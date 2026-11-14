// SHOW ME MY RIVAL — headless balance sim.
//
//   node tools/sim.js [--runs N] [--seeds K] [--seed S] [--bot name[,name]] [--quick] [--jobs J]
//                     [--unlocks natural|all] [--no-combos] [--no-boons]
//                     [--set key=value ...] [--label text] [--trace]
//
// Plays the real logic (core/rng, ai/brain, game/boons, game/combat, game/run) in exactly the order
// the game does (scenes/duel.js turn(), main.js newRun/duelOver/draft). Every chain is N
// SEQUENTIAL runs sharing one brain + one meta, so the Rival learns the bot across runs and unlocks
// arrive the way they would for a person. Deterministic from --seed.
//
// Player bots see only what a human sees: their own state, the Rival's HP / statuses / boons, the
// tension, the shown stance, the Called Shot, the public payoff of each cell and their own history.
// They are never handed `sealed`; the harness reads it for statistics only. Info boons reach a bot
// through view.use() / view.info, which return exactly what the scene would draw.
//
// --set overrides balance numbers for a sweep without editing files, e.g.
//   --set maxhp=24 --set hp=5,6,7,7,8,9,8 --set p2hp=7 --set heal=6 --set p2heal=3 --set exploit=.15,.3,.45,.55,.65,.75,.9
//   --set stake=5 (lights of the Vigil out)  --set V.healCut=2 --set V.hp=1 --set V.callsFrom=1
//   --set honesty=.92,.85,.75,.65,.55,.5,.42 --set p2honesty=.35 --set p2exploit=1 --set K.H_TRUST_UP_LATE=0.8
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const WT = require('worker_threads');
const src = path.join(__dirname, '..', 'src');
require(path.join(src, 'core', 'rng.js'));
require(path.join(src, 'ai', 'brain.js'));
require(path.join(src, 'game', 'boons.js'));
require(path.join(src, 'game', 'combat.js'));
require(path.join(src, 'game', 'run.js'));
const R = globalThis.RIVAL;
const C = R.Combat, RUN = R.Run, B = R.Boons, MOVES = R.MOVES, BEATS = R.BEATS, LOSES_TO = R.LOSES_TO;

const BOT_NAMES = ['guard', 'cycle', 'wsls', 'truster', 'habit', 'uniform', 'mixer', 'adaptive'];
const BUCKETS = [[1, 10], [11, 50], [51, 200], [201, 1e9]];
const BUCKET_NAMES = ['1-10', '11-50', '51-200', '201+'];

// ------------------------------------------------------------------ overrides
let STAKE = 0;                                        // --set stake=N: every run is played with N lights of the Vigil out
let BOSS = 'unmasked';                                // --set boss=id: the face worn in duel 7 (R.Run.BOSSES)
function applySet(list) {
  (list || []).forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i < 0) throw new Error('--set needs key=value: ' + kv);
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    const nums = v.split(',').map(Number);
    let n;
    if (k === 'hp') for (n = 1; n <= 7; n++) RUN.DUELS[n].rivalHp = nums[n - 1];
    else if (k === 'exploit') for (n = 1; n <= 7; n++) RUN.DUELS[n].exploit = nums[n - 1];
    else if (k === 'honesty') for (n = 1; n <= 7; n++) RUN.DUELS[n].honesty = nums[n - 1];
    else if (k === 'p2hp') RUN.DUELS.phase2.rivalHp = nums[0];
    else if (k === 'p2exploit') RUN.DUELS.phase2.exploit = nums[0];
    else if (k === 'p2honesty') RUN.DUELS.phase2.honesty = nums[0];
    else if (k === 'heal') RUN.HEAL = nums[0];
    else if (k === 'maxhp') RUN.PLAYER_MAX_HP = nums[0];
    else if (k === 'p2heal') RUN.PHASE2_HEAL = nums[0];
    else if (k === 'stake') STAKE = nums[0];
    else if (k.indexOf('B.') === 0) {                 // B.<boss id>.<phase 1..n>.<key>=number, e.g. B.hours.4.floor=2
      const parts = k.split('.'), bo = RUN.BOSSES.filter(function (b) { return b.id === parts[1]; })[0];
      if (!bo || !bo.phases[+parts[2] - 1]) throw new Error('unknown boss phase: ' + k);
      bo.phases[+parts[2] - 1][parts[3]] = nums[0];
    }
    else if (k === 'boss') { BOSS = v; if (!RUN.BOSSES.some(function (b) { return b.id === v; })) throw new Error('unknown boss: ' + v); }
    else if (k.indexOf('V.') === 0) RUN.VIGIL_TUNE[k.slice(2)] = nums[0];
    else if (k.indexOf('K.') === 0) R.Brain.K[k.slice(2)] = nums[0];
    else if (k.indexOf('A.') === 0) ADAPT[k.slice(2)] = nums[0];
    else throw new Error('unknown --set key: ' + k);
  });
}

// ------------------------------------------------------------------ small helpers
function hash32(a, b, c) {
  let h = 0x811c9dc5;
  const s = a + '|' + b + '|' + c;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) || 1;
}
function argmaxMove(pred, legal) {
  let best = legal[0];
  for (let i = 1; i < legal.length; i++) if (pred[legal[i]] > pred[best]) best = legal[i];
  return best;
}
function sampleDist(p, legal, rng) {
  let total = 0, i;
  for (i = 0; i < legal.length; i++) total += p[legal[i]] > 0 ? p[legal[i]] : 0;
  if (!(total > 0)) return rng.pick(legal);
  let x = rng.next() * total;
  for (i = 0; i < legal.length; i++) { const w = p[legal[i]] > 0 ? p[legal[i]] : 0; x -= w; if (x < 0) return legal[i]; }
  return legal[legal.length - 1];
}
function has(arr, x) { return arr.indexOf(x) >= 0; }
function zeros(n) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = 0; return a; }

// ------------------------------------------------------------------ drafting policies
// Which move a boon rewards (null = no particular move).
const BOON_MOVE = {
  coiled_riposte: 'S', thorned_guard: 'G', stone_patience: 'G', iron_oath: 'G', serrated_edge: 'S',
  paper_cuts: 'F', vampires_curtsy: 'F', long_con: 'F', turtle_cracker: 'F', debt_collector: 'S', headsman: 'S'
};
// Value of a boon to a player with no strong move preference (hand prior, 0..1).
// Started as a guess; nudged once toward what the first sweeps measured (a person learns this too).
const GENERIC = {
  last_candle: 0.85, first_blood: 0.75, ash_veil: 0.65, thorned_guard: 0.55, paper_cuts: 0.5, iron_oath: 0.5,
  three_faces: 0.45, mirror_etiquette: 0.45, serrated_edge: 0.45, vampires_curtsy: 0.45, coiled_riposte: 0.4,
  stone_patience: 0.4, ash_of_forgetting: 0.4, cornered: 0.4, spite: 0.4, turtle_cracker: 0.4,
  ember_hoard: 0.35, long_con: 0.35, headsman: 0.35, deathblow_creed: 0.35, debt_collector: 0.3, resonance: 0.25,
  salt_the_wound: 0.25, carrion_comfort: 0.25, broken_pattern: 0.4,
  keyhole: 0.85, truth_candle: 0.7, liars_tally: 0.5, stolen_ledger: 0.5, coin_of_fools: 0.6
};
const BLEED_SOURCES = ['serrated_edge', 'paper_cuts', 'relic_rusty_nail'];
// Counter-drafting: the Rival's visible pick -> what a thoughtful player reaches for (id or tag: bonus).
const ANTI = {
  turtle_cracker: { iron_oath: 0.6, EXE: 0.15, TRK: 0.15 }, long_con: { iron_oath: 0.7 }, paper_cuts: { iron_oath: 0.4, ember_hoard: 0.2 },
  debt_collector: { iron_oath: 0.6 }, resonance: { ash_veil: 0.6 }, deathblow_creed: { ash_veil: 0.7 },
  thorned_guard: { TRK: 0.3 }, coiled_riposte: { TRK: 0.3, ash_veil: 0.2 }, stone_patience: { TRK: 0.35 }, mourning_veil: { BLD: 0.35 },
  serrated_edge: { RIP: 0.3, ember_hoard: 0.2 }, first_blood: { RIP: 0.2 }, headsman: { RIP: 0.3, ember_hoard: 0.3, last_candle: 0.2 },
  painted_smile: { truth_candle: 0.4, liars_tally: 0.4, keyhole: 0.3 }, hungry_mask: { CHA: 0.3 },
  no_encores: { three_faces: 0.4 }, sealing_wax: { three_faces: 0.3 }, iron_oath: { EXE: 0.2 }, salt_the_wound: { ember_hoard: 0.2 },
  vampires_curtsy: { RIP: 0.3 }, cornered: {}, spite: {}, three_faces: {}, mirror_etiquette: { ash_veil: 0.3 }, ash_veil: {}, carrion_comfort: {}, spare_mask: {}
};

