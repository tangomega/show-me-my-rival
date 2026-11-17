# Persona text client

`tools/playtest/play.js` lets a playtester play the real game one command at a time, as text. It loads the game's own modules from `src/` in place (never a copy) and replays the scenes' call order, so the Rival, the rules, the drafts and the lines are the game's. A playtester sees what the phone screen would show, plus a log that the client adds.

It exists for persona playtests: twelve play styles (`personas.md`) that play fresh or existing profiles and report back in one fixed shape. A re-playtest is planned after every milestone.

## Running it

From the repo root (any folder works; paths resolve from the script's own location):

```
node tools/playtest/play.js help
node tools/playtest/play.js new demo
node tools/playtest/play.js move demo G
```

Every command prints the screen and appends the command and its output to the profile's `transcript.md`.

## Commands

| Command | What it does |
|---|---|
| `new <profile> [options]` | Start a run (a new profile is created on first use). Goes to the relic screen first when the profile owns a relic or has earned a light of the Vigil, as the game does. |
| `show <profile>` | Print the current screen again. |
| `move <profile> S\|G\|F` | Play a move. Also accepts `1`/`2`/`3` and `STRIKE`/`GUARD`/`FEINT`. Alias: `play`. |
| `active <profile> <boonId>` | Use an active boon (Keyhole, Candle of Truth, Coin of Fools...). Alias: `use`. |
| `relic <profile> <relicId\|none> [--stake N]` | Answer the relic screen (and set the lights out). |
| `draft <profile> <boonId\|none>` | Take a card at a bonfire (`none` only when no card is left). |
| `ledger <profile>` | Both fighters' boons, with their text, and the lights out. |
| `dossier <profile>` | The dossier, as the dossier scene presents it. |
| `unlocks <profile>` | The unlocks screen: faces, boons, relics, masks, arenas. |
| `reload <profile>` | Close and reopen the app: the brain is rebuilt from its saved form, with new dice. A sealed commit survives. |
| `wait <profile> <days>` | Days pass without the game being opened (0 to 3650). |
| `abandon <profile>` | Walk away from the run. It counts as a death. |
| `selftest [--quick] [--seed N] [--profiles <dir>] [--keep]` | The self-test (below). |
| `pins [--update]` | Check, or refresh, the scene-mirror pins (below). |
| `help` | The command list, with the faces `--boss` accepts. |

Options of `new`:

| Option | Meaning |
|---|---|
| `--unlocks natural\|all` | `natural` (default): unlocks are earned. `all`: **test option**, everything unlocked, and the stake is not limited by the lights earned. The choice stays with the profile. |
| `--stake N` | Lights of the Vigil out (0 to 7). Clamped to the lights the profile has earned, unless `--unlocks all` (**test option** beyond what is earned). |
| `--boss <faceId>` | **Test option**: force the face of duel 7. |
| `--relic <id>\|none` | Skip the relic screen with this choice. |
| `--start 7` | **Test option**: start at duel 7 (six bonfires drafted by the real rules, taking the first card each time; HP set to 17). |
| `--seed N` | **Test option**: the run's seed. |

Any command also takes `--profiles <dir>` to use another profiles folder.

Exit codes: 0 when the command worked; 1 for a user error (the output is one line starting with `! `); 2 for an internal error (`INTERNAL ERROR: <stack>`). `selftest` and `pins` exit 0 or 1.

## What the client prints

The input screen keeps fixed line prefixes: `DUEL n/7 - NAME`, the run counters, `YOU a/b   IT c/d   TENSION [##.] t/3`, `Your status:`, `Its status:`, `Its stance:` (or `(it shows no stance)`), `Stamp on the stance:` and `Keyhole:` (only when an owned boon or relic reveals them), `Hint row:` (the game's single hint row: `IT CALLS`, `GUARD BROKEN` or `DEATHBLOW` first, otherwise the Stolen Ledger or Liar's Tally line), `IT: "..."`, `Moves:` and `Actives:`.

After a move:

- `Floats:` mirrors the game's floating labels and numbers in the order they appear (`you`/`it` = over that fighter): both moves, the damage (`0` on a loss for no damage), RUPTURE (only non-zero damage), DEATHBLOW, OVERKILL, GUARD BROKEN, then boon names, heals, bleeds and NOT YET.
- `log:` is **the client's own** event log. The game has no log. Boons that fired are listed apart from their effects, because the engine's event order says nothing about cause.
- `[client]`, `[test]` and `[note]` lines are the client's too. `[note]` appears when the game source changed since the profile's last command.

## Profiles

```
tools/playtest/profiles/<name>/
  save.json        client state (the brain, meta, run, the sealed commit); written atomically
  transcript.md    every command and its output, appended by the client
  journal.md       written by the playtester, never by the client
  report.md        optional: the playtester's final report
```

- Names use letters, digits, `-` and `_` (up to 40).
- `tools/playtest/profiles/` is gitignored and never committed.
- Override the folder with `--profiles <dir>` or the environment variable `RIVAL_PLAYTEST_PROFILES` (child processes inherit it).
- **Playtesters never open `save.json`.** It holds the Rival's sealed move for the current turn.
- `save.json` keeps schema `v: 1`. Profiles from the earlier scratch client still load. After a change to the brain, their op logs replay under the new code, so the rebuilt Rival differs from the one those personas faced.
- Each profile stores a SHA-256 of the loaded `src/` tree (line endings normalised), and every `new` prints its first 16 hex digits, so a transcript can be tied to a commit.

## Running a persona playtest

1. Work from a dedicated worktree, or from a `git archive` export at a fixed commit. The client loads `src/` in place, so another session's edit would change the game halfway through a playtest (`[note]` lines flag it).
2. Run `node tools/playtest/play.js selftest --quick` first.
3. For each persona, assemble the prompt: the "Shared rules" section of `personas.md`, then that persona's section, then `Your profile: <key>`.
4. Collect the reports and the journals. Compare the ratings table with the previous playtest.

The re-playtest plan, per milestone: after M1, all twelve personas, mixing fresh and existing profiles; after M2, newcomer, commuter, lore and chaos on fresh profiles; after M3, returner, completionist and veteran, plus chaos and commuter; after M4, breaker, bossrush and veteran at Lightless; after M5 to M7, completionist and bossrush.

## The self-test

```
node tools/playtest/play.js selftest            full run
node tools/playtest/play.js selftest --quick    gate run
```

It plays complete runs through the same `exec()` the CLI uses, and checks:

- **Seal before print.** Every input screen is checked before it prints: the commit for that turn must already be on disk (`seal-before-print: screen for <key> printed before its commit was saved`), identical to the one in memory and, when the same command sealed or resumed the turn, identical to the commit it sealed or resumed (`... on-disk commit for <key> differs from the sealed commit`). Every turn that reaches an input screen must have had its seal traced, and the commit on screen must be that one. The summary's `seal-before-print checks N` counts the screens.
- **Counterfactual pre-pick.** Every time a turn is sealed or resumed, the step from the seal to the player's window (the pre-pick line, the window's state, the input screen) runs twice from the same state: once with the real commit and once with its hidden fields changed. The line, the state, the shuffle bags, the dice and the screen must come out the same, apart from the lines an owned boon or relic reveals (`counterfactual pre-pick for <key>: ...`).
- **Move independence.** From the same saved state, each of S, G and F is played in turn. A legal move must resolve against the sealed Rival move (`Rival move X differs from the sealed Y when the player plays m`). An illegal one (sealed, guard broken, or locked by the tutorial) must be refused, with `save.json` byte-identical afterwards (`refused move m changed the save`). The full run checks every turn. `--quick` checks turns 1 and 3 of every duel and phase, every Called Shot turn, every resumed turn, every coin turn, and every turn of the coverage runs.
- **Counterfactual commit.** The commit is replayed from the saved brain (base plus op log) and the saved dice state, and must come out identical, dice included. So the seal depends only on the state before the player's window. The full run replays every sealed turn; `--quick` replays the turns it checks for independence and must replay at least one.
- **Coverage.** At least one independence check in a stance phase, a phase with no stance, a mimic phase, a Called Shot turn, a Coin of Fools turn, a resumed turn and a tutorial turn, and at least one run that ends on the death screen. Four short coverage runs make sure of it. One places the coin among the first bonfire's cards (a test fixture). Another, on a fresh profile, plays a move that loses to the sealed one after the tutorial, so the death screen (its line, what it learned, the unlocks) is printed and scanned on every seed.
- **Kept from the first client.** Hidden commit fields never reach the screen (counterfactual render), apart from the Stamp, Keyhole and Ledger lines when owned. A reload mid-turn keeps the commit, and so does an active. A coin turn resolves to the sealed move. Every printed screen is scanned for leak patterns, and `HONESTY ~` may appear only with Liar's Tally. The CLI runs as real processes from another folder, rejecting a bad move with `! Move is S, G or F.` and the tutorial with `! The tutorial wants GUARD this turn.`, both exit 1.
- **Client wording.** No `-0` damage, no `Its THE ...` boon lines, no `is lifted`, and no doubled `cannot Guard` line.
- **Mirror pins** (below), and **no absolute local paths** in the files of this folder.
- **Isolation.** It writes only under its profiles folder: `--profiles <dir>`, or else a new temporary folder, removed at the end unless `--keep` is given. It then checks that `src/` and the default profiles folder are unchanged, and that no `_selftest_` entry appeared anywhere else (the repo root, `tools/`, this folder, the working folder).

