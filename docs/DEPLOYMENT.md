# Kiebitz — Deployment

How to build, package, and distribute Kiebitz. The app is a Tauri 2 project: a
Rust core plus a Vite/React frontend. The **desktop** build is the primary
product (a native installer per OS, with auto-update). An **Android** build
exists too (Phase 4) — a signed, sideloaded APK that CI now builds and attaches
to each release (no auto-update on mobile); see *Android build* below.

- Product name: `Kiebitz`
- Bundle identifier: `de.torim.kiebitz`
- Current version: `0.4.4` (`src-tauri/tauri.conf.json` → `version`)

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

### One-time setup for the Android build

Only needed if you build the Android APK. On this machine it is already
installed (2026-07-17); these are the steps to reproduce it elsewhere. No
Android Studio required — the command-line tools are enough.

1. **JDK 17** (Temurin). Portable zip is fine; set `JAVA_HOME` to it. On this
   machine: `C:\Users\tomma\AppData\Local\Java\jdk-17.0.19+10`.
2. **Android SDK** via the command-line tools. Unzip Google's
   `commandlinetools` into `<sdk>\cmdline-tools\latest\`, set `ANDROID_HOME`
   to `<sdk>` (here: `C:\Users\tomma\AppData\Local\Android\Sdk`), then:

   ```sh
   sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0" "ndk;28.2.13676358"
   ```

   Set `NDK_HOME` to `<sdk>\ndk\28.2.13676358`.
3. **Rust Android targets**:

   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

4. **Windows only — enable Developer Mode** (Settings → System → For
   developers). The Tarui CLI symlinks the built `libapp_lib.so` into the
   Gradle project, which needs the symlink privilege.

`JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME` are persisted as user environment
variables, but tools that keep a long-lived shell don't always inherit them —
export all three inline in the same command when invoking `tauri android` (see
*Android build*).

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
  "resources": [
    "binaries/stockfish.exe",
    "resources/stockfish/NOTICE.txt",
    "resources/stockfish/COPYING.txt"
  ]
}
```

This copies the file to `<resource_dir>/binaries/stockfish.exe` in the installed
app, where `resolve_engine` already expects it.

Notes:

- **Cross-platform**: the resource above is Windows-only. For multi-OS releases,
  ship the correct per-OS/arch binary (`stockfish` vs `stockfish.exe`, avx2/bmi2
  vs generic) — either with OS-specific `resources`, or via Tauri's `externalBin`
  sidecar mechanism using target-triple-suffixed names.
- **Licensing**: Stockfish is **GPL-3.0** and Kiebitz distributes its unmodified
  official binary as a separate UCI process. `resources/stockfish/NOTICE.txt`
  records Stockfish 18, the exact source commit, official binary URLs and their
  SHA-256 hashes; `COPYING.txt` contains the complete GPL-3.0. Both files are
  bundled on desktop and Android and are also referenced by
  `THIRD_PARTY_NOTICES.md`. CI downloads only the pinned `sf_18` archives and
  aborts if a hash differs. Keep this provenance in sync whenever Stockfish is
  upgraded.

## Android build (APK)

The Android app reuses the same Rust core and React frontend. A tagged release
now builds and attaches a signed APK automatically (see *Releasing a new
version*); the steps here are for **local** builds and to explain the moving
parts. The app is **sideloaded** and does **not** auto-update (the updater
plugin is desktop-only; mobile updates by reinstalling a newer APK).

> **Two version fields.** `versionName` is the human-readable string (e.g.
> `0.4.0`, shown in-app) and comes straight from `tauri.conf.json`. `versionCode`
> is a separate integer Android uses to compare "newer/older" for installs; it is
> **never shown** and must be an integer, so it cannot literally be `0.4.0`. Tauri
> derives it from the version (`0.4.0` → `4000`, `0.4.1` → `4001`, monotonic),
> which is why installs over an older APK work. Nothing to set by hand.

Build a debug APK (arm64), exporting the toolchain paths inline:

