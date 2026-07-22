//! Auto-Analyse-Pipeline: läuft als Hintergrund-Thread mit eigener
//! Engine-Instanz über alle unanalysierten Partien, cached Bewertungen pro
//! Stellung, erkennt Patzer/Fehler/Ungenauigkeiten aus Win-Prob-Schwankungen
//! und schreibt Annotationen in die Datenbank.

use crate::chess::{self, WalkedMove};
use crate::db;
use crate::engine::UciEngine;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

pub struct AnalysisState {
    pub running: AtomicBool,
    pub cancel: AtomicBool,
}

impl Default for AnalysisState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        }
    }
}

/// Pfad zur Datenbank — Hintergrund-Threads öffnen eigene Verbindungen.
/// Mutex, weil der Speicherort in den Einstellungen änderbar ist.
pub struct DbPath(pub Mutex<PathBuf>);

// ── Win-Prob & Judgments ─────────────────────────────────────────────────────

/// Weiß-Gewinnwahrscheinlichkeit (0..1) aus Weiß-Sicht-Bewertung.
fn win_prob(eval_cp: Option<i32>, mate_in: Option<i32>) -> f64 {
    if let Some(m) = mate_in {
        return if m > 0 { 1.0 } else { 0.0 };
    }
    let cp = f64::from(eval_cp.unwrap_or(0));
    1.0 / (1.0 + (-0.004 * cp).exp())
}

fn judgment_for(drop: f64) -> &'static str {
    if drop >= 0.30 {
        "blunder"
    } else if drop >= 0.20 {
        "mistake"
    } else if drop >= 0.10 {
        "inaccuracy"
    } else {
        ""
    }
}

/// Genauigkeit nach der Lichess-Formel aus mittlerem Win-Prob-Verlust (×100).
fn accuracy_from_losses(losses: &[f64]) -> Option<f64> {
    if losses.is_empty() {
        return None;
    }
    let mean = losses.iter().sum::<f64>() / losses.len() as f64 * 100.0;
    let acc = 103.1668 * (-0.04354 * mean).exp() - 3.1669;
    Some((acc.clamp(0.0, 100.0) * 10.0).round() / 10.0)
}

// ── Bewertung einer Stellung (mit Cache) ─────────────────────────────────────

/// Bewertung aus Weiß-Sicht plus bester Zug (aus Sicht des Spielers am Zug).
#[derive(Clone)]
struct PosEval {
    eval_cp: Option<i32>,
    mate_in: Option<i32>,
    best_uci: String,
}

