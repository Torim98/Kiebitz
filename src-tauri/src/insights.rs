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

// ── Kleine Helfer ────────────────────────────────────────────────────────────

fn r1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn pct(part: f64, whole: f64) -> f64 {
    if whole > 0.0 {
        r1(part / whole * 100.0)
    } else {
        0.0
    }
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn score_of(result: &str) -> f64 {
    match result {
        "win" => 1.0,
        "draw" => 0.5,
        _ => 0.0,
    }
}

/// Gewinnwahrscheinlichkeit aus Weiß-Sicht · identisch zu `analysis.rs`, damit
/// Verluste hier dieselbe Skala haben wie die gespeicherten Judgments.
fn win_prob(eval_cp: Option<i64>, mate_in: Option<i64>) -> f64 {
    if let Some(m) = mate_in {
        return if m > 0 { 1.0 } else { 0.0 };
    }
    let cp = eval_cp.unwrap_or(0) as f64;
    1.0 / (1.0 + (-0.004 * cp).exp())
}

/// Genauigkeit nach der Lichess-Formel · Gegenstück zu `analysis.rs`, damit
/// Werte aus Teilmengen (Phase, Zeitformat, Gegnerzüge) vergleichbar bleiben.
fn accuracy_from_losses(losses: &[f64]) -> Option<f64> {
    let m = mean(losses)? * 100.0;
    Some(r1(
        (103.1668 * (-0.04354 * m).exp() - 3.1669).clamp(0.0, 100.0)
    ))
}

/// Zieht Weiß den Halbzug `ply`? (1-basiert, Weiß beginnt.)
fn white_plays(ply: i64) -> bool {
    ply % 2 == 1
}

fn phase_index(phase: &str) -> usize {
    match phase {
        "opening" => 0,
        "middlegame" => 1,
        _ => 2,
    }
}

const PHASES: [&str; 3] = ["opening", "middlegame", "endgame"];

// ── Rohdaten ─────────────────────────────────────────────────────────────────

struct RawGame {
    id: i64,
    played_ts: i64,
    source: String,
    time_class: String,
    color: String,
    result: String,
    moves: String,
    clocks: String,
    time_control: String,
    my_elo: i64,
    opp_elo: i64,
    accuracy: Option<f64>,
    /// Eröffnungsname aus dem PGN ("Sicilian Defense Bowdler Attack").
    opening: String,
}

impl RawGame {
    fn my_white(&self) -> bool {
        self.color == "white"
    }
    fn mine(&self, ply: i64) -> bool {
        white_plays(ply) == self.my_white()
    }
    fn score(&self) -> f64 {
        score_of(&self.result)
    }
}

struct Ev {
    ply: i64,
    san: String,
    eval_cp: Option<i64>,
    mate_in: Option<i64>,
    best_uci: String,
    judgment: String,
    phase: String,
}

/// Uhrenverlauf einer Partie in Sekunden.
struct Clocks {
    initial: f64,
    increment: f64,
    /// Restzeit nach Halbzug `i+1`.
    remaining: Vec<f64>,
}

impl Clocks {
    /// Zeit, die der Halbzug `ply` gekostet hat, und ihr Anteil an dem, was der
    /// Seite zu Beginn des Zuges zur Verfügung stand.
    fn spent(&self, ply: i64) -> Option<(f64, f64)> {
        let index = (ply - 1) as usize;
        let now = *self.remaining.get(index)?;
        let before = if ply >= 3 {
            *self.remaining.get(index - 2)?
        } else {
            self.initial
        };
        let budget = before + self.increment;
        if budget <= 0.0 {
            return None;
        }
        let spent = (budget - now).clamp(0.0, budget);
        Some((spent, spent / budget))
    }

    /// Restzeit der Seite, die `ply` zieht, *vor* diesem Zug.
    fn before(&self, ply: i64) -> f64 {
        if ply >= 3 {
            self.remaining
                .get((ply - 3) as usize)
                .copied()
                .unwrap_or(self.initial)
        } else {
            self.initial
        }
    }

    fn last_of(&self, white: bool) -> Option<f64> {
        self.remaining
            .iter()
            .enumerate()
            .rfind(|(i, _)| white_plays(*i as i64 + 1) == white)
            .map(|(_, v)| *v)
    }
}

/// "600+5" → (600, 5). Mehrstufige Vorgaben werden auf die erste Stufe
/// reduziert · daraus wird die Startzeit auf der Uhr.
fn parse_time_control(raw: &str) -> Option<(f64, f64)> {
    let first = raw.trim().split(':').next()?.trim();
    if first.is_empty() || first == "-" || first == "?" {
        return None;
    }
    let body = first.rsplit('/').next()?;
    let mut parts = body.split('+');
    let initial: f64 = parts.next()?.trim().parse().ok()?;
    let increment: f64 = match parts.next() {
        Some(v) => v.trim().parse().ok()?,
        None => 0.0,
    };
    if initial <= 0.0 {
        return None;
    }
    Some((initial, increment))
}

fn clocks_of(game: &RawGame) -> Option<Clocks> {
    // Chess.com verwendet `%clk` in Fernpartie-PGNs für eine Tages-/Zuguhr,
    // nicht für eine durchlaufende Partieuhr. Der Vergleich mit der nominellen
    // Ein- bis Sieben-Tage-Vorgabe ließ fast jeden Fernschachzug wie Zeitnot
    // aussehen. Zeitmanagement-Auswertungen verwenden deshalb nur Livepartien.
    if matches!(game.time_class.as_str(), "daily" | "correspondence") {
        return None;
    }
    let (initial, increment) = parse_time_control(&game.time_control)?;
    if game.clocks.trim().is_empty() {
        return None;
    }
    let mut remaining = Vec::new();
    for part in game.clocks.split_whitespace() {
        let centis: f64 = part.parse().ok()?;
        remaining.push(centis / 100.0);
    }
    if remaining.len() < 4 {
        return None;
    }
    Some(Clocks {
        initial,
        increment,
        remaining,
    })
}

// ── Ausgabestrukturen ────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
pub struct Coverage {
    pub games: i64,
    pub analyzed: i64,
    pub with_clocks: i64,
    pub moves_judged: i64,
    pub first_ts: i64,
    pub last_ts: i64,
}

// Block A · Zeitmanagement

#[derive(Serialize)]
pub struct SpeedBucket {
    /// instant | quick | normal | long
    pub key: String,
    pub moves: i64,
    pub errors: i64,
    pub blunders: i64,
    /// Fehler (Fehler + Patzer) je 100 Züge.
    pub errors_per_100: f64,
    /// Mittlerer Gewinnwahrscheinlichkeits-Verlust in Prozentpunkten.
    pub avg_loss: f64,
    pub share_pct: f64,
}

#[derive(Serialize, Default, Debug)]
pub struct TimeFocus {
    /// Ø Anteil der Restzeit, den ein Zug in ausgeglichener Stellung kostet.
    pub balanced_share: f64,
    /// … und in längst entschiedener Stellung.
    pub decided_share: f64,
    pub balanced_moves: i64,
    pub decided_moves: i64,
    /// Ø Zeitanteil auf Zügen, die sich als Fehler herausstellten …
    pub error_share: f64,
    /// … gegenüber allen anderen.
    pub ok_share: f64,
}

#[derive(Serialize, Default)]
pub struct TimeTrouble {
    /// Züge unter 10 % der Grundzeit.
    pub moves: i64,
    pub share_pct: f64,
    pub errors_per_100: f64,
    /// Vergleichswert außerhalb der Zeitnot.
    pub baseline_per_100: f64,
    pub games: i64,
    pub games_pct: f64,
    /// Ø Zug, ab dem die Zeitnot beginnt.
    pub first_move: f64,
    /// Niederlagen mit praktisch leerer Uhr · vermutlich Zeitüberschreitung.
    pub flag_losses: i64,
    pub score_in_trouble: f64,
    pub score_without: f64,
}

#[derive(Serialize, Default)]
pub struct ClockEdge {
    pub games: i64,
    pub ahead_games: i64,
    pub ahead_score: f64,
    pub behind_games: i64,
    pub behind_score: f64,
    /// Ø Uhrvorsprung am 60-%-Punkt der Partie, in Sekunden.
    pub avg_diff: f64,
}

#[derive(Serialize, Default)]
pub struct TheoryTime {
    pub games: i64,
    /// Anteil der eigenen Bedenkzeit, der auf Züge im eigenen Buch fällt.
    pub book_share_pct: f64,
    pub book_moves: i64,
    /// Ø Zeitanteil je Buchzug gegenüber Zügen außerhalb des Buchs.
    pub book_avg_share: f64,
    pub own_avg_share: f64,
}

#[derive(Serialize, Default)]
pub struct IncrementBalance {
    pub games: i64,
    pub moves: i64,
    /// Anteil der Züge, die mehr kosten als der Zuschlag einbringt.
    pub over_increment_pct: f64,
    pub avg_spent: f64,
    pub increment: f64,
}

#[derive(Serialize)]
pub struct DriftPoint {
    /// Partie-Nummer innerhalb der Session (5 = „fünfte und später").
    pub index: i64,
    pub games: i64,
    pub avg_share: f64,
    pub score_pct: f64,
}

#[derive(Serialize)]
pub struct PhaseTime {
    pub phase: String,
    pub moves: i64,
    /// Anteil der Grundzeit, der in dieser Phase verbraucht wird.
    pub clock_pct: f64,
    pub avg_share: f64,
}

#[derive(Serialize, Default)]
pub struct TimeInsights {
    pub games: i64,
    pub moves: i64,
    pub by_speed: Vec<SpeedBucket>,
    pub focus: TimeFocus,
    pub trouble: TimeTrouble,
    pub edge: ClockEdge,
    pub theory: TheoryTime,
    pub increment: IncrementBalance,
    pub drift: Vec<DriftPoint>,
    pub by_phase: Vec<PhaseTime>,
}

// Block C · Partieinhalt

#[derive(Serialize, Default)]
pub struct Conversion {
    /// Partien, in denen ich klar auf Gewinn stand (≥ +2).
    pub games: i64,
    pub won: i64,
    pub drawn: i64,
    pub lost: i64,
    pub score_pct: f64,
    /// Ø Zug, ab dem der Vorteil endgültig weg war.
    pub lost_at_move: f64,
    /// Phase, in der der Vorteil am häufigsten verloren geht.
    pub phase: String,
}

#[derive(Serialize, Default)]
pub struct Defense {
    pub games: i64,
    pub saved: i64,
    pub save_pct: f64,
}

#[derive(Serialize, Default)]
pub struct Decisive {
    pub games: i64,
    /// Ø Zug, ab dem die Partie nicht mehr kippte.
    pub avg_move: f64,
    pub by_phase: Vec<PhaseShare>,
}

#[derive(Serialize)]
pub struct PhaseShare {
    pub phase: String,
    pub games: i64,
    pub share_pct: f64,
}

#[derive(Serialize, Default)]
pub struct MissedPunishment {
    /// Gegnerische Fehler und Patzer, auf die ein eigener Zug folgte.
    pub chances: i64,
    /// … davon nicht bestraft (eigener Zug verliert selbst ≥ 10 % Winrate).
    pub missed: i64,
    pub missed_pct: f64,
}

#[derive(Serialize)]
pub struct PieceErrors {
    /// P | N | B | R | Q | K
    pub piece: String,
    pub errors: i64,
    pub moves: i64,
    pub errors_per_100: f64,
}

#[derive(Serialize, Default)]
pub struct Anatomy {
    pub errors: i64,
    /// Fehler, bei denen der übersehene beste Zug forcierend war.
    pub forcing_missed: i64,
    pub forcing_pct: f64,
    /// Vergleichsmaß: Anteil forcierender Bestzüge über alle eigenen Züge.
    pub forcing_base_pct: f64,
    pub by_piece: Vec<PieceErrors>,
    /// Mittlerer Verlust in Stellungen mit forcierendem bzw. ruhigem Bestzug.
    pub forcing_loss: f64,
    pub quiet_loss: f64,
    pub forcing_moves: i64,
    pub quiet_moves: i64,
}

#[derive(Serialize)]
pub struct EndgameType {
    /// pawn | queen | rook | rook+minor | minor | opposite-bishops | other
    pub key: String,
    pub games: i64,
    pub score_pct: f64,
    pub accuracy: Option<f64>,
}

#[derive(Serialize, Default)]
pub struct ContentInsights {
    pub games: i64,
    pub conversion: Conversion,
    pub defense: Defense,
    pub decisive: Decisive,
    pub punishment: MissedPunishment,
    pub anatomy: Anatomy,
    pub endgames: Vec<EndgameType>,
}

// Block D · Feld-Vergleich

#[derive(Serialize)]
pub struct SideMetrics {
    pub moves: i64,
    pub avg_loss: f64,
    pub errors_per_100: f64,
    pub blunders_per_100: f64,
    pub accuracy: Option<f64>,
    pub by_phase: Vec<PhaseMetric>,
    /// Ø Zeitanteil je Zug; null ohne Uhrdaten.
    pub avg_share: Option<f64>,
    pub trouble_pct: Option<f64>,
}

#[derive(Serialize)]
pub struct PhaseMetric {
    pub phase: String,
    pub moves: i64,
    pub blunders_per_100: f64,
    pub avg_loss: f64,
}

#[derive(Serialize, Default)]
pub struct BenchmarkInsights {
    /// Partien gegen Gegner im Fenster ±150 Elo.
    pub games: i64,
    pub avg_opp_elo: i64,
    pub me: Option<SideMetrics>,
    pub field: Option<SideMetrics>,
}

// Block E · Sessions

#[derive(Serialize)]
pub struct SessionIndex {
    pub index: i64,
    pub games: i64,
    pub score_pct: f64,
    pub accuracy: Option<f64>,
}

#[derive(Serialize, Default)]
pub struct Requeue {
    /// Partien, die kurz nach einer Niederlage begannen.
    pub fast_games: i64,
    pub fast_score: f64,
    pub slow_games: i64,
    pub slow_score: f64,
    /// Grenze in Sekunden.
    pub threshold: i64,
}

#[derive(Serialize, Default)]
pub struct Warmup {
    pub first_games: i64,
    pub first_score: f64,
    pub rest_games: i64,
    pub rest_score: f64,
    /// Erste Partie an Tagen mit vorherigem Puzzletraining …
    pub primed_games: i64,
    pub primed_score: f64,
    /// … gegenüber Tagen ohne.
    pub cold_games: i64,
    pub cold_score: f64,
}

#[derive(Serialize, Default)]
pub struct SessionDamage {
    pub sessions: i64,
    /// Summe aller negativen Session-Bilanzen in Elo.
    pub total_loss: i64,
    /// Anteil daran, der auf die drei schlimmsten Sessions entfällt.
    pub worst3_pct: f64,
    pub worst_delta: i64,
}

#[derive(Serialize, Default)]
pub struct SessionInsights {
    pub sessions: i64,
    pub avg_games: f64,
    pub by_index: Vec<SessionIndex>,
    /// Empfohlene Obergrenze; 0 = kein belastbarer Abfall gefunden.
    pub recommended_length: i64,
    pub requeue: Requeue,
    pub warmup: Warmup,
    pub damage: SessionDamage,
}

// Block F · Fortschritt

#[derive(Serialize)]
pub struct MonthPoint {
    /// "2026-06"
    pub month: String,
    pub games: i64,
    pub score_pct: f64,
    pub accuracy: Option<f64>,
    pub rating: Option<i64>,
    pub blunders_per_100: Option<f64>,
    pub puzzle_attempts: i64,
    pub puzzle_solved: i64,
}

#[derive(Serialize)]
pub struct ThemeProgress {
    pub theme: String,
    pub attempts: i64,
    pub early_pct: f64,
    pub late_pct: f64,
    pub delta: f64,
}

#[derive(Serialize, Default)]
pub struct RepEffect {
    /// Partien, die eine später trainierte Linie erreichten · vor dem Training.
    pub before_games: i64,
    pub before_score: f64,
    pub after_games: i64,
    pub after_score: f64,
}

#[derive(Serialize, Default)]
pub struct ProgressInsights {
    pub months: Vec<MonthPoint>,
    pub themes: Vec<ThemeProgress>,
    pub rep_effect: RepEffect,
    /// Genauigkeits- und Ratingtrend über die letzten Monate, in Punkten.
    pub accuracy_delta: Option<f64>,
    pub rating_delta: Option<i64>,
}

// Block B · Repertoire-Abweichung

#[derive(Serialize)]
pub struct DeviationSide {
    pub side: String,
    pub games: i64,
    /// Partien, in denen ich zuerst vom Buch abwich.
    pub mine: i64,
    pub mine_score: f64,
    /// … und in denen der Gegner es tat.
    pub theirs: i64,
    pub theirs_score: f64,
    /// Partien, die bis zur Prüftiefe im Buch blieben.
    pub in_book: i64,
    pub in_book_score: f64,
    pub avg_mine_move: f64,
    pub avg_theirs_move: f64,
}

#[derive(Serialize)]
pub struct ShakyLine {
    pub node_id: i64,
    pub side: String,
    pub line: String,
    pub san: String,
    pub lapses: i64,
    pub reps: i64,
    pub stability: f64,
    /// Wie oft die Stellung in echten Partien vorkam.
    pub games: i64,
}

#[derive(Serialize, Default)]
pub struct RepertoireInsights {
    /// Buchknoten insgesamt; 0 = kein Repertoire angelegt.
    pub nodes: i64,
    pub checked_games: i64,
    pub plies: i64,
    pub by_side: Vec<DeviationSide>,
    pub shaky: Vec<ShakyLine>,
}

// Block H · Zeitformate

#[derive(Serialize)]
pub struct FormatStat {
    /// "chess.com/blitz"
    pub key: String,
    pub source: String,
    pub time_class: String,
    pub games: i64,
    pub score_pct: f64,
    /// Letztes eigenes Rating in diesem Format.
    pub rating: Option<i64>,
    pub avg_opp_elo: Option<i64>,
    /// Performance-Rating aus Ergebnissen gegen die Gegner-Elo.
    pub perf_rating: Option<i64>,
    /// perf_rating − rating: über oder unter dem eigenen Rating gespielt.
    pub perf_edge: Option<i64>,
    pub accuracy: Option<f64>,
    pub avg_loss: Option<f64>,
    pub blunders_per_100: Option<f64>,
    pub trouble_pct: Option<f64>,
    /// Eigene Bedenkzeit in Minuten (nur Partien mit Uhrdaten).
    pub minutes: i64,
    pub analyzed: i64,
    pub last_ts: i64,
}

#[derive(Serialize, Default)]
pub struct FormatInsights {
    pub formats: Vec<FormatStat>,
    /// Formate mit genug analysierten Partien für den Skill-Vergleich.
    pub comparable: i64,
}

// Spotlight

#[derive(Serialize)]
pub struct Spotlight {
    pub game_id: i64,
    pub ply: i64,
    /// missed_win | collapse | comeback
    pub kind: String,
    /// Größe des Ausschlags in Prozentpunkten Gewinnwahrscheinlichkeit.
    pub magnitude: f64,
    pub opponent: String,
    pub played_at: String,
}

// ── Block I · Eröffnungsfamilien ─────────────────────────────────────────────

/// Eine Eröffnungsfamilie aus *meiner* Sicht, getrennt nach Farbe.
///
/// Als Weiß steht hier, was ich selbst wähle; als Schwarz, womit ich
/// konfrontiert werde. Das ist derselbe Datensatz mit zwei Lesarten, und beide
/// braucht die Empfehlung: das eigene Repertoire und die Systeme, gegen die es
/// nicht hält.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct OpeningFamily {
    pub key: String,
    pub label: String,
    /// Meine Farbe in diesen Partien.
    pub color: String,
    /// Erster Zug der Partie ("e4", "d4", …) · gröbere Gruppierung für die UI.
    pub root: String,
    pub games: i64,
    pub score_pct: f64,
    /// Ø Partiegenauigkeit (nur analysierte Partien).
    pub accuracy: Option<f64>,
    /// Genauigkeit meiner Züge in der Eröffnungsphase.
    pub opening_accuracy: Option<f64>,
    /// Ø Winrate-Verlust je eigenem Eröffnungszug, in Prozentpunkten.
    pub avg_loss: f64,
    pub blunders_per_100: f64,
    /// Gewertete eigene Züge in der Eröffnungsphase.
    pub moves: i64,
    pub analyzed: i64,
    /// Partien, die bis zur Prüftiefe im Repertoire blieben.
    pub in_book: i64,
    /// Partien, in denen ich zuerst vom Buch abwich.
    pub my_departure: i64,
    /// Ø Halbzug der ersten Abweichung (0 = nie gemessen).
    pub avg_departure_ply: f64,
    pub last_ts: i64,
}

