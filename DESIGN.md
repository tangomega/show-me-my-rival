# SHOW ME MY RIVAL — Design Spec (v1)

Developed by tangoSHELL · 2026. Phone-first, single-file HTML5. This file says *what* the game is; `INTERFACES.md` says how modules talk. Names below (`sealed`, `ctx`, `payoff`, anim/SFX names) follow that contract; anything the contract lacks is tagged **[+IF]** and collected in §18.

## 0. Lead's rulings (these OVERRIDE anything below that disagrees)

1. **Balance targets changed.** The brief says the Rival must beat predictable play and *lose to near-random play over time*. So an unexploitable player must have a real shot, and the HP economy is close to a 1:1 trade, not 1.8:1. New targets (run win rate, all unlocks): always-Guard ≈ 0%; fixed cycle ≤ 2%; naive tell-truster ≤ 15% on run 1 and falling to ≤ 5% by run 10; **equilibrium/uniform mixer that ignores tells: 30–45%**; adaptive tell-reading bot: 50–65%. The §5 bot table is superseded by this.
2. **Starting numbers for the sim:** Rival HP by duel `[6,7,8,8,9,10, 9 then phase-2 8]`, bonfire heal 5, phase-2 heal 2. Exploit and honesty curves stay as in §5. The sim tunes HP and heal first.
3. **Phase 2 has two rules, not three: Embers and Called Shot. Twin Stance is CUT** (no flickering stance, no `p2:` tables, no phantom tell). Phase 2 uses the normal tell layer at honesty base 0.35.
4. **Called Shot plumbing:** on a Called Shot turn the duel scene asks `brain.predict(ctx, legalP)` (tell-independent ensemble) and stores the argmax in `duel.intel.called` *before* `R.Combat.payoff` and `brain.commit`, so the payoff matrix already contains the ±2 / stagger terms. The brain has no Called Shot code.
5. **`R.Combat.payoff` is the complete value matrix:** it includes tension, focus/fortify, boon hooks, the hit cap, guard-break value (±0.86 per turn of break inflicted) and the lethal bonus (±8). The brain uses it as given and adds nothing.
6. **Accepted contract additions:** `duel.intel {called, honest, pred, coin}`, `brain.predict`, `brain.forget(f)`, `brain.beginRun({days})`, `meta.counters`, `meta.memory.favorites`, `offer.choices` of length 3–4, `run.pending` (the sealed commit, saved so a reload cannot reroll it). Taunt shuffle bags are session-only (no `tauntBag` persistence).
7. **Art scope cuts (quality over quantity):**
   - Per-duel arena variants are limited to candle count, palette remap and the altar candle ring. No rain, puddle reflection, wind gusts or crows.
   - Boon cards use one 12×12 icon per archetype tag (8) plus a relic icon, not one icon per boon.
   - Masks are a face overlay on one head part (one variant each), not 5 × 3 head variants.
   - `transform` is at most 10 frames. `rival2` reuses the Rival's poses with part swaps (shattered head, tendril cloak, 3 px hover) and a code-drawn afterimage.
   - The title scene is one large mask sprite plus a candle; the "smile widens" gag is optional.
8. **Skip** is implemented as: a tap during resolution sets `timeScale` to 3 until the next input window.
11. **Balance numbers live in `BALANCE.md` and the constants block of `src/game/run.js`; they supersede every HP, heal, exploit, honesty and boon number in this document.** As shipped: player max HP 26 (a run-long pool), bonfire heal 6, phase-2 heal 4, Rival HP 6,7,8,8,9,10,9 then 7; hit cap 8; **Rupture no longer seals a move** (a clash at 3 pips costs both fighters 1 non-lethal HP and tension stays at 3), because the seal could lock a duel into an endless loop.
10. **The game's title is "Show Me My Rival"** (renamed from the working title "THE RIVAL"). Use "SHOW ME MY RIVAL" for the logo, the HTML `<title>`, the header comment and the README. In-fiction, the opponent is still called "the Rival". The internal `RIVAL` namespace, folder name and save key do not change.
9. The credits roll contains only in-fiction lines, the player's lifetime stats and "Developed by tangoSHELL · 2026". No other names, roles or studios.

## 1. Pillars

1. **It knows you.** One enemy, forever. Its model of the player persists across all runs and is quoted back in taunts and the Dossier. Every system feeds or reads that model.
2. **Fair mind-game.** Three moves, sealed simultaneous choice, the Rival commits first and never sees input. Every Rival advantage (boons, phase rules, guard break) is visible before the player picks.
3. **Read the stance, never trust it.** The tell is the skill axis: honest early, lying later, and it lies *more* the more you trust it.
4. **Options, not stat bloat.** Boons change which move is good when; none is flat +HP/+damage.
5. **Melancholy with a smirk.** Ruined cathedral, ash, candlelight, "YOU DIED" — and a nemesis who is funnier than you. PG-13, never cruel about the real person, only about their play.
6. **Thumb-fast.** A turn resolves in 2.5–3.5 s, a duel in ~1 min, a full clear in 9–12 min; always resumable at turn granularity.

## 2. Screen flow

