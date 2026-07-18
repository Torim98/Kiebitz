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

## Phase 3 — Training & learning ✅

- [x] **Trainer / coach feature.** The Study tab (between Puzzles and Insights)
  opens with coach recommendations computed from the local data (`lib/coach.ts`):
  weakest openings by score, weakest puzzle motif by solve rate, tilt-prone
  4-hour windows vs. the overall win rate, and the game phase where serious
  errors cluster — each with a one-click jump into the matching trainer
  (repertoire, puzzles pre-filtered to the motif, endgame trainer).
- [x] **Learning schedule (calendar replacement).** Same tab, below the coach:
  a "today" checklist (due FSRS reviews, configurable daily puzzle goal, analysis
  backlog) with done-states, plus a Mon–Sun week strip showing completed study
  units per day and the FSRS due-forecast for upcoming days, and a study streak
  across puzzles, endgame drills, and reviews (`study.rs`). Reminders stay
  in-app (the agenda itself); OS notifications were deliberately skipped.
- [x] **Endgame trainer.** Own tab between Repertoire and Puzzles: curated
  theoretical drills (basic mates, K+P key squares/square rule/opposition, Lucena,
  Philidor, Q vs pawn) played out against the engine (`endgame.rs`, own persistent
  Stockfish instance). Win drills end at checkmate, draw drills at any draw;
  attempts land in `endgame_attempts` with per-drill mastery shown in the list.
  Optional Syzygy tablebase folder (Settings → Engine) for perfect defense.

## Phase 4 — Mobile (Android first)

Tauri 2 supports mobile targets; the React frontend and the Rust core are both
reused on Android. The two open questions are decided:

**Decision — engine: native per-ABI Stockfish, not WASM.** Tauri sidecars don't
exist on mobile, but Android allows executing files from the app's
`nativeLibraryDir`: Stockfish is packaged per ABI (arm64-v8a first) as
`libstockfish.so` in `jniLibs` and spawned as a child process (the DroidFish
pattern). This reuses the entire existing Rust UCI stack (`engine.rs`,
`live.rs`, `analysis.rs`, `endgame.rs`) unchanged, runs ~2-3× faster than WASM
at lower energy per node, and avoids the SharedArrayBuffer/threading fragility
of WASM in the Android WebView. Mobile defaults: 1-2 threads, 32-64 MB hash,
lower live depth; batch analysis stays off on the phone (or charging-only) —
heavy analysis lives on the desktop and arrives via sync. (iOS later: child
processes are forbidden there, so Stockfish would be linked in-process as a
static library; out of scope for the Android phase.)

**Decision — sync: direct device-to-device over the local network, desktop as
hub.** No cloud, no server, no third-party requirement (Nextcloud/Syncthing
stay possible for power users via the existing DB-location setting, app
closed). The sync module is written once in Rust and compiled into both apps.
Pairing via QR code (desktop shows, phone scans → token), mDNS discovery,
one-tap "sync now" when both are on the same Wi-Fi. Merge is application-level
(no WAL file copying) and mostly trivial by design: games are duplicate-safe
upserts by natural key; puzzle/endgame attempts and FSRS reviews are
append-only event logs — union them, then recompute Elo/FSRS state
deterministically from the merged log (conflict-free); notes are
last-write-wins by timestamp; analysis results flow desktop → phone. The
puzzle DB is not synced — the phone imports its own (optionally
rating-filtered) subset.

Remaining work:

- [x] Android build scaffold (`tauri android init`), per-ABI engine packaging,
  engine-path resolution from `nativeLibraryDir`, mobile engine defaults.
  Done 2026-07-17: toolchain (JDK 17 portable, SDK, NDK r28, Rust android
  targets — paths in the toolchain memory note), `gen/android` committed
  (build outputs stay gitignored), `tauri.android.conf.json` keeps the
  Windows engine out of the APK, updater plugin is desktop-only (mobile
  stubs), Stockfish 18 android-armv8 ships as
  `jniLibs/arm64-v8a/libstockfish.so` (gitignored, staged manually for now —
  CI download step still pending), `resolve_engine` finds it via
  `/proc/self/maps`, mobile defaults 2 threads/64 MB/depth 14/10. Debug APK
  builds end-to-end (~278 MB debug; release will shrink the Rust lib).
  Windows builds require Developer Mode (symlinks). **On-device engine test
  still pending.**
- [ ] Responsive/touch pass on the UI (board drag, tables, charts) — some layouts
  are already responsive, but the desktop grids need mobile variants.
- [ ] Sync v1: pairing + event-log merge as described above; sync history/status
  in Settings.
- [ ] Distribution: Play Store account, signing, review overhead (or sideload APK
  via GitHub releases first).

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
- [x] Auto-update (Tauri updater plugin). Signed GitHub releases as the update
  feed; background check + install on startup (toggleable in Settings), plus a
  manual check/install in Settings → Updates. Release mechanics in `DEPLOYMENT.md`.
- [ ] Tests: expand Rust coverage (importer normalization, stats) and add frontend
  component tests.