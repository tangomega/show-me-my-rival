// SHOW ME MY RIVAL — noise baseline and per-face per-phase tables, as Markdown on stdout.
//
//   node tools/sim_tables.js [--jobs J] [--seeds 8] [--runs 400] [--seed 1] [--stakes 0,7] [--faces all|id,id]
//                            [--raw <dir>] [--from <dir>]
//
// Runs one sim process per face x stake (`node tools/sim.js --json --unlocks all --no-combos --set boss=<face>
// --set stake=<s>`, never --label), then prints, per stake:
//   - final-duel win given arrival per bot, pooled (W/A), with the per-chain SD, SE = SD / sqrt(chains), the binomial
//     SE for reference, the band max(3, 2 SD), run win and arrivals;
//   - the per-face per-phase table (turn quantiles, settled within 2 decisive exchanges, clash, 7+ hits, Ruptures,
//     locks, bored escapes, stance truth rate on shown turns).
// Insufficient sample: a chain counts with 30+ arrivals, an SD needs 6 counted chains, a pooled value needs 100+
// arrivals (sim.js SAMPLE). Progress and timings go to stderr; stdout is only the Markdown, so it is reproducible.
// --raw <dir> also saves each sim JSON there; --from <dir> renders saved JSON instead of running the sim.
'use strict';
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SIM_PATH = path.join(__dirname, 'sim.js');
const SIM = require(SIM_PATH);                        // module mode: runs nothing; loads the pure modules
const R = globalThis.RIVAL;
const SAMPLE = SIM.SAMPLE;
const MAIN_BOTS = ['adaptive', 'mixer', 'uniform', 'habit'];

function fail(msg) { console.error('sim_tables: ' + msg); process.exit(1); }
function parse(argv) {
  const a = { jobs: 4, seeds: 8, runs: 400, seed: 1, stakes: [0, 7], faces: R.Run.BOSSES.map(function (b) { return b.id; }), raw: null, from: null };
  function int(i, k, min) { const s = argv[i]; if (!/^-?\d+$/.test(s || '')) fail(k + ' needs an integer'); const x = parseInt(s, 10); if (x < min) fail(k + ' must be >= ' + min); return x; }
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--jobs') a.jobs = int(++i, k, 1);
    else if (k === '--seeds') a.seeds = int(++i, k, 1);
    else if (k === '--runs') a.runs = int(++i, k, 1);
    else if (k === '--seed') a.seed = int(++i, k, -1e9);
    else if (k === '--stakes') a.stakes = String(argv[++i] || '').split(',').map(function (s) { if (!/^[0-7]$/.test(s)) fail('--stakes takes integers 0..7'); return +s; });
    else if (k === '--faces') { const v = argv[++i] || ''; if (v !== 'all') { a.faces = v.split(','); a.faces.forEach(function (f) { if (!R.Run.BOSSES.some(function (b) { return b.id === f; })) fail('unknown face ' + f); }); } }
    else if (k === '--raw') a.raw = argv[++i];
    else if (k === '--from') a.from = argv[++i];
    else if (k === '--help' || k === '-h') { console.log(fs.readFileSync(__filename, 'utf8').replace(/\r\n?/g, '\n').split("'use strict';")[0]); process.exit(0); }
    else fail('unknown argument ' + k);
  }
  return a;
}

