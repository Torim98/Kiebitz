# Kiebitz Store Assets

Kiebitz keeps the in-app captures and their marketing presentation separate:

- `artifacts/store-assets/` contains the reproducible source captures.
- `artifacts/store-assets-v3/` contains the current branded Google Play assets.
- `artifacts/store-assets-v2/` is the previous flat layout, kept for comparison.

Generate the complete German and English series with:

```sh
npm run store-assets:marketing
```

The renderer never touches the source captures. It adds the marketing layer,
generates review strips, validates dimensions and color mode, and packages all
38 upload files as `artifacts/Kiebitz-Play-Store-Assets-v3.zip`.

## v3 design

- **Device frames.** Every capture sits in a dark Android frame with bezel, mint
  rim light, and a synthetic status bar (clock, signal, wifi, battery,
  punch-hole camera). The frame is tilted alternately ±4° and bleeds off the
  bottom edge, so the UI stays large and readable.
- **Editorial headline.** Eyebrow pill in Kiebitz mint, then a two-line headline
  — first line white, second line mint — and two lines of supporting copy. The
  headline size is computed once per series so all frames line up in the
  carousel.
- **Continuous backdrop.** One wide scene is rendered per device series and each
  frame crops its own window out of it: dark green gradient, rotated chessboard
  texture, and a mint light that pulses across the whole strip. Swiping the
  carousel reads as panning across a single image.
- **Feature graphic.** Wordmark, headline, tagline, and a trust pill next to two
  overlapping phones.

The upload sequence is:

1. Dashboard — ownership and local-first positioning
2. Analysis — Stockfish analysis
3. Insights — patterns and weaknesses
4. Study — personal training plan
5. Repertoire — phone only
6. Puzzles — phone only

Edit the localized `COPY` mapping in `scripts/compose-store-assets-v3.py` to
adjust eyebrows, headlines, or supporting copy. Headlines are two short
all-caps lines; keep the longest line under roughly 13 characters or the shared
font size shrinks for the whole series.

To re-render the old v2 look for comparison, run
`npm run store-assets:marketing-v2`.
