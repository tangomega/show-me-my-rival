# SHOW ME MY RIVAL — module contract

This is the binding contract between modules. `DESIGN.md` says *what* the game is; this file says *how modules talk*. If you need something that is not here, implement it inside your own file and report it; do not change another module's signature.

## Ground rules

- One global namespace. Every file is a plain script wrapped like this (no ES modules, no bundler, no dependencies):
  ```js
  (function (R) {
    'use strict';
    // ...
    R.Thing = { ... };
  })(globalThis.RIVAL = globalThis.RIVAL || {});
  ```
- **Pure modules** (`core/rng.js`, `ai/brain.js`, `game/*.js`) must run under plain Node: no `window`, `document`, `localStorage`, `Date.now()` (time is passed in), or `Math.random()` (an `rng` is passed in). The headless sim `require`s them in order and reads `globalThis.RIVAL`.
- All persisted state (brain, meta, run, duel) is **plain JSON**: no functions, class instances, Maps, or cycles. Boon behavior is looked up by id at call time.
- Moves are the strings `'S'` (Strike), `'G'` (Guard), `'F'` (Feint). `R.MOVES = ['S','G','F']`, `R.BEATS = {S:'F', G:'S', F:'G'}` (key beats value), `R.LOSES_TO = {S:'G', G:'F', F:'S'}` (key loses to value). Defined in `core/rng.js`.
- Sides are `'p'` (player) and `'r'` (Rival).
- ES2018 syntax is fine. No per-frame allocations in update/draw hot paths (pool particles, reuse arrays).
- Never throw on bad input from storage; fall back to defaults.
- Target devices: mobile Safari/Chrome. Internal resolution is 180 wide.

## Build order (tools/build.js concatenates in this order)

```
core/rng.js  core/save.js
art/palette.js  art/pix.js  art/font.js  art/sprites.js  art/icons.js  art/backgrounds.js  art/ui.js  art/fx.js
audio/audio.js
text/strings.js  text/taunts.js  text/dossier.js
ai/brain.js
game/boons.js  game/combat.js  game/run.js
core/engine.js
scenes/*.js (alphabetical)
main.js
```

---

## R.RNG — `src/core/rng.js` (pure)

```
R.RNG.create(seed:uint32) -> rng
  rng.next() -> [0,1)        rng.int(n) -> 0..n-1        rng.range(a,b) -> float
  rng.chance(p) -> bool      rng.pick(arr) -> item       rng.weighted(weights[]) -> index
  rng.shuffle(arr) -> arr (in place)                     rng.state() -> uint32 ; rng.setState(u)
R.RNG.hash(str) -> uint32
```

## R.Save — `src/core/save.js`

```
R.Save.init(storageLike|null)     // pass window.localStorage inside try/catch; null => in-memory
R.Save.data                       // live object, schema below
R.Save.commit() -> bool           // write now; true when the save reached storage; try/catch; never throws
R.Save.reset()                    // wipe to defaults and commit (does nothing in a stale tab)
R.Save.stale                      // true once another tab has saved since this one loaded: nothing is written until a reload
R.Save.check() -> bool            // re-reads the generation; true = stale. Never writes
R.Save.changedElsewhere()         // a storage event from another tab: stale (only when this tab has storage)
R.Save.KEY, R.Save.GEN_KEY        // 'rival.save.v1', 'rival.save.v1.gen'
```
Schema (key `rival.save.v1`):
```
{ v:1,
  settings:{ muted:false, haptics:true, mask:'porcelain', arena:'cathedral' },
  brain:null|object,   // owned by R.Brain (serialize())
  meta:null|object,    // owned by R.Run   (defaultMeta())
  run:null|object,     // owned by R.Run   (mid-run state incl. current duel)
  parked?:object }     // a run saved under newer rules (run.req > R.Run.RULES): kept, never played or counted
```
- **Generation (stale-tab guard).** `rival.save.v1.gen` holds a decimal integer string (1-9 digits; after 999999999 comes 1). It is written only after a successful save write, as the generation this tab last read or wrote plus one. A tab whose next save finds a different generation, or that receives a storage event for either key, is stale: it writes nothing (commit returns false, reset erases nothing) and reboots from storage on its next tap, key press or return to view (`R.Game.reboot`), or at its next seal. The duel scene never shows Rival information it could not save: it checks `R.Save.stale || R.Save.check()` before `brain.commit` and reboots instead of sealing; it reboots before the stance shows if the seal's own save finds the tab stale; it reboots before the presentation if the resolve's save finds the tab stale (the reboot replays the saved seal unresolved); and it checks before an active boon (Keyhole, Candle of Truth) is spent. The tap listener also calls `R.Save.check()`, so a tap after another tab saved with no storage event is swallowed too. The tap that reboots is swallowed, so it cannot pick a move in the old state. A commit whose text equals what storage already holds writes nothing and takes no new generation. No storage, or a generation that cannot be read, is memory-only and never stale; the in-memory copy stands in only when storage cannot be read at all.
- **Top-level keys.** `Save.repair` keeps top-level keys it does not know (such as `parked`), so an older build does not drop a newer build's data. A new top-level key must tolerate that.
- **Never revert past train 0.** From P1.1 on, a brain is reload-exact and runs carry `req`; older builds read these saves, but rolling the live game back past P1.1 loses those guarantees.

