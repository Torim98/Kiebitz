//! Eröffnungs-Repertoire: persistenter Zugbaum, FSRS-Spaced-Repetition
//! und Abgleich gegen die gespielten Partien.

use crate::chess;
use crate::db;
use rusqlite::{params, Connection};
use serde::Serialize;
use shakmaty::san::SanPlus;
use shakmaty::{Chess, Position};
use std::collections::HashMap;
use tauri::State;

// ── FSRS-Scheduler (Default-Gewichte, Retention 0,9) ─────────────────────────

const W: [f64; 17] = [
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461,
    2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const FACTOR: f64 = 19.0 / 81.0;
const DECAY: f64 = -0.5;

/// Abrufwahrscheinlichkeit nach `days` Tagen bei Stabilität `s`.
fn retrievability(days: f64, s: f64) -> f64 {
    (1.0 + FACTOR * days / s.max(0.1)).powf(DECAY)
}

fn init_stability(grade: u8) -> f64 {
    W[(grade as usize - 1).min(3)].max(0.1)
}

fn init_difficulty(grade: u8) -> f64 {
    (W[4] - (grade as f64 - 3.0) * W[5]).clamp(1.0, 10.0)
}

fn next_difficulty(d: f64, grade: u8) -> f64 {
    let d_new = d - W[6] * (grade as f64 - 3.0);
    (W[7] * W[4] + (1.0 - W[7]) * d_new).clamp(1.0, 10.0)
}

fn next_stability(s: f64, d: f64, r: f64, grade: u8) -> f64 {
    if grade == 1 {
        // Lapse: Stabilität bricht ein, aber nie über den alten Wert.
        let s_fail =
            W[11] * d.powf(-W[12]) * ((s + 1.0).powf(W[13]) - 1.0) * (W[14] * (1.0 - r)).exp();
        return s_fail.min(s).max(0.1);
    }
    let hard = if grade == 2 { W[15] } else { 1.0 };
    let easy = if grade == 4 { W[16] } else { 1.0 };
    let growth = (W[8]).exp() * (11.0 - d) * s.powf(-W[9]) * ((W[10] * (1.0 - r)).exp() - 1.0);
    s * (growth * hard * easy + 1.0)
}

/// FSRS-Update: liefert (neue Stabilität, neue Schwierigkeit, Intervall in Tagen).
fn fsrs_review(
    stability: f64,
    difficulty: f64,
    reps: i64,
    elapsed_days: f64,
    grade: u8,
) -> (f64, f64, i64) {
    let (s, d) = if reps == 0 {
        (init_stability(grade), init_difficulty(grade))
    } else {
        let r = retrievability(elapsed_days.max(0.0), stability);
        (
            next_stability(stability, difficulty, r, grade),
            next_difficulty(difficulty, grade),
        )
    };
    // Bei Retention 0,9 entspricht das Intervall der Stabilität.
    let interval = if grade == 1 { 0 } else { (s.round() as i64).clamp(1, 365) };
    (s, d, interval)
}

// ── Datenformen ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct RepNodeOut {
    pub id: i64,
    pub parent_id: i64,
    pub side: String,
    pub san: String,
    pub name: String,
    pub depth: i64,
    pub reps: i64,
    pub lapses: i64,
    pub due_ts: i64,
    pub stability: f64,
    /// True, wenn dieser Zug von mir zu spielen ist (trainierbar).
    pub my_move: bool,
}

