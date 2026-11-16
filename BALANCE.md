# SHOW ME MY RIVAL — balance pass

Measured with `tools/sim.js`, which plays the real `rng`, `brain`, `boons`, `combat` and `run` modules in the game's own call order. Each bot plays chains of 400 sequential runs against one persistent brain and meta. Tables are 8 chains per bot (3,200 runs), seed 1, natural unlock order.

Reproduce: `node tools/sim.js --seeds 8` (about 40 s). The raw output of the final run (`tools/out/final_r2.txt`) and the tuning log (`tools/out/balance_log.md`) are local-only, not in the repo: `tools/out/` is git-ignored.

## 1. The structure

The player's HP is one pool for the whole run. With 26 max HP and a bonfire heal of 6, the bar drains from 26 to about 17 by phase 2 for a neutral player, so a bad duel costs the next duels rather than ending the run on the spot. That is what lets the Rival keep a real HP ramp (6 to 10) and duels of about 7 turns while a neutral player still clears a third of runs.

## 2. Final constants

`src/game/run.js`, BALANCE CONSTANTS block:

| Constant | Start | Final |
|---|---|---|
| `PLAYER_MAX_HP` | 12 | 26 |
| `HEAL` | 5 | 6 |
| `PHASE2_HEAL` | 2 | 4 |
| `RIVAL_HP` (duels 1..7) | 6,7,8,8,9,10,9 | 6,7,8,8,9,10,9 |
| `PHASE2_HP` | 8 | 7 |
| `EXPLOIT` | .15,.30,.45,.55,.65,.75,.90 | .30,.50,.65,.75,.85,.95,1.00 |
| `PHASE2_EXPLOIT` | 1.00 | 1.00 |
| `HONESTY` | .92,.85,.75,.65,.55,.50,.42 | .97,.90,.82,.74,.64,.50,.42 |
| `PHASE2_HONESTY` | 0.35 | 0.35 |

`src/ai/brain.js`, `R.Brain.K`: `TAU_BASE` 1.5 to 1.2, `TAU_SLOPE` 1.2 to 0.9, `H_TRUST_UP_LATE` 1.0 to 0.75. The `tau()` display helper in `run.js` matches.

`src/game/combat.js`:
- **Rupture no longer seals the move.** A clash at 3 pips deals 1 to both (never lethal) and tension stays at 3. The old seal left two moves with one dominant, the Rival always took it, and the duel locked in an endless G, S, F loop (8.2% of mixer duels at the starting numbers).
- `HIT_CAP` stays 8.

`src/game/boons.js`:
- `first_blood`: focus 2 to 1.
- `coiled_riposte`: +3 to +2.
- Both trimmed for the 7+ hit rate (4.3% of duels before, 3.5% after). Card text updated.

Why the curves and K values moved (unchanged from the previous round):
- **Exploit up:** costs an unexploitable player nothing and is what keeps predictable play down.
- **Honesty up in duels 1 to 5:** this is the adaptive player's edge over the mixer. Duels 6, 7 and phase 2 are unchanged.
- **`H_TRUST_UP_LATE` 0.75:** at 1.0 a player who trusted sensibly saw only 67% honest stances in duel 1 after a few runs. At 0.65 the "truster collapses" brain benchmark failed.
- **Tau curve:** still 0.30 at exploit 1.0, sharper before that.

Both suites pass: `test_brain.js` 106 of 106, `test_combat.js` 6,652 assertions. In `test_combat.js` I updated the constant checks, the Rupture checks (no seal, three legal moves, a second Rupture on the same move), the two boon numbers, and the heal checks that depended on max HP.

## 3. Results

Measured with `node tools/sim.js --seeds 8 --no-timing` (8 chains × 400 sequential runs per bot, seed 1, natural unlocks) on save train 0 (P1.1); §8e pairs these with the P1.0 build.

| Bot | Target | All runs | Runs 1-10 | 11-50 | 51-200 | 201+ | 51+ | Mean duel reached |
|---|---|---|---|---|---|---|---|---|
| guard | 0.5% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2.19 |
| cycle | 2% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 2.28 |
| wsls | 6% or less | 0.2% | 0.0 | 0.9 | 0.1 | 0.1 | 0.1 | 3.29 |
| truster | 20% early, 5% late | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 3.98 |
| habit | 10% or less after run 50 | 10.3% | 16.3 | 10.9 | 10.5 | 9.8 | 10.1 | 6.21 |
| uniform | 15-35% | 20.9% | 18.8 | 17.8 | 21.2 | 21.4 | 21.3 | 5.68 |
| mixer | 30-45% | 34.7% | 40.0 | 34.4 | 34.5 | 34.6 | 34.5 | 6.26 |
| adaptive | 50-65% | 57.1% | 58.8 | 54.4 | 56.9 | 57.6 | 57.3 | 7.36 |
"Mean duel reached" counts phase 2 as 8. One standard error is about 0.8 points for the mixer and 0.9 for the adaptive bot; the runs 1-10 column is 80 runs per bot, so about 5 points.

Where runs end: guard and cycle die in duels 1 to 3 (96% and 94%), truster in duels 3 to 5 (91%), wsls in duels 2 to 4 (76%). The habit bot dies later than intended, mostly in duels 5 to 7 (65%).

Per duel:

| | d1 | d2 | d3 | d4 | d5 | d6 | d7 | P2 |
|---|---|---|---|---|---|---|---|---|
| mixer duel win % | 98.7 | 96.0 | 92.1 | 89.6 | 86.1 | 81.5 | 82.8 | 76.3 |
| adaptive duel win % | 100.0 | 100.0 | 99.5 | 97.6 | 94.2 | 86.1 | 86.8 | 83.4 |
| uniform duel win % | 98.5 | 94.3 | 88.0 | 85.4 | 78.6 | 74.0 | 73.6 | 69.9 |
| habit duel win % | 100.0 | 99.5 | 97.0 | 91.7 | 80.2 | 60.2 | 54.8 | 44.3 |
| mean HP entering, mixer | 26.0 | 24.2 | 22.7 | 21.5 | 20.8 | 19.9 | 19.3 | 17.2 |
| mean HP entering, adaptive | 26.0 | 25.9 | 25.6 | 24.8 | 23.9 | 22.2 | 20.8 | 18.7 |
| mean HP entering, habit | 26.0 | 25.6 | 24.8 | 23.7 | 22.6 | 21.4 | 20.0 | 15.8 |
| mean turns, mixer | 5.9 | 6.8 | 7.4 | 7.3 | 7.9 | 8.3 | 7.4 | 5.5 |
| mean turns, adaptive | 3.9 | 4.8 | 6.1 | 6.6 | 7.9 | 8.8 | 7.7 | 5.3 |
| honest stances %, adaptive | 84.1 | 74.8 | 64.4 | 56.0 | 50.1 | 43.2 | 42.6 | 38.3 |
| honest stances %, habit | 84.0 | 79.7 | 73.2 | 67.6 | 60.5 | 49.6 | 43.9 | 36.0 |
| honest stances %, mixer | 94.8 | 89.3 | 82.8 | 77.3 | 71.1 | 62.3 | 58.3 | 52.8 |
| Rival exchange win %, mixer | 31.9 | 31.7 | 31.7 | 31.5 | 31.7 | 31.7 | 32.0 | 31.4 |
| clash %, mixer | 35.7 | 36.5 | 36.1 | 37.2 | 36.9 | 37.0 | 37.2 | 37.7 |
| Rival exchange win %, adaptive | 11.1 | 15.0 | 19.9 | 22.8 | 25.8 | 27.2 | 26.6 | 27.7 |
| Rival exchange win %, habit | 26.3 | 28.9 | 31.7 | 34.7 | 38.3 | 43.5 | 46.0 | 50.6 |