function softPick(ids, scores, temp, rng) {
  let best = -Infinity, i;
  for (i = 0; i < ids.length; i++) if (scores[i] > best) best = scores[i];
  const w = [];
  for (i = 0; i < ids.length; i++) w.push(scores[i] < 0 && best >= 0 ? 0 : Math.exp((scores[i] - best) / temp));
  return ids[rng.weighted(w)];
}
// usable: set of active boon ids this bot knows how to use; info: can it read info boons.
function draftSimple(o, shares, usable, readsInfo, temp, rng) {
  const ids = o.choices, sc = [];
  const bleeder = o.pBoons.some(function (b) { return has(BLEED_SOURCES, b); });
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], b = B.byId[id];
    let s;
    if (b.active && !usable[id]) s = -1;
    else if (has(b.tags, 'INF') && !b.active && !readsInfo) s = 0.05;
    else if (BOON_MOVE[id]) s = 0.2 + 1.2 * shares[BOON_MOVE[id]];
    else s = GENERIC[id] === undefined ? 0.35 : GENERIC[id];
    if ((id === 'salt_the_wound' || id === 'carrion_comfort') && bleeder) s += 0.4;
    sc.push(s);
  }
  return softPick(ids, sc, temp, rng);
}
function draftAdaptive(o, rng) {
  const ids = o.choices, sc = [], own = {};
  o.pBoons.forEach(function (id) { const b = B.byId[id]; if (b) b.tags.forEach(function (t) { own[t] = (own[t] || 0) + 1; }); });
  const bleeder = o.pBoons.some(function (b) { return has(BLEED_SOURCES, b); });
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], b = B.byId[id];
    let s = GENERIC[id] === undefined ? 0.35 : GENERIC[id], k;
    for (k = 0; k < b.tags.length; k++) if (own[b.tags[k]]) s += 0.12;                 // tag synergy
    if ((id === 'salt_the_wound' || id === 'carrion_comfort') && bleeder) s += 0.4;
    if (id === 'debt_collector' && has(o.pBoons, 'long_con')) s += 0.25;
    for (k = 0; k < o.rBoons.length; k++) {                                            // counter-draft, newest pick counts most
      const a = ANTI[o.rBoons[k]];
      if (!a) continue;
      const wgt = k === o.rBoons.length - 1 ? 1 : 0.5;
      if (a[id]) s += wgt * a[id];
      for (let t = 0; t < b.tags.length; t++) if (a[b.tags[t]]) s += wgt * a[b.tags[t]];
    }
    sc.push(s);
  }
  return softPick(ids, sc, 0.22, rng);
}

// ------------------------------------------------------------------ bots
// view = { n, phase, turn, ctx, legalP, legalR, tell, called, payoff, tension, pHp, rHp, pBoons, rBoons,
//          charges, info:{stamp,ledger,tallyH}, rng, use(id) }
// bot  = { relic(ownedIds), pick(view) -> move, after(view, pm, rm, res), draft(offerView) -> id, runStart(), duelStart(view) }
const CYCLE = ['S', 'G', 'F'];
const NO_ACTIVES = {};
const COIN_ONLY = { coin_of_fools: true };
const ALL_ACTIVES = { coin_of_fools: true, keyhole: true, truth_candle: true };

// A person settles on a favourite relic; `explore` is the share of runs that try another one
// (it keeps the per-relic table populated).
function preferRelic(prefs, rng, explore) {
  return function (owned) {
    if (explore && owned.length && rng.chance(explore)) return rng.pick(owned);
    for (let i = 0; i < prefs.length; i++) if (has(owned, prefs[i])) return prefs[i];
    return owned.length ? rng.pick(owned) : null;
  };
}
function randomRelic(rng) { return function (owned) { return owned.length ? rng.pick(owned) : null; }; }
function sharesOf(o) {
  const m = o.moves, n = m.S + m.G + m.F;
  return n > 0 ? { S: m.S / n, G: m.G / n, F: m.F / n } : { S: 1 / 3, G: 1 / 3, F: 1 / 3 };
}
// Safety net from before the Rupture rule was fixed (it used to seal the move, which locked the duel):
// a bot that has clashed this many times in a row at 3 pips presses something at random.
const BORED_AFTER = 9;
function bored(v) { return v.tension >= 3 && v.clashRun >= BORED_AFTER; }
function basicBot(rng, pick, relicPrefs, usable) {
  return {
    relic: relicPrefs ? preferRelic(relicPrefs, rng, usable ? 0.15 : 0) : randomRelic(rng),
    pick: pick, after: function () {}, runStart: function () {}, duelStart: function () {},
    draft: function (o) { return draftSimple(o, sharesOf(o), usable || NO_ACTIVES, false, usable ? 0.3 : 0.15, rng); }
  };
}

// Tunables of the adaptive bot (also reachable as --set A.NAME=value for sensitivity checks).
const ADAPT = {
  PRIOR_N: 5,          // pseudo-observations behind the per-duel honesty prior
  DECAY: 0.97,         // per observation, per duel table
  RECENT_ALPHA: 0.12,  // EMA of the last few stances, across duels
  RECENT_W: 0.25,      // weight of that EMA in the estimate
  TAU: 0.7,            // softmax temperature of the best response (damage units)
  W_BR: 0.75,          // share of the best response; the rest is the equilibrium mix
  CALLED_FEAR: 1.0,    // EV penalty on the called move
  STAKES: 5,           // |payoff| that makes an info active worth spending
  COIN_EDGE: 0.2       // flip the Coin of Fools when it beats the considered mix by this much
};
const PRIOR_H = [0, 0.88, 0.82, 0.72, 0.62, 0.54, 0.48, 0.42, 0.36];

