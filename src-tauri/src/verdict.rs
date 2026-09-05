//! Das Fazit einer Partie · vier bis fünf Sätze, aus dem, was die Analyse
//! ohnehin gerechnet hat.
//!
//! Ein Blatt schließt eine Partie mit einer Bemerkung ab, nicht mit einer
//! Tabelle. Die Bemerkung entsteht hier, und zwar als Liste von Bausteinen —
//! `{"key": …, "params": …}` — und nicht als Text. Der Grund ist derselbe wie
//! in `motifs.rs`: Sätze, die in Rust entstehen, sprechen eine Sprache, und
//! Kiebitz spricht sieben.
//!
//! Was hier *nicht* passiert: Padding. Ein Satz, der nichts sagt („Das
//! Endspiel war ausgeglichen"), macht die Bemerkung länger und schlechter.
//! Jeder Baustein hat deshalb eine Bedingung, unter der er ausbleibt.

use serde_json::{json, Value};

/// Regelstand des Fazits · steht in `games.verdict_version`.
pub const VERDICT_VERSION: i64 = 1;

/// Was eine fertig analysierte Partie über sich weiß.
pub struct GameSummary<'a> {
    /// `win`, `loss` oder `draw` · aus Sicht des Spielers.
    pub result: &'a str,
    pub accuracy: Option<f64>,
    pub opponent_accuracy: Option<f64>,
    pub accuracy_opening: Option<f64>,
    pub accuracy_middlegame: Option<f64>,
    pub accuracy_endgame: Option<f64>,
    pub inaccuracies: u32,
    pub mistakes: u32,
    pub blunders: u32,
    /// Der erste eigene grobe Fehler: Zugnummer und Zug in englischem SAN.
    pub turning_point: Option<(u32, String)>,
    /// Das häufigste Motiv unter den eigenen Fehlern und wie oft es auftrat.
    pub recurring: Option<(String, u32)>,
}

/// Note für die Genauigkeit · dieselben Stufen wie die Befund-Engine sie
/// gewohnt ist, nur gröber: fünf Bänder, damit der erste Satz etwas aussagt.
fn grade(accuracy: f64) -> &'static str {
    if accuracy >= 90.0 {
        "excellent"
    } else if accuracy >= 80.0 {
        "solid"
    } else if accuracy >= 70.0 {
        "mixed"
    } else if accuracy >= 55.0 {
        "shaky"
    } else {
        "rough"
    }
}

