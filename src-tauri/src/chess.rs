//! Schach-Hilfsfunktionen: SAN-Züge nachspielen, Stellungen normalisieren
//! (fen_key) und die Spielphase bestimmen.
//!
//! Basis ist `owlchess` (MIT). Vorher stand hier `shakmaty`, das GPL-3.0+ ist
//! und statisch gelinkt Kiebitz zu einem abgeleiteten Werk gemacht hätte —
//! anders als Stockfish, das als eigener Prozess über UCI angesprochen wird.
//!
//! **Die von `fen_key` erzeugten Schlüssel stehen in der Datenbank** (Tabelle
//! `positions`, `rep_nodes.fen_key`). Ihr Format darf sich nicht ändern, sonst
//! finden Stellungssuche, Repertoire-Zuordnung und Puzzle-Stellungen in
//! bestehenden Datenbanken nichts mehr. `tests::golden_keys` sichert das mit
//! Werten ab, die noch mit der shakmaty-Implementierung erzeugt wurden.

use owlchess::movegen::legal;
use owlchess::{Board, Color, MoveKind, Piece};

/// Die Stellungsrepräsentation dieses Moduls — Aufrufer sollen `owlchess` nicht
/// direkt importieren müssen.
pub type Position = Board;

/// Eine nachgespielte Halbzug-Station einer Partie.
pub struct WalkedMove {
    /// 1-basierter Halbzug-Index.
    pub ply: u32,
    pub san: String,
    /// Volle FEN der Stellung vor dem Zug.
    pub fen_before: String,
    /// Volle FEN der Stellung nach dem Zug.
    pub fen_after: String,
    /// Normalisierter Schlüssel der Stellung nach dem Zug.
    pub key_after: String,
    /// Spielphase, in der der Zug fiel: opening | middlegame | endgame.
    pub phase: &'static str,
    /// True, wenn Weiß diesen Zug gespielt hat.
    pub by_white: bool,
}

/// Ist ein En-passant-Schlag in dieser Stellung wirklich legal?
///
/// Standard-FEN nennt das En-passant-Feld nach jedem Doppelschritt, auch wenn
/// niemand dort schlagen kann. Für einen Stellungsschlüssel ist das schädlich:
/// dieselbe Stellung bekäme aus verschiedenen Partien verschiedene Schlüssel.
/// Deshalb wird das Feld nur gesetzt, wenn es einen legalen En-passant-Zug gibt
/// — das entspricht `EnPassantMode::Legal` der früheren Implementierung.
fn has_legal_en_passant(pos: &Position) -> bool {
    legal::gen_all(pos)
        .iter()
        .any(|mv| mv.kind() == MoveKind::Enpassant)
}

/// Volle FEN mit auf legales En passant normalisiertem vierten Feld.
fn normalized_fen(pos: &Position) -> String {
    let fen = pos.as_fen();
    let mut fields: Vec<&str> = fen.split(' ').collect();
    if fields.len() == 6 && fields[3] != "-" && !has_legal_en_passant(pos) {
        fields[3] = "-";
    }
    fields.join(" ")
}

/// Normalisierter Stellungsschlüssel: Figuren, Zugrecht, Rochade und legales
/// En passant — ohne Zugzähler, damit identische Stellungen aus verschiedenen
/// Partien denselben Schlüssel bekommen.
pub fn fen_key(pos: &Position) -> String {
    let fen = normalized_fen(pos);
    let mut fields = fen.split(' ');
    let mut key = String::with_capacity(fen.len());
    for i in 0..4 {
        match fields.next() {
            Some(field) => {
                if i > 0 {
                    key.push(' ');
                }
                key.push_str(field);
            }
            None => break,
        }
    }
    key
}

pub fn full_fen(pos: &Position) -> String {
    normalized_fen(pos)
}

/// Normalisiert eine beliebige FEN (z. B. aus chess.js) zum fen_key.
pub fn normalize_fen(fen: &str) -> Result<String, String> {
    let pos = Position::from_fen(fen).map_err(|e| format!("Ungültige FEN: {e}"))?;
    Ok(fen_key(&pos))
}