#[derive(Serialize, Default)]
pub struct OpeningInsights {
    /// Nach Partienzahl absteigend, gedeckelt.
    pub families: Vec<OpeningFamily>,
    /// Punktausbeute über alle gewerteten Partien · Bezugsgröße dafür, ob eine
    /// Familie über- oder unterdurchschnittlich läuft.
    pub baseline_score: f64,
    pub games: i64,
}

#[derive(Serialize, Default)]
pub struct DeepInsights {
    pub coverage: Coverage,
    pub time: TimeInsights,
    pub content: ContentInsights,
    pub benchmark: BenchmarkInsights,
    pub sessions: SessionInsights,
    pub progress: ProgressInsights,
    pub repertoire: RepertoireInsights,
    pub formats: FormatInsights,
    pub openings: OpeningInsights,
    pub spotlight: Option<Spotlight>,
}

// ── Endspiel-Signatur ────────────────────────────────────────────────────────

/// Materialbild eines Endspiels aus dem Figurenfeld einer FEN.
///
/// Bewusst grob: Es geht um die Frage „welchen Endspieltyp beherrsche ich
/// nicht", nicht um eine Klassifikation für ein Lehrbuch.
fn endgame_signature(placement: &str) -> &'static str {
    let (mut n, mut b, mut r, mut q) = (0, 0, 0, 0);
    // Läuferfelder für das Erkennen ungleichfarbiger Läufer.
    let mut white_bishop_dark: Option<bool> = None;
    let mut black_bishop_dark: Option<bool> = None;
    let mut white_bishops = 0;
    let mut black_bishops = 0;

    let mut rank = 0usize;
    for row in placement.split('/') {
        let mut file = 0usize;
        for ch in row.chars() {
            if let Some(skip) = ch.to_digit(10) {
                file += skip as usize;
                continue;
            }
            let dark = (rank + file) % 2 == 1;
            match ch {
                'n' | 'N' => n += 1,
                'r' | 'R' => r += 1,
                'q' | 'Q' => q += 1,
                'B' => {
                    b += 1;
                    white_bishops += 1;
                    white_bishop_dark = Some(dark);
                }
                'b' => {
                    b += 1;
                    black_bishops += 1;
                    black_bishop_dark = Some(dark);
                }
                _ => {}
            }
            file += 1;
        }
        rank += 1;
    }

    if q > 0 {
        return if r > 0 { "queen+rook" } else { "queen" };
    }
    if n + b + r == 0 {
        return "pawn";
    }
    if r > 0 {
        return if n + b > 0 { "rook+minor" } else { "rook" };
    }
    if white_bishops == 1 && black_bishops == 1 && n == 0 {
        if let (Some(w), Some(bl)) = (white_bishop_dark, black_bishop_dark) {
            if w != bl {
                return "opposite-bishops";
            }
        }
    }
    if n + b > 0 {
        return "minor";
    }
    "other"
}

/// Figur, die einen SAN-Zug ausgeführt hat.
fn piece_of_san(san: &str) -> &'static str {
    match san.chars().next() {
        Some('N') => "N",
        Some('B') => "B",
        Some('R') => "R",
        Some('Q') => "Q",
        Some('K') => "K",
        Some('O') => "K",
        _ => "P",
    }
}

// ── Aufbereitete Partie ──────────────────────────────────────────────────────

/// Alles, was die Blöcke von einer Partie brauchen · einmal gerechnet.
struct GameView<'a> {
    raw: &'a RawGame,
    /// Bewertungen nach Halbzug `i+1`.
    evals: &'a [Ev],
    /// Gewinnwahrscheinlichkeit aus Weiß-Sicht nach Halbzug `i+1`.
    wp: Vec<f64>,
    clocks: Option<Clocks>,
    /// Erste Abweichung vom Buch, falls ein Repertoire vorliegt.
    book_departure: Option<(i64, bool)>,
    /// Anzahl der Halbzüge, die vom Start weg wirklich im eigenen
    /// farbspezifischen Repertoire stehen. 0 bedeutet ausdrücklich: kein
    /// passender Repertoirepfad; es ist nicht dasselbe wie "keine Abweichung".
    book_plies: i64,
}

impl<'a> GameView<'a> {
    /// Verlust des Halbzugs `ply` aus Sicht der ziehenden Seite (0..1).
    fn loss(&self, ply: i64) -> Option<f64> {
        let index = (ply - 1) as usize;
        let after = *self.wp.get(index)?;
        let before = if ply >= 2 {
            *self.wp.get(index - 1)?
        } else {
            0.5
        };
        Some(if white_plays(ply) {
            (before - after).max(0.0)
        } else {
            (after - before).max(0.0)
        })
    }

    /// Bewertung nach Halbzug `ply` aus *meiner* Sicht, in Centipawn.
    fn cp_mine(&self, ply: i64) -> Option<f64> {
        let ev = self.evals.get((ply - 1) as usize)?;
        let cp = match ev.mate_in {
            Some(m) => {
                if m > 0 {
                    2000.0
                } else {
                    -2000.0
                }
            }
            None => ev.eval_cp? as f64,
        };
        Some(if self.raw.my_white() { cp } else { -cp })
    }
}

// ── Hauptberechnung ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn deep_insights(app: tauri::AppHandle) -> Result<DeepInsights, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The calculation can scan many games and evaluations. A dedicated
        // read-only WAL connection keeps that work off the global command
        // mutex while still giving the whole calculation one stable snapshot.
        let path = app
            .state::<analysis::DbPath>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        let result = compute(&conn);
        if result.is_ok() {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        } else {
            let _ = conn.execute_batch("ROLLBACK");
        }
        result
    })
    .await
    .map_err(|e| format!("Tiefenanalyse fehlgeschlagen: {e}"))?
}

fn compute(conn: &Connection) -> Result<DeepInsights, String> {
    let games = load_games(conn)?;
    let evals = load_evals(conn)?;
    let puzzle_days = load_puzzle_days(conn)?;
    let nodes = repertoire::load_nodes(conn).unwrap_or_default();
    let children = repertoire::book_children(&nodes);

    // Reihenfolge aufsteigend · Sessions, Trends und Fortschritt brauchen sie.
    let mut asc: Vec<&RawGame> = games.iter().collect();
    asc.sort_by_key(|g| (g.played_ts, g.id));

    let empty: Vec<Ev> = Vec::new();
    let mut views: Vec<GameView> = Vec::with_capacity(asc.len());
    for game in &asc {
        let rows = evals.get(&game.id).unwrap_or(&empty);
        let mut wp = Vec::with_capacity(rows.len());
        for ev in rows {
            wp.push(win_prob(ev.eval_cp, ev.mate_in));
        }
        let (book_departure, book_plies) = book_progress(&nodes, &children, game);
        views.push(GameView {
            raw: game,
            evals: rows,
            wp,
            clocks: clocks_of(game),
            book_departure,
            book_plies,
        });
    }

    let coverage = Coverage {
        games: views.len() as i64,
        analyzed: views.iter().filter(|v| !v.evals.is_empty()).count() as i64,
        with_clocks: views.iter().filter(|v| v.clocks.is_some()).count() as i64,
        moves_judged: views.iter().map(|v| v.evals.len() as i64).sum(),
        first_ts: asc.first().map(|g| g.played_ts).unwrap_or(0),
        last_ts: asc.last().map(|g| g.played_ts).unwrap_or(0),
    };

    let sessions = session_bounds(&views);

    Ok(DeepInsights {
        time: time_insights(&views, &sessions),
        content: content_insights(&views),
        benchmark: benchmark_insights(&views),
        sessions: session_insights(&views, &sessions, &puzzle_days),
        progress: progress_insights(conn, &views, &nodes, &children)?,
        repertoire: repertoire_insights(&views, &nodes, &children),
        formats: format_insights(&views),
        openings: opening_insights(&views),
        spotlight: spotlight(&views),
        coverage,
    })
}

/// Prüftiefe für den Buchabgleich · 20 Halbzüge sind zehn Züge und decken das
/// ab, was ein Amateurrepertoire realistisch enthält.
const BOOK_PLIES: usize = 20;

