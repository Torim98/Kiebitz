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

#[derive(Default)]
struct DayTotals {
    puzzle_attempts: i64,
    puzzle_solved: i64,
    endgame_attempts: i64,
    rep_reviews: i64,
    game_reviews: i64,
    play_centi: i64,
    analysis_centi: i64,
    /// Gemessene Trainingszeit der vier Trainerseiten, in Hundertstelminuten.
    measured_centi: i64,
    /// Gilt für diesen Tag schon die Messung? Davor zählen die Hochrechnungen.
    measured: bool,
    due_reviews: i64,
}

fn range_index(day: i64, first: i64, len: usize) -> Option<usize> {
    let index = (day - first).div_euclid(86_400);
    (index >= 0 && index < len as i64).then_some(index as usize)
}

/// Aggregates a complete range with a constant number of SQL statements.
fn study_days(conn: &Connection, first: i64, last: i64, now: i64) -> Result<Vec<StudyDay>, String> {
    let len = ((last - first).div_euclid(86_400) + 1).max(0) as usize;
    let end = first + len as i64 * 86_400;
    let mut totals: Vec<DayTotals> = (0..len).map(|_| DayTotals::default()).collect();

    // Gemessene Trainingszeit · dieselbe Quelle wie im Trainingsprogramm,
    // damit Kalender und Budget nie zwei verschiedene Zahlen zeigen.
    let measured_from = measurement_start(conn)?;
    for index in 0..len {
        totals[index].measured = measured_day(measured_from, first + index as i64 * 86_400);
    }
    for ((day, _area), seconds) in measured_seconds(conn, first, end)? {
        if let Some(index) = range_index(day, first, len) {
            totals[index].measured_centi += (seconds as f64 / 60.0 * 100.0).round() as i64;
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT (ts / 86400) * 86400, COUNT(*),
                        COALESCE(SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END), 0)
                   FROM puzzle_attempts WHERE ts >= ?1 AND ts < ?2
                  GROUP BY ts / 86400",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![first, end], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (day, attempts, solved) = row.map_err(|e| e.to_string())?;
            if let Some(index) = range_index(day, first, len) {
                totals[index].puzzle_attempts = attempts;
                totals[index].puzzle_solved = solved;
            }
        }
    }
    for (sql, endgame) in [
        (
            "SELECT (ts / 86400) * 86400, COUNT(*) FROM endgame_attempts
             WHERE ts >= ?1 AND ts < ?2 GROUP BY ts / 86400",
            true,
        ),
        (
            "SELECT (ts / 86400) * 86400, COUNT(*) FROM rep_review_log
             WHERE ts >= ?1 AND ts < ?2 GROUP BY ts / 86400",
            false,
        ),
    ] {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![first, end], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (day, value) = row.map_err(|e| e.to_string())?;
            if let Some(index) = range_index(day, first, len) {
                if endgame {
                    totals[index].endgame_attempts = value;
                } else {
                    totals[index].rep_reviews = value;
                }
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                "SELECT (e.completed_ts / 86400) * 86400, COUNT(*),
                        COALESCE(SUM(t.duration_min), 0) * 100
                   FROM study_events e JOIN study_templates t ON t.id = e.template_id
                  WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
                    AND e.completed_ts >= ?1 AND e.completed_ts < ?2
                    AND (LOWER(t.tool) LIKE '%analys%' OR LOWER(t.title) LIKE '%analys%')
                  GROUP BY e.completed_ts / 86400",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![first, end], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (day, reviews, centi) = row.map_err(|e| e.to_string())?;
            if let Some(index) = range_index(day, first, len) {
                totals[index].game_reviews = reviews;
                totals[index].analysis_centi = centi;
            }
        }
    }
    {
        let mut stmt = conn
            .prepare(
                "SELECT played_ts, clocks, time_control, time_class, moves_count
                   FROM games
                  WHERE played_ts >= ?1 AND played_ts < ?2 AND analysis_excluded = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![first, end], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, clocks, control, class, moves) = row.map_err(|e| e.to_string())?;
            if let Some(index) = range_index(day_bucket(ts), first, len) {
                totals[index].play_centi +=
                    (game_minutes_real(&clocks, &control, &class, moves) * 100.0).round() as i64;
            }
        }
    }

    let today = day_bucket(now);
    let my_move = "((side = 'white' AND depth % 2 = 1) OR (side = 'black' AND depth % 2 = 0))";
    if let Some(index) = range_index(today, first, len) {
        totals[index].due_reviews = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM rep_nodes WHERE {my_move} AND (reps = 0 OR due_ts < ?1)"
                ),
                params![today + 86_400],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
    }
    let future_start = first.max(today + 86_400);
    if future_start < end {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT (due_ts / 86400) * 86400, COUNT(*) FROM rep_nodes
                 WHERE {my_move} AND reps > 0 AND due_ts >= ?1 AND due_ts < ?2
                 GROUP BY due_ts / 86400"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![future_start, end], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (day, due) = row.map_err(|e| e.to_string())?;
            if let Some(index) = range_index(day, first, len) {
                totals[index].due_reviews = due;
            }
        }
    }

    Ok(totals
        .into_iter()
        .enumerate()
        .map(|(index, total)| {
            // Partien zählen immer mit, sie werden aus den Uhren gemessen.
            // Für das Training am Gerät gilt entweder die Messung oder — vor
            // deren Beginn — die alte Hochrechnung, nie beides.
            let training_centi = if total.measured {
                total.measured_centi
            } else {
                total.puzzle_attempts * CENTI_PER_PUZZLE
                    + total.endgame_attempts * CENTI_PER_DRILL
                    + total.rep_reviews * CENTI_PER_REVIEW
                    + total.analysis_centi
            };
            let actual_centi = total.play_centi + training_centi;
            StudyDay {
                day: iso_day(first + index as i64 * 86_400),
                puzzle_attempts: total.puzzle_attempts,
                puzzle_solved: total.puzzle_solved,
                endgame_attempts: total.endgame_attempts,
                rep_reviews: total.rep_reviews,
                game_reviews: total.game_reviews,
                actual_minutes: round_centi(actual_centi),
                due_reviews: total.due_reviews,
            }
        })
        .collect())
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
    let capped_last = last.min(first + 41 * 86_400);
    let days = study_days(conn, first, capped_last, now)?;
    Ok(StudyCalendar {
        templates,
        events,
        days,
    })
}
