//! Partien aus einer En-Croissant-Datenbank (`.db3`) lesen.
//!
//! `.db3` ist eine SQLite-Datei mit fünf Tabellen (`Info`, `Events`, `Sites`,
//! `Players`, `Games`), wie sie das freie Programm [En Croissant] schreibt und
//! wie sie fertig zum Herunterladen bereitliegen — MillionBase, Lumbra's
//! Gigabase und ähnliche Sammlungen gibt es in dieser Form. Für eine
//! Referenzdatenbank ist das das freundlichere Format: Elf Millionen Partien
//! wiegen darin knapp drei Gigabyte statt der zwanzig, die dieselbe Sammlung
//! als PGN bräuchte.
//!
//! ## Das Zugformat
//!
//! Der Preis dafür steht in der Spalte `Moves`: ein Byte je Halbzug, und dieses
//! Byte ist **der Index des Zuges in der Liste der legalen Züge der Stellung**.
//! Es steht darin also weder Herkunft noch Ziel — die Zahl bedeutet nur etwas,
//! wenn man die Zugliste in exakt derselben Reihenfolge erzeugt wie der
//! Schreiber. En Croissant benutzt dafür `shakmaty`; Kiebitz benutzt owlchess
//! (siehe chess.rs — shakmaty ist GPL und kommt als Abhängigkeit nicht in
//! Frage). Dieses Modul stellt die Reihenfolge deshalb selbst her: Es erzeugt
//! die legalen Züge mit owlchess und *sortiert* sie nach der Regel, in der der
//! andere Generator sie erzeugt. Diese Regel steht in `order_key`.
//!
//! Vier Bytewerte sind keine Züge, sondern Marken: Variante auf, Variante zu,
//! Kommentar, NAG (255 bis 252). Ein Kommentar und ein NAG tragen ihre Länge
//! als zwei Bytes hinter der Marke. Für ein Buch zählt die Hauptvariante, also
//! wird alles zwischen „Variante auf" und „Variante zu" übersprungen — dieselbe
//! Entscheidung wie beim PGN-Import (`refdb::main_line`).
//!
//! ## Warum das trotzdem verlässlich ist
//!
//! Eine nachgebaute Reihenfolge, die an einer Stelle abweicht, liefert nicht
//! etwa einen Fehler, sondern einen anderen, ebenfalls legalen Zug — und damit
//! eine erfundene Partie. Deshalb prüft jede eingelesene Partie sich selbst:
//! Die Datei speichert zu jeder Partie `PawnHome`, eine 16-Bit-Maske der Bauern,
//! die in der *Schlussstellung* noch auf ihrer Grundreihe stehen. Diese Maske
//! hängt an der gesamten Zugfolge. Stimmt sie nicht mit der überein, die sich
//! aus den nachgespielten Zügen ergibt, wird die Partie verworfen und gezählt,
//! statt still Unsinn in die Referenzdatenbank zu schreiben.
//!
//! [En Croissant]: https://encroissant.org/

use crate::chess;
use owlchess::movegen::legal;
use owlchess::{Board, Color, Coord, Move, MoveKind, Piece};

/// Bytewerte, die keine Züge sind. Eine Stellung hat höchstens 218 legale
/// Züge, die vier obersten Werte sind damit frei.
const VARIATION_START: u8 = 255;
const VARIATION_END: u8 = 254;
const COMMENT: u8 = 253;
const NAG: u8 = 252;

/// Feldnummer in der Zählung des anderen Generators: a1 = 0, h8 = 63.
///
/// owlchess zählt andersherum (a8 = 0, h1 = 63). Die Umrechnung steht hier
/// einmal, weil jede Sortierregel unten auf ihr beruht.
fn sq(c: Coord) -> u8 {
    ((7 - c.rank().index()) * 8 + c.file().index()) as u8
}

/// Rang eines Umwandlungsstücks in der Reihenfolge, in der der Schreiber die
/// vier Möglichkeiten anhängt: Dame, Turm, Läufer, Springer.
fn promo_rank(kind: MoveKind) -> u8 {
    match kind {
        MoveKind::PromoteQueen => 0,
        MoveKind::PromoteRook => 1,
        MoveKind::PromoteBishop => 2,
        MoveKind::PromoteKnight => 3,
        _ => 0,
    }
}