/// Liefert getrennt die fachliche Abweichung und die tatsächlich passende
/// Präfixlänge. `None` bei der Abweichung kann nämlich sowohl "bis zum Ende im
/// Buch" als auch "gespeicherte Linie ist hier zu Ende" heißen; nur die Länge
/// ist für die Kennzahl "bekannte Züge" eindeutig.
fn book_progress(
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
    game: &RawGame,
) -> (Option<(i64, bool)>, i64) {
    if nodes.is_empty() {
        return (None, 0);
    }
    let walk = repertoire::walk_book(children, &game.color, &game.moves, BOOK_PLIES);
    let book_plies = match &walk {
        Some(departure) => departure.ply - 1,
        None => game.moves.split_whitespace().take(BOOK_PLIES).count() as i64,
    };
    let departure = match walk {
        Some(departure) if departure.book_has_moves => {
            Some((departure.ply, game.mine(departure.ply)))
        }
        // Ende einer angelegten Linie ist keine Abweichung, aber auch kein
        // Freibrief, alle weiteren Eröffnungszüge als bekannt zu zählen.
        _ => None,
    };
    (departure, book_plies)
}

fn load_games(conn: &Connection) -> Result<Vec<RawGame>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, played_ts, source, time_class, color, result, moves, clocks,
                    time_control, my_elo, opp_elo, accuracy, opening
             FROM games
             WHERE analysis_excluded = 0 AND moves != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RawGame {
                id: r.get(0)?,
                played_ts: r.get(1)?,
                source: r.get(2)?,
                time_class: r.get(3)?,
                color: r.get(4)?,
                result: r.get(5)?,
                moves: r.get(6)?,
                clocks: r.get(7)?,
                time_control: r.get(8)?,
                my_elo: r.get(9)?,
                opp_elo: r.get(10)?,
                accuracy: r.get(11)?,
                opening: r.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_evals(conn: &Connection) -> Result<HashMap<i64, Vec<Ev>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.game_id, e.ply, e.san, e.eval_cp, e.mate_in, e.best_uci, e.judgment, e.phase
             FROM move_evals e
             JOIN games g ON g.id = e.game_id
             WHERE g.analysis_excluded = 0
             ORDER BY e.game_id, e.ply",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Ev {
                    ply: r.get(1)?,
                    san: r.get(2)?,
                    eval_cp: r.get(3)?,
                    mate_in: r.get(4)?,
                    best_uci: r.get(5)?,
                    judgment: r.get(6)?,
                    phase: r.get(7)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out: HashMap<i64, Vec<Ev>> = HashMap::new();
    for row in rows {
        let (game_id, ev) = row.map_err(|e| e.to_string())?;
        let list = out.entry(game_id).or_default();
        // Lücken in der Halbzugfolge dürfen die Indizierung nicht verschieben ·
        // `wp` und `evals` werden über den Index angesprochen.
        while list.len() as i64 + 1 < ev.ply {
            let ply = list.len() as i64 + 1;
            list.push(Ev {
                ply,
                san: String::new(),
                eval_cp: None,
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: String::new(),
            });
        }
        list.push(ev);
    }
    Ok(out)
}

