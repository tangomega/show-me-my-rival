# Show Me My Rival

**Developed by tangoSHELL · 2026**

A turn-based, dark-fantasy roguelite duel in animated pixel art, made for a phone held upright. Every run you fight the same masked duelist. It remembers how you play, across every run you have ever started, and it tells you so.

The whole game is one self-contained file, `index.html`: code, pixel art and procedural audio are all inline. It makes no network requests and plays offline.

## How to play

Each turn you and the Rival secretly pick one of three moves.

| Move | Beats | Effect when it wins |
|---|---|---|
| **Strike** | Feint | 3 damage |
| **Guard** | Strike | 2 damage (a riposte) |
| **Feint** | Guard | 2 damage and a **guard break**: the loser cannot Guard next turn |

- **Same move = a clash.** No damage, but a tension pip lights. The next hit that lands deals +1 per pip. At three pips the duel is in *Deathblow*; clash again there and both fighters take 1 (a *Rupture*).
- **The Rival always commits first.** Its sealed sigil drops before your buttons light up, and both sigils crack open at the same instant. Nothing you tap can change or read its choice.
- **Read the stance.** Before you pick, the Rival takes a stance that hints at its move, and the game names it for you. Early in a run the stance is honest. Later it lies, and it lies more the more you believe it.
- **A run is seven duels** with a bonfire between each. Your health is one pool for the whole run (26, with a small heal at each fire). At the bonfire the Rival drafts a boon *first*, you see what it took, then you pick one of three.
- **The seventh duel has more than one phase.** At first it is The Unmasked: the mask breaks and the Rival calls your move out loud on some turns. Beat that and other faces start to appear, with up to four phases (see below).
- Tap the small ledger button under the tension pips to read both fighters' boons mid-duel, and to toggle sound.

The first duel teaches all of this in under 30 seconds, with the Rival doing the teaching.

## How the Rival learns

