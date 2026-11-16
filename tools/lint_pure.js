// SHOW ME MY RIVAL - purity lint for the modules that must run the same in the browser and under Node:
// src/core/rng.js, src/ai/*.js, src/game/*.js and src/text/*.js. They may not touch the clock, the platform's
// randomness, timers, the DOM, storage, locale formatting or any global other than globalThis.RIVAL.
//
//   node tools/lint_pure.js [--root <repo root>]      exit 1 on any hit
//
// 1. Static: a string-aware scanner blanks comments and the bodies of string, template and regex literals (code
//    inside ${...} is still scanned; newlines are kept so line numbers hold), then word-boundary bans run over
//    what is left. Each hit prints as "FAIL static <file>:<line> <ban> <source line>".
// 2. Runtime trap: the pure modules are loaded in build order into a vm context where Math.random, Date (call,
//    construct and Date.now), performance, crypto, timers, Intl, the DOM globals (self, top, parent and frames
//    included), storage and the toLocale*/
//    localeCompare methods throw "PURE-TRAP: <name>". tools/sim.js is then loaded into the same context as a
//    module (it starts no workers there) and its runChain plays 20 runs per bot and face with noTiming set.
//    Any trap, any other error, or a chain that does not finish its 20 runs is a FAIL.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------------------------------------------------------------- arguments
let root = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root' && i + 1 < argv.length) root = path.resolve(argv[++i]);
  else { console.error('lint_pure: unknown argument ' + argv[i] + ' (usage: node tools/lint_pure.js [--root <repo root>])'); process.exit(1); }
}
const SRC = path.join(root, 'src');
const SIM = path.join(root, 'tools', 'sim.js');

// The pure files in build order (tools/build.js ORDER). A new file in a pure folder must be added here.
const ORDER = ['core/rng.js', 'text/strings.js', 'text/taunts.js', 'text/dossier.js', 'ai/brain.js', 'game/boons.js', 'game/combat.js', 'game/run.js'];
const PURE_DIRS = ['ai', 'game', 'text'];

let fails = 0;
function fail(msg) { fails++; console.log('FAIL ' + msg); }

function pureFiles() {
  const found = ['core/rng.js'];
  for (const d of PURE_DIRS) {
    const dir = path.join(SRC, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.js')) found.push(d + '/' + f);
  }
  return found;
}

// ---------------------------------------------------------------- scanner
// mask(code) -> the same text with comments and literal bodies replaced by spaces (newlines kept).
const RE_AFTER_PUNCT = '(,=:[!&|?{};+-*%<>~^';
const RE_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'else', 'do', 'yield', 'await']);
function mask(src) {
  const a = src.split('');
  const n = a.length;
  function blank(from, to) { for (let k = from; k < to && k < n; k++) if (a[k] !== '\n' && a[k] !== '\r') a[k] = ' '; }
  let i = 0, depth = 0, prev = null;
  const tpl = [];                                     // brace depths at which an open ${ expression closes
  function regexAllowed() {
    if (!prev) return true;
    if (prev.t === 'p') return RE_AFTER_PUNCT.indexOf(prev.v) >= 0;
    if (prev.t === 'w') return RE_AFTER_WORD.has(prev.v);
    return false;
  }
  // From just after a backtick or the "}" that closes an expression: blank up to the closing backtick or "${".
  function template(start) {
    let k = start;
    while (k < n) {
      const c = a[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '`') { blank(start, k); return { end: k + 1, expr: false }; }
      if (c === '$' && a[k + 1] === '{') { blank(start, k); return { end: k + 2, expr: true }; }
      k++;
    }
    blank(start, n);
    return { end: n, expr: false };
  }
  function afterTemplate(r) {
    i = r.end;
    if (r.expr) { tpl.push(depth); depth++; prev = { t: 'p', v: '{' }; } else prev = { t: 'lit' };
  }
  while (i < n) {
    const c = a[i], d = a[i + 1];
    if (c === '/' && d === '/') { let k = i; while (k < n && a[k] !== '\n') k++; blank(i, k); i = k; continue; }
    if (c === '/' && d === '*') { let k = src.indexOf('*/', i + 2); k = k < 0 ? n : k + 2; blank(i, k); i = k; continue; }
    if (c === '\'' || c === '"') {
      let k = i + 1;
      while (k < n && a[k] !== c && a[k] !== '\n') { if (a[k] === '\\') k++; k++; }
      blank(i + 1, k); i = k + 1; prev = { t: 'lit' }; continue;
    }
    if (c === '`') { afterTemplate(template(i + 1)); continue; }
    if (c === '/') {
      if (regexAllowed()) {
        let k = i + 1, cls = false;
        while (k < n && a[k] !== '\n') {
          const x = a[k];
          if (x === '\\') { k += 2; continue; }
          if (cls) { if (x === ']') cls = false; } else if (x === '[') cls = true; else if (x === '/') break;
          k++;
        }
        blank(i + 1, k); k++;
        while (k < n && /[A-Za-z]/.test(a[k])) k++;
        i = k; prev = { t: 'lit' }; continue;
      }
      prev = { t: 'p', v: '/' }; i++; continue;
    }
    if (c === '{') { depth++; prev = { t: 'p', v: '{' }; i++; continue; }
    if (c === '}') {
      if (tpl.length && tpl[tpl.length - 1] === depth - 1) { tpl.pop(); depth--; afterTemplate(template(i + 1)); continue; }
      depth--; prev = { t: 'p', v: '}' }; i++; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let k = i + 1; while (k < n && /[\w$]/.test(a[k])) k++; prev = { t: 'w', v: src.slice(i, k) }; i = k; continue; }
    if (/[0-9]/.test(c)) { let k = i + 1; while (k < n && /[\w.]/.test(a[k])) k++; prev = { t: 'n' }; i = k; continue; }
    if (/\s/.test(c)) { i++; continue; }
    prev = { t: 'p', v: c }; i++;
  }
  return a.join('');
}