```sh
JAVA_HOME=".../jdk-17.0.19+10" \
ANDROID_HOME=".../Android/Sdk" \
NDK_HOME=".../Android/Sdk/ndk/28.2.13676358" \
npx tauri android build --debug --apk --target aarch64
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
(~130 MB debug; a release build strips the Rust lib and is much smaller).

Install on a device (USB debugging on): `adb install -r <apk>`. A newer APK
with the **same signature** installs over the old one and keeps the on-device
database; `-r` is the reinstall flag. Or copy the APK to the phone (e.g. via a
synced folder) and tap it, allowing "install from unknown sources".

Android-specific pieces (already wired in `src-tauri/gen/android`, which is
committed; build outputs and the engine `.so` stay gitignored):

- **Engine**: Stockfish ships per ABI as
  `app/src/main/jniLibs/<abi>/libstockfish.so` (arm64 today). CI stages it
  automatically (downloads the pinned Stockfish 18 `stockfish-android-armv8`);
  for a **local**
  build download that asset and copy it in yourself. `resolve_engine`
  (`src-tauri/src/lib.rs`) finds it in the app's `nativeLibraryDir` via
  `/proc/self/maps`.
- **Native lib packaging**: `useLegacyPackaging = true` in
  `app/build.gradle.kts` sets `extractNativeLibs`, so the engine `.so` is
  unpacked as a real, executable file — required to launch it as a UCI child
  process (and it shrinks the APK).
- **Config**: `src-tauri/tauri.android.conf.json` drops the desktop
  `stockfish.exe` resource and the updater artifacts from the mobile bundle.

CI now builds a **signed** arm64 release APK on every tagged release and attaches
it to the GitHub release (see *Releasing a new version* → *One-time setup* for the
keystore secrets). The steps above stay valid for local/manual builds. Still open:
multi-ABI packaging and a Play-Store track — see `ROADMAP.md`, Phase 4.

## Icons

App icons for **all** targets — desktop (`.ico`/`.icns`/`.png`), iOS, and the
Android launcher (`gen/android/.../res/mipmap-*`) — are generated from a single
source and committed. To regenerate after changing the artwork:

```sh
npx tauri icon src-tauri/icons/source-icon.png
```

This is Android-aware when `gen/android` exists and writes the launcher icons
there too. Two things must be re-applied after regenerating, because `tauri icon`
overwrites them:

- **Adaptive background** — `tauri icon` sets it to white; for Kiebitz it must be
  the dark green `#103528` in
  `gen/android/app/src/main/res/values/ic_launcher_background.xml` (otherwise
  square-mask launchers show white corners).
- **Adaptive foreground scale** — `tauri icon` bleeds the whole source to the
  foreground edge, which square-mask launchers zoom in so the bird looks far too
  large. The committed `ic_launcher_foreground.png` (all densities, in both
  `icons/android/` and `gen/android/.../mipmap-*`) are instead the source tile
  scaled to ~88 % of the 108 dp canvas on a transparent background, so the bird
  keeps its desktop proportion inside the adaptive safe zone. Regenerate with a
  short script rather than by hand — for each density canvas `N` (mdpi 108 →
  xxxhdpi 432), paste `source-icon.png` resized to `round(N*0.88)` centred on a
  transparent `N×N` image.

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
release for you. The checked-in PowerShell command **is the only command you
need to run locally**: it verifies the working tree and version, runs the test
suite, updates all version files, commits, creates an annotated tag, and pushes
`main` plus the tag. Pushing the tag starts the CI workflow.

> **Scope:** pushing a tag now builds **both** the Windows desktop installer and
> a signed **Android arm64 APK**, and attaches the APK to the same GitHub release
> (`Kiebitz_<version>_arm64.apk`). The desktop app auto-updates; **Android does
> not** — the APK is for manual/sideload install, and a newer one installs over
> the old (keeping the on-device DB) only because CI signs every build with the
> **same** keystore. The Android job runs only once the keystore secret is set
> (see *One-time setup*); until then it is skipped and the desktop release is
> unaffected.

### One-time setup

**Desktop updater key.** Add the updater's **private signing key** as a
repository secret named `TAURI_SIGNING_PRIVATE_KEY` (the workflow reads it; the
key has no password, so no second secret is needed). From the repo root, with
the GitHub CLI:

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY < "$HOME/.tauri/kiebitz.key"
# Windows path: C:\Users\tomma\.tauri\kiebitz.key
```

Or paste the file's contents under **GitHub → Settings → Secrets and variables
→ Actions → New repository secret**. That's it for the desktop app — endpoint,
public key, and workflow are already committed.

**Android signing keystore.** This is a **separate** credential from the updater
key above: the updater key (minisign) only verifies desktop *update manifests*;
Android needs a Java **keystore** for `apksigner` to sign the APK itself — the
two are different formats and cannot be substituted for each other. Because this
repo is **public**, the keystore must live in **secrets**, never committed.

Create the keystore once with `keytool` — **back it up**, losing it means new
APKs can no longer install over old ones without uninstalling. `keytool` ships
inside any JDK; it is only needed for this one step (CI brings its own JDK for
the actual build). If you don't have a JDK on the machine, install one first.

**macOS / Linux** (keytool on `PATH`):

```sh
keytool -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Kiebitz, O=Torim, C=DE"
# choose a store password when prompted; press Enter at the key password to reuse it
```

**Windows (PowerShell).** There is no standalone `keytool` — install a JDK, then
call `keytool` by its full path (a fresh shell is not even required this way):

```powershell
winget install EclipseAdoptium.Temurin.17.JDK
# resolves keytool.exe regardless of the exact patch version installed:
$kt = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\keytool.exe" | Select-Object -First 1).FullName
& $kt -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kiebitz, O=Torim, C=DE"
# choose a store password; press Enter at the key password to reuse it
```

> Don't rely on `$env:JAVA_HOME` for this — a stale or unset value gives a
> confusing "not recognized as ... program" error even though the path looks
> right. The `Get-ChildItem` resolver above sidesteps it.

> **PKCS12 keystores (keytool's default since JDK 9) use one password** — the
> store and key password must be **identical**. If `ANDROID_KEY_PASSWORD` differs
> from `ANDROID_KEYSTORE_PASSWORD`, the signing step fails with `Get Key failed:
> Given final block not properly padded`. Set both secrets to the same value. The
> most robust way (no mismatch, no echo) is to capture the password once and feed
> everything from it — see the atomic PowerShell block below.

<details>
<summary>Atomic, mismatch-proof setup (PowerShell) — recommended</summary>

Creates the keystore and sets all four secrets from a single password entered
once (never echoed, never on the command line as a literal):

```powershell
$sec = Read-Host "Keystore password" -AsSecureString
$PW  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