- **Duel length:** mean 7.1 turns for the mixer and 6.3 for the adaptive bot; p50 / p90 / p99 are 6 / 12 / 18 and 5 / 11 / 17.
- **Winning run:** 51 turns for the mixer, 48 for the adaptive bot, 55 for the habit bot.
- **Predictability score** (the Rival's lifetime rating, 0 to 100): guard 100, truster 95, cycle 94, wsls 39, habit 20, adaptive 12, mixer 4, uniform 1.
- **Hits of 7 or more:** 3.6% of duels for the mixer and 3.5% for the adaptive bot, 3.3% uniform, 2.7% habit. No hit exceeds a third of max HP. Without phase 2 the rate is 2.7% and 2.3%; phase 2 alone is 16% of its fights for the mixer and 15% for the adaptive bot, from Embers plus the Called Shot bonus.
- **Ruptures:** 10% of mixer duels contain one; 0.02% of mixer duels lock (9+ clashes in a row at three pips).

## 4. Targets not met

| Target | Result | Why |
|---|---|---|
| 7+ hits in 3% of duels or fewer | 3.6% (mixer), 3.5% (adaptive), 3.3% (uniform) | Phase 2. The remaining lever is `CALLED_BONUS` (2 to 1) in `combat.js`, which I did not touch. A cap of 7 would not change the count. |
| combo 1 under 3% | 23% (mixer), 14% (adaptive) | The four-boon Rival build still stacks to 8 under a cap of 8. Only a cap of 6 fixes it, and that makes Deathblow Creed dead again. |
| winning run 60-100 turns | 48 to 55 | Eight fights at 6 to 7 turns. One more Rival HP per duel would get there but takes the mixer under 30%. |
| habit bot bleeds out by duels 3-5 | mostly duels 5-7 | The bucket trend is right (16.3% in runs 1-10, 10.5 and 9.8% later). |
| habit bot 10% or less after run 50 | 10.1% (runs 51+) | Just over the line since save train 0 rounds the Rival's state: it was 9.6% on P1.0 (runs 51+ of the P1.0 headline run), a move of 0.5 points, about one binomial standard error of this figure (2,800 runs). |
| honesty 50% or less in duels 6-7 | adaptive 43 / 43, habit 50 / 44, mixer 62 / 58 | Met for players who react to stances. A player who ignores them never drives honesty down. |
| combo 8 uplift 12 or less | +16.2 | Over the line by 4.2 points (one binomial standard error is about 2 at 1,200 runs per arm, more once the runs in a chain are counted as related). It was +12.3 on P1.0 (§8e) and +18.3 with the 5 HP Rival. Both arms moved: the combo rose 2.2 points and the baseline fell 1.8. |

## 5. Boons

Measured on save train 0 (P1.1) with the same command as §3 (`node tools/sim.js --seeds 8 --no-timing`).

Conditional uplift is the run win rate of runs that took the boon at a bonfire minus that of runs that reached the same bonfire and took something else. Entries have 185 to 1,112 picks; one standard error is about 1.5 points at the largest and 3.5 at the smallest.

**Player boons**

| | mixer | adaptive |
|---|---|---|
| Strongest | mirror_etiquette +8.3, ash_veil +7.1, last_candle +3.4 | keyhole +10.7, serrated_edge +6.9, mirror_etiquette +5.4 |
| Weakest | turtle_cracker -7.1, ash_of_forgetting -5.2, debt_collector -4.5 | long_con -10.6, broken_pattern -9.1, three_faces -6.9 |

Nothing exceeds +12. Ember Hoard is about neutral (-0.5 for the mixer, -1.6 adaptive), so still a real pick. Deathblow Creed deals its full +2 under the cap of 8 but is still a slightly weak pick (-2.0 mixer, -1.4 adaptive), because wins at 3 pips are rare. Both of its figures are inside one standard error.

**Rival boons, effect on the player's win rate**

| | mixer | adaptive |
|---|---|---|
| Worst for the player | sealing_wax -8.9, mirror_etiquette -7.1, mourning_veil -6.5 | serrated_edge -9.5, ash_veil -8.2, no_encores -6.3 |
| Wasted Rival picks | carrion_comfort +6.3, hungry_mask +6.2, vampires_curtsy +5.7 | hungry_mask +6.7, carrion_comfort +6.0, salt_the_wound +5.3 |

Nothing costs more than 12. `sealing_wax` is under the line now, so I did not trim it.

**Relics** (run win rate when carried): mixer ashen_flask 38.5%, dented_buckler 38.1%, rusty_nail 35.3%, cracked_mirror 26.7%, dealers_thumb 18.8%, liars_coin 18.5%. Adaptive liars_coin 58.3%, rusty_nail 56.1%, ashen_flask 53.6%, dented_buckler 50.0%, cracked_mirror 50.0%, dealers_thumb 35.7%. Dealer's Thumb is weak for both. For the mixer, Liar's Coin is as low, on only 54 carriers.

**Dangerous combos (DESIGN §8), all unlocks, combo held from duel 1 unless stated**

| # | Combo | Result | Target |
|---|---|---|---|
| 1 | Rival coiled_riposte + first_blood + deathblow_creed + resonance | 7+ hits in 23% of duels (mixer), 14% (adaptive); max hit 8. Run win 33 to 19%, 55 to 46% | under 3%: **not met** |
| 2 | guard bot with stone_patience + thorned_guard + ash_veil + mirror_etiquette | 0.0% run win, reaches duel 3.1 | still loses: met |
| 3 | vampires_curtsy + paper_cuts + carrion_comfort + salt_the_wound | heal per duel mean 0.79 (mixer), p95 2, above 5 in 0.01% of adaptive duels and never for the mixer. Run win 33 to 45%, 55 to 67% | 5 or less: met |
| 4 | long_con + debt_collector + turtle_cracker | net swing per guard break 1.88 (mixer), 2.48 (adaptive) | 4 or less: met |
| 5 | Rival no_encores + sealing_wax | player mean legal moves 2.59 (mixer), 2.67 (adaptive). Run win 33 to 11%, 55 to 30% | 2.4 or more: met |
| 6 | Rival hungry_mask + mourning_veil + spare_mask | duel length p99 20, max 25 | p99 25 or less: met |
| 7 | coin_of_fools + broken_pattern + three_faces | coin turn edge +0.57 damage for the uniform bot | 1.2 or less: met |
| 8 | adaptive drafts keyhole, truth_candle, ash_of_forgetting at bonfires 1-3 | 71.0% vs 54.8%, +16.2 points | 12 or less: **not met** |
| 9 | mirror_etiquette + resonance | healed 0.38 per duel, Rupture damage 0.31 per duel | see note |

- **Combo 5** passes its stated target but costs the mixer two-thirds of its win rate (33 to 11%) and the adaptive bot almost half (55 to 30%). It needs two specific Rival-only boons.
- **Combo 9:** clash heals now slightly exceed Rupture damage in normal play. The heal is still capped at 2 per duel, and the forced-mirror check in `test_combat.js` still shows Rupture outpacing it when someone farms on purpose.

## 6. What we tried

- **Starting numbers (12 HP, heal 5):** mixer 1 to 3%, adaptive about 6%, with or without the Rupture fix.
- **12 HP with a flat 5 HP Rival, heal 8:** mixer 29.3%, adaptive 51.3%, but duels of 4.3 turns ending in two hits and a 28-turn clear. Rejected: it removes the mind game. The cause is that 12 HP is about four hits, bonfires refill it, and each duel becomes an independent gamble that must be won 88% of the time.
- **Hit cap 6:** removed every 7+ hit but made Deathblow Creed add nothing to a Strike. Reverted to 8 with the pooled HP.
- **Pooled HP, coarse sweep** (Rival 6,7,8,8,9,10,9 / 7):

| Max HP | Heal / P2 heal | mixer | adaptive | habit |
|---|---|---|---|---|
| 20 | 6 / 4 | 20.6% | 43.3% | 6.8% |
| 24 | 4 / 2 | 17.7% | 43.4% | 5.3% |
| 24 | 6 / 4 | 29.1% | 49.6% | 9.1% |
| 24 | 7 / 5 | 36.3% | 55.8% | 9.5% |
| 26 | 5 / 3 | 28.9% | 51.7% | 8.1% |
| **26** | **6 / 4** | **34.8%** | **54.8%** | **9.8%** |
| 28 | 5 / 3 | 30.9% | 55.1% | 10.1% |

The first, second and last rows were measured with the hit cap at 6 and before the two boon trims; the cap moved results by about a point. 24 with heal 7/5 scores the same as 26 with 6/4. I took 26 because the bar drains further (26 to 17 against 24 to 18) and the heals sit mid-range.

## 7. What a playtester should feel-check

1. **The drain.** Does arriving at duel 6 on about 20 of 26 HP feel like a run-long resource, and does a 6 HP bonfire feel like relief without undoing it?
2. **Phase 2.** It is the hardest fight (76% for a neutral player) and where the big hits live: 16% of phase-2 fights contain a hit of 7 or 8 (mixer; 15% for the adaptive bot). Check whether that reads as a finale or as unfair.
3. **Early stances.** Duels 1 to 3 are 84, 75 and 64% honest for a player who trusts about two times in three. Check that the tutorial's lesson holds and that the first lies feel earned.

Also worth a look: Rupture without the seal (four clashes in a row), Sealing Wax with No Encores in the Rival's hands, and whether Deathblow Creed is worth a rare slot.

## 8. Follow-ups outside this pass

- Closed in the P1.0 docs pass: `DESIGN.md` §4, §5 and §12 carry SUPERSEDED banners, and §8 says the card text in `src/game/boons.js` is authoritative. `index.html` must equal a fresh build of `src/`; the release gate's in-sync step checks it on every run.
- Balance changes are checked against the exact sim digest in `tools/baseline.json`: `node tools/test_all.js` replays 8 short sim cells (four faces × stakes 0 and 7, 2 chains × 60 runs, all unlocks, no combos) and compares them byte for byte, so any change in pure-module behaviour fails the gate unless the same commit re-records the baseline. P1.0 recorded the baseline on the `src/` tree with src digest `283c46cbdad8` (the first 12 hex of its `srcSha256`); save train 0 re-recorded it at `49e893c2b342` (§8e).
- Still open: the layout spec has "9/12"-style numerals and an HP bar with a notch per HP; I have not looked at either at 26.

## 8b. The Vigil (stakes)

Added after the main pass. `node tools/sim.js --set stake=N` plays every run with N lights out; `--set V.healCut=2 --set V.hp=1 --set V.callsFrom=1` tune the three numeric rules.

Run win % by lights out, 8 chains × 300 runs, natural unlocks:

| Lights out | adaptive | mixer | uniform | habit | 7+ hit duels % (adaptive) |
|---|---|---|---|---|---|
| 0 | 55.0 | 35.4 | 21.5 | 10.2 | 3.6 |
| 1 The Benefit of the Doubt | 53.8 | 32.9 | 21.7 | 8.4 | 3.6 |
| 2 The Kinder Fire | 48.3 | 24.0 | 13.5 | 6.5 | 3.3 |
| 3 The Honest Face | 40.4 | 24.2 | 13.3 | 4.1 | 3.3 |
| 4 The Empty Hand | 32.0 | 17.6 | 9.9 | 2.2 | 4.5 |
| 5 A Moment's Peace | 29.5 | 15.7 | 8.5 | 1.9 | 4.2 |
| 6 The Glass Jaw | 20.7 | 9.6 | 4.3 | 0.9 | 4.4 |
| 7 The Unsaid | 20.2 | 8.2 | 3.2 | 0.5 | 7.0 |

- Every step is flat or down for every bot. Lights 1, 3 and 7 sharpen the Rival (earlier exploitation, earlier lies, called moves), so they hit the habit bot hardest and the mixer least; lights 2, 5 and 6 are resource rules and hit the mixer hardest.
- Known cost: with The Unsaid out, duels with a hit of 7+ double to about 7%, because the Called Shot bonus is live from duel 1.
- Rules tried and dropped: a tension floor of one pip from duel 5 raised the adaptive bot's win rate by 3.5 points (tension rewards whoever wins more exchanges); offering two boons instead of three moved no bot.

## 8c. The faces (final bosses)

`node tools/sim.js --unlocks all --set boss=<id>` forces one face; `--set B.<id>.<phase>.<key>=n` overrides one number in the table (for example `--set B.hours.4.floor=2`). The target was: winning the final duel, given that you reach it, stays within about 5 points of The Unmasked for the adaptive and mixer bots.

Final-duel win % given arrival (run win % in brackets), 8 chains × 300 runs:

| Face (health per phase, heal between) | adaptive | mixer | uniform | habit |
|---|---|---|---|---|
| The Unmasked (9 / 7, heal 4) | 70 (56) | 64 (35) | 51 (21) | 23 (10) |
| The Three-Faced (5 / 4 / 5, heal 3) | 72 (56) | 64 (34) | 54 (22) | 24 (11) |
| The Hours (4 / 4 / 4 / 4, heal 3) | 71 (57) | 61 (34) | 50 (21) | 16 (7) |
| The Reflection (5 / 5 / 5, heal 3) | 75 (59) | 61 (31) | 55 (24) | 32 (14) |

With all seven lights out: Unmasked 46 / 39 / 23 / 17, Three-Faced 44 / 32 / 25 / 0, Hours 47 / 30 / 25 / 0, Reflection 46 / 32 / 25 / 14.

- **Met** with no lights out. **Missed for the mixer with seven lights out** (30–32% against 39%): The Glass Jaw adds its health and A Moment's Peace removes its heal once per phase, so faces with more phases pay more. Not corrected.
- First numbers and what moved them: The Three-Faced at 5 / 5 / 6 with heal 2 and fortify 2 was 59 / 57, ten points too hard; The Reflection at 6 / 5 / 5 with heal 2 was 69 / 52, where the mixer's own drafted boons were being used against it.
- The Hours favours whoever wins more exchanges, because a raised tension floor makes every hit bigger. That is why the habit bot does worst there and the adaptive bot is unmoved.
- The Reflection is the kindest to the habit bot: when it plays as the bot would, the two of them clash a lot.
- The adaptive bot was taught one thing for The Reflection: under the mimic rule it weighs the Rival's moves by its own record after a win, loss or clash, which is what a player who has read the rule card would do.

## 8d. Noise baseline and per-phase tables (P1.0)

The tables below come from `node tools/sim_tables.js` (its defaults: `--seeds 8 --runs 400 --seed 1 --stakes 0,7 --faces all --jobs 4`; about 90 to 110 s). It runs one sim process per face and stake, never with `--label`:

```
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=unmasked --set stake=0
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=three_faced --set stake=0
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=hours --set stake=0
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=reflection --set stake=0
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=unmasked --set stake=7
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=three_faced --set stake=7
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=hours --set stake=7
node tools/sim.js --json --seed 1 --seeds 8 --runs 400 --unlocks all --no-combos --set boss=reflection --set stake=7
```

- **Code measured:** commit `fdb990f` with the P1.0 tools, node v22.23.2. Its `src/` is the same tree as at `0cba25d`; these tools (`sim.js --json`, `sim_tables.js`) do not exist at that commit, so the tables cannot be re-run there. `sim_tables.js` prints the src digest `263f9953f0a7` (LF-normalised path+length+content, 32 files); `tools/baseline.json` hashes the same tree another way (`srcSha256` `283c46cbdad8`).
- 8 chains × 400 sequential runs per bot, seed 1, all unlocks, no combo checks. W = runs won, A = runs that reached duel 7.
- **Insufficient sample:** a chain counts only with 30 or more duel-7 arrivals, a chain SD needs 6 counted chains, and a pooled value needs 100 or more arrivals (`SAMPLE` in `tools/sim.js`). Such a cell reads "insufficient sample", never a pass.
- **Chain SD** is the spread of win given arrival across the counted chains: the noise of one 400-run chain. **SE = SD / √(counted chains)** is the noise of the pooled 8 × 400 number. The binomial SE √(p(1 − p) / A) is shown for reference.
- **Acceptance bands** for later balance changes are max(3, 2 × chain SD) points around these values. That band is sized for chain-to-chain noise; a pooled 8 × 400 figure is known to within its SE, which is smaller. The bands stay on the chain SD (owner, 2026-11-16): runs in one chain share a learning Rival and are not independent, so a band built on the pooled SE would be too narrow and would flag noise as change.
- At stake 0 these figures agree with the 8c table (300-run chains) within 2 points for every face and bot. At stake 7 the adaptive and mixer figures agree within 2 points; the uniform and habit samples there are small (see their SD and arrivals).
- Stance columns count only turns on which a stance was shown (since P1.0), so The Blank's no-stance turns are left out of The Three-Faced's stance numbers.

**Final-duel win given arrival, stake 0**

| face | bot | W/A | win given arrival % | chain SD | SE = SD/√chains | binomial SE | band max(3, 2 SD) | run win % | arrivals per chain (min-max) |
|---|---|---|---|---|---|---|---|---|---|
| unmasked | adaptive | 1827/2567 | 71.2 | 1.29 | 0.45 | 0.89 | 3.0 | 57.1 | 310-334 |
| unmasked | mixer | 1108/1746 | 63.5 | 3.18 | 1.12 | 1.15 | 6.4 | 34.6 | 211-223 |
| unmasked | uniform | 689/1341 | 51.4 | 2.49 | 0.88 | 1.36 | 5.0 | 21.5 | 154-172 |
| unmasked | habit | 303/1411 | 21.5 | 2.25 | 0.79 | 1.09 | 4.5 | 9.5 | 158-192 |
| three_faced | adaptive | 1793/2506 | 71.5 | 2.82 | 1.00 | 0.90 | 5.6 | 56.0 | 298-324 |
| three_faced | mixer | 1097/1684 | 65.1 | 4.01 | 1.42 | 1.16 | 8.0 | 34.3 | 199-215 |
| three_faced | uniform | 721/1289 | 55.9 | 5.86 | 2.07 | 1.38 | 11.7 | 22.5 | 151-171 |
| three_faced | habit | 343/1430 | 24.0 | 1.20 | 0.42 | 1.13 | 3.0 | 10.7 | 166-195 |
| hours | adaptive | 1840/2553 | 72.1 | 2.23 | 0.79 | 0.89 | 4.5 | 57.5 | 313-327 |
| hours | mixer | 1066/1754 | 60.8 | 3.95 | 1.40 | 1.17 | 7.9 | 33.3 | 210-227 |
| hours | uniform | 688/1338 | 51.4 | 3.15 | 1.11 | 1.37 | 6.3 | 21.5 | 155-176 |
| hours | habit | 206/1366 | 15.1 | 3.84 | 1.36 | 0.97 | 7.7 | 6.4 | 160-192 |
| reflection | adaptive | 1861/2516 | 74.0 | 2.91 | 1.03 | 0.87 | 5.8 | 58.2 | 303-327 |
| reflection | mixer | 991/1645 | 60.2 | 4.06 | 1.44 | 1.21 | 8.1 | 31.0 | 200-214 |
| reflection | uniform | 771/1387 | 55.6 | 3.65 | 1.29 | 1.33 | 7.3 | 24.1 | 165-185 |
| reflection | habit | 435/1413 | 30.8 | 3.74 | 1.32 | 1.23 | 7.5 | 13.6 | 153-187 |

Left out, insufficient sample (fewer than 100 arrivals pooled): unmasked cycle (0 arrivals), unmasked guard (0 arrivals), unmasked truster (6 arrivals), unmasked wsls (46 arrivals), three_faced cycle (0 arrivals), three_faced guard (0 arrivals), three_faced truster (6 arrivals), three_faced wsls (56 arrivals), hours cycle (0 arrivals), hours guard (0 arrivals), hours truster (6 arrivals), hours wsls (47 arrivals), reflection cycle (0 arrivals), reflection guard (0 arrivals), reflection truster (5 arrivals), reflection wsls (51 arrivals).

**Final-duel win given arrival, stake 7** (all seven lights out)

| face | bot | W/A | win given arrival % | chain SD | SE = SD/√chains | binomial SE | band max(3, 2 SD) | run win % | arrivals per chain (min-max) |
|---|---|---|---|---|---|---|---|---|---|
| unmasked | adaptive | 680/1468 | 46.3 | 3.25 | 1.15 | 1.30 | 6.5 | 21.3 | 150-199 |
| unmasked | mixer | 291/734 | 39.6 | 3.54 | 1.25 | 1.81 | 7.1 | 9.1 | 73-107 |
| unmasked | uniform | 113/407 | 27.8 | 10.15 | 3.59 | 2.22 | 20.3 | 3.5 | 47-64 |
| unmasked | habit | 27/192 | 14.1 | insufficient sample (2 of 8 chains) | insufficient sample | 2.51 | insufficient sample | 0.8 | 16-33 |
| three_faced | adaptive | 626/1418 | 44.1 | 2.67 | 0.94 | 1.32 | 5.3 | 19.6 | 158-190 |
| three_faced | mixer | 222/698 | 31.8 | 8.12 | 2.87 | 1.76 | 16.2 | 6.9 | 71-102 |
| three_faced | uniform | 102/403 | 25.3 | 6.65 | 2.35 | 2.17 | 13.3 | 3.2 | 41-61 |
| three_faced | habit | 11/173 | 6.4 | insufficient sample (0 of 8 chains) | insufficient sample | 1.86 | insufficient sample | 0.3 | 14-28 |
| hours | adaptive | 684/1482 | 46.2 | 4.92 | 1.74 | 1.29 | 9.8 | 21.4 | 167-200 |
| hours | mixer | 217/754 | 28.8 | 5.11 | 1.81 | 1.65 | 10.2 | 6.8 | 84-107 |
| hours | uniform | 88/378 | 23.3 | 8.06 | 2.85 | 2.17 | 16.1 | 2.8 | 38-62 |
| hours | habit | 6/184 | 3.3 | insufficient sample (1 of 8 chains) | insufficient sample | 1.31 | insufficient sample | 0.2 | 15-32 |
| reflection | adaptive | 656/1473 | 44.5 | 3.87 | 1.37 | 1.29 | 7.7 | 20.5 | 175-196 |
| reflection | mixer | 227/710 | 32.0 | 4.44 | 1.57 | 1.75 | 8.9 | 7.1 | 80-101 |
| reflection | uniform | 96/413 | 23.2 | 4.69 | 1.66 | 2.08 | 9.4 | 3.0 | 45-58 |
| reflection | habit | 15/214 | 7.0 | insufficient sample (4 of 8 chains) | insufficient sample | 1.75 | insufficient sample | 0.5 | 20-30 |

Left out, insufficient sample (fewer than 100 arrivals pooled): unmasked cycle (0 arrivals), unmasked guard (0 arrivals), unmasked truster (0 arrivals), unmasked wsls (0 arrivals), three_faced cycle (0 arrivals), three_faced guard (0 arrivals), three_faced truster (0 arrivals), three_faced wsls (0 arrivals), hours cycle (0 arrivals), hours guard (0 arrivals), hours truster (0 arrivals), hours wsls (0 arrivals), reflection cycle (0 arrivals), reflection guard (0 arrivals), reflection truster (0 arrivals), reflection wsls (0 arrivals).

**Final duel by phase.** Condensed to the adaptive and mixer rows; `node tools/sim_tables.js` also prints the uniform and habit rows.

turns = p10/p50/p90 (mean); ≤2 dec = phases settled within 2 decisive (non-clash) exchanges; ≤2 t = within 2 turns; clash = clashes / turns;
7+, rupt, lock = share of phases with a 7+ hit on the player, a Rupture, 9+ clashes in a row at 3 pips; bored = escapes (turns / phases);
truth = honest share of the turns on which a stance was shown (shown turns). Rows with fewer than 100 arrivals: insufficient sample.

Stake 0:

| face | bot | phase | exploit | arrive | win % | ±SE | turns | ≤2 dec % | ≤2 t % | clash % | 7+ % | rupt % | lock % | bored | truth % (shown) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| unmasked | adaptive | 1 The Altar | 1 | 2567 | 86.4 | 0.5 | 4/7/13 (7.54) | 6.5 | 1.0 | 34.0 | 5.8 | 10.6 | 0.0 | 1/1 | 42.0 (19352) |
| unmasked | adaptive | 2 The Unmasked | 1 | 2219 | 82.3 | 0.6 | 2/5/9 (5.12) | 39.1 | 17.9 | 35.5 | 14.6 | 21.1 | 0.1 | 4/2 | 38.4 (11372) |
| unmasked | mixer | 1 The Altar | 1 | 1746 | 82.1 | 0.5 | 3/7/13 (7.37) | 17.1 | 3.7 | 38.1 | 6.9 | 12.8 | 0.2 | 4/3 | 57.2 (12866) |
| unmasked | mixer | 2 The Unmasked | 1 | 1433 | 77.3 | 1.3 | 2/5/10 (5.51) | 33.2 | 11.3 | 37.3 | 15.1 | 24.6 | 0.0 | 0/0 | 52.7 (7895) |
| three_faced | adaptive | 1 The Jester | 1 | 2506 | 92.7 | 0.6 | 2/3/8 (4.16) | 56.3 | 37.9 | 32.5 | 5.2 | 5.1 | 0.0 | 0/0 | 33.6 (10422) |
| three_faced | adaptive | 2 The Mourner | 1 | 2322 | 89.5 | 0.6 | 2/4/9 (5.00) | 42.9 | 22.4 | 34.7 | 4.2 | 7.0 | 0.1 | 3/2 | 40.1 (11610) |
| three_faced | adaptive | 3 The Blank | 1 | 2078 | 86.3 | 0.8 | 2/5/10 (5.71) | 34.4 | 13.7 | 37.1 | 3.5 | 10.3 | 0.0 | 0/0 | n/a (no stance shown) |
| three_faced | mixer | 1 The Jester | 1 | 1684 | 91.3 | 0.5 | 1/3/9 (4.20) | 58.7 | 36.7 | 37.9 | 4.6 | 6.8 | 0.1 | 2/1 | 48.6 (7065) |
| three_faced | mixer | 2 The Mourner | 1 | 1538 | 84.1 | 0.9 | 2/5/10 (5.39) | 37.5 | 14.5 | 36.3 | 5.0 | 9.4 | 0.0 | 0/0 | 50.9 (8288) |
| three_faced | mixer | 3 The Blank | 1 | 1294 | 84.8 | 1.7 | 3/5/10 (5.79) | 34.2 | 10.0 | 39.5 | 2.9 | 10.6 | 0.0 | 0/0 | n/a (no stance shown) |
| hours | adaptive | 1 Vespers | 1 | 2553 | 94.4 | 0.5 | 2/3/8 (3.96) | 61.9 | 45.2 | 32.2 | 3.2 | 4.9 | 0.1 | 4/3 | 40.1 (10119) |
| hours | adaptive | 2 Compline | 1 | 2411 | 91.5 | 0.4 | 1/3/8 (3.72) | 64.5 | 46.2 | 34.9 | 5.3 | 14.7 | 0.1 | 2/2 | 35.8 (8968) |
| hours | adaptive | 3 Matins | 1 | 2207 | 91.7 | 0.7 | 1/2/6 (2.64) | 79.5 | 65.1 | 33.0 | 6.7 | 18.3 | 0.0 | 0/0 | 37.3 (5819) |
| hours | adaptive | 4 Lauds | 1 | 2024 | 90.9 | 0.4 | 1/1/5 (2.24) | 85.4 | 71.2 | 30.8 | 7.9 | 33.0 | 0.0 | 0/0 | 37.6 (4533) |
| hours | mixer | 1 Vespers | 1 | 1754 | 93.8 | 0.4 | 1/3/8 (3.91) | 63.3 | 41.8 | 37.7 | 2.9 | 7.5 | 0.0 | 0/0 | 56.9 (6855) |
| hours | mixer | 2 Compline | 1 | 1646 | 88.8 | 1.2 | 1/3/8 (4.08) | 59.5 | 36.8 | 38.3 | 5.8 | 19.5 | 0.0 | 0/0 | 51.6 (6723) |
| hours | mixer | 3 Matins | 1 | 1462 | 86.8 | 0.7 | 1/3/7 (3.26) | 72.4 | 49.7 | 37.5 | 6.6 | 25.0 | 0.0 | 0/0 | 50.6 (4759) |
| hours | mixer | 4 Lauds | 1 | 1269 | 84.0 | 0.6 | 1/2/6 (2.95) | 80.4 | 54.5 | 40.3 | 11.7 | 55.7 | 0.0 | 0/0 | 52.4 (3748) |
| reflection | adaptive | 1 The Borrower | 1 | 2516 | 89.3 | 0.6 | 2/4/10 (5.11) | 42.4 | 25.5 | 34.2 | 6.6 | 7.5 | 0.0 | 0/0 | 41.3 (12864) |
| reflection | adaptive | 2 The Likeness | 1 | 2247 | 92.9 | 0.4 | 2/4/8 (4.51) | 48.6 | 26.2 | 32.4 | 2.4 | 5.5 | 0.0 | 0/0 | 24.5 (10140) |
| reflection | adaptive | 3 The Reflection | 1 | 2087 | 89.2 | 0.8 | 2/3/8 (4.19) | 55.2 | 31.2 | 33.7 | 10.0 | 16.4 | 0.0 | 0/0 | 27.4 (8752) |
| reflection | mixer | 1 The Borrower | 1 | 1645 | 86.4 | 0.9 | 2/4/9 (4.75) | 50.6 | 27.7 | 37.9 | 6.9 | 8.3 | 0.0 | 0/0 | 57.4 (7813) |
| reflection | mixer | 2 The Likeness | 1 | 1422 | 88.0 | 0.8 | 2/4/9 (5.07) | 37.3 | 15.8 | 33.2 | 3.4 | 7.0 | 0.0 | 0/0 | 29.1 (7212) |
| reflection | mixer | 3 The Reflection | 1 | 1252 | 79.2 | 1.2 | 2/4/8 (4.37) | 47.9 | 24.5 | 33.7 | 13.9 | 17.8 | 0.1 | 1/1 | 30.5 (5470) |

Stake 7:

| face | bot | phase | exploit | arrive | win % | ±SE | turns | ≤2 dec % | ≤2 t % | clash % | 7+ % | rupt % | lock % | bored | truth % (shown) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| unmasked | adaptive | 1 The Altar | 1 | 1468 | 71.7 | 1.3 | 4/7/12 (7.56) | 5.4 | 0.8 | 33.8 | 12.7 | 10.8 | 0.1 | 2/1 | 43.0 (11099) |
| unmasked | adaptive | 2 The Unmasked | 1 | 1053 | 64.6 | 1.5 | 2/4/8 (4.83) | 40.8 | 15.5 | 35.5 | 18.9 | 21.3 | 0.1 | 3/1 | 40.6 (5082) |
| unmasked | mixer | 1 The Altar | 1 | 734 | 69.2 | 2.1 | 3/7/12 (7.03) | 14.6 | 3.4 | 37.3 | 10.9 | 12.7 | 0.0 | 0/0 | 54.5 (5160) |
| unmasked | mixer | 2 The Unmasked | 1 | 508 | 57.3 | 1.6 | 2/4/8 (4.46) | 43.1 | 19.3 | 35.2 | 13.6 | 20.1 | 0.0 | 0/0 | 50.6 (2267) |
| three_faced | adaptive | 1 The Jester | 1 | 1418 | 84.0 | 0.7 | 2/4/8 (4.43) | 46.8 | 24.5 | 32.1 | 9.9 | 6.2 | 0.0 | 0/0 | 41.0 (6283) |
| three_faced | adaptive | 2 The Mourner | 1 | 1191 | 75.7 | 0.8 | 2/4/9 (4.98) | 37.2 | 13.9 | 34.4 | 8.1 | 7.1 | 0.0 | 0/0 | 43.8 (5926) |
| three_faced | adaptive | 3 The Blank | 1 | 901 | 69.5 | 1.5 | 2/5/9 (5.20) | 36.7 | 14.1 | 35.3 | 5.4 | 8.3 | 0.0 | 0/0 | n/a (no stance shown) |
| three_faced | mixer | 1 The Jester | 1 | 698 | 80.4 | 1.8 | 2/4/8 (4.35) | 49.9 | 26.1 | 35.7 | 11.5 | 8.2 | 0.0 | 0/0 | 49.4 (3039) |
| three_faced | mixer | 2 The Mourner | 1 | 561 | 67.0 | 1.9 | 2/4/9 (4.94) | 39.4 | 18.7 | 36.3 | 8.7 | 8.2 | 0.0 | 0/0 | 51.4 (2773) |
| three_faced | mixer | 3 The Blank | 1 | 376 | 59.0 | 3.6 | 2/4/8 (4.71) | 47.6 | 17.6 | 39.1 | 8.2 | 10.4 | 0.0 | 0/0 | n/a (no stance shown) |
| hours | adaptive | 1 Vespers | 1 | 1482 | 88.7 | 1.0 | 2/3/8 (4.29) | 50.4 | 30.6 | 31.8 | 5.0 | 5.2 | 0.0 | 0/0 | 41.6 (6351) |
| hours | adaptive | 2 Compline | 1 | 1314 | 79.4 | 1.6 | 2/3/7 (3.70) | 63.9 | 40.6 | 33.6 | 12.6 | 16.7 | 0.0 | 0/0 | 39.5 (4857) |
| hours | adaptive | 3 Matins | 1 | 1043 | 78.6 | 1.4 | 1/2/6 (3.13) | 73.4 | 51.3 | 33.4 | 15.1 | 23.3 | 0.1 | 1/1 | 39.4 (3268) |
| hours | adaptive | 4 Lauds | 1 | 820 | 83.4 | 1.2 | 1/1/4 (2.01) | 90.5 | 75.2 | 29.9 | 11.2 | 35.0 | 0.0 | 0/0 | 37.2 (1652) |
| hours | mixer | 1 Vespers | 1 | 754 | 85.0 | 1.1 | 2/3/8 (3.99) | 58.5 | 35.5 | 36.0 | 5.4 | 7.7 | 0.0 | 0/0 | 55.0 (3010) |
| hours | mixer | 2 Compline | 1 | 641 | 73.9 | 1.0 | 2/3/7 (3.85) | 60.2 | 35.1 | 37.2 | 13.3 | 17.9 | 0.0 | 0/0 | 50.8 (2468) |
| hours | mixer | 3 Matins | 1 | 474 | 69.2 | 1.5 | 1/3/6 (3.13) | 73.0 | 47.0 | 34.8 | 15.6 | 22.2 | 0.0 | 0/0 | 48.1 (1484) |
| hours | mixer | 4 Lauds | 1 | 328 | 66.2 | 4.3 | 1/2/5 (2.42) | 87.8 | 64.0 | 37.2 | 17.7 | 46.6 | 0.0 | 0/0 | 49.7 (793) |
| reflection | adaptive | 1 The Borrower | 1 | 1473 | 79.8 | 1.1 | 2/4/10 (5.28) | 32.8 | 15.5 | 33.7 | 12.6 | 8.0 | 0.1 | 2/2 | 42.4 (7784) |
| reflection | adaptive | 2 The Likeness | 1 | 1175 | 79.2 | 0.9 | 2/4/8 (4.61) | 43.7 | 18.8 | 32.8 | 5.8 | 6.0 | 0.0 | 0/0 | 25.5 (5412) |
| reflection | adaptive | 3 The Reflection | 1 | 931 | 70.5 | 1.3 | 2/3/7 (3.92) | 56.8 | 30.1 | 32.3 | 14.1 | 14.2 | 0.0 | 0/0 | 27.9 (3653) |
| reflection | mixer | 1 The Borrower | 1 | 710 | 77.2 | 1.4 | 2/4/8 (4.58) | 47.6 | 22.4 | 36.3 | 15.5 | 7.7 | 0.0 | 0/0 | 54.5 (3253) |
| reflection | mixer | 2 The Likeness | 1 | 548 | 69.5 | 1.2 | 2/4/8 (4.65) | 38.5 | 19.0 | 32.3 | 6.9 | 6.9 | 0.0 | 0/0 | 28.1 (2547) |
| reflection | mixer | 3 The Reflection | 1 | 381 | 59.6 | 1.3 | 2/4/7 (4.17) | 54.1 | 24.9 | 34.7 | 18.6 | 17.1 | 0.0 | 0/0 | 28.3 (1588) |

## 8e. Save train 0 (P1.1), paired with P1.0

P1.1 changes no rule. It rounds the Rival's learned state to the precision the save holds, every time the brain writes it (`quant()` in `src/ai/brain.js`), so a reloaded Rival plays exactly like one that never reloaded. Rounding moves every sim trajectory, so the exact digest in `tools/baseline.json` is re-recorded in the same commit (baseline `srcSha256` `49e893c2b342`). The tables below pair the two builds on the same seeds.

- **P1.0:** commit `fdb990f`. The P1.0 branch head differs from it only in the page's description meta, the docs and the check tools (`check.js`, `check_docs.js`, `test_all.js`), and its digest is byte-identical (the gate's digest step).
- **P1.1:** the save-train commit on the P1.1 branch. The tables were measured on its `src/` before the stale-tab check in the duel scene was added (`sim_tables.js` src digest `a7efe92920f3`); the sim does not load the duel scene, and the gate's digest cells are byte-identical across that change.
- **Headline:** `node tools/sim.js --seeds 8 --no-timing` (8 chains × 400 sequential runs per bot, seed 1, natural unlocks). **Final duel:** `node tools/sim_tables.js` (the §8d commands), bands from §8d.
- **Limits for this push:** headline run win within 3 points, 7+ hit duels within 0.5 points, lock 0.1% or less.

