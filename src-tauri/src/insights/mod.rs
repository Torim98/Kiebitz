//! Tiefenanalyse für den Insights-Reiter.
//!
//! Zeitmanagement, Partieinhalt, Vergleich mit dem eigenen Gegnerfeld,
//! Sessions, Lernfortschritt, Repertoire-Abweichung und Zeitformate entstehen
//! in *einem* Durchlauf über Partien, Uhren und `move_evals`. Das hat zwei
//! Gründe: die Kennzahlen passen dann zueinander, und die Seite kommt mit einem
//! einzigen Aufruf aus. Aggregiert wird in Rust, weil die Zugebene je nach
//! Datenbank schnell sechsstellig wird und im Frontend den Reiter blockieren
//! würde.
//!
//! Zwei Konventionen ziehen sich durch: Bewertungen stehen wie in `move_evals`
//! aus Weiß-Sicht und werden hier auf *meine* Sicht gedreht, und „Verlust" ist
//! immer der Gewinnwahrscheinlichkeits-Verlust eines Zuges (0..1) · dieselbe
//! Größe, aus der `analysis.rs` Ungenauigkeit/Fehler/Patzer ableitet.

use crate::analysis;
use crate::chess;
use crate::db;
use crate::repertoire;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use tauri::Manager;

include!("helpers_and_raw.rs");
include!("models.rs");
include!("load.rs");
include!("time.rs");
include!("content.rs");
include!("sessions_and_progress.rs");
include!("repertoire_and_formats.rs");
include!("metrics.rs");
include!("tests.rs");