fn is_promotion(kind: MoveKind) -> bool {
    matches!(
        kind,
        MoveKind::PromoteQueen
            | MoveKind::PromoteRook
            | MoveKind::PromoteBishop
            | MoveKind::PromoteKnight
    )
}

/// Der Sortierschlüssel eines Zuges · die ganze Formatkenntnis dieses Moduls.
///
/// Der Schreiber erzeugt die Zugliste in festen Abschnitten und läuft in jedem
/// über ein Bitboard, also aufsteigend nach Feldnummer. Die Abschnitte sind, in
/// dieser Reihenfolge:
///
/// 0. En passant (nach Herkunftsfeld)
/// 1. Bauernschlag zur a-Linie hin, ohne Umwandlung (nach Zielfeld)
/// 2. derselbe Schlag mit Umwandlung (Zielfeld, dann D/T/L/S)
/// 3. Bauernschlag zur h-Linie hin, ohne Umwandlung
/// 4. derselbe Schlag mit Umwandlung
/// 5. Einfacher Bauernzug ohne Umwandlung
/// 6. Einfacher Bauernzug mit Umwandlung
/// 7. Doppelschritt
/// 8. Springer · 9. Läufer · 10. Turm · 11. Dame (Herkunft, dann Ziel)
/// 12. König (nach Zielfeld)
/// 13. kurze Rochade · 14. lange Rochade
///
/// **Im Schach steht der König vorn.** Steht die eigene Seite im Schach, erzeugt
/// der Schreiber erst die Königszüge und dann — nur bei einfachem Schach — die
/// übrigen Züge in derselben inneren Reihenfolge; Rochaden entfallen. Das ist
/// der einzige Unterschied, und `in_check` schaltet ihn.
fn order_key(mv: Move, in_check: bool) -> (u8, u8, u8) {
    let kind = mv.kind();
    let from = mv.src();
    let to = mv.dst();
    let piece = mv.src_cell().piece();

    // Reihenfolge innerhalb von `gen_non_king`: 1 bis 11. Der König und die
    // Rochaden stehen außerhalb und bekommen ihre Nummer weiter unten.
    let non_king = |group: u8| if in_check { group + 1 } else { group };

    match kind {
        MoveKind::Enpassant => (0, sq(from), 0),
        MoveKind::CastlingKingside => (13, 0, 0),
        MoveKind::CastlingQueenside => (14, 0, 0),
        MoveKind::PawnDouble => (non_king(7), sq(to), 0),
        _ if piece == Some(Piece::King) => (if in_check { 1 } else { 12 }, sq(to), 0),
        _ if piece == Some(Piece::Pawn) => {
            // Ein Bauer, der die Linie wechselt, schlägt · der Doppelschritt und
            // der einfache Zug sind oben bzw. hier schon unterschieden.
            let captures = from.file().index() != to.file().index();
            let promotes = is_promotion(kind);
            let group = match (captures, from.file().index() > to.file().index(), promotes) {
                (true, true, false) => 1,
                (true, true, true) => 2,
                (true, false, false) => 3,
                (true, false, true) => 4,
                (false, _, false) => 5,
                (false, _, true) => 6,
            };
            (non_king(group), sq(to), promo_rank(kind))
        }
        _ => {
            let group = match piece {
                Some(Piece::Knight) => 8,
                Some(Piece::Bishop) => 9,
                Some(Piece::Rook) => 10,
                _ => 11,
            };
            (non_king(group), sq(from), sq(to))
        }
    }
}

/// Die legalen Züge einer Stellung in der Reihenfolge, in der das Byte sie zählt.
pub fn ordered_moves(board: &Board) -> Vec<Move> {
    let in_check = board.is_check();
    let mut moves: Vec<Move> = legal::gen_all(board).iter().copied().collect();
    moves.sort_unstable_by_key(|mv| order_key(*mv, in_check));
    moves
}

