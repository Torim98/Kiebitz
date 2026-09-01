//! Eigene Referenzdatenbank · die große Fremdsammlung neben den eigenen Partien.
//!
//! Wer heute eine Mega Database, Caissabase oder die wöchentliche TWIC-Ausgabe
//! besitzt, hat damit genau das, was Kiebitz bisher fehlte: Millionen fremder
//! Partien als Vergleichsmaßstab. Dieses Modul liest so eine Sammlung ein und
//! macht daraus zweierlei — eine Häufigkeitsstatistik je Stellung (das „Buch")
//! und einen Vorrat an Musterpartien.
//!
//! Drei Entscheidungen, die den Rest erklären:
//!
//! **Eigene Datei.** Die Referenz liegt in `reference.sqlite` neben der
//! `kiebitz.db`, nicht darin. Eine Fremdsammlung kann ein Vielfaches der
//! eigenen Datenbank wiegen; sie hat in einer Datei, die gesichert, gesynct und
//! auf das Handy getragen wird, nichts verloren. Löschen ist so auch nur ein
//! Dateilöschen und kann die eigenen Partien gar nicht erst treffen.
//!
//! **Getrennt von `games`.** Fremdpartien dürfen niemals in die eigene
//! Partientabelle. Sonst zählten vier Millionen fremde Partien in Insights, im
//! Ratingverlauf, in der Analyse-Warteschlange und in den eigenen Puzzles mit ·
//! aus einem Werkzeug für die eigene Entwicklung würde eine Suchmaschine.
//!
//! **Buch statt Archiv.** Für die Frage „was wird hier gespielt?" ist die
//! Partienliste das falsche Format. Der Import verdichtet jede Partie beim
//! Lesen zu Zeilen der Form (Stellung, Zug) → Weiß/Remis/Schwarz, Elo-Schnitt,
//! beste Beispielpartie. Danach ist die Auskunft eine einzige indizierte
//! Abfrage, egal wie groß die Sammlung war.

use crate::{chess, explorer::ExplorerGame, explorer::ExplorerMove, explorer::ExplorerResult};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

/// Bis zu welchem Halbzug eine Partie ins Buch einzahlt.
///
/// Ab hier wird aus Statistik Einzelfall: Eine Stellung im 16. Zug kommt in
/// einer Millionensammlung meist genau einmal vor, und eine Zeile „1 Partie,
/// 100 % Weiß" ist keine Auskunft. Die Grenze hält zugleich die Datenbank
/// klein · sie ist der einzige Hebel, der linear auf Größe und Importdauer
/// wirkt. Die Partien selbst werden vollständig gespeichert, nur das Buch
/// endet hier.
const BOOK_PLIES: usize = 24;

/// Partien je Schreibblock. Innerhalb eines Blocks fasst eine Hashmap gleiche
/// Stellungen zusammen · in der Eröffnung sind das die meisten. Größere Blöcke
/// sparen Schreibarbeit, kosten aber Arbeitsspeicher.
const FLUSH_GAMES: u64 = 4_000;

/// So oft meldet der Import seinen Fortschritt an die Oberfläche.
const PROGRESS_GAMES: u64 = 2_000;

/// Musterpartien je Stellung in der Antwort.
const TOP_GAMES: usize = 6;