**Headline**

| bot | run win % P1.0 | P1.1 | change | 7+ hit % P1.0 | P1.1 | change | lock % P1.0 | P1.1 |
|---|---|---|---|---|---|---|---|---|
| guard | 0.0 | 0.0 | ±0.0 | 0.36 | 0.36 | ±0.00 | 0.00 | 0.00 |
| cycle | 0.0 | 0.0 | ±0.0 | 0.83 | 0.82 | −0.01 | 0.00 | 0.00 |
| wsls | 0.2 | 0.2 | ±0.0 | 1.30 | 1.54 | +0.24 | 0.02 | 0.02 |
| truster | 0.0 | 0.0 | ±0.0 | 0.29 | 0.31 | +0.02 | 0.00 | 0.00 |
| habit | 9.8 | 10.3 | +0.5 | 2.60 | 2.66 | +0.06 | 0.00 | 0.00 |
| uniform | 21.6 | 20.9 | −0.7 | 3.24 | 3.26 | +0.02 | 0.01 | 0.02 |
| mixer | 34.8 | 34.7 | −0.1 | 3.52 | 3.64 | +0.12 | 0.03 | 0.02 |
| adaptive | 54.8 | 57.1 | +2.3 | 3.52 | 3.46 | −0.06 | 0.03 | 0.02 |

