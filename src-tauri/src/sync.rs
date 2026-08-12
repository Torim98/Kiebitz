//! Geräte-Sync v1 · direkter Abgleich im lokalen Netz, Desktop als Hub.
//!
//! Das Handy stößt den Sync an (ein POST-Roundtrip): es schickt seine lokalen
//! Änderungen und bekommt die Desktop-Änderungen seit dem letzten Sync zurück.
//! Kein Server, keine Cloud · der Desktop lauscht nur solange die App läuft
//! auf Port 47323, abgesichert über einen Pairing-Code aus den Einstellungen.
//!
//! Merge-Regeln (idempotent, wiederholbar):
//! - Partien: Upsert per Natural Key (source, source_id); `analyzed` wird nie
//!   zurückgesetzt, `accuracy` per COALESCE; Analyse-Züge (move_evals) werden
//!   übernommen, wenn die Gegenseite analysiert hat und wir nicht.
//! - Notizen: Last-Write-Wins über `note_ts`.
//! - Repertoire: Knoten werden per Pfad (side + SAN-Kette) additiv vereinigt;
//!   der FSRS-Zustand pro Knoten gewinnt nach `last_ts` (die frischere Review).
//!   Löschungen propagieren in v1 nicht.
//! - Puzzle-/Endspiel-Versuche: append-only-Union, Duplikate über
//!   (puzzle_id|drill_id, ts) erkannt.
//! - Study: Vorlagen und Kalendereinträge per stabiler Sync-ID; der neuere
//!   `updated_ts`-Stand gewinnt, einschließlich Abschluss und Löschung.
//! - Eigene Puzzles: vollständiger Desktop-Snapshot; die lokale Game-ID wird
//!   über den stabilen Partie-Schlüssel (source, source_id) neu zugeordnet.
//! - Nicht gesynct: Lichess-Puzzle-DB, positions-Index (wird lokal neu
//!   aufgebaut), Caches. Puzzle-Ratings bleiben Geräte-lokal (v1).
//!
//! Cursor: der Client merkt sich die Serverzeit des letzten Syncs (meta
//! `sync_last_ts`) und beide Seiten filtern veränderliche Datensätze mit einem
//! Sicherheitsfenster (SLACK). Manuell importierte Partien und append-only
//! Puzzle-Versuche reisen dagegen vollständig mit: Erstere lassen sich nicht
//! von einer Online-Quelle nachladen, bei Letzteren ist `ts` der Zeitpunkt des
//! Trainings und kein verlässlicher Änderungs-Cursor. Doppel-Übertragungen sind
//! durch die idempotenten Merges gratis; Tombstones verhindern, dass gelöschte
//! manuelle Partien dabei wieder auftauchen.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

use crate::{db, settings};

pub const SYNC_PORT: u16 = 47323;
/// UDP-Port für die Auto-Discovery ("Desktop suchen" auf dem Handy).
pub const DISCOVERY_PORT: u16 = 47324;
const DISCOVER_MSG: &[u8] = b"KIEBITZ_DISCOVER_V1";
const DISCOVER_REPLY: &str = "KIEBITZ_HERE";
/// Sicherheitsfenster gegen Uhren-Drift zwischen den Geräten (Sekunden).
const SLACK: i64 = 600;
/// Obergrenze für den Request-Body (Schutz gegen Unsinn auf dem Port).
const MAX_BODY: usize = 256 * 1024 * 1024;

