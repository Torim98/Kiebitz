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
