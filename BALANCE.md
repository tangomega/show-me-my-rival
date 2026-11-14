# SHOW ME MY RIVAL — balance pass

Measured with `tools/sim.js`, which plays the real `rng`, `brain`, `boons`, `combat` and `run` modules in the game's own call order. Each bot plays chains of 400 sequential runs against one persistent brain and meta. The tables below are 8 chains per bot (3,200 runs), seed 1.

Reproduce: `node tools/sim.js --rupture-fix --seeds 8` (about 30 s). Raw output of the final runs is in `tools/out/final_*.txt`; every tuning step is logged in `tools/out/balance_log.md`.

## 1. Read this first

**1. The Rupture rule soft-locks the duel. It is a rules bug, not a balance number, and I did not change it.**
A clash at 3 pips seals the clashed move for both fighters. In any two-move game that is left, one move dominates (Guard in Strike/Guard, Strike in Strike/Feint, Feint in Guard/Feint). The Rival always takes it, so the player's only non-losing reply is the same move, which clashes again and seals the next move. The loop G, S, F, G, S, F drains both fighters to 1 HP and then never ends. The player can only leave it by picking the dominated move and taking a 5 to 6 damage hit (death at low HP).

- With the starting numbers, 8.2% of the equilibrium mixer's duels and 5.0% of the adaptive bot's duels ended in this loop. With the final numbers it is 5.6% and 2.9%.
- Proposed fix (one rule, two lines in `combat.js`): Rupture no longer seals. A clash at 3 pips deals 1 to both, never lethal, and tension stays at 3. The three-move game has no dominant move, so the loop cannot form.
- The sim has `--rupture-fix`, a shim that applies exactly that after `R.Combat.resolve` and touches no source file. **All tuning below assumes the fix.** Section 3 also gives the numbers under the rules as shipped.
- In the sim, a bot stuck for 9 straight clashes at 3 pips presses a random legal move, as a person would.

**2. The mixer target cannot be met with a Rival that ramps.** The player has 12 HP and a Rival hit averages about 3, so the player has about four "lives" per duel. A player who wins exactly half the decisive exchanges loses a duel 6% of the time against a one-hit Rival, 19% against a two-hit Rival and 34% against a three-hit Rival. Eight fights in a row at a 30 to 45% clear rate need about 88% per fight, so every Rival has to die in about two hits. Bonfire healing does not help: survivors already enter every duel at 11.8 HP, and runs end by losing one duel from full health.

Following the stated priority (mixer first, shape targets last), the committed table is a flat 5 HP Rival. Measured frontier, same curves and brain constants, Rupture fix on:

| Rival HP d1..d7 / phase 2 | mixer | adaptive | uniform | habit | mean turns per duel |
|---|---|---|---|---|---|
| 6,7,8,8,9,10,9 / 8 (starting table) | 7.4% | 19.3% | 3.6% | 1.0% | 5.9 |
| 5,5,6,6,7,7,6 / 6 | 17.3% | 39.1% | 12.3% | 5.1% | 4.8 |
| 5,5,5,6,6,6,6 / 5 | 24.4% | 42.5% | 16.6% | 7.5% | 4.6 |
| **5,5,5,5,5,5,5 / 4 (committed)** | **29.3%** | **51.3%** | **20.9%** | **10.7%** | **4.3** |

Duel 1 cannot go below 5: the scripted tutorial deals 4 damage on turns 1 and 2, and `seenTutorial` is only set on turn 3, so a 4 HP Rival would die before the lesson and the tutorial would repeat every run. If the lead prefers a Rival that feels like a boss over the mixer target, the second or third row is one edit to `RIVAL_HP` / `PHASE2_HP`. The real lever for both goals at once is outside this pass: more player HP, or smaller base damage.

## 2. Final constants

`src/game/run.js`, BALANCE CONSTANTS block:

| Constant | Start | Final |
|---|---|---|
| `RIVAL_HP` (duels 1..7) | 6,7,8,8,9,10,9 | 5,5,5,5,5,5,5 |
| `PHASE2_HP` | 8 | 4 |
| `HEAL` | 5 | 8 |
| `PHASE2_HEAL` | 2 | 8 |
| `EXPLOIT` | .15,.30,.45,.55,.65,.75,.90 | .30,.50,.65,.75,.85,.95,1.00 |
| `PHASE2_EXPLOIT` | 1.00 | 1.00 |
| `HONESTY` | .92,.85,.75,.65,.55,.50,.42 | .97,.90,.82,.74,.64,.50,.42 |
| `PHASE2_HONESTY` | 0.35 | 0.35 |

