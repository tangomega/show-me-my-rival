// THE RIVAL — combat / boons / run tests + smoke sim.   node tools/test_combat.js   (exit 1 on failure)
'use strict';
const path = require('path');
const src = path.join(__dirname, '..', 'src');
require(path.join(src, 'core', 'rng.js'));
require(path.join(src, 'game', 'boons.js'));
require(path.join(src, 'game', 'combat.js'));
require(path.join(src, 'game', 'run.js'));
const R = globalThis.RIVAL;
const C = R.Combat, B = R.Boons, RUN = R.Run, MOVES = R.MOVES;

const QUICK = process.argv.indexOf('--quick') >= 0;
let fails = 0, passes = 0;
const failLog = [];
function ok(cond, msg) {
  if (cond) passes++;
  else { fails++; failLog.push(msg); console.log('    FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(t) { console.log('\n=== ' + t + ' ==='); }
function pct(a, b) { return b ? (100 * a / b).toFixed(1) + '%' : '  n/a'; }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function lpad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function rt(o) { return JSON.parse(JSON.stringify(o)); }

// ------------------------------------------------------------------ helpers
function mk(pB, rB, o) {
  o = o || {};
  const p = C.newFighter(o.pMax || 20, o.pHp || o.pMax || 20, pB || []);
  const r = C.newFighter(o.rMax || 20, o.rHp || o.rMax || 20, rB || []);
  return C.newDuel({ n: o.n || 1, phase: o.phase || 1, p: p, r: r });
}
function turn(d, pm, rm, intel) {
  C.beginTurn(d);
  if (intel) for (const k in intel) d.intel[k] = intel[k];
  return C.resolve(d, pm, rm);
}
function hasEv(res, t, id, side) {
  const evs = Array.isArray(res) ? res : res.events;
  return evs.some(e => e.t === t && (id === undefined || e.id === id) && (side === undefined || e.side === side));
}
function boonFired(res, id) { return hasEv(res, 'boon', id); }
function legalHas(d, side, m) { return C.legal(d, side).indexOf(m) >= 0; }
function allMeta() {
  const m = RUN.defaultMeta();
  RUN.UNLOCKS.forEach(u => { m.unlocked[u.id] = true; });
  return m;
}
function simplex(rng, legal) {
  const p = { S: 0, G: 0, F: 0 };
  let sum = 0;
  legal.forEach(m => { p[m] = -Math.log(1 - rng.next()); sum += p[m]; });
  legal.forEach(m => { p[m] /= sum; });
  return p;
}
// A bonfire reached with the given boons / HP; returns the run (offer is built).
function restRun(pBoons, pHp, meta, seed) {
  meta = meta || allMeta();
  const run = RUN.create(meta, { seed: seed || 7, relicId: null, now: 1000 });
  run.pBoons = pBoons.slice();
  const d = RUN.startDuel(run);
  d.p.hp = pHp;
  d.r.hp = 0;
  d.over = 'p';
  RUN.endDuel(run, meta, 'p', null);
  return run;
}

// ================================================================== 0. data table sanity
section('0. Boon table sanity');
(function () {
  const boons = B.list.filter(b => !b.relic), relics = B.list.filter(b => b.relic);
  eq(boons.length, 36, 'boon count');
  eq(relics.length, 6, 'relic count');
  const rar = { common: 0, uncommon: 0, rare: 0 }, who = { both: 0, rival: 0, player: 0 };
  boons.forEach(b => { rar[b.rarity]++; who[b.who]++; });
  eq(rar.common + '/' + rar.uncommon + '/' + rar.rare, '14/14/8', 'rarity split C/U/R');
  eq(who.both + '/' + who.rival + '/' + who.player, '21/6/9', 'who split both/rival/player');
  eq(boons.filter(b => !b.unlock).length, 20, 'boons open from run 1');
  eq(boons.filter(b => b.active).length, 3, 'actives');
  let maxLen = 0;
  B.list.forEach(b => {
    maxLen = Math.max(maxLen, b.desc.length);
    ok(b.desc.length <= 60, b.id + ' desc is ' + b.desc.length + ' chars (max 60)');
    ok(b.name && b.name.length <= 20, b.id + ' name length <= 20');
    ok(B.byId[b.id] === b, b.id + ' byId');
    ok(!b.unlock || RUN.UNLOCKS.some(u => u.id === b.unlock && u.ref === b.id), b.id + ' unlock entry exists');
  });
  B.TAGS.forEach(t => ok(boons.filter(b => b.tags.indexOf(t) >= 0).length >= 4, 'tag ' + t + ' has >= 4 boons'));
  eq(RUN.UNLOCKS.length, 28, 'unlock entries (items)');
  const ids = {};
  RUN.UNLOCKS.forEach(u => { ids[u.id] = 1; ok(u.id && u.type && u.ref && u.name && u.how && typeof u.check === 'function', 'unlock entry complete: ' + u.id); });
  eq(Object.keys(ids).length, 23, 'unlock conditions');
  console.log('  36 boons (14C/14U/8R, 21 both / 6 rival / 9 player, 20 open), 6 relics, 28 unlock items / 23 conditions');
  console.log('  longest desc: ' + maxLen + ' chars');
  eq(RUN.DUELS.slice(1).map(d => d.rivalHp).join(','), '6,7,8,8,9,10,9', 'duel HP table');
  eq(RUN.DUELS.phase2.rivalHp, 7, 'phase 2 HP');
  eq(RUN.HEAL, 6, 'HEAL'); eq(RUN.PLAYER_MAX_HP, 26, 'PLAYER_MAX_HP');
  eq(RUN.PHASE2_HEAL, 4, 'PHASE2_HEAL');
})();

// ================================================================== 1. core rules
section('1. Core rules');
(function () {
  // --- base table
  const want = {            // [pm][rm] -> [dmgP, dmgR, winner, guardBreak]
    S: { S: [0, 0, null, null], G: [2, 0, 'r', null], F: [0, 3, 'p', null] },
    G: { S: [0, 2, 'p', null], G: [0, 0, null, null], F: [2, 0, 'r', 'p'] },
    F: { S: [3, 0, 'r', null], G: [0, 2, 'p', 'r'], F: [0, 0, null, null] }
  };
  console.log('  base table (rows = Rival move, cols = player move; cell = dmgP/dmgR [break]):');
  MOVES.forEach(rm => {
    let line = '    R ' + rm + ' |';
    MOVES.forEach(pm => {
      const d = mk();
      const res = turn(d, pm, rm);
      const w = want[pm][rm];
      eq(res.dmgP, w[0], 'base ' + pm + ' vs ' + rm + ' dmgP');
      eq(res.dmgR, w[1], 'base ' + pm + ' vs ' + rm + ' dmgR');
      eq(res.winner, w[2], 'base ' + pm + ' vs ' + rm + ' winner');
      eq(res.guardBreak, w[3], 'base ' + pm + ' vs ' + rm + ' guardBreak');
      eq(res.clash, pm === rm, 'base ' + pm + ' vs ' + rm + ' clash');
      eq(res.tensionAfter, pm === rm ? 1 : 0, 'base tension');
      eq(d.turn, 2, 'turn advanced');
      line += ' P ' + pm + ': ' + res.dmgP + '/' + res.dmgR + (res.guardBreak ? ' brk:' + res.guardBreak : '      ') + ' |';
    });
    console.log(line);
  });

  // --- tension stacking + reset
  let d = mk();
  eq(turn(d, 'S', 'S').tensionAfter, 1, 'tension 1');
  eq(turn(d, 'G', 'G').tensionAfter, 2, 'tension 2');
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 5, 'win at 2 pips = 3 + 2');
  eq(res.tensionAfter, 0, 'tension reset after decisive');
  eq(res.deathblow, false, 'no deathblow at 2 pips');
  d = mk();
  turn(d, 'S', 'S'); turn(d, 'G', 'G'); turn(d, 'F', 'F');
  eq(d.tension, 3, 'tension 3');
  res = turn(d, 'G', 'S');
  eq(res.dmgR, 5, 'riposte at 3 pips = 2 + 3');
  eq(res.deathblow, true, 'deathblow flag');
  console.log('  tension: clash x2 then Strike win = ' + 5 + ' dmg, pips 2 -> 0; win at 3 pips flags deathblow');

  // --- Rupture
  d = mk();
  turn(d, 'S', 'S'); turn(d, 'G', 'G'); turn(d, 'F', 'F');
  res = turn(d, 'S', 'S');
  ok(res.rupture, 'rupture flag');
  eq(res.dmgP, 1, 'rupture dmg P'); eq(res.dmgR, 1, 'rupture dmg R');
  eq(d.tension, 3, 'rupture keeps tension at 3');
  ok(legalHas(d, 'p', 'S') && legalHas(d, 'r', 'S'), 'rupture does not seal the move (a seal for both locks the duel)');
  eq(C.legal(d, 'p').length, 3, 'three legal moves after rupture'); eq(C.legal(d, 'r').length, 3, 'three legal moves for the Rival too');
  res = turn(d, 'S', 'S');
  ok(res.rupture && d.tension === 3 && res.dmgP === 1 && res.dmgR === 1, 'a second rupture on the same move is allowed');
  d = mk([], [], { pHp: 1, rHp: 1 });
  d.tension = 3;
  res = turn(d, 'G', 'G');
  ok(res.rupture && res.dmgP === 0 && res.dmgR === 0 && !d.over, 'rupture is never lethal');
  console.log('  rupture: 1 dmg each, no seal, tension stays 3, cannot drop below 1 HP');

  // --- guard break timing
  d = mk();
  res = turn(d, 'G', 'F');
  eq(res.guardBreak, 'p', 'guard broken');
  ok(!legalHas(d, 'p', 'G'), 'Guard illegal on the next turn');
  eq(C.ctx(d).pBroken, true, 'ctx.pBroken');
  turn(d, 'S', 'S');
  ok(legalHas(d, 'p', 'G'), 'Guard legal again the turn after');
  console.log('  guard break: applied turn t, Guard illegal on t+1 only');

  // --- bleed timing + kill
  d = mk(['serrated_edge'], [], { rHp: 20 });
  res = turn(d, 'S', 'F');
  eq(d.r.status.bleed, 3, 'bleed 3 applied');
  const hp0 = d.r.hp;
  let ev = C.beginTurn(d); ok(hasEv(ev, 'bleed', undefined, 'r'), 'bleed tick 1'); C.resolve(d, 'G', 'G');
  ev = C.beginTurn(d); eq(C.beginTurn(d).length, 0, 'beginTurn is idempotent per turn'); C.resolve(d, 'G', 'G');
  ev = C.beginTurn(d); C.resolve(d, 'G', 'G');
  eq(d.r.hp, hp0 - 3, 'bleed dealt exactly 3 over 3 turn starts');
  ev = C.beginTurn(d);
  ok(!hasEv(ev, 'bleed'), 'no 4th tick');
  d = mk([], [], { pHp: 1, rHp: 1 });
  d.p.status.bleed = 2; d.r.status.bleed = 2;
  ev = C.beginTurn(d);
  eq(d.over, 'p', 'double bleed kill: Rival ticks first, player wins');
  eq(d.p.hp, 1, 'player did not tick after the Rival died');
  d = mk([], [], { pHp: 1 });
  d.p.status.bleed = 1; d.p.status.fortify = 3;
  C.beginTurn(d);
  eq(d.over, 'r', 'bleed kills and ignores fortify');
  d = mk(); d.r.status.bleed = 3; d.r.status.bleed = Math.max(d.r.status.bleed, 2);
  eq(d.r.status.bleed, 3, 're-apply keeps max');
  console.log('  bleed: 1 dmg at each of the next n turn starts, Rival ticks first, can kill, ignores fortify');

  // --- fortify / focus consumption
  d = mk(['first_blood'], ['mourning_veil']);
  eq(d.p.status.focus, 1, 'focus 1 at start'); eq(d.r.status.fortify, 2, 'fortify 2 at start');
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 2, '3 + focus 1 - fortify 2');
  eq(d.p.status.focus, 0, 'focus consumed'); eq(d.r.status.fortify, 0, 'fortify consumed');
  eq(turn(d, 'S', 'F').dmgR, 3, 'second hit unmodified');
  d = mk(); d.p.status.fortify = 3; d.r.status.focus = 3;
  turn(d, 'S', 'S');
  eq(d.p.status.fortify, 3, 'fortify not consumed by a clash'); eq(d.r.status.focus, 3, 'focus not consumed by a clash');
  res = turn(d, 'S', 'G');                           // Rival riposte 2 + tension 1 + focus 3 - fortify 3
  eq(res.dmgP, 3, 'focus then fortify');
  eq(d.p.status.fortify, 0, 'fortify consumed by the hit');
  console.log('  focus adds to the next win then clears; fortify absorbs the next hit then clears; cap 3');

  // --- hit cap (dangerous combo 1 raw value)
  d = mk([], ['coiled_riposte', 'first_blood', 'deathblow_creed', 'resonance']);
  turn(d, 'S', 'S'); turn(d, 'G', 'G');              // resonance: 2 + 2 -> 3 pips, Rival's last move = Guard
  eq(d.tension, 3, 'resonance reached 3 pips in two clashes');
  res = turn(d, 'F', 'S');
  eq(res.dmgP, 8, 'hit cap 8');
  eq(res.overkill, 3, 'raw 11 clipped by 3');
  ok(hasEv(res, 'overkill'), 'overkill event');
  console.log('  hit cap: Guard -> Strike at 3 pips with coiled+first_blood+creed = raw 11 -> ' + res.dmgP + ' (overkill ' + res.overkill + ')');

  // --- >= 2 legal moves under seal stacking
  d = mk([], ['no_encores', 'sealing_wax', 'long_con']);
  turn(d, 'G', 'F');                                 // broken for 2 turns (long con)
  eq(C.legal(d, 'p').join(''), 'SF', 'broken: S/F legal');
  res = turn(d, 'S', 'G');                           // loses with S: sealing wax would leave only F
  ok(res.events.some(e => e.t === 'status' && e.id === 'sealed' && e.op === 'blocked'), 'seal blocked by the 2-move rule');
  eq(C.legal(d, 'p').join(''), 'SF', 'still two legal moves');
  const rng = R.RNG.create(99);
  let minLegal = 3, sum = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    d = mk([], ['no_encores', 'sealing_wax', 'long_con'], { pMax: 200, rMax: 200 });
    d.tension = rng.int(4);
    for (let t = 0; t < 30 && !d.over; t++) {
      C.beginTurn(d);
      const lp = C.legal(d, 'p'), lr = C.legal(d, 'r');
      minLegal = Math.min(minLegal, lp.length, lr.length); sum += lp.length; n++;
      C.resolve(d, rng.pick(lp), rng.pick(lr));
    }
  }
  ok(minLegal >= 2, 'legal moves never below 2 (min ' + minLegal + ')');
  console.log('  seal stacking (no_encores + sealing_wax + long_con, 12k random turns): min legal ' + minLegal + ', mean ' + (sum / n).toFixed(2));

  // --- phase 2: Embers
  d = mk([], [], { n: 7, phase: 2 });
  eq(d.tension, 1, 'phase 2 starts at 1 pip');
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 4, 'Embers: every hit +1');
  eq(d.tension, 1, 'Embers: tension resets to 1');
  turn(d, 'S', 'S'); turn(d, 'G', 'G');
  eq(d.tension, 3, 'two clashes from the floor reach 3');
  console.log('  Embers: tension floor 1 in phase 2 (Strike win = 4, back to 1 pip)');

  // --- phase 2: Called Shot
  d = mk([], [], { n: 7, phase: 2 });
  res = turn(d, 'G', 'F', { called: 'G' });
  eq(res.dmgP, 5, 'called + lost: 2 + 1 pip + 2');
  eq(res.called, 'hit', 'called hit');
  ok(res.events.some(e => e.t === 'called' && e.result === 'hit'), 'called hit event');
  eq(d.intel.called, null, 'intel reset after resolve');
  d = mk([], [], { n: 7, phase: 2 });
  res = turn(d, 'G', 'S', { called: 'G' });
  eq(res.dmgR, 3, 'called move that wins: no bonus either way'); eq(res.guardBreak, null, 'no stagger');
  d = mk([], [], { n: 7, phase: 2 });
  res = turn(d, 'S', 'F', { called: 'G' });
  eq(res.called, 'miss', 'called miss'); eq(res.guardBreak, 'r', 'Rival staggered');
  ok(!legalHas(d, 'r', 'G'), 'Rival cannot Guard next turn');
  turn(d, 'S', 'S');
  ok(legalHas(d, 'r', 'G'), 'stagger lasts one turn');
  d = mk([], [], { n: 7, phase: 2 });
  res = turn(d, 'F', 'S', { called: 'G' });
  eq(res.dmgP, 4, 'different move that loses: no +2'); eq(res.called, null, 'no called result');
  d = mk([], [], { n: 7, phase: 2 });
  res = turn(d, 'S', 'S', { called: 'S' });
  eq(res.called, null, 'called + clash: nothing');
  d = mk([], [], { n: 7, phase: 1 });
  res = turn(d, 'G', 'F', { called: 'G' });
  eq(res.dmgP, 2, 'Called Shot is phase 2 only');
  // payoff contains the Called Shot terms
  d = mk([], [], { n: 7, phase: 2 });
  C.beginTurn(d); d.intel.called = 'G';
  let pay = C.payoff(d);
  eq(pay.F.G, 5 + 0.86, 'payoff: called G loses to F = 5 dmg + break');
  eq(pay.F.S, -(4 + 0.86), 'payoff: uncalled S beats F = -4 and a stagger');
  eq(d.intel.called, 'G', 'payoff leaves intel alone');
  console.log('  Called Shot: called move loses = +2 (5 dmg); other move wins = Rival guardBroken 1; in payoff: F/G ' + pay.F.G.toFixed(2) + ', F/S ' + pay.F.S.toFixed(2));

  // --- payoff base matrix + lethal bonus
  d = mk();
  pay = C.payoff(d);
  console.log('  payoff, fresh duel (rows Rival S/G/F, cols player S/G/F): ' + MOVES.map(r => '[' + MOVES.map(p => pay[r][p].toFixed(2)).join(', ') + ']').join(' '));
  eq(pay.S.F, 3, 'payoff S>F'); eq(pay.G.S, 2, 'payoff G>S'); eq(pay.F.G, 2.86, 'payoff F>G incl. break');
  eq(pay.G.F, -2.86, 'payoff player F>G'); eq(pay.S.S, 0, 'payoff clash');
  d = mk([], [], { pHp: 2, rHp: 2 });
  pay = C.payoff(d);
  eq(pay.S.F, 3 + 8, 'payoff lethal on player +8'); eq(pay.F.S, -(3 + 8), 'payoff lethal on Rival -8');

  // --- useActive / illegal move coercion / over
  d = mk();
  eq(C.useActive(d, 'keyhole').ok, false, 'useActive without the boon');
  d = mk(); turn(d, 'G', 'F');
  res = turn(d, 'G', 'S');
  ok(res.pm !== 'G' && hasEv(res, 'note'), 'illegal move is replaced, never thrown');
  d = mk([], [], { rHp: 2 });
  res = turn(d, 'S', 'F');
  eq(res.over, 'p', 'duel over'); eq(d.r.hp, 0, 'hp floors at 0');
  eq(C.resolve(d, 'S', 'F').events.length, 0, 'resolve after over is a no-op');
  eq(C.legal(d, 'p').length, 3, 'legal never empty');
})();

