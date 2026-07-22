//! Geräte-Sync v1 — direkter Abgleich im lokalen Netz, Desktop als Hub.
//!
//! Das Handy stößt den Sync an (ein POST-Roundtrip): es schickt seine lokalen
//! Änderungen und bekommt die Desktop-Änderungen seit dem letzten Sync zurück.
//! Kein Server, keine Cloud — der Desktop lauscht nur solange die App läuft
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
//! - Nicht gesynct: Puzzle-DB, positions-Index (wird lokal neu aufgebaut),
//!   Caches. Puzzle-Ratings bleiben Geräte-lokal (v1).
//!
//! Cursor: der Client merkt sich die Serverzeit des letzten Syncs (meta
//! `sync_last_ts`) und beide Seiten filtern mit einem Sicherheitsfenster
//! (SLACK) — Doppel-Übertragungen sind durch die idempotenten Merges gratis.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
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
    pub moves: String,
    pub note: String,
    pub note_ts: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tags_ts: i64,
    pub analyzed: bool,
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
    /// Anlage-Zeitpunkt — entscheidet gegen Tombstones (Wieder-Anlegen gewinnt).
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
    /// Puzzle-Rating zur Versuchszeit — Basis für den deterministischen
    /// Elo-Replay nach einem Merge (0 = unbekannt, Versuch neutral).
    #[serde(default)]
    pub puzzle_rating: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncEndgameAttempt {
    pub drill_id: String,
    pub ts: i64,
    pub solved: bool,
    pub moves: i64,
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
    pub endgame_attempts: Vec<SyncEndgameAttempt>,
}

// ── Collect: lokale Daten für die Gegenseite einsammeln ─────────────────────

