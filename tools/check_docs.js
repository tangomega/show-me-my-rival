// SHOW ME MY RIVAL - docs checker: the contract docs against the code they describe.
//
//   node tools/check_docs.js          (no arguments; exit 1 on any FAIL, else 0)
//
// Read-only and dependency-free. It loads the pure modules from src/ (core/rng, text/*, ai/brain, game/*), reads the
// root .md files with fs and writes nothing: no build, no network, nothing under tools/out. The root is the folder
// above this file, so it runs the same in a working tree and in the export of HEAD that tools/test_all.js makes.
// The file list comes from git (tracked files plus new files that are not ignored) when the root has a .git entry,
// otherwise from a walk of the tree that skips node_modules and tools/out. Every anchor is a string, never a line
// number. Text is compared after CRLF and the characters minus, times, >=, <= and middle dot are normalised (the
// credit check, F12, reads the raw characters).
//
// HARD tier: a FAIL line, exit 1, and the release gate fails.
//   F1  commit contract: the q fields brain.commit reads, the keys it returns and its mode literals equal the
//       INTERFACES.md "q = {" and "sealed = {" lines
//   F2  the run.pending keys the scenes write equal the INTERFACES.md "pending:" line
//   F3  the options R.Run.create reads equal the INTERFACES.md "R.Run.create(meta, {" line
//   F4  every R.<Mod>.<name> on a loaded module, and every brain.<method>, named in INTERFACES.md, DESIGN.md or
//       PROGRESS.md exists (names on DOM modules such as R.Game or R.Engine are counted, not checked)
//   F6  every repo path cited in a root .md (a backtick span, a word inside a backtick span such as the path in
//       `node tools/sim.js --json`, or a link target, with a "/" and a file extension) is a tracked file, as written
//       or under src/; a line that says local-only is exempt
//   F7  DESIGN.md section 0: rulings numbered 1..N in order, each reserved number in the one fixed form, every
//       landed ruling from 14 on starts with a bold title
//   F11 ruling 5 and the INTERFACES.md payoff line say that intel.honest, intel.pred and intel.coin are not priced
//       and intel.called is; neither doc still calls the payoff complete
//   F12 every credit in a tracked .md (any case or spacing of its first two words) reads exactly
//       "Developed by tangoSHELL · 2026", with nothing appended after the year
// WARN tier: a WARN line, exit 0 (prose drift to fix).
//   F5  DESIGN section citations in src/ and tools/ resolve to a DESIGN.md heading
//   F8  BALANCE.md section 2 (final constants) and 8c (face health) match R.Run
//   F9  BALANCE.md section 8 cites the first 12 hex of tools/baseline.json srcSha256 (SKIP while the file is absent)
//   F10 every KNOWN BUG marker in a root .md is in KNOWN_BUGS below with the same fixing push, every entry there has
//       a marker, and, once PROGRESS.md has a "## Known bugs" section, every marker has an entry there too
//   F13 every STALE_COMMENTS entry below still finds its anchor in its file (gone: remove the entry with the fix)
// INFO: one "INFO comment-<id>: ..." line per stale code comment in STALE_COMMENTS (tools/test_all.js lists INFO
// lines after its table).
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CREDIT = 'Developed by tangoSHELL · 2026';

