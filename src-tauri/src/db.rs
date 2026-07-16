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
    /// Unix-Sekunden des Partie-Endes (für Heatmaps nach Uhrzeit).
    #[serde(default)]
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
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
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
        CREATE INDEX IF NOT EXISTS idx_games_played_at ON games(played_at DESC);

        -- v3: Auto-Analyse — ein Eintrag pro gespieltem Halbzug
        CREATE TABLE IF NOT EXISTS move_evals (
            game_id  INTEGER NOT NULL,
            ply      INTEGER NOT NULL,          -- 1-basiert
            san      TEXT NOT NULL DEFAULT '',
            eval_cp  INTEGER,                   -- nach dem Zug, aus Weiß-Sicht
            mate_in  INTEGER,                   -- gesetzt statt eval_cp bei Matt
            best_uci TEXT NOT NULL DEFAULT '',  -- Engine-Empfehlung vor dem Zug
            judgment TEXT NOT NULL DEFAULT '',  -- '', inaccuracy, mistake, blunder
            phase    TEXT NOT NULL DEFAULT '',  -- opening, middlegame, endgame
            PRIMARY KEY (game_id, ply)
        );

        -- v3: Positionsindex für die Stellungssuche
        CREATE TABLE IF NOT EXISTS positions (
            fen_key TEXT NOT NULL,
            game_id INTEGER NOT NULL,
            ply     INTEGER NOT NULL,           -- Stellung nach `ply` Halbzügen
            PRIMARY KEY (fen_key, game_id, ply)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_positions_game ON positions(game_id);

        -- v3: Eval-Cache über Partien hinweg (Eröffnungen wiederholen sich)
        CREATE TABLE IF NOT EXISTS eval_cache (
            fen_key  TEXT PRIMARY KEY,
            eval_cp  INTEGER,                   -- aus Sicht des Spielers am Zug
            mate_in  INTEGER,
            best_uci TEXT NOT NULL DEFAULT '',
            depth    INTEGER NOT NULL DEFAULT 0
        );

        -- v3: Eröffnungs-Repertoire als Zugbaum mit FSRS-Lernzustand
        CREATE TABLE IF NOT EXISTS rep_nodes (
            id         INTEGER PRIMARY KEY,
            parent_id  INTEGER NOT NULL DEFAULT 0,  -- 0 = Wurzel
            side       TEXT NOT NULL,               -- white | black
            san        TEXT NOT NULL,
            name       TEXT NOT NULL DEFAULT '',
            fen_key    TEXT NOT NULL,
            depth      INTEGER NOT NULL,            -- Halbzug des Zuges (1-basiert)
            stability  REAL NOT NULL DEFAULT 0,
            difficulty REAL NOT NULL DEFAULT 0,
            reps       INTEGER NOT NULL DEFAULT 0,
            lapses     INTEGER NOT NULL DEFAULT 0,
            due_ts     INTEGER NOT NULL DEFAULT 0,
            last_ts    INTEGER NOT NULL DEFAULT 0,
            UNIQUE(side, parent_id, san)
        );
        CREATE INDEX IF NOT EXISTS idx_rep_fen ON rep_nodes(fen_key);

        -- v3: Lichess-Puzzle-Datenbank (lokal importiert)
        CREATE TABLE IF NOT EXISTS puzzles (
            id           TEXT PRIMARY KEY,
            fen          TEXT NOT NULL,
            moves        TEXT NOT NULL,          -- UCI, erster Zug ist der Gegnerzug
            rating       INTEGER NOT NULL,
            rd           INTEGER NOT NULL DEFAULT 0,
            popularity   INTEGER NOT NULL DEFAULT 0,
            nb_plays     INTEGER NOT NULL DEFAULT 0,
            themes       TEXT NOT NULL DEFAULT '',
            opening_tags TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles(rating);

        CREATE TABLE IF NOT EXISTS puzzle_attempts (
            id            INTEGER PRIMARY KEY,
            puzzle_id     TEXT NOT NULL,
            ts            INTEGER NOT NULL,
            solved        INTEGER NOT NULL,
            rating_before INTEGER NOT NULL,
            rating_after  INTEGER NOT NULL,
            themes        TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- v4: Cache für chessdb.cn-Antworten (Cloud-Eröffnungsbuch)
        CREATE TABLE IF NOT EXISTS chessdb_cache (
            fen_key TEXT PRIMARY KEY,
            json    TEXT NOT NULL,
            ts      INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("Schema-Init fehlgeschlagen: {e}"))?;

    // Migration v2: Zeitstempel-Spalte. Schlägt fehl, wenn sie schon existiert — ok.
    let _ = conn.execute(
        "ALTER TABLE games ADD COLUMN played_ts INTEGER NOT NULL DEFAULT 0",
        [],
    );
    Ok(())
}

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0))
        .ok()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct DbStats {
    pub total: i64,
}

pub fn stats(conn: &Connection) -> Result<DbStats, String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbStats { total })
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
                "INSERT INTO games (source, source_id, url, played_at, played_ts, time_class, color,
                    opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy, moves)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
                 ON CONFLICT(source, source_id) DO UPDATE SET
                    url = excluded.url,
                    played_at = excluded.played_at,
                    played_ts = excluded.played_ts,
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
                    g.played_ts,
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
            "SELECT id, source, source_id, url, played_at, played_ts, time_class, color, opponent,
                    opp_elo, my_elo, result, opening, eco, moves_count, accuracy, moves,
                    note, analyzed
             FROM games ORDER BY played_ts DESC, played_at DESC, id DESC",
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
                moves: r.get(16)?,
                note: r.get(17)?,
                analyzed: r.get::<_, i64>(18)? != 0,
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
            played_ts: 1_783_769_082,
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