function cellArgs(a, face, stake) {
  return ['--json', '--seed', String(a.seed), '--seeds', String(a.seeds), '--runs', String(a.runs), '--unlocks', 'all', '--no-combos',
          '--set', 'boss=' + face, '--set', 'stake=' + stake];
}
// One cell's sim JSON, checked to hold the results for its face (a wrong or truncated file is a clear error).
function cellDoc(text, face, stake, where) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { fail('cannot parse the sim JSON for ' + face + ' stake ' + stake + ' (' + where + '): ' + e.message); }
  if (!doc || !doc.results || !doc.results[face] || !doc.args || doc.args.stake !== stake)
    fail('the sim JSON for ' + face + ' stake ' + stake + ' (' + where + ') has no results for that face and stake');
  return doc;
}
function runCell(a, face, stake) {
  const file = face + '_' + stake + '.json';
  if (a.from) {
    const p = path.join(a.from, file);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { fail('cannot read ' + file + ' from ' + a.from + ': ' + (e.code || e.message)); }
    return cellDoc(text, face, stake, p);
  }
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [SIM_PATH].concat(cellArgs(a, face, stake), ['--jobs', String(a.jobs)]), { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) fail('sim failed for ' + face + ' stake ' + stake + ':\n' + (r.stderr || r.error));
  console.error('cell ' + face + ' stake ' + stake + ': ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  const doc = cellDoc(r.stdout, face, stake, 'sim stdout');
  if (a.raw) {
    try { fs.mkdirSync(a.raw, { recursive: true }); fs.writeFileSync(path.join(a.raw, file), r.stdout); } catch (e) { fail('cannot write ' + file + ' to ' + a.raw + ': ' + (e.code || e.message)); }
  }
  return doc;
}

// ------------------------------------------------------------------ statistics
function spread(pairs) {                              // pairs [w, n]: per-chain percent over chains with enough trials
  const r = pairs.filter(function (p) { return p[1] >= SAMPLE.chainArrivals; }).map(function (p) { return 100 * p[0] / p[1]; });
  if (r.length < SAMPLE.sdChains) return { sd: null, se: null, m: r.length };
  let mean = 0, v = 0;
  r.forEach(function (x) { mean += x; });
  mean /= r.length;
  r.forEach(function (x) { v += (x - mean) * (x - mean); });
  const sd = Math.sqrt(v / (r.length - 1));
  return { sd: sd, se: sd / Math.sqrt(r.length), m: r.length };
}
function f1(x) { return x.toFixed(1); }
function f2(x) { return x.toFixed(2); }
function pc(a, b) { return b > 0 ? f1(100 * a / b) : 'n/a'; }
function quantileOf(hist, q) {
  let total = 0, acc = 0, i;
  for (i = 0; i < hist.length; i++) total += hist[i];
  if (!total) return 0;
  for (i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= q * total) return i; }
  return hist.length - 1;
}
const INS = 'insufficient sample';

function waTable(docs, a, stake, L) {
  L.push('### Final-duel win given arrival, stake ' + stake);
  L.push('');
  L.push('| face | bot | W/A | win given arrival % | chain SD | SE = SD/√chains | binomial SE | band max(3, 2 SD) | run win % | arrivals per chain (min-max) |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  const short = [];
  a.faces.forEach(function (face) {
    const res = docs[face + '/' + stake].results[face];
    const bots = MAIN_BOTS.concat(Object.keys(res).filter(function (b) { return MAIN_BOTS.indexOf(b) < 0 && res[b].final.a >= SAMPLE.pooledArrivals; }));
    Object.keys(res).forEach(function (b) { if (bots.indexOf(b) < 0) short.push(face + ' ' + b + ' (' + res[b].final.a + ' arrivals)'); });
    bots.forEach(function (b) {
      const B = res[b];
      if (!B) return;
      const W = B.final.w, A = B.final.a, p = A ? W / A : 0;
      const sp = spread(B.perChain.map(function (c) { return [c.final.w, c.final.a]; }));
      const arr = B.perChain.map(function (c) { return c.final.a; });
      const pooled = A >= SAMPLE.pooledArrivals;
      L.push('| ' + [face, b, W + '/' + A,
        pooled ? f1(100 * p) : INS + ' (' + f1(A ? 100 * p : 0) + ')',
        sp.sd === null ? INS + ' (' + sp.m + ' of ' + B.perChain.length + ' chains)' : f2(sp.sd),
        sp.se === null ? INS : f2(sp.se),
        pooled ? f2(100 * Math.sqrt(p * (1 - p) / A)) : INS,
        sp.sd === null ? INS : f1(Math.max(3, 2 * sp.sd)),
        pc(B.wins, B.runs), Math.min.apply(null, arr) + '-' + Math.max.apply(null, arr)].join(' | ') + ' |');
    });
  });
  L.push('');
  if (short.length) L.push('Left out, ' + INS + ' (fewer than ' + SAMPLE.pooledArrivals + ' arrivals pooled): ' + short.join(', ') + '.');
  L.push('');
}

function phaseTables(docs, a, stake, L) {
  L.push('### Final duel by phase, stake ' + stake);
  L.push('');
  L.push('turns = p10/p50/p90 (mean); ≤2 dec = phases settled within 2 decisive (non-clash) exchanges; ≤2 t = within 2 turns; clash = clashes / turns;');
  L.push('7+, rupt, lock = share of phases with a 7+ hit on the player, a Rupture, ' + SIM.BORED_AFTER + '+ clashes in a row at 3 pips; bored = escapes (turns / phases);');
  L.push('truth = honest share of the turns on which a stance was shown (shown turns). Rows with fewer than ' + SAMPLE.pooledArrivals + ' arrivals: ' + INS + '.');
  L.push('');
  a.faces.forEach(function (face) {
    const def = R.Run.BOSSES.filter(function (b) { return b.id === face; })[0];
    const res = docs[face + '/' + stake].results[face];
    L.push('**' + def.name + '** (`' + face + '`, stake ' + stake + ')');
    L.push('');
    L.push('| bot | phase | exploit | arrive | win % | ±SE | turns | ≤2 dec % | ≤2 t % | clash % | 7+ % | rupt % | lock % | bored | truth % (shown) |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    MAIN_BOTS.forEach(function (b) {
      const B = res[b];
      if (!B) return;
      for (let k = 1; k <= def.phases.length; k++) {
        const g = B.phase[String(k)], ex = SIM.phaseCfg(face, stake, k).exploit;
        const head = [b, k + ' ' + def.phases[k - 1].name, ex, g.n];
        if (g.n < SAMPLE.pooledArrivals) { L.push('| ' + head.concat([INS, '', '', '', '', '', '', '', '', '', '']).join(' | ') + ' |'); continue; }
        const sp = spread(B.perChain.map(function (c) { return [c.phase[String(k)].w, c.phase[String(k)].n]; }));
        const turns = quantileOf(g.hist, 0.1) + '/' + quantileOf(g.hist, 0.5) + '/' + quantileOf(g.hist, 0.9) + ' (' + f2(g.turns / g.n) + ')';
        L.push('| ' + head.concat([pc(g.w, g.n), sp.se === null ? INS : f1(sp.se), turns, pc(g.le2dec, g.n), pc(g.le2t, g.n), pc(g.clash, g.turns),
          pc(g.big7, g.n), pc(g.ruptDuels, g.n), pc(g.lockDuels, g.n), g.bored + '/' + g.boredPhases,
          g.tells ? pc(g.honest, g.tells) + ' (' + g.tells + ')' : 'n/a (no stance shown)']).join(' | ') + ' |');
      }
    });
    L.push('');
  });
}

