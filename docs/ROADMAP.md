# Kiebitz — Roadmap

This document contains only open work and near-term technical direction.
Completed work belongs in the [Git history](https://github.com/Torim98/Kiebitz/commits/main)
and [release notes](https://github.com/Torim98/Kiebitz/releases); the current feature
set is summarized in the [README](../README.md).

## Current priorities

- [ ] **Bugfixing pass.** Continue the systematic UI and logic review across all
  tabs, prioritizing reproducible user-facing defects.
- [ ] **Google Play distribution.** Complete Play App Signing enrollment, store
  listing, closed testing, the production-access request and review. The signed
  AAB build and its technical verification already exist.
- [ ] **Sharing, second stage.** The analysis board and the puzzle trainer can
  share a position; repertoire lines and endgame drills cannot yet. Also open:
  Android App Links for `https://s.kiebitz.dev/p/*` (`assetlinks.json` from the
  share worker), so a shared link opens the installed app directly instead of
  the browser.

## Platform horizon

- [ ] Revisit iOS only with an in-process Stockfish integration. The current
  child-process engine architecture is suitable for desktop and Android but not
  for iOS.

All refactoring remains subject to the same constraint: existing user-visible
features and results must remain compatible unless a separate product decision
explicitly changes them.
