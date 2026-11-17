// SHOW ME MY RIVAL - release gate. Run it before every push.
//
//   node tools/test_all.js [--worktree] [--keep] [--parallel N] [--only <steps>] [--full]
//   node tools/test_all.js --write-baseline [--worktree]
//
// HEAD mode (default) tests the last commit, not the working tree. It refuses (exit 2) while src/ or index.html
// differ from HEAD or src/ has untracked files, exports HEAD with "git -c core.autocrlf=false archive" into a new
// temp folder and runs every step there, so uncommitted tools/ changes are NOT what runs (a NOTE row says so).
// --worktree runs the same steps on the working tree (banner: WORKTREE MODE).
//
// Steps: in-sync (a fresh build of src equals index.html once line endings are normalised), check (tools/check.js
// on that build), check-docs-names (tools/check.js --docs: the name lint over every tracked .md), the suites as
// concurrent child processes (FLOW_* and RIVAL_* variables removed from their environment), the corrupt section
// of test_flow in full mode at seeds 1-3, check_docs when the tree has it, the sim digest (8 cells, compared exactly
// with tools/baseline.json), the seal trace (compared with baseline.json), degeneracy bounds on the digest, then
// test_combat and test_brain one at a time (both have wall-clock assertions).
//
// KNOWN rows: a suite prints "KNOWN <id> <push>: <text>" for a known-open defect; the id must be registered in
// tools/known.json for that suite, and a registered row its step no longer prints is a FAIL (stale). Any other
// line starting with KNOWN is a FAIL. "INFO <id>: <text>" lines are listed after the table.
//
// Output: one table row per step (PASS / FAIL / KNOWN / WARN / NOTE, time, detail), the tail of the log of every
// failed step, and "TOTAL: ...". Exit 0 = no FAIL, 1 = any FAIL, 2 = refused or git error. Logs go to a temp folder
// that is removed at the end unless --keep. Nothing is written anywhere else, except that --write-baseline writes
// tools/baseline.json in the working tree (never automatically).
//
//   --parallel N   at most N concurrent child processes (a digest cell counts 2; default: CPU threads - 2); alias --jobs.
//                  The digest cells themselves always run the sim with --jobs 2 (part of the baseline args).
//   --only a,b     run only these steps or groups (in-sync, check, suites, corrupt, digest, bounds (= digest), sealtrace,
//                  test_brain, or a step name such as test_flow); an unknown name is refused (exit 2); a partial run is
//                  not a release verdict
//   --full         also run tools/test_flow.js with 200 runs (all default sections, not quick)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const T0 = Date.now();

// ------------------------------------------------------------------ constants
const FACES = ['unmasked', 'three_faced', 'hours', 'reflection'];
const STAKES = [0, 7];
const DIGEST_ARGS = ['--json', '--seed', '1', '--seeds', '2', '--runs', '60', '--no-combos', '--unlocks', 'all'];
function cellArgs(face, stake) { return DIGEST_ARGS.concat(['--set', 'boss=' + face, '--set', 'stake=' + stake, '--jobs', '2']); }
function cellKey(face, stake) { return face + '/' + stake; }
// Degeneracy bounds (final-duel phases only; duels 1-6 are reported as INFO).
const BOUND = { minSample: 200, lockPct: 1.0, runWinGap: 0.10, honestLo: 0.10, honestHi: 0.95, moveWin: 0.60 };
const REPORT_MIN = 100;                               // report-only table: smaller samples print "insufficient sample"
// Columns kept per digest cell in tools/baseline.json (the per-column diff on a mismatch).
const RUN_COLS = ['runs', 'wins', 'chains', 'duels', 'turns', 'reach', 'big7', 'maxHit', 'ruptDuels', 'lockDuels', 'coerced', 'final.a', 'final.w',
  'deathAt.0', 'deathAt.1', 'deathAt.2', 'deathAt.3', 'deathAt.4', 'deathAt.5', 'deathAt.6', 'deathAt.7', 'deathAt.8', 'deathAt.9', 'lifeScore', 'trust'];
const SEG_COLS = ['n', 'w', 'deaths', 'turns', 'hpIn', 'hpOut', 'tells', 'honest', 'trap', 'counter', 'mirror', 'rWin', 'pWin', 'clash', 'big7',
  'ruptDuels', 'lockDuels', 'mv.S.ex', 'mv.S.pWin', 'mv.S.rWin', 'mv.G.ex', 'mv.G.pWin', 'mv.G.rWin', 'mv.F.ex', 'mv.F.pWin', 'mv.F.rWin'];
const BOTS_REQUIRED = ['guard', 'truster', 'mixer'];
const DIGEST_FAIL_TEXT = 'pure-module behaviour changed: confirm intended, regenerate the baseline in this commit, run the per-face protocol';

// ------------------------------------------------------------------ arguments
const opt = { worktree: false, keep: false, writeBaseline: false, full: false, parallel: Math.max(2, os.cpus().length - 2), only: null, onlyRaw: null };
const CELL_STEPS = FACES.reduce(function (a, f) { return a.concat(STAKES.map(function (s) { return 'digest ' + cellKey(f, s); })); }, []);
// Every step name --only accepts is listed here (a group, or a member of one); main() checks that the step table
// below has no step missing from it.
const GROUPS = {
  'in-sync': ['in-sync'], check: ['check', 'check-docs-names'], corrupt: ['corrupt-1', 'corrupt-2', 'corrupt-3'], sealtrace: ['sealtrace'], test_brain: ['test_brain'],
  digest: CELL_STEPS.concat(['bounds']),
  bounds: CELL_STEPS.concat(['bounds']),                  // the bounds are computed from the digest cells
  suites: ['test_combat', 'test_flow', 'test_audio', 'test_scenes', 'check_text', 'test_rules', 'test_sim', 'playtest', 'lint_pure', 'check_docs', 'check-docs-names'],
  'test_flow-full': ['test_flow-full']                    // runs only together with --full
};
const STEP_NAMES = new Set();
Object.keys(GROUPS).forEach(function (g) { GROUPS[g].forEach(function (s) { STEP_NAMES.add(s); }); });
function usage(msg) {
  console.error('test_all: ' + msg);
  console.error('usage: node tools/test_all.js [--worktree] [--keep] [--parallel N] [--only <steps>] [--full] | --write-baseline [--worktree]');
  process.exit(2);
}
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--worktree') opt.worktree = true;
    else if (a === '--keep') opt.keep = true;
    else if (a === '--write-baseline') opt.writeBaseline = true;
    else if (a === '--full') opt.full = true;
    else if (a === '--parallel' || a === '--jobs') {
      const v = argv[++i];
      if (!/^\d+$/.test(v || '') || +v < 1) usage(a + ' needs a positive integer');
      opt.parallel = +v;
    } else if (a === '--only') {
      const v = argv[++i];
      if (!v) usage('--only needs a list of steps');
      opt.only = new Set();
      opt.onlyRaw = [];
      const bad = [];
      for (const name of v.split(',')) {
        const n = name.trim();
        if (!n) continue;
        if (!GROUPS[n] && !STEP_NAMES.has(n)) { bad.push(n); continue; }
        opt.onlyRaw.push(n);
        (GROUPS[n] || [n]).forEach(function (s) { opt.only.add(s); });
      }
      if (bad.length) {
        usage('--only: unknown step or group ' + bad.map(function (s) { return '"' + s + '"'; }).join(', ') + '; groups: ' + Object.keys(GROUPS).join(', ') +
          '; steps: ' + Array.from(STEP_NAMES).filter(function (s) { return !GROUPS[s]; }).join(', '));
      }
      if (!opt.only.size) usage('--only needs at least one step');
      if (opt.only.has('test_flow-full') && !opt.full) usage('--only test_flow-full needs --full');
    } else usage('unknown argument ' + a);
  }
}
function wanted(step) {
  if (!opt.only) return true;
  if (opt.only.has(step)) return true;
  if (/^digest /.test(step) && opt.only.has('digest')) return true;
  return false;
}