#[derive(Default)]
pub struct RefDbState {
    pub importing: AtomicBool,
    pub cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
pub struct RefDbStatus {
    /// Partien in der Referenzdatenbank.
    pub games: i64,
    /// Zeilen im Buch (Stellung + Zug).
    pub positions: i64,
    /// Dateigröße in Bytes.
    pub size_bytes: u64,
    /// Zuletzt eingelesene Datei (Anzeige).
    pub source: String,
    /// Unix-Zeit des letzten Imports.
    pub imported_at: i64,
    pub importing: bool,
    pub path: String,
}

#[derive(Serialize, Clone)]
struct ImportProgress {
    games: u64,
    bytes: u64,
    bytes_total: u64,
    /// "reading" · "finishing"
    phase: String,
}

#[derive(Serialize, Clone)]
struct ImportDone {
    games: u64,
    /// Bestand nach dem Lauf.
    total: i64,
    cancelled: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct RefGame {
    pub id: i64,
    pub white: String,
    pub black: String,
    pub white_elo: i32,
    pub black_elo: i32,
    pub result: String,
    pub played_at: String,
    pub event: String,
    pub eco: String,
    pub moves: String,
}

// ── Datei und Schema ─────────────────────────────────────────────────────────

/// Die Referenzdatei liegt neben der Hauptdatenbank · verlegt der Nutzer die
/// eine, wandert die andere mit.
pub fn ref_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let main = app
        .state::<crate::analysis::DbPath>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let dir = main
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Kein Datenverzeichnis".to_string())?;
    Ok(dir.join("reference.sqlite"))
}

fn open(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "journal_size_limit", 8 * 1024 * 1024);
    let _ = conn.pragma_update(None, "busy_timeout", "10000");
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ref_games (
            id        INTEGER PRIMARY KEY,
            white     TEXT NOT NULL DEFAULT '',
            black     TEXT NOT NULL DEFAULT '',
            white_elo INTEGER NOT NULL DEFAULT 0,
            black_elo INTEGER NOT NULL DEFAULT 0,
            result    TEXT NOT NULL DEFAULT '',
            played_at TEXT NOT NULL DEFAULT '',
            event     TEXT NOT NULL DEFAULT '',
            eco       TEXT NOT NULL DEFAULT '',
            moves     TEXT NOT NULL DEFAULT ''
        );

        -- Das Buch: je Stellung und Zug die Bilanz aus allen Partien, die ihn
        -- gespielt haben. `game_id` zeigt auf die bestbesetzte davon, `best_elo`
        -- ist der Schnitt, an dem sich dieser Titel entscheidet.
        CREATE TABLE IF NOT EXISTS ref_book (
            fen_key  TEXT NOT NULL,
            san      TEXT NOT NULL,
            white    INTEGER NOT NULL DEFAULT 0,
            draws    INTEGER NOT NULL DEFAULT 0,
            black    INTEGER NOT NULL DEFAULT 0,
            elo_sum  INTEGER NOT NULL DEFAULT 0,
            elo_n    INTEGER NOT NULL DEFAULT 0,
            best_elo INTEGER NOT NULL DEFAULT 0,
            game_id  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (fen_key, san)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS ref_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Referenz-Schema fehlgeschlagen: {e}"))
}

fn meta_get(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM ref_meta WHERE key = ?1",
        params![key],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_default()
}

fn meta_set(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO ref_meta (key, value) VALUES (?1, ?2)",
        params![key, value],
    );
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ── PGN lesen ────────────────────────────────────────────────────────────────

/// Eine gelesene Partie, so wie sie aus der Quelldatei kommt.
pub struct RawGame {
    pub white: String,
    pub black: String,
    pub white_elo: i32,
    pub black_elo: i32,
    pub result: String,
    pub date: String,
    pub event: String,
    pub eco: String,
    /// Zugtext der Hauptvariante, SAN durch Leerzeichen getrennt.
    pub sans: Vec<String>,
}

impl RawGame {
    fn empty() -> Self {
        Self {
            white: String::new(),
            black: String::new(),
            white_elo: 0,
            black_elo: 0,
            result: String::new(),
            date: String::new(),
            event: String::new(),
            eco: String::new(),
            sans: Vec::new(),
        }
    }

