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
    #[serde(default)]
    pub accuracy_opening: Option<f64>,
    #[serde(default)]
    pub accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub accuracy_endgame: Option<f64>,
    pub moves: String,
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
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
        );

        -- v5: Endspiel-Trainer — ein Eintrag pro ausgespieltem Drill-Versuch
        CREATE TABLE IF NOT EXISTS endgame_attempts (
            id       INTEGER PRIMARY KEY,
            drill_id TEXT NOT NULL,               -- ID aus src/data/endgames.ts
            ts       INTEGER NOT NULL,
            solved   INTEGER NOT NULL,
            moves    INTEGER NOT NULL DEFAULT 0   -- Halbzüge bis zum Ende
        );
        CREATE INDEX IF NOT EXISTS idx_endgame_drill ON endgame_attempts(drill_id);",
    )
    .map_err(|e| format!("Schema-Init fehlgeschlagen: {e}"))?;

    // Migration v2: Zeitstempel-Spalte. Schlägt fehl, wenn sie schon existiert — ok.
    let _ = conn.execute(
        "ALTER TABLE games ADD COLUMN played_ts INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // Migration v6 (Sync): Änderungs-Zeitstempel für den Delta-Sync und
    // Last-Write-Wins bei Notizen. DEFAULT 0 = "vor Einführung des Syncs" —
    // der erste Sync (Cursor 0) überträgt damit den kompletten Bestand.
    let _ = conn.execute(
        "ALTER TABLE games ADD COLUMN updated_ts INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE games ADD COLUMN note_ts INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // Migration v8: Phasen-Genauigkeit und frei editierbare Tags.
    for sql in [
        "ALTER TABLE games ADD COLUMN accuracy_opening REAL",
        "ALTER TABLE games ADD COLUMN accuracy_middlegame REAL",
        "ALTER TABLE games ADD COLUMN accuracy_endgame REAL",
        "ALTER TABLE games ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
        "ALTER TABLE games ADD COLUMN tags_ts INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute(sql, []);
    }
    // Migration v7 (Sync-Grenzen): Repertoire-Löschungen propagieren über
    // Tombstones (Löschung gewinnt nur gegen ältere Knoten — created_ts
    // erlaubt das Wieder-Anlegen), und Puzzle-Versuche merken sich das
    // Puzzle-Rating zur Versuchszeit, damit die Elo-Kette nach einem Merge
    // deterministisch neu berechnet werden kann.
    let _ = conn.execute(
        "ALTER TABLE rep_nodes ADD COLUMN created_ts INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE puzzle_attempts ADD COLUMN puzzle_rating INTEGER NOT NULL DEFAULT 0",
        [],
    );
    // Migration v9: Herkunft eigener Puzzles sowie persistenter Studienkalender.
    for sql in [
        "ALTER TABLE puzzles ADD COLUMN source TEXT NOT NULL DEFAULT 'lichess'",
        "ALTER TABLE puzzles ADD COLUMN source_game_id INTEGER",
        "ALTER TABLE puzzles ADD COLUMN source_ply INTEGER",
        "ALTER TABLE puzzles ADD COLUMN setup_plies INTEGER NOT NULL DEFAULT 1",
    ] {
        let _ = conn.execute(sql, []);
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_puzzles_source ON puzzles(source);
         CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_puzzle
           ON puzzle_attempts(puzzle_id, solved);

         CREATE TABLE IF NOT EXISTS study_templates (
            id           INTEGER PRIMARY KEY,
            title        TEXT NOT NULL,
            duration_min INTEGER NOT NULL DEFAULT 20,
            tool         TEXT NOT NULL DEFAULT '',
            description  TEXT NOT NULL DEFAULT '',
            created_ts   INTEGER NOT NULL DEFAULT 0,
            updated_ts   INTEGER NOT NULL DEFAULT 0
         );

         CREATE TABLE IF NOT EXISTS study_events (
            id           INTEGER PRIMARY KEY,
            template_id  INTEGER NOT NULL,
            day          TEXT NOT NULL,
            position     INTEGER NOT NULL DEFAULT 0,
            completed    INTEGER NOT NULL DEFAULT 0,
            completed_ts INTEGER NOT NULL DEFAULT 0,
            created_ts   INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_study_events_day ON study_events(day, position, id);",
    )
    .map_err(|e| format!("Kalender-Schema fehlgeschlagen: {e}"))?;

    // Einmalige, danach vollständig editier- und löschbare Startvorlagen.
    if meta_get(conn, "study_templates_seeded").is_none() {
        let now = now_ts();
        for (title, duration, tool, description) in [
            (
                "Eröffnungs-Training",
                20,
                "Kiebitz Repertoire",
                "Wähle eine Eröffnung für Weiß und eine für Schwarz. Lerne die ersten 8–10 Züge und die Ideen dahinter.",
            ),
            (
                "Endspiel-Training",
                20,
                "Kiebitz Endgames",
                "Grundlagen in Reihenfolge: Dame gegen König, Turm gegen König, Bauernendspiele mit Opposition und Quadratregel.",
            ),
            (
                "Taktik",
                20,
                "Kiebitz Puzzles",
                "15–20 Aufgaben, langsam und korrekt. Fokus: Gabel, Fesselung, Spieß und Abzug.",
            ),
            (
                "Partie + Analyse",
                40,
                "Lichess + Kiebitz Analysis",
                "Eine Rapid-Partie spielen, zuerst selbst prüfen und danach die drei größten Engine-Fehler verstehen.",
            ),
        ] {
            conn.execute(
                "INSERT INTO study_templates
                 (title, duration_min, tool, description, created_ts, updated_ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![title, duration, tool, description, now],
            )
            .map_err(|e| e.to_string())?;
        }
        meta_set(conn, "study_templates_seeded", "1")?;
    }
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS rep_tombstones (
            side       TEXT NOT NULL,
            path       TEXT NOT NULL,
            deleted_ts INTEGER NOT NULL,
            PRIMARY KEY (side, path)
        )",
        [],
    );
    // Backfill: Puzzle-Rating für Alt-Versuche aus der lokalen Puzzle-DB.
    let _ = conn.execute(
        "UPDATE puzzle_attempts
         SET puzzle_rating = COALESCE((SELECT rating FROM puzzles WHERE id = puzzle_id), 0)
         WHERE puzzle_rating = 0",
        [],
    );
    Ok(())
}

/// Unix-Zeit in Sekunden — der gemeinsame Zeitstempel für Sync-Spalten.
pub fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
        r.get(0)
    })
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
                    opponent, opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame, moves,
                    note, note_ts, tags, tags_ts, updated_ts)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
                 ON CONFLICT(source, source_id) DO UPDATE SET
                    url = excluded.url,
                    played_at = excluded.played_at,
                    played_ts = excluded.played_ts,
                    accuracy = COALESCE(excluded.accuracy, games.accuracy),
                    accuracy_opening = COALESCE(excluded.accuracy_opening, games.accuracy_opening),
                    accuracy_middlegame = COALESCE(excluded.accuracy_middlegame, games.accuracy_middlegame),
                    accuracy_endgame = COALESCE(excluded.accuracy_endgame, games.accuracy_endgame),
                    moves = excluded.moves,
                    moves_count = excluded.moves_count,
                    updated_ts = excluded.updated_ts",
            )
            .map_err(|e| e.to_string())?;

        for g in games {
            let existed = exists_stmt
                .exists(params![g.source, g.source_id])
                .map_err(|e| e.to_string())?;
            let changed_at = now_ts();
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
                    g.accuracy_opening,
                    g.accuracy_middlegame,
                    g.accuracy_endgame,
                    g.moves,
                    g.note,
                    if g.note.is_empty() { 0 } else { changed_at },
                    serde_json::to_string(&g.tags).map_err(|e| e.to_string())?,
                    if g.tags.is_empty() { 0 } else { changed_at },
                    changed_at
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
                    opp_elo, my_elo, result, opening, eco, moves_count, accuracy,
                    accuracy_opening, accuracy_middlegame, accuracy_endgame, moves,
                    note, tags, analyzed
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
                accuracy_opening: r.get(16)?,
                accuracy_middlegame: r.get(17)?,
                accuracy_endgame: r.get(18)?,
                moves: r.get(19)?,
                note: r.get(20)?,
                tags: serde_json::from_str(&r.get::<_, String>(21)?).unwrap_or_default(),
                analyzed: r.get::<_, i64>(22)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE games SET note = ?1, note_ts = ?3, updated_ts = ?3 WHERE id = ?2",
        params![note, id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_tags(conn: &Connection, id: i64, tags: &[String]) -> Result<Vec<String>, String> {
    let mut clean: Vec<String> = tags
        .iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();
    clean.sort_by_key(|tag| tag.to_lowercase());
    clean.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());
    clean.truncate(20);
    let json = serde_json::to_string(&clean).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE games SET tags = ?1, tags_ts = ?3, updated_ts = ?3 WHERE id = ?2",
        params![json, id, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(clean)
}

/// Löscht eine Partie samt lokal abgeleiteten Daten. Online-Import oder Sync
/// können dieselbe Partie anhand ihres Natural Keys später erneut einspielen.
pub fn delete_game(conn: &mut Connection, id: i64) -> Result<bool, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM puzzle_attempts
         WHERE puzzle_id IN (
             SELECT id FROM puzzles WHERE source = 'own' AND source_game_id = ?1
         )",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM puzzles WHERE source = 'own' AND source_game_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM move_evals WHERE game_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM positions WHERE game_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let deleted = tx
        .execute("DELETE FROM games WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(deleted > 0)
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
            accuracy_opening: None,
            accuracy_middlegame: None,
            accuracy_endgame: None,
            moves: "e4 c6 Qf3 e5".into(),
            note: String::new(),
            tags: Vec::new(),
            analyzed: false,
        }
    }

    #[test]
    fn upsert_inserts_then_updates_without_touching_notes() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();

        let mut tagged = sample("def");
        tagged.note = "Imported PGN note".into();
        tagged.tags = vec!["OTB".into(), "Club".into()];
        let r1 = upsert_games(&mut conn, &[sample("abc"), tagged]).unwrap();
        assert_eq!(r1.inserted, 2);
        assert_eq!(r1.total, 2);

        let games = list_games(&conn).unwrap();
        let imported = games.iter().find(|g| g.source_id == "def").unwrap();
        assert_eq!(imported.note, "Imported PGN note");
        assert_eq!(imported.tags, vec!["OTB", "Club"]);
        let cleaned = set_tags(
            &conn,
            imported.id.unwrap(),
            &[" club ".into(), "CLUB".into(), "Turnier".into()],
        )
        .unwrap();
        assert_eq!(cleaned, vec!["club", "Turnier"]);
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

    #[test]
    fn delete_game_removes_derived_rows_but_keeps_other_games() {
        let mut conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        upsert_games(&mut conn, &[sample("delete-me"), sample("keep-me")]).unwrap();
        let id = list_games(&conn)
            .unwrap()
            .into_iter()
            .find(|game| game.source_id == "delete-me")
            .and_then(|game| game.id)
            .unwrap();

        conn.execute(
            "INSERT INTO move_evals (game_id, ply) VALUES (?1, 1)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO positions (fen_key, game_id, ply) VALUES ('fen', ?1, 1)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzles
             (id, fen, moves, rating, source, source_game_id, setup_plies)
             VALUES ('own:test', 'fen', 'e2e4', 1200, 'own', ?1, 0)",
            params![id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO puzzle_attempts
             (puzzle_id, ts, solved, rating_before, rating_after)
             VALUES ('own:test', 1, 1, 1200, 1210)",
            [],
        )
        .unwrap();

        assert!(delete_game(&mut conn, id).unwrap());
        assert_eq!(list_games(&conn).unwrap().len(), 1);
        for table in ["move_evals", "positions", "puzzles", "puzzle_attempts"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "derived rows remain in {table}");
        }
        assert!(!delete_game(&mut conn, id).unwrap());
    }
}