/// UTC-Tag → Puzzleversuche, für den Aufwärm-Effekt.
fn load_puzzle_days(conn: &Connection) -> Result<HashMap<i64, i64>, String> {
    let mut stmt = conn
        .prepare("SELECT ts FROM puzzle_attempts")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?;
    let mut out: HashMap<i64, i64> = HashMap::new();
    for ts in rows {
        let ts = ts.map_err(|e| e.to_string())?;
        *out.entry(ts.div_euclid(86_400)).or_insert(0) += 1;
    }
    Ok(out)
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/// Sitzungsgrenze: mehr als eine Stunde Pause beginnt eine neue Sitzung.
const SESSION_GAP: i64 = 3_600;

/// Für jede Partie (Index in `views`): Sitzungsnummer und Position darin.
fn session_bounds(views: &[GameView]) -> Vec<(usize, i64)> {
    let mut out = Vec::with_capacity(views.len());
    let mut session = 0usize;
    let mut index = 0i64;
    let mut previous_ts = i64::MIN;
    for view in views {
        let ts = view.raw.played_ts;
        if ts <= 0 {
            // `played_ts = 0` heißt „Zeitpunkt unbekannt" (PGN-Importe ohne
            // Datum). Solche Partien hängen an der laufenden Sitzung, ohne eine
            // neue zu beginnen · sonst zerfiele jeder Import in Einzelsitzungen.
            if session == 0 {
                session = 1;
                index = 1;
            }
            out.push((session, index.max(1)));
            continue;
        }
        if previous_ts == i64::MIN || ts - previous_ts > SESSION_GAP {
            session += 1;
            index = 1;
        } else {
            index += 1;
        }
        previous_ts = ts;
        out.push((session, index));
    }
    out
}

// ── Block A · Zeitmanagement ─────────────────────────────────────────────────

fn time_insights(views: &[GameView], sessions: &[(usize, i64)]) -> TimeInsights {
    let mut out = TimeInsights::default();

    // Vier Tempostufen, gemessen am Anteil der Restzeit · absolute Sekunden
    // wären zwischen Bullet und Rapid nicht vergleichbar.
    let limits = [0.02f64, 0.08, 0.20];
    let keys = ["instant", "quick", "normal", "long"];
    let mut buckets = [(0i64, 0i64, 0i64, 0.0f64); 4];

    let mut balanced: Vec<f64> = Vec::new();
    let mut decided: Vec<f64> = Vec::new();
    let mut error_share: Vec<f64> = Vec::new();
    let mut ok_share: Vec<f64> = Vec::new();

    let (mut trouble_moves, mut trouble_errors) = (0i64, 0i64);
    let (mut safe_moves, mut safe_errors) = (0i64, 0i64);
    let mut trouble_games = 0i64;
    let mut first_trouble: Vec<f64> = Vec::new();
    let mut flag_losses = 0i64;
    let mut trouble_scores: Vec<f64> = Vec::new();
    let mut safe_scores: Vec<f64> = Vec::new();

    let (mut ahead, mut ahead_score, mut behind, mut behind_score) = (0i64, 0.0f64, 0i64, 0.0f64);
    let mut diffs: Vec<f64> = Vec::new();

    let mut book_time = 0.0f64;
    let mut total_time = 0.0f64;
    let mut book_moves = 0i64;
    let mut book_shares: Vec<f64> = Vec::new();
    let mut own_shares: Vec<f64> = Vec::new();
    let mut theory_games = 0i64;

    let (mut inc_games, mut inc_moves, mut inc_over) = (0i64, 0i64, 0i64);
    let mut inc_spent: Vec<f64> = Vec::new();
    let mut inc_value: Vec<f64> = Vec::new();

    let mut phase_moves = [0i64; 3];
    let mut phase_time = [0.0f64; 3];
    let mut phase_shares: [Vec<f64>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut phase_initial = 0.0f64;
    let mut phase_games = 0i64;

    let mut drift: BTreeMap<i64, (i64, Vec<f64>, f64)> = BTreeMap::new();

    for (position, view) in views.iter().enumerate() {
        let Some(clocks) = &view.clocks else { continue };
        out.games += 1;
        let plies = clocks.remaining.len() as i64;
        let trouble_limit = clocks.initial * 0.10;
        let mut game_trouble = false;
        let mut game_shares: Vec<f64> = Vec::new();
        let mut game_book_moves = 0i64;

        if clocks.increment > 0.0 {
            inc_games += 1;
        }
        phase_games += 1;
        phase_initial += clocks.initial;

        for ply in 1..=plies {
            if !view.raw.mine(ply) {
                continue;
            }
            let Some((spent, share)) = clocks.spent(ply) else {
                continue;
            };
            out.moves += 1;
            total_time += spent;
            game_shares.push(share);

            let bucket = limits.iter().position(|limit| share < *limit).unwrap_or(3);
            buckets[bucket].0 += 1;
            buckets[bucket].3 += share;

            let judgment = view
                .evals
                .get((ply - 1) as usize)
                .map(|e| e.judgment.as_str());
            let is_error = matches!(judgment, Some("mistake") | Some("blunder"));
            if is_error {
                buckets[bucket].1 += 1;
                if judgment == Some("blunder") {
                    buckets[bucket].2 += 1;
                }
                error_share.push(share);
            } else if judgment.is_some() {
                ok_share.push(share);
            }

            // Zeit gegen Stellungswert: Wo wird nachgedacht, wo nicht?
            // Vor dem ersten Halbzug gibt es keine gespeicherte Bewertung ·
            // die Grundstellung gilt als ausgeglichen.
            let before = if ply == 1 {
                Some(0.0)
            } else {
                view.cp_mine(ply - 1)
            };
            if let Some(cp) = before {
                if cp.abs() <= 100.0 {
                    balanced.push(share);
                } else if cp.abs() >= 300.0 {
                    decided.push(share);
                }
            }

            // Zeitnot
            if clocks.before(ply) < trouble_limit {
                trouble_moves += 1;
                if is_error {
                    trouble_errors += 1;
                }
                if !game_trouble {
                    game_trouble = true;
                    first_trouble.push(((ply + 1) / 2) as f64);
                }
            } else {
                safe_moves += 1;
                if is_error {
                    safe_errors += 1;
                }
            }

            // Buchzeit: nur ein vom Start bis zu diesem Halbzug lückenlos
            // passender Pfad im eigenen Weiß-/Schwarz-Repertoire zählt.
            if ply <= view.book_plies {
                book_time += spent;
                book_moves += 1;
                game_book_moves += 1;
                book_shares.push(share);
            } else {
                own_shares.push(share);
            }

            if clocks.increment > 0.0 {
                inc_moves += 1;
                inc_spent.push(spent);
                if spent > clocks.increment {
                    inc_over += 1;
                }
            }

            let phase = view
                .evals
                .get((ply - 1) as usize)
                .map(|e| phase_index(&e.phase))
                .unwrap_or(if ply <= 20 { 0 } else { 1 });
            phase_moves[phase] += 1;
            phase_time[phase] += spent;
            phase_shares[phase].push(share);
        }

        if clocks.increment > 0.0 {
            inc_value.push(clocks.increment);
        }
        if game_book_moves > 0 {
            theory_games += 1;
        }
        if game_trouble {
            trouble_games += 1;
            trouble_scores.push(view.raw.score());
        } else {
            safe_scores.push(view.raw.score());
        }
        if view.raw.result == "loss" {
            if let Some(last) = clocks.last_of(view.raw.my_white()) {
                if last < 2.0 {
                    flag_losses += 1;
                }
            }
        }

        // Uhrvorsprung am 60-%-Punkt: früh genug, um noch etwas zu bedeuten,
        // spät genug, dass sich ein Unterschied aufgebaut hat.
        let mark = ((plies as f64) * 0.6).round() as i64;
        if mark >= 4 {
            let mine = last_before(clocks, mark, view.raw.my_white());
            let theirs = last_before(clocks, mark, !view.raw.my_white());
            if let (Some(mine), Some(theirs)) = (mine, theirs) {
                let diff = mine - theirs;
                diffs.push(diff);
                if diff > 0.0 {
                    ahead += 1;
                    ahead_score += view.raw.score();
                } else {
                    behind += 1;
                    behind_score += view.raw.score();
                }
            }
        }

        // Tempo-Drift über die Sitzung
        if let (Some(avg), Some((_, index))) = (mean(&game_shares), sessions.get(position)) {
            let key = (*index).min(5);
            let entry = drift.entry(key).or_insert((0, Vec::new(), 0.0));
            entry.0 += 1;
            entry.1.push(avg);
            entry.2 += view.raw.score();
        }
    }

    out.by_speed = keys
        .iter()
        .enumerate()
        .map(|(i, key)| {
            let (moves, errors, blunders, share_sum) = buckets[i];
            SpeedBucket {
                key: (*key).to_string(),
                moves,
                errors,
                blunders,
                errors_per_100: if moves > 0 {
                    r1(errors as f64 / moves as f64 * 100.0)
                } else {
                    0.0
                },
                avg_loss: 0.0,
                share_pct: if moves > 0 {
                    r1(share_sum / moves as f64 * 100.0)
                } else {
                    0.0
                },
            }
        })
        .collect();
    // Verluste pro Tempostufe brauchen die Bewertungen · zweiter, billiger Lauf.
    fill_speed_losses(views, &limits, &mut out.by_speed);

    out.focus = TimeFocus {
        balanced_share: r1(mean(&balanced).unwrap_or(0.0) * 100.0),
        decided_share: r1(mean(&decided).unwrap_or(0.0) * 100.0),
        balanced_moves: balanced.len() as i64,
        decided_moves: decided.len() as i64,
        error_share: r1(mean(&error_share).unwrap_or(0.0) * 100.0),
        ok_share: r1(mean(&ok_share).unwrap_or(0.0) * 100.0),
    };

    out.trouble = TimeTrouble {
        moves: trouble_moves,
        share_pct: pct(trouble_moves as f64, (trouble_moves + safe_moves) as f64),
        errors_per_100: if trouble_moves > 0 {
            r1(trouble_errors as f64 / trouble_moves as f64 * 100.0)
        } else {
            0.0
        },
        baseline_per_100: if safe_moves > 0 {
            r1(safe_errors as f64 / safe_moves as f64 * 100.0)
        } else {
            0.0
        },
        games: trouble_games,
        games_pct: pct(trouble_games as f64, out.games as f64),
        first_move: r1(mean(&first_trouble).unwrap_or(0.0)),
        flag_losses,
        score_in_trouble: r1(mean(&trouble_scores).unwrap_or(0.0) * 100.0),
        score_without: r1(mean(&safe_scores).unwrap_or(0.0) * 100.0),
    };

    out.edge = ClockEdge {
        games: ahead + behind,
        ahead_games: ahead,
        ahead_score: pct(ahead_score, ahead as f64),
        behind_games: behind,
        behind_score: pct(behind_score, behind as f64),
        avg_diff: r1(mean(&diffs).unwrap_or(0.0)),
    };

    out.theory = TheoryTime {
        games: theory_games,
        book_share_pct: pct(book_time, total_time),
        book_moves,
        book_avg_share: r1(mean(&book_shares).unwrap_or(0.0) * 100.0),
        own_avg_share: r1(mean(&own_shares).unwrap_or(0.0) * 100.0),
    };

    out.increment = IncrementBalance {
        games: inc_games,
        moves: inc_moves,
        over_increment_pct: pct(inc_over as f64, inc_moves as f64),
        avg_spent: r1(mean(&inc_spent).unwrap_or(0.0)),
        increment: r1(mean(&inc_value).unwrap_or(0.0)),
    };

    out.drift = drift
        .into_iter()
        .map(|(index, (games, shares, score))| DriftPoint {
            index,
            games,
            avg_share: r1(mean(&shares).unwrap_or(0.0) * 100.0),
            score_pct: pct(score, games as f64),
        })
        .collect();

    let avg_initial = if phase_games > 0 {
        phase_initial / phase_games as f64
    } else {
        0.0
    };
    out.by_phase = PHASES
        .iter()
        .enumerate()
        .map(|(i, phase)| PhaseTime {
            phase: (*phase).to_string(),
            moves: phase_moves[i],
            clock_pct: if avg_initial > 0.0 && phase_games > 0 {
                pct(phase_time[i] / phase_games as f64, avg_initial)
            } else {
                0.0
            },
            avg_share: r1(mean(&phase_shares[i]).unwrap_or(0.0) * 100.0),
        })
        .collect();

    out
}

/// Restzeit der gesuchten Seite bei oder vor Halbzug `mark`.
fn last_before(clocks: &Clocks, mark: i64, white: bool) -> Option<f64> {
    (1..=mark.min(clocks.remaining.len() as i64))
        .rev()
        .find(|ply| white_plays(*ply) == white)
        .and_then(|ply| clocks.remaining.get((ply - 1) as usize).copied())
}

fn fill_speed_losses(views: &[GameView], limits: &[f64; 3], buckets: &mut [SpeedBucket]) {
    let mut sums = [(0.0f64, 0i64); 4];
    for view in views {
        let Some(clocks) = &view.clocks else { continue };
        for ply in 1..=clocks.remaining.len() as i64 {
            if !view.raw.mine(ply) {
                continue;
            }
            let (Some((_, share)), Some(loss)) = (clocks.spent(ply), view.loss(ply)) else {
                continue;
            };
            if view.evals.get((ply - 1) as usize).is_none() {
                continue;
            }
            let bucket = limits.iter().position(|limit| share < *limit).unwrap_or(3);
            sums[bucket].0 += loss;
            sums[bucket].1 += 1;
        }
    }
    for (i, bucket) in buckets.iter_mut().enumerate() {
        if sums[i].1 > 0 {
            bucket.avg_loss = r1(sums[i].0 / sums[i].1 as f64 * 100.0);
        }
    }
}

// ── Block C · Partieinhalt ───────────────────────────────────────────────────

/// Obergrenze für die Partieinhalt-Auswertung.
///
/// Block C ist der einzige Teil, der jede Partie nachspielen muss (für die
/// Eigenschaften des übersehenen Bestzuges und das Materialbild beim
/// Endspieleintritt). Bei mehreren tausend analysierten Partien wird das
/// spürbar, und die ältesten Partien sagen ohnehin am wenigsten über das
/// heutige Spiel. Gerechnet wird deshalb über die jüngsten Partien · wie viele
/// es waren, steht als `content.games` in der Oberfläche.
const CONTENT_LIMIT: usize = 600;

fn content_insights(views: &[GameView]) -> ContentInsights {
    let analyzed: Vec<&GameView> = views.iter().filter(|v| !v.evals.is_empty()).collect();
    let recent = &analyzed[analyzed.len().saturating_sub(CONTENT_LIMIT)..];
    content_from(recent)
}

fn content_from(views: &[&GameView]) -> ContentInsights {
    let mut out = ContentInsights::default();

    let (mut conv_games, mut conv_won, mut conv_drawn, mut conv_lost) = (0i64, 0i64, 0i64, 0i64);
    let mut conv_score = 0.0f64;
    let mut lost_at: Vec<f64> = Vec::new();
    let mut conv_phase = [0i64; 3];

    let (mut def_games, mut def_saved) = (0i64, 0i64);

    let mut decisive_moves: Vec<f64> = Vec::new();
    let mut decisive_phase = [0i64; 3];

    let (mut chances, mut missed) = (0i64, 0i64);

    let (mut errors, mut forcing_missed) = (0i64, 0i64);
    let (mut forcing_total, mut forcing_all) = (0i64, 0i64);
    let mut piece_errors: HashMap<&'static str, (i64, i64)> = HashMap::new();
    let mut forcing_losses: Vec<f64> = Vec::new();
    let mut quiet_losses: Vec<f64> = Vec::new();

    let mut endgames: HashMap<&'static str, (i64, f64, Vec<f64>)> = HashMap::new();

    for view in views {
        out.games += 1;
        let plies = view.evals.len() as i64;

        // Nachspielen brauchen wir für die Stellungen: Bestzug-Eigenschaften
        // und das Materialbild beim Endspieleintritt.
        let walked = chess::walk_sans(&view.raw.moves);

        let mut peak = f64::MIN;
        let mut low = f64::MAX;
        let mut advantage_lost_at: Option<i64> = None;
        for ply in 1..=plies {
            let Some(cp) = view.cp_mine(ply) else {
                continue;
            };
            if cp > peak {
                peak = cp;
            }
            if cp < low {
                low = cp;
            }
            if peak >= 200.0 && cp < 50.0 && advantage_lost_at.is_none() {
                advantage_lost_at = Some(ply);
            }
        }

        if peak >= 200.0 {
            conv_games += 1;
            conv_score += view.raw.score();
            match view.raw.result.as_str() {
                "win" => conv_won += 1,
                "draw" => conv_drawn += 1,
                _ => conv_lost += 1,
            }
            if view.raw.result != "win" {
                if let Some(ply) = advantage_lost_at {
                    lost_at.push(((ply + 1) / 2) as f64);
                    if let Some(ev) = view.evals.get((ply - 1) as usize) {
                        conv_phase[phase_index(&ev.phase)] += 1;
                    }
                }
            }
        }
        if low <= -200.0 {
            def_games += 1;
            if view.raw.result != "loss" {
                def_saved += 1;
            }
        }

        // Punkt ohne Rückkehr: letzter Halbzug, an dem ±150 zuletzt gekreuzt
        // wurde und danach nie mehr zurück.
        let mut crossing: Option<i64> = None;
        let mut previous_side: Option<bool> = None;
        for ply in 1..=plies {
            let Some(cp) = view.cp_mine(ply) else {
                continue;
            };
            if cp.abs() < 150.0 {
                previous_side = None;
                continue;
            }
            let side = cp > 0.0;
            if previous_side != Some(side) {
                crossing = Some(ply);
            }
            previous_side = Some(side);
        }
        if let Some(ply) = crossing {
            decisive_moves.push(((ply + 1) / 2) as f64);
            if let Some(ev) = view.evals.get((ply - 1) as usize) {
                decisive_phase[phase_index(&ev.phase)] += 1;
            }
        }

        for ply in 1..=plies {
            let Some(ev) = view.evals.get((ply - 1) as usize) else {
                continue;
            };
            if view.raw.mine(ply) {
                // Fehler-Anatomie
                let is_error = matches!(ev.judgment.as_str(), "mistake" | "blunder");
                let piece = piece_of_san(&ev.san);
                let entry = piece_errors.entry(piece).or_insert((0, 0));
                entry.1 += 1;
                if is_error {
                    entry.0 += 1;
                    errors += 1;
                }

                // Eigenschaften des übersehenen Bestzuges.
                let traits = if ev.best_uci.is_empty() {
                    None
                } else {
                    walked
                        .get((ply - 1) as usize)
                        .and_then(|w| chess::uci_traits(&w.fen_before, &ev.best_uci))
                };
                if let Some(traits) = traits {
                    let forcing = traits.forcing();
                    forcing_all += 1;
                    if forcing {
                        forcing_total += 1;
                    }
                    if let Some(loss) = view.loss(ply) {
                        if forcing {
                            forcing_losses.push(loss);
                        } else {
                            quiet_losses.push(loss);
                        }
                    }
                    if is_error && forcing {
                        forcing_missed += 1;
                    }
                }
            } else if matches!(ev.judgment.as_str(), "mistake" | "blunder") {
                // Verpasste Bestrafung: mein direkt folgender Zug.
                if view.evals.get(ply as usize).is_some() {
                    chances += 1;
                    if view.loss(ply + 1).unwrap_or(0.0) >= 0.10 {
                        missed += 1;
                    }
                }
            }
        }

        // Endspieltyp beim ersten Halbzug mit Endspielphase.
        if let Some(entry) = view.evals.iter().find(|e| e.phase == "endgame") {
            if let Some(walk) = walked.get((entry.ply - 1) as usize) {
                if let Some(placement) = walk.fen_after.split(' ').next() {
                    let key = endgame_signature(placement);
                    let bucket = endgames.entry(key).or_insert((0, 0.0, Vec::new()));
                    bucket.0 += 1;
                    bucket.1 += view.raw.score();
                    if let Some(accuracy) = view.raw.accuracy {
                        bucket.2.push(accuracy);
                    }
                }
            }
        }
    }

    out.conversion = Conversion {
        games: conv_games,
        won: conv_won,
        drawn: conv_drawn,
        lost: conv_lost,
        score_pct: pct(conv_score, conv_games as f64),
        lost_at_move: r1(mean(&lost_at).unwrap_or(0.0)),
        phase: PHASES[argmax(&conv_phase)].to_string(),
    };
    out.defense = Defense {
        games: def_games,
        saved: def_saved,
        save_pct: pct(def_saved as f64, def_games as f64),
    };
    let decisive_games: i64 = decisive_phase.iter().sum();
    out.decisive = Decisive {
        games: decisive_games,
        avg_move: r1(mean(&decisive_moves).unwrap_or(0.0)),
        by_phase: PHASES
            .iter()
            .enumerate()
            .map(|(i, phase)| PhaseShare {
                phase: (*phase).to_string(),
                games: decisive_phase[i],
                share_pct: pct(decisive_phase[i] as f64, decisive_games as f64),
            })
            .collect(),
    };
    out.punishment = MissedPunishment {
        chances,
        missed,
        missed_pct: pct(missed as f64, chances as f64),
    };

    let mut by_piece: Vec<PieceErrors> = piece_errors
        .into_iter()
        .map(|(piece, (errors, moves))| PieceErrors {
            piece: piece.to_string(),
            errors,
            moves,
            errors_per_100: if moves > 0 {
                r1(errors as f64 / moves as f64 * 100.0)
            } else {
                0.0
            },
        })
        .collect();
    by_piece.sort_by(|a, b| b.errors.cmp(&a.errors).then(a.piece.cmp(&b.piece)));

    out.anatomy = Anatomy {
        errors,
        forcing_missed,
        forcing_pct: pct(forcing_missed as f64, errors as f64),
        forcing_base_pct: pct(forcing_total as f64, forcing_all as f64),
        by_piece,
        forcing_loss: r1(mean(&forcing_losses).unwrap_or(0.0) * 100.0),
        quiet_loss: r1(mean(&quiet_losses).unwrap_or(0.0) * 100.0),
        forcing_moves: forcing_losses.len() as i64,
        quiet_moves: quiet_losses.len() as i64,
    };

    let mut list: Vec<EndgameType> = endgames
        .into_iter()
        .map(|(key, (games, score, accuracies))| EndgameType {
            key: key.to_string(),
            games,
            score_pct: pct(score, games as f64),
            accuracy: mean(&accuracies).map(r1),
        })
        .collect();
    list.sort_by(|a, b| b.games.cmp(&a.games).then(a.key.cmp(&b.key)));
    out.endgames = list;

    out
}

fn argmax(values: &[i64; 3]) -> usize {
    let mut best = 0;
    for (i, value) in values.iter().enumerate() {
        if *value > values[best] {
            best = i;
        }
    }
    best
}

// ── Block D · Feld-Vergleich ─────────────────────────────────────────────────

/// Fenster um das eigene Rating, in dem Gegner als „gleich stark" gelten.
const FIELD_WINDOW: i64 = 150;

fn benchmark_insights(views: &[GameView]) -> BenchmarkInsights {
    let mut out = BenchmarkInsights::default();
    let mut elos: Vec<f64> = Vec::new();

    struct Acc {
        losses: Vec<f64>,
        errors: i64,
        blunders: i64,
        phase_losses: [Vec<f64>; 3],
        phase_blunders: [i64; 3],
        phase_moves: [i64; 3],
        shares: Vec<f64>,
        trouble: i64,
        timed: i64,
    }
    impl Acc {
        fn new() -> Self {
            Acc {
                losses: Vec::new(),
                errors: 0,
                blunders: 0,
                phase_losses: [Vec::new(), Vec::new(), Vec::new()],
                phase_blunders: [0; 3],
                phase_moves: [0; 3],
                shares: Vec::new(),
                trouble: 0,
                timed: 0,
            }
        }
        fn finish(self) -> Option<SideMetrics> {
            let moves = self.losses.len() as i64;
            if moves == 0 {
                return None;
            }
            Some(SideMetrics {
                moves,
                avg_loss: r1(mean(&self.losses).unwrap_or(0.0) * 100.0),
                errors_per_100: r1(self.errors as f64 / moves as f64 * 100.0),
                blunders_per_100: r1(self.blunders as f64 / moves as f64 * 100.0),
                accuracy: accuracy_from_losses(&self.losses),
                by_phase: PHASES
                    .iter()
                    .enumerate()
                    .map(|(i, phase)| PhaseMetric {
                        phase: (*phase).to_string(),
                        moves: self.phase_moves[i],
                        blunders_per_100: if self.phase_moves[i] > 0 {
                            r1(self.phase_blunders[i] as f64 / self.phase_moves[i] as f64 * 100.0)
                        } else {
                            0.0
                        },
                        avg_loss: r1(mean(&self.phase_losses[i]).unwrap_or(0.0) * 100.0),
                    })
                    .collect(),
                avg_share: if self.timed > 0 {
                    mean(&self.shares).map(|v| r1(v * 100.0))
                } else {
                    None
                },
                trouble_pct: if self.timed > 0 {
                    Some(pct(self.trouble as f64, self.timed as f64))
                } else {
                    None
                },
            })
        }
    }

    let mut me = Acc::new();
    let mut field = Acc::new();

    for view in views {
        let raw = view.raw;
        if view.evals.is_empty() || raw.my_elo <= 0 || raw.opp_elo <= 0 {
            continue;
        }
        if (raw.opp_elo - raw.my_elo).abs() > FIELD_WINDOW {
            continue;
        }
        out.games += 1;
        elos.push(raw.opp_elo as f64);

        for ply in 1..=view.evals.len() as i64 {
            let Some(ev) = view.evals.get((ply - 1) as usize) else {
                continue;
            };
            if ev.phase.is_empty() {
                continue;
            }
            let Some(loss) = view.loss(ply) else { continue };
            let acc = if raw.mine(ply) { &mut me } else { &mut field };
            let phase = phase_index(&ev.phase);
            acc.losses.push(loss);
            acc.phase_losses[phase].push(loss);
            acc.phase_moves[phase] += 1;
            match ev.judgment.as_str() {
                "blunder" => {
                    acc.errors += 1;
                    acc.blunders += 1;
                    acc.phase_blunders[phase] += 1;
                }
                "mistake" => acc.errors += 1,
                _ => {}
            }
            if let Some(clocks) = &view.clocks {
                if let Some((_, share)) = clocks.spent(ply) {
                    acc.shares.push(share);
                    acc.timed += 1;
                    if clocks.before(ply) < clocks.initial * 0.10 {
                        acc.trouble += 1;
                    }
                }
            }
        }
    }

    out.avg_opp_elo = mean(&elos).unwrap_or(0.0).round() as i64;
    out.me = me.finish();
    out.field = field.finish();
    out
}

// ── Block E · Sessions ───────────────────────────────────────────────────────

fn session_insights(
    views: &[GameView],
    sessions: &[(usize, i64)],
    puzzle_days: &HashMap<i64, i64>,
) -> SessionInsights {
    let mut out = SessionInsights::default();
    if views.is_empty() {
        return out;
    }

    let mut by_index: BTreeMap<i64, (i64, f64, Vec<f64>)> = BTreeMap::new();
    let mut per_session: BTreeMap<usize, (i64, i64, i64)> = BTreeMap::new(); // (Partien, erstes Elo, letztes Elo)

    let (mut fast_games, mut fast_score, mut slow_games, mut slow_score) = (0i64, 0.0, 0i64, 0.0);
    let (mut first_games, mut first_score, mut rest_games, mut rest_score) = (0i64, 0.0, 0i64, 0.0);
    let (mut primed_games, mut primed_score, mut cold_games, mut cold_score) =
        (0i64, 0.0, 0i64, 0.0);
    let mut seen_days: HashMap<i64, bool> = HashMap::new();

    for (position, view) in views.iter().enumerate() {
        let raw = view.raw;
        let Some((session, index)) = sessions.get(position).copied() else {
            continue;
        };

        let key = index.min(5);
        let entry = by_index.entry(key).or_insert((0, 0.0, Vec::new()));
        entry.0 += 1;
        entry.1 += raw.score();
        if let Some(accuracy) = raw.accuracy {
            entry.2.push(accuracy);
        }

        if raw.my_elo > 0 {
            let session_entry = per_session
                .entry(session)
                .or_insert((0, raw.my_elo, raw.my_elo));
            session_entry.0 += 1;
            session_entry.2 = raw.my_elo;
        }

        // Wie schnell ging es nach einer Niederlage weiter?
        if position > 0 {
            let previous = &views[position - 1];
            if previous.raw.result == "loss" && sessions[position - 1].0 == session {
                let gap = raw.played_ts - previous.raw.played_ts;
                if gap > 0 && gap <= REQUEUE_LIMIT {
                    fast_games += 1;
                    fast_score += raw.score();
                } else {
                    slow_games += 1;
                    slow_score += raw.score();
                }
            }
        }

        // Aufwärmeffekt: erste Partie eines Kalendertages.
        if raw.played_ts > 0 {
            let day = raw.played_ts.div_euclid(86_400);
            let is_first = !seen_days.contains_key(&day);
            seen_days.insert(day, true);
            if is_first {
                first_games += 1;
                first_score += raw.score();
                // Wurde an diesem Tag vorher trainiert? Puzzleversuche zählen
                // tagesweise, deshalb genügt „mindestens fünf am selben Tag".
                if puzzle_days.get(&day).copied().unwrap_or(0) >= 5 {
                    primed_games += 1;
                    primed_score += raw.score();
                } else {
                    cold_games += 1;
                    cold_score += raw.score();
                }
            } else {
                rest_games += 1;
                rest_score += raw.score();
            }
        }
    }

    out.sessions = sessions.iter().map(|(s, _)| *s).max().unwrap_or(0) as i64;
    out.avg_games = if out.sessions > 0 {
        r1(views.len() as f64 / out.sessions as f64)
    } else {
        0.0
    };
    out.by_index = by_index
        .into_iter()
        .map(|(index, (games, score, accuracies))| SessionIndex {
            index,
            games,
            score_pct: pct(score, games as f64),
            accuracy: mean(&accuracies).map(r1),
        })
        .collect();

    // Empfehlung: erster Index mit belastbarem Abfall gegenüber Partie 1.
    if let Some(first) = out.by_index.first().map(|b| b.score_pct) {
        for bucket in out.by_index.iter().skip(1) {
            if bucket.games >= 10 && bucket.score_pct <= first - 5.0 {
                out.recommended_length = bucket.index - 1;
                break;
            }
        }
    }

    out.requeue = Requeue {
        fast_games,
        fast_score: pct(fast_score, fast_games as f64),
        slow_games,
        slow_score: pct(slow_score, slow_games as f64),
        threshold: REQUEUE_LIMIT,
    };
    out.warmup = Warmup {
        first_games,
        first_score: pct(first_score, first_games as f64),
        rest_games,
        rest_score: pct(rest_score, rest_games as f64),
        primed_games,
        primed_score: pct(primed_score, primed_games as f64),
        cold_games,
        cold_score: pct(cold_score, cold_games as f64),
    };

    let mut deltas: Vec<i64> = per_session
        .values()
        .filter(|(games, first, last)| *games >= 2 && *first > 0 && *last > 0)
        .map(|(_, first, last)| last - first)
        .collect();
    deltas.sort();
    let total_loss: i64 = deltas.iter().filter(|d| **d < 0).sum();
    let worst3: i64 = deltas.iter().take(3).filter(|d| **d < 0).sum();
    out.damage = SessionDamage {
        sessions: deltas.len() as i64,
        total_loss,
        worst3_pct: if total_loss < 0 {
            pct(worst3 as f64, total_loss as f64)
        } else {
            0.0
        },
        worst_delta: deltas.first().copied().unwrap_or(0),
    };

    out
}

/// „Sofort weiter" nach einer Niederlage · zwei Minuten.
const REQUEUE_LIMIT: i64 = 120;

// ── Block F · Fortschritt ────────────────────────────────────────────────────

fn progress_insights(
    conn: &Connection,
    views: &[GameView],
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
) -> Result<ProgressInsights, String> {
    let mut out = ProgressInsights::default();

    struct Month {
        games: i64,
        score: f64,
        accuracies: Vec<f64>,
        rating: Option<i64>,
        my_moves: i64,
        blunders: i64,
    }
    let mut months: BTreeMap<String, Month> = BTreeMap::new();

    for view in views {
        let raw = view.raw;
        if raw.played_ts <= 0 {
            continue;
        }
        let key = month_key(raw.played_ts);
        let entry = months.entry(key).or_insert(Month {
            games: 0,
            score: 0.0,
            accuracies: Vec::new(),
            rating: None,
            my_moves: 0,
            blunders: 0,
        });
        entry.games += 1;
        entry.score += raw.score();
        if let Some(accuracy) = raw.accuracy {
            entry.accuracies.push(accuracy);
        }
        if raw.my_elo > 0 {
            entry.rating = Some(raw.my_elo);
        }
        for ply in 1..=view.evals.len() as i64 {
            if !raw.mine(ply) {
                continue;
            }
            if let Some(ev) = view.evals.get((ply - 1) as usize) {
                if ev.phase.is_empty() {
                    continue;
                }
                entry.my_moves += 1;
                if ev.judgment == "blunder" {
                    entry.blunders += 1;
                }
            }
        }
    }

    // Puzzleaufkommen je Monat aus derselben Quelle wie der Puzzle-Reiter.
    let mut puzzles: HashMap<String, (i64, i64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT ts, solved FROM puzzle_attempts")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (ts, solved) = row.map_err(|e| e.to_string())?;
            let entry = puzzles.entry(month_key(ts)).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += solved;
        }
    }

    out.months = months
        .into_iter()
        .map(|(month, data)| {
            let (attempts, solved) = puzzles.get(&month).copied().unwrap_or((0, 0));
            MonthPoint {
                score_pct: pct(data.score, data.games as f64),
                accuracy: mean(&data.accuracies).map(r1),
                rating: data.rating,
                blunders_per_100: if data.my_moves > 0 {
                    Some(r1(data.blunders as f64 / data.my_moves as f64 * 100.0))
                } else {
                    None
                },
                games: data.games,
                month,
                puzzle_attempts: attempts,
                puzzle_solved: solved,
            }
        })
        .collect();
    // Der Verlauf soll die jüngere Entwicklung zeigen, nicht die Frühgeschichte.
    if out.months.len() > 18 {
        out.months = out.months.split_off(out.months.len() - 18);
    }

    let with_accuracy: Vec<f64> = out.months.iter().filter_map(|m| m.accuracy).collect();
    if with_accuracy.len() >= 4 {
        let half = with_accuracy.len() / 2;
        let early = mean(&with_accuracy[..half]);
        let late = mean(&with_accuracy[half..]);
        if let (Some(early), Some(late)) = (early, late) {
            out.accuracy_delta = Some(r1(late - early));
        }
    }
    let ratings: Vec<i64> = out.months.iter().filter_map(|m| m.rating).collect();
    if ratings.len() >= 2 {
        out.rating_delta = Some(ratings[ratings.len() - 1] - ratings[0]);
    }

    out.themes = theme_progress(conn)?;
    out.rep_effect = rep_effect(views, nodes, children);
    Ok(out)
}

fn month_key(ts: i64) -> String {
    // Ohne Kalenderbibliothek: aus dem Tagesindex Jahr und Monat rechnen.
    let days = ts.div_euclid(86_400);
    let (year, month, _) = civil_from_days(days);
    format!("{year:04}-{month:02}")
}

/// Tagesindex → (Jahr, Monat, Tag) nach Howard Hinnants `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn theme_progress(conn: &Connection) -> Result<Vec<ThemeProgress>, String> {
    let mut stmt = conn
        .prepare("SELECT solved, themes FROM puzzle_attempts ORDER BY ts, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut per_theme: HashMap<String, Vec<bool>> = HashMap::new();
    for row in rows {
        let (solved, themes) = row.map_err(|e| e.to_string())?;
        for theme in themes.split_whitespace() {
            per_theme
                .entry(theme.to_string())
                .or_default()
                .push(solved != 0);
        }
    }

    // Lernkurve: erste gegen zweite Hälfte der Versuche eines Motivs. Unter 20
    // Versuchen ist die Differenz reines Rauschen.
    let mut out: Vec<ThemeProgress> = per_theme
        .into_iter()
        .filter(|(_, attempts)| attempts.len() >= 20)
        .map(|(theme, attempts)| {
            let half = attempts.len() / 2;
            let rate = |slice: &[bool]| -> f64 {
                pct(
                    slice.iter().filter(|s| **s).count() as f64,
                    slice.len() as f64,
                )
            };
            let early = rate(&attempts[..half]);
            let late = rate(&attempts[half..]);
            ThemeProgress {
                theme,
                attempts: attempts.len() as i64,
                early_pct: early,
                late_pct: late,
                delta: r1(late - early),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.delta
            .partial_cmp(&a.delta)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.theme.cmp(&b.theme))
    });
    out.truncate(12);
    Ok(out)
}

/// Wirkt das Repertoiretraining? Partien, die eine trainierte Linie erreichten,
/// vor dem ersten Review gegen die danach.
fn rep_effect(
    views: &[GameView],
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
) -> RepEffect {
    let mut out = RepEffect::default();
    if nodes.is_empty() {
        return out;
    }
    // Frühester Review je Knoten · `last_ts` ist der letzte, das genügt als
    // Trennlinie: davor war die Linie sicher untrainiert.
    let trained: HashMap<i64, i64> = nodes
        .iter()
        .filter(|n| n.reps > 0 && n.due_ts > 0)
        .map(|n| (n.id, n.due_ts))
        .collect();
    if trained.is_empty() {
        return out;
    }

    for view in views {
        let raw = view.raw;
        if raw.played_ts <= 0 {
            continue;
        }
        // Tiefster erreichter Buchknoten dieser Partie.
        let mut node_id = 0i64;
        let mut trained_ts: Option<i64> = None;
        for san in raw.moves.split_whitespace().take(BOOK_PLIES) {
            let kids = children.get(&(raw.color.clone(), node_id));
            match kids.and_then(|k| k.iter().find(|(s, _)| s == san)) {
                Some((_, id)) => {
                    node_id = *id;
                    if let Some(ts) = trained.get(id) {
                        trained_ts = Some(*ts);
                    }
                }
                None => break,
            }
        }
        let Some(ts) = trained_ts else { continue };
        if raw.played_ts < ts {
            out.before_games += 1;
            out.before_score += raw.score();
        } else {
            out.after_games += 1;
            out.after_score += raw.score();
        }
    }
    out.before_score = pct(out.before_score, out.before_games as f64);
    out.after_score = pct(out.after_score, out.after_games as f64);
    out
}

// ── Block B · Repertoire-Abweichung ──────────────────────────────────────────

fn repertoire_insights(
    views: &[GameView],
    nodes: &[repertoire::RepNodeOut],
    children: &repertoire::BookChildren,
) -> RepertoireInsights {
    let mut out = RepertoireInsights {
        nodes: nodes.len() as i64,
        plies: BOOK_PLIES as i64,
        ..Default::default()
    };
    if nodes.is_empty() {
        return out;
    }

    struct Side {
        games: i64,
        mine: i64,
        mine_score: f64,
        mine_plies: Vec<f64>,
        theirs: i64,
        theirs_score: f64,
        theirs_plies: Vec<f64>,
        in_book: i64,
        in_book_score: f64,
    }
    let mut sides: BTreeMap<String, Side> = BTreeMap::new();
    let mut node_games: HashMap<i64, i64> = HashMap::new();

    for view in views {
        let raw = view.raw;
        let side = sides.entry(raw.color.clone()).or_insert(Side {
            games: 0,
            mine: 0,
            mine_score: 0.0,
            mine_plies: Vec::new(),
            theirs: 0,
            theirs_score: 0.0,
            theirs_plies: Vec::new(),
            in_book: 0,
            in_book_score: 0.0,
        });
        side.games += 1;

        // Erreichte Buchknoten zählen · Grundlage für „wackelige Linien".
        let mut node_id = 0i64;
        for san in raw.moves.split_whitespace().take(BOOK_PLIES) {
            match children
                .get(&(raw.color.clone(), node_id))
                .and_then(|k| k.iter().find(|(s, _)| s == san))
            {
                Some((_, id)) => {
                    node_id = *id;
                    *node_games.entry(*id).or_insert(0) += 1;
                }
                None => break,
            }
        }

        match repertoire::walk_book(children, &raw.color, &raw.moves, BOOK_PLIES) {
            Some(departure) if departure.book_has_moves => {
                let move_number = ((departure.ply + 1) / 2) as f64;
                if raw.mine(departure.ply) {
                    side.mine += 1;
                    side.mine_score += raw.score();
                    side.mine_plies.push(move_number);
                } else {
                    side.theirs += 1;
                    side.theirs_score += raw.score();
                    side.theirs_plies.push(move_number);
                }
            }
            _ => {
                side.in_book += 1;
                side.in_book_score += raw.score();
            }
        }
    }

    out.checked_games = views.len() as i64;
    out.by_side = sides
        .into_iter()
        .map(|(side, data)| DeviationSide {
            side,
            games: data.games,
            mine: data.mine,
            mine_score: pct(data.mine_score, data.mine as f64),
            theirs: data.theirs,
            theirs_score: pct(data.theirs_score, data.theirs as f64),
            in_book: data.in_book,
            in_book_score: pct(data.in_book_score, data.in_book as f64),
            avg_mine_move: r1(mean(&data.mine_plies).unwrap_or(0.0)),
            avg_theirs_move: r1(mean(&data.theirs_plies).unwrap_or(0.0)),
        })
        .collect();

    // Wackelig: oft vergessen (Lapses) trotz Wiederholungen · nach oben
    // sortiert, aber nur was in echten Partien auch vorkommt zählt wirklich.
    let by_id: HashMap<i64, &repertoire::RepNodeOut> = nodes.iter().map(|n| (n.id, n)).collect();
    let mut shaky: Vec<ShakyLine> = nodes
        .iter()
        .filter(|n| n.my_move && n.lapses > 0)
        .map(|n| ShakyLine {
            node_id: n.id,
            side: n.side.clone(),
            line: line_name(&by_id, n),
            san: n.san.clone(),
            lapses: n.lapses,
            reps: n.reps,
            stability: r1(n.stability),
            games: node_games.get(&n.id).copied().unwrap_or(0),
        })
        .collect();
    shaky.sort_by(|a, b| {
        (b.lapses * (b.games + 1))
            .cmp(&(a.lapses * (a.games + 1)))
            .then(a.line.cmp(&b.line))
    });
    shaky.truncate(8);
    out.shaky = shaky;

    out
}

/// Benannte Linie eines Knotens · sonst der Pfad bis dorthin.
fn line_name(
    by_id: &HashMap<i64, &repertoire::RepNodeOut>,
    node: &repertoire::RepNodeOut,
) -> String {
    let mut current = Some(node);
    let mut path: Vec<String> = Vec::new();
    while let Some(n) = current {
        if !n.name.is_empty() {
            return n.name.clone();
        }
        path.push(n.san.clone());
        current = by_id.get(&n.parent_id).copied();
    }
    path.reverse();
    path.join(" ")
}

// ── Block H · Zeitformate ────────────────────────────────────────────────────

fn format_insights(views: &[GameView]) -> FormatInsights {
    struct Bucket {
        games: i64,
        score: f64,
        wins: i64,
        losses: i64,
        opp_elos: Vec<f64>,
        rating: Option<i64>,
        last_ts: i64,
        accuracies: Vec<f64>,
        losses_wp: Vec<f64>,
        blunders: i64,
        my_moves: i64,
        seconds: f64,
        trouble: i64,
        timed: i64,
        analyzed: i64,
    }
    let mut buckets: BTreeMap<(String, String), Bucket> = BTreeMap::new();

    for view in views {
        let raw = view.raw;
        if raw.time_class.is_empty() {
            continue;
        }
        let entry = buckets
            .entry((raw.source.clone(), raw.time_class.clone()))
            .or_insert(Bucket {
                games: 0,
                score: 0.0,
                wins: 0,
                losses: 0,
                opp_elos: Vec::new(),
                rating: None,
                last_ts: 0,
                accuracies: Vec::new(),
                losses_wp: Vec::new(),
                blunders: 0,
                my_moves: 0,
                seconds: 0.0,
                trouble: 0,
                timed: 0,
                analyzed: 0,
            });
        entry.games += 1;
        entry.score += raw.score();
        match raw.result.as_str() {
            "win" => entry.wins += 1,
            "loss" => entry.losses += 1,
            _ => {}
        }
        if raw.opp_elo > 0 {
            entry.opp_elos.push(raw.opp_elo as f64);
        }
        // Partien kommen aufsteigend · das letzte Rating gewinnt.
        if raw.my_elo > 0 && raw.played_ts >= entry.last_ts {
            entry.rating = Some(raw.my_elo);
            entry.last_ts = raw.played_ts;
        }
        if let Some(accuracy) = raw.accuracy {
            entry.accuracies.push(accuracy);
        }
        if !view.evals.is_empty() {
            entry.analyzed += 1;
        }
        for ply in 1..=view.evals.len() as i64 {
            if !raw.mine(ply) {
                continue;
            }
            let Some(ev) = view.evals.get((ply - 1) as usize) else {
                continue;
            };
            if ev.phase.is_empty() {
                continue;
            }
            entry.my_moves += 1;
            if ev.judgment == "blunder" {
                entry.blunders += 1;
            }
            if let Some(loss) = view.loss(ply) {
                entry.losses_wp.push(loss);
            }
        }
        if let Some(clocks) = &view.clocks {
            for ply in 1..=clocks.remaining.len() as i64 {
                if !raw.mine(ply) {
                    continue;
                }
                if let Some((spent, _)) = clocks.spent(ply) {
                    entry.seconds += spent;
                    entry.timed += 1;
                    if clocks.before(ply) < clocks.initial * 0.10 {
                        entry.trouble += 1;
                    }
                }
            }
        }
    }

    let mut formats: Vec<FormatStat> = buckets
        .into_iter()
        .map(|((source, time_class), b)| {
            let avg_opp = mean(&b.opp_elos);
            // Performance-Rating nach der linearen Näherung: Gegnerschnitt plus
            // 400 Punkte je Bilanzpunkt. Für Bilanzen nahe 0 ist das solide,
            // an den Rändern bewusst gedeckelt.
            let perf = avg_opp.map(|avg| {
                let edge = (b.wins - b.losses) as f64 / b.games as f64;
                (avg + 400.0 * edge.clamp(-0.9, 0.9)).round() as i64
            });
            FormatStat {
                key: format!("{source}/{time_class}"),
                source,
                time_class,
                games: b.games,
                score_pct: pct(b.score, b.games as f64),
                rating: b.rating,
                avg_opp_elo: avg_opp.map(|v| v.round() as i64),
                perf_rating: perf,
                perf_edge: match (perf, b.rating) {
                    (Some(perf), Some(rating)) => Some(perf - rating),
                    _ => None,
                },
                accuracy: mean(&b.accuracies).map(r1),
                avg_loss: mean(&b.losses_wp).map(|v| r1(v * 100.0)),
                blunders_per_100: if b.my_moves > 0 {
                    Some(r1(b.blunders as f64 / b.my_moves as f64 * 100.0))
                } else {
                    None
                },
                trouble_pct: if b.timed > 0 {
                    Some(pct(b.trouble as f64, b.timed as f64))
                } else {
                    None
                },
                minutes: (b.seconds / 60.0).round() as i64,
                analyzed: b.analyzed,
                last_ts: b.last_ts,
            }
        })
        .filter(|f| f.games >= 3)
        .collect();
    formats.sort_by(|a, b| b.games.cmp(&a.games).then(a.key.cmp(&b.key)));

    FormatInsights {
        comparable: formats.iter().filter(|f| f.analyzed >= 5).count() as i64,
        formats,
    }
}

// ── Block I · Eröffnungsfamilien ─────────────────────────────────────────────

/// Wörter, hinter denen ein Eröffnungsname aufhört, Familie zu sein.
///
/// PGN-Namen sind hierarchisch, aber nicht einheitlich interpunktiert:
/// Lichess schreibt "Sicilian Defense: Alapin Variation", chess.com
/// "Sicilian Defense Bowdler Attack". Der Schnitt hinter dem ersten dieser
/// Wörter trifft beide Schreibweisen.
const FAMILY_STOPWORDS: [&str; 9] = [
    "defense",
    "defence",
    "opening",
    "game",
    "gambit",
    "system",
    "attack",
    "countergambit",
    "counter-gambit",
];

/// Familienname einer Eröffnung, aus dem PGN-Namen gekürzt.
/// Leer, wenn kein brauchbarer Name vorliegt (dann übernimmt die Zugfolge).
fn family_from_name(opening: &str) -> String {
    let head = opening
        .split([':', ','])
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if head.is_empty() {
        return String::new();
    }
    let words: Vec<&str> = head.split_whitespace().collect();
    for (index, word) in words.iter().enumerate() {
        let plain: String = word
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-')
            .collect::<String>()
            .to_lowercase();
        if FAMILY_STOPWORDS.contains(&plain.as_str()) {
            return words[..=index].join(" ");
        }
    }
    // Kein Schlüsselwort ("Ruy Lopez", "Réti") · dann ist der Kopf die Familie,
    // aber nicht mehr als vier Wörter, damit lange Varianten nicht durchrutschen.
    words[..words.len().min(4)].join(" ")
}

/// Beschriftung aus der Zugfolge, wenn ein Name fehlt: "1.e4 c5 2.Nf3".
fn line_label(moves: &str, plies: usize) -> String {
    let mut out = String::new();
    for (index, san) in moves.split_whitespace().take(plies).enumerate() {
        if index % 2 == 0 {
            if index > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{}.{}", index / 2 + 1, san));
        } else {
            out.push(' ');
            out.push_str(san);
        }
    }
    out
}

/// Höchstzahl ausgewiesener Familien je Farbe · darunter wird jede Zeile zu
/// einer Einzelpartie mit Prozentzeichen.
const MAX_FAMILIES_PER_COLOR: usize = 14;

fn opening_insights(views: &[GameView]) -> OpeningInsights {
    #[derive(Default)]
    struct Acc {
        label: String,
        root: String,
        games: i64,
        points: f64,
        accuracies: Vec<f64>,
        losses: Vec<f64>,
        blunders: i64,
        analyzed: i64,
        in_book: i64,
        my_departure: i64,
        departure_plies: Vec<f64>,
        last_ts: i64,
    }

    let mut by_key: BTreeMap<(String, String), Acc> = BTreeMap::new();
    let mut total_games = 0i64;
    let mut total_points = 0.0;

    for view in views {
        let raw = view.raw;
        let root = raw
            .moves
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();
        if root.is_empty() {
            continue;
        }
        let named = family_from_name(&raw.opening);
        // Ohne Namen gruppiert die Zugfolge · vier Halbzüge trennen die
        // gängigen Systeme, ohne jede Zugumstellung zu einer eigenen Familie
        // zu machen.
        let (key, label) = if named.is_empty() {
            let line = line_label(&raw.moves, 4);
            (format!("line:{line}"), line)
        } else {
            (format!("name:{}", named.to_lowercase()), named)
        };

        total_games += 1;
        total_points += raw.score();

        let entry = by_key.entry((raw.color.clone(), key)).or_default();
        if entry.label.is_empty() {
            entry.label = label;
            entry.root = root;
        }
        entry.games += 1;
        entry.points += raw.score();
        entry.last_ts = entry.last_ts.max(raw.played_ts);
        if let Some(accuracy) = raw.accuracy {
            entry.accuracies.push(accuracy);
        }
        if !view.evals.is_empty() {
            entry.analyzed += 1;
        }
        match view.book_departure {
            None => entry.in_book += 1,
            Some((ply, mine)) => {
                entry.departure_plies.push(ply as f64);
                if mine {
                    entry.my_departure += 1;
                }
            }
        }
        // Eigene Züge der Eröffnungsphase · dort entscheidet sich, ob die
        // Vorbereitung trägt.
        for ev in view.evals {
            if ev.phase != "opening" || !raw.mine(ev.ply) {
                continue;
            }
            if let Some(loss) = view.loss(ev.ply) {
                entry.losses.push(loss);
            }
            if ev.judgment == "blunder" {
                entry.blunders += 1;
            }
        }
    }

    let mut families: Vec<OpeningFamily> = by_key
        .into_iter()
        .map(|((color, key), acc)| OpeningFamily {
            key,
            label: acc.label,
            color,
            root: acc.root,
            games: acc.games,
            score_pct: pct(acc.points, acc.games as f64),
            accuracy: mean(&acc.accuracies).map(r1),
            opening_accuracy: accuracy_from_losses(&acc.losses),
            avg_loss: mean(&acc.losses).map(|v| r1(v * 100.0)).unwrap_or(0.0),
            blunders_per_100: pct(acc.blunders as f64, acc.losses.len() as f64),
            moves: acc.losses.len() as i64,
            analyzed: acc.analyzed,
            in_book: acc.in_book,
            my_departure: acc.my_departure,
            avg_departure_ply: mean(&acc.departure_plies).map(r1).unwrap_or(0.0),
            last_ts: acc.last_ts,
        })
        .collect();

    // Je Farbe die häufigsten behalten · sortiert bleibt nach Häufigkeit,
    // die Gewichtung nach Punktverlust macht erst die Empfehlung.
    families.sort_by(|a, b| b.games.cmp(&a.games).then(a.label.cmp(&b.label)));
    let mut kept: Vec<OpeningFamily> = Vec::new();
    for color in ["white", "black"] {
        kept.extend(
            families
                .iter()
                .filter(|f| f.color == color)
                .take(MAX_FAMILIES_PER_COLOR)
                .cloned(),
        );
    }
    kept.sort_by(|a, b| b.games.cmp(&a.games).then(a.label.cmp(&b.label)));

    OpeningInsights {
        families: kept,
        baseline_score: pct(total_points, total_games as f64),
        games: total_games,
    }
}

// ── Block J · Wirkungsfenster ────────────────────────────────────────────────
//
// Eine Kennzahl für einen beliebigen Zeitraum, mit Stichprobe und Streuung.
// Beides zusammen ist der Punkt: ohne die Streuung lässt sich nicht sagen, ob
// eine Veränderung mehr ist als das übliche Rauschen, und genau das entscheidet
// im Study-Reiter zwischen „wirkt" und „noch nicht messbar".
//
// Gerechnet wird immer neu aus den Rohdaten · es gibt bewusst keine
// gespeicherten Momentaufnahmen (siehe die Migration in `db.rs`).

/// Einheit einer Kennzahl · steuert Formatierung und Rauschgrenze im Frontend.
/// `pct` = Prozent, `per100` = Ereignisse je 100 Züge, `elo` = Ratingpunkte.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MetricValue {
    pub key: String,
    pub value: Option<f64>,
    /// Stichprobe: Partien, Züge oder Versuche · je nach Kennzahl.
    pub n: i64,
    /// Streuung der Einzelwerte, wo eine sinnvoll ist (sonst None · dann
    /// rechnet das Frontend die Grenze aus dem Verteilungsmodell).
    pub sd: Option<f64>,
    pub unit: String,
    /// Ist ein kleinerer Wert besser? Patzer ja, Genauigkeit nein.
    pub lower_is_better: bool,
}