// ------------------------------------------------------------------ helpers
function lf(s) { return String(s).replace(/\r\n?/g, '\n'); }
function sha256(x) { return crypto.createHash('sha256').update(x).digest('hex'); }
function secs(ms) { return (ms / 1000).toFixed(1) + ' s'; }
function pct(x) { return (100 * x).toFixed(1) + '%'; }
function rel(p) { return path.relative(REPO, p).split(path.sep).join('/'); }
function git(args, opts) {
  return cp.spawnSync('git', args, Object.assign({ cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true }, opts || {}));
}
function gitOut(args) { const r = git(args); return r.status === 0 ? r.stdout : null; }
function isGitRepo() {
  const r = git(['rev-parse', '--show-toplevel']);
  if (r.status !== 0 || !r.stdout) return false;
  try { return fs.realpathSync(path.resolve(r.stdout.trim())).toLowerCase() === fs.realpathSync(REPO).toLowerCase(); } catch (e) { return false; }
}
function blobAt(rev, file) {                         // file content at a revision, or null when absent
  const r = git(['cat-file', '-e', rev + ':' + file]);
  if (r.status !== 0) return null;
  const s = git(['show', rev + ':' + file]);
  return s.status === 0 ? s.stdout : null;
}
function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(p);
    }
  })(dir);
  return out;
}
// SHA-256 over the concatenation, in sorted path order, of "<posix path from the repo root>\0<LF content>\0" for
// every file under the given folder (src/ for srcSha256). Identical for an LF and a CRLF checkout.
function treeDigest(root, sub) {
  const dir = path.join(root, sub);
  if (!fs.existsSync(dir)) return null;
  const files = listFiles(dir).map(function (p) { return path.relative(root, p).split(path.sep).join('/'); }).sort();
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(f + '\0' + lf(fs.readFileSync(path.join(root, f), 'utf8')) + '\0', 'utf8');
  return { sha: h.digest('hex'), files: files.length };
}
function fileDigest(root, relPath) {
  const p = path.join(root, relPath);
  if (!fs.existsSync(p)) return null;
  return sha256(relPath + '\0' + lf(fs.readFileSync(p, 'utf8')) + '\0');
}
function getPath(o, p) { return p.split('.').reduce(function (v, k) { return v === null || v === undefined ? undefined : v[k]; }, o); }
function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function segOrder(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return +a - +b;
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sortKeys(v[k]); }); return o; }
  return v;
}
// JSON with sorted keys; arrays of plain values stay on one line (so a baseline diff shows one line per row).
function fmtJson(v, ind) {
  ind = ind || '';
  if (Array.isArray(v)) {
    if (v.every(function (x) { return x === null || typeof x !== 'object'; })) return '[' + v.map(function (x) { return JSON.stringify(x); }).join(', ') + ']';
    return '[\n' + v.map(function (x) { return ind + '  ' + fmtJson(x, ind + '  '); }).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const ks = Object.keys(v).sort();
    if (!ks.length) return '{}';
    return '{\n' + ks.map(function (k) { return ind + '  ' + JSON.stringify(k) + ': ' + fmtJson(v[k], ind + '  '); }).join(',\n') + '\n' + ind + '}';
  }
  return JSON.stringify(v);
}
function tail(text, n) { const L = lf(text).replace(/\s+$/, '').split('\n'); return L.slice(Math.max(0, L.length - n)); }
function lastLine(text) { const L = lf(text).split('\n').map(function (s) { return s.trim(); }).filter(Boolean); return L.length ? L[L.length - 1] : ''; }
// The most telling line of a failed child: the first error or FAIL line, else the last line.
function errLine(text) {
  const L = lf(text).split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
  const e = L.find(function (x) { return /^(\w*Error\b|FAIL\b)/.test(x); });
  return e || (L.length ? L[L.length - 1] : '');
}
function clip(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 3) + '...' : s; }

// ------------------------------------------------------------------ rows
const rows = [];
const afterTable = [];                                // extra blocks printed after the table
const infos = [];
function addRow(step, result, ms, detail, log) { rows.push({ step: step, result: result, ms: ms, detail: detail || '', log: log || null }); }