function makeBot(name, rng) {
  let mem = { i: 0 };
  if (name === 'guard') {
    return basicBot(rng, function (v) { return has(v.legalP, 'G') ? 'G' : (has(v.legalP, 'S') ? 'S' : v.legalP[0]); },
      ['relic_dented_buckler', 'relic_ashen_flask']);
  }
  if (name === 'cycle') {
    const b = basicBot(rng, function (v) {
      for (let k = 0; k < 3; k++) {
        const m = CYCLE[(mem.i + k) % 3];
        if (has(v.legalP, m)) { mem.i = (mem.i + k + 1) % 3; return m; }
      }
      return v.legalP[0];
    }, ['relic_ashen_flask']);
    b.duelStart = function () { mem.i = 0; };
    return b;
  }
  if (name === 'wsls') {
    return basicBot(rng, function (v) {
      let m = null;
      if (v.ctx.last === 'W') m = v.ctx.prev1;
      else if (v.ctx.last === 'L') m = LOSES_TO[v.ctx.prevR];          // shift to what beats its last move
      return m && has(v.legalP, m) ? m : rng.pick(v.legalP);
    }, ['relic_ashen_flask']);
  }
  if (name === 'truster') {
    return basicBot(rng, function (v) {
      const m = LOSES_TO[v.tell];
      return has(v.legalP, m) ? m : rng.pick(v.legalP);
    }, ['relic_ashen_flask']);
  }
  if (name === 'habit') {
    return basicBot(rng, function (v) {
      const c = v.ctx, lp = v.legalP;
      if (c.turn === 1 && has(lp, 'S') && rng.chance(0.7)) return 'S';
      if (c.last === 'L' && has(lp, 'G') && rng.chance(0.7)) return 'G';
      if (c.last === 'W' && c.prev1 && has(lp, c.prev1) && rng.chance(0.6)) return c.prev1;
      const m = LOSES_TO[v.tell];
      if (has(lp, m) && rng.chance(0.7)) return m;
      return rng.pick(lp);
    }, ['relic_ashen_flask']);
  }
  if (name === 'uniform') {
    return basicBot(rng, function (v) {
      if (v.charges.coin_of_fools > 0 && rng.chance(0.5)) { const m = v.use('coin_of_fools'); if (m) return m; }
      return rng.pick(v.legalP);
    }, ['relic_rusty_nail', 'relic_dented_buckler', 'relic_ashen_flask'], COIN_ONLY);
  }
  if (name === 'mixer') {
    return basicBot(rng, function (v) {
      if (bored(v)) return rng.pick(v.legalP);
      if (v.charges.coin_of_fools > 0 && v.legalP.length === 3) { const m = v.use('coin_of_fools'); if (m) return m; }
      const eq = R.Brain.equilibrium(v.payoff, v.legalR, v.legalP);
      return sampleDist(eq.p, v.legalP, rng);
    }, ['relic_rusty_nail', 'relic_dented_buckler', 'relic_ashen_flask'], COIN_ONLY);
  }
  if (name === 'adaptive') return makeAdaptive(rng);
  throw new Error('unknown bot ' + name);
}

// A strong human: reads the stance through a running estimate of how often it is honest / a trap /
// a double-bluff in each duel, best-responds to that estimate, and always keeps a share of the
// equilibrium mix so that it never becomes a pattern itself.
function makeAdaptive(rng) {
  const A = ADAPT;
  const shape = [];                                   // [duel 1..8] -> decayed counts [honest, trap, double-bluff]
  for (let k = 0; k <= 8; k++) shape.push([0, 0, 0]);
  const recent = [0.7, 0.15, 0.15];
  const q = { S: 0, G: 0, F: 0 }, ev = { S: 0, G: 0, F: 0 }, pr = { S: 0, G: 0, F: 0 };
  const FLIP = { W: 'L', L: 'W', C: 'C' };
  const own = { W: { S: 0, G: 0, F: 0 }, L: { S: 0, G: 0, F: 0 }, C: { S: 0, G: 0, F: 0 }, start: { S: 0, G: 0, F: 0 } };

  function estimate(k, out) {
    const c = shape[k], n = c[0] + c[1] + c[2], ph0 = PRIOR_H[k];
    for (let i = 0; i < 3; i++) {
      const prior = i === 0 ? ph0 : (1 - ph0) / 2;
      out[i] = (1 - A.RECENT_W) * (c[i] + A.PRIOR_N * prior) / (n + A.PRIOR_N) + A.RECENT_W * recent[i];
    }
    return out;
  }

  const est = [0, 0, 0];
  function pick(v) {
    const k = v.phase >= 2 ? 8 : v.n, t = v.tell, lp = v.legalP, lr = v.legalR;
    if (bored(v)) return rng.pick(lp);
    // It plays as I would in its seat: its last result is the mirror of mine, so weigh its moves by my own record there.
    const mine = v.mimic ? own[FLIP[v.ctx.last] || 'start'] : null;
    const mineN = mine ? mine.S + mine.G + mine.F : 0;
    const eq = R.Brain.equilibrium(v.payoff, lr, lp);
    estimate(k, est);
    if (v.info.tallyH !== null) {                     // Liar's Tally: the game shows its honesty to the nearest 10%
      const h = Math.min(0.95, Math.max(0.05, v.info.tallyH / 100)), rest = est[1] + est[2];
      est[1] = rest > 0 ? (1 - h) * est[1] / rest : (1 - h) / 2;
      est[2] = 1 - h - est[1];
      est[0] = h;
    }
    let i, m, known = false, sum = 0;
    for (i = 0; i < 3; i++) q[MOVES[i]] = 0;
    for (i = 0; i < lr.length; i++) {
      m = lr[i];
      const f = t === null ? 1 : (m === t ? est[0] : (m === BEATS[t] ? est[1] : est[2]));     // no stance shown: nothing to read
      q[m] = Math.max(0.04, eq.r[m]) * f;
      if (mine) q[m] = f * (mine[m] + 1) / (mineN + 3);
    }
    // stakes: the biggest swing on the board this turn
    let stakes = 0;
    for (i = 0; i < lr.length; i++) for (let j = 0; j < lp.length; j++) stakes = Math.max(stakes, Math.abs(v.payoff[lr[i]][lp[j]]));
    const spend = stakes >= A.STAKES || v.turn >= 4;

    let stamp = v.info.stamp;                         // Liar's Coin relic (turn 1) is free
    if (v.charges.keyhole > 0 && spend) {
      const seen = v.use('keyhole');
      if (seen) { for (i = 0; i < 3; i++) q[MOVES[i]] = 0; q[seen] = 1; known = true; }
    }
    if (!known && stamp === null && v.charges.truth_candle > 0 && spend) stamp = v.use('truth_candle');
    if (!known && stamp === true) { for (i = 0; i < 3; i++) q[MOVES[i]] = 0; q[t] = 1; known = true; }
    else if (!known && stamp === false) q[t] = 0;
    if (!known && v.info.ledger && v.info.ledger.dots >= 2) {
      // Stolen Ledger: it expects `top`, so it leans to the move that beats `top`
      const lean = LOSES_TO[v.info.ledger.top];
      if (q[lean] > 0) q[lean] *= v.info.ledger.dots === 3 ? 2.2 : 1.5;
    }
    for (i = 0; i < 3; i++) sum += q[MOVES[i]];
    if (!(sum > 0)) { for (i = 0; i < lr.length; i++) q[lr[i]] = 1 / lr.length; sum = 1; }
    for (i = 0; i < 3; i++) q[MOVES[i]] /= sum;

    let best = -Infinity;
    for (i = 0; i < lp.length; i++) {
      m = lp[i];
      let x = 0;
      for (let j = 0; j < lr.length; j++) x -= q[lr[j]] * v.payoff[lr[j]][m];
      if (v.called === m && !known) x -= A.CALLED_FEAR;
      ev[m] = x;
      if (x > best) best = x;
    }
    if (known) { for (i = 0; i < lp.length; i++) if (ev[lp[i]] === best) return lp[i]; }

    let z = 0, mixEv = 0;
    for (i = 0; i < 3; i++) pr[MOVES[i]] = 0;
    for (i = 0; i < lp.length; i++) { m = lp[i]; pr[m] = Math.exp((ev[m] - best) / A.TAU); z += pr[m]; }
    for (i = 0; i < lp.length; i++) { m = lp[i]; pr[m] = A.W_BR * pr[m] / z + (1 - A.W_BR) * eq.p[m]; mixEv += pr[m] * ev[m]; }

    if (v.charges.coin_of_fools > 0) {                // a coin turn: uniform move, +2 if it wins
      let coinEv = 0;
      for (i = 0; i < lp.length; i++) coinEv += (ev[lp[i]] + 2 * q[BEATS[lp[i]]]) / lp.length;
      if (coinEv > mixEv + A.COIN_EDGE) { const c = v.use('coin_of_fools'); if (c) return c; }
    }
    return sampleDist(pr, lp, rng);
  }

  function after(v, pm, rm) {
    const k = v.phase >= 2 ? 8 : v.n, t = v.tell;
    own[v.ctx.last || 'start'][pm]++;                                   // what I do after a win / loss / clash / at the start
    if (t === null) return;
    const s = rm === t ? 0 : (rm === BEATS[t] ? 1 : 2);
    const c = shape[k];
    c[0] *= A.DECAY; c[1] *= A.DECAY; c[2] *= A.DECAY; c[s] += 1;
    for (let i = 0; i < 3; i++) recent[i] += A.RECENT_ALPHA * ((i === s ? 1 : 0) - recent[i]);
  }

  return {
    relic: preferRelic(['relic_liars_coin', 'relic_dented_buckler', 'relic_rusty_nail', 'relic_ashen_flask'], rng, 0.15), pick: pick, after: after, runStart: function () {}, duelStart: function () {},
    draft: function (o) { return draftAdaptive(o, rng); }
  };
}