// Bans over masked code. "(?<![\w$.])" keeps a property of some other object (stats.performance) from matching.
const G = '(?<![\\w$.])';
const BANS = [
  ['document', new RegExp(G + 'document\\b', 'g')],
  ['window', new RegExp(G + 'window\\b', 'g')],
  ['navigator', new RegExp(G + 'navigator\\b', 'g')],
  ['localStorage', /(?<![\w$])localStorage\b/g],
  ['sessionStorage', /(?<![\w$])sessionStorage\b/g],
  ['Date', new RegExp(G + 'Date\\b', 'g')],                 // Date.now, new Date, Date()
  ['Math.random', /\bMath\s*\.\s*random\b/g],
  ['performance', new RegExp(G + 'performance\\b', 'g')],
  ['crypto', new RegExp(G + 'crypto\\b', 'g')],
  ['setTimeout', new RegExp(G + 'setTimeout\\b', 'g')],
  ['setInterval', new RegExp(G + 'setInterval\\b', 'g')],
  ['setImmediate', new RegExp(G + 'setImmediate\\b', 'g')],
  ['requestAnimationFrame', new RegExp(G + 'requestAnimationFrame\\b', 'g')],
  ['queueMicrotask', new RegExp(G + 'queueMicrotask\\b', 'g')],
  ['Intl', new RegExp(G + 'Intl\\b', 'g')],
  ['toLocale*', /\btoLocale\w*/g],
  ['localeCompare', /\blocaleCompare\b/g],
  ['process', new RegExp(G + 'process\\b', 'g')],
  ['fetch', new RegExp(G + 'fetch\\b', 'g')],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/g],
  ['WebSocket', /\bWebSocket\b/g],
  ['globalThis (other than globalThis.RIVAL)', new RegExp(G + 'globalThis\\b(?!\\s*\\.\\s*RIVAL\\b)', 'g')],
  // Other names of the global object: through them a banned global is only a property (self.performance), which the
  // bans above leave alone. An object key ("{ self: ..." or ", self: ...", run.js) is not a use. "top" is also an
  // ordinary local name (brain.js), so only a member access on it counts.
  ['self / parent / frames (global object)', new RegExp(G + '(?:(?<![{,]\\s*)(?:self|parent|frames)\\b|(?:self|parent|frames)\\b(?!\\s*:))', 'g')],
  ['top (global object)', new RegExp(G + 'top\\b(?=\\s*(?:\\.|\\[|\\?\\.))', 'g')]
];
function scan(code) {
  const masked = mask(code), lines = code.split('\n'), hits = [];
  const starts = [0];
  for (let k = 0; k < masked.length; k++) if (masked[k] === '\n') starts.push(k + 1);
  function lineOf(idx) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; }
  for (const [name, re] of BANS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked))) {
      const line = lineOf(m.index);
      let label = name;
      if (name === 'Date') label = /^Date\s*\.\s*now\b/.test(masked.slice(m.index)) ? 'Date.now' : /\bnew\s+$/.test(masked.slice(Math.max(0, m.index - 8), m.index)) ? 'new Date' : 'Date';
      hits.push({ line: line, ban: label, text: (lines[line - 1] || '').trim() });
    }
  }
  return hits.sort(function (x, y) { return x.line - y.line; });
}