/// Spielphase einer Stellung: Endspiel, sobald höchstens 6 Nicht-Bauern-
/// Figuren (ohne Könige) auf dem Brett stehen; Eröffnung bis Halbzug 20.
pub fn phase_of(pos: &Position, ply: u32) -> &'static str {
    let pieces = [Piece::Knight, Piece::Bishop, Piece::Rook, Piece::Queen]
        .into_iter()
        .map(|piece| {
            (pos.piece2(Color::White, piece) | pos.piece2(Color::Black, piece)).len()
        })
        .sum::<u32>();
    if pieces <= 6 {
        "endgame"
    } else if ply <= 20 {
        "opening"
    } else {
        "middlegame"
    }
}

/// Spielt eine leerzeichengetrennte SAN-Zugfolge von der Grundstellung nach.
/// Bricht beim ersten unlesbaren/illegalen Zug ab und liefert alles Gültige.
pub fn walk_sans(moves: &str) -> Vec<WalkedMove> {
    let mut pos = Position::initial();
    let mut out = Vec::new();
    for (i, san_str) in moves.split_whitespace().enumerate() {
        let ply = (i + 1) as u32;
        let san: owlchess::moves::san::Move = match san_str.parse() {
            Ok(s) => s,
            Err(_) => break,
        };
        let m = match san.into_move(&pos) {
            Ok(m) => m,
            Err(_) => break,
        };
        let by_white = pos.side() == Color::White;
        let fen_before = full_fen(&pos);
        pos = match pos.make_move(m) {
            Ok(p) => p,
            Err(_) => break,
        };
        out.push(WalkedMove {
            ply,
            san: san_str.to_string(),
            fen_before,
            fen_after: full_fen(&pos),
            key_after: fen_key(&pos),
            phase: phase_of(&pos, ply),
            by_white,
        });
    }
    out
}

/// Kanonische SAN-Schreibweise eines Zuges in einer Stellung, inklusive
/// Schach-/Mattzeichen. Das Repertoire speichert diese Form, damit dieselbe
/// Linie unabhängig von der Eingabeschreibweise denselben Knoten trifft.
pub fn canonical_san(pos: &Position, mv: owlchess::Move) -> Result<String, String> {
    owlchess::moves::san::Move::from_move(mv, pos)
        .map(|san| san.styled(owlchess::moves::san::Style::Algebraic).to_string())
        .map_err(|e| e.to_string())
}

/// Liest einen SAN-Zug in einer Stellung. Fehler sind sprechend, weil das
/// Repertoire sie dem Nutzer zeigt.
pub fn parse_san(pos: &Position, san_str: &str) -> Result<owlchess::Move, String> {
    let san: owlchess::moves::san::Move = san_str
        .parse()
        .map_err(|_| format!("nicht lesbar: {san_str}"))?;
    san.into_move(pos).map_err(|_| format!("illegal: {san_str}"))
}

