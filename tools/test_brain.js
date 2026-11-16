// THE RIVAL — tests + learning benchmark for src/ai/brain.js.   node tools/test_brain.js
// Exit code 1 on any failed check. Uses a tiny local model of the duel rules (DESIGN §4):
// HP 12 vs 10, tension, guard break, Rupture chip. No boons, no phase 2.
//   RIVAL_LOCKSTEP=full   section 3b plays 100 snapshot and 100 chained games (default: 1 and 20; 2,000 turns each)
//   RIVAL_OLD_SAVES=print print the old-build saves of section 3c regenerated from git history, then exit
//   RIVAL_OLD_SAVES=check also check that regenerated text against the embedded saves (not part of the default run)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const SRC = path.join(__dirname, '..', 'src');
require(path.join(SRC, 'core', 'rng.js'));
require(path.join(SRC, 'ai', 'brain.js'));
// The run tables, only for section 1c (which duels can hide the stance). Pure modules; the brain does not read them.
require(path.join(SRC, 'game', 'boons.js'));
require(path.join(SRC, 'game', 'combat.js'));
require(path.join(SRC, 'game', 'run.js'));
const R = globalThis.RIVAL;
const MOVES = R.MOVES, BEATS = R.BEATS, LOSES_TO = R.LOSES_TO;

let failures = 0, checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
}
function section(t) { console.log('\n=== ' + t + ' ==='); }
function f2(x) { return (x >= 0 ? '+' : '') + x.toFixed(2); }
function pc(x) { return (100 * x).toFixed(1); }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// ---------------------------------------------------------------- local rules model
const BASE = { S: 3, G: 2, F: 2 };
const BREAK = 0.86;
function newDuel(n) {
  return { n: n, turn: 1, tension: 0, pHp: 12, pMax: 12, rHp: 10, rMax: 10,
           pBroken: false, rBroken: false, prev1: null, prev2: null, prevR: null, last: null };
}
function ctxOf(d) {
  return { duel: d.n, phase: 1, turn: d.turn, prev1: d.prev1, prev2: d.prev2, prevR: d.prevR, last: d.last,
           pHp: d.pHp, pMaxHp: d.pMax, rHp: d.rHp, rMaxHp: d.rMax, tension: d.tension,
           pBroken: d.pBroken, rBroken: d.rBroken };
}
function legalOf(broken) { return broken ? ['S', 'F'] : ['S', 'G', 'F']; }
function payoffOf(tension) {
  const P = {};
  for (const r of MOVES) {
    P[r] = {};
    for (const p of MOVES) {
      let v = 0;
      if (BEATS[r] === p) v = BASE[r] + tension + (r === 'F' ? BREAK : 0);
      else if (BEATS[p] === r) v = -(BASE[p] + tension) - (p === 'F' ? BREAK : 0);
      P[r][p] = v;
    }
  }
  return P;
}
function resolve(d, pm, rm) {
  let dmgP = 0, dmgR = 0, winner = null, pB = false, rB = false;
  if (pm === rm) {
    if (d.tension >= 3) { dmgP = d.pHp > 1 ? 1 : 0; dmgR = d.rHp > 1 ? 1 : 0; }   // Rupture
    else d.tension++;
    d.last = 'C';
  } else if (BEATS[rm] === pm) {
    winner = 'r'; dmgP = Math.min(8, BASE[rm] + d.tension); d.tension = 0; pB = rm === 'F'; d.last = 'L';
  } else {
    winner = 'p'; dmgR = Math.min(8, BASE[pm] + d.tension); d.tension = 0; rB = pm === 'F'; d.last = 'W';
  }
  d.pHp -= dmgP; d.rHp -= dmgR; d.pBroken = pB; d.rBroken = rB;
  d.prev2 = d.prev1; d.prev1 = pm; d.prevR = rm; d.turn++;
  return { winner: winner, dmgP: dmgP, dmgR: dmgR, over: d.pHp <= 0 || d.rHp <= 0 };
}

// ---------------------------------------------------------------- scripted players
// Each gets only what a real player sees: the pre-exchange ctx, the shown tell, its legal moves.
const CYCLE = ['S', 'G', 'F'];
const PLAYERS = {
  'always-Guard': function () { return 'G'; },
  'cycle S>G>F': function (v) {
    for (let k = 0; k < 3; k++) {
      const m = CYCLE[(v.mem.i + k) % 3];
      if (v.legal.indexOf(m) >= 0) { v.mem.i = (v.mem.i + k + 1) % 3; return m; }
    }
    return 'S';
  },
  'guard-after-hit': function (v) { return v.ctx.last === 'L' ? 'G' : v.rng.pick(v.legal); },
  'win-stay/lose-shift': function (v) {
    if (v.ctx.last === 'W') return v.ctx.prev1;
    if (v.ctx.last === 'L') return LOSES_TO[v.ctx.prevR];     // shift to what beats its last move
    return v.rng.pick(v.legal);
  },
  'tell-truster': function (v) { return LOSES_TO[v.tell]; },   // always COUNTER the shown stance
  'tell-mirrorer': function (v) { return v.tell; },
  'uniform': function (v) { return v.rng.pick(v.legal); },
  // same, minus the one dominated move in the rules: Feinting into a guard that is already broken
  'uniform, no dud Feint': function (v) { return (v.ctx.rBroken && !v.ctx.pBroken) ? v.rng.pick(['S', 'G']) : v.rng.pick(v.legal); },
  'equilibrium': function (v) {
    const c = v.ctx, u = v.rng.next();
    if (c.pBroken && c.rBroken) return 'S';
    if (c.pBroken) return u < 5 / 7 ? 'S' : 'F';
    if (c.rBroken) return u < 4 / 7 ? 'S' : 'G';
    return u < 0.364 ? 'S' : u < 0.746 ? 'G' : 'F';
  }
};

function simulate(o) {
  const brain = o.brain || R.Brain.create(null);
  const rngR = R.RNG.create(o.seed * 7919 + 13), rngP = R.RNG.create(o.seed * 104729 + 71);
  const player = typeof o.player === 'function' ? o.player : PLAYERS[o.player];
  const mem = { i: 0 };
  const st = { turns: 0, rWin: 0, pWin: 0, clash: 0, dealt: 0, taken: 0, pAct: 0, honest: 0, ns: 0n, brain: brain };
  let duelN = 1, d = newDuel(duelN);
  if (!o.keepRun) brain.beginRun({ days: 0 });
  for (let i = 0; i < o.turns; i++) {
    const ctx = ctxOf(d), legalR = legalOf(d.rBroken), legalP = legalOf(d.pBroken);
    const q = { ctx: ctx, payoff: payoffOf(d.tension), legalR: legalR, legalP: legalP,
                exploit: o.exploit, honestyBase: o.honestyBase, rng: rngR };
    const t0 = process.hrtime.bigint();
    const sealed = brain.commit(q);
    const t1 = process.hrtime.bigint();
    let pm = player({ ctx: ctx, tell: sealed.tell, legal: legalP, rng: rngP, mem: mem, turn: i });
    if (legalP.indexOf(pm) < 0) pm = rngP.pick(legalP);
    if (o.onTurn) o.onTurn({ i: i, ctx: ctx, sealed: sealed, pm: pm, brain: brain, legalP: legalP });
    const t2 = process.hrtime.bigint();
    brain.observe(ctx, sealed.tell, pm, sealed.move);
    const t3 = process.hrtime.bigint();
    st.ns += (t1 - t0) + (t3 - t2);
    const res = resolve(d, pm, sealed.move);
    st.turns++;
    if (res.winner === 'r') st.rWin++; else if (res.winner === 'p') st.pWin++; else st.clash++;
    st.dealt += res.dmgP; st.taken += res.dmgR;
    st.pAct += sealed.pred[pm];
    if (sealed.honest) st.honest++;
    if (o.afterTurn) o.afterTurn({ i: i, ctx: ctx, sealed: sealed, pm: pm, res: res, brain: brain });
    if (res.over) { duelN = duelN % 7 + 1; d = newDuel(duelN); }
  }
  return st;
}
function averaged(o, seeds) {
  const a = { rWin: 0, pWin: 0, clash: 0, net: 0, pAct: 0, honest: 0, ns: 0n, turns: 0 };
  for (let s = 1; s <= seeds; s++) {
    const st = simulate(Object.assign({}, o, { seed: (o.seed || 0) + s }));
    a.rWin += st.rWin / st.turns; a.pWin += st.pWin / st.turns; a.clash += st.clash / st.turns;
    a.net += (st.dealt - st.taken) / st.turns; a.pAct += st.pAct / st.turns; a.honest += st.honest / st.turns;
    a.ns += st.ns; a.turns += st.turns;
  }
  for (const k of ['rWin', 'pWin', 'clash', 'net', 'pAct', 'honest']) a[k] /= seeds;
  return a;
}

function randomCtx(rng, pBroken, rBroken) {
  const mv = function () { return rng.chance(0.15) ? null : rng.pick(MOVES); };
  const turn = 1 + rng.int(12);
  return { duel: 1 + rng.int(7), phase: 1 + rng.int(2), turn: turn,
           prev1: turn === 1 ? null : mv(), prev2: turn <= 2 ? null : mv(), prevR: turn === 1 ? null : mv(),
           last: turn === 1 ? null : rng.pick(['W', 'L', 'C']),
           pHp: 1 + rng.int(12), pMaxHp: 12, rHp: 1 + rng.int(10), rMaxHp: 10, tension: rng.int(4),
           pBroken: !!pBroken, rBroken: !!rBroken };
}
function randomPayoff(rng) {
  const P = {};
  for (const r of MOVES) { P[r] = {}; for (const p of MOVES) P[r][p] = Math.round(rng.range(-9, 9) * 100) / 100; }
  return P;
}
function sealedProblems(sealed, legalR, legalP) {
  const bad = [];
  if (legalR.indexOf(sealed.move) < 0) bad.push('move ' + sealed.move + ' not in legalR');
  if (legalR.indexOf(sealed.tell) < 0) bad.push('tell ' + sealed.tell + ' not in legalR');
  if (sealed.honest !== (sealed.move === sealed.tell)) bad.push('honest flag wrong');
  let sum = 0;
  for (const m of MOVES) {
    const v = sealed.pred[m];
    if (typeof v !== 'number' || !(v >= 0 && v <= 1)) bad.push('pred.' + m + '=' + v);
    if (legalP.indexOf(m) < 0 && v !== 0) bad.push('pred of illegal ' + m + '=' + v);
    sum += v;
  }
  if (!(Math.abs(sum - 1) < 1e-9)) bad.push('pred sums to ' + sum);
  if (legalP.indexOf(sealed.top) < 0) bad.push('top ' + sealed.top + ' not in legalP');
  if (!(sealed.confidence >= 0 && sealed.confidence <= 1)) bad.push('confidence ' + sealed.confidence);
  if (sealed.mode !== 'exploit' && sealed.mode !== 'mix') bad.push('mode ' + sealed.mode);
  return bad;
}
function trained(playerName, turns, seed, exploit, honestyBase) {
  return simulate({ player: playerName, turns: turns, seed: seed, exploit: exploit === undefined ? 0.6 : exploit,
                    honestyBase: honestyBase === undefined ? 0.7 : honestyBase }).brain;
}

// ---------------------------------------------------------------- reload helpers (sections 1, 3, 3b, 3c)
// What a page reload does to the brain: the save text is all that survives.
function reload(b) { return R.Brain.create(JSON.parse(JSON.stringify(b.serialize()))); }
// Deep equality with Object.is on every number (so 1e-17 or -0 counts) and the same key order.
function bitSame(a, b) {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || !bitSame(a[ka[i]], b[kb[i]])) return false;
  return true;
}
function hasNegZero(x) {
  if (typeof x === 'number') return Object.is(x, -0);
  if (x && typeof x === 'object') for (const k of Object.keys(x)) if (hasNegZero(x[k])) return true;
  return false;
}
// The order brain.serialize() writes pk in (brain.js PEAK_IDS), and the frozen expert-table sizes (SIZES x 3).
const PEAK_ORDER = ['fav_move', 'opening', 'after_loss', 'after_win', 'low_hp', 'two_step', 'loop3', 'deathblow_nerves', 'broken_panic', 'vs_broken'];
const TABLE_LENS = [3, 9, 27, 9, 27, 6, 3, 9, 12, 12, 3, 9, 9];
// The Rival's own seat, for q.mimic: the player's view of the duel turned around.
function mimicCtxOf(d) {
  return { duel: d.n, phase: 1, turn: d.turn, prev1: d.prevR, prev2: null, prevR: d.prev1,
           last: d.last === 'W' ? 'L' : d.last === 'L' ? 'W' : d.last, pHp: d.rHp, pMaxHp: d.rMax, rHp: d.pHp, rMaxHp: d.pMax,
           tension: d.tension, pBroken: d.rBroken, rBroken: d.pBroken };
}
// Duel n's exploit and honesty base, roughly the run's ramp; 10% of turns hide the stance, 10% mimic.
const RAMP_EXPLOIT = [0.3, 0.5, 0.65, 0.75, 0.85, 0.95, 1], RAMP_HONESTY = [0.97, 0.9, 0.82, 0.74, 0.64, 0.5, 0.42];
function rampQuestion(d, sit, modes) {
  const q = { ctx: ctxOf(d), payoff: payoffOf(d.tension), legalR: legalOf(d.rBroken), legalP: legalOf(d.pBroken),
              exploit: RAMP_EXPLOIT[d.n - 1], honestyBase: RAMP_HONESTY[d.n - 1] };
  if (modes) { const u = sit.next(); if (u < 0.1) q.noTell = true; else if (u < 0.2) q.mimic = mimicCtxOf(d); }
  return q;
}
// The player answers only after the seal, seeing the stance unless it was hidden.
function answer(name, q, sealed, prng, mem, i) {
  let pm = PLAYERS[name]({ ctx: q.ctx, tell: q.noTell ? null : sealed.tell, legal: q.legalP, rng: prng, mem: mem, turn: i });
  if (q.legalP.indexOf(pm) < 0) pm = prng.pick(q.legalP);
  return pm;
}