// ------------------------------------------------------------------ statistics
function newSeg() {
  return { n: 0, w: 0, turns: 0, hpIn: 0, hpOut: 0, tells: 0, honest: 0, trap: 0, rWin: 0, pWin: 0, clash: 0, big7: 0, counter: 0, mirror: 0 };
}
function newStats() {
  const s = {
    chains: 0, runs: 0, wins: 0, bRuns: zeros(4), bWins: zeros(4), bReach: zeros(4), bScore: zeros(4),
    reach: 0, deathAt: zeros(10), seg: [], lenHist: zeros(64), winTurns: 0, winTurnsHist: zeros(64), turns: 0,
    duels: 0, big7: 0, maxHit: 0, hitHist: zeros(10),
    lifeScore: 0, trust: 0, legalSum: 0, legal2: 0,
    pb: {}, rb: {}, bonN: zeros(7), bonW: zeros(7), relic: {},
    healHist: zeros(16), brkN: 0, brkNet: 0, brkDealt: 0, coinN: 0, coinNet: 0, nocoinN: 0, nocoinNet: 0,
    mirrorHeal: 0, ruptureP: 0, ruptures: 0, ruptDuels: 0, lockDuels: 0, ruptLost: 0, unlockRun: {}, ms: 0
  };
  for (let k = 0; k <= 8; k++) s.seg.push(newSeg());
  return s;
}
function merge(a, b) {
  for (const k in b) {
    const v = b[k];
    if (typeof v === 'number') a[k] = k === 'maxHit' ? Math.max(a[k] || 0, v) : (a[k] || 0) + v;
    else if (Array.isArray(v)) {
      if (!a[k]) a[k] = [];
      for (let i = 0; i < v.length; i++) {
        if (typeof v[i] === 'number') a[k][i] = (a[k][i] || 0) + v[i];
        else { if (!a[k][i]) a[k][i] = {}; merge(a[k][i], v[i]); }
      }
    } else if (v && typeof v === 'object') { if (!a[k]) a[k] = {}; merge(a[k], v); }
  }
  return a;
}
function bucketOf(runNo) { for (let i = 0; i < 4; i++) if (runNo >= BUCKETS[i][0] && runNo <= BUCKETS[i][1]) return i; return 3; }
function boonRow(tbl, id) { return tbl[id] || (tbl[id] = { n: zeros(7), w: zeros(7) }); }