function srcDigest() {
  const src = path.join(ROOT, 'src'), files = [];
  (function walk(d, rel) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else files.push(r);
    });
  })(src, '');
  files.sort();
  const h = crypto.createHash('sha256');
  files.forEach(function (rel) {
    const t = fs.readFileSync(path.join(src, rel), 'utf8').replace(/\r\n?/g, '\n');
    h.update('src/' + rel + '\n' + Buffer.byteLength(t) + '\n' + t + '\n');
  });
  return { sha: h.digest('hex'), files: files.length };
}
function git(args) {
  const r = cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === null ? null : { status: r.status, out: (r.stdout || '').trim() };
}

function main() {
  const a = parse(process.argv);
  const t0 = Date.now();
  const docs = {};
  a.stakes.forEach(function (s) { a.faces.forEach(function (f) { docs[f + '/' + s] = runCell(a, f, s); }); });
  const L = [];
  const head = git(['rev-parse', 'HEAD']), dirty = git(['diff', '--quiet', 'HEAD', '--', 'src']), dg = srcDigest();
  L.push('## Noise baseline (same code)');
  L.push('');
  L.push('- commit `' + (head && head.status === 0 ? head.out : 'unknown') + '`' + (dirty && dirty.status === 1 ? ' (src differs from that commit)' : '') +
         '; src sha256 (LF-normalised path+length+content, ' + dg.files + ' files) `' + dg.sha + '`; node ' + process.version + '.');
  L.push('- ' + a.seeds + ' chains x ' + a.runs + ' sequential runs per bot, seed ' + a.seed + ', all unlocks, no combos; one sim process per face and stake, no --label:');
  L.push('');
  L.push('```');
  a.stakes.forEach(function (s) { a.faces.forEach(function (f) { L.push('node tools/sim.js ' + cellArgs(a, f, s).join(' ')); }); });
  L.push('```');
  L.push('');
  L.push('- Insufficient sample: a chain counts with ' + SAMPLE.chainArrivals + '+ duel-7 arrivals, a chain SD needs ' + SAMPLE.sdChains + ' counted chains, a pooled value needs ' +
         SAMPLE.pooledArrivals + '+ arrivals. W = runs won, A = runs that reached duel 7. SE = chain SD / √(counted chains); the binomial SE √(p(1-p)/A) is shown for reference.');
  L.push('');
  a.stakes.forEach(function (s) { waTable(docs, a, s, L); });
  a.stakes.forEach(function (s) { phaseTables(docs, a, s, L); });
  process.stdout.write(L.join('\n') + '\n');
  console.error('sim_tables: ' + Object.keys(docs).length + ' cells in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}
main();