fn eval_position(
    conn: &Connection,
    engine: &mut UciEngine,
    fen: &str,
    key: &str,
    white_to_move: bool,
    depth: u32,
) -> Result<PosEval, String> {
    // Cache: Werte liegen aus Sicht des Spielers am Zug im Cache.
    let cached: Option<(Option<i32>, Option<i32>, String)> = conn
        .query_row(
            "SELECT eval_cp, mate_in, best_uci FROM eval_cache WHERE fen_key = ?1 AND depth >= ?2",
            params![key, depth],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();

    let (mut cp, mut mate, best) = match cached {
        Some(c) => c,
        None => {
            let r = engine.analyze(fen, depth)?;
            // Matt in 0 = der Spieler am Zug ist bereits matt.
            let mate = r.mate_in.map(|m| if m == 0 { -1 } else { m });
            conn.execute(
                "INSERT OR REPLACE INTO eval_cache (fen_key, eval_cp, mate_in, best_uci, depth)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![key, r.eval_cp, mate, r.bestmove, depth],
            )
            .map_err(|e| e.to_string())?;
            (r.eval_cp, mate, r.bestmove)
        }
    };

    // Auf Weiß-Sicht drehen.
    if !white_to_move {
        cp = cp.map(|v| -v);
        mate = mate.map(|v| -v);
    }
    Ok(PosEval {
        eval_cp: cp,
        mate_in: mate,
        best_uci: best,
    })
}

// ── Positionsindex ───────────────────────────────────────────────────────────

fn index_game_positions(
    conn: &Connection,
    game_id: i64,
    walked: &[WalkedMove],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare_cached(
            "INSERT OR IGNORE INTO positions (fen_key, game_id, ply) VALUES (?1, ?2, ?3)",
        )
        .map_err(|e| e.to_string())?;
    stmt.execute(params![chess::start_key(), game_id, 0])
        .map_err(|e| e.to_string())?;
    for w in walked {
        stmt.execute(params![w.key_after, game_id, w.ply])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Indiziert alle Partien, die noch nicht im Positionsindex stehen.
#[tauri::command]
pub fn index_positions(db: State<db::Db>) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let missing: Vec<(i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT g.id, g.moves FROM games g
                 WHERE g.moves != '' AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.game_id = g.id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let mut indexed = 0usize;
    for (id, moves) in &missing {
        let walked = chess::walk_sans(moves);
        if walked.is_empty() {
            continue;
        }
        index_game_positions(&conn, *id, &walked)?;
        indexed += 1;
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    Ok(indexed)
}

// ── Analyse-Worker ───────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct Progress {
    game_index: usize,
    games_total: usize,
    game_id: i64,
    opponent: String,
    ply: u32,
    plies: u32,
}

#[derive(Serialize, Clone)]
struct GameDone {
    game_id: i64,
    inaccuracies: u32,
    mistakes: u32,
    blunders: u32,
}

#[derive(Serialize, Clone)]
struct AllDone {
    analyzed: usize,
    canceled: bool,
    error: Option<String>,
}

/// Startet die Hintergrund-Analyse. `game_ids` analysiert gezielt (auch neu),
/// sonst werden unanalysierte Partien abgearbeitet (neueste zuerst, `limit`).
#[tauri::command]
pub fn start_analysis(
    app: tauri::AppHandle,
    state: State<AnalysisState>,
    game_ids: Option<Vec<i64>>,
    depth: Option<u32>,
    limit: Option<u32>,
) -> Result<(), String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("Die Analyse läuft bereits.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);

    let engine_path = match crate::resolve_engine(&app) {
        Some(p) => p,
        None => {
            state.running.store(false, Ordering::SeqCst);
            return Err("Keine Engine gefunden".into());
        }
    };
    let batch_depth = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map(|s| s.batch_depth)
        .unwrap_or(14);
    let depth = depth.unwrap_or(batch_depth).clamp(6, 30);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_worker(&app2, &engine_path, game_ids, depth, limit);
        let st = app2.state::<AnalysisState>();
        let canceled = st.cancel.load(Ordering::SeqCst);
        st.running.store(false, Ordering::SeqCst);
        let _ = app2.emit(
            "analysis://done",
            AllDone {
                analyzed: result.as_ref().copied().unwrap_or(0),
                canceled,
                error: result.err(),
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_analysis(state: State<AnalysisState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn analysis_running(state: State<AnalysisState>) -> bool {
    state.running.load(Ordering::SeqCst)
}

fn run_worker(
    app: &tauri::AppHandle,
    engine_path: &std::path::Path,
    game_ids: Option<Vec<i64>>,
    depth: u32,
    limit: Option<u32>,
) -> Result<usize, String> {
    let db_path = app
        .state::<DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "busy_timeout", "10000");

    let targets: Vec<(i64, String, String, String, i64)> = {
        let (sql, use_ids) = match &game_ids {
            Some(_) => (
                "SELECT id, moves, opponent, color, my_elo FROM games WHERE id = ?1".to_string(),
                true,
            ),
            None => (
                format!(
                    "SELECT id, moves, opponent, color, my_elo FROM games
                     WHERE analyzed = 0 AND moves != ''
                     ORDER BY played_ts DESC LIMIT {}",
                    limit.unwrap_or(u32::MAX)
                ),
                false,
            ),
        };
        if use_ids {
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let mut v = Vec::new();
            for id in game_ids.unwrap() {
                if let Ok(row) = stmt.query_row(params![id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                }) {
                    v.push(row);
                }
            }
            v
        } else {
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        }
    };

    if targets.is_empty() {
        return Ok(0);
    }

    let (threads, hash_mb) = {
        let s = app.state::<crate::settings::SettingsState>();
        let s = s.0.lock().map_err(|e| e.to_string())?;
        (
            if s.engine_threads == 0 {
                UciEngine::worker_threads()
            } else {
                s.engine_threads as usize
            },
            s.engine_hash_mb,
        )
    };
    let mut engine = UciEngine::spawn(&engine_path.to_string_lossy())?;
    let _ = engine.set_option("Threads", &threads.to_string());
    let _ = engine.set_option("Hash", &hash_mb.to_string());

    let state = app.state::<AnalysisState>();
    let total = targets.len();
    let mut analyzed = 0usize;

    for (idx, (game_id, moves, opponent, color, my_elo)) in targets.into_iter().enumerate() {
        if state.cancel.load(Ordering::SeqCst) {
            break;
        }
        let walked = chess::walk_sans(&moves);
        if walked.is_empty() {
            // Nichts zu analysieren (abgebrochene/leere Partie) — aus der Queue nehmen.
            conn.execute(
                "UPDATE games SET analyzed = 1, updated_ts = ?2 WHERE id = ?1",
                params![game_id, crate::db::now_ts()],
            )
            .map_err(|e| e.to_string())?;
            continue;
        }
        let plies = walked.len() as u32;

        // Bewertungen für Grundstellung + jede Stellung nach einem Halbzug.
        let mut evals: Vec<PosEval> = Vec::with_capacity(walked.len() + 1);
        let start_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        evals.push(eval_position(
            &conn,
            &mut engine,
            start_fen,
            &chess::start_key(),
            true,
            depth,
        )?);

        let mut canceled = false;
        for w in &walked {
            if state.cancel.load(Ordering::SeqCst) {
                canceled = true;
                break;
            }
            let white_to_move_after = !w.by_white;
            evals.push(eval_position(
                &conn,
                &mut engine,
                &w.fen_after,
                &w.key_after,
                white_to_move_after,
                depth,
            )?);
            let _ = app.emit(
                "analysis://progress",
                Progress {
                    game_index: idx + 1,
                    games_total: total,
                    game_id,
                    opponent: opponent.clone(),
                    ply: w.ply,
                    plies,
                },
            );
        }
        if canceled {
            break;
        }

        // Judgments + Genauigkeit meiner Züge.
        let my_white = color == "white";
        let mut my_losses: Vec<f64> = Vec::new();
        let mut opening_losses: Vec<f64> = Vec::new();
        let mut middlegame_losses: Vec<f64> = Vec::new();
        let mut endgame_losses: Vec<f64> = Vec::new();
        let mut counts = (0u32, 0u32, 0u32); // inaccuracy, mistake, blunder
        let mut rows: Vec<(u32, &WalkedMove, &PosEval, &'static str)> = Vec::new();
        for (i, w) in walked.iter().enumerate() {
            let before = &evals[i];
            let after = &evals[i + 1];
            let wp_before = win_prob(before.eval_cp, before.mate_in);
            let wp_after = win_prob(after.eval_cp, after.mate_in);
            let drop = if w.by_white {
                (wp_before - wp_after).max(0.0)
            } else {
                (wp_after - wp_before).max(0.0)
            };
            if w.by_white == my_white {
                my_losses.push(drop);
                match w.phase {
                    "opening" => opening_losses.push(drop),
                    "middlegame" => middlegame_losses.push(drop),
                    "endgame" => endgame_losses.push(drop),
                    _ => {}
                }
            }
            let judgment = judgment_for(drop);
            match judgment {
                "inaccuracy" => counts.0 += 1,
                "mistake" => counts.1 += 1,
                "blunder" => counts.2 += 1,
                _ => {}
            }
            rows.push((w.ply, w, after, judgment));
        }
        let accuracy = accuracy_from_losses(&my_losses);
        let accuracy_opening = accuracy_from_losses(&opening_losses);
        let accuracy_middlegame = accuracy_from_losses(&middlegame_losses);
        let accuracy_endgame = accuracy_from_losses(&endgame_losses);
        let own_puzzles: Vec<crate::puzzles::OwnPuzzleCandidate> = rows
            .iter()
            .filter(|(_, w, _, judgment)| {
                w.by_white == my_white && matches!(*judgment, "mistake" | "blunder")
            })
            .map(|(ply, w, _, judgment)| crate::puzzles::OwnPuzzleCandidate {
                ply: *ply,
                fen: w.fen_before.clone(),
                best_uci: evals[*ply as usize - 1].best_uci.clone(),
                phase: w.phase.to_string(),
                judgment: (*judgment).to_string(),
            })
            .collect();

        // In einer Transaktion schreiben.
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM move_evals WHERE game_id = ?1",
            params![game_id],
        )
        .map_err(|e| e.to_string())?;
        {
            let mut stmt = conn
                .prepare_cached(
                    "INSERT INTO move_evals (game_id, ply, san, eval_cp, mate_in, best_uci, judgment, phase)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )
                .map_err(|e| e.to_string())?;
            for (ply, w, after, judgment) in &rows {
                let best = &evals[*ply as usize - 1].best_uci;
                stmt.execute(params![
                    game_id,
                    ply,
                    w.san,
                    after.eval_cp,
                    after.mate_in,
                    best,
                    judgment,
                    w.phase
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        crate::puzzles::replace_own_game_puzzles(
            &conn,
            game_id,
            if my_elo > 0 { my_elo } else { 1500 },
            &own_puzzles,
        )?;
        index_game_positions(&conn, game_id, &walked)?;
        conn.execute(
            "UPDATE games SET analyzed = 1, accuracy = COALESCE(accuracy, ?2),
                accuracy_opening = ?3, accuracy_middlegame = ?4, accuracy_endgame = ?5,
                updated_ts = ?6 WHERE id = ?1",
            params![
                game_id,
                accuracy,
                accuracy_opening,
                accuracy_middlegame,
                accuracy_endgame,
                crate::db::now_ts()
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;

        analyzed += 1;
        let _ = app.emit(
            "analysis://game_done",
            GameDone {
                game_id,
                inaccuracies: counts.0,
                mistakes: counts.1,
                blunders: counts.2,
            },
        );
    }

    Ok(analyzed)
}

// ── Gespeicherte Analyse lesen ───────────────────────────────────────────────

#[derive(Serialize)]
pub struct MoveEvalRow {
    pub ply: u32,
    pub san: String,
    pub eval_cp: Option<i32>,
    pub mate_in: Option<i32>,
    pub best_uci: String,
    pub judgment: String,
    pub phase: String,
}

#[tauri::command]
pub fn game_analysis(db: State<db::Db>, game_id: i64) -> Result<Vec<MoveEvalRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT ply, san, eval_cp, mate_in, best_uci, judgment, phase
             FROM move_evals WHERE game_id = ?1 ORDER BY ply",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![game_id], |r| {
            Ok(MoveEvalRow {
                ply: r.get(0)?,
                san: r.get(1)?,
                eval_cp: r.get(2)?,
                mate_in: r.get(3)?,
                best_uci: r.get(4)?,
                judgment: r.get(5)?,
                phase: r.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

// ── Fehler nach Spielphase (nur eigene Züge) ─────────────────────────────────

#[derive(Serialize)]
pub struct PhaseErrors {
    pub phase: String,
    pub inaccuracy: i64,
    pub mistake: i64,
    pub blunder: i64,
}

#[tauri::command]
pub fn error_stats(db: State<db::Db>) -> Result<Vec<PhaseErrors>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT e.phase, e.judgment, COUNT(*) FROM move_evals e
             JOIN games g ON g.id = e.game_id
             WHERE e.judgment != ''
               AND ((g.color = 'white' AND e.ply % 2 = 1) OR (g.color = 'black' AND e.ply % 2 = 0))
             GROUP BY e.phase, e.judgment",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut out: Vec<PhaseErrors> = ["opening", "middlegame", "endgame"]
        .iter()
        .map(|p| PhaseErrors {
            phase: p.to_string(),
            inaccuracy: 0,
            mistake: 0,
            blunder: 0,
        })
        .collect();
    for (phase, judgment, count) in rows {
        if let Some(entry) = out.iter_mut().find(|e| e.phase == phase) {
            match judgment.as_str() {
                "inaccuracy" => entry.inaccuracy = count,
                "mistake" => entry.mistake = count,
                "blunder" => entry.blunder = count,
                _ => {}
            }
        }
    }
    Ok(out)
}

// ── Positionssuche ───────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct NextMoveStat {
    pub san: String,
    pub games: i64,
    /// Meine Punktquote in Prozent (Sieg 1, Remis 0,5).
    pub score_pct: f64,
}

#[derive(Serialize)]
pub struct PositionHit {
    pub game_id: i64,
    pub ply: u32,
    pub opponent: String,
    pub color: String,
    pub result: String,
    pub played_at: String,
    pub time_class: String,
    pub next_san: String,
}

#[derive(Serialize)]
pub struct PositionSearch {
    pub total_games: i64,
    pub next_moves: Vec<NextMoveStat>,
    pub sample: Vec<PositionHit>,
}

#[tauri::command]
pub fn search_position(db: State<db::Db>, fen: String) -> Result<PositionSearch, String> {
    let key = chess::normalize_fen(&fen)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.game_id, p.ply, g.moves, g.opponent, g.color, g.result, g.played_at, g.time_class
             FROM positions p JOIN games g ON g.id = p.game_id
             WHERE p.fen_key = ?1
             ORDER BY g.played_ts DESC, p.ply ASC LIMIT 800",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, u32, String, String, String, String, String, String)> = stmt
        .query_map(params![key], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Pro Partie nur das erste Erreichen der Stellung zählen (Zugwiederholung).
    let mut seen = std::collections::HashSet::new();
    let mut agg: Vec<(String, i64, f64)> = Vec::new(); // san, games, score sum
    let mut sample = Vec::new();
    let mut total = 0i64;

    for (game_id, ply, moves, opponent, color, result, played_at, time_class) in rows {
        if !seen.insert(game_id) {
            continue;
        }
        total += 1;
        let next_san = moves
            .split_whitespace()
            .nth(ply as usize)
            .unwrap_or("—")
            .to_string();
        let score = match result.as_str() {
            "win" => 1.0,
            "draw" => 0.5,
            _ => 0.0,
        };
        match agg.iter_mut().find(|(s, _, _)| *s == next_san) {
            Some(e) => {
                e.1 += 1;
                e.2 += score;
            }
            None => agg.push((next_san.clone(), 1, score)),
        }
        if sample.len() < 12 {
            sample.push(PositionHit {
                game_id,
                ply,
                opponent,
                color,
                result,
                played_at,
                time_class,
                next_san,
            });
        }
    }

    agg.sort_by(|a, b| b.1.cmp(&a.1));
    let next_moves = agg
        .into_iter()
        .take(6)
        .map(|(san, games, score)| NextMoveStat {
            san,
            games,
            score_pct: (score / games as f64 * 1000.0).round() / 10.0,
        })
        .collect();

    Ok(PositionSearch {
        total_games: total,
        next_moves,
        sample,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn judgments_follow_thresholds() {
        assert_eq!(judgment_for(0.35), "blunder");
        assert_eq!(judgment_for(0.25), "mistake");
        assert_eq!(judgment_for(0.12), "inaccuracy");
        assert_eq!(judgment_for(0.05), "");
    }

    #[test]
    fn win_prob_symmetry() {
        assert!((win_prob(Some(0), None) - 0.5).abs() < 1e-9);
        assert!(win_prob(Some(300), None) > 0.7);
        assert_eq!(win_prob(None, Some(3)), 1.0);
        assert_eq!(win_prob(None, Some(-2)), 0.0);
    }

    #[test]
    fn accuracy_reasonable() {
        // Fehlerfreie Partie ≈ 100 %, viele grobe Fehler deutlich darunter.
        let perfect = accuracy_from_losses(&[0.0, 0.0, 0.01]).unwrap();
        assert!(perfect > 95.0, "{perfect}");
        let sloppy = accuracy_from_losses(&[0.3, 0.25, 0.2, 0.1]).unwrap();
        assert!(sloppy < 60.0, "{sloppy}");
    }
}