// ================================================================== 2. boon checklist
section('2. Boon checklist (every boon and relic: triggers when it should, not otherwise)');
const boonTests = {};
function T(id, fn) { boonTests[id] = fn; }

T('coiled_riposte', () => {
  let d = mk(['coiled_riposte']);
  turn(d, 'G', 'S');
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 5, 'Guard then Strike = 5'); ok(boonFired(res, 'coiled_riposte'), 'event');
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 3, 'Strike after Strike = 3'); ok(!boonFired(res, 'coiled_riposte'), 'no event');
  d = mk(['coiled_riposte']);
  eq(turn(d, 'S', 'F').dmgR, 3, 'turn 1 Strike = 3');
});
T('thorned_guard', () => {
  let d = mk(['thorned_guard']);
  eq(turn(d, 'G', 'S').dmgR, 3, 'riposte = 3');
  eq(turn(d, 'S', 'F').dmgR, 3, 'Strike unchanged');
  d = mk(['thorned_guard']);
  eq(turn(d, 'F', 'G').dmgR, 2, 'Feint unchanged');
});
T('stone_patience', () => {
  let d = mk(['stone_patience']);
  let res = turn(d, 'G', 'S');
  eq(d.p.status.fortify, 1, 'fortify 1 after a clean Guard'); ok(boonFired(res, 'stone_patience'), 'event');
  turn(d, 'G', 'G');
  eq(d.p.status.fortify, 1, 'does not stack');
  d = mk(['stone_patience']);
  turn(d, 'S', 'F'); eq(d.p.status.fortify, 0, 'no fortify without Guard');
  d = mk(['stone_patience']);
  turn(d, 'G', 'F'); eq(d.p.status.fortify, 0, 'no fortify when the Guard took damage');
});
T('iron_oath', () => {
  const d = mk(['iron_oath']);
  let res = turn(d, 'G', 'F');
  eq(res.guardBreak, null, 'first break negated'); ok(legalHas(d, 'p', 'G'), 'Guard still legal'); ok(boonFired(res, 'iron_oath'), 'event');
  eq(res.dmgP, 2, 'damage still taken');
  res = turn(d, 'G', 'F');
  eq(res.guardBreak, 'p', 'second break lands'); ok(!legalHas(d, 'p', 'G'), 'Guard illegal'); ok(!boonFired(res, 'iron_oath'), 'no second trigger');
});
T('resonance', () => {
  let d = mk(['resonance']);
  let res = turn(d, 'S', 'S');
  eq(d.tension, 2, 'clash adds 2'); ok(boonFired(res, 'resonance'), 'event');
  turn(d, 'G', 'G'); eq(d.tension, 3, 'capped at 3');
  res = turn(d, 'S', 'F'); ok(!boonFired(res, 'resonance'), 'no trigger on a decisive exchange');
  d = mk([], ['resonance']);
  turn(d, 'F', 'F'); eq(d.tension, 2, 'works for the Rival too');
  d = mk();
  turn(d, 'S', 'S'); eq(d.tension, 1, 'without it: 1');
});
T('ash_veil', () => {
  let d = mk(['ash_veil']);
  d.tension = 3;
  let res = turn(d, 'F', 'S');
  eq(res.dmgP, 4, '3 + 3 pips - 2'); ok(boonFired(res, 'ash_veil'), 'event');
  d = mk(['ash_veil']); d.tension = 1;
  eq(turn(d, 'F', 'S').dmgP, 3, '3 + 1 - 1 (only the tension part)');
  d = mk(['ash_veil']);
  res = turn(d, 'F', 'S');
  eq(res.dmgP, 3, 'no tension: no reduction'); ok(!boonFired(res, 'ash_veil'), 'no event');
});
T('deathblow_creed', () => {
  let d = mk(['deathblow_creed']); d.tension = 3;
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 8, '3 + 3 + 2'); ok(boonFired(res, 'deathblow_creed'), 'event');
  d = mk(['deathblow_creed']); d.tension = 3;
  eq(turn(d, 'G', 'S').dmgR, 7, 'riposte at 3 pips: 2 + 3 + 2');
  d = mk(['deathblow_creed']); d.tension = 2;
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 5, '2 pips: no bonus'); ok(!boonFired(res, 'deathblow_creed'), 'no event');
});
T('mirror_etiquette', () => {
  const d = mk(['mirror_etiquette'], [], { pHp: 10 });
  let res = turn(d, 'S', 'S');
  eq(d.p.status.focus, 1, 'Bind: focus 1'); ok(boonFired(res, 'mirror_etiquette'), 'event');
  d.tension = 0; turn(d, 'G', 'G');
  eq(d.p.status.fortify, 1, 'Standoff: fortify 1');
  d.tension = 0; res = turn(d, 'F', 'F');
  eq(d.p.hp, 11, 'Masquerade: heal 1'); eq(res.healP, 1, 'healP');
  d.tension = 0; turn(d, 'F', 'F'); eq(d.p.hp, 12, 'second heal');
  d.tension = 0; res = turn(d, 'F', 'F'); eq(d.p.hp, 12, 'max 2 heals per duel');
  ok(!boonFired(res, 'mirror_etiquette'), 'no event past the cap');
  const d2 = mk(['mirror_etiquette'], [], { pHp: 10 });
  turn(d2, 'G', 'S');
  ok(d2.p.status.focus === 0 && d2.p.status.fortify === 0 && d2.p.hp === 10, 'nothing on a decisive exchange');
});
T('serrated_edge', () => {
  let d = mk(['serrated_edge']);
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 2, 'Strike -1'); eq(d.r.status.bleed, 3, 'bleed 3');
  d = mk(['serrated_edge']);
  res = turn(d, 'G', 'S');
  eq(res.dmgR, 2, 'riposte unchanged'); eq(d.r.status.bleed, 0, 'no bleed');
  d = mk(['serrated_edge']);
  turn(d, 'S', 'G'); eq(d.r.status.bleed, 0, 'no bleed on a lost Strike');
});
T('paper_cuts', () => {
  let d = mk(['paper_cuts']);
  let res = turn(d, 'F', 'G');
  eq(d.r.status.bleed, 2, 'bleed 2'); ok(boonFired(res, 'paper_cuts'), 'event');
  d = mk(['paper_cuts']);
  turn(d, 'S', 'F'); eq(d.r.status.bleed, 0, 'no bleed on Strike');
  d = mk(['paper_cuts']);
  turn(d, 'F', 'S'); eq(d.r.status.bleed, 0, 'no bleed on a lost Feint');
});
T('salt_the_wound', () => {
  let d = mk(['salt_the_wound']); d.r.status.bleed = 3;
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 4, '+1 vs bleeding'); ok(boonFired(res, 'salt_the_wound'), 'event');
  d = mk(['salt_the_wound']);
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 3, 'no bleed: no bonus'); ok(!boonFired(res, 'salt_the_wound'), 'no event');
});
T('carrion_comfort', () => {
  let d = mk(['carrion_comfort'], [], { pHp: 10 });
  d.r.status.bleed = 3;
  let res = turn(d, 'S', 'F');
  eq(res.healP, 1, 'heal 1'); eq(d.p.hp, 11, 'hp');
  d.r.status.bleed = 3; turn(d, 'S', 'F'); d.r.status.bleed = 3; turn(d, 'S', 'F');
  eq(d.p.hp, 13, '3 heals');
  d.r.status.bleed = 3; res = turn(d, 'S', 'F');
  eq(d.p.hp, 13, 'max 3 per duel'); eq(res.healP, 0, 'no heal past cap');
  d = mk(['carrion_comfort'], [], { pHp: 10 });
  res = turn(d, 'S', 'F'); eq(res.healP, 0, 'foe not bleeding: no heal');
  d = mk(['carrion_comfort', 'paper_cuts'], [], { pHp: 10 });
  res = turn(d, 'F', 'G'); eq(res.healP, 0, 'bleed applied by this very hit does not count');
});
T('vampires_curtsy', () => {
  let d = mk(['vampires_curtsy'], [], { pHp: 10 });
  let res = turn(d, 'F', 'G');
  eq(res.healP, 1, 'heal 1'); ok(boonFired(res, 'vampires_curtsy'), 'event');
  d.r.status.guardBroken = 0; turn(d, 'F', 'G'); d.r.status.guardBroken = 0; turn(d, 'F', 'G');
  d.r.status.guardBroken = 0; res = turn(d, 'F', 'G');
  eq(d.p.hp, 13, 'max 3 per duel'); eq(res.healP, 0, 'capped');
  d = mk(['vampires_curtsy'], [], { pHp: 10 });
  eq(turn(d, 'S', 'F').healP, 0, 'Strike win: no heal');
  eq(turn(d, 'F', 'S').healP, 0, 'lost Feint: no heal');
});
T('long_con', () => {
  let d = mk(['long_con']);
  let res = turn(d, 'F', 'G');
  eq(res.brokenR, 2, '2 turns inflicted'); ok(boonFired(res, 'long_con'), 'event');
  ok(!legalHas(d, 'r', 'G'), 'turn +1 illegal'); turn(d, 'S', 'S');
  ok(!legalHas(d, 'r', 'G'), 'turn +2 illegal'); turn(d, 'S', 'S');
  ok(legalHas(d, 'r', 'G'), 'turn +3 legal');
  d = mk(['long_con']);
  res = turn(d, 'S', 'F'); ok(!boonFired(res, 'long_con'), 'no break: no trigger');
  d = mk();
  eq(turn(d, 'F', 'G').brokenR, 1, 'without it: 1 turn');
});
T('turtle_cracker', () => {
  let d = mk(['turtle_cracker']);
  turn(d, 'S', 'G');
  let res = turn(d, 'F', 'G');
  eq(res.dmgR, 4, 'Guard twice: 2 + 2'); ok(boonFired(res, 'turtle_cracker'), 'event');
  d = mk(['turtle_cracker']);
  res = turn(d, 'F', 'G');
  eq(res.dmgR, 2, 'first Guard: no bonus'); ok(!boonFired(res, 'turtle_cracker'), 'no event');
});
T('debt_collector', () => {
  let d = mk(['debt_collector']);
  turn(d, 'F', 'G');
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 5, 'Strike vs broken = 5'); ok(boonFired(res, 'debt_collector'), 'event');
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 3, 'break expired: 3');
  d = mk(['debt_collector']); turn(d, 'F', 'G');
  d.r.status.sealed.S = 0;
  res = C.resolve(d, 'G', 'S'); eq(res.dmgR, 2, 'riposte vs broken: no bonus');
});
T('cornered', () => {
  let d = mk(['cornered'], [], { pMax: 12, pHp: 4 });
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 4, 'low HP: +1'); ok(boonFired(res, 'cornered'), 'event');
  d = mk(['cornered'], [], { pMax: 12, pHp: 5 });
  eq(turn(d, 'S', 'F').dmgR, 3, 'hp 5/12 is not low');
});
T('spite', () => {
  let d = mk(['spite']);
  let res = turn(d, 'F', 'S');
  eq(d.p.status.focus, 2, 'focus 2 after losing 3'); ok(boonFired(res, 'spite'), 'event');
  eq(turn(d, 'S', 'F').dmgR, 5, 'next win +2');
  d = mk(['spite']);
  turn(d, 'S', 'G'); eq(d.p.status.focus, 0, 'lost only 2: nothing');
  d = mk(['spite']); d.p.status.focus = 2;
  turn(d, 'F', 'S'); eq(d.p.status.focus, 2, 'does not stack');
});
T('three_faces', () => {
  const d = mk(['three_faces']);
  eq(turn(d, 'S', 'F').dmgR, 3, 'turn 1: needs two previous moves');
  eq(turn(d, 'G', 'S').dmgR, 2, 'turn 2: needs two previous moves');
  let res = turn(d, 'F', 'G');
  eq(res.dmgR, 3, 'S, G then Feint: +1'); ok(boonFired(res, 'three_faces'), 'event');
  d.r.status.guardBroken = 0;
  res = turn(d, 'G', 'S');
  eq(res.dmgR, 2, 'G, F then Guard: no bonus'); ok(!boonFired(res, 'three_faces'), 'no event');
});
T('first_blood', () => {
  let d = mk(['first_blood']);
  eq(d.p.status.focus, 1, 'focus 1 at duel start');
  ok(d.pendingEvents.some(e => e.t === 'boon' && e.id === 'first_blood'), 'duelStart event queued');
  eq(turn(d, 'S', 'F').dmgR, 4, 'first win +1');
  eq(turn(d, 'S', 'F').dmgR, 3, 'then normal');
  d = mk([], ['first_blood']);
  eq(d.r.status.focus, 1, 'Rival version'); eq(d.p.status.focus, 0, 'player has none');
});
T('headsman', () => {
  let d = mk(['headsman'], [], { rMax: 9, rHp: 3 });
  let res = turn(d, 'S', 'F');
  eq(res.dmgR, 5, 'low foe: +2'); ok(boonFired(res, 'headsman'), 'event');
  d = mk(['headsman'], [], { rMax: 9, rHp: 4 });
  eq(turn(d, 'S', 'F').dmgR, 3, 'foe at 4/9: no bonus');
  d = mk(['headsman'], [], { rMax: 9, rHp: 3 });
  eq(turn(d, 'G', 'S').dmgR, 2, 'riposte: no bonus');
});
T('no_encores', () => {
  let d = mk([], ['no_encores']);
  turn(d, 'S', 'G');
  ok(legalHas(d, 'p', 'S'), 'first Strike: nothing');
  let res = turn(d, 'S', 'G');
  ok(!legalHas(d, 'p', 'S'), 'repeat: Strike sealed'); ok(boonFired(res, 'no_encores'), 'event');
  turn(d, 'G', 'G');
  ok(legalHas(d, 'p', 'S'), 'seal lasts one turn');
  d = mk([], ['no_encores']);
  turn(d, 'S', 'G'); res = turn(d, 'G', 'G');
  eq(C.legal(d, 'p').length, 3, 'no repeat: no seal'); ok(!boonFired(res, 'no_encores'), 'no event');
});
T('painted_smile', () => {
  let d = mk([], ['painted_smile']);
  let res = turn(d, 'F', 'S', { honest: false });
  eq(res.dmgP, 4, 'lie that wins: +1'); ok(boonFired(res, 'painted_smile'), 'event');
  res = turn(d, 'S', 'F', { honest: false });
  eq(res.dmgR, 4, 'lie that is caught: +1 to the Rival');
  res = turn(d, 'F', 'S', { honest: true });
  eq(res.dmgP, 3, 'honest stance: nothing'); ok(!boonFired(res, 'painted_smile'), 'no event');
  eq(turn(d, 'S', 'F').dmgR, 3, 'unknown honesty: nothing');
});
T('mourning_veil', () => {
  let d = mk([], ['mourning_veil']);
  eq(d.r.status.fortify, 2, 'fortify 2 at start');
  eq(turn(d, 'S', 'F').dmgR, 1, 'first hit -2');
  eq(turn(d, 'S', 'F').dmgR, 3, 'then normal');
  d = mk();
  eq(d.r.status.fortify, 0, 'without it: none');
});
T('hungry_mask', () => {
  let d = mk([], ['hungry_mask'], { rHp: 10 });
  let res = turn(d, 'S', 'G', { pred: { S: 0.7, G: 0.2, F: 0.1 } });
  eq(res.healR, 1, 'read + win: heal 1'); ok(boonFired(res, 'hungry_mask'), 'event');
  res = turn(d, 'S', 'G', { pred: { S: 0.5, G: 0.3, F: 0.2 } });
  eq(res.healR, 0, 'not a read');
  res = turn(d, 'G', 'S', { pred: { S: 0.1, G: 0.8, F: 0.1 } });
  eq(res.healR, 0, 'read but lost');
  res = turn(d, 'S', 'G');
  eq(res.healR, 0, 'no pred');
  for (let i = 0; i < 4; i++) turn(d, 'S', 'G', { pred: { S: 0.9, G: 0.05, F: 0.05 } });
  eq(d.r.counters.hungry_mask, 3, 'max 3 per duel');
});
T('sealing_wax', () => {
  let d = mk([], ['sealing_wax']);
  let res = turn(d, 'S', 'G');
  ok(!legalHas(d, 'p', 'S'), 'losing move sealed'); ok(boonFired(res, 'sealing_wax'), 'event');
  turn(d, 'G', 'G'); ok(legalHas(d, 'p', 'S'), 'one turn only');
  d = mk([], ['sealing_wax']);
  res = turn(d, 'S', 'F');
  eq(C.legal(d, 'p').length, 3, 'Rival lost: no seal'); ok(!boonFired(res, 'sealing_wax'), 'no event');
  turn(d, 'S', 'S'); eq(C.legal(d, 'p').length, 3, 'clash: no seal');
});
T('spare_mask', () => {
  let d = mk([], ['spare_mask'], { n: 3, rHp: 2 });
  let res = turn(d, 'S', 'F');
  eq(d.r.hp, 1, 'survives at 1'); eq(d.over, null, 'not over'); eq(d.r.status.fortify, 1, 'fortify 1');
  ok(hasEv(res, 'saved', undefined, 'r') && boonFired(res, 'spare_mask'), 'events');
  res = turn(d, 'S', 'F');
  eq(d.over, 'p', 'only once (3 - fortify 1 kills)');
  d = mk([], ['spare_mask'], { n: 7, rHp: 2 });
  turn(d, 'S', 'F'); eq(d.over, 'p', 'never in duel 7');
  // once per RUN: persists through R.Run
  const meta = allMeta();
  const run = RUN.create(meta, { seed: 5, now: 1 });
  run.rBoons = ['spare_mask'];
  let dd = RUN.startDuel(run);
  dd.r.hp = 1; C.beginTurn(dd);
  res = C.resolve(dd, 'S', 'F'); RUN.record(run, meta, res, null);
  eq(dd.over, null, 'run: saved in duel 1');
  run.duelN = 2; dd = RUN.startDuel(run);
  dd.r.hp = 1; C.beginTurn(dd); C.resolve(dd, 'S', 'F');
  eq(dd.over, 'p', 'run: already spent in duel 2');
});
T('keyhole', () => {
  let d = mk(['keyhole']);
  eq(d.p.charges.keyhole, 1, '1 charge');
  let a = C.useActive(d, 'keyhole');
  ok(a.ok && a.kind === 'glimpse', 'ok + kind glimpse');
  eq(C.useActive(d, 'keyhole').ok, false, 'no charge left');
  d = mk();
  eq(C.useActive(d, 'keyhole').ok, false, 'not owned');
});
T('truth_candle', () => {
  let d = mk(['truth_candle']);
  let a = C.useActive(d, 'truth_candle');
  ok(a.ok && a.kind === 'honesty', 'ok + kind honesty');
  eq(C.useActive(d, 'truth_candle').ok, false, 'no charge left');
  eq(d.intel.coin, false, 'does not set the coin flag');
  d = mk(['keyhole']);
  eq(C.useActive(d, 'truth_candle').ok, false, 'not owned');
});
T('stolen_ledger', () => {
  let d = mk(['stolen_ledger']);
  eq(C.info(d).ledger, true, 'info.ledger');
  ok(hasEv(C.beginTurn(d), 'info', 'stolen_ledger'), 'turnStart info event');
  d = mk();
  eq(C.info(d).ledger, false, 'off without it');
  ok(!hasEv(C.beginTurn(d), 'info', 'stolen_ledger'), 'no event without it');
});
T('liars_tally', () => {
  let d = mk(['liars_tally']);
  eq(C.info(d).tally, true, 'info.tally');
  turn(d, 'S', 'G', { honest: true }); turn(d, 'S', 'G', { honest: false }); turn(d, 'S', 'G', { honest: false }); turn(d, 'S', 'S');
  eq(C.info(d).tallyHonest, 1, 'honest count'); eq(C.info(d).tallyLie, 2, 'lie count');
  d = mk();
  turn(d, 'S', 'G', { honest: true });
  eq(C.info(d).tally, false, 'off without it'); eq(C.info(d).tallyHonest, 0, 'no count without it');
});
T('coin_of_fools', () => {
  let d = mk(['coin_of_fools']);
  C.beginTurn(d);
  let a = C.useActive(d, 'coin_of_fools');
  ok(a.ok && a.kind === 'coin' && a.left === 2, 'ok + kind coin'); eq(d.intel.coin, true, 'intel.coin set');
  eq(C.useActive(d, 'coin_of_fools').ok, false, 'one coin per turn');
  let res = C.resolve(d, 'S', 'F');
  eq(res.dmgR, 5, 'coin move wins: +2'); ok(boonFired(res, 'coin_of_fools'), 'event');
  res = turn(d, 'S', 'F');
  eq(res.dmgR, 3, 'no coin: no bonus'); ok(!boonFired(res, 'coin_of_fools'), 'no event');
  C.beginTurn(d); C.useActive(d, 'coin_of_fools'); res = C.resolve(d, 'S', 'G');
  eq(res.dmgP, 2, 'coin move loses: nothing extra');
  C.beginTurn(d); eq(C.useActive(d, 'coin_of_fools').ok, true, 'third charge'); C.resolve(d, 'S', 'S');
  C.beginTurn(d); eq(C.useActive(d, 'coin_of_fools').ok, false, 'only 3 charges');
});
T('broken_pattern', () => {
  let d = mk(['broken_pattern']);
  let res = turn(d, 'S', 'F', { pred: { S: 0.1, G: 0.6, F: 0.3 } });
  eq(res.dmgR, 5, 'rated 10%: +2'); ok(boonFired(res, 'broken_pattern'), 'event');
  res = turn(d, 'S', 'F', { pred: { S: 0.25, G: 0.45, F: 0.3 } });
  eq(res.dmgR, 3, 'rated 25%: nothing');
  eq(turn(d, 'S', 'F').dmgR, 3, 'no pred: nothing');
  res = turn(d, 'S', 'G', { pred: { S: 0.1, G: 0.6, F: 0.3 } });
  eq(res.dmgP, 2, 'only on wins');
});
T('ash_of_forgetting', () => {
  let run = restRun(['ash_of_forgetting'], 6);
  ok(run.offer.events.some(e => e.t === 'forget' && e.n === 0.5), 'forget event at the bonfire');
  run = restRun([], 6);
  ok(!run.offer.events.some(e => e.t === 'forget'), 'no forget without it');
});
T('last_candle', () => {
  let d = mk(['last_candle'], [], { pHp: 2 });
  let res = turn(d, 'F', 'S');
  eq(d.p.hp, 1, 'survives at 1'); eq(d.over, null, 'not over'); eq(d.p.status.fortify, 2, 'fortify 2');
  ok(hasEv(res, 'saved', undefined, 'p') && boonFired(res, 'last_candle'), 'events');
  turn(d, 'F', 'S');                               // 3 - 2 fortify = 1 -> dead
  eq(d.over, 'r', 'only once');
  d = mk(['last_candle'], [], { pHp: 1 });
  d.p.status.bleed = 1; C.beginTurn(d);
  eq(d.over, null, 'also saves from a bleed tick');
  d = mk([], [], { pHp: 2 });
  turn(d, 'F', 'S'); eq(d.over, 'r', 'without it: dead');
  const meta = allMeta(), run = RUN.create(meta, { seed: 3, now: 1 });
  run.pBoons = ['last_candle'];
  let dd = RUN.startDuel(run); dd.p.hp = 1; C.beginTurn(dd);
  RUN.record(run, meta, C.resolve(dd, 'F', 'S'), null);
  eq(dd.over, null, 'run: saved');
  dd.over = 'p'; RUN.endDuel(run, meta, 'p', null); RUN.pick(run, run.offer.choices[0]);
  dd = RUN.startDuel(run); dd.p.hp = 1; C.beginTurn(dd); C.resolve(dd, 'F', 'S');
  eq(dd.over, 'r', 'run: spent for the rest of the run');
});
T('ember_hoard', () => {
  eq(restRun(['ember_hoard'], 12).offer.healed, RUN.HEAL + 1, 'heal +1 (12 of 26 HP is not low)');
  eq(restRun(['ember_hoard'], 3).offer.healed, Math.min(RUN.HEAL + 3, RUN.PLAYER_MAX_HP - 3), 'heal +3 at low HP (capped at max HP)');
  eq(restRun(['ember_hoard'], 1).offer.healed, RUN.HEAL + 3, 'heal +3 at low HP, uncapped from 1 HP');
  eq(restRun([], 3).offer.healed, RUN.HEAL, 'base heal without it');
  eq(restRun([], RUN.PLAYER_MAX_HP - 2).offer.healed, 2, 'heal capped at max HP');
});
T('relic_ashen_flask', () => {
  const run = restRun(['relic_ashen_flask'], 2);
  eq(run.offer.healed, RUN.HEAL + 2, 'heal +2'); eq(run.pHp, 2 + RUN.HEAL + 2, 'hp');
  eq(restRun([], 2).offer.healed, RUN.HEAL, 'base heal without it');
});
T('relic_dented_buckler', () => {
  let d = mk(['relic_dented_buckler']);
  eq(d.p.status.fortify, 1, 'fortify 1 at start');
  eq(turn(d, 'G', 'S').dmgR, 3, 'first riposte +1');
  eq(turn(d, 'G', 'S').dmgR, 2, 'second riposte normal');
  d = mk(['relic_dented_buckler']);
  eq(turn(d, 'S', 'F').dmgR, 3, 'Strike: no bonus');
  eq(turn(d, 'G', 'S').dmgR, 3, 'bonus still waiting for the first riposte');
});
T('relic_rusty_nail', () => {
  let d = mk(['relic_rusty_nail']);
  turn(d, 'S', 'G'); eq(d.r.status.bleed, 0, 'a loss does not trigger');
  let res = turn(d, 'S', 'F');
  eq(d.r.status.bleed, 2, 'first win: bleed 2'); ok(boonFired(res, 'relic_rusty_nail'), 'event');
  d.r.status.bleed = 0;
  res = turn(d, 'S', 'F');
  eq(d.r.status.bleed, 0, 'second win: nothing'); ok(!boonFired(res, 'relic_rusty_nail'), 'no event');
});
T('relic_cracked_mirror', () => {
  let d = mk(['relic_cracked_mirror']);
  let res = turn(d, 'S', 'S');
  eq(d.tension, 2, 'first clash: 2 pips'); eq(d.p.status.fortify, 1, 'fortify 1'); ok(boonFired(res, 'relic_cracked_mirror'), 'event');
  res = turn(d, 'G', 'G');
  eq(d.tension, 3, 'second clash: 1 pip'); eq(d.p.status.fortify, 1, 'no second fortify'); ok(!boonFired(res, 'relic_cracked_mirror'), 'no event');
});
T('relic_dealers_thumb', () => {
  eq(restRun(['relic_dealers_thumb'], 6).offer.choices.length, 4, '4 choices');
  eq(restRun([], 6).offer.choices.length, 3, '3 without it');
});
T('relic_liars_coin', () => {
  let d = mk(['relic_liars_coin']);
  eq(C.info(d).coinTurn1, true, 'turn 1: stamped');
  ok(hasEv(C.beginTurn(d), 'info', 'relic_liars_coin'), 'turn 1 info event');
  C.resolve(d, 'S', 'S');
  eq(C.info(d).coinTurn1, false, 'turn 2: not stamped');
  ok(!hasEv(C.beginTurn(d), 'info', 'relic_liars_coin'), 'no event on turn 2');
  d = mk();
  eq(C.info(d).coinTurn1, false, 'off without it');
});