/// Die Bauern, die noch auf ihrer Grundreihe stehen · Prüfsumme einer Partie.
///
/// Unteres Byte: weiße Bauern auf der zweiten Reihe, Bit 0 ist die a-Linie.
/// Oberes Byte: schwarze Bauern auf der siebten Reihe, ebenso.
pub fn pawn_home(board: &Board) -> u16 {
    let mut mask = 0u16;
    for file in 0..8u16 {
        let white = Coord::from_index(48 + file as usize); // zweite Reihe
        let black = Coord::from_index(8 + file as usize); // siebte Reihe
        if board.get(white) == owlchess::types::Cell::from_parts(Color::White, Piece::Pawn) {
            mask |= 1 << file;
        }
        if board.get(black) == owlchess::types::Cell::from_parts(Color::Black, Piece::Pawn) {
            mask |= 1 << (file + 8);
        }
    }
    mask
}

/// Eine gelesene Partie.
pub struct DecodedGame {
    /// Die Hauptvariante in SAN · dieselbe Form, die der PGN-Import liefert.
    pub sans: Vec<String>,
    /// Die Bauern-Grundreihen-Maske der Schlussstellung (siehe `pawn_home`).
    pub pawn_home: u16,
}

/// Spielt die Hauptvariante einer Partie nach.
///
/// `None`, sobald ein Byte auf keinen legalen Zug zeigt: Dann stimmt entweder
/// die Datei nicht oder diese Reihenfolge nicht, und in beiden Fällen ist alles
/// Weitere geraten. Kommentare, NAGs und Varianten werden übersprungen.
pub fn decode_mainline(start: &Board, bytes: &[u8]) -> Option<DecodedGame> {
    let mut pos = start.clone();
    let mut sans: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        let byte = bytes[i];
        i += 1;
        match byte {
            VARIATION_START => depth += 1,
            VARIATION_END => depth = depth.saturating_sub(1),
            COMMENT | NAG => {
                // Marke, zwei Bytes Länge, dann der Text · beides überspringen.
                if i + 2 > bytes.len() {
                    return None;
                }
                let len = u16::from_le_bytes([bytes[i], bytes[i + 1]]) as usize;
                i = i.checked_add(2)?.checked_add(len)?;
                if i > bytes.len() {
                    return None;
                }
            }
            index if depth == 0 => {
                let moves = ordered_moves(&pos);
                let mv = *moves.get(index as usize)?;
                sans.push(chess::canonical_san(&pos, mv).ok()?);
                pos = pos.make_move(mv).ok()?;
            }
            // Ein Zug innerhalb einer Variante · die Hauptvariante steht auf
            // ihrer eigenen Stellung weiter, das Byte wird nur weggeworfen.
            _ => {}
        }
    }

    Some(DecodedGame {
        pawn_home: pawn_home(&pos),
        sans,
    })
}

