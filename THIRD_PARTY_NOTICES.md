# Third-party notices

Kiebitz itself is source-available under the [Kiebitz Source-Available
License](LICENSE). The third-party software it uses and bundles stays under the
licenses of its respective authors; those terms are not superseded by Kiebitz'
own license.

## Stockfish (GPL-3.0)

Kiebitz distributes Stockfish 18 and starts it as a separate process,
communicating over the public UCI text protocol. The Android binary is compiled
without source modifications from the pinned official commit; the Windows binary
comes from the official release archive. No part of Stockfish is linked into the
Kiebitz binary.

The notices, the complete GPL-3.0 text, the exact source revision, the binary
provenance with archive checksums, and the **written offer for the corresponding
source** live in [`src-tauri/resources/stockfish/`](src-tauri/resources/stockfish/).
These files ship as application resources in both the desktop and the Android
bundle, so every recipient of a binary also receives the notice and the offer.

Corresponding source, at no charge, attached to every Kiebitz release:

<https://github.com/Torim98/Kiebitz/releases/latest/download/stockfish-18-source-cb3d4ee9b47d.tar.gz>

The release workflow verifies the documented Windows archive and NNUE hashes,
compiles Android Stockfish from the pinned commit, and generates the source
archive straight from that same commit, so binary and source cannot drift apart.

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

### No copyleft in the linked dependencies

Everything statically linked into Kiebitz is permissively licensed (MIT,
Apache-2.0, ISC, BSD, MPL-2.0). The chess-rules crate is `owlchess` (MIT); the
GPL-3.0-or-later `shakmaty` it replaced would have made the binary a derivative
work. Stockfish is the one GPL component and stays at arm's length as a separate
UCI process. Keep it that way: a copyleft crate in the link graph would override
the terms in [`LICENSE`](LICENSE).
