//! Repertoire als PGN lesen und schreiben · inklusive Varianten.
//!
//! Eröffnungsbücher aus Chessable, Lichess-Studien oder ChessBase kommen als
//! PGN mit Klammervarianten (`1. e4 e5 (1... c5 2. Nf3) 2. Nf3`). Der
//! Partie-Import in `lib/pgn.ts` liest bewusst nur Hauptvarianten · für ein
//! Repertoire ist aber genau der Varianten-Baum der Inhalt.
//!
//! Der Parser ist absichtlich klein und tolerant: Zugnummern, Kommentare,
//! NAGs und Ergebnisse werden übersprungen, unbekannte Züge beenden nur den
//! betroffenen Zweig. Ein halb lesbares Buch soll importierbar bleiben.

use crate::chess;

/// Ein Token des Zugtexts · alles, was der Baum wirklich braucht.
#[derive(Debug, PartialEq)]
enum Token {
    San(String),
    Open,
    Close,
}

/// Zerlegt den Zugtext. Kommentare (`{…}`, `;…`), Zugnummern, NAGs (`$7`) und
/// Ergebnisse fallen dabei weg.
fn tokenize(movetext: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let chars: Vec<char> = movetext.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' => {
                while i < chars.len() && chars[i] != '}' {
                    i += 1;
                }
                i += 1;
            }
            ';' => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            '<' => {
                while i < chars.len() && chars[i] != '>' {
                    i += 1;
                }
                i += 1;
            }
            '(' => {
                out.push(Token::Open);
                i += 1;
            }
            ')' => {
                out.push(Token::Close);
                i += 1;
            }
            '$' => {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            }
            c if c.is_whitespace() => i += 1,
            _ => {
                let start = i;
                while i < chars.len()
                    && !chars[i].is_whitespace()
                    && !matches!(chars[i], '(' | ')' | '{' | '}' | ';' | '<')
                {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                if let Some(san) = clean_san(&word) {
                    out.push(Token::San(san));
                }
            }
        }
    }
    out
}

/// Filtert Zugnummern, Ergebnisse und Platzhalter aus einem Wort.
/// Übrig bleibt der reine SAN-Zug (oder nichts).
pub(crate) fn clean_san(word: &str) -> Option<String> {
    // "12." / "12..." / "12.e4" → alles vor dem letzten Punkt abschneiden.
    let rest = match word.rfind('.') {
        Some(idx) => &word[idx + 1..],
        None => word,
    };
    let rest = rest.trim_matches(|c: char| c == '!' || c == '?');
    if rest.is_empty() {
        return None;
    }
    if matches!(rest, "1-0" | "0-1" | "1/2-1/2" | "*" | "--" | "Z0") {
        return None;
    }
    // Reine Zahlen sind Zugnummern ohne Punkt.
    if rest.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if !rest.starts_with(|c: char| c.is_ascii_alphabetic() || c == 'O') {
        return None;
    }
    Some(rest.to_string())
}