// The scanner must blank comments and literals and still see code inside ${...}. Checked on every run.
function selfTest() {
  const cases = [
    ['var s = "Date.now()"; // Math.random\n/* performance */ var r = /window\\.x/g;', 0],
    ["var t = `a ${ Date.now() } b`;", 1],
    ["var t = `a ${ { k: `x ${ crypto } y` }.k } b`;", 1],
    ['var q = x / 2 / Math.random();', 1],
    ['return /setTimeout/.test(s);', 0],
    ['var g = globalThis.RIVAL; var h = globalThis.document;', 1],
    ['var o = stats.performance + a.window;', 0],
    ["var u = '\\'' + Intl;", 1],
    ['function f() { return self.performance.now() + self.Date.now(); }', 2],
    ['var x = top.Date.now() + top["crypto"] + parent.crypto + frames[0];', 4],
    ['var top = lp[0]; pred[top] = { top: top }; var o = x.self + y.parent + z.top.k + w.frames;', 0],
    ["var c = { run: r, side: 'p', self: { hp: 1 },\n  parent: 2 }; var d = k ? self : 0; var e = { self };", 2]
  ];
  let bad = 0;
  for (const [code, want] of cases) {
    const got = scan(code).length;
    if (got !== want) { bad++; fail('self-test: the scanner found ' + got + ' hit(s), expected ' + want + ', in: ' + code); }
  }
  return bad === 0;
}

// ---------------------------------------------------------------- runtime trap
const TRAP_PREAMBLE = [
  '(function () {',
  '  "use strict";',
  '  function trap(name) { return function () { throw new Error("PURE-TRAP: " + name); }; }',
  '  Object.defineProperty(Math, "random", { value: trap("Math.random"), writable: false, configurable: false });',
  '  var RealDate = Date;',
  '  var DateTrap = new Proxy(RealDate, {',
  '    construct: function () { throw new Error("PURE-TRAP: new Date"); },',
  '    apply: function () { throw new Error("PURE-TRAP: Date()"); },',
  '    get: function (t, k) { if (k === "now") throw new Error("PURE-TRAP: Date.now"); return t[k]; }',
  '  });',
  '  Object.defineProperty(globalThis, "Date", { value: DateTrap, writable: false, configurable: false });',
  '  ["performance", "crypto", "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "requestAnimationFrame",',
  '   "queueMicrotask", "Intl", "document", "window", "navigator", "localStorage", "sessionStorage", "process", "fetch",',
  '   "XMLHttpRequest", "WebSocket", "self", "top", "parent", "frames"].forEach(function (name) {',
  '    Object.defineProperty(globalThis, name, { get: trap(name), set: trap(name), configurable: false });',
  '  });',
  '  [[Number.prototype, "toLocaleString"], [Date.prototype, "toLocaleString"], [Date.prototype, "toLocaleDateString"],',
  '   [Date.prototype, "toLocaleTimeString"], [String.prototype, "toLocaleUpperCase"], [String.prototype, "toLocaleLowerCase"],',
  '   [String.prototype, "localeCompare"], [Array.prototype, "toLocaleString"], [Object.prototype, "toLocaleString"],',
  '   [BigInt.prototype, "toLocaleString"]].forEach(function (p) {',
  '    Object.defineProperty(p[0], p[1], { value: trap(p[1]), writable: false, configurable: false });',
  '  });',
  '})();'
].join('\n');