// ------------------------------------------------------------------ registers
// KNOWN BUG markers: the docs keep the intended behaviour and mark each gap "**KNOWN BUG (<id>):** ... (fixed in
// <push>)." until the fix lands; the fixing commit removes the marker and its entry here.
const KNOWN_BUGS = [
  { id: 'B01', push: ['P1.2', 'P1.3'], doc: 'DESIGN.md section 8 (Liar\'s Tally)', what: 'the Liar\'s Tally never draws its honest/lie count, and counts no-stance turns as honest' },
  { id: 'B08', push: ['P1.2'], doc: 'DESIGN.md section 8 (Liar\'s Coin)', what: 'the Liar\'s Coin also stamps turn 1 of every later phase of the final duel' },
  { id: 'B10', push: ['P1.3'], doc: 'DESIGN.md section 16 (low-HP triggers)', what: 'a low-HP line comes an exchange late when a Called Shot or Rupture line takes the crossing exchange' },
  { id: 'B26', push: ['P1.5'], doc: 'DESIGN.md section 14 (banner)', what: 'the GUARD BROKEN banner is drawn at a fixed x, not over the loser' },
  { id: 'B30', push: ['P1.6'], doc: 'DESIGN.md section 2 (settings row)', what: 'no pause icon or menu in the duel or bonfire; settings open from the title only' },
  { id: 'B36', push: ['P1.5'], doc: 'DESIGN.md section 3 (letterbox)', what: 'the page behind the canvas is #000, not palette colour 1' },
  { id: 'V5', push: ['P1.3'], doc: 'DESIGN.md pillar 2', what: 'the pre-pick habit line is chosen after the seal, so a reload can re-roll it' }
];
// Code comments that no longer match the code. They ship inside index.html (tools/build.js copies src verbatim), so a
// docs-only push cannot edit them; each is fixed with the code push named here.
const STALE_COMMENTS = [
  { id: 'taunts-rupture', file: 'src/text/taunts.js', anchor: 'that move sealed for both', push: 'P1.3',
    text: 'the clash_rupture comment says a Rupture seals the move; it seals nothing (DESIGN.md ruling 11)' },
  { id: 'taunts-called-wrong', file: 'src/text/taunts.js', anchor: '// The player played something else.', push: 'P1.3',
    text: 'the called_shot_wrong comment: the lines fire whenever the player plays another move, whether or not they win the exchange' },
  { id: 'taunts-final-death', file: 'src/text/taunts.js', anchor: 'Died in duel 7 or to the Unmasked', push: 'P1.9',
    text: 'the player_death_final comment names only the Unmasked; duel 7 has four faces' },
  { id: 'taunts-checker-path', file: 'src/text/taunts.js', anchor: 'tools/out/check_text.js verifies them', push: 'P1.3',
    text: 'the header names the old checker path; the checker is tools/check_text.js' },
  { id: 'sprites-witchfire', file: 'src/art/sprites.js', anchor: 'appears nowhere else', push: 'P1.5',
    text: 'the rival2 header says witchfire appears nowhere else; phase rows with witch: true use it too' },
  { id: 'run-calls-scope', file: 'src/game/run.js', anchor: 'callsFrom: first duel with Called Shot (light 7)', push: 'P1.2',
    text: 'the Called Shot scope comments (light 7, the phase-row calls field) do not say that light 7 also makes a mimic phase call (the Mirror Rule)' },
  { id: 'combat-called-bonus', file: 'src/game/combat.js', anchor: 'phase 2 Called Shot: extra damage', push: 'P1.2',
    text: 'CALLED_BONUS is not phase-2-only: it applies in any duel where R.Combat.callsOf(duel) is true' },
  { id: 'combat-payoff-complete', file: 'src/game/combat.js', anchor: 'Complete value of each cell to the Rival', push: 'P1.2',
    text: 'payoff() is the value of one exchange at the seal; intel honest, pred and coin are not priced (DESIGN.md ruling 5)' },
  { id: 'brain-call-order', file: 'src/ai/brain.js', anchor: 'sealed = brain.commit({ ctx, payoff, legalR, legalP, exploit, honestyBase, rng })', push: 'P1.2',
    text: 'the call-order comment\'s q lacks noTell and mimic' },
  { id: 'brain-trust-slope', file: 'src/ai/brain.js', anchor: 'the trust slope grows from 0.45 to 1.0', push: 'P1.2',
    text: 'the header gives the late trust slope as 1.0; R.Brain.K.H_TRUST_UP_LATE is 0.75' },
  { id: 'brain-mimic-likely', file: 'src/ai/brain.js', anchor: 'it plays the move the player would most likely play in its seat', push: 'P1.2',
    text: 'the mimic comment says "most likely"; the move is sampled from the prediction for the Rival\'s seat, not its argmax' }
];

// ------------------------------------------------------------------ output
const out = [];
const infos = [];
function line(kind, f, msg) { out.push((kind === 'ok' ? 'ok  ' : kind) + ' ' + f + ' ' + msg); }
const OK = (f, m) => line('ok', f, m);
const FAIL = (f, m) => line('FAIL', f, m);
const WARN = (f, m) => line('WARN', f, m);
const SKIP = (f, m) => line('SKIP', f, m);
function guard(f, fn) {
  try { fn(); } catch (e) { FAIL(f, 'internal error: ' + String(e && e.message || e).split('\n')[0]); }
}

