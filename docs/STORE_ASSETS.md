# Kiebitz Store Assets

Kiebitz keeps the in-app captures and their marketing presentation separate:

- `artifacts/store-assets/` contains the reproducible source captures.
- `artifacts/store-assets-v2/` contains the branded Google Play assets.

Generate the complete German and English series with:

```sh
npm run store-assets:marketing
```

The renderer adds the Kiebitz background, localized benefit copy, framing, and
decorative brand elements without changing the captured app interface. It also
generates contact sheets, validates dimensions and color mode, and packages all
38 upload files as `artifacts/Kiebitz-Play-Store-Assets-v2.zip`.

The upload sequence is:

1. Dashboard — ownership and local-first positioning
2. Analysis — Stockfish analysis
3. Insights — patterns and weaknesses
4. Study — personal training plan
5. Repertoire — phone only
6. Puzzles — phone only

Edit the localized `COPY` mapping in `scripts/compose-store-assets.py` to adjust
headlines or supporting copy. The current source assets are never overwritten.
