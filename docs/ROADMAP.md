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
- **Release:** auto-update via signed GitHub releases (desktop) and CI that also
  builds + signs the Android arm64 APK and attaches it to each release. Mechanics
  in `DEPLOYMENT.md`.

## Next up

Current priorities (added 2026-07-21):

- [ ] **Bugfixing pass.** Work through UI/logic bugs, **starting with the Games
  tab** and continuing through the following tabs.
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
  desktop→phone; the puzzle DB is imported per-device, not synced.

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
  the official Android/Windows archive hashes, and GPL-3.0, source and binary
  provenance notices are bundled as app resources on both platforms.
- [ ] **Play Store distribution** (account, signing policy, review overhead).
  Sideloading the signed GitHub-release APK already works.

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
- [x] Auto-update — signed GitHub releases as the update feed, background
  check/install on startup (toggleable) + manual check in Settings → Updates.
