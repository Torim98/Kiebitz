//! Study-Tab: aggregierte Lernplan-Daten. Der Coach selbst (Empfehlungen)
//! rechnet im Frontend auf den vorhandenen Insights-Daten; hier kommt nur
//! zusammen, was der Tagesplan und der Wochenkalender brauchen.
//!
//! Tagesgrenzen sind bewusst UTC (wie in puzzles.rs) · für Streaks und
//! Kalenderkacheln ist das genau genug.

use crate::{db, settings};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{Manager, State};

#[derive(Serialize)]
pub struct DayActivity {
    /// Unix-Sekunden des UTC-Tagesbeginns.
    pub day_ts: i64,
    pub puzzle_attempts: i64,
    /// Gelöste Puzzles für Erfolgs- und Streak-Anzeigen.
    pub puzzle_solved: i64,
    pub endgame_attempts: i64,
    /// Tatsächliche Wiederholungen aus dem append-only Review-Log.
    pub rep_reviews: i64,
    /// Manuell als erledigt markierte Analyse-Termine im Lernkalender.
    pub game_reviews: i64,
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
    /// "" (Einzeltermin), "daily", "weekly" oder "biweekly".
    pub repeat_rule: String,
    /// Gemeinsamer Schlüssel aller Termine einer Serie ("" = Einzeltermin).
    pub series_key: String,
    pub template: StudyTemplate,
}

/// Wiederholungsraster einer Serie · Abstand in Tagen.
fn repeat_step(rule: &str) -> Option<i64> {
    match rule {
        "daily" => Some(1),
        "weekly" => Some(7),
        "biweekly" => Some(14),
        _ => None,
    }
}

/// Eine Serie darf den Kalender nicht fluten: zwei Jahre Wochentermine bzw.
/// gut drei Monate Tagestermine sind die Obergrenze.
const MAX_OCCURRENCES: usize = 104;

/// Standard-Horizont einer Serie in Tagen, wenn kein Enddatum gewählt wurde.
fn default_horizon(rule: &str) -> i64 {
    if rule == "daily" {
        30
    } else {
        84
    }
}

/// Tageskennzahlen des Wochenkalenders: erfasste Ist-Minuten (Vergangenheit
/// und heute) sowie fällige Wiederholungen (heute und Zukunft).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StudyDay {
    pub day: String,
    pub puzzle_attempts: i64,
    pub puzzle_solved: i64,
    pub endgame_attempts: i64,
    pub rep_reviews: i64,
    pub game_reviews: i64,
    /// Tatsächlicher Aufwand nach genau derselben Minutenregel wie das
    /// Ist-Budget im Trainingsplan.
    pub actual_minutes: i64,
    /// An diesem Tag fällige Repertoire-Wiederholungen (heute inkl. überfällig
    /// und neuer Karten).
    pub due_reviews: i64,
}

#[derive(Serialize)]
pub struct StudyCalendar {
    pub templates: Vec<StudyTemplate>,
    pub events: Vec<StudyEvent>,
    /// Ein Eintrag je Tag des angefragten Zeitraums (aufsteigend).
    pub days: Vec<StudyDay>,
}

/// Tage seit 1970-01-01 (Howard Hinnants `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// ISO-Tag ("2026-07-25") → Unix-Sekunden des UTC-Tagesbeginns.
fn day_start_ts(day: &str) -> Option<i64> {
    if !valid_day(day) {
        return None;
    }
    let year: i64 = day[0..4].parse().ok()?;
    let month: i64 = day[5..7].parse().ok()?;
    let date: i64 = day[8..10].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&date) {
        return None;
    }
    Some(days_from_civil(year, month, date) * 86_400)
}

/// ISO-Tag aus Unix-Sekunden (UTC), Gegenstück zu `day_start_ts`.
pub fn iso_day(ts: i64) -> String {
    let days = ts.div_euclid(86_400) + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
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
        "SELECT id, title, duration_min, tool, description
         FROM study_templates WHERE id = ?1 AND deleted = 0",
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

/// Kennzahlen eines Kalendertags: erledigte Einheiten und fällige Wiederholungen.
fn study_day(conn: &Connection, day_start: i64, now: i64) -> Result<StudyDay, String> {
    let day_end = day_start + 86_400;
    let today_start = now - now.rem_euclid(86_400);
    let puzzle_attempts = count(
        conn,
        "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
        day_start,
        day_end,
    )?;
    let puzzle_solved = count(
        conn,
        "SELECT COUNT(*) FROM puzzle_attempts WHERE solved = 1 AND ts >= ?1 AND ts < ?2",
        day_start,
        day_end,
    )?;
    let endgame_attempts = count(
        conn,
        "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
        day_start,
        day_end,
    )?;
    let rep_reviews = count(
        conn,
        "SELECT COUNT(*) FROM rep_review_log WHERE ts >= ?1 AND ts < ?2",
        day_start,
        day_end,
    )?;
    let (game_reviews, analysis_centi) = completed_analysis_load(conn, day_start, day_end)?;
    let play_centi = game_load_between(conn, day_start, day_end)?.1;
    let actual_centi = play_centi
        + puzzle_attempts * CENTI_PER_PUZZLE
        + endgame_attempts * CENTI_PER_DRILL
        + rep_reviews * CENTI_PER_REVIEW
        + analysis_centi;
    // my_move-Parität wie in repertoire.rs: Weiß trainiert ungerade Halbzüge.
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    let due_reviews = if day_start < today_start {
        0
    } else if day_start == today_start {
        // Heute: alles Überfällige plus neue Karten.
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts < ?1)"
            ),
            params![day_end],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    } else {
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM rep_nodes
                 WHERE {my_move} AND reps > 0 AND due_ts >= ?1 AND due_ts < ?2"
            ),
            params![day_start, day_end],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
    };
    Ok(StudyDay {
        day: iso_day(day_start),
        puzzle_attempts,
        puzzle_solved,
        endgame_attempts,
        rep_reviews,
        game_reviews,
        actual_minutes: round_centi(actual_centi),
        due_reviews,
    })
}

