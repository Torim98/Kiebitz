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

## Performance and maintainability

- [ ] Move the updater-manifest implementation out of the release workflow into
  a small testable script; keep workflows focused on orchestration.
- [ ] After the measurable work above, split the largest modules (`insights.rs`,
  `sync.rs`, `study.rs`, `Settings.tsx`, `Puzzles.tsx`, `Repertoire.tsx`) along
  their existing responsibilities. This is a maintainability change, not a
  rewrite.

## Platform horizon

- [ ] Revisit iOS only with an in-process Stockfish integration. The current
  child-process engine architecture is suitable for desktop and Android but not
  for iOS.

All refactoring remains subject to the same constraint: existing user-visible
features and results must remain compatible unless a separate product decision
explicitly changes them.