fn is_my_move(side: &str, depth: i64) -> bool {
    if side == "white" {
        depth % 2 == 1
    } else {
        depth % 2 == 0
    }
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn load_nodes(conn: &Connection) -> Result<Vec<RepNodeOut>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, parent_id, side, san, name, depth, reps, lapses, due_ts, stability
             FROM rep_nodes ORDER BY depth, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let side: String = r.get(2)?;
            let depth: i64 = r.get(5)?;
            Ok(RepNodeOut {
                id: r.get(0)?,
                parent_id: r.get(1)?,
                my_move: is_my_move(&side, depth),
                side,
                san: r.get(3)?,
                name: r.get(4)?,
                depth,
                reps: r.get(6)?,
                lapses: r.get(7)?,
                due_ts: r.get(8)?,
                stability: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rep_list(db: State<db::Db>) -> Result<Vec<RepNodeOut>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    load_nodes(&conn)
}

/// Fügt eine Zugfolge ab der Grundstellung ein; vorhandene Knoten werden
/// wiederverwendet. `name` benennt den letzten Knoten der Linie.
#[tauri::command]
pub fn rep_add_line(
    db: State<db::Db>,
    side: String,
    name: String,
    sans: Vec<String>,
) -> Result<i64, String> {
    if side != "white" && side != "black" {
        return Err("Seite muss white oder black sein".into());
    }
    if sans.is_empty() {
        return Err("Keine Züge angegeben".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut pos = Chess::default();
    let mut parent_id = 0i64;
    let mut leaf_id = 0i64;
    for (i, san_str) in sans.iter().enumerate() {
        let san: SanPlus = san_str
            .parse()
            .map_err(|_| format!("Zug {} nicht lesbar: {san_str}", i + 1))?;
        let m = san
            .san
            .to_move(&pos)
            .map_err(|_| format!("Zug {} illegal: {san_str}", i + 1))?;
        let clean_san = SanPlus::from_move(pos.clone(), &m).to_string();
        pos = pos.play(&m).map_err(|_| format!("Zug {} illegal: {san_str}", i + 1))?;
        let key = chess::fen_key(&pos);
        let depth = (i + 1) as i64;

        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM rep_nodes WHERE side = ?1 AND parent_id = ?2 AND san = ?3",
                params![side, parent_id, clean_san],
                |r| r.get(0),
            )
            .ok();
        leaf_id = match existing {
            Some(id) => id,
            None => {
                conn.execute(
                    "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, created_ts)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![parent_id, side, clean_san, key, depth, db::now_ts()],
                )
                .map_err(|e| e.to_string())?;
                conn.last_insert_rowid()
            }
        };
        parent_id = leaf_id;
    }
    if !name.trim().is_empty() {
        conn.execute(
            "UPDATE rep_nodes SET name = ?2 WHERE id = ?1",
            params![leaf_id, name.trim()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(leaf_id)
}

/// Löscht einen Knoten samt aller Untervarianten.
#[tauri::command]
pub fn rep_delete(db: State<db::Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // Pfad des Knotens für den Sync-Tombstone bestimmen (Wurzel → Knoten),
    // damit die Löschung auf gepairte Geräte propagiert.
    let mut parts: Vec<String> = Vec::new();
    let mut side = String::new();
    let mut cur = id;
    while cur != 0 {
        match conn
            .query_row(
                "SELECT parent_id, san, side FROM rep_nodes WHERE id = ?1",
                params![cur],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
            )
            .ok()
        {
            Some((parent, san, s)) => {
                parts.push(san);
                side = s;
                cur = parent;
            }
            None => break,
        }
    }
    if !parts.is_empty() {
        parts.reverse();
        let path = parts.join(" ");
        let _ = conn.execute(
            "INSERT INTO rep_tombstones (side, path, deleted_ts) VALUES (?1, ?2, ?3)
             ON CONFLICT(side, path) DO UPDATE SET deleted_ts = MAX(deleted_ts, excluded.deleted_ts)",
            params![side, path, db::now_ts()],
        );
    }
    conn.execute(
        "DELETE FROM rep_nodes WHERE id IN (
            WITH RECURSIVE sub(i) AS (
                SELECT ?1
                UNION ALL
                SELECT r.id FROM rep_nodes r JOIN sub ON r.parent_id = sub.i
            ) SELECT i FROM sub)",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Training ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DueItem {
    pub node_id: i64,
    pub side: String,
    /// Züge bis zur Ausgangsstellung (vor meinem Zug).
    pub prompt_sans: Vec<String>,
    pub expected_san: String,
    pub line: String,
    pub is_new: bool,
}

fn path_to(nodes: &HashMap<i64, RepNodeOut>, id: i64) -> Vec<String> {
    let mut path = Vec::new();
    let mut cur = id;
    while cur != 0 {
        match nodes.get(&cur) {
            Some(n) => {
                path.push(n.san.clone());
                cur = n.parent_id;
            }
            None => break,
        }
    }
    path.reverse();
    path
}

/// Name der Linie: nächster benannter Vorfahre (oder eigener Name).
fn line_name(nodes: &HashMap<i64, RepNodeOut>, id: i64) -> String {
    let mut cur = id;
    while cur != 0 {
        match nodes.get(&cur) {
            Some(n) => {
                if !n.name.is_empty() {
                    return n.name.clone();
                }
                cur = n.parent_id;
            }
            None => break,
        }
    }
    String::new()
}

#[tauri::command]
pub fn rep_due(db: State<db::Db>) -> Result<Vec<DueItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let by_id: HashMap<i64, RepNodeOut> = nodes.iter().map(|n| (n.id, n.clone())).collect();
    let now = now_ts();

    let mut due: Vec<(&RepNodeOut, bool)> = nodes
        .iter()
        .filter(|n| n.my_move && (n.reps == 0 || n.due_ts <= now))
        .map(|n| (n, n.reps == 0))
        .collect();
    // Fällige zuerst (älteste zuerst), neue danach.
    due.sort_by_key(|(n, is_new)| (*is_new, n.due_ts, n.depth));

    Ok(due
        .into_iter()
        .map(|(n, is_new)| {
            let mut prompt = path_to(&by_id, n.id);
            prompt.pop(); // letzter Zug ist die gesuchte Antwort
            DueItem {
                node_id: n.id,
                side: n.side.clone(),
                prompt_sans: prompt,
                expected_san: n.san.clone(),
                line: line_name(&by_id, n.id),
                is_new,
            }
        })
        .collect())
}

#[derive(Serialize)]
pub struct ReviewResult {
    pub due_ts: i64,
    pub interval_days: i64,
}

/// Bewertet eine Trainingsantwort: 1 = falsch, 2 = schwer, 3 = gut, 4 = leicht.
#[tauri::command]
pub fn rep_review(db: State<db::Db>, node_id: i64, grade: u8) -> Result<ReviewResult, String> {
    if !(1..=4).contains(&grade) {
        return Err("Grade muss 1–4 sein".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (stability, difficulty, reps, lapses, last_ts): (f64, f64, i64, i64, i64) = conn
        .query_row(
            "SELECT stability, difficulty, reps, lapses, last_ts FROM rep_nodes WHERE id = ?1",
            params![node_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| "Knoten nicht gefunden".to_string())?;

    let now = now_ts();
    let elapsed_days = (now - last_ts) as f64 / 86_400.0;
    let (s, d, interval) = fsrs_review(stability, difficulty, reps, elapsed_days, grade);
    let due_ts = if grade == 1 { now + 600 } else { now + interval * 86_400 };
    let lapses = lapses + i64::from(grade == 1 && reps > 0);

    conn.execute(
        "UPDATE rep_nodes SET stability = ?2, difficulty = ?3, reps = reps + 1,
            lapses = ?4, due_ts = ?5, last_ts = ?6 WHERE id = ?1",
        params![node_id, s, d, lapses, due_ts, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(ReviewResult {
        due_ts,
        interval_days: interval,
    })
}

// ── Abgleich mit den Partien ─────────────────────────────────────────────────

#[derive(Serialize)]
pub struct RepStats {
    /// Anzahl trainierbarer Stellungen (meine Züge).
    pub my_positions: i64,
    pub due_now: i64,
    /// Anteil der letzten 50 Partien, die bis Halbzug 8 im Buch blieben.
    pub coverage_pct: f64,
    pub games_checked: i64,
}

#[tauri::command]
pub fn rep_stats(db: State<db::Db>) -> Result<RepStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let nodes = load_nodes(&conn)?;
    let now = now_ts();
    let my_positions = nodes.iter().filter(|n| n.my_move).count() as i64;
    let due_now = nodes
        .iter()
        .filter(|n| n.my_move && (n.reps == 0 || n.due_ts <= now))
        .count() as i64;

    // Kinder-Lookup: (side, parent_id) → [(san, id)]
    let mut children: HashMap<(String, i64), Vec<(String, i64)>> = HashMap::new();
    for n in &nodes {
        children
            .entry((n.side.clone(), n.parent_id))
            .or_default()
            .push((n.san.clone(), n.id));
    }

    let mut stmt = conn
        .prepare("SELECT color, moves FROM games WHERE moves != '' ORDER BY played_ts DESC LIMIT 50")
        .map_err(|e| e.to_string())?;
    let games: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut covered = 0i64;
    let checked = games.len() as i64;
    for (color, moves) in &games {
        let mut node_id = 0i64;
        let mut ok = true;
        for (i, san) in moves.split_whitespace().take(8).enumerate() {
            let ply = (i + 1) as i64;
            let kids = children.get(&(color.clone(), node_id));
            let hit = kids.and_then(|k| k.iter().find(|(s, _)| s == san));
            match hit {
                Some((_, id)) => node_id = *id,
                None => {
                    // Buch verlassen: nur mein eigener Abweichler zählt gegen mich,
                    // und nur wenn das Buch hier überhaupt eine Fortsetzung kennt.
                    let book_has_moves = kids.map(|k| !k.is_empty()).unwrap_or(false);
                    if is_my_move(color, ply) && book_has_moves {
                        ok = false;
                    }
                    break;
                }
            }
        }
        if ok {
            covered += 1;
        }
    }

    Ok(RepStats {
        my_positions,
        due_now,
        coverage_pct: if checked > 0 {
            (covered as f64 / checked as f64 * 1000.0).round() / 10.0
        } else {
            0.0
        },
        games_checked: checked,
    })
}

#[derive(Serialize)]
pub struct Deviation {
    pub san: String,
    pub count: i64,
}

#[derive(Serialize)]
pub struct NodeGameStats {
    pub games: i64,
    pub score_pct: f64,
    /// Buchzüge ab dieser Stellung.
    pub book_sans: Vec<String>,
    /// Gespielte Züge, die nicht im Buch stehen.
    pub deviations: Vec<Deviation>,
    pub followed_book: i64,
}

/// Statistik zu einem Repertoire-Knoten: wie oft wurde die Stellung erreicht,
/// wie lief es, und wo wurde vom Buch abgewichen.
#[tauri::command]
pub fn rep_node_games(db: State<db::Db>, node_id: i64) -> Result<NodeGameStats, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (fen_key, side): (String, String) = conn
        .query_row(
            "SELECT fen_key, side FROM rep_nodes WHERE id = ?1",
            params![node_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Knoten nicht gefunden".to_string())?;

    let book_sans: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT san FROM rep_nodes WHERE parent_id = ?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![node_id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };

    let mut stmt = conn
        .prepare(
            "SELECT p.game_id, MIN(p.ply), g.result, g.moves
             FROM positions p JOIN games g ON g.id = p.game_id
             WHERE p.fen_key = ?1 AND g.color = ?2
             GROUP BY p.game_id",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(i64, u32, String, String)> = stmt
        .query_map(params![fen_key, side], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut score = 0.0;
    let mut followed = 0i64;
    let mut dev: Vec<Deviation> = Vec::new();
    for (_id, ply, result, moves) in &rows {
        score += match result.as_str() {
            "win" => 1.0,
            "draw" => 0.5,
            _ => 0.0,
        };
        if let Some(next) = moves.split_whitespace().nth(*ply as usize) {
            if book_sans.iter().any(|s| s == next) {
                followed += 1;
            } else if !book_sans.is_empty() {
                match dev.iter_mut().find(|d| d.san == next) {
                    Some(d) => d.count += 1,
                    None => dev.push(Deviation {
                        san: next.to_string(),
                        count: 1,
                    }),
                }
            }
        }
    }
    dev.sort_by(|a, b| b.count.cmp(&a.count));
    dev.truncate(4);

    let games = rows.len() as i64;
    Ok(NodeGameStats {
        games,
        score_pct: if games > 0 {
            (score / games as f64 * 1000.0).round() / 10.0
        } else {
            0.0
        },
        book_sans,
        deviations: dev,
        followed_book: followed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fsrs_new_card_good() {
        let (s, d, interval) = fsrs_review(0.0, 0.0, 0, 0.0, 3);
        assert!((s - W[2]).abs() < 1e-9, "S0(good) = w2");
        assert!(d > 1.0 && d < 10.0);
        assert!(interval >= 1);
    }

    #[test]
    fn fsrs_success_grows_interval() {
        let (s1, d1, i1) = fsrs_review(0.0, 0.0, 0, 0.0, 3);
        let (s2, _, i2) = fsrs_review(s1, d1, 1, i1 as f64, 3);
        assert!(s2 > s1, "Stabilität wächst: {s1} → {s2}");
        assert!(i2 >= i1, "Intervall wächst: {i1} → {i2}");
    }

    #[test]
    fn fsrs_lapse_shrinks_stability() {
        let (s, d, _) = fsrs_review(20.0, 5.0, 5, 20.0, 1);
        assert!(s < 20.0, "Lapse reduziert Stabilität: {s}");
        let _ = d;
    }

    #[test]
    fn my_move_parity() {
        assert!(is_my_move("white", 1));
        assert!(!is_my_move("white", 2));
        assert!(is_my_move("black", 2));
        assert!(!is_my_move("black", 1));
    }
}