// One fresh context per face: load the pure files, then sim.js as a CommonJS module, then play.
function trapFace(face, plan, files) {
  const ctx = vm.createContext({ console: console });
  vm.runInContext(TRAP_PREAMBLE, ctx, { filename: 'lint_pure-trap-preamble.js' });
  const loaded = new Set();
  function load(rel) {
    const file = path.join(SRC, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    loaded.add(path.resolve(file));
  }
  for (const rel of files) load(rel);
  const hostMods = { path: path, fs: fs, os: require('os'), worker_threads: { isMainThread: true } };
  function shimRequire(id) {
    if (Object.prototype.hasOwnProperty.call(hostMods, id)) return hostMods[id];
    const abs = path.resolve(path.dirname(SIM), id);
    if (abs.indexOf(SRC + path.sep) === 0) {
      if (!loaded.has(abs)) {
        console.log('INFO lint-pure-extra: tools/sim.js also loads ' + path.relative(root, abs).split(path.sep).join('/') + ' (not a pure file; evaluated inside the trap)');
        vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: abs });
        loaded.add(abs);
      }
      return ctx.RIVAL;
    }
    throw new Error('lint_pure trap: tools/sim.js requires ' + id + ', which the trap does not provide');
  }
  shimRequire.main = undefined;
  const mod = { exports: {} };
  const wrapped = vm.runInContext('(function (exports, require, module, __filename, __dirname) {' + fs.readFileSync(SIM, 'utf8') + '\n})', ctx, { filename: SIM });
  wrapped(mod.exports, shimRequire, mod, SIM, path.dirname(SIM));
  const sim = mod.exports;
  if (typeof sim.runChain !== 'function') throw new Error('tools/sim.js exports no runChain');
  const out = [];
  for (const p of plan) {
    const r = sim.runChain({ bot: p.bot, tag: p.bot, seed: 1, runs: 20, unlocks: 'all', noTiming: true, boss: face, stake: p.stake, idx: 0 });
    out.push({ bot: p.bot, stake: p.stake, runs: r && r.stats ? r.stats.runs : null });
  }
  return out;
}
function frameOf(e) {
  const st = String(e && e.stack || '');
  const lines = st.split('\n');
  for (const l of lines) {
    const m = /\(?([A-Za-z]:[\\/][^():]+|\/[^():]+):(\d+):\d+\)?\s*$/.exec(l.trim());
    if (m && path.resolve(m[1]).indexOf(SRC + path.sep) === 0) return path.relative(root, m[1]).split(path.sep).join('/') + ':' + m[2];
  }
  for (const l of lines) {
    const m = /\(?([A-Za-z]:[\\/][^():]+|\/[^():]+):(\d+):\d+\)?\s*$/.exec(l.trim());
    if (m && !/lint_pure/.test(m[1])) return path.relative(root, m[1]).split(path.sep).join('/') + ':' + m[2];
  }
  return '?';
}

// ---------------------------------------------------------------- main
const t0 = Date.now();
const files = pureFiles();
for (const rel of files) if (ORDER.indexOf(rel) < 0) fail('new pure file src/' + rel + ': add it to ORDER in tools/lint_pure.js (build order, tools/build.js)');
for (const rel of ORDER) if (files.indexOf(rel) < 0) fail('pure file src/' + rel + ' is missing');
const present = ORDER.filter(function (r) { return files.indexOf(r) >= 0; });
console.log('lint_pure: ' + present.length + ' pure files: ' + present.map(function (r) { return 'src/' + r; }).join(', '));

selfTest();
let hits = 0;
for (const rel of present) {
  const code = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n?/g, '\n');
  for (const h of scan(code)) { hits++; fail('static src/' + rel + ':' + h.line + ' ' + h.ban + ': ' + (h.text.length > 120 ? h.text.slice(0, 120) + '...' : h.text)); }
}
console.log('lint_pure: static pass: ' + hits + ' hit(s)');

const FACES = ['unmasked', 'three_faced', 'hours', 'reflection'];
const PLAN = [{ bot: 'mixer', stake: 0 }, { bot: 'adaptive', stake: 0 }, { bot: 'uniform', stake: 0 }, { bot: 'mixer', stake: 7 }];
let chains = 0, traps = 0;
if (!fs.existsSync(SIM)) fail('trap: tools/sim.js not found');
else {
  for (const face of FACES) {
    try {
      const res = trapFace(face, PLAN, present);
      for (const r of res) {
        chains++;
        if (r.runs !== 20) fail('trap ' + face + '/' + r.bot + '/stake ' + r.stake + ': played ' + r.runs + ' runs, expected 20');
      }
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/PURE-TRAP:/.test(msg)) traps++;
      fail('trap ' + face + ': ' + msg.split('\n')[0] + ' (at ' + frameOf(e) + ')');
    }
  }
}
console.log('lint_pure: runtime trap: ' + chains + ' chains x 20 runs (' + FACES.length + ' faces; mixer, adaptive, uniform at stake 0, mixer at stake 7), ' + traps + ' trap(s)');
console.log(fails ? 'lint_pure: FAILED ' + fails : 'lint_pure: ALL PASS - ' + present.length + ' files, 0 static hits, ' + chains + ' trapped chains, ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(fails ? 1 : 0);