`src/ai/brain.js`, `R.Brain.K`: `TAU_BASE` 1.5 to 1.2, `TAU_SLOPE` 1.2 to 0.9, `H_TRUST_UP_LATE` 1.0 to 0.75. `H_MIRROR_LATE` stays 0.7. The `tau()` display helper in `run.js` was updated to match.

`src/game/combat.js`: `HIT_CAP` 8 to 6.

`src/game/boons.js`: no change. No boon crossed the 12 point line consistently (section 5).

Why each one moved:

- **Rival HP, phase-2 HP:** section 1, point 2.
- **Heal 8 / 8:** with a 5 HP Rival the mixer measured 26.0% at heal 6/4, 28.1% at 7/6 and 30.4% at 8/8 (12 chains each). Heal 9/12 added nothing.
- **Exploit up:** it costs the mixer nothing (the Rival cannot gain on equilibrium play) and is the only thing holding predictable bots down once the Rival has 5 HP.
- **Honesty up in duels 1 to 5:** this is where the adaptive bot's edge over the mixer comes from. Duels 6, 7 and phase 2 are unchanged.
- **`H_TRUST_UP_LATE` 0.75:** at 1.0 a player who trusted sensibly was shown only 67% honest stances in duel 1 after a few runs, so the tutorial's lesson was false. At 0.65 the brain benchmark "truster collapses" failed; 0.75 passes it.
- **Tau curve:** tau at exploit 1.0 is still 0.30 (lower made the Rival gain on a uniform player and failed a benchmark); it is sharper in duels 1 to 6. The effect on the habit bot is small (about 12% to 11%).
- **Hit cap 6:** removes every 7+ hit and trims the swing that kills a 12 HP player.

Both test suites pass: `test_brain.js` 106 of 106, `test_combat.js` 6,651 assertions. In `test_combat.js` I updated the constant assertions, the hit-cap expectations (8 to 6, overkill 5 to 7, Deathblow Creed 8 to 6) and three heal expectations that assumed the heal fits under max HP.

## 3. Results (Rupture fix on, natural unlock order)

| Bot | Target | All runs | Runs 1-10 | 11-50 | 51-200 | 201+ | Mean duel reached | Predictability | Rules as shipped |
|---|---|---|---|---|---|---|---|---|---|
| guard | 0.5% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 1.83 | 100 | 0.0% |
| cycle | 2% or less | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 1.92 | 86 | 0.0% |
| wsls | 6% or less | 0.7% | 0.0 | 0.0 | 0.8 | 0.8 | 2.66 | 30 | 0.5% |
| truster | 20% early, 5% late | 0.0% | 0.0 | 0.0 | 0.0 | 0.0 | 3.44 | 99 | 0.0% |
| habit | 10% or less after run 50 | 10.7% | 11.3 | 10.6 | 10.7 | 10.8 | 5.38 | 17 | 9.1% |
| uniform | 15-35% | 20.9% | 20.0 | 21.9 | 20.5 | 21.0 | 4.76 | 0 | 18.7% |
| mixer | 30-45% | 29.3% | 23.8 | 30.6 | 30.2 | 28.8 | 5.20 | 2 | 19.6% |
| adaptive | 50-65% | 51.3% | 51.3 | 49.4 | 50.3 | 52.6 | 6.92 | 15 | 39.9% |

"Mean duel reached" counts phase 2 as 8. "Predictability" is the Rival's lifetime score for the bot (0 to 100). One standard error is about 0.8 points for the mixer and 0.9 for the adaptive bot. With every unlock open from run 1 the picture is the same (mixer 29.6%, adaptive 52.3%, habit 11.0%).

Per duel:

| | d1 | d2 | d3 | d4 | d5 | d6 | d7 | P2 |
|---|---|---|---|---|---|---|---|---|
| mixer duel win % | 88.8 | 87.5 | 85.9 | 86.3 | 86.9 | 83.9 | 86.8 | 80.3 |
| adaptive duel win % | 99.9 | 99.3 | 96.7 | 92.6 | 89.1 | 87.1 | 87.7 | 84.9 |
| uniform duel win % | 87.0 | 84.7 | 82.2 | 83.2 | 82.4 | 83.6 | 80.9 | 74.2 |
| habit duel win % | 96.1 | 93.4 | 89.4 | 83.5 | 76.5 | 65.5 | 60.0 | 53.3 |
| honest stances %, adaptive | 81.7 | 74.0 | 63.9 | 55.3 | 47.5 | 39.2 | 37.0 | 34.5 |
| honest stances %, habit | 84.8 | 79.5 | 72.9 | 66.4 | 60.1 | 48.4 | 42.0 | 35.0 |
| honest stances %, mixer | 94.7 | 88.9 | 82.4 | 78.0 | 70.2 | 61.6 | 57.0 | 51.6 |
| Rival exchange win %, mixer | 32.2 | 32.4 | 33.0 | 31.9 | 31.8 | 34.1 | 31.5 | 31.3 |
| clash %, mixer | 35.7 | 35.7 | 35.6 | 35.7 | 35.4 | 35.6 | 36.8 | 37.0 |
| Rival exchange win %, adaptive | 11.0 | 13.7 | 18.5 | 22.5 | 24.1 | 24.5 | 24.1 | 26.0 |
| mean turns, mixer | 4.69 | 4.49 | 4.37 | 4.16 | 4.03 | 4.08 | 3.90 | 3.65 |
| mean HP entering, mixer | 12.0 | 11.8 | 11.8 | 11.8 | 11.9 | 11.9 | 11.8 | 11.8 |