Remove-Item .\kiebitz-release.jks -ErrorAction SilentlyContinue
$kt = (Get-ChildItem "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\keytool.exe" | Select-Object -First 1).FullName
& $kt -genkeypair -v -keystore kiebitz-release.jks -alias kiebitz -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kiebitz, O=Torim, C=DE" -storepass $PW -keypass $PW

[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\kiebitz-release.jks))) | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEY_ALIAS -b kiebitz
$PW | gh secret set ANDROID_KEYSTORE_PASSWORD
$PW | gh secret set ANDROID_KEY_PASSWORD
```

</details>

Then set four repository secrets. The keystore is binary, so base64-encode it
(`gh` reads the encoded value from the pipe; CI decodes it with `base64 -d`):

```sh
# macOS / Linux
base64 -w0 kiebitz-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
```

```powershell
# Windows (PowerShell) — produces single-line base64, compatible with base64 -d
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path .\kiebitz-release.jks))) | gh secret set ANDROID_KEYSTORE_BASE64
```

The remaining three are plain strings — `gh` prompts for each value:

```sh
gh secret set ANDROID_KEYSTORE_PASSWORD   # the store password from above
gh secret set ANDROID_KEY_ALIAS           # kiebitz
gh secret set ANDROID_KEY_PASSWORD        # the key password (= store password if you pressed Enter)
```

Once `ANDROID_KEYSTORE_BASE64` exists, the next tagged release also builds and
attaches the APK. Keep the `.jks` file (and its passwords) somewhere safe and
out of the repo.

### Every release — one command

From a clean, current `main` branch run (use the desired, strictly higher
semantic version):

```powershell
.\scripts\release.ps1 -Version 0.4.5
```

The command runs the frontend build, frontend tests, and Rust tests first. Only
after all checks pass does it update `package.json`, `package-lock.json`, and
`src-tauri/tauri.conf.json`, create `Release v0.4.5`, create the annotated tag
`v0.4.5`, then push both `main` and that tag. It deliberately refuses a dirty
working tree, a version that is not higher than the current one, or an existing
remote tag.

Then watch **GitHub → Actions**. The release starts with a private draft; the
desktop and Android builds run in parallel and upload their artifacts to it. The
final `publish` job makes the draft public only when both jobs completed
successfully. A failed build therefore leaves a private draft with its logs and
any completed artifacts for diagnosis, rather than publishing a partial release.

> **Tip:** after fixing a failed build, delete the remote and local tag and the
> failed draft release, then run the command again with the same version. If the
> release is already public, use a new, higher version instead.

### What the workflow handles for you

- **Engine**: fetches the pinned official Stockfish 18 Windows AVX2 archive into
  `src-tauri/binaries/stockfish.exe` before the build (the binary is gitignored,
  so it never lives in the repo). `bundle.resources` then ships it inside the
  installer. For older CPUs, change the asset pattern in the workflow.
- **Signing**: passes `TAURI_SIGNING_PRIVATE_KEY`, so `.sig` files and
  `latest.json` are produced and uploaded automatically.
- **Release orchestration**: `prepare-release` creates (or reuses) a private
  draft. `desktop` and `android` both depend only on that small setup job, so
  they run in parallel. `publish` depends on both and publishes the draft last.
- **Android**: a second job (`android`, on `ubuntu-latest`) sets up the JDK, the
  Android SDK/NDK (r28) and the `aarch64-linux-android` Rust target, downloads
  the pinned Stockfish 18 `stockfish-android-armv8` engine into
  `jniLibs/arm64-v8a/`, verifies its SHA-256 hash,
  restores the keystore from the secrets, builds a signed release APK
  (`tauri android build --apk --target aarch64`), and uploads
  `Kiebitz_<version>_arm64.apk` to the draft release. Without the keystore
  secret the job skips cleanly, leaving the desktop release green.
- **Desktop scope**: Windows only, matching the primary target. To add
  macOS/Linux, turn the desktop job into a matrix over `windows-latest` /
  `macos-latest` / `ubuntu-22.04`, add per-OS Stockfish fetch + resources, and
  (for macOS) signing and notarization credentials.

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

1. On a clean `main`, run `.\scripts\release.ps1 -Version X.Y.Z`.
2. Wait for the GitHub Actions run to finish, including the final `publish` job.
3. Smoke-test: install the new release (or let an existing copy auto-update),
   import games, run a live analysis, confirm the database is untouched in the
   app-data directory.

Doing it by hand instead (no CI): build with
`TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/kiebitz.key npm run tauri build`, sign /
notarize if distributing publicly, then create the tag and attach the installer,
`.sig`, and `latest.json` to the release yourself.