    /// Elo-Schnitt der Partie · 0, wenn keine Zahl bekannt ist.
    fn avg_elo(&self) -> i32 {
        match (self.white_elo, self.black_elo) {
            (0, 0) => 0,
            (w, 0) => w,
            (0, b) => b,
            (w, b) => (w + b) / 2,
        }
    }
}

/// `[White "Kasparov, G."]` → ("White", "Kasparov, G.")
fn parse_header(line: &str) -> Option<(&str, &str)> {
    let rest = line.trim().strip_prefix('[')?.strip_suffix(']')?;
    let (key, value) = rest.split_once(' ')?;
    let value = value.trim().strip_prefix('"')?.strip_suffix('"')?;
    Some((key, value))
}

/// Züge der Hauptvariante aus einem Zugtext.
///
/// Klammervarianten fallen weg · für ein Buch zählt, was am Brett stand, nicht
/// was jemand als Nebenlinie notiert hat. Kommentare, NAGs und Zugnummern
/// ebenso.
pub fn main_line(movetext: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let bytes = movetext.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => {
                while i < bytes.len() && bytes[i] != b'}' {
                    i += 1;
                }
                i += 1;
            }
            b';' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'(' => {
                depth += 1;
                i += 1;
            }
            b')' => {
                depth = depth.saturating_sub(1);
                i += 1;
            }
            b'$' => {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            }
            c if c.is_ascii_whitespace() => i += 1,
            _ => {
                let start = i;
                while i < bytes.len()
                    && !bytes[i].is_ascii_whitespace()
                    && !matches!(bytes[i], b'(' | b')' | b'{' | b'}' | b';')
                {
                    i += 1;
                }
                if depth == 0 {
                    if let Ok(word) = std::str::from_utf8(&bytes[start..i]) {
                        if let Some(san) = crate::rep_pgn::clean_san(word) {
                            out.push(san);
                        }
                    }
                }
            }
        }
    }
    out
}

/// Liest eine PGN-Datei Partie für Partie und ruft `each` damit auf.
///
/// Streamend, weil eine Referenzsammlung mehrere Gigabyte groß sein kann: Die
/// Datei als String einzulesen wäre auf dem Handy das Ende und auf dem Desktop
/// eine Wette auf den Arbeitsspeicher. `each` gibt `false` zurück, um
/// abzubrechen.
pub fn read_pgn<R: Read>(
    reader: R,
    mut on_bytes: impl FnMut(u64),
    mut each: impl FnMut(RawGame) -> bool,
) -> Result<(), String> {
    let mut reader = BufReader::with_capacity(1 << 20, reader);
    let mut line = String::new();
    let mut game = RawGame::empty();
    let mut movetext = String::new();
    let mut in_moves = false;
    let mut read_total: u64 = 0;

    loop {
        line.clear();
        // Fremde PGN-Dateien sind selten sauberes UTF-8 (ChessBase-Exporte
        // kommen oft als Latin-1). Ungültige Bytes dürfen den Import nicht
        // abbrechen · sie werden ersetzt.
        let mut raw = Vec::new();
        let read = read_line_lossy(&mut reader, &mut raw, &mut line)?;
        if read == 0 {
            break;
        }
        read_total += read as u64;
        on_bytes(read_total);

        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Ein Header nach gelesenem Zugtext beginnt die nächste Partie.
            if in_moves {
                game.sans = main_line(&movetext);
                if !each(std::mem::replace(&mut game, RawGame::empty())) {
                    return Ok(());
                }
                movetext.clear();
                in_moves = false;
            }
            if let Some((key, value)) = parse_header(&line) {
                match key {
                    "White" => game.white = value.to_string(),
                    "Black" => game.black = value.to_string(),
                    "WhiteElo" => game.white_elo = value.parse().unwrap_or(0),
                    "BlackElo" => game.black_elo = value.parse().unwrap_or(0),
                    "Result" => game.result = value.to_string(),
                    "Date" => game.date = value.to_string(),
                    "Event" => game.event = value.to_string(),
                    "ECO" => game.eco = value.to_string(),
                    _ => {}
                }
            }
            continue;
        }
        if !trimmed.is_empty() {
            in_moves = true;
            movetext.push_str(&line);
            movetext.push(' ');
        }
    }
    if in_moves || !game.white.is_empty() {
        game.sans = main_line(&movetext);
        each(game);
    }
    Ok(())
}

/// Liest eine Zeile und ersetzt ungültige UTF-8-Bytes, statt zu scheitern.
fn read_line_lossy<R: BufRead>(
    reader: &mut R,
    raw: &mut Vec<u8>,
    out: &mut String,
) -> Result<usize, String> {
    raw.clear();
    let read = reader
        .read_until(b'\n', raw)
        .map_err(|e| format!("Lesefehler: {e}"))?;
    if read > 0 {
        out.push_str(&String::from_utf8_lossy(raw));
    }
    Ok(read)
}