/// Der Zugtext einer PGN-Partie · Header und Leerzeile davor fallen weg.
fn movetext(block: &str) -> String {
    block
        .lines()
        .filter(|line| !line.trim_start().starts_with('['))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Trennt mehrere Partien eines PGN-Texts.
fn split_games(text: &str) -> Vec<String> {
    let mut games: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut seen_moves = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        // Ein neuer Header nach bereits gelesenem Zugtext beginnt die nächste Partie.
        if trimmed.starts_with('[') && seen_moves {
            games.push(std::mem::take(&mut current));
            seen_moves = false;
        }
        if !trimmed.starts_with('[') && !trimmed.is_empty() {
            seen_moves = true;
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        games.push(current);
    }
    games
}

/// Eine eingelesene Linie: Zugfolge ab der Grundstellung.
pub type Line = Vec<String>;

/// Baut aus den Tokens alle Linien des Baums.
///
/// Eine Klammervariante ersetzt den zuletzt gespielten Zug, deshalb merkt sich
/// der Durchlauf immer die Stellung *vor* diesem Zug.
fn collect_lines(tokens: &[Token], start: chess::Position) -> Vec<Line> {
    struct Frame {
        pos: chess::Position,
        line: Line,
        /// Stellung und Linie vor dem zuletzt gespielten Zug.
        previous: Option<(chess::Position, Line)>,
    }

    let mut lines: Vec<Line> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut frame = Frame {
        pos: start,
        line: Vec::new(),
        previous: None,
    };
    // Eine Linie zählt erst, wenn sie nicht bloß der Anfang einer längeren ist.
    let mut pending: Option<Line> = None;

    for token in tokens {
        match token {
            Token::San(san) => {
                let Ok(m) = chess::parse_san(&frame.pos, san) else {
                    // Unlesbarer Zug: diesen Zweig aufgeben, aber das bisher
                    // Gelesene behalten.
                    if !frame.line.is_empty() {
                        pending = Some(frame.line.clone());
                    }
                    frame.previous = None;
                    continue;
                };
                let Ok(canonical) = chess::canonical_san(&frame.pos, m) else {
                    continue;
                };
                let Ok(next) = frame.pos.make_move(m) else {
                    continue;
                };
                frame.previous = Some((frame.pos.clone(), frame.line.clone()));
                frame.pos = next;
                frame.line.push(canonical);
                pending = Some(frame.line.clone());
            }
            Token::Open => {
                let Some((pos, line)) = frame.previous.clone() else {
                    // Variante ohne vorangehenden Zug · nichts, worauf sie
                    // sich beziehen könnte.
                    continue;
                };
                stack.push(Frame {
                    pos: frame.pos.clone(),
                    line: frame.line.clone(),
                    previous: frame.previous.clone(),
                });
                frame = Frame {
                    pos,
                    line,
                    previous: None,
                };
            }
            Token::Close => {
                if let Some(line) = pending.take() {
                    lines.push(line);
                }
                match stack.pop() {
                    Some(parent) => frame = parent,
                    None => break,
                }
            }
        }
    }
    if let Some(line) = pending.take() {
        lines.push(line);
    }
    lines
}

/// Alle Linien eines PGN-Texts (Hauptvarianten und Klammervarianten).
pub fn parse_lines(text: &str) -> Vec<Line> {
    let mut lines: Vec<Line> = Vec::new();
    for block in split_games(text) {
        let tokens = tokenize(&movetext(&block));
        lines.extend(collect_lines(&tokens, chess::Position::initial()));
    }
    // Linien, die vollständig in einer längeren stecken, sind redundant: der
    // Baum entsteht ohnehin aus den längeren.
    lines.sort_by_key(|line| std::cmp::Reverse(line.len()));
    let mut kept: Vec<Line> = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if kept.iter().any(|k| k.starts_with(&line)) {
            continue;
        }
        kept.push(line);
    }
    kept
}

/// Schreibt einen Zugbaum als PGN-Zugtext.
///
/// Das erste Kind ist die Hauptvariante, alle weiteren stehen als Klammer
/// dahinter · genau die Form, die `parse_lines` wieder einliest.
pub struct ExportNode {
    pub san: String,
    pub note: String,
    pub children: Vec<ExportNode>,
}

fn write_moves(out: &mut String, nodes: &[ExportNode], ply: usize) {
    let Some((first, rest)) = nodes.split_first() else {
        return;
    };
    push_move(out, &first.san, &first.note, ply);
    for sibling in rest {
        out.push_str(" (");
        push_move(out, &sibling.san, &sibling.note, ply);
        write_moves(out, &sibling.children, ply + 1);
        out.push(')');
    }
    write_moves(out, &first.children, ply + 1);
}

fn push_move(out: &mut String, san: &str, note: &str, ply: usize) {
    if !out.is_empty() && !out.ends_with('(') {
        out.push(' ');
    }
    let number = ply / 2 + 1;
    if ply % 2 == 0 {
        out.push_str(&format!("{number}. "));
    } else if out.ends_with('(') || out.ends_with(") ") {
        out.push_str(&format!("{number}... "));
    }
    out.push_str(san);
    if !note.trim().is_empty() {
        out.push_str(&format!(" {{{}}}", note.trim().replace(['{', '}'], "")));
    }
}

