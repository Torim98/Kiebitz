# Kiebitz — Deployment

How to build, package, and distribute Kiebitz. The app is a Tauri 2 desktop
application: a Rust core plus a Vite/React frontend, bundled into a single native
installer per platform.

- Product name: `Kiebitz`
- Bundle identifier: `de.torim.kiebitz`
- Current version: `0.1.0` (`src-tauri/tauri.conf.json` → `version`)

## Prerequisites

Same toolchain as development:

- **Node.js** 20+ (developed on 24) and npm.
- **Rust** stable (developed on 1.97), MSVC toolchain on Windows.
- **C++ build tools** for the target OS:
  - Windows: Visual Studio Build Tools with the "Desktop development with C++"
    workload (MSVC + Windows SDK).
  - macOS: Xcode Command Line Tools.
  - Linux: `webkit2gtk`, `libgtk`, `librsvg`, `patchelf`, and build essentials
    (see the Tauri prerequisites for your distro).

Install project dependencies once:

```sh
npm install
```

## Local build & run

```sh
npm run tauri dev     # dev build, hot-reloaded frontend + Rust
npm run tauri build   # optimized production build + installers
```

`tauri build` runs `npm run build` (type-check + Vite production bundle) first,
then compiles the Rust binary in release mode and packages it.

## Build output

`npm run tauri build` writes to `src-tauri/target/release/bundle/`:

- **Windows**: `msi/Kiebitz_<version>_x64_en-US.msi` and
  `nsis/Kiebitz_<version>_x64-setup.exe`.
- **macOS**: `dmg/Kiebitz_<version>_<arch>.dmg` and a `.app` bundle.
- **Linux**: `deb/`, `rpm/`, and `appimage/` artifacts.

The raw executable is at `src-tauri/target/release/kiebitz(.exe)`.

`bundle.targets` is currently `"all"`; set it to a specific list (e.g. `["nsis"]`)
in `tauri.conf.json` to build only what you ship.

## Bundling the Stockfish engine (required for a real release)

> **This is the most important deployment step.** In development the engine is
> resolved from `src-tauri/binaries/stockfish.exe`, which is **gitignored and not
> part of a production bundle**. A `tauri build` today ships **without** an engine,
> so live analysis would be unavailable on an installed copy.

The backend (`src-tauri/src/lib.rs` → `resolve_engine`) looks for the engine in
this order:

1. the `KIEBITZ_ENGINE` environment variable (an explicit path),
2. `<manifest>/binaries/stockfish[.exe]` (development),
3. `<resource_dir>/binaries/stockfish[.exe]` (installed app).

To make step 3 work, bundle the binary as a resource. In `tauri.conf.json`:

```json
"bundle": {
  "resources": ["binaries/stockfish.exe"]
}
```

This copies the file to `<resource_dir>/binaries/stockfish.exe` in the installed
app, where `resolve_engine` already expects it.

Notes:

- **Cross-platform**: the resource above is Windows-only. For multi-OS releases,
  ship the correct per-OS/arch binary (`stockfish` vs `stockfish.exe`, avx2/bmi2
  vs generic) — either with OS-specific `resources`, or via Tauri's `externalBin`
  sidecar mechanism using target-triple-suffixed names.
- **Licensing**: Stockfish is **GPL-3.0**. Distributing it inside Kiebitz brings
  the combined distribution under GPL obligations (offer of source, license
  compatibility). Fine for private use; review before any public release.
  Alternatively, ship without an engine and let users point `KIEBITZ_ENGINE` at
  their own install.

## Icons

App icons are generated from a single source and committed under
`src-tauri/icons/`. To regenerate after changing the artwork:

```sh
npx tauri icon src-tauri/icons/source-icon.png
```

## Code signing & notarization

Unsigned installers trigger OS warnings (SmartScreen on Windows, Gatekeeper on
macOS). For distribution:

- **Windows**: sign the `.msi`/`.exe` with a code-signing certificate. Configure
  `bundle.windows.certificateThumbprint` (or sign in CI).
- **macOS**: sign with a Developer ID certificate and notarize with Apple; set the
  signing identity and notarization credentials in the build environment.

