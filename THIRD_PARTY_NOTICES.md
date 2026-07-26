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

Frontend dependencies (npm) and backend dependencies (Cargo) remain under their
own licenses — predominantly MIT, Apache-2.0, ISC and BSD; the bundled Inter
font is under the SIL Open Font License 1.1. See `package.json` and
`src-tauri/Cargo.toml` for the dependency lists.
