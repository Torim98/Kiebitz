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

/// Zeitraum, aus dem die Befunde gerechnet werden.
///
/// Die Reiter zeigen die ganze Historie, die Befunde nur diesen Ausschnitt ·
/// die Oberfläche muss beides auseinanderhalten können, also steht hier, worauf
/// „Woran du arbeiten solltest" beruht.
#[derive(Serialize, Default, Clone)]
pub struct FindingWindow {
    /// Länge in Tagen · 0 heißt „ganze Historie".
    pub days: i64,
    /// Beginn des Fensters (0 bei ganzer Historie).
    pub from_ts: i64,
    /// Partien im Fenster.
    pub games: i64,
    pub analyzed: i64,
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
    /// Fenster, über das `recent` gerechnet ist.
    pub window: FindingWindow,
    /// Dieselbe Auswertung, aber nur über die jüngsten Partien · `None`, wenn
    /// das Fenster ohnehin die ganze Historie umfasst.
    pub recent: Option<Box<DeepInsights>>,
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