The full plan is 2 unlock modes × every face × 6 runs at stakes 0, 4 and 7, with `--start 7` on alternate runs. `--quick` plays one run per face and unlock mode. Both then add the four coverage runs. `--seed N` (default 1) seeds profile entropy and the test's own dice, so two runs with the same seed print the same summary apart from the `time` line. The first line of the summary is `SELFTEST PASSED` or `SELFTEST FAILED (n problems)`, followed by up to 25 `FAIL:` lines.

How long it takes: `--quick` takes about 15 to 20 seconds. The full run takes about 4 minutes (229 s measured while other work shared the machine), because it plays all three moves from the saved state on every turn of all 52 runs, replays every commit, and runs the pre-pick step twice at every seal. Keep the full run out of any time limit of a few minutes that is shared with other suites running at the same time. The release gate runs `--quick`.

For the release gate: `node tools/playtest/play.js selftest --quick --seed 1 --profiles <temp dir>`. It passes when the exit code is 0 and stdout starts with `SELFTEST PASSED`.

`require('tools/playtest/play.js')` runs no command and gives `{ exec, selftest, checkPins }`. The client's own `R.Game` and `R.Text.taunt` are installed only while `exec()` or `selftest()` runs, and the previous values come back afterwards, so other suites in the same process keep the game's own versions.

