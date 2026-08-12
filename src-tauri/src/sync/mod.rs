//! Geräte-Sync v1 · direkter Abgleich im lokalen Netz, Desktop als Hub.
//!
//! Das Handy stößt den Sync an (ein POST-Roundtrip): es schickt seine lokalen
//! Änderungen und bekommt die Desktop-Änderungen seit dem letzten Sync zurück.
//! Kein Server, keine Cloud · der Desktop lauscht nur solange die App läuft
//! auf Port 47323, abgesichert über einen Pairing-Code aus den Einstellungen.
//!
//! Merge-Regeln (idempotent, wiederholbar):
//! - Partien: Upsert per Natural Key (source, source_id); `analyzed` wird nie
//!   zurückgesetzt, `accuracy` per COALESCE; Analyse-Züge (move_evals) werden
//!   übernommen, wenn die Gegenseite analysiert hat und wir nicht.
//! - Notizen: Last-Write-Wins über `note_ts`.
//! - Repertoire: Knoten werden per Pfad (side + SAN-Kette) additiv vereinigt;
//!   der FSRS-Zustand pro Knoten gewinnt nach `last_ts` (die frischere Review).
//!   Löschungen propagieren in v1 nicht.
//! - Puzzle-/Endspiel-Versuche: append-only-Union, Duplikate über
//!   (puzzle_id|drill_id, ts) erkannt.
//! - Study: Vorlagen und Kalendereinträge per stabiler Sync-ID; der neuere
//!   `updated_ts`-Stand gewinnt, einschließlich Abschluss und Löschung.
//! - Eigene Puzzles: vollständiger Desktop-Snapshot; die lokale Game-ID wird
//!   über den stabilen Partie-Schlüssel (source, source_id) neu zugeordnet.
//! - Nicht gesynct: Lichess-Puzzle-DB, positions-Index (wird lokal neu
//!   aufgebaut), Caches. Puzzle-Ratings bleiben Geräte-lokal (v1).
//!
//! Cursor: der Client merkt sich die Serverzeit des letzten Syncs (meta
//! `sync_last_ts`) und beide Seiten filtern veränderliche Datensätze mit einem
//! Sicherheitsfenster (SLACK). Manuell importierte Partien und append-only
//! Puzzle-Versuche reisen dagegen vollständig mit: Erstere lassen sich nicht
//! von einer Online-Quelle nachladen, bei Letzteren ist `ts` der Zeitpunkt des
//! Trainings und kein verlässlicher Änderungs-Cursor. Doppel-Übertragungen sind
//! durch die idempotenten Merges gratis; Tombstones verhindern, dass gelöschte
//! manuelle Partien dabei wieder auftauchen.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

use crate::{db, settings};

pub const SYNC_PORT: u16 = 47323;
/// UDP-Port für die Auto-Discovery ("Desktop suchen" auf dem Handy).
pub const DISCOVERY_PORT: u16 = 47324;
const DISCOVER_MSG: &[u8] = b"KIEBITZ_DISCOVER_V1";
const DISCOVER_REPLY: &str = "KIEBITZ_HERE";
/// Sicherheitsfenster gegen Uhren-Drift zwischen den Geräten (Sekunden).
const SLACK: i64 = 600;
/// Obergrenze für den Request-Body (Schutz gegen Unsinn auf dem Port).
const MAX_BODY: usize = 256 * 1024 * 1024;

include!("types.rs");
include!("collect.rs");
include!("apply.rs");
include!("server.rs");
include!("commands.rs");
include!("tests.rs");