(function () {
  let pass = 0, line = '';
  const missing = [];
  B.list.forEach(b => {
    const fn = boonTests[b.id];
    if (!fn) { missing.push(b.id); fails++; failLog.push('no test for ' + b.id); return; }
    const before = fails, nBefore = passes;
    try { fn(); } catch (e) { fails++; failLog.push(b.id + ' threw ' + e.message); console.log('    FAIL: ' + b.id + ' threw: ' + e.stack); }
    const good = fails === before && passes > nBefore;
    if (good) pass++;
    line += '  ' + pad(b.id, 22) + (good ? 'PASS' : 'FAIL') + ' (' + lpad(passes - nBefore, 2) + ')';
    if ((B.list.indexOf(b) + 1) % 3 === 0) { console.log(line); line = ''; }
  });
  if (line) console.log(line);
  if (missing.length) console.log('  MISSING TESTS: ' + missing.join(', '));
  console.log('  checklist: ' + pass + '/' + B.list.length + ' PASS');
})();

// ================================================================== 3. payoff == resolve
section('3. payoff(duel) vs resolve on 300 random mid-duel states');
(function () {
  const rng = R.RNG.create(20261113);
  const pPool = B.list.filter(b => !b.relic && b.who !== 'rival').map(b => b.id);
  const rPool = B.list.filter(b => !b.relic && b.who !== 'player').map(b => b.id);
  const relics = B.list.filter(b => b.relic).map(b => b.id);
  let states = 0, cells = 0, bad = 0, mutated = 0, tries = 0, withIllegal = 0, phase2 = 0;
  function sub(pool, n) { return rng.shuffle(pool.slice()).slice(0, n); }
  while (states < 300 && tries < 5000) {
    tries++;
    const pB = sub(pPool, rng.int(8)), rB = sub(rPool.filter(x => pB.indexOf(x) < 0), rng.int(7));
    if (rng.chance(0.5)) pB.unshift(rng.pick(relics));
    const n = 1 + rng.int(7), ph = n === 7 && rng.chance(0.5) ? 2 : 1;
    const pMax = 12, rMax = 6 + rng.int(6);
    const d = mk(pB, rB, { n: n, phase: ph, pMax: pMax, pHp: 3 + rng.int(10), rMax: rMax, rHp: 2 + rng.int(rMax - 1) });
    const k = rng.int(9);
    for (let t = 0; t < k && !d.over; t++) {
      C.beginTurn(d);
      if (d.over) break;
      const lp = C.legal(d, 'p'), lr = C.legal(d, 'r');
      d.intel.honest = rng.chance(0.6); d.intel.pred = simplex(rng, lp);
      if (ph === 2 && rng.chance(0.4)) d.intel.called = rng.pick(lp);
      if (d.p.charges.coin_of_fools > 0 && rng.chance(0.3)) C.useActive(d, 'coin_of_fools');
      C.resolve(d, rng.pick(lp), rng.pick(lr));
    }
    if (d.over) continue;
    C.beginTurn(d);
    if (d.over) continue;
    // the state the brain would see, with random intel written by the "scene"
    if (rng.chance(0.7)) d.intel.honest = rng.chance(0.5);
    if (rng.chance(0.7)) d.intel.pred = simplex(rng, C.legal(d, 'p'));
    if (ph === 2 && rng.chance(0.5)) d.intel.called = rng.pick(C.legal(d, 'p'));
    if (rng.chance(0.2)) d.intel.coin = true;
    const snap = JSON.stringify(d);
    const pay = C.payoff(d);
    if (JSON.stringify(d) !== snap) mutated++;
    states++;
    if (ph === 2) phase2++;
    if (C.legal(d, 'p').length < 3 || C.legal(d, 'r').length < 3) withIllegal++;
    MOVES.forEach(rm => MOVES.forEach(pm => {
      const c = JSON.parse(snap);
      const gbP = Math.max(0, c.p.status.guardBroken - 1), gbR = Math.max(0, c.r.status.guardBroken - 1);
      const hpP = c.p.hp, hpR = c.r.hp;
      const res = C.resolve(c, pm, rm, { unchecked: true });
      let v = res.dmgP - res.dmgR + res.healR - res.healP
        + 0.86 * Math.max(0, c.p.status.guardBroken - gbP) - 0.86 * Math.max(0, c.r.status.guardBroken - gbR);
      if (c.over === 'r') v += 8;
      if (c.over === 'p') v -= 8;
      cells++;
      const savedP = res.events.some(e => e.t === 'saved' && e.side === 'p'), savedR = res.events.some(e => e.t === 'saved' && e.side === 'r');
      const consistent = (c.over === 'r' || savedP || hpP - c.p.hp === res.dmgP - res.healP) && (c.over === 'p' || savedR || hpR - c.r.hp === res.dmgR - res.healR);
      if (!(Math.abs(v - pay[rm][pm]) < 1e-9) || !consistent || res.pm !== pm || res.rm !== rm) {
        bad++;
        if (bad <= 5) console.log('    mismatch pm=' + pm + ' rm=' + rm + ' payoff=' + pay[rm][pm] + ' resolve=' + v + ' boons P[' + pB + '] R[' + rB + ']');
      }
    }));
  }
  eq(states, 300, 'generated 300 states');
  eq(bad, 0, 'payoff cells that differ from resolve');
  eq(mutated, 0, 'payoff calls that mutated the duel');
  console.log('  ' + states + ' states (' + phase2 + ' in phase 2, ' + withIllegal + ' with an illegal move on some side), ' + cells + ' cells: ' + bad + ' mismatches, ' + mutated + ' mutations');

  // timing on a heavy late state
  const d = mk(pPool.slice(0, 7), rPool.filter(x => pPool.slice(0, 7).indexOf(x) < 0).slice(0, 6), { pMax: 200, rMax: 200 });
  for (let t = 0; t < 30; t++) { C.beginTurn(d); C.resolve(d, rng.pick(C.legal(d, 'p')), rng.pick(C.legal(d, 'r'))); }
  for (let i = 0; i < 300; i++) C.payoff(d);
  const N = 3000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) C.payoff(d);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  ok(ms < 0.5, 'payoff under 0.5 ms (' + ms.toFixed(4) + ')');
  console.log('  payoff() mean time, turn-31 duel with 7 + 6 boons: ' + ms.toFixed(4) + ' ms');
})();