// ------------------------------------------------------------------ preflight: refusal, temp folder, export
const gitOk = isGitRepo();
const headSha = gitOk ? (gitOut(['rev-parse', '--short', 'HEAD']) || '?').trim() : 'no-git';
if (!opt.worktree) {
  if (!gitOk) { console.error('test_all: ' + REPO + ' is not a git repository; use --worktree to test the files as they are'); process.exit(2); }
  const d = git(['diff', '--quiet', 'HEAD', '--', 'src', 'index.html']);
  const u = git(['ls-files', '--others', '--exclude-standard', '--', 'src']);
  if ((d.status !== 0 && d.status !== 1) || u.status !== 0) { console.error('test_all: git error: ' + (d.stderr || u.stderr)); process.exit(2); }
  const changed = d.status === 1 ? (gitOut(['diff', '--name-only', 'HEAD', '--', 'src', 'index.html']) || '').trim().split('\n').filter(Boolean) : [];
  const untracked = u.stdout.trim().split('\n').filter(Boolean);
  if (changed.length || untracked.length) {
    console.error('test_all: refused: HEAD mode tests the last commit, and these differ from it:');
    for (const f of changed) console.error('  changed    ' + f);
    for (const f of untracked) console.error('  untracked  ' + f);
    console.error('Commit them (and rebuild index.html), or run node tools/test_all.js --worktree to test the working tree.');
    process.exit(2);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rival-gate-'));
const LOGS = path.join(TMP, 'logs');
fs.mkdirSync(LOGS);
let TREE = REPO;
const live = new Set();
function cleanup() {
  for (const ch of live) { try { ch.kill(); } catch (e) { /* gone */ } }
  if (!opt.keep) { try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* best effort */ } }
}
process.on('SIGINT', function () { console.error('\ntest_all: interrupted'); cleanup(); process.exit(1); });

if (!opt.worktree) {
  const t = Date.now();
  const tar = path.join(TMP, 'head.tar');
  const a = git(['-c', 'core.autocrlf=false', 'archive', '--format=tar', '-o', tar, 'HEAD']);
  TREE = path.join(TMP, 'tree');
  fs.mkdirSync(TREE);
  const x = a.status === 0 ? cp.spawnSync('tar', ['-xf', 'head.tar', '-C', 'tree'], { cwd: TMP, encoding: 'utf8', windowsHide: true }) : null;
  if (a.status !== 0 || !x || x.status !== 0) {
    console.error('test_all: could not export HEAD: ' + (a.status !== 0 ? a.stderr : x && (x.stderr || x.error)));
    cleanup();
    process.exit(2);
  }
  try { fs.unlinkSync(tar); } catch (e) { /* kept */ }
  addRow('export', 'PASS', Date.now() - t, 'git archive HEAD ' + headSha + ' (LF blobs) into the temp folder');
}

// ------------------------------------------------------------------ notes about what is (not) tested
if (!opt.worktree && gitOk) {
  const mod = (gitOut(['diff', '--name-only', 'HEAD', '--', 'tools']) || '').trim().split('\n').filter(Boolean);
  const unt = (gitOut(['ls-files', '--others', '--exclude-standard', '--', 'tools']) || '').trim().split('\n').filter(Boolean);
  const self = blobAt('HEAD', 'tools/test_all.js');
  if (self === null) addRow('self', 'NOTE', 0, 'tools/test_all.js is not in HEAD: this run uses the working copy as the orchestrator');
  else if (lf(self) !== lf(fs.readFileSync(__filename, 'utf8'))) addRow('self', 'NOTE', 0, 'tools/test_all.js differs from HEAD: this run uses the working copy as the orchestrator');
  if (mod.length || unt.length) {
    addRow('uncommitted', 'NOTE', 0, (mod.length + unt.length) + ' uncommitted file(s) under tools/ are NOT tested in HEAD mode: ' +
      clip(mod.concat(unt).join(', '), 140));
  }
}
if (!gitOk) addRow('git', 'NOTE', 0, 'not a git repository: the BASELINE CHANGED checks are skipped');

// ------------------------------------------------------------------ registry and baseline of the tree being tested
function readJson(p) { try { return { v: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) { return { err: e.code === 'ENOENT' ? 'missing' : String(e.message) }; } }
const knownRead = readJson(path.join(TREE, 'tools', 'known.json'));
const KNOWN = new Map();
if (knownRead.v && Array.isArray(knownRead.v.known)) for (const k of knownRead.v.known) KNOWN.set(k.id, k);
const baseRead = readJson(path.join(TREE, 'tools', 'baseline.json'));
const BASE = baseRead.v || null;

// ------------------------------------------------------------------ child processes
function childEnv(extra) {
  const env = {};
  for (const k of Object.keys(process.env)) if (!/^(FLOW_|RIVAL_)/i.test(k)) env[k] = process.env[k];
  return Object.assign(env, extra || {});
}
function logName(step) { return path.join(LOGS, step.replace(/[^A-Za-z0-9_.-]+/g, '_') + '.txt'); }
function runChild(task) {
  return new Promise(function (resolve) {
    const t = Date.now();
    const script = path.join(TREE, task.script);
    const out = [], all = [];
    let ch;
    const head = '$ ' + Object.keys(task.env || {}).map(function (k) { return k + '=' + task.env[k] + ' '; }).join('') + 'node ' + task.script + ' ' + task.args.join(' ') + '\n(cwd ' + TREE + ')\n\n';
    try {
      ch = cp.spawn(process.execPath, [script].concat(task.args), { cwd: TREE, env: childEnv(task.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ code: -1, error: String(e), stdout: '', stdoutBuf: Buffer.alloc(0), all: '', ms: Date.now() - t, log: null });
    }
    live.add(ch);
    let timedOut = false;
    const timer = setTimeout(function () { timedOut = true; try { ch.kill(); } catch (e) { /* gone */ } }, task.timeout || 15 * 60 * 1000);
    ch.stdout.on('data', function (b) { out.push(b); all.push(b); });
    ch.stderr.on('data', function (b) { all.push(b); });
    function done(code, err) {
      clearTimeout(timer);
      live.delete(ch);
      const ms = Date.now() - t;
      const buf = Buffer.concat(out);
      const allText = Buffer.concat(all).toString('utf8');
      const log = logName(task.step);
      try {
        const body = task.digest ? '(stdout: ' + buf.length + ' bytes of JSON, kept in ' + path.basename(log, '.txt') + '.json)\n' + Buffer.concat(all.filter(function (b) { return out.indexOf(b) < 0; })).toString('utf8') : allText;
        fs.writeFileSync(log, head + body + '\n[exit ' + code + (timedOut ? ', timed out' : '') + (err ? ', ' + err : '') + ', ' + secs(ms) + ']\n');
        if (task.digest) fs.writeFileSync(log.replace(/\.txt$/, '.json'), buf);
      } catch (e) { /* the log is best effort */ }
      resolve({ code: code, timedOut: timedOut, error: err || null, stdout: buf.toString('utf8'), stdoutBuf: buf, all: allText, ms: ms, log: log });
    }
    ch.on('error', function (e) { done(-1, String(e)); });
    ch.on('close', function (code, sig) { done(code === null ? (sig ? 'signal ' + sig : -1) : code); });
  });
}
function pool(tasks, slots) {
  return new Promise(function (resolve) {
    const results = new Array(tasks.length);
    let used = 0, next = 0, finished = 0;
    if (!tasks.length) return resolve(results);
    function pump() {
      while (next < tasks.length && (used === 0 || used + tasks[next].weight <= slots)) {
        const k = next++, task = tasks[k];
        used += task.weight;
        runChild(task).then(function (r) {
          results[k] = r; used -= task.weight; finished++;
          if (finished === tasks.length) resolve(results); else pump();
        });
      }
    }
    pump();
  });
}

// ------------------------------------------------------------------ the steps
const SUITES = [
  { step: 'corrupt-1', script: 'tools/test_flow.js', args: ['200', '1'], env: { FLOW_SECTIONS: 'corrupt' }, est: 40 },
  { step: 'corrupt-2', script: 'tools/test_flow.js', args: ['200', '2'], env: { FLOW_SECTIONS: 'corrupt' }, est: 40 },
  { step: 'corrupt-3', script: 'tools/test_flow.js', args: ['200', '3'], env: { FLOW_SECTIONS: 'corrupt' }, est: 40 },
  { step: 'test_flow', script: 'tools/test_flow.js', args: ['--quick'], est: 38 },
  { step: 'test_sim', script: 'tools/test_sim.js', args: [], est: 20, weight: 2 },
  { step: 'playtest', script: 'tools/playtest/play.js', args: ['selftest', '--quick', '--seed', '1', '--profiles', path.join(TMP, 'playtest-profiles')], est: 20 },
  { step: 'sealtrace', script: 'tools/test_flow.js', args: ['--quick'], env: { FLOW_SECTIONS: 'sealtrace' }, est: 15, seal: true },
  { step: 'test_rules', script: 'tools/test_rules.js', args: [], est: 10 },
  { step: 'lint_pure', script: 'tools/lint_pure.js', args: [], est: 6 },
  { step: 'test_scenes', script: 'tools/test_scenes.js', args: [], est: 3 },
  { step: 'check_text', script: 'tools/check_text.js', args: [], est: 1 },
  { step: 'test_audio', script: 'tools/test_audio.js', args: [], est: 1 },
  { step: 'check_docs', script: 'tools/check_docs.js', args: [], est: 1, optional: true },
  { step: 'check-docs-names', script: 'tools/check.js', args: ['--docs'], est: 1 }
];
if (opt.full) SUITES.unshift({ step: 'test_flow-full', script: 'tools/test_flow.js', args: ['200'], est: 300 });
const CELLS = [];
for (const f of FACES) for (const s of STAKES) CELLS.push({ step: 'digest ' + cellKey(f, s), script: 'tools/sim.js', args: cellArgs(f, s), est: 3, weight: 2, digest: { face: f, stake: s } });
// Suites with wall-clock assertions (payoff() time, the brain's commit time) run after the pool, one at a time, so a
// busy machine cannot fail them.
const ALONE = [
  { step: 'test_combat', script: 'tools/test_combat.js', args: ['--quick'], est: 6 },
  { step: 'test_brain', script: 'tools/test_brain.js', args: [], est: 8 }
];
const SCRIPT_OF = {};
SUITES.concat(CELLS, ALONE).forEach(function (t) { SCRIPT_OF[t.step] = t.script; });
// Keep --only honest: a step missing from GROUPS could never be selected on its own.
['in-sync', 'check', 'bounds'].concat(Object.keys(SCRIPT_OF)).forEach(function (s) {
  if (!STEP_NAMES.has(s)) addRow('internal', 'FAIL', 0, 'step ' + s + ' is not listed in GROUPS in tools/test_all.js (--only could not select it)');
});

function present(task) { return fs.existsSync(path.join(TREE, task.script)); }
function missingRow(task) {
  addRow(task.step, 'FAIL', 0, (opt.worktree ? 'suite missing: ' : 'suite not in HEAD: ') + task.script);
}

// in-sync + check (sequential, before the suites)
function stepInSync() {
  const t = Date.now();
  const out = path.join(TMP, 'index.gate.html');
  const buildJs = path.join(TREE, 'tools', 'build.js');
  // A build.js without --out would ignore the flag and rewrite the tree's own index.html: never run it.
  if (!fs.existsSync(buildJs) || !/--out\b/.test(fs.readFileSync(buildJs, 'utf8'))) {
    addRow('in-sync', 'FAIL', Date.now() - t, 'tools/build.js ' + (fs.existsSync(buildJs) ? 'has no --out option' : 'is missing') + ' in the tree being tested: cannot build it apart from index.html');
    return null;
  }
  const b = cp.spawnSync(process.execPath, [buildJs, '--out', out], { cwd: TREE, encoding: 'utf8', env: childEnv(), windowsHide: true });
  fs.writeFileSync(logName('in-sync'), '$ node tools/build.js --out ' + out + '\n' + (b.stdout || '') + (b.stderr || '') + '\n[exit ' + b.status + ']\n');
  if (b.status !== 0 || !fs.existsSync(out)) { addRow('in-sync', 'FAIL', Date.now() - t, 'tools/build.js --out failed (exit ' + b.status + ')', logName('in-sync')); return null; }
  const idx = path.join(TREE, 'index.html');
  if (!fs.existsSync(idx)) { addRow('in-sync', 'FAIL', Date.now() - t, 'index.html is missing: run node tools/build.js'); return out; }
  const fresh = lf(fs.readFileSync(out, 'utf8')), shipped = lf(fs.readFileSync(idx, 'utf8'));
  if (fresh === shipped) {
    addRow('in-sync', 'PASS', Date.now() - t, 'index.html equals a fresh build of src (' + fs.statSync(out).size + ' bytes, LF-normalised)');
  } else {
    const A = shipped.split('\n'), B = fresh.split('\n');
    let i = 0;
    while (i < A.length && i < B.length && A[i] === B[i]) i++;
    addRow('in-sync', 'FAIL', Date.now() - t, 'index.html is stale: run node tools/build.js (first difference at line ' + (i + 1) + '; index.html ' +
      fs.statSync(idx).size + ' bytes, fresh build ' + fs.statSync(out).size + ' bytes)', logName('in-sync'));
  }
  return out;
}
function stepCheck(built) {
  const t = Date.now();
  const target = built || path.join(TREE, 'index.html');
  const c = cp.spawnSync(process.execPath, [path.join(TREE, 'tools', 'check.js'), target], { cwd: TREE, encoding: 'utf8', env: childEnv(), windowsHide: true });
  const text = (c.stdout || '') + (c.stderr || '');
  fs.writeFileSync(logName('check'), '$ node tools/check.js ' + target + '\n' + text + '\n[exit ' + c.status + ']\n');
  const warns = lf(c.stdout || '').split('\n').filter(function (l) { return /^WARN /.test(l); });
  if (c.status !== 0) {
    const first = lf(c.stderr || '').split('\n').filter(function (l) { return /^\s+- /.test(l); });
    addRow('check', 'FAIL', Date.now() - t, clip(first.length ? first.length + ' problem(s); first: ' + first[0].trim().replace(/^- /, '') : lastLine(text), 170), logName('check'));
  } else if (warns.length) addRow('check', 'WARN', Date.now() - t, warns.join(' | '));
  else addRow('check', 'PASS', Date.now() - t, lastLine(c.stdout || '') + (built ? '' : ' (on index.html: there is no gate build)'));
}

// ------------------------------------------------------------------ digest and baseline
function cellRows(doc, face) {
  const res = doc && doc.results && doc.results[face];
  if (!res) throw new Error('the sim JSON has no results.' + face);
  const out = {};
  for (const bot of Object.keys(res).sort()) {
    const B = res[bot];
    out[bot + ' run'] = RUN_COLS.map(function (c) { return numOrNull(getPath(B, c)); });
    for (const k of Object.keys(B.duel || {}).sort(segOrder)) out[bot + ' d' + k] = SEG_COLS.map(function (c) { return numOrNull(getPath(B.duel[k], c)); });
    for (const k of Object.keys(B.phase || {}).sort(segOrder)) out[bot + ' p' + k] = SEG_COLS.map(function (c) { return numOrNull(getPath(B.phase[k], c)); });
  }
  return out;
}
function diffRows(oldRows, newRows, cols) {
  const out = [];
  const keys = Array.from(new Set(Object.keys(oldRows || {}).concat(Object.keys(newRows || {})))).sort();
  for (const k of keys) {
    const a = oldRows ? oldRows[k] : undefined, b = newRows ? newRows[k] : undefined;
    if (!a) { out.push(k + ': new row'); continue; }
    if (!b) { out.push(k + ': row gone'); continue; }
    const names = / run$/.test(k) ? cols.run : cols.seg;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(k + ' ' + (names[i] || '#' + i) + ': ' + a[i] + ' -> ' + b[i]);
  }
  return out;
}
// Did tools/baseline.json change? HEAD mode: HEAD against HEAD^1 ("IN THIS COMMIT") and against the merge-base with
// origin/main ("SINCE origin/main"). --worktree: the working file against HEAD and against that merge-base.
function baselineChanges() {
  const out = { inCommit: false, since: false, notes: [] };
  if (!gitOk) return out;
  const tested = fs.existsSync(path.join(TREE, 'tools', 'baseline.json')) ? lf(fs.readFileSync(path.join(TREE, 'tools', 'baseline.json'), 'utf8')) : null;
  if (tested === null) return out;
  function differs(rev) { const b = blobAt(rev, 'tools/baseline.json'); return b === null || lf(b) !== tested; }
  if (opt.worktree) out.inCommit = differs('HEAD');
  else {
    const parent = gitOut(['rev-parse', '--verify', '-q', 'HEAD^1']);
    if (parent) out.inCommit = differs(parent.trim());
    else {
      const r = gitOut(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD', '--', 'tools/baseline.json']);
      out.inCommit = !!(r && r.trim());
    }
  }
  const om = gitOut(['rev-parse', '--verify', '-q', 'origin/main']);
  if (om) {
    const mb = gitOut(['merge-base', 'HEAD', om.trim()]);
    if (mb) out.since = differs(mb.trim());
    else out.notes.push('no merge-base with origin/main');
  } else out.notes.push('no origin/main ref: the SINCE origin/main check is skipped');
  return out;
}

// ------------------------------------------------------------------ degeneracy bounds (final-duel phases)
// Every field a bound reads must be a finite number: a renamed or missing field would otherwise compare as NaN and
// pass silently. A cell with a missing field or a missing required bot is not evaluated; the "bounds" row FAILs.
const NEED_BOT = ['runs', 'wins', 'coerced'];
const NEED_SEG = ['n', 'lockDuels', 'tells', 'honest', 'mv.S.ex', 'mv.S.pWin', 'mv.G.ex', 'mv.G.pWin', 'mv.F.ex', 'mv.F.pWin'];
function boundsSchema(key, face, res) {
  const errs = [];
  if (!res || typeof res !== 'object') return [key + ': results.' + face];
  for (const b of BOTS_REQUIRED) if (!res[b] || typeof res[b] !== 'object') errs.push(key + ': bot ' + b + ' (required by the run-win bound)');
  const bots = Object.keys(res).sort();
  const phaseKeys = new Set();
  for (const b of bots) {
    const ph = res[b] && res[b].phase;
    if (ph && typeof ph === 'object') Object.keys(ph).forEach(function (k) { phaseKeys.add(k); });
  }
  if (!phaseKeys.size) errs.push(key + ': results.' + face + '.<bot>.phase (no final-duel phases)');
  for (const b of bots) {
    const B = res[b];
    if (!B || typeof B !== 'object') { errs.push(key + ' ' + b); continue; }
    for (const c of NEED_BOT) if (numOrNull(getPath(B, c)) === null) errs.push(key + ' ' + b + '.' + c);
    for (const k of Array.from(phaseKeys).sort(segOrder)) for (const c of NEED_SEG) if (numOrNull(getPath(B.phase && B.phase[k], c)) === null) errs.push(key + ' ' + b + '.phase.' + k + '.' + c);
    for (let d = 1; d <= 6; d++) for (const c of NEED_SEG) if (numOrNull(getPath(B.duel && B.duel[d], c)) === null) errs.push(key + ' ' + b + '.duel.' + d + '.' + c);
  }
  return errs;
}
function bounds(docs) {
  const R = { lock: { fails: [], tested: 0, insufficient: 0, max: 0 }, run: { fails: [], tested: 0, insufficient: 0 }, honest: { fails: [], tested: 0, insufficient: 0, nostance: 0 },
              move: { fails: [], tested: 0, insufficient: 0, max: 0 }, coerce: { fails: [], tested: 0 }, early: { honest: [], move: [], lock: [] }, schema: [], checked: 0 };
  for (const key of Object.keys(docs).sort()) {
    const { face, doc } = docs[key];
    const res = doc.results && doc.results[face];
    const errs = boundsSchema(key, face, res);
    if (errs.length) { for (const e of errs) R.schema.push(e); continue; }
    R.checked++;
    const bots = Object.keys(res).sort();
    // (5) the Rival's sealed move is never replaced at resolve
    for (const b of bots) { R.coerce.tested++; if (res[b].coerced) R.coerce.fails.push(key + ' ' + b + ': ' + res[b].coerced + ' Rival coercion(s)'); }
    // (2) guard / truster run win <= mixer run win + 10 points (sample: the runs of the two bots compared)
    if (res.mixer) {
      for (const b of ['guard', 'truster']) {
        if (!res[b]) continue;
        const n = res[b].runs + res.mixer.runs;
        if (n < BOUND.minSample) { R.run.insufficient++; continue; }
        R.run.tested++;
        const wb = res[b].wins / res[b].runs, wm = res.mixer.wins / res.mixer.runs;
        if (wb > wm + BOUND.runWinGap) R.run.fails.push(key + ' ' + b + ' run win ' + pct(wb) + ' > mixer ' + pct(wm) + ' + 10 points');
      }
    }
    const phases = Object.keys(res[bots[0]].phase || {}).sort(segOrder);
    for (const k of phases) {
      // (1) lock% pooled over bots
      let n = 0, lock = 0;
      for (const b of bots) { n += res[b].phase[k].n; lock += res[b].phase[k].lockDuels; }
      if (n < BOUND.minSample) R.lock.insufficient++;
      else {
        R.lock.tested++;
        const p = 100 * lock / n;
        if (p > R.lock.max) R.lock.max = p;
        if (p > BOUND.lockPct) R.lock.fails.push(key + ' phase ' + k + ': lock ' + p.toFixed(2) + '% (' + lock + ' of ' + n + ' phases)');
      }
      for (const b of bots) {
        const g = res[b].phase[k];
        // (3) honesty on stance-shown turns
        if (!g.tells) R.honest.nostance++;
        else if (g.tells < BOUND.minSample) R.honest.insufficient++;
        else {
          R.honest.tested++;
          const h = g.honest / g.tells;
          if (h < BOUND.honestLo || h > BOUND.honestHi) R.honest.fails.push(key + ' phase ' + k + ' ' + b + ': honesty ' + h.toFixed(3) + ' over ' + g.tells + ' shown turns');
        }
        // (4) no player move wins more than 60% of its exchanges
        for (const m of ['S', 'G', 'F']) {
          const mv = g.mv && g.mv[m];
          if (!mv || mv.ex < BOUND.minSample) { R.move.insufficient++; continue; }
          R.move.tested++;
          const w = mv.pWin / mv.ex;
          if (w > R.move.max) R.move.max = w;
          if (w > BOUND.moveWin) R.move.fails.push(key + ' phase ' + k + ' ' + b + ': ' + m + ' wins ' + pct(w) + ' of ' + mv.ex + ' exchanges');
        }
      }
    }
    // duels 1-6: the same bounds, report-only
    for (let d = 1; d <= 6; d++) {
      const k = String(d);
      let n = 0, lock = 0;
      for (const b of bots) { const g = res[b].duel && res[b].duel[k]; if (g) { n += g.n; lock += g.lockDuels; } }
      if (n >= BOUND.minSample && 100 * lock / n > BOUND.lockPct) R.early.lock.push(key + ' d' + k + ' ' + (100 * lock / n).toFixed(2) + '%');
      for (const b of bots) {
        const g = res[b].duel && res[b].duel[k];
        if (!g) continue;
        if (g.tells >= BOUND.minSample) { const h = g.honest / g.tells; if (h < BOUND.honestLo || h > BOUND.honestHi) R.early.honest.push(key + ' d' + k + ' ' + b + ' ' + h.toFixed(3)); }
        for (const m of ['S', 'G', 'F']) {
          const mv = g.mv && g.mv[m];
          if (mv && mv.ex >= BOUND.minSample && mv.pWin / mv.ex > BOUND.moveWin) R.early.move.push({ s: key + ' d' + k + ' ' + b + ' ' + m + ' ' + pct(mv.pWin / mv.ex), w: mv.pWin / mv.ex });
        }
      }
    }
  }
  return R;
}
function boundRow(name, r, what) {
  if (r.fails.length) { addRow(name, 'FAIL', 0, r.fails.length + ' violation(s); first: ' + r.fails[0]); afterTable.push({ title: name + ' violations', lines: r.fails.slice(0, 40) }); }
  else if (!r.tested) addRow(name, 'NOTE', 0, (r.noCells ? 'no digest cell could be checked' : 'insufficient sample in every cell') + ' (' + what + ')');
  else addRow(name, 'PASS', 0, r.tested + ' tested, ' + (r.insufficient || 0) + ' insufficient sample' + (r.extra ? '; ' + r.extra : '') + ' (' + what + ')');
}
// Report-only figures with standard errors (kept in the logs).
function reportTable(docs) {
  const L = ['report-only: per face/stake and bot: run win, final-duel win given arrival (W/A), clash%, rupt%, 7+ hit%, each +-SE (n); n < ' + REPORT_MIN + ' = insufficient sample', ''];
  function f(x, n) { if (n < REPORT_MIN) return 'insufficient sample (n ' + n + ')'; const p = x / n; return pct(p) + ' +-' + (100 * Math.sqrt(p * (1 - p) / n)).toFixed(1) + ' (n ' + n + ')'; }
  for (const key of Object.keys(docs).sort()) {
    const { face, doc } = docs[key];
    const res = doc.results[face];
    L.push(key);
    for (const b of Object.keys(res).sort()) {
      const B = res[b];
      let turns = 0, clash = 0;
      for (const k of Object.keys(B.duel || {})) if (k !== 'P2+') { turns += B.duel[k].turns; clash += B.duel[k].clash; }
      if (B.duel && B.duel['P2+']) { turns += B.duel['P2+'].turns; clash += B.duel['P2+'].clash; }
      L.push('  ' + (b + '          ').slice(0, 10) + 'run win ' + f(B.wins, B.runs) + ' | W/A ' + f(B.final.w, B.final.a) + ' | clash ' + f(clash, turns) +
        ' | rupt ' + f(B.ruptDuels, B.duels) + ' | 7+ ' + f(B.big7, B.duels));
    }
  }
  return L;
}

// ------------------------------------------------------------------ KNOWN rows
function scanLines(step, stdout, found, malformed) {
  for (const line of lf(stdout).split('\n')) {
    const m = /^KNOWN (\S+) (\S+): (.+)$/.exec(line);
    if (m) { (found[m[1]] = found[m[1]] || []).push({ step: step, push: m[2], text: m[3].trim() }); continue; }
    if (/^\s*KNOWN/.test(line)) { malformed.push(step + ': ' + clip(line.trim(), 160)); continue; }
    const i = /^INFO (\S+): (.*)$/.exec(line);
    if (i) infos.push({ step: step, id: i[1], text: i[2] });
  }
}

// ------------------------------------------------------------------ main
(async function main() {
  const steps = [];                                   // [{task, r}]
  // 1. in-sync and check
  let built = null;
  if (!opt.writeBaseline) {
    if (wanted('in-sync') || wanted('check')) built = stepInSync();
    const at = rows.findIndex(function (r) { return r.step === 'in-sync'; });
    if (!wanted('in-sync') && at >= 0) rows.splice(at, 1);
    if (wanted('check')) stepCheck(built);
  }
  // 2. concurrent children
  const tasks = [];
  const pick = opt.writeBaseline ? SUITES.filter(function (t) { return t.seal; }).concat(CELLS) : SUITES.concat(CELLS);
  for (const t of pick) {
    if (!opt.writeBaseline && !wanted(t.step)) continue;
    if (!present(t)) {
      if (t.optional) addRow(t.step, 'NOTE', 0, t.script + ' is not in the tree being tested: step skipped');
      else missingRow(t);
      continue;
    }
    tasks.push(Object.assign({ weight: 1 }, t));
  }
  tasks.sort(function (a, b) { return b.est - a.est; });
  const results = await pool(tasks, opt.parallel);
  tasks.forEach(function (t, i) { steps.push({ task: t, r: results[i] }); });
  // 3. the wall-clock suites, one at a time
  for (const t of ALONE) {
    if (opt.writeBaseline || !wanted(t.step)) continue;
    if (!present(t)) missingRow(t);
    else { const r = await runChild(Object.assign({ weight: 1 }, t)); steps.push({ task: t, r: r }); }
  }

  // ---- evaluate
  const found = {}, malformed = [];
  const ran = {};
  const docs = {};
  let sealHex = null;
  const cellResults = {};
  for (const { task, r } of steps) {
    ran[task.step] = r;
    scanLines(task.step, r.stdout, found, malformed);
    if (task.digest) { cellResults[task.step] = { task: task, r: r }; continue; }
    if (r.timedOut) { addRow(task.step, 'FAIL', r.ms, 'timed out', r.log); continue; }
    if (r.code !== 0) {
      const firstFail = lf(r.stdout).split('\n').find(function (l) { return /^FAIL\b/.test(l.trim()); });
      addRow(task.step, 'FAIL', r.ms, 'exit ' + r.code + (firstFail ? ': ' + firstFail.trim() : (errLine(r.all) ? ': ' + clip(errLine(r.all), 120) : '')), r.log);
      continue;
    }
    if (task.step === 'playtest' && !/^SELFTEST PASSED/.test(lf(r.stdout).replace(/^\s+/, ''))) { addRow(task.step, 'FAIL', r.ms, 'stdout does not start with SELFTEST PASSED', r.log); continue; }
    if (task.seal) {
      const m = /^SEALTRACE ([0-9a-f]{64})\s*$/m.exec(lf(r.stdout));
      if (!m) { addRow(task.step, 'FAIL', r.ms, 'no "SEALTRACE <sha256>" line in the output (FLOW_SECTIONS=sealtrace test_flow --quick)', r.log); continue; }
      sealHex = m[1];
      if (opt.writeBaseline) { addRow(task.step, 'PASS', r.ms, 'SEALTRACE ' + sealHex.slice(0, 16) + '...'); continue; }
      if (!BASE) addRow(task.step, 'FAIL', r.ms, 'no tools/baseline.json to compare with: run node tools/test_all.js --write-baseline', r.log);
      else if (!BASE.sealTrace) addRow(task.step, 'FAIL', r.ms, 'tools/baseline.json has no sealTrace: regenerate it with --write-baseline', r.log);
      else if (BASE.sealTrace !== sealHex) {
        addRow(task.step, 'FAIL', r.ms, 'seal trace changed: ' + BASE.sealTrace.slice(0, 12) + ' -> ' + sealHex.slice(0, 12) + ': ' + DIGEST_FAIL_TEXT, r.log);
      } else addRow(task.step, 'PASS', r.ms, 'identical to tools/baseline.json (' + sealHex.slice(0, 12) + ')');
      continue;
    }
    if (/test_flow/.test(task.script) && /(^|\D)0 checks\b/.test(lastLine(r.stdout))) { addRow(task.step, 'FAIL', r.ms, 'ran 0 checks (is the section missing?): ' + lastLine(r.stdout), r.log); continue; }
    const summary = task.step === 'playtest' ? lf(r.stdout).replace(/^\s+/, '').split('\n')[0] + '; ' + lastLine(r.stdout) : lastLine(r.stdout);
    addRow(task.step, 'PASS', r.ms, clip(summary, 110));
  }

  // ---- digest cells
  let cellsAllMatch = true, cellsRun = 0;
  const newCells = {};
  for (const c of CELLS) {
    const e = cellResults[c.step];
    if (!e) continue;
    cellsRun++;
    const { task, r } = e;
    const key = cellKey(task.digest.face, task.digest.stake);
    if (r.timedOut || r.code !== 0) { cellsAllMatch = false; addRow(task.step, 'FAIL', r.ms, 'sim exited ' + r.code + (r.timedOut ? ' (timed out)' : '') + ': ' + clip(errLine(r.all), 100), r.log); continue; }
    let doc, newRows;
    try { doc = JSON.parse(r.stdout); newRows = cellRows(doc, task.digest.face); } catch (err) {
      cellsAllMatch = false; addRow(task.step, 'FAIL', r.ms, 'the sim output is not the expected JSON document: ' + clip(err.message, 90), r.log); continue;
    }
    docs[key] = { face: task.digest.face, doc: doc };
    const sha = sha256(r.stdoutBuf);
    newCells[key] = { args: task.args.slice(), bytes: r.stdoutBuf.length, rows: newRows, sha256: sha };
    if (opt.writeBaseline) { addRow(task.step, 'PASS', r.ms, 'sha256 ' + sha.slice(0, 12) + ', ' + r.stdoutBuf.length + ' bytes'); continue; }
    if (!BASE) { cellsAllMatch = false; addRow(task.step, 'FAIL', r.ms, 'no tools/baseline.json (' + baseRead.err + '): run node tools/test_all.js --write-baseline'); continue; }
    const bc = BASE.cells && BASE.cells[key];
    if (!bc) { cellsAllMatch = false; addRow(task.step, 'FAIL', r.ms, 'cell missing from tools/baseline.json: regenerate it'); continue; }
    if (JSON.stringify(bc.args) !== JSON.stringify(task.args)) { cellsAllMatch = false; addRow(task.step, 'FAIL', r.ms, 'tools/baseline.json was written with other sim args: regenerate it'); continue; }
    if (bc.sha256 === sha) { addRow(task.step, 'PASS', r.ms, 'identical to tools/baseline.json (sha256 ' + sha.slice(0, 12) + ', ' + r.stdoutBuf.length + ' bytes)'); continue; }
    cellsAllMatch = false;
    const cols = BASE.columns || { run: RUN_COLS, seg: SEG_COLS };
    const diffs = diffRows(bc.rows, newRows, cols);
    addRow(task.step, 'FAIL', r.ms, 'differs from tools/baseline.json in ' + diffs.length + ' column(s)' + (diffs.length ? '; first: ' + clip(diffs[0], 70) : ' (outside the stored columns)'), r.log);
    afterTable.push({ title: 'digest ' + key + ': ' + diffs.length + ' differing column(s) (baseline -> now), first 40', lines: diffs.slice(0, 40).concat(diffs.length ? [] : ['the stored columns are identical; the difference is elsewhere in the JSON (keep the logs with --keep and diff the cell JSON)']).concat([DIGEST_FAIL_TEXT]) });
  }

  // ---- baseline bookkeeping
  const srcNow = treeDigest(TREE, 'src');
  const simNow = fileDigest(TREE, 'tools/sim.js');
  let banners = [];
  if (opt.writeBaseline) {
    const okCells = Object.keys(newCells).length === CELLS.length;
    if (!okCells) addRow('write-baseline', 'FAIL', 0, 'not written: ' + (CELLS.length - Object.keys(newCells).length) + ' digest cell(s) did not produce a document');
    else {
      const doc = {
        about: 'Release-gate baseline (tools/test_all.js). Regenerate only with: node tools/test_all.js --write-baseline (in the commit that changes pure-module behaviour, after reading the diff). cells: one sim digest per face and stake, sha256 of the exact stdout plus the columns used for the per-column diff. srcSha256: SHA-256 over the sorted records "<path>\\0<LF content>\\0" of every file under src/. sealTrace: the SEALTRACE line of FLOW_SECTIONS=sealtrace node tools/test_flow.js --quick.',
        args: DIGEST_ARGS.concat(['--set', 'boss=<face>', '--set', 'stake=<stake>', '--jobs', '2']),
        cells: newCells,
        columns: { run: RUN_COLS, seg: SEG_COLS },
        faces: FACES,
        node: process.version,
        schema: 1,
        sealTrace: sealHex,
        simSha256: simNow,
        srcFiles: srcNow ? srcNow.files : 0,
        srcSha256: srcNow ? srcNow.sha : null,
        stakes: STAKES
      };
      if (!sealHex) delete doc.sealTrace;
      const target = path.join(REPO, 'tools', 'baseline.json');
      const prev = readJson(target).v;
      fs.writeFileSync(target, fmtJson(sortKeys(doc)) + '\n');
      let changed = 0;
      if (prev && prev.cells) for (const k of Object.keys(newCells)) if (!prev.cells[k] || prev.cells[k].sha256 !== newCells[k].sha256) changed++;
      addRow('write-baseline', 'PASS', 0, 'wrote ' + rel(target) + ' (' + Object.keys(newCells).length + ' cells' + (prev ? ', ' + changed + ' changed vs the previous file' : '') +
        ', src ' + (srcNow ? srcNow.sha.slice(0, 12) : '-') + (sealHex ? ', sealTrace ' + sealHex.slice(0, 12) : ', NO sealTrace') + ')');
      if (!sealHex) addRow('sealTrace', 'NOTE', 0, 'written without sealTrace: test_flow printed no SEALTRACE line');
    }
  } else if (wanted('digest ' + cellKey(FACES[0], STAKES[0])) || wanted('sealtrace')) {
    const ch = baselineChanges();
    for (const n of ch.notes) addRow('baseline', 'NOTE', 0, n);
    if (ch.inCommit) banners.push(opt.worktree ? 'BASELINE CHANGED IN THE WORKING TREE (tools/baseline.json differs from HEAD ' + headSha + ')' : 'BASELINE CHANGED IN THIS COMMIT');
    if (ch.since) banners.push('BASELINE CHANGED SINCE origin/main');
    if (BASE) {
      const srcMatch = srcNow && BASE.srcSha256 === srcNow.sha;
      // srcSha256 is bound only in the commit (or working tree) that changes tools/baseline.json. A later commit that
      // moves src without changing behaviour (all cells identical) is a presentation-only change, even on a branch
      // whose baseline changed SINCE origin/main: that banner is information, not a second binding.
      if (ch.inCommit && !srcMatch) addRow('baseline', 'FAIL', 0, 'baseline.json was not generated from this src (srcSha256 ' + String(BASE.srcSha256).slice(0, 12) + ', src now ' + (srcNow ? srcNow.sha.slice(0, 12) : '-') + ')');
      else if (!srcMatch && cellsRun === CELLS.length && cellsAllMatch) addRow('baseline', 'NOTE', 0, 'src moved since the baseline, digest identical (presentation-only change)' + (ch.since ? '; the baseline itself changed earlier on this branch (SINCE origin/main)' : ''));
      else if (srcMatch) addRow('baseline', 'PASS', 0, 'srcSha256 matches src (' + srcNow.files + ' files, ' + srcNow.sha.slice(0, 12) + ')');
      else addRow('baseline', 'NOTE', 0, 'src differs from the baseline (srcSha256 ' + String(BASE.srcSha256).slice(0, 12) + ', now ' + (srcNow ? srcNow.sha.slice(0, 12) : '-') + ')');
      if (!cellsAllMatch && BASE.simSha256 && BASE.simSha256 !== simNow) addRow('baseline', 'NOTE', 0, 'tools/sim.js changed since the baseline was written');
      if (!cellsAllMatch && BASE.node && BASE.node !== process.version) addRow('baseline', 'NOTE', 0, 'the baseline was written under node ' + BASE.node + ', this is ' + process.version);
    } else if (cellsRun) addRow('baseline', 'FAIL', 0, 'tools/baseline.json: ' + baseRead.err);
  }

  // ---- degeneracy bounds
  if (!opt.writeBaseline && wanted('bounds')) {
    const keys = Object.keys(docs);
    if (!keys.length) addRow('bounds', 'FAIL', 0, 'no digest data to check');
    else {
      if (keys.length < CELLS.length) addRow('bounds', 'NOTE', 0, 'only ' + keys.length + ' of ' + CELLS.length + ' digest cells produced data');
      const B = bounds(docs);
      if (B.schema.length) {
        addRow('bounds', 'FAIL', 0, 'bounds: sim field ' + B.schema[0] + ' missing or not a number (' + B.schema.length + ' in all; ' + (keys.length - B.checked) + ' of ' + keys.length +
          ' cells not checked): update the bounds in tools/test_all.js with the sim JSON schema');
        afterTable.push({ title: 'bounds: missing sim fields (first 40)', lines: B.schema.slice(0, 40) });
      }
      if (!B.checked) [B.lock, B.run, B.honest, B.move].forEach(function (r) { r.noCells = true; });
      B.lock.extra = 'max ' + B.lock.max.toFixed(2) + '%';
      B.move.extra = 'max ' + pct(B.move.max);
      B.honest.extra = B.honest.nostance + ' no-stance bot rows (null honesty)';
      boundRow('bound lock%', B.lock, 'final-duel phase cells pooled over bots, need ' + BOUND.minSample + ' phases, fail above ' + BOUND.lockPct + '%');
      boundRow('bound run win', B.run, 'guard and truster vs mixer + 10 points, need ' + BOUND.minSample + ' runs');
      boundRow('bound honesty', B.honest, 'bot x final phase, need ' + BOUND.minSample + ' shown turns, fail outside [0.10, 0.95]');
      boundRow('bound move win', B.move, 'bot x final phase x move, need ' + BOUND.minSample + ' exchanges, fail above 60%');
      if (B.coerce.fails.length) { addRow('bound coerce', 'FAIL', 0, B.coerce.fails[0]); afterTable.push({ title: 'bound coerce', lines: B.coerce.fails }); }
      else if (!B.coerce.tested) addRow('bound coerce', 'NOTE', 0, 'no digest cell could be checked');
      else addRow('bound coerce', 'PASS', 0, '0 Rival coercions in ' + B.coerce.tested + ' bot rows');
      const em = B.early.move.sort(function (a, b) { return b.w - a.w; });
      addRow('bounds d1-6', 'NOTE', 0, 'report-only: honesty outside [0.10, 0.95] in ' + B.early.honest.length + ' rows, a move above 60% in ' + em.length + ' rows' +
        (em.length ? ' (max ' + em[0].s + ')' : '') + ', lock above 1% in ' + B.early.lock.length + ' pooled cells');
      infos.push({ step: 'bounds', id: 'degeneracy-duels-1-6', text: 'honesty ' + B.early.honest.length + ' rows' + (B.early.honest.length ? ' (e.g. ' + B.early.honest.slice(0, 3).join('; ') + ')' : '') +
        '; move > 60% ' + em.length + ' rows' + (em.length ? ' (' + em.slice(0, 3).map(function (x) { return x.s; }).join('; ') + ')' : '') + '; lock ' + B.early.lock.length + ' cells' });
      try { fs.writeFileSync(path.join(LOGS, 'degeneracy.txt'), JSON.stringify(B, null, 1) + '\n\n' + reportTable(docs).join('\n') + '\n'); } catch (e) { /* best effort */ }
    }
  }

  // ---- KNOWN registry
  if (!opt.writeBaseline) {
    if (knownRead.err && steps.some(function (s) { return !s.task.digest; })) addRow('known.json', 'FAIL', 0, 'tools/known.json ' + knownRead.err + ': every KNOWN row is unregistered');
    for (const m of malformed) addRow('known', 'FAIL', 0, 'KNOWN line not in the "KNOWN <id> <push>: <text>" form: ' + m);
    for (const id of Object.keys(found).sort()) {
      const hits = found[id], reg = KNOWN.get(id), steps = Array.from(new Set(hits.map(function (h) { return h.step; })));
      if (!reg) { addRow('known ' + id, 'FAIL', 0, 'unregistered KNOWN ' + id + ' (printed by ' + steps.join(', ') + '): fix it, or register it in tools/known.json with its fixing push'); continue; }
      const wrongSuite = steps.filter(function (s) { return SCRIPT_OF[s] !== reg.suite; });
      const wrongPush = hits.filter(function (h) { return h.push !== reg.push; });
      if (wrongSuite.length) addRow('known ' + id, 'FAIL', 0, 'KNOWN ' + id + ' is registered for ' + reg.suite + ' but printed by ' + wrongSuite.join(', '));
      else if (wrongPush.length) addRow('known ' + id, 'FAIL', 0, 'KNOWN ' + id + ' says ' + wrongPush[0].push + ', tools/known.json says ' + reg.push);
      else addRow('known ' + id, 'KNOWN', 0, reg.push + ' [' + steps.join(', ') + '] ' + clip(hits[0].text, 110));
    }
    for (const [id, reg] of KNOWN) {
      if (!SCRIPT_OF[reg.step] || SCRIPT_OF[reg.step] !== reg.suite) {
        addRow('known ' + id, 'FAIL', 0, 'tools/known.json: step ' + reg.step + ' does not run ' + reg.suite);
        continue;
      }
      const r = ran[reg.step];
      if (!r) continue;                               // not run (--only, or the suite is missing: that row FAILs)
      if (found[id] && found[id].some(function (h) { return h.step === reg.step; })) continue;
      if (r.code !== 0 || r.timedOut) addRow('known ' + id, 'NOTE', 0, 'not printed: its step ' + reg.step + ' FAILED, so the row could not be checked');
      else if (found[id]) addRow('known ' + id, 'FAIL', 0, 'KNOWN ' + id + ' is registered for step ' + reg.step + ', which did not print it');
      else addRow('known ' + id, 'FAIL', 0, 'stale KNOWN row ' + id + ': remove it from tools/known.json in the fixing commit');
    }
  }

  // ---- print
  const nFail = rows.filter(function (r) { return r.result === 'FAIL'; }).length;
  const nKnown = rows.filter(function (r) { return r.result === 'KNOWN'; }).length;
  const nWarn = rows.filter(function (r) { return r.result === 'WARN'; }).length;
  const nNote = rows.filter(function (r) { return r.result === 'NOTE'; }).length;
  const code = nFail ? 1 : 0;
  for (const b of banners) console.log(b);
  console.log('test_all HEAD ' + headSha + ' ' + (opt.worktree ? 'worktree' : 'head') + (opt.writeBaseline ? ' write-baseline' : '') + ' ' + TMP + ' node ' + process.version);
  if (opt.worktree) console.log('WORKTREE MODE: results do not describe HEAD');
  if (opt.only) console.log('PARTIAL RUN (--only ' + opt.onlyRaw.join(',') + '): not a release verdict');
  const w = Math.min(32, Math.max(4, rows.reduce(function (m, r) { return Math.max(m, r.step.length); }, 4)));
  function cell(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
  console.log(cell('STEP', w) + ' | RESULT | TIME    | DETAIL');
  console.log('-'.repeat(w) + '-+--------+---------+-' + '-'.repeat(60));
  for (const r of rows) console.log(cell(r.step, w) + ' | ' + cell(r.result, 6) + ' | ' + cell(r.ms ? secs(r.ms) : '', 7) + ' | ' + r.detail);
  for (const b of afterTable) {
    console.log('\n' + b.title + ':');
    for (const l of b.lines) console.log('  ' + l);
  }
  // The last 20 lines of each failed step's log; identical failures (all 8 digest cells, say) print once.
  const shownTails = new Set(), sameAs = [];
  for (const r of rows) {
    if (r.result !== 'FAIL' || !r.log) continue;
    let text = '';
    try { text = fs.readFileSync(r.log, 'utf8'); } catch (e) { /* none */ }
    const last = tail(text, 20);
    const sig = last.filter(function (l) { return !/^\$ |^\(cwd |^\(stdout: |^\[exit /.test(l); }).join('\n').replace(/\d+(\.\d+)? s\b/g, '');
    if (shownTails.has(sig)) { sameAs.push(r.step); continue; }
    shownTails.add(sig);
    console.log('\n--- ' + r.step + ': last 20 lines of ' + r.log + (opt.keep ? '' : ' (removed at exit; --keep keeps it)'));
    for (const l of last) console.log('  ' + l);
  }
  if (sameAs.length) console.log('\n(the logs of ' + sameAs.join(', ') + ' end like one shown above)');
  if (infos.length) {
    console.log('');
    const seen = new Set();
    for (const i of infos) {
      const k = i.id + '|' + i.text;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log('INFO ' + i.id + ' [' + i.step + ']: ' + clip(i.text, 220));
    }
  }
  console.log('\nTOTAL: ' + nFail + ' FAIL, ' + nKnown + ' KNOWN, ' + nWarn + ' WARN, ' + nNote + ' NOTE, exit ' + code + '  ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s');
  console.log(opt.keep ? 'logs kept in ' + LOGS : 'logs were in ' + LOGS + ' (removed; --keep keeps them)');
  cleanup();
  process.exit(code);
})().catch(function (e) {
  console.error('test_all: internal error: ' + (e && e.stack || e));
  cleanup();
  process.exit(1);
});
