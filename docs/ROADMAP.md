# Kiebitz — Roadmap

Where the project stands and what comes next. Living document; reorder freely as
priorities shift.

## Where we are

Kiebitz is a Tauri 2 desktop app (Rust core + React/TypeScript frontend) with
eight modules and a polished dark UI. Everything real runs in the desktop app;
the plain browser build keeps demo fallbacks.

Shipped:

- **Core:** native Stockfish 18 (UCI in Rust) with live single-position analysis
  plus a background auto-analysis pipeline (per-move evals, inaccuracy/mistake/
  blunder, Lichess-style accuracy); SQLite persistence with duplicate-safe
  chess.com/Lichess import and per-game notes; position search across all games.
- **Modules:** Dashboard, Games, Analysis, Repertoire (FSRS training), Endgame
  trainer (curated drills vs. engine, optional Syzygy), Puzzles (Lichess CC0 DB
  plus positions from the player's own games, Elo + per-theme), Study/coach
  (weakness recommendations + persistent drag-and-drop calendar), Insights
  (multi-page in-depth analysis).
- **Settings:** German/English i18n, configurable DB location, engine binary +
  tuning, optional chessdb.cn book, puzzle-DB management, account/import
  defaults. (One dark theme by choice.)
- **Mobile & sync:** Android build (per-ABI native Stockfish), responsive/touch
  UI, LAN device-to-device sync with the desktop as hub.
- **Release:** auto-update via signed GitHub releases for Windows, macOS and
  Linux, plus CI that builds + signs the Android arm64 APK and attaches it to
  each release. Mechanics in `DEPLOYMENT.md`.

## Next up

Current priorities (added 2026-07-21):

- [ ] **Bugfixing pass.** Work through UI/logic bugs, **starting with the Games
  tab** and continuing through the following tabs.
- [x] **macOS and Linux in the release** (2026-08-09). The `desktop` job became a
  matrix over `windows-latest`, `macos-latest` and `ubuntu-22.04`; the two new
  platforms compile Stockfish from the same pinned commit the Android job uses,
  and `tauri.macos.conf.json` / `tauri.linux.conf.json` swap the bundled engine
  resource to the extension-less name. Three things had to be fixed for the code
  to compile off Windows at all: `tiny_http`, `rcgen`, `rustls-pemfile` and
  `qrcode` were declared under `cfg(windows)` although the sync hub they serve
  is `cfg(desktop)`. A new `rust-linux` CI job (`cargo check` on Ubuntu) keeps
  that class of error from reaching a tag again. The three matrix legs now run
  in parallel without letting tauri-action upload `latest.json`; a separate
  `updater-manifest` job assembles the complete manifest once all builds finish.
  Linux auto-updates only via AppImage; macOS builds are unsigned and
  Apple-Silicon-only, both documented in `DEPLOYMENT.md`. **iOS stays out** —
  Stockfish runs as a child process, which iOS forbids, so a port means an
  in-process FFI engine layer next to the existing one.
- [x] **The app explains itself** (2026-08-09). `components/AppTour.tsx` — five
  slides on what Kiebitz does with your games, how analysis, training and the
  study plan connect, and what stays on the device. It runs as the middle step
  of the first-run setup, between language and accounts, so the account question
  arrives after the reason for it. The same component reopens from Settings →
  *Kiebitz kurz erklärt* as an overlay. Deliberately stateless: no "already
  seen" flag anywhere, because replaying it is the point.
- [x] **Study becomes a training programme** (2026-07-31). The tab no longer
  shows the top of the findings list; it answers what to train, how much, and
  whether it worked.
  **Allocation.** `lib/plan.ts` starts from a rating-band prior (below 1400
  blunders dominate, higher up openings and endgames gain weight) and lets the
  findings shift it. Every finding carries a `lever` — which area it is worked
  in and how well Kiebitz can actually train it, so "the field got stronger"
  never pulls budget. The result is a planned-vs-actual bar pair: planned from
  the need, actual from the last 28 days of recorded load. The gap is the
  message, and it also decides which findings become focuses (at most three,
  one per area) so a saturated area is not prescribed a fourth time.
  **Prescriptions.** Each focus is *quantified* and clickable: the puzzle band
  comes from the solve rate per difficulty bucket (below 50 % the material is
  too hard, above 80 % too easy), the daily dose from the budget, the motif from
  the weakest measured theme — and the trainer opens with band and motif already
  set. Endgame findings resolve their material signature to a drill category via
  `ENDGAME_TYPE_CATEGORY`; five new drills cover minor pieces, opposite bishops
  and rook+minor so a named weakness always has an exercise behind it.
  **Effect.** `lib/effect.ts` compares a metric before and after a focus cycle
  (7/14/28 days, chosen in Settings) against a noise floor computed from the
  actual spread — binomial for shares, Poisson for event rates, SD/√n where the
  spread is known. Four verdicts, no more; "not measurable yet" states how much
  material is still missing instead of pretending. Only the *intent* is stored
  (`study_focus`): every measurement is recomputed from raw data, so it survives
  re-imports, new analyses and syncs. Rating is included but deliberately as
  context, converted per pool through `formatScale.ts` — 1100 blitz is not 1100
  rapid, and the same conversion drives the format recommendation and the
  rating-band prior.
  **New data.** `insights.rs` gained opening families (block I: PGN names cut to
  their family, split by colour, so "what I play" and "what I face" are separate
  questions) and metric windows (block J: any metric for any time range, with
  sample size and spread). `rep_review_log` is a new append-only table because
  `rep_nodes.last_ts` only holds the newest review — the past erased itself.
  Both new tables sync.
  **Calendar.** A week plan can be generated from the recommendations: reviews
  land on the days with the most FSRS due cards, tactics spread across the week,
  and nothing is written until the proposal is accepted. Insights → Training
  gained the training balance (load per week against the leading metric, plus a
  lagged high-vs-low-training comparison, labelled as a correlation).
- [x] **Insights, second pass** (2026-07-31). A new Rust module `insights.rs`
  computes everything in one walk over games, clocks and `move_evals` and serves
  it through a single `deep_insights` command. What it adds:
  **time management** (error rate per pace bucket measured as a share of the
  remaining clock, time spent on moves that became errors vs. the rest, time
  trouble, clock edge against the opponent, thinking time burned on moves that
  are already in the repertoire, increment discipline, pace drift across a
  session); **repertoire vs. reality** (who leaves the book first and what it
  costs, shaky lines from the FSRS state, the existing `rep_gaps` map);
  **game content** (conversion of winning positions, save rate, the ply after
  which the evaluation never swings back, unpunished opponent errors, error
  anatomy by piece and by whether the missed best move was forcing, endgame
  types from the material signature); **a benchmark against the player's own
  opponent field** — possible because auto-analysis judges the opponents' moves
  too, so "is 71 % good?" gets a real answer without any external service;
  **sessions** (performance by game index, requeue time after a loss as an
  objective tilt measure, warm-up effect including days with prior puzzle
  training, share of the rating loss coming from the worst sessions);
  **progress** (skill vs. rating, per-motif learning curves, effect of
  repertoire training on games in trained lines); and **time formats**
  (per-format score, performance rating, accuracy, blunder rate, time trouble
  and hours invested).
  Ratings across formats and platforms live in separate pools, so
  `lib/formatScale.ts` converts them onto one scale from published anchor
  points, marks extrapolated and estimated values, and the UI states that skill
  metrics are the only pool-free comparison.
  Against overload: `lib/findings.ts` turns every metric into one ranked list of
  findings with sample-size guards; the overview leads with the top few, each
  tab pins its own, and the Study coach consumes the same list instead of its
  own weaker heuristics. `lib/dna.ts` condenses it into a six-axis profile with
  the opponent field overlaid. Six tabs (overview, strength, time, openings,
  patterns, training), everything below the fold in collapsible sections that
  keep their headline visible, all collapsed by default on the phone.
- [x] **Deepen Insights** (2026-07-22). Insights now has four focused sub-pages:
  overview/diagnosis, playing strength, color-split opening files, and behavioral
  patterns. Added score-rate and 20-game form comparisons, analysis coverage and
  consistency, phase/error, opponent-strength, time-control, game-length,
  weekday/time-slot, bounce-back and losing-streak analysis.
- [x] **Drag-and-drop study calendar** (2026-07-22). A collapsed planner below
  the existing Study checklist/week strip persists editable unit templates and
  scheduled events in SQLite. Units can be added, edited, deleted, assigned by
  date, dragged between days, completed and reopened. Four starter templates
  cover openings, endgames, tactics, and a played game plus analysis.
- [x] **Puzzles from your own games** (2026-07-22). Auto-analysis turns the
  player's missed best moves on mistakes/blunders into directly playable local
  puzzles. Existing analyses are backfilled once; the trainer exposes source
  filters for all, own-game, and Lichess puzzles.
- [x] **Rebrand the sidebar subtitle.** Replaced "Chess cockpit" with
  "Zug um Zugvogel" / "Moves take flight" (2026-07-22).
- [x] **Board sounds** (2026-07-30). Move, capture, castling, promotion and check
  sounds on every board, synthesized in `lib/sound.ts` via Web Audio — no audio
  files, no licensing question, nothing to download. `lib/boardSound.ts` derives
  the sound from the difference between two positions, so the player's move, the
  engine's reply, a puzzle's setup move and stepping through a move list all
  sound alike. Toggle plus volume in Settings → Board & sound.
- [x] **One board size** (2026-07-30). Every playable board now uses the analysis
  board's 528 px (`lib/boardLayout.ts`); the pages' grid columns and the game
  preview column grew with it.
- [x] **Clocks in the analysis board** (2026-07-30). Games import their per-move
  clock readings (`%clk` from chess.com PGN, `clocks=true` from the Lichess API,
  `%clk`/`%emt` from PGN files) into `games.clocks`; the board shows both sides'
  remaining time at the position on screen, the side to move highlighted, plus
  what the move cost. PGN export writes the readings back.
- [x] **Recurring study units** (2026-07-30). A planned unit can repeat daily,
  weekly or every two weeks up to a chosen end date. A series is a row of real
  events sharing a `series_key`, so completing, moving, deleting and syncing stay
  the operations that already existed; "delete series from here" ends it without
  touching the past.
- [x] **Feedback, crash reports and the log** (2026-07-30). `diag.rs` keeps a
  local ring-buffer log plus a rotating file and catches Rust panics and
  unhandled UI errors. The new Feedback page mirrors the website's form
  (feedback / crash / feature) and can attach a diagnostics report the user can
  read in full beforehand — Kiebitz still sends nothing on its own. Shaking an
  Android device opens it straight away.
- [x] **Mobile settings, decluttered** (2026-07-30). On the phone the eleven
  settings cards became collapsed rows with a one-line summary, ordered by how
  often they are needed, with the expert areas behind an "Advanced" heading. The
  desktop layout is unchanged.
- [x] **Chess-pattern backdrop** (2026-07-30). The suggested chessboard from the
  website, lit by a light drifting across it over 96 seconds like Sekundant's
  board backdrop — a few percent above black, and still black everywhere the
  light is not. Frozen for reduced-motion and for store screenshots.

---

## Done — Phases 1–3 (core, settings, training) ✅

Condensed; the implementation lives in the code.

- **Phase 1 — core made real:** auto-analysis pipeline (`analysis.rs`),
  persistent streaming engine (`live.rs`, MultiPV 3), position search
  (`positions` table), real repertoire (FSRS-4.5 scheduler in Rust), real puzzles
  (streamed Lichess CC0 dump, multi-move trainer, Elo + per-theme accuracy).
- **Phase 2 — settings & config:** `Settings.tsx` / `settings.rs` applied live;
  type-safe i18n (`i18n.tsx`); DB move/use via `VACUUM INTO`;
  engine config with test button; chessdb.cn opening book with local cache;
  puzzle-DB management; account handles + import window.
- **Phase 3 — training & learning:** Study/coach tab (data-driven weakness
  recommendations + a "today" checklist, week strip and study streak —
  `coach.ts` / `study.rs`); endgame trainer (`endgame.rs`, curated theoretical
  drills played against the engine, optional Syzygy tablebases).

## Phase 4 — Mobile (Android) — mostly done

Architecture decided and built:

- **Engine — native per-ABI Stockfish, not WASM.** Packaged as
  `jniLibs/<abi>/libstockfish.so` and spawned as a child process from the app's
  `nativeLibraryDir` (the DroidFish pattern), reusing the entire Rust UCI stack
  unchanged — ~2–3× faster than WASM, no SharedArrayBuffer/threading fragility.
  Mobile defaults: 2 threads / 64 MB / lower depth; heavy batch analysis stays on
  the desktop and arrives via sync. (iOS later would link Stockfish in-process —
  out of scope.)
- **Sync — direct device-to-device over the LAN, desktop as hub.** No cloud, no
  server. `sync.rs`: desktop serves `POST /sync` (pairing code, UDP
  auto-discovery); the phone does a one-tap single-roundtrip sync. Merges are
  conflict-free by design — duplicate-safe game upserts, append-only
  attempt/review logs unioned then Elo/FSRS recomputed deterministically, notes
  last-write-wins, repertoire united by SAN path with tombstones; analyses flow
  desktop→phone together with their derived own-game puzzles; the large
  Lichess puzzle DB is imported per-device, not synced.

Done: Android scaffold + engine packaging/resolution (2026-07-17); responsive/
touch pass, verified at 375 px (2026-07-17); sync v1 + v1.1 with UDP discovery,
repertoire tombstones and deterministic puzzle-rating recompute (2026-07-18);
**CI-built, signed arm64 APK attached to every release**, with the Android
Stockfish staged automatically in CI (2026-07-21).

Open:

- [x] **Automatic background sync** (2026-07-21). New `sync_auto` setting; when
  on (mobile, hub configured) `AutoSyncManager` (`lib/syncManager.ts`) runs
  `sync_now` on its own: on local changes via a data-change event
  (`lib/changes.ts`, wired into note/import/puzzle/endgame/repertoire mutations,
  debounced/coalesced), on a periodic timer and on app focus/visibility. A
  min-gap throttle and exponential backoff keep an unreachable peer quiet;
  status (`syncing` / last-synced / offline) shows in the sidebar footer, with a
  toggle in Settings → Device sync. Unit-tested and verified end-to-end on device
  (2026-07-21).
- [x] **On-device smoke test** (2026-07-21) — engine launch + live analysis
  confirmed on a real phone, and the full sync roundtrip against the desktop hub.
- [x] **Match the Android launcher icon to the desktop icon 1:1** (2026-07-21).
  The adaptive foreground previously bled the bird to the canvas edge, so
  square-mask launchers zoomed it in and it read far too large. The foreground is
  now the desktop tile scaled to ~88 % of the 108 dp canvas (bird ≈ 0.6 of the
  canvas), keeping the desktop's bird-to-tile proportion while leaving safe-zone
  margin under both circle and squircle masks. Regenerated from `source-icon.png`
  for all densities in both `icons/android/` and `gen/android/.../mipmap-*`; the
  legacy `ic_launcher(_round).png` already matched and were left as is.
- [x] **Sync QR pairing** (2026-07-21). The desktop hub shows a QR encoding
  `kiebitz://sync?host=<lan-ip>:47323&code=<code>` (Settings → Device sync); the
  phone taps **Scan QR**, the camera reads it (`tauri-plugin-barcode-scanner`,
  `CAMERA` permission) and both fields are filled. Manual entry and Wi-Fi
  discovery stay. Note on reach: the embedded LAN IP works both on the home Wi-Fi
  **and over the FRITZ!Box WireGuard VPN** (the box routes the home subnet into
  the tunnel), so pairing no longer depends on the same-broadcast-domain UDP
  discovery, which never crossed subnets. On-device camera scan still wants a
  real-phone check. Revisit with TLS so the payload can also carry a cert
  fingerprint.
- [x] **TLS on the sync channel** (2026-07-21). The desktop hub now serves only
  HTTPS with a persistent self-signed certificate. QR pairing transfers its
  SHA-256 fingerprint, which the mobile client pins; Android cleartext traffic
  is disabled. Windows Firewall prompts on the first server start.
- [x] **Play Store prerequisites: Android manifest and Stockfish licensing**
  (2026-07-22). Removed the unintended Android TV/Leanback declaration. The
  bundled Stockfish 18 release is pinned to its exact source commit; CI verifies
  its source, Windows archive and NNUE networks, and GPL-3.0, source and binary
  provenance notices are bundled as app resources on both platforms.
- [x] **Licensing made explicit** (2026-07-26). `LICENSE` states
  source-available terms (read, build, private use — no redistribution, no
  commercial use). Stockfish' notice carries a written offer for the
  corresponding source per GPL-3.0 §6, and a `stockfish-source` release job
  attaches the engine's exact source archive to every release, with `publish`
  depending on it. The license texts of all ~650 shipped npm packages and Rust
  crates are generated into a bundled resource, surfaced under Settings → About
  Kiebitz, and kept honest by a `licenses` CI job.
- [x] **Replaced the GPL chess-rules crate** (2026-07-26). The license sweep
  found `shakmaty` (GPL-3.0-or-later, no linking exception) statically linked in
  `chess.rs` and `repertoire.rs` — that made the binary a derivative work and
  contradicted `LICENSE`. Swapped for `owlchess` (MIT), which covers FEN with
  counters, SAN parsing *and* canonical SAN formatting, and legal move
  generation. Because `fen_key` values are stored in the database, the old
  implementation was kept temporarily to generate golden values over a corpus
  covering legal/illegal en passant (including the pin case where the capture
  would expose the king), castling-right loss, capture-promotion, half-move
  counters and early-abort lines; the new implementation reproduces all of them
  byte-for-byte, so existing databases keep working. `tests::golden_keys` locks
  that in. The dependency graph now contains no copyleft crate.
- [x] **Play Store technical build** (2026-07-27). Separate `play-store` flavor
  without the external APK updater or exact-alarm permissions; signed AAB build
  and verifier for package/API/permissions/signature; every native library,
  including a source-built Stockfish 18, has 16-KB ELF alignment.
- [ ] **Play Store distribution** (Play App Signing enrollment, store listing,
  closed test, production-access request and review). Sideloading the signed
  GitHub-release APK already works.

## Cross-cutting / nice-to-have

- [x] **Per-phase accuracy** (2026-07-21). Analysis stores separate opening,
  middlegame and endgame scores using the existing game-phase split; game details
  and Insights expose the values.
- [x] **PGN import/export for manual / over-the-board games** (2026-07-21).
  Multi-game PGNs retain player perspective, metadata, notes and Kiebitz tags.
- [x] **Tags UI** (2026-07-21). Tags can be added/removed per game, searched,
  persisted in SQLite and synchronized between devices.
- [x] **Backup/restore of the database** (2026-07-21). Settings can create a
  consistent SQLite backup and validate/restore it over the active database.
- [x] Frontend tests + CI. Vitest set up (jsdom + Testing Library, `npm test` /
  `npm run test:run`); unit tests for importer normalization (`importer.ts`,
  fetch-mocked), dashboard/insights stats (`stats.ts`), number/FEN helpers
  (`util.ts`) and game mapping (`gameUi.ts`), pure presentational components
  (`components/ui.tsx`), plus data-backed Dashboard and Study page interactions
  with mocked Tauri `invoke` calls — 56 tests total. The CI workflow (`ci.yml`)
  runs the type-check and frontend tests on every push/PR to main.
- [x] **Rust coverage across all backend modules** (2026-07-22). Added tests for
  the previously uncovered `endgame`, `study`, `puzzles`, `live` and `updater`
  modules: database aggregation, streak/due logic, puzzle selection and Elo
  persistence, UCI parsing, engine lifecycle and updater progress throttling.
  The 47-test Rust suite now runs in CI on Windows, avoiding the additional
  GTK/WebKit system dependencies a Linux Tauri build would require.
- [x] **Data-backed frontend interaction tests** (2026-07-22). Dashboard, Study,
  its persistent planner, and the four Insights sub-pages exercise asynchronous
  backend loading and navigation/filter actions through mocked Tauri `invoke`
  calls, including coach recommendations and daily plan completion.
- [x] Update flow — signed GitHub releases as the feed; desktop has toggleable
  background check/install plus a manual action, while Android checks the same
  feed and opens the matching signed APK for user-confirmed installation.
