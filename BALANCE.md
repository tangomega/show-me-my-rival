# SHOW ME MY RIVAL — balance pass

Measured with `tools/sim.js`, which plays the real `rng`, `brain`, `boons`, `combat` and `run` modules in the game's own call order. Each bot plays chains of 400 sequential runs against one persistent brain and meta. Tables are 8 chains per bot (3,200 runs), seed 1, natural unlock order.

Reproduce: `node tools/sim.js --seeds 8` (about 40 s). Raw output of the final run is `tools/out/final_r2.txt`; every tuning step is in `tools/out/balance_log.md`.

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

| Bot | Target | All runs | Runs 1-10 | 11-50 | 51-200 | 201+ | Mean duel reached |
|---|---|---|---|---|---|---|---|
| guard | 0.5% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 2.19 |
| cycle | 2% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 2.28 |
| wsls | 6% or less | 0.2% | 0.0 | 0.9 | 0.2 | 0.1 | 3.25 |
| truster | 20% early, 5% late | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 3.98 |
| habit | 10% or less after run 50 | 9.8% | 16.3 | 9.7 | 10.2 | 9.2 | 6.20 |
| uniform | 15-35% | 21.6% | 18.8 | 17.8 | 20.9 | 22.9 | 5.68 |
| mixer | 30-45% | 34.8% | 40.0 | 36.3 | 34.3 | 34.5 | 6.23 |
| adaptive | 50-65% | 54.8% | 58.8 | 51.9 | 55.9 | 54.3 | 7.36 |

"Mean duel reached" counts phase 2 as 8. One standard error is about 0.8 points for the mixer and 0.9 for the adaptive bot; the runs 1-10 column is 80 runs per bot, so about 5 points.

Where runs end: guard and cycle die in duels 1 to 3 (about 95%), truster in duels 3 to 5 (92%), wsls in duels 2 to 4 (76%). The habit bot dies later than intended, mostly in duels 5 to 7 (66%).

Per duel:

| | d1 | d2 | d3 | d4 | d5 | d6 | d7 | P2 |
|---|---|---|---|---|---|---|---|---|
| mixer duel win % | 98.7 | 95.8 | 92.1 | 89.2 | 85.6 | 81.2 | 83.2 | 77.4 |
| adaptive duel win % | 100.0 | 100.0 | 99.7 | 98.2 | 94.3 | 85.7 | 84.4 | 82.0 |
| uniform duel win % | 98.5 | 93.8 | 88.4 | 85.0 | 79.1 | 74.1 | 74.6 | 71.1 |
| habit duel win % | 99.8 | 99.1 | 97.3 | 92.1 | 80.4 | 60.1 | 51.9 | 44.0 |
| mean HP entering, mixer | 26.0 | 24.1 | 22.7 | 21.4 | 20.7 | 20.0 | 19.3 | 17.4 |
| mean HP entering, adaptive | 26.0 | 25.9 | 25.6 | 24.8 | 23.7 | 22.2 | 20.7 | 18.9 |
| mean HP entering, habit | 26.0 | 25.5 | 24.8 | 23.7 | 22.6 | 21.6 | 20.2 | 16.1 |
| mean turns, mixer | 5.9 | 6.8 | 7.5 | 7.3 | 7.9 | 8.3 | 7.3 | 5.5 |
| mean turns, adaptive | 3.9 | 4.9 | 6.1 | 6.6 | 7.9 | 8.8 | 7.6 | 5.2 |
| honest stances %, adaptive | 84.0 | 74.5 | 64.8 | 56.6 | 49.9 | 43.1 | 42.3 | 39.0 |
| honest stances %, habit | 84.4 | 79.3 | 73.3 | 67.6 | 60.5 | 49.6 | 42.8 | 36.8 |
| honest stances %, mixer | 94.9 | 89.2 | 82.7 | 77.3 | 70.6 | 62.5 | 58.0 | 52.8 |
| Rival exchange win %, mixer | 32.0 | 31.6 | 31.6 | 31.9 | 31.7 | 31.8 | 31.7 | 31.6 |
| clash %, mixer | 35.7 | 36.9 | 36.7 | 36.8 | 37.1 | 37.2 | 37.2 | 37.1 |
| Rival exchange win %, adaptive | 10.9 | 15.0 | 19.7 | 23.2 | 25.4 | 27.5 | 27.1 | 28.3 |
| Rival exchange win %, habit | 26.8 | 29.2 | 31.7 | 35.0 | 37.9 | 43.7 | 46.7 | 50.6 |