// ------------------------------------------------------------------ one chain of sequential runs
// job = { bot, seed, runs, unlocks:'natural'|'all', pre:{p:[],r:[]}|null, force:[ids]|null, set:[...], trace:bool }
function runChain(job) {
  const t0 = Date.now();
  const st = newStats();
  st.chains = 1;
  const brain = R.Brain.create(null);
  const meta = RUN.defaultMeta();
  meta.seenTutorial = true;                           // the scripted first duel is not simulated
  if (job.unlocks === 'all') RUN.UNLOCKS.forEach(function (u) { meta.unlocked[u.id] = true; });
  const botRng = R.RNG.create(hash32(job.seed, job.bot, 'bot'));
  const bot = makeBot(job.bot, botRng);
  const trace = job.trace ? [] : null;
  const view = { info: { stamp: null, ledger: null, tallyH: null }, rng: botRng };
  let cur = null;                                     // per-turn harness state reachable from view.use
  view.use = function (id) {
    const r = C.useActive(cur.duel, id);
    if (!r || !r.ok) return null;
    if (r.kind === 'coin') { cur.coin = true; cur.forced = cur.rng.pick(cur.legalP); return cur.forced; }   // as the scene: gameplay rng
    if (r.kind === 'glimpse') return cur.sealed.move;
    if (r.kind === 'honesty') return cur.sealed.honest;
    return null;
  };

  function fight(run, rng, k) {
    const duel = run.duel, seg = st.seg[k];
    let turns = 0, big = false, brkLeft = 0, clashRun = 0, rupt = 0, locked = false;
    seg.n++; seg.hpIn += duel.p.hp;
    bot.duelStart();
    for (;;) {
      C.beginTurn(duel);
      if (duel.over) break;
      const ctx = C.ctx(duel), legalP = C.legal(duel, 'p'), legalR = C.legal(duel, 'r');
      const cfg = RUN.cfg(run, duel);
      let called = null;
      if (C.callsOf(duel) && duel.turn % 3 === 2) called = argmaxMove(brain.predict(ctx, legalP), legalP);
      duel.intel.called = called;
      const payoff = C.payoff(duel);
      const noStance = duel.stance === 'none';
      const cq = { ctx: ctx, payoff: payoff, legalR: legalR, legalP: legalP, exploit: cfg.exploit, honestyBase: cfg.honesty, rng: rng };
      if (noStance) cq.noTell = true;                                   // as scenes/duel.js turn()
      if (duel.mimic) cq.mimic = C.ctx(duel, 'r');
      const sealed = brain.commit(cq);

      // ---- the player's window: public information only
      const inf = C.info(duel);
      view.n = duel.n; view.phase = duel.phase; view.turn = duel.turn; view.ctx = ctx; view.legalP = legalP; view.legalR = legalR;
      view.clashRun = clashRun; if (duel.tension >= 3 && clashRun >= BORED_AFTER) locked = true;
      view.tell = noStance ? null : sealed.tell; view.called = called; view.payoff = payoff; view.tension = duel.tension;
      view.mimic = !!duel.mimic;                                        // public: the rule card says it plays as you do
      view.pHp = duel.p.hp; view.rHp = duel.r.hp; view.pBoons = duel.p.boons; view.rBoons = duel.r.boons; view.charges = duel.p.charges;
      view.info.stamp = inf.coinTurn1 && !noStance ? sealed.honest : null;
      view.info.ledger = inf.ledger ? { top: sealed.top, dots: sealed.confidence > 0.66 ? 3 : sealed.confidence > 0.33 ? 2 : 1 } : null;
      view.info.tallyH = (!inf.ledger && inf.tally) ? Math.round(brain.honesty(cfg.honesty) * 10) * 10 : null;
      cur = { duel: duel, sealed: sealed, legalP: legalP, rng: rng, coin: false, forced: null };
      const coinAvail = duel.p.charges.coin_of_fools > 0;
      let pm = bot.pick(view);
      if (cur.forced) pm = cur.forced;
      if (!has(legalP, pm)) throw new Error(job.bot + ' picked an illegal move ' + pm);

      duel.intel.honest = sealed.honest; duel.intel.pred = sealed.pred; duel.intel.coin = cur.coin;
      const res = C.resolve(duel, pm, sealed.move);
      brain.observe(ctx, noStance ? null : sealed.tell, pm, sealed.move);
      RUN.record(run, meta, res, sealed);
      bot.after(view, pm, sealed.move, res);

      // ---- statistics (the harness may look at everything)
      turns++;
      seg.tells++;
      if (sealed.honest) seg.honest++; else if (sealed.move === BEATS[sealed.tell]) seg.trap++;
      if (pm === LOSES_TO[sealed.tell]) seg.counter++; else if (pm === sealed.tell) seg.mirror++;
      if (res.clash) seg.clash++; else if (res.winner === 'r') seg.rWin++; else seg.pWin++;
      st.legalSum += legalP.length; if (legalP.length === 2) st.legal2++;
      if (res.winner === 'r') {
        st.hitHist[Math.min(9, res.dmgP)]++;
        if (res.dmgP > st.maxHit) st.maxHit = res.dmgP;
        if (res.dmgP >= 7) big = true;
      }
      const net = res.dmgR - res.dmgP;
      if (brkLeft > 0) { st.brkNet += net; st.brkDealt += res.dmgR; brkLeft--; }
      if (res.brokenR > 0) { st.brkN++; brkLeft = res.brokenR; }
      if (cur.coin) { st.coinN++; st.coinNet += net; } else if (coinAvail) { st.nocoinN++; st.nocoinNet += net; }
      clashRun = res.clash ? clashRun + 1 : 0;
      if (res.rupture) { st.ruptureP += res.dmgP; st.ruptures++; rupt++; }
      if (res.clash && res.healP > 0) st.mirrorHeal += res.healP;
      if (trace) trace.push('  d' + duel.n + (duel.phase === 2 ? 'b' : '') + ' t' + res.turn + ' tell ' + sealed.tell + ' R ' + sealed.move + ' P ' + pm +
        (called ? ' called ' + called : '') + ' -> ' + (res.clash ? 'clash' : res.winner) + ' dmgP ' + res.dmgP + ' dmgR ' + res.dmgR + ' hp ' + duel.p.hp + '/' + duel.r.hp + ' T' + duel.tension + ' ' + sealed.mode);
      if (turns > 200) {
        throw new Error('duel over 200 turns: ' + JSON.stringify({ n: duel.n, phase: duel.phase, tension: duel.tension, p: duel.p, r: duel.r, payoff: payoff, tell: sealed.tell, move: sealed.move, pm: pm, mode: sealed.mode }));
      }
      if (duel.over) break;
    }
    const won = duel.over === 'p';
    if (won) seg.w++;
    seg.turns += turns; seg.hpOut += Math.max(0, duel.p.hp);
    st.lenHist[Math.min(63, turns)]++;
    st.duels++; if (big) { st.big7++; seg.big7++; }
    st.healHist[Math.min(15, duel.tally.healP)]++;
    if (rupt) { st.ruptDuels++; if (!won) st.ruptLost++; }
    if (locked) st.lockDuels++;
    st.turns += turns;
    return duel.over;
  }

  for (let i = 0; i < job.runs; i++) {
    const seed = hash32(job.seed, job.bot, i);
    const now = 1.7e12 + i * 600000;
    const owned = RUN.relics(meta).map(function (b) { return b.id; });
    const relicId = bot.relic(owned);
    const run = RUN.create(meta, { seed: seed, relicId: relicId, now: now, stake: STAKE, anyStake: true, dossier: STAKE >= 4 ? brain.dossier() : null, boss: BOSS, anyBoss: true });
    brain.beginRun({ days: run.daysAway || 0 });
    const rng = R.RNG.create((seed ^ 0x5bd1e995) >>> 0);
    bot.runStart();
    if (job.pre) {
      (job.pre.p || []).forEach(function (id) { if (!has(run.pBoons, id)) run.pBoons.push(id); });
      (job.pre.r || []).forEach(function (id) { if (!has(run.rBoons, id)) run.rBoons.push(id); });
    }
    const picks = [], rpicks = [];                    // [bonfire, id]
    let reached = 1, totalTurns = 0;
    if (trace) trace.push('run ' + (i + 1) + ' relic ' + relicId);
    for (;;) {
      RUN.startDuel(run);
      let winner = fight(run, rng, run.duelN);
      reached = run.duelN;
      while (winner === 'p' && run.duelN === 7 && run.phase < RUN.phaseCount(run)) {
        RUN.endDuel(run, meta, 'p', null);            // closes the phase (the scene's transform())
        RUN.nextPhase(run);
        reached = 8;
        winner = fight(run, rng, 8);                  // every later phase is counted in the "P2" column
      }
      RUN.endDuel(run, meta, winner, brain.dossier());
      if (run.stage !== 'bonfire') break;
      const off = run.offer;
      for (let e = 0; e < off.events.length; e++) if (off.events[e].t === 'forget') brain.forget(off.events[e].n || 0.5);
      const bf = off.bonfire;
      if (job.forceR && job.forceR[bf - 1] && off.rivalPick) {             // scenario: the Rival's draft is dictated
        const fr = job.forceR[bf - 1];
        if (!has(run.pBoons, fr) && !has(run.rBoons, fr)) { run.rBoons[run.rBoons.length - 1] = fr; off.rivalPick = fr; off.choices = off.choices.filter(function (c) { return c !== fr; }); }
      }
      if (off.rivalPick) rpicks.push([bf, off.rivalPick]);
      let id;
      if (job.force && job.force[bf - 1] && !has(run.rBoons, job.force[bf - 1]) && !has(run.pBoons, job.force[bf - 1])) {
        id = job.force[bf - 1];
        if (!has(off.choices, id)) off.choices[0] = id;                     // scenario: the player's draft is dictated
      } else {
        id = bot.draft({ choices: off.choices, pBoons: run.pBoons, rBoons: run.rBoons, rivalPick: off.rivalPick, bonfire: bf,
                         moves: run.stats.moves, hp: run.pHp, maxHp: run.pMaxHp });
      }
      if (!RUN.pick(run, id, meta)) throw new Error('draft refused: ' + id);
      picks.push([bf, id]);
      if (trace) trace.push(' bonfire ' + bf + ': healed ' + off.healed + ' -> hp ' + run.pHp + ', rival takes ' + off.rivalPick + ', player takes ' + id);
    }
    run.stats.score = brain.runScore();
    const fin = RUN.finish(run, meta, now + 300000);
    (fin.unlocks || []).forEach(function (u) { if (st.unlockRun[u.id] === undefined) st.unlockRun[u.id] = i + 1; });

    const won = run.stage === 'won', bk = bucketOf(i + 1), w = won ? 1 : 0;
    totalTurns = run.stats.turns;
    st.runs++; st.wins += w; st.bRuns[bk]++; st.bWins[bk] += w; st.bReach[bk] += reached; st.bScore[bk] += run.stats.score;
    st.reach += reached;
    st.deathAt[won ? 9 : reached]++;
    if (won) { st.winTurns += totalTurns; st.winTurnsHist[Math.min(63, Math.floor(totalTurns / 4))]++; }
    let j;
    for (j = 0; j < picks.length; j++) {
      const r1 = boonRow(st.pb, picks[j][1]); r1.n[picks[j][0]]++; r1.w[picks[j][0]] += w;
      st.bonN[picks[j][0]]++; st.bonW[picks[j][0]] += w;
    }
    for (j = 0; j < rpicks.length; j++) { const r2 = boonRow(st.rb, rpicks[j][1]); r2.n[rpicks[j][0]]++; r2.w[rpicks[j][0]] += w; }
    const rl = st.relic[relicId || 'none'] || (st.relic[relicId || 'none'] = { n: 0, w: 0 });
    rl.n++; rl.w += w;
    if (trace) trace.push(' => ' + (won ? 'WON' : 'died at ' + reached) + ' after ' + totalTurns + ' turns, score ' + run.stats.score);
  }
  st.lifeScore = brain.dossier().predictability;
  st.trust = brain.trust();
  st.ms = Date.now() - t0;
  return { bot: job.bot, tag: job.tag || job.bot, stats: st, trace: trace };
}

