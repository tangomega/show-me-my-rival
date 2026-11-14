# THE RIVAL — module contract

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
art/palette.js  art/font.js  art/sprites.js  art/backgrounds.js  art/ui.js  art/fx.js
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
R.Save.commit()                   // write now; try/catch; never throws
R.Save.reset()                    // wipe to defaults and commit
```
Schema (key `rival.save.v1`):
```
{ v:1,
  settings:{ muted:false, haptics:true, mask:'porcelain', arena:'cathedral' },
  brain:null|object,   // owned by R.Brain (serialize())
  meta:null|object,    // owned by R.Run   (defaultMeta())
  run:null|object }    // owned by R.Run   (mid-run state incl. current duel)
```

## R.Brain — `src/ai/brain.js` (pure)

```
R.Brain.create(serialized|null) -> brain
brain.serialize() -> object
brain.beginRun({ days })                 // run-start decay (stronger if days >= 7); resets per-run tracking
brain.commit(q) -> sealed
brain.predict(ctx, legalP) -> {S,G,F}    // tell-independent ensemble prediction (used for Called Shot + Stolen Ledger)
brain.observe(ctx, tell, pm, rm)         // call once per resolved turn, AFTER reveal (skipped for forced tutorial turns)
brain.trust() -> 0..1                    // smoothed COUNTER share (how much the player believes stances)
brain.honesty(honestyBase) -> 0..1       // the h it would use right now (for the Liar's Tally boon)
brain.forget(f)                          // Ash of Forgetting: decayed tables *= f, weights halfway to uniform
brain.runScore() -> 0..100               // this run's predictability score
brain.dossier() -> dossier
brain.habitFor(ctx) -> stat|null         // strongest shown-able habit relevant to this context
brain.runInsights() -> stat[]            // up to 3, for the death/victory screen
```
`q = { ctx, payoff, legalR:[move], legalP:[move], exploit:0..1, honestyBase:0..1, rng, force?:{move?, tell?} }`
(`force` is for the scripted tutorial only.)

`sealed = { move, tell, honest:bool, pred:{S,G,F}, top:move, confidence:0..1, mode:'exploit'|'mix' }`
- `pred` = predicted probability of each player move given ctx **and the tell it chose to show**; `top` = argmax.
- The caller keeps `sealed` in a closure the input handler cannot reach. `commit` must never be given the current-turn player move, and `observe` is the only place it learns it.

`ctx` (built by `R.Combat.ctx(duel)`):
```
{ duel:1..7, phase:1|2, turn:int>=1,
  prev1:move|null, prev2:move|null,   // player's last two moves this duel
  prevR:move|null,                    // Rival's last move this duel
  last:'W'|'L'|'C'|null,              // last exchange from the player's view
  pHp, pMaxHp, rHp, rMaxHp, tension:0..3,
  pBroken:bool, rBroken:bool }        // guard broken this turn
```
`payoff[rm][pm]` = number, the complete value to the Rival of that exchange, from `R.Combat.payoff(duel)`: damage dealt minus damage taken with tension, focus/fortify, boon hooks, hit cap, Called Shot terms, guard-break value (±0.86 per break turn) and lethal bonus (±8) already included. Illegal cells are present but ignored (the brain only reads `legalR × legalP`). The brain adds nothing to it.

`stat = { id, kind:'habit'|'tell'|'record', move:move|null, pct:0..100, n:int, strength:0..1, vars:{...} }`
`dossier = { samples:int, predictability:0..100, favorite:move|null, tell:{counter,mirror,under,n}, stats:stat[] (strongest first), broken:stat|null }`
Stat ids are the ones listed in DESIGN.md "Dossier stats"; `R.Text.dossierLine(stat)` turns one into a sentence.

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
  // duel.intel is written by the duel scene: `called` at turn start (phase 2, before payoff/commit);
  // `honest` + `pred` copied from `sealed` and `coin` set right before resolve(). resolve() resets it afterwards.
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
R.Run.create(meta, { seed, relicId|null, now }) -> run
  run = { seed, rngState, duelN:1, phase:1, stage:'duel'|'bonfire'|'won'|'dead',
          pHp, pMaxHp, pBoons:[id], rBoons:[id], duel:null|duel,
          offer:null|{ rivalPick:id, rivalWhy:null|'G'|'S'|'F'|'repeat'|'predictable'|'trust'|'tags', choices:[id x3..4], healed:int },
          pending:null|{ sealed },                    // the Rival's commit for the current turn (so a reload cannot reroll it)
          relicId:null|id,
          stats:{ turns, moves:{S,G,F}, wins, losses, clashes, reads, surprises, liesCaught, duelTurns:[...], flags:{} } }
R.Run.startDuel(run) -> duel                          // sets run.duel
R.Run.startPhase2(run) -> duel                        // final duel only; keeps the player fighter, heals R.Run.PHASE2_HEAL
R.Run.record(run, meta, result, sealed)               // per-turn stats + lifetime counters (reads, surprises, lies caught...)
R.Run.endDuel(run, meta, winner, dossier) -> void     // winner 'p': heal + build offer (stage 'bonfire') or stage 'won'; 'r': stage 'dead'
R.Run.pick(run, boonId)                               // player drafts; run.duelN++, stage 'duel'
R.Run.finish(run, meta, now) -> { unlocks:[unlock], firstWin:bool }   // updates memory + unlocks
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
E.paused                    // true while document hidden; loop + audio suspended
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
R.Game.brain ; R.Game.meta ; R.Game.run ; R.Game.rng
R.Game.newRun(relicId|null)      // creates run, saves, goes to 'duel'
R.Game.resume()                  // continues a saved run at its stage
R.Game.hasRun() -> bool
R.Game.duelOver(winner)          // called by the duel scene; routes to bonfire / phase 2 / victory / death
R.Game.draft(boonId)             // called by the bonfire scene; goes to next duel
R.Game.save()                    // serializes brain + meta + run into R.Save and commits
```
Scene names: `title, relic, duel, bonfire, dossier, death, victory, credits, settings, unlocks`.