// ── Payload-Typen ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncEval {
    pub ply: i64,
    pub san: String,
    pub eval_cp: Option<i64>,
    pub mate_in: Option<i64>,
    pub best_uci: String,
    pub judgment: String,
    pub phase: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncGame {
    pub source: String,
    pub source_id: String,
    pub url: String,
    pub played_at: String,
    pub played_ts: i64,
    pub time_class: String,
    pub color: String,
    #[serde(default)]
    pub my_name: String,
    pub opponent: String,
    pub opp_elo: i64,
    pub my_elo: i64,
    pub result: String,
    pub opening: String,
    pub eco: String,
    pub moves_count: i64,
    pub accuracy: Option<f64>,
    #[serde(default)]
    pub accuracy_opening: Option<f64>,
    #[serde(default)]
    pub accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub accuracy_endgame: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_opening: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_endgame: Option<f64>,
    pub moves: String,
    /// Restzeit nach jedem Halbzug (Hundertstelsekunden). Ältere Gegenstellen
    /// kennen das Feld nicht · dort bleibt die Partie ohne Uhren.
    #[serde(default)]
    pub clocks: String,
    #[serde(default)]
    pub time_control: String,
    pub note: String,
    pub note_ts: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tags_ts: i64,
    pub analyzed: bool,
    /// Zeitpunkt der Auto-Analyse · der Wochenkalender zählt Partie-Reviews
    /// dadurch auf jedem Gerät am selben Tag.
    #[serde(default)]
    pub analyzed_ts: i64,
    #[serde(default)]
    pub analysis_excluded: bool,
    /// Ursprungszeit der letzten Änderung; entscheidet gegen Löschmarker.
    #[serde(default)]
    pub updated_ts: i64,
    pub evals: Vec<SyncEval>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncGameTombstone {
    pub source: String,
    pub source_id: String,
    pub deleted_ts: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncRepNode {
    pub side: String,
    /// SAN-Kette von der Wurzel bis zu diesem Knoten, mit ' ' verbunden.
    pub path: String,
    pub name: String,
    pub fen_key: String,
    pub depth: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    pub due_ts: i64,
    pub last_ts: i64,
    /// Anlage-Zeitpunkt · entscheidet gegen Tombstones (Wieder-Anlegen gewinnt).
    #[serde(default)]
    pub created_ts: i64,
}

/// Gelöschter Repertoire-Teilbaum (Löschung propagiert auf gepairte Geräte).
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncTombstone {
    pub side: String,
    pub path: String,
    pub deleted_ts: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncPuzzleAttempt {
    pub puzzle_id: String,
    pub ts: i64,
    pub solved: bool,
    pub rating_before: i64,
    pub rating_after: i64,
    pub themes: String,
    /// Puzzle-Rating zur Versuchszeit · Basis für den deterministischen
    /// Elo-Replay nach einem Merge (0 = unbekannt, Versuch neutral).
    #[serde(default)]
    pub puzzle_rating: i64,
}

/// Ein von der Desktop-Analyse erzeugtes Puzzle. `source_game_id` ist bewusst
/// nicht Teil des Payloads: SQLite-IDs sind gerätelokal, deshalb reist der
/// natürliche Schlüssel der Partie mit.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncOwnPuzzle {
    pub id: String,
    pub fen: String,
    pub moves: String,
    pub rating: i64,
    pub rd: i64,
    pub popularity: i64,
    pub nb_plays: i64,
    pub themes: String,
    pub opening_tags: String,
    pub game_source: String,
    pub game_source_id: String,
    pub source_ply: Option<i64>,
    pub setup_plies: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncEndgameAttempt {
    pub drill_id: String,
    pub ts: i64,
    pub solved: bool,
    pub moves: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyTemplate {
    pub sync_key: String,
    pub title: String,
    pub duration_min: i64,
    pub tool: String,
    pub description: String,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyEvent {
    pub sync_key: String,
    pub template_sync_key: String,
    pub day: String,
    pub position: i64,
    pub completed: bool,
    pub completed_ts: i64,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
    /// Wiederholungsraster der Serie ("" = Einzeltermin). Ältere Gegenstellen
    /// kennen das Feld nicht · dort bleiben Serien einzelne Termine.
    #[serde(default)]
    pub repeat_rule: String,
    #[serde(default)]
    pub series_key: String,
}

/// Eine Repertoire-Wiederholung. Der natürliche Schlüssel ist `(side, path)`
/// wie bei Knoten und Tombstones · lokale `node_id` reisen nicht mit.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncRepReview {
    pub side: String,
    pub path: String,
    pub ts: i64,
    pub grade: i64,
}

/// Ein Fokus-Zyklus. Enthält nur die Absicht; Messwerte werden auf jedem Gerät
/// aus den Rohdaten neu gerechnet.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyFocus {
    pub sync_key: String,
    pub area: String,
    pub metric_key: String,
    pub label_params: String,
    pub target: Option<f64>,
    pub cycle_days: i64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub status: String,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize)]
pub struct SyncRequest {
    pub code: String,
    /// Serverzeit des letzten erfolgreichen Syncs (0 = erster Sync).
    pub since: i64,
    pub games: Vec<SyncGame>,
    #[serde(default)]
    pub game_tombstones: Vec<SyncGameTombstone>,
    pub rep_nodes: Vec<SyncRepNode>,
    #[serde(default)]
    pub rep_tombstones: Vec<SyncTombstone>,
    pub puzzle_attempts: Vec<SyncPuzzleAttempt>,
    pub endgame_attempts: Vec<SyncEndgameAttempt>,
    #[serde(default)]
    pub study_templates: Vec<SyncStudyTemplate>,
    #[serde(default)]
    pub study_events: Vec<SyncStudyEvent>,
    #[serde(default)]
    pub rep_reviews: Vec<SyncRepReview>,
    #[serde(default)]
    pub study_focus: Vec<SyncStudyFocus>,
}

#[derive(Serialize, Deserialize)]
pub struct SyncResponse {
    pub now: i64,
    pub games: Vec<SyncGame>,
    #[serde(default)]
    pub game_tombstones: Vec<SyncGameTombstone>,
    pub rep_nodes: Vec<SyncRepNode>,
    #[serde(default)]
    pub rep_tombstones: Vec<SyncTombstone>,
    pub puzzle_attempts: Vec<SyncPuzzleAttempt>,
    /// `None` bedeutet eine ältere Gegenstelle, die eigene Puzzles noch nicht
    /// mitsendet. `Some([])` ist dagegen ein autoritativer leerer Snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_puzzles: Option<Vec<SyncOwnPuzzle>>,
    pub endgame_attempts: Vec<SyncEndgameAttempt>,
    #[serde(default)]
    pub study_templates: Vec<SyncStudyTemplate>,
    #[serde(default)]
    pub study_events: Vec<SyncStudyEvent>,
    #[serde(default)]
    pub rep_reviews: Vec<SyncRepReview>,
    #[serde(default)]
    pub study_focus: Vec<SyncStudyFocus>,
}

// ── Collect: lokale Daten für die Gegenseite einsammeln ─────────────────────

fn collect_games(conn: &Connection, since: i64) -> Result<Vec<SyncGame>, String> {
    let cutoff = since.saturating_sub(SLACK);
    let mut stmt = conn
        .prepare(
            "SELECT id, source, source_id, url, played_at, played_ts, time_class, color,
                    my_name, opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame,
                    opponent_accuracy, opponent_accuracy_opening,
                    opponent_accuracy_middlegame, opponent_accuracy_endgame,
                    moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts,
                    analyzed_ts, clocks, time_control
             FROM games
             WHERE source = 'manual' OR updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, SyncGame)> = stmt
        .query_map(params![cutoff], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                SyncGame {
                    source: r.get(1)?,
                    source_id: r.get(2)?,
                    url: r.get(3)?,
                    played_at: r.get(4)?,
                    played_ts: r.get(5)?,
                    time_class: r.get(6)?,
                    color: r.get(7)?,
                    my_name: r.get(8)?,
                    opponent: r.get(9)?,
                    opp_elo: r.get(10)?,
                    my_elo: r.get(11)?,
                    result: r.get(12)?,
                    opening: r.get(13)?,
                    eco: r.get(14)?,
                    moves_count: r.get(15)?,
                    accuracy: r.get(16)?,
                    accuracy_opening: r.get(17)?,
                    accuracy_middlegame: r.get(18)?,
                    accuracy_endgame: r.get(19)?,
                    opponent_accuracy: r.get(20)?,
                    opponent_accuracy_opening: r.get(21)?,
                    opponent_accuracy_middlegame: r.get(22)?,
                    opponent_accuracy_endgame: r.get(23)?,
                    moves: r.get(24)?,
                    note: r.get(25)?,
                    note_ts: r.get(26)?,
                    tags: serde_json::from_str(&r.get::<_, String>(27)?).unwrap_or_default(),
                    tags_ts: r.get(28)?,
                    analyzed: r.get::<_, i64>(29)? != 0,
                    analysis_excluded: r.get::<_, i64>(30)? != 0,
                    updated_ts: r.get(31)?,
                    analyzed_ts: r.get(32)?,
                    clocks: r.get(33)?,
                    time_control: r.get(34)?,
                    evals: Vec::new(),
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut eval_stmt = conn
        .prepare(
            "SELECT ply, san, eval_cp, mate_in, best_uci, judgment, phase
             FROM move_evals WHERE game_id = ?1 ORDER BY ply",
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, mut g) in rows {
        if g.analyzed {
            g.evals = eval_stmt
                .query_map(params![id], |r| {
                    Ok(SyncEval {
                        ply: r.get(0)?,
                        san: r.get(1)?,
                        eval_cp: r.get(2)?,
                        mate_in: r.get(3)?,
                        best_uci: r.get(4)?,
                        judgment: r.get(5)?,
                        phase: r.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?;
        }
        out.push(g);
    }
    Ok(out)
}

fn collect_game_tombstones(conn: &Connection) -> Result<Vec<SyncGameTombstone>, String> {
    let mut stmt = conn
        .prepare("SELECT source, source_id, deleted_ts FROM game_tombstones")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncGameTombstone {
                source: r.get(0)?,
                source_id: r.get(1)?,
                deleted_ts: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Kompletter Repertoire-Baum mit berechneten Pfaden (klein genug für "immer alles").
fn collect_rep(conn: &Connection) -> Result<Vec<SyncRepNode>, String> {
    struct Row {
        id: i64,
        parent_id: i64,
        side: String,
        san: String,
        name: String,
        fen_key: String,
        depth: i64,
        stability: f64,
        difficulty: f64,
        reps: i64,
        lapses: i64,
        due_ts: i64,
        last_ts: i64,
        created_ts: i64,
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, side, san, name, fen_key, depth, stability, difficulty,
                    reps, lapses, due_ts, last_ts, created_ts
             FROM rep_nodes ORDER BY depth, id",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<Row> = stmt
        .query_map([], |r| {
            Ok(Row {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                side: r.get(2)?,
                san: r.get(3)?,
                name: r.get(4)?,
                fen_key: r.get(5)?,
                depth: r.get(6)?,
                stability: r.get(7)?,
                difficulty: r.get(8)?,
                reps: r.get(9)?,
                lapses: r.get(10)?,
                due_ts: r.get(11)?,
                last_ts: r.get(12)?,
                created_ts: r.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    // Pfade aufbauen: dank ORDER BY depth sind Eltern immer vor Kindern dran.
    let mut paths: HashMap<i64, String> = HashMap::new();
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let path = if r.parent_id == 0 {
            r.san.clone()
        } else {
            match paths.get(&r.parent_id) {
                Some(p) => format!("{p} {}", r.san),
                None => continue, // verwaister Knoten · überspringen
            }
        };
        paths.insert(r.id, path.clone());
        out.push(SyncRepNode {
            side: r.side.clone(),
            path,
            name: r.name.clone(),
            fen_key: r.fen_key.clone(),
            depth: r.depth,
            stability: r.stability,
            difficulty: r.difficulty,
            reps: r.reps,
            lapses: r.lapses,
            due_ts: r.due_ts,
            last_ts: r.last_ts,
            created_ts: r.created_ts,
        });
    }
    Ok(out)
}

fn collect_tombstones(conn: &Connection) -> Result<Vec<SyncTombstone>, String> {
    let mut stmt = conn
        .prepare("SELECT side, path, deleted_ts FROM rep_tombstones")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncTombstone {
                side: r.get(0)?,
                path: r.get(1)?,
                deleted_ts: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Tombstones der Gegenseite übernehmen (Union, neuester Zeitstempel gewinnt)
/// und danach lokal alle abgedeckten Knoten löschen, die älter sind als die
/// Löschung · jüngere (wieder angelegte oder frisch trainierte) überleben.
fn apply_tombstones(conn: &mut Connection, tombstones: &[SyncTombstone]) -> Result<usize, String> {
    for t in tombstones {
        conn.execute(
            "INSERT INTO rep_tombstones (side, path, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(side, path) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![t.side, t.path, t.deleted_ts],
        )
        .map_err(|e| e.to_string())?;
    }
    // Sweep über den lokalen Baum mit allen (auch schon vorhandenen) Tombstones.
    let all = collect_tombstones(conn)?;
    if all.is_empty() {
        return Ok(0);
    }
    let local = collect_rep(conn)?;
    let mut delete_keys: Vec<(String, String)> = Vec::new();
    for n in &local {
        let alive = n.last_ts.max(n.created_ts);
        let covered = all.iter().any(|t| {
            t.side == n.side
                && (n.path == t.path || n.path.starts_with(&format!("{} ", t.path)))
                && t.deleted_ts > alive
        });
        if covered {
            delete_keys.push((n.side.clone(), n.path.clone()));
        }
    }
    // Über (side, parent, san) je Ebene löschen · wir haben nur Pfade, keine IDs.
    let mut deleted = 0usize;
    if !delete_keys.is_empty() {
        // IDs nachschlagen wie in apply_rep.
        let mut stmt = conn
            .prepare("SELECT id, parent_id, side, san FROM rep_nodes ORDER BY depth, id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);
        let mut paths: HashMap<i64, String> = HashMap::new();
        let mut ids: Vec<i64> = Vec::new();
        for (id, parent_id, side, san) in rows {
            let path = if parent_id == 0 {
                san
            } else {
                match paths.get(&parent_id) {
                    Some(p) => format!("{p} {san}"),
                    None => continue,
                }
            };
            paths.insert(id, path.clone());
            if delete_keys.iter().any(|(s, p)| *s == side && *p == path) {
                ids.push(id);
            }
        }
        for id in ids {
            deleted += conn
                .execute("DELETE FROM rep_nodes WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(deleted)
}

fn collect_puzzle_attempts(
    conn: &Connection,
    _since: i64,
) -> Result<Vec<SyncPuzzleAttempt>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating
             FROM puzzle_attempts ORDER BY ts, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncPuzzleAttempt {
                puzzle_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                rating_before: r.get(3)?,
                rating_after: r.get(4)?,
                themes: r.get(5)?,
                puzzle_rating: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

/// Eigene Puzzles sind im Vergleich zum Lichess-Dump klein und abgeleitete
/// Desktop-Daten. Ein vollständiger Snapshot macht auch Entfernungen nach einer
/// Re-Analyse ohne Puzzle-Tombstones eindeutig.
fn collect_own_puzzles(conn: &Connection) -> Result<Vec<SyncOwnPuzzle>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.fen, p.moves, p.rating, p.rd, p.popularity, p.nb_plays,
                    p.themes, p.opening_tags, g.source, g.source_id,
                    p.source_ply, p.setup_plies
             FROM puzzles p
             JOIN games g ON g.id = p.source_game_id
             WHERE p.source = 'own'
             ORDER BY p.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SyncOwnPuzzle {
                id: r.get(0)?,
                fen: r.get(1)?,
                moves: r.get(2)?,
                rating: r.get(3)?,
                rd: r.get(4)?,
                popularity: r.get(5)?,
                nb_plays: r.get(6)?,
                themes: r.get(7)?,
                opening_tags: r.get(8)?,
                game_source: r.get(9)?,
                game_source_id: r.get(10)?,
                source_ply: r.get(11)?,
                setup_plies: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_endgame_attempts(
    conn: &Connection,
    since: i64,
) -> Result<Vec<SyncEndgameAttempt>, String> {
    let mut stmt = conn
        .prepare("SELECT drill_id, ts, solved, moves FROM endgame_attempts WHERE ts >= ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncEndgameAttempt {
                drill_id: r.get(0)?,
                ts: r.get(1)?,
                solved: r.get::<_, i64>(2)? != 0,
                moves: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_templates(
    conn: &Connection,
    since: i64,
) -> Result<Vec<SyncStudyTemplate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sync_key, title, duration_min, tool, description,
                    created_ts, updated_ts, deleted
             FROM study_templates WHERE updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyTemplate {
                sync_key: r.get(0)?,
                title: r.get(1)?,
                duration_min: r.get(2)?,
                tool: r.get(3)?,
                description: r.get(4)?,
                created_ts: r.get(5)?,
                updated_ts: r.get(6)?,
                deleted: r.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_events(conn: &Connection, since: i64) -> Result<Vec<SyncStudyEvent>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.sync_key, t.sync_key, e.day, e.position, e.completed,
                    e.completed_ts, e.created_ts, e.updated_ts, e.deleted,
                    e.repeat_rule, e.series_key
             FROM study_events e
             JOIN study_templates t ON t.id = e.template_id
             WHERE e.updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyEvent {
                sync_key: r.get(0)?,
                template_sync_key: r.get(1)?,
                day: r.get(2)?,
                position: r.get(3)?,
                completed: r.get::<_, i64>(4)? != 0,
                completed_ts: r.get(5)?,
                created_ts: r.get(6)?,
                updated_ts: r.get(7)?,
                deleted: r.get::<_, i64>(8)? != 0,
                repeat_rule: r.get(9)?,
                series_key: r.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_rep_reviews(conn: &Connection, since: i64) -> Result<Vec<SyncRepReview>, String> {
    let mut stmt = conn
        .prepare("SELECT side, path, ts, grade FROM rep_review_log WHERE ts >= ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncRepReview {
                side: r.get(0)?,
                path: r.get(1)?,
                ts: r.get(2)?,
                grade: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

fn collect_study_focus(conn: &Connection, since: i64) -> Result<Vec<SyncStudyFocus>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sync_key, area, metric_key, label_params, target, cycle_days,
                    start_ts, end_ts, status, created_ts, updated_ts, deleted
             FROM study_focus WHERE updated_ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
            Ok(SyncStudyFocus {
                sync_key: r.get(0)?,
                area: r.get(1)?,
                metric_key: r.get(2)?,
                label_params: r.get(3)?,
                target: r.get(4)?,
                cycle_days: r.get(5)?,
                start_ts: r.get(6)?,
                end_ts: r.get(7)?,
                status: r.get(8)?,
                created_ts: r.get(9)?,
                updated_ts: r.get(10)?,
                deleted: r.get::<_, i64>(11)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string());
    rows
}

// ── Apply: Daten der Gegenseite einmergen ───────────────────────────────────

fn apply_game_tombstones(
    conn: &mut Connection,
    tombstones: &[SyncGameTombstone],
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut deleted = 0usize;
    for tombstone in tombstones {
        tx.execute(
            "INSERT INTO game_tombstones (source, source_id, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(source, source_id) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![tombstone.source, tombstone.source_id, tombstone.deleted_ts],
        )
        .map_err(|e| e.to_string())?;
        let local: Option<(i64, i64)> = tx
            .query_row(
                "SELECT id, updated_ts FROM games WHERE source = ?1 AND source_id = ?2",
                params![tombstone.source, tombstone.source_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        if let Some((id, updated_ts)) = local {
            if tombstone.deleted_ts >= updated_ts {
                db::delete_game_rows(&tx, id)?;
                deleted += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted)
}

fn apply_games(conn: &mut Connection, games: &[SyncGame]) -> Result<usize, String> {
    let now = db::now_ts();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut applied = 0usize;
    for g in games {
        let tombstone_ts: Option<i64> = tx
            .query_row(
                "SELECT deleted_ts FROM game_tombstones WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
                |row| row.get(0),
            )
            .ok();
        if tombstone_ts.is_some_and(|deleted_ts| deleted_ts >= g.updated_ts) {
            continue;
        }
        if tombstone_ts.is_some() {
            tx.execute(
                "DELETE FROM game_tombstones WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
            )
            .map_err(|e| e.to_string())?;
        }
        let incoming_updated = if g.updated_ts > 0 { g.updated_ts } else { now };
        let existing: Option<(i64, i64, i64, bool, i64)> = tx
            .query_row(
                "SELECT id, note_ts, tags_ts, analyzed, updated_ts FROM games WHERE source = ?1 AND source_id = ?2",
                params![g.source, g.source_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? != 0, r.get(4)?)),
            )
            .ok();
        let game_id = match existing {
            None => {
                tx.execute(
                    "INSERT INTO games (source, source_id, url, played_at, played_ts, time_class,
                        color, my_name, opponent, opp_elo, my_elo, result, opening, eco, moves_count,
                        accuracy, accuracy_opening, accuracy_middlegame, accuracy_endgame,
                        opponent_accuracy, opponent_accuracy_opening,
                        opponent_accuracy_middlegame, opponent_accuracy_endgame,
                        moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts,
                        analyzed_ts, clocks, time_control)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34)",
                    params![
                        g.source, g.source_id, g.url, g.played_at, g.played_ts, g.time_class,
                        g.color, g.my_name, g.opponent, g.opp_elo, g.my_elo, g.result, g.opening, g.eco,
                        g.moves_count, g.accuracy, g.accuracy_opening, g.accuracy_middlegame,
                        g.accuracy_endgame, g.opponent_accuracy, g.opponent_accuracy_opening,
                        g.opponent_accuracy_middlegame, g.opponent_accuracy_endgame,
                        g.moves, g.note, g.note_ts,
                        serde_json::to_string(&g.tags).map_err(|e| e.to_string())?, g.tags_ts,
                        g.analyzed as i64, g.analysis_excluded as i64, incoming_updated,
                        g.analyzed_ts, g.clocks, g.time_control
                    ],
                )
                .map_err(|e| e.to_string())?;
                applied += 1;
                tx.last_insert_rowid()
            }
            Some((id, local_note_ts, local_tags_ts, _, _local_updated_ts)) => {
                tx.execute(
                    "UPDATE games SET
                        accuracy = COALESCE(accuracy, ?2),
                        accuracy_opening = COALESCE(accuracy_opening, ?3),
                        accuracy_middlegame = COALESCE(accuracy_middlegame, ?4),
                        accuracy_endgame = COALESCE(accuracy_endgame, ?5),
                        opponent_accuracy = COALESCE(opponent_accuracy, ?6),
                        opponent_accuracy_opening = COALESCE(opponent_accuracy_opening, ?7),
                        opponent_accuracy_middlegame = COALESCE(opponent_accuracy_middlegame, ?8),
                        opponent_accuracy_endgame = COALESCE(opponent_accuracy_endgame, ?9),
                        analyzed = MAX(analyzed, ?10),
                        -- Erste bekannte Analysezeit gewinnt (0 = noch keine).
                        analyzed_ts = CASE WHEN analyzed_ts = 0 THEN ?15 ELSE analyzed_ts END,
                        analysis_excluded = CASE WHEN ?11 >= updated_ts THEN ?12 ELSE analysis_excluded END,
                        time_class = CASE WHEN ?11 >= updated_ts THEN ?13 ELSE time_class END,
                        my_name = CASE WHEN ?11 >= updated_ts AND ?14 != '' THEN ?14 ELSE my_name END,
                        -- Uhrendaten sind unveränderliche Partiedaten: wer sie
                        -- hat, behält sie; wer keine hat, übernimmt sie.
                        clocks = CASE WHEN clocks = '' THEN ?16 ELSE clocks END,
                        time_control = CASE WHEN time_control = '' THEN ?17 ELSE time_control END,
                        updated_ts = MAX(updated_ts, ?11)
                     WHERE id = ?1",
                    params![
                        id,
                        g.accuracy,
                        g.accuracy_opening,
                        g.accuracy_middlegame,
                        g.accuracy_endgame,
                        g.opponent_accuracy,
                        g.opponent_accuracy_opening,
                        g.opponent_accuracy_middlegame,
                        g.opponent_accuracy_endgame,
                        g.analyzed as i64,
                        incoming_updated,
                        g.analysis_excluded as i64,
                        g.time_class,
                        g.my_name,
                        g.analyzed_ts,
                        g.clocks,
                        g.time_control
                    ],
                )
                .map_err(|e| e.to_string())?;
                if g.note_ts > local_note_ts {
                    tx.execute(
                        "UPDATE games SET note = ?2, note_ts = ?3 WHERE id = ?1",
                        params![id, g.note, g.note_ts],
                    )
                    .map_err(|e| e.to_string())?;
                }
                if g.tags_ts > local_tags_ts {
                    tx.execute(
                        "UPDATE games SET tags = ?2, tags_ts = ?3 WHERE id = ?1",
                        params![
                            id,
                            serde_json::to_string(&g.tags).map_err(|e| e.to_string())?,
                            g.tags_ts
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                }
                applied += 1;
                id
            }
        };
        // Analyse übernehmen, wenn die Gegenseite sie hat und wir (noch) nicht.
        let locally_analyzed = existing.map(|(_, _, _, a, _)| a).unwrap_or(false);
        if !g.evals.is_empty() && !locally_analyzed {
            tx.execute(
                "DELETE FROM move_evals WHERE game_id = ?1",
                params![game_id],
            )
            .map_err(|e| e.to_string())?;
            let mut ins = tx
                .prepare(
                    "INSERT INTO move_evals (game_id, ply, san, eval_cp, mate_in, best_uci, judgment, phase)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                )
                .map_err(|e| e.to_string())?;
            for e in &g.evals {
                ins.execute(params![
                    game_id, e.ply, e.san, e.eval_cp, e.mate_in, e.best_uci, e.judgment, e.phase
                ])
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(applied)
}

fn apply_rep(conn: &mut Connection, nodes: &[SyncRepNode]) -> Result<usize, String> {
    // Lokale Pfade aufbauen (side + "\n" + Pfad → id, last_ts).
    let mut local_ids: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, side, san, last_ts FROM rep_nodes ORDER BY depth, id")
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, String, String, i64)> = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        let mut paths: HashMap<i64, String> = HashMap::new();
        for (id, parent_id, side, san, last_ts) in rows {
            let path = if parent_id == 0 {
                san
            } else {
                match paths.get(&parent_id) {
                    Some(p) => format!("{p} {san}"),
                    None => continue,
                }
            };
            paths.insert(id, path.clone());
            local_ids.insert(format!("{side}\n{path}"), (id, last_ts));
        }
    }

    // Tombstones: gelöschte Pfade nicht wieder anlegen, außer der Knoten ist
    // jünger als die Löschung (Wieder-Anlegen/Training nach dem Löschen).
    let tombstones = collect_tombstones(conn)?;

    // Eltern vor Kindern anlegen.
    let mut sorted: Vec<&SyncRepNode> = nodes.iter().collect();
    sorted.sort_by_key(|n| n.depth);
    let mut merged = 0usize;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for n in sorted {
        let alive = n.last_ts.max(n.created_ts);
        let buried = tombstones.iter().any(|t| {
            t.side == n.side
                && (n.path == t.path || n.path.starts_with(&format!("{} ", t.path)))
                && t.deleted_ts > alive
        });
        if buried {
            continue;
        }
        let key = format!("{}\n{}", n.side, n.path);
        match local_ids.get(&key) {
            None => {
                let parent_key = n
                    .path
                    .rsplit_once(' ')
                    .map(|(prefix, _)| format!("{}\n{}", n.side, prefix));
                let parent_id = match &parent_key {
                    None => 0,
                    Some(k) => match local_ids.get(k) {
                        Some((id, _)) => *id,
                        None => continue, // Elternknoten fehlt (übersprungen) · Kind auslassen
                    },
                };
                let san = n.path.rsplit(' ').next().unwrap_or(&n.path);
                tx.execute(
                    "INSERT INTO rep_nodes (parent_id, side, san, name, fen_key, depth,
                        stability, difficulty, reps, lapses, due_ts, last_ts, created_ts)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                    params![
                        parent_id,
                        n.side,
                        san,
                        n.name,
                        n.fen_key,
                        n.depth,
                        n.stability,
                        n.difficulty,
                        n.reps,
                        n.lapses,
                        n.due_ts,
                        n.last_ts,
                        n.created_ts
                    ],
                )
                .map_err(|e| e.to_string())?;
                local_ids.insert(key, (tx.last_insert_rowid(), n.last_ts));
                merged += 1;
            }
            Some((id, local_last)) => {
                if n.last_ts > *local_last {
                    tx.execute(
                        "UPDATE rep_nodes SET stability = ?2, difficulty = ?3, reps = ?4,
                            lapses = ?5, due_ts = ?6, last_ts = ?7 WHERE id = ?1",
                        params![
                            id,
                            n.stability,
                            n.difficulty,
                            n.reps,
                            n.lapses,
                            n.due_ts,
                            n.last_ts
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                    merged += 1;
                }
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(merged)
}

fn apply_puzzle_attempts(
    conn: &Connection,
    attempts: &[SyncPuzzleAttempt],
) -> Result<usize, String> {
    let mut n = 0usize;
    for a in attempts {
        n += conn
            .execute(
                "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating)
                 SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
                 WHERE NOT EXISTS (SELECT 1 FROM puzzle_attempts WHERE puzzle_id = ?1 AND ts = ?2)",
                params![a.puzzle_id, a.ts, a.solved as i64, a.rating_before, a.rating_after, a.themes, a.puzzle_rating],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

/// Spiegelt den autoritativen Desktop-Snapshot. Puzzles werden über den
/// natürlichen Partie-Schlüssel an die gerätelokale Game-ID gehängt.
fn apply_own_puzzles(conn: &mut Connection, puzzles: &[SyncOwnPuzzle]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut retained = HashSet::new();
    let mut changed = 0usize;

    for puzzle in puzzles {
        let game_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM games WHERE source = ?1 AND source_id = ?2",
                params![puzzle.game_source, puzzle.game_source_id],
                |row| row.get(0),
            )
            .ok();
        let Some(game_id) = game_id else {
            continue;
        };

        retained.insert(puzzle.id.clone());
        changed += tx
            .execute(
                "INSERT INTO puzzles
                 (id, fen, moves, rating, rd, popularity, nb_plays, themes,
                  opening_tags, source, source_game_id, source_ply, setup_plies)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'own',?10,?11,?12)
                 ON CONFLICT(id) DO UPDATE SET
                    fen = excluded.fen,
                    moves = excluded.moves,
                    rating = excluded.rating,
                    rd = excluded.rd,
                    popularity = excluded.popularity,
                    nb_plays = excluded.nb_plays,
                    themes = excluded.themes,
                    opening_tags = excluded.opening_tags,
                    source = 'own',
                    source_game_id = excluded.source_game_id,
                    source_ply = excluded.source_ply,
                    setup_plies = excluded.setup_plies",
                params![
                    puzzle.id,
                    puzzle.fen,
                    puzzle.moves,
                    puzzle.rating,
                    puzzle.rd,
                    puzzle.popularity,
                    puzzle.nb_plays,
                    puzzle.themes,
                    puzzle.opening_tags,
                    game_id,
                    puzzle.source_ply,
                    puzzle.setup_plies
                ],
            )
            .map_err(|e| e.to_string())?;
    }

    let local_ids: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT id FROM puzzles WHERE source = 'own'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    for id in local_ids {
        if !retained.contains(&id) {
            changed += tx
                .execute(
                    "DELETE FROM puzzles WHERE source = 'own' AND id = ?1",
                    params![id],
                )
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(changed)
}

/// Spielt die Elo-Kette über alle Versuche deterministisch neu ab · nach einem
/// Merge haben damit beide Geräte identische Ratings. Sortiert wird geräte-
/// unabhängig nach (ts, puzzle_id); Versuche ohne bekanntes Puzzle-Rating
/// (puzzle_rating = 0) lassen das Rating unverändert.
fn replay_puzzle_ratings(conn: &mut Connection) -> Result<(), String> {
    const ELO_K: f64 = 24.0; // identisch zu puzzles.rs
    const DEFAULT_RATING: i64 = 1500;
    let rows: Vec<(i64, bool, i64)> = {
        let mut stmt = conn
            .prepare("SELECT id, solved, puzzle_rating FROM puzzle_attempts ORDER BY ts, puzzle_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string());
        rows?
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut rating = DEFAULT_RATING;
    for (id, solved, puzzle_rating) in rows {
        let before = rating;
        let after = if puzzle_rating > 0 {
            let expected = 1.0 / (1.0 + 10f64.powf((puzzle_rating - before) as f64 / 400.0));
            let score = if solved { 1.0 } else { 0.0 };
            (before as f64 + ELO_K * (score - expected)).round() as i64
        } else {
            before
        };
        tx.execute(
            "UPDATE puzzle_attempts SET rating_before = ?2, rating_after = ?3 WHERE id = ?1",
            params![id, before, after],
        )
        .map_err(|e| e.to_string())?;
        rating = after;
    }
    db::meta_set(&tx, "puzzle_rating", &rating.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_endgame_attempts(
    conn: &Connection,
    attempts: &[SyncEndgameAttempt],
) -> Result<usize, String> {
    let mut n = 0usize;
    for a in attempts {
        n += conn
            .execute(
                "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
                 SELECT ?1, ?2, ?3, ?4
                 WHERE NOT EXISTS (SELECT 1 FROM endgame_attempts WHERE drill_id = ?1 AND ts = ?2)",
                params![a.drill_id, a.ts, a.solved as i64, a.moves],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(n)
}

fn apply_study_templates(
    conn: &Connection,
    templates: &[SyncStudyTemplate],
) -> Result<usize, String> {
    let mut merged = 0usize;
    for template in templates {
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_templates WHERE sync_key = ?1",
            params![template.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if template.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_templates
                         SET title=?1, duration_min=?2, tool=?3, description=?4,
                             created_ts=?5, updated_ts=?6, deleted=?7
                         WHERE id=?8",
                        params![
                            template.title,
                            template.duration_min,
                            template.tool,
                            template.description,
                            template.created_ts,
                            template.updated_ts,
                            template.deleted as i64,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_templates
                         (sync_key, title, duration_min, tool, description,
                          created_ts, updated_ts, deleted)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        params![
                            template.sync_key,
                            template.title,
                            template.duration_min,
                            template.tool,
                            template.description,
                            template.created_ts,
                            template.updated_ts,
                            template.deleted as i64
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

fn apply_study_events(conn: &Connection, events: &[SyncStudyEvent]) -> Result<usize, String> {
    let mut merged = 0usize;
    for event in events {
        let template_id = match conn.query_row(
            "SELECT id FROM study_templates WHERE sync_key = ?1",
            params![event.template_sync_key],
            |row| row.get::<_, i64>(0),
        ) {
            Ok(id) => id,
            Err(rusqlite::Error::QueryReturnedNoRows) => continue,
            Err(error) => return Err(error.to_string()),
        };
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_events WHERE sync_key = ?1",
            params![event.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if event.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_events
                         SET template_id=?1, day=?2, position=?3, completed=?4,
                             completed_ts=?5, created_ts=?6, updated_ts=?7, deleted=?8,
                             repeat_rule=?9, series_key=?10
                         WHERE id=?11",
                        params![
                            template_id,
                            event.day,
                            event.position,
                            event.completed as i64,
                            event.completed_ts,
                            event.created_ts,
                            event.updated_ts,
                            event.deleted as i64,
                            event.repeat_rule,
                            event.series_key,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_events
                         (sync_key, template_id, day, position, completed,
                          completed_ts, created_ts, updated_ts, deleted,
                          repeat_rule, series_key)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                        params![
                            event.sync_key,
                            template_id,
                            event.day,
                            event.position,
                            event.completed as i64,
                            event.completed_ts,
                            event.created_ts,
                            event.updated_ts,
                            event.deleted as i64,
                            event.repeat_rule,
                            event.series_key
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

/// Wiederholungen sind append-only · der Merge ist eine Vereinigung über den
/// natürlichen Schlüssel `(side, path, ts)`.
///
/// Fremde Zeilen bekommen `node_id = 0`: SQLite-IDs sind gerätelokal, und für
/// die Trainingslast zählt allein der Zeitpunkt. Die Spalte bleibt eine
/// Bequemlichkeit für lokal geschriebene Zeilen, kein Fremdschlüssel.
fn apply_rep_reviews(conn: &Connection, reviews: &[SyncRepReview]) -> Result<usize, String> {
    let mut merged = 0usize;
    for review in reviews {
        merged += conn
            .execute(
                "INSERT OR IGNORE INTO rep_review_log (node_id, ts, grade, side, path)
                 VALUES (0, ?1, ?2, ?3, ?4)",
                params![review.ts, review.grade, review.side, review.path],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(merged)
}

fn apply_study_focus(conn: &Connection, focuses: &[SyncStudyFocus]) -> Result<usize, String> {
    let mut merged = 0usize;
    for focus in focuses {
        let existing = conn.query_row(
            "SELECT id, updated_ts FROM study_focus WHERE sync_key = ?1",
            params![focus.sync_key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        );
        match existing {
            Ok((id, updated_ts)) if focus.updated_ts > updated_ts => {
                merged += conn
                    .execute(
                        "UPDATE study_focus
                         SET area=?1, metric_key=?2, label_params=?3, target=?4, cycle_days=?5,
                             start_ts=?6, end_ts=?7, status=?8, created_ts=?9, updated_ts=?10,
                             deleted=?11
                         WHERE id=?12",
                        params![
                            focus.area,
                            focus.metric_key,
                            focus.label_params,
                            focus.target,
                            focus.cycle_days,
                            focus.start_ts,
                            focus.end_ts,
                            focus.status,
                            focus.created_ts,
                            focus.updated_ts,
                            focus.deleted as i64,
                            id
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) => {}
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                merged += conn
                    .execute(
                        "INSERT INTO study_focus
                         (sync_key, area, metric_key, label_params, target, cycle_days,
                          start_ts, end_ts, status, created_ts, updated_ts, deleted)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                        params![
                            focus.sync_key,
                            focus.area,
                            focus.metric_key,
                            focus.label_params,
                            focus.target,
                            focus.cycle_days,
                            focus.start_ts,
                            focus.end_ts,
                            focus.status,
                            focus.created_ts,
                            focus.updated_ts,
                            focus.deleted as i64
                        ],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(merged)
}

/// Server-Seite eines Sync-Roundtrips: Request einmergen, Antwort einsammeln.
#[cfg(any(desktop, test))]
fn handle_sync(conn: &mut Connection, req: &SyncRequest) -> Result<SyncResponse, String> {
    apply_game_tombstones(conn, &req.game_tombstones)?;
    apply_games(conn, &req.games)?;
    apply_tombstones(conn, &req.rep_tombstones)?;
    apply_rep(conn, &req.rep_nodes)?;
    let pz = apply_puzzle_attempts(conn, &req.puzzle_attempts)?;
    if pz > 0 {
        replay_puzzle_ratings(conn)?;
    }
    apply_endgame_attempts(conn, &req.endgame_attempts)?;
    apply_study_templates(conn, &req.study_templates)?;
    apply_study_events(conn, &req.study_events)?;
    apply_rep_reviews(conn, &req.rep_reviews)?;
    apply_study_focus(conn, &req.study_focus)?;
    Ok(SyncResponse {
        now: db::now_ts(),
        games: collect_games(conn, req.since)?,
        game_tombstones: collect_game_tombstones(conn)?,
        rep_nodes: collect_rep(conn)?,
        rep_tombstones: collect_tombstones(conn)?,
        puzzle_attempts: collect_puzzle_attempts(conn, req.since)?,
        own_puzzles: Some(collect_own_puzzles(conn)?),
        endgame_attempts: collect_endgame_attempts(conn, req.since)?,
        study_templates: collect_study_templates(conn, req.since)?,
        study_events: collect_study_events(conn, req.since)?,
        rep_reviews: collect_rep_reviews(conn, req.since)?,
        study_focus: collect_study_focus(conn, req.since)?,
    })
}

// ── Server (Desktop-Hub) ────────────────────────────────────────────────────

#[derive(Default)]
pub struct SyncServer(pub AtomicBool);

/// Zertifikat und Schlüssel des lokalen HTTPS-Hubs. Der Fingerprint wird beim
/// Pairing in den QR-Code geschrieben und vom Handy gepinnt.
#[cfg(desktop)]
struct TlsMaterial {
    certificate_pem: Vec<u8>,
    private_key_pem: Vec<u8>,
    fingerprint: String,
}

#[cfg(desktop)]
fn hex_fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(desktop)]
fn fingerprint_from_pem(certificate_pem: &[u8]) -> Result<String, String> {
    let mut reader = std::io::BufReader::new(certificate_pem);
    let cert = rustls_pemfile::certs(&mut reader)
        .next()
        .transpose()
        .map_err(|e| format!("Zertifikat nicht lesbar: {e}"))?
        .ok_or("Zertifikat enthält keine PEM-Codierung.")?;
    Ok(hex_fingerprint(cert.as_ref()))
}

/// Lädt das dauerhaft gespeicherte Hub-Zertifikat oder erstellt es beim ersten
/// Start. Es bleibt bewusst im App-Konfigurationsordner (nicht im Repository)
/// erhalten, damit bereits gekoppelte Geräte ihren Pin nicht verlieren.
#[cfg(desktop)]
fn tls_material(app: &tauri::AppHandle) -> Result<TlsMaterial, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let certificate_path = dir.join("sync-cert.pem");
    let private_key_path = dir.join("sync-key.pem");

    if let (Ok(certificate_pem), Ok(private_key_pem)) = (
        std::fs::read(&certificate_path),
        std::fs::read(&private_key_path),
    ) {
        let fingerprint = fingerprint_from_pem(&certificate_pem)?;
        return Ok(TlsMaterial {
            certificate_pem,
            private_key_pem,
            fingerprint,
        });
    }

    let mut names = vec!["localhost".to_string(), "kiebitz.local".to_string()];
    if let Some(ip) = local_ip() {
        names.push(ip);
    }
    let rcgen::CertifiedKey { cert, key_pair } = rcgen::generate_simple_self_signed(names)
        .map_err(|e| format!("TLS-Zertifikat nicht erzeugbar: {e}"))?;
    let certificate_pem = cert.pem().into_bytes();
    let private_key_pem = key_pair.serialize_pem().into_bytes();
    let fingerprint = hex_fingerprint(cert.der().as_ref());
    std::fs::write(&certificate_path, &certificate_pem)
        .map_err(|e| format!("TLS-Zertifikat nicht speicherbar: {e}"))?;
    std::fs::write(&private_key_path, &private_key_pem)
        .map_err(|e| format!("TLS-Schlüssel nicht speicherbar: {e}"))?;
    Ok(TlsMaterial {
        certificate_pem,
        private_key_pem,
        fingerprint,
    })
}

/// Prüft den im Pairing gespeicherten SHA-256-Fingerprint. Zertifikats-Pinning
/// ersetzt hier eine öffentliche CA: Nur genau der beim QR-Scan übernommene Hub
/// darf die TLS-Verbindung beenden.
#[derive(Debug)]
struct PinnedCertVerifier {
    fingerprint: [u8; 32],
    algorithms: rustls::crypto::WebPkiSupportedAlgorithms,
}

impl PinnedCertVerifier {
    fn new(fingerprint: &str) -> Result<Self, String> {
        // ureq bringt rustls bereits mit AWS-LC; tiny_http benötigt parallel
        // rustls/ring. Deshalb den Provider hier explizit einmal pro Prozess
        // festlegen, statt die Feature-Auswahl raten zu lassen.
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        if fingerprint.len() != 64 || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Kein gültiger TLS-Fingerprint konfiguriert. Bitte den Desktop erneut per QR-Code koppeln.".into());
        }
        let mut bytes = [0u8; 32];
        for (slot, pair) in bytes.iter_mut().zip(fingerprint.as_bytes().chunks_exact(2)) {
            let hex = std::str::from_utf8(pair).map_err(|e| e.to_string())?;
            *slot = u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
        }
        Ok(Self {
            fingerprint: bytes,
            algorithms: rustls::crypto::aws_lc_rs::default_provider()
                .signature_verification_algorithms,
        })
    }
}

impl rustls::client::danger::ServerCertVerifier for PinnedCertVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if Sha256::digest(end_entity.as_ref()).as_slice() == self.fingerprint {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::InvalidCertificate(
                rustls::CertificateError::ApplicationVerificationFailure,
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn pinned_tls_config(fingerprint: &str) -> Result<Arc<rustls::ClientConfig>, String> {
    // `PinnedCertVerifier::new` installiert den expliziten CryptoProvider,
    // bevor `ClientConfig::builder` ihn abfragt.
    let verifier = PinnedCertVerifier::new(fingerprint)?;
    Ok(Arc::new(
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(verifier))
            .with_no_client_auth(),
    ))
}

/// Lokale LAN-Adresse ermitteln (UDP-Trick, es wird nichts gesendet).
fn local_ip() -> Option<String> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}

fn ensure_code(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<settings::SettingsState>();
    let mut s = state.0.lock().map_err(|e| e.to_string())?;
    if s.sync_code.is_empty() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64 + d.as_secs())
            .unwrap_or(0);
        s.sync_code = format!(
            "{:06}",
            (nanos ^ ((std::process::id() as u64) * 2654435761)) % 1_000_000
        );
        settings::save(app, &s)?;
    }
    Ok(s.sync_code.clone())
}

/// Beantwortet Discovery-Broadcasts vom Handy mit "KIEBITZ_HERE <port>".
/// Der eigentliche Sync auf diesem Port erfolgt ausschließlich per HTTPS.
#[cfg(desktop)]
fn start_discovery_responder() {
    std::thread::spawn(|| {
        let sock = match std::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Discovery-Responder startet nicht (Port {DISCOVERY_PORT}): {e}");
                return;
            }
        };
        let mut buf = [0u8; 64];
        loop {
            if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                if &buf[..n] == DISCOVER_MSG {
                    let _ = sock.send_to(format!("{DISCOVER_REPLY} {SYNC_PORT}").as_bytes(), peer);
                }
            }
        }
    });
}

#[cfg(desktop)]
pub fn start_server(app: &tauri::AppHandle) -> Result<(), String> {
    let flag = &app.state::<SyncServer>().0;
    if flag.swap(true, Ordering::SeqCst) {
        return Ok(()); // läuft schon
    }
    if let Err(e) = ensure_code(app) {
        app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
        return Err(e);
    }
    let tls = match tls_material(app) {
        Ok(tls) => tls,
        Err(e) => {
            app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };
    let server = tiny_http::Server::https(
        ("0.0.0.0", SYNC_PORT),
        tiny_http::SslConfig {
            certificate: tls.certificate_pem,
            private_key: tls.private_key_pem,
        },
    )
    .map_err(|e| {
        app.state::<SyncServer>().0.store(false, Ordering::SeqCst);
        format!("Sync-Server startet nicht (Port {SYNC_PORT}): {e}")
    })?;
    start_discovery_responder();
    let app = app.clone();
    std::thread::spawn(move || {
        log::info!("Sync-Server lauscht per HTTPS auf Port {SYNC_PORT}");
        for mut request in server.incoming_requests() {
            let respond_json = |req: tiny_http::Request, status: u16, body: String| {
                let header =
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .unwrap();
                let _ = req.respond(
                    tiny_http::Response::from_string(body)
                        .with_status_code(status)
                        .with_header(header),
                );
            };
            let url = request.url().to_string();
            if request.method() == &tiny_http::Method::Get && url == "/ping" {
                respond_json(request, 200, "{\"app\":\"kiebitz\"}".into());
                continue;
            }
            if request.method() != &tiny_http::Method::Post || url != "/sync" {
                respond_json(request, 404, "{\"error\":\"not found\"}".into());
                continue;
            }
            let mut body = Vec::new();
            if request
                .as_reader()
                .take(MAX_BODY as u64)
                .read_to_end(&mut body)
                .is_err()
            {
                respond_json(request, 400, "{\"error\":\"read\"}".into());
                continue;
            }
            let parsed: Result<SyncRequest, _> = serde_json::from_slice(&body);
            let req_data = match parsed {
                Ok(r) => r,
                Err(e) => {
                    respond_json(request, 400, format!("{{\"error\":\"json: {e}\"}}"));
                    continue;
                }
            };
            let expected = app
                .state::<settings::SettingsState>()
                .0
                .lock()
                .map(|s| s.sync_code.clone())
                .unwrap_or_default();
            if expected.is_empty() || req_data.code != expected {
                respond_json(request, 403, "{\"error\":\"code\"}".into());
                continue;
            }
            let result = {
                let db = app.state::<db::Db>();
                let mut conn = match db.0.lock() {
                    Ok(c) => c,
                    Err(e) => {
                        respond_json(request, 500, format!("{{\"error\":\"lock: {e}\"}}"));
                        continue;
                    }
                };
                handle_sync(&mut conn, &req_data)
            };
            match result.and_then(|r| serde_json::to_string(&r).map_err(|e| e.to_string())) {
                Ok(json) => respond_json(request, 200, json),
                Err(e) => respond_json(request, 500, format!("{{\"error\":\"{e}\"}}")),
            }
        }
    });
    Ok(())
}

#[cfg(not(desktop))]
pub fn start_server(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("Der Sync-Server läuft nur auf dem Desktop-Hub.".into())
}

// ── Tauri-Commands ──────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SyncInfo {
    pub running: bool,
    pub addr: Option<String>,
    pub code: String,
    pub fingerprint: String,
    pub host: String,
    pub last_sync: i64,
}

/// Dateizugriff (Code, Zertifikat) und eine Datenbanksperre · beides gehört
/// nicht in den Hauptthread, sonst wartet auf Android die Oberfläche mit.
#[tauri::command]
pub async fn sync_info(app: tauri::AppHandle) -> Result<SyncInfo, String> {
    tauri::async_runtime::spawn_blocking(move || collect_sync_info(&app))
        .await
        .map_err(|e| format!("Sync-Status fehlgeschlagen: {e}"))?
}

fn collect_sync_info(app: &tauri::AppHandle) -> Result<SyncInfo, String> {
    let code = ensure_code(app)?;
    #[cfg(desktop)]
    let fingerprint = tls_material(app)?.fingerprint;
    #[cfg(not(desktop))]
    let fingerprint = String::new();
    let (host, running) = {
        let s = app.state::<settings::SettingsState>();
        let host = s.0.lock().map(|s| s.sync_host.clone()).unwrap_or_default();
        (host, app.state::<SyncServer>().0.load(Ordering::SeqCst))
    };
    let last_sync = {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db::meta_get(&conn, "sync_last_ts")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    };
    Ok(SyncInfo {
        running,
        addr: local_ip().map(|ip| format!("{ip}:{SYNC_PORT}")),
        code,
        fingerprint,
        host,
        last_sync,
    })
}

#[tauri::command]
pub fn sync_server_start(app: tauri::AppHandle) -> Result<SyncInfo, String> {
    start_server(&app)?;
    collect_sync_info(&app)
}

/// Pairing per QR-Code: Adresse, Code und Zertifikats-Fingerprint in eine
/// `kiebitz://sync?...`-URI packen, die das Handy scannt. Die eingebettete Adresse
/// ist die LAN-IP des Desktops · sie ist im Heim-WLAN *und* über das
/// Fritzbox-WireGuard erreichbar (die Fritzbox routet das Heimnetz in den
/// Tunnel), anders als die UDP-Broadcast-Discovery, die Subnetzgrenzen nicht
/// überschreitet. Deshalb funktioniert QR-Pairing auch entfernt über VPN.
#[derive(Serialize)]
pub struct PairInfo {
    /// URI mit Adresse, Code und TLS-Fingerprint (im QR kodiert).
    pub uri: String,
    /// Kodierte Adresse "ip:port".
    pub addr: String,
    pub code: String,
    /// SHA-256-Fingerprint des selbstsignierten Hub-Zertifikats.
    pub fingerprint: String,
    /// Fertiges SVG des QR-Codes (schwarz auf weiß, mit Quiet-Zone).
    pub qr_svg: String,
}

/// Baut die Pairing-URI aus Adresse, Code und TLS-Fingerprint.
#[cfg(any(desktop, test))]
pub fn pair_uri(addr: &str, code: &str, fingerprint: &str) -> String {
    format!("kiebitz://sync?host={addr}&code={code}&fingerprint={fingerprint}")
}

/// Erzeugt ein eigenständiges QR-SVG (nur die Kernkodierung von `qrcode`,
/// kein optionales Renderer-Feature): ein Pfad aus 1×1-Modulen auf weißem Grund.
#[cfg(desktop)]
fn qr_svg(data: &str) -> Result<String, String> {
    use qrcode::{Color, QrCode};
    let code = QrCode::new(data.as_bytes()).map_err(|e| e.to_string())?;
    let w = code.width();
    let quiet = 4usize;
    let n = w + quiet * 2;
    let colors = code.to_colors();
    let mut path = String::new();
    for (i, c) in colors.iter().enumerate() {
        if *c == Color::Dark {
            let x = i % w + quiet;
            let y = i / w + quiet;
            path.push_str(&format!("M{x} {y}h1v1h-1z"));
        }
    }
    Ok(format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {n} {n}' \
         shape-rendering='crispEdges'><rect width='{n}' height='{n}' fill='#ffffff'/>\
         <path d='{path}' fill='#0b0b0b'/></svg>"
    ))
}

/// Desktop-Hub: Pairing-Infos inkl. QR-SVG. Mobile ist Client · dort Stub.
#[cfg(desktop)]
#[tauri::command]
pub fn sync_pair(app: tauri::AppHandle) -> Result<PairInfo, String> {
    let code = ensure_code(&app)?;
    let fingerprint = tls_material(&app)?.fingerprint;
    let addr = local_ip()
        .map(|ip| format!("{ip}:{SYNC_PORT}"))
        .ok_or("Keine LAN-Adresse gefunden.")?;
    let uri = pair_uri(&addr, &code, &fingerprint);
    let qr_svg = qr_svg(&uri)?;
    Ok(PairInfo {
        uri,
        addr,
        code,
        fingerprint,
        qr_svg,
    })
}

/// Mobile-Stub: das Handy zeigt keinen QR (es scannt ihn nur).
#[cfg(not(desktop))]
#[tauri::command]
pub fn sync_pair(_app: tauri::AppHandle) -> Result<PairInfo, String> {
    Err("QR-Pairing wird nur auf dem Desktop-Hub angezeigt.".into())
}

/// Handy: sucht den Desktop-Hub per UDP-Broadcast im lokalen Netz.
/// Liefert "ip:port" oder None, wenn nichts antwortet.
#[tauri::command]
pub async fn sync_discover() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let sock = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        sock.set_broadcast(true).map_err(|e| e.to_string())?;
        let _ = sock.set_read_timeout(Some(std::time::Duration::from_millis(600)));
        let mut buf = [0u8; 64];
        for _ in 0..3 {
            let _ = sock.send_to(DISCOVER_MSG, ("255.255.255.255", DISCOVERY_PORT));
            if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                let msg = String::from_utf8_lossy(&buf[..n]).to_string();
                if let Some(port) = msg.strip_prefix(DISCOVER_REPLY) {
                    return Ok(Some(format!("{}:{}", peer.ip(), port.trim())));
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct SyncSummary {
    pub games_pulled: usize,
    pub rep_merged: usize,
    pub own_puzzles_pulled: usize,
    pub puzzle_attempts_pulled: usize,
    pub endgame_attempts_pulled: usize,
    pub study_merged: usize,
}

/// Client-Seite: kompletter Sync-Roundtrip gegen den Desktop-Hub.
#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (host, code, fingerprint) = {
            let s = app.state::<settings::SettingsState>();
            let s = s.0.lock().map_err(|e| e.to_string())?;
            (
                s.sync_host.clone(),
                s.sync_code.clone(),
                s.sync_fingerprint.clone(),
            )
        };
        if host.is_empty() {
            return Err("Keine Sync-Adresse konfiguriert.".into());
        }
        let tls_config = pinned_tls_config(&fingerprint)?;

        // Lokalen Stand einsammeln (kurz locken, dann Netz ohne Lock).
        let (since, request) = {
            let db = app.state::<db::Db>();
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let since: i64 = db::meta_get(&conn, "sync_last_ts")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            let req = SyncRequest {
                code,
                since,
                games: collect_games(&conn, since)?,
                game_tombstones: collect_game_tombstones(&conn)?,
                rep_nodes: collect_rep(&conn)?,
                rep_tombstones: collect_tombstones(&conn)?,
                puzzle_attempts: collect_puzzle_attempts(&conn, since)?,
                endgame_attempts: collect_endgame_attempts(&conn, since)?,
                study_templates: collect_study_templates(&conn, since)?,
                study_events: collect_study_events(&conn, since)?,
                rep_reviews: collect_rep_reviews(&conn, since)?,
                study_focus: collect_study_focus(&conn, since)?,
            };
            (since, req)
        };
        let _ = since;

        let body = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        let agent = ureq::AgentBuilder::new()
            .https_only(true)
            .tls_config(tls_config)
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(600))
            .build();
        let resp = agent
            .post(&format!("https://{host}/sync"))
            .set("Content-Type", "application/json")
            .send_string(&body)
            .map_err(|e| format!("Sync fehlgeschlagen: {e}"))?;
        let resp: SyncResponse = serde_json::from_reader(resp.into_reader().take(MAX_BODY as u64))
            .map_err(|e| format!("Antwort unlesbar: {e}"))?;

        let db = app.state::<db::Db>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        apply_game_tombstones(&mut conn, &resp.game_tombstones)?;
        let games_pulled = apply_games(&mut conn, &resp.games)?;
        apply_tombstones(&mut conn, &resp.rep_tombstones)?;
        let rep_merged = apply_rep(&mut conn, &resp.rep_nodes)?;
        let own_puzzles_pulled = match &resp.own_puzzles {
            Some(puzzles) => apply_own_puzzles(&mut conn, puzzles)?,
            None => 0,
        };
        let pz = apply_puzzle_attempts(&conn, &resp.puzzle_attempts)?;
        if pz > 0 {
            replay_puzzle_ratings(&mut conn)?;
        }
        let eg = apply_endgame_attempts(&conn, &resp.endgame_attempts)?;
        let study_templates = apply_study_templates(&conn, &resp.study_templates)?;
        let study_events = apply_study_events(&conn, &resp.study_events)?;
        let rep_reviews = apply_rep_reviews(&conn, &resp.rep_reviews)?;
        let study_focus = apply_study_focus(&conn, &resp.study_focus)?;
        db::meta_set(&conn, "sync_last_ts", &resp.now.to_string())?;
        Ok(SyncSummary {
            games_pulled,
            rep_merged,
            own_puzzles_pulled,
            puzzle_attempts_pulled: pz,
            endgame_attempts_pulled: eg,
            study_merged: study_templates + study_events + rep_reviews + study_focus,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        conn
    }

    fn sample_game(id: &str) -> SyncGame {
        SyncGame {
            source: "lichess".into(),
            source_id: id.into(),
            url: String::new(),
            played_at: "2026-07-01".into(),
            played_ts: 100,
            time_class: "rapid".into(),
            color: "white".into(),
            my_name: "Torim98".into(),
            opponent: "opp".into(),
            opp_elo: 1500,
            my_elo: 1490,
            result: "win".into(),
            opening: "Italian".into(),
            eco: "C50".into(),
            moves_count: 30,
            accuracy: None,
            accuracy_opening: None,
            accuracy_middlegame: None,
            accuracy_endgame: None,
            opponent_accuracy: None,
            opponent_accuracy_opening: None,
            opponent_accuracy_middlegame: None,
            opponent_accuracy_endgame: None,
            moves: "e4 e5".into(),
            note: String::new(),
            note_ts: 0,
            tags: Vec::new(),
            tags_ts: 0,
            analyzed: false,
            analyzed_ts: 0,
            clocks: String::new(),
            time_control: String::new(),
            analysis_excluded: false,
            updated_ts: 100,
            evals: Vec::new(),
        }
    }

    #[test]
    fn games_merge_is_idempotent_and_lww_metadata_wins() {
        let mut conn = mem_db();
        let mut g = sample_game("g1");
        g.note = "vom Handy".into();
        g.note_ts = 50;
        g.tags = vec!["OTB".into()];
        g.tags_ts = 50;
        g.accuracy_opening = Some(91.0);
        g.opponent_accuracy = Some(76.4);
        g.opponent_accuracy_opening = Some(79.2);
        apply_games(&mut conn, &[g.clone()]).unwrap();
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let (tags, opening, opponent, opponent_opening):
            (String, Option<f64>, Option<f64>, Option<f64>) = conn
            .query_row("SELECT tags, accuracy_opening, opponent_accuracy, opponent_accuracy_opening FROM games", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!(tags, r#"["OTB"]"#);
        assert_eq!(opening, Some(91.0));
        assert_eq!(opponent, Some(76.4));
        assert_eq!(opponent_opening, Some(79.2));

        // Ältere Notiz verliert, neuere gewinnt.
        let mut older = g.clone();
        older.note = "alt".into();
        older.note_ts = 10;
        older.tags = vec!["old".into()];
        older.tags_ts = 10;
        apply_games(&mut conn, &[older]).unwrap();
        let note: String = conn
            .query_row("SELECT note FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note, "vom Handy");

        let mut newer = g;
        newer.note = "neu".into();
        newer.note_ts = 99;
        newer.tags = vec!["Club".into(), "Important".into()];
        newer.tags_ts = 99;
        apply_games(&mut conn, &[newer]).unwrap();
        let note: String = conn
            .query_row("SELECT note FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(note, "neu");
        let tags: String = conn
            .query_row("SELECT tags FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, r#"["Club","Important"]"#);
    }

    #[test]
    fn game_tombstone_deletes_remote_copy_and_blocks_stale_recreation() {
        let mut conn = mem_db();
        let old = sample_game("deleted-game");
        apply_games(&mut conn, std::slice::from_ref(&old)).unwrap();

        let tombstone = SyncGameTombstone {
            source: old.source.clone(),
            source_id: old.source_id.clone(),
            deleted_ts: 200,
        };
        assert_eq!(apply_game_tombstones(&mut conn, &[tombstone]).unwrap(), 1);
        assert_eq!(
            apply_games(&mut conn, std::slice::from_ref(&old)).unwrap(),
            0
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        let mut reimported = old;
        reimported.updated_ts = 300;
        assert_eq!(apply_games(&mut conn, &[reimported]).unwrap(), 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "a genuinely newer reimport may recreate the game");
    }

    #[test]
    fn manual_games_converge_even_when_they_predate_the_sync_cursor() {
        let mut desktop = mem_db();
        let mut mobile = mem_db();

        let mut desktop_game = sample_game("desktop-manual-legacy");
        desktop_game.source = "manual".into();
        desktop_game.updated_ts = 1;
        apply_games(&mut desktop, &[desktop_game]).unwrap();
        // Reproduziert eine Partie aus einer alten Datenbankmigration: Ein
        // Delta-Sync hinter einem gesetzten Cursor würde sie nie einsammeln.
        desktop
            .execute(
                "UPDATE games SET updated_ts = 0 WHERE source_id = 'desktop-manual-legacy'",
                [],
            )
            .unwrap();

        let mut mobile_game = sample_game("mobile-manual-offline");
        mobile_game.source = "manual".into();
        mobile_game.updated_ts = 1_000;
        apply_games(&mut mobile, &[mobile_game]).unwrap();
        let mut old_online_game = sample_game("mobile-online-old");
        old_online_game.updated_ts = 1_000;
        apply_games(&mut mobile, &[old_online_game]).unwrap();

        let since = 50_000;
        let outgoing = collect_games(&mobile, since).unwrap();
        // Nur der nicht wiederbeschaffbare manuelle Datensatz umgeht den
        // Cursor; alte Onlinepartien blähen das Delta nicht auf.
        assert_eq!(outgoing.len(), 1);
        assert_eq!(outgoing[0].source_id, "mobile-manual-offline");

        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: outgoing,
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        let response = handle_sync(&mut desktop, &request).unwrap();
        apply_game_tombstones(&mut mobile, &response.game_tombstones).unwrap();
        apply_games(&mut mobile, &response.games).unwrap();

        for conn in [&desktop, &mobile] {
            let ids: Vec<String> = conn
                .prepare("SELECT source_id FROM games WHERE source = 'manual' ORDER BY source_id")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(ids, vec!["desktop-manual-legacy", "mobile-manual-offline"]);
        }

        // Der Vollabgleich darf beim nächsten Roundtrip keine Duplikate
        // erzeugen; der Natural Key bleibt die einzige Zeile pro Partie.
        let second_request = SyncRequest {
            code: "000000".into(),
            since,
            games: collect_games(&mobile, since).unwrap(),
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        let second_response = handle_sync(&mut desktop, &second_request).unwrap();
        apply_games(&mut mobile, &second_response.games).unwrap();
        for conn in [&desktop, &mobile] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM games WHERE source = 'manual'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 2);
        }
    }

    #[test]
    fn manual_full_sync_does_not_resurrect_a_tombstoned_game() {
        let mut desktop = mem_db();
        let mut mobile = mem_db();
        let mut stale = sample_game("deleted-manual");
        stale.source = "manual".into();
        stale.updated_ts = 100;
        apply_games(&mut desktop, &[stale.clone()]).unwrap();
        apply_games(&mut mobile, &[stale]).unwrap();

        let deletion = SyncGameTombstone {
            source: "manual".into(),
            source_id: "deleted-manual".into(),
            deleted_ts: 200,
        };
        apply_game_tombstones(&mut desktop, &[deletion]).unwrap();

        let since = 50_000;
        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: collect_games(&mobile, since).unwrap(),
            game_tombstones: collect_game_tombstones(&mobile).unwrap(),
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        assert_eq!(request.games.len(), 1, "manual games bypass the cursor");
        let response = handle_sync(&mut desktop, &request).unwrap();
        assert!(response.games.is_empty());
        apply_game_tombstones(&mut mobile, &response.game_tombstones).unwrap();
        apply_games(&mut mobile, &response.games).unwrap();

        for conn in [&desktop, &mobile] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM games WHERE source_id = 'deleted-manual'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0);
        }
    }

    #[test]
    fn evals_adopted_only_when_not_locally_analyzed() {
        let mut conn = mem_db();
        let mut g = sample_game("g2");
        g.analyzed = true;
        g.evals = vec![SyncEval {
            ply: 1,
            san: "e4".into(),
            eval_cp: Some(30),
            mate_in: None,
            best_uci: "e2e4".into(),
            judgment: String::new(),
            phase: "opening".into(),
        }];
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let evals: i64 = conn
            .query_row("SELECT COUNT(*) FROM move_evals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(evals, 1);
        let analyzed: i64 = conn
            .query_row("SELECT analyzed FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(analyzed, 1);

        // Zweiter Sync mit anderen Evals überschreibt die lokale Analyse nicht.
        g.evals[0].eval_cp = Some(999);
        apply_games(&mut conn, &[g]).unwrap();
        let cp: i64 = conn
            .query_row("SELECT eval_cp FROM move_evals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cp, 30);
    }

    #[test]
    fn own_puzzle_snapshot_remaps_game_ids_and_propagates_removals() {
        let mut desktop = mem_db();
        apply_games(&mut desktop, &[sample_game("puzzle-game")]).unwrap();
        let desktop_game_id: i64 = desktop
            .query_row(
                "SELECT id FROM games WHERE source_id = 'puzzle-game'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        desktop
            .execute(
                "INSERT INTO puzzles
                 (id, fen, moves, rating, themes, opening_tags, source,
                  source_game_id, source_ply, setup_plies)
                 VALUES ('own:desktop:17', 'test-fen', 'e2e4', 1540,
                         'ownGame opening mistake oneMove', '', 'own', ?1, 17, 0)",
                params![desktop_game_id],
            )
            .unwrap();

        let snapshot = collect_own_puzzles(&desktop).unwrap();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].game_source_id, "puzzle-game");

        let mut mobile = mem_db();
        apply_games(&mut mobile, &[sample_game("filler")]).unwrap();
        apply_games(&mut mobile, &[sample_game("puzzle-game")]).unwrap();
        let mobile_game_id: i64 = mobile
            .query_row(
                "SELECT id FROM games WHERE source_id = 'puzzle-game'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(desktop_game_id, mobile_game_id);

        assert_eq!(apply_own_puzzles(&mut mobile, &snapshot).unwrap(), 1);
        let received: (i64, String, i64) = mobile
            .query_row(
                "SELECT source_game_id, moves, setup_plies
                 FROM puzzles WHERE id = 'own:desktop:17'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(received, (mobile_game_id, "e2e4".into(), 0));

        assert_eq!(apply_own_puzzles(&mut mobile, &[]).unwrap(), 1);
        let remaining: i64 = mobile
            .query_row(
                "SELECT COUNT(*) FROM puzzles WHERE source = 'own'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn analysis_time_travels_and_is_not_overwritten() {
        let mut conn = mem_db();
        let mut g = sample_game("g3");
        g.analyzed = true;
        g.analyzed_ts = 1_784_000_000;
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let stored = |c: &Connection| -> i64 {
            c.query_row("SELECT analyzed_ts FROM games", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(stored(&conn), 1_784_000_000);

        // Ein späterer Sync verschiebt den Review-Tag nicht mehr.
        g.analyzed_ts = 1_790_000_000;
        g.updated_ts += 10;
        apply_games(&mut conn, &[g]).unwrap();
        assert_eq!(stored(&conn), 1_784_000_000);
    }

    #[test]
    fn rep_merge_adds_paths_and_lww_fsrs() {
        let mut conn = mem_db();
        let node = |path: &str, depth: i64, last_ts: i64, reps: i64| SyncRepNode {
            side: "white".into(),
            path: path.into(),
            name: String::new(),
            fen_key: format!("fen-{path}"),
            depth,
            stability: 1.0,
            difficulty: 5.0,
            reps,
            lapses: 0,
            due_ts: 0,
            last_ts,
            created_ts: 0,
        };
        apply_rep(&mut conn, &[node("e4", 1, 10, 1), node("e4 e5", 2, 10, 1)]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // Frischere Review gewinnt, ältere nicht.
        apply_rep(&mut conn, &[node("e4", 1, 20, 5)]).unwrap();
        let reps: i64 = conn
            .query_row("SELECT reps FROM rep_nodes WHERE san = 'e4'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(reps, 5);
        apply_rep(&mut conn, &[node("e4", 1, 15, 3)]).unwrap();
        let reps: i64 = conn
            .query_row("SELECT reps FROM rep_nodes WHERE san = 'e4'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(reps, 5);
    }

    #[test]
    fn attempts_dedupe_on_natural_key() {
        let conn = mem_db();
        let a = SyncPuzzleAttempt {
            puzzle_id: "p1".into(),
            ts: 1000,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1480,
        };
        assert_eq!(
            apply_puzzle_attempts(&conn, std::slice::from_ref(&a)).unwrap(),
            1
        );
        assert_eq!(apply_puzzle_attempts(&conn, &[a]).unwrap(), 0);

        let e = SyncEndgameAttempt {
            drill_id: "lucena".into(),
            ts: 2000,
            solved: true,
            moves: 14,
        };
        assert_eq!(
            apply_endgame_attempts(&conn, std::slice::from_ref(&e)).unwrap(),
            1
        );
        assert_eq!(apply_endgame_attempts(&conn, &[e]).unwrap(), 0);
    }

    #[test]
    fn puzzle_history_is_collected_even_when_it_predates_the_sync_cursor() {
        let conn = mem_db();
        let old_attempt = SyncPuzzleAttempt {
            puzzle_id: "offline-puzzle".into(),
            ts: 1_000,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1600,
        };
        apply_puzzle_attempts(&conn, &[old_attempt]).unwrap();

        // Ein Zeitstempel-basierter Delta-Filter würde diesen bislang nie
        // synchronisierten Offline-Versuch dauerhaft verlieren.
        let collected = collect_puzzle_attempts(&conn, 50_000).unwrap();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].puzzle_id, "offline-puzzle");
    }

    #[test]
    fn puzzle_history_converges_after_a_cursor_gap() {
        let mut desktop = mem_db();
        let mobile = mem_db();
        let attempt = |id: &str, ts: i64| SyncPuzzleAttempt {
            puzzle_id: id.into(),
            ts,
            solved: true,
            rating_before: 1500,
            rating_after: 1512,
            themes: "fork".into(),
            puzzle_rating: 1600,
        };
        apply_puzzle_attempts(&desktop, &[attempt("desktop-old", 1_000)]).unwrap();
        apply_puzzle_attempts(&mobile, &[attempt("mobile-old", 2_000)]).unwrap();

        let since = 50_000;
        let request = SyncRequest {
            code: "000000".into(),
            since,
            games: vec![],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: collect_puzzle_attempts(&mobile, since).unwrap(),
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        let response = handle_sync(&mut desktop, &request).unwrap();
        apply_puzzle_attempts(&mobile, &response.puzzle_attempts).unwrap();

        for conn in [&desktop, &mobile] {
            let ids: Vec<String> = conn
                .prepare("SELECT puzzle_id FROM puzzle_attempts ORDER BY puzzle_id")
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap();
            assert_eq!(ids, vec!["desktop-old", "mobile-old"]);
        }
    }

    #[test]
    fn study_plan_syncs_templates_events_completion_and_deletion() {
        let conn = mem_db();
        let template = SyncStudyTemplate {
            sync_key: "custom-calculation".into(),
            title: "Calculation".into(),
            duration_min: 30,
            tool: "Board".into(),
            description: "Candidate moves".into(),
            created_ts: 100,
            updated_ts: 100,
            deleted: false,
        };
        let mut event = SyncStudyEvent {
            sync_key: "event-calculation-monday".into(),
            template_sync_key: template.sync_key.clone(),
            day: "2026-07-27".into(),
            position: 0,
            completed: false,
            completed_ts: 0,
            created_ts: 110,
            updated_ts: 110,
            deleted: false,
            repeat_rule: "weekly".into(),
            series_key: "series-calculation".into(),
        };

        assert_eq!(
            apply_study_templates(&conn, std::slice::from_ref(&template)).unwrap(),
            1
        );
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 0);

        event.completed = true;
        event.completed_ts = 200;
        event.updated_ts = 200;
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        let completed: i64 = conn
            .query_row(
                "SELECT completed FROM study_events WHERE sync_key = ?1",
                params![event.sync_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1);

        event.deleted = true;
        event.updated_ts = 300;
        assert_eq!(apply_study_events(&conn, &[event.clone()]).unwrap(), 1);
        assert!(collect_study_events(&conn, 250)
            .unwrap()
            .iter()
            .any(|entry| entry.sync_key == event.sync_key && entry.deleted));
    }

    #[test]
    fn rep_reviews_union_without_duplicating() {
        let conn = mem_db();
        let review = |ts: i64, grade: i64| SyncRepReview {
            side: "white".into(),
            path: "e4 e5 Nf3".into(),
            ts,
            grade,
        };

        assert_eq!(apply_rep_reviews(&conn, &[review(100, 3)]).unwrap(), 1);
        // Append-only heißt: derselbe Eintrag zweimal bleibt ein Eintrag. Ohne
        // das würde jede Synchronisation die Trainingslast aufblähen.
        assert_eq!(apply_rep_reviews(&conn, &[review(100, 3)]).unwrap(), 0);
        assert_eq!(apply_rep_reviews(&conn, &[review(200, 1)]).unwrap(), 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_review_log", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // Eingesammelt wird ab dem Cursor (mit Karenz), nicht alles.
        let collected = collect_rep_reviews(&conn, 150 + SLACK).unwrap();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].ts, 200);
        assert_eq!(collected[0].path, "e4 e5 Nf3");
    }

    #[test]
    fn study_focus_merges_by_last_write() {
        let conn = mem_db();
        let mut focus = SyncStudyFocus {
            sync_key: "focus-tactics".into(),
            area: "tactics".into(),
            metric_key: "blunders_middlegame_per100".into(),
            label_params: "{}".into(),
            target: Some(2.0),
            cycle_days: 14,
            start_ts: 1_000,
            end_ts: 0,
            status: "active".into(),
            created_ts: 1_000,
            updated_ts: 1_000,
            deleted: false,
        };

        assert_eq!(apply_study_focus(&conn, &[focus.clone()]).unwrap(), 1);
        // Ein älterer Stand darf den neueren nicht überschreiben.
        let mut stale = focus.clone();
        stale.status = "dropped".into();
        stale.updated_ts = 500;
        assert_eq!(apply_study_focus(&conn, &[stale]).unwrap(), 0);

        focus.status = "done".into();
        focus.end_ts = 2_000;
        focus.updated_ts = 2_000;
        assert_eq!(apply_study_focus(&conn, &[focus.clone()]).unwrap(), 1);

        let collected = collect_study_focus(&conn, 0).unwrap();
        assert_eq!(collected.len(), 1);
        assert_eq!(collected[0].status, "done");
        assert_eq!(collected[0].end_ts, 2_000);
        // Der Zyklus trägt nur die Absicht · Messwerte gibt es hier bewusst nicht.
        assert_eq!(collected[0].metric_key, "blunders_middlegame_per100");
    }

    #[test]
    fn tombstones_delete_subtree_but_newer_nodes_survive() {
        let mut conn = mem_db();
        let node = |path: &str, depth: i64, last_ts: i64, created_ts: i64| SyncRepNode {
            side: "white".into(),
            path: path.into(),
            name: String::new(),
            fen_key: format!("fen-{path}"),
            depth,
            stability: 1.0,
            difficulty: 5.0,
            reps: 1,
            lapses: 0,
            due_ts: 0,
            last_ts,
            created_ts,
        };
        // Baum: e4 → e5 → Nf3; alles alt (ts 10).
        apply_rep(
            &mut conn,
            &[
                node("e4", 1, 10, 10),
                node("e4 e5", 2, 10, 10),
                node("e4 e5 Nf3", 3, 10, 10),
            ],
        )
        .unwrap();

        // Tombstone auf "e4 e5" (ts 50) löscht den Teilbaum, nicht die Wurzel.
        let tomb = SyncTombstone {
            side: "white".into(),
            path: "e4 e5".into(),
            deleted_ts: 50,
        };
        let deleted = apply_tombstones(&mut conn, std::slice::from_ref(&tomb)).unwrap();
        assert_eq!(deleted, 2);
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);

        // Alte Kopie der Gegenseite kommt nicht zurück (buried) …
        apply_rep(&mut conn, &[node("e4 e5", 2, 10, 10)]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 1);

        // … aber ein NEU angelegter Knoten (created_ts 100 > 50) überlebt.
        apply_rep(&mut conn, &[node("e4 e5", 2, 0, 100)]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 2);
        // Ein erneuter Tombstone-Sweep mit demselben Stein löscht ihn nicht.
        apply_tombstones(&mut conn, &[tomb]).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM rep_nodes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 2);
    }

    #[test]
    fn rating_replay_is_deterministic_across_merge_orders() {
        // Zwei "Geräte" mit unterschiedlichen Versuchen; nach Merge + Replay
        // müssen beide dieselbe Elo-Kette und dasselbe Endrating haben.
        let attempt = |id: &str, ts: i64, solved: bool, pr: i64| SyncPuzzleAttempt {
            puzzle_id: id.into(),
            ts,
            solved,
            rating_before: 0,
            rating_after: 0,
            themes: String::new(),
            puzzle_rating: pr,
        };
        let a_set = [
            attempt("a", 100, true, 1600),
            attempt("b", 300, false, 1400),
        ];
        let b_set = [attempt("c", 200, true, 1550)];

        let final_rating = |first: &[SyncPuzzleAttempt], second: &[SyncPuzzleAttempt]| {
            let mut conn = mem_db();
            apply_puzzle_attempts(&conn, first).unwrap();
            apply_puzzle_attempts(&conn, second).unwrap();
            replay_puzzle_ratings(&mut conn).unwrap();
            db::meta_get(&conn, "puzzle_rating").unwrap()
        };
        let r1 = final_rating(&a_set, &b_set);
        let r2 = final_rating(&b_set, &a_set);
        assert_eq!(r1, r2, "Merge-Reihenfolge darf das Rating nicht ändern");
        assert_ne!(r1, "1500", "Replay muss die Versuche einrechnen");
    }

    #[test]
    fn pair_uri_roundtrips_through_parser() {
        let fingerprint = "0".repeat(64);
        let uri = pair_uri("192.168.178.30:47323", "123456", &fingerprint);
        assert_eq!(
            uri,
            "kiebitz://sync?host=192.168.178.30:47323&code=123456&fingerprint=0000000000000000000000000000000000000000000000000000000000000000"
        );
        // dieselbe Zerlegung wie im Frontend (parsePairUri).
        let q = &uri[uri.find('?').unwrap() + 1..];
        let mut host = "";
        let mut code = "";
        let mut parsed_fingerprint = "";
        for kv in q.split('&') {
            match kv.split_once('=') {
                Some(("host", v)) => host = v,
                Some(("code", v)) => code = v,
                Some(("fingerprint", v)) => parsed_fingerprint = v,
                _ => {}
            }
        }
        assert_eq!(host, "192.168.178.30:47323");
        assert_eq!(code, "123456");
        assert_eq!(parsed_fingerprint, fingerprint);
    }

    #[cfg(desktop)]
    #[test]
    fn qr_svg_encodes_pairing_uri() {
        let svg = qr_svg(&pair_uri("192.168.178.30:47323", "123456", &"a".repeat(64))).unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("<path d='M")); // mindestens ein dunkles Modul
        assert!(svg.contains("viewBox='0 0 "));
    }

    #[test]
    fn https_roundtrip_over_localhost_with_pinned_certificate() {
        // Echter TLS-tiny_http-Server + gepinnter ureq-Client · dieselben
        // Transportbausteine wie in start_server/sync_now, ohne Tauri-AppHandle.
        let rcgen::CertifiedKey { cert, key_pair } =
            rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let fingerprint = hex_fingerprint(cert.der().as_ref());
        let server = tiny_http::Server::https(
            "127.0.0.1:0",
            tiny_http::SslConfig {
                certificate: cert.pem().into_bytes(),
                private_key: key_pair.serialize_pem().into_bytes(),
            },
        )
        .unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut request = server.recv().unwrap();
            let mut body = Vec::new();
            request.as_reader().read_to_end(&mut body).unwrap();
            let req: SyncRequest = serde_json::from_slice(&body).unwrap();
            assert_eq!(req.code, "424242");
            let mut conn = mem_db();
            let resp = handle_sync(&mut conn, &req).unwrap();
            let json = serde_json::to_string(&resp).unwrap();
            request
                .respond(tiny_http::Response::from_string(json))
                .unwrap();
        });

        let req = SyncRequest {
            code: "424242".into(),
            since: 0,
            games: vec![sample_game("http1")],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        let tls_config = pinned_tls_config(&fingerprint).unwrap();
        let agent = ureq::AgentBuilder::new()
            .https_only(true)
            .tls_config(tls_config)
            .build();
        let resp = agent
            .post(&format!("https://localhost:{port}/sync"))
            .send_string(&serde_json::to_string(&req).unwrap())
            .unwrap();
        let resp: SyncResponse = serde_json::from_reader(resp.into_reader()).unwrap();
        assert!(resp.now > 0);
        // Der Server hat unsere Partie gemergt und liefert sie im Delta zurück.
        assert_eq!(resp.games.len(), 1);
        assert_eq!(resp.games[0].source_id, "http1");
        handle.join().unwrap();
    }

    #[test]
    fn roundtrip_via_handle_sync() {
        // "Desktop" hat eine analysierte Partie, "Handy" schickt einen Versuch.
        let mut desktop = mem_db();
        let mut g = sample_game("rt1");
        g.analyzed = true;
        g.evals = vec![SyncEval {
            ply: 1,
            san: "e4".into(),
            eval_cp: Some(20),
            mate_in: None,
            best_uci: "e2e4".into(),
            judgment: String::new(),
            phase: "opening".into(),
        }];
        apply_games(&mut desktop, &[g]).unwrap();

        let req = SyncRequest {
            code: "000000".into(),
            since: 0,
            games: vec![],
            game_tombstones: vec![],
            rep_nodes: vec![],
            rep_tombstones: vec![],
            puzzle_attempts: vec![SyncPuzzleAttempt {
                puzzle_id: "p9".into(),
                ts: 500,
                solved: false,
                rating_before: 1400,
                rating_after: 1390,
                themes: String::new(),
                puzzle_rating: 1450,
            }],
            endgame_attempts: vec![],
            study_templates: vec![],
            study_events: vec![],
            rep_reviews: vec![],
            study_focus: vec![],
        };
        let resp = handle_sync(&mut desktop, &req).unwrap();
        assert_eq!(resp.games.len(), 1);
        assert_eq!(resp.games[0].evals.len(), 1);
        assert_eq!(resp.puzzle_attempts.len(), 1); // enthält den gerade gepushten

        // Der Versuch ist beim Desktop angekommen.
        let n: i64 = desktop
            .query_row("SELECT COUNT(*) FROM puzzle_attempts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