// ------------------------------------------------------------------ worker entry
if (!WT.isMainThread) {
  applySet(WT.workerData.set);
  WT.parentPort.on('message', function (job) {
    let out;
    try { out = runChain(job); } catch (e) { out = { error: String(e && e.stack || e), tag: job.tag || job.bot }; }
    WT.parentPort.postMessage(out);
  });
  return;
}

// ------------------------------------------------------------------ main: CLI
function parseArgs(argv) {
  const a = { runs: 400, seeds: 6, seed: 1, bots: BOT_NAMES.slice(), quick: false, jobs: Math.max(1, Math.min(os.cpus().length - 1, 16)),
              unlocks: 'natural', combos: true, set: [], label: null, trace: false, boons: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--runs') a.runs = parseInt(argv[++i], 10);
    else if (k === '--seeds') a.seeds = parseInt(argv[++i], 10);
    else if (k === '--seed') a.seed = parseInt(argv[++i], 10);
    else if (k === '--bot' || k === '--bots') a.bots = argv[++i] === 'all' ? BOT_NAMES.slice() : argv[i].split(',');
    else if (k === '--quick') a.quick = true;
    else if (k === '--jobs') a.jobs = parseInt(argv[++i], 10);
    else if (k === '--unlocks') a.unlocks = argv[++i];
    else if (k === '--no-combos') a.combos = false;
    else if (k === '--no-boons') a.boons = false;
    else if (k === '--rupture-fix') { /* accepted for old command lines; the rule is fixed in combat.js now */ }
    else if (k === '--set') a.set.push(argv[++i]);
    else if (k === '--label') a.label = argv[++i];
    else if (k === '--trace') a.trace = true;
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 20).join('\n')); process.exit(0); }
    else throw new Error('unknown argument ' + k);
  }
  if (a.quick) { a.runs = Math.min(a.runs, 400); a.seeds = Math.min(a.seeds, 2); a.combos = false; }
  a.bots.forEach(function (b) { if (BOT_NAMES.indexOf(b) < 0) throw new Error('unknown bot ' + b + ' (have: ' + BOT_NAMES.join(', ') + ')'); });
  return a;
}

function runJobs(jobs, nWorkers, set) {
  return new Promise(function (resolve, reject) {
    const results = [];
    let next = 0, live = 0, failed = false;
    if (!jobs.length) return resolve(results);
    function spawn() {
      const w = new WT.Worker(__filename, { workerData: { set: set } });
      live++;
      function feed() {
        if (next >= jobs.length || failed) { w.terminate(); live--; if (!live && !failed) resolve(results); return; }
        w.postMessage(jobs[next++]);
      }
      w.on('message', function (m) {
        if (m.error) { failed = true; reject(new Error(m.tag + ': ' + m.error)); return; }
        results.push(m); feed();
      });
      w.on('error', function (e) { failed = true; reject(e); });
      feed();
    }
    const n = Math.min(nWorkers, jobs.length);
    for (let i = 0; i < n; i++) spawn();
  });
}

// ------------------------------------------------------------------ report helpers
function pct(a, b, d) { return b > 0 ? (100 * a / b).toFixed(d === undefined ? 1 : d) : ' n/a'; }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function quantile(hist, qv, scale) {
  let total = 0, i;
  for (i = 0; i < hist.length; i++) total += hist[i];
  if (!total) return 0;
  let acc = 0;
  for (i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= qv * total) return i * (scale || 1); }
  return (hist.length - 1) * (scale || 1);
}
function steady(s) { return { n: s.bRuns[2] + s.bRuns[3], w: s.bWins[2] + s.bWins[3] }; }
function uplift(tbl, s) {
  // holders = runs that took the boon at bonfire b; baseline = runs that reached bonfire b and did not take it there
  const out = [];
  for (const id in tbl) {
    const r = tbl[id];
    let n = 0, w = 0, base = 0;
    for (let b = 1; b <= 6; b++) {
      if (!r.n[b]) continue;
      const on = s.bonN[b] - r.n[b], ow = s.bonW[b] - r.w[b];
      if (on <= 0) continue;
      n += r.n[b]; w += r.w[b]; base += r.n[b] * ow / on;
    }
    if (n > 0) out.push({ id: id, n: n, wr: w / n, base: base / n, up: (w - base) / n });
  }
  out.sort(function (a, b) { return b.up - a.up; });
  return out;
}

