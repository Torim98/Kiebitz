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