## R.Brain — `src/ai/brain.js` (pure)

```
R.Brain.create(serialized|null) -> brain  // a non-object gives a fresh brain; each field is sanitised, unknown keys dropped
brain.serialize() -> object              // the save (schema below); canonical, so it is a byte fixed point
brain.beginRun({ days })                 // run-start decay (stronger if days >= 7); resets per-run tracking
brain.commit(q) -> sealed
brain.predict(ctx, legalP) -> {S,G,F}    // tell-independent habit-only ensemble; the game uses it for the Called Shot call only.
                                         // The Stolen Ledger shows sealed.top, which is conditioned on the shown tell and blended toward
                                         // equilibrium, so the two can differ (a fresh brain's predict is uniform, while its
                                         // sealed.top follows the equilibrium mix: Guard on an opening turn)
brain.observe(ctx, tell, pm, rm)         // call once per resolved turn, AFTER reveal (skipped for forced tutorial turns)
brain.trust() -> 0..1                    // smoothed COUNTER share (how much the player believes stances)
brain.honesty(honestyBase) -> 0..1       // the h it would use right now (for the Liar's Tally boon)
brain.forget(f)                          // Ash of Forgetting: decayed tables *= f, weights halfway to uniform
brain.runScore() -> 0..100               // this run's predictability score
brain.dossier() -> dossier
brain.habitFor(ctx) -> stat|null         // strongest shown-able habit relevant to this context
brain.runInsights() -> stat[]            // up to 3, for the death/victory screen
```
`q = { ctx, payoff, legalR:[move], legalP:[move], exploit:0..1, honestyBase:0..1, rng, force?:{move?, tell?}, noTell?:bool, mimic?:ctx }`
(`force` is for the scripted tutorial only. `noTell`: no stance is shown (The Blank), so the stance is forced honest and carries nothing. `mimic`: the context from the Rival's seat, `R.Combat.ctx(duel, 'r')`; it samples its move from what it predicts the player would play in that seat (The Reflection).)

`sealed = { move, tell, honest:bool, pred:{S,G,F}, top:move, confidence:0..1, mode:'exploit'|'mix'|'mimic' }`
- `pred` = predicted probability of each player move given ctx **and the tell it chose to show**; `top` = argmax.
- The duel scene keeps `sealed` as a local of its turn coroutine; input handlers only set the player's choice, and the Keyhole / Candle of Truth reveals read it through a scene closure. `sealed` is also saved in `run.pending` (localStorage `rival.save.v1`) for the whole input window, so a reload replays it; no backup, share or seed code may contain `run` or `run.pending`. `commit` must never be given the current-turn player move, and `observe` is the only place it learns it.

`ctx` (built by `R.Combat.ctx(duel)`):
```
{ duel:1..7, phase:1..4, turn:int>=1,
  prev1:move|null, prev2:move|null,   // player's last two moves this duel
  prevR:move|null,                    // Rival's last move this duel
  last:'W'|'L'|'C'|null,              // last exchange from the player's view
  pHp, pMaxHp, rHp, rMaxHp, tension:0..3,
  pBroken:bool, rBroken:bool }        // guard broken this turn
```
`payoff[rm][pm]` = number, the value to the Rival of that one exchange as known at the seal, from `R.Combat.payoff(duel)`, called after `duel.intel.called` is set and before `brain.commit`: damage dealt minus damage taken plus the Rival's heals minus the player's, from a simulated resolve with tension pips, focus/fortify, boon damage and heal hooks, hit cap and Called Shot terms applied, plus guard-break value (±0.86 per break turn inflicted) and lethal bonus (±8). Hooks that read `intel.honest`, `intel.pred` or `intel.coin` are not priced: at the seal they are `null`, `null` and `false`; `intel.called` is priced (DESIGN ruling 5). Effects on later turns are worth 0. Illegal cells are present but ignored (the brain only reads `legalR × legalP`). The brain adds nothing to it.

`stat = { id, kind:'habit'|'tell'|'record', move:move|null, pct:0..100, n:int, strength:0..1, vars:{...} }`
`dossier = { samples:int, predictability:0..100, favorite:move|null, tell:{counter,mirror,under,n}, stats:stat[] (strongest first), broken:stat|null }`
Stat ids are the ones listed in DESIGN.md "Dossier stats"; `R.Text.dossierLine(stat)` turns one into a sentence.

Save (`brain.serialize()`, format `v:1`):
```
{ v:1, n:int, runs:int,
  w:[13 numbers, 4 dp, each >= 0.0001],       // Hedge weight per expert slot
  c:[13 arrays, 3 dp], life:[13 int arrays], run:[13 int arrays],   // decayed / lifetime / this-run counts
  t2:0..2, ema:4 dp, rs:3 dp, rn:int,
  pk:{ id:{k,m,p,r,s} } }                     // habit peaks, keys in the fixed order of brain.js PEAK_IDS
```
- **Reload-exact.** create, observe, beginRun and forget end by rounding the live state to the precision the save holds (`quant()`, never run by commit or a read), and every key is written in one fixed order. So `R.Brain.create(JSON.parse(JSON.stringify(b.serialize())))` agrees with `b` bit for bit in every later output, and `serialize(create(serialize(b)))` is byte-identical to `serialize(b)`. This holds for any input create accepts, a hand-edited save included: a loaded field never holds -0, a weight is never rounded below 0.0001, and load keeps the stored weights only when their rounded sum is within 0.01 of 1 (otherwise it renormalises; a `w` with a sum that overflows is ignored). Any new map in the save must also be written in a fixed order. Tested in tools/test_brain.js sections 3-3c, which also load saves written by earlier builds.
- **Expert layout (frozen).** Slot e of `w`, `c`, `life` and `run` is expert e, in the order E0-E9, T0, T1, T2, with tables of 3, 9, 27, 9, 27, 6, 3, 9, 12, 12, 3, 9, 9 numbers. `w` is always written as exactly 13 numbers (load ignores a `w` of any other length). A future expert never takes or shifts a slot: its weight goes in a side key of the brain object (`wa`), and its tables are appended after index 12 in `c`, `life` and `run`. Slots are only ever appended, never inserted or reordered. A save without the new expert loads with that expert at its start state, and the 13 stored weights keep their ratios to one another.

## R.Boons — `src/game/boons.js` (pure)

```
R.Boons.list -> boon[]        R.Boons.byId[id] -> boon
boon = { id, name, desc,            // desc = exact mechanical effect, <= 60 chars
         rarity:'common'|'uncommon'|'rare', who:'both'|'player'|'rival',
         relic:bool, tags:[string], unlock:null|unlockId,
         active:null|{ charges:int, kind:'glimpse'|'honesty'|'guess'|string },
         hooks:{ duelStart?, turnStart?, outDamage?, inDamage?, afterExchange?, onClash?, onLethal?, onRest?, onDraft? } }
```
Hook signature: `fn(x)` where `x = { duel, self, foe, side:'p'|'r', my:move, their:move, dmg:number, won:bool, lost:bool, clash:bool, tension:int, events:[] }` (fields that do not apply are undefined). `outDamage`/`inDamage` return the new damage number. Hooks push presentation events into `x.events`.

## R.Combat — `src/game/combat.js` (pure)

```
R.Combat.newFighter(maxHp, hp, boonIds) -> fighter
  fighter = { hp, maxHp, boons:[id], status:{ guardBroken:0, bleed:0, fortify:0, focus:0, sealed:{S:0,G:0,F:0} },
              counters:{}, charges:{boonId:int}, moves:[move...] (this duel), results:['W'|'L'|'C'...] }
R.Combat.newDuel({ n, phase, p:fighter, r:fighter }) -> duel   // runs duelStart hooks
  duel = { n, phase, turn:1, tension:0, p, r, over:null|'p'|'r' (winner), pendingEvents:[],
           intel:{ called:move|null, honest:bool|null, pred:{S,G,F}|null, coin:bool } }
  // duel.intel is written by the duel scene: `called` on Called Shot turns (R.Combat.callsOf(duel) && turn % 3 == 2, never on a
  // tutorial beat), before payoff and commit; `coin` by useActive during the player's window; `honest`, `pred` and `coin`
  // right before resolve(). resolve() resets it afterwards, so payoff() sees only `called`. callsOf(duel) is true in the
  // Unmasked's phase 2, in any phase whose row sets calls, and in every duel with light 7 out (R.Run sets duel.calls).
R.Combat.legal(duel, side) -> [move]            // never empty
R.Combat.ctx(duel) -> ctx                        // for R.Brain
R.Combat.payoff(duel) -> payoff[rm][pm]          // pure preview, no mutation
R.Combat.beginTurn(duel) -> event[]              // turnStart hooks, bleed ticks; may set duel.over
R.Combat.resolve(duel, pm, rm) -> result         // mutates duel, advances duel.turn
R.Combat.useActive(duel, boonId) -> { ok:bool, kind }   // spends a charge; the scene performs the reveal
```
```
result = { turn, pm, rm, winner:null|'p'|'r', clash:bool,
           dmgP, dmgR,            // damage taken by player / by Rival this exchange
           healP, healR,
           tensionBefore, tensionAfter, deathblow:bool,
           guardBreak:null|'p'|'r',   // whose guard was broken
           events:[event], over:null|'p'|'r' }
event  = { t:'boon'|'status'|'heal'|'dmg'|'saved'|'bleed'|'charge'|'note', side:'p'|'r', id?:string, n?:number, text?:string }
```

## R.Run — `src/game/run.js` (pure)

```
R.Run.DUELS            // per-duel table: [{ rivalHp, exploit, honesty, ... }] index 1..7, plus .phase2
R.Run.UNLOCKS          // [{ id, type:'boon'|'relic'|'mask'|'arena', ref, name, how (condition text), check(meta, run, outcome) }]
R.Run.defaultMeta() -> meta
  meta = { unlocked:{id:true}, seenCredits:false, seenTutorial:false,
           counters:{ deathblows, bleedDealt, reads, guardBroken, drafts, liesCaught },
           memory:{ runs, wins, deaths, streakW, streakL, bestDuel, closestLoss:null|{duel,rivalHp}, fastestDeath:null|{duel,turns},
                    lastWin:null|{move,hp,run,ts}, lastPlayed:ts|0, firstPlayed:ts|0, lastFavorite:move|null, totalTurns } }
R.Run.relics(meta) -> boon[]                          // unlocked starting relics
R.Run.pool(meta, side) -> boon[]                      // draftable boons for that side
R.Run.create(meta, { seed, relicId|null, now, stake, anyStake, boss, anyBoss, dossier }) -> run
  run = { seed, rngState, duelN:1, phase:1, stage:'duel'|'bonfire'|'won'|'dead',   // rngState: the offer + Rival-draft stream only (not the Rival's dice; reloads are safe because of pending)
          pHp, pMaxHp, pBoons:[id], rBoons:[id], duel:null|duel,
          offer:null|{ rivalPick:id, rivalWhy:null|'G'|'S'|'F'|'repeat'|'predictable'|'trust'|'tags', choices:[id x3..4], healed:int },
          pending:null|{ sealed, turn, n, phase, called, seen_glimpse?, seen_honesty? },   // the Rival's commit for the current turn, saved before the buttons light (a reload replays it, never re-rolls it); seen_* = a Keyhole / Candle of Truth reveal already shown
          relicId:null|id,
          stats:{ turns, moves:{S,G,F}, wins, losses, clashes, reads, surprises, liesCaught, duelTurns:[...], flags:{} } }
R.Run.startDuel(run) -> duel                          // sets run.duel
R.Run.startPhase2(run) -> duel                        // final duel only; keeps the player fighter, heals R.Run.PHASE2_HEAL
R.Run.record(run, meta, result, sealed)               // per-turn stats + lifetime counters (reads, surprises, lies caught...)
R.Run.endDuel(run, meta, winner, dossier) -> void     // winner 'p': heal + build offer (stage 'bonfire') or stage 'won'; 'r': stage 'dead'
R.Run.pick(run, boonId)                               // player drafts; run.duelN++, stage 'duel'
R.Run.finish(run, meta, now) -> { unlocks:[unlock], firstWin:bool }   // updates memory + unlocks
```

Added after ship (the Vigil and the faces of the final duel):

```
meta.vigil  = { max, sel, wins:[8] }                  // lights earned, lights chosen, wins per number out
meta.bosses = { max, wins:{id:n}, last:id|null }      // faces earned (BOSSES order), wins per face, last run's face
run.stake, run.rivalHead, run.boss                    // lights out, The Empty Hand's boon, the face in duel 7
R.Run.create(meta, { ..., stake, anyStake, boss, anyBoss, dossier })
R.Run.VIGIL            // [{ id, name }] x7             R.Run.VIGIL_TUNE   { healCut, hp, callsFrom }
R.Run.BOSSES           // [{ id, name, phases:[{ name, hp, exploit, honesty, heal, floor, calls, stance, mimic, innate,
                       //    fortify, copyBoons, who, mask, arena, witch, music, change, cards }] }]
R.Run.cfg(run, duel) -> row                           // numbers after the Vigil + this phase's rules and look; use instead of DUELS
R.Run.bossOf(run) / phaseCount(run) / stakeOf(run) / lightsOut(run) / healOf(run)
R.Run.startPhase(run, k) / nextPhase(run) -> duel     // startPhase2(run) is startPhase(run, 2)
R.Run.finish(...) also returns { light: 0..7, face: id|null }
duel.floor, duel.calls, duel.stance, duel.mimic       // set by R.Run; read with R.Combat.floorOf(duel) / callsOf(duel)
R.Combat.ctx(duel, 'r')                               // the same picture from the Rival's seat
brain.commit({ ..., noTell:true })                    // no stance is shown; honest is forced true after the honesty draw (same dice count)
brain.commit({ ..., mimic: ctxFromRivalSeat })        // it plays as the player would; the payoff is still passed but not used to pick the move
```

Save safety (P1.1, train 0):

```
R.Run.RULES            // the rules this build plays (0); read at call time
run.req                // the rules a run was made under (stamped by create); a build with RULES below it parks the run
R.Run.reqOf(run) -> int                               // 0 for a run from before run.req, or a garbage value
R.Run.bossIndex(id) -> index | -1
R.Run.repairRun(run, meta) -> { redrawn, restart }    // in place, at load: a face this build does not know is redrawn
                       // from the earned faces (its own seeded stream) and becomes meta.bosses.last; at duel 7 that,
                       // or a phase past the face's count, restarts the final duel at phase 1 (no duel, no pending)
R.Run.startPhase(run, k, { rebuild:true })            // rebuild phase k of a stored final duel whose duel was dropped
                       // (an older shape): no second phase heal, no heal event; the scene plays it as resumed
meta.bosses.hi, meta.vigil.hi, meta.vigil.winsX       // high-water shadows of bosses.max, vigil.max and wins past the
                       // light table; never clamped or dropped, so an older build cannot lower what a newer one reads
```

## R.Engine — `src/core/engine.js` (DOM)

```
E = R.Engine
E.W = 180 ; E.H (320..400, set at init/resize) ; E.safe = { top, bottom } (internal px)
E.init(canvas) ; E.start()
E.scene(name, def)          // def: { enter(args), exit(), update(dt), draw(g), down(x,y), up(x,y), move(x,y), back() }
E.go(name, args, fadeSec=0.25)       // fade out, swap, fade in; clears the old scene's timers/coroutines
E.time                      // seconds since scene enter (scaled)
E.timeScale = 1             // slow motion: affects dt, timers, coroutines
E.hitStop(sec)              // freezes update (not draw) for sec of real time
E.shake(px, sec) ; E.flash(palIndex, sec)
E.after(sec, fn) -> id ; E.cancel(id)
E.co(generatorFn) -> { cancel(), done }   // coroutine: `yield 0.3` waits seconds (scaled); `yield fn` waits until fn() is truthy
E.tween(obj, key, to, sec, ease?) -> can be yielded-on via its .done flag
E.buzz(pattern)             // navigator.vibrate, respects settings.haptics, fails silently
E.paused                    // true while the document is hidden, after pagehide and after blur; cleared, once the page is visible, by
                            // visibilitychange, focus, pageshow, a key or a tap; loop + audio suspended while true
```
- Rendering: scenes draw to the 180×H buffer `g`; the engine blits it to the visible canvas at an integer scale of device pixels with smoothing off; letterbox is black. dt is clamped to 50 ms.
- Input: pointer events mapped to internal coordinates; multi-touch ignored (first pointer only); context menu, selection, scroll, pinch and double-tap zoom are suppressed in the HTML/CSS shell.
- The first pointerdown anywhere calls `R.Audio.init()`.

## R.Pal / R.Font / R.Art / R.UI / R.FX — `src/art/*`

```
R.Pal.hex[i]  -> '#rrggbb' (i = 1..31; 0 is transparent)     R.Pal.C -> { name: index }
R.Font.draw(g, text, x, y, palIndex, opts?)   // opts: { align:'left'|'center'|'right', scale:int, shadow:palIndex }
R.Font.width(text, scale=1) -> px ; R.Font.wrap(text, maxPx) -> lines[] ; R.Font.lineH (= 9)

R.Art.init()                                             // builds cached canvases from palette-indexed data
R.Art.anim(who, name) -> { n, dur:[ms], loop:bool, total:ms } | null     // who: 'player'|'rival'|'rival2'
R.Art.frameAt(anim, ms) -> frame index
R.Art.fighter(g, who, name, frame, x, y, opts?)          // x,y = feet centre; opts: { flip, mask:id, white:bool, alpha }
R.Art.sprite(g, name, x, y, opts?)                       // static sprites and icons; opts: { flip, frame }
R.Art.sigil(g, x, y, state, move, side)                  // state: 'sealed'|'crack'|'open'|'gone'
R.Art.bg(g, name, t, opts?)                              // 'cathedral'|'bonfire'|'title'; opts: { variant, gutter:0..1, phase2:bool }
R.Art.fg(g, name, t, opts?)                              // foreground layer drawn over the fighters

R.UI.panel(g, x, y, w, h, style?)                        // 'stone'|'dark'|'card'
R.UI.button(g, x, y, w, h, label, st?)                   // st: { pressed, disabled, icon:move, glow, accent:palIndex }
R.UI.bubble(g, x, y, w, lines[], tailX, tailDir)         // speech bubble, tailDir 'up'|'down'
R.UI.bar(g, x, y, w, h, frac, lagFrac, palIndex)         // HP bar with lagging chunk
R.UI.hit(px, py, x, y, w, h) -> bool

R.FX.create(max=256) -> fx
  fx.burst(kind, x, y, n, opts?)   // kind: 'spark'|'blood'|'ash'|'ember'|'shard'|'dust'|'heal'; opts: { dir, spread, speed }
  fx.ambient(kind, perSec) ; fx.update(dt) ; fx.draw(g) ; fx.clear()
```
Animation names (both fighters): `idle, tell_S, tell_G, tell_F, strike, guard, feint, hit, stagger, clash, death, taunt, taunt2, victory`; Rival only: `transform`; `'rival2'` has the same set for phase 2.

### Art conventions the scenes rely on

- **All fighter sprites are authored facing RIGHT.** The scene passes `opts.flip = true` for the Rival (it stands on the right, facing left). `x,y` is the feet-centre anchor; flipping mirrors around that x.
- `R.Art.frameAt(anim, ms)` clamps to the last frame when `ms >= anim.total` (the scene does its own modulo for loops).
- Tell anims (`tell_S/G/F`) are 5 frames: 3 wind-up frames then 2 hold frames; the scene loops the last two (380 ms each) for as long as the player thinks.
- `R.Art.fighter(..., opts)`: `opts.white` draws the whole silhouette in palette 23 (hit flash); `opts.mask` is a mask id (`porcelain|mourner|jester|kintsugi|blank`), Rival only; unknown anim/mask falls back silently (never throws).
- `R.Art.sprite(g, name, x, y)` draws at top-left x,y and **silently draws nothing for an unknown name**. Names used by scenes:
  - move icons `icon_S, icon_G, icon_F` (10×10), `icon_S_big, icon_G_big, icon_F_big` (20×20), `mini_S, mini_G, mini_F` (6×6)
  - statuses (8×8) `st_guardBroken, st_bleed, st_fortify, st_focus, st_sealed`
  - active-boon icons (12×12) `act_glimpse, act_honesty, act_coin`
  - archetype tag icons (12×12) `tag_RIP, tag_TEN, tag_BLD, tag_TRK, tag_GMB, tag_INF, tag_CHA, tag_EXE, tag_relic`
  - rarity pips `rar_common, rar_uncommon, rar_rare` (up to 11×3)
  - menu art `title_mask` (large, about 64×64), `logo` (two-line wordmark: small "SHOW ME MY" above a large "RIVAL", about 120×34), `bonfire_player`, `bonfire_rival` (seated figures, about 32×32), `lock` (8×8), `mask_porcelain, mask_mourner, mask_jester, mask_kintsugi, mask_blank` (12×14 previews)
- `R.Art.bg(g, name, t, opts)` paints the whole 180×E.H buffer. For `'cathedral'`, `opts.floorY` is the y of the floor line (fighters' feet); the image is anchored there and extends up to y=0 and down at least 40 px. `opts.variant` = duel number 1..7, `opts.gutter` 0..1 dims the candles, `opts.phase2` switches to witchfire, `opts.arena` = `'cathedral'|'blood_moon'|'pale_dawn'`. For `'bonfire'` and `'title'`, `opts.floorY` is likewise the ground line.
- `R.Art.sigil(g, x, y, state, move, side)`: x,y top-left of a 16×16 cell; `state:'open'` with `move` shows that move's icon, `'crack'` is animated by the artist from an internal clock or drawn as one cracked frame.
- `R.UI.bar(..., palIndex, opts?)`: `opts.ticks` = max HP (draw a notch per HP), `opts.flip` drains toward the left edge instead of the right.
- `R.UI.button(..., st)`: `st.icon` is a move letter (draws `icon_*_big` above the label when the button is tall enough) or a sprite name; `st.broken` overlays the cracked "not legal this turn" mark; `st.glow` pulses the frame; `st.accent` is a palette index for the move colour stripe.
- `R.UI.bubble(g, x, y, w, lines, tailX, tailDir, opts?)`: height follows `lines.length` (1–3 lines of 9 px + padding); `opts.phase2` uses the inverted void/witchfire style.

## Scenes

Scene files register with `R.Scenes = R.Scenes || {}; R.Scenes.<name> = def;` and never call `E.scene` themselves; `main.js` registers every entry at boot. Scene defs may also implement `key(k)` (desktop testing), `pause()` and `resume()`.

## R.Audio — `src/audio/audio.js`

```
R.Audio.init() ; R.Audio.setMuted(b) ; R.Audio.suspend() ; R.Audio.resume()
R.Audio.sfx(name, opts?)      // opts: { vol, pitch }
R.Audio.music(name|null, fadeSec=1)   // 'title'|'drone'|'bonfire'|'boss'|'boss2'|'death'|'credits'
R.Audio.heartbeat(bpm|0)
```
Everything is a safe no-op before `init()` or when Web Audio is missing. SFX names:
`whoosh_s, whoosh_f, guard_up, hit, clang, clash_s, clash_g, clash_f, guard_break, seal, crack, tick, select, back, heal, boon, rival_draft, deathblow, final_blow, you_died, phase2, bell, type, unlock, step, ember`

## R.Text — `src/text/*.js`

```
R.Text.taunts[category] -> [template]            // categories from DESIGN.md
R.Text.taunt(category, vars, rng) -> string|null // fills {vars}, avoids recent repeats, null if none usable
R.Text.fill(template, vars) -> string
R.Text.dossierLine(stat) -> string               // mocking sentence for a brain stat
R.Text.move(m) -> 'Strike'|'Guard'|'Feint'
R.Text.boon[id] -> { name, flavor }              // overrides R.Boons name for display
R.Text.ui -> { key: string }                     // all menu/UI strings
```

## R.Game — `src/main.js` (flow controller, owned by the lead)

```
R.Game.brain ; R.Game.meta ; R.Game.run (null when no run is in progress)
R.Game.rng                       // gameplay rng (Rival decisions, coin). Never use it for cosmetics.
R.Game.crng                      // cosmetic rng: taunt picks, particles, menu flourishes
R.Game.days                      // whole days since the previous visit (0 on the first)
R.Game.hasRun() -> bool
R.Game.startFlow()               // title's main button: resume() if hasRun(), else 'relic' scene if any relic is unlocked, else newRun(null)
R.Game.newRun(relicId|null)      // creates the run, brain.beginRun, saves, goes to 'duel'
R.Game.resume()                  // continues a saved run at its stage ('duel' or 'bonfire')
R.Game.duelOver(winner)          // called by the duel scene; routes to 'bonfire' / 'victory' / 'death'
R.Game.draft(boonId)             // called by the bonfire scene; applies the pick, saves, goes to 'duel'
R.Game.save() -> bool            // serializes brain + meta + run into R.Save and commits; false in a stale tab
R.Game.reboot()                  // a stale tab: reload the save as a fresh page would and cut to 'title'
R.Game.vars(extra?) -> object    // template variables for R.Text.taunt: runs, deaths, wins, days, streak, duel,
                                 // bestDuel, hp, rivalHp, turns, score, lastWinMove, lastWinHp (+ extra merged in)
R.Game.last                      // result of the run that just ended, for 'death' / 'victory' / 'credits':
  { won:bool, duel:1..7, phase:1..4, rivalHp:int, turns:int, score:0..100, finishingMove:move|null, hp:int,
    unlocks:[{ id, type, ref, name, how }], firstWin:bool, insights:stat[], boons:[id], rivalBoons:[id] }
R.Game.resetAll()                // settings "erase everything": wipes save, brain, meta; goes to 'title'
```
Scene names: `title, relic, duel, bonfire, dossier, death, victory, credits, settings, unlocks`.
Routing: `death` and `victory` are entered with `R.Game.run === null` and read `R.Game.last`. `victory` goes to `credits` when `R.Game.last.firstWin` (and always sets `meta.seenCredits = true` there), otherwise to `title`. `dossier`, `settings` and `unlocks` take `args.from` (a scene name) and return there with `E.go(args.from)`; the bonfire keeps its own step in `R.Game.run.offer` / scene state so returning to it is safe.
