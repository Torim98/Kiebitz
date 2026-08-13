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
    let area = if AREAS.contains(&template.area.as_str()) {
        template.area.clone()
    } else {
        String::new()
    };
    let id = if let Some(id) = template.id {
        let changed = conn
            .execute(
                // Ab der ersten Bearbeitung gehört der Text dem Nutzer · der
                // Übersetzungsschlüssel der Startvorlage fällt damit weg, sonst
                // überschriebe die nächste Sprachumstellung seine Formulierung.
                "UPDATE study_templates SET title=?1, duration_min=?2, tool=?3,
                    description=?4, area=?5, i18n_key='', updated_ts=?6, deleted=0
                 WHERE id=?7",
                params![title, duration, tool, description, area, now, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Lerneinheit nicht gefunden".into());
        }
        id
    } else {
        conn.execute(
            "INSERT INTO study_templates
             (sync_key, title, duration_min, tool, description, area, created_ts, updated_ts)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![title, duration, tool, description, area, now],
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
    // One grouped pass covers both the last seven activity days and the next
    // seven due-date buckets (today is the shared middle element).
    let summary_days = study_days(conn, day_start - 6 * 86_400, day_start + 6 * 86_400, now)?;

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

    let due_week: Vec<i64> = summary_days[6..13]
        .iter()
        .map(|day| day.due_reviews)
        .collect();
    // Heute: alles, was bis Tagesende fällig ist (inkl. neuer Karten).

    // ── Backlog & Tagesziel ──────────────────────────────────────────────────
    let unanalyzed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM games
             WHERE analyzed = 0 AND analysis_excluded = 0 AND TRIM(moves) != ''",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let today_puzzle_attempts = summary_days[6].puzzle_attempts;
    // ── Aktivität der letzten 7 Tage ─────────────────────────────────────────
    let activity = summary_days[..7]
        .iter()
        .enumerate()
        .map(|(index, day)| DayActivity {
            day_ts: day_start - (6 - index as i64) * 86_400,
            puzzle_attempts: day.puzzle_attempts,
            puzzle_solved: day.puzzle_solved,
            endgame_attempts: day.endgame_attempts,
            rep_reviews: day.rep_reviews,
            game_reviews: day.game_reviews,
        })
        .collect();

    // ── Streak: zusammenhängende Tage mit irgendeiner Lernaktivität ─────────
    let mut days: BTreeSet<i64> = BTreeSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT ts / 86400 FROM puzzle_attempts
             UNION SELECT ts / 86400 FROM endgame_attempts
             UNION SELECT ts / 86400 FROM rep_review_log
             UNION SELECT e.completed_ts / 86400
               FROM study_events e JOIN study_templates t ON t.id = e.template_id
              WHERE e.completed = 1 AND e.deleted = 0 AND t.deleted = 0
                AND (LOWER(t.tool) LIKE '%analys%' OR LOWER(t.title) LIKE '%analys%')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    for day in rows {
        days.insert(day.map_err(|e| e.to_string())?);
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