## The mirror rule

The client copies scene logic, so **every change to scene logic in `src/` is mirrored into `play.js`** before the next re-playtest. Otherwise transcripts mislead. `mirror.json` pins a SHA-256 of each mirrored function, small helpers included (the Called Shot target, the low-HP test, the three-line bubble cut, the move lock): its source from the declaration line to its closing brace, with LF line endings. Pure drawing, layout, sound and hit-test functions are not mirrored and not pinned; when a change moves game logic into one of them, add it to the `MIRROR` list in `play.js`. When a pinned function changes, the self-test fails with

```
scene logic changed in <file>:<function>: mirror it into tools/playtest/play.js, then update the pin
```

Mirror the change, then run `node tools/playtest/play.js pins --update` and commit `mirror.json` with it. `node tools/playtest/play.js pins` lists every pin with its current lines.

Mirrored now (lines as of this commit):

| File | Functions (lines) |
|---|---|
| `src/scenes/duel.js` | mname 26, boonName 27-32, taunt 33-36, low 37, hasEv 38, say 77-86, cfgOf 136, setForm 138-146, argmaxMove 147-151, setLegal 175-179, hintFor 180-185, tutorialBeat 188-194, tutorialResult 195-201, flow 204-217, introLine 219-249, intro 251-283, turn 285-406, reaction 409-438, showEvents 441-461, present 463-573, outro 575-599, bossTaunt 602-605, showCards 606-615, transform 619-675, canPick 683, useActive 689-701, pick 702-706, the hint-row lines of drawButtons 784-809, ledgerPage 812-816, vigilPage 817-821, openLedger 822, enter 840-878 |
| `src/scenes/bonfire.js` | rivalLine 62-66, flow 69-116, leave 118-127, enter 229-275 |
| `src/scenes/death.js` | tap 56-65, enter 86-119 |
| `src/scenes/victory.js` | tap 50-58, enter 73-101 |
| `src/scenes/credits.js` | cast 16-19, build 21-47, enter 103-123 |
| `src/scenes/dossier.js` | header 16-21, line 22-26, build 28-91 |
| `src/scenes/unlocks.js` | build 9-44 |
| `src/scenes/relic.js` | viewLight 44-53, refreshLabel 54-57, tapLight 59-67, confirm 69-75, enter 85-110 |
| `src/scenes/title.js` | memory 8, refresh 11-30, begin 32-37, activate 39-55 |
| `src/main.js` | validRun 12-25, nextGoal 28-36, hasRun 51, startFlow 53-58, newRun 60-70, resume 72-92, duelOver 94-147, draft 149-155, abandon 158-166, vars 168-184, boot 196-222 |
| `src/text/taunts.js` | freshOrder 733-742, draw 744-756, taunt 760-774 (copied with the shuffle bags kept in the profile) |

`R.SceneKit` (`src/scenes/_common.js`) loads under the client, so its helpers (`light`, `vigilLabel`, `boonInfo`, `unlockInfo`, `reel`, `fill`, `ui`, `wrap`, `taunt`) are called directly, not copied.

## Known fidelity gaps

1. Lines appear whole, at once. There is no typing effect and nothing is cut off mid-word. In the game, an optional Rival line is erased when the player picks quickly, so voice lines are easier to see here than on a phone.
2. The client prints status numbers, turn and run counters and an event log. The game's HUD shows icons without counts and has no log, so the rules are easier to learn here than in the game.
3. It cannot judge timing or pacing in seconds, visuals, animation, sound, haptics, settings, masks or arenas. There is no settings screen, pause or menu, and the idle heckle after 14 seconds is not modelled.
4. Time is virtual: 3 s per turn, 20 s per draft, ten minutes between runs, plus whatever `wait` adds.
5. It never uses the game's storage layer. Storage loss, separate storage for an app added to a phone's home screen, a second open tab and backup codes cannot be seen.
6. Within a session the Rival's brain is exact (rebuilt from an op log). It is rebuilt from the rounded saved form only on `reload`, or at a new run once the op log passes 400 entries. The game rounds at every page load.
7. The test options do not exist in the game. `--unlocks all` on a fresh profile still plays the tutorial; `--start 7` drafts six bonfires by a fixed policy and sets HP to 17.
8. The `log:` prose is the client's own; the game only floats labels and numbers.
9. `abandon` returns to the title. In the game, NEW RUN on the title abandons the run and goes straight on to the next one (through the relic screen when it has one).

Developed by tangoSHELL · 2026