// ================================================================== run driver (used by 4 and 5)
// Plays one full run exactly as the game would call the API. `S` holds { run, meta } so that the
// JSON round-trip mode can replace both objects at any point.
function playRun(S, seed, o) {
  o = o || {};
  const rng = R.RNG.create((seed * 2654435761 + 17) >>> 0);
  const hop = () => { if (o.roundTrip) { S.run = rt(S.run); S.meta = rt(S.meta); } };
  const info = { duels: [], picks: [], rivalPicks: [], maxTurns: 0, minLegal: 3, err: null, won: false, phase2: false };
  const owned = RUN.relics(S.meta).map(b => b.id);
  const relicId = o.relic === false || !owned.length || rng.chance(0.25) ? null : rng.pick(owned);
  S.run = RUN.create(S.meta, { seed: seed, relicId: relicId, now: o.now || 1000 });
  info.relic = S.run.relicId;
  hop();

  function bad(msg) { if (!info.err) info.err = msg + ' (seed ' + seed + ', duel ' + S.run.duelN + '.' + S.run.phase + ')'; }
  function check(d) {
    const fs = [d.p, d.r];
    for (let i = 0; i < 2; i++) {
      const f = fs[i], st = f.status;
      const nums = [f.hp, f.maxHp, st.guardBroken, st.bleed, st.fortify, st.focus, st.sealed.S, st.sealed.G, st.sealed.F, d.tension, d.turn];
      for (let j = 0; j < nums.length; j++) if (typeof nums[j] !== 'number' || nums[j] !== nums[j]) bad('NaN in state');
      if (f.hp > f.maxHp) bad('hp above max');
      if (f.hp < 0) bad('hp below 0');
      if (st.fortify > 3 || st.focus > 3) bad('status above cap');
    }
    if (d.tension < (d.phase === 2 ? 1 : 0) || d.tension > 3) bad('tension out of range');
  }

  function fight() {
    let turns = 0;
    for (;;) {
      let d = S.run.duel;
      C.beginTurn(d);
      check(d);
      if (d.over) break;
      const lp = C.legal(d, 'p'), lr = C.legal(d, 'r');
      info.minLegal = Math.min(info.minLegal, lp.length, lr.length);
      if (lp.length < 2 || lr.length < 2) bad('fewer than 2 legal moves');
      if (o.onLegal) o.onLegal(d, lp, lr);
      if (d.phase === 2 && d.turn % 3 === 2) d.intel.called = rng.pick(lp);     // Called Shot turns 2, 5, 8...
      C.ctx(d);
      const pay = C.payoff(d);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const v = pay[MOVES[a]][MOVES[b]];
        if (typeof v !== 'number' || v !== v || !isFinite(v)) bad('payoff not finite');
      }
      // stand-in for brain.commit (no brain in this sim)
      const sealed = { move: rng.pick(lr), tell: null, honest: rng.chance(0.6), pred: simplex(rng, lp) };
      S.run.pending = { sealed: sealed };
      hop(); d = S.run.duel;
      // the player: uniform random, taps actives at random
      for (const id in d.p.charges) if (d.p.charges[id] > 0 && rng.chance(0.3)) C.useActive(d, id);
      const pm = rng.pick(lp);
      d.intel.honest = sealed.honest; d.intel.pred = sealed.pred;
      const hpP = d.p.hp;
      const res = C.resolve(d, pm, S.run.pending.sealed.move);
      if (res.pm !== pm) bad('legal move was replaced');
      RUN.record(S.run, S.meta, res, sealed);
      if (o.onTurn) o.onTurn(d, res, hpP);
      check(d);
      turns++;
      if (turns > 60) { bad('duel over 60 turns'); break; }
      hop(); d = S.run.duel;
      if (d.over) break;
    }
    info.maxTurns = Math.max(info.maxTurns, turns);
    if (o.onDuelEnd) o.onDuelEnd(S.run.duel);
    return turns;
  }

  try {
    for (;;) {
      RUN.startDuel(S.run);
      hop();
      let turns = fight();
      let winner = S.run.duel.over;
      const n = S.run.duelN;
      info.duels.push({ n: n, phase: 1, won: winner === 'p', turns: turns });
      if (n === 7 && winner === 'p') {
        if (seed % 2 === 0) RUN.endDuel(S.run, S.meta, 'p', null);         // both call orders are legal
        if (S.run.stage !== 'duel') bad('stage after phase 1 should stay duel');
        RUN.startPhase2(S.run);
        hop();
        info.phase2 = true;
        turns = fight();
        winner = S.run.duel.over;
        info.duels.push({ n: 8, phase: 2, won: winner === 'p', turns: turns });
      }
      RUN.endDuel(S.run, S.meta, winner, null);
      hop();
      if (S.run.stage === 'bonfire') {
        const of = S.run.offer;
        if (!of || of.choices.length < 3) bad('offer has fewer than 3 choices');
        if (of.rivalPick) info.rivalPicks.push(of.rivalPick); else bad('rival did not draft');
        const all = S.run.pBoons.concat(S.run.rBoons);
        of.choices.forEach(c => { if (all.indexOf(c) >= 0) bad('offer contains an owned boon'); });
        if (of.choices.filter(c => B.byId[c].active).length > 1) bad('two actives in one offer');
        if (new Set(of.choices).size !== of.choices.length) bad('duplicate in offer');
        if (S.run.pHp > S.run.pMaxHp) bad('hp above max after rest');
        const choice = rng.pick(of.choices);
        info.picks.push({ id: choice, bonfire: n });
        if (!RUN.pick(S.run, choice)) bad('pick refused');
        hop();
        continue;
      }
      break;
    }
    if (S.run.stage !== 'won' && S.run.stage !== 'dead') bad('run ended in stage ' + S.run.stage);
    S.run.stats.score = o.score !== undefined ? o.score : rng.int(20);       // stand-in for brain.runScore()
    info.fin = RUN.finish(S.run, S.meta, (o.now || 1000) + 60000);
    info.won = S.run.stage === 'won';
    info.reached = S.run.duelN;
    hop();
  } catch (e) {
    info.err = 'EXCEPTION ' + e.stack + ' (seed ' + seed + ')';
  }
  return info;
}