fn calendar_from_conn(
    conn: &Connection,
    start_day: &str,
    end_day: &str,
    now: i64,
) -> Result<StudyCalendar, String> {
    if !valid_day(start_day) || !valid_day(end_day) || start_day > end_day {
        return Err("Ungültiger Kalenderzeitraum".into());
    }
    let templates = {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, duration_min, tool, description
                 FROM study_templates WHERE deleted = 0 ORDER BY id",
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
                        e.repeat_rule, e.series_key,
                        t.id, t.title, t.duration_min, t.tool, t.description
                 FROM study_events e JOIN study_templates t ON t.id = e.template_id
                 WHERE e.day >= ?1 AND e.day <= ?2
                   AND e.deleted = 0 AND t.deleted = 0
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
                    repeat_rule: r.get(6)?,
                    series_key: r.get(7)?,
                    template: StudyTemplate {
                        id: r.get(8)?,
                        title: r.get(9)?,
                        duration_min: r.get(10)?,
                        tool: r.get(11)?,
                        description: r.get(12)?,
                    },
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    // Tageskennzahlen: höchstens 42 Tage (Wochen- und Monatsansicht).
    let (Some(first), Some(last)) = (day_start_ts(start_day), day_start_ts(end_day)) else {
        return Err("Ungültiger Kalenderzeitraum".into());
    };
    let mut days = Vec::new();
    let mut cursor = first;
    while cursor <= last && days.len() < 42 {
        days.push(study_day(conn, cursor, now)?);
        cursor += 86_400;
    }
    Ok(StudyCalendar {
        templates,
        events,
        days,
    })
}

#[tauri::command]
pub fn study_calendar(
    db: State<db::Db>,
    start_day: String,
    end_day: String,
) -> Result<StudyCalendar, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    calendar_from_conn(&conn, &start_day, &end_day, now_ts())
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
                    description=?4, updated_ts=?5, deleted=0 WHERE id=?6",
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
             (sync_key, title, duration_min, tool, description, created_ts, updated_ts)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?5)",
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
    let now = now_ts();
    conn.execute(
        "UPDATE study_events SET deleted = 1, updated_ts = ?2 WHERE template_id = ?1",
        params![template_id, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE study_templates SET deleted = 1, updated_ts = ?2 WHERE id = ?1",
        params![template_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Termine einer Serie ab `first_day`: der erste Tag plus jeder weitere im
/// Raster, bis `until` erreicht ist. Ohne Raster bleibt es bei einem Termin.
fn series_days(first_day: &str, rule: &str, until: Option<&str>) -> Result<Vec<String>, String> {
    let Some(start) = day_start_ts(first_day) else {
        return Err("Ungültiges Datum".into());
    };
    let Some(step) = repeat_step(rule) else {
        return Ok(vec![first_day.to_string()]);
    };
    let end = match until {
        Some(value) if !value.is_empty() => {
            day_start_ts(value).ok_or_else(|| "Ungültiges Enddatum".to_string())?
        }
        _ => start + default_horizon(rule) * 86_400,
    };
    if end < start {
        return Err("Das Enddatum liegt vor dem Starttermin".into());
    }
    let mut days = Vec::new();
    let mut cursor = start;
    while cursor <= end && days.len() < MAX_OCCURRENCES {
        days.push(iso_day(cursor));
        cursor += step * 86_400;
    }
    Ok(days)
}

/// Legt für jeden Tag einen Termin an; alle teilen `series_key` und Raster.
fn insert_units(
    conn: &Connection,
    template_id: i64,
    days: &[String],
    rule: &str,
    series_key: &str,
) -> Result<usize, String> {
    let now = now_ts();
    for day in days {
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM study_events WHERE day = ?1",
                params![day],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO study_events
             (sync_key, template_id, day, position, created_ts, updated_ts,
              repeat_rule, series_key)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?4, ?5, ?6)",
            params![template_id, day, position, now, rule, series_key],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(days.len())
}

#[tauri::command]
pub fn schedule_study_unit(
    db: State<db::Db>,
    template_id: i64,
    day: String,
    repeat_rule: Option<String>,
    until: Option<String>,
) -> Result<usize, String> {
    if !valid_day(&day) {
        return Err("Ungültiges Datum".into());
    }
    let rule = repeat_rule.unwrap_or_default();
    if !rule.is_empty() && repeat_step(&rule).is_none() {
        return Err("Unbekanntes Wiederholungsraster".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    read_template(&conn, template_id)?;
    let days = series_days(&day, &rule, until.as_deref())?;
    let series_key = if rule.is_empty() {
        String::new()
    } else {
        new_series_key(&conn)?
    };
    insert_units(&conn, template_id, &days, &rule, &series_key)
}

/// Zufälliger Serienschlüssel · dieselbe Quelle wie die sync_keys.
fn new_series_key(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Macht aus einem geplanten Einzeltermin eine Serie: der Termin selbst bleibt
/// stehen und bekommt das Raster, die weiteren Termine kommen dazu. Gehört er
/// schon zu einer Serie, wird deren Zukunft ab diesem Tag neu gesetzt · so
/// bleibt Abgehaktes in der Vergangenheit unberührt.
#[tauri::command]
pub fn repeat_study_unit(
    db: State<db::Db>,
    event_id: i64,
    repeat_rule: String,
    until: Option<String>,
) -> Result<usize, String> {
    if repeat_step(&repeat_rule).is_none() {
        return Err("Unbekanntes Wiederholungsraster".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let (template_id, day, series_key): (i64, String, String) = conn
        .query_row(
            "SELECT template_id, day, series_key FROM study_events
             WHERE id = ?1 AND deleted = 0",
            params![event_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Geplante Einheit nicht gefunden".to_string())?;
    let now = now_ts();
    let series_key = if series_key.is_empty() {
        new_series_key(&conn)?
    } else {
        // Bestehende Serie: alles ab diesem Tag weicht der neuen Reihe.
        conn.execute(
            "UPDATE study_events SET deleted = 1, updated_ts = ?3
             WHERE series_key = ?1 AND day > ?2 AND deleted = 0",
            params![series_key, day, now],
        )
        .map_err(|e| e.to_string())?;
        series_key
    };
    let days = series_days(&day, &repeat_rule, until.as_deref())?;
    conn.execute(
        "UPDATE study_events SET repeat_rule = ?1, series_key = ?2, updated_ts = ?3
         WHERE id = ?4",
        params![repeat_rule, series_key, now, event_id],
    )
    .map_err(|e| e.to_string())?;
    // Der erste Tag der Reihe ist der Termin selbst · er wird nicht doppelt angelegt.
    insert_units(&conn, template_id, &days[1..], &repeat_rule, &series_key)
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
            "UPDATE study_events SET day = ?1, position = ?2, updated_ts = ?3
             WHERE id = ?4 AND deleted = 0",
            params![day, position.max(0), now_ts(), event_id],
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
        "UPDATE study_events
         SET completed = ?1, completed_ts = ?2, updated_ts = ?3
         WHERE id = ?4 AND deleted = 0",
        params![
            completed,
            if completed { now_ts() } else { 0 },
            now_ts(),
            event_id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Löscht eine geplante Einheit. `scope = "series"` löscht stattdessen diesen
/// und alle folgenden Termine derselben Serie · vergangene Termine bleiben, weil
/// dort schon abgehakt sein kann, was passiert ist.
#[tauri::command]
pub fn delete_study_unit(
    db: State<db::Db>,
    event_id: i64,
    scope: Option<String>,
) -> Result<usize, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = now_ts();
    if scope.as_deref() == Some("series") {
        let series: Option<(String, String)> = conn
            .query_row(
                "SELECT series_key, day FROM study_events WHERE id = ?1",
                params![event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((key, day)) = series.filter(|(key, _)| !key.is_empty()) {
            return conn
                .execute(
                    "UPDATE study_events SET deleted = 1, updated_ts = ?3
                     WHERE series_key = ?1 AND day >= ?2 AND deleted = 0",
                    params![key, day, now],
                )
                .map_err(|e| e.to_string());
        }
    }
    conn.execute(
        "UPDATE study_events SET deleted = 1, updated_ts = ?2 WHERE id = ?1",
        params![event_id, now],
    )
    .map_err(|e| e.to_string())
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
        .query_row(
            "SELECT COUNT(*) FROM games
             WHERE analyzed = 0 AND analysis_excluded = 0 AND TRIM(moves) != ''",
            [],
            |r| r.get(0),
        )
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
            puzzle_solved: count(
                conn,
                "SELECT COUNT(*) FROM puzzle_attempts WHERE solved = 1 AND ts >= ?1 AND ts < ?2",
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
                "SELECT COUNT(*) FROM rep_review_log WHERE ts >= ?1 AND ts < ?2",
                lo,
                hi,
            )?,
            game_reviews: completed_analysis_load(conn, lo, hi)?.0,
        });
    }

    // ── Streak: zusammenhängende Tage mit irgendeiner Lernaktivität ─────────
    let mut days: BTreeSet<i64> = BTreeSet::new();
    for sql in [
        "SELECT DISTINCT ts / 86400 FROM puzzle_attempts",
        "SELECT DISTINCT ts / 86400 FROM endgame_attempts",
        "SELECT DISTINCT ts / 86400 FROM rep_review_log",
        "SELECT DISTINCT e.completed_ts / 86400
           FROM study_events e JOIN study_templates t ON t.id = e.template_id
          WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
            AND (LOWER(t.tool) LIKE '%analys%' OR LOWER(t.title) LIKE '%analys%')",
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

// ── Trainingsprogramm: Fokus, Ist-Aufwand, Trainingslast ────────────────────
//
// Gespeichert wird nur die *Absicht* (welcher Fokus, ab wann, mit welchem
// Ziel). Jede Kennzahl dazu wird aus den Rohdaten neu gerechnet · siehe die
// Begründung an der Migration in `db.rs`.

/// Trainingsbereiche. Dieselben Schlüssel benutzt `lib/plan.ts`.
pub const AREAS: [&str; 5] = ["play", "tactics", "openings", "endgames", "analysis"];

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct StudyFocus {
    pub id: i64,
    /// play | tactics | openings | endgames | analysis
    pub area: String,
    /// Kennzahl, an der die Wirkung gemessen wird (Schlüssel aus `effect.ts`).
    pub metric_key: String,
    /// JSON mit den Parametern für die Beschriftung (Motiv, Eröffnung, …).
    pub label_params: String,
    pub target: Option<f64>,
    pub cycle_days: i64,
    pub start_ts: i64,
    /// 0, solange der Zyklus läuft.
    pub end_ts: i64,
    /// active | done | dropped
    pub status: String,
}

#[derive(Deserialize)]
pub struct StudyFocusInput {
    pub id: Option<i64>,
    pub area: String,
    pub metric_key: String,
    pub label_params: Option<String>,
    pub target: Option<f64>,
    pub cycle_days: Option<i64>,
}

fn read_focus_rows(conn: &Connection, only_active: bool) -> Result<Vec<StudyFocus>, String> {
    let sql = if only_active {
        "SELECT id, area, metric_key, label_params, target, cycle_days, start_ts, end_ts, status
         FROM study_focus WHERE deleted = 0 AND status = 'active' ORDER BY start_ts, id"
    } else {
        "SELECT id, area, metric_key, label_params, target, cycle_days, start_ts, end_ts, status
         FROM study_focus WHERE deleted = 0 ORDER BY start_ts DESC, id DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(StudyFocus {
                id: r.get(0)?,
                area: r.get(1)?,
                metric_key: r.get(2)?,
                label_params: r.get(3)?,
                target: r.get(4)?,
                cycle_days: r.get(5)?,
                start_ts: r.get(6)?,
                end_ts: r.get(7)?,
                status: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Startet einen Fokus-Zyklus (oder ändert einen laufenden).
///
/// Ein neuer Fokus im selben Bereich beendet den bisherigen · zwei gleichzeitige
/// Ziele für dieselbe Sache wären nicht auswertbar.
#[tauri::command]
pub fn set_study_focus(db: State<db::Db>, focus: StudyFocusInput) -> Result<StudyFocus, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    set_focus_on_conn(&conn, focus, now_ts())
}

fn set_focus_on_conn(
    conn: &Connection,
    focus: StudyFocusInput,
    now: i64,
) -> Result<StudyFocus, String> {
    if !AREAS.contains(&focus.area.as_str()) {
        return Err("Unbekannter Trainingsbereich".into());
    }
    let metric = clean_text(focus.metric_key, 60);
    if metric.is_empty() {
        return Err("Kennzahl fehlt".into());
    }
    let params = clean_text(focus.label_params.unwrap_or_default(), 1_000);
    let params = if params.is_empty() {
        "{}".to_string()
    } else {
        params
    };
    let cycle = match focus.cycle_days.unwrap_or(14) {
        7 => 7,
        28 => 28,
        _ => 14,
    };

    let id = match focus.id {
        Some(id) => {
            let changed = conn
                .execute(
                    "UPDATE study_focus SET area=?1, metric_key=?2, label_params=?3, target=?4,
                        cycle_days=?5, updated_ts=?6, deleted=0 WHERE id=?7",
                    params![focus.area, metric, params, focus.target, cycle, now, id],
                )
                .map_err(|e| e.to_string())?;
            if changed == 0 {
                return Err("Fokus nicht gefunden".into());
            }
            id
        }
        None => {
            conn.execute(
                "UPDATE study_focus SET status='dropped', end_ts=?2, updated_ts=?2
                 WHERE area=?1 AND status='active' AND deleted=0",
                params![focus.area, now],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO study_focus
                 (sync_key, area, metric_key, label_params, target, cycle_days, start_ts,
                  status, created_ts, updated_ts)
                 VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, 'active', ?6, ?6)",
                params![focus.area, metric, params, focus.target, cycle, now],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };
    read_focus_rows(conn, false)?
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| "Fokus nicht gefunden".to_string())
}

/// Beendet einen Zyklus: "done" (Ziel erreicht bzw. abgehakt) oder "dropped".
#[tauri::command]
pub fn close_study_focus(db: State<db::Db>, focus_id: i64, status: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let status = match status.as_str() {
        "done" => "done",
        _ => "dropped",
    };
    let now = now_ts();
    let changed = conn
        .execute(
            "UPDATE study_focus SET status=?2, end_ts=?3, updated_ts=?3 WHERE id=?1 AND deleted=0",
            params![focus_id, status, now],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Fokus nicht gefunden".into());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_study_focus(db: State<db::Db>, focus_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE study_focus SET deleted = 1, updated_ts = ?2 WHERE id = ?1",
        params![focus_id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Aufwand eines Bereichs in einem Zeitraum · Minuten sind geschätzt, damit
/// Puzzles, Drills, Wiederholungen und Partien überhaupt vergleichbar werden.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct AreaLoad {
    pub area: String,
    /// Rohzähler (Puzzleversuche, Drills, Wiederholungen, Partien, Analysen).
    pub items: i64,
    pub minutes: i64,
}

/// Ein Tag der Trainingslast · Grundlage der Verlaufsdarstellung.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct LoadDay {
    pub day_ts: i64,
    pub play: i64,
    pub tactics: i64,
    pub openings: i64,
    pub endgames: i64,
    pub analysis: i64,
}

#[derive(Serialize, Default)]
pub struct TrainingProgram {
    pub focuses: Vec<StudyFocus>,
    pub history: Vec<StudyFocus>,
    /// Ist-Aufwand der letzten 28 Tage je Bereich.
    pub load_28d: Vec<AreaLoad>,
    /// Tageslast (Minuten) über das angefragte Fenster, aufsteigend.
    pub days: Vec<LoadDay>,
    /// Aus der Historie abgeleitetes Wochenbudget in Minuten (Median-nah:
    /// Durchschnitt der letzten acht Wochen).
    pub observed_weekly_minutes: i64,
}

/// Aufwandsschätzung in Hundertstelminuten. Kalender und Ist-Budget benutzen
/// dieselben Konstanten; gerundet wird erst nach dem Summieren.
const CENTI_PER_PUZZLE: i64 = 150;
const CENTI_PER_DRILL: i64 = 400;
const CENTI_PER_REVIEW: i64 = 50;

fn round_centi(value: i64) -> i64 {
    ((value.max(0) as f64) / 100.0).round() as i64
}

/// Spielminuten einer Partie aus ihrer Zeitkontrolle ("300+3"), sonst nach
/// Zeitklasse geschätzt. Beide Seiten zusammen, gedeckelt · eine Fernpartie
/// über zwei Wochen ist keine zweiwöchige Trainingseinheit.
fn game_minutes(time_control: &str, time_class: &str, moves_count: i64) -> f64 {
    // Bei Fernpartien verteilt sich die Arbeit über Tage; der Endzeitpunkt und
    // die mehrtägige Nominaluhr taugen nicht als Trainingsdauer. Eine erfundene
    // 180-Minuten-Buchung wäre schlechter als keine Schätzung.
    if matches!(time_class, "daily" | "correspondence") {
        return 0.0;
    }
    let base = time_control
        .split_once('+')
        .and_then(|(base, inc)| {
            let base: f64 = base.trim().parse().ok()?;
            let inc: f64 = inc.trim().parse().ok()?;
            Some(base + inc * moves_count.clamp(0, 120) as f64 / 2.0)
        })
        .or_else(|| time_control.trim().parse::<f64>().ok());
    let seconds = match base {
        Some(seconds) => seconds,
        None => match time_class {
            "bullet" => 120.0,
            "blitz" => 400.0,
            "rapid" => 900.0,
            "classical" => 2_400.0,
            _ => 600.0,
        },
    };
    // Partien enden selten mit leerer Uhr; zwei Drittel der Nominalzeit ist
    // eine ehrlichere Schätzung als die volle Bedenkzeit.
    (seconds * 2.0 / 3.0 / 60.0).clamp(1.0, 180.0)
}

/// Live-Partien und ihre geschätzte eigene Spielzeit im Zeitraum.
fn game_load_between(conn: &Connection, from: i64, to: i64) -> Result<(i64, i64), String> {
    let mut stmt = conn
        .prepare(
            "SELECT time_control, time_class, moves_count
               FROM games
              WHERE played_ts >= ?1 AND played_ts < ?2 AND analysis_excluded = 0
                AND time_class NOT IN ('daily', 'correspondence')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut items = 0;
    let mut centi = 0;
    for row in rows {
        let (control, class, moves) = row.map_err(|e| e.to_string())?;
        items += 1;
        centi += (game_minutes(&control, &class, moves) * 100.0).round() as i64;
    }
    Ok((items, centi))
}

/// Nur bewusst abgehakte Analyse-Termine sind reale Lernzeit. Das bloße
/// Fertigwerden der Engine ist Rechenarbeit und darf kein Ist-Budget erzeugen.
fn completed_analysis_load(conn: &Connection, from: i64, to: i64) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(t.duration_min), 0) * 100
           FROM study_events e JOIN study_templates t ON t.id = e.template_id
          WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
            AND e.completed_ts >= ?1 AND e.completed_ts < ?2
            AND (LOWER(t.tool) LIKE '%analys%' OR LOWER(t.title) LIKE '%analys%')",
        params![from, to],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .map_err(|e| e.to_string())
}

fn day_bucket(ts: i64) -> i64 {
    ts.div_euclid(86_400) * 86_400
}

#[tauri::command]
pub fn training_program(db: State<db::Db>, days: Option<i64>) -> Result<TrainingProgram, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    training_program_from_conn(&conn, now_ts(), days.unwrap_or(180).clamp(28, 730))
}

fn training_program_from_conn(
    conn: &Connection,
    now: i64,
    window_days: i64,
) -> Result<TrainingProgram, String> {
    let today = day_bucket(now);
    let from = today - (window_days - 1) * 86_400;
    let mut by_day: BTreeMap<i64, LoadDay> = BTreeMap::new();

    // Interne Trainer: ein Zeitstempel je tatsächlichem Versuch/Review.
    for (sql, area) in [
        ("SELECT ts FROM puzzle_attempts WHERE ts >= ?1", "tactics"),
        ("SELECT ts FROM endgame_attempts WHERE ts >= ?1", "endgames"),
        ("SELECT ts FROM rep_review_log WHERE ts >= ?1", "openings"),
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        for ts in rows {
            let day = day_bucket(ts.map_err(|e| e.to_string())?);
            let entry = by_day.entry(day).or_insert(LoadDay {
                day_ts: day,
                ..Default::default()
            });
            match area {
                "tactics" => entry.tactics += CENTI_PER_PUZZLE,
                "endgames" => entry.endgames += CENTI_PER_DRILL,
                _ => entry.openings += CENTI_PER_REVIEW,
            }
        }
    }

    // Analysezeit ist eine bewusste, im Lernkalender abgehakte Sitzung. Eine
    // Engine kann 1.000 Partien im Hintergrund rechnen, ohne dass der Nutzer
    // 1.000 Partie-Reviews absolviert hat.
    {
        let mut stmt = conn
            .prepare(
                "SELECT e.completed_ts, t.duration_min
                   FROM study_events e JOIN study_templates t ON t.id = e.template_id
                  WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
                    AND e.completed_ts >= ?1
                    AND (LOWER(t.tool) LIKE '%analys%' OR LOWER(t.title) LIKE '%analys%')",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, minutes) = row.map_err(|e| e.to_string())?;
            by_day
                .entry(day_bucket(ts))
                .or_insert(LoadDay {
                    day_ts: day_bucket(ts),
                    ..Default::default()
                })
                .analysis += minutes.max(0) * 100;
        }
    }

    // Gespielte Partien: Minuten aus der Zeitkontrolle.
    {
        let mut stmt = conn
            .prepare(
                "SELECT played_ts, time_control, time_class, moves_count
                 FROM games WHERE played_ts >= ?1 AND analysis_excluded = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![from], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, tc, class, moves) = row.map_err(|e| e.to_string())?;
            let day = day_bucket(ts);
            let centi = (game_minutes(&tc, &class, moves) * 100.0).round() as i64;
            if centi > 0 {
                by_day
                    .entry(day)
                    .or_insert(LoadDay {
                        day_ts: day,
                        ..Default::default()
                    })
                    .play += centi;
            }
        }
    }

    // Summen werden aus den ungerundeten Hundertstelminuten gebildet. So geht
    // etwa eine einzelne 30-Sekunden-Repertoirewiederholung nicht an jedem Tag
    // durch Ganzzahldivision verloren.
    let centi_days: Vec<LoadDay> = by_day.into_values().collect();
    let days: Vec<LoadDay> = centi_days
        .iter()
        .map(|d| LoadDay {
            day_ts: d.day_ts,
            play: round_centi(d.play),
            tactics: round_centi(d.tactics),
            openings: round_centi(d.openings),
            endgames: round_centi(d.endgames),
            analysis: round_centi(d.analysis),
        })
        .collect();

    let cutoff_28 = today - 27 * 86_400;
    let recent: Vec<&LoadDay> = centi_days
        .iter()
        .filter(|d| d.day_ts >= cutoff_28)
        .collect();
    let sum =
        |pick: fn(&LoadDay) -> i64| -> i64 { round_centi(recent.iter().map(|d| pick(d)).sum()) };
    let recent_end = now + 86_400;
    let (play_items, _) = game_load_between(conn, cutoff_28, recent_end)?;
    let (analysis_items, _) = completed_analysis_load(conn, cutoff_28, recent_end)?;
    let load_28d = vec![
        AreaLoad {
            area: "play".into(),
            items: play_items,
            minutes: sum(|d| d.play),
        },
        AreaLoad {
            area: "tactics".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.tactics),
        },
        AreaLoad {
            area: "openings".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM rep_review_log WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.openings),
        },
        AreaLoad {
            area: "endgames".into(),
            items: count(
                conn,
                "SELECT COUNT(*) FROM endgame_attempts WHERE ts >= ?1 AND ts < ?2",
                cutoff_28,
                recent_end,
            )?,
            minutes: sum(|d| d.endgames),
        },
        AreaLoad {
            area: "analysis".into(),
            items: analysis_items,
            minutes: sum(|d| d.analysis),
        },
    ];

    // Beobachtetes Wochenbudget aus den letzten acht Wochen · ohne Vorgabe in
    // den Einstellungen plant der Wochenplan damit.
    let cutoff_8w = today - 55 * 86_400;
    let observed_centi: i64 = centi_days
        .iter()
        .filter(|d| d.day_ts >= cutoff_8w)
        .map(|d| d.play + d.tactics + d.openings + d.endgames + d.analysis)
        .sum();

    Ok(TrainingProgram {
        focuses: read_focus_rows(conn, true)?,
        history: read_focus_rows(conn, false)?
            .into_iter()
            .filter(|f| f.status != "active")
            .take(12)
            .collect(),
        load_28d,
        days,
        observed_weekly_minutes: round_centi(observed_centi / 8),
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
            "INSERT INTO games (source, source_id, analyzed, moves)
             VALUES ('manual', 'open', 0, 'e4 e5')",
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
        conn.execute(
            "INSERT INTO rep_review_log (node_id, ts, grade, side, path)
             VALUES (1, ?1, 3, 'white', 'e4')",
            params![(TODAY - 2) * 86_400 + 10],
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
        assert_eq!(data.activity[6].puzzle_solved, 1);
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

        let calendar = calendar_from_conn(&conn, "2026-07-20", "2026-07-26", NOW).unwrap();
        assert!(calendar.templates.iter().any(|t| t.title == "Calculation"));
        assert_eq!(calendar.events.len(), 1);
        assert_eq!(calendar.events[0].template.duration_min, 30);
        assert!(!calendar.events[0].completed);
        assert_eq!(calendar.days.len(), 7);
        assert_eq!(calendar.days[0].day, "2026-07-20");
        assert_eq!(calendar.days[6].day, "2026-07-26");
    }

    #[test]
    fn series_days_follow_the_chosen_grid_and_stay_bounded() {
        assert_eq!(
            series_days("2026-07-27", "weekly", Some("2026-08-17")).unwrap(),
            vec![
                "2026-07-27".to_string(),
                "2026-08-03".into(),
                "2026-08-10".into(),
                "2026-08-17".into()
            ]
        );
        assert_eq!(
            series_days("2026-07-27", "biweekly", Some("2026-08-24")).unwrap(),
            vec![
                "2026-07-27".to_string(),
                "2026-08-10".into(),
                "2026-08-24".into()
            ]
        );
        // Ohne Raster bleibt es ein Einzeltermin, egal welches Enddatum.
        assert_eq!(
            series_days("2026-07-27", "", Some("2027-07-27")).unwrap(),
            vec!["2026-07-27".to_string()]
        );
        // Der Standardhorizont greift ohne Enddatum, die Obergrenze bei einem
        // absurd weit entfernten.
        assert_eq!(series_days("2026-07-27", "weekly", None).unwrap().len(), 13);
        assert_eq!(
            series_days("2026-07-27", "daily", Some("2030-01-01"))
                .unwrap()
                .len(),
            MAX_OCCURRENCES
        );
        assert!(series_days("2026-07-27", "weekly", Some("2026-07-20")).is_err());
        assert!(series_days("27.07.2026", "weekly", None).is_err());
    }

    #[test]
    fn a_planned_unit_becomes_a_series_and_can_be_ended_again() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let template_id: i64 = conn
            .query_row(
                "SELECT id FROM study_templates ORDER BY id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();

        let key = new_series_key(&conn).unwrap();
        let days = series_days("2026-07-27", "weekly", Some("2026-08-17")).unwrap();
        assert_eq!(
            insert_units(&conn, template_id, &days, "weekly", &key).unwrap(),
            4
        );

        let calendar = calendar_from_conn(&conn, "2026-07-27", "2026-08-17", NOW).unwrap();
        assert_eq!(calendar.events.len(), 4);
        assert!(calendar
            .events
            .iter()
            .all(|event| event.repeat_rule == "weekly" && event.series_key == key));

        // Serie ab dem zweiten Termin beenden: davor bleibt sie stehen.
        let second = calendar.events[1].id;
        let now = now_ts();
        let removed = conn
            .execute(
                "UPDATE study_events SET deleted = 1, updated_ts = ?3
                 WHERE series_key = ?1 AND day >= ?2 AND deleted = 0",
                params![key, calendar.events[1].day, now],
            )
            .unwrap();
        assert_eq!(removed, 3, "der zweite Termin und alle danach");
        assert!(second > 0);
        let left = calendar_from_conn(&conn, "2026-07-27", "2026-08-17", NOW).unwrap();
        assert_eq!(left.events.len(), 1);
        assert_eq!(left.events[0].day, "2026-07-27");
    }

    #[test]
    fn validates_calendar_days() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        assert!(calendar_from_conn(&conn, "22.07.2026", "2026-07-26", NOW).is_err());
        assert!(calendar_from_conn(&conn, "2026-07-27", "2026-07-26", NOW).is_err());
    }

    #[test]
    fn iso_days_round_trip_and_match_day_starts() {
        for day in ["1970-01-01", "2026-02-28", "2024-02-29", "2026-12-31"] {
            let ts = day_start_ts(day).unwrap();
            assert_eq!(ts % 86_400, 0);
            assert_eq!(iso_day(ts), day);
        }
        assert!(day_start_ts("2026-13-01").is_none());
    }

    #[test]
    fn calendar_days_use_the_same_minutes_as_the_real_budget() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let today = iso_day(NOW);
        let day_start = TODAY * 86_400;

        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('p', ?1, 1, 1500, 1512, 'fork')",
            params![day_start + 60],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after, themes)
             VALUES ('q', ?1, 0, 1512, 1500, 'pin')",
            params![day_start + 120],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games (source, source_id, analyzed, analyzed_ts)
             VALUES ('manual', 'reviewed', 1, ?1)",
            params![day_start + 180],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (parent_id, side, san, fen_key, depth, reps, due_ts, last_ts)
             VALUES (0, 'white', 'e4', 'fen-e4', 1, 0, 0, 0)",
            [],
        )
        .unwrap();

        // Ein bewusst abgehakter Analyse-Termin zählt mit seiner Dauer; das
        // oben bloß von der Engine analysierte Spiel dagegen nicht.
        let analysis_template: i64 = conn
            .query_row(
                "SELECT id FROM study_templates WHERE title = 'Game + analysis'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        conn.execute(
            "INSERT INTO study_events
             (template_id, day, position, completed, completed_ts)
             VALUES (?1, ?2, 0, 1, ?3)",
            params![analysis_template, today, day_start + 240],
        )
        .unwrap();

        let calendar = calendar_from_conn(&conn, &today, &today, NOW).unwrap();
        let day = &calendar.days[0];
        // Beide Puzzleversuche zählen als investierte Zeit: 2 × 1,5 Minuten,
        // dazu die manuell bestätigte 40-Minuten-Analyse.
        assert_eq!(day.puzzle_attempts, 2);
        assert_eq!(day.puzzle_solved, 1);
        assert_eq!(day.game_reviews, 1);
        assert_eq!(day.actual_minutes, 43);
        // Neue Repertoire-Karten sind heute fällig.
        assert_eq!(day.due_reviews, 1);
    }

    #[test]
    fn a_new_focus_supersedes_the_running_one_in_the_same_area() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        let first = set_focus_on_conn(
            &conn,
            StudyFocusInput {
                id: None,
                area: "tactics".into(),
                metric_key: "blunders_middlegame_per100".into(),
                label_params: None,
                target: Some(2.0),
                cycle_days: Some(14),
            },
            NOW,
        )
        .unwrap();
        assert_eq!(first.status, "active");
        assert_eq!(first.cycle_days, 14);
        assert_eq!(first.label_params, "{}");

        // Zweiter Fokus im selben Bereich · der erste wird beendet, sonst wären
        // zwei Ziele gleichzeitig scharf und keines auswertbar.
        set_focus_on_conn(
            &conn,
            StudyFocusInput {
                id: None,
                area: "tactics".into(),
                metric_key: "puzzle_solve_pct".into(),
                label_params: Some(r#"{"theme":"fork"}"#.into()),
                target: None,
                cycle_days: Some(28),
            },
            NOW + 3_600,
        )
        .unwrap();
        // Ein anderer Bereich bleibt davon unberührt.
        set_focus_on_conn(
            &conn,
            StudyFocusInput {
                id: None,
                area: "endgames".into(),
                metric_key: "acc_endgame".into(),
                label_params: None,
                target: None,
                cycle_days: None,
            },
            NOW + 7_200,
        )
        .unwrap();

        let active = read_focus_rows(&conn, true).unwrap();
        assert_eq!(active.len(), 2);
        assert!(active.iter().any(|f| f.metric_key == "puzzle_solve_pct"));
        assert!(active.iter().any(|f| f.area == "endgames"));
        // Voreinstellung greift bei fehlender Angabe.
        assert_eq!(
            active
                .iter()
                .find(|f| f.area == "endgames")
                .unwrap()
                .cycle_days,
            14
        );

        let program = training_program_from_conn(&conn, NOW + 7_200, 60).unwrap();
        assert_eq!(program.focuses.len(), 2);
        assert_eq!(program.history.len(), 1);
        assert_eq!(program.history[0].status, "dropped");
    }

    #[test]
    fn unknown_areas_and_empty_metrics_are_rejected() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let bad_area = set_focus_on_conn(
            &conn,
            StudyFocusInput {
                id: None,
                area: "vibes".into(),
                metric_key: "score_pct".into(),
                label_params: None,
                target: None,
                cycle_days: None,
            },
            NOW,
        );
        assert!(bad_area.is_err());
        let no_metric = set_focus_on_conn(
            &conn,
            StudyFocusInput {
                id: None,
                area: "play".into(),
                metric_key: "   ".into(),
                label_params: None,
                target: None,
                cycle_days: None,
            },
            NOW,
        );
        assert!(no_metric.is_err());
    }

    #[test]
    fn training_load_splits_minutes_by_area() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let day_start = TODAY * 86_400;

        for offset in 0..4 {
            conn.execute(
                "INSERT INTO puzzle_attempts (puzzle_id, ts, solved, rating_before, rating_after)
                 VALUES ('p', ?1, 1, 1500, 1510)",
                params![day_start + offset * 60],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO endgame_attempts (drill_id, ts, solved, moves) VALUES ('lucena', ?1, 1, 20)",
            params![day_start + 500],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_review_log (node_id, ts, grade, side, path)
             VALUES (1, ?1, 3, 'white', 'e4')",
            params![day_start + 600],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO games
             (source, source_id, played_ts, time_control, time_class, moves_count, analyzed, analyzed_ts)
             VALUES ('lichess', 'g1', ?1, '600+0', 'rapid', 40, 1, ?2)",
            params![day_start + 700, day_start + 800],
        )
        .unwrap();

        let program = training_program_from_conn(&conn, NOW, 28).unwrap();
        let by_area = |area: &str| -> AreaLoad {
            program
                .load_28d
                .iter()
                .find(|l| l.area == area)
                .cloned()
                .unwrap()
        };
        assert_eq!(by_area("tactics").items, 4);
        // 4 × 1,5 Minuten
        assert_eq!(by_area("tactics").minutes, 6);
        assert_eq!(by_area("endgames").items, 1);
        assert_eq!(by_area("endgames").minutes, 4);
        assert_eq!(by_area("openings").items, 1);
        assert_eq!(by_area("openings").minutes, 1);
        assert_eq!(by_area("play").items, 1);
        // 600 s nominal, zwei Drittel davon: 6,67 Minuten, am Ende gerundet.
        assert_eq!(by_area("play").minutes, 7);
        // Das Fertigwerden der Engine ist kein bewusstes Partie-Review.
        assert_eq!(by_area("analysis").items, 0);
        assert_eq!(by_area("analysis").minutes, 0);
        assert_eq!(program.days.len(), 1);
    }

    #[test]
    fn game_minutes_fall_back_to_the_time_class() {
        // Zeitkontrolle mit Inkrement: 300 s + 3 s × 20 Züge = 360 s → 4 min.
        assert_eq!(game_minutes("300+3", "blitz", 40).round(), 4.0);
        // Ohne verwertbare Angabe entscheidet die Klasse.
        assert_eq!(game_minutes("", "bullet", 30).round(), 1.0);
        assert_eq!(game_minutes("-", "rapid", 30).round(), 10.0);
        // Bei einer Fernpartie lässt sich aus Endzeitpunkt und Tagesuhr keine
        // reale Sitzungsdauer ableiten.
        assert_eq!(game_minutes("1209600+0", "daily", 60), 0.0);
    }
}
