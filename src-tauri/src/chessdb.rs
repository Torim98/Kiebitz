//! Optionale chessdb.cn-Integration: Online-Eröffnungsbuch mit Cloud-Evals.
//! Antworten werden lokal gecacht, damit wiederholte Stellungen (Eröffnungen!)
//! keine erneuten Anfragen auslösen.

use crate::{chess, db, settings};
use rusqlite::params;
use serde::Serialize;
use tauri::Manager;

const API: &str = "https://www.chessdb.cn/cdb.php";
/// Cloud-Evals ändern sich langsam — 30 Tage Cache genügen.
const CACHE_TTL_SECS: i64 = 30 * 86_400;

#[derive(Serialize, Clone)]
pub struct ChessDbMove {
    pub uci: String,
    pub san: String,
    /// Centipawns aus Sicht des Spielers am Zug.
    pub score: Option<i32>,
    pub rank: Option<i32>,
    pub winrate: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ChessDbResult {
    /// "ok", "unknown" (Stellung nicht in der Datenbank) o. Ä.
    pub status: String,
    pub moves: Vec<ChessDbMove>,
    pub cached: bool,
}

fn parse_response(json: &str) -> ChessDbResult {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => {
            return ChessDbResult {
                status: "invalid".into(),
                moves: Vec::new(),
                cached: false,
            }
        }
    };
    let status = value["status"].as_str().unwrap_or("unknown").to_string();
    let moves = value["moves"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|m| ChessDbMove {
                    uci: m["uci"].as_str().unwrap_or("").to_string(),
                    san: m["san"].as_str().unwrap_or("").to_string(),
                    // score kommt je nach Stellung als Zahl oder String.
                    score: m["score"]
                        .as_i64()
                        .map(|v| v as i32)
                        .or_else(|| m["score"].as_str().and_then(|s| s.parse().ok())),
                    rank: m["rank"]
                        .as_i64()
                        .map(|v| v as i32)
                        .or_else(|| m["rank"].as_str().and_then(|s| s.parse().ok())),
                    winrate: m["winrate"].as_str().map(String::from),
                })
                .filter(|m| !m.uci.is_empty())
                .collect()
        })
        .unwrap_or_default();
    ChessDbResult {
        status,
        moves,
        cached: false,
    }
}

/// Fragt chessdb.cn nach den bekannten Zügen einer Stellung (cache-gestützt).
#[tauri::command]
pub fn chessdb_query(
    app: tauri::AppHandle,
    db: tauri::State<db::Db>,
    fen: String,
) -> Result<ChessDbResult, String> {
    let enabled = app
        .state::<settings::SettingsState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .chessdb_enabled;
    if !enabled {
        return Err("ChessDB ist in den Einstellungen deaktiviert.".into());
    }
    let key = chess::normalize_fen(&fen)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // Cache zuerst.
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let hit: Option<String> = conn
            .query_row(
                "SELECT json FROM chessdb_cache WHERE fen_key = ?1 AND ts > ?2",
                params![key, now - CACHE_TTL_SECS],
                |r| r.get(0),
            )
            .ok();
        if let Some(json) = hit {
            let mut result = parse_response(&json);
            result.cached = true;
            return Ok(result);
        }
    }

    // Anfrage ohne gehaltenen DB-Lock (Netzwerk kann dauern).
    let response = ureq::get(API)
        .query("action", "queryall")
        .query("json", "1")
        .query("board", &fen)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("ChessDB nicht erreichbar: {e}"))?;
    let body = response
        .into_string()
        .map_err(|e| format!("ChessDB-Antwort unlesbar: {e}"))?;

    let result = parse_response(&body);
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO chessdb_cache (fen_key, json, ts) VALUES (?1, ?2, ?3)",
            params![key, body, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ok_response() {
        let json = r#"{"status":"ok","moves":[
            {"uci":"e2e4","san":"e4","score":35,"rank":2,"winrate":"52.71"},
            {"uci":"d2d4","san":"d4","score":"28","rank":"2"}]}"#;
        let r = parse_response(json);
        assert_eq!(r.status, "ok");
        assert_eq!(r.moves.len(), 2);
        assert_eq!(r.moves[0].san, "e4");
        assert_eq!(r.moves[0].score, Some(35));
        assert_eq!(r.moves[1].score, Some(28), "String-Scores werden geparst");
    }

    #[test]
    fn parses_unknown_response() {
        let r = parse_response(r#"{"status":"unknown"}"#);
        assert_eq!(r.status, "unknown");
        assert!(r.moves.is_empty());
    }

    #[test]
    fn survives_garbage() {
        let r = parse_response("<html>error</html>");
        assert_eq!(r.status, "invalid");
    }
}