/// fen_key der Grundstellung.
pub fn start_key() -> String {
    fen_key(&Position::initial())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Korpus für die Schlüssel-Absicherung. Deckt bewusst die Fälle ab, in
    /// denen sich FEN-Konventionen unterscheiden: En passant legal und
    /// illegal, Rochadeverlust, Umwandlung, Halbzugzähler.
    pub(crate) const LINES: &[&str] = &[
        "",
        "e4",
        "e4 e5",
        "e4 d5 e5 f5",
        "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7",
        "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O",
        "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6",
        "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O O-O d3 d6",
        // Endet in einer Umwandlung mit Schlag.
        "e4 d5 exd5 c6 dxc6 Nf6 cxb7 Ne4 bxc8=Q",
        // Bricht bewusst früh ab: prüft, dass unlesbare Folgen dieselbe
        // Teilstellung liefern wie vorher.
        "a4 b5 axb5 a6 bxa6 Nc6 axb7 Rb8 bxc8=Q",
        "d4 Nf6 c4 e6 Nf3 d5 Nc3 c5 cxd5 cxd4 Qxd4 exd5",
        "f4 e5 fxe5 d6 exd6 Bxd6 Nf3 Nf6 e3 O-O",
        "e4 Nf6 e5 Nd5 c4 Nb6 d4 d6 exd6 exd6",
    ];

    pub(crate) const FENS: &[&str] = &[
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
        "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
        "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 5",
        "8/8/8/4k3/8/8/4K3/8 w - - 0 60",
        "4k3/8/8/8/8/8/4P3/4K3 w - - 12 45",
        "r3k2r/8/8/8/8/8/8/R3K2R w Qk - 3 20",
        // Der kritische Fall für die En-passant-Normalisierung: cxd3 wäre
        // möglich, legt aber den König auf a4 dem Turm auf h4 frei. Das
        // ep-Feld d3 darf deshalb *nicht* im Schlüssel stehen.
        "8/8/8/8/k1pP3R/8/8/4K3 b - d3 0 1",
        // Gegenprobe ohne Fesselung: hier ist cxd3 legal, d3 gehört hinein.
        "8/8/8/8/k1pP4/8/8/4K3 b - d3 0 1",
        // Umwandlung steht unmittelbar an.
        "1n2k3/1P6/8/8/8/8/8/4K3 w - - 0 40",
    ];

    #[test]
    fn walks_a_short_game() {
        let walked = walk_sans("e4 e5 Nf3 Nc6 Bc4 Bc5");
        assert_eq!(walked.len(), 6);
        assert_eq!(walked[0].san, "e4");
        assert!(walked[0].by_white);
        assert!(!walked[1].by_white);
        assert_eq!(walked[5].phase, "opening");
        assert!(
            walked[5].key_after.contains("w KQkq"),
            "{}",
            walked[5].key_after
        );
    }

    #[test]
    fn stops_at_illegal_move() {
        let walked = walk_sans("e4 e5 Qxf7 Nc6");
        assert_eq!(walked.len(), 2, "Qxf7 ist illegal, danach ist Schluss");
    }

    #[test]
    fn normalizes_chessjs_fen() {
        // chess.js liefert volle FEN mit Zählern — der Schlüssel lässt sie weg.
        let key =
            normalize_fen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1").unwrap();
        let walked = walk_sans("e4");
        assert_eq!(key, walked[0].key_after);
    }

    /// Ein Doppelschritt allein macht kein En passant: das Feld darf nur im
    /// Schlüssel stehen, wenn dort tatsächlich geschlagen werden kann. Sonst
    /// zerfiele dieselbe Stellung in zwei verschiedene Schlüssel.
    #[test]
    fn en_passant_only_when_legal() {
        let after_e4 = walk_sans("e4");
        assert!(
            after_e4[0].key_after.ends_with(" -"),
            "kein Schläger da, also kein ep-Feld: {}",
            after_e4[0].key_after
        );

        let with_ep = walk_sans("e4 d5 e5 f5");
        assert!(
            with_ep[3].key_after.ends_with(" f6"),
            "exf6 ist legal, also gehört f6 in den Schlüssel: {}",
            with_ep[3].key_after
        );
    }

    #[test]
    fn canonical_san_normalizes_input() {
        let pos = Position::initial();
        let mv = parse_san(&pos, "e4").unwrap();
        assert_eq!(canonical_san(&pos, mv).unwrap(), "e4");

        // Mattzug: das Zeichen gehört in die kanonische Form.
        let pos = Position::from_fen("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2")
            .unwrap();
        let mv = parse_san(&pos, "Qh4").unwrap();
        assert_eq!(canonical_san(&pos, mv).unwrap(), "Qh4#");
    }

    #[test]
    fn phase_follows_material() {
        assert_eq!(phase_of(&Position::initial(), 1), "opening");
        assert_eq!(phase_of(&Position::initial(), 30), "middlegame");
        let endgame = Position::from_fen("4k3/8/8/8/8/8/4P3/4K3 w - - 12 45").unwrap();
        assert_eq!(phase_of(&endgame, 60), "endgame");
    }

    /// Der Import darf nicht stillschweigend mitten in der Partie abbrechen.
    /// `walk_sans` bricht bei unlesbarer Notation ab, deshalb muss der Parser
    /// alles verstehen, was `chess.js` in den `moves`-String schreibt:
    /// Rochade, Präzisierung, Umwandlung, Schach- und Mattzeichen. Geprüft wird
    /// nicht der Inhalt, sondern dass *jeder* Zug verarbeitet wurde.
    #[test]
    fn consumes_every_move_of_real_games() {
        let games = [
            // Morphy – Herzog von Braunschweig/Graf Isouard, 1858: enthält
            // Nbd7 (Präzisierung), O-O-O, Schach- und Mattzeichen.
            "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 \
             Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#",
            // Beide Seiten rochieren kurz.
            "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7",
            // Umwandlung mit Schlag.
            "e4 d5 exd5 c6 dxc6 Nf6 cxb7 Ne4 bxc8=Q",
        ];
        for game in games {
            let expected = game.split_whitespace().count();
            let walked = walk_sans(game);
            assert_eq!(
                walked.len(),
                expected,
                "abgebrochen bei Halbzug {} ({:?})",
                walked.len() + 1,
                game.split_whitespace().nth(walked.len()),
            );
        }
    }

    /// Schlüssel und FEN sind Datenbankinhalt. Die Erwartungswerte stammen aus
    /// der früheren shakmaty-Implementierung (`EnPassantMode::Legal`) und
    /// dürfen sich nicht ändern — sonst finden bestehende Datenbanken ihre
    /// Stellungen nicht mehr wieder.
    #[test]
    fn golden_keys() {
        let mut actual = String::new();
        for line in LINES {
            let walked = walk_sans(line);
            let key = walked.last().map(|w| w.key_after.clone()).unwrap_or_else(start_key);
            let fen = walked.last().map(|w| w.fen_after.clone()).unwrap_or_else(|| full_fen(&Position::initial()));
            actual.push_str(&format!("{key}\n{fen}\n"));
        }
        for fen in FENS {
            actual.push_str(&format!("{}\n", normalize_fen(fen).unwrap()));
        }
        assert_eq!(actual, GOLDEN, "Stellungsschlüssel haben sich verändert");
    }

    const GOLDEN: &str = concat!(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -\n",
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -\n",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\n",
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -\n",
        "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2\n",
        "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6\n",
        "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3\n",
        "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq -\n",
        "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6\n",
        "rnbq1rk1/ppp1bppp/4pn2/3p2B1/2PP4/2N1P3/PP3PPP/R2QKBNR w KQ -\n",
        "rnbq1rk1/ppp1bppp/4pn2/3p2B1/2PP4/2N1P3/PP3PPP/R2QKBNR w KQ - 1 6\n",
        "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq -\n",
        "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6\n",
        "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq -\n",
        "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4\n",
        "rnQqkb1r/p3pppp/8/8/4n3/8/PPPP1PPP/RNBQKBNR b KQkq -\n",
        "rnQqkb1r/p3pppp/8/8/4n3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5\n",
        "r1bqkbnr/2pppppp/P1n5/8/8/8/1PPPPPPP/RNBQKBNR w KQkq -\n",
        "r1bqkbnr/2pppppp/P1n5/8/8/8/1PPPPPPP/RNBQKBNR w KQkq - 1 4\n",
        "rnbqkb1r/pp3ppp/5n2/3p4/3Q4/2N2N2/PP2PPPP/R1B1KB1R w KQkq -\n",
        "rnbqkb1r/pp3ppp/5n2/3p4/3Q4/2N2N2/PP2PPPP/R1B1KB1R w KQkq - 0 7\n",
        "rnbq1rk1/ppp2ppp/3b1n2/8/8/4PN2/PPPP2PP/RNBQKB1R w KQ -\n",
        "rnbq1rk1/ppp2ppp/3b1n2/8/8/4PN2/PPPP2PP/RNBQKB1R w KQ - 1 6\n",
        "rnbqkb1r/ppp2ppp/1n1p4/8/2PP4/8/PP3PPP/RNBQKBNR w KQkq -\n",
        "rnbqkb1r/ppp2ppp/1n1p4/8/2PP4/8/PP3PPP/RNBQKBNR w KQkq - 0 6\n",
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -\n",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -\n",
        "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -\n",
        "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6\n",
        "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq -\n",
        "8/8/8/4k3/8/8/4K3/8 w - -\n",
        "4k3/8/8/8/8/8/4P3/4K3 w - -\n",
        "r3k2r/8/8/8/8/8/8/R3K2R w Qk -\n",
        "8/8/8/8/k1pP3R/8/8/4K3 b - -\n",
        "8/8/8/8/k1pP4/8/8/4K3 b - d3\n",
        "1n2k3/1P6/8/8/8/8/8/4K3 w - -\n",
    );
}