/// Vollständiges PGN einer Seite (mit Kopfzeilen).
pub fn export_pgn(side: &str, roots: &[ExportNode]) -> String {
    let mut moves = String::new();
    write_moves(&mut moves, roots, 0);
    let event = if side == "white" {
        "Kiebitz repertoire (White)"
    } else {
        "Kiebitz repertoire (Black)"
    };
    format!(
        "[Event \"{event}\"]\n[Site \"Kiebitz\"]\n[Result \"*\"]\n[White \"?\"]\n[Black \"?\"]\n\n{moves} *\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_plain_main_line() {
        let lines = parse_lines("1. e4 e5 2. Nf3 Nc6 *");
        assert_eq!(lines, vec![vec!["e4", "e5", "Nf3", "Nc6"]]);
    }

    #[test]
    fn reads_a_variation_as_its_own_line() {
        let lines = parse_lines("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 *");
        assert!(lines.contains(&vec!["e4".into(), "e5".into(), "Nf3".into()]));
        assert!(lines.contains(&vec!["e4".into(), "c5".into(), "Nf3".into(), "d6".into()]));
    }

    #[test]
    fn reads_nested_variations() {
        let lines = parse_lines("1. d4 d5 2. c4 e6 (2... c6 3. Nf3 (3. Nc3 Nf6) dxc4) 3. Nc3 *");
        assert!(lines.contains(&vec![
            "d4".into(),
            "d5".into(),
            "c4".into(),
            "c6".into(),
            "Nf3".into(),
            "dxc4".into()
        ]));
        assert!(lines.contains(&vec![
            "d4".into(),
            "d5".into(),
            "c4".into(),
            "c6".into(),
            "Nc3".into(),
            "Nf6".into()
        ]));
    }

    #[test]
    fn skips_comments_nags_and_headers() {
        let pgn = "[Event \"Test\"]\n[Result \"*\"]\n\n1. e4 {beste Eröffnung} e5 $1 2. Nf3! *";
        assert_eq!(
            parse_lines(pgn),
            vec![vec!["e4".to_string(), "e5".into(), "Nf3".into()]]
        );
    }

    #[test]
    fn keeps_reading_after_an_illegal_move() {
        // Qh9 gibt es nicht · davor Gelesenes bleibt trotzdem erhalten.
        let lines = parse_lines("1. e4 e5 2. Qh9 Nf6 *");
        assert_eq!(lines, vec![vec!["e4".to_string(), "e5".into()]]);
    }

    #[test]
    fn drops_lines_that_are_prefixes_of_longer_ones() {
        let lines = parse_lines("1. e4 e5 (1... e5 2. Nf3) *");
        assert_eq!(
            lines,
            vec![vec!["e4".to_string(), "e5".into(), "Nf3".into()]]
        );
    }

    #[test]
    fn splits_several_games() {
        let pgn = "[Event \"A\"]\n\n1. e4 e5 *\n\n[Event \"B\"]\n\n1. d4 d5 *\n";
        let lines = parse_lines(pgn);
        assert!(lines.contains(&vec!["e4".to_string(), "e5".into()]));
        assert!(lines.contains(&vec!["d4".to_string(), "d5".into()]));
    }

    #[test]
    fn export_round_trips_through_the_parser() {
        let tree = vec![ExportNode {
            san: "e4".into(),
            note: String::new(),
            children: vec![
                ExportNode {
                    san: "e5".into(),
                    note: "offen".into(),
                    children: vec![ExportNode {
                        san: "Nf3".into(),
                        note: String::new(),
                        children: vec![],
                    }],
                },
                ExportNode {
                    san: "c5".into(),
                    note: String::new(),
                    children: vec![],
                },
            ],
        }];
        let pgn = export_pgn("white", &tree);
        let lines = parse_lines(&pgn);
        assert!(lines.contains(&vec!["e4".to_string(), "e5".into(), "Nf3".into()]));
        assert!(lines.contains(&vec!["e4".to_string(), "c5".into()]));
    }
}