// ------------------------------------------------------------------ reading
function readRaw(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }
function norm(s) { return s.replace(/−/g, '-').replace(/×/g, 'x').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/·/g, '.'); }
function read(rel) { return norm(readRaw(rel)); }
function exists(rel) { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; } }

function fileList() {
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    try {
      const txt = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString('utf8');
      const list = txt.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      if (list.length) return list.filter(function (f) { return exists(f); });
    } catch (e) { /* not usable: walk the tree */ }
  }
  const list = [];
  (function walk(d) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      const r = d ? d + '/' + f : f;
      if (/^(node_modules|\.git)$/.test(f) || r === 'tools/out') continue;
      const st = fs.statSync(path.join(ROOT, r));
      if (st.isDirectory()) walk(r); else list.push(r);
    }
  })('');
  return list;
}

// Brace matching that skips strings, template literals and comments. Returns the index of the matching '}'.
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return i; }
  }
  return -1;
}
// The {...} body that follows the first match of re (re must end just after its '{').
function bodyAfter(src, re) {
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  if (src[open] !== '{') return null;
  const close = matchBrace(src, open);
  return close < 0 ? null : src.slice(open, close + 1);
}
// Keys of a comma list at depth 0 ("a, b:[x], c?:{d, e}" -> a, b, c); "..." entries are skipped.
function topKeys(inner) {
  const keys = [];
  let d = 0, cur = '';
  for (const ch of inner) {
    if ('{[('.includes(ch)) d++; else if ('}])'.includes(ch)) d--;
    if (ch === ',' && d === 0) { keys.push(cur); cur = ''; } else cur += ch;
  }
  keys.push(cur);
  const set = new Set();
  for (const k of keys) { const m = /^\s*(\w+)/.exec(k); if (m) set.add(m[1]); }
  return set;
}
// The text inside the first {...} on a doc line, starting at index from.
function lineBraces(ln, from) {
  const i = ln.indexOf('{', from);
  if (i < 0) return null;
  let d = 0;
  for (let j = i; j < ln.length; j++) { if (ln[j] === '{') d++; else if (ln[j] === '}') { d--; if (!d) return ln.slice(i + 1, j); } }
  return null;
}
function diff(a, b) { return [...a].filter(function (x) { return !b.has(x); }); }
function list(a) { return '[' + a.join(', ') + ']'; }
function sha12(s) { return String(s || '').slice(0, 12); }

// ------------------------------------------------------------------ setup
const FILES = fileList();
const ROOT_MD = FILES.filter(function (f) { return /\.md$/.test(f) && f.indexOf('/') < 0; }).sort();
const ALL_MD = FILES.filter(function (f) { return /\.md$/.test(f); }).sort();
let R = null;
try {
  for (const f of ['core/rng.js', 'text/strings.js', 'text/taunts.js', 'text/dossier.js', 'ai/brain.js', 'game/boons.js', 'game/combat.js', 'game/run.js']) {
    require(path.join(ROOT, 'src', f));
  }
  R = globalThis.RIVAL;
  if (!R || !R.Brain || !R.Combat || !R.Run) throw new Error('globalThis.RIVAL lacks Brain, Combat or Run');
} catch (e) { R = null; FAIL('LOAD', String(e && e.message || e).split('\n')[0]); }
const DOC = {};
for (const d of ['INTERFACES.md', 'DESIGN.md', 'PROGRESS.md', 'BALANCE.md']) {
  try { DOC[d] = read(d); } catch (e) { DOC[d] = null; FAIL('LOAD', 'cannot read ' + d); }
}
function docLines(d) { return DOC[d] ? DOC[d].split('\n') : []; }
function findLine(d, test) { return docLines(d).find(test) || null; }
// DESIGN.md section 0 as numbered items: [{ n, t }] (null when the section is missing).
function section0() {
  if (!DOC['DESIGN.md']) return null;
  const m = /(^|\n)## 0\.[^\n]*\n([\s\S]*?)\n## 1\./.exec(DOC['DESIGN.md']);
  if (!m) return null;
  return { text: m[2], items: [...m[2].matchAll(/^(\d+)\.\s(.*)$/gm)].map(function (x) { return { n: +x[1], t: x[2] }; }) };
}

