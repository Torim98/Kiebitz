//! Study-Tab: aggregierte Lernplan-Daten. Der Coach selbst (Empfehlungen)
//! rechnet im Frontend auf den vorhandenen Insights-Daten; hier kommt nur
//! zusammen, was der Tagesplan und der Wochenkalender brauchen.
//!
//! Tagesgrenzen sind bewusst UTC (wie in puzzles.rs) · für Streaks und
//! Kalenderkacheln ist das genau genug.

use crate::{db, settings};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{Manager, State};

include!("calendar.rs");
include!("calendar_commands.rs");
include!("sessions.rs");
include!("training.rs");
include!("tests.rs");