/// Ratingstand eines Pools im Fenster. Ratings verschiedener Formate und
/// Plattformen sind nicht vergleichbar · deshalb reisen sie getrennt und
/// werden erst im Frontend über `formatScale.ts` auf eine Skala gebracht.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct RatingPoint {
    pub source: String,
    pub time_class: String,
    pub first: i64,
    pub last: i64,
    pub games: i64,
}

#[derive(Deserialize)]
pub struct WindowSpec {
    pub from_ts: i64,
    pub to_ts: i64,
}

#[derive(Serialize, Default)]
pub struct MetricWindow {
    pub from_ts: i64,
    pub to_ts: i64,
    pub games: i64,
    pub metrics: Vec<MetricValue>,
    pub ratings: Vec<RatingPoint>,
}

fn metric(
    key: &str,
    value: Option<f64>,
    n: i64,
    sd: Option<f64>,
    unit: &str,
    lower: bool,
) -> MetricValue {
    MetricValue {
        key: key.into(),
        value: value.map(r1),
        n,
        sd: sd.map(r1),
        unit: unit.into(),
        lower_is_better: lower,
    }
}

fn sd_of(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let m = mean(values)?;
    let var = values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - 1) as f64;
    Some(var.sqrt())
}

/// Kennzahlen eines Fensters aus den vorbereiteten Partien.
fn metrics_for_window(
    views: &[&GameView],
    puzzles: &[(i64, bool, i64)],
    from_ts: i64,
    to_ts: i64,
) -> MetricWindow {
    let mut points = Vec::new();
    let mut accuracies: Vec<f64> = Vec::new();
    // Je Phase: eigene gewertete Züge, davon Patzer, davon Fehler, plus Verluste.
    let mut phase_moves = [0i64; 3];
    let mut phase_blunders = [0i64; 3];
    let mut phase_losses: [Vec<f64>; 3] = Default::default();
    let mut errors = 0i64;
    let (mut trouble_moves, mut safe_moves) = (0i64, 0i64);
    let (mut book_checked, mut book_stayed) = (0i64, 0i64);
    let mut ratings: BTreeMap<(String, String), (i64, i64, i64)> = BTreeMap::new();

    for view in views {
        let raw = view.raw;
        points.push(raw.score());
        if let Some(accuracy) = raw.accuracy {
            accuracies.push(accuracy);
        }
        if raw.my_elo > 0 {
            let entry = ratings
                .entry((raw.source.clone(), raw.time_class.clone()))
                .or_insert((raw.my_elo, raw.my_elo, 0));
            // `views` kommt aufsteigend sortiert · erster Eintrag bleibt stehen.
            entry.1 = raw.my_elo;
            entry.2 += 1;
        }
        if !view.evals.is_empty() {
            book_checked += 1;
            if view.book_departure.is_none() {
                book_stayed += 1;
            }
        }
        let clocks = view.clocks.as_ref();
        let trouble_limit = clocks.map(|c| c.initial * 0.10);
        for ev in view.evals {
            if !raw.mine(ev.ply) {
                continue;
            }
            let index = phase_index(&ev.phase);
            phase_moves[index] += 1;
            if let Some(loss) = view.loss(ev.ply) {
                phase_losses[index].push(loss);
            }
            match ev.judgment.as_str() {
                "blunder" => {
                    phase_blunders[index] += 1;
                    errors += 1;
                }
                "mistake" => errors += 1,
                _ => {}
            }
            if let (Some(clocks), Some(limit)) = (clocks, trouble_limit) {
                if clocks.before(ev.ply) < limit {
                    trouble_moves += 1;
                } else {
                    safe_moves += 1;
                }
            }
        }
    }

    let all_moves: i64 = phase_moves.iter().sum();
    let all_blunders: i64 = phase_blunders.iter().sum();
    let all_losses: Vec<f64> = phase_losses.iter().flatten().copied().collect();

    let mut metrics = vec![
        metric(
            "score_pct",
            mean(&points).map(|v| v * 100.0),
            points.len() as i64,
            sd_of(&points).map(|v| v * 100.0),
            "pct",
            false,
        ),
        metric(
            "acc_overall",
            mean(&accuracies),
            accuracies.len() as i64,
            sd_of(&accuracies),
            "pct",
            false,
        ),
        metric(
            "blunders_per100",
            if all_moves > 0 {
                Some(all_blunders as f64 / all_moves as f64 * 100.0)
            } else {
                None
            },
            all_moves,
            None,
            "per100",
            true,
        ),
        metric(
            "errors_per100",
            if all_moves > 0 {
                Some(errors as f64 / all_moves as f64 * 100.0)
            } else {
                None
            },
            all_moves,
            None,
            "per100",
            true,
        ),
        metric(
            "avg_loss",
            mean(&all_losses).map(|v| v * 100.0),
            all_moves,
            sd_of(&all_losses).map(|v| v * 100.0),
            "pct",
            true,
        ),
    ];

    for (index, phase) in PHASES.iter().enumerate() {
        metrics.push(metric(
            &format!("blunders_{phase}_per100"),
            if phase_moves[index] > 0 {
                Some(phase_blunders[index] as f64 / phase_moves[index] as f64 * 100.0)
            } else {
                None
            },
            phase_moves[index],
            None,
            "per100",
            true,
        ));
        metrics.push(metric(
            &format!("acc_{phase}"),
            accuracy_from_losses(&phase_losses[index]),
            phase_moves[index],
            None,
            "pct",
            false,
        ));
    }

    metrics.push(metric(
        "trouble_pct",
        if trouble_moves + safe_moves > 0 {
            Some(trouble_moves as f64 / (trouble_moves + safe_moves) as f64 * 100.0)
        } else {
            None
        },
        trouble_moves + safe_moves,
        None,
        "pct",
        true,
    ));
    metrics.push(metric(
        "in_book_pct",
        if book_checked > 0 {
            Some(book_stayed as f64 / book_checked as f64 * 100.0)
        } else {
            None
        },
        book_checked,
        None,
        "pct",
        false,
    ));

    // Puzzles: die schnellste Rückmeldung im ganzen Satz · sie reagiert
    // tagesgenau, während Partiekennzahlen Wochen brauchen.
    let window_puzzles: Vec<&(i64, bool, i64)> = puzzles
        .iter()
        .filter(|(ts, _, _)| *ts >= from_ts && *ts < to_ts)
        .collect();
    let solved = window_puzzles.iter().filter(|(_, ok, _)| *ok).count() as i64;
    let rated: Vec<f64> = window_puzzles
        .iter()
        .filter(|(_, _, rating)| *rating > 0)
        .map(|(_, _, rating)| *rating as f64)
        .collect();
    metrics.push(metric(
        "puzzle_solve_pct",
        if window_puzzles.is_empty() {
            None
        } else {
            Some(solved as f64 / window_puzzles.len() as f64 * 100.0)
        },
        window_puzzles.len() as i64,
        None,
        "pct",
        false,
    ));
    metrics.push(metric(
        "puzzle_rating",
        mean(&rated),
        rated.len() as i64,
        sd_of(&rated),
        "elo",
        false,
    ));

    MetricWindow {
        from_ts,
        to_ts,
        games: views.len() as i64,
        metrics,
        ratings: ratings
            .into_iter()
            .map(|((source, time_class), (first, last, games))| RatingPoint {
                source,
                time_class,
                first,
                last,
                games,
            })
            .collect(),
    }
}