// ================================================================== 4. JSON round trip
section('4. JSON round-trip of run / duel / meta mid-fight');
(function () {
  let same = 0, n = 40, turns = 0;
  for (let i = 0; i < n; i++) {
    const A = { run: null, meta: allMeta() }, Bs = { run: null, meta: allMeta() };
    const a = playRun(A, 5000 + i, {}), b = playRun(Bs, 5000 + i, { roundTrip: true });
    ok(!a.err && !b.err, 'round-trip run error: ' + (a.err || b.err));
    if (JSON.stringify(A.run) === JSON.stringify(Bs.run) && JSON.stringify(A.meta) === JSON.stringify(Bs.meta)) same++;
    turns += A.run.stats.turns;
  }
  eq(same, n, 'runs identical with a JSON round-trip after every API call');
  console.log('  ' + n + ' full runs (' + turns + ' turns) replayed with run+meta serialized after every call: ' + same + '/' + n + ' byte-identical');

  // a duel alone, serialized between beginTurn and resolve
  const rng = R.RNG.create(77);
  let d1 = mk(['serrated_edge', 'long_con', 'mirror_etiquette', 'last_candle'], ['no_encores', 'sealing_wax', 'spare_mask', 'resonance'], { n: 3, pMax: 12, rMax: 14 });
  let d2 = rt(d1), okAll = true;
  for (let t = 0; t < 40 && !d1.over; t++) {
    const e1 = C.beginTurn(d1); d2 = rt(d2); const e2 = C.beginTurn(d2);
    if (JSON.stringify(e1) !== JSON.stringify(e2)) okAll = false;
    if (d1.over) break;
    const pm = rng.pick(C.legal(d1, 'p')), rm = rng.pick(C.legal(d1, 'r'));
    d2 = rt(d2);
    const r1 = C.resolve(d1, pm, rm), r2 = C.resolve(d2, pm, rm);
    if (JSON.stringify(r1) !== JSON.stringify(r2) || JSON.stringify(d1) !== JSON.stringify(d2)) okAll = false;
  }
  ok(okAll, 'duel continues identically after JSON round-trips');
  // offers are reproducible from the seed
  const m1 = allMeta(), m2 = allMeta();
  const r1 = restRun(['thorned_guard'], 6, m1, 4242), r2 = restRun(['thorned_guard'], 6, m2, 4242), r3 = restRun(['thorned_guard'], 6, allMeta(), 4243);
  eq(JSON.stringify(r1.offer), JSON.stringify(r2.offer), 'same seed -> same offer');
  console.log('  same seed -> same offer: ' + JSON.stringify(r1.offer.choices) + ' rival ' + r1.offer.rivalPick + ' | other seed: ' + JSON.stringify(r3.offer.choices) + ' rival ' + r3.offer.rivalPick);
})();

