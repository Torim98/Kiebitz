//! Study-Tab: aggregierte Lernplan-Daten. Der Coach selbst (Empfehlungen)
//! rechnet im Frontend auf den vorhandenen Insights-Daten; hier kommt nur
//! zusammen, was der Tagesplan und der Wochenkalender brauchen.
//!
//! Tagesgrenzen sind bewusst UTC (wie in puzzles.rs) — für Streaks und
//! Kalenderkacheln ist das genau genug.

use crate::{db, settings};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use tauri::{Manager, State};

#[derive(Serialize)]
pub struct DayActivity {
    /// Unix-Sekunden des UTC-Tagesbeginns.
    pub day_ts: i64,
    pub puzzle_attempts: i64,
    pub endgame_attempts: i64,
    /// Approximation: Knoten, deren letzte Wiederholung an diesem Tag war.
    pub rep_reviews: i64,
}

#[derive(Serialize)]
pub struct StudyData {
    /// Jetzt fällige Repertoire-Wiederholungen (inkl. neuer Karten).
    pub due_now: i64,
    /// Fällige Wiederholungen je Tag: Index 0 = heute (inkl. überfälliger),
    /// 1..6 = Vorschau der nächsten Tage laut FSRS-Fälligkeiten.
    pub due_week: Vec<i64>,
    /// Partien ohne Auto-Analyse.
    pub unanalyzed: i64,
    pub today_puzzle_attempts: i64,
    pub puzzle_goal: i64,
    /// Letzte 7 Tage aufsteigend (Index 6 = heute).
    pub activity: Vec<DayActivity>,
    /// Zusammenhängende Lerntage (Puzzles, Endspiele oder Wiederholungen).
    pub streak_days: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StudyTemplate {
    pub id: i64,
    pub title: String,
    pub duration_min: i64,
    pub tool: String,
    pub description: String,
}

#[derive(Deserialize)]
pub struct StudyTemplateInput {
    pub id: Option<i64>,
    pub title: String,
    pub duration_min: i64,
    pub tool: String,
    pub description: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StudyEvent {
    pub id: i64,
    pub template_id: i64,
    pub day: String,
    pub position: i64,
    pub completed: bool,
    pub completed_ts: i64,
    pub template: StudyTemplate,
}

#[derive(Serialize)]
pub struct StudyCalendar {
    pub templates: Vec<StudyTemplate>,
    pub events: Vec<StudyEvent>,
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn count(conn: &Connection, sql: &str, lo: i64, hi: i64) -> Result<i64, String> {
    conn.query_row(sql, params![lo, hi], |r| r.get(0))
        .map_err(|e| e.to_string())
}

fn clean_text(value: String, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
}

fn read_template(conn: &Connection, id: i64) -> Result<StudyTemplate, String> {
    conn.query_row(
        "SELECT id, title, duration_min, tool, description FROM study_templates WHERE id = ?1",
        params![id],
        |r| {
            Ok(StudyTemplate {
                id: r.get(0)?,
                title: r.get(1)?,
                duration_min: r.get(2)?,
                tool: r.get(3)?,
                description: r.get(4)?,
            })
        },
    )
    .map_err(|_| "Lerneinheit nicht gefunden".to_string())
}

fn calendar_from_conn(
    conn: &Connection,
    start_day: &str,
    end_day: &str,
) -> Result<StudyCalendar, String> {
    if !valid_day(start_day) || !valid_day(end_day) || start_day > end_day {
        return Err("Ungültiger Kalenderzeitraum".into());
    }
    let templates = {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, duration_min, tool, description
                 FROM study_templates ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(StudyTemplate {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    duration_min: r.get(2)?,
                    tool: r.get(3)?,
                    description: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let events = {
        let mut stmt = conn
            .prepare(
                "SELECT e.id, e.template_id, e.day, e.position, e.completed, e.completed_ts,
                        t.id, t.title, t.duration_min, t.tool, t.description
                 FROM study_events e JOIN study_templates t ON t.id = e.template_id
                 WHERE e.day >= ?1 AND e.day <= ?2
                 ORDER BY e.day, e.position, e.id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start_day, end_day], |r| {
                Ok(StudyEvent {
                    id: r.get(0)?,
                    template_id: r.get(1)?,
                    day: r.get(2)?,
                    position: r.get(3)?,
                    completed: r.get::<_, i64>(4)? != 0,
                    completed_ts: r.get(5)?,
                    template: StudyTemplate {
                        id: r.get(6)?,
                        title: r.get(7)?,
                        duration_min: r.get(8)?,
                        tool: r.get(9)?,
                        description: r.get(10)?,
                    },
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    Ok(StudyCalendar { templates, events })
}

#[tauri::command]
pub fn study_calendar(
    db: State<db::Db>,
    start_day: String,
    end_day: String,
) -> Result<StudyCalendar, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    calendar_from_conn(&conn, &start_day, &end_day)
}

#[tauri::command]
pub fn save_study_template(
    db: State<db::Db>,
    template: StudyTemplateInput,
) -> Result<StudyTemplate, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let title = clean_text(template.title, 80);
    if title.is_empty() {
        return Err("Titel darf nicht leer sein".into());
    }
    let duration = template.duration_min.clamp(5, 480);
    let tool = clean_text(template.tool, 100);
    let description = clean_text(template.description, 2_000);
    let now = now_ts();
    let id = if let Some(id) = template.id {
        let changed = conn
            .execute(
                "UPDATE study_templates SET title=?1, duration_min=?2, tool=?3,
                    description=?4, updated_ts=?5 WHERE id=?6",
                params![title, duration, tool, description, now, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Lerneinheit nicht gefunden".into());
        }
        id
    } else {
        conn.execute(
            "INSERT INTO study_templates
             (title, duration_min, tool, description, created_ts, updated_ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![title, duration, tool, description, now],
        )
        .map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };
    read_template(&conn, id)
}

#[tauri::command]
pub fn delete_study_template(db: State<db::Db>, template_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM study_events WHERE template_id = ?1",
        params![template_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM study_templates WHERE id = ?1",
        params![template_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn schedule_study_unit(db: State<db::Db>, template_id: i64, day: String) -> Result<(), String> {
    if !valid_day(&day) {
        return Err("Ungültiges Datum".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    read_template(&conn, template_id)?;
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM study_events WHERE day = ?1",
            params![day],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO study_events (template_id, day, position, created_ts)
         VALUES (?1, ?2, ?3, ?4)",
        params![template_id, day, position, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_study_unit(
    db: State<db::Db>,
    event_id: i64,
    day: String,
    position: i64,
) -> Result<(), String> {
    if !valid_day(&day) {
        return Err("Ungültiges Datum".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let changed = conn
        .execute(
            "UPDATE study_events SET day = ?1, position = ?2 WHERE id = ?3",
            params![day, position.max(0), event_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Geplante Einheit nicht gefunden".into());
    }
    Ok(())
}

#[tauri::command]
pub fn complete_study_unit(
    db: State<db::Db>,
    event_id: i64,
    completed: bool,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE study_events SET completed = ?1, completed_ts = ?2 WHERE id = ?3",
        params![completed, if completed { now_ts() } else { 0 }, event_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_study_unit(db: State<db::Db>, event_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM study_events WHERE id = ?1", params![event_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn study_data(app: tauri::AppHandle, db: State<db::Db>) -> Result<StudyData, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_ts();
    let puzzle_goal = app
        .state::<settings::SettingsState>()
        .0
        .lock()
        .map(|s| s.puzzle_goal as i64)
        .unwrap_or(20);
    study_data_from_conn(&conn, now, puzzle_goal)
}

fn study_data_from_conn(
    conn: &Connection,
    now: i64,
    puzzle_goal: i64,
) -> Result<StudyData, String> {
    let today = now / 86_400;
    let day_start = today * 86_400;

    // ── Repertoire-Fälligkeiten ──────────────────────────────────────────────
    // my_move-Parität wie in repertoire.rs: Weiß trainiert ungerade Halbzüge.
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    let due_now: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts <= ?1)"
            ),
            params![now],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut due_week = Vec::with_capacity(7);
    // Heute: alles, was bis Tagesende fällig ist (inkl. neuer Karten).
    due_week.push(
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts < ?1)"
            ),
            params![day_start + 86_400],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?,
    );
    for k in 1..7i64 {
        due_week.push(
            conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM rep_nodes
                     WHERE {my_move} AND reps > 0 AND due_ts >= ?1 AND due_ts < ?2"
                ),
                params![day_start + k * 86_400, day_start + (k + 1) * 86_400],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?,
        );
    }

    // ── Backlog & Tagesziel ──────────────────────────────────────────────────
    let unanalyzed: i64 = conn
        .query_row("SELECT COUNT(*) FROM games WHERE analyzed = 0 AND analysis_excluded = 0", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let today_puzzle_attempts = count(
        conn,
        "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
        day_start,
        day_start + 86_400,
    )?;
    // ── Aktivität der letzten 7 Tage ─────────────────────────────────────────
    let mut activity = Vec::with_capacity(7);
    for k in (0..7i64).rev() {
        let lo = day_start - k * 86_400;
        let hi = lo + 86_400;
        activity.push(DayActivity {
            day_ts: lo,
            puzzle_attempts: count(
                conn,
                "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
                lo,
                hi,
            )?,
            endgame_attempts: count(
                conn,
                "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
                lo,
                hi,
            )?,
            rep_reviews: count(
                conn,
                "SELECT COUNT(*) FROM rep_nodes WHERE last_ts >= ?1 AND last_ts < ?2",
                lo,
                hi,
            )?,
        });
    }

    // ── Streak: zusammenhängende Tage mit irgendeiner Lernaktivität ─────────
    let mut days: BTreeSet<i64> = BTreeSet::new();
    for sql in [
        "SELECT DISTINCT ts / 86400 FROM puzzle_attempts",
        "SELECT DISTINCT ts / 86400 FROM endgame_attempts",
        "SELECT DISTINCT last_ts / 86400 FROM rep_nodes WHERE last_ts > 0",
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        for d in rows {
            days.insert(d.map_err(|e| e.to_string())?);
        }
    }
    let mut streak = 0i64;
    // Heute zählt, sobald etwas passiert ist; sonst ab gestern rückwärts.
    let mut expect = if days.contains(&today) {
        today
    } else {
        today - 1
    };
    while days.contains(&expect) {
        streak += 1;
        expect -= 1;
    }

    Ok(StudyData {
        due_now,
        due_week,
        unanalyzed,
        today_puzzle_attempts,
        puzzle_goal,
        activity,
        streak_days: streak,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const TODAY: i64 = 20_000;
    const NOW: i64 = TODAY * 86_400 + 12 * 3_600;

    #[test]
    fn aggregates_due_items_activity_backlog_and_streak() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        conn.execute(
            "INSERT INTO games (source, source_id, analyzed) VALUES ('manual', 'open', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed) VALUES ('manual', 'done', 1)",
            [],
        )
        .unwrap();

        // White depth 1 and black depth 2 are trainable moves. White depth 2
        // belongs to the opponent and must not enter the due counts.
        for (side, san, depth, reps, due_ts, last_ts) in [
            ("white", "e4", 1, 0, 0, (TODAY - 2) * 86_400 + 10),
            ("black", "e5", 2, 1, NOW - 1, 0),
            ("white", "c5", 2, 0, 0, 0),
            ("white", "Nf3", 3, 1, (TODAY + 1) * 86_400 + 10, 0),
        ] {
            conn.execute(
                "INSERT INTO rep_nodes
                 (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
                 VALUES (0, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    side,
                    san,
                    format!("fen-{side}-{san}"),
                    depth,
                    reps,
                    due_ts,
                    last_ts
                ],
            )
            .unwrap();
        }

        for ts in [TODAY * 86_400 + 100, (TODAY - 1) * 86_400 + 100] {
            conn.execute(
                "INSERT INTO puzzle_attempts
                 (puzzle_id, ts, solved, rating_before, rating_after, themes)
                 VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
                params![ts],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
             VALUES ('lucena', ?1, 1, 8)",
            params![(TODAY - 2) * 86_400 + 200],
        )
        .unwrap();

        let data = study_data_from_conn(&conn, NOW, 12).unwrap();
        assert_eq!(data.due_now, 2);
        assert_eq!(data.due_week[0], 2);
        assert_eq!(data.due_week[1], 1);
        assert_eq!(data.unanalyzed, 1);
        assert_eq!(data.today_puzzle_attempts, 1);
        assert_eq!(data.puzzle_goal, 12);
        assert_eq!(data.activity.len(), 7);
        assert_eq!(data.activity[6].puzzle_attempts, 1);
        assert_eq!(data.activity[5].puzzle_attempts, 1);
        assert_eq!(data.activity[4].endgame_attempts, 1);
        assert_eq!(data.activity[4].rep_reviews, 1);
        assert_eq!(data.streak_days, 3);
    }

    #[test]
    fn streak_can_continue_from_yesterday_when_today_is_empty() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        for day in [TODAY - 1, TODAY - 2] {
            conn.execute(
                "INSERT INTO endgame_attempts (drill_id, ts, solved, moves)
                 VALUES ('philidor', ?1, 1, 6)",
                params![day * 86_400 + 1],
            )
            .unwrap();
        }

        let data = study_data_from_conn(&conn, NOW, 20).unwrap();
        assert_eq!(data.streak_days, 2);
    }

    #[test]
    fn calendar_templates_and_events_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let template = StudyTemplateInput {
            id: None,
            title: "  Calculation  ".into(),
            duration_min: 30,
            tool: "Board".into(),
            description: "Three candidate moves".into(),
        };
        let title = clean_text(template.title, 80);
        conn.execute(
            "INSERT INTO study_templates
             (title, duration_min, tool, description, created_ts, updated_ts)
             VALUES (?1, ?2, ?3, ?4, 1, 1)",
            params![
                title,
                template.duration_min,
                template.tool,
                template.description
            ],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO study_events (template_id, day, position, created_ts)
             VALUES (?1, '2026-07-22', 0, 1)",
            params![id],
        )
        .unwrap();

        let calendar = calendar_from_conn(&conn, "2026-07-20", "2026-07-26").unwrap();
        assert!(calendar.templates.iter().any(|t| t.title == "Calculation"));
        assert_eq!(calendar.events.len(), 1);
        assert_eq!(calendar.events[0].template.duration_min, 30);
        assert!(!calendar.events[0].completed);
    }

    #[test]
    fn validates_calendar_days() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        assert!(calendar_from_conn(&conn, "22.07.2026", "2026-07-26").is_err());
        assert!(calendar_from_conn(&conn, "2026-07-27", "2026-07-26").is_err());
    }
}
