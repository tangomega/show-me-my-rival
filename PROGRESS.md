# SHOW ME MY RIVAL — progress

Developed by tangoSHELL · 2026

A new session can continue from this file plus `DESIGN.md` (what the game is; section 0 holds the lead's rulings that override the rest), `INTERFACES.md` (how modules talk) and `BALANCE.md` (the shipped numbers and how they were reached).

## How to build and run

- `node tools/build.js` writes the single-file game to `index.html`.
- `node tools/serve.js` serves the folder on http://localhost:4173 for local preview. `POST /shot/<name>` on that server saves a PNG to `tools/out/` (used to review frames).
- `node tools/check.js` verifies the build has no external requests and carries the credits.
- Tests: `tools/test_brain.js`, `tools/test_combat.js`, `tools/test_flow.js` (`--quick` for a short pass), `tools/test_audio.js`, `tools/out/test_scenes.js`.
- Balance: `node tools/sim.js --seeds 8`.
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
- **Final-boss roster**: planned in four stages (data-driven final fight, The Three-Faced, The Hours, The Reflection). See "Bosses" below for what is built.

## Polish passes

1. Duel: the arena dims during the pre-reveal hold; move names pop in their colour when the sigils crack; fighters close the distance so blades meet; hit effects follow the fighters; the stance is named on screen; the guard-break banner sits clear of the sigils.
2. Flow: death goes straight into the next run; the death screen shows a run recap, the nearest locked unlock as a goal, and the mask watching; sound can be toggled mid-duel from the boon ledger; first-duel intro lines no longer assume a rest came first.

## Not verified

- Nothing has run on a real phone: iOS audio unlock, haptics, safe-area insets, Safari zoom suppression and frame rate are unchecked.
- The audio mix has only been tested against a mock audio graph; nobody has listened to it.
- Motion and timing were judged from still frames and code, not from watching the game at speed.

## Ideas for another session

- Listen to the audio and remix; the clang, the boss lead and the phase-two theme were flagged as most in need of an ear.
- Art second pass: the Rival's Strike stance could be taller, its kneel is cramped, the bonfire bell and seated figures are serviceable rather than characterful.
- Balance: hits of 7+ land in 3.5% of duels (target 3%); a Rival holding `coiled_riposte` + `first_blood` + `deathblow_creed` + `resonance` spikes that; `no_encores` + `sealing_wax` together are harsh on unpredictable players.
- Boon cards in the menus use a flat frame rather than the brass bevel the buttons have.
- Settings (beyond the sound toggle) are only reachable from the title.

## Decisions log

- The game is titled **Show Me My Rival** (renamed by the owner from the working title "THE RIVAL"). The opponent is still "the Rival" in-fiction; the `RIVAL` code namespace and save key are unchanged.
- Source is split into `src/` plain scripts on one `globalThis.RIVAL` namespace; `tools/build.js` inlines them into `index.html`.
- Logic modules (`core/rng.js`, `ai/`, `game/`) are DOM-free so the sim and tests run the real game code.
- Player health is a run-long pool (26, heal 6 per bonfire) rather than 12 with near-full heals: with the smaller pool an unpredictable player could only reach a ~30% win rate if every Rival had 5 HP, which made duels two hits long.
- Rupture (a clash at three pips) no longer seals a move: the seal could trap a duel in an endless loop.
- Phase 2 has two rules (Embers, Called Shot); a third (Twin Stance) was cut for readability.
- The stance is named on screen. The skill is deciding whether to believe it, not parsing a sprite.
