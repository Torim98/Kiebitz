/**
 * Beispielpfade für Eingabefelder, passend zur Plattform.
 *
 * Ein Platzhalter ist die einzige Anleitung, die so ein Feld mitbringt · ein
 * `C:\`-Pfad auf einem Android-Telefon führt genau in die falsche Richtung.
 */
export interface ExamplePaths {
  engine: string;
  syzygy: string;
  db: string;
  backup: string;
  puzzleDump: string;
  /** Große Fremdsammlung als PGN oder ChessBase-Datenbank. */
  refdb: string;
}

export function examplePaths(platform?: string): ExamplePaths {
  if (platform === "android" || platform === "ios") {
    return {
      engine: "/data/local/tmp/stockfish",
      syzygy: "/storage/emulated/0/Kiebitz/syzygy",
      db: "/storage/emulated/0/Kiebitz/kiebitz.db",
      backup: "/storage/emulated/0/Kiebitz/kiebitz-backup.db",
      puzzleDump: "/storage/emulated/0/Download/lichess_db_puzzle.csv.zst",
      refdb: "/storage/emulated/0/Download/caissabase.pgn",
    };
  }
  if (platform === "linux" || platform === "macos") {
    return {
      engine: "/usr/local/bin/stockfish",
      syzygy: "~/chess/syzygy",
      db: "~/Kiebitz/kiebitz.db",
      backup: "~/Kiebitz/kiebitz-backup.db",
      puzzleDump: "~/Downloads/lichess_db_puzzle.csv.zst",
      refdb: "~/Downloads/caissabase.pgn",
    };
  }
  return {
    engine: "C:\\Engines\\stockfish.exe",
    syzygy: "D:\\Schach\\syzygy",
    db: "C:\\Kiebitz\\kiebitz.db",
    backup: "C:\\Kiebitz\\kiebitz-backup.db",
    puzzleDump: "C:\\Downloads\\lichess_db_puzzle.csv.zst",
    refdb: "C:\\Downloads\\caissabase.pgn",
  };
}