Largest run-win change 2.3 points (limit 3), largest 7+ change 0.24 points (limit 0.5), highest lock 0.02% (limit 0.1).

**Final-duel win given arrival**

Stake 0:

| face | bot | P1.0 win given arrival % | P1.1 % | change | band (P1.0) | within band |
|---|---|---|---|---|---|---|
| unmasked | adaptive | 71.2 | 70.0 | −1.2 | 3.0 | yes |
| unmasked | mixer | 63.5 | 64.9 | +1.4 | 6.4 | yes |
| unmasked | uniform | 51.4 | 50.1 | −1.3 | 5.0 | yes |
| unmasked | habit | 21.5 | 22.4 | +0.9 | 4.5 | yes |
| three_faced | adaptive | 71.5 | 71.5 | ±0.0 | 5.6 | yes |
| three_faced | mixer | 65.1 | 65.0 | −0.1 | 8.0 | yes |
| three_faced | uniform | 55.9 | 53.6 | −2.3 | 11.7 | yes |
| three_faced | habit | 24.0 | 24.6 | +0.6 | 3.0 | yes |
| hours | adaptive | 72.1 | 73.4 | +1.3 | 4.5 | yes |
| hours | mixer | 60.8 | 59.4 | −1.4 | 7.9 | yes |
| hours | uniform | 51.4 | 48.8 | −2.6 | 6.3 | yes |
| hours | habit | 15.1 | 15.6 | +0.5 | 7.7 | yes |
| reflection | adaptive | 74.0 | 74.9 | +0.9 | 5.8 | yes |
| reflection | mixer | 60.2 | 60.4 | +0.2 | 8.1 | yes |
| reflection | uniform | 55.6 | 56.2 | +0.6 | 7.3 | yes |
| reflection | habit | 30.8 | 30.4 | −0.4 | 7.5 | yes |

