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

## Releasing a new version (the comfortable way)

A GitHub Actions workflow (`.github/workflows/release.yml`) does the whole
release for you. **Pushing a version tag is the only action you take** — the
workflow then builds on a Windows runner, downloads Stockfish, signs the
installer, creates the GitHub release, and uploads `latest.json`. Installed
apps update themselves on their next start.

### One-time setup

Add the updater's **private signing key** as a repository secret named
`TAURI_SIGNING_PRIVATE_KEY` (the workflow reads it; the key has no password, so
no second secret is needed). From the repo root, with the GitHub CLI:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/kiebitz.key"
# Windows path: C:\Users\tomma\.tauri\kiebitz.key
```

Or paste the file's contents under **GitHub → Settings → Secrets and variables
→ Actions → New repository secret**. That's it — endpoint, public key, and
workflow are already committed.

### Every release — three steps

1. **Bump the version** in `src-tauri/tauri.conf.json` and `package.json` (keep
   them equal). It must be **higher** than what users have installed, or the
   updater won't offer it — e.g. `0.1.0` → `0.2.0`. This `tauri.conf.json`
   version is also what the app shows (sidebar, Settings → Updates) and what the
   updater compares against; `src-tauri/Cargo.toml`'s `version` is unrelated to
   the app version and does not need bumping.
2. **Commit** the bump:

   ```sh
   git commit -am "Release v0.2.0"
   ```

3. **Tag and push** — the tag must be `v` + the version from step 1:

   ```sh
   git tag v0.2.0
   git push origin main --tags
   ```

Then watch **GitHub → Actions**; the run takes ~10–15 min. When it's green,
the release is live with the installer, `.sig`, and `latest.json` attached, and
every running Kiebitz picks the update up on its next launch. Nothing else to do.

> **Tip:** if a build fails, fix it, delete the tag locally and remotely
> (`git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0`), and push it again.

### What the workflow handles for you

- **Engine**: fetches the current official Windows AVX2 Stockfish into
  `src-tauri/binaries/stockfish.exe` before the build (the binary is gitignored,
  so it never lives in the repo). `bundle.resources` then ships it inside the
  installer. For older CPUs, change the asset pattern in the workflow.
- **Signing**: passes `TAURI_SIGNING_PRIVATE_KEY`, so `.sig` files and
  `latest.json` are produced and uploaded automatically.
- **Scope**: Windows only, matching the primary target. To add macOS/Linux,
  turn the job into a matrix over `windows-latest` / `macos-latest` /
  `ubuntu-22.04`, add per-OS Stockfish fetch + resources, and (for macOS) signing
  and notarization credentials.

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

- **Manifest**: the release workflow (see *Releasing a new version*) generates
  and uploads `latest.json` for you — this is the normal path. The updater only
  offers versions greater than the installed one, so publishing a release is all
  it takes to roll everyone forward.

  <details>
  <summary>Manual manifest (fallback, only if you build without CI)</summary>

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

  Attach it (plus installer and `.sig`) to the GitHub release yourself.
  </details>

## Release checklist

The automated flow (see *Releasing a new version*) is the short version of this:

1. Bump `version` in `src-tauri/tauri.conf.json` **and** `package.json`.
2. Commit, then tag `vX.Y.Z` and push (`git push origin main --tags`).
3. Wait for the GitHub Actions run to go green.
4. Smoke-test: install the new release (or let an existing copy auto-update),
   import games, run a live analysis, confirm the database is untouched in the
   app-data directory.

Doing it by hand instead (no CI): build with
`TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kiebitz.key npm run tauri build`, sign /
notarize if distributing publicly, then create the tag and attach the installer,
`.sig`, and `latest.json` to the release yourself.