/// Kennzahlen für mehrere Zeitfenster in einem Durchlauf.
///
/// Der Study-Reiter fragt typischerweise zwei an — vor und seit dem
/// Fokusstart —, die Trainingsbilanz eine Reihe von Wochen.
#[tauri::command]
pub async fn study_metrics(
    app: tauri::AppHandle,
    windows: Vec<WindowSpec>,
) -> Result<Vec<MetricWindow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<db::Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        metrics_from_conn(&conn, &windows)
    })
    .await
    .map_err(|e| format!("Wirkungsmessung fehlgeschlagen: {e}"))?
}

/// Höchstzahl gleichzeitig angefragter Fenster · schützt vor einem Aufruf, der
/// die Datenbank für jeden Tag eines Jahres einmal durchgeht.
const MAX_WINDOWS: usize = 64;

fn metrics_from_conn(
    conn: &Connection,
    windows: &[WindowSpec],
) -> Result<Vec<MetricWindow>, String> {
    if windows.is_empty() {
        return Ok(Vec::new());
    }
    if windows.len() > MAX_WINDOWS {
        return Err("Zu viele Zeitfenster angefragt".into());
    }
    let games = load_games(conn)?;
    let evals = load_evals(conn)?;
    let nodes = repertoire::load_nodes(conn).unwrap_or_default();
    let children = repertoire::book_children(&nodes);

    let mut asc: Vec<&RawGame> = games.iter().collect();
    asc.sort_by_key(|g| (g.played_ts, g.id));

    let empty: Vec<Ev> = Vec::new();
    let mut views: Vec<GameView> = Vec::with_capacity(asc.len());
    for game in &asc {
        let rows = evals.get(&game.id).unwrap_or(&empty);
        let wp = rows
            .iter()
            .map(|ev| win_prob(ev.eval_cp, ev.mate_in))
            .collect();
        let (book_departure, book_plies) = book_progress(&nodes, &children, game);
        views.push(GameView {
            raw: game,
            evals: rows,
            wp,
            clocks: clocks_of(game),
            book_departure,
            book_plies,
        });
    }

    let puzzles = load_puzzle_attempts(conn)?;

    Ok(windows
        .iter()
        .map(|window| {
            let selected: Vec<&GameView> = views
                .iter()
                .filter(|v| v.raw.played_ts >= window.from_ts && v.raw.played_ts < window.to_ts)
                .collect();
            metrics_for_window(&selected, &puzzles, window.from_ts, window.to_ts)
        })
        .collect())
}

