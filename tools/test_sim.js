// SHOW ME MY RIVAL — checks for the balance sim's command line and module interface (tools/sim.js).
//
//   node tools/test_sim.js
//
// Determinism (--json and --no-timing output byte-identical across runs and --jobs values), the --json shape and
// its invariants, strict --set, module mode (requiring sim.js runs nothing), the commit log used by the sim-scene
// parity check (and a script replay of it), and the Rival-coercion counter. Writes no files; every sim it starts
// uses at most 3 workers. Prints PASS / FAIL lines and exits 1 on any failure.
'use strict';
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const SIM = path.join(__dirname, 'sim.js');
const t0 = Date.now();
let checks = 0, fails = 0;
function check(cond, name, detail) {
  checks++;
  if (cond) console.log('PASS ' + name);
  else { fails++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); }
  return !!cond;
}
function section(t) { console.log('\n== ' + t); }
function sim(args) {
  const r = cp.spawnSync(process.execPath, [SIM].concat(args), { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', error: r.error };
}
function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return 'line ' + (i + 1) + ': ' + JSON.stringify(x[i]) + ' vs ' + JSON.stringify(y[i]);
  return 'none';
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// The first value under v that is not plain JSON (a function, undefined, a symbol or bigint, a non-finite number,
// a sparse array slot, or an object that is not a plain Object or Array), as a path; null when v is plain JSON.
function notPlainJson(v, p) {
  p = p || '$';
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : p + ' = ' + v;
  if (typeof v !== 'object') return p + ' is a ' + typeof v;
  const proto = Object.getPrototypeOf(v);
  if (Array.isArray(v)) {
    if (proto !== Array.prototype) return p + ' is not a plain array';
    for (let i = 0; i < v.length; i++) { if (!(i in v)) return p + '[' + i + '] is a hole'; const b = notPlainJson(v[i], p + '[' + i + ']'); if (b) return b; }
    return null;
  }
  if (proto !== Object.prototype) return p + ' is not a plain object';
  if (Object.getOwnPropertySymbols(v).length) return p + ' has symbol keys';
  const ks = Object.keys(v);
  for (let i = 0; i < ks.length; i++) { const b = notPlainJson(v[ks[i]], p + '.' + ks[i]); if (b) return b; }
  return null;
}
// JSON with the keys sorted at every depth, written here independently of sim.js canon().
function sortedJson(v) {
  if (Array.isArray(v)) return '[' + v.map(sortedJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + sortedJson(v[k]); }).join(',') + '}';
  return JSON.stringify(v);
}

// ------------------------------------------------------------------ 1. module mode
section('1. requiring sim.js runs nothing and exports the interface');
{
  const r = cp.spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(SIM) + ')'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  check(r.status === 0 && !r.error, 'require exits 0 on its own (no workers left running)', r.error ? String(r.error) : 'status ' + r.status);
  check(r.stdout === '' && r.stderr === '', 'require prints nothing', JSON.stringify((r.stdout + r.stderr).slice(0, 200)));
}
const S = require(SIM);
['runChain', 'applySet', 'parseSet', 'parseArgs', 'makeBot', 'makeScripted', 'commitRecord', 'commitInput', 'canon', 'merge', 'newStats', 'quantile', 'phaseCfg'].forEach(function (k) {
  check(typeof S[k] === 'function', 'export ' + k + ' is a function');
});
check(Array.isArray(S.BOT_NAMES) && S.BOT_NAMES.indexOf('adaptive') >= 0 && S.BORED_AFTER === 9 && S.MAX_PHASES >= 4, 'exports BOT_NAMES, BORED_AFTER, MAX_PHASES');
{
  let a = null, err = null;
  try { a = S.parseArgs(['node', 'sim.js', '--quick', '--set', 'boss=all', '--set', 'stake=7', '--json']); } catch (e) { err = e; }
  check(a && a.faces.length === 4 && a.stake === 7 && a.combos === false && a.timing === false && a.seeds === 2, 'parseArgs normalises boss=all, stake, --quick and --json (implies no timing)', err ? err.message : JSON.stringify(a && { faces: a.faces, stake: a.stake }));
}

// ------------------------------------------------------------------ 2. strict --set
section('2. strict --set: bad values are refused before anything runs');
const TINY = ['--runs', '2', '--seeds', '1', '--bot', 'guard', '--no-combos', '--no-boons', '--jobs', '1', '--json'];
const BAD = [
  [['--set', 'B.hours.4.stance=foo'], 'B.hours.4.stance=foo'],
  [['--set', 'B.hours.4.floor=none'], 'B.hours.4.floor=none'],
  [['--set', 'B.hours.4.nosuchkey=1'], 'B.hours.4.nosuchkey=1'],
  [['--set', 'hp=9,9,9'], 'hp=9,9,9'],
  [['--set', 'B.hours.5.floor=1'], 'B.hours.5.floor=1'],
  [['--set', 'B.nobody.1.hp=4'], 'B.nobody.1.hp=4'],
  [['--set', 'B.hours.1.change=bell'], 'B.hours.1.change=bell'],
  [['--set', 'stake=8'], 'stake=8'],
  [['--set', 'stake=2.5'], 'stake=2.5'],
  [['--set', 'exploit=.1,.2'], 'exploit=.1,.2'],
  [['--set', 'K.NOPE=1'], 'K.NOPE=1'],
  [['--set', 'V.nope=1'], 'V.nope=1'],
  [['--set', 'A.NOPE=1'], 'A.NOPE=1'],
  [['--set', 'K.LAMBDA=0.9'], 'K.LAMBDA=0.9'],
  [['--set', 'maxhp=abc'], 'maxhp=abc'],
  [['--set', 'heal=1e999'], 'heal=1e999'],
  [['--set', 'boss=nobody'], 'boss=nobody'],
  [['--set', 'nosuchkey=1'], 'nosuchkey=1'],
  [['--set', 'B.reflection.2.innate=relic_rusty_nail'], 'B.reflection.2.innate=relic_rusty_nail'],
  [['--json', '--trace'], '--trace'],
  [['--unlocks', 'some'], '--unlocks'],
  [['--runs', 'many'], '--runs'],
  [['--frobnicate'], '--frobnicate']
];
BAD.forEach(function (c) {
  const r = sim(TINY.concat(c[0]));
  check(r.status !== 0 && r.status !== null && r.err.indexOf(c[1]) >= 0 && r.out === '' && !/\n\s+at /.test(r.err),
    'refused: ' + c[0].join(' '), 'status ' + r.status + ', stderr ' + JSON.stringify(r.err.trim().slice(0, 160)));
});
{
  const r = sim(['--runs', '2', '--seeds', '1', '--bot', 'guard', '--set', 'boss=all', '--trace']);
  check(r.status === 1 && /--trace needs one face/.test(r.err) && r.out === '', 'refused: --set boss=all --trace', 'status ' + r.status + ' ' + r.err.trim().slice(0, 160));
}
// --label writes tools/out, so these two are checked in process, never by running the CLI
[['--json', '--label', 'x'], ['--set', 'boss=all', '--label', 'x']].forEach(function (args) {
  let threw = null;
  try { S.parseArgs(['node', 'sim.js'].concat(args)); } catch (e) { threw = e; }
  check(threw && threw.usage && /--label/.test(threw.message), 'refused: ' + args.join(' '), threw ? threw.message : 'accepted');
});
const GOOD = [['--set', 'B.hours.4.floor=2'], ['--set', 'B.three_faced.3.stance=none'], ['--set', 'boss=all'], ['--set', 'stake=7'], ['--set', 'K.LAMBDA=' + [0.93, 0.90, 0.85, 0.90, 0.85, 0.90, 0.80, 0.90, 0.88, 0.88, 0.92, 0.88, 0.88].join(',')]];
GOOD.forEach(function (c) {
  const r = sim(TINY.concat(c));
  let ok = r.status === 0;
  try { JSON.parse(r.out); } catch (e) { ok = false; }
  check(ok, 'accepted: ' + c.join(' '), 'status ' + r.status + ' ' + r.err.trim().slice(0, 160));
});
{
  let threw = null;
  try { S.parseSet(['B.hours.4.floor=2', 'hp=1,2']); } catch (e) { threw = e; }
  check(threw && threw.usage && /hp=1,2/.test(threw.message), 'parseSet refuses the whole list when one entry is bad', threw ? threw.message : 'no error');
  const items = S.parseSet(['B.three_faced.3.stance=none', 'B.hours.2.calls=true', 'B.hours.2.heal=null', 'stake=7', 'boss=hours']);
  check(items[0].value === 'none' && items[1].value === true && items[2].del === true && items[3].value === 7 && items[4].value === 'hours', 'parseSet types its values (enum, boolean, null delete, integer, face)');
}

// ------------------------------------------------------------------ 3. --json shape, invariants, determinism
section('3. --json: one canonical document, the same for every run and every --jobs value');
const JARGS = ['--json', '--seed', '1', '--seeds', '2', '--runs', '40', '--no-combos', '--unlocks', 'all', '--set', 'boss=all'];
const j3 = sim(JARGS.concat(['--jobs', '3']));
const j3b = sim(JARGS.concat(['--jobs', '3']));
const j1 = sim(JARGS.concat(['--jobs', '1']));
check(j3.status === 0 && j3b.status === 0 && j1.status === 0, '--json runs exit 0', [j3.status, j3b.status, j1.status].join(' ') + ' ' + (j3.err || j1.err).slice(0, 300));
check(j3.out.length > 0 && j3.out === j3b.out, 'two --json runs are byte-identical', firstDiff(j3.out, j3b.out));
check(j3.out === j1.out, '--json with --jobs 1 and --jobs 3 is byte-identical', firstDiff(j3.out, j1.out));
check(j3.err === '', '--json prints nothing on stderr', j3.err.slice(0, 200));
let doc = null;
try { doc = JSON.parse(j3.out); } catch (e) { check(false, '--json stdout is one valid JSON document', e.message); }
if (doc) {
  check(true, '--json stdout is one valid JSON document');
  check(JSON.stringify(S.canon(doc), null, 2) + '\n' === j3.out, '--json is canonical (sorted keys, 2-space indent, LF, trailing newline)');
  const timingKeys = [];
  (function walk(v, p) {
    if (Array.isArray(v)) v.forEach(function (x, i) { walk(x, p + '[' + i + ']'); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { if (/^(ms|elapsed|runsPerSec|jobs|workers|time|date)$/.test(k)) timingKeys.push(p + '.' + k); walk(v[k], p + '.' + k); });
  })(doc, '');
  check(timingKeys.length === 0, '--json carries no timing or machine keys', timingKeys.slice(0, 5).join(' '));
  check(doc.format === 'rival-sim/1' && doc.args && doc.constants && doc.results && !doc.combos, 'top level: format, args, constants, results (no combos unless asked)');
  check(deepEqual(doc.args.faces, ['unmasked', 'three_faced', 'hours', 'reflection']) && doc.args.stake === 0 && doc.args.runs === 40 && doc.args.seeds === 2 && doc.args.bots.length === 8, 'args are normalised (faces, stake, runs, seeds, bots)');
  check(doc.constants.rivalHp.length === 7 && doc.constants.faces.hours.length === 4 && typeof doc.constants.vigil.callsFrom === 'number', 'constants carry the duel table, the Vigil tune and every face run');
  const R = globalThis.RIVAL;
  const SEG_KEYS = ['n', 'w', 'deaths', 'turns', 'hist', 'decHist', 'le2dec', 'clash', 'rWin', 'pWin', 'big7', 'ruptDuels', 'lockDuels', 'bored', 'tells', 'honest', 'trap', 'counter', 'mirror', 'mv', 'q', 'rate', 'legalSum'];
  const BOT_KEYS = ['runs', 'wins', 'chains', 'bRuns', 'bWins', 'reach', 'deathAt', 'final', 'perChain', 'duel', 'phase', 'coerced', 'pb', 'rb', 'lifeScore', 'trust'];
  const problems = [];
  let bots = 0, coerced = 0;
  function sum(o, keys, f) { let s = 0; keys.forEach(function (k) { s += o[k][f]; }); return s; }
  R.Run.BOSSES.forEach(function (face) {
    const F = doc.results[face.id];
    if (!F) { problems.push('no results for ' + face.id); return; }
    doc.args.bots.forEach(function (b) {
      const B = F[b], P = face.id + '/' + b + ': ';
      if (!B) { problems.push(P + 'missing'); return; }
      bots++;
      BOT_KEYS.forEach(function (k) { if (!(k in B)) problems.push(P + 'no ' + k); });
      const nPh = face.phases.length, phs = Object.keys(B.phase || {});
      if (phs.join(',') !== Array.from({ length: nPh }, function (_, i) { return String(i + 1); }).join(',')) problems.push(P + 'phase keys ' + phs.join(',') + ' (want 1..' + nPh + ')');
      if (Object.keys(B.duel).join(',') !== '1,2,3,4,5,6,7,P2+') problems.push(P + 'duel keys ' + Object.keys(B.duel).join(','));
      phs.concat([]).forEach(function (k) { SEG_KEYS.forEach(function (s) { if (!(s in B.phase[k])) problems.push(P + 'phase ' + k + ' has no ' + s); }); });
      if (B.coerced !== 0) coerced++;
      if (B.final.a !== B.duel['7'].n) problems.push(P + 'final.a ' + B.final.a + ' != duel 7 n ' + B.duel['7'].n);
      if (!(B.final.w === B.wins && B.wins === B.deathAt[9])) problems.push(P + 'final.w / wins / deathAt[9] disagree');
      if (B.final.a !== B.deathAt[7] + B.deathAt[8] + B.deathAt[9]) problems.push(P + 'A != deathAt[7]+[8]+[9]');
      if (B.phase['1'].n !== B.duel['7'].n) problems.push(P + 'phase 1 n != duel 7 n');
      const later = phs.filter(function (k) { return k !== '1'; });
      ['n', 'w', 'turns', 'tells', 'clash'].forEach(function (f) { if (sum(B.phase, later, f) !== B.duel['P2+'][f]) problems.push(P + 'phases 2+ ' + f + ' != P2+ ' + f); });
      phs.forEach(function (k) {
        const g = B.phase[k];
        if (g.n !== g.w + g.deaths) problems.push(P + 'phase ' + k + ' n != w + deaths');
        if (!(Number.isInteger(g.q.p10) && g.q.p10 <= g.q.p50 && g.q.p50 <= g.q.p90)) problems.push(P + 'phase ' + k + ' quantiles ' + JSON.stringify(g.q));
        let hist = 0; g.hist.forEach(function (x) { hist += x; });
        if (hist !== g.n) problems.push(P + 'phase ' + k + ' turn histogram holds ' + hist + ' of ' + g.n);
        const ex = g.mv.S.ex + g.mv.G.ex + g.mv.F.ex;
        if (ex !== g.turns || g.mv.S.pWin + g.mv.G.pWin + g.mv.F.pWin !== g.pWin) problems.push(P + 'phase ' + k + ' per-move counts disagree');
        const stanceless = face.phases[+k - 1].stance === 'none';
        if (stanceless && (g.tells !== 0 || g.honest !== 0 || g.rate.truth !== null)) problems.push(P + 'phase ' + k + ' shows no stance but tells ' + g.tells + ', truth ' + g.rate.truth);
        if (!stanceless && g.tells !== g.turns) problems.push(P + 'phase ' + k + ' tells ' + g.tells + ' != turns ' + g.turns);
      });
      if (B.perChain.length !== B.chains) problems.push(P + 'perChain length ' + B.perChain.length + ' != chains ' + B.chains);
      if (sum(B.perChain, Object.keys(B.perChain), 'runs') !== B.runs) problems.push(P + 'perChain runs do not add up');
      let fa = 0, fw = 0;
      B.perChain.forEach(function (c) { fa += c.final.a; fw += c.final.w; });
      if (fa !== B.final.a || fw !== B.final.w) problems.push(P + 'perChain final counts do not add up');
      if (B.perChain.map(function (c) { return c.seed; }).join(',') !== '1000,1001') problems.push(P + 'perChain is not in seed order');
    });
  });
  check(bots === 32 && problems.length === 0, 'every face x bot has the required keys and the invariants hold (' + bots + ' bots)', problems.slice(0, 6).join('; '));
  // A coercion throws and fails the run (caught by '--json runs exit 0'), so a finished run can only report 0: this
  // checks that the field is there and is 0. The controls in section 5 prove each detection path really throws.
  check(coerced === 0, 'every face x bot reports coerced: 0 (the field is present; a coercion throws instead, see the section 5 controls)', coerced + ' bots without coerced: 0');
  // one face alone gives the same numbers as that face inside boss=all: the face travels with each job
  const one = sim(['--json', '--seed', '1', '--seeds', '2', '--runs', '40', '--no-combos', '--unlocks', 'all', '--set', 'boss=hours', '--jobs', '2']);
  let oneDoc = null;
  try { oneDoc = JSON.parse(one.out); } catch (e) { /* reported below */ }
  check(oneDoc && deepEqual(oneDoc.results.hours, doc.results.hours), 'boss=hours alone equals the hours results of boss=all (no face leaks between jobs)');
}

section('4. --no-timing text: byte-identical across runs and --jobs values');
{
  const TARGS = ['--seed', '2', '--seeds', '2', '--runs', '30', '--unlocks', 'all', '--set', 'boss=reflection', '--set', 'stake=7', '--no-timing'];
  const a = sim(TARGS.concat(['--jobs', '3'])), b = sim(TARGS.concat(['--jobs', '3'])), c = sim(TARGS.concat(['--jobs', '1']));
  check(a.status === 0 && b.status === 0 && c.status === 0, '--no-timing runs exit 0', [a.status, b.status, c.status].join(' ') + ' ' + a.err.slice(0, 300));
  check(a.out.length > 0 && a.out === b.out, 'two --no-timing runs are byte-identical (combos included)', firstDiff(a.out, b.out));
  check(a.out === c.out, '--no-timing with --jobs 1 and --jobs 3 is byte-identical', firstDiff(a.out, c.out));
  check(!/runs\/s|wall clock| workers/.test(a.out), '--no-timing prints no runs/s, wall clock or worker count');
  check(/=== FINAL DUEL BY PHASE \(face reflection, stake 7\) ===/.test(a.out) && /final win \| arrival: \d+\/\d+/.test(a.out) && /=== DANGEROUS COMBOS/.test(a.out),
    'the text report has the per-phase table, the raw W/A lines and the combos');
}

// ------------------------------------------------------------------ 5. commit log and script replay (in process)
section('5. commit log: the exact brain.commit inputs, and a script that replays them');
{
  const base = { bot: 'mixer', tag: 'cl', seed: 4242, runs: 14, unlocks: 'all', noTiming: true };
  ['reflection', 'three_faced'].forEach(function (face) {
    const job = Object.assign({}, base, { boss: face, stake: 7 });
    const plainRun = S.runChain(Object.assign({}, job));
    const logged = S.runChain(Object.assign({ commitLog: true, record: true }, job));
    check(!plainRun.commitLog && deepEqual(plainRun.stats, logged.stats), face + ': logging changes no statistic (no extra draw)');
    const L = logged.commitLog || [];
    check(L.length > 0 && L.length === logged.stats.turns && logged.commits.length === L.length, face + ': one record per seal (' + L.length + ' seals)', L.length + ' records, ' + logged.stats.turns + ' turns');
    let shapeBad = 0, firstShape = '', jsonBad = 0, firstJson = '', strBad = 0;
    L.forEach(function (r, i) {
      const keys = Object.keys(r).sort().join(','), qk = Object.keys(r.q || {}).filter(function (k) { return ['ctx', 'payoff', 'legalR', 'legalP', 'exploit', 'honestyBase', 'noTell', 'mimic', 'force'].indexOf(k) < 0; });
      const typed = Number.isInteger(r.duel) && Number.isInteger(r.phase) && Number.isInteger(r.turn) && Number.isInteger(r.rngState) && r.q && r.q.ctx && r.q.payoff &&
            Array.isArray(r.q.legalR) && Array.isArray(r.q.legalP) && typeof r.q.exploit === 'number' && typeof r.q.honestyBase === 'number';
      if (!typed || keys !== 'duel,phase,q,rngState,turn' || qk.length) { if (!shapeBad++) firstShape = 'record ' + i + ' keys ' + keys + (qk.length ? ' / extra q.' + qk.join(',q.') : ''); }
      const bad = notPlainJson(r);
      if (bad) { if (!jsonBad++) firstJson = 'record ' + i + ': ' + bad; }
      if (logged.commits[i] !== sortedJson(r)) strBad++;
    });
    check(shapeBad === 0, face + ': every record is {duel, phase, turn, q, rngState} with the brain.commit input fields in q', shapeBad + ' bad, first ' + firstShape);
    check(jsonBad === 0, face + ': every record is plain JSON (no function, undefined, non-finite number, hole or class instance)', jsonBad + ' bad, first ' + firstJson);
    check(strBad === 0, face + ': commits[i] is record i as JSON with keys sorted at every depth (checked by an independent writer)', strBad + ' differ');
    const special = face === 'reflection' ? L.filter(function (r) { return r.q.mimic; }).length : L.filter(function (r) { return r.q.noTell; }).length;
    check(special > 0, face + ': the log carries ' + (face === 'reflection' ? 'mimic' : 'noTell') + ' inputs (' + special + ')');
    const sc = logged.script;
    const coins = sc ? sc.runs.reduce(function (n, r) { return n + r.moves.filter(function (m) { return m === 'coin'; }).length; }, 0) : 0;
    const replay = sc ? S.runChain({ bot: 'script', tag: 'replay', seed: 0, unlocks: 'all', noTiming: true, script: sc, commitLog: true }) : null;
    check(replay && deepEqual(replay.commits, logged.commits), face + ': a script replay of the chain seals from identical inputs (' + L.length + ' seals, ' + coins + ' coin throws)',
      replay ? 'replay ' + replay.commits.length + ' vs ' + logged.commits.length : 'no script');
    check(replay && replay.stats.wins === logged.stats.wins && replay.stats.turns === logged.stats.turns, face + ': the replay ends every run the same way');
  });
  // a hand-made record that is not plain JSON must be caught by the check above (the check itself can fail)
  {
    const fake = { duel: 1, phase: 1, turn: 1, rngState: 1, q: { ctx: {}, payoff: {}, legalR: ['S'], legalP: ['S'], exploit: NaN, honestyBase: 0.5, rng: { next: function () {} } } };
    check(notPlainJson(fake) !== null && notPlainJson({ a: [1, 'x', null, { b: true }] }) === null && notPlainJson({ d: new Date(0) }) !== null && notPlainJson({ u: undefined }) !== null,
      'control: the plain-JSON check refuses NaN, functions, a Date and undefined, and accepts plain values', String(notPlainJson(fake)));
  }
  // positive controls: each way the harness detects a coerced Rival move must stop the chain with a clear error
  const RV = globalThis.RIVAL, Brain = RV.Brain, Combat = RV.Combat, realCreate = Brain.create, realResolve = Combat.resolve;
  function control(name, re, install, uninstall) {
    let thrown = null, ran = 0;
    install(function () { ran++; });
    try { S.runChain(Object.assign({}, base, { boss: 'hours', stake: 0 })); } catch (e) { thrown = e; } finally { uninstall(); }
    check(ran > 0 && thrown && re.test(thrown.message), 'control: ' + name + ' stops the chain with a clear error', thrown ? thrown.message.slice(0, 140) : 'no error (tamper ran ' + ran + ' times)');
  }
  // 1. the 30th seal names a move the Rival may not play (caught before resolve)
  control('an illegal sealed move', /the Rival sealed an illegal move/, function (hit) {
    Brain.create = function (x) {
      const br = realCreate(x), commit = br.commit;
      let k = 0;
      br.commit = function (q) {
        const s = commit(q);
        if (++k !== 30) return s;
        hit();
        const off = ['S', 'G', 'F'].filter(function (m) { return q.legalR.indexOf(m) < 0; });
        return Object.assign({}, s, { move: off.length ? off[0] : 'X' });
      };
      return br;
    };
  }, function () { Brain.create = realCreate; });
  // 2. resolve plays a different Rival move than the sealed one (caught after resolve, by res.rm)
  control('a Rival move replaced at resolve', /was replaced at resolve by/, function (hit) {
    let k = 0;
    Combat.resolve = function (duel, pm, rm) {
      const res = realResolve.apply(this, arguments);
      if (++k !== 30) return res;
      hit();
      return Object.assign({}, res, { rm: rm === 'S' ? 'G' : 'S' });
    };
  }, function () { Combat.resolve = realResolve; });
  // 3. resolve keeps rm but reports a Rival-side note (the combat log's 'illegal move replaced')
  control('a Rival-side resolve note', /was replaced at resolve by/, function (hit) {
    let k = 0;
    Combat.resolve = function () {
      const res = realResolve.apply(this, arguments);
      if (++k !== 30) return res;
      hit();
      return Object.assign({}, res, { events: (res.events || []).concat([{ t: 'note', side: 'r', text: 'illegal move replaced' }]) });
    };
  }, function () { Combat.resolve = realResolve; });
  check(Brain.create === realCreate && Combat.resolve === realResolve, 'controls restore Brain.create and Combat.resolve');

  const q = { ctx: { duel: 3, phase: 1, turn: 2 }, payoff: { S: { S: 0, G: 1, F: -1 } }, legalR: ['S', 'G'], legalP: ['S', 'G', 'F'], exploit: 0.5, honestyBase: 0.8, rng: globalThis.RIVAL.RNG.create(7) };
  const before = q.rng.state(), rec = S.commitRecord(q);
  check(rec.rngState === before && q.rng.state() === before && rec.duel === 3 && rec.turn === 2 && !('noTell' in rec.q) && S.commitInput(q) === JSON.stringify(S.canon(rec)), 'commitRecord reads the dice state without drawing');
}

console.log('\ntest_sim: ' + (fails ? 'FAILED ' + fails + ' of ' + checks : 'ALL PASS - ' + checks) + ' checks, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exitCode = fails ? 1 : 0;