Duel length p50 / p90 / p99: mixer 4 / 8 / 11, adaptive 3 / 7 / 10. A winning run is 29 turns for the mixer and 28 for the adaptive bot. Under the shipped rules the mixer's p99 is 15.

Hits of 7 or more on the player: 2.4 to 3.0% of duels at the start in normal play (33.8% with the four-boon combo in the Rival's hands), 0% now (the cap makes them impossible). Hits of 5 or 6 are 13% of the exchanges the Rival wins against the mixer and 18% against the adaptive bot.

The adaptive bot is not riding one trick. Changing its best-response share from 0.5 to 0.9, its temperature from 0.35 to 1.4, or its memory weighting moved it between 50.3% and 54.0%.

## 4. Targets not met

| Target | Result | Why |
|---|---|---|
| mixer 30-45% | 29.3% (30.4% in a 12-chain run) | On the floor of the band. The next step down in Rival HP breaks the tutorial or drops phase 2 to 3 HP. |
| habit 10% or less after run 50 | 10.7% | A 5 HP Rival loses to anyone some of the time. Lower mid-run honesty fixes it but takes the adaptive bot under 50%, which ranks higher. |
| habit clearly worse late than early | 11.3% then 10.7% | Flat. The Rival learns this bot within the first few duels, so there is no early grace period to lose. |
| mean duel length 5-9 turns | 4.3 | Direct result of the 5 HP Rival. |
| winning run 60-100 turns | 28 to 29 | Same. |
| per-duel win rate declines from duel 1 | flat for the mixer (89 to 84), phase 2 lowest at 80 | Flat HP gives a flat curve. Bots that read stances or have habits do decline. |
| honesty 50% or less in duels 6-7 | adaptive 39 / 37, habit 48 / 42, mixer 62 / 57 | Met for players who react to stances. A player who ignores them never drives honesty down, and the Rival may still pick an honest stance on a "lie" roll. |
| uniform duel 1 win 88% or more | 87.0% | The uniform bot Feints into broken guards. Mixer 88.8%, adaptive 99.9%. |
| combo 8 uplift 12 or less | +18.3 | See section 5. |

## 5. Boons

Conditional uplift is the run win rate of runs that took the boon at a bonfire minus that of runs that reached the same bonfire and took something else. Entries have 200 to 1,100 picks; one standard error is 2 to 3 points.

**Player boons, strongest and weakest**

| | mixer | adaptive |
|---|---|---|
| Strongest | last_candle +9.5, first_blood +7.8, mirror_etiquette +4.1 | keyhole +10.5, truth_candle +7.8, serrated_edge +6.1 |
| Weakest | stolen_ledger -6.6, headsman -6.6, vampires_curtsy -5.8, debt_collector -5.8 | resonance -12.1, broken_pattern -8.4, turtle_cracker -5.9 |

Nothing exceeds +12. No boon number was changed.

**Rival boons, effect on the player's win rate**

| | mixer | adaptive |
|---|---|---|
| Worst for the player | sealing_wax -13.3, mourning_veil -7.8, paper_cuts -5.4 | no_encores -6.1, mourning_veil -5.6, ash_veil -5.1 |
| Wasted Rival picks | painted_smile +7.1, debt_collector +5.5, salt_the_wound +5.3 | hungry_mask +6.7, salt_the_wound +5.7, mirror_etiquette +4.1 |

`sealing_wax` measured -13.3 against the mixer here (203 picks), and -10.0, -6.0 and -2.2 in three earlier sweeps, and -4.3 against the adaptive bot. It is on the line, not clearly over it, so I left it. It is the first boon to trim if it feels oppressive.

**Relics** (run win rate when carried): mixer rusty_nail 31%, dented_buckler 27%, others 13 to 21%. Adaptive rusty_nail 56%, liars_coin 53%, dented_buckler 46%, others 32 to 47%. The gap between a good and a dead relic is 10 to 20 points. Bots pick their best relic 85% of the time. An earlier sweep with random relics had the mixer 6 to 9 points lower, so relic choice is a large part of the result.

**Dangerous combos (DESIGN §8), all unlocks, combo held from duel 1 unless stated**

| # | Combo | Result | Target |
|---|---|---|---|
| 1 | Rival coiled_riposte + first_blood + deathblow_creed + resonance | 7+ hits 0%, max hit 6. Run win falls 27 to 14% (mixer), 51 to 34% (adaptive) | under 3%: met |
| 2 | guard bot with stone_patience + thorned_guard + ash_veil + mirror_etiquette | 0.0% run win, reaches duel 2.6 | still loses: met |
| 3 | vampires_curtsy + paper_cuts + carrion_comfort + salt_the_wound | heal per duel mean 0.32, p95 2, never above 5 | 5 or less: met |
| 4 | long_con + debt_collector + turtle_cracker | net swing per guard break 1.16 (mixer), 2.39 (adaptive) | 4 or less: met |
| 5 | Rival no_encores + sealing_wax | player mean legal moves 2.65 (mixer), 2.75 (adaptive). Run win 27 to 13%, 51 to 32% | 2.4 or more: met |
| 6 | Rival hungry_mask + mourning_veil + spare_mask | duel length p99 13, max 20 | p99 25 or less: met |
| 7 | coin_of_fools + broken_pattern + three_faces | coin turn edge +0.60 damage for the uniform bot | 1.2 or less: met |
| 8 | adaptive drafts keyhole, truth_candle, ash_of_forgetting at bonfires 1-3 | 69.0% vs 50.8%, +18.3 points | 12 or less: **not met** |
| 9 | mirror_etiquette + resonance | healed 0.18 per duel, Rupture damage 0.18 per duel | no net farming: met |

Combo 8 fails because of the short duels: one guaranteed winning turn per duel is about half of what it takes to kill a 5 HP Rival. The charges are already 1 per duel, so there is no number left to trim; it needs a rule change (charges per run) or a tougher Rival.

Combos 1 and 5 pass their stated targets but each halves the player's win rate. They are rare in a real draft (four and two specific boons).

## 6. Side effects of these numbers

- **Deathblow Creed** is nearly dead under a 6 cap. A Strike at 3 pips is already 6, so the +2 adds nothing; on Guard and Feint wins it adds 1. Its card text is still literally true but misleading. Coiled Riposte is capped the same way at 1+ pips.
- **Ember Hoard and Ashen Flask** rarely matter with heal 8: the player arrives at 11.8 HP. Ember Hoard measures -3 to -5 as a pick.
- **`DESIGN.md` §5 and §12** still show the old duel table, heal and cap. I did not edit it.
- **`index.html`** was not rebuilt; run `node tools/build.js` to carry the constants into the build.

## 7. What a playtester should feel-check

1. **Is a 5 HP Rival a duel or a formality?** Two clean hits end every fight and a full clear is under 30 turns. If it feels thin, take the 5,5,6,6,7,7,6 / 6 row and accept a mixer near 17%.
2. **Get into a Rupture on purpose** (four clashes in a row). Under the shipped rule, confirm the loop and how it feels to be forced to take a hit to leave. Then decide on the fix before anything else is tuned.
3. **Duel 1 honesty and the first lie.** With 5 HP the Rival is at 1 HP when the tutorial's lie arrives on turn 3. Check that the lesson still lands, and that stances stay believable in duels 1 to 3 for someone who trusts about two times in three (the sim says 82, 74, 64% honest).

Also worth a look: how a 6 damage hit feels at 12 HP (half the bar, 5 to 8% of the Rival's wins), Keyhole in a three-turn duel, and Sealing Wax or No Encores in the Rival's hands.

## 8. About the sim

- `node tools/sim.js [--runs N] [--seeds K] [--seed S] [--bot a,b] [--quick] [--rupture-fix] [--unlocks natural|all] [--no-combos] [--no-boons] [--set key=value] [--label text] [--trace]`. About 250 runs per second per worker, 1,900 per second on 11 workers.
- `--set` overrides constants for a sweep without editing files, for example `--set hp=5,5,6,6,7,7,6 --set p2hp=6 --set K.TAU_BASE=1.5`. `--label` appends the headline to `tools/out/balance_log.md`.
- Bots are never handed the sealed commit. Info boons reach them only through the same values the scene draws (Keyhole, Candle of Truth, Liar's Tally, Stolen Ledger, Liar's Coin). The mixer and uniform bots use only the Coin of Fools; the adaptive bot uses all of them.
- The tutorial is skipped (`seenTutorial = true`), runs are spaced 10 minutes apart (no away-decay), and unlocks arrive naturally unless `--unlocks all`.
- Bot relic choice is a fixed favourite with 15% exploration. Draft choice is a soft preference by move share (simple bots) or by tag synergy and counter-drafting the Rival's pick (adaptive).