// ------------------------------------------------------------------ F1 commit contract
guard('F1', function () {
  const file = 'src/ai/brain.js';
  const src = readRaw(file);
  const b = bodyAfter(src, /function commit\(q\)\s*\{/);
  if (!b) return FAIL('F1', 'extractor broke: function commit(q) { ... } not found in ' + file);
  const code = new Set([...b.matchAll(/\bq\.(\w+)/g)].map(function (m) { return m[1]; }));
  const ql = findLine('INTERFACES.md', function (l) { return /^`?q = \{/.test(l.trim()); });
  if (!ql) return FAIL('F1', 'anchor not found: INTERFACES.md "q = {"');
  const qdoc = topKeys(lineBraces(ql, ql.indexOf('q = {')) || '');
  const qm = diff(code, qdoc), qx = diff(qdoc, code);
  if (qm.length || qx.length) FAIL('F1', 'INTERFACES.md: q = { - code reads ' + list(qm) + ' not documented; documented ' + list(qx) + ' not read');
  else OK('F1', 'q fields ' + [...code].sort().join(','));

  const ri = b.lastIndexOf('return {');
  const close = ri < 0 ? -1 : matchBrace(b, ri + 7);
  if (close < 0) return FAIL('F1', 'extractor broke: the sealed "return { ... }" literal not found in commit() in ' + file);
  const rkeys = topKeys(b.slice(ri + 8, close));
  const sl = findLine('INTERFACES.md', function (l) { return /^`?sealed = \{/.test(l.trim()); });
  if (!sl) return FAIL('F1', 'anchor not found: INTERFACES.md "sealed = {"');
  const sdoc = topKeys(lineBraces(sl, sl.indexOf('sealed = {')) || '');
  const sm = diff(rkeys, sdoc), sx = diff(sdoc, rkeys);
  if (sm.length || sx.length) FAIL('F1', 'INTERFACES.md: sealed = { - commit returns ' + list(sm) + ' not documented; documented ' + list(sx) + ' not returned');
  else OK('F1', 'sealed keys ' + [...rkeys].join(','));

  const modes = new Set([...b.matchAll(/\bmode\s*=\s*'(\w+)'/g)].map(function (m) { return m[1]; }));
  if (!modes.size) return FAIL('F1', 'extractor broke: no mode = \'<x>\' literal in commit() in ' + file);
  const mm = /mode:([^}\s]+)/.exec(sl);
  const dmodes = new Set(mm ? [...mm[1].matchAll(/'(\w+)'/g)].map(function (m) { return m[1]; }) : []);
  const mmiss = diff(modes, dmodes), mx = diff(dmodes, modes);
  if (mmiss.length || mx.length) FAIL('F1', 'INTERFACES.md: sealed.mode - code sets ' + list(mmiss) + ' not documented; documented ' + list(mx) + ' not set');
  else OK('F1', 'modes ' + [...modes].join(','));
});

// ------------------------------------------------------------------ F2 run.pending
guard('F2', function () {
  const srcs = FILES.filter(function (f) { return /^src\/.*\.js$/.test(f); });
  const keys = new Set();
  let literals = 0;
  for (const f of srcs) {
    const src = readRaw(f);
    for (const m of src.matchAll(/run\.pending\s*=\s*\{/g)) {
      const open = m.index + m[0].length - 1, close = matchBrace(src, open);
      if (close < 0) return FAIL('F2', 'extractor broke: unclosed run.pending = { in ' + f);
      literals++;
      for (const k of topKeys(src.slice(open + 1, close))) keys.add(k);
    }
    for (const m of src.matchAll(/run\.pending\.(\w+)\s*=(?!=)/g)) keys.add(m[1]);
    if (/run\.pending\['seen_'\s*\+\s*kind\]/.test(src)) {
      const rv = bodyAfter(src, /S\.reveal\s*=\s*function\s*\(kind\)\s*\{/);
      if (!rv) return FAIL('F2', 'extractor broke: S.reveal = function (kind) { ... } not found in ' + f);
      const kinds = [...rv.matchAll(/kind\s*===\s*'(\w+)'/g)].map(function (x) { return x[1]; });
      if (!kinds.length) return FAIL('F2', 'extractor broke: no kind === \'<k>\' in S.reveal in ' + f);
      for (const k of kinds) keys.add('seen_' + k);
    }
  }
  if (!literals) return FAIL('F2', 'extractor broke: run.pending = { ... } not found in src/');
  const pl = findLine('INTERFACES.md', function (l) { return /^pending:/.test(l.trim()); });
  if (!pl) return FAIL('F2', 'anchor not found: INTERFACES.md "pending:"');
  const doc = topKeys(lineBraces(pl, pl.indexOf('pending:')) || '');
  const miss = diff(keys, doc), extra = diff(doc, keys);
  if (miss.length || extra.length) FAIL('F2', 'INTERFACES.md: pending: - code writes ' + list(miss) + ' not documented; documented ' + list(extra) + ' not written');
  else OK('F2', 'pending keys ' + [...keys].join(','));
});

// ------------------------------------------------------------------ F3 R.Run.create options
guard('F3', function () {
  const file = 'src/game/run.js';
  const b = bodyAfter(readRaw(file), /function create\(meta, o\)\s*\{/);
  if (!b) return FAIL('F3', 'extractor broke: function create(meta, o) { ... } not found in ' + file);
  const code = new Set([...b.matchAll(/\bo\.(\w+)/g)].map(function (m) { return m[1]; }));
  const ln = findLine('INTERFACES.md', function (l) { return l.indexOf('R.Run.create(meta, {') >= 0 && l.indexOf('...') < 0; });
  if (!ln) return FAIL('F3', 'anchor not found: INTERFACES.md "R.Run.create(meta, {" (a line without "...")');
  const doc = topKeys((lineBraces(ln, ln.indexOf('R.Run.create(meta, {')) || '').replace(/\|null/g, ''));
  const miss = diff(code, doc), extra = diff(doc, code);
  if (miss.length || extra.length) FAIL('F3', 'INTERFACES.md: R.Run.create(meta, { - code reads ' + list(miss) + ' not documented; documented ' + list(extra) + ' not read');
  else OK('F3', 'create options ' + [...code].join(','));
});

// ------------------------------------------------------------------ F4 names
guard('F4', function () {
  if (!R) return FAIL('F4', 'skipped: the pure modules did not load');
  const brainObj = R.Brain.create(null);
  const loaded = { RNG: R.RNG, Brain: R.Brain, Boons: R.Boons, Combat: R.Combat, Run: R.Run, Text: R.Text };
  for (const d of ['INTERFACES.md', 'DESIGN.md', 'PROGRESS.md']) {
    const txt = DOC[d];
    if (txt === null) continue;
    let n = 0;
    const bad = new Set(), soft = new Set();
    for (const m of txt.matchAll(/\bR\.([A-Z]\w*)\.(\w+)/g)) {
      if (loaded[m[1]]) { n++; if (!(m[2] in loaded[m[1]])) bad.add('R.' + m[1] + '.' + m[2]); }
      else soft.add('R.' + m[1] + '.' + m[2]);
    }
    for (const m of txt.matchAll(/(?<![\w/.])brain\.(\w+)/g)) {
      if (m[1] === 'js') continue;
      n++;
      if (typeof brainObj[m[1]] !== 'function') bad.add('brain.' + m[1]);
    }
    if (bad.size) FAIL('F4', d + ': names missing on the loaded modules: ' + [...bad].join(', '));
    else OK('F4', d + ' ' + n + ' names resolve on loaded modules; ' + soft.size + ' distinct names on DOM modules not checked');
  }
});

// ------------------------------------------------------------------ F5 DESIGN citations in code (warn)
guard('F5', function () {
  if (!DOC['DESIGN.md']) return WARN('F5', 'skipped: DESIGN.md not read');
  const heads = new Set();
  for (const l of docLines('DESIGN.md')) {
    let m = /^#{2,3}\s+(\d+(?:\.\d+)?)[.\s]/.exec(l); if (m) heads.add(m[1]);
    m = /^\*\*(\d+\.\d+)\s/.exec(l); if (m) heads.add(m[1]);
  }
  let n = 0;
  const bad = [];
  for (const f of FILES.filter(function (x) { return /^(src|tools)\/.*\.js$/.test(x); })) {
    const t = read(f);
    for (const m of t.matchAll(/DESIGN(?:\.md)?\s*(?:§|section\s+)\s*(\d+(?:\.\d+)?)|DESIGN(?:\.md)?\s+(\d+\.\d+)|§(\d+(?:\.\d+)?)/g)) {
      const s = m[1] || m[2] || m[3];
      n++;
      if (!heads.has(s)) bad.push(f + ' ' + s);
    }
  }
  if (bad.length) WARN('F5', 'DESIGN citations with no heading: ' + bad.join('; '));
  else OK('F5', n + ' section citations in src/ and tools/ resolve');
});

// ------------------------------------------------------------------ F6 cited paths
guard('F6', function () {
  const tracked = new Set(FILES);
  const bad = [];
  let n = 0;
  for (const f of ROOT_MD) {
    readRaw(f).split('\n').forEach(function (l, i) {
      // A span with spaces (a command line) is split into words, each stripped of wrapping brackets and quotes.
      const toks = [];
      for (const m of l.matchAll(/`([^`]+)`/g)) {
        const s = m[1].trim();
        if (!/\s/.test(s)) { toks.push(s); continue; }
        for (const w of s.split(/\s+/)) toks.push(w.replace(/^[(\[{'"<]+|[)\]}'",;:>]+$/g, ''));
      }
      for (const m of l.matchAll(/\]\(([^)\s]+)\)/g)) toks.push(m[1]);
      for (const t0 of toks) {
        const t = t0.trim();
        if (!/^[\w.\-/]+\.(js|md|html|json|txt|sh|png)$/.test(t) || t.indexOf('/') < 0 || /^[a-z]+:\/\//i.test(t)) continue;
        n++;
        if (/local-only/i.test(l)) continue;
        if (tracked.has(t) || tracked.has('src/' + t)) continue;
        bad.push(f + ':' + (i + 1) + ' ' + t);
      }
    });
  }
  if (bad.length) FAIL('F6', 'cited paths that are not tracked files (say local-only on the line if that is meant): ' + bad.join(', '));
  else OK('F6', n + ' cited paths in ' + ROOT_MD.length + ' root .md files are tracked (or marked local-only)');
});

// ------------------------------------------------------------------ F7 section 0
guard('F7', function () {
  const s0 = section0();
  if (!s0) return FAIL('F7', 'anchor not found: DESIGN.md "## 0." ... "## 1."');
  const nums = s0.items.map(function (x) { return x.n; });
  const bad = [];
  if (!nums.length) bad.push('no numbered rulings');
  if (!nums.every(function (x, i) { return x === i + 1; })) bad.push('not numbered 1..N in order: ' + nums.join(','));
  const RES = /^\*Reserved, lands in P\d+\.\d+\.\* Topic: [^.]+\. Not yet a ruling\.$/;
  let reserved = 0;
  for (const it of s0.items) {
    const isRes = RES.test(it.t);
    if (isRes) reserved++;
    else if (/reserved/i.test(it.t.slice(0, 40))) bad.push(it.n + ': a reserved line must read exactly "N. *Reserved, lands in Px.y.* Topic: <topic>. Not yet a ruling."');
    if (it.n >= 14 && !isRes && !/^\*\*[^*]+\*\*/.test(it.t)) bad.push(it.n + ': a landed ruling from 14 on must start with a bold title');
  }
  if (bad.length) FAIL('F7', 'DESIGN.md section 0: ' + bad.join('; '));
  else OK('F7', nums.length + ' rulings in numeric order, ' + reserved + ' reserved');
});

// ------------------------------------------------------------------ F8 BALANCE numbers (warn)
guard('F8', function () {
  if (!R) return WARN('F8', 'skipped: the pure modules did not load');
  const BA = DOC['BALANCE.md'];
  if (!BA) return WARN('F8', 'skipped: BALANCE.md not read');
  const run = R.Run, bad = [];
  const s2 = /## 2\. Final constants([\s\S]*?)\n## 3\./.exec(BA);
  if (!s2) return WARN('F8', 'anchor not found: BALANCE.md "## 2. Final constants"');
  const want = { PLAYER_MAX_HP: String(run.PLAYER_MAX_HP), HEAL: String(run.HEAL), PHASE2_HEAL: String(run.PHASE2_HEAL),
    RIVAL_HP: [1, 2, 3, 4, 5, 6, 7].map(function (n) { return run.DUELS[n].rivalHp; }).join(','), PHASE2_HP: String(run.DUELS.phase2.rivalHp) };
  const seen = {};
  for (const l of s2[1].split('\n')) {
    const m = /^\|\s*`(\w+)`[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/.exec(l);
    if (!m || want[m[1]] === undefined) continue;
    seen[m[1]] = true;
    if (want[m[1]] !== m[2].replace(/\s/g, '')) bad.push(m[1] + ' doc ' + m[2] + ', code ' + want[m[1]]);
  }
  for (const k of Object.keys(want)) if (!seen[k]) bad.push(k + ' row missing from section 2');
  const s8 = /## 8c\.([\s\S]*?)\n## \d/.exec(BA);
  if (!s8) bad.push('anchor not found: "## 8c."');
  for (const b of run.BOSSES) {
    const hp = b.phases.map(function (p, i) { return typeof p.hp === 'number' ? p.hp : (i === 0 ? run.DUELS[7].rivalHp : run.DUELS.phase2.rivalHp); }).join(' / ');
    if (s8 && s8[1].indexOf('| ' + b.name + ' (' + hp) < 0) bad.push(b.id + ' health ' + hp + ' not in 8c');
  }
  if (bad.length) WARN('F8', 'BALANCE.md: ' + bad.join('; '));
  else OK('F8', 'BALANCE.md section 2 and 8c match R.Run and R.Run.BOSSES');
});

// ------------------------------------------------------------------ F9 baseline digest (warn)
guard('F9', function () {
  const rel = 'tools/baseline.json';
  if (!exists(rel)) return SKIP('F9', rel + ' not present');
  let j;
  try { j = JSON.parse(readRaw(rel)); } catch (e) { return WARN('F9', rel + ' is not readable JSON'); }
  const h = sha12(j && j.srcSha256);
  if (!/^[0-9a-f]{12}$/.test(h)) return WARN('F9', rel + ' has no srcSha256');
  const s8 = /## 8\. [^\n]*\n([\s\S]*?)\n## 8b\./.exec(DOC['BALANCE.md'] || '');
  if (!s8) return WARN('F9', 'anchor not found: BALANCE.md "## 8. " ... "## 8b."');
  if (s8[1].indexOf(h) < 0) WARN('F9', 'BALANCE.md section 8 does not cite the baseline src digest ' + h + ' (srcSha256 of ' + rel + ')');
  else OK('F9', 'BALANCE.md section 8 cites baseline src digest ' + h);
});

// ------------------------------------------------------------------ F10 KNOWN BUG markers (warn)
guard('F10', function () {
  const reg = {};
  for (const k of KNOWN_BUGS) reg[k.id] = k;
  const prog = /(^|\n)## Known bugs[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(DOC['PROGRESS.md'] || '');
  const progIds = prog ? new Set([...prog[2].matchAll(/^- \*\*([BV]\d+)\*\*/gm)].map(function (m) { return m[1]; })) : null;
  const bad = [], used = {};
  let n = 0;
  for (const f of ROOT_MD) {
    read(f).split('\n').forEach(function (l, i) {
      for (const m of l.matchAll(/\*\*KNOWN BUG \(([A-Z]+\d+)\):\*\*/g)) {
        n++;
        const id = m[1], at = f + ':' + (i + 1);
        used[id] = true;
        const rest = l.slice(m.index + m[0].length);
        const fx = /fixed in ((?:P\d+\.\d+(?:,\s*|\s+and\s+)?)+)/i.exec(rest);
        const pushes = fx ? (fx[1].match(/P\d+\.\d+/g) || []) : [];
        if (!reg[id]) { bad.push(at + ' marker ' + id + ' is not in KNOWN_BUGS in tools/check_docs.js'); continue; }
        if (!pushes.length) bad.push(at + ' marker ' + id + ' does not say "fixed in <push>"');
        else if (pushes.slice().sort().join(',') !== reg[id].push.slice().sort().join(',')) bad.push(at + ' marker ' + id + ' says fixed in ' + pushes.join(' and ') + ', KNOWN_BUGS says ' + reg[id].push.join(' and '));
        if (progIds && !progIds.has(id)) bad.push(at + ' marker ' + id + ' has no "- **' + id + '**" entry under PROGRESS.md "## Known bugs"');
      }
    });
  }
  for (const k of KNOWN_BUGS) if (!used[k.id]) bad.push('KNOWN_BUGS entry ' + k.id + ' has no marker in any root .md (fixed? remove the entry)');
  if (bad.length) WARN('F10', bad.join('; '));
  else OK('F10', n + ' markers, ' + KNOWN_BUGS.length + ' registered bugs' + (progIds ? ', ' + progIds.size + ' PROGRESS.md entries' : ' (PROGRESS.md has no "## Known bugs" section yet)'));
});

// ------------------------------------------------------------------ F11 ruling 5 and the payoff line
guard('F11', function () {
  const bad = [];
  const s0 = section0();
  if (!s0) bad.push('anchor not found: DESIGN.md "## 0."');
  else {
    if (/complete value matrix/i.test(s0.text)) bad.push('DESIGN.md section 0 still says "complete value matrix"');
    const r5 = s0.items.find(function (x) { return x.n === 5; });
    if (!r5) bad.push('DESIGN.md section 0 has no ruling 5');
    else {
      for (const k of ['intel.honest', 'intel.pred', 'intel.coin']) if (r5.t.indexOf(k) < 0) bad.push('ruling 5 does not name ' + k);
      if (!/not (?:be )?priced|does not price/.test(r5.t)) bad.push('ruling 5 does not say those hooks are not priced');
      if (!/intel\.called`? is priced/.test(r5.t)) bad.push('ruling 5 does not say intel.called is priced');
    }
  }
  const IF = DOC['INTERFACES.md'] || '';
  if (/the complete value to the Rival/i.test(IF)) bad.push('INTERFACES.md still says "the complete value to the Rival"');
  const pl = findLine('INTERFACES.md', function (l) { return /^`payoff\[rm\]\[pm\]`/.test(l.trim()); });
  if (!pl) bad.push('anchor not found: INTERFACES.md "`payoff[rm][pm]`"');
  else {
    for (const k of ['intel.honest', 'intel.pred', 'intel.coin', 'intel.called']) if (pl.indexOf(k) < 0) bad.push('INTERFACES.md payoff line does not name ' + k);
    if (!/not priced/.test(pl)) bad.push('INTERFACES.md payoff line does not say those hooks are not priced');
    if (!/intel\.called`? is priced/.test(pl)) bad.push('INTERFACES.md payoff line does not say intel.called is priced');
  }
  if (bad.length) FAIL('F11', bad.join('; '));
  else OK('F11', 'ruling 5 and the INTERFACES.md payoff line: honest, pred and coin unpriced, called priced');
});

// ------------------------------------------------------------------ F12 the credit in every tracked .md
guard('F12', function () {
  const bad = [];
  let n = 0;
  for (const f of ALL_MD) {
    const t = readRaw(f);
    for (const m of t.matchAll(/developed(?:\s|&nbsp;| )+by(?![A-Za-z0-9])/gi)) {
      n++;
      const s = t.slice(m.index, m.index + CREDIT.length + 1);
      // The exact credit, then only the end of the text or line or one closing mark, so nothing can be appended.
      if (s.slice(0, CREDIT.length) !== CREDIT || !/^(?:$|[\r\n."*)|<`'])/.test(s.slice(CREDIT.length))) {
        bad.push(f + ':' + (t.slice(0, m.index).split('\n').length) + ' "' + t.slice(m.index, m.index + 40).split(/\r?\n/)[0] + '"');
      }
    }
  }
  if (bad.length) FAIL('F12', 'credit must read exactly "Developed by tangoSHELL · 2026": ' + bad.join(', '));
  else OK('F12', n + ' credit lines in ' + ALL_MD.length + ' tracked .md files are exact');
});

// ------------------------------------------------------------------ register of stale code comments (info)
guard('INFO', function () {
  const gone = [];
  for (const c of STALE_COMMENTS) {
    let has = false;
    try { has = readRaw(c.file).indexOf(c.anchor) >= 0; } catch (e) { has = false; }
    if (!has) { gone.push(c.id + ' (' + c.file + ')'); continue; }
    infos.push('INFO comment-' + c.id + ': ' + c.file + ': ' + c.text + '; fix with its code in ' + c.push);
  }
  if (gone.length) WARN('F13', 'stale-comment register: anchor no longer in its file (fixed? remove the entry from STALE_COMMENTS): ' + gone.join(', '));
});

// ------------------------------------------------------------------ report
for (const l of out) console.log(l);
for (const l of infos) console.log(l);
const fails = out.filter(function (l) { return /^FAIL /.test(l); }).length;
const warns = out.filter(function (l) { return /^WARN /.test(l); }).length;
console.log('check_docs: ' + fails + ' FAIL, ' + warns + ' WARN');
process.exitCode = fails ? 1 : 0;
