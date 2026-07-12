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

Still running on demo data (not yet wired to the backend): the Repertoire tree,
the Puzzle trainer, and the "errors by game phase" insight (needs the analysis
pipeline below).

---

## Phase 1 — Make the core real

The features that currently show demo data become backed by the database.

- [ ] **Auto-analysis pipeline.** Run Stockfish over imported games in the
  background, cache evaluation per position, detect blunders/mistakes/inaccuracies
  from eval swings, write annotations, and set the `analyzed` flag. Feeds the real
  "errors by game phase" chart and the Analysis queue.
- [ ] **Persistent engine + streaming eval.** Keep Stockfish as a managed,
  long-lived process (Tauri state) instead of spawning per request; stream `info`
  lines to the UI so the eval bar and depth update live.
- [ ] **Position search.** Index positions by FEN hash so "show all my games that
  reached this position" works across the whole database (SQLite FTS / hash table).
- [ ] **Real Repertoire.** Persist the opening tree, train with FSRS spaced
  repetition, and cross-reference against played games ("you left book here in N
  games").
- [ ] **Real Puzzles.** Import the Lichess puzzle database (CC0 dump), store
  locally, filter by theme/rating, track a personal puzzle rating.

## Phase 2 — Settings & configuration

- [ ] **Design a Settings page.** A proper configuration surface, not scattered
  defaults.
  - [ ] **Language switch (German / English).** Introduce i18n; the UI is currently
    German-only. Extract strings, add a locale toggle, persist the choice.
  - [ ] **Database location.** Let the user pick where `kiebitz.db` lives (e.g. a
    Nextcloud folder for cross-device sync). Move/relink safely.
  - [ ] **Chess engine.** Choose the UCI engine binary and tune it (threads, hash,
    MultiPV, depth/skill). Today the engine is resolved from a fixed path /
    `KIEBITZ_ENGINE`; make it user-configurable.
  - [ ] **ChessDB integration.** Optional online move/opening database (e.g.
    chessdb.cn) for opening moves and cloud evals, toggleable and cache-backed.
  - [ ] **Puzzle database source.** Configure/refresh the puzzle DB (Lichess dump
    path, re-import, size).
  - [ ] Account handles (chess.com / Lichess usernames), import defaults, theme.

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

## Cross-cutting / nice-to-have

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
