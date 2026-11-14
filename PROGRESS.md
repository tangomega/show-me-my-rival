# SHOW ME MY RIVAL — progress

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
| 1. Design (`DESIGN.md`, `INTERFACES.md`) | done |
| 2. Core (engine, Rival AI, combat/run, duel scene, flow controller) | done, grey-box duel plays in the browser |
| 3. Content and art | writing done; audio, menus, fighter sprites in progress; world/UI art not started |
| 4. Balance sim and QA | balance sim in progress; QA not started |
| 5. Polish passes (two) | not started |
| 6. README, final build, deploy | not started |

## Next up

- Integrate menus + audio + art as they land, play a full run in the browser, then QA and two polish passes.
- Remaining old-title header comments in src/game, src/ai, src/text (cosmetic) get fixed at ship time.

## Decisions log

- The game is titled **Show Me My Rival** (renamed by the owner from the working title "THE RIVAL"). The opponent is still "the Rival" in-fiction; the `RIVAL` code namespace and save key are unchanged.

- Source is split into `src/` plain scripts on one `globalThis.RIVAL` namespace; `tools/build.js` inlines them into `index.html`.
- Logic modules (`core/rng.js`, `ai/`, `game/`) are DOM-free so the sim runs the real game code.
- Deploy: the GitHub CLI is not installed on this machine, so the repo must be created by hand (steps go in the README).