// ── Import ───────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy)]
struct BookAgg {
    white: i64,
    draws: i64,
    black: i64,
    elo_sum: i64,
    elo_n: i64,
    best_elo: i32,
    game_id: i64,
}

/// Erkennt das Format an der Endung · zstd-gepackte Dumps kommen so von
/// Lichess, `.cbh`/`.cbv` sind ChessBase.
fn is_zstd(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("zst") || e.eq_ignore_ascii_case("zstd"))
        .unwrap_or(false)
}

fn run_import(app: &tauri::AppHandle, path: String) -> Result<(u64, i64), String> {
    let source = PathBuf::from(&path);
    if !source.exists() {
        return Err(format!("Datei nicht gefunden: {path}"));
    }
    if crate::cbh::is_chessbase(&source) {
        return Err(crate::cbh::UNSUPPORTED_HINT.to_string());
    }
    let bytes_total = std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
    let file = std::fs::File::open(&source).map_err(|e| format!("Datei nicht lesbar: {e}"))?;

    let target = ref_path(app)?;
    let mut conn = open(&target)?;
    // Import ist ein Massenschreibvorgang; die Haltbarkeit einzelner Blöcke
    // ist hier weniger wert als die Dauer. Ein Absturz mittendrin kostet den
    // laufenden Block, nicht die Datenbank.
    let _ = conn.pragma_update(None, "synchronous", "OFF");
    let _ = conn.pragma_update(None, "cache_size", -64_000);

    let state = app.state::<RefDbState>();
    let mut next_id: i64 = conn
        .query_row("SELECT COALESCE(MAX(id), 0) FROM ref_games", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);

    let mut book: HashMap<(String, String), BookAgg> = HashMap::new();
    let mut pending: Vec<(i64, RawGame)> = Vec::new();
    let mut games_read: u64 = 0;
    let mut games_kept: u64 = 0;
    let mut last_progress: u64 = 0;
    // Beide Rückrufe von `read_pgn` brauchen den Lesestand · der eine schreibt
    // ihn, der andere meldet ihn.
    let bytes_read = std::cell::Cell::new(0u64);
    let mut cancelled = false;

    let reader: Box<dyn Read> = if is_zstd(&source) {
        Box::new(zstd::Decoder::new(file).map_err(|e| format!("zstd: {e}"))?)
    } else {
        Box::new(file)
    };

    read_pgn(
        reader,
        |n| bytes_read.set(n),
        |game| {
            games_read += 1;
            if state.cancel.load(Ordering::SeqCst) {
                cancelled = true;
                return false;
            }
            if game.sans.is_empty() {
                return true;
            }
            games_kept += 1;
            next_id += 1;
            let id = next_id;
            let avg = game.avg_elo();
            // Eine Partie ohne Ergebnis zahlt nicht ins Buch ein · sie hätte
            // in keiner der drei Spalten etwas zu suchen. Gespeichert wird sie
            // trotzdem, als Musterpartie taugt sie.
            let bucket = match game.result.as_str() {
                "1-0" => Some(0),
                "0-1" => Some(2),
                "1/2-1/2" | "½-½" => Some(1),
                _ => None,
            };
            if let Some(bucket) = bucket {
                let mut pos = chess::Position::initial();
                for san in game.sans.iter().take(BOOK_PLIES) {
                    let key = chess::fen_key(&pos);
                    let mv = match chess::parse_san(&pos, san) {
                        Ok(mv) => mv,
                        // Ein unlesbarer Zug beendet nur diese Partie · eine
                        // Millionensammlung enthält immer ein paar kaputte.
                        Err(_) => break,
                    };
                    let entry = book.entry((key, san.clone())).or_default();
                    match bucket {
                        0 => entry.white += 1,
                        1 => entry.draws += 1,
                        _ => entry.black += 1,
                    }
                    if avg > 0 {
                        entry.elo_sum += avg as i64;
                        entry.elo_n += 1;
                    }
                    if avg >= entry.best_elo {
                        entry.best_elo = avg;
                        entry.game_id = id;
                    }
                    pos = match pos.make_move(mv) {
                        Ok(next) => next,
                        Err(_) => break,
                    };
                }
            }
            pending.push((id, game));

            if games_kept % FLUSH_GAMES == 0 {
                if let Err(e) = flush(&mut conn, &mut pending, &mut book) {
                    log::error!("Referenz-Import: {e}");
                    return false;
                }
            }
            if games_read - last_progress >= PROGRESS_GAMES {
                last_progress = games_read;
                let _ = app.emit(
                    "refdb://progress",
                    ImportProgress {
                        games: games_kept,
                        bytes: bytes_read.get(),
                        bytes_total,
                        phase: "reading".into(),
                    },
                );
            }
            true
        },
    )?;

    let _ = app.emit(
        "refdb://progress",
        ImportProgress {
            games: games_kept,
            bytes: bytes_read.get(),
            bytes_total,
            phase: "finishing".into(),
        },
    );
    flush(&mut conn, &mut pending, &mut book)?;

    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
        .unwrap_or(0);
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&path)
        .to_string();
    meta_set(&conn, "source", &name);
    meta_set(&conn, "imported_at", &now_secs().to_string());
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    if cancelled {
        // Abgebrochen heißt „behalten, was schon da ist" · genau wie beim
        // Partien-Import. Ein zweiter Lauf über dieselbe Datei fügt allerdings
        // erneut hinzu, deshalb sagt es die Oberfläche deutlich.
        log::info!("Referenz-Import abgebrochen nach {games_kept} Partien");
    }
    Ok((games_kept, total))
}