function headline(byBot, bots) {
  const lines = [];
  lines.push(pad('bot', 10) + lpad('runs', 7) + lpad('win%', 7) + BUCKET_NAMES.map(function (b) { return lpad(b, 8); }).join('') + lpad('51+', 8) +
             lpad('reach', 7) + lpad('life', 6) + lpad('trust', 7) + lpad('7+hit%', 8) + lpad('turns/d', 8) + lpad('rupt%', 7) + lpad('lock%', 7) + lpad('runs/s', 8));
  bots.forEach(function (b) {
    const s = byBot[b];
    if (!s) return;
    const sd = steady(s);
    lines.push(pad(b, 10) + lpad(s.runs, 7) + lpad(pct(s.wins, s.runs), 7) +
      [0, 1, 2, 3].map(function (i) { return lpad(pct(s.bWins[i], s.bRuns[i]), 8); }).join('') + lpad(pct(sd.w, sd.n), 8) +
      lpad((s.reach / s.runs).toFixed(2), 7) + lpad((s.lifeScore / s.chains).toFixed(0), 6) + lpad((s.trust / s.chains).toFixed(2), 7) +
      lpad(pct(s.big7, s.duels, 2), 8) + lpad((s.turns / s.duels).toFixed(2), 8) + lpad(pct(s.ruptDuels, s.duels, 2), 7) + lpad(pct(s.lockDuels, s.duels, 2), 7) + lpad((1000 * s.runs / s.ms).toFixed(0), 8));
  });
  return lines;
}
function segTable(s, f, d) {
  let out = '';
  for (let k = 1; k <= 8; k++) out += lpad(s.seg[k].n ? f(s.seg[k]).toFixed(d === undefined ? 1 : d) : '-', 7);
  return out;
}
function perDuel(byBot, bots) {
  const lines = [];
  const head = '            ' + [1, 2, 3, 4, 5, 6, 7, 'P2'].map(function (x) { return lpad('d' + x, 7); }).join('');
  const rows = [
    ['duel win %', function (g) { return 100 * g.w / g.n; }],
    ['fights', function (g) { return g.n; }, 0],
    ['turns', function (g) { return g.turns / g.n; }, 2],
    ['HP in', function (g) { return g.hpIn / g.n; }, 2],
    ['honest %', function (g) { return 100 * g.honest / g.tells; }],
    ['trap %', function (g) { return 100 * g.trap / g.tells; }],
    ['R exch win%', function (g) { return 100 * g.rWin / g.tells; }],
    ['P exch win%', function (g) { return 100 * g.pWin / g.tells; }],
    ['clash %', function (g) { return 100 * g.clash / g.tells; }],
    ['P counters%', function (g) { return 100 * g.counter / g.tells; }],
    ['7+ hit duel%', function (g) { return 100 * g.big7 / g.n; }, 2]
  ];
  bots.forEach(function (b) {
    const s = byBot[b];
    if (!s) return;
    lines.push('--- ' + b + '   death duel share: ' + [1, 2, 3, 4, 5, 6, 7, 8].map(function (k) { return 'd' + (k === 8 ? 'P2' : k) + ' ' + pct(s.deathAt[k], s.runs, 0); }).join('  ') + '  won ' + pct(s.deathAt[9], s.runs, 0) +
      '   | mean score by bucket: ' + [0, 1, 2, 3].map(function (i) { return s.bRuns[i] ? (s.bScore[i] / s.bRuns[i]).toFixed(0) : '-'; }).join(' / '));
    lines.push(head);
    rows.forEach(function (r) { lines.push('  ' + pad(r[0], 12) + segTable(s, r[1], r[2])); });
    lines.push('  duel length p50/p90/p99: ' + quantile(s.lenHist, 0.5) + ' / ' + quantile(s.lenHist, 0.9) + ' / ' + quantile(s.lenHist, 0.99) +
      '   winning run turns mean ' + (s.deathAt[9] ? (s.winTurns / s.deathAt[9]).toFixed(1) : '-') + ' (p10 ' + quantile(s.winTurnsHist, 0.1, 4) + ', p90 ' + quantile(s.winTurnsHist, 0.9, 4) + ')' +
      '   max hit on player ' + s.maxHit + '   mean legal moves ' + (s.legalSum / s.turns).toFixed(3));
    let hits = 0, h5 = 0;
    for (let k = 0; k < s.hitHist.length; k++) { hits += s.hitHist[k]; if (k >= 5) h5 += s.hitHist[k]; }
    lines.push('  hits taken by size (share of the exchanges the Rival won): ' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (k) { return k + ': ' + pct(s.hitHist[k], hits, 0) + '%'; }).join('  ') + '   (5+: ' + pct(h5, hits) + '%)');
  });
  return lines;
}
function boonTables(byBot, bots) {
  const lines = [];
  bots.forEach(function (b) {
    const s = byBot[b];
    if (!s) return;
    const up = uplift(s.pb, s), rp = uplift(s.rb, s);
    lines.push('--- ' + b + ': player boons, conditional uplift in run win rate (points) = P(win | took it at bonfire b) - P(win | reached b, took something else)');
    let row = '';
    up.forEach(function (u, i) {
      row += pad('  ' + u.id, 21) + lpad((100 * u.up >= 0 ? '+' : '') + (100 * u.up).toFixed(1), 6) + lpad('(' + u.n + ')', 8);
      if (i % 4 === 3) { lines.push(row); row = ''; }
    });
    if (row) lines.push(row);
    lines.push('--- ' + b + ': Rival boons, change in the PLAYER\'s run win rate when the Rival took it (points; negative = it hurts the player)');
    row = '';
    rp.reverse().forEach(function (u, i) {
      row += pad('  ' + u.id, 21) + lpad((100 * u.up >= 0 ? '+' : '') + (100 * u.up).toFixed(1), 6) + lpad('(' + u.n + ')', 8);
      if (i % 4 === 3) { lines.push(row); row = ''; }
    });
    if (row) lines.push(row);
    const rel = Object.keys(s.relic).map(function (id) { return id.replace('relic_', '') + ' ' + pct(s.relic[id].w, s.relic[id].n) + '% (' + s.relic[id].n + ')'; });
    lines.push('  relics (run win rate when carried): ' + rel.join(',  '));
  });
  return lines;
}

// ------------------------------------------------------------------ dangerous combos (DESIGN §8)
function comboJobs(a, runs, seeds) {
  const jobs = [];
  function add(tag, bot, o) {
    for (let s = 0; s < seeds; s++) jobs.push(Object.assign({ tag: tag, bot: bot, seed: a.seed * 1000 + 500 + s, runs: runs, unlocks: 'all' }, o));
  }
  ['mixer', 'adaptive'].forEach(function (b) {
    add('base/' + b, b, {});
    add('c1/' + b, b, { pre: { r: ['coiled_riposte', 'first_blood', 'deathblow_creed', 'resonance'] } });
    add('c3/' + b, b, { pre: { p: ['vampires_curtsy', 'paper_cuts', 'carrion_comfort', 'salt_the_wound'] } });
    add('c4/' + b, b, { pre: { p: ['long_con', 'debt_collector', 'turtle_cracker'] } });
    add('c5/' + b, b, { pre: { r: ['no_encores', 'sealing_wax'] } });
    add('c6/' + b, b, { pre: { r: ['hungry_mask', 'mourning_veil', 'spare_mask'] } });
    add('c9/' + b, b, { pre: { p: ['mirror_etiquette', 'resonance'] } });
  });
  add('c8/adaptive', 'adaptive', { force: ['keyhole', 'truth_candle', 'ash_of_forgetting'] });
  add('base/guard', 'guard', {});
  add('c2/guard', 'guard', { pre: { p: ['stone_patience', 'thorned_guard', 'ash_veil', 'mirror_etiquette'] } });
  add('base/uniform', 'uniform', {});
  add('c7/uniform', 'uniform', { pre: { p: ['coin_of_fools', 'broken_pattern', 'three_faces'] } });
  add('c7/adaptive', 'adaptive', { pre: { p: ['coin_of_fools', 'broken_pattern', 'three_faces'] } });
  return jobs;
}
function comboReport(by) {
  const L = [];
  function wr(t) { return by[t] ? pct(by[t].wins, by[t].runs) + '%' : 'n/a'; }
  function big(t) { return by[t] ? pct(by[t].big7, by[t].duels, 2) + '%' : 'n/a'; }
  function ok(c) { return c ? 'ok' : 'NOT MET'; }
  let s, t;
  L.push('  (all unlocks, fresh brain per chain; "pre" = the boons are held from duel 1 on top of the normal draft)');
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c1/' + b];
    if (s) L.push('  1. Rival pre coiled_riposte+first_blood+deathblow_creed+resonance vs ' + b + ': duels with a 7+ hit ' + big('c1/' + b) + ' (baseline ' + big('base/' + b) + '), max hit ' + s.maxHit +
      ', run win ' + wr('c1/' + b) + ' (baseline ' + wr('base/' + b) + ')  [target < 3%: ' + ok(s.big7 / s.duels < 0.03) + ']');
  });
  s = by['c2/guard'];
  if (s) L.push('  2. guard bot pre stone_patience+thorned_guard+ash_veil+mirror_etiquette: run win ' + wr('c2/guard') + ' (baseline ' + wr('base/guard') + '), mean duel reached ' + (s.reach / s.runs).toFixed(2) + '  [must still lose: ' + ok(s.wins / s.runs <= 0.02) + ']');
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c3/' + b];
    if (s) {
      let n = 0, sum = 0, over = 0;
      for (let i = 0; i < s.healHist.length; i++) { n += s.healHist[i]; sum += i * s.healHist[i]; if (i > 5) over += s.healHist[i]; }
      L.push('  3. ' + b + ' pre vampires_curtsy+paper_cuts+carrion_comfort+salt_the_wound: heal per duel mean ' + (sum / n).toFixed(2) + ', p95 ' + quantile(s.healHist, 0.95) + ', duels healing > 5: ' + pct(over, n, 2) +
        '%, run win ' + wr('c3/' + b) + ' (baseline ' + wr('base/' + b) + ')  [target <= 5: ' + ok(over / n < 0.01) + ']');
    }
  });
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c4/' + b]; t = by['base/' + b];
    if (s) L.push('  4. ' + b + ' pre long_con+debt_collector+turtle_cracker: net swing per guard break ' + (s.brkNet / s.brkN).toFixed(2) + ' (dealt ' + (s.brkDealt / s.brkN).toFixed(2) + '; baseline net ' + (t.brkNet / t.brkN).toFixed(2) +
      '), run win ' + wr('c4/' + b) + ' (baseline ' + wr('base/' + b) + ')  [target <= 4: ' + ok(s.brkNet / s.brkN <= 4) + ']');
  });
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c5/' + b];
    if (s) L.push('  5. Rival pre no_encores+sealing_wax vs ' + b + ': player mean legal moves ' + (s.legalSum / s.turns).toFixed(3) + ', turns with only 2 legal ' + pct(s.legal2, s.turns) + '%, run win ' + wr('c5/' + b) +
      ' (baseline ' + wr('base/' + b) + ')  [target >= 2.4: ' + ok(s.legalSum / s.turns >= 2.4) + ']');
  });
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c6/' + b];
    if (s) L.push('  6. Rival pre hungry_mask+mourning_veil+spare_mask vs ' + b + ': duel length p50/p99/max ' + quantile(s.lenHist, 0.5) + ' / ' + quantile(s.lenHist, 0.99) + ' / ' + quantile(s.lenHist, 1) +
      ', run win ' + wr('c6/' + b) + ' (baseline ' + wr('base/' + b) + ')  [target p99 <= 25: ' + ok(quantile(s.lenHist, 0.99) <= 25) + ']');
  });
  ['uniform', 'adaptive'].forEach(function (b) {
    s = by['c7/' + b];
    if (s && s.coinN) L.push('  7. ' + b + ' pre coin_of_fools+broken_pattern+three_faces: net damage per coin turn ' + (s.coinNet / s.coinN).toFixed(2) + ' vs ' + (s.nocoinN ? (s.nocoinNet / s.nocoinN).toFixed(2) : 'n/a') +
      ' on turns it held a charge and chose itself (' + s.coinN + ' / ' + s.nocoinN + ' turns): edge ' + (s.nocoinN ? (s.coinNet / s.coinN - s.nocoinNet / s.nocoinN).toFixed(2) : 'n/a') +
      ', run win ' + wr('c7/' + b) + ' (baseline ' + wr('base/' + b) + ')' + (b === 'uniform' ? '  [target edge <= 1.2: ' + ok(s.coinNet / s.coinN - s.nocoinNet / s.nocoinN <= 1.2) + ']' : ''));
  });
  s = by['c8/adaptive']; t = by['base/adaptive'];
  if (s && t) L.push('  8. adaptive drafting keyhole, truth_candle, ash_of_forgetting at bonfires 1-3: run win ' + wr('c8/adaptive') + ' vs ' + wr('base/adaptive') + ' = ' + (100 * (s.wins / s.runs - t.wins / t.runs)).toFixed(1) +
    ' points  [target <= 12: ' + ok(s.wins / s.runs - t.wins / t.runs <= 0.12) + ']');
  ['mixer', 'adaptive'].forEach(function (b) {
    s = by['c9/' + b];
    if (s) L.push('  9. ' + b + ' pre mirror_etiquette+resonance: healed by clashes ' + (s.mirrorHeal / s.duels).toFixed(3) + ' per duel vs Rupture damage taken ' + (s.ruptureP / s.duels).toFixed(3) +
      ' per duel, run win ' + wr('c9/' + b) + ' (baseline ' + wr('base/' + b) + ')');
  });
  return L;
}