For private/personal use you can skip signing and dismiss the warnings.

## User data location

The SQLite database (`kiebitz.db`) is created in the OS app-data directory on
first launch, **separate from the installed program** so updates never touch it:

- Windows: `%APPDATA%\de.torim.kiebitz\kiebitz.db`
- macOS: `~/Library/Application Support/de.torim.kiebitz/kiebitz.db`
- Linux: `~/.local/share/de.torim.kiebitz/kiebitz.db`

A configurable location is planned (see `ROADMAP.md`, Settings). Backing up the
app means backing up this file.

## CI/CD (optional)

Cross-platform installers require building on each OS. The standard approach is
GitHub Actions with the official Tauri action, which matrix-builds on
Windows/macOS/Linux and attaches installers to a GitHub release:

```yaml
# .github/workflows/release.yml (sketch)
name: release
on:
  push:
    tags: ["v*"]
jobs:
  build:
    strategy:
      matrix:
        platform: [windows-latest, macos-latest, ubuntu-22.04]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: dtolnay/rust-toolchain@stable
      - run: npm ci
      # Fetch the platform-appropriate Stockfish binary into src-tauri/binaries here.
      - uses: tauri-apps/tauri-action@v0
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Kiebitz ${{ github.ref_name }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add a step to download/place the engine binary per platform before the Tauri
build, and inject signing secrets where applicable.

## Auto-update

The updater plugin (`tauri-plugin-updater`) is wired up. Behavior in the app:

- **On startup** (if enabled in Settings → Updates, default on): a background
  task checks the endpoint, downloads and installs a newer version, and restarts
  the app. A toast announces the download/restart; failures (offline, no release
  yet) are only logged.
- **Manually**: Settings → Updates has a "check now" button and an explicit
  "download & restart" action, independent of the toggle.

The pieces that make it work:

- **Endpoint**: `https://github.com/Torim98/Kiebitz/releases/latest/download/latest.json`
  (`tauri.conf.json` → `plugins.updater.endpoints`). Each release must attach a
  `latest.json` manifest plus the updater artifacts.
- **Signing key pair**: updates are signed (independent of OS code signing).
  - Private key: `C:\Users\tomma\.tauri\kiebitz.key` (no password, **not** in the
    repo — losing it means users must reinstall manually, so back it up).
  - Public key: embedded in `tauri.conf.json` → `plugins.updater.pubkey`.
- **Build**: `bundle.createUpdaterArtifacts: true` makes `tauri build` produce
  `.sig` files next to the installers. Signing requires the env var
  `TAURI_SIGNING_PRIVATE_KEY_PATH` (or `TAURI_SIGNING_PRIVATE_KEY` with the key
  contents — use that one as a CI secret):

  ```sh
  TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kiebitz.key npm run tauri build
  ```

- **Manifest**: the CI route (tauri-action, see above) generates and uploads
  `latest.json` automatically. For a manual release, write it yourself:

  ```json
  {
    "version": "0.2.0",
    "notes": "What changed",
    "pub_date": "2026-07-16T12:00:00Z",
    "platforms": {
      "windows-x86_64": {
        "signature": "<contents of the .sig file>",
        "url": "https://github.com/Torim98/Kiebitz/releases/download/v0.2.0/Kiebitz_0.2.0_x64-setup.exe"
      }
    }
  }
  ```

  and attach it (plus installer and `.sig`) to the GitHub release. The updater
  only offers versions greater than the installed one, so publishing a release
  is all it takes to roll everyone forward.

## Release checklist

1. Bump `version` in `src-tauri/tauri.conf.json` (and `package.json`).
2. Ensure the target Stockfish binary is present and bundled (see above).
3. `npm run tauri build` on each target OS (or via CI) with
   `TAURI_SIGNING_PRIVATE_KEY_PATH` set, so updater `.sig` files are produced.
4. Sign / notarize the installers if distributing publicly.
5. Smoke-test the installed app: import games, run a live analysis, confirm the
   database is created in the app-data directory.
6. Tag the release (`vX.Y.Z`) and attach the installers, `.sig` files, and
   `latest.json` — installed apps then pick the update up on their next start.
