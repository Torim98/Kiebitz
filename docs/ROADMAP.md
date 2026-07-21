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
  trainer (curated drills vs. engine, optional Syzygy), Puzzles (Lichess CC0 DB,
  Elo + per-theme), Study/coach (weakness recommendations + learning schedule),
  Insights (live stats).
- **Settings:** German/English i18n, configurable DB location (Nextcloud-ready),
  engine binary + tuning, optional chessdb.cn book, puzzle-DB management,
  account/import defaults. (One dark theme by choice.)
- **Mobile & sync:** Android build (per-ABI native Stockfish), responsive/touch
  UI, LAN device-to-device sync with the desktop as hub.
- **Release:** auto-update via signed GitHub releases (desktop) and CI that also
  builds + signs the Android arm64 APK and attaches it to each release. Mechanics
  in `DEPLOYMENT.md`.

## Next up

Current priorities (added 2026-07-21):

- [ ] **Bugfixing pass.** Work through UI/logic bugs, **starting with the Games
  tab** and continuing through the following tabs.
- [ ] **Deepen Insights.** Grow Insights into serious, in-depth, comprehensive
  analysis — likely split across several sub-tabs rather than one page.
- [ ] **Drag-and-drop study calendar.** Give the study schedule real calendar
  units that can be placed and moved by drag and drop (like a personal
  calendar), beyond today's checklist + week strip.
- [ ] **Puzzles from your own games.** Generate puzzles from the player's own
  positions (the tactical moments the analysis pipeline already flags), not just
  the Lichess dump.
- [ ] **Rebrand the sidebar subtitle.** Replace "Chess cockpit" (top-left) with a
  short pun on bird/Kiebitz (lapwing) + chess.

---

## Done — Phases 1–3 (core, settings, training) ✅

Condensed; the implementation lives in the code.

- **Phase 1 — core made real:** auto-analysis pipeline (`analysis.rs`),
  persistent streaming engine (`live.rs`, MultiPV 3), position search
  (`positions` table), real repertoire (FSRS-4.5 scheduler in Rust), real puzzles
  (streamed Lichess CC0 dump, multi-move trainer, Elo + per-theme accuracy).
- **Phase 2 — settings & config:** `Settings.tsx` / `settings.rs` applied live;
  type-safe i18n (`i18n.tsx`); DB move/use via `VACUUM INTO` (Nextcloud-ready);
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
  desktop→phone; the puzzle DB is imported per-device, not synced.

Done: Android scaffold + engine packaging/resolution (2026-07-17); responsive/
touch pass, verified at 375 px (2026-07-17); sync v1 + v1.1 with UDP discovery,
repertoire tombstones and deterministic puzzle-rating recompute (2026-07-18);
**CI-built, signed arm64 APK attached to every release**, with the Android
Stockfish staged automatically in CI (2026-07-21).

Open:

- [ ] **Automatic background sync.** Once sync is enabled in Settings, it should
  run on its own in the background — triggered by changes (new import, note edit,
  finished analysis, puzzle/endgame attempt, repertoire change) and/or on a
  timer/app-focus, so the user never has to open Settings to sync manually. Needs
  debouncing/coalescing so bursts of changes collapse into one roundtrip, quiet
  handling when the peer is unreachable, and a small status/last-synced indicator.
- [ ] **On-device smoke test** — engine launch + live analysis on a real phone
  (still pending after the build/packaging work).
- [ ] **Sync QR pairing.** Collapse address + 6-digit code into one scan: the
  desktop renders a QR encoding `kiebitz://sync?host=…&code=…`, the phone scans
  it (camera permission + QR decoder) and fills both fields. Nice-to-have; manual
  entry already works. Revisit with TLS so the payload can also carry a cert
  fingerprint.
- [ ] **TLS on the sync channel** (currently cleartext LAN, `usesCleartextTraffic
  =true`). Caveat: Windows Firewall prompts on first server start.
- [ ] **Play Store distribution** (account, signing policy, review overhead).
  Sideloading the signed GitHub-release APK already works.

## Cross-cutting / nice-to-have

- [ ] Per-phase accuracy (separate opening/middlegame/endgame scores), reusing
  the analysis pipeline's game-phase split.
- [ ] PGN import/export for manual / over-the-board games.
- [ ] Tags UI (the schema supports notes; tags are still demo-only).
- [ ] Backup/restore of the database.
- [ ] Tests: expand Rust coverage (importer normalization, stats) and add
  frontend component tests.
- [x] Auto-update — signed GitHub releases as the update feed, background
  check/install on startup (toggleable) + manual check in Settings → Updates.