// ================================================================== 4b. run / meta / draft unit checks
section('4b. Run, draft, memory and unlock checks');
(function () {
  // meta repair
  const broken = { unlocked: null, memory: { runs: 3 } };
  RUN.create(broken, { seed: 1, now: 5 });
  ok(broken.counters && broken.counters.drafts === 0 && broken.memory.runs === 4 && Array.isArray(broken.memory.favorites), 'meta repaired in place');
  eq(RUN.relics(RUN.defaultMeta()).length, 0, 'no relics on a fresh meta');
  eq(RUN.pool(RUN.defaultMeta(), 'p').length, 17, 'fresh player pool = 17');
  eq(RUN.pool(RUN.defaultMeta(), 'r').length, 16, 'fresh rival pool = 16');
  eq(RUN.pool(allMeta(), 'p').length, 30, 'full player pool = 30');
  eq(RUN.pool(allMeta(), 'r').length, 27, 'full rival pool = 27');
  eq(RUN.create(RUN.defaultMeta(), { seed: 1, relicId: 'relic_ashen_flask', now: 1 }).relicId, null, 'locked relic refused');

  // offer rules over many bonfires
  let offers = 0, tagOk = 0, tagApplicable = 0, rare = [0, 0, 0, 0, 0, 0, 0], tot = [0, 0, 0, 0, 0, 0, 0];
  const meta = allMeta();
  for (let s = 0; s < 400; s++) {
    const S = { run: null, meta: meta };
    const rng = R.RNG.create(s + 1);
    S.run = RUN.create(meta, { seed: 900 + s, now: 1 });
    for (let b = 1; b <= 6; b++) {
      const d = RUN.startDuel(S.run); d.over = 'p';
      const before = S.run.pBoons.slice();
      RUN.endDuel(S.run, meta, 'p', null);
      const of = S.run.offer;
      offers++;
      of.choices.forEach(c => { tot[b]++; if (B.byId[c].rarity === 'rare') rare[b]++; });
      if (b >= 2 && before.length) {
        const own = {};
        before.forEach(id => B.byId[id].tags.forEach(t => { own[t] = 1; }));
        tagApplicable++;
        if (of.choices.some(c => B.byId[c].tags.some(t => own[t]))) tagOk++;
      }
      ok(B.byId[of.rivalPick].who !== 'player', 'rival drafted a legal boon');
      ok(!(b === 6 && of.rivalPick === 'spare_mask'), 'no spare_mask at bonfire 6');
      RUN.pick(S.run, rng.pick(of.choices));
    }
    eq(S.run.rBoons.length, 6, 'rival has 6 boons entering duel 7');
    eq(new Set(S.run.pBoons.concat(S.run.rBoons)).size, 12, 'boons unique across both fighters');
  }
  ok(tagOk === tagApplicable, 'tag guarantee from bonfire 2 (' + tagOk + '/' + tagApplicable + ')');
  console.log('  ' + offers + ' offers: tag guarantee ' + tagOk + '/' + tagApplicable + '; rare share by bonfire 1..6: ' + [1, 2, 3, 4, 5, 6].map(b => pct(rare[b], tot[b])).join(' '));

  // counter-draft: a Guard-heavy run makes turtle_cracker far more likely and sets rivalWhy
  function counterRate(dossier, moves, target, mutate) {
    let hit = 0, why = {}, n = 600;
    for (let s = 0; s < n; s++) {
      const m = allMeta(), run = RUN.create(m, { seed: 31000 + s, now: 1 });
      run.stats.moves = moves; run.stats.turns = moves.S + moves.G + moves.F;
      if (mutate) mutate(run);
      const d = RUN.startDuel(run); d.over = 'p';
      RUN.endDuel(run, m, 'p', dossier);
      if (target.indexOf(run.offer.rivalPick) >= 0) { hit++; why[run.offer.rivalWhy] = (why[run.offer.rivalWhy] || 0) + 1; }
      else if (run.offer.rivalWhy && !mutate) ok(['G', 'S', 'F', 'repeat', 'predictable', 'trust', 'tags'].indexOf(run.offer.rivalWhy) >= 0, 'rivalWhy in enum');
    }
    return { rate: hit / n, why: why };
  }
  const base = counterRate(null, { S: 4, G: 2, F: 4 }, ['turtle_cracker', 'long_con']);
  const guard = counterRate(null, { S: 2, G: 6, F: 2 }, ['turtle_cracker', 'long_con']);
  ok(guard.rate > base.rate * 1.5, 'Guard-heavy play raises turtle_cracker/long_con picks');
  ok(guard.why.G > 0, 'rivalWhy = G when the counter decided it');
  console.log('  Rival picks turtle_cracker/long_con: ' + pct(base.rate, 1) + ' vs a balanced player, ' + pct(guard.rate, 1) + ' vs 60% Guard (rivalWhy ' + JSON.stringify(guard.why) + ')');
  const dos = { samples: 80, predictability: 70, favorite: null, tell: { counter: 0.7, mirror: 0.2, under: 0.1, n: 40 }, stats: [{ id: 'repeat', kind: 'habit', move: null, pct: 55, n: 40, strength: 0.4, vars: {} }, { id: 'tell_trust', kind: 'tell', move: null, pct: 70, n: 40, strength: 0.5, vars: {} }], broken: null };
  const rep0 = counterRate(null, { S: 3, G: 3, F: 4 }, ['no_encores', 'sealing_wax', 'hungry_mask', 'painted_smile']);
  const rep1 = counterRate(dos, { S: 3, G: 3, F: 4 }, ['no_encores', 'sealing_wax', 'hungry_mask', 'painted_smile']);
  ok(rep1.rate > rep0.rate * 1.3, 'dossier evidence raises punisher picks');
  ok(rep1.why.repeat > 0 && rep1.why.predictable > 0 && rep1.why.trust > 0, 'rivalWhy repeat / predictable / trust');
  console.log('  Rival picks a punisher (no_encores, sealing_wax, hungry_mask, painted_smile): ' + pct(rep0.rate, 1) + ' with no dossier, ' + pct(rep1.rate, 1) + ' with repeat 55% / predictability 70 / trust 70% (rivalWhy ' + JSON.stringify(rep1.why) + ')');
  const tags = counterRate(null, { S: 3, G: 3, F: 4 }, ['ash_veil'], run => { run.pBoons = ['resonance', 'mirror_etiquette']; });
  ok(tags.why.tags > 0, 'rivalWhy = tags');

  // memory + unlocks through a scripted death and a scripted win
  const m = RUN.defaultMeta();
  let run = RUN.create(m, { seed: 1, now: 1000 });
  let d = RUN.startDuel(run);
  C.beginTurn(d); RUN.record(run, m, C.resolve(d, 'F', 'S'), { pred: { S: 0.1, G: 0.2, F: 0.7 }, honest: true });
  eq(run.stats.reads, 1, 'read counted'); eq(m.counters.reads, 1, 'lifetime read counted');
  d.p.hp = 1; d.r.hp = 3;
  C.beginTurn(d); RUN.record(run, m, C.resolve(d, 'F', 'S'), { pred: { S: 0.3, G: 0.3, F: 0.4 }, honest: false });
  eq(run.stats.liesWorked, 1, 'lie worked counted');
  RUN.endDuel(run, m, 'r', null);
  eq(run.stage, 'dead', 'stage dead');
  let fin = RUN.finish(run, m, 2000);
  eq(m.memory.deaths, 1, 'deaths'); eq(m.memory.streakL, 1, 'streakL'); eq(m.memory.lastFavorite, 'F', 'lastFavorite');
  eq(JSON.stringify(m.memory.closestLoss), '{"duel":1,"rivalHp":3}', 'closestLoss');
  eq(JSON.stringify(m.memory.fastestDeath), '{"duel":1,"turns":2}', 'fastestDeath');
  eq(m.memory.totalTurns, 2, 'totalTurns'); eq(m.memory.lastPlayed, 2000, 'lastPlayed');
  ok(fin.unlocks.length === 1 && fin.unlocks[0].id === 'first_death' && !fin.firstWin, 'first_death unlocked');
  eq(RUN.finish(run, m, 3000).unlocks.length, 1, 'finish is idempotent');
  eq(m.memory.deaths, 1, 'no double count');
  run = RUN.create(m, { seed: 2, now: 2000 + 3 * 86.4e6 });
  eq(run.daysAway, 3, 'daysAway'); eq(m.memory.runs, 2, 'runs');
  d = RUN.startDuel(run); d.over = 'r'; RUN.endDuel(run, m, 'r', null);
  fin = RUN.finish(run, m, 9e9);
  ok(fin.unlocks.some(u => u.id === 'die_duel1'), 'die_duel1 on run 2');
  // scripted win
  run = RUN.create(m, { seed: 3, now: 9e9 });
  for (let n = 1; n <= 7; n++) {
    d = RUN.startDuel(run);
    eq(d.r.boons.length, n - 1, 'rival boons in duel ' + n);
    eq(d.r.maxHp, RUN.DUELS[n].rivalHp, 'rival HP duel ' + n);
    for (let t = 0; t < 5; t++) { C.beginTurn(d); RUN.record(run, m, C.resolve(d, 'F', 'F'), { pred: { S: 0.3, G: 0.3, F: 0.4 }, honest: false }); }
    d.tension = 3; d.r.hp = 1; d.r.boons = []; d.r.status.fortify = 0; d.r.status.sealed.F = 0; d.p.status.sealed.S = 0;
    C.beginTurn(d); const res = C.resolve(d, 'S', 'F', { unchecked: true });
    RUN.record(run, m, res, { pred: { S: 0.1, G: 0.5, F: 0.4 }, honest: false });
    eq(d.over, 'p', 'scripted duel ' + n + ' won');
    RUN.endDuel(run, m, 'p', null);
    if (n < 7) { eq(run.stage, 'bonfire', 'bonfire after duel ' + n); RUN.pick(run, run.offer.choices[0], m); }
  }
  eq(run.stage, 'duel', 'duel 7 phase 1 won: waiting for startPhase2');
  run.duel.p.hp = 5; run.duel.p.status.bleed = 2; run.duel.p.status.guardBroken = 1;
  d = RUN.startPhase2(run);
  ok(d.phase === 2 && d.tension === 1 && d.r.hp === RUN.DUELS.phase2.rivalHp, 'phase 2 duel');
  eq(d.p.hp, Math.min(RUN.PLAYER_MAX_HP, 5 + RUN.PHASE2_HEAL), 'phase 2 heal (capped at max HP)'); ok(d.p.status.bleed === 0 && d.p.status.guardBroken === 0, 'statuses cleared');
  eq(d.r.boons.length, 6, 'rival keeps its boons');
  d.r.hp = 1; d.r.boons = []; C.beginTurn(d);
  RUN.record(run, m, C.resolve(d, 'G', 'S'), null);
  RUN.endDuel(run, m, 'p', null);
  eq(run.stage, 'won', 'stage won');
  run.stats.score = 30;
  fin = RUN.finish(run, m, 9e9 + 5);
  ok(fin.firstWin, 'firstWin');
  eq(m.memory.wins, 1, 'wins'); eq(m.memory.bestDuel, 8, 'bestDuel 8'); eq(m.memory.streakW, 1, 'streakW'); eq(m.memory.streakL, 0, 'streakL reset');
  eq(JSON.stringify(m.memory.lastWin), JSON.stringify({ move: 'G', hp: run.pHp, run: 3, ts: 9e9 + 5 }), 'lastWin');
  eq(m.counters.drafts, 6, 'drafts counted'); eq(m.counters.deathblows, 7, 'deathblows counted'); eq(m.counters.liesCaught, 7, 'lies caught counted');
  const got = fin.unlocks.map(u => u.ref).sort().join(',');
  ['headsman', 'spare_mask', 'iron_oath', 'ash_veil', 'deathblow_creed', 'stolen_ledger', 'relic_dented_buckler', 'relic_cracked_mirror', 'long_con', 'debt_collector', 'broken_pattern', 'ash_of_forgetting', 'blank'].forEach(ref => ok(got.indexOf(ref) >= 0, 'win unlocked ' + ref));
  console.log('  scripted death + win: memory fields, counters and ' + fin.unlocks.length + ' unlock items on the winning run verified');
  console.log('  memory after 3 runs: ' + JSON.stringify(m.memory));
})();

