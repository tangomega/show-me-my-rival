# SHOW ME MY RIVAL — progress

Developed by tangoSHELL · 2026

A new session can continue from this file plus `DESIGN.md` (what the game is; section 0 holds the lead's rulings that override the rest), `INTERFACES.md` (how modules talk) and `BALANCE.md` (the shipped numbers and how they were reached).

## How to build and run

- `node tools/build.js` writes the single-file game to `index.html`.
- `node tools/serve.js` serves the folder on http://localhost:4173 for local preview. `POST /shot/<name>` on that server saves a PNG to `tools/out/` (used to review frames).
- `node tools/check.js` verifies the build has no external requests, carries the exact credit, names nothing else and stays under 700,000 bytes (WARN above 650,000). `node tools/check.js --docs` runs the same name check over every tracked `.md` file; the code host the game is served from may be named there, never in the game.
- **Release gate:** `node tools/test_all.js` exports HEAD and runs everything below on it (about 90 s). Run it before asking for any push, and with `--full` (about 5 minutes more) before a milestone push; `--worktree` checks uncommitted work; `--write-baseline` re-records `tools/baseline.json` and is only for a commit that changes behaviour on purpose. Known-open defects are registered in `tools/known.json`.
- Tests: `tools/test_brain.js`, `tools/test_combat.js`, `tools/test_flow.js` (`--quick` for a short pass; `FLOW_SECTIONS=corrupt node tools/test_flow.js 200 <seed>` for the full corrupt-save section), `tools/test_audio.js`, `tools/test_scenes.js`, `tools/check_text.js`, `tools/test_rules.js`, `tools/test_sim.js`, `tools/lint_pure.js`, and the text client's `node tools/playtest/play.js selftest --quick`.
- Balance: `node tools/sim.js --seeds 8`; `--json` (implies `--no-timing`) prints raw counts per face, bot, duel and final-duel phase; `node tools/sim_tables.js` prints the noise baseline and per-phase tables. Never pass `--label`.
- Playtesting: `tools/playtest/` (see its README). Every scene-logic change is mirrored into `tools/playtest/play.js`; its self-test fails until it is.
- Art review sheets: `node tools/render_fighters.js`, `node tools/render_world.js` (write PNGs to `tools/out/`, which is git-ignored).

## Status

| Phase | State |
|---|---|
| 1. Design (`DESIGN.md`, `INTERFACES.md`) | done |
| 2. Core (engine, Rival AI, combat/run, duel scene, flow controller) | done |
| 3. Content and art (writing, audio, menus, fighter sprites, world/UI/icons) | done |
| 4. Balance sim and QA audit | done (`BALANCE.md`; QA fixes and patches applied) |
| 5. Polish | two passes done (see below) |
| 6. README, final build | done |
| 7. Deploy to GitHub Pages | done — live at https://tangomega.github.io/show-me-my-rival/, served from `main` / root of https://github.com/tangomega/show-me-my-rival. Pushing to `main` redeploys. |

## After ship

- **The Vigil (stakes)**: seven lights, set on the relic screen; rules in `R.Run.cfg / healOf / lightsOut`, text in `R.Text.vigil`, numbers and sim table in `BALANCE.md` §8b, ruling 12 in `DESIGN.md`. Checked on screen at 375×812 and 360×640.
- **Final-boss roster ("the faces at the altar")**: all four stages built. Duel 7 reads `R.Run.BOSSES`; The Unmasked (2 phases), The Three-Faced (3), The Hours (4) and The Reflection (3) are earned in order and then drawn per run. Rules in `src/game/run.js` (`cfg`, `startPhase`, `rivalFighter`) and `src/game/combat.js` (`floor`, `calls`, `stance`, `mimic` on the duel); AI modes `noTell` and `mimic` in `src/ai/brain.js`; staging in `transform()` in `src/scenes/duel.js`; text in `R.Text.bosses`, `R.Text.rules` and the `boss_*` taunt categories; numbers in `BALANCE.md` §8c; ruling 13 in `DESIGN.md`. Each face was played through on screen at 375×812.
- Changed from the plan: The Three-Faced was planned as "always lies / always true / no stance". The first two are degenerate in a three-move game (one move can never lose), so the Jester and Mourner use lent boons instead. The mask change is a flash cut, not a new hand-to-face animation, and the boss music reuses the two existing cues rather than four levels.

## Polish passes

1. Duel: the arena dims during the pre-reveal hold; move names pop in their colour when the sigils crack; fighters close the distance so blades meet; hit effects follow the fighters; the stance is named on screen; the guard-break banner sits clear of the sigils.
2. Flow: death goes straight into the next run; the death screen shows a run recap, the nearest locked unlock as a goal, and the mask watching; sound can be toggled mid-duel from the boon ledger; first-duel intro lines no longer assume a rest came first.

## Not verified

- Nothing has run on a real phone: iOS audio unlock, haptics, safe-area insets, Safari zoom suppression and frame rate are unchecked.
- The audio mix has only been tested against a mock audio graph; nobody has listened to it.
- Motion and timing were judged from still frames and code, not from watching the game at speed.
- The three newer faces were tuned against bots only. Whether a person finds The Hours' last phase tense or a coin flip, and whether The Reflection's "it plays as you" reads clearly, is untested.
- The phase changes for the newer faces (mask swap, bell) were checked as still frames; their pacing and sound were not.

## Ideas for another session

- Faces: a drawn mask-swap animation and distinct music per face; soften the newer faces at seven lights for unpredictable players (see `BALANCE.md` §8c).
- Small extensions that keep the game simple: share your Rival as a code (the model is a few kilobytes), a date-seeded daily duel, letting the player show a stance too, a three-duel sprint run, titles the Rival gives you for how you play.

- Listen to the audio and remix; the clang, the boss lead and the phase-two theme were flagged as most in need of an ear.
- Art second pass: the Rival's Strike stance could be taller, its kneel is cramped, the bonfire bell and seated figures are serviceable rather than characterful.
- Balance: hits of 7+ land in 3.5% of duels (target 3%); a Rival holding `coiled_riposte` + `first_blood` + `deathblow_creed` + `resonance` spikes that; `no_encores` + `sealing_wax` together are harsh on unpredictable players.
- Boon cards in the menus use a flat frame rather than the brass bevel the buttons have.
- Settings (beyond the sound toggle) are only reachable from the title.

## Decisions log

- **Owner decisions for Milestone 1 (2026-11-16).**
  - O1: one yes per milestone. Milestone 1's gate (P1.0) and save fix (P1.1) ship first, each on its own, so the save fix is live before anything else changes the save. Each release is tagged in git.
  - O2: section 0 of `DESIGN.md` keeps rulings 1-13 under their numbers, and 14-25 are reserved.
  - O3: the credit reads exactly "Developed by tangoSHELL · 2026" everywhere. `check.js` checks `index.html`; `check.js --docs` checks every tracked `.md`.
  - O18: no mandatory timers (ruling 20). O22: seeded or chosen tables earn nothing (ruling 19).
  - O28: the gate is a habit; there is no hook or CI.
  - Size: FAIL above 700,000 bytes, WARN above 650,000. `test_all --full` is opt-in day to day and required before a milestone push.
  - Signed off: the two pause-tap KNOWN rows until P1.6; the exploit mode's 0.5% dominated-move tolerance (revisit after P1.2); The Reflection's dominated moves as INFO until P1.2; degeneracy bounds on final-duel phases only (duels 1-6 reported); ruling 19 names no section outside this repo; acceptance bands from the chain SD (`BALANCE.md` §8d).

- The game is titled **Show Me My Rival** (renamed by the owner from the working title "THE RIVAL"). The opponent is still "the Rival" in-fiction; the `RIVAL` code namespace and save key are unchanged.
- Source is split into `src/` plain scripts on one `globalThis.RIVAL` namespace; `tools/build.js` inlines them into `index.html`.
- Logic modules (`core/rng.js`, `ai/`, `game/`) are DOM-free so the sim and tests run the real game code.
- Player health is a run-long pool (26, heal 6 per bonfire) rather than 12 with near-full heals: with the smaller pool an unpredictable player could only reach a ~30% win rate if every Rival had 5 HP, which made duels two hits long.
- Rupture (a clash at three pips) no longer seals a move: the seal could trap a duel in an endless loop.
- Phase 2 has two rules (Embers, Called Shot); a third (Twin Stance) was cut for readability.
- The stance is named on screen. The skill is deciding whether to believe it, not parsing a sprite.
