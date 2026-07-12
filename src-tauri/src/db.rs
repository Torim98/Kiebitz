//! SQLite-Persistenz: die lokale Partien-Datenbank.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GameRecord {
    pub id: Option<i64>,
    pub source: String,
    pub source_id: String,
    pub url: String,
    pub played_at: String,
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
    pub moves: String,
    pub note: String,
    pub analyzed: bool,
}

#[derive(Serialize)]
pub struct UpsertResult {
    pub inserted: usize,
    pub total: i64,
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS games (
            id          INTEGER PRIMARY KEY,
            source      TEXT NOT NULL,
            source_id   TEXT NOT NULL,
            url         TEXT NOT NULL DEFAULT '',
            played_at   TEXT NOT NULL DEFAULT '',
            time_class  TEXT NOT NULL DEFAULT '',
            color       TEXT NOT NULL DEFAULT '',
            opponent    TEXT NOT NULL DEFAULT '',
            opp_elo     INTEGER NOT NULL DEFAULT 0,
            my_elo      INTEGER NOT NULL DEFAULT 0,
            result      TEXT NOT NULL DEFAULT '',
            opening     TEXT NOT NULL DEFAULT '',
            eco         TEXT NOT NULL DEFAULT '',
            moves_count INTEGER NOT NULL DEFAULT 0,
            accuracy    REAL,
            moves       TEXT NOT NULL DEFAULT '',
            note        TEXT NOT NULL DEFAULT '',
            analyzed    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(source, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at DESC);",
    )
    .map_err(|e| format!("Schema-Init fehlgeschlagen: {e}"))
}

/// Fügt Partien ein; bereits vorhandene (source, source_id) werden aktualisiert,
/// ohne Notizen oder den Analyse-Status zu überschreiben.
pub fn upsert_games(conn: &mut Connection, games: &[GameRecord]) -> Result<UpsertResult, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0usize;
    {
        let mut exists_stmt = tx
            .prepare("SELECT 1 FROM games WHERE source = ?1 AND source_id = ?2")
            .map_err(|e| e.to_string())?;
        let mut upsert_stmt = tx
            .prepare(
                "INSERT INTO games (source, source_id, url, played_at, time_class, color,
                    opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy, moves)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(source, source_id) DO UPDATE SET
                    url = excluded.url,
                    played_at = excluded.played_at,
                    accuracy = COALESCE(excluded.accuracy, games.accuracy),
                    moves = excluded.moves,
                    moves_count = excluded.moves_count",
            )
            .map_err(|e| e.to_string())?;

        for g in games {
            let existed = exists_stmt
                .exists(params![g.source, g.source_id])
                .map_err(|e| e.to_string())?;
            upsert_stmt
                .execute(params![
                    g.source,
                    g.source_id,
                    g.url,
                    g.played_at,
                    g.time_class,
                    g.color,
                    g.opponent,
                    g.opp_elo,
                    g.my_elo,
                    g.result,
                    g.opening,
                    g.eco,
                    g.moves_count,
                    g.accuracy,
                    g.moves
                ])
                .map_err(|e| e.to_string())?;
            if !existed {
                inserted += 1;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(UpsertResult { inserted, total })
}

pub fn list_games(conn: &Connection) -> Result<Vec<GameRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, source, source_id, url, played_at, time_class, color, opponent,
                    opp_elo, my_elo, result, opening, eco, moves_count, accuracy, moves,
                    note, analyzed
             FROM games ORDER BY played_at DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(GameRecord {
                id: r.get(0)?,
                source: r.get(1)?,
                source_id: r.get(2)?,
                url: r.get(3)?,
                played_at: r.get(4)?,
                time_class: r.get(5)?,
                color: r.get(6)?,
                opponent: r.get(7)?,
                opp_elo: r.get(8)?,
                my_elo: r.get(9)?,
                result: r.get(10)?,
                opening: r.get(11)?,
                eco: r.get(12)?,
                moves_count: r.get(13)?,
                accuracy: r.get(14)?,
                moves: r.get(15)?,
                note: r.get(16)?,
                analyzed: r.get::<_, i64>(17)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> Result<(), String> {
    conn.execute("UPDATE games SET note = ?1 WHERE id = ?2", params![note, id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(source_id: &str) -> GameRecord {
        GameRecord {
            id: None,
            source: "lichess".into(),
            source_id: source_id.into(),
            url: format!("https://lichess.org/{source_id}"),
            played_at: "2026-07-11".into(),
            time_class: "rapid".into(),
            color: "white".into(),
            opponent: "PagasusFantasy".into(),
            opp_elo: 1203,
            my_elo: 1076,
            result: "loss".into(),
            opening: "Caro-Kann Defense".into(),
            eco: "B10".into(),
            moves_count: 32,
            accuracy: None,
            moves: "e4 c6 Qf3 e5".into(),
            note: String::new(),
            analyzed: false,
        }
    }

    #[test]
    fn upsert_inserts_then_updates_without_touching_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        let r1 = upsert_games(&mut conn, &[sample("abc"), sample("def")]).unwrap();
        assert_eq!(r1.inserted, 2);
        assert_eq!(r1.total, 2);

        let games = list_games(&conn).unwrap();
        let id = games[0].id.unwrap();
        set_note(&conn, id, "Merken: Cb6!").unwrap();

        // Re-Import derselben Partie mit jetzt vorhandener Accuracy
        let mut updated = sample("abc");
        updated.accuracy = Some(84.2);
        let r2 = upsert_games(&mut conn, &[updated, sample("ghi")]).unwrap();
        assert_eq!(r2.inserted, 1, "abc existierte schon, nur ghi ist neu");
        assert_eq!(r2.total, 3);

        let games = list_games(&conn).unwrap();
        let abc = games.iter().find(|g| g.source_id == "abc").unwrap();
        assert_eq!(abc.accuracy, Some(84.2), "Accuracy aktualisiert");
        let noted = games.iter().find(|g| g.id == Some(id)).unwrap();
        assert_eq!(noted.note, "Merken: Cb6!", "Notiz überlebt den Re-Import");
    }
}
