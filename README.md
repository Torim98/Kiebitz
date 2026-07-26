# Kiebitz

Local-first chess companion for desktop and Android. Import your chess.com and
Lichess games, analyze them with a native Stockfish, build an opening repertoire,
train tactics and endgames — all from a single dashboard, with your data staying
on your own devices.

No account, no cloud, no telemetry. Devices sync directly with each other over
the local network.

**Website:** <https://torim98.github.io/kiebitz-site/> · **Downloads:**
[latest release](https://github.com/Torim98/Kiebitz/releases/latest)

## Features

- **Dashboard** — ratings, recent games, quick jumps to chess.com & Lichess.
- **Game database** — duplicate-safe import from chess.com/Lichess, PGN
  import/export, tags, per-game and per-move notes, position search.
- **Analysis** — live Stockfish analysis plus a background pipeline that
  annotates every game (per-move evals, inaccuracy/mistake/blunder, accuracy).
- **Insights** — four in-depth pages on playing strength, openings by color,
  behavioral patterns and error phases across your whole history.
- **Repertoire** — a position tree trained with FSRS spaced repetition.
- **Puzzles** — offline tactics from the Lichess database *and* from your own
  missed moves, with Elo and per-theme tracking.
- **Endgames** — curated theoretical drills against the engine, optional Syzygy.
- **Study** — data-driven weakness recommendations, daily checklist, and a
  drag-and-drop study planner.
- **Mobile** — Android build with native per-ABI Stockfish and encrypted
  device-to-device LAN sync (QR pairing) with the desktop as hub.

German and English, one carefully made dark theme.

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

Build, packaging and release mechanics: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Where the project stands and what is next: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Stack

Tauri 2 · React + TypeScript · Rust · SQLite · Stockfish

## License

Kiebitz is **source-available, not open source**. You may read the code, build it
and run it privately; redistribution and commercial use are not permitted. See
[`LICENSE`](LICENSE) for the exact terms.

Bundled third-party software keeps its own license — notably Stockfish under
GPL-3.0, whose corresponding source is attached to every release. See
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