// ------------------------------------------------------------------ main
(async function main() {
  const a = parseArgs(process.argv);
  applySet(a.set);                                    // so that the printed constants are the ones simulated
  const t0 = Date.now();
  const D = RUN.DUELS;
  const consts = 'rivalHp ' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return D[n].rivalHp; }).join(',') + ' | p2 ' + D.phase2.rivalHp +
    ' | player max HP ' + RUN.PLAYER_MAX_HP + ' | heal ' + RUN.HEAL + ' | p2heal ' + RUN.PHASE2_HEAL + ' | exploit ' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return D[n].exploit; }).join(',') + ' p2 ' + D.phase2.exploit +
    ' | honesty ' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return D[n].honesty; }).join(',') + ' p2 ' + D.phase2.honesty + ' | hit cap ' + C.HIT_CAP;
  console.log('SHOW ME MY RIVAL balance sim   seed ' + a.seed + ', ' + a.seeds + ' chains x ' + a.runs + ' sequential runs per bot, unlocks ' + a.unlocks + ', ' + a.jobs + ' workers');
  console.log('constants: ' + consts);
  if (a.set.length) console.log('overrides: ' + a.set.join('  '));

  if (a.trace) {
    const out = runChain({ bot: a.bots[0], seed: a.seed, runs: Math.min(a.runs, 3), unlocks: a.unlocks, trace: true });
    console.log(out.trace.join('\n'));
    return;
  }

  const jobs = [];
  a.bots.forEach(function (b) { for (let s = 0; s < a.seeds; s++) jobs.push({ bot: b, tag: b, seed: a.seed * 1000 + s, runs: a.runs, unlocks: a.unlocks }); });
  const cj = a.combos ? comboJobs(a, Math.min(a.runs, 300), Math.max(2, Math.min(a.seeds, 4))) : [];
  const res = await runJobs(jobs.concat(cj), a.jobs, a.set);
  const by = {};
  res.forEach(function (r) { by[r.tag] = merge(by[r.tag] || newStats(), r.stats); });

  console.log('\n=== HEADLINE (run win rate %; buckets are the run ordinal inside a chain; 51+ = steady state) ===');
  const hl = headline(by, a.bots);
  console.log(hl.join('\n'));
  console.log('  reach = mean duel reached (8 = phase 2); life = the Rival\'s lifetime predictability score 0..100; trust = its smoothed COUNTER share at the end;');
  console.log('  rupt% = duels with at least one Rupture; lock% = duels with ' + BORED_AFTER + '+ clashes in a row at 3 pips (should be about 0).');
  console.log('\n=== PER DUEL ===');
  console.log(perDuel(by, a.bots).join('\n'));
  if (a.boons) {
    console.log('\n=== BOONS ===');
    console.log(boonTables(by, a.bots.filter(function (b) { return b === 'mixer' || b === 'adaptive'; })).join('\n'));
  }
  if (a.combos) {
    console.log('\n=== DANGEROUS COMBOS (DESIGN §8) ===');
    console.log(comboReport(by).join('\n'));
  }
  const secs = (Date.now() - t0) / 1000;
  let totalRuns = 0;
  res.forEach(function (r) { totalRuns += r.stats.runs; });
  console.log('\n' + totalRuns + ' runs in ' + secs.toFixed(1) + ' s (' + (totalRuns / secs).toFixed(0) + ' runs/s wall clock)');

  if (a.label) {
    const dir = path.join(__dirname, 'out');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* exists */ }
    const entry = '\n## ' + a.label + '\n' + consts + (a.set.length ? '\noverrides: ' + a.set.join('  ') : '') + '\n' + a.seeds + ' x ' + a.runs + ' runs, unlocks ' + a.unlocks + '\n```\n' + hl.join('\n') + '\n' +
      ['mixer', 'adaptive', 'uniform'].filter(function (b) { return by[b]; }).map(function (b) {
        return pad(b, 9) + ' duel win% ' + segTable(by[b], function (g) { return 100 * g.w / g.n; }) + '\n' + pad('', 9) + ' honest %  ' + segTable(by[b], function (g) { return 100 * g.honest / g.tells; });
      }).join('\n') + '\n```\n';
    fs.appendFileSync(path.join(dir, 'balance_log.md'), entry);
  }
})().catch(function (e) { console.error(e); process.exit(1); });