/// Puzzleversuche als (Zeitpunkt, gelöst, Aufgabenrating).
fn load_puzzle_attempts(conn: &Connection) -> Result<Vec<(i64, bool, i64)>, String> {
    let mut stmt = conn
        .prepare("SELECT ts, solved, puzzle_rating FROM puzzle_attempts ORDER BY ts")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? != 0, r.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    rows
}

// ── Lehrreichste Partie ──────────────────────────────────────────────────────

/// Die Partie mit dem größten Lernwert: der größte einzelne Ausschlag der
/// Gewinnwahrscheinlichkeit aus eigener Sicht, gewichtet danach, ob er die
/// Partie tatsächlich gedreht hat.
fn spotlight(views: &[GameView]) -> Option<Spotlight> {
    let mut best: Option<(f64, Spotlight)> = None;
    // Nur die jüngere Vergangenheit · eine Lehre von vor zwei Jahren hilft nicht.
    for view in views.iter().rev().take(60) {
        if view.evals.is_empty() {
            continue;
        }
        for ply in 1..=view.evals.len() as i64 {
            if !view.raw.mine(ply) {
                continue;
            }
            let Some(loss) = view.loss(ply) else { continue };
            let Some(before) = view
                .cp_mine(ply - 1)
                .or(if ply == 1 { Some(0.0) } else { None })
            else {
                continue;
            };
            let Some(after) = view.cp_mine(ply) else {
                continue;
            };
            // Interessant ist der Zug, der Gewinn zu Nicht-Gewinn macht.
            let kind = if before >= 200.0 && after < 50.0 {
                "missed_win"
            } else if before > -50.0 && after <= -200.0 {
                "collapse"
            } else {
                continue;
            };
            let magnitude = loss * 100.0;
            if best.as_ref().map(|(m, _)| magnitude > *m).unwrap_or(true) {
                best = Some((
                    magnitude,
                    Spotlight {
                        game_id: view.raw.id,
                        ply,
                        kind: kind.to_string(),
                        magnitude: r1(magnitude),
                        opponent: String::new(),
                        played_at: String::new(),
                    },
                ));
            }
        }
    }
    best.map(|(_, s)| s)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_time_controls() {
        assert_eq!(parse_time_control("600+5"), Some((600.0, 5.0)));
        assert_eq!(parse_time_control("300"), Some((300.0, 0.0)));
        assert_eq!(parse_time_control("40/7200:1800"), Some((7200.0, 0.0)));
        assert_eq!(parse_time_control("-"), None);
        assert_eq!(parse_time_control(""), None);
    }

    #[test]
    fn correspondence_clocks_are_not_live_time_management_data() {
        let game = RawGame {
            id: 1,
            played_ts: 0,
            source: "chess.com".into(),
            time_class: "daily".into(),
            color: "white".into(),
            result: "win".into(),
            moves: "e4 e5 Nf3 Nc6".into(),
            clocks: "60000 50000 40000 30000".into(),
            time_control: "1/86400".into(),
            my_elo: 1500,
            opp_elo: 1500,
            accuracy: None,
            opening: String::new(),
        };
        assert!(clocks_of(&game).is_none());
    }

    #[test]
    fn clock_spending_uses_the_players_own_previous_reading() {
        let clocks = Clocks {
            initial: 600.0,
            increment: 5.0,
            // Weiß: 597, 590 · Schwarz: 598, 585
            remaining: vec![597.0, 598.0, 590.0, 585.0],
        };
        // Halbzug 1 (Weiß): 600 + 5 − 597 = 8
        let (spent, share) = clocks.spent(1).unwrap();
        assert!((spent - 8.0).abs() < 0.001, "{spent}");
        assert!((share - 8.0 / 605.0).abs() < 0.001);
        // Halbzug 3 (Weiß): 597 + 5 − 590 = 12
        let (spent, _) = clocks.spent(3).unwrap();
        assert!((spent - 12.0).abs() < 0.001, "{spent}");
        // Halbzug 4 (Schwarz): 598 + 5 − 585 = 18
        let (spent, _) = clocks.spent(4).unwrap();
        assert!((spent - 18.0).abs() < 0.001, "{spent}");
    }

    #[test]
    fn clock_before_falls_back_to_the_base_time() {
        let clocks = Clocks {
            initial: 300.0,
            increment: 0.0,
            remaining: vec![295.0, 294.0, 280.0, 270.0],
        };
        assert_eq!(clocks.before(1), 300.0);
        assert_eq!(clocks.before(2), 300.0);
        assert_eq!(clocks.before(3), 295.0);
        assert_eq!(clocks.before(4), 294.0);
        assert_eq!(clocks.last_of(true), Some(280.0));
        assert_eq!(clocks.last_of(false), Some(270.0));
    }

    #[test]
    fn endgame_signatures_follow_the_material() {
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4P3/4K3"), "pawn");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4R3/4K3"), "rook");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/4Q3/4K3"), "queen");
        assert_eq!(endgame_signature("4k3/8/8/8/8/8/3RN3/4K3"), "rook+minor");
        // Weißer Läufer c1 (dunkel), schwarzer Läufer f8 (dunkel) → gleichfarbig.
        assert_eq!(endgame_signature("5b2/8/8/8/8/8/8/2B1K2k"), "minor");
        // Weiß c1 (dunkel), Schwarz c8 (hell) → ungleichfarbig.
        assert_eq!(
            endgame_signature("2b5/8/8/8/8/8/8/2B1K2k"),
            "opposite-bishops"
        );
    }

    #[test]
    fn opening_families_survive_both_pgn_spellings() {
        // Lichess trennt mit Doppelpunkt, chess.com gar nicht · beide müssen
        // auf dieselbe Familie fallen, sonst zerfällt die Auswertung in
        // Einzelpartien.
        assert_eq!(
            family_from_name("Sicilian Defense: Alapin Variation, 2...d5"),
            "Sicilian Defense"
        );
        assert_eq!(
            family_from_name("Sicilian Defense Bowdler Attack"),
            "Sicilian Defense"
        );
        assert_eq!(
            family_from_name("Queen's Gambit Declined: Exchange"),
            "Queen's Gambit"
        );
        assert_eq!(family_from_name("Italian Game"), "Italian Game");
        // Ohne Schlüsselwort bleibt der Kopf stehen.
        assert_eq!(family_from_name("Ruy Lopez"), "Ruy Lopez");
        assert_eq!(family_from_name(""), "");
    }

    #[test]
    fn line_label_numbers_the_moves() {
        assert_eq!(line_label("e4 c5 Nf3 d6 d4", 4), "1.e4 c5 2.Nf3 d6");
        assert_eq!(line_label("d4", 4), "1.d4");
        assert_eq!(line_label("", 4), "");
    }

    #[test]
    fn metric_windows_report_their_sample_size() {
        // Ohne Partien im Fenster darf keine Kennzahl einen Wert vortäuschen ·
        // „noch nicht messbar" ist die richtige Antwort, nicht 0 %.
        let window = metrics_for_window(&[], &[], 0, 100);
        assert_eq!(window.games, 0);
        for value in &window.metrics {
            assert!(value.value.is_none(), "{} hat einen Wert", value.key);
            assert_eq!(value.n, 0);
        }
        assert!(window.metrics.iter().any(|m| m.key == "blunders_per100"));
        assert!(window
            .metrics
            .iter()
            .find(|m| m.key == "blunders_per100")
            .is_some_and(|m| m.lower_is_better));
        assert!(window
            .metrics
            .iter()
            .find(|m| m.key == "acc_overall")
            .is_some_and(|m| !m.lower_is_better));
    }

    #[test]
    fn puzzle_metrics_are_cut_to_the_window() {
        let attempts = vec![(50, true, 1400), (150, false, 1500), (250, true, 1600)];
        let window = metrics_for_window(&[], &attempts, 100, 200);
        let solve = window
            .metrics
            .iter()
            .find(|m| m.key == "puzzle_solve_pct")
            .unwrap();
        assert_eq!(solve.n, 1);
        assert_eq!(solve.value, Some(0.0));
        let rating = window
            .metrics
            .iter()
            .find(|m| m.key == "puzzle_rating")
            .unwrap();
        assert_eq!(rating.value, Some(1500.0));
    }

    #[test]
    fn sd_needs_at_least_two_values() {
        assert_eq!(sd_of(&[]), None);
        assert_eq!(sd_of(&[5.0]), None);
        let sd = sd_of(&[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]).unwrap();
        assert!((sd - 2.138).abs() < 0.01, "{sd}");
    }

    #[test]
    fn piece_of_san_reads_the_leading_letter() {
        assert_eq!(piece_of_san("e4"), "P");
        assert_eq!(piece_of_san("exd5"), "P");
        assert_eq!(piece_of_san("Nf3"), "N");
        assert_eq!(piece_of_san("O-O"), "K");
        assert_eq!(piece_of_san("Qxh7#"), "Q");
    }

    #[test]
    fn month_keys_match_the_calendar() {
        // 2026-07-31 00:00 UTC
        assert_eq!(month_key(1_785_456_000), "2026-07");
        // 1970-01-01
        assert_eq!(month_key(0), "1970-01");
    }

    #[test]
    fn loss_is_measured_from_the_moving_side() {
        let raw = RawGame {
            id: 1,
            played_ts: 0,
            source: "lichess".into(),
            time_class: "blitz".into(),
            color: "white".into(),
            result: "loss".into(),
            moves: String::new(),
            clocks: String::new(),
            time_control: String::new(),
            my_elo: 1500,
            opp_elo: 1500,
            accuracy: None,
            opening: String::new(),
        };
        let evals = vec![
            Ev {
                ply: 1,
                san: "e4".into(),
                eval_cp: Some(0),
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: "opening".into(),
            },
            Ev {
                ply: 2,
                san: "e5".into(),
                eval_cp: Some(300),
                mate_in: None,
                best_uci: String::new(),
                judgment: String::new(),
                phase: "opening".into(),
            },
        ];
        let wp = evals
            .iter()
            .map(|e| win_prob(e.eval_cp, e.mate_in))
            .collect();
        let view = GameView {
            raw: &raw,
            evals: &evals,
            wp,
            clocks: None,
            book_departure: None,
            book_plies: 0,
        };
        // Halbzug 2 ist Schwarz und verschlechtert die Lage von Schwarz.
        let loss = view.loss(2).unwrap();
        assert!(loss > 0.2, "Schwarz verliert Winrate: {loss}");
        // Aus meiner (weißen) Sicht steht es danach besser.
        assert_eq!(view.cp_mine(2), Some(300.0));
    }

    /// Ende zu Ende gegen eine echte Datenbank: SQL, Nachspielen der Züge und
    /// Aggregation greifen ineinander, und genau dort brechen Änderungen.
    #[test]
    fn computes_over_a_real_database() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();

        // Skandinavisch, in dem Weiß im 5. Zug eine Figur einstellt. Die
        // Uhrwerte sinken je Halbzug um zwei Sekunden, der 9. Halbzug (Weiß)
        // kostet bewusst deutlich mehr.
        let moves = "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Bd2 Qb6";
        let clocks: Vec<String> = (1..=10)
            .map(|ply: i64| {
                let base = 30_000 - ply * 200;
                (if ply == 9 { base - 4_000 } else { base }).to_string()
            })
            .collect();

        conn.execute(
            "INSERT INTO games (id, source, source_id, played_at, played_ts, time_class, color,
                                opponent, opp_elo, my_elo, result, opening, moves_count, accuracy,
                                moves, analyzed, clocks, time_control)
             VALUES (1,'lichess','g1','2026-07-01',1782000000,'blitz','white','Gegner',1500,1500,
                     'loss','Scandinavian Defense',10,68.0,?1,1,?2,'300+0')",
            rusqlite::params![moves, clocks.join(" ")],
        )
        .unwrap();

        // Bewertungen: bis Halbzug 8 ausgeglichen, Halbzug 9 ist der Patzer.
        for ply in 1..=10i64 {
            let eval = if ply >= 9 { -350 } else { 20 };
            let judgment = if ply == 9 { "blunder" } else { "" };
            // Der übersehene Bestzug im 9. Halbzug wäre Bb5+ gewesen · ein
            // Schach und damit forcierend.
            let best = if ply == 9 { "f1b5" } else { "" };
            conn.execute(
                "INSERT INTO move_evals (game_id, ply, san, eval_cp, best_uci, judgment, phase)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, 'opening')",
                rusqlite::params![
                    ply,
                    moves.split_whitespace().nth((ply - 1) as usize).unwrap(),
                    eval,
                    best,
                    judgment
                ],
            )
            .unwrap();
        }

        let out = compute(&conn).unwrap();

        assert_eq!(out.coverage.games, 1);
        assert_eq!(out.coverage.analyzed, 1);
        assert_eq!(out.coverage.with_clocks, 1, "Uhren wurden gelesen");
        assert_eq!(out.coverage.moves_judged, 10);

        // Zeit: fünf eigene Halbzüge, der Patzer ist der teuerste davon.
        assert_eq!(out.time.games, 1);
        assert_eq!(out.time.moves, 5);
        assert_eq!(
            out.time.theory.book_moves, 0,
            "ohne Repertoire ist kein Zug bekannt"
        );
        assert!(
            out.time.focus.error_share > out.time.focus.ok_share,
            "der lange Zug war der Fehlzug: {:?}",
            out.time.focus
        );

        // Eine schmale Linie kennt genau die passenden eigenen Züge. Nach
        // ihrem Ende werden die restlichen Eröffnungszüge nicht pauschal zu
        // Repertoirezügen erklärt.
        conn.execute(
            "INSERT INTO rep_nodes (id, parent_id, side, san, fen_key, depth)
             VALUES (1, 0, 'white', 'e4', 'book-e4', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rep_nodes (id, parent_id, side, san, fen_key, depth)
             VALUES (2, 1, 'white', 'd5', 'book-e4-d5', 2)",
            [],
        )
        .unwrap();
        let with_book = compute(&conn).unwrap();
        assert_eq!(with_book.time.theory.book_moves, 1);

        // Inhalt: der Patzer wird der Figur zugeordnet, die gezogen hat (Läufer
        // Bd2), und der übersehene Bestzug war forcierend.
        assert_eq!(out.content.games, 1);
        assert_eq!(out.content.anatomy.errors, 1);
        assert_eq!(
            out.content.anatomy.forcing_missed, 1,
            "Bb5+ wäre ein Schach"
        );
        let bishop = out
            .content
            .anatomy
            .by_piece
            .iter()
            .find(|p| p.piece == "B")
            .expect("Läuferzüge wurden gezählt");
        assert_eq!(bishop.errors, 1);

        // Feldvergleich: eigene und gegnerische Züge landen getrennt.
        let me = out.benchmark.me.expect("eigene Züge");
        let field = out.benchmark.field.expect("Gegnerzüge");
        assert_eq!(me.moves, 5);
        assert_eq!(field.moves, 5);
        assert!(me.blunders_per_100 > field.blunders_per_100);

        // Formate: eine Partie fällt unter die Mindestgröße und taucht nicht auf.
        assert!(out.formats.formats.is_empty());
        assert_eq!(out.sessions.sessions, 1);

        // Eröffnungsfamilie: aus dem PGN-Namen gekürzt, meiner Farbe zugeordnet.
        assert_eq!(out.openings.games, 1);
        let family = &out.openings.families[0];
        assert_eq!(family.label, "Scandinavian Defense");
        assert_eq!(family.color, "white");
        assert_eq!(family.root, "e4");
        assert_eq!(family.games, 1);
        assert_eq!(family.score_pct, 0.0);
        // Fünf eigene Halbzüge in der Eröffnungsphase, davon einer ein Patzer.
        assert_eq!(family.moves, 5);
        assert_eq!(family.blunders_per_100, 20.0);
        assert_eq!(out.openings.baseline_score, 0.0);
    }

    #[test]
    fn metric_windows_cut_the_same_database_by_time() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();

        // Zwei Partien, ein Monat auseinander · die zweite läuft sauber.
        for (id, ts, judgment) in [(1i64, 1_700_000_000i64, "blunder"), (2, 1_702_600_000, "")] {
            conn.execute(
                "INSERT INTO games (id, source, source_id, played_ts, time_class, color, result,
                                    opening, moves_count, accuracy, moves, analyzed, my_elo)
                 VALUES (?1,'lichess',?2,?3,'blitz','white','win','Italian Game',4,70.0,
                         'e4 e5 Nf3 Nc6', 1, 1500)",
                rusqlite::params![id, format!("g{id}"), ts],
            )
            .unwrap();
            for ply in 1..=4i64 {
                conn.execute(
                    "INSERT INTO move_evals (game_id, ply, san, eval_cp, judgment, phase)
                     VALUES (?1, ?2, 'e4', 10, ?3, 'middlegame')",
                    rusqlite::params![id, ply, if ply == 1 { judgment } else { "" }],
                )
                .unwrap();
            }
        }

        let windows = metrics_from_conn(
            &conn,
            &[
                WindowSpec {
                    from_ts: 1_699_000_000,
                    to_ts: 1_701_000_000,
                },
                WindowSpec {
                    from_ts: 1_701_000_000,
                    to_ts: 1_703_000_000,
                },
            ],
        )
        .unwrap();

        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].games, 1);
        assert_eq!(windows[1].games, 1);
        let blunders = |window: &MetricWindow| {
            window
                .metrics
                .iter()
                .find(|m| m.key == "blunders_middlegame_per100")
                .unwrap()
                .value
        };
        // Zwei eigene Züge je Partie, im ersten Fenster einer davon ein Patzer.
        assert_eq!(blunders(&windows[0]), Some(50.0));
        assert_eq!(blunders(&windows[1]), Some(0.0));

        // Ratings reisen nach Pool getrennt · erst das Frontend rechnet sie um.
        assert_eq!(windows[0].ratings.len(), 1);
        assert_eq!(windows[0].ratings[0].time_class, "blitz");
        assert_eq!(windows[0].ratings[0].games, 1);
    }

    #[test]
    fn metric_windows_are_bounded() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        assert!(metrics_from_conn(&conn, &[]).unwrap().is_empty());
        let too_many: Vec<WindowSpec> = (0..MAX_WINDOWS + 1)
            .map(|index| WindowSpec {
                from_ts: index as i64,
                to_ts: index as i64 + 1,
            })
            .collect();
        assert!(metrics_from_conn(&conn, &too_many).is_err());
    }

    #[test]
    fn sessions_split_on_long_breaks() {
        const BASE: i64 = 1_700_000_000;
        let games: Vec<RawGame> = [BASE, BASE + 300, BASE + 600, BASE + 100_000, BASE + 100_300]
            .iter()
            .enumerate()
            .map(|(i, ts)| RawGame {
                id: i as i64,
                played_ts: *ts,
                source: "lichess".into(),
                time_class: "blitz".into(),
                color: "white".into(),
                result: "win".into(),
                moves: String::new(),
                clocks: String::new(),
                time_control: String::new(),
                my_elo: 1500,
                opp_elo: 1500,
                accuracy: None,
                opening: String::new(),
            })
            .collect();
        let empty: Vec<Ev> = Vec::new();
        let views: Vec<GameView> = games
            .iter()
            .map(|raw| GameView {
                raw,
                evals: &empty,
                wp: Vec::new(),
                clocks: None,
                book_departure: None,
                book_plies: 0,
            })
            .collect();
        let bounds = session_bounds(&views);
        assert_eq!(
            bounds,
            vec![(1, 1), (1, 2), (1, 3), (2, 1), (2, 2)],
            "nach 100.000 s Pause beginnt eine neue Sitzung"
        );
    }
}
