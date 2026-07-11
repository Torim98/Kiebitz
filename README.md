# Kiebitz

Local-first desktop chess companion. Import your chess.com and Lichess games,
analyze them with Stockfish, build an opening repertoire, and train tactics
puzzles — all from a single dashboard.

> Status: early setup. The prototype will follow.

## Planned features

- **Dashboard** — ratings, recent games, and quick jumps to chess.com & Lichess.
- **Game database** — import from chess.com/Lichess, tags, per-game and per-move notes.
- **Analysis** — Stockfish-powered board analysis and automatic game annotation.
- **Database-wide analysis** — aggregate insights across your entire game history.
- **Opening repertoire** — a position tree trained with spaced repetition.
- **Puzzles** — offline tactics training from the Lichess puzzle database.

## Planned stack

Tauri 2 · React + TypeScript · Rust · SQLite · Stockfish
