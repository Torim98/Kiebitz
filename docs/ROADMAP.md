# Kiebitz — Roadmap

Where the project stands and what comes next. This is a living document; reorder
freely as priorities shift.

## Where we are

Done so far:

- Tauri 2 desktop shell (Rust backend) wrapping the React + TypeScript frontend.
- Six modules with a polished dark UI: Dashboard, Games, Analysis, Repertoire,
  Puzzles, Insights.
- Native Stockfish 18 integration (UCI client in Rust) — live single-position
  analysis on the Analysis page.
- SQLite persistence (`rusqlite`, bundled) with real game import from chess.com
  and Lichess, incremental and full history, duplicate-safe upsert, per-game notes.
- Dashboard and Insights compute live statistics from the local database.
- **Phase 1 complete:** auto-analysis pipeline, persistent streaming engine,
  position search, persistent repertoire with FSRS training, and the local
  Lichess puzzle database. The browser build keeps demo fallbacks; everything
  real runs in the desktop app.
- **Phase 2 complete:** a real Settings page — German/English i18n, configurable
  database location (Nextcloud-ready), engine binary + tuning, optional
  chessdb.cn opening book, puzzle-DB management, and account/import defaults.

---

## Phase 1 — Make the core real ✅

The features that currently show demo data become backed by the database.

- [x] **Auto-analysis pipeline.** Background worker (`analysis.rs`) with its own
  Stockfish instance walks unanalyzed games, caches evals per normalized position
  (`eval_cache`), judges moves by win-probability swings (≥10/20/30 % →
  inaccuracy/mistake/blunder), writes `move_evals`, computes Lichess-style
  accuracy, sets `analyzed`, and streams progress events. Feeds the real
  "errors by game phase" chart (own moves only) and the Analysis queue.
- [x] **Persistent engine + streaming eval.** `live.rs` keeps Stockfish as
  managed Tauri state (MultiPV 3, multi-threaded); a reader thread streams
  parsed `info` lines as `engine://info` events. Eval bar, depth, and three
  PV lines update live while browsing moves.
- [x] **Position search.** Every game position is indexed by normalized EPD key
  (`positions` table, filled at import and during analysis). The Analysis page
  shows "this position in your games" with next-move stats and jump-to-game.
- [x] **Real Repertoire.** Move tree in `rep_nodes` with FSRS-4.5-weight
  scheduler in Rust; lines are added by playing moves on the board; training
  asks due positions and grades answers (correct → Good, wrong → Again);
  coverage and per-node "left book here" stats come from the games database.
- [x] **Real Puzzles.** One-click download (or local-file import) of the Lichess
  CC0 dump (streamed zstd+CSV into SQLite), multi-move trainer with automatic
  opponent replies, theme filter, and an Elo-based personal rating with per-theme
  accuracy tracked in `puzzle_attempts`.

## Phase 2 — Settings & configuration ✅

- [x] **Design a Settings page.** `Settings.tsx` behind the sidebar gear button;
  settings live in `settings.json` in the app-config dir (`settings.rs`), applied
  live (the persistent engine restarts on save). The web preview only exposes the
  language toggle.
  - [x] **Language switch (German / English).** Custom type-safe i18n
    (`src/lib/i18n.tsx`, ~280 keys per language) with a locale context, `t()`
    interpolation, and locale-aware number/date formatting. All UI chrome is
    extracted; demo content and backend error strings intentionally stay German.
  - [x] **Database location.** Settings shows the current path/size; "move"
    creates a consistent copy via `VACUUM INTO` and switches all states, "use"
    relinks to (or creates) a database elsewhere — e.g. a Nextcloud folder. The
    old file stays as a backup; a missing custom path falls back to the default
    at startup.
  - [x] **Chess engine.** Configurable UCI binary (with a test button showing the
    engine name), threads (0 = auto), hash, MultiPV, live-analysis depth, and
    auto-analysis depth. Resolution order: settings path → `KIEBITZ_ENGINE` →
    bundled Stockfish.
  - [x] **ChessDB integration.** Toggleable chessdb.cn opening book (`chessdb.rs`):
    the Analysis page shows known moves with cloud evals; responses are cached
    locally for 30 days (`chessdb_cache`).
  - [x] **Puzzle database source.** Settings shows puzzle count and last-import
    date, with re-download or import-from-file (progress events shared with the
    Puzzles page).
  - [x] Account handles (chess.com / Lichess usernames) feed the importer,
    dashboard links, and greetings; quick-import month window is configurable.
    (A theme picker was skipped — the app ships one dark theme.)