/// Schreibt Partien und Buchzeilen eines Blocks in einer Transaktion.
fn flush(
    conn: &mut Connection,
    pending: &mut Vec<(i64, RawGame)>,
    book: &mut HashMap<(String, String), BookAgg>,
) -> Result<(), String> {
    if pending.is_empty() && book.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut insert = tx
            .prepare_cached(
                "INSERT OR REPLACE INTO ref_games
                 (id, white, black, white_elo, black_elo, result, played_at, event, eco, moves)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )
            .map_err(|e| e.to_string())?;
        for (id, game) in pending.drain(..) {
            insert
                .execute(params![
                    id,
                    game.white,
                    game.black,
                    game.white_elo,
                    game.black_elo,
                    game.result,
                    game.date,
                    game.event,
                    game.eco,
                    game.sans.join(" "),
                ])
                .map_err(|e| e.to_string())?;
        }
        let mut upsert = tx
            .prepare_cached(
                "INSERT INTO ref_book (fen_key, san, white, draws, black, elo_sum, elo_n, best_elo, game_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(fen_key, san) DO UPDATE SET
                   white    = white + excluded.white,
                   draws    = draws + excluded.draws,
                   black    = black + excluded.black,
                   elo_sum  = elo_sum + excluded.elo_sum,
                   elo_n    = elo_n + excluded.elo_n,
                   game_id  = CASE WHEN excluded.best_elo >= best_elo THEN excluded.game_id ELSE game_id END,
                   best_elo = MAX(best_elo, excluded.best_elo)",
            )
            .map_err(|e| e.to_string())?;
        for ((fen_key, san), agg) in book.drain() {
            upsert
                .execute(params![
                    fen_key,
                    san,
                    agg.white,
                    agg.draws,
                    agg.black,
                    agg.elo_sum,
                    agg.elo_n,
                    agg.best_elo,
                    agg.game_id,
                ])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

// ── Kommandos ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn refdb_status(app: tauri::AppHandle) -> Result<RefDbStatus, String> {
    let path = ref_path(&app)?;
    let importing = app.state::<RefDbState>().importing.load(Ordering::SeqCst);
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if !path.exists() {
        return Ok(RefDbStatus {
            games: 0,
            positions: 0,
            size_bytes: 0,
            source: String::new(),
            imported_at: 0,
            importing,
            path: path.display().to_string(),
        });
    }
    let conn = open(&path)?;
    Ok(RefDbStatus {
        games: conn
            .query_row("SELECT COUNT(*) FROM ref_games", [], |r| r.get(0))
            .unwrap_or(0),
        positions: conn
            .query_row("SELECT COUNT(*) FROM ref_book", [], |r| r.get(0))
            .unwrap_or(0),
        size_bytes,
        source: meta_get(&conn, "source"),
        imported_at: meta_get(&conn, "imported_at").parse().unwrap_or(0),
        importing,
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn refdb_import(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<RefDbState>();
    if state.importing.swap(true, Ordering::SeqCst) {
        return Err("Ein Referenz-Import läuft bereits.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_import(&app2, path);
        let state = app2.state::<RefDbState>();
        let cancelled = state.cancel.swap(false, Ordering::SeqCst);
        state.importing.store(false, Ordering::SeqCst);
        let (games, total, error) = match result {
            Ok((games, total)) => (games, total, None),
            Err(e) => (0, 0, Some(e)),
        };
        let _ = app2.emit(
            "refdb://done",
            ImportDone {
                games,
                total,
                cancelled,
                error,
            },
        );
    });
    Ok(())
}

#[tauri::command]
pub fn refdb_cancel_import(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<RefDbState>()
        .cancel
        .store(true, Ordering::SeqCst);
    Ok(())
}

/// Löscht die Referenzdatenbank vollständig · sie ist eine eigene Datei, die
/// eigenen Partien können davon gar nicht betroffen sein.
#[tauri::command]
pub fn refdb_clear(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<RefDbState>().importing.load(Ordering::SeqCst) {
        return Err("Während eines laufenden Imports nicht möglich.".into());
    }
    let path = ref_path(&app)?;
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("{}{suffix}", path.display()));
        if file.exists() {
            std::fs::remove_file(&file).map_err(|e| format!("Löschen fehlgeschlagen: {e}"))?;
        }
    }
    Ok(())
}

/// Auskunft des Buchs zu einer Stellung · dieselbe Form wie beim
/// Lichess-Explorer, damit die Karte in der Analyse nur eine Zeile kennt.
#[tauri::command]
pub fn refdb_query(app: tauri::AppHandle, fen: String) -> Result<ExplorerResult, String> {
    let path = ref_path(&app)?;
    let key = chess::normalize_fen(&fen)?;
    let mut result = ExplorerResult {
        source: "own".into(),
        status: "unknown".into(),
        white: 0,
        draws: 0,
        black: 0,
        moves: Vec::new(),
        top_games: Vec::new(),
        opening: None,
        cached: true,
    };
    if !path.exists() {
        return Ok(result);
    }
    let conn = open(&path)?;
    let mut stmt = conn
        .prepare(
            "SELECT san, white, draws, black, elo_sum, elo_n, game_id
             FROM ref_book WHERE fen_key = ?1
             ORDER BY (white + draws + black) DESC LIMIT 12",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![key], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut game_ids: Vec<i64> = Vec::new();
    for (san, white, draws, black, elo_sum, elo_n, game_id) in rows {
        result.white += white;
        result.draws += draws;
        result.black += black;
        result.moves.push(ExplorerMove {
            // Das Buch speichert SAN · die UCI-Form braucht die Karte nur als
            // Schlüssel, und dafür genügt der Zug selbst.
            uci: san.clone(),
            san,
            white,
            draws,
            black,
            average_rating: if elo_n > 0 {
                Some((elo_sum / elo_n) as i32)
            } else {
                None
            },
        });
        if game_id > 0 && game_ids.len() < TOP_GAMES {
            game_ids.push(game_id);
        }
    }
    if !result.moves.is_empty() {
        result.status = "ok".into();
    }

    for id in game_ids {
        if let Ok(game) = conn.query_row(
            "SELECT id, white, black, white_elo, black_elo, result, played_at, eco
             FROM ref_games WHERE id = ?1",
            params![id],
            |r| {
                Ok(ExplorerGame {
                    id: r.get::<_, i64>(0)?.to_string(),
                    white: r.get(1)?,
                    black: r.get(2)?,
                    white_elo: r.get::<_, i64>(3).ok().filter(|v| *v > 0).map(|v| v as i32),
                    black_elo: r.get::<_, i64>(4).ok().filter(|v| *v > 0).map(|v| v as i32),
                    winner: match r.get::<_, String>(5)?.as_str() {
                        "1-0" => "white".into(),
                        "0-1" => "black".into(),
                        _ => String::new(),
                    },
                    year: r
                        .get::<_, String>(6)?
                        .get(0..4)
                        .and_then(|y| y.parse().ok()),
                    month: None,
                })
            },
        ) {
            result.top_games.push(game);
        }
    }
    Ok(result)
}

/// Eine Referenzpartie zum Nachspielen · das Analysebrett lädt sie damit.
#[tauri::command]
pub fn refdb_game(app: tauri::AppHandle, id: i64) -> Result<RefGame, String> {
    let path = ref_path(&app)?;
    if !path.exists() {
        return Err("Keine Referenzdatenbank vorhanden.".into());
    }
    let conn = open(&path)?;
    conn.query_row(
        "SELECT id, white, black, white_elo, black_elo, result, played_at, event, eco, moves
         FROM ref_games WHERE id = ?1",
        params![id],
        |r| {
            Ok(RefGame {
                id: r.get(0)?,
                white: r.get(1)?,
                black: r.get(2)?,
                white_elo: r.get(3)?,
                black_elo: r.get(4)?,
                result: r.get(5)?,
                played_at: r.get(6)?,
                event: r.get(7)?,
                eco: r.get(8)?,
                moves: r.get(9)?,
            })
        },
    )
    .map_err(|e| format!("Partie nicht gefunden: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PGN: &str = "[Event \"Test\"]\n[White \"Kasparov, G.\"]\n[Black \"Karpov, A.\"]\n\
[WhiteElo \"2820\"]\n[BlackElo \"2745\"]\n[Result \"1-0\"]\n[Date \"1997.05.11\"]\n[ECO \"C50\"]\n\n\
1. e4 {beste Eröffnung} e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 3. Bc4 $1 Bc5 1-0\n\n\
[Event \"Test 2\"]\n[White \"Anand, V.\"]\n[Black \"Kramnik, V.\"]\n[Result \"1/2-1/2\"]\n\n\
1. d4 d5 2. c4 1/2-1/2\n";

    #[test]
    fn reads_headers_and_main_line() {
        let mut games = Vec::new();
        read_pgn(
            PGN.as_bytes(),
            |_| {},
            |g| {
                games.push(g);
                true
            },
        )
        .unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].white, "Kasparov, G.");
        assert_eq!(games[0].white_elo, 2820);
        assert_eq!(games[0].result, "1-0");
        assert_eq!(games[0].eco, "C50");
        // Klammervariante, Kommentar und NAG fallen weg.
        assert_eq!(games[0].sans, vec!["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"]);
        assert_eq!(games[1].sans, vec!["d4", "d5", "c4"]);
        assert_eq!(games[1].avg_elo(), 0);
    }

    #[test]
    fn stops_when_the_callback_asks_to() {
        let mut seen = 0;
        read_pgn(
            PGN.as_bytes(),
            |_| {},
            |_| {
                seen += 1;
                false
            },
        )
        .unwrap();
        assert_eq!(seen, 1, "der Abbruch greift sofort");
    }

    #[test]
    fn averages_only_the_ratings_it_knows() {
        let mut game = RawGame::empty();
        game.white_elo = 2600;
        assert_eq!(game.avg_elo(), 2600);
        game.black_elo = 2400;
        assert_eq!(game.avg_elo(), 2500);
    }

    #[test]
    fn main_line_ignores_nested_variations() {
        let sans = main_line("1. e4 (1. d4 d5 (1... Nf6 2. c4)) 1... c5 2. Nf3 *");
        assert_eq!(sans, vec!["e4", "c5", "Nf3"]);
    }
}
