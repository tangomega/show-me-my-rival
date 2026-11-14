# THE RIVAL — progress

Developed by tangoSHELL · 2026

A new session can continue from this file plus `DESIGN.md` (what the game is) and `INTERFACES.md` (how modules talk).

## How to build and run

- `node tools/build.js` writes the single-file game to `index.html`.
- `node tools/serve.js` serves the folder on http://localhost:4173 for local preview.
- `node tools/sim.js` runs the headless balance sim (Phase 4).
- `node tools/check.js` verifies the build has no external requests and carries the credits.

## Status

| Phase | State |
|---|---|
| 1. Design (`DESIGN.md`, `INTERFACES.md`) | in progress |
| 2. Core (engine, Rival AI, combat/run) | not started |
| 3. Content and art (sprites, writing, audio, menus) | not started |
| 4. Balance sim and QA | not started |
| 5. Polish passes (two) | not started |
| 6. README, final build, deploy | not started |

## Next up

- Review `DESIGN.md`, reconcile it with `INTERFACES.md`, commit Phase 1.

## Decisions log

- Source is split into `src/` plain scripts on one `globalThis.RIVAL` namespace; `tools/build.js` inlines them into `index.html`.
- Logic modules (`core/rng.js`, `ai/`, `game/`) are DOM-free so the sim runs the real game code.
- Deploy: the GitHub CLI is not installed on this machine, so the repo must be created by hand (steps go in the README).