/// Startstellung einer Partie · leeres FEN-Feld heißt Grundstellung.
pub fn start_position(fen: &str) -> Option<Board> {
    let fen = fen.trim();
    if fen.is_empty() {
        Some(Board::initial())
    } else {
        Board::from_fen(fen).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn play(sans: &[&str]) -> Board {
        let mut pos = Board::initial();
        for san in sans {
            let mv = chess::parse_san(&pos, san).unwrap();
            pos = pos.make_move(mv).unwrap();
        }
        pos
    }

    /// Die Grundstellung ist der einzige Fall, dessen Nummerierung sich ohne
    /// Datei nachrechnen lässt: acht einfache Bauernzüge (a3 … h3), acht
    /// Doppelschritte (a4 … h4), dann die vier Springerzüge.
    #[test]
    fn numbers_the_opening_moves_the_way_the_file_does() {
        let board = Board::initial();
        let names: Vec<String> = ordered_moves(&board)
            .iter()
            .map(|mv| chess::canonical_san(&board, *mv).unwrap())
            .collect();
        assert_eq!(
            names,
            vec![
                "a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3", //
                "a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4", //
                "Na3", "Nc3", "Nf3", "Nh3",
            ]
        );
    }

    /// Aus der Häufigkeitsverteilung echter Sammlungen: 12 ist 1. e4, 11 ist
    /// 1. d4, 18 ist 1. Sf3.
    #[test]
    fn decodes_the_three_most_common_first_moves() {
        let board = Board::initial();
        let decoded = |byte: u8| {
            let game = decode_mainline(&board, &[byte]).unwrap();
            game.sans[0].clone()
        };
        assert_eq!(decoded(12), "e4");
        assert_eq!(decoded(11), "d4");
        assert_eq!(decoded(18), "Nf3");
    }

    /// Im Schach kommen die Königszüge vor allen anderen · erst danach folgen
    /// die Züge, die das Schach abblocken, in der Reihenfolge von
    /// `gen_non_king`. Außerhalb des Schachs steht der König hinter ihnen.
    #[test]
    fn puts_king_moves_first_while_in_check() {
        let board = Board::from_fen("4k3/8/5n2/8/8/8/8/4R1K1 b - - 0 1").unwrap();
        let names: Vec<String> = ordered_moves(&board)
            .iter()
            .map(|mv| chess::canonical_san(&board, *mv).unwrap())
            .collect();
        assert_eq!(names, vec!["Kd7", "Kf7", "Kd8", "Kf8", "Ne4"]);
    }

    #[test]
    fn puts_king_moves_last_while_not_in_check() {
        let board = Board::from_fen("4k3/8/5n2/8/8/8/8/5RK1 b - - 0 1").unwrap();
        let names: Vec<String> = ordered_moves(&board)
            .iter()
            .map(|mv| chess::canonical_san(&board, *mv).unwrap())
            .collect();
        let king_at = names.iter().position(|n| n.starts_with('K')).unwrap();
        let knight_at = names.iter().position(|n| n.starts_with('N')).unwrap();
        assert!(knight_at < king_at, "{names:?}");
    }

    /// Umwandlungen hängen als Viererblock am Zielfeld, in der Reihenfolge
    /// Dame, Turm, Läufer, Springer.
    #[test]
    fn orders_promotions_queen_first() {
        let board = Board::from_fen("8/P6k/8/8/8/8/8/K7 w - - 0 1").unwrap();
        let names: Vec<String> = ordered_moves(&board)
            .iter()
            .map(|mv| chess::canonical_san(&board, *mv).unwrap())
            .collect();
        assert_eq!(&names[..4], &["a8=Q", "a8=R", "a8=B", "a8=N"]);
    }

    /// Bauernschläge stehen vor jedem anderen Zug, und der Schlag zur a-Linie
    /// hin vor dem zur h-Linie hin.
    #[test]
    fn orders_pawn_captures_before_pushes_and_west_before_east() {
        // Weißer Bauer auf e4, schwarze Bauern auf d5 und f5.
        let board = Board::from_fen("4k3/8/8/3p1p2/4P3/8/8/4K3 w - - 0 1").unwrap();
        let names: Vec<String> = ordered_moves(&board)
            .iter()
            .map(|mv| chess::canonical_san(&board, *mv).unwrap())
            .collect();
        assert_eq!(&names[..3], &["exd5", "exf5", "e5"]);
    }

    /// Die Grundstellung hat alle sechzehn Bauern zu Hause.
    #[test]
    fn reads_the_pawn_home_mask() {
        assert_eq!(pawn_home(&Board::initial()), 0b1111_1111_1111_1111);
        // Nach 1. e4 e5 fehlen die e-Bauern beider Seiten (Bit 4 und Bit 12).
        assert_eq!(pawn_home(&play(&["e4", "e5"])), 0b1110_1111_1110_1111);
    }

    /// Varianten, Kommentare und NAGs gehören nicht in die Hauptvariante.
    #[test]
    fn skips_variations_comments_and_nags() {
        let mut bytes = vec![12]; // 1. e4
        bytes.extend_from_slice(&[NAG, 1, 0, b'!']);
        bytes.extend_from_slice(&[VARIATION_START, 11, VARIATION_END]); // (1. d4)
        bytes.extend_from_slice(&[COMMENT, 3, 0, b'f', b'o', b'o']);
        bytes.push(12); // 1... e5
        let game = decode_mainline(&Board::initial(), &bytes).unwrap();
        assert_eq!(game.sans, vec!["e4", "e5"]);
    }

    /// Ein Index, der auf keinen Zug zeigt, beendet die Partie · lieber keine
    /// als eine erfundene.
    #[test]
    fn refuses_an_index_without_a_move() {
        assert!(decode_mainline(&Board::initial(), &[200]).is_none());
    }

    /// Die Reihenfolge oben ist nachgebaut, nicht dokumentiert · dieser Test
    /// hält sie gegen eine echte Datei.
    ///
    /// Er läuft nicht mit, weil er eine mehrere Gigabyte große Sammlung
    /// braucht, die nicht im Repository liegt:
    ///
    /// ```notrust
    /// KIEBITZ_DB3="…/MillionBase.db3" KIEBITZ_DB3_LIMIT=200000 \
    ///   cargo test --release --lib db3::tests::matches_a_real_database -- --ignored --nocapture
    /// ```
    ///
    /// Geprüft wird jede Partie gegen ihre eigene `PawnHome`-Maske. Eine
    /// Abweichung heißt, dass die Reihenfolge irgendwo anders ist als beim
    /// Schreiber — dann taugt der Import nicht und darf nicht ausgeliefert
    /// werden.
    #[test]
    #[ignore = "braucht eine .db3-Sammlung; Pfad in KIEBITZ_DB3"]
    fn matches_a_real_database() {
        let path = std::env::var("KIEBITZ_DB3").expect("KIEBITZ_DB3 nicht gesetzt");
        let limit: usize = std::env::var("KIEBITZ_DB3_LIMIT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50_000);
        let offset: i64 = std::env::var("KIEBITZ_DB3_OFFSET")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let conn = rusqlite::Connection::open(&path).expect("Datei nicht lesbar");
        let mut stmt = conn
            .prepare("SELECT ID, FEN, Moves, PawnHome, PlyCount FROM Games LIMIT ?1 OFFSET ?2")
            .unwrap();
        let started = std::time::Instant::now();
        let mut checked = 0usize;
        let mut plies = 0usize;
        let mut broken: Vec<i64> = Vec::new();
        let mut mismatched: Vec<i64> = Vec::new();
        let mut short: Vec<i64> = Vec::new();

        let rows = stmt
            .query_map(rusqlite::params![limit as i64, offset], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    r.get::<_, Vec<u8>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                ))
            })
            .unwrap();

        for row in rows {
            let (id, fen, bytes, home, ply_count) = row.unwrap();
            let Some(start) = start_position(&fen) else {
                continue;
            };
            checked += 1;
            match decode_mainline(&start, &bytes) {
                None => broken.push(id),
                Some(game) => {
                    plies += game.sans.len();
                    if let Some(home) = home {
                        if game.pawn_home != home as u16 {
                            mismatched.push(id);
                        }
                    }
                    if ply_count > 0 && game.sans.len() != ply_count as usize {
                        short.push(id);
                    }
                }
            }
        }

        let secs = started.elapsed().as_secs_f64();
        println!(
            "{checked} Partien · {plies} Halbzüge · {secs:.1} s · {:.0} Halbzüge/s",
            plies as f64 / secs
        );
        println!(
            "nicht dekodierbar: {}  {:?}",
            broken.len(),
            &broken[..broken.len().min(5)]
        );
        println!(
            "PawnHome abweichend: {}  {:?}",
            mismatched.len(),
            &mismatched[..mismatched.len().min(5)]
        );
        println!(
            "PlyCount abweichend: {}  {:?}",
            short.len(),
            &short[..short.len().min(5)]
        );
        assert!(checked > 0, "keine Partien gelesen");
        assert!(
            broken.is_empty(),
            "{} Partien nicht dekodierbar",
            broken.len()
        );
        assert!(
            mismatched.is_empty(),
            "{} Partien mit falscher Schlussstellung",
            mismatched.len()
        );
        assert!(
            short.is_empty(),
            "{} Partien mit falscher Zugzahl",
            short.len()
        );
    }
}