Stake 7:

| face | bot | P1.0 win given arrival % | P1.1 % | change | band (P1.0) | within band |
|---|---|---|---|---|---|---|
| unmasked | adaptive | 46.3 | 46.8 | +0.5 | 6.5 | yes |
| unmasked | mixer | 39.6 | 38.6 | −1.0 | 7.1 | yes |
| unmasked | uniform | 27.8 | 26.5 | −1.3 | 20.3 | yes |
| unmasked | habit | 14.1 | 13.2 | −0.9 | insufficient sample | n/a |
| three_faced | adaptive | 44.1 | 42.0 | −2.1 | 5.3 | yes |
| three_faced | mixer | 31.8 | 33.7 | +1.9 | 16.2 | yes |
| three_faced | uniform | 25.3 | 24.8 | −0.5 | 13.3 | yes |
| three_faced | habit | 6.4 | 3.0 | −3.4 | insufficient sample | n/a |
| hours | adaptive | 46.2 | 46.3 | +0.1 | 9.8 | yes |
| hours | mixer | 28.8 | 26.9 | −1.9 | 10.2 | yes |
| hours | uniform | 23.3 | 21.3 | −2.0 | 16.1 | yes |
| hours | habit | 3.3 | 1.2 | −2.1 | insufficient sample | n/a |
| reflection | adaptive | 44.5 | 46.9 | +2.4 | 7.7 | yes |
| reflection | mixer | 32.0 | 30.7 | −1.3 | 8.9 | yes |
| reflection | uniform | 23.2 | 25.1 | +1.9 | 9.4 | yes |
| reflection | habit | 7.0 | 9.6 | +2.6 | insufficient sample | n/a |