/// Die schwächste Phase, für die es überhaupt Zahlen gibt.
fn weakest(summary: &GameSummary) -> Option<(&'static str, f64)> {
    [
        ("opening", summary.accuracy_opening),
        ("middlegame", summary.accuracy_middlegame),
        ("endgame", summary.accuracy_endgame),
    ]
    .into_iter()
    .filter_map(|(phase, value)| value.map(|v| (phase, v)))
    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Baut das Fazit · leere Zeichenkette, wenn nichts Belastbares zu sagen ist.
pub fn build(summary: &GameSummary) -> String {
    let mut out: Vec<Value> = Vec::new();

    // 1 · Die Note. Ohne Genauigkeit gibt es kein Fazit — dann lief die
    // Analyse nicht weit genug, und Raten ist keine Auskunft.
    let Some(accuracy) = summary.accuracy else {
        return String::new();
    };
    out.push(json!({
        "key": format!("verdict.grade.{}", grade(accuracy)),
        "params": { "acc": round1(accuracy) },
    }));

    // 2 · Der Vergleich mit der Gegenseite · nur, wenn er etwas hergibt.
    // Zwei Prozentpunkte sind Rauschen und keine Aussage.
    if let Some(opponent) = summary.opponent_accuracy {
        let gap = accuracy - opponent;
        let side = if gap > 2.0 {
            Some("better")
        } else if gap < -2.0 {
            Some("worse")
        } else {
            None
        };
        if let Some(side) = side {
            out.push(json!({
                "key": format!("verdict.versus.{side}"),
                "params": { "opp": round1(opponent) },
            }));
        }
    }

    // 3 · Die Fehlerbilanz.
    let errors = summary.inaccuracies + summary.mistakes + summary.blunders;
    if errors == 0 {
        out.push(json!({ "key": "verdict.errors.none", "params": {} }));
    } else {
        out.push(json!({
            "key": "verdict.errors.count",
            "params": {
                "inaccuracies": summary.inaccuracies,
                "mistakes": summary.mistakes,
                "blunders": summary.blunders,
            },
        }));
    }

    // 4 · Die schwächste Phase · nur, wenn sie wirklich schwach war.
    if let Some((phase, value)) = weakest(summary) {
        if value < 75.0 {
            out.push(json!({
                "key": format!("verdict.phase.{phase}"),
                "params": { "acc": round1(value) },
            }));
        }
    }

    // 5 · Der Wendepunkt · der erste eigene grobe Fehler.
    if let Some((number, san)) = &summary.turning_point {
        out.push(json!({
            "key": "verdict.turningPoint",
            "params": { "n": number, "san": san },
        }));
    }

    // 6 · Was sich wiederholt hat. Einmal ist ein Zufall.
    if let Some((motif, count)) = &summary.recurring {
        if *count >= 2 {
            out.push(json!({
                "key": "verdict.recurring",
                "params": { "n": count, "motif": motif },
            }));
        }
    }

    // 7 · Das Ergebnis, aber nur, wenn es der Genauigkeit widerspricht: gut
    // gespielt und verloren, oder schwach gespielt und gewonnen. Sonst sagt
    // der Satz nur, was schon oben steht.
    match (summary.result, accuracy) {
        ("loss", acc) if acc >= 80.0 => {
            out.push(json!({ "key": "verdict.result.wellPlayedLoss", "params": {} }));
        }
        ("win", acc) if acc < 65.0 => {
            out.push(json!({ "key": "verdict.result.luckyWin", "params": {} }));
        }
        _ => {}
    }

    Value::Array(out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn summary() -> GameSummary<'static> {
        GameSummary {
            result: "win",
            accuracy: Some(84.2),
            opponent_accuracy: Some(71.5),
            accuracy_opening: Some(92.0),
            accuracy_middlegame: Some(80.0),
            accuracy_endgame: Some(88.0),
            inaccuracies: 3,
            mistakes: 1,
            blunders: 0,
            turning_point: None,
            recurring: None,
        }
    }

    fn keys(json_text: &str) -> Vec<String> {
        serde_json::from_str::<Vec<Value>>(json_text)
            .unwrap()
            .into_iter()
            .map(|entry| entry["key"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn without_an_accuracy_there_is_no_verdict() {
        let mut s = summary();
        s.accuracy = None;
        assert_eq!(build(&s), "");
    }

    #[test]
    fn the_grade_follows_the_accuracy() {
        let mut s = summary();
        for (accuracy, expected) in [
            (95.0, "verdict.grade.excellent"),
            (84.2, "verdict.grade.solid"),
            (72.0, "verdict.grade.mixed"),
            (60.0, "verdict.grade.shaky"),
            (40.0, "verdict.grade.rough"),
        ] {
            s.accuracy = Some(accuracy);
            assert_eq!(keys(&build(&s))[0], expected);
        }
    }

    #[test]
    fn a_phase_that_held_stays_unmentioned() {
        // Alle drei Phasen über 75 · kein Phasensatz.
        let s = summary();
        assert!(!keys(&build(&s))
            .iter()
            .any(|k| k.starts_with("verdict.phase")));
    }

    #[test]
    fn the_weakest_phase_is_named_when_it_was_weak() {
        let mut s = summary();
        s.accuracy_middlegame = Some(61.0);
        let found = keys(&build(&s));
        assert!(found.contains(&"verdict.phase.middlegame".to_string()));
    }

    #[test]
    fn a_near_equal_opponent_is_not_worth_a_sentence() {
        let mut s = summary();
        s.opponent_accuracy = Some(83.0);
        assert!(!keys(&build(&s))
            .iter()
            .any(|k| k.starts_with("verdict.versus")));
    }

    #[test]
    fn a_motif_seen_once_is_a_coincidence() {
        let mut s = summary();
        s.recurring = Some(("fork".into(), 1));
        assert!(!keys(&build(&s)).contains(&"verdict.recurring".to_string()));
        s.recurring = Some(("fork".into(), 3));
        assert!(keys(&build(&s)).contains(&"verdict.recurring".to_string()));
    }

    #[test]
    fn the_result_speaks_only_when_it_contradicts_the_play() {
        let mut s = summary();
        assert!(!keys(&build(&s))
            .iter()
            .any(|k| k.starts_with("verdict.result")));
        s.result = "loss";
        assert!(keys(&build(&s)).contains(&"verdict.result.wellPlayedLoss".to_string()));
        s.result = "win";
        s.accuracy = Some(58.0);
        assert!(keys(&build(&s)).contains(&"verdict.result.luckyWin".to_string()));
    }

    #[test]
    fn the_turning_point_carries_its_move() {
        let mut s = summary();
        s.turning_point = Some((17, "Nxe5".into()));
        let text = build(&s);
        assert!(text.contains("verdict.turningPoint"));
        assert!(text.contains("Nxe5"));
    }
}
