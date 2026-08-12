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