- **Duel length:** mean 7.1 turns for the mixer and 6.4 for the adaptive bot; p50 / p90 / p99 are 6 / 12 / 18 and 5 / 11 / 17.
- **Winning run:** 51 turns for the mixer, 48 for the adaptive bot, 55 for the habit bot.
- **Predictability score** (the Rival's lifetime rating, 0 to 100): guard 100, truster 97, cycle 94, wsls 37, habit 18, adaptive 12, mixer 3, uniform 1.
- **Hits of 7 or more:** 3.5% of duels for the mixer and adaptive bot, 3.2% uniform, 2.6% habit. No hit exceeds a third of max HP. Without phase 2 the rate is 2.6% and 2.4%; phase 2 alone is 15% of its fights, from Embers plus the Called Shot bonus.
- **Ruptures:** 10% of mixer duels contain one; none lock.

## 4. Targets not met

| Target | Result | Why |
|---|---|---|
| 7+ hits in 3% of duels or fewer | 3.5% (mixer, adaptive) | Phase 2. The remaining lever is `CALLED_BONUS` (2 to 1) in `combat.js`, which I did not touch. A cap of 7 would not change the count. |
| combo 1 under 3% | 23% (mixer), 14% (adaptive) | The four-boon Rival build still stacks to 8 under a cap of 8. Only a cap of 6 fixes it, and that makes Deathblow Creed dead again. |
| winning run 60-100 turns | 48 to 55 | Eight fights at 6 to 7 turns. One more Rival HP per duel would get there but takes the mixer under 30%. |
| habit bot bleeds out by duels 3-5 | mostly duels 5-7 | It still clears under 10%, and the bucket trend is now right (16% in runs 1-10, 9 to 10% after). |
| honesty 50% or less in duels 6-7 | adaptive 43 / 42, habit 50 / 43, mixer 62 / 58 | Met for players who react to stances. A player who ignores them never drives honesty down. |
| combo 8 uplift 12 or less | +12.3 | On the line (one standard error is about 2.5). It was +18.3 with the 5 HP Rival. |

## 5. Boons

Conditional uplift is the run win rate of runs that took the boon at a bonfire minus that of runs that reached the same bonfire and took something else. Entries have 200 to 1,100 picks; one standard error is 2 to 3 points.

**Player boons**

| | mixer | adaptive |
|---|---|---|
| Strongest | mirror_etiquette +10.1, ash_veil +8.7, spite +3.8 | keyhole +10.4, serrated_edge +5.6, paper_cuts +5.0 |
| Weakest | turtle_cracker -7.6, resonance -7.6, ash_of_forgetting -6.0, deathblow_creed -5.4 | long_con -7.7, resonance -7.6, turtle_cracker -7.4 |

Nothing exceeds +12. Ember Hoard is a real pick again (+2.0 for the mixer). Deathblow Creed deals its full +2 under the cap of 8 but is still a weak pick (-5.4 mixer, -1.6 adaptive), because wins at 3 pips are rare.

**Rival boons, effect on the player's win rate**

| | mixer | adaptive |
|---|---|---|
| Worst for the player | sealing_wax -9.0, mourning_veil -6.4, mirror_etiquette -5.4 | mirror_etiquette -7.9, sealing_wax -7.3, serrated_edge -6.5 |
| Wasted Rival picks | salt_the_wound +6.9, vampires_curtsy +6.0, resonance +4.8 | spare_mask +8.5, salt_the_wound +8.5, hungry_mask +6.2 |

Nothing costs more than 12. `sealing_wax` is under the line now, so I did not trim it.

**Relics** (run win rate when carried): mixer ashen_flask 40%, dented_buckler 37%, rusty_nail 35%, cracked_mirror 30%, liars_coin 27%, dealers_thumb 22%. Adaptive liars_coin 56%, rusty_nail 56%, dented_buckler 54%, cracked_mirror 49%, ashen_flask 45%, dealers_thumb 36%. Dealer's Thumb is the weak one for both.

**Dangerous combos (DESIGN §8), all unlocks, combo held from duel 1 unless stated**

| # | Combo | Result | Target |
|---|---|---|---|
| 1 | Rival coiled_riposte + first_blood + deathblow_creed + resonance | 7+ hits in 23% of duels (mixer), 14% (adaptive); max hit 8. Run win 34 to 19%, 57 to 43% | under 3%: **not met** |
| 2 | guard bot with stone_patience + thorned_guard + ash_veil + mirror_etiquette | 0.0% run win, reaches duel 3.1 | still loses: met |
| 3 | vampires_curtsy + paper_cuts + carrion_comfort + salt_the_wound | heal per duel mean 0.78, p95 2, never above 5. Run win 34 to 44%, 57 to 69% | 5 or less: met |
| 4 | long_con + debt_collector + turtle_cracker | net swing per guard break 1.93 (mixer), 2.46 (adaptive) | 4 or less: met |
| 5 | Rival no_encores + sealing_wax | player mean legal moves 2.59 (mixer), 2.67 (adaptive). Run win 34 to 11%, 57 to 32% | 2.4 or more: met |
| 6 | Rival hungry_mask + mourning_veil + spare_mask | duel length p99 20, max 28 | p99 25 or less: met |
| 7 | coin_of_fools + broken_pattern + three_faces | coin turn edge +0.65 damage for the uniform bot | 1.2 or less: met |
| 8 | adaptive drafts keyhole, truth_candle, ash_of_forgetting at bonfires 1-3 | 68.8% vs 56.6%, +12.3 points | 12 or less: on the line |
| 9 | mirror_etiquette + resonance | healed 0.38 per duel, Rupture damage 0.31 per duel | see note |

- **Combo 5** passes its stated target but costs the player more than half their win rate. It needs two specific Rival-only boons.
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
2. **Phase 2.** It is the hardest fight (77% for a neutral player) and where the big hits live: 15% of phase-2 fights contain a hit of 7 or 8. Check whether that reads as a finale or as unfair.
3. **Early stances.** Duels 1 to 3 are 84, 75 and 65% honest for a player who trusts about two times in three. Check that the tutorial's lesson holds and that the first lies feel earned.

Also worth a look: Rupture without the seal (four clashes in a row), Sealing Wax with No Encores in the Rival's hands, and whether Deathblow Creed is worth a rare slot.

## 8. Follow-ups outside this pass

- `DESIGN.md` §4, §5, §8 and §12 still describe the old Rupture rule, HP table, heal and boon numbers. I did not edit it.
- `index.html` was not rebuilt; run `node tools/build.js`.
- The layout spec has "9/12"-style numerals and an HP bar with a notch per HP; I have not looked at either at 26.

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

## 9. About the sim

- `node tools/sim.js [--runs N] [--seeds K] [--seed S] [--bot a,b] [--quick] [--unlocks natural|all] [--no-combos] [--no-boons] [--set key=value] [--label text] [--trace]`. About 100 to 150 runs per second per worker, 1,300 per second on 11 workers.
- `--set` overrides constants for a sweep without editing files, for example `--set maxhp=24 --set heal=7 --set hp=6,7,8,8,9,10,9 --set K.TAU_BASE=1.5`. `--label` appends the headline to `tools/out/balance_log.md`.
- Bots are never handed the sealed commit. Info boons reach them only through the values the scene draws. The mixer and uniform bots use only the Coin of Fools; the adaptive bot uses every active.
- The tutorial is skipped, runs are spaced 10 minutes apart, and unlocks arrive naturally unless `--unlocks all`.
- Bot relic choice is a fixed favourite with 15% exploration. Draft choice is a soft preference by move share (simple bots) or by tag synergy and counter-drafting the Rival's pick (adaptive).
- The adaptive bot was checked for sensitivity in the previous round: changing its best-response share, temperature or memory weighting moved it by about 4 points.