## Phase 3 — Training & learning

- [ ] **Trainer / coach feature.** A guided "what should I work on next" view that
  reads the Insights data and recommends focus areas — weakest openings, weakest
  puzzle motifs, tilt-prone times of day, recurring blunder patterns — and links
  straight into the relevant trainer.
- [ ] **Learning schedule (calendar replacement).** A daily/weekly plan that
  combines due repertoire reviews (FSRS), a puzzle goal, and the analysis backlog
  into a single agenda. Calendar view, streaks, and reminders — meant to replace
  a separate calendar for chess study.
- [ ] **Endgame trainer.** Theoretical endgame drills (Lucena, Philidor, K+P, basic
  mates) with Syzygy tablebase support for perfect play, plus "play it out against
  the engine" from key positions.

## Phase 4 — Mobile

- [ ] **Android + iOS app.** Tauri 2 supports mobile targets, so the React frontend
  can largely be reused. Open questions to resolve first:
  - Engine on mobile: native Stockfish per-arch binary (sidecar) vs. a WASM build;
    battery/thermal limits mean lower default depth.
  - SQLite works on mobile; decide on sync (shared DB via Nextcloud vs. a sync layer).
  - Responsive/touch pass on the UI (board drag, tables, charts) — some layouts are
    already responsive, but the desktop grids need mobile variants.
  - Distribution: Play Store / App Store accounts, signing, review overhead.

## Phase 5 — Real web version (optional)

- [ ] **Turn the browser build into a real web app.** Today, opening the frontend
  in a plain browser yields "web mode": the same UI but backed by demo data, because
  there is no Tauri backend (no SQLite, no engine, no persistence) — it exists as a
  development convenience and a showcase. A genuine web version would replace the
  Rust core with a server-side backend so the browser build becomes fully functional.
  Open questions to resolve first:
  - Backend: a small API service (auth, database, game import) replacing the Tauri
    commands; the frontend's `invoke` layer would swap for HTTP calls behind the
    same interface.
  - Persistence: a hosted database instead of the local SQLite file; decide on
    multi-user vs. single-user, and how it relates to the desktop app's local data.
  - Engine: server-side Stockfish (shared compute, queues) or a client-side WASM
    build — no native process is available in the browser.
  - Hosting, accounts, and the GPL implications of serving Stockfish.

  This is deliberately last and optional: the desktop app is the primary product,
  and this only pays off if a browser-accessible version is actually wanted.

## Phase 6 — LLM coach (hyper optional)

- [ ] **Local LLM as a coach.** Wire up a language model that can answer questions
  about the player's own data — "what are my weaknesses?", "what should I train
  next?", "explain this position", "adjust my training plan" — grounded in the
  Insights/analysis data already in the database. Explore doing it with a small
  **local** model so nothing leaves the machine. Very much a stretch goal, last in
  line after everything else.

## Cross-cutting / nice-to-have

- [ ] Per-phase accuracy. In addition to the overall accuracy, compute and show
  separate accuracy scores for opening, middlegame, and endgame — reusing the
  existing game-phase split from the analysis pipeline.
- [ ] PGN import/export for manual games (over-the-board play).
- [ ] Tags UI (the schema supports notes; tags are still demo-only).
- [ ] Backup/restore of the database.
- [ ] Auto-update (Tauri updater plugin) — see `DEPLOYMENT.md`.
- [ ] Tests: expand Rust coverage (importer normalization, stats) and add frontend
  component tests.

---

## Suggested order

Phase 1 first — it turns the last demo surfaces into real features and unlocks the
data the Trainer needs. Settings (Phase 2) can run in parallel since it's mostly
independent. Trainer/Schedule/Endgame (Phase 3) build on Phase 1's analysis data.
Mobile (Phase 4) is the largest single effort and is best tackled once the desktop
feature set is stable. The real web version (Phase 5) is optional and only worth it
if browser access is genuinely needed — the desktop app remains the primary product.
