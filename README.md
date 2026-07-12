# Kiebitz

Local-first desktop chess companion. Import your chess.com and Lichess games,
analyze them with Stockfish, build an opening repertoire, and train tactics
puzzles — all from a single dashboard.

> Status: UI prototype with demo data + Tauri 2 shell (Rust backend with UCI
> engine client). Real data import, SQLite persistence and live Stockfish
> analysis are next.

## Development

```sh
npm install        # frontend dependencies
npm run dev        # web preview at http://localhost:5173
npm run tauri dev  # desktop app (requires Rust + MSVC C++ toolchain)
```

Live analysis needs a Stockfish binary (not bundled in the repo). Place one at
`src-tauri/binaries/stockfish.exe`, or point the `KIEBITZ_ENGINE` environment
variable at any UCI engine. In the web preview the analysis panel shows demo
values instead.

## Planned features

- **Dashboard** — ratings, recent games, and quick jumps to chess.com & Lichess.
- **Game database** — import from chess.com/Lichess, tags, per-game and per-move notes.
- **Analysis** — Stockfish-powered board analysis and automatic game annotation.
- **Database-wide analysis** — aggregate insights across your entire game history.
- **Opening repertoire** — a position tree trained with spaced repetition.
- **Puzzles** — offline tactics training from the Lichess puzzle database.

## Planned stack

Tauri 2 · React + TypeScript · Rust · SQLite · Stockfish
