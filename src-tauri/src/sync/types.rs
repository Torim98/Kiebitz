// ── Payload-Typen ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncEval {
    pub ply: i64,
    pub san: String,
    pub eval_cp: Option<i64>,
    pub mate_in: Option<i64>,
    pub best_uci: String,
    pub judgment: String,
    pub phase: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncGame {
    pub source: String,
    pub source_id: String,
    pub url: String,
    pub played_at: String,
    pub played_ts: i64,
    pub time_class: String,
    pub color: String,
    #[serde(default)]
    pub my_name: String,
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
    #[serde(default)]
    pub opponent_accuracy: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_opening: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_middlegame: Option<f64>,
    #[serde(default)]
    pub opponent_accuracy_endgame: Option<f64>,
    pub moves: String,
    /// Restzeit nach jedem Halbzug (Hundertstelsekunden). Ältere Gegenstellen
    /// kennen das Feld nicht · dort bleibt die Partie ohne Uhren.
    #[serde(default)]
    pub clocks: String,
    #[serde(default)]
    pub time_control: String,
    /// Beendigungsgrund der Partie · wie die Uhren ein unveränderliches
    /// Partiedatum. Ältere Gegenstellen kennen das Feld nicht.
    #[serde(default)]
    pub termination: String,
    pub note: String,
    pub note_ts: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub tags_ts: i64,
    pub analyzed: bool,
    /// Zeitpunkt der Auto-Analyse · der Wochenkalender zählt Partie-Reviews
    /// dadurch auf jedem Gerät am selben Tag.
    #[serde(default)]
    pub analyzed_ts: i64,
    #[serde(default)]
    pub analysis_excluded: bool,
    /// Ursprungszeit der letzten Änderung; entscheidet gegen Löschmarker.
    #[serde(default)]
    pub updated_ts: i64,
    pub evals: Vec<SyncEval>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncGameTombstone {
    pub source: String,
    pub source_id: String,
    pub deleted_ts: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncRepNode {
    pub side: String,
    /// SAN-Kette von der Wurzel bis zu diesem Knoten, mit ' ' verbunden.
    pub path: String,
    pub name: String,
    pub fen_key: String,
    pub depth: i64,
    pub stability: f64,
    pub difficulty: f64,
    pub reps: i64,
    pub lapses: i64,
    pub due_ts: i64,
    pub last_ts: i64,
    /// Anlage-Zeitpunkt · entscheidet gegen Tombstones (Wieder-Anlegen gewinnt).
    #[serde(default)]
    pub created_ts: i64,
}

/// Gelöschter Repertoire-Teilbaum (Löschung propagiert auf gepairte Geräte).
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncTombstone {
    pub side: String,
    pub path: String,
    pub deleted_ts: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncPuzzleAttempt {
    pub puzzle_id: String,
    pub ts: i64,
    pub solved: bool,
    pub rating_before: i64,
    pub rating_after: i64,
    pub themes: String,
    /// Puzzle-Rating zur Versuchszeit · Basis für den deterministischen
    /// Elo-Replay nach einem Merge (0 = unbekannt, Versuch neutral).
    #[serde(default)]
    pub puzzle_rating: i64,
}

/// Ein von der Desktop-Analyse erzeugtes Puzzle. `source_game_id` ist bewusst
/// nicht Teil des Payloads: SQLite-IDs sind gerätelokal, deshalb reist der
/// natürliche Schlüssel der Partie mit.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncOwnPuzzle {
    pub id: String,
    pub fen: String,
    pub moves: String,
    pub rating: i64,
    pub rd: i64,
    pub popularity: i64,
    pub nb_plays: i64,
    pub themes: String,
    pub opening_tags: String,
    pub game_source: String,
    pub game_source_id: String,
    pub source_ply: Option<i64>,
    pub setup_plies: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncEndgameAttempt {
    pub drill_id: String,
    pub ts: i64,
    pub solved: bool,
    pub moves: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyTemplate {
    pub sync_key: String,
    pub title: String,
    pub duration_min: i64,
    pub tool: String,
    pub description: String,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyEvent {
    pub sync_key: String,
    pub template_sync_key: String,
    pub day: String,
    pub position: i64,
    pub completed: bool,
    pub completed_ts: i64,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
    /// Wiederholungsraster der Serie ("" = Einzeltermin). Ältere Gegenstellen
    /// kennen das Feld nicht · dort bleiben Serien einzelne Termine.
    #[serde(default)]
    pub repeat_rule: String,
    #[serde(default)]
    pub series_key: String,
}

/// Eine Repertoire-Wiederholung. Der natürliche Schlüssel ist `(side, path)`
/// wie bei Knoten und Tombstones · lokale `node_id` reisen nicht mit.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncRepReview {
    pub side: String,
    pub path: String,
    pub ts: i64,
    pub grade: i64,
}

/// Ein Fokus-Zyklus. Enthält nur die Absicht; Messwerte werden auf jedem Gerät
/// aus den Rohdaten neu gerechnet.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudyFocus {
    pub sync_key: String,
    pub area: String,
    pub metric_key: String,
    pub label_params: String,
    pub target: Option<f64>,
    pub cycle_days: i64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub status: String,
    pub created_ts: i64,
    pub updated_ts: i64,
    pub deleted: bool,
}

/// Eine gemessene Trainingssitzung.
///
/// Anders als Puzzle-Versuche wächst eine Sitzung nach dem Anlegen weiter ·
/// deshalb reist sie mit ihrem Schlüssel und wird über MAX(seconds) vereinigt.
/// Zwei Geräte können dieselbe Sitzung nicht gleichzeitig führen, also gewinnt
/// schlicht der weiter fortgeschrittene Stand.
#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStudySession {
    pub sync_key: String,
    pub area: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub seconds: i64,
    pub updated_ts: i64,
}

#[derive(Serialize, Deserialize)]
pub struct SyncRequest {
    pub code: String,
    /// Serverzeit des letzten erfolgreichen Syncs (0 = erster Sync).
    pub since: i64,
    pub games: Vec<SyncGame>,
    #[serde(default)]
    pub game_tombstones: Vec<SyncGameTombstone>,
    pub rep_nodes: Vec<SyncRepNode>,
    #[serde(default)]
    pub rep_tombstones: Vec<SyncTombstone>,
    pub puzzle_attempts: Vec<SyncPuzzleAttempt>,
    pub endgame_attempts: Vec<SyncEndgameAttempt>,
    #[serde(default)]
    pub study_templates: Vec<SyncStudyTemplate>,
    #[serde(default)]
    pub study_events: Vec<SyncStudyEvent>,
    #[serde(default)]
    pub rep_reviews: Vec<SyncRepReview>,
    #[serde(default)]
    pub study_focus: Vec<SyncStudyFocus>,
    /// Ältere Gegenstellen kennen das Feld nicht · dort bleibt die gemessene
    /// Zeit auf dem Gerät, auf dem sie angefallen ist.
    #[serde(default)]
    pub study_sessions: Vec<SyncStudySession>,
}

#[derive(Serialize, Deserialize)]
pub struct SyncResponse {
    pub now: i64,
    pub games: Vec<SyncGame>,
    #[serde(default)]
    pub game_tombstones: Vec<SyncGameTombstone>,
    pub rep_nodes: Vec<SyncRepNode>,
    #[serde(default)]
    pub rep_tombstones: Vec<SyncTombstone>,
    pub puzzle_attempts: Vec<SyncPuzzleAttempt>,
    /// `None` bedeutet eine ältere Gegenstelle, die eigene Puzzles noch nicht
    /// mitsendet. `Some([])` ist dagegen ein autoritativer leerer Snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_puzzles: Option<Vec<SyncOwnPuzzle>>,
    pub endgame_attempts: Vec<SyncEndgameAttempt>,
    #[serde(default)]
    pub study_templates: Vec<SyncStudyTemplate>,
    #[serde(default)]
    pub study_events: Vec<SyncStudyEvent>,
    #[serde(default)]
    pub rep_reviews: Vec<SyncRepReview>,
    #[serde(default)]
    pub study_focus: Vec<SyncStudyFocus>,
    /// Ältere Gegenstellen kennen das Feld nicht · dort bleibt die gemessene
    /// Zeit auf dem Gerät, auf dem sie angefallen ist.
    #[serde(default)]
    pub study_sessions: Vec<SyncStudySession>,
}