The limits hold. No headline run win moves by more than 2.3 points (the adaptive bot, 54.8 to 57.1), 7+ hit duels by at most 0.24 points, and lock stays at or under 0.02%. Every final-duel figure that has a band in §8d stays inside it; the largest of those moves are 2.6 points (hours uniform, stake 0) and 2.4 (reflection adaptive, stake 7). The four stake-7 habit cells have no band (too few arrivals per chain), so they are reported, not judged; the largest moves 3.4 points (three_faced, 6.4 to 3.0). One figure outside these tables moves more: combo 8's uplift (§4) goes from +12.3 to +16.2 against a target of 12 it already missed, about 1.4 standard errors of a change between two builds at 1,200 runs per arm.

## 9. About the sim

- `node tools/sim.js [--runs N] [--seeds K] [--seed S] [--bot a,b] [--quick] [--jobs J] [--unlocks natural|all] [--no-combos] [--combos] [--no-boons] [--set key=value] [--no-timing] [--json] [--label text] [--trace]`. `--no-timing` drops everything machine-dependent, so the output is byte-identical across runs and `--jobs` values; `--json` prints one canonical JSON document (sorted keys, raw counts per face, bot, duel and final-duel phase, no timing); `--set boss=all` plays every face, one job per face × bot × chain, and implies `--no-combos` unless `--combos` is given. About 100 to 150 runs per second per worker, 1,300 per second on 11 workers.
- `--set` overrides constants for a sweep without editing files, for example `--set maxhp=24 --set heal=7 --set hp=6,7,8,8,9,10,9 --set K.TAU_BASE=1.5`. `--label` appends the headline to `tools/out/balance_log.md` (local-only, not in the repo; release work never passes `--label`).
- Bots are never handed the sealed commit. Info boons reach them only through the values the scene draws. The mixer and uniform bots use only the Coin of Fools; the adaptive bot uses every active.
- The tutorial is skipped, runs are spaced 10 minutes apart, and unlocks arrive naturally unless `--unlocks all`.
- Bot relic choice is a fixed favourite with 15% exploration. Draft choice is a soft preference by move share (simple bots) or by tag synergy and counter-drafting the Rival's pick (adaptive).
- The adaptive bot was checked for sensitivity in the previous round: changing its best-response share, temperature or memory weighting moved it by about 4 points.