| Scene | Enters from | Content | Exits to |
|---|---|---|---|
| `title` | boot, death, victory, credits | Mask in ash, logo, "TAP TO BEGIN" (or CONTINUE if `hasRun()`), buttons DOSSIER · UNLOCKS · SETTINGS, credit line, "It remembers {runs} of you." (runs ≥ 1) | `relic` if ≥1 relic unlocked, else `duel` |
| `relic` | title | Unlocked relics as cards + "NONE"; tap = select, CONFIRM | `duel` (duel 1) |
| `duel` | relic, bonfire, resume | Intro bubble → turns → end | `bonfire` (duels 1–6 won), phase 2 (duel 7 phase 1 won, same scene), `victory`, `death` |
| `bonfire` | duel won | (1) heal anim, (2) Rival drafts — card shown + bubble, (3) player picks 1 of 3 (4 with Dealer's Thumb): tap card = detail panel, CONFIRM; DOSSIER button; boon list | next `duel` |
| `dossier` | title, bonfire | The Rival's notebook: predictability gauge, stat lines (§7), lifetime record, most-broken habit | back |
| `death` | duel lost | "YOU DIED" → parting line → 2–3 "what I learned" lines (`runInsights()`) → unlock cards → TAP | `title` |
| `victory` | phase 2 won | Rival's defeat line, run summary (turns, predictability, finishing move), unlocks | `credits` (first win) else `title` |
| `credits` | first win (replay from settings) | 35 s roll over dawn cathedral: title, "Developed by tangoSHELL · 2026", the Rival's footnotes heckling each credit, lifetime stats | `title` |
| `settings` | title, pause icon in duel/bonfire | Mute, Haptics, Mask (unlocked), Arena (unlocked), Replay credits (if seen), RESET SAVE (two-step: "ERASE EVERYTHING? It will forget you." hold 1.5 s to confirm) | back |
| `unlocks` | title | Grid of 28 items; locked ones show the condition text | back |

Save/resume: `R.Game.save()` after every resolved exchange, after `brain.commit` (the sealed move/tell and `rngState` are stored so a reload cannot reroll the Rival's choice), after each bonfire step, and on `visibilitychange`. Resume re-enters at: start of the pending turn (sealed already committed), or the exact bonfire step.

## 3. Layout (180 × 320 baseline, internal px; add `E.safe.top` to all y)

| Zone / element | Rect x,y,w,h | Notes |
|---|---|---|
| **HUD** | 0,0,180,34 | palette 2 strip with 1 px line (5) at y33 |
| Player HP bar / Rival HP bar | 4,4,72,7 / 104,4,72,7 | Rival bar drains toward the centre; lag bar behind |
| HP numerals | 4,13 left / 176,13 right-aligned | "9/12" in bone (10) |
| Duel pips | 77,6,27,3 | 7 pips 3×3, gap 1: won = amber 21, current = blinking 10, future = 5; pip 7 is red 18 |
| Tension pips | 76,14,27,7 | 3 diamonds 7×7, gap 3; lit = flame 21/22 with 2-frame flicker |
| Boon ledger button | 83,23,14,10 | opens overlay listing both fighters' boons with text (always visible, turn-safe) |
| Status icons | player 4,24 → right; Rival 168,24 → left | 8×8 each, max 4 per side, remaining turns as a tiny digit |
| **Arena** | 0,34,180,170 | floor line y=172; background authored 180×210 (extra rows revealed at top) |
| Player frame / Rival frame | 20,124,48,48 / 112,124,48,48 | feet centre (44,172) / (136,172); phase 2 Rival box 48×56 at 112,116 |
| Rival sigil / player sigil / called-shot rune | 128,102,16,16 / 36,104,16,16 / 36,86,16,16 | sigils bob ±1 px, 1.2 s |
| **Speech band** | 0,204,180,34 | bubble max 4,205,172,32; tail tip (136,203) pointing up at the Rival |
| **Active row** | 0,238,180,24 | slots 4,239,22,22 · 30,239,22,22 · 56,239,22,22; hint text 84,239,92,22 ("GUARD BROKEN", "DEATHBLOW", "SEALED") |
| **Buttons** STRIKE / GUARD / FEINT | 4,262,56,52 / 62,262,56,52 / 120,262,56,52 | icon 20×20 on top, label below, 6×6 "beats" mini-icon in corner |
| Bottom pad | 0,314,180,6 | plus `E.safe.bottom` |

Stretch (E = H − 320, 0..80): arena height += min(E,40) (rows added at the top; fighters, floor and sigils stay anchored to the arena bottom); button height += clamp(E−40, 0, 24); the rest (≤16) goes to the bottom pad. Everything below the arena shifts down. H = clamp(floor(180·vh/vw), 320, 400); scale = largest integer fitting both axes; letterbox colour 1.

## 4. Combat rules & math

**Turn order:** (1) `beginTurn`: Rival bleed tick, then player bleed tick (Rival first = ties favour the player), status timers, `turnStart` hooks; (2) `brain.commit` → sigil seals; (3) tell shown, legal buttons enable, actives usable; (4) player locks in; (5) reveal → `resolve` → `brain.observe` → taunt → save.

| Rival ↓ / Player → | S | G | F |
|---|---|---|---|
| **S** | Bind (clash) | player ripostes: Rival −2 | Rival wins: player −3 |
| **G** | Rival ripostes: player −2 | Standoff (clash) | player wins: Rival −2, Rival `guardBroken` |
| **F** | player wins: Rival −3 | Rival wins: player −2, player `guardBroken` | Masquerade (clash) |

**Damage pipeline (winner → loser):** base (3/2/2) → winner's `outDamage` hooks (acquisition order) → + tension pips, tension := 0 (phase 2: := 1) → + winner's `focus` (consumed) → loser's `inDamage` hooks → − loser's `fortify` (consumed up to its value) → clamp to [0, **8**] (hit cap, shows "OVERKILL" if clipped) → apply → `onLethal` if hp ≤ 0 → statuses (guard break applies even if damage was reduced to 0) → `afterExchange` hooks, winner first (hooks may add/remove statuses).

**Clash = Tension.** Same move: no damage, +1 pip (max 3). Mirror flavours: **Bind** (S-S: blades lock, sparks at centre), **Standoff** (G-G: both circle half a step, cloaks sway), **Masquerade** (F-F: both flourish and miss; the Rival laughs). At 3 pips the duel is in **Deathblow** state (presentation only, §14).
**Rupture (the 3-pip twist, one sentence):** a clash at 3 pips deals 1 damage to both fighters (never lethal: cannot drop below 1 HP), seals that move for both next turn, and tension stays at 3.

| Status | Effect | Timing |
|---|---|---|
| `guardBroken` n | Guard is illegal | applied on turn t, covers turns t+1..t+n (n=1 unless Long Con) |
| `bleed` n | 1 damage at each of the next n turn starts (ignores fortify/tension; can kill) | re-applying sets n = max(current, new) |
| `fortify` n | next damage taken from an exchange −n | consumed by the next hit, cap 3 |
| `focus` n | next exchange you win deals +n | consumed on win, cap 3 |
| `sealed:<m>` n | move m is illegal | same timing as guardBroken |

Legal-move rule: a fighter always has ≥ 2 legal moves; if a new seal would leave fewer, that seal is not applied (guardBroken has priority over seals). The Rival's statuses are always shown; its stance can never show an illegal move.

**Hook contract (who/when):**

| Hook | Fires | Typical use |
|---|---|---|
| `duelStart` | `newDuel`, after HP set | starting statuses, counter reset |
| `turnStart` | `beginTurn`, after bleed | passive info events, periodic effects |
| `outDamage` → number | my win, before tension | conditional damage (reads `x.my`, `x.their`, `x.tension`, `x.self.moves/results`, `x.foe.status`, `x.duel.intel`) |
| `inDamage` → number | my loss, after focus | mitigation |
| `afterExchange` | every exchange (won/lost/clash flags) | heal, statuses, counters |
| `onClash` | clash only, before pip is added | pip count, clash rewards |
| `onLethal` | hp would reach ≤ 0 | survive once |
| `onRest` | bonfire heal step (player only) | heal modifiers, brain events |
| `onDraft` | building the offer (player only) | offer size |
| `active` | tap during step 3 | info / self-modifier; never alters the already-sealed Rival move |

**[+IF] `duel.intel`** (plain JSON set by the duel scene from `sealed` right before `resolve`): `{ honest:bool, pred:{S,G,F}, called:move|null, coin:bool }`. Needed by 4 boons and Called Shot; no signature changes.

## 5. Duel table & balance targets

| Duel | Name | Rival HP | exploit e | honesty base | τ = 1.5−1.2e | Rival boons | Arena variant (`bg opts.variant`) |
|---|---|---|---|---|---|---|---|
| 1 | The Nave | 7 | 0.15 | 0.92 | 1.32 | 0 | dusk through the rose window, 6 candles, light ash |
| 2 | Vespers | 8 | 0.30 | 0.85 | 1.14 | 1 | night, moonbeam shaft, 6 candles |
| 3 | The Leak | 9 | 0.45 | 0.75 | 0.96 | 2 | rain through the roof: drip particles, floor puddle reflection row |
| 4 | Draught | 10 | 0.55 | 0.65 | 0.84 | 3 | 4 candles, wind gusts every ~6 s (cloaks + flames lean) |
| 5 | The Wake | 11 | 0.65 | 0.55 | 0.72 | 4 | crows on the beams (3 silhouettes; scatter on any hit ≥ 4) |
| 6 | Blood Moon | 12 | 0.75 | 0.50 | 0.60 | 5 | window tint remap 26→16, 27→17, 28→19; 3 candles |
| 7 | The Altar | 10 | 0.90 | 0.42 | 0.42 | 6 | altar end: broken statue, ring of 12 candles |
| 7b | The Unmasked | 9 | 1.00 | 0.35 | 0.30 | 6 | candles turn witchfire (remap 20→27, 21→31, 22→31, 23→10) |

Player: max HP 12, HP persists; bonfire heals 4 (cap at max); phase-2 transition heals 2 (`PHASE2_HEAL`). First-ever duel uses the same row (HP 7) with turns 1–3 scripted (§17).

**HP economy (why the edges matter):** Rival HP totals 76; the player's budget is 12 + 6×4 = 36 plus boon sustain (~4–8). A full clear needs roughly a 1.8:1 damage trade over the run. Sources of edge: honest tells in duels 1–4, boons (player picks with knowledge of the Rival's pick), guard-break tempo, and out-levelling the model late.

| Bot (sim, 10k runs each, all unlocks unless noted) | Run win-rate target | Secondary target |
|---|---|---|
| Uniform random, ignores tells | ≤ 2% | mean duel reached 2.5–3.5 |
| Always Guard | 0% (≤ 0.1%) | dies by duel 2 in ≥ 90% of runs after 3 runs of history |
| Fixed cycle S→G→F | ≤ 0.5% | wins duel 1 ≤ 60% once the model has 30 turns of it |
| Equilibrium mix, ignores tells | ≤ 6% | sanity: the Rival's edge vs this bot comes only from HP budget + boons |
| Naive tell-truster (always COUNTER) | 6–12% on run 1; ≤ 2% by run 10 | wins duel 1 ≥ 85% on run 1 |
| Adaptive human-like (calibrated trust, mixes, avoids its own flagged habits, drafts by tag) | 25–35% (8–15% with no unlocks) | duel 1 win ≥ 95%; median death duel 4–5; 7–11 turns per duel |

Tuning levers, in order: honesty base (duels 3–6) → Rival HP duels 5–7 → bonfire heal → exploit curve → hit cap.

## 6. Rival AI (`ai/brain.js`)

**6.1 Experts.** Each expert maps a context key → decayed counts `[S,G,F]`. Prediction for expert i: `p_i(m) = (c[m] + 0.5) / (Σc + 1.5)`, then restricted to `legalP` and renormalised. On `observe`: for each expert with a defined key, `c[key] *= λ_i; c[key][pm] += 1`; a parallel raw integer table `life[key]` (no decay) feeds the Dossier.

| # | Expert | Key (from `ctx`) | Keys | λ |
|---|---|---|---|---|
| E0 | global | `""` | 1 | 0.93 |
| E1 | prev move | `prev1` | 3 | 0.90 |
| E2 | prev two | `prev2+prev1` | 9 | 0.85 |
| E3 | last outcome | `last` (W/L/C) | 3 | 0.90 |
| E4 | outcome × prev | `last+prev1` | 9 | 0.85 |
| E5 | low HP | `pHp ≤ ceil(pMaxHp/3)` | 2 | 0.90 |
| E6 | opening | `turn==1` only (abstains otherwise) | 1 | 0.80 |
| E7 | Rival's prev move | `prevR` (copy/counter it?) | 3 | 0.90 |
| E8 | tension | `tension` 0..3 | 4 | 0.88 |
| E9 | guard state | `pBroken`,`rBroken` → none/self/foe/both | 4 | 0.88 |
| T0 | tell response | `""` → counts over [COUNTER, MIRROR, UNDER] | 1 | 0.92 |
| T1 | response by stance | shown tell | 3 | 0.88 |
| T2 | response after last tell result | `burned` (lost on a lie) / `paid` (countered an honest tell and won) / `other` | 3 | 0.88 |

Tell experts predict a response category relative to a candidate tell t and convert it to a move: COUNTER = `LOSES_TO[t]` (what beats t), MIRROR = t, UNDER = `BEATS[t]` (what t beats). Phase 2 uses separate tables with key prefix `p2:` (see §12). An expert abstains when its key is undefined (turn 1/2) or the key's Σc < 0.5.

**6.2 Mixing (Hedge with decay).** Weights start at 1/13. After each observed turn, for every non-abstaining expert: `loss = 1 − p_i(pm | tell shown)`; `w_i = max(0.02, w_i^0.96 · exp(−1.5·loss))`; renormalise. Ensemble: `P(m | ctx, t) = Σ w_i p_i(m|t) / Σ w_i` over active experts. Habit-break speed: E0 half-life ≈ 9.5 turns, 3-key experts ≈ 20 turns of play; with Hedge shifting weight a dropped habit loses >70% of its predicted mass in 15–25 turns.
`confidence = clamp((p_max − 1/n)/(1 − 1/n), 0, 1) · min(1, lifetimeTurns/20)`, n = |legalP|.
`beginRun`: all decayed counts × 0.90 (× 0.75 if ≥ 7 days away **[+IF]** pass `days`), `w_i := w_i^0.5` renormalised. Raw `life` tables never decay.

**6.3 Tell shapes.** A stance shows one move t; the Rival actually plays r.

| Shape | r | Player COUNTERs | Player MIRRORs | Player goes UNDER |
|---|---|---|---|---|
| Honest | t | player wins | clash | Rival wins |
| Trap | `BEATS[t]` (the move t beats) | Rival wins | player wins | clash |
| Double-bluff | `LOSES_TO[t]` (the move that beats t) | clash | Rival wins | player wins |

Traps alone would make MIRROR risk-free (win or clash), so lies must be drawn from both shapes; the tell layer is itself a rock-paper-scissors over {COUNTER, MIRROR, UNDER}. `trustRate` = smoothed COUNTER share of T0.

**6.4 Baseline (near-equilibrium) mix.** Zero-sum values S>F = a = 3, G>S = b = 2, F>G = c = 2. Generalised-RPS equilibrium plays each move in proportion to the payoff of the matchup it is *not* in: S:G:F = c:a:b = **2/7 : 3/7 : 2/7** (28.6 / 42.9 / 28.6%), value 0. Guard break is worth extra: in the broken sub-game the unbroken side plays S 4/7, G 3/7 (F is dominated), the broken side S 5/7, F 2/7, value **6/7 ≈ 0.86** to the unbroken side. With c = 2.86: **S 36.4%, G 38.2%, F 25.5%** (20:21:14) — the default opening mix. At tension T add T to a, b, c (T=3: 34.7 / 35.6 / 29.7). Because boons make the matrix non-antisymmetric, `brain` solves the supplied matrix numerically: regret matching, 300 iterations over `legalR × legalP`, cached by matrix hash → `eqR`, `eqP`.

**6.5 Decision (`commit(q)`).**
```
V[r][p]  = q.payoff[r][p] + 0.86·(r=='F'&&p=='G') − 0.86·(r=='G'&&p=='F')   // only if payoff omits break value
           clamp lethal: +8 if exchange kills the player, −8 if it kills the Rival
eqR,eqP  = solve(V)
h        = clamp(q.honestyBase − 0.45·(trustRate − 1/3), 0.15, 0.97)
for each legal tell t:  pred[t] = conf·P(·|ctx,t) + (1−conf)·eqP
honest   = rng.chance(h)
if !rng.chance(q.exploit):                       // mode 'mix'
    r = sample(eqR);  t = honest ? r : rng.pick([BEATS-shape tell, LOSES_TO-shape tell] that are legal)
else:                                            // mode 'exploit'
    pairs = honest ? {(r,t): t==r} : all legal (r,t)
    EV(r,t) = Σ_p pred[t][p]·V[r][p]
    choose (r,t) with probability ∝ eqR[r] · exp(EV(r,t)/τ),  τ = 1.5 − 1.2·q.exploit
return sealed{ move:r, tell:t, honest:(t==r), pred:pred[t], top:argmax, confidence:conf, mode }
```
Tells are restricted to moves the Rival can legally make. The `eqR` prior means "no information" degrades to equilibrium play, not to uniform. Note: the non-honest branch may still pick an honest pair, so realised honesty ≥ h; the sim must log realised honesty per duel. `force` (tutorial) bypasses everything. `commit` receives nothing derived from the current input; a unit test asserts identical `sealed` for all three player moves under the same `rngState`.

**6.6 Signals.** `pAct = sealed.pred[pm]`. **Surprised:** pAct < 0.20. **Read:** pAct > 0.60 and the Rival won the exchange. **Lie worked / lie caught:** `!honest` and Rival won / player won. Per-run counters `reads`, `surprises`, `liesCaught` feed taunts, unlocks and the run summary.

## 7. Dossier stats

`pct` and `n` come from raw `life` tables (turns with a forced/illegal option are excluded unless the stat is about that state). Shown when n ≥ min; mocked (taunt-eligible, `strength > 0`) when pct ≥ skew. `strength = clamp((pct − skew)/(100 − skew), 0, 1) · min(1, n/(2·min))`.

| id | kind | Definition (pct = share of the top move unless stated) | min n | skew | Line shape |
|---|---|---|---|---|---|
| `fav_move` | habit | E0 global share | 20 | ≥ 45% | "You {moveLower} {pct}% of the time." |
| `opening` | habit | E6: first move of a duel | 5 duels | ≥ 60% | "You open with {move} {pct}% of duels." |
| `after_loss` | habit | E3 key L | 12 | ≥ 55% | "After taking a hit you {moveLower} {pct}%." |
| `after_win` | habit | E3 key W | 12 | ≥ 55% | "After landing one you {moveLower} {pct}%." |
| `repeat` | habit | E1 diagonal: P(move = prev move) | 20 | ≥ 50% or ≤ 12% | "You repeat yourself {pct}%." / "You never repeat. That is also a pattern." |
| `two_step` | habit | E1: strongest prev → next pair | 8 on that key | ≥ 60% | "{prevMove}, then {move}. {pct}% of the time." |
| `loop3` | habit | E2: strongest (a,b) → c | 6 on that key | ≥ 70% | "{a}, {b}, {move}. Your little waltz." |
| `low_hp` | habit | E5 key low | 10 | ≥ 55% | "Near death you {moveLower} {pct}%." |
| `tell_trust` | tell | T0: COUNTER share | 15 | ≥ 60% (gullible) or ≤ 20% (paranoid) | "You believe my stance {pct}% of the time." |
| `tell_by_stance` | tell | T1: strongest response to one shown stance | 8 on that stance | ≥ 65% | "When I show {tellMove} you {moveLower} {pct}%." |
| `after_burn` | tell | T2 key burned: COUNTER share on the next turn | 6 | ≥ 70% (never learns) or ≤ 20% (sulks) | "Fooled once, you trust me again {pct}%." |
| `echo_rival` | habit | E7: P(player move = Rival's prev move), or P(= its counter) if larger | 15 | ≥ 50% | "You copy what I just did {pct}%." |
| `deathblow_nerves` | habit | E8 key 3 | 6 | ≥ 60% | "At three pips you {moveLower} {pct}%." |
| `broken_panic` | habit | E9 key self (only S/F legal) | 6 | ≥ 85% (equilibrium is 71% S) | "Guard broken, you {moveLower} {pct}%." |
| `vs_broken` | habit | E9 key foe | 6 | ≥ 75% | "When my guard breaks you {moveLower} {pct}%." |
| `predictability` | record | 0–100, formula below | 30 turns | ≥ 60 mocked, ≤ 25 grudging respect | gauge + header line |
| `broken_habit` | record | most-broken habit, rule below | — | drop ≥ 25 pts | "You used to {oldMove} {ctxPhrase}. You stopped. I noticed." |
| `record` | record | lifetime block from `meta.memory` (§11): runs, deaths, wins, best duel, closest loss, fastest death, last win (move, HP left, run #), days since last visit, current streaks, favourite move of the last runs | 1 run | — | table, each row with a one-line jab |

**Predictability.** Per turn `s_t = (pAct − 1/n)/(1 − 1/n)` clipped to [−0.5, 1] (n = legal moves). Run score = `clamp(round(150 · mean(s_t)), 0, 100)`; lifetime score uses an EMA of `s_t` with α = 0.02. Reference points: perfect mixer ≈ 0; model hits 45% on average ≈ 26; 60% ≈ 60; 78%+ = 100.
**Most-broken habit.** Whenever a habit stat is mocked, store `peak[id] = {move, pct, run}` if pct is a new high. A habit is "broken" when the *decayed* table's share of `peak.move` (Σc ≥ 8) is ≤ peak.pct − 25. Report the largest drop; clear the peak after it has been shown in 2 runs.
`habitFor(ctx)` returns the mocked stat with the highest strength whose key matches the current ctx (e.g. `after_loss` only when `last=='L'`). `runInsights()` returns the top 3 by strength computed on this run's turns only (min n = 6).

## 8. Boons (36) & relics (6)

Archetype tags: **RIP** Riposte/Guard · **TEN** Tension/Clash · **BLD** Bleed · **TRK** Feint-trickster · **GMB** Low-HP gambler · **INF** Information · **CHA** Chaos/habit-breaker · **EXE** Strike/executioner. Every tag has ≥ 4 boons. Boons are unique per run across both fighters (if the Rival takes it, the player's offer cannot contain it). "Low HP" = hp ≤ ceil(maxHp/3). Card `desc` (≤ 60 chars) is the writer's compression of the effect column.

| id | Name | Rar. | Who | Hook(s) | Exact effect | Tags | Locked (unlock id) |
|---|---|---|---|---|---|---|---|
| `coiled_riposte` | Coiled Riposte | U | both | outDamage | Strike win deals double base (+3) if your previous move was Guard | RIP, EXE | — |
| `thorned_guard` | Thorned Guard | C | both | outDamage | Riposte (G beats S) deals +1 | RIP | — |
| `stone_patience` | Stone Patience | C | both | afterExchange | If you played Guard and took 0 damage this exchange: fortify 1 (no stack) | RIP, TEN | — |
| `iron_oath` | Iron Oath | U | both | afterExchange | First time each duel you would become guardBroken, the status is removed | RIP | `reach_5` |
| `resonance` | Resonance | C | both | onClash | Your clashes add 2 pips instead of 1 | TEN | — |
| `ash_veil` | Ash Veil | U | both | inDamage | Tension bonus on damage you take is reduced by 2 (min 0) | TEN, RIP | `reach_5` |
| `deathblow_creed` | Deathblow Creed | R | both | outDamage | Win at 3 pips: +2 on top of the tension bonus | TEN, EXE | `reach_7` |
| `mirror_etiquette` | Mirror Etiquette | C | both | onClash | Bind: focus 1 · Standoff: fortify 1 · Masquerade: heal 1 (max 2 heals/duel) | TEN | — |
| `serrated_edge` | Serrated Edge | C | both | outDamage, afterExchange | Strike wins deal −1 but apply bleed 3 | BLD, EXE | — |
| `paper_cuts` | Paper Cuts | C | both | afterExchange | Feint wins apply bleed 2 | BLD, TRK | — |
| `salt_the_wound` | Salt the Wound | U | both | outDamage | +1 when you win against a bleeding foe | BLD | — |
| `carrion_comfort` | Carrion Comfort | U | both | afterExchange | Winning against a bleeding foe heals 1 (max 3/duel) | BLD, GMB | `bleed_20` |
| `vampires_curtsy` | Vampire's Curtsy | C | both | afterExchange | Feint wins heal 1 (max 3/duel) | TRK, GMB | — |
| `long_con` | The Long Con | U | both | afterExchange | guardBroken you inflict lasts 2 turns | TRK | `no_guard_duel` |
| `turtle_cracker` | Turtle Cracker | U | both | outDamage | Feint beating Guard deals +2 if the foe also Guarded the turn before | TRK | `no_strike_duel` |
| `debt_collector` | Debt Collector | U | both | outDamage | Strike wins deal +2 against a guardBroken foe | TRK, EXE | `no_guard_duel` |
| `cornered` | Cornered | C | both | outDamage | While at low HP your wins deal +1 | GMB | — |
| `spite` | Spite | C | both | afterExchange | After losing an exchange for 3+ damage: focus 2 (no stack) | GMB | — |
| `three_faces` | Three Faces | C | both | outDamage | +1 if the winning move differs from both of your previous two moves this duel | CHA | — |
| `first_blood` | First Blood | C | both | duelStart | Start each duel with focus 2 | EXE | — |
| `headsman` | Headsman's Patience | R | both | outDamage | Strike wins deal +2 against a foe at low HP | EXE, GMB | `first_win` |
| `no_encores` | No Encores | U | rival | afterExchange | When the player plays the same move twice in a row, that move is sealed for 1 turn | CHA (punisher) | — |
| `painted_smile` | The Painted Smile | U | rival | outDamage, inDamage | On a lying stance the winner of the exchange deals +1 (its lies bite; catching one bites back) — reads `intel.honest` | INF (punisher) | — |
| `mourning_veil` | Mourning Veil | C | rival | duelStart | Starts each duel with fortify 2 | RIP | — |
| `hungry_mask` | Hungry Mask | R | rival | afterExchange | When it wins an exchange it read (`intel.pred[pm]` > 0.60) it heals 1 (max 3/duel) | CHA (punisher) | `read_25` |
| `sealing_wax` | Sealing Wax | R | rival | afterExchange | When it wins, the move you lost with is sealed for 1 turn | TRK | `broken_15` |
| `spare_mask` | Spare Mask | R | rival | onLethal | Once per run, never in duel 7: survives at 1 HP with fortify 1; mask visibly cracked afterwards | GMB | `first_win` |
| `keyhole` | Keyhole | R | player | active ×1 (`glimpse`) | Tap: the sealed sigil turns to glass this turn, showing its committed move | INF | `flawless_duel` |
| `truth_candle` | Candle of Truth | U | player | active ×1 (`honesty`) | Tap: this turn's stance is stamped TRUE or FALSE | INF | — |
| `stolen_ledger` | Stolen Ledger | U | player | turnStart | Each turn shows the Rival's top guess for your move (`sealed.top`) with 1–3 confidence dots | INF, CHA | `reach_7` |
| `liars_tally` | Liar's Tally | C | player | duelStart, afterExchange | HUD shows its current honesty h (nearest 10%) and this duel's honest/lie count | INF | — |
| `coin_of_fools` | Coin of Fools | U | player | active ×3 (`coin`), outDamage | Tap: your move is chosen uniformly from your legal moves; if it wins, +2 | CHA | — |
| `broken_pattern` | Broken Pattern | U | player | outDamage | +2 when you win with a move its model rated below 20% (`intel.pred[pm]`) | CHA | `ghost_run` |
| `ash_of_forgetting` | Ash of Forgetting | R | player | onRest | Each bonfire: its decayed tables × 0.5, expert weights halfway to uniform (**[+IF]** `brain.forget(0.5)`) | CHA | `ghost_run` |
| `last_candle` | Last Candle | R | player | onLethal | Once per run: survive at 1 HP and gain fortify 2 | GMB | `die_5` |
| `ember_hoard` | Ember Hoard | C | player | onRest | Bonfires heal +1; +3 instead if you arrive at low HP | GMB | — |

Counts: 14 common / 14 uncommon / 8 rare; 21 both / 6 rival-only / 9 player-only; 20 open from run 1, 16 locked; 3 actives (`keyhole`, `truth_candle`, `coin_of_fools`). Boons that reward breaking habits: `three_faces`, `coin_of_fools`, `broken_pattern`, `ash_of_forgetting`, `stolen_ledger`; boons that punish having them: `no_encores`, `hungry_mask`, `sealing_wax`.

**Relics** (one chosen at run start, `relic:true`, all locked by default):

| id | Name | Hook(s) | Effect | Archetype | Unlock id |
|---|---|---|---|---|---|
| `relic_ashen_flask` | Ashen Flask | onRest | Bonfires heal +2 | sustain | `first_death` |
| `relic_dented_buckler` | Dented Buckler | duelStart, outDamage | Start each duel with fortify 1; your first riposte each duel deals +1 | RIP | `reach_3` |
| `relic_rusty_nail` | Rusty Nail | afterExchange | Your first win each duel applies bleed 2 | BLD | `lose_3_row` |
| `relic_cracked_mirror` | Cracked Mirror | onClash | The first clash each duel adds 2 pips and gives you fortify 1 | TEN | `deathblows_5` |
| `relic_dealers_thumb` | Dealer's Thumb | onDraft | Draft from 4 choices instead of 3 | draft | `drafts_12` |
| `relic_liars_coin` | Liar's Coin | turnStart | On turn 1 of every duel the stance is stamped TRUE or FALSE | INF | `lies_15` |

**Known dangerous combos (sim must check):**
1. `coiled_riposte` + `first_blood` + `deathblow_creed` + `resonance`: Guard → Strike at 3 pips = 6+3+2+2 = 13 raw; verify the hit cap (8) and that P(player takes ≥ 7 in one hit) < 3% per duel when the Rival holds it.
2. `stone_patience` + `thorned_guard` + `ash_veil` + `mirror_etiquette`: Guard-spam; the always-Guard bot must still lose (Feint break + `turtle_cracker` counter-draft).
3. `vampires_curtsy` + `paper_cuts` + `carrion_comfort` + `salt_the_wound`: Feint win = 3 dmg-equivalent + heal 2; net heal per duel must stay ≤ 5.
4. `long_con` + `debt_collector` (+ `turtle_cracker`): two turns of a 2-move foe with Strike +2; EV per guard break must stay ≤ 4.
5. Rival `no_encores` + `sealing_wax` + guard break: player's mean legal moves must stay ≥ 2.4 (the ≥ 2 rule guarantees the floor).
6. Rival `hungry_mask` + `mourning_veil` + `spare_mask` vs low-damage builds: no duel > 25 turns in 99% of sims.
7. `coin_of_fools` + `broken_pattern` + `three_faces`: up to +5 on a coin win; EV of a coin turn must stay ≤ +1.2 over a chosen move.
8. `ash_of_forgetting` + `keyhole` + `truth_candle`: adaptive-bot win-rate uplift ≤ 12 points.
9. `mirror_etiquette` + `resonance` + Rupture chip: clash farming must not out-heal Rupture damage.

## 9. Draft logic

**Player offer:** built after the Rival's pick from `pool(meta,'p')` minus owned and minus the Rival's boons. Rarity weights by bonfire: #1–2 C70/U27/R3, #3–4 C50/U40/R10, #5–6 C35/U45/R20. From bonfire 2, at least one choice shares a tag with a boon the player owns (if any exists in the pool). Never more than one active per offer.

**Rival pick** (one per bonfire, shown first as a card flying to its side + `bonfire_rival_pick` line): draw 3 hidden candidates from `pool(meta,'r')` using the same rarity weights, then choose among them with weight `W = base · counter · synergy · jitter`, base = 1, jitter = uniform 0.8–1.2, synergy = 1.5 if the boon shares a tag with one it already owns.

| Evidence about the player (`dossier` + `run.stats`) | Counter multiplier |
|---|---|
| Guard share ≥ 40% this run or `fav_move`=G | `turtle_cracker` ×4, `long_con` ×3, `paper_cuts` ×2, `debt_collector` ×2 |
| Strike share ≥ 40% or `fav_move`=S | `thorned_guard` ×4, `coiled_riposte` ×2.5, `stone_patience` ×2, `mourning_veil` ×2 |
| Feint share ≥ 35% or `fav_move`=F | `serrated_edge` ×3, `iron_oath` ×4, `first_blood` ×2, `headsman` ×2 |
| `repeat` pct ≥ 45% | `no_encores` ×4, `sealing_wax` ×2.5 |
| run predictability ≥ 55 | `hungry_mask` ×4 |
| `tell_trust` ≥ 60% or ≤ 20% | `painted_smile` ×3 |
| Player owns ≥ 2 TEN boons | `ash_veil` ×3, `deathblow_creed` ×2 |
| Player owns ≥ 2 TRK boons | `iron_oath` ×4 |
| Player owns ≥ 2 BLD boons | `carrion_comfort` ×0.5, `vampires_curtsy` ×2 (sustain race) |
| Player owns ≥ 2 RIP boons | `turtle_cracker` ×3, `long_con` ×2 |
| Player ended the last duel at low HP | `headsman` ×3, `salt_the_wound` ×1.5 |
| Bonfire 6 and it has not been used | `spare_mask` ×0 (cannot trigger in duel 7) |

Multipliers stack multiplicatively, capped at ×8. The taunt names the reason when counter ≥ 3 ("You Guard too much. So: this.").

## 10. Meta-progression (23 conditions → 28 items)

Checked in `R.Run.finish` (lifetime counters live in `meta.memory` / `meta.counters` **[+IF]**). Each `UNLOCKS` entry has one `ref`; conditions granting two items are two entries sharing a check.

| Unlock id | Condition | Grants |
|---|---|---|
| `first_death` | Die once | relic Ashen Flask |
| `die_5` | Die 5 times | boon Last Candle |
| `die_15` | Die 15 times | mask *The Mourner* |
| `die_duel1` | Die in duel 1 (run 2 or later) | mask *The Jester* |
| `lose_3_row` | Lose 3 runs in a row | relic Rusty Nail |
| `reach_3` | Reach duel 3 | relic Dented Buckler |
| `reach_5` | Reach duel 5 | boons Iron Oath + Ash Veil |
| `reach_7` | Reach duel 7 | boons Deathblow Creed + Stolen Ledger |
| `first_win` | Beat the Unmasked | boon Headsman's Patience + Rival boon Spare Mask; credits roll |
| `win_2` | Beat it twice | mask *Kintsugi* |
| `win_3` | Beat it three times | arena *Pale Dawn* |
| `no_guard_duel` | Win a duel (≥ 5 turns) without ever picking Guard | boons The Long Con + Debt Collector |
| `no_strike_duel` | Win a duel (≥ 5 turns) without ever picking Strike | boon Turtle Cracker |
| `flawless_duel` | Win a duel from duel 2 onward without losing HP | boon Keyhole |
| `deathblows_5` | Win 5 exchanges at 3 pips (lifetime) | relic Cracked Mirror |
| `bleed_20` | Deal 20 bleed damage (lifetime) | boon Carrion Comfort |
| `ghost_run` | End a run that reached duel 4+ with run predictability < 35 | boons Broken Pattern + Ash of Forgetting |
| `ghost_win` | Beat it with run predictability < 40 | mask *The Blank* |
| `read_25` | Get "read" 25 times (lifetime) | Rival boon Hungry Mask ("You fed it.") |
| `broken_15` | Have your guard broken 15 times (lifetime) | Rival boon Sealing Wax |
| `drafts_12` | Draft 12 boons (lifetime) | relic Dealer's Thumb |
| `lies_15` | Win 15 exchanges against a lying stance (lifetime) | relic Liar's Coin |
| `runs_10` | Start 10 runs | arena *Blood Moon* |

Totals: 16 boons, 6 relics, 4 masks, 2 arenas. Rival-boon unlocks are framed as "it learned something from you". Arena palettes are index remaps inside the 32-colour palette: *Blood Moon* 26→16, 27→17, 28→19 on background layers; *Pale Dawn* 2→4, 3→5, 4→6, 26→7, 27→8 with the ash fall recoloured 10.

## 11. Rival memory (`meta.memory`, persisted)

| Field | Type | Updated | Used by |
|---|---|---|---|
| `runs`, `wins`, `deaths` | int | run start / finish | milestones, death lines, title line |
| `streakW`, `streakL` | int | finish (the other resets to 0) | `win_streak` (≥ 2), `lose_streak` (≥ 3) |
| `bestDuel` | 1..8 (8 = phase 2 reached) | finish | "You've never seen duel {bestDuel+1}." |
| `closestLoss` | `{duel, rivalHp}` (lowest Rival HP at the player's death, later duel wins ties) | on death | "I had {rivalHp} left. Does that keep you up?" |
| `fastestDeath` | `{duel, turns}` (fewest total run turns before dying) | on death | death + returning lines |
| `lastWin` | `{move, hp, run, ts}` finishing move, HP left, run number | on victory | `{lastWinMove}`, `{lastWinHp}`, final-duel intro |
| `lastPlayed`, `firstPlayed` | ts (passed in as `now`) | run start and finish | `{days}` = floor((now − lastPlayed)/86.4e6); returning lines at ≥ 2 days |
| `lastFavorite` | move | finish (most-played move of the run) | duel intros |
| `favorites` **[+IF]** | move[] (last 10 runs) | finish | "Three runs of Guard, now Strike? Bold." |
| `totalTurns` | int | per turn | confidence ramp, milestones |
| `counters` **[+IF]** | `{deathblows, bleedDealt, reads, guardBroken, drafts, liesCaught}` | per turn / bonfire | unlock checks |
| `tauntBag` **[+IF]** | `{category:[used line ids]}` | per taunt | no-repeat shuffle bags across sessions |

## 12. Final duel

Phase 1 (duel 7): standard rules, HP 10, e 0.90, honesty 0.42, altar arena, music `boss`. `spare_mask` cannot trigger. At 0 HP: transformation (§14), then `R.Run.startPhase2`: Rival HP 9, both fighters' statuses cleared, player heals 2, tension set to 1, boons and charges carry over (actives are *not* recharged).

**Phase 2 — "The Unmasked" — three rules, each shown as an icon card during the transformation:**

| Rule | Mechanic | AI / data |
|---|---|---|
| **Twin Stance** | Its stance flickers between two moves; an honest stance means the real move is one of the two, a lie means it is the third. | `sealed.tell` = the move **not** shown (X); honest ⇔ `move ≠ X`. Response categories map onto the same tell layer with phantom tell X: CALL = `LOSES_TO[X]` (beats the lie), GAMBLE = X, SAFE = `BEATS[X]` (never loses to either shown move). Tables keyed `p2:`. If its guard is broken the pair is forced to S+F. |
| **Embers** | Tension never drops below 1: after a decisive exchange it resets to 1, so every hit is +1 and Deathblow is one clash closer. | In `payoff`; symmetric. |
| **Called Shot** | On phase-2 turns 2, 5, 8… it names the move it expects ("You will Guard.", rune over the player). Play that move and lose the exchange: +2 damage. Play anything else and win: it is staggered (`guardBroken` 1). | Called move = argmax of the tell-independent ensemble, fixed before `commit` and returned as **[+IF]** `sealed.called`; `brain` adds the ±2 / ±0.86 terms to V itself; combat reads `duel.intel.called`. |

Exploit 1.0, τ 0.30, honesty base 0.35. Presentation: `rival2` sprite set, witchfire candles, `boss2` music, bubbles inverted (fill 1, text 31), its typewriter blip drops an octave. Death of the Unmasked: 12-frame collapse, the cloak empties, the original porcelain mask (whole, unpainted) drops and spins to rest; the last line types with no bubble.

## 13. Art bible

### 13.1 Palette (exactly 32; index 0 transparent)

| # | Hex | Name | Use |
|---|---|---|---|
| 0 | — | transparent | — |
| 1 | #0b0a10 | Void | outlines, deepest shadow, letterbox, phase-2 bubble fill |
| 2 | #16141f | Crypt | HUD strip, far vault |
| 3 | #221f2e | Night stone | far wall |
| 4 | #2f2c3d | Slate shadow | stone mid-dark, button face |
| 5 | #403e52 | Cold stone | pillars, disabled UI, HUD line |
| 6 | #56566c | Worn stone | lit stone, disabled icon |
| 7 | #74768c | Ash blue | stone highlight, common rarity, credit line |
| 8 | #9a9cae | Pale ash | ash particles, steel mid |
| 9 | #c4c6d0 | Steel light | blade highlight |
| 10 | #ecebe4 | Bone white | mask, main text, bubble fill, lag bar |
| 11 | #cfc4a6 | Bone | porcelain shadow, secondary text, bandages |
| 12 | #9c8f76 | Parchment | bubble shade, cloth highlight |
| 13 | #6b5f52 | Dust brown | leather, floor flagstones |
| 14 | #463b36 | Umber | player cloak, wood |
| 15 | #2c2423 | Char | player cloak shadow, burnt wood |
| 16 | #3a1418 | Dried blood | Rival cloak deep shadow, blood-moon shadow |
| 17 | #6e1a20 | Wine | Rival cloak, sealed sigil wax |
| 18 | #a3242a | Blood red | HP fill, painted smile, "YOU DIED", Strike colour |
| 19 | #d8483a | Fresh red | HP highlight, damage numbers, blood particles |
| 20 | #f08a4a | Ember | bonfire body, sparks |
| 21 | #f6b44c | Candle amber | flames, tension pips, glow dither |
| 22 | #fde08a | Flame core | flame centres |
| 23 | #fff6d0 | White-hot | spark centres, hit flash, sigil crack line |
| 24 | #8a5a2a | Brass dark | candlesticks, button frame shadow |
| 25 | #c08a3c | Brass | button frame, uncommon rarity, kintsugi veins |
| 26 | #1d3340 | Deep teal | moonlight shadow, Guard dark |
| 27 | #2f5d6e | Cold teal | moonbeam, Guard colour |
| 28 | #6fa6b0 | Moon blue | moon highlight, Guard highlight, mourner's tear |
| 29 | #4a2c5e | Bruise violet | Feint dark, afterimages |
| 30 | #8a4fa0 | Feint violet | Feint colour, rare rarity |
| 31 | #a8e04a | Witchfire | **phase 2 only**: eye, blade edge, candle flames, bubble text |

Move colour-coding everywhere: Strike = 18/19, Guard = 27/28, Feint = 29/30, always paired with a distinct shape (never colour alone).

### 13.2 Fighters (48×48 frame, feet centre anchor, composited from indexed parts)

- **Player — "the Ashen":** ~30 px tall, slightly hunched. Deep hood (14/15) with the face in void (1) and a single pale-ash chin glint (8); tattered umber cloak ending in three ragged tongues; sword arm wrapped in bone bandages (11); notched straight sword (8/9, one missing chip); wrapped shins, no boots. Reads as tired, stubborn, small. Never speaks.
- **The Rival:** ~38 px tall, narrow, upright. High-collared wine cloak (17/16) with a brass clasp (25); porcelain mask (10/11) with two slit eyes (1) and a painted red smile (18) one pixel too wide; long thin estoc (9); black gloves. Idle keeps one hand behind its back.
- **Phase 2 (`rival2`):** right half of the mask gone; behind it void (1) with one 3-px witchfire eye; cloak hem splits into four tendrils that move as if underwater; floats 3 px above the floor (44 px tall in a 48×56 box); estoc gains a 1-px witchfire edge (remap 9→31 on the edge row); every frame leaves a 2-px-offset afterimage of the previous frame in 29.
- **Unlockable masks** (head part swap; `settings.mask`): *The Mourner* — downturned mouth, one painted tear (28). *The Jester* — split void/bone, diamond eye, a brass bell on the collar that jingles on taunts. *Kintsugi* — the smile mask shattered and rejoined with brass veins (25). *The Blank* — no features at all, smooth bone ("I had nothing left to paint").

| Part | Player variants | Rival variants |
|---|---|---|
| Head (12×12 / 12×14) | hood level, bowed, thrown back | 5 masks × (level, tilted, thrown back); phase 2: 3 shattered |
| Torso (14×14) | upright, lean forward, lean back | upright, lean forward, lean back (bow) |
| Cloak (24×24) | sway ×4, flare ×2 | sway ×4, flare ×2, wrap ×2; phase 2: tendril ×8 |
| Legs (20×14) | stand, wide, lunge, backstep, kneel, sprawl | stand, narrow (heels together), lunge, backstep, kneel, cross-step |
| Sword arm (28×28 / 34×34, shoulder anchor) | 6 angles: overhead-back −75°, high-forward −35°, level 0°, low +35°, vertical guard, reversed behind hip | same 6 angles |
| Off arm | hang, brace on blade, open palm forward | behind back, brace, splayed fingers, wagging finger |

Poses are explicit per-frame lists `{part, variant, dx, dy}`; no runtime skeletal maths.

**Tell silhouettes (must read in < 200 ms at 2× scale):**
- `tell_S` — **tallest.** Sword overhead-back, tip above the head, torso leaning back, front foot forward. A red glint (19) runs down the blade every loop.
- `tell_G` — **narrowest.** Heels together, sword vertical in front of the face, off hand braced on the flat, cloak wrapped. A teal glint (28) pulses on the crossguard.
- `tell_F` — **widest and lowest.** Deep crouch, sword reversed behind the hip pointing back and down, open palm (Rival: splayed fingers) thrust forward, cloak flared. A violet shimmer (30) on the open hand.
Honest and lying stances are pixel-identical. Phase 2 alternates two tell poses every 300 ms with a 2-frame (40 ms each) witchfire smear between.

### 13.3 Animations (frame durations in ms; `|n|` marks the contact frame, always starting at t = 200 ms)

| Anim | Frames: durations | Loop | Player | Rival (`rival`) | `rival2` difference |
|---|---|---|---|---|---|
| `idle` | 4: 220 each (Rival 260) | yes | torso +1 px on frames 2–3, cloak sway, sword low | same, hand behind back, mask tilts on frame 3 | 6: 160 each; tendrils ripple, hover bob ±1 px |
| `tell_S` / `tell_G` / `tell_F` | 3 in: 80, 80, 120; then 2-frame hold: 380 each | hold loops | player uses these only as the first frames of its own moves (never shown before reveal) | wind-up into the silhouettes above; hold frame 2 adds the glint | flicker pairs (see above) |
| `strike` | 5: 70, 70, 60, \|80\|, 100 | no | overhead → diagonal cut, lunge legs, slash-arc FX part on contact | longer reach, cloak flare, lands with one hand | arc drawn in 31; body lunges 6 px further |
| `guard` | 4: 80, 120, \|120\|, 60 | no | vertical blade, brace, knees bend | barely moves; turns the blade a quarter | cloak tendrils cross in front |
| `feint` | 6: 50, 50, 50, 50, \|80\|, 100 | no | fake high (frames 1–2), drop low, slip thrust | fake + a pirouette of the cloak, stab from behind the hip | body blinks out for frame 4 (afterimage only) |
| `hit` | 3: 50 (white), 90, 110 | no | head back, 2 px knock-back, returns | hand to mask, 1 px knock-back | eye flares, tendrils spike |
| `stagger` | 5: 60, 80, 120, 120, 120; then 2-frame dazed overlay 300 each while broken | overlay loops | sword arm flung wide, drops to a knee | sword arm flung wide, cloak wrap opens, offended head tilt | mask fragment orbits the head |
| `clash` | 4: 50, 70, 100, 100 | no | recoil 4 px back and return | recoil 4 px; Bind = blades crossed frame, Standoff = half step sideways, Masquerade = both flourish past each other | same |
| `death` | player 8: 80, 80, 100, 120, 140, 160, 200, 400 | no | knees, sword falls, slump, dissolves top-down into ash | duels 1–6 it *yields*: 7: 80, 80, 100, 120, 120, 160, 300 — kneels, laughs, vanishes in a cloak swirl | 12: 90 each then 400 — collapse, cloak empties, mask drops |
| `taunt` | Rival 6: 110 each ×2 loops; player 4: 120 each | no | player: pulls hood lower (used after surprising it) | slow clap | clap with tendrils |
| `taunt2` | Rival 5: 100, 100, 140, 100, 160; player 4: 120 each | no | player: flicks ash off the blade | wags a finger, mask tilts 15° | finger wag, eye narrows |
| `victory` | 6: 120, 120, 160, 160, 200, 400 | no | plants sword, kneels beside it | mocking bow with a cloak flourish | rises 6 px, arms wide |
| `transform` | 24: 60–100 each, ≈ 2.0 s (inside the §14 sequence) | no | — | kneel → hand on mask → shatter → rise as `rival2` | — |

### 13.4 Backgrounds

**Cathedral arena** (180×210, back to front): L0 vault gradient (2→3 dither bands), static. L1 far wall with broken rose window (40×40 at arena x70,y8) and a moonbeam shaft (27/28 dither) with 12 drifting dust motes. L2 four pillars (x 8, 46, 122, 160; w 12), two broken arches, two hanging chains swaying 1 px on a 2 s cycle. L3 rubble, toppled pews, candles at arena-relative (14,120) (40,128) (88,116) (96,118) (140,128) (166,120): 3×5 flame, 3 frames at random 120–180 ms, 9×9 checker-dither glow (21); `gutter` 0..1 shrinks flames to a 2-frame low state and dims glow. L4 flagstone floor, floor line at arena y=138, duel-3 puddle row mirrors fighter feet at 50% dither. L5 (`fg`, drawn over fighters) bottom vignette, one pew silhouette at the left edge (1), ash fall: 20 particles, 8–14 px/s, colours 7/8. Variants per §5.
**Bonfire:** night cloister, fire burning inside a cracked, half-buried cathedral bell at (90,150): 6-frame fire loop at 100 ms, 16 rising embers, 40×24 glow. The Ashen sits left (2 frames at 600 ms, breathing); the Rival sits opposite on a toppled pillar, legs crossed, warming its hands, mask tilted at the player. Cards rise from the fire.
**Title:** close-up of the porcelain mask lying in ash beside one candle; logo: small "SHOW ME MY" in ash (8) above a large "RIVAL" in bone (10) with a blood (18) underline; every ~4 s a glint crosses an eye slit, and after 8 s idle the painted smile widens by 1 px. "TAP TO BEGIN" blinks at 600 ms; credit line in 7 at the bottom.

### 13.5 UI

| Element | Spec |
|---|---|
| Sigil 16×16 | `sealed`: wine wax disc (17, rim 16) stamped with a mask glyph; `crack`: 3 frames — hairline (23), split with light leak, 6 shards fly; `open`: void disc (2) with a move-coloured ring and the 10×10 move icon; glass state (Keyhole): outline only, icon visible |
| Move icons 10×10 | Strike: diagonal blade (9/8) with red tip (19). Guard: kite shield (27/28) with a vertical bar. Feint: crescent with a three-dot trail (29/30). Also at 20×20 (2×) on buttons and 6×6 minis for "beats" hints |
| Button 56×52 | 9-slice brass frame (25, shadow 24) on slate (4), icon on top, label in 10. Pressed: content +2 px down, frame 24, face 3, 80 ms. Disabled: face 3, frame 5, icon 6, plus a reason overlay (cracked shield = guard broken, wax blob = sealed). Glow (tutorial highlight): frame cycles 25→22→25 at 500 ms |
| HP bar 72×7 | frame 1, back 3, fill 18 with a 19 top row, ticks every HP; lag bar (10) waits 300 ms then drains at 40 px/s; player at low HP: fill pulses 18↔19 in time with the heartbeat; phase 2 Rival fill 31 |
| Speech bubble | 9-slice, 4 px corners, fill 10, border 1, bottom shade row 12, tail 6×5; text colour 1; phase 2: fill 1, border 31 (jitters 1 px every 200 ms), text 31 |
| Boon card (bonfire) | 56×44 tile: 9-slice, 16×16 icon, name (≤ 2 lines); selected tile lifts 3 px and a 172×58 detail panel shows name, tags, effect text (≤ 60 chars, 3 lines) and CONFIRM |
| Rarity marks | common: border 7, one pip; uncommon: border 25, two pips; rare: border 30, three pips and a 4-frame glint sweep every 2 s; Rival-only cards add a small mask glyph in the corner |
| Status icons 8×8 | cracked shield (guardBroken), red drop (bleed), stone block (fortify), flame eye (focus), wax blob + mini move icon (sealed) |

**Font:** 5×7 proportional pixel font (widths 1–5, 1 px spacing, line height 9), upper + lower case, digits, `.,!?'"-:;%()/·…`. Bubble inner width 164 px ≈ 26 characters per line, max 3 lines, hard cap 78 characters per taunt after variable expansion.

## 14. Juice timing

**Normal turn (ms).** Sum of the automated part = 2690; with bleed / guard break / clash extras ≤ 3500.

| Step | Duration | Detail |
|---|---|---|
| Turn start | 150 | status timers tick; bleed tick adds 250 (blood ×4, `hit` at pitch 0.6) |
| Commit / seal | 300 | sigil drops 6 px and stamps shut (4 frames × 50, 100 settle), `seal` |
| Tell wind-up | 350 | Rival enters the tell stance (80+80+120, 70 settle); then the hold loops for as long as the player thinks; buttons enable at the end of this step |
| *(player thinks)* | — | idle taunt check at 14 s |
| Lock-in | 200 | button press 80, player sigil stamps 120, `select`, buzz 8 ms; all buttons lock |
| Pre-reveal hold | 350 | both fighters still, ambient ducked 30%; 500 in Deathblow |
| Sigil crack | 300 | both sigils: 3 frames × 60, shards 120, `crack`, 6 `shard` each |
| Exchange | 500 | both move anims start together; contact at +200 |
| Impact | 90 hit-stop | 130 for Strike-beats-Feint; shake 2 px/150 ms (3 px if dmg ≥ 4, 4 px if ≥ 6); loser flashes white 50 ms; `spark` ×8 (riposte ×12 at the blades), `blood` ×6 on HP loss; damage number rises 14 px over 500 |
| Aftermath | 450 | HP bar snaps, lag bar per §13.5, fighters return to idle (250), tension pips reset or light |
| Taunt bubble | non-blocking | typewriter 28 ms/char (`type` blip every 2nd char), stays 1800 ms after the last char or until lock-in; the next turn's seal starts 0 ms after aftermath regardless |

**Skip:** any tap during resolution plays the remainder at 4× (floor 400 ms total); the open sigils and the damage number always stay ≥ 120 ms. Scripted sequences below are unskippable the first time only.

| Sequence | Beats (ms from start) |
|---|---|
| **Clash** | contact: hit-stop 70, `spark` ×10 at x=90, `clash_s/g/f`; 70–390 recoil; 390–540 new pip pops (scale 1→2→1) with `bell` at rising pitch. Entering 3 pips (once): +500 — letterbox bars slide in 6 px top and bottom of the arena, background layers part ±2 px (push-in), `gutter`→1, heartbeat 100 bpm, drone low-passed, hint text "DEATHBLOW", `deathblow`. **Rupture:** both `hit` anims, shake 3 px, both sealed icons stamp onto the buttons. |
| **Guard break** | contact: hit-stop 140, `guard_break`, `shard` ×16 (28/9) from the loser's blade, shake 3 px/200; 140–640 `stagger`; 200–800 banner "GUARD BROKEN" over the loser; 400–580 loser's GUARD button cracks (3 frames) if it is the player; buzz [20,40,20]. Adds 350 to the turn. |
| **Final blow** (exchange will end a duel) | 0–700 hold with two heartbeats, all ambient cut; 700–1000 sigil crack; 1000–2100 exchange at `timeScale` 0.35; contact: hit-stop 320, full-screen flash (23) 2 frames, arena colours inverted 1 frame, shake 4 px/350, `spark` ×24 + `ash` ×12, `final_blow`; 2420 time back to 1; loser's `death`/yield; 400 silence; then the line. ≈ 4.2 s; first 1.5 s never skippable. |
| **Death / YOU DIED** | 0–1280 player `death`, `ash` ×30; 600–1200 arena desaturates in 3 remap steps to greys; music → `death` drone; 1280–1780 black; 1780–2680 "YOU DIED" (18) dithers in over 4 steps, letter spacing widens 1→3 px over 2 s, `you_died`, buzz 200; 4300 parting line types on black; 5600+ insight lines slide in 300 apart; unlock cards flip (`unlock`); TAP enabled 1200 after the first text. |
| **Phase-2 transformation** (≈ 6.5 s) | 0 lethal hit: hit-stop 400, hairline cracks on the mask (3 × 120); 600–1400 silence, Rival kneels, hand to mask, bubble "..."; 1400–2200 mask shatters (`shard` ×12, `phase2`), flash 23; 2200–3600 candles snuff one by one (100 apart), arena remaps to 1/2/3; 3600 `boss2` starts, the witchfire eye opens (1 px → 3 px), candles relight green; 3600–4600 `transform` frames, tendrils unfurl, it rises 3 px; 4600–5600 HP bar refills 0→9 in 31 with ticks, player +2 heal; 5600–6500 `phase2` line + three rule cards (TWIN STANCE · EMBERS · CALLED SHOT) slide through the hint area, 900 each, overlapping. |

Haptics: lock-in 8; hit taken 30; guard break [20,40,20]; Deathblow heartbeat 12 per beat; death 200; unlock [10,30,10].

## 15. Audio (all procedural Web Audio; names per `R.Audio`)

| SFX | Recipe |
|---|---|
| `tick` | square 880 Hz, 20 ms, exponential decay, gain 0.08 (pitch opt reused for status gain/loss) |
| `select` / `back` | two square blips 660→990 Hz, 40 ms each / single 440→330 Hz glide 70 ms |
| `seal` | noise 30 ms through band-pass 300 Hz Q4 + sine thud 90→50 Hz over 120 ms (wax stamp) |
| `crack` | three high-passed (6 kHz) noise clicks at 0/40/90 ms + sine ping 2.4 kHz, 80 ms decay |
| `whoosh_s` | white noise, band-pass sweep 400→2400 Hz in 140 ms, Q 1.5, attack 20 / decay 120 |
| `whoosh_f` | noise, band-pass 2000→500→1800 Hz in two 90 ms legs, softer, slight stereo wobble |
| `guard_up` | triangle 147 Hz 120 ms + low-passed (600 Hz) cloth noise 100 ms |
| `clang` (riposte) | inharmonic partials 523 / 784 / 1178 / 1661 Hz (square+triangle, detuned ±6 c), 5 ms attack, 350 ms decay, 10 ms noise click, high-pass 300 Hz |
| `hit` | sine thump 120→45 Hz 120 ms + noise low-passed 800 Hz 80 ms |
| `clash_s` (Bind) | `clang` partials × 0.8, two strikes 60 ms apart, 30 Hz ring-mod shimmer tail 500 ms |
| `clash_g` (Standoff) | triangle 98 Hz 250 ms + cloth noise (low-pass 600 Hz) 200 ms, no transient |
| `clash_f` (Masquerade) | two triangle chirps 700→1100 and 1100→700 Hz, 70 ms each (a mocking "ha-ha") |
| `guard_break` | `clang` partials bent −30% over 300 ms + noise crash (low-pass 3 k→500 Hz, 400 ms) + 55 Hz sub thud |
| `bell` (tension pip) | sine + 2nd harmonic at 392 / 466 / 554 Hz for pips 1/2/3, 180 ms; FM index 2 |
| `deathblow` | reversed-envelope noise swell 600 ms into a 49 Hz saw stab through low-pass 200 Hz |
| `final_blow` | global low-pass to 400 Hz + 700 ms noise swell, then a dry full-band `clang` + 40 Hz sub, 1.2 s tail |
| `heal` | triangle arpeggio D5–F5–A5, 60 ms each, over a soft sine pad 300 ms |
| `boon` | triangle chime with feedback delay 0.3: one note (A5) common, two (A5, D6) uncommon, three (A5, D6, F6) rare |
| `rival_draft` | `boon` pitched down a tritone + a 2-chirp `clash_f` laugh |
| `you_died` | saws D2 + A2 + D3 through low-pass 600 Hz, attack 300 ms, release 2 s; E♭3 enters at 1 s |
| `phase2` | 12 random glass grains (sine pings 2–6 kHz, 20–60 ms) over 500 ms + noise crash + 40 Hz boom 1 s; then saw 55 Hz through a band-pass sweep 200→3000 Hz (Q8) with 14 Hz tremolo, 900 ms |
| `type` | square 180 Hz ±12% random per blip, 18 ms; phase 2: saw 90 Hz ring-modulated at 30 Hz |
| `unlock` | triangle D4–A4–D5–F5 (100 ms each) + high-passed (5 kHz) noise shimmer |
| `step` | low-passed (500 Hz) noise 40 ms + sine 70 Hz 30 ms (lunges, the Rival's entrance) |
| `ember` | single crackle: noise burst 10–40 ms, band-pass random 1–4 kHz, random gain |
| `heartbeat(bpm)` | two sine thumps 60→40 Hz, 70 ms each, 140 ms apart, low-pass 120 Hz; 66 bpm at player low HP, 100 bpm in Deathblow |

| Music | Recipe |
|---|---|
| `drone` (duels 1–6) | saws D1 + A1 detuned ±4 c through low-pass 180 Hz (cutoff LFO 0.07 Hz, 120–260 Hz); wind = noise band-pass 400 Hz Q0.7 with a 0.05 Hz gain LFO; a lone FM bell on D4/F4/A4 at random 6–14 s gaps, 3 s decay. Each tension pip adds a triangle D2 pulse layer (8ths at 72 bpm). |
| `title` | `drone` + music-box triangle at 60 bpm: D5 A4 F4 E4 \| D4 – A4 – (8-bar loop) |
| `bonfire` | `ember` at ~9 crackles/s over brown noise (low-pass 250 Hz) + Dm9 sine pad (D3 F3 A3 C4 E4, 2 s attack) + triangle melody in 6/8 at 50 bpm: A4 F4 D4 \| E4 C4 A3 |
| `boss` (duel 7) | **D Phrygian, 96 bpm, 4/4.** Bass saw (low-pass 300 Hz), 8ths: D2 D2 D2 E♭2 \| D2 D2 C2 D2. Lead square (25% duty, 5 Hz vibrato): D4 E♭4 F4 E♭4 \| D4 – A3 – \| B♭3 A3 G3 A3 \| D4 – – –. Pad of three detuned saws (low-pass 900 Hz): Dm → E♭ → Cm → D5. Kick = sine 100→40 Hz on beats 1 and 3; snare = noise band-pass 1.8 kHz on 4. |
| `boss2` (phase 2) | same motif in **D Locrian** (A→A♭), **132 bpm**, lead doubled a tritone below, bass in 16ths, waveshaper grit, 14 Hz tremolo on the pad; in Deathblow the kick is replaced by the heartbeat |
| `death` | `drone` alone at −12 dB with the low-pass fixed at 120 Hz |
| `credits` | the boss motif in D Dorian at 66 bpm on triangle + sine pad, ending on a D major chord — the only major chord in the game |

## 16. Taunts

Voice: an aristocrat who has all the time in the world and has spent it on you. Dry, specific, never shouts (until phase 2). Mocks play, not the person. Target total: **305 lines**. Sample lines set the voice; the writer fills the counts.

| Category | Lines | Trigger | p | Sample A | Sample B |
|---|---|---|---|---|---|
| `habit_detected` | 36 | `habitFor(ctx)` returns a stat (max 2 per duel, each stat once per 2 duels) | 0.35 | "{ctxPhrase}, you {moveLower} {pct}% of the time. I counted. Twice." | "{pct}% {move} {ctxPhrase}. Not a duelist. A metronome." |
| `habit_broken` | 8 | `dossier.broken` set, once per run, duel intro slot | 1.0 | "You used to {oldMove} {ctxPhrase}. You stopped. I noticed." | "No more {oldMove}? Someone has been reading their dossier." |
| `read_you` | 20 | Read signal | 0.5 | "I knew. I knew before you did." | "{move}. Again. I could set my watch by you, if time still worked here." |
| `surprised` | 14 | Surprised signal and the player won | 0.6 | "...Hm. That wasn't in my notes." | "Oh, a new trick! Precious. I'll have it memorized by morning." |
| `lie_worked` | 8 | lying stance, Rival won | 0.3 | "You believed me. Adorable. Never change. Really, don't." | "The stance said Strike. The stance lies. I taught it everything." |
| `lie_caught` | 8 | lying stance, player won | 0.4 | "You didn't buy it. When did you get suspicious? I preferred you gullible." | "Called my bluff. Enjoy it. I have others." |
| `player_low_hp` | 12 | player first crosses low HP this duel | 1.0 | "{hp} health left. I'd say 'careful', but you never are." | "You're bleeding on my floor. I just had it ruined." |
| `rival_low_hp` | 12 | Rival first crosses low HP this duel | 1.0 | "A scratch. The mask is fine. That's what matters." | "Enjoy this. I've watched you waste better leads." |
| `clash` | 15 | clash (4 per mirror type + 3 Rupture) | 0.25; entering 3 pips 0.8; Rupture 1.0 | "Great minds. And also yours." | "Stop copying me. It's embarrassing for both of us." |
| `guard_break_player` | 8 | player's guard broken | 0.6 | "There goes your guard. You leaned on it like a crutch anyway." | "No Guard next turn. Whatever will you do. (I know what you'll do.)" |
| `guard_break_rival` | 8 | Rival's guard broken | 0.6 | "Rude. That guard was an antique." | "Fine. My guard is down. Do something clever. I'll wait." |
| `player_death` | 16 | death screen parting line | 1.0 | "Death {deaths}. I've started naming them." | "Go on, then. Walk back. I'll keep your habits warm." |
| `rival_defeated` | 12 | duel 1–6 won / final win (4 reserved) | 1.0 | "I yield. Briefly. See you by the fire." | "Well struck. I'll be insufferable about it later." |
| `first_run_tutorial` | 10 | scripted, §17 | 1.0 | "Ah. A new one. Lovely. Let me teach you how to lose." | "Lesson three: I lie." |
| `run_50` | 4 | intro of run 50 | 1.0 | "Fifty runs. That's not persistence. That's a relationship." | "Run fifty. I baked nothing. I did, however, memorize you." |
| `milestone_runs` | 10 | intro of runs 5, 10, 25, 100, 200 (2 each) | 1.0 | "Run {runs}. At this point I'm your longest commitment." | "{runs} attempts, {deaths} deaths. The math is not flattering." |
| `returning` | 8 | duel-1 intro, `{days}` ≥ 2 | 1.0 | "{days} days. I was beginning to think you'd found a hobby." | "Back after {days} days. The candles missed you. I did not." |
| `lose_streak` | 8 | duel-1 intro, `streakL` ≥ 3 | 0.8 | "{streak} deaths running. Should I fight left-handed? I'm asking sincerely." | "That's {streak} in a row. I'm running out of ways to pity you." |
| `win_streak` | 6 | duel-1 intro, `streakW` ≥ 2 | 1.0 | "{streak} wins. Fine. I'm taking notes in a much angrier hand." | "Beaten {streak} times running. I liked you better dead." |
| `bonfire_player_pick` | 14 | player confirms a boon | 0.7 | "{boon}? Bold. Wrong, but bold." | "{boon}. Of course. You always take the shiny one." |
| `bonfire_rival_pick` | 10 | Rival drafts (counter ≥ 3 uses the "because you…" subset) | 1.0 | "I'll have {rivalBoon}. It goes with the mask." | "{rivalBoon}, for me. Read it slowly. Dread it properly." |
| `duel_intro` | 12 | start of duels 2–6 when no higher-priority intro applies | 0.8 | "Duel {duel}. You open with {move} {pct}% of the time. Just saying." | "Rested? Good. I prefer my opponents hopeful." |
| `final_duel_intro` | 6 | start of duel 7 | 1.0 | "Seven. The altar. You know every stone by now; you've died on most of them." | "No more lessons. I know you by heart. Come and be known." |
| `phase2` | 6 | transformation, 5600 ms beat | 1.0 | "You broke the mask. Do you know how long I painted that smile?" | "No more face. No more manners. LOOK AT ME." |
| `called_shot` | 6 | Called Shot turn (3 calls "{moveLower}", 3 reactions when wrong) | 1.0 | "You will {moveLower}. I've read this page already." | "Wrong?! You... deviated. How dare you surprise me now." |
| `idle` | 6 | 14 s without input, once per duel | 0.5 | "Take your time. I have eternity and a very comfortable cloak." | "Thinking? That's new. I'll note the date." |
| `dossier_headers` | 12 | Dossier section titles (chosen by top stat kind) | — | "ON THE SUBJECT OF YOU" | "THINGS YOU DO WHEN FRIGHTENED" |
| `learned_lines` | 10 | death/victory screen, wraps each `runInsights()` stat | — | "This run: {pct}% {move} {ctxPhrase}." | "You trusted my stance {pct}% of the time. It earned far less." |

**Template variables:** `{pct}` (integer), `{move}` / `{moveLower}` (Strike / strike), `{counterMove}`, `{oldMove}`, `{prevMove}`, `{tellMove}`, `{ctxPhrase}` (≤ 28 chars, lower case, engine capitalises line starts: "after you take a hit", "on the first turn", "when I show you Strike", "when you're nearly dead", "at three pips", "with your guard broken"), `{runs}`, `{deaths}`, `{wins}`, `{days}`, `{streak}`, `{duel}`, `{bestDuel}`, `{hp}`, `{rivalHp}`, `{turns}`, `{score}` (predictability), `{boon}`, `{rivalBoon}` (≤ 20 chars), `{lastWinMove}`, `{lastWinHp}`. A line whose variables are unavailable is not eligible. Worst-case expansion must fit 78 characters / 3 lines of 26.

**Trigger rules.**
- **Forced moments (always speak, ignore cooldown):** tutorial beats, duel intros, first low-HP crossing (either side), Rupture, Called Shot, duel end, phase 2, death, bonfire picks.
- **Optional triggers:** after each exchange collect all that fired, walk them in priority order, roll each one's p, speak the first success. Priority: `guard_break_*` > `read_you` > `surprised` > `habit_detected` > `lie_caught` > `lie_worked` > `clash` > `idle`.
- **Cooldown:** after any optional bubble the next turn is silent; after a forced bubble optional triggers resume immediately. A third consecutive silent turn doubles all p for the next roll (capped at 1). Expected density ≈ 1 bubble per 3 turns.
- **No repeats:** each category is a shuffle bag persisted in `meta.memory.tauntBag`; a line cannot recur until the bag empties; never the same category twice in a row unless forced.
- **Budget per duel:** max 2 `habit_detected`, 2 `read_you`, 1 `idle`. Bubbles never block input.

## 17. Tutorial (first-ever duel; ≈ 26 s; Rival HP 7)

Turns 1–2 use `force` and are **not** passed to `brain.observe`; turn 3 is observed. Disabled buttons during forced turns are dimmed with no reason overlay; the target button uses the glow state. Each button permanently shows the 6×6 mini-icon of the move it beats.

| Beat | Rival (forced) | Buttons | Bubble (exact) | Result |
|---|---|---|---|---|
| 0 · 0.0 s | `taunt` (slow clap) | locked | "Ah. A new one. Lovely. Let me teach you how to lose." | tap or 2.2 s |
| 1 · tell | shows Strike, plays Strike | GUARD glows, others dim | "This is my Strike stance. Guard beats Strike. Go on." | — |
| 1 · result | — | — | "Good. A trained crow could do it, but good." | riposte: Rival 5/7 |
| 2 · tell | shows Guard, plays Guard | FEINT glows | "Now I Guard. A Feint slips past a Guard. Try it." | — |
| 2 · result | cracked-shield icon flashes ×3 | — | "My guard is broken. No Guard for me next turn. See?" | Rival 3/7, guardBroken |
| 3 · tell | shows Strike, plays **Feint** (trap) | all three lit, none glowing | "Strike again. You know what beats it." | — |
| 3a · player Guards | — | — | "Lesson three: I lie. A Strike would have cut that Feint down." | player 10/12, guardBroken; hint text "GUARD BROKEN" |
| 3b · player Strikes | — | — | "...You didn't trust me. Good. Strike beats Feint. Remember it." | Rival 0/7: it yields in 3 turns |
| 3c · player Feints | — | — | "A clash. Tension builds. The next hit lands harder." | 1 pip; turn-4 intro adds "Also: I lie. Often." |
| 4+ | normal duel-1 AI | normal | first time each occurs: clash / tension / Rival lie get one extra explanatory line from `first_run_tutorial` | — |

No text panels, no pause screens: every lesson is one bubble plus one highlighted control. Bonfire 1 adds two lines only: "I choose first. You may watch." and, when the cards appear, "Pick one. Choose badly; I enjoy that."

## 18. Designer's objections & contract gaps

- **HP budget:** 76 Rival HP vs ≈ 36–44 player HP demands a ~1.8:1 trade; I expect the sim to pull duel 5–7 HP down by 1–2 or raise the bonfire heal to 5 before the 25–35% target is reachable.
- **Realised honesty:** as specified, the "allow all pairs" branch can still choose honest pairs, so true honesty sits above h (up to h + (1−h)/3 with no information); tune against realised values, not the table.
- **Hit cap 8** is my addition (not in the brief) to stop one-shot stacks; delete it if the sim shows the stacks are rare enough.
- **Persistent learning never resets:** a habitual player's run 30 is harder than run 1 with no visible cause except the Dossier; the run-start ×0.90 decay softens this, but consider a floor on exploitation for duels 1–2.
- **~22 unlocks:** 16 boons + 6 relics + 4 masks + 2 arenas is 28 items; I bundled them into 23 conditions rather than cut content.
- **Contract gaps [+IF]:** `duel.intel {honest,pred,called,coin}`; `sealed.called`; `brain.forget(f)`; `beginRun({days})`; `meta.memory.favorites/counters/tauntBag`; `offer.choices` of length 4 (Dealer's Thumb); `payoff` should already include tension, focus/fortify, hit cap and Called Shot, and state whether guard-break value is included (brain adds 0.86 only if not).
- **Third active:** I used `coin_of_fools` (kind `coin`) and made the "top guess" boon passive; `INTERFACES.md` anticipates an active `guess` kind — swap if the lead prefers three pure-information actives.
- **The Rival "dies" six times:** I made duels 1–6 end in a yield, not a death, so the fiction of one persistent nemesis holds.