// ================================================================== 4c. the Vigil (stakes)
section('4c. The Vigil: each light adds exactly its rule');
{
  const mk = (stake, seed, max) => {
    const meta = allMeta(); meta.vigil.max = max === undefined ? 7 : max; meta.vigil.sel = stake;
    return { meta, run: RUN.create(meta, { seed: seed || 77, now: 1.7e12, stake }) };
  };
  eq(RUN.VIGIL.length, 7, 'seven lights');
  eq(new Set(RUN.VIGIL.map(v => v.id)).size, 7, 'light ids are unique');
  eq(RUN.repairMeta({}).vigil.max, 0, 'repairMeta adds the Vigil to an old save');
  eq(RUN.repairMeta({ vigil: { max: 99, sel: 99, wins: 'x' } }).vigil.sel, 7, 'a hand-edited Vigil is clamped');
  eq(mk(5, 1, 2).run.stake, 2, 'a run cannot have more lights out than were earned');
  eq(RUN.create(allMeta(), { seed: 1, now: 1, stake: 5, anyStake: true }).stake, 5, 'anyStake (the sim) bypasses the earned limit');
  const D = RUN.DUELS;
  for (let s = 0; s <= 7; s++) {
    const { run } = mk(s);
    eq(RUN.stakeOf(run), s, 'stake ' + s + ' stored on the run');
    eq(RUN.lightsOut(run).length, s, 'lightsOut lists ' + s);
    for (let n = 1; n <= 7; n++) {
      const c = RUN.cfg(run, { n, phase: 1 });
      const wantEx = s >= 1 ? (n < 7 ? D[n + 1].exploit : D.phase2.exploit) : D[n].exploit;
      const wantHo = s >= 3 ? (n < 7 ? D[n + 1].honesty : (D[7].honesty + D.phase2.honesty) / 2) : D[n].honesty;
      eq(c.exploit, wantEx, 'stake ' + s + ' duel ' + n + ' exploit');
      ok(Math.abs(c.honesty - wantHo) < 1e-9, 'stake ' + s + ' duel ' + n + ' honesty (got ' + c.honesty + ', want ' + wantHo + ')');
      eq(c.rivalHp, D[n].rivalHp + (s >= 6 ? 1 : 0), 'stake ' + s + ' duel ' + n + ' rival hp');
      ok(c.exploit >= D[n].exploit && c.honesty <= D[n].honesty, 'a light never makes the Rival gentler');
    }
    const p2 = RUN.cfg(run, { n: 7, phase: 2 });
    eq(p2.exploit, D.phase2.exploit, 'stake ' + s + ' phase-2 exploit unchanged');
    eq(p2.honesty, D.phase2.honesty, 'stake ' + s + ' phase-2 honesty unchanged');
    eq(p2.rivalHp, D.phase2.rivalHp + (s >= 6 ? 1 : 0), 'stake ' + s + ' phase-2 rival hp');
    eq(RUN.healOf(run), RUN.HEAL - (s >= 2 ? 2 : 0), 'stake ' + s + ' bonfire heal');
    eq(run.rBoons.length, s >= 4 ? 1 : 0, 'stake ' + s + ' head-start boon');
    eq(run.rivalHead, s >= 4 ? run.rBoons[0] : null, 'stake ' + s + ' rivalHead recorded');
    if (s >= 4) ok(B.byId[run.rBoons[0]] && B.byId[run.rBoons[0]].who !== 'player' && !B.byId[run.rBoons[0]].relic, 'the head-start boon is one the Rival may draft');
    // duel 1: health, Called Shot flag; then a bonfire heals by the stake's amount
    const d1 = RUN.startDuel(run);
    eq(d1.r.hp, D[1].rivalHp + (s >= 6 ? 1 : 0), 'stake ' + s + ' duel-1 rival hp');
    eq(!!d1.calls, s >= 7, 'stake ' + s + ' Called Shot allowed in duel 1');
    eq(d1.tension, 0, 'no Embers before phase 2 at stake ' + s);
    run.duel.p.hp = 10; run.duel.over = 'p';
    const off = RUN.endDuel(run, mk(s).meta, 'p', null);
    eq(off.healed, RUN.HEAL - (s >= 2 ? 2 : 0), 'stake ' + s + ' healed at the first fire');
    eq(off.choices.length, 3, 'stake ' + s + ' still offers three boons');
    eq(run.rBoons.length, (s >= 4 ? 1 : 0) + 1, 'stake ' + s + ' Rival boons after the first fire');
    eq(new Set(run.pBoons.concat(run.rBoons, off.choices)).size, run.pBoons.length + run.rBoons.length + off.choices.length, 'stake ' + s + ' no boon offered or owned twice');
    // phase 2: the heal goes at light 5
    const r2 = mk(s).run; r2.duelN = 7; RUN.startDuel(r2); r2.duel.p.hp = 9; r2.pHp = 9;
    const d2 = RUN.startPhase2(r2);
    eq(d2.p.hp, 9 + (s >= 5 ? 0 : RUN.PHASE2_HEAL), 'stake ' + s + ' hp after the transformation');
    eq(d2.r.hp, D.phase2.rivalHp + (s >= 6 ? 1 : 0), 'stake ' + s + ' Unmasked hp');
    ok(d2.calls && d2.embers && d2.tension === 1, 'phase 2 keeps Embers and Called Shot at stake ' + s);
    // a Called Shot only counts where it is allowed
    const r3 = mk(s).run; r3.duelN = 3; const d3 = RUN.startDuel(r3);
    d3.intel.called = 'S';
    const before = d3.p.hp, res = C.resolve(d3, 'S', 'G');
    eq(res.called || null, s >= 7 ? 'hit' : null, 'stake ' + s + ' Called Shot in duel 3');
    eq(before - d3.p.hp, 2 + (s >= 7 ? 2 : 0), 'stake ' + s + ' damage from a riposte on the called move');
  }
  // earning lights: a win with every earned light out earns the next; a win below the top does not
  const meta = allMeta();
  const win = (stake) => { const run = RUN.create(meta, { seed: 5, now: 1.7e12, stake }); run.stage = 'won'; run.duelN = 7; run.phase = 2; return RUN.finish(run, meta, 1.7e12); };
  eq(win(0).light, 1, 'the first win earns light 1');
  eq(meta.vigil.max, 1, 'max is 1 after the first win');
  eq(win(0).light, 0, 'a second win with nothing out earns nothing');
  eq(win(1).light, 2, 'a win with light 1 out earns light 2');
  for (let s = 2; s <= 6; s++) eq(win(s).light, s + 1, 'a win with ' + s + ' out earns light ' + (s + 1));
  eq(meta.vigil.max, 7, 'all seven earned');
  eq(win(7).light, 0, 'a lightless win earns no further light');
  eq(meta.vigil.wins.join(','), '2,1,1,1,1,1,1,1', 'wins are counted per stake');
  const lost = RUN.create(meta, { seed: 6, now: 1.7e12, stake: 3 }); lost.stage = 'dead';
  eq(RUN.finish(lost, meta, 1.7e12).light, 0, 'a death earns no light');
  const twice = RUN.create(meta, { seed: 7, now: 1.7e12, stake: 7 }); twice.stage = 'won'; twice.duelN = 7; twice.phase = 2;
  RUN.finish(twice, meta, 1.7e12); RUN.finish(twice, meta, 1.7e12);
  eq(meta.vigil.wins[7], 2, 'finish() twice counts the win once');
  // JSON round trip keeps the stake
  const rt = JSON.parse(JSON.stringify(mk(6).run));
  eq(RUN.stakeOf(rt), 6, 'stake survives a save');
  eq(RUN.stakeOf({}), 0, 'a run saved before the Vigil existed has nothing out');
}

// ================================================================== 5. smoke sim
section('5. Smoke sim: uniform-random player vs uniform-random Rival');
(function () {
  const RUNS = QUICK ? 600 : 3000;
  const meta = allMeta();
  const S = { run: null, meta: meta };
  let wins = 0, errs = 0, firstErr = null, sumReached = 0, minLegal = 3, maxTurns = 0, phase2 = 0, totTurns = 0, totDuels = 0;
  const duelPlayed = {}, duelWon = {}, duelTurns = {};
  const held = {}, pickAt = {}, reach = {}, rivalAt = {};
  let simDuels = 0, simBig = 0, simMaxHit = 0, bigThis = false;
  const onTurn = (d, res) => { if (res.winner === 'r') { simMaxHit = Math.max(simMaxHit, res.dmgP); if (res.dmgP >= 7) bigThis = true; } };
  const t0 = Date.now();
  for (let b = 0; b <= 6; b++) reach[b] = { n: 0, w: 0 };
  for (let i = 0; i < RUNS; i++) {
    const info = playRun(S, 100000 + i, { onTurn: onTurn, onDuelEnd: () => { simDuels++; if (bigThis) simBig++; bigThis = false; } });
    if (info.err) { errs++; if (!firstErr) firstErr = info.err; continue; }
    if (info.won) wins++;
    sumReached += info.reached;
    if (info.phase2) phase2++;
    minLegal = Math.min(minLegal, info.minLegal); maxTurns = Math.max(maxTurns, info.maxTurns);
    info.duels.forEach(du => {
      duelPlayed[du.n] = (duelPlayed[du.n] || 0) + 1; if (du.won) duelWon[du.n] = (duelWon[du.n] || 0) + 1;
      duelTurns[du.n] = (duelTurns[du.n] || 0) + du.turns; totTurns += du.turns; totDuels++;
    });
    const w = info.won ? 1 : 0;
    reach[0].n++; reach[0].w += w;
    if (info.relic) { const h = held[info.relic] = held[info.relic] || { n: 0, w: 0, adj: 0 }; h.n++; h.w += w; pickAt[info.relic] = pickAt[info.relic] || {}; const pa = pickAt[info.relic][0] = pickAt[info.relic][0] || { n: 0, w: 0 }; pa.n++; pa.w += w; }
    info.picks.forEach(pk => {
      const h = held[pk.id] = held[pk.id] || { n: 0, w: 0 }; h.n++; h.w += w;
      pickAt[pk.id] = pickAt[pk.id] || {}; const pa = pickAt[pk.id][pk.bonfire] = pickAt[pk.id][pk.bonfire] || { n: 0, w: 0 }; pa.n++; pa.w += w;
    });
    for (let b = 1; b <= info.picks.length; b++) { reach[b].n++; reach[b].w += w; }
    info.rivalPicks.forEach((id, k) => { rivalAt[id] = rivalAt[id] || {}; const pa = rivalAt[id][k + 1] = rivalAt[id][k + 1] || { n: 0, w: 0 }; pa.n++; pa.w += w; });
  }
  const done = RUNS - errs;
  eq(errs, 0, 'runs with an invariant violation or exception' + (firstErr ? ': ' + firstErr : ''));
  ok(minLegal >= 2, 'legal moves always >= 2');
  ok(maxTurns <= 60, 'no duel over 60 turns');
  console.log('  ' + RUNS + ' runs in ' + (Date.now() - t0) + ' ms: ' + errs + ' errors, min legal moves ' + minLegal + ', longest duel ' + maxTurns + ' turns');
  console.log('  run win rate ' + pct(wins, done) + '   reached phase 2 ' + pct(phase2, done) + '   mean duel reached ' + (sumReached / done).toFixed(2) + '   mean turns per duel ' + (totTurns / totDuels).toFixed(2));
  console.log('  per-duel player win rate (and mean turns):');
  [1, 2, 3, 4, 5, 6, 7, 8].forEach(n => {
    console.log('    ' + (n === 8 ? 'phase 2' : 'duel ' + n + ' ') + '  played ' + lpad(duelPlayed[n] || 0, 5) + '  won ' + lpad(pct(duelWon[n] || 0, duelPlayed[n] || 0), 6) + '  turns ' + ((duelTurns[n] || 0) / (duelPlayed[n] || 1)).toFixed(1));
  });
  const overall = wins / done;
  console.log('  player boons: run win rate when held vs overall (' + pct(wins, done) + ').');
  console.log('  "adj" compares against runs that reached the same bonfire (removes survivorship); flag = adj > +15 pts.');
  const rows = [], flagged = [], rawFlag = [];
  B.list.filter(b => b.who !== 'rival').forEach(b => {
    const h = held[b.id];
    if (!h) { rows.push({ id: b.id, n: 0 }); return; }
    let num = 0, den = 0;
    for (const bf in pickAt[b.id]) { const pa = pickAt[b.id][bf], rc = reach[bf]; num += pa.n * (pa.w / pa.n - rc.w / rc.n); den += pa.n; }
    const adj = 100 * num / den, raw = 100 * (h.w / h.n - overall);
    rows.push({ id: b.id, n: h.n, wr: h.w / h.n, raw: raw, adj: adj });
    if (adj > 15 && h.n >= 30) flagged.push(b.id + ' (+' + adj.toFixed(1) + ')');
    if (raw > 15) rawFlag.push(b.id);
  });
  rows.sort((a, b) => (b.adj || -99) - (a.adj || -99));
  let line = '';
  rows.forEach((r, i) => {
    line += '    ' + pad(r.id, 21) + (r.n ? lpad(r.n, 4) + ' ' + lpad((100 * r.wr).toFixed(1), 5) + '% raw ' + lpad((r.raw >= 0 ? '+' : '') + r.raw.toFixed(1), 5) + ' adj ' + lpad((r.adj >= 0 ? '+' : '') + r.adj.toFixed(1), 5) : ' never held');
    if (i % 2 === 1) { console.log(line); line = ''; }
  });
  if (line) console.log(line);
  console.log('  FLAGGED (adj uplift > +15 pts): ' + (flagged.length ? flagged.join(', ') : 'none'));
  console.log('  raw uplift > +15 pts (survivorship-biased, late picks imply a deep run): ' + (rawFlag.length ? rawFlag.length + ' boons' : 'none'));
  const rrows = Object.keys(rivalAt).map(id => {
    let num = 0, den = 0;
    for (const bf in rivalAt[id]) { const pa = rivalAt[id][bf], rc = reach[bf]; num += pa.n * (pa.w / pa.n - rc.w / rc.n); den += pa.n; }
    return { id: id, n: den, d: 100 * num / den };
  }).sort((a, b) => a.d - b.d);
  console.log('  Rival boons: player run win rate delta when the Rival drafted it (adj, same-bonfire baseline), most punishing first:');
  console.log('    ' + rrows.slice(0, 7).map(r => r.id + ' ' + (r.d >= 0 ? '+' : '') + r.d.toFixed(1)).join(', '));
  console.log('    least punishing: ' + rrows.slice(-4).map(r => r.id + ' ' + (r.d >= 0 ? '+' : '') + r.d.toFixed(1)).join(', '));
  console.log('  big hits at real draft frequencies: max single hit on the player ' + simMaxHit + ', duels with a hit >= 7 on the player: ' + pct(simBig, simDuels) + ' of ' + simDuels);

  // --- unlock frequency: fresh meta, 200 sequential runs, repeated
  const TRIALS = QUICK ? 5 : 20, SEQ = 200;
  const got = {}, when = {};
  let seqWins = 0, seqErr = 0;
  for (let t = 0; t < TRIALS; t++) {
    const S2 = { run: null, meta: RUN.defaultMeta() };
    for (let i = 0; i < SEQ; i++) {
      const info = playRun(S2, 700000 + t * 1000 + i, { now: 1000 + i * 3600e3 });
      if (info.err) { seqErr++; if (!firstErr) { firstErr = info.err; console.log('    ' + info.err); } continue; }
      if (info.won) seqWins++;
      info.fin.unlocks.forEach(u => { if (when[u.id + '#' + t] === undefined) { when[u.id + '#' + t] = i + 1; got[u.id] = got[u.id] || []; got[u.id].push(i + 1); } });
    }
    ok(S2.meta.memory.runs === SEQ && S2.meta.memory.wins + S2.meta.memory.deaths === SEQ, 'memory counts add up over ' + SEQ + ' runs');
  }
  eq(seqErr, 0, 'errors in sequential-meta runs');
  console.log('  unlocks: ' + TRIALS + ' fresh metas x ' + SEQ + ' sequential runs (win rate ' + pct(seqWins, TRIALS * SEQ) + '; run score stand-in = uniform 0..19).');
  console.log('  share of metas that had the unlock after ' + SEQ + ' runs, and the median run it arrived on:');
  const conds = [];
  RUN.UNLOCKS.forEach(u => { if (conds.indexOf(u.id) < 0) conds.push(u.id); });
  line = '';
  conds.forEach((id, i) => {
    const a = (got[id] || []).slice().sort((x, y) => x - y);
    line += '    ' + pad(id, 15) + lpad(pct(a.length, TRIALS), 6) + (a.length ? ' @' + lpad(a[Math.floor(a.length / 2)], 3) : '     ');
    if (i % 3 === 2) { console.log(line); line = ''; }
  });
  if (line) console.log(line);
})();

