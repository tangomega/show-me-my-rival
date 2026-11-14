// THE RIVAL — tests + learning benchmark for src/ai/brain.js.   node tools/test_brain.js
// Exit code 1 on any failed check. Uses a tiny local model of the duel rules (DESIGN §4):
// HP 12 vs 10, tension, guard break, Rupture chip. No boons, no phase 2.
'use strict';
const path = require('path');
require(path.join(__dirname, '..', 'src', 'core', 'rng.js'));
require(path.join(__dirname, '..', 'src', 'ai', 'brain.js'));
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
    if (a !== outs[0] && Math.abs(JSON.parse(a).pred.S - JSON.parse(outs[0]).pred.S) > 2e-3) cacheSame = false;
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
  check('reloaded brain commits like the live one (rounding only)', cacheSame);
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
    sealedN++; if (sa.move === sb.move && sa.tell === sb.tell) sealedSame++;
  }
  maxDiff = Math.max(maxDiff, Math.abs(brain.trust() - copy.trust()), Math.abs(brain.honesty(0.7) - copy.honesty(0.7)));
  console.log('  round trip: max |Δ prediction| = ' + maxDiff.toExponential(2) + ';  identical sealed move+tell in ' + sealedSame + '/' + sealedN + ' commits');
  check('round trip keeps predictions (max diff < 2e-3) and decisions (≥ 99%)', maxDiff < 2e-3 && sealedSame >= 0.99 * sealedN);
  check('round trip keeps the dossier', JSON.stringify(brain.dossier()) === JSON.stringify(copy.dossier()));
  const again = JSON.stringify(R.Brain.create(JSON.parse(JSON.stringify(copy.serialize()))).serialize());
  check('serialize → create → serialize is stable', again === JSON.stringify(copy.serialize()));

  const freshJson = JSON.stringify(R.Brain.create(null).serialize());
  const garbage = [{}, null, { junk: 1 }, undefined, 'hello', 42, [1, 2, 3],
                   { v: 99, n: NaN, w: 'x', c: [1, 2], life: {}, run: [[], null, ['a']], pk: { fav_move: { k: 99, m: -4, p: 'q' }, bogus: 1 }, t2: 12, ema: 'z' },
                   { w: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], c: [[1e99, -5, NaN]] }];
  let allFresh = true, allWork = true, why = '';
  garbage.forEach(function (g, i) {
    try {
      const b = R.Brain.create(g);
      if (i < 7 && JSON.stringify(b.serialize()) !== freshJson) allFresh = false;
      const st = simulate({ brain: b, player: 'uniform', turns: 60, seed: 900 + i, exploit: 0.8, honestyBase: 0.5 });
      const js = JSON.stringify(b.serialize());
      if (js.indexOf('null') >= 0 || st.turns !== 60) { allWork = false; why = 'case ' + i; }
      b.dossier(); b.runInsights();
    } catch (e) { allWork = false; why = 'case ' + i + ': ' + e; }
  });
  check('create({}), create(null), create({junk:1}), strings, arrays → a fresh brain', allFresh);
  check('garbage fields are sanitised; every such brain plays 60 turns cleanly', allWork, why);
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
