//! Schach-Hilfsfunktionen auf Basis von shakmaty: SAN-Züge nachspielen,
//! Stellungen normalisieren (fen_key) und die Spielphase bestimmen.

use shakmaty::fen::{Epd, Fen};
use shakmaty::san::SanPlus;
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Position};

/// Eine nachgespielte Halbzug-Station einer Partie.
pub struct WalkedMove {
    /// 1-basierter Halbzug-Index.
    pub ply: u32,
    pub san: String,
    /// Volle FEN der Stellung nach dem Zug.
    pub fen_after: String,
    /// Normalisierter Schlüssel der Stellung nach dem Zug.
    pub key_after: String,
    /// Spielphase, in der der Zug fiel: opening | middlegame | endgame.
    pub phase: &'static str,
    /// True, wenn Weiß diesen Zug gespielt hat.
    pub by_white: bool,
}

/// Normalisierter Stellungsschlüssel: EPD (Figuren, Zugrecht, Rochade,
/// legales En-passant) ohne Zugzähler — identische Stellungen aus
/// verschiedenen Partien bekommen denselben Schlüssel.
pub fn fen_key(pos: &Chess) -> String {
    Epd::from_position(pos.clone(), EnPassantMode::Legal).to_string()
}

pub fn full_fen(pos: &Chess) -> String {
    Fen::from_position(pos.clone(), EnPassantMode::Legal).to_string()
}

/// Normalisiert eine beliebige FEN (z. B. aus chess.js) zum fen_key.
pub fn normalize_fen(fen: &str) -> Result<String, String> {
    let parsed: Fen = fen.parse().map_err(|e| format!("Ungültige FEN: {e}"))?;
    let pos: Chess = parsed
        .into_position(CastlingMode::Standard)
        .map_err(|e| format!("Ungültige Stellung: {e}"))?;
    Ok(fen_key(&pos))
}

/// Spielphase einer Stellung: Endspiel, sobald höchstens 6 Nicht-Bauern-
/// Figuren (ohne Könige) auf dem Brett stehen; Eröffnung bis Halbzug 20.
pub fn phase_of(pos: &Chess, ply: u32) -> &'static str {
    let b = pos.board();
    let pieces = (b.knights() | b.bishops() | b.rooks() | b.queens()).count();
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
    let mut pos = Chess::default();
    let mut out = Vec::new();
    for (i, san_str) in moves.split_whitespace().enumerate() {
        let ply = (i + 1) as u32;
        let san: SanPlus = match san_str.parse() {
            Ok(s) => s,
            Err(_) => break,
        };
        let m = match san.san.to_move(&pos) {
            Ok(m) => m,
            Err(_) => break,
        };
        let by_white = pos.turn() == Color::White;
        pos = match pos.play(&m) {
            Ok(p) => p,
            Err(_) => break,
        };
        out.push(WalkedMove {
            ply,
            san: san_str.to_string(),
            fen_after: full_fen(&pos),
            key_after: fen_key(&pos),
            phase: phase_of(&pos, ply),
            by_white,
        });
    }
    out
}

/// fen_key der Grundstellung.
pub fn start_key() -> String {
    fen_key(&Chess::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_a_short_game() {
        let walked = walk_sans("e4 e5 Nf3 Nc6 Bc4 Bc5");
        assert_eq!(walked.len(), 6);
        assert_eq!(walked[0].san, "e4");
        assert!(walked[0].by_white);
        assert!(!walked[1].by_white);
        assert_eq!(walked[5].phase, "opening");
        assert!(walked[5].key_after.contains("w KQkq"), "{}", walked[5].key_after);
    }

    #[test]
    fn stops_at_illegal_move() {
        let walked = walk_sans("e4 e5 Qxf7 Nc6");
        assert_eq!(walked.len(), 2, "Qxf7 ist illegal, danach ist Schluss");
    }

    #[test]
    fn normalizes_chessjs_fen() {
        // chess.js liefert volle FEN mit Zählern — der Schlüssel lässt sie weg.
        let key = normalize_fen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1").unwrap();
        let walked = walk_sans("e4");
        assert_eq!(key, walked[0].key_after);
    }

}