// ================================================================== 6. dangerous combos
section('6. Dangerous combos (those measurable without the brain)');
(function () {
  const rng = R.RNG.create(424242);
  // random-vs-random duel with synthetic intel; cb(d, res, before) after each exchange
  function simDuel(pB, rB, o, cb, policy) {
    const d = mk(pB, rB, o);
    let t = 0;
    while (!d.over && t < 200) {
      C.beginTurn(d);
      if (d.over) break;
      const lp = C.legal(d, 'p'), lr = C.legal(d, 'r');
      d.intel.honest = rng.chance(0.6); d.intel.pred = simplex(rng, lp);
      const pm = policy && policy.p ? policy.p(d, lp) : rng.pick(lp), rm = policy && policy.r ? policy.r(d, lr) : rng.pick(lr);
      const before = { pHp: d.p.hp, rHp: d.r.hp, rBroken: d.r.status.guardBroken, lp: lp.length };
      const res = C.resolve(d, pm, rm);
      t++;
      if (cb) cb(d, res, before);
    }
    return { d: d, turns: t };
  }
  // zero-sum matrix game value for the row player (rows maximise), by fictitious play
  function solve(M) {
    const nr = M.length, nc = M[0].length, rc = new Array(nr).fill(0), cc = new Array(nc).fill(0);
    let ri = 0, ci = 0;
    for (let it = 0; it < 20000; it++) {
      rc[ri]++; cc[ci]++;
      let best = -1e9, worst = 1e9;
      for (let i = 0; i < nr; i++) { let v = 0; for (let j = 0; j < nc; j++) v += M[i][j] * cc[j]; if (v > best) { best = v; ri = i; } }
      for (let j = 0; j < nc; j++) { let v = 0; for (let i = 0; i < nr; i++) v += M[i][j] * rc[i]; if (v < worst) { worst = v; ci = j; } }
    }
    let lo = 1e9, hi = -1e9;
    for (let j = 0; j < nc; j++) { let v = 0; for (let i = 0; i < nr; i++) v += M[i][j] * rc[i] / 20000; lo = Math.min(lo, v); }
    for (let i = 0; i < nr; i++) { let v = 0; for (let j = 0; j < nc; j++) v += M[i][j] * cc[j] / 20000; hi = Math.max(hi, v); }
    return (lo + hi) / 2;
  }
  const N = QUICK ? 4000 : 20000;

  // 1. coiled_riposte + first_blood + deathblow_creed + resonance on the Rival
  function bigHit(rB, n) {
    let big = 0, bigHits = 0, hits = 0, maxHit = 0;
    for (let i = 0; i < n; i++) {
      let saw = false;
      simDuel([], rB, { n: 5, pMax: 12, rMax: 9 }, (d, res) => {
        if (res.winner === 'r') { hits++; maxHit = Math.max(maxHit, res.dmgP); if (res.dmgP >= 7) { bigHits++; saw = true; } }
      });
      if (saw) big++;
    }
    return { p: big / n, share: bigHits / hits, max: maxHit };
  }
  const c1 = bigHit(['coiled_riposte', 'first_blood', 'deathblow_creed', 'resonance'], N);
  ok(c1.max <= 8, 'combo 1: no hit above the cap');
  console.log('  1. Rival coiled_riposte+first_blood+deathblow_creed+resonance (random play, ' + N + ' duels, 12 HP vs 9 HP):');
  console.log('     max single hit ' + c1.max + ' (cap ' + C.HIT_CAP + '); P(player takes >= 7 in one hit) per duel = ' + pct(c1.p, 1) + '  [target < 3%' + (c1.p < 0.03 ? '' : ' -- NOT MET') + ']  (' + pct(c1.share, 1) + ' of its hits)');
  const subs = [[], ['first_blood'], ['resonance'], ['coiled_riposte'], ['deathblow_creed'], ['first_blood', 'resonance'], ['coiled_riposte', 'first_blood'], ['coiled_riposte', 'resonance'], ['coiled_riposte', 'deathblow_creed', 'resonance']];
  console.log('     same measure by subset: ' + subs.map(sb => (sb.length ? sb.join('+') : 'no boons') + ' ' + pct(bigHit(sb, N / 4).p, 1)).join(' | '));

  // 3. vampires_curtsy + paper_cuts + carrion_comfort + salt_the_wound on the player
  let heals = [], over5 = 0;
  for (let i = 0; i < N; i++) {
    const r = simDuel(['vampires_curtsy', 'paper_cuts', 'carrion_comfort', 'salt_the_wound'], [], { n: 6, pMax: 12, pHp: 6, rMax: 10 });
    heals.push(r.d.tally.healP); if (r.d.tally.healP > 5) over5++;
  }
  heals.sort((a, b) => a - b);
  let d = mk(['vampires_curtsy', 'paper_cuts', 'carrion_comfort', 'salt_the_wound'], [], { pHp: 10 });
  d.r.status.bleed = 2;
  let res = turn(d, 'F', 'G');
  console.log('  3. Player vampires_curtsy+paper_cuts+carrion_comfort+salt_the_wound (start 6/12 HP, Rival 10 HP):');
  console.log('     Feint win vs a bleeding foe = ' + res.dmgR + ' dmg + heal ' + res.healP + '; heal per duel mean ' + (heals.reduce((a, b) => a + b, 0) / N).toFixed(2) + ', p95 ' + heals[Math.floor(N * 0.95)] + ', max ' + heals[N - 1] + ' (hard cap 3+3 = 6); duels healing > 5: ' + pct(over5, N) + '  [target <= 5]');

  // 4. long_con + debt_collector (+ turtle_cracker)
  function breakEV(pB) {
    let breaks = 0, net = 0, dealt = 0, open = 0;
    for (let i = 0; i < N / 4; i++) {
      open = 0;
      simDuel(pB, [], { pMax: 60, rMax: 60 }, (d, res, b) => {
        if (b.rBroken > 0) { net += res.dmgR - res.dmgP; dealt += res.dmgR; }
        if (res.guardBreak === 'r') breaks++;
      });
    }
    return { net: net / breaks, dealt: dealt / breaks, breaks: breaks };
  }
  function brokenValue(pB, turns) {            // equilibrium value to the player of one broken-Rival turn
    const dd = mk(pB, []);
    dd.r.status.guardBroken = turns;
    const pay = C.payoff(dd), lr = C.legal(dd, 'r'), lp = C.legal(dd, 'p');
    return solve(lp.map(pm => lr.map(rm => -pay[rm][pm])));
  }
  const ev0 = breakEV([]), ev1 = breakEV(['long_con', 'debt_collector']), ev2 = breakEV(['long_con', 'debt_collector', 'turtle_cracker']);
  const v0 = brokenValue([], 1), v1 = brokenValue(['long_con', 'debt_collector'], 1);
  console.log('  4. Guard-break follow-up, net damage swing (dealt - taken) during the break window, per break inflicted:');
  console.log('     random play: no boons ' + ev0.net.toFixed(2) + ' | long_con+debt_collector ' + ev1.net.toFixed(2) + ' | +turtle_cracker ' + ev2.net.toFixed(2) + '  (dealt only: ' + ev0.dealt.toFixed(2) + ' / ' + ev1.dealt.toFixed(2) + ' / ' + ev2.dealt.toFixed(2) + ')');
  console.log('     equilibrium value of a broken turn from payoff(): ' + v0.toFixed(2) + ' base (analytic 0.76 with the break term counted on both sides; design quotes 0.86 without it), ' + v1.toFixed(2) + ' with debt_collector; x2 turns with long_con = ' + (2 * v1).toFixed(2) + '  [target <= 4]');
  // complete matrix (a lost Guard also costs 0.86): player mixes S 4.86/7.86, value 2 * 3/7.86 = 0.763
  ok(Math.abs(v0 - 6 / 7.86) < 0.02, 'broken sub-game value matches the analytic 0.763');

  // 5. Rival no_encores + sealing_wax + guard break
  let lsum = 0, ln = 0, lmin = 3, two = 0;
  for (let i = 0; i < N / 2; i++) {
    const dd = mk([], ['no_encores', 'sealing_wax'], { pMax: 12, rMax: 10 });
    while (!dd.over) {
      C.beginTurn(dd); if (dd.over) break;
      const lp = C.legal(dd, 'p'), lr = C.legal(dd, 'r');
      lsum += lp.length; ln++; lmin = Math.min(lmin, lp.length); if (lp.length === 2) two++;
      C.resolve(dd, rng.pick(lp), rng.pick(lr));
    }
  }
  ok(lmin >= 2, 'combo 5: floor of 2 legal moves');
  console.log('  5. Rival no_encores+sealing_wax (+ guard breaks), random play: player mean legal moves ' + (lsum / ln).toFixed(3) + ', min ' + lmin + ', turns with only 2 legal ' + pct(two, ln) + '  [target mean >= 2.4]');

  // 6. Rival hungry_mask + mourning_veil + spare_mask vs a boonless player
  const lens = [];
  for (let i = 0; i < N; i++) lens.push(simDuel([], ['hungry_mask', 'mourning_veil', 'spare_mask'], { n: 6, pMax: 12, rMax: 10 }).turns);
  lens.sort((a, b) => a - b);
  let over25 = lens.filter(x => x > 25).length;
  console.log('  6. Rival hungry_mask+mourning_veil+spare_mask vs no boons (12 HP vs 10 HP, random play): turns mean ' + (lens.reduce((a, b) => a + b, 0) / N).toFixed(1) + ', p99 ' + lens[Math.floor(N * 0.99)] + ', max ' + lens[N - 1] + ', duels > 25 turns ' + pct(over25, N) + '  [target < 1%]');
  // worst case for length: both sides only ever clash-avoid... measured with a Guard-only player
  const lensG = [];
  for (let i = 0; i < N / 10; i++) lensG.push(simDuel([], ['hungry_mask', 'mourning_veil', 'spare_mask'], { n: 6, pMax: 12, rMax: 10 }, null, { p: (dd, lp) => lp.indexOf('G') >= 0 ? 'G' : rng.pick(lp) }).turns);
  lensG.sort((a, b) => a - b);
  console.log('     same, always-Guard player (lowest-damage line): turns p99 ' + lensG[Math.floor(lensG.length * 0.99)] + ', max ' + lensG[lensG.length - 1]);

  // 9. mirror_etiquette + resonance + Rupture chip
  ['F', 'S', 'G'].forEach(m => {
    const dd = mk(['mirror_etiquette', 'resonance'], [], { pMax: 12, pHp: 8, rMax: 12 });
    let healed = 0, chip = 0, trace = [];
    for (let t = 0; t < 12; t++) {
      C.beginTurn(dd);
      const mv = C.legal(dd, 'p').indexOf(m) >= 0 && C.legal(dd, 'r').indexOf(m) >= 0 ? m : null;
      if (!mv) { const alt = C.legal(dd, 'p').filter(x => C.legal(dd, 'r').indexOf(x) >= 0)[0]; const r2 = C.resolve(dd, alt, alt); healed += r2.healP; chip += r2.dmgP; trace.push(dd.p.hp); continue; }
      const r = C.resolve(dd, mv, mv); healed += r.healP; chip += r.dmgP; trace.push(dd.p.hp);
    }
    if (m === 'F') ok(healed <= 2 && chip > healed, 'combo 9: Rupture chip outpaces Masquerade heals');
    console.log('  9. clash farming on ' + m + ' (mirror_etiquette+resonance, 12 forced mirrors from 8/12 HP): healed ' + healed + ', Rupture chip ' + chip + ', HP trace ' + trace.join(' '));
  });
})();

// ================================================================== summary
console.log('\n=== SUMMARY ===');
console.log('  assertions passed: ' + passes + ', failed: ' + fails);
if (fails) {
  failLog.slice(0, 30).forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ALL PASS');