- **An ensemble of habit trackers.** Thirteen small predictors each watch one thing: your overall favourite move, what you play after a given move or pair of moves, what you do after winning, losing or clashing, at low health, on the first turn of a duel, in response to its last move, at each tension level, with your guard broken, and how you respond to its stance. Each keeps decaying counts, so a habit you break fades within a couple of dozen turns.
- **The predictors compete.** Those that have recently predicted you well get more say (multiplicative weights). The result is a probability for each of your moves.
- **It plays the best response, sometimes.** With a probability that rises across the run (30% in duel 1, 100% by duel 7) it picks the move and stance with the best expected result against that prediction. Otherwise it plays a near-equilibrium random mix, so it is never perfectly predictable itself.
- **Stances are part of the model.** It tracks whether you counter the stance, mirror it or defy it, and lowers its honesty the more you trust it.
- **Everything persists** in `localStorage`: the model, your lifetime record, unlocks, settings, and the run in progress (including the Rival's sealed choice for the current turn, so reloading cannot reroll it).
- **The Dossier** shows what it has learned, in its own voice, with real numbers from the model. To win consistently you have to break the habits listed there.

## Balance

Measured by `tools/sim.js`: bot players, 8 chains of 400 sequential runs each, one persistent Rival per chain. Full tables are in [BALANCE.md](BALANCE.md).

| Player | Run win rate |
|---|---|
| Always Guard | 0% |
| Fixed Strike → Guard → Feint cycle | 0% |
| Win-stay / lose-shift | 0.2% |
| Always trusts the stance | 0% |
| A realistic creature of habit | 9.8% (16% in the first ten runs, then 9–10%) |
| Uniform random | 21.6% |
| Equilibrium mixer (unpredictable, ignores stances) | 34.8% |
| Adaptive stance-reader | 54.8% |

Duels last about seven turns; a winning run is about fifty.

## The Vigil (harder runs)

Seven lights keep watch over you. Each win with every earned light out earns the right to put out the next, and each light you put out hands the Rival what it guarded. You set the Vigil on the relic screen by tapping the candles; the rules stack.

| Light | When it is out |
|---|---|
| 1. The Benefit of the Doubt | It acts on what it knows one duel sooner |
| 2. The Kinder Fire | Bonfires heal 4, not 6 |
| 3. The Honest Face | Its stances start lying one duel sooner |
| 4. The Empty Hand | It arrives with a boon already drafted (shown to you) |
| 5. A Moment's Peace | No healing between the phases of the last duel |
| 6. The Glass Jaw | It has +1 health in every fight |
| 7. The Unsaid | It calls your move out loud in every duel |

Run win rate by lights out (8 chains of 300 runs per bot):

| Lights out | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Adaptive stance-reader | 55 | 54 | 48 | 40 | 32 | 30 | 21 | 20 |
| Equilibrium mixer | 35 | 33 | 24 | 24 | 18 | 16 | 10 | 8 |
| Creature of habit | 10 | 8 | 7 | 4 | 2 | 2 | 1 | 0.5 |

Lights 1, 3 and 7 make the Rival sharper rather than tougher, so they cost a predictable player far more than an unpredictable one.

## The faces at the altar (final bosses)

It is always the same duelist, but the seventh duel has four possible faces. Beating one for the first time earns the next; after that each run draws one of those you have earned (never the same twice running) and names it at the start of the run and again at the last bonfire, so you can draft for it.

| Face | Phases | What changes |
|---|---|---|
| **The Unmasked** | 2 | The mask breaks. Tension never drops below one pip, and it calls your move aloud. |
| **The Three-Faced** | 3 | *The Jester* lies often, and a lying stance makes the winner's hit +1. *The Mourner* ripostes harder and shrugs off its first wound. *The Blank* shows no stance at all. |
| **The Hours** | 4 | Four short fights as the night passes. Each bell raises the tension floor by one, so the last phase is all Deathblows. The arena turns from night to blood moon to dawn. |
| **The Reflection** | 3 | *The Borrower* holds a copy of your boons. *The Likeness* takes your shape and picks its moves the way its model says you would. The last phase does both. |

Chance of winning the final duel once you reach it (8 chains of 300 runs per bot, no lights out):

| | Unmasked | Three-Faced | Hours | Reflection |
|---|---|---|---|---|
| Adaptive stance-reader | 70% | 72% | 71% | 75% |
| Equilibrium mixer | 64% | 64% | 61% | 61% |
| Uniform random | 51% | 54% | 50% | 55% |
| Creature of habit | 23% | 24% | 16% | 32% |

Every face still seals its move before your buttons light up. With all seven lights out the three newer faces are harder on an unpredictable player than The Unmasked is (about 31% against 39%), because the extra health and the missing heals apply once per phase.

## Design highlights

- **Fair by construction.** The sealed commit lives where the input code cannot reach it, and an automated test replays hundreds of mid-turn reloads to confirm the committed move never changes.
- **36 boons and 6 starting relics** across eight archetypes (riposte, tension, bleed, trickster, gambler, information, chaos, executioner), several of which reward playing unpredictably or punish repeating yourself.
- **Counter-drafting.** The Rival picks its boon to punish your most-used move and says why.
- **Meta-progression adds options, not stats:** new boons, relics, four alternate masks and two arena palettes, unlocked by feats (and by failures).
- **386 taunt lines** tagged by context, plus a dossier written in the Rival's hand.
- **Pixel art drawn in code.** A 32-colour palette, sprites stored as palette-indexed rows, fighters composited from parts into frame-by-frame animations, rendered at 180 px wide and integer-scaled with nearest-neighbour.
- **Procedural audio** through the Web Audio API: 26 sound effects and 7 music cues, including a boss theme that escalates for phase two.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
node tools/serve.js
```

then visit http://localhost:4173 (use your browser's phone emulation for the intended layout).

## Put it on your phone with GitHub Pages

The code lives at https://github.com/tangomega/show-me-my-rival and is meant to be played at **https://tangomega.github.io/show-me-my-rival/** (on the phone, use "Add to Home Screen" for a full-screen icon).

To host your own copy:

1. Create a new **public** repository on github.com (no README, no licence) and push this folder's `main` branch to it.
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save.**
3. After a minute the game is at `https://YOUR-NAME.github.io/REPO-NAME/`.

## Develop

| Command | What it does |
|---|---|
| `node tools/build.js` | Inlines `src/` into `index.html` |
| `node tools/check.js` | Fails if the build could make any external request or lacks the credit |
| `node tools/test_brain.js` | Rival AI tests and learning benchmark |
| `node tools/test_combat.js` | Rules, all 42 boons/relics, and a 3,000-run smoke sim |
| `node tools/test_flow.js` | Plays 200 full runs through the real scenes with random reloads |
| `node tools/test_audio.js` | Audio graph tests against a mock Web Audio context |
| `node tools/sim.js --seeds 8` | The balance sim |

Source layout, module contract and design are in [INTERFACES.md](INTERFACES.md), [DESIGN.md](DESIGN.md) and [PROGRESS.md](PROGRESS.md).

## Not yet verified on a real device

Built and tested in a desktop browser at phone sizes. Still to check on actual hardware: the iOS audio unlock and mute, haptics, notch and home-bar insets, pinch and double-tap zoom suppression in Safari, and frame rate on a mid-range phone. The audio mix has passed automated graph tests but has not been listened to.