// ---------------------------------------------------------------- saves written by earlier builds (section 3c)
// The exact save text three earlier builds wrote (their serialize() kept pk in first-seen order and did not
// quantise in memory). A fixed script played each one: OLD_PLAY below, on that build's own brain.js. The embedded
// text is the acceptance. RIVAL_OLD_SAVES=check regenerates it from `git show <sha>:src/ai/brain.js` and compares;
// RIVAL_OLD_SAVES=print prints it. Both replay with this file's current players and rules model, so a later edit to
// those helpers can change the regenerated text while the old builds and their saves stay the same: that is why the
// default run (and the gate) does not regenerate.
const OLD_PLAY = {
  '6e8a65b': { seed: 61, turns: 900, start: 2, modes: false },
  '42ec57c': { seed: 42, turns: 1300, start: 0, modes: false },
  '0cba25d': { seed: 25, turns: 1100, start: 5, modes: true }
};
const OLD_SAVES = {
  '6e8a65b': '{"v":1,"n":900,"runs":15,"w":[0.0515,0.0317,0.0289,0.0847,0.082,0.125,0.0777,0.0624,0.0733,0.0791,0.0742,0.0366,0.1928],"c":[[5.563,5.102,3.599],[3.674,3.711,2.48,3.994,3.528,1.907,4.949,1.778,2.995],[2.761,1.827,1.45,2.369,2.401,0.779,1.516,1.826,2.711,3.299,2.18,0.599,2.227,2.004,0.186,2.652,1.023,1.507,1,2.303,2.866,3.168,1.175,1.038,2.863,1.085,1.625],[4.685,4.057,1.011,3.82,3.352,2.505,3.298,1.896,4.588],[2.132,2.035,1.086,2.31,3.096,0.751,4.448,1.58,0.057,2.149,3.103,1.019,0,0,0,2.466,1.445,2.374,2.402,1.422,2.654,2.961,0.754,2.105,0.497,1.388,3.011],[2.855,4.827,2.308,5.606,0.698,3.298],[1.905,1.23,1.71],[3.512,3.369,3.044,5.381,3.329,1.105,2.177,2.694,3.407],[3.191,3.803,1.335,2.224,2.143,3.707,3.017,0.702,2.63,1.917,0.687,1.352],[2.393,3.775,2.165,2.759,0,3.069,5.147,1.962,0.117,0,0,0],[2.152,4.25,6.088],[1.81,3.71,2.756,1.797,2.687,3.805,2.648,2.125,3.295],[1.328,2.068,4.933,1.322,0.847,3.189,1.771,5.372,0.968]],"life":[[249,296,270],[89,85,97,56,65,56,78,109,76],[28,24,28,16,19,21,22,35,24,35,28,33,14,12,14,23,27,26,15,23,31,18,27,13,20,26,19],[69,72,59,52,95,68,102,92,102],[20,19,12,23,34,23,26,19,24,22,24,35,0,0,0,30,71,33,47,42,50,33,31,33,22,19,19],[203,233,205,46,63,65],[26,37,41],[100,147,106,81,74,92,42,38,31],[147,204,168,69,59,62,21,20,28,12,13,12],[223,277,246,47,0,38,26,19,24,0,0,0],[318,300,197],[122,102,69,109,106,60,87,92,68],[186,217,143,52,39,16,80,44,38]],"run":[[25,18,15],[8,8,5,6,5,3,7,4,4],[2,2,1,3,2,1,1,2,2,3,2,0,1,2,0,2,1,1,1,3,3,2,1,1,2,0,1],[10,7,1,6,6,3,5,4,8],[2,1,0,4,4,1,4,2,0,3,4,1,0,0,0,3,2,2,3,3,4,2,1,2,0,0,2],[17,17,10,8,1,5],[4,1,3],[10,9,7,9,7,3,2,1,2],[20,14,7,2,4,6,2,0,2,1,0,0],[21,16,15,0,0,2,4,2,0,0,0,0],[17,21,20],[7,10,5,6,7,11,4,4,4],[13,12,17,1,0,1,3,9,2]],"t2":0,"ema":0.0021,"rs":-0.023,"rn":60,"pk":{"two_step":{"k":2,"m":1,"p":64,"r":3,"s":1},"low_hp":{"k":1,"m":1,"p":65,"r":2,"s":0},"fav_move":{"k":0,"m":1,"p":47,"r":3,"s":0}}}',
  '42ec57c': '{"v":1,"n":1300,"runs":22,"w":[0.0601,0.0979,0.0573,0.0966,0.1079,0.1128,0.0493,0.0374,0.0786,0.0913,0.0732,0.0532,0.0844],"c":[[5.427,5.708,2.861],[2.581,5.021,1.653,3.522,1.458,3.18,4.685,2.691,0.549],[1.242,2.861,1.279,2.372,0.623,2.202,2.322,1.271,0.921,1.093,2.798,1.071,1.16,0.594,1.258,2.825,1.612,0.078,2.035,1.39,1.187,1.653,1.27,0.695,0.892,1.519,0.176],[4.948,0.9,1.326,3.737,2.687,2.036,2.661,4.965,1.713],[2.462,0.254,0.702,2.531,0.375,1.309,2.29,1.402,0.005,2.001,2.102,1.609,0,0,0,2.602,1.012,0.868,0.983,4.159,0.593,1.97,1.457,2.124,2.605,1.718,0.064],[5.643,2.806,1.299,1.751,4.462,2.7],[2.228,1.396,0.569],[3.094,4.107,1.715,3.208,3.111,2.883,4.389,1.711,0.48],[4.778,1.76,1.615,2.428,4.05,0.781,1.857,0.868,2.367,1.894,2.688,0.815],[2.757,3.789,1.768,0.316,0,3.19,2.594,1.649,0.014,0,0,0],[4.613,5.175,2.556],[2.806,4.329,0.675,2.228,2.893,2.793,2.112,2.082,2.765],[3.182,3.297,1.814,0.352,1.345,2.082,1.927,3.567,0.585]],"life":[[339,455,338],[105,165,102,62,90,83,132,136,99],[32,27,34,25,18,33,26,35,28,32,61,27,11,26,11,65,57,24,29,58,32,19,32,23,17,30,31],[90,111,65,75,134,93,134,146,126],[26,15,12,25,58,29,39,38,24,21,58,40,0,0,0,54,76,53,58,92,50,37,32,54,39,22,22],[279,342,263,60,113,75],[40,64,54],[137,226,132,97,128,118,65,37,34],[205,309,212,76,107,78,36,25,31,22,14,17],[300,417,314,65,0,103,39,38,24,0,0,0],[381,432,319],[164,150,77,118,139,90,99,143,152],[230,310,243,53,58,26,98,64,50]],"run":[[17,12,9],[5,7,4,3,1,3,6,3,1],[1,3,2,2,0,2,2,1,1,0,2,1,0,0,1,3,1,0,2,1,1,1,1,0,0,1,0],[4,1,1,5,3,4,5,7,3],[1,0,0,2,0,1,1,1,0,3,2,3,0,0,0,2,1,1,1,5,1,1,1,2,3,1,0],[14,5,5,3,7,4],[3,1,1],[5,6,3,5,4,5,4,1,0],[12,5,6,4,5,1,1,0,2,0,2,0],[16,11,9,0,0,2,1,1,0,0,0,0],[10,15,13],[4,8,2,4,4,7,2,3,4],[8,10,12,0,1,1,2,4,0]],"t2":0,"ema":0.0147,"rs":0.577,"rn":40,"pk":{"fav_move":{"k":0,"m":1,"p":100,"r":2,"s":1},"low_hp":{"k":1,"m":1,"p":100,"r":2,"s":1},"after_win":{"k":0,"m":1,"p":83,"r":3,"s":1}}}',
  '0cba25d': '{"v":1,"n":1100,"runs":19,"w":[0.0281,0.0201,0.02,0.0237,0.3057,0.0231,0.0932,0.2891,0.0291,0.0798,0.0263,0.0358,0.0261],"c":[[2.845,7.655,3.353],[2.327,3.848,3.03,1.54,4.905,2.51,0.933,6.225,1.601],[1.377,1.604,1.224,0.813,2.486,1.622,0.427,2.956,1.21,1.64,2.171,1.88,1.457,2.334,1.446,0.77,2.608,1.543,0.097,1.948,1.962,0.372,2.911,0.988,0.513,2.99,0.427],[1.887,5.167,1.923,0.033,6.998,1.397,2.354,3.623,3.345],[1.77,2.065,0.792,0.412,4.76,0.616,1.61,0.061,2.879,0,2.59,2.315,0,0,0,0.05,5.448,0,1.418,2.66,1.956,1.618,1.346,2.636,1.346,1.926,1.004],[2.298,5.283,2.102,1.541,4.41,2.331],[2.332,1.368,0.78],[0.847,7.25,1.489,1.682,2.067,5.123,2.625,3.368,1.367],[1.682,5.346,1.069,2.033,3.037,2.77,1.001,1.35,1.994,0.594,1.108,0.028],[1.711,4.811,1.704,5.682,0,0.862,1.982,0.1,3.084,0,0,0],[2.646,2.753,6.732],[3.141,1.802,2.931,1.146,3.767,2.415,1.128,0.717,6.003],[1.518,1.867,4.765,0.673,0.969,2.025,2.995,2.118,2.131]],"life":[[278,434,254],[67,165,71,61,110,85,113,114,59],[18,22,21,19,35,40,21,26,14,25,60,22,18,32,13,67,45,22,15,65,18,19,30,21,11,27,14],[76,103,63,55,109,49,110,177,103],[8,28,9,24,47,36,44,28,18,11,61,24,0,0,0,44,48,25,48,76,38,37,63,49,25,38,16],[213,335,199,65,99,55],[37,45,39],[116,171,99,92,152,91,33,66,25],[168,257,151,65,117,65,21,36,22,24,24,16],[234,406,236,63,0,71,44,28,18,0,0,0],[244,357,273],[112,119,71,64,143,69,68,95,133],[175,275,212,12,23,17,57,59,44]],"run":[[4,9,4],[2,2,2,1,2,1,0,4,1],[1,1,0,0,0,0,0,1,1,1,0,2,1,0,0,0,1,0,0,0,0,0,2,0,0,1,0],[1,2,1,0,4,0,2,2,3],[1,0,0,0,2,0,0,0,1,0,0,0,0,0,0,0,4,0,1,2,2,1,0,1,0,0,0],[3,6,2,1,3,2],[1,1,0],[1,8,2,1,0,2,1,0,0],[2,7,1,2,2,3,0,0,0,0,0,0],[4,9,3,3,0,0,0,0,1,0,0,0],[4,3,8],[3,2,3,0,1,0,1,0,5],[3,2,7,0,0,0,1,1,1]],"t2":0,"ema":0.0785,"rs":1.954,"rn":20,"pk":{"low_hp":{"k":1,"m":0,"p":56,"r":1,"s":0},"fav_move":{"k":0,"m":0,"p":48,"r":1,"s":0}}}'
};
function oldSavePlay(Brain, o) {
  const b = Brain.create(null), rng = R.RNG.create(o.seed), prng = R.RNG.create(o.seed + 1), sit = R.RNG.create(o.seed + 2);
  const names = Object.keys(PLAYERS), mem = { i: 0 };
  let d = newDuel(1);
  b.beginRun({ days: 0 });
  for (let i = 0; i < o.turns; i++) {
    if (i > 0 && i % 60 === 0) b.beginRun({ days: i % 240 === 0 ? 9 : 0 });
    if (i > 0 && i % 250 === 0) b.forget(0.5);
    const q = rampQuestion(d, sit, o.modes);
    const sealed = b.commit(Object.assign({}, q, { rng: rng }));
    const pm = answer(names[(o.start + Math.floor(i / 150)) % names.length], q, sealed, prng, mem, i);
    b.observe(q.ctx, q.noTell ? null : sealed.tell, pm, sealed.move);
    if (resolve(d, pm, sealed.move).over) d = newDuel(d.n % 7 + 1);
  }
  return JSON.stringify(b.serialize());
}
function brainAt(sha) {
  const root = path.join(__dirname, '..');
  let src;
  try {
    src = cp.execFileSync('git', ['-C', root, 'show', sha + ':src/ai/brain.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return null; }
  const box = vm.createContext({});
  vm.runInContext('globalThis.RIVAL = { MOVES: ["S","G","F"], BEATS: { S: "F", G: "S", F: "G" }, LOSES_TO: { S: "G", G: "F", F: "S" } };', box);
  vm.runInContext(src, box, { filename: sha + ':src/ai/brain.js' });
  return vm.runInContext('RIVAL.Brain', box);
}
if (process.env.RIVAL_OLD_SAVES === 'print') {
  for (const sha of Object.keys(OLD_PLAY)) {
    const B = brainAt(sha);
    console.log(sha + ' ' + (B ? oldSavePlay(B, OLD_PLAY[sha]) : '(no git history)'));
  }
  process.exit(0);
}

// ================================================================ 0. solver sanity
section('0. Equilibrium solver');
(function () {
  const eq = R.Brain.equilibrium(payoffOf(0), MOVES, MOVES);
  console.log('  base matrix: R  S ' + pc(eq.r.S) + '  G ' + pc(eq.r.G) + '  F ' + pc(eq.r.F) +
              '   |  P  S ' + pc(eq.p.S) + '  G ' + pc(eq.p.G) + '  F ' + pc(eq.p.F) + '   value ' + eq.value.toFixed(3) +
              '   (analytic 36.4 / 38.2 / 25.5, value 0)');
  const ok = Math.abs(eq.r.S - 0.364) < 0.02 && Math.abs(eq.r.G - 0.382) < 0.02 && Math.abs(eq.r.F - 0.255) < 0.02 &&
             Math.abs(eq.p.S - 0.364) < 0.02 && Math.abs(eq.p.G - 0.382) < 0.02 && Math.abs(eq.p.F - 0.255) < 0.02;
  check('regret matching lands on the analytic opening mix (±2 pts)', ok);
  const eb = R.Brain.equilibrium(payoffOf(0), MOVES, ['S', 'F']);
  console.log('  player broken: R  S ' + pc(eb.r.S) + '  G ' + pc(eb.r.G) + '  F ' + pc(eb.r.F) +
              '   |  P  S ' + pc(eb.p.S) + '  F ' + pc(eb.p.F) + '   value ' + eb.value.toFixed(3) + '   (analytic with the 0.86 break term in the matrix: R 61.8/38.2/0, P 74.6/25.4, value 0.763)');
  check('broken sub-game: analytic mix and value, Guard never predicted for the broken player',
        Math.abs(eb.value - 0.763) < 0.02 && eb.p.G === 0 && Math.abs(eb.r.S - 0.618) < 0.02 && Math.abs(eb.p.S - 0.746) < 0.02 && eb.r.F < 0.02);
})();

// ================================================================ 1. fairness / determinism
section('1. Fairness, determinism, commit does not learn');
(function () {
  const brain = trained('win-stay/lose-shift', 300, 5);
  const rng = R.RNG.create(99), sit = R.RNG.create(1234);
  let same3 = true, sameTwice = true, sameExtra = true, sameFrozen = true, cacheSame = true, n = 0;
  for (let i = 0; i < 400; i++) {
    const pB = sit.chance(0.2), rB = sit.chance(0.2);
    const ctx = randomCtx(sit, pB, rB);
    const q0 = { ctx: ctx, payoff: i % 3 === 0 ? randomPayoff(sit) : payoffOf(ctx.tension),
                 legalR: legalOf(rB), legalP: legalOf(pB), exploit: sit.next(), honestyBase: sit.next() };
    const snap = JSON.stringify(brain.serialize()), rs = rng.state();
    // (a) same state + same rng state => same sealed, whatever the player then does
    const outs = [];
    for (const pm of MOVES) {
      const b = R.Brain.create(JSON.parse(snap)), r = R.RNG.create(1);
      r.setState(rs);
      const sealed = b.commit(Object.assign({}, q0, { rng: r }));
      outs.push(JSON.stringify(sealed));
      b.observe(ctx, sealed.tell, pm, sealed.move);
    }
    if (outs[0] !== outs[1] || outs[1] !== outs[2]) same3 = false;
    // (b) committing twice on the live brain from the same rng state changes nothing (2nd = cache hit)
    const r1 = R.RNG.create(1); r1.setState(rs);
    const r2 = R.RNG.create(1); r2.setState(rs);
    const a = JSON.stringify(brain.commit(Object.assign({}, q0, { rng: r1 })));
    const b2 = JSON.stringify(brain.commit(Object.assign({}, q0, { rng: r2 })));
    if (a !== b2) sameTwice = false;
    if (a !== outs[0]) cacheSame = false;                      // the live brain and its reload seal the same, to the bit
    // (c) smuggling the player's move into q is ignored
    for (const pm of MOVES) {
      const r3 = R.RNG.create(1); r3.setState(rs);
      const c = JSON.stringify(brain.commit(Object.assign({}, q0, { rng: r3, pm: pm, playerMove: pm, input: pm })));
      if (c !== a) sameExtra = false;
    }
    // (d) arguments are not mutated (frozen inputs must not throw or change)
    const r4 = R.RNG.create(1); r4.setState(rs);
    const fq = { ctx: Object.freeze(Object.assign({}, ctx)), payoff: q0.payoff, legalR: Object.freeze(q0.legalR.slice()),
                 legalP: Object.freeze(q0.legalP.slice()), exploit: q0.exploit, honestyBase: q0.honestyBase, rng: r4 };
    for (const m of MOVES) Object.freeze(fq.payoff[m]);
    Object.freeze(fq.payoff);
    try { if (JSON.stringify(brain.commit(fq)) !== a) sameFrozen = false; } catch (e) { sameFrozen = false; }
    // advance the live brain so later situations differ
    const sealed = brain.commit(Object.assign({}, q0, { rng: rng }));
    brain.observe(ctx, sealed.tell, sit.pick(q0.legalP), sealed.move);
    n++;
  }
  check('identical sealed for all three player moves (' + n + ' situations)', same3);
  check('commit twice from the same rng state is identical (cache hit = cache miss)', sameTwice);
  check('reloaded brain commits exactly like the live one (identical sealed, pred and confidence to the bit)', cacheSame);
  check('extra fields on q (pm, playerMove, input) cannot influence commit', sameExtra);
  check('commit works on frozen ctx / payoff / legal lists (no argument mutation)', sameFrozen);

  const b = trained('guard-after-hit', 400, 8);
  const before = JSON.stringify(b.serialize()), dBefore = JSON.stringify(b.dossier());
  const r = R.RNG.create(4242), s2 = R.RNG.create(77);
  for (let i = 0; i < 500; i++) {
    const pB = s2.chance(0.2), rB = s2.chance(0.2), ctx = randomCtx(s2, pB, rB);
    b.commit({ ctx: ctx, payoff: payoffOf(ctx.tension), legalR: legalOf(rB), legalP: legalOf(pB),
               exploit: s2.next(), honestyBase: s2.next(), rng: r });
    b.predict(ctx, legalOf(pB)); b.honesty(0.7); b.trust(); b.habitFor(ctx); b.runInsights(); b.runScore();
  }
  b.dossier();
  check('500 commits + every read-only call leave the serialized state byte-identical', JSON.stringify(b.serialize()) === before);
  check('dossier unchanged by commits', JSON.stringify(b.dossier()) === dBefore);
  b.observe(ctxOf(newDuel(1)), 'S', 'G', 'S');
  check('observe is what changes the state', JSON.stringify(b.serialize()) !== before);

  // force (tutorial) bypasses the decision and the dice
  const fr = R.RNG.create(5), fs = fr.state();
  const fz = b.commit({ ctx: ctxOf(newDuel(1)), payoff: payoffOf(0), legalR: MOVES, legalP: MOVES, exploit: 1, honestyBase: 0.1,
                        rng: fr, force: { move: 'G', tell: 'S' } });
  const fz2 = b.commit({ ctx: ctxOf(newDuel(1)), payoff: payoffOf(0), legalR: MOVES, legalP: MOVES, exploit: 1, honestyBase: 0.1,
                         rng: fr, force: { move: 'F' } });
  check('force {move:G, tell:S} is obeyed, flagged dishonest, and draws no dice',
        fz.move === 'G' && fz.tell === 'S' && fz.honest === false && fr.state() === fs && fz2.move === 'F' && fz2.tell === 'F' && fz2.honest === true);
})();

// ================================================================ 1b. the boss modes keep the seal blind
// Section 1 covers exploit / mix only. The Blank (q.noTell) and the Reflection (q.mimic) take their own
// branches in commit(), so each gets the same proof: the sealed output AND the number of dice it rolls are
// a function of q alone. Every commit runs on a fresh copy of the same brain from the same rng state; the
// three copies differ only in the player move smuggled into q, q.ctx and q.mimic.
section('1b. noTell and mimic: the seal ignores the player move (400 situations per mode)');
(function () {
  const N = 400;
  const MODES = [{ name: 'noTell', noTell: true }, { name: 'mimic', mimic: true }, { name: 'noTell+mimic', noTell: true, mimic: true }];
  const stray = function (o, pm) { return Object.assign({}, o, { pm: pm, playerMove: pm, input: pm }); };
  MODES.forEach(function (M) {
    const brain = trained('win-stay/lose-shift', 300, 5);
    const rng = R.RNG.create(99), sit = R.RNG.create(1234);
    let n = 0, same3 = 0, draws3 = 0, sameStray = 0, sameTwice = 0, frozen = 0, tellOk = 0, modeOk = 0;
    const drawHist = {}, why = [];
    for (let i = 0; i < N; i++) {
      const pB = sit.chance(0.2), rB = sit.chance(0.2);
      const ctx = randomCtx(sit, pB, rB);
      const q0 = { ctx: ctx, payoff: i % 3 === 0 ? randomPayoff(sit) : payoffOf(ctx.tension),
                   legalR: legalOf(rB), legalP: legalOf(pB), exploit: sit.next(), honestyBase: sit.next() };
      if (M.noTell) q0.noTell = true;
      if (M.mimic) q0.mimic = randomCtx(sit, rB, pB);            // the Rival's own seat: its guard is the "player" guard
      const snap = JSON.stringify(brain.serialize()), rs = rng.state();
      // one sealed commit on a fresh copy, counting every draw from the dice
      const seal = function (q) {
        const b = R.Brain.create(JSON.parse(snap)), r = R.RNG.create(1);
        r.setState(rs);
        let draws = 0;
        const next = r.next;
        r.next = function () { draws++; return next(); };
        const sealed = b.commit(Object.assign({}, q, { rng: r }));
        return { b: b, sealed: sealed, json: JSON.stringify(sealed), draws: draws, end: r.state() };
      };
      const base = seal(q0);
      const outs = MOVES.map(function (pm) {
        const q = stray(q0, pm);
        q.ctx = stray(q0.ctx, pm);
        if (q0.mimic) q.mimic = stray(q0.mimic, pm);
        const o = seal(q);
        o.b.observe(ctx, M.noTell ? null : o.sealed.tell, pm, o.sealed.move);    // then the player's move is known
        return o;
      });
      if (outs[0].json === outs[1].json && outs[1].json === outs[2].json) same3++;
      else if (why.length < 3) why.push('#' + i + ' ' + outs.map(function (o) { return o.sealed.move + '/' + o.sealed.tell; }).join(' '));
      if (outs[0].draws === outs[1].draws && outs[1].draws === outs[2].draws && outs[0].end === outs[1].end && outs[1].end === outs[2].end) draws3++;
      if (outs.every(function (o) { return o.json === base.json && o.draws === base.draws && o.end === base.end; })) sameStray++;
      drawHist[base.draws] = (drawHist[base.draws] || 0) + 1;
      // twice from the same state, and on frozen arguments (nothing is mutated)
      const fq = { ctx: Object.freeze(Object.assign({}, ctx)), payoff: q0.payoff, legalR: Object.freeze(q0.legalR.slice()),
                   legalP: Object.freeze(q0.legalP.slice()), exploit: q0.exploit, honestyBase: q0.honestyBase };
      if (q0.noTell) fq.noTell = true;
      if (q0.mimic) fq.mimic = Object.freeze(Object.assign({}, q0.mimic));
      for (const m of MOVES) Object.freeze(fq.payoff[m]);
      Object.freeze(fq.payoff);
      if (seal(q0).json === base.json) sameTwice++;
      try { if (seal(fq).json === base.json) frozen++; } catch (e) { if (why.length < 3) why.push('frozen: ' + e.message); }
      const s = base.sealed;
      if (q0.legalR.indexOf(s.move) >= 0 && q0.legalR.indexOf(s.tell) >= 0 && s.honest === (s.move === s.tell) &&
          (!M.noTell || (s.tell === s.move && s.honest === true))) tellOk++;
      if (M.mimic ? s.mode === 'mimic' : (s.mode === 'mix' || s.mode === 'exploit')) modeOk++;
      // advance the live brain so later situations differ
      const live = brain.commit(Object.assign({}, q0, { rng: rng }));
      brain.observe(ctx, M.noTell ? null : live.tell, sit.pick(q0.legalP), live.move);
      n++;
    }
    const hist = Object.keys(drawHist).map(function (k) { return k + ' draws x' + drawHist[k]; }).join(', ');
    console.log('  ' + pad(M.name, 13) + ' situations ' + n + ';  dice per commit: ' + hist);
    check(M.name + ': identical sealed for all three player moves (' + n + ' situations)', same3 === n, same3 + '/' + n + (why.length ? '; ' + why.join(' | ') : ''));
    check(M.name + ': identical rng draw count for all three player moves', draws3 === n, draws3 + '/' + n);
    check(M.name + ': stray pm/playerMove/input on q, q.ctx and q.mimic cannot influence commit', sameStray === n, sameStray + '/' + n);
    check(M.name + ': commit twice is identical, and works on frozen ctx / mimic / payoff / legal lists', sameTwice === n && frozen === n, sameTwice + '/' + n + ', frozen ' + frozen + '/' + n);
    if (M.noTell) check(M.name + ': tell === move and honest on every non-force commit', tellOk === n, tellOk + '/' + n);
    else check(M.name + ': move and tell legal, honest flag consistent', tellOk === n, tellOk + '/' + n);
    if (M.mimic) check(M.name + ': mode is mimic on every commit', modeOk === n, modeOk + '/' + n);
    else check(M.name + ': mode is mix or exploit on every commit', modeOk === n, modeOk + '/' + n);
  });
})();

// ================================================================ 1c. force and noTell never meet
// commit()'s force path (the scripted tutorial) does not apply noTell: force {move:G, tell:S} with noTell
// still seals honest:false. That is safe only while the tutorial (the one caller of force) runs in duel 1
// and duel 1 always shows a stance. Both halves are checked here.
section('1c. The scripted first duel (force) never meets a hidden stance (noTell)');
(function () {
  const RUN = R.Run;
  const bad = [], hidden = [];
  let cells = 0;
  RUN.BOSSES.forEach(function (b) {
    for (let s = 0; s <= RUN.VIGIL.length; s++) {
      const run = RUN.create(RUN.defaultMeta(), { seed: 11, now: 1.7e12, boss: b.id, anyBoss: true, stake: s, anyStake: true });
      const c = RUN.cfg(run, { n: 1, phase: 1 });
      const d = RUN.startDuel(run);
      cells++;
      if (run.duelN !== 1 || c.stance === 'none' || d.stance === 'none') bad.push(b.id + ' stake ' + s);
      for (let n = 2; n <= 6; n++) if (RUN.cfg(run, { n: n, phase: 1 }).stance === 'none') hidden.push('duel ' + n + ' ' + b.id + ' stake ' + s);
    }
  });
  console.log('  ' + cells + ' face x stake cells;  duels 2-6 that hide the stance: ' + (hidden.length ? hidden.join(', ') : 'none'));
  check('duel 1 shows a stance for every face at every stake 0..' + RUN.VIGIL.length + ' (R.Run.cfg and startDuel)', bad.length === 0 && cells === RUN.BOSSES.length * (RUN.VIGIL.length + 1), bad.join(', '));
  // the scene side of the premise: q.force comes only from the tutorial, and the tutorial runs only in duel 1
  const scene = fs.readFileSync(path.join(SRC, 'scenes', 'duel.js'), 'utf8');
  const tutGate = /tutorial:\s*run\.duelN === 1 && !meta\.seenTutorial/.test(scene);
  const forceSets = scene.match(/q\.force\s*=/g) || [];
  const forceFromTut = /if \(tut && tut\.force\) q\.force = tut\.force;/.test(scene);
  check('scenes/duel.js sets q.force only from the tutorial beat, and the tutorial only in duel 1 (re-verify 1c if this moved)',
        tutGate && forceSets.length === 1 && forceFromTut, 'tutorial gate ' + tutGate + ', q.force writes ' + forceSets.length + ', from tutorial ' + forceFromTut);
})();

// ================================================================ 2. legal moves
section('2. Legal-move and numerical safety (2,000 random situations per case)');
(function () {
  const cases = [
    { name: "legalR = ['S','F'] (Rival guard broken)", lr: function () { return ['S', 'F']; }, lp: function () { return MOVES.slice(); } },
    { name: "legalP = ['S','F'] (player guard broken)", lr: function () { return MOVES.slice(); }, lp: function () { return ['S', 'F']; } },
    { name: 'both broken', lr: function () { return ['S', 'F']; }, lp: function () { return ['S', 'F']; } },
    { name: 'random 2–3 move subsets (seals), random payoffs', random: true }
  ];
  cases.forEach(function (c, ci) {
    const brain = R.Brain.create(null), rng = R.RNG.create(1000 + ci), sit = R.RNG.create(2000 + ci);
    const problems = [];
    function subset() { const a = MOVES.slice(); if (sit.chance(0.6)) a.splice(sit.int(3), 1); return a; }
    for (let i = 0; i < 2000; i++) {
      const legalR = c.random ? subset() : c.lr(), legalP = c.random ? subset() : c.lp();
      const ctx = randomCtx(sit, legalP.indexOf('G') < 0, legalR.indexOf('G') < 0);
      const q = { ctx: ctx, payoff: (c.random || i % 2) ? randomPayoff(sit) : payoffOf(ctx.tension), legalR: legalR, legalP: legalP,
                  exploit: sit.next(), honestyBase: sit.next(), rng: rng };
      const sealed = brain.commit(q);
      const bad = sealedProblems(sealed, legalR, legalP);
      const p = brain.predict(ctx, legalP);
      let ps = 0;
      for (const m of MOVES) {
        if (!(p[m] >= 0 && p[m] <= 1)) bad.push('predict.' + m + '=' + p[m]);
        if (legalP.indexOf(m) < 0 && p[m] !== 0) bad.push('predict of illegal ' + m);
        ps += p[m];
      }
      if (!(Math.abs(ps - 1) < 1e-9)) bad.push('predict sums to ' + ps);
      const h = brain.honesty(q.honestyBase), tr = brain.trust();
      if (!(h >= 0 && h <= 1) || !(tr >= 0 && tr <= 1)) bad.push('honesty/trust out of range');
      if (i % 5 === 0) {      // forced turns must stay legal too
        const fz = brain.commit(Object.assign({}, q, { force: { move: sit.pick(MOVES), tell: sit.pick(MOVES) } }));
        Array.prototype.push.apply(bad, sealedProblems(fz, legalR, legalP).map(function (x) { return 'force: ' + x; }));
      }
      if (bad.length && problems.length < 5) problems.push('#' + i + ' ' + bad.join('; '));
      brain.observe(ctx, sealed.tell, sit.pick(legalP), sealed.move);
    }
    const rs = brain.runScore();
    check(c.name + ': move/tell legal, pred a distribution over legalP', problems.length === 0 && rs >= 0 && rs <= 100, problems.join(' | '));
  });

  // hostile input
  const b = R.Brain.create(null), rng = R.RNG.create(3);
  let ok = true, why = '';
  const junk = [
    {}, { ctx: null }, { ctx: {}, payoff: null, legalR: [], legalP: [] },
    { ctx: { turn: 'x', tension: NaN, pHp: undefined }, payoff: { S: { S: NaN, G: Infinity, F: 'a' } }, legalR: ['Q'], legalP: ['S'], exploit: NaN, honestyBase: -4 },
    { ctx: { turn: 3, prev1: 'Z', last: 'X', tension: 99 }, payoff: payoffOf(3), legalR: ['G'], legalP: ['G', 'G'], exploit: 7, honestyBase: 9, rng: rng }
  ];
  try {
    junk.forEach(function (q) {
      const sealed = b.commit(q);
      const lr = (q.legalR && q.legalR.filter(function (m) { return MOVES.indexOf(m) >= 0; }).length) ? q.legalR : MOVES;
      const lp = (q.legalP && q.legalP.filter(function (m) { return MOVES.indexOf(m) >= 0; }).length) ? q.legalP : MOVES;
      const bad = sealedProblems(sealed, lr, lp);
      if (bad.length) { ok = false; why = bad.join('; '); }
      b.observe(q.ctx, sealed.tell, 'S', sealed.move);
    });
    b.observe(null, null, 'G', null); b.observe({}, 'Q', 'Q', 'Q'); b.observe(undefined, 'S', undefined, 'S');
    b.predict(null, null); b.habitFor(null); b.beginRun(null); b.beginRun({ days: 'x' }); b.forget(NaN); b.forget(5);
    if (JSON.stringify(b.serialize()).indexOf('null') >= 0) { ok = false; why = 'NaN leaked into state'; }
  } catch (e) { ok = false; why = String(e && e.stack || e); }
  check('garbage q / ctx / payoff never throws and never yields NaN or illegal output', ok, why);
})();

// ================================================================ 2b. dominated moves by mode
// A Rival move is strictly dominated when another legal move of its own does better against EVERY legal
// player move, in the payoff matrix the Rival was handed. Pinned generator and seeds: the rate depends on
// both (near-tie rows leave the equilibrium solver some mass), so they are part of the test.
// mix and noTell must seal no dominated move at these seeds (the output is deterministic; both measure 0).
// exploit cannot be 0 without a brain change: its softmax keeps every move's equilibrium weight plus
// K.EQ_PRIOR_FLOOR as its prior, so it seals a dominated move now and then (2 of these 2,000 seals, gaps of
// 0.02-0.6 HP; 0.015-0.04% over 20,000 seals at other seeds). It keeps the feel-10 C1 bound of 0.5%.
// noTell seals take either branch (about half each), so a change to the dice order may move a seal into the
// exploit tail: re-measure at other seeds before loosening its bound.
section('2b. Dominated moves by mode (2,000 random payoffs with a strictly dominated Rival row, per mode)');
(function () {
  const SEALS = 2000;
  const BOUND = { mix: 0, exploit: 0.005, noTell: 0 };
  function strictlyDominated(V, r, lr, lp) {
    return lr.some(function (r2) { return r2 !== r && lp.every(function (p) { return V[r2][p] > V[r][p]; }); });
  }
  const out = {};
  ['mix', 'exploit', 'noTell', 'mimic'].forEach(function (mode) {
    const sit = R.RNG.create(5100), rng = R.RNG.create(5200);
    const brain = R.Brain.create(null);
    function subset() { const a = MOVES.slice(); if (sit.chance(0.6)) a.splice(sit.int(3), 1); return a; }
    let n = 0, tries = 0, dom = 0, badMode = 0, illegal = 0;
    const modes = {};
    while (n < SEALS && tries < 100000) {
      tries++;
      const legalR = subset(), legalP = subset(), V = randomPayoff(sit);
      if (!legalR.some(function (r) { return strictlyDominated(V, r, legalR, legalP); })) continue;
      const ctx = randomCtx(sit, legalP.indexOf('G') < 0, legalR.indexOf('G') < 0);
      const q = { ctx: ctx, payoff: V, legalR: legalR, legalP: legalP,
                  exploit: mode === 'mix' ? 0 : mode === 'exploit' ? 1 : sit.next(), honestyBase: sit.next(), rng: rng };
      if (mode === 'noTell') q.noTell = true;
      if (mode === 'mimic') q.mimic = randomCtx(sit, legalR.indexOf('G') < 0, legalP.indexOf('G') < 0);
      const s = brain.commit(q);
      n++;
      modes[s.mode] = (modes[s.mode] || 0) + 1;
      if (legalR.indexOf(s.move) < 0 || legalR.indexOf(s.tell) < 0) illegal++;
      if (strictlyDominated(V, s.move, legalR, legalP)) dom++;
      if (mode === 'noTell' ? (s.mode !== 'mix' && s.mode !== 'exploit') : s.mode !== mode) badMode++;
      brain.observe(ctx, mode === 'noTell' ? null : s.tell, sit.pick(legalP), s.move);
    }
    out[mode] = { n: n, dom: dom };
    console.log('  ' + pad(mode, 8) + lpad(n, 5) + ' seals (' + tries + ' payoffs drawn), modes ' + JSON.stringify(modes) + ':  dominated ' + dom + ' (' + (100 * dom / Math.max(1, n)).toFixed(2) + '%)');
    check('dominated moves by mode: ' + mode + ' seals legal moves in the mode it was asked for (' + n + ' seals)', n === SEALS && illegal === 0 && badMode === 0,
          'n ' + n + ', illegal ' + illegal + ', wrong mode ' + badMode);
    if (mode !== 'mimic') check('dominated moves by mode: ' + mode + (BOUND[mode] ? ' <= ' + (100 * BOUND[mode]) + '%' : ' none'), n > 0 && dom <= BOUND[mode] * n, dom + ' of ' + n);
  });
  // The Reflection samples the player's own habits without a dominance filter (brain.js mimic branch).
  // Report-only until the filter lands; it becomes an assertion then.
  console.log('INFO c1-mimic-dominated: ' + (100 * out.mimic.dom / Math.max(1, out.mimic.n)).toFixed(1) + '% (fix P1.2, B18/V6)');
})();

// ================================================================ 3. serialization
section('3. Serialization');
(function () {
  const names = Object.keys(PLAYERS);
  const brain = R.Brain.create(null);
  let size1000 = 0, turns = 0;
  for (let k = 0; turns < 5000; k++) {
    simulate({ brain: brain, player: names[k % names.length], turns: 125, seed: 300 + k, exploit: (k % 5) / 4, honestyBase: 0.35 + (k % 4) * 0.2 });
    turns += 125;
    if (k % 7 === 3) brain.forget(0.5);
    if (turns === 1000) size1000 = JSON.stringify(brain.serialize()).length;
  }
  const ser = brain.serialize(), json = JSON.stringify(ser);
  console.log('  size after 1,000 turns: ' + size1000 + ' bytes;  after 5,000 turns: ' + json.length + ' bytes (limit 12,288)');
  check('serialized state is plain JSON with a v field', ser.v === 1 && JSON.stringify(JSON.parse(json)) === json);
  check('size under 12 KB after 5,000 turns and not growing with history', json.length < 12288 && json.length < size1000 * 1.5);
  check('no NaN/null leaked into the serialized state', json.indexOf('null') < 0 && json.indexOf('NaN') < 0);
  // The save layout is frozen (brain.js, above NE): a new expert appends, it never takes or shifts a slot.
  const lensOk = function (t) { return Array.isArray(t) && t.length === TABLE_LENS.length && t.every(function (a, e) { return Array.isArray(a) && a.length === TABLE_LENS[e]; }); };
  check('save layout frozen: keys v,n,runs,w,c,life,run,t2,ema,rs,rn,pk; w is 13 numbers; c, life and run are 13 tables of ' + TABLE_LENS.join(','),
        Object.keys(ser).join(',') === 'v,n,runs,w,c,life,run,t2,ema,rs,rn,pk' && Array.isArray(ser.w) && ser.w.length === 13 &&
        ser.w.every(function (x) { return typeof x === 'number' && x > 0; }) && lensOk(ser.c) && lensOk(ser.life) && lensOk(ser.run),
        Object.keys(ser).join(',') + '; w ' + ser.w.length + '; c ' + ser.c.map(function (a) { return a.length; }).join(','));
  const pkKeys = Object.keys(ser.pk);
  check('pk is written in the canonical order (' + pkKeys.length + ' peaks: ' + pkKeys.join(', ') + ')', pkKeys.length >= 2 &&
        pkKeys.every(function (k, i) { return i === 0 || PEAK_ORDER.indexOf(pkKeys[i - 1]) < PEAK_ORDER.indexOf(k); }));
  const viaJson = R.Brain.create(JSON.parse(json)).serialize(), direct = R.Brain.create(ser).serialize();
  check('the live state is already what the save holds: serialize(create(save)) equals the save, number for number and key for key',
        bitSame(viaJson, ser) && bitSame(direct, ser) && !hasNegZero(ser));

  const copy = R.Brain.create(JSON.parse(json));
  const sit = R.RNG.create(55);
  let maxDiff = 0, sealedSame = 0, sealedN = 0;
  for (let i = 0; i < 500; i++) {
    const pB = sit.chance(0.2), rB = sit.chance(0.2), ctx = randomCtx(sit, pB, rB);
    const a = brain.predict(ctx, legalOf(pB)), b = copy.predict(ctx, legalOf(pB));
    for (const m of MOVES) maxDiff = Math.max(maxDiff, Math.abs(a[m] - b[m]));
    const q = { ctx: ctx, payoff: payoffOf(ctx.tension), legalR: legalOf(rB), legalP: legalOf(pB), exploit: 0.7, honestyBase: 0.6 };
    const sa = brain.commit(Object.assign({ rng: R.RNG.create(i + 1) }, q)), sb = copy.commit(Object.assign({ rng: R.RNG.create(i + 1) }, q));
    for (const m of MOVES) maxDiff = Math.max(maxDiff, Math.abs(sa.pred[m] - sb.pred[m]));
    sealedN++; if (bitSame(sa, sb)) sealedSame++;
  }
  maxDiff = Math.max(maxDiff, Math.abs(brain.trust() - copy.trust()), Math.abs(brain.honesty(0.7) - copy.honesty(0.7)));
  console.log('  round trip: max |Δ prediction| = ' + maxDiff.toExponential(2) + ';  identical sealed object in ' + sealedSame + '/' + sealedN + ' commits');
  check('round trip keeps predictions exactly (max diff 0) and every sealed object to the bit', maxDiff === 0 && sealedSame === sealedN,
        'max diff ' + maxDiff.toExponential(2) + ', ' + sealedSame + '/' + sealedN);
  check('round trip keeps the dossier', JSON.stringify(brain.dossier()) === JSON.stringify(copy.dossier()));
  const again = JSON.stringify(R.Brain.create(JSON.parse(JSON.stringify(copy.serialize()))).serialize());
  check('serialize → create → serialize is stable', again === JSON.stringify(copy.serialize()));

  // '' when b is reload-exact right now: its save is a byte fixed point, holds no -0, and a brain rebuilt from it
  // reports and seals exactly as b does (Object.is on every number).
  function reloadExact(b, seed) {
    const ser0 = b.serialize(), aj = JSON.stringify(ser0);
    if (JSON.stringify(R.Brain.create(JSON.parse(aj)).serialize()) !== aj) return 'not a byte fixed point';
    if (hasNegZero(ser0)) return 'the live state holds a -0';
    const copy = R.Brain.create(JSON.parse(aj)), sit = R.RNG.create(seed);
    if (!bitSame(b.dossier(), copy.dossier()) || !Object.is(b.trust(), copy.trust()) || !Object.is(b.honesty(0.6), copy.honesty(0.6)) ||
        !Object.is(b.runScore(), copy.runScore())) return 'a report differs on reload';
    for (let i = 0; i < 12; i++) {
      const pB = sit.chance(0.2), rB = sit.chance(0.2), ctx = randomCtx(sit, pB, rB);
      const q = { ctx: ctx, payoff: payoffOf(ctx.tension), legalR: legalOf(rB), legalP: legalOf(pB), exploit: sit.next(), honestyBase: sit.next() };
      if (!bitSame(b.commit(Object.assign({ rng: R.RNG.create(seed + i) }, q)), copy.commit(Object.assign({ rng: R.RNG.create(seed + i) }, q)))) return 'seal ' + i + ' differs on reload';
    }
    return '';
  }

  const freshJson = JSON.stringify(R.Brain.create(null).serialize());
  const garbage = [{}, null, { junk: 1 }, undefined, 'hello', 42, [1, 2, 3],
                   { v: 99, n: NaN, w: 'x', c: [1, 2], life: {}, run: [[], null, ['a']], pk: { fav_move: { k: 99, m: -4, p: 'q' }, bogus: 1 }, t2: 12, ema: 'z' },
                   { w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], c: [[1e99, -5, NaN]] },
                   // hand-edited weights and zeros: each must still give a reload-exact brain
                   { v: 1, w: [0.00004].concat(Array(12).fill(1 / 12)) },           // a stored weight that rounds to 0
                   { w: [1e6].concat(Array(12).fill(1)) },                            // one huge weight shrinks the rest below 0.0001
                   { w: Array(4).fill(1e-7).concat([5], Array(8).fill(1e-7)) },     // tiny weights renormalised
                   { w: Array(13).fill(1e308) },                                      // a sum that overflows
                   { w: Array(13).fill(1.0099 / 13) },                                // a sum at the edge of the rounding slack
                   JSON.parse('{"n":-0,"runs":-0.3,"t2":-0,"rn":-0,"ema":-0,"rs":-0,"life":[[-0,1,2]],"run":[[-0.2,0,0]],"c":[[-0,1,1]],' +
                              '"pk":{"fav_move":{"k":-0,"m":-0,"p":-0.4,"r":-0,"s":-0}}}')];
  let allFresh = true, allWork = true, why = '', exact = 0, exactWhy = '';
  garbage.forEach(function (g, i) {
    try {
      const b = R.Brain.create(g);
      if (i < 7 && JSON.stringify(b.serialize()) !== freshJson) allFresh = false;
      const r0 = reloadExact(b, 700 + i);
      const st = simulate({ brain: b, player: 'uniform', turns: 60, seed: 900 + i, exploit: 0.8, honestyBase: 0.5 });
      const js = JSON.stringify(b.serialize());
      if (js.indexOf('null') >= 0 || st.turns !== 60) { allWork = false; why = 'case ' + i; }
      b.dossier(); b.runInsights();
      const r1 = reloadExact(b, 800 + i);
      if (!r0 && !r1) exact++; else if (!exactWhy) exactWhy = 'case ' + i + ': ' + (r0 ? r0 + ' (as loaded)' : r1 + ' (after 60 turns)');
    } catch (e) { allWork = false; why = 'case ' + i + ': ' + e; }
  });
  check('create({}), create(null), create({junk:1}), strings, arrays → a fresh brain', allFresh);
  check('garbage fields are sanitised; every such brain plays 60 turns cleanly', allWork, why);
  check('every garbage or hand-edited save (tiny, huge, overflowing and edge-of-slack weights, -0) gives a reload-exact brain, as loaded and after 60 turns',
        exact === garbage.length, exact + '/' + garbage.length + (exactWhy ? '; ' + exactWhy : ''));

  // Single-field corruptions of the trained save above, and weights near the rounding slack: every brain they load
  // is reload-exact before its first observe (the window a reload can fall in).
  const paths = [];
  for (let e = 0; e < 13; e++) paths.push(['w', e]);
  ['n', 'runs', 't2', 'ema', 'rs', 'rn'].forEach(function (k) { paths.push([k]); });
  [0, 4, 9, 12].forEach(function (e) { paths.push(['c', e, 1]); paths.push(['life', e, 2]); paths.push(['run', e, 0]); });
  Object.keys(ser.pk).forEach(function (id) { ['k', 'm', 'p', 'r', 's'].forEach(function (f) { paths.push(['pk', id, f]); }); });
  const vals = [0, -0, -0.3, 4e-6, 4e-5, 1e-300, 1e300, 1e308, -1, 0.49, 7.5, 'x', null, NaN, Infinity];
  let fuzzN = 0, fuzzOk = 0, fuzzWhy = '';
  paths.forEach(function (p, pi) {
    vals.forEach(function (v, vi) {
      const o = JSON.parse(json);
      let at = o;
      for (let j = 0; j < p.length - 1; j++) at = at[p[j]];
      at[p[p.length - 1]] = v;
      fuzzN++;
      let r;
      try { r = reloadExact(R.Brain.create(o), 1000 + pi * 31 + vi); } catch (e) { r = String(e); }
      if (!r) fuzzOk++; else if (!fuzzWhy) fuzzWhy = p.join('.') + '=' + String(v) + ': ' + r;
    });
  });
  const band = R.RNG.create(77);
  let bandOk = 0;
  for (let i = 0; i < 2000; i++) {
    const raw = [];
    let sum = 0;
    for (let e = 0; e < 13; e++) { raw.push(0.01 + band.next()); sum += raw[e]; }
    const target = 0.985 + 0.03 * band.next(), w = raw.map(function (x) { return x / sum * target; });
    if (band.chance(0.3)) w[band.int(13)] = band.next() * 2e-4;
    const aj = JSON.stringify(R.Brain.create({ w: w }).serialize());
    if (JSON.stringify(R.Brain.create(JSON.parse(aj)).serialize()) === aj) bandOk++;
  }
  console.log('  corrupt saves: ' + fuzzOk + '/' + fuzzN + ' single-field corruptions reload-exact;  ' + bandOk + '/2000 weight sets near the slack a byte fixed point');
  check('single-field corruptions of a trained save, and weights near the rounding slack or under 0.0001, all load reload-exact',
        fuzzOk === fuzzN && bandOk === 2000, fuzzOk + '/' + fuzzN + ', ' + bandOk + '/2000' + (fuzzWhy ? '; ' + fuzzWhy : ''));
})();

// ================================================================ 3b. reload-exact: lockstep
// A reload must never change what the Rival does next. quant() (brain.js) keeps the live state equal to what its
// save holds, and serialize() writes one canonical key order. Two measures, both over 2,000-turn games with a
// beginRun every 40 turns (days >= 7 one time in ten), forget(0.5) every 333, 10% noTell and 10% mimic turns, the
// local rules model and the scripted players in rotation (125 turns each):
//   snapshot: every turn a brain rebuilt from the live brain's save answers the same question with the same dice;
//             predict, the sealed object, the rng draws, dossier, honesty, trust, runScore, habitFor and runInsights
//             must be bit-equal (Object.is on every number). After every observe the save must be a byte fixed
//             point (JSON of serialize(create(save)) === JSON of the save) and hold no -0.
//   chained:  two games on the same dice and player streams; one brain never reloads, the other is rebuilt from its
//             own save before every turn. Every sealed object, player move and the final save must match.
section('3b. Reload-exact: lockstep (2,000-turn games: snapshot every turn, chained reload before every turn)');
(function () {
  const FULL = process.env.RIVAL_LOCKSTEP === 'full';
  const TURNS = 2000, SNAP_GAMES = FULL ? 100 : 1, CHAIN_GAMES = FULL ? 100 : 20;
  const names = Object.keys(PLAYERS);
  function game(seed) {
    return { seed: seed, rng: R.RNG.create(seed * 7919 + 13), prng: R.RNG.create(seed * 104729 + 71), sit: R.RNG.create(seed * 31 + 5),
             mem: { i: 0 }, d: newDuel(1) };
  }
  function lifecycle(b, g, i) {
    if (i > 0 && i % 40 === 0) b.beginRun({ days: g.sit.chance(0.1) ? 8 : 0 });
    if (i > 0 && i % 333 === 0) b.forget(0.5);
  }
  function finish(g, b, q, sealed, i) {
    const pm = answer(names[Math.floor(i / 125) % names.length], q, sealed, g.prng, g.mem, i);
    b.observe(q.ctx, q.noTell ? null : sealed.tell, pm, sealed.move);
    if (resolve(g.d, pm, sealed.move).over) g.d = newDuel(g.d.n % 7 + 1);
    return pm;
  }
  const t0 = Date.now();
  // --- snapshot
  const S = { turns: 0, predict: 0, sealed: 0, dice: 0, dossier: 0, honesty: 0, trust: 0, runScore: 0, habitFor: 0, insights: 0, all: 0,
              fixed: 0, negZero: 0, modes: {}, firstMiss: -1, firstFix: -1 };
  for (let k = 0; k < SNAP_GAMES; k++) {
    const g = game(1 + k), live = R.Brain.create(null);
    live.beginRun({ days: 0 });
    for (let i = 0; i < TURNS; i++) {
      lifecycle(live, g, i);
      const q = rampQuestion(g.d, g.sit, true);
      const copy = reload(live);
      const rs = g.rng.state(), r1 = R.RNG.create(1), r2 = R.RNG.create(1);
      r1.setState(rs); r2.setState(rs);
      const ok = {
        predict: bitSame(live.predict(q.ctx, q.legalP), copy.predict(q.ctx, q.legalP)),
        sealed: false, dice: false,
        dossier: bitSame(live.dossier(), copy.dossier()),
        honesty: Object.is(live.honesty(q.honestyBase), copy.honesty(q.honestyBase)),
        trust: Object.is(live.trust(), copy.trust()),
        runScore: Object.is(live.runScore(), copy.runScore()),
        habitFor: bitSame(live.habitFor(q.ctx), copy.habitFor(q.ctx)),
        insights: bitSame(live.runInsights(), copy.runInsights())
      };
      const sL = live.commit(Object.assign({}, q, { rng: r1 })), sC = copy.commit(Object.assign({}, q, { rng: r2 }));
      ok.sealed = bitSame(sL, sC);
      ok.dice = r1.state() === r2.state();
      g.rng.setState(r1.state());
      S.modes[sL.mode] = (S.modes[sL.mode] || 0) + 1;
      let all = true;
      for (const key of Object.keys(ok)) { if (ok[key]) S[key]++; else all = false; }
      S.turns++;
      if (all) S.all++; else if (S.firstMiss < 0) S.firstMiss = k * TURNS + i;
      finish(g, live, q, sL, i);
      // byte fixed point of the LIVE brain's save after every observe
      const save = live.serialize(), aj = JSON.stringify(save), bj = JSON.stringify(R.Brain.create(JSON.parse(aj)).serialize());
      if (aj === bj) S.fixed++; else if (S.firstFix < 0) S.firstFix = k * TURNS + i;
      if (hasNegZero(save)) S.negZero++;
    }
  }
  const tSnap = Date.now() - t0;
  console.log('  snapshot, ' + SNAP_GAMES + ' game(s) x ' + TURNS + ' turns (modes ' + JSON.stringify(S.modes) + '): all outputs bit-equal on ' + S.all + '/' + S.turns +
              (S.firstMiss >= 0 ? ' (first miss at turn ' + S.firstMiss + ')' : '') + ';  ' +
              ['predict', 'sealed', 'dice', 'dossier', 'honesty', 'trust', 'runScore', 'habitFor', 'insights'].map(function (key) { return key + ' ' + S[key]; }).join(', ') +
              ';  ' + (tSnap / 1000).toFixed(1) + ' s');
  console.log('  byte fixed point after every observe: ' + S.fixed + '/' + S.turns + (S.firstFix >= 0 ? ' (first failure at turn ' + S.firstFix + ')' : '') + ';  saves holding -0: ' + S.negZero);
  check('lockstep (snapshot): a brain rebuilt from the live save agrees bit-for-bit on predict, seal, dice, dossier, honesty, trust, runScore, habitFor, runInsights',
        S.all === S.turns && S.turns === SNAP_GAMES * TURNS && S.modes.mimic > 0 && S.modes.exploit > 0 && S.modes.mix > 0, S.all + '/' + S.turns);
  check('byte fixed point after every observe on the live brain (serialize(create(save)) === save as text), never a -0',
        S.fixed === S.turns && S.negZero === 0, S.fixed + '/' + S.turns + ', -0 in ' + S.negZero);

  // --- chained: a game goes on until the play itself differs (move, stance or player answer), so both the first
  // bit-level difference (any sealed number, or the dice) and the first different play are measured
  const t1 = Date.now();
  let chainTurns = 0, finalSame = 0;
  const bitAt = [], playAt = [];
  for (let k = 0; k < CHAIN_GAMES; k++) {
    const gA = game(101 + k), gB = game(101 + k);
    const A = R.Brain.create(null);
    let B = R.Brain.create(null), firstBit = -1, firstPlay = -1;
    A.beginRun({ days: 0 }); B.beginRun({ days: 0 });
    for (let i = 0; i < TURNS && firstPlay < 0; i++) {
      lifecycle(A, gA, i); lifecycle(B, gB, i);
      B = reload(B);
      const qA = rampQuestion(gA.d, gA.sit, true), qB = rampQuestion(gB.d, gB.sit, true);
      const sA = A.commit(Object.assign({}, qA, { rng: gA.rng })), sB = B.commit(Object.assign({}, qB, { rng: gB.rng }));
      const pA = finish(gA, A, qA, sA, i), pB = finish(gB, B, qB, sB, i);
      chainTurns++;
      if (firstBit < 0 && (!bitSame(sA, sB) || gA.rng.state() !== gB.rng.state())) firstBit = i;
      if (sA.move !== sB.move || sA.tell !== sB.tell || pA !== pB) firstPlay = i;
    }
    if (firstBit >= 0) bitAt.push(firstBit);
    if (firstPlay >= 0) playAt.push(firstPlay);
    if (firstBit < 0 && firstPlay < 0 && JSON.stringify(A.serialize()) === JSON.stringify(B.serialize()) && bitSame(A.dossier(), B.dossier())) finalSame++;
  }
  const spread = function (a) {
    a.sort(function (x, y) { return x - y; });
    return a.length ? ' (first at turn min/median/max ' + a[0] + '/' + a[a.length >> 1] + '/' + a[a.length - 1] + ')' : '';
  };
  const tChain = Date.now() - t1;
  console.log('  chained, ' + CHAIN_GAMES + ' games x ' + TURNS + ' turns (' + chainTurns + ' reloads): games whose seal differs to the bit ' + bitAt.length + '/' + CHAIN_GAMES + spread(bitAt) +
              ';  whose move, stance or answer differs ' + playAt.length + '/' + CHAIN_GAMES + spread(playAt) +
              ';  identical final save and dossier ' + finalSame + '/' + CHAIN_GAMES + ';  ' + (tChain / 1000).toFixed(1) + ' s' + (FULL ? '' : '  (RIVAL_LOCKSTEP=full: 100 snapshot and 100 chained games)'));
  check('lockstep (chained): a brain reloaded before every turn never diverges from one never reloaded (' + CHAIN_GAMES + ' games x ' + TURNS + ' turns)',
        bitAt.length === 0 && playAt.length === 0 && finalSame === CHAIN_GAMES && chainTurns === CHAIN_GAMES * TURNS,
        bitAt.length + ' differ to the bit, ' + playAt.length + ' in play, ' + finalSame + ' identical at the end');

  // --- where quant() runs: only at the end of create/observe/beginRun/forget, never in commit or a read
  const code = fs.readFileSync(path.join(SRC, 'ai', 'brain.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const where = [], re = /\bquant\(/g;
  let m;
  while ((m = re.exec(code))) {
    const fns = code.slice(0, m.index + 6).match(/function\s+\w+\s*\(/g) || [];
    where.push(fns.length ? /function\s+(\w+)/.exec(fns[fns.length - 1])[1] : '?');
  }
  check('brain.js calls quant() only in create, observe, beginRun and forget (once each)', where.join(',') === 'quant,create,observe,beginRun,forget', where.join(','));
})();

// ================================================================ 3c. saves written by earlier builds (OLD_PLAY, OLD_SAVES above section 0)
section('3c. Saves written by earlier builds load and play (' + Object.keys(OLD_PLAY).join(', ') + ')');
(function () {
  const REGEN = process.env.RIVAL_OLD_SAVES === 'check';
  let regen = 0, regenSame = 0;
  const names = Object.keys(PLAYERS);
  const fixedOrder = function (txt) {          // the same save with pk in the canonical order
    const o = JSON.parse(txt), pk = {};
    for (const id of PEAK_ORDER) if (o.pk[id]) pk[id] = o.pk[id];
    o.pk = pk;
    return JSON.stringify(o);
  };
  for (const sha of Object.keys(OLD_PLAY)) {
    const txt = OLD_SAVES[sha];
    if (typeof txt !== 'string') { check(sha + ': embedded save present', false, 'missing: run RIVAL_OLD_SAVES=print node tools/test_brain.js'); continue; }
    const B = REGEN ? brainAt(sha) : null;
    if (B) { regen++; if (oldSavePlay(B, OLD_PLAY[sha]) === txt) regenSame++; }
    const save = JSON.parse(txt), pkOrder = Object.keys(save.pk);
    const canonical = pkOrder.every(function (k, i) { return i === 0 || PEAK_ORDER.indexOf(pkOrder[i - 1]) < PEAK_ORDER.indexOf(k); });
    let loaded = false, lossless = false, plays = false, fixed = false, why = '';
    try {
      const b = R.Brain.create(JSON.parse(txt));
      loaded = true;
      lossless = JSON.stringify(b.serialize()) === fixedOrder(txt);
      // then it plays on: 600 turns with every lifecycle call and every boss mode, all legal and finite
      const g = { rng: R.RNG.create(7), prng: R.RNG.create(8), sit: R.RNG.create(9), mem: { i: 0 } };
      let d = newDuel(1), bad = 0, fixedN = 0;
      b.beginRun({ days: 3 });
      for (let i = 0; i < 600; i++) {
        if (i === 300) { b.forget(0.5); b.beginRun({ days: 8 }); }
        const q = rampQuestion(d, g.sit, true);
        const s = b.commit(Object.assign({}, q, { rng: g.rng }));
        if (sealedProblems(s, q.legalR, q.legalP).filter(function (x) { return x.indexOf('mode') !== 0; }).length) bad++;
        const pm = answer(names[i % names.length], q, s, g.prng, g.mem, i);
        b.observe(q.ctx, q.noTell ? null : s.tell, pm, s.move);
        const aj = JSON.stringify(b.serialize());
        if (aj === JSON.stringify(R.Brain.create(JSON.parse(aj)).serialize())) fixedN++;
        if (resolve(d, pm, s.move).over) d = newDuel(d.n % 7 + 1);
      }
      b.dossier(); b.runInsights(); b.habitFor(ctxOf(d));
      const js = JSON.stringify(b.serialize());
      plays = bad === 0 && js.indexOf('null') < 0 && js.indexOf('NaN') < 0 && b.serialize().runs === save.runs + 2;
      fixed = fixedN === 600;
      why = 'bad seals ' + bad + ', fixed point ' + fixedN + '/600';
    } catch (e) { why = String(e && e.stack || e); }
    console.log('  ' + sha + ': ' + txt.length + ' bytes, n ' + save.n + ', runs ' + save.runs + ', pk ' + pkOrder.join(',') + (canonical ? '' : ' (not canonical)'));
    check(sha + ': its save loads without throwing and nothing is lost (same numbers; only pk is reordered)', loaded && lossless, why);
    check(sha + ': the loaded brain plays 600 turns (beginRun, forget, noTell, mimic): legal seals, a byte fixed point every turn', plays && fixed, why);
  }
  const anyOld = Object.keys(OLD_SAVES).some(function (sha) {
    const k = Object.keys(JSON.parse(OLD_SAVES[sha]).pk);
    return k.some(function (id, i) { return i > 0 && PEAK_ORDER.indexOf(k[i - 1]) > PEAK_ORDER.indexOf(id); });
  });
  check('at least one old save holds pk out of canonical order (so the reorder path is exercised)', anyOld);
  if (!REGEN) console.log('  (the embedded text is used as it is; RIVAL_OLD_SAVES=check regenerates it from git history with this harness)');
  else if (regen) check('the embedded saves are exactly what those builds write (regenerated from git history with this harness)', regenSame === regen, regenSame + '/' + regen);
  else console.log('  (no git history here: nothing to regenerate)');
})();

// ================================================================ 4. learning benchmark
section('4. Learning benchmark (1,500 turns from a blank brain, mean of N seeds)');
let benchNs = 0n, benchTurns = 0;
const bench = {};
(function () {
  const TURNS = 1500;
  const names = Object.keys(PLAYERS);
  const MIXERS = ['uniform', 'uniform, no dud Feint', 'equilibrium'];
  console.log('  ' + pad('player', 23) + pad('expl', 6) + pad('hBase', 7) + lpad('R win%', 8) + lpad('P win%', 8) + lpad('clash%', 8) +
              lpad('net/turn', 10) + lpad('p(actual)', 11) + lpad('honest%', 9) + lpad('seeds', 7));
  for (const name of names) {
    const mixer = MIXERS.indexOf(name) >= 0;
    const seeds = mixer ? 24 : 6;
    for (const hb of [0.9, 0.4]) {
      for (const e of (mixer ? [0, 0.2, 0.6, 1.0] : [0.2, 0.6, 1.0])) {
        const a = averaged({ player: name, turns: TURNS, exploit: e, honestyBase: hb, seed: 40 }, seeds);
        bench[name + '|' + e + '|' + hb] = a;
        benchNs += a.ns; benchTurns += a.turns;
        console.log('  ' + pad(name, 23) + pad(e.toFixed(1), 6) + pad(hb.toFixed(1), 7) + lpad(pc(a.rWin), 8) + lpad(pc(a.pWin), 8) + lpad(pc(a.clash), 8) +
                    lpad(f2(a.net), 10) + lpad(a.pAct.toFixed(3), 11) + lpad(pc(a.honest), 9) + lpad(seeds, 7));
      }
    }
  }
  console.log('');
  const floor = { 'always-Guard': 0.8, 'cycle S>G>F': 0.8, 'guard-after-hit': 0.3, 'win-stay/lose-shift': 0.3, 'tell-truster': 0.3, 'tell-mirrorer': 0.3 };
  for (const name of Object.keys(floor)) {
    for (const hb of [0.9, 0.4]) {
      const a = bench[name + '|1|' + hb];
      check(pad(name, 20) + ' exploit 1.0, hBase ' + hb + ': net/turn > +' + floor[name], a.net > floor[name], f2(a.net));
    }
  }
  // Random play. "Within ±0.12 of zero" holds for the equilibrium mixer and for uniform play that
  // skips the one dominated move. The literal uniform bot Feints into an already-broken guard a
  // third of the time; a Rival with NO learning at all (exploit 0 = pure equilibrium) already
  // collects that, so zero is not the right reference for it: its reference is the exploit-0 row.
  const u0 = (bench['uniform|0|0.9'].net + bench['uniform|0|0.4'].net) / 2, s0 = (bench['uniform, no dud Feint|0|0.9'].net + bench['uniform, no dud Feint|0|0.4'].net) / 2;
  console.log('  note: zero-learning Rival (exploit 0) vs uniform: ' + f2(u0) + '/turn;  vs uniform without the dud Feint: ' + f2(s0) +
              '/turn. The gap is the bot Feinting into a broken guard, not the model.');
  for (const name of ['equilibrium', 'uniform, no dud Feint']) {
    for (const hb of [0.9, 0.4]) {
      for (const e of [0.2, 0.6, 1.0]) {
        const a = bench[name + '|' + e + '|' + hb];
        check(pad(name, 21) + ' exploit ' + e.toFixed(1) + ', hBase ' + hb + ': |net/turn| ≤ 0.12', Math.abs(a.net) <= 0.12, f2(a.net));
      }
    }
  }
  for (const name of MIXERS) {
    for (const hb of [0.9, 0.4]) {
      const b0 = bench[name + '|0|' + hb].net;
      for (const e of [0.2, 0.6, 1.0]) {
        const a = bench[name + '|' + e + '|' + hb];
        check(pad(name, 21) + ' exploit ' + e.toFixed(1) + ', hBase ' + hb + ': learning moves net/turn by ≤ 0.06 vs no learning', Math.abs(a.net - b0) <= 0.06,
              f2(b0) + ' → ' + f2(a.net));
      }
    }
  }
  for (const hb of [0.9, 0.4]) {
    for (const e of [0.2, 0.6, 1.0]) {
      const a = bench['uniform|' + e + '|' + hb];
      check(pad('uniform', 21) + ' exploit ' + e.toFixed(1) + ', hBase ' + hb + ': |net/turn| ≤ 0.12 + the zero-learning edge, and never negative beyond −0.12',
            a.net <= 0.12 + Math.max(0, u0) && a.net >= -0.12, f2(a.net));
    }
  }
  for (const name of Object.keys(floor)) {
    const lo = bench[name + '|0.2|0.4'], hi = bench[name + '|1|0.4'];
    check(pad(name, 20) + ' more exploit = more damage (0.2 → 1.0 at hBase 0.4)', hi.net > lo.net, f2(lo.net) + ' → ' + f2(hi.net));
  }
})();

// ================================================================ 5. habit break
section('5. Habit break: Guards 90% after a hit for 300 turns, then plays uniformly');
(function () {
  const SEEDS = 40, MARKS = [0, 3, 6, 10, 15, 20, 25, 40];
  const sumPred = MARKS.map(function () { return 0; }), sumSealed = MARKS.map(function () { return 0; }), cnt = MARKS.map(function () { return 0; });
  let before = 0, beforeN = 0, below25 = 0, seeds25 = 0, meanQ = 0;
  for (let s = 1; s <= SEEDS; s++) {
    let q = 0, qBefore = 0;
    const recent = [];
    simulate({
      seed: 500 + s, turns: 520, exploit: 0.75, honestyBase: 0.6,
      player: function (v) {
        if (v.turn < 300 && v.ctx.last === 'L' && v.legal.indexOf('G') >= 0 && v.rng.chance(0.9)) return 'G';
        return v.rng.pick(v.legal);
      },
      onTurn: function (t) {
        if (t.ctx.last !== 'L' || t.ctx.pBroken) return;         // qualifying turn: just hit, Guard available
        const pG = t.brain.predict(t.ctx, t.legalP).G;
        if (t.i < 300) { qBefore++; recent.push(pG); if (recent.length > 10) recent.shift(); return; }
        const k = MARKS.indexOf(q);
        if (k >= 0) { sumPred[k] += pG; sumSealed[k] += t.sealed.pred.G; cnt[k]++; }
        if (q === 25) { seeds25++; if (pG < 0.5) below25++; }
        q++;
      }
    });
    meanQ += qBefore;
    for (const x of recent) { before += x; beforeN++; }
  }
  console.log('  qualifying turns while the habit lived: ' + (meanQ / SEEDS).toFixed(0) + ' per seed;  predicted P(Guard | just hit) over its last 10: ' + (before / beforeN).toFixed(3));
  console.log('  qualifying turns after it stopped → mean predicted P(Guard)   [predict() | sealed.pred]   (' + SEEDS + ' seeds)');
  MARKS.forEach(function (m, k) {
    console.log('    ' + lpad(m, 3) + ' : ' + (sumPred[k] / cnt[k]).toFixed(3) + ' | ' + (sumSealed[k] / cnt[k]).toFixed(3));
  });
  const k25 = MARKS.indexOf(25);
  check('habit was learned (P(Guard | hit) > 0.60 before the break)', before / beforeN > 0.60, (before / beforeN).toFixed(3));
  check('predicted Guard-after-hit < 0.50 within 25 qualifying turns (mean)', sumPred[k25] / cnt[k25] < 0.5, (sumPred[k25] / cnt[k25]).toFixed(3));
  check('...and in at least 85% of individual seeds', below25 / seeds25 >= 0.85, below25 + '/' + seeds25);
  check('sealed.pred agrees (< 0.50 at 25)', sumSealed[k25] / cnt[k25] < 0.5, (sumSealed[k25] / cnt[k25]).toFixed(3));
})();

// ================================================================ 6. tell adaptation
section('6. Tell adaptation at honestyBase 0.9 (300 turns, 50-turn windows, mean of 12 seeds)');
(function () {
  const SEEDS = 12, W = 6;
  function run(name, exploit) {
    const win = [], hon = [], h = [];
    for (let i = 0; i < W; i++) { win.push(0); hon.push(0); h.push(0); }
    let hEnd = 0, hMean = 0, hN = 0, first = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const st = simulate({ player: name, turns: 300, seed: 700 + s, exploit: exploit, honestyBase: 0.9,
        afterTurn: function (t) {
          const w = Math.floor(t.i / 50);
          if (t.res.winner === 'p') { win[w]++; if (t.i < 20) first++; }
          if (t.sealed.honest) hon[w]++;
          const hv = t.brain.honesty(0.9);
          h[w] += hv;
          if (t.i >= 50) { hMean += hv; hN++; }
        } });
      hEnd += st.brain.honesty(0.9);
    }
    const out = { win: win.map(function (x) { return x / (50 * SEEDS); }), hon: hon.map(function (x) { return x / (50 * SEEDS); }),
                  h: h.map(function (x) { return x / (50 * SEEDS); }), hEnd: hEnd / SEEDS, hMean: hMean / hN, first: first / (20 * SEEDS) };
    console.log('  ' + pad(name + ' (exploit ' + exploit.toFixed(1) + ')', 30) + ' player win% first 20: ' + lpad(pc(out.first), 5) + ', by 50s: ' + out.win.map(function (x) { return lpad(pc(x), 5); }).join(' ') +
                '   | honesty(0.9): ' + out.h.map(function (x) { return x.toFixed(2); }).join(' ') + '   | realised honest%: ' + out.hon.map(function (x) { return lpad(pc(x), 5); }).join(' '));
    return out;
  }
  const t10 = run('tell-truster', 1.0);
  const t06 = run('tell-truster', 0.6);
  const mir = run('tell-mirrorer', 1.0);
  const uni = run('uniform', 1.0);
  const eqm = run('equilibrium', 1.0);
  const lastTwo = (t10.win[4] + t10.win[5]) / 2;
  check('truster: honesty(0.9) falls well below base (< 0.55 after 300 turns)', t10.hEnd < 0.55, t10.hEnd.toFixed(3));
  check('truster: exchange win% collapses (first 20 turns > 55%, last 100 < 35%)', t10.first > 0.55 && lastTwo < 0.35, pc(t10.first) + '% → ' + pc(lastTwo) + '%');
  check('truster at exploit 0.6 also collapses (last 100 < 45%)', (t06.win[4] + t06.win[5]) / 2 < 0.45, pc((t06.win[4] + t06.win[5]) / 2) + '%');
  check('mirrorer: honesty drops too (double-bluffs beat a mirror)', mir.hEnd < 0.8, mir.hEnd.toFixed(3));
  check('tell-ignoring uniform player: honesty stays near base (|mean − 0.9| < 0.10)', Math.abs(uni.hMean - 0.9) < 0.10, uni.hMean.toFixed(3));
  check('tell-ignoring equilibrium player: honesty stays near base (|mean − 0.9| < 0.10)', Math.abs(eqm.hMean - 0.9) < 0.10, eqm.hMean.toFixed(3));
})();

// ================================================================ 7. dossier
section('7. Dossier');
function printDossier(title, brain) {
  const d = brain.dossier();
  console.log('  --- ' + title + ' ---');
  console.log('  samples ' + d.samples + '   predictability ' + d.predictability + '   favorite ' + d.favorite +
              '   tell {counter ' + d.tell.counter + ', mirror ' + d.tell.mirror + ', under ' + d.tell.under + ', n ' + d.tell.n + '}   runScore ' + brain.runScore());
  d.stats.forEach(function (s) {
    console.log('    ' + pad(s.id, 17) + pad(s.kind, 7) + 'move ' + pad(String(s.move), 5) + 'pct ' + lpad(s.pct, 3) + '  n ' + lpad(s.n, 5) +
                '  strength ' + s.strength.toFixed(3) + '  vars ' + JSON.stringify(s.vars));
  });
  console.log('    broken: ' + (d.broken ? JSON.stringify(d.broken) : 'null'));
  console.log('    runInsights: ' + brain.runInsights().map(function (s) { return s.id + '(' + (s.move || s.vars.variant) + ' ' + s.pct + '%, n ' + s.n + ', ' + s.strength + ')'; }).join('  '));
  return d;
}
(function () {
  const IDS = ['fav_move', 'opening', 'after_loss', 'after_win', 'repeat', 'two_step', 'loop3', 'low_hp', 'tell_trust', 'tell_by_stance',
               'after_burn', 'echo_rival', 'deathblow_nerves', 'broken_panic', 'vs_broken', 'predictability', 'broken_habit'];
  const g = trained('guard-after-hit', 1500, 21, 0.6, 0.7);
  const d = printDossier('"Guard after being hit, otherwise random" (1,500 turns, exploit 0.6, hBase 0.7)', g);
  const al = d.stats.filter(function (s) { return s.id === 'after_loss'; })[0];
  check('stats contain after_loss with move G and a believable pct (≥ 85, strength > 0)', !!al && al.move === 'G' && al.pct >= 85 && al.pct <= 100 && al.strength > 0 && al.n >= 12,
        al ? 'pct ' + al.pct + ', n ' + al.n : 'missing');
  check('after_loss vars carry {pct, move, moveLower, n, ctxKey}', !!al && al.vars.pct === al.pct && al.vars.move === 'Guard' && al.vars.moveLower === 'guard' && al.vars.n === al.n && al.vars.ctxKey === 'after_loss');
  let sorted = true, shape = true, known = true;
  for (let i = 0; i < d.stats.length; i++) {
    const s = d.stats[i];
    if (i && s.strength > d.stats[i - 1].strength) sorted = false;
    if (IDS.indexOf(s.id) < 0) known = false;
    if (!(s.strength >= 0 && s.strength <= 1) || !(s.pct >= 0 && s.pct <= 100) || !(s.n >= 0) || ['habit', 'tell', 'record'].indexOf(s.kind) < 0 ||
        !s.vars || typeof s.vars.pct !== 'number' || typeof s.vars.move !== 'string' || typeof s.vars.moveLower !== 'string' || typeof s.vars.n !== 'number' || typeof s.vars.ctxKey !== 'string') shape = false;
  }
  check('stats sorted by strength, well-formed, only §7 ids (no `record`)', sorted && shape && known);
  const base = { duel: 3, phase: 1, turn: 5, prev1: 'S', prev2: 'F', prevR: 'G', pHp: 9, pMaxHp: 12, rHp: 7, rMaxHp: 10, tension: 0, pBroken: false, rBroken: false };
  const hL = g.habitFor(Object.assign({}, base, { last: 'L' }));
  const hW = g.habitFor(Object.assign({}, base, { last: 'W' }));
  const hC = g.habitFor(Object.assign({}, base, { last: 'C' }));
  const hB = g.habitFor(Object.assign({}, base, { last: 'L', pBroken: true }));
  console.log('    habitFor(last L) → ' + (hL ? hL.id + ' ' + hL.move + ' ' + hL.pct + '%' : 'null') + ';  habitFor(last W) → ' + (hW ? hW.id : 'null') +
              ';  habitFor(last C) → ' + (hC ? hC.id : 'null') + ';  habitFor(last L, guard broken) → ' + (hB ? hB.id + ' ' + hB.move : 'null'));
  check("habitFor returns after_loss when ctx.last === 'L'", !!hL && hL.id === 'after_loss' && hL.move === 'G');
  check("habitFor never returns after_loss when ctx.last is 'W' or 'C', nor a Guard habit while Guard is broken",
        (!hW || hW.id !== 'after_loss') && (!hC || hC.id !== 'after_loss') && (!hB || hB.move !== 'G'));
  const ins = g.runInsights();
  check('runInsights returns ≤ 3 mocked stats including after_loss', ins.length <= 3 && ins.length >= 1 && ins.every(function (s) { return s.strength > 0; }) &&
        ins.some(function (s) { return s.id === 'after_loss'; }));

  const t = trained('tell-truster', 1500, 22, 0.6, 0.7);
  const dt = printDossier('naive tell-truster (1,500 turns, exploit 0.6, hBase 0.7)', t);
  const tt = dt.stats.filter(function (s) { return s.id === 'tell_trust'; })[0];
  const ts = dt.stats.filter(function (s) { return s.id === 'tell_by_stance'; })[0];
  check('truster: tell_trust is gullible with pct ≥ 90', !!tt && tt.vars.variant === 'gullible' && tt.pct >= 90 && tt.strength > 0.5, tt ? 'pct ' + tt.pct : 'missing');
  check('truster: tell_by_stance names the stance and the counter move', !!ts && ts.vars.variant === 'counter' && ts.move === LOSES_TO[ts.vars.tell] && typeof ts.vars.tellMove === 'string' && ts.vars.ctxKey === 'show_' + ts.vars.tell);
  check('truster: dossier.tell.counter ≥ 90 and trust() > 0.85', dt.tell.counter >= 90 && t.trust() > 0.85, 'counter ' + dt.tell.counter + ', trust ' + t.trust().toFixed(3));

  const c = trained('cycle S>G>F', 600, 23, 0.6, 0.7);
  const dc = c.dossier();
  const two = dc.stats.filter(function (s) { return s.id === 'two_step'; })[0], l3 = dc.stats.filter(function (s) { return s.id === 'loop3'; })[0];
  console.log('  --- cycle player: ' + dc.stats.map(function (s) { return s.id + ' ' + (s.move || s.vars.variant) + ' ' + s.pct + '% (' + s.strength + ')'; }).join(',  '));
  check('cycle: two_step and loop3 found with prevMove / a / b vars; repeat reads never_repeats',
        !!two && two.pct >= 80 && typeof two.vars.prevMove === 'string' && !!l3 && l3.pct >= 80 && typeof l3.vars.a === 'string' && typeof l3.vars.b === 'string' &&
        dc.stats.some(function (s) { return s.id === 'repeat' && s.vars.variant === 'never_repeats' && s.strength > 0; }));
  check('predictability: cycle ≥ 60 and mocked; uniform ≤ 15', dc.predictability >= 60 && trained('uniform', 1500, 24).dossier().predictability <= 15,
        'cycle ' + dc.predictability + ', uniform ' + trained('uniform', 1500, 24).dossier().predictability);

  // most-broken habit: Guard-after-hit for 600 turns, then two runs without it
  const hb = R.Brain.create(null);
  const habit = function (on) { return function (v) { return (on && v.ctx.last === 'L') ? 'G' : v.rng.pick(v.legal); }; };
  simulate({ brain: hb, player: habit(true), turns: 600, seed: 31, exploit: 0.6, honestyBase: 0.7 });
  const b0 = hb.dossier().broken;
  simulate({ brain: hb, player: habit(false), turns: 200, seed: 32, exploit: 0.6, honestyBase: 0.7 });
  const b1 = hb.dossier().broken;
  console.log('    while the habit lives: broken = ' + (b0 ? b0.vars.habitId : 'null') + ';  200 turns after it stops: ' + (b1 ? JSON.stringify(b1) : 'null'));
  check('broken habit: null while it lives, after_loss / Guard once it stops (drop ≥ 25 pts, vars oldMove + ctxKey)',
        b0 === null && !!b1 && b1.id === 'broken_habit' && b1.vars.habitId === 'after_loss' && b1.move === 'G' && b1.vars.oldMove === 'guard' && b1.vars.ctxKey === 'after_loss' && b1.vars.drop >= 25 &&
        hb.dossier().stats.some(function (s) { return s.id === 'broken_habit'; }));
  let shown = 0;
  for (let k = 0; k < 4; k++) { hb.beginRun({ days: 0 }); if (hb.dossier().broken) shown++; }
  check('the broken habit is reported for two more runs, then its peak is cleared', shown === 2, 'reported in ' + shown + ' of the next 4 runs');

  // beginRun / forget
  const fb = trained('always-Guard', 300, 41);
  const ctxG = Object.assign({}, base, { last: 'W', prev1: 'G' });
  const p0 = fb.predict(ctxG, MOVES).G; fb.forget(0.5); const p1 = fb.predict(ctxG, MOVES).G;
  for (let k = 0; k < 6; k++) fb.forget(0.5);
  const p2 = fb.predict(ctxG, MOVES).G; const n0 = fb.dossier().stats.filter(function (s) { return s.id === 'fav_move'; })[0];
  console.log('    Ash of Forgetting on an always-Guard model: P(G) ' + p0.toFixed(3) + ' → ' + p1.toFixed(3) + ' → (6 more) ' + p2.toFixed(3) + ';  fav_move still ' + (n0 ? n0.move + ' ' + n0.pct + '%' : 'missing'));
  check('forget(0.5) softens predictions but never erases the lifetime dossier', p1 < p0 && p2 < p1 && !!n0 && n0.move === 'G');
  const rb = trained('cycle S>G>F', 200, 42);
  rb.beginRun({ days: 0 });
  check('beginRun resets the run score and run insights', rb.runScore() === 0 && rb.runInsights().length === 0);
})();

// ================================================================ 8. timing + bounded caches
section('8. Timing and bounded state');
(function () {
  const st = simulate({ player: 'win-stay/lose-shift', turns: 20000, seed: 77, exploit: 0.8, honestyBase: 0.5 });
  const us = Number(st.ns) / st.turns / 1000, usBench = Number(benchNs) / benchTurns / 1000;
  console.log('  commit + observe: ' + us.toFixed(1) + ' µs/turn over 20,000 warm turns;  ' + usBench.toFixed(1) + ' µs/turn over the whole benchmark (' + benchTurns + ' turns, cold brains)');
  check('commit + observe under 300 µs on average', us < 300 && usBench < 300);
  // hammer the solver with unique matrices: the cache must stay capped
  const b = R.Brain.create(null), rng = R.RNG.create(9);
  for (let i = 0; i < 2000; i++) b.commit({ ctx: ctxOf(newDuel(1)), payoff: randomPayoff(rng), legalR: MOVES, legalP: MOVES, exploit: 0.5, honestyBase: 0.5, rng: rng });
  console.log('  equilibrium cache entries after 2,000 unique matrices: ' + R.Brain.cacheSize());
  check('equilibrium cache capped at 64 entries', R.Brain.cacheSize() <= 64);
  check('state size after 20,000 turns still under 12 KB', JSON.stringify(st.brain.serialize()).length < 12288, JSON.stringify(st.brain.serialize()).length + ' bytes');
})();

// ------------------------------------------------------------------ the faces: no stance, and playing as the player
section('Boss modes: noTell (The Blank) and mimic (The Reflection)');
(function () {
  const pay = { S: { S: 0, G: -2, F: 3 }, G: { S: 2, G: 0, F: -2 }, F: { S: -3, G: 2, F: 0 } };
  const ctxW = { duel: 7, phase: 2, turn: 4, prev1: 'G', prev2: 'S', prevR: 'F', last: 'W', pHp: 12, pMaxHp: 26, rHp: 4, rMaxHp: 5, tension: 0, pBroken: false, rBroken: false };
  // a player who always Guards after a win and always Strikes after a loss
  const b = R.Brain.create(null), rng = R.RNG.create(77);
  b.beginRun({ days: 0 });
  for (let i = 0; i < 300; i++) {
    const last = i % 2 ? 'W' : 'L', ctx = Object.assign({}, ctxW, { last: last, turn: 2 + (i % 5) });
    b.observe(ctx, MOVES[i % 3], last === 'W' ? 'G' : 'S', MOVES[(i + 1) % 3]);
  }
  let lies = 0, modes = {}, illegal = 0;
  for (let i = 0; i < 400; i++) {
    const s = b.commit({ ctx: ctxW, payoff: pay, legalR: MOVES, legalP: MOVES, exploit: 1, honestyBase: 0.2, rng: rng, noTell: true });
    if (!s.honest || s.tell !== s.move) lies++;
    modes[s.mode] = 1;
  }
  check('noTell: the stance never differs from the move (it is not shown)', lies === 0, lies + ' of 400');
  const before = JSON.stringify(b.serialize());
  b.observe(ctxW, null, 'G', 'S');
  check('observe with no stance still learns the habit', JSON.stringify(b.serialize()) !== before);
  // (every observe decays all tables a little, so "alone" means no more than that decay)
  check('observe with no stance does not count as a response to a stance', Math.abs(b.trust() - R.Brain.create(JSON.parse(before)).trust()) < 0.01,
    b.trust() + ' vs ' + R.Brain.create(JSON.parse(before)).trust());

  // mimic: in the seat of someone who just won, it Guards (as the player does); after a loss it Strikes
  const count = { W: { S: 0, G: 0, F: 0 }, L: { S: 0, G: 0, F: 0 } };
  ['W', 'L'].forEach(function (last) {
    for (let i = 0; i < 600; i++) {
      const s = b.commit({ ctx: ctxW, payoff: pay, legalR: MOVES, legalP: MOVES, exploit: 1, honestyBase: 0.5, rng: rng, mimic: Object.assign({}, ctxW, { last: last }) });
      count[last][s.move]++;
      if (s.mode !== 'mimic') modes.bad = 1;
      if (MOVES.indexOf(s.move) < 0 || MOVES.indexOf(s.tell) < 0 || s.honest !== (s.tell === s.move)) illegal++;
    }
  });
  console.log('  mimic after a win: ' + JSON.stringify(count.W) + '   after a loss: ' + JSON.stringify(count.L));
  check('mimic plays Guard after a win, as the player does', count.W.G > 360, JSON.stringify(count.W));
  check('mimic plays Strike after a loss, as the player does', count.L.S > 360, JSON.stringify(count.L));
  check('mimic reports its mode and a consistent stance', !modes.bad && illegal === 0);
  let guardWhenBroken = 0;
  for (let i = 0; i < 200; i++) if (b.commit({ ctx: ctxW, payoff: pay, legalR: ['S', 'F'], legalP: MOVES, exploit: 1, honestyBase: 0.5, rng: rng, mimic: ctxW }).move === 'G') guardWhenBroken++;
  check('mimic never plays a move it may not', guardWhenBroken === 0);
  const fresh = R.Brain.create(null), seen = { S: 0, G: 0, F: 0 };
  for (let i = 0; i < 600; i++) seen[fresh.commit({ ctx: ctxW, payoff: pay, legalR: MOVES, legalP: MOVES, exploit: 1, honestyBase: 0.5, rng: rng, mimic: ctxW }).move]++;
  check('mimic of an unknown player is close to even', Math.min(seen.S, seen.G, seen.F) > 120, JSON.stringify(seen));
})();

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
