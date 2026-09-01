//! ChessBase-Datenbanken erkennen.
//!
//! Eine ChessBase-Datenbank ist kein einzelnes Dateiformat, sondern ein Dutzend
//! Dateien mit gemeinsamem Namen: `.cbh` die Partieköpfe (feste 46-Byte-Sätze),
//! `.cbg` die Züge, `.cbp`/`.cbt` die Namensverzeichnisse, dazu Anmerkungen,
//! Medien und Suchindizes.
//!
//! Gelesen wird davon bisher nichts. Dieses Modul erkennt die Formate nur, um
//! den Import mit einer brauchbaren Auskunft abzulehnen statt mit einem
//! Parserfehler auf halber Strecke · der Weg in die Referenzdatenbank führt
//! vorerst über den PGN-Export.

use std::path::Path;

/// Auskunft, solange ChessBase-Dateien nicht gelesen werden können.
pub const UNSUPPORTED_HINT: &str = "ChessBase-Dateien (.cbh/.cbv) kann Kiebitz noch nicht lesen. Exportiere die Datenbank in ChessBase nach PGN und lies die PGN-Datei ein.";

/// Gehört diese Datei zu einer ChessBase-Datenbank?
pub fn is_chessbase(path: &Path) -> bool {
    matches!(extension(path).as_str(), "cbh" | "cbv" | "cbf" | "cbg")
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn recognizes_chessbase_files_regardless_of_case() {
        assert!(is_chessbase(&PathBuf::from("Mega Database 2026.CBH")));
        assert!(is_chessbase(&PathBuf::from("archiv.cbv")));
        assert!(!is_chessbase(&PathBuf::from("caissabase.pgn")));
        assert!(!is_chessbase(&PathBuf::from("dump.pgn.zst")));
    }
}
