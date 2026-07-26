# Third-party notices

Kiebitz itself is source-available under the [Kiebitz Source-Available
License](LICENSE). The third-party software it uses and bundles stays under the
licenses of its respective authors; those terms are not superseded by Kiebitz'
own license.

## Stockfish (GPL-3.0)

Kiebitz distributes the unmodified official Stockfish 18 binary and starts it as
a separate process, communicating over the public UCI text protocol. No part of
Stockfish is linked into the Kiebitz binary.

The notices, the complete GPL-3.0 text, the exact source revision, the binary
provenance with archive checksums, and the **written offer for the corresponding
source** live in [`src-tauri/resources/stockfish/`](src-tauri/resources/stockfish/).
These files ship as application resources in both the desktop and the Android
bundle, so every recipient of a binary also receives the notice and the offer.

Corresponding source, at no charge, attached to every Kiebitz release:

<https://github.com/Torim98/Kiebitz/releases/latest/download/stockfish-18-source-cb3d4ee9b47d.tar.gz>

The release workflow verifies the documented SHA-256 hashes of the official
engine archives before packaging, and generates the source archive straight from
the pinned Stockfish commit, so binary and source can never drift apart.

## Lichess puzzle database (CC0 1.0)

The offline tactics trainer imports the public Lichess puzzle dump, released
under the CC0 1.0 public domain dedication. The database is downloaded per
device and is not redistributed by Kiebitz.

## Libraries

MIT, BSD and ISC require the license text and copyright notice to travel with
the binary, so the full texts of every shipped npm package and Rust crate are
bundled as an application resource:

[`src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt`](src-tauri/resources/licenses/THIRD_PARTY_LICENSES.txt)

The app reaches them under **Settings → About Kiebitz → Licenses & notices**,
next to the Stockfish notice and the GPL-3.0 text.

Regenerate after changing dependencies:

```sh
npm run licenses
```

The generator (`scripts/generate-third-party-licenses.mjs`) reads the npm
production tree from `package-lock.json` and the Rust graph from `cargo
metadata`, then takes each component's license text from the package itself.
CI runs `npm run licenses:check` and fails if the bundled file no longer matches
the dependency set, so it cannot silently go stale.

Development-only dependencies are excluded on purpose: they are not distributed
and therefore trigger no obligation.

### shakmaty is GPL-3.0-or-later

The Rust crate `shakmaty` (chess rules, used in `src-tauri/src/chess.rs` and
`repertoire.rs`) is licensed **GPL-3.0-or-later** and is statically linked into
the Kiebitz binary. Unlike Stockfish — a separate process, cleanly at arm's
length — static linking makes the combined work a derivative, which is
incompatible with the terms in [`LICENSE`](LICENSE). This is tracked in
[`docs/ROADMAP.md`](docs/ROADMAP.md) and must be resolved before Kiebitz is
distributed under those terms.