fn collect_games(conn: &Connection, since: i64) -> Result<Vec<SyncGame>, String> {
    let cutoff = since.saturating_sub(SLACK);
    let mut stmt = conn
        .prepare(
            "SELECT id, source, source_id, url, played_at, played_ts, time_class, color,
                    opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame,
                    moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts
             FROM games WHERE updated_ts >= ?1",
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
                    opponent: r.get(8)?,
                    opp_elo: r.get(9)?,
                    my_elo: r.get(10)?,
                    result: r.get(11)?,
                    opening: r.get(12)?,
                    eco: r.get(13)?,
                    moves_count: r.get(14)?,
                    accuracy: r.get(15)?,
                    accuracy_opening: r.get(16)?,
                    accuracy_middlegame: r.get(17)?,
                    accuracy_endgame: r.get(18)?,
                    moves: r.get(19)?,
                    note: r.get(20)?,
                    note_ts: r.get(21)?,
                    tags: serde_json::from_str(&r.get::<_, String>(22)?).unwrap_or_default(),
                    tags_ts: r.get(23)?,
                    analyzed: r.get::<_, i64>(24)? != 0,
                    analysis_excluded: r.get::<_, i64>(25)? != 0,
                    updated_ts: r.get(26)?,
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
                None => continue, // verwaister Knoten — überspringen
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
/// Löschung — jüngere (wieder angelegte oder frisch trainierte) überleben.
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
    // Über (side, parent, san) je Ebene löschen — wir haben nur Pfade, keine IDs.
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
    since: i64,
) -> Result<Vec<SyncPuzzleAttempt>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT puzzle_id, ts, solved, rating_before, rating_after, themes, puzzle_rating
             FROM puzzle_attempts WHERE ts >= ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since.saturating_sub(SLACK)], |r| {
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
                        color, opponent, opp_elo, my_elo, result, opening, eco, moves_count,
                        accuracy, accuracy_opening, accuracy_middlegame, accuracy_endgame,
                        moves, note, note_ts, tags, tags_ts, analyzed, analysis_excluded, updated_ts)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26)",
                    params![
                        g.source, g.source_id, g.url, g.played_at, g.played_ts, g.time_class,
                        g.color, g.opponent, g.opp_elo, g.my_elo, g.result, g.opening, g.eco,
                        g.moves_count, g.accuracy, g.accuracy_opening, g.accuracy_middlegame,
                        g.accuracy_endgame, g.moves, g.note, g.note_ts,
                        serde_json::to_string(&g.tags).map_err(|e| e.to_string())?, g.tags_ts,
                        g.analyzed as i64, g.analysis_excluded as i64, incoming_updated
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
                        analyzed = MAX(analyzed, ?6),
                        analysis_excluded = CASE WHEN ?7 >= updated_ts THEN ?8 ELSE analysis_excluded END,
                        time_class = CASE WHEN ?7 >= updated_ts THEN ?9 ELSE time_class END,
                        updated_ts = MAX(updated_ts, ?7)
                     WHERE id = ?1",
                    params![
                        id,
                        g.accuracy,
                        g.accuracy_opening,
                        g.accuracy_middlegame,
                        g.accuracy_endgame,
                        g.analyzed as i64,
                        incoming_updated,
                        g.analysis_excluded as i64,
                        g.time_class
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
                let parent_key = match n.path.rsplit_once(' ') {
                    Some((prefix, _)) => Some(format!("{}\n{}", n.side, prefix)),
                    None => None,
                };
                let parent_id = match &parent_key {
                    None => 0,
                    Some(k) => match local_ids.get(k) {
                        Some((id, _)) => *id,
                        None => continue, // Elternknoten fehlt (übersprungen) — Kind auslassen
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

/// Spielt die Elo-Kette über alle Versuche deterministisch neu ab — nach einem
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

/// Server-Seite eines Sync-Roundtrips: Request einmergen, Antwort einsammeln.
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
    Ok(SyncResponse {
        now: db::now_ts(),
        games: collect_games(conn, req.since)?,
        game_tombstones: collect_game_tombstones(conn)?,
        rep_nodes: collect_rep(conn)?,
        rep_tombstones: collect_tombstones(conn)?,
        puzzle_attempts: collect_puzzle_attempts(conn, req.since)?,
        endgame_attempts: collect_endgame_attempts(conn, req.since)?,
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
            (nanos ^ (std::process::id() as u64) * 2654435761) % 1_000_000
        );
        settings::save(app, &s)?;
    }
    Ok(s.sync_code.clone())
}

/// Beantwortet Discovery-Broadcasts vom Handy mit "KIEBITZ_HERE <port>".
/// Der eigentliche Sync auf diesem Port erfolgt ausschließlich per HTTPS.
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

#[tauri::command]
pub fn sync_info(app: tauri::AppHandle) -> Result<SyncInfo, String> {
    let code = ensure_code(&app)?;
    #[cfg(desktop)]
    let fingerprint = tls_material(&app)?.fingerprint;
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
    sync_info(app)
}

/// Pairing per QR-Code: Adresse, Code und Zertifikats-Fingerprint in eine
/// `kiebitz://sync?...`-URI packen, die das Handy scannt. Die eingebettete Adresse
/// ist die LAN-IP des Desktops — sie ist im Heim-WLAN *und* über das
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

/// Desktop-Hub: Pairing-Infos inkl. QR-SVG. Mobile ist Client — dort Stub.
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
    pub puzzle_attempts_pulled: usize,
    pub endgame_attempts_pulled: usize,
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
        let pz = apply_puzzle_attempts(&conn, &resp.puzzle_attempts)?;
        if pz > 0 {
            replay_puzzle_ratings(&mut conn)?;
        }
        let eg = apply_endgame_attempts(&conn, &resp.endgame_attempts)?;
        db::meta_set(&conn, "sync_last_ts", &resp.now.to_string())?;
        Ok(SyncSummary {
            games_pulled,
            rep_merged,
            puzzle_attempts_pulled: pz,
            endgame_attempts_pulled: eg,
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
            moves: "e4 e5".into(),
            note: String::new(),
            note_ts: 0,
            tags: Vec::new(),
            tags_ts: 0,
            analyzed: false,
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
        apply_games(&mut conn, &[g.clone()]).unwrap();
        apply_games(&mut conn, &[g.clone()]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let (tags, opening): (String, Option<f64>) = conn
            .query_row("SELECT tags, accuracy_opening FROM games", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(tags, r#"["OTB"]"#);
        assert_eq!(opening, Some(91.0));

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
        apply_games(&mut conn, &[old.clone()]).unwrap();

        let tombstone = SyncGameTombstone {
            source: old.source.clone(),
            source_id: old.source_id.clone(),
            deleted_ts: 200,
        };
        assert_eq!(apply_game_tombstones(&mut conn, &[tombstone]).unwrap(), 1);
        assert_eq!(apply_games(&mut conn, &[old.clone()]).unwrap(), 0);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);

        let mut reimported = old;
        reimported.updated_ts = 300;
        assert_eq!(apply_games(&mut conn, &[reimported]).unwrap(), 1);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "a genuinely newer reimport may recreate the game");
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
        assert_eq!(apply_puzzle_attempts(&conn, &[a.clone()]).unwrap(), 1);
        assert_eq!(apply_puzzle_attempts(&conn, &[a]).unwrap(), 0);

        let e = SyncEndgameAttempt {
            drill_id: "lucena".into(),
            ts: 2000,
            solved: true,
            moves: 14,
        };
        assert_eq!(apply_endgame_attempts(&conn, &[e.clone()]).unwrap(), 1);
        assert_eq!(apply_endgame_attempts(&conn, &[e]).unwrap(), 0);
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
        let deleted = apply_tombstones(&mut conn, &[tomb.clone()]).unwrap();
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
        // Echter TLS-tiny_http-Server + gepinnter ureq-Client — dieselben
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
