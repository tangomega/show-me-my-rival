// SHOW ME MY RIVAL - end-to-end flow test.   node tools/test_flow.js [runs=200] [seed=1] [--quick] [--verbose]
//
// Every "page load" is a fresh vm context that evaluates the REAL sources in build order: core/rng, core/save,
// art/palette, art/pix, art/font, art/fx, audio/audio, text/*, ai/brain, game/*, core/engine, scenes/*, main.js.
// Faked: the DOM (canvas, 2D context, rAF, pointer/keyboard/visibility events, safe-area probe, matchMedia,
// localStorage with switchable failure modes) and R.Art / R.UI (validating recorders; the artists own those files).
// A bot plays complete runs through the real scenes by dispatching pointer and key events at the real engine;
// "reloads" (throw the context away, boot a new one from the same localStorage) are injected at random and at
// chosen moments: mid-turn after the Rival committed, between the pick and the reveal, between a lethal blow and
// the next screen, on the bonfire, during the phase-2 transformation, on the death / victory / credits screens.
// exit 1 on any failure.
//
// Sections (FLOW_SECTIONS=a,b picks some; the default runs all but the opt-in ones):
//   soak long storage corrupt pause scripted layout perf random   the original flow tests
//   rngsites   static: src/scenes reads the gameplay rng only at the commit and the Coin of Fools pick
//   blind      the frames and sounds before the pick do not depend on which lie was sealed (?debug on and off)
//   pausetap   a tap or key that only ends a pause must not pick a move (KNOWN until P1.6)
//   parity     the real duel scene and tools/sim.js runChain feed brain.commit identical inputs
//   coerce     positive control for the Rival-coercion counter (a forged save with an illegal sealed move)
//   fixtures   every golden save in tools/fixtures/ (written by older builds) boots and resumes in the current one:
//              the same stage, duel, phase and turn, the same commit where one was pending, no turn start applied
//              twice, the tutorial, a four-card bonfire, a save between final-duel phases; plus the V1 rebuild, the
//              run.req park, the unknown-face redraw, the shadow high-water keys, an empty store and memory-only storage
//   stale      two pages on one storage: the tab that did not save last writes nothing and reloads from storage; an
//              idle tab writes nothing; garbage generations; a save cleared elsewhere
//   sealtrace  opt-in: per-seal trace of the commit and G.rng draw counts; prints "SEALTRACE <sha256>"
//              (FLOW_SEAL_OUT=<file> also writes the trace as JSON)
// Every page wraps R.Combat.resolve: a Rival move that is not legal at resolve time is a FAIL.
// KNOWN rows (registry: tools/known.json) print "KNOWN <id> <push>: <text>" once and do not fail the run.
// require('./tools/test_flow.js') runs nothing and exports the harness (makePage, session, ...).
// Sources: src/ of this tree; FLOW_SRC=<dir> loads another src/ folder (e.g. one exported with git archive), and
// FLOW_SHA=<commit> loads src/ of that commit (git show). FLOW_HEAD=a.js,b.js swaps single files for HEAD's.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const FLOW_SHA = process.env.FLOW_SHA || null;
const SRC = process.env.FLOW_SRC ? path.resolve(process.env.FLOW_SRC) : path.join(ROOT, 'src');
function gitText(args) { return require('child_process').execFileSync('git', ['-c', 'core.autocrlf=false'].concat(args), { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
const argv = process.argv.slice(2), flags = argv.filter(a => a.startsWith('--')), nums = argv.filter(a => !a.startsWith('--'));
const QUICK = flags.includes('--quick'), VERBOSE = flags.includes('--verbose');
const RUNS = +nums[0] > 0 ? +nums[0] : (QUICK ? 30 : 200), SEED = +nums[1] > 0 ? +nums[1] : 1;
const KEY = 'rival.save.v1';

const PATCHED = flags.includes('--patched');                         // run against tools/qa_patches.js applied in memory

// Known-open defects that a later push fixes. Ids are registered in tools/known.json (shared protocol): each row
// prints exactly one line "KNOWN <id> <push>: <text>" and is not a failure. A row with `match` turns matching
// failures into that row; every other failure still fails. Rows without `match` are raised by their section
// (knownHit), which also FAILs as "stale KNOWN row" once the defect stops reproducing. Remove a row (here and in
// tools/known.json) in the commit that fixes it.
const KNOWN_ROWS = {
  // (V1, an old-shape duel-7 save restarting at phase 1, was fixed in P1.1 by the rebuild in duel.js enter(): a
  // "phase regressed" failure is a plain FAIL again.)
  // O13 (fixed by P1.6): engine.js pDown / keydown end the pause and deliver the same event to the scene.
  'pause-tap-pointer': { push: 'P1.6', text: 'a pointer-down that only ends a pause also picks a move (O13)' },
  'pause-tap-key': { push: 'P1.6', text: 'a key press that only ends a pause also picks a move (O13)' }
};

// ---------------------------------------------------------------------------------------------- failures
let fails = 0, known = 0, checks = 0, where = 'init';
const seenFail = new Set(), knownSeen = {};
function knownHit(id) {
  const row = KNOWN_ROWS[id];
  if (!row) { fail('unregistered KNOWN row ' + id); return; }
  if (!knownSeen[id]) { knownSeen[id] = 0; console.log('KNOWN ' + id + ' ' + row.push + ': ' + row.text); }
  knownSeen[id]++; known++;
}
function fail(msg) {
  for (const id in KNOWN_ROWS) {
    if (KNOWN_ROWS[id].match && KNOWN_ROWS[id].match(where, msg)) {
      const vk = 'known|' + where + '|' + msg.slice(0, 60);
      if (VERBOSE && !seenFail.has(vk)) { seenFail.add(vk); console.log('  (' + id + ') [' + where + '] ' + msg); }
      knownHit(id);
      return;
    }
  }
  const k = where.replace(/[#\d].*$/, '') + '|' + msg.replace(/\d+/g, '#').slice(0, 90);
  if (seenFail.has(k)) return;
  seenFail.add(k);
  fails++;
  console.log('FAIL [' + where + '] ' + msg);
  if (fails > 60) { console.log('too many failures, stopping'); process.exit(1); }
}
function ok(cond, msg) { checks++; if (!cond) fail(typeof msg === 'function' ? msg() : msg); return !!cond; }
function fin() { for (let i = 0; i < arguments.length; i++) if (typeof arguments[i] !== 'number' || !isFinite(arguments[i])) return false; return true; }
function mulberry(seed) {
  let s = seed >>> 0;
  const f = function () { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = n => Math.floor(f() * n);
  f.chance = p => f() < p;
  f.pick = a => a[Math.floor(f() * a.length)];
  return f;
}

// ---------------------------------------------------------------------------------------------- sources
const ORDER_A = ['core/rng.js', 'core/save.js', 'art/palette.js', 'art/pix.js', 'art/font.js'];
const ORDER_B = ['art/fx.js', 'audio/audio.js', 'text/strings.js', 'text/taunts.js', 'text/dossier.js', 'ai/brain.js',
  'game/boons.js', 'game/combat.js', 'game/run.js', 'core/engine.js'];
const SCENE_FILES = (FLOW_SHA ? gitText(['ls-tree', '--name-only', FLOW_SHA + ':src/scenes']).split('\n').map(f => f.trim()) : fs.readdirSync(path.join(SRC, 'scenes')))
  .filter(f => f.endsWith('.js')).sort().map(f => 'scenes/' + f);
const scripts = {};
function script(rel) {
  const key = (FLOW_SHA || SRC) + ':' + rel;
  if (!scripts[key]) {
    let code = FLOW_SHA ? gitText(['show', FLOW_SHA + ':src/' + rel]) : fs.readFileSync(path.join(SRC, rel), 'utf8');
    if (process.env.FLOW_HEAD && process.env.FLOW_HEAD.split(',').indexOf(rel) >= 0) code = require('child_process').execSync('git show HEAD:src/' + rel, { cwd: ROOT, encoding: 'utf8' });   // A/B against the committed file
    if (PATCHED && (rel === 'main.js' || rel === 'scenes/duel.js')) {
      const res = require('./qa_patches.js').applyTo(rel, code);
      for (const s of res.skipped) console.log('note: patch ' + s.id + ' not applied to ' + rel + ' (' + s.why + ', edit ' + s.n + ')');
      code = res.text;
    }
    scripts[key] = new vm.Script(code, { filename: path.join(SRC, rel) });
  }
  return scripts[key];
}
function inline(name, code) { return new vm.Script(code, { filename: name }); }

const SPRITES = new Set(('icon_S icon_G icon_F icon_S_big icon_G_big icon_F_big mini_S mini_G mini_F st_guardBroken st_bleed st_fortify st_focus st_sealed ' +
  'act_glimpse act_honesty act_coin tag_RIP tag_TEN tag_BLD tag_TRK tag_GMB tag_INF tag_CHA tag_EXE tag_relic rar_common rar_uncommon rar_rare ' +
  'title_mask logo bonfire_player bonfire_rival lock mask_porcelain mask_mourner mask_jester mask_kintsugi mask_blank').split(' '));
const SFX = new Set('whoosh_s whoosh_f guard_up hit clang clash_s clash_g clash_f guard_break seal crack tick select back heal boon rival_draft deathblow final_blow you_died phase2 bell type unlock step ember'.split(' '));
const MUSIC = new Set(['title', 'drone', 'bonfire', 'boss', 'boss2', 'death', 'credits']);
const BGS = new Set(['cathedral', 'bonfire', 'title']);

const PRELUDE = inline('prelude', `
  Date.now = function () { return __H.now(); };
  Math.random = function () { return __H.rand(); };
`);
const FAKE_ART = inline('fake-art', `
(function (R) {
  'use strict';
  var H = globalThis.__H;
  var NAMES = ['idle', 'tell_S', 'tell_G', 'tell_F', 'strike', 'guard', 'feint', 'hit', 'stagger', 'clash', 'death', 'taunt', 'taunt2', 'victory', 'transform'];
  var DEFS = {}, i;
  function mk(n, ms, loop) { var d = [], k; for (k = 0; k < n; k++) d.push(ms); return { n: n, dur: d, loop: !!loop, total: n * ms }; }
  for (i = 0; i < NAMES.length; i++) DEFS[NAMES[i]] = NAMES[i] === 'transform' ? mk(10, 200, false) : NAMES[i].indexOf('tell_') === 0 ? mk(5, 100, false) : mk(4, 110, NAMES[i] === 'idle');
  R.Art = {
    init: function () {},
    anim: function (who, name) {
      if (who !== 'player' && who !== 'rival' && who !== 'rival2' && who !== 'mirror') return null;
      if (name === 'transform' && (who === 'player' || who === 'mirror')) return null;
      return DEFS[name] || null;
    },
    frameAt: function (a, ms) { var f = (ms / a.dur[0]) | 0; return f < 0 ? 0 : f >= a.n ? a.n - 1 : f; },
    fighter: function (g, who, name, frame, x, y, opts) { H.fighter(who, name, frame, x, y, opts, DEFS[name]); },
    sprite: function (g, name, x, y, opts) { H.sprite(name, x, y, opts); },
    sigil: function (g, x, y, state, move, side) { H.sigil(x, y, state, move, side); },
    bg: function (g, name, t, opts) { H.bg(name, t, opts); },
    fg: function (g, name, t, opts) { H.bg(name, t, opts); }
  };
  R.UI = {
    panel: function (g, x, y, w, h, style) { H.panel(x, y, w, h, style); },
    button: function (g, x, y, w, h, label, st) { H.button(x, y, w, h, label, st); },
    bubble: function (g, x, y, w, lines, tailX, tailDir, opts) { H.bubble(x, y, w, lines, opts); },
    bar: function (g, x, y, w, h, frac, lag, pal, opts) { H.bar(x, y, w, h, frac, lag, pal, opts); },
    hit: function (px, py, x, y, w, h) { return px >= x && py >= y && px < x + w && py < y + h; }
  };
  var realDraw = R.Font.draw, realWrap = R.Font.wrap, realWidth = R.Font.width;
  H.width = realWidth; H.has = R.Font.has;
  R.Font.draw = function (g, text, x, y, pal, opts) { H.text(text, x, y, pal, opts); if (H.realDraw) realDraw(g, text, x, y, pal, opts); };
  R.Font.wrap = function (t, w, s) { H.c.wrap++; return realWrap(t, w, s); };
})(globalThis.RIVAL = globalThis.RIVAL || {});
`);
const FAKE_AUDIO = inline('audio-spy', `
(function (R) {
  var H = globalThis.__H, A = R.Audio, names = ['init', 'setMuted', 'suspend', 'resume', 'sfx', 'music', 'heartbeat'];
  names.forEach(function (n) { var f = A[n]; A[n] = function (a, b) { H.audio(n, a, b); return f(a, b); }; });
})(globalThis.RIVAL);
`);
// Per-frame allocation proxies (only loaded for the performance probe: they slow everything down).
const PERF = inline('perf-probe', `
(function () {
  var c = __H.c;
  function hook(obj, name, key) { var f = obj[name]; obj[name] = function () { c[key]++; return f.apply(this, arguments); }; }
  ['toUpperCase', 'toLowerCase', 'substring', 'substr', 'slice', 'split', 'replace', 'concat', 'trim', 'repeat', 'padStart', 'padEnd'].forEach(function (n) { hook(String.prototype, n, 'str'); });
  ['slice', 'concat', 'map', 'filter', 'splice', 'join', 'sort', 'reverse'].forEach(function (n) { hook(Array.prototype, n, 'arr'); });
  hook(Number.prototype, 'toFixed', 'str'); hook(Number.prototype, 'toString', 'str');
  hook(Object, 'keys', 'arr'); hook(Object, 'assign', 'arr'); hook(JSON, 'stringify', 'json'); hook(JSON, 'parse', 'json');
})();
`);

// ---------------------------------------------------------------------------------------------- storage mock
// mode: 'ok' | 'failWrite' (setItem throws: quota / private mode) | 'failAll' (every call throws) | 'deny' (reading
// window.localStorage itself throws, as in a sandboxed iframe). failKeys: setItem of these keys alone throws.
// writes / lastBytes count every successful setItem / the size of the last save written (KEY only).
function makeStore() {
  const st = {
    map: new Map(), mode: 'ok', writes: 0, failed: 0, lastBytes: 0, failKeys: new Set(),
    api: {
      getItem(k) { if (st.mode === 'failAll') throw new Error('SecurityError'); return st.map.has(k) ? st.map.get(k) : null; },
      setItem(k, v) {
        if (st.mode !== 'ok' || st.failKeys.has(k)) { st.failed++; throw new Error('QuotaExceededError'); }
        st.writes++; if (k === KEY) st.lastBytes = String(v).length; st.map.set(k, String(v));
      },
      removeItem(k) { if (st.mode !== 'ok') throw new Error('SecurityError'); st.map.delete(k); }
    },
    raw() { return st.map.has(KEY) ? st.map.get(KEY) : null; },
    parsed() { const r = st.raw(); if (r === null) return null; try { return JSON.parse(r); } catch (e) { return null; } }
  };
  return st;
}

// ---------------------------------------------------------------------------------------------- page (one load)
const VIEWS = [
  { name: '320x568@2', vw: 320, vh: 568, dpr: 2, st: 0, sb: 0 },
  { name: '320x568@2+safe47/34', vw: 320, vh: 568, dpr: 2, st: 47, sb: 34 },
  { name: '360x640@1', vw: 360, vh: 640, dpr: 1, st: 0, sb: 0 },
  { name: '360x640@1+safe47/34', vw: 360, vh: 640, dpr: 1, st: 47, sb: 34 },
  { name: '375x667@2', vw: 375, vh: 667, dpr: 2, st: 20, sb: 0 },
  { name: '390x844@3+safe47/34', vw: 390, vh: 844, dpr: 3, st: 47, sb: 34 },
  { name: '412x915@2.625+safe32/24', vw: 412, vh: 915, dpr: 2.625, st: 32, sb: 24 },
  { name: '360x800@3.5+safe30/20', vw: 360, vh: 800, dpr: 3.5, st: 30, sb: 20 },
  { name: '430x932@3+safe59/34', vw: 430, vh: 932, dpr: 3, st: 59, sb: 34 },
  { name: '768x1024@2', vw: 768, vh: 1024, dpr: 2, st: 24, sb: 20 }
];
const clock = { ms: 1.75e12 };                                    // wall clock shared by every page (Date.now)
const sysRand = mulberry(SEED * 7919 + 13);                       // what the pages see as Math.random

function newCounters() {
  return { wrap: 0, createElement: 0, getContext: 0, fresh: 0, str: 0, arr: 0, json: 0, listeners: 0, vibrate: 0, texts: 0, fillRect: 0, drawImage: 0, save: 0, sfx: 0, type: 0 };
}

// Rival-coercion counter. Every page wraps R.Combat.resolve (the scene calls it through the object, duel.js turn()):
// the Rival's move must be legal when the exchange resolves and must be the move that resolves. coerce() inside
// combat.js is private, so this watches its trace instead: a {t:'note', side:'r'} event, or res.rm !== rm.
// page.coerceExpected > 0 lets a positive control (section coerce) count exactly that many as expected.
const COERCE = { resolves: 0, rival: 0, player: 0, expected: 0 };
function instrument(page) {
  const Cb = page.R && page.R.Combat;
  if (!Cb || typeof Cb.resolve !== 'function') return;
  const real = Cb.resolve;
  Cb.resolve = function (duel, pm, rm, opts) {
    const live = !!(duel && !duel.over && duel.r && !(opts && opts.unchecked));
    const lr = live ? Cb.legal(duel, 'r') : null, at = live ? duel.n + '.' + duel.phase + ' turn ' + duel.turn : '';
    const res = real.apply(this, arguments);
    COERCE.resolves++;
    const ev = (res && res.events) || [];
    if (ev.some(e => e && e.t === 'note' && e.side === 'p')) COERCE.player++;
    if (live && (ev.some(e => e && e.t === 'note' && e.side === 'r') || lr.indexOf(rm) < 0 || res.rm !== rm)) {
      if (page.coerceExpected > 0) { page.coerceExpected--; COERCE.expected++; }
      else {
        COERCE.rival++;
        fail('the Rival sealed move ' + rm + ' was replaced at resolve by ' + (res && res.rm) + ' (legal ' + lr.join(',') + ', duel ' + at + ')');
      }
    }
    return res;
  };
}

function makePage(store, view, opt) {
  opt = opt || {};
  const ts0 = 1000 + Math.floor(sysRand() * 1e6);                 // always drawn, so opt.ts does not shift the stream
  const page = {
    store, view, ts: typeof opt.ts === 'number' ? opt.ts : ts0, frameNo: 0, rafCb: null, timeouts: [], tid: 0, coerceExpected: 0,
    lw: {}, ld: {}, c: newCounters(), buttons: [], bubbleLines: 0, dbg: null, maxDbg: { t: 0, c: 0, w: 0 },
    audioLog: [], seenOpts: new WeakSet(), trackFresh: false, alive: true, pointer: null, hidden: false, landscape: false,
    lastTexts: [], keepTexts: false, layoutChecks: opt.layoutChecks !== false
  };
  const H = {
    c: page.c, realDraw: opt.realDraw !== false, width: null, has: null,
    now: () => clock.ms, rand: opt.randomTrap ? opt.randomTrap : sysRand,
    fresh(o) { if (page.trackFresh && o && typeof o === 'object' && !page.seenOpts.has(o)) { page.seenOpts.add(o); page.c.fresh++; } },
    text(text, x, y, pal, opts) {
      page.c.texts++; H.fresh(opts);
      if (typeof text !== 'string') { fail('Font.draw non-string: ' + String(text) + ' @' + page.scene()); return; }
      if (page.keepTexts) page.lastTexts.push(text);
      if (text.length > 6 && text.charCodeAt(text.length - 1) >= 48 && /fps .* t\d+ c\d+ w\d+$/.test(text)) {   // engine debug readout
        const m = /t(\d+) c(\d+) w(\d+)$/.exec(text);
        page.dbg = { t: +m[1], c: +m[2], w: +m[3] };
        if (page.dbg.t > page.maxDbg.t) page.maxDbg.t = page.dbg.t;
        if (page.dbg.c > page.maxDbg.c) page.maxDbg.c = page.dbg.c;
        if (page.dbg.w > page.maxDbg.w) page.maxDbg.w = page.dbg.w;
        return;
      }
      if (!fin(x, y)) { fail('Font.draw NaN position for "' + text + '" @' + page.scene()); return; }
      if (!(pal >= 1 && pal <= 31)) fail('Font.draw bad palette ' + pal + ' for "' + text + '" @' + page.scene());
      if (!page.layoutChecks) return;
      if (/undefined|null|NaN|\{\w+\}|\[object/.test(text)) fail('suspicious text "' + text + '" @' + page.scene());
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch !== '\n' && !H.has(ch) && '’‘“”– ×'.indexOf(ch) < 0) fail('glyph missing for "' + ch + '" in "' + text + '"');
      }
      const scale = opts && opts.scale > 1 ? opts.scale | 0 : 1, w = H.width(text, scale);
      const left = opts && opts.align === 'center' ? x - (w >> 1) : opts && opts.align === 'right' ? x - w : x;
      if (left < 0 || left + w > 180) fail('text off screen (' + left + '..' + (left + w) + ') @' + page.scene() + ': "' + text + '"');
    },
    fighter(who, name, frame, x, y, opts, def) {
      H.fresh(opts);
      if (!fin(x, y, frame)) fail('Art.fighter NaN ' + [who, name, frame, x, y]);
      if (def && (frame < 0 || frame >= def.n || frame !== (frame | 0))) fail('Art.fighter frame out of range: ' + name + ' ' + frame);
    },
    sprite(name, x, y, opts) { H.fresh(opts); if (!SPRITES.has(name)) fail('unknown sprite "' + name + '"'); if (!fin(x, y)) fail('sprite NaN position ' + name); },
    sigil(x, y, state, move, side) {
      if (!fin(x, y)) fail('sigil NaN');
      if (['sealed', 'crack', 'open', 'gone'].indexOf(state) < 0) fail('sigil state ' + state);
      if (state === 'open' && ['S', 'G', 'F'].indexOf(move) < 0) fail('sigil open without a move: ' + move);
    },
    bg(name, t, opts) {
      H.fresh(opts);
      if (!BGS.has(name)) fail('unknown bg ' + name);
      if (opts && opts.floorY !== undefined && !(fin(opts.floorY) && opts.floorY > 0 && opts.floorY < page.E.H)) fail('bg floorY ' + opts.floorY + ' @' + page.scene());
    },
    panel(x, y, w, h) { if (!(fin(x, y, w, h) && w > 0 && h > 0)) fail('panel bad rect ' + [x, y, w, h] + ' @' + page.scene()); else if (x < 0 || x + w > 180) fail('panel off screen @' + page.scene()); },
    button(x, y, w, h, label, st) {
      H.fresh(st);
      const E = page.E;
      if (!(fin(x, y, w, h) && w > 0 && h > 0)) { fail('button bad rect ' + [x, y, w, h]); return; }
      if (page.layoutChecks) {
        if (h < 20) fail('button shorter than 20 px: "' + label + '" h=' + h + ' @' + page.scene());
        if (x < 0 || x + w > 180 || y < E.safe.top || y + h > E.H - E.safe.bottom) fail('button outside the safe area @' + page.scene() + ' "' + label + '" ' + [x, y, w, h] + ' H=' + E.H + ' safe=' + E.safe.top + '/' + E.safe.bottom + ' view ' + page.view.name);
        if (label && H.width(label) > w - 8) fail('button label too wide: "' + label + '"');
      }
      page.buttons.push({ x, y, w, h, label: label || '', disabled: !!(st && st.disabled) });
    },
    bubble(x, y, w, lines, opts) {
      H.fresh(opts); H.fresh(lines);
      page.bubbleLines = lines.length;
      if (!page.layoutChecks) return;
      if (lines.length > 3) fail('bubble with ' + lines.length + ' lines');
      for (let i = 0; i < lines.length; i++) if (H.width(lines[i]) > w - 8) fail('bubble line too wide: "' + lines[i] + '"');
    },
    bar(x, y, w, h, frac, lag, pal, opts) { H.fresh(opts); if (!fin(x, y, w, h, frac, lag)) fail('bar NaN ' + [x, y, w, h, frac, lag] + ' @' + page.scene()); else if (frac < 0 || frac > 1.0001) fail('bar fraction out of range ' + frac); },
    audio(fn, a) {
      page.audioLog.push(fn);
      if (page.audioLog.length > 4000) page.audioLog.splice(0, 2000);
      if (fn === 'sfx') { page.c.sfx++; if (a === 'type') page.c.type++; if (!SFX.has(a)) fail('unknown sfx "' + a + '"'); }
      if (fn === 'music' && !(a === null || a === undefined || MUSIC.has(a))) fail('unknown music "' + a + '"');
    }
  };
  function mkCtx() {
    return {
      fillStyle: '#000', globalAlpha: 1, imageSmoothingEnabled: true, strokeStyle: '#000', lineWidth: 1, globalCompositeOperation: 'source-over', font: '', textAlign: 'left', textBaseline: 'top',
      fillRect(x, y, w, h) { page.c.fillRect++; if (x !== x || y !== y || w !== w || h !== h) fail('fillRect NaN ' + [x, y, w, h] + ' @' + page.scene()); },
      drawImage(img, a, b) { page.c.drawImage++; if (!img) fail('drawImage without a source'); if (a !== a || b !== b) fail('drawImage NaN @' + page.scene()); },
      clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
      save() { page.c.save++; }, restore() { page.c.save--; },
      translate() {}, scale() {}, rotate() {}, setTransform() {}, resetTransform() {},
      createPattern() { return {}; },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
      getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
      putImageData() {}, fillText() {}, measureText() { return { width: 0 }; }
    };
  }
  function mkCanvas() { return { width: 300, height: 150, style: {}, getContext() { page.c.getContext++; return mkCtx(); } }; }
  const game = mkCanvas(), probe = { style: {} };
  page.canvas = game;
  const gameCtx = game.getContext;                                 // keep the visible context: the blind recorder hashes the blit (shake)
  game.getContext = function () { const c = gameCtx.apply(this, arguments); page.vctx = c; return c; };
  // A capture listener (third argument true or { capture: true }) runs before the bubble ones, as for an event that
  // targets an element below window / document.
  function listen(map) {
    return function (type, fn, o) {
      page.c.listeners++;
      (map[type] = map[type] || []).push({ fn, capture: o === true || !!(o && o.capture) });
    };
  }
  const doc = {
    readyState: 'complete', visibilityState: 'visible',
    documentElement: { clientWidth: view.vw, clientHeight: view.vh },
    body: { appendChild() {} },
    getElementById(id) { return id === 'game' ? game : id === 'safe' ? probe : null; },
    createElement() { page.c.createElement++; return mkCanvas(); },
    addEventListener: listen(page.ld)
  };
  const sb = {
    __H: H, document: doc,
    console: {
      log() {}, info() {}, warn() {}, debug() {},
      error() { const a = arguments[0]; fail('console.error @' + page.scene() + ': ' + (a && a.stack ? a.stack.split('\n').slice(0, 4).join(' | ') : String(a))); }
    },
    innerWidth: view.vw, innerHeight: view.vh, devicePixelRatio: view.dpr,
    location: { search: opt.search || '' },
    navigator: { vibrate() { page.c.vibrate++; return true; } },
    performance: { now: () => page.ts },
    requestAnimationFrame(cb) { page.rafCb = cb; return 1; },
    setTimeout(fn, ms) { page.timeouts.push({ id: ++page.tid, fn, at: page.ts + (ms || 0) }); return page.tid; },
    clearTimeout(id) { page.timeouts = page.timeouts.filter(t => t.id !== id); },
    setInterval() { return 0; }, clearInterval() {},
    getComputedStyle() { return { paddingTop: page.view.st + 'px', paddingBottom: page.view.sb + 'px' }; },
    matchMedia() { return { matches: page.landscape }; },
    PointerEvent: function PointerEvent() {},
    addEventListener: listen(page.lw)
  };
  Object.defineProperty(sb, 'localStorage', { get() { if (store.mode === 'deny') throw new Error('SecurityError: localStorage is denied'); return store.api; }, enumerable: true });
  sb.window = sb; sb.self = sb;
  const ctx = vm.createContext(sb);
  page.ctx = ctx; page.H = H;
  page.scene = () => (page.E ? page.E.sceneName : '(boot)');
  // Capture listeners first, then the rest; stopImmediatePropagation ends the dispatch, stopPropagation in a capture
  // listener skips the bubble ones. Returns the event (ev.defaultPrevented, ev.stopped).
  page.fire = function (target, type, ev) {
    const list = (target === 'window' ? page.lw : page.ld)[type];
    ev = ev || {};
    if (!list) return ev;
    let imm = false, prop = false;
    ev.defaultPrevented = false; ev.stopped = false;
    if (!ev.preventDefault) ev.preventDefault = function () { ev.defaultPrevented = true; };
    ev.stopImmediatePropagation = function () { imm = prop = true; ev.stopped = true; };
    ev.stopPropagation = function () { prop = true; ev.stopped = true; };
    ev.type = type;
    const order = list.filter(f => f.capture).concat(list.filter(f => !f.capture));
    for (let i = 0; i < order.length && !imm; i++) {
      if (prop && !order[i].capture) break;
      try { order[i].fn(ev); } catch (e) { fail('exception in ' + type + ' handler @' + page.scene() + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
    }
    return ev;
  };
  page.frame = function (dtMs) {
    if (!page.rafCb) { fail('requestAnimationFrame chain broken @' + page.scene()); return false; }
    page.ts += dtMs; clock.ms += dtMs; page.frameNo++;
    if (page.timeouts.length) {
      const due = page.timeouts.filter(t => t.at <= page.ts);
      page.timeouts = page.timeouts.filter(t => t.at > page.ts);
      for (const t of due) { try { t.fn(); } catch (e) { fail('exception in a timeout: ' + (e && e.stack || e)); } }
    }
    const cb = page.rafCb; page.rafCb = null;
    page.buttons.length = 0; page.bubbleLines = 0; page.c.save = 0;
    if (page.keepTexts) page.lastTexts.length = 0;
    try { cb(page.ts); }
    catch (e) { fail('exception in frame @' + page.scene() + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e)); return false; }
    if (page.c.save !== 0) fail('unbalanced g.save()/g.restore() @' + page.scene());
    return true;
  };
  // internal px -> client px
  function cx(x) { return parseFloat(game.style.left) + (x + 0.5) * parseFloat(game.style.width) / 180; }
  function cy(y) { return parseFloat(game.style.top) + (y + 0.5) * parseFloat(game.style.height) / page.E.H; }
  page.down = (x, y, id) => page.fire('window', 'pointerdown', { pointerId: id || 1, pointerType: 'touch', isPrimary: (id || 1) !== 2, button: 0, clientX: cx(x), clientY: cy(y), cancelable: true });
  page.move = (x, y, id) => page.fire('window', 'pointermove', { pointerId: id || 1, pointerType: 'touch', clientX: cx(x), clientY: cy(y), cancelable: true });
  page.up = (x, y, id) => page.fire('window', 'pointerup', { pointerId: id || 1, pointerType: 'touch', button: 0, clientX: cx(x), clientY: cy(y), cancelable: true });
  page.cancel = (id) => page.fire('window', 'pointercancel', { pointerId: id || 1, pointerType: 'touch', clientX: 0, clientY: 0 });
  page.key = (k) => page.fire('window', 'keydown', { key: k, cancelable: true });
  page.setHidden = function (h) {
    page.hidden = h; doc.visibilityState = h ? 'hidden' : 'visible';
    page.fire('document', 'visibilitychange', {});
    if (h) page.fire('window', 'pagehide', {}); else page.fire('window', 'pageshow', {});
  };
  page.resize = function (v) {
    page.view = v; sb.innerWidth = v.vw; sb.innerHeight = v.vh; sb.devicePixelRatio = v.dpr;
    doc.documentElement.clientWidth = v.vw; doc.documentElement.clientHeight = v.vh;
    page.fire('window', 'resize', {});
  };

  // ---- load
  try {
    PRELUDE.runInContext(ctx);
    if (opt.perf) PERF.runInContext(ctx);
    for (const f of ORDER_A) script(f).runInContext(ctx);
    FAKE_ART.runInContext(ctx);
    for (const f of ORDER_B) { script(f).runInContext(ctx); if (f === 'audio/audio.js') FAKE_AUDIO.runInContext(ctx); }
    for (const f of SCENE_FILES) script(f).runInContext(ctx);
    page.R = vm.runInContext('RIVAL', ctx);
    instrument(page);
    if (opt.beforeBoot) opt.beforeBoot(page);
    script('main.js').runInContext(ctx);                          // boots: document.readyState is 'complete'
  } catch (e) {
    fail('exception while loading/booting (' + (opt.label || store.mode) + '): ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join(' | ') : e));
    page.alive = false;
    return page;
  }
  page.E = page.R.Engine; page.G = page.R.Game;
  page.bootListeners = page.c.listeners;
  return page;
}

// Pure-module oracle (never touched by a page): used to predict what one beginTurn does to a saved duel.
const oracle = (function () {
  const ctx = vm.createContext({});
  for (const f of ['core/rng.js', 'ai/brain.js', 'game/boons.js', 'game/combat.js', 'game/run.js']) script(f).runInContext(ctx);
  const R = vm.runInContext('RIVAL', ctx);
  return { R, json: vm.runInContext('(function (s) { return JSON.parse(s); })', ctx) };
})();

// ---------------------------------------------------------------------------------------------- the bot
function findBtn(page, label) {
  for (const b of page.buttons) if (label instanceof RegExp ? label.test(b.label) : b.label === label) return b;
  return null;
}
function makeBot(rng, style) {
  const bot = { style, wait: 0, think: -1, held: null, taps: 0, keys: 0, noise: 0.02, stats: {} };
  function press(page, x, y, hold, how) {
    page.down(x, y);
    bot.held = { x, y, frames: hold === undefined ? rng.int(3) : hold, how: how || (rng.chance(0.04) ? (rng.chance(0.5) ? 'cancel' : 'slide') : 'up') };
    bot.taps++;
  }
  function tapBtn(page, b) { press(page, b.x + 2 + rng.int(Math.max(1, b.w - 4)), b.y + 2 + rng.int(Math.max(1, b.h - 4)), undefined, 'up'); }
  bot.act = function (page) {
    const E = page.E, G = page.G, R = page.R;
    if (bot.held) {
      const h = bot.held;
      if (h.frames-- > 0) return;
      bot.held = null;
      if (h.how === 'cancel') page.cancel();
      else if (h.how === 'slide') { page.move(h.x + 40, h.y - 60); page.up((h.x + 40) % 180, Math.max(0, h.y - 60)); }
      else page.up(h.x, h.y);
      return;
    }
    if (bot.wait > 0) { bot.wait--; return; }
    bot.wait = rng.int(4);
    const top = E.safe.top, bottom = E.H - E.safe.bottom, scene = E.sceneName, r = rng();
    if (r < bot.noise) { press(page, rng.int(180), rng.int(E.H)); return; }               // a stray tap anywhere
    if (r < bot.noise + 0.006) { page.key(rng.pick(['1', '2', '3', 'Enter', 'Escape', ' ', 's', 'g', 'f', 'x'])); bot.keys++; return; }
    if (r < bot.noise + 0.008) { page.down(rng.int(180), rng.int(E.H), 2); page.up(1, 1, 2); return; }   // a second finger
    let b;
    switch (scene) {
      case 'title': {
        b = findBtn(page, 'SURE?');
        if (b && rng.chance(0.5)) { tapBtn(page, b); return; }
        b = findBtn(page, 'NEW RUN');
        if (b && rng.chance(0.02)) { tapBtn(page, b); bot.wait = 2; return; }
        if (rng.chance(0.06)) { b = findBtn(page, rng.pick(['DOSSIER', 'UNLOCKS', 'SETTINGS'])); if (b) { tapBtn(page, b); return; } }
        b = findBtn(page, /BEGIN|CONTINUE/);
        if (b) tapBtn(page, b);
        return;
      }
      case 'relic': {
        if (rng.chance(0.5)) { press(page, 6 + rng.int(168), top + 24 + rng.int(140), 0, 'up'); return; }
        b = findBtn(page, rng.chance(0.93) ? 'CONFIRM' : 'BACK');
        if (b) tapBtn(page, b);
        return;
      }
      case 'duel': {
        const moves = page.buttons.filter(q => (q.label === 'STRIKE' || q.label === 'GUARD' || q.label === 'FEINT'));
        const open = moves.filter(q => !q.disabled);
        if (!open.length) { bot.think = -1; if (rng.chance(0.35)) press(page, 20 + rng.int(140), top + 50 + rng.int(100), 0, 'up'); return; }
        if (bot.think < 0) bot.think = rng.chance(0.25) ? 8 + rng.int(60) : rng.int(4);    // sometimes hesitate (reload windows, idle heckle)
        if (bot.think-- > 0) {
          const acts = page.buttons.filter(q => q.label === '' && q.w === 22 && !q.disabled);
          if (acts.length && rng.chance(0.08)) tapBtn(page, rng.pick(acts));
          else if (rng.chance(0.02)) press(page, 84 + rng.int(12), top + 20 + rng.int(12), 0, 'up');   // the boon ledger
          return;
        }
        const pend = G.run && G.run.pending, pk = R.Scenes.duel.peek();
        const rm = pend && pend.sealed ? pend.sealed.move : null;    // (white box: the bot cheats so that runs reach every stage)
        let want = null;
        const st = bot.style;
        if (st === 'cheat') want = rng.chance(0.9) && rm ? R.LOSES_TO[rm] : null;
        else if (st === 'lose') want = rng.chance(0.85) && rm ? R.BEATS[rm] : null;
        else if (st === 'trust') want = pk && pk.tell ? R.LOSES_TO[pk.tell] : null;
        else if (st === 'mash') want = 'S';
        const label = want === 'S' ? 'STRIKE' : want === 'G' ? 'GUARD' : want === 'F' ? 'FEINT' : null;
        b = (label && open.find(q => q.label === label)) || rng.pick(open);
        if (rng.chance(0.15)) { page.key(b.label === 'STRIKE' ? '1' : b.label === 'GUARD' ? 'g' : '3'); bot.keys++; }
        else tapBtn(page, b);
        bot.think = -1;
        return;
      }
      case 'bonfire': {
        const okb = findBtn(page, 'CONFIRM'), dos = findBtn(page, 'DOSSIER');
        if (okb && !okb.disabled && rng.chance(0.75)) { tapBtn(page, okb); return; }
        if (dos && !dos.disabled) {                                  // the card choice is open
          const q = rng();
          if (q < 0.03) tapBtn(page, dos);
          else if (q < 0.75) press(page, 5 + rng.int(170), bottom - 157 + rng.int(46), 0, 'up');
          else press(page, 4 + rng.int(172), bottom - 260 + rng.int(100), 0, 'up');       // strip / the Rival's pick / nothing
          return;
        }
        if (rng.chance(0.4)) press(page, rng.int(180), top + rng.int(200), 0, 'up');
        return;
      }
      case 'dossier': case 'unlocks': {
        if (rng.chance(0.3)) {                                       // drag-scroll
          const x = 20 + rng.int(140); let y = top + 40 + rng.int(120); const dy = (rng.chance(0.5) ? -1 : 1) * (5 + rng.int(25));
          page.down(x, y);
          for (let k = 0; k < 5; k++) { y += dy; page.move(x, y); }
          bot.held = { x, y: Math.max(0, Math.min(E.H - 1, y)), frames: 1, how: 'up' };
          return;
        }
        if (rng.chance(0.3)) { press(page, 10 + rng.int(160), top + 30 + rng.int(150), 0, 'up'); return; }
        b = findBtn(page, 'BACK');
        if (b) tapBtn(page, b);
        return;
      }
      case 'settings': {
        const q = rng();
        const pick = q < 0.12 ? /^MUTE/ : q < 0.24 ? /^HAPTICS/ : q < 0.3 ? 'REPLAY CREDITS' : null;
        b = pick ? findBtn(page, pick) : null;
        if (!b && q >= 0.3 && q < 0.45) { const wide = page.buttons.filter(z => z.label === '' && z.w === 172 && z.h === 24); if (wide.length) b = rng.pick(wide); }
        if (!b && q >= 0.45 && q < 0.5) { b = findBtn(page, /RESET SAVE|HOLD TO ERASE/); if (b) { press(page, b.x + 20, b.y + 8, 3 + rng.int(20), 'up'); return; } }   // released early: nothing is erased
        if (!b) b = findBtn(page, 'BACK');
        if (b) tapBtn(page, b);
        return;
      }
      default:                                                        // death, victory, credits
        if (rng.chance(0.3)) press(page, 10 + rng.int(160), top + 20 + rng.int(200), 0, 'up');
    }
  };
  return bot;
}

// ---------------------------------------------------------------------------------------------- the monitor
// Host-side expectations that survive reloads.
function commitOf(p) { return JSON.stringify({ sealed: p.sealed, turn: p.turn, n: p.n, phase: p.phase, called: p.called || null }); }
function coreOf(d) {
  const f = x => ({ hp: x.hp, maxHp: x.maxHp, status: x.status, charges: x.charges, counters: x.counters, moves: x.moves, results: x.results, boons: x.boons });
  return JSON.stringify({ n: d.n, phase: d.phase, turn: d.turn, tension: d.tension, over: d.over, begun: d.begun, p: f(d.p), r: f(d.r), tally: d.tally });
}
function makeMonitor(store) {
  const mon = {
    exp: null, runKey: undefined, turns: 0, duelN: 0, phase: 1, commit: null, inputOpen: false, pendingStr: null,
    offers: {}, bonfireHp: {}, after: null, phase2Hp: null, lastDuelHp: 0, sig: '', sigAt: 0, simSec: 0, runStartSec: 0,
    count: { runs: 0, deaths: 0, wins: 0, abandons: 0, turns: 0, bonfires: 0, fourCard: 0, phase2: 0, credits: 0, midTurnReloads: 0, midTurnVerified: 0,
      betweenTurnVerified: 0, bonfireReloadVerified: 0, lethalReloads: 0, transformReloads: 0, relicRuns: 0, stakeRuns: 0, earlyCalls: 0, laterPhases: 0, faceRuns: 0, tutorialTurns: 0, calledShots: 0, activesUsed: 0, persistedEqual: 0 },
    trust: true                                                     // false while storage is failing (nothing survives a reload)
  };
  const J = JSON.stringify;
  mon.keyOf = run => (run ? run.seed + ':' + run.runNo : null);
  mon.sync = function (page) {                                      // adopt the loaded state as the expectation
    const m = page.G.meta.memory || {};
    mon.exp = { runs: m.runs | 0, wins: m.wins | 0, deaths: m.deaths | 0 };
    mon.runKey = mon.keyOf(page.G.run);
    mon.turns = page.G.run ? page.G.run.stats.turns : 0;
    mon.duelN = page.G.run ? page.G.run.duelN : 0;
    mon.phase = page.G.run ? page.G.run.phase : 1;
    mon.commit = null; mon.inputOpen = false; mon.after = null; mon.phase2Hp = null;
  };
  // Called right after a reload. `snapRaw` is what was in storage when the old page went away.
  mon.reloaded = function (page, snapRaw, before) {
    mon.inputOpen = false; mon.pendingStr = null; mon.lastReload = before; mon.lastReloadAt = mon.simSec;
    const G = page.G;
    if (!mon.trust || mon.malformed) { mon.sync(page); return; }
    let snap = null;
    try { snap = snapRaw ? JSON.parse(snapRaw) : null; } catch (e) { snap = null; }
    if (!ok(!!snap, 'reload: storage had no parseable save although writes succeed')) { mon.sync(page); return; }
    // A run made under newer rules than this build's is parked at every boot until a save stores the move (P1.1).
    const RR = page.R.Run, parked = !!(snap.run && typeof snap.run === 'object' && RR.reqOf && RR.reqOf(snap.run) > RR.RULES);
    const want = parked ? null : snap.run;
    if (parked) ok(J(page.R.Save.data.parked) === J(snap.run), 'reload: a stored run from newer rules must be parked, not played');
    ok(J(G.run) === J(want), () => 'reload: R.Game.run differs from the stored run (stage ' + (snap.run && snap.run.stage) + '): ' + diffKeys(want, G.run));
    ok(J(G.meta) === J(snap.meta), () => 'reload: R.Game.meta differs from the stored meta: ' + diffKeys(snap.meta, G.meta));
    const m = G.meta.memory;
    ok(m.runs === mon.exp.runs && m.wins === mon.exp.wins && m.deaths === mon.exp.deaths,
      () => 'reload lost progress: stored runs/wins/deaths ' + [m.runs, m.wins, m.deaths] + ' but ' + [mon.exp.runs, mon.exp.wins, mon.exp.deaths] + ' happened (' + before + ')');
    ok(mon.keyOf(G.run) === mon.runKey, () => 'reload: the run in storage is ' + mon.keyOf(G.run) + ', live was ' + mon.runKey + ' (' + before + ')');
    // The transformation is stored when its HP count-up ends. A page killed before that comes back in phase 1: either
    // already won (resume() transforms again) or one bleed tick short of it (the turn start is replayed and kills the
    // Rival again). Nothing is applied twice: the phase-2 fighter is rebuilt from the same phase-1 state.
    if (G.run && mon.phase >= 2 && G.run.phase === mon.phase - 1 && G.run.duelN === 7 && G.run.duel && G.run.stats.turns === mon.turns) { mon.phase--; mon.phase2Hp = null; mon.count.phase2--; }
    if (G.run) {
      ok(G.run.stats.turns === mon.turns, () => 'reload: stored stats.turns ' + G.run.stats.turns + ' != live ' + mon.turns + ' (' + before + ')');
      ok(G.run.duelN === mon.duelN, () => 'reload: stored duelN ' + G.run.duelN + ' != live ' + mon.duelN + ' (' + before + ')');
    }
    mon.after = want ? { run: want, turns: want.stats ? want.stats.turns : 0 } : null;
  };
  mon.check = function (page, dt) {
    const R = page.R, G = page.G, E = page.E, run = G.run, meta = G.meta;
    mon.simSec += dt;
    // ---- run lifecycle and lifetime counters
    const key = mon.keyOf(run);
    if (mon.runKey === undefined) mon.sync(page);
    if (key !== mon.runKey) {
      if (mon.runKey !== null) {                                   // the previous run is over
        if (G.last && G.last.won && key === null) { mon.exp.wins++; mon.count.wins++; }
        else { mon.exp.deaths++; mon.count.deaths++; if (!G.last) mon.count.abandons++; }
      }
      if (key !== null) {
        mon.exp.runs++; mon.count.runs++; mon.runStartSec = mon.simSec;
        ok(run.duelN === 1 && run.stats.turns === 0 && run.stage === 'duel', 'a new run must start at duel 1, turn 0');
        if (run.relicId) mon.count.relicRuns++;
        if (run.stake > 0) mon.count.stakeRuns++;
        if (run.boss && run.boss !== 'unmasked') mon.count.faceRuns++;
        ok(R.Run.BOSSES.findIndex(b => b.id === run.boss) < G.meta.bosses.max, () => 'the run drew a face that was not earned: ' + run.boss);
        ok(run.stake >= 0 && run.stake <= 7 && run.stake <= G.meta.vigil.max, () => 'run stake ' + run.stake + ' beyond the earned lights ' + G.meta.vigil.max);
        ok((run.stake >= 4) === !!run.rivalHead, () => 'The Empty Hand: stake ' + run.stake + ' but head boon ' + run.rivalHead);
      }
      mon.runKey = key; mon.turns = 0; mon.duelN = key ? 1 : 0; mon.phase = 1; mon.commit = null; mon.inputOpen = false; mon.after = null; mon.phase2Hp = null;
    }
    const m = meta.memory;
    if (!m) { fail('R.Game.meta has no .memory (a stored meta of an older shape was not repaired at boot)'); mon.progress(page, 'nomem|' + E.sceneName + '|' + page.buttons.length); return; }
    ok(m.runs === mon.exp.runs && m.wins === mon.exp.wins && m.deaths === mon.exp.deaths,
      () => 'meta.memory runs/wins/deaths ' + [m.runs, m.wins, m.deaths] + ' != what happened ' + [mon.exp.runs, mon.exp.wins, mon.exp.deaths] + ' @' + E.sceneName);
    if (!run) { mon.progress(page, 'norun|' + E.sceneName + '|' + page.buttons.length); return; }

    // ---- structure
    const st = run.stats, d = run.duel;
    if (!(fin(run.duelN, run.pHp, run.pMaxHp) && st && Array.isArray(st.duelTurns) && fin(st.turns) && (!d || (d.p && d.r && Array.isArray(d.p.moves) && Array.isArray(d.r.moves))))) {
      fail('boot accepted a malformed run from storage as R.Game.run (validRun is too weak): ' + JSON.stringify(run).slice(0, 120));
      mon.progress(page, 'malformed|' + E.sceneName + '|' + page.buttons.length);
      mon.trust = false; mon.malformed = true;
      return;
    }
    ok(run.duelN >= mon.duelN && run.duelN <= 7, () => 'duelN regressed or overflowed: ' + mon.duelN + ' -> ' + run.duelN);
    if (run.duelN > mon.duelN) { ok(run.duelN === mon.duelN + 1, 'duelN skipped'); mon.duelN = run.duelN; mon.phase = 1; mon.phase2Hp = null; }
    ok(!(run.phase < mon.phase && run.duelN === 7), () => 'phase regressed ' + mon.phase + ' -> ' + run.phase + ' @' + E.sceneName + ' (duel turn ' + (d && d.turn) + ', over ' + (d && d.over) + ', duel phase ' + (d && d.phase) + ', stats.turns ' + st.turns + ', last reload: ' + mon.lastReload + ', ' + (mon.simSec - mon.lastReloadAt).toFixed(1) + ' s ago)');
    if (run.duelN === 7 && run.phase > mon.phase) {                // a phase change just happened
      ok(run.phase === mon.phase + 1 && run.phase <= R.Run.phaseCount(run), () => 'phase jumped ' + mon.phase + ' -> ' + run.phase + ' (' + run.boss + ' has ' + R.Run.phaseCount(run) + ')');
      mon.phase = run.phase; mon.count.phase2++;
      if (run.phase > 2) mon.count.laterPhases++;
      if (d) {
        const row = R.Run.cfg(run, d), heal = R.Run.stakeOf(run) >= 5 ? 0 : (row.heal !== null ? row.heal : R.Run.PHASE2_HEAL);
        mon.phase2Hp = d.p.hp;
        ok(d.p.hp === Math.min(d.p.maxHp, Math.max(1, mon.lastDuelHp) + heal), () => 'heal at the phase change is wrong: ' + mon.lastDuelHp + ' -> ' + d.p.hp + ' (' + run.boss + ' phase ' + run.phase + ')');
        ok(d.floor === row.floor && d.tension >= d.floor && (d.stance || null) === row.stance && !!d.mimic === row.mimic, () => 'the phase started with the wrong rules: ' + run.boss + ' phase ' + run.phase);
      }
    }
    if (d && d.phase === mon.phase) mon.lastDuelHp = d.p.hp;
    if (d) ok(d.tension >= R.Combat.floorOf(d) && d.tension <= 3, () => 'tension ' + d.tension + ' outside ' + R.Combat.floorOf(d) + '..3');
    ok(fin(run.pHp, run.pMaxHp) && run.pHp >= 0 && run.pHp <= run.pMaxHp, 'run.pHp out of range: ' + run.pHp + '/' + run.pMaxHp);
    if (d) ok(fin(d.p.hp, d.r.hp) && d.p.hp <= d.p.maxHp && d.r.hp <= d.r.maxHp, 'duel hp out of range');
    const relic = run.pBoons.length && /^relic_/.test(run.pBoons[0]) ? 1 : 0, done = run.stage === 'bonfire' ? run.duelN : run.duelN - 1;
    if (run.stage === 'duel' || run.stage === 'bonfire') {
      ok(run.pBoons.length === relic + (run.stage === 'bonfire' ? done - 1 : done), () => 'player boons ' + run.pBoons.length + ' at duel ' + run.duelN + ' stage ' + run.stage + ' (relic ' + relic + '): a reward was duplicated or lost');
      ok(run.rBoons.length === done + (run.rivalHead ? 1 : 0), () => 'Rival boons ' + run.rBoons.length + ' after ' + done + ' finished duels (stage ' + run.stage + ')');
      ok(new Set(run.pBoons.concat(run.rBoons)).size === run.pBoons.length + run.rBoons.length, 'a boon is owned twice');
    }
    // ---- turn accounting
    if (st.turns !== mon.turns) {
      ok(st.turns === mon.turns + 1, () => 'stats.turns jumped ' + mon.turns + ' -> ' + st.turns);
      mon.count.turns++;
      if (d && ok(d.r.moves.length > 0 && d.p.moves.length === d.r.moves.length, 'moves not recorded on the fighters')) {
        const rm = d.r.moves[d.r.moves.length - 1];
        if (ok(!!mon.commit, 'a turn resolved without a commit having been observed')) {
          ok(mon.commit.n === d.n && mon.commit.phase === d.phase && mon.commit.turn === d.turn - 1, 'the resolved turn is not the committed one');
          ok(rm === mon.commit.move, () => 'the Rival played ' + rm + ' but had committed ' + mon.commit.move);
          if (mon.commit.reloaded) mon.count.midTurnVerified++;
        }
      }
      ok(run.pending === null, 'run.pending survived the resolve');
      mon.turns = st.turns; mon.commit = null; mon.inputOpen = false; mon.pendingStr = null; mon.after = null;
      if (mon.phase2Hp !== null) mon.phase2Hp = null;
    }
    let sum = 0;
    for (let i = 0; i < st.duelTurns.length; i++) sum += st.duelTurns[i];
    if (d && !d.closed) sum += d.p.moves.length;
    if (!mon.lenient) ok(sum === st.turns, () => 'stats.turns ' + st.turns + ' != turns on record ' + sum);
    if (mon.phase2Hp !== null && d && d.phase === mon.phase && d.phase >= 2) ok(d.p.hp === mon.phase2Hp, () => 'player hp changed between the transformation and the first phase-2 exchange: ' + mon.phase2Hp + ' -> ' + d.p.hp);

    // ---- the commit
    const pend = run.pending;
    if (pend && d) {
      const s = commitOf(pend);
      if (mon.commit && mon.commit.n === pend.n && mon.commit.phase === pend.phase && mon.commit.turn === pend.turn) {
        ok(s === mon.commit.str, () => 'the committed move/tell for duel ' + pend.n + ' turn ' + pend.turn + ' changed: ' + mon.commit.str + ' -> ' + s);
      } else {
        ok(pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase, 'run.pending is for another turn');
        mon.commit = { n: pend.n, phase: pend.phase, turn: pend.turn, move: pend.sealed.move, tell: pend.sealed.tell, str: s, reloaded: false };
        if (pend.called) mon.count.calledShots++;
        if (pend.called && pend.phase === 1) { mon.count.earlyCalls++; ok(run.stake >= 7, () => 'a Called Shot before phase 2 at stake ' + run.stake); }
      }
    }
    const pk = E.sceneName === 'duel' ? R.Scenes.duel.peek() : null;
    if (pk && pk.input) {
      if (ok(!!pend && !!d && pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase, 'input is enabled but the Rival has not committed for this turn')) {
        if (!mon.inputOpen) {
          mon.inputOpen = true;
          if (d.stance === 'none') ok(pk.tell === null, 'a stance was shown in a fight that shows none');
          else ok(pk.tell === pend.sealed.tell, 'the stance shown is not the committed tell');
          ok(R.Combat.legal(d, 'r').indexOf(pend.sealed.move) >= 0, 'the committed move is not legal');
          if (pk.only) mon.count.tutorialTurns++;
          if (mon.trust) {
            const saved = store.parsed();
            ok(saved && saved.run && saved.run.pending && commitOf(saved.run.pending) === commitOf(pend), 'input enabled before the commit reached storage');
            if (saved && saved.run && J(saved.run) === J(run)) mon.count.persistedEqual++;
            else ok(false, () => 'at the input window the stored run differs from the live run: ' + diffKeys(saved && saved.run, run));
          }
          const a = mon.after;                                     // first input window after a reload
          if (a && a.run.duel && a.turns === st.turns && a.run.duelN === run.duelN && a.run.phase === run.phase && !a.run.duel.over && a.run.stage === 'duel') {
            const sp = a.run.pending;
            if (sp && sp.turn === a.run.duel.turn) {
              ok(coreOf(d) === coreOf(a.run.duel), () => 'mid-turn reload changed the duel: ' + coreOf(a.run.duel) + ' -> ' + coreOf(d));
              ok(commitOf(pend) === commitOf(sp), 'mid-turn reload changed the commit');
              mon.commit.reloaded = true;
            } else {
              const o = oracle.json(J(a.run.duel));
              oracle.R.Combat.beginTurn(o);
              ok(coreOf(d) === coreOf(o), () => 'reload between turns: turn start applied wrongly (expected ' + coreOf(o) + ' got ' + coreOf(d) + ')');
              mon.count.betweenTurnVerified++;
            }
            mon.after = null;
          }
        } else ok(commitOf(pend) === mon.pendingStr, 'run.pending changed while the input window was open');
        mon.pendingStr = commitOf(pend);
      }
    } else if (mon.inputOpen && !(pk && pk.input)) mon.inputOpen = false;

    // ---- the bonfire
    if (run.stage === 'bonfire') {
      const o = run.offer, bk = key + ':' + run.duelN;
      if (ok(!!o, 'stage bonfire without an offer')) {
        const s = J({ c: o.choices, r: o.rivalPick, w: o.rivalWhy, h: o.healed });
        if (!mon.offers[bk]) {
          mon.offers[bk] = s; mon.bonfireHp[bk] = run.pHp; mon.count.bonfires++;
          if (o.choices.length > 3) mon.count.fourCard++;
          ok(o.choices.length >= 1, 'bonfire offer has no choices (the scene cannot be left)');
          if (d) ok(run.pHp === Math.min(run.pMaxHp, Math.max(0, d.p.hp) + o.healed), () => 'bonfire heal: duel hp ' + d.p.hp + ' + ' + o.healed + ' != ' + run.pHp);
        } else {
          ok(mon.offers[bk] === s, () => 'the bonfire offer was rerolled: ' + mon.offers[bk] + ' -> ' + s);
          ok(mon.bonfireHp[bk] === run.pHp, () => 'hp changed during the bonfire: ' + mon.bonfireHp[bk] + ' -> ' + run.pHp);
        }
        if (mon.after && mon.after.run.stage === 'bonfire' && E.sceneName === 'bonfire') { mon.count.bonfireReloadVerified++; mon.after = null; }
      }
    } else if (d && d.turn === 1 && !d.over && d.phase === 1 && run.duelN > 1 && !d.p.moves.length) {
      const prev = mon.bonfireHp[key + ':' + (run.duelN - 1)];
      if (prev !== undefined && d.begun !== 1) ok(d.p.hp === prev, () => 'hp at the start of duel ' + run.duelN + ' is ' + d.p.hp + ', the bonfire left ' + prev);
    }
    mon.progress(page, E.sceneName + '|' + run.duelN + '|' + run.phase + '|' + run.stage + '|' + st.turns + '|' + (d ? d.turn + (d.over || '') : '') + '|' + (pend ? 1 : 0) + '|' + (pk && pk.input ? 1 : 0) + '|' + page.buttons.map(b => (b.disabled ? '-' : '+')).join(''));
  };
  mon.progress = function (page, sig) {
    if (sig !== mon.sig) { mon.sig = sig; mon.sigAt = mon.simSec; return; }
    if (mon.simSec - mon.sigAt > 45) {
      fail('soft-lock: no progress for 45 s @' + page.E.sceneName + ' sig ' + sig + ' buttons ' + page.buttons.map(b => b.label + (b.disabled ? '(off)' : '')).join(','));
      mon.sigAt = mon.simSec;
      mon.stuck = true;
    }
  };
  return mon;
}
function diffKeys(a, b) {
  if (!a || !b) return 'one side missing';
  const out = [];
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k + ': ' + String(JSON.stringify(a[k])).slice(0, 160) + ' vs ' + String(JSON.stringify(b[k])).slice(0, 160));
  return out.join(' ; ');
}

// ---------------------------------------------------------------------------------------------- session driver
// Plays until `runs` runs have ended (or the frame budget is gone). Returns the last page and the monitor.
function session(o) {
  const rng = mulberry(o.seed), store = o.store || makeStore(), mon = makeMonitor(store);
  mon.trust = o.trust === undefined ? store.mode === 'ok' : o.trust;
  mon.lenient = !!o.lenient;                                       // (an old-shape duel may be dropped at boot: its turns stay unbooked)
  const reloadP = o.reloadP === undefined ? 1 : o.reloadP;
  let page = makePage(store, o.view || rng.pick(VIEWS), o.pageOpt);
  if (!page.alive) return { page, mon, store, ended: 0 };
  const writes0 = store.writes;                                     // (boot itself never writes)
  let bot = makeBot(rng, o.style || 'cheat'), ended = 0, frames = 0, runFrames = 0, reloads = 0, runReloads = 0, plan = null, cat = '', lastKey;
  const kinds = {};
  const maxFrames = o.maxFrames || 4e6;
  function styleFor(n) { const q = rng(); return o.style || (q < 0.42 ? 'cheat' : q < 0.7 ? 'random' : q < 0.84 ? 'lose' : q < 0.94 ? 'trust' : 'mash'); }
  function category() {
    const G = page.G, E = page.E, run = G.run, sc = E.sceneName;
    if (!run) return sc === 'death' || sc === 'victory' || sc === 'credits' ? 'F:' + sc : 'G:menu';
    const d = run.duel;
    if (run.stage === 'bonfire') return 'D:bonfire' + (sc === 'dossier' ? '-dossier' : '');
    if (sc !== 'duel') return 'G:menu-run';
    if (d && d.over) return run.duelN === 7 && d.phase === 1 && d.over === 'p' ? 'E:transform' : 'C:lethal';
    if (d && d.phase >= 2 && d.turn === 1 && !run.pending) return 'E:transform2';
    const pk = page.R.Scenes.duel.peek();
    if (run.pending) return pk && pk.input ? 'A:input' : 'B:committed';
    return 'I:between';
  }
  const P = { A: 0.05, B: 0.06, C: 0.3, D: 0.25, E: 0.6, F: 0.2, G: 0.04, I: 0.04 }, SPAN = { A: 40, B: 8, C: 50, D: 220, E: 150, F: 200, G: 60, I: 50 };
  function reload(why) {
    const flush = rng.chance(0.6);
    if (flush) page.setHidden(true);                               // a real close: visibilitychange + pagehide
    const raw = store.raw(), before = why + (flush ? ' +flush' : ' kill') + ' @' + page.E.sceneName;
    if (mon.trust && flush) {                                      // after a flush the stored run is the live run
      const live = JSON.stringify(page.G.run), saved = store.parsed();
      ok(saved && JSON.stringify(saved.run) === live, () => 'pagehide flush did not store the live run (' + before + '): ' + diffKeys(saved && saved.run, page.G.run));
    }
    const k = why.split(':')[0];
    kinds[why] = (kinds[why] || 0) + 1;
    if (why === 'A:input' || why === 'B:committed') mon.count.midTurnReloads++;
    if (k === 'C') mon.count.lethalReloads++;
    if (k === 'E') mon.count.transformReloads++;
    page = makePage(store, o.view || rng.pick(VIEWS), o.pageOpt);
    reloads++; runReloads++;
    if (!page.alive) return false;
    bot.held = null; bot.think = -1;
    // Nothing written since the session's first boot: this boot repeats it (a save of an older or newer shape is
    // repaired, parked or redrawn the same way again), so its state is adopted rather than compared with storage.
    if (store.writes === writes0) mon.sync(page);
    else mon.reloaded(page, raw, before);
    return true;
  }
  where = o.label || 'session';
  const fails0 = fails;
  while (ended < o.runs && frames < maxFrames && fails - fails0 < 8) {
    const dtMs = o.dt || (frames % 97 < 60 ? 33.4 : 16.7);
    if (!page.frame(dtMs)) break;
    frames++; runFrames++;
    mon.check(page, Math.min(0.05, dtMs / 1000));
    if (mon.stuck) break;
    if (mon.runKey !== lastKey) {
      if (lastKey) { ended++; runFrames = 0; runReloads = 0; if (o.onRunEnd) o.onRunEnd(page, mon, ended); }
      if (mon.runKey) bot = makeBot(rng, styleFor(ended));
      lastKey = mon.runKey;
      if (ended >= o.runs) break;
      if (!mon.runKey && rng.chance(0.15)) clock.ms += 86.4e6 * (1 + rng.int(9));   // come back days later
    }
    if (runFrames > 60000) { fail('run did not terminate within 60000 frames (' + bot.style + ') @' + page.E.sceneName); break; }
    // reload injection
    if (reloadP > 0 && runReloads < 14) {
      const c = category();
      if (c !== cat) { cat = c; const k = c[0]; plan = rng.chance(P[k] * reloadP) ? { at: frames + rng.int(SPAN[k]), cat: c } : null; }
      if ((plan && frames >= plan.at) || rng.chance(0.0003 * reloadP)) {
        const why = plan && frames >= plan.at ? plan.cat : 'R:random(' + c + ')';
        plan = null; cat = '';
        if (!reload(why)) break;
        continue;
      }
    }
    bot.act(page);
    if (o.onFrame) o.onFrame(page, mon, frames);
  }
  if (frames >= maxFrames) fail('session frame budget exhausted (' + frames + ' frames, ' + ended + '/' + o.runs + ' runs)');
  return { page, mon, store, ended, frames, reloads, kinds };
}

// ---------------------------------------------------------------------------------------------- helpers for scripted tests
function run60(page, n, each) { for (let i = 0; i < n; i++) { if (!page.frame(16.7)) return false; if (each) each(i); } return true; }
function tapXY(page, x, y) { page.down(x, y); page.frame(16.7); page.up(x, y); page.frame(16.7); }
function tapLabel(page, label) {
  const b = findBtn(page, label);
  if (!b) { fail('button not found: ' + label + ' @' + page.scene() + ' (have ' + page.buttons.map(q => q.label).join(' | ') + ')'); return false; }
  tapXY(page, b.x + (b.w >> 1), b.y + (b.h >> 1));
  return true;
}
function waitScene(page, name, maxFrames) {
  for (let i = 0; i < (maxFrames || 600); i++) { if (page.E.sceneName === name) return true; if (!page.frame(16.7)) return false; }
  return page.E.sceneName === name;
}
// Plays with a cheating bot until the predicate holds (or gives up).
function playUntil(page, store, pred, o) {
  o = o || {};
  const rng = mulberry(o.seed || 99), bot = makeBot(rng, o.style || 'cheat');
  bot.noise = 0;
  for (let i = 0; i < (o.max || 200000); i++) {
    if (pred(page)) return true;
    if (!page.frame(33.4)) return false;
    bot.act(page);
  }
  fail('playUntil: gave up (' + (o.what || '?') + ') @' + page.scene());
  return false;
}

// ============================================================================================== 1. the soak
const t0 = Date.now();
const total = { runs: 0, frames: 0, reloads: 0, kinds: {}, count: null, views: {} };
function addCount(c) {
  if (!total.count) { total.count = Object.assign({}, c); return; }
  for (const k in c) total.count[k] += c[k];
}
function soak() {
  const per = Math.max(1, Math.round(RUNS / 10)), only = process.env.FLOW_ONLY;
  let left = RUNS, i = 0, bytes = [], maxDbg = { t: 0, c: 0, w: 0 }, listenersGrew = 0;
  while (left > 0 && fails < 40) {
    const n = Math.min(per, left);
    if (only !== undefined && +only !== i) { left -= n; i++; continue; }
    const res = session({
      label: 'soak#' + i, seed: SEED * 1000 + i, runs: n,
      pageOpt: { realDraw: i % 3 === 0 },
      onRunEnd(page) { bytes.push(page.store.lastBytes); },
      onFrame(page) {
        if (page.frameNo === 5) page.E.debug = true;               // the engine's own t/c/w readout
        // (white box) every other session plays with lights of the Vigil out: earned, then a different count each run
        const pm = (i & 1) && page.G && !page.G.run ? page.G.meta : null;
        if (pm && pm.vigil && pm.seenTutorial) { pm.vigil.max = 7; pm.vigil.sel = (pm.memory.runs * 3 + i) % 8; }
        if (pm && pm.bosses && pm.seenTutorial) pm.bosses.max = page.R.Run.BOSSES.length;      // ... and with every face earned
        if (page.c.listeners !== page.bootListeners) { listenersGrew++; page.bootListeners = page.c.listeners; }
      }
    });
    left -= n; i++;
    total.runs += res.ended; total.frames += res.frames || 0; total.reloads += res.reloads || 0;
    for (const k in res.kinds) total.kinds[k] = (total.kinds[k] || 0) + res.kinds[k];
    addCount(res.mon.count);
    if (res.page.maxDbg) for (const k in maxDbg) if (res.page.maxDbg[k] > maxDbg[k]) maxDbg[k] = res.page.maxDbg[k];
    if (res.ended < n) { fail('soak session ' + i + ' ended after ' + res.ended + '/' + n + ' runs'); break; }
  }
  where = 'soak';
  const c = total.count || {};
  ok(listenersGrew === 0, 'event listeners were added after boot (' + listenersGrew + ' times)');
  ok(c.wins > 0 && c.deaths > 0, 'the soak must see both wins and deaths (wins ' + c.wins + ', deaths ' + c.deaths + ')');
  ok(c.phase2 > 0, 'no run reached phase 2');
  if (only === undefined && RUNS >= 20) ok(c.stakeRuns > 0, 'no run was played with lights of the Vigil out');
  ok(c.midTurnVerified > 0, 'no mid-turn reload was verified');
  ok(c.bonfireReloadVerified > 0, 'no bonfire reload was verified');
  ok(c.lethalReloads > 0 && c.transformReloads > 0, 'no reload after a lethal blow / during the transformation');
  console.log('soak: ' + total.runs + ' runs (' + c.wins + ' wins, ' + c.deaths + ' deaths incl. ' + c.abandons + ' abandoned), ' + c.turns + ' turns, ' + c.bonfires + ' bonfires (' + c.fourCard +
    ' with 4 cards), ' + c.phase2 + ' phase-2, ' + c.relicRuns + ' relic runs, ' + c.stakeRuns + ' Vigil runs, ' + c.faceRuns + ' runs against a later face (' + c.laterPhases + ' third or fourth phases), ' + c.calledShots + ' called shots (' + c.earlyCalls + ' before phase 2), ' + c.tutorialTurns + ' tutorial turns');
  console.log('      ' + total.frames + ' frames, ' + total.reloads + ' reloads: ' + Object.keys(total.kinds).sort().map(k => k + ' ' + total.kinds[k]).join(', '));
  console.log('      verified: mid-turn commit unchanged ' + c.midTurnVerified + '/' + c.midTurnReloads + ' reloads (the rest never resolved that turn before the next reload), between-turn state ' +
    c.betweenTurnVerified + ', bonfire offers ' + c.bonfireReloadVerified + ', stored==live at input ' + c.persistedEqual);
  console.log('      engine peak timers/coroutines/tweens: ' + maxDbg.t + '/' + maxDbg.c + '/' + maxDbg.w + '; save size first/last run: ' + bytes[0] + ' / ' + bytes[bytes.length - 1] + ' bytes (max ' + Math.max.apply(null, bytes) + ')');
  ok(maxDbg.c <= 4, 'coroutines pile up: ' + maxDbg.c);
  ok(maxDbg.t <= 16 && maxDbg.w <= 24, 'timers/tweens pile up: ' + maxDbg.t + '/' + maxDbg.w);
  ok(Math.max.apply(null, bytes) < 200000, 'the save grows too large: ' + Math.max.apply(null, bytes) + ' bytes');
}

// ============================================================================================== 1b. one long-lived page
// The soak reloads every few hundred frames, so nothing there lives long. This is one page, no reload, 30+ simulated
// minutes: pools, caches, timers, listeners and the JS heap must stay flat.
function longSession() {
  let gc = null;
  try { require('v8').setFlagsFromString('--expose-gc'); gc = vm.runInNewContext('gc'); } catch (e) { gc = null; }
  const marks = [];
  let page0 = null, listeners0 = 0, canvases = 0, simMin = 0;
  const res = session({
    label: 'long', seed: SEED * 4099 + 7, runs: QUICK ? 6 : 24, reloadP: 0, pageOpt: { realDraw: true },
    onFrame(page) { if (!page0) { page0 = page; } if (page.frameNo === 5) { page.E.debug = true; listeners0 = page.c.listeners; } },
    onRunEnd(page, mon, n) { if (gc) { gc(); marks.push(process.memoryUsage().heapUsed); } simMin = mon.simSec / 60; canvases = page.c.createElement; }
  });
  where = 'long';
  const page = res.page;
  ok(page === page0, 'the long session must stay on one page');
  ok(page.c.listeners === listeners0, 'event listeners grew during the session: ' + listeners0 + ' -> ' + page.c.listeners);
  ok(page.maxDbg.c <= 4 && page.maxDbg.t <= 16 && page.maxDbg.w <= 24, 'engine timers/coroutines/tweens pile up: ' + JSON.stringify(page.maxDbg));
  ok(canvases <= 64, 'canvases keep being created: ' + canvases);
  ok(QUICK || simMin >= 30, 'the long session only covered ' + simMin.toFixed(1) + ' simulated minutes');
  let growth = NaN;
  if (marks.length >= 6) {
    const third = Math.floor(marks.length / 3), a = Math.max.apply(null, marks.slice(third, 2 * third)), b = Math.max.apply(null, marks.slice(2 * third));
    growth = (b - a) / 1048576;
    ok(growth < 4, 'JS heap keeps growing on a long-lived page: +' + growth.toFixed(2) + ' MB between the middle and the last third of the session');
  }
  console.log('long session: ' + res.ended + ' runs, ' + res.frames + ' frames, ' + simMin.toFixed(1) + ' simulated minutes on one page; canvases ' + canvases + ', listeners ' + page.c.listeners +
    ', peak timers/coroutines/tweens ' + page.maxDbg.t + '/' + page.maxDbg.c + '/' + page.maxDbg.w + ', heap after gc ' + (marks.length ? (marks[marks.length - 1] / 1048576).toFixed(1) + ' MB (middle third -> last third: ' + (growth >= 0 ? '+' : '') + growth.toFixed(2) + ' MB)' : 'n/a') +
    ', save ' + page.store.lastBytes + ' bytes');
}

// ============================================================================================== 2. storage failures
function storageTests() {
  for (const mode of ['failWrite', 'failAll', 'deny']) {
    const store = makeStore(); store.mode = mode;
    const res = session({ label: 'storage:' + mode, seed: SEED * 31 + mode.length, runs: QUICK ? 3 : 6, store, reloadP: 0.5 });
    where = 'storage:' + mode;
    ok(res.ended >= (QUICK ? 3 : 6), 'runs did not finish with storage mode ' + mode + ' (' + res.ended + ')');
    ok(store.map.size === 0, 'something was written although storage is failing');
    if (res.page.alive) { res.page.G.save(); ok(res.page.R.Save.persistent === false, 'R.Save.persistent should be false when writes fail'); }
  }
  // storage starts failing in the middle of a session, then comes back
  const store = makeStore();
  let flips = 0;
  const res = session({
    label: 'storage:flaky', seed: SEED * 77, runs: QUICK ? 3 : 6, store, reloadP: 0, trust: false,
    onFrame(page, mon, f) { if (f % 900 === 450) { store.mode = 'failWrite'; flips++; } else if (f % 900 === 0) store.mode = 'ok'; }
  });
  where = 'storage:flaky';
  ok(res.ended >= (QUICK ? 3 : 6) && flips > 0, 'flaky storage: runs did not finish');
}

// ============================================================================================== 3. corrupt / old saves
function collectSaves() {                                           // real saves from every stage of a run
  const store = makeStore(), out = [], seen = new Set();
  session({
    label: 'collect', seed: SEED * 5 + 3, runs: QUICK ? 6 : 14, store, reloadP: 0, style: null,
    onFrame(page, mon) {
      const run = page.G.run, d = run && run.duel;
      const tag = !run ? 'none:' + page.E.sceneName : run.stage + ':' + run.duelN + ':' + run.phase + ':' + (d ? (d.over || '') + (run.pending ? 'P' : '') : '');
      if (!seen.has(tag) && store.raw()) { seen.add(tag); out.push({ tag, raw: store.raw() }); }
    }
  });
  return out;
}
function bootAndPlay(label, raw, runs, expectFresh) {
  const store = makeStore();
  if (raw !== null) store.map.set(KEY, raw);
  where = label;
  const res = session({ label, seed: SEED * 13 + label.length, runs: runs || 1, store, reloadP: 0.3, maxFrames: 400000, lenient: /^oldshape/.test(label) });
  where = label;
  ok(res.ended >= (runs || 1), 'could not finish a run after booting from this save');
  return res;
}
function corruptTests() {
  const saves = collectSaves();
  where = 'corrupt';
  ok(saves.length >= 8, 'collected only ' + saves.length + ' distinct saves');
  const rng = mulberry(SEED + 4242);
  const garbage = ['', ' ', 'null', 'undefined', '[]', '42', '"x"', '{', '{"v":1', '{"v":1,"run":"x","meta":7,"brain":[],"settings":null}', '{"v":2,"settings":{"muted":"yes","mask":7}}',
    '{"v":1,"run":{"stage":"duel","stats":{},"pBoons":[],"rBoons":[]}}', '{"v":1,"run":{"stage":"bonfire","stats":{},"pBoons":[],"rBoons":[]},"meta":{}}',
    '{"v":1,"meta":{"unlocked":null,"memory":null,"counters":null}}', '\u0000\u0001�', 'x'.repeat(3000)];
  let n = 0;
  for (const gb of garbage) { bootAndPlay('corrupt:garbage#' + n, gb, 1); n++; }
  // truncated real saves
  const cuts = QUICK ? 6 : 24;
  for (let i = 0; i < cuts; i++) {
    const s = rng.pick(saves).raw;
    bootAndPlay('corrupt:truncated#' + i, s.slice(0, 1 + rng.int(s.length - 1)), 1);
  }
  // older shapes: real saves with fields removed
  const strips = [
    ['settings', o => { delete o.settings; }],
    ['meta.counters', o => { if (o.meta) delete o.meta.counters; }],
    ['settings+meta.counters', o => { delete o.settings; if (o.meta) delete o.meta.counters; }],
    ['meta.memory', o => { if (o.meta) delete o.meta.memory; }],
    ['meta.memory.favorites', o => { if (o.meta && o.meta.memory) delete o.meta.memory.favorites; }],
    ['meta.unlocked', o => { if (o.meta) delete o.meta.unlocked; }],
    ['meta={}', o => { o.meta = {}; }],
    ['brain', o => { o.brain = null; }],
    ['brain={}', o => { o.brain = {}; }],
    ['run.pending', o => { if (o.run) delete o.run.pending; }],
    ['run.offer.seen/events', o => { if (o.run && o.run.offer) { delete o.run.offer.seen; delete o.run.offer.events; delete o.run.offer.bonfire; } }],
    ['run.stats.flags+spent', o => { if (o.run) { delete o.run.stats.flags; delete o.run.stats.spent; } }],
    ['run.stats extras', o => { if (o.run) o.run.stats = { turns: o.run.stats.turns, moves: o.run.stats.moves, duelTurns: o.run.stats.duelTurns }; }],
    ['run.duel.intel/tally/begun', o => { if (o.run && o.run.duel) { delete o.run.duel.intel; delete o.run.duel.tally; delete o.run.duel.begun; delete o.run.duel.pendingEvents; } }],
    ['run.finished/runNo/daysAway', o => { if (o.run) { delete o.run.finished; delete o.run.runNo; delete o.run.daysAway; delete o.run.relicId; } }],
    ['v', o => { delete o.v; }],
    // Every persisted field added since the first release gets a strip (each new field gets one; P1.1 added the last six),
    // then saves from a newer build: rules this build does not know (the run is parked and survives every save), a
    // face it does not know (redrawn), shadow high-water keys above its tables (kept), and garbage in each new field.
    ['meta.vigil', o => { if (o.meta) delete o.meta.vigil; }],
    ['meta.bosses', o => { if (o.meta) delete o.meta.bosses; }],
    ['run.stake', o => { if (o.run) delete o.run.stake; }],
    ['run.boss', o => { if (o.run) delete o.run.boss; }],
    ['run.phase', o => { if (o.run) delete o.run.phase; }],
    ['run.req', o => { if (o.run) delete o.run.req; }],
    ['meta.bosses.hi', o => { if (o.meta && o.meta.bosses) delete o.meta.bosses.hi; }],
    ['meta.vigil.hi', o => { if (o.meta && o.meta.vigil) delete o.meta.vigil.hi; }],
    ['meta.vigil.winsX', o => { if (o.meta && o.meta.vigil) delete o.meta.vigil.winsX; }],
    ['parked', o => { delete o.parked; }],
    ['newer: run.req=99', o => { if (o.run) o.run.req = 99; }, (res, o) => {
      const sv = res.store.parsed();
      if (o.run) ok(sv && JSON.stringify(sv.parked) === JSON.stringify(o.run), 'a run from newer rules must be parked as stored and survive a whole run of saves');
    }],
    ['newer: unknown run.boss', o => { if (o.run) o.run.boss = 'face_of_a_later_build'; }],
    ['newer: hi and winsX above the tables', o => {
      if (!o.meta) return;
      const b = o.meta.bosses = o.meta.bosses || {}, v = o.meta.vigil = o.meta.vigil || {};
      b.hi = 9; b.max = 9; v.hi = 12; v.max = 12;
      v.wins = (Array.isArray(v.wins) ? v.wins.slice(0, 8) : []).concat([0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 8).concat([3, 1]);
    }, (res, o) => {
      const sv = res.store.parsed(), mt = sv && sv.meta;
      if (o.meta) ok(mt && mt.bosses.hi === 9 && mt.vigil.hi === 12 && mt.vigil.winsX && mt.vigil.winsX['8'] === 3 && mt.vigil.winsX['9'] === 1 && mt.vigil.wins.length === 8 && mt.vigil.max === 7,
        () => 'shadow high-water keys were lost or not applied: ' + JSON.stringify(mt && { bosses: mt.bosses, vigil: mt.vigil }));
    }],
    ['garbage: the new fields', o => {
      if (o.run) { o.run.req = 'x'; o.run.phase = 'x'; o.run.boss = 7; }
      if (o.meta) { o.meta.bosses = Object.assign({}, o.meta.bosses, { hi: 'x' }); o.meta.vigil = Object.assign({}, o.meta.vigil, { hi: {}, winsX: 7 }); }
      o.parked = 'x';
    }, (res) => { const sv = res.store.parsed(); ok(sv && sv.parked === 'x', 'a parked value this build cannot read must be kept, never deleted'); }]
  ];
  let m = 0;
  for (const [name, fn, after] of strips) {
    const picks = QUICK ? [rng.pick(saves)] : [rng.pick(saves), rng.pick(saves), rng.pick(saves)];
    for (const s of picks) {
      const o = JSON.parse(s.raw); fn(o);
      const res = bootAndPlay('oldshape:' + name + ' (' + s.tag + ')#' + (m++), JSON.stringify(o), 1);
      if (after) after(res, o);
    }
  }
  console.log('corrupt/old saves: ' + garbage.length + ' garbage, ' + cuts + ' truncated, ' + m + ' old-shape boots from ' + saves.length + ' real saves; each then played a full run');
}

// ============================================================================================== 4. visibility / pause
function pauseTests() {
  where = 'pause';
  const store = makeStore(), page = makePage(store, VIEWS[5]);
  if (!page.alive) return;
  const E = page.E, G = page.G;
  playUntil(page, store, p => p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input, { what: 'first input window' });
  run60(page, 10);
  const a0 = page.audioLog.length, t1 = E.time, w0 = store.writes;
  page.R.Save.data.flushMark = 1 + (page.R.Save.data.flushMark | 0);   // something new to store (a save with nothing new writes nothing)
  page.setHidden(true);
  ok(E.paused === true, 'E.paused must be true while hidden');
  ok(page.audioLog.slice(a0).indexOf('suspend') >= 0, 'audio must suspend on visibilitychange');
  ok(store.writes > w0 && store.raw() === JSON.stringify(page.R.Save.data) && JSON.stringify(store.parsed().run) === JSON.stringify(G.run), 'hiding the page must flush a save of the live state');
  run60(page, 30);
  ok(E.time === t1, 'time advanced while hidden');
  page.ts += 600000; clock.ms += 600000;                            // ten minutes away
  const a1 = page.audioLog.length;
  page.setHidden(false);
  ok(E.paused === false, 'E.paused must clear when visible again');
  ok(page.audioLog.slice(a1).indexOf('resume') >= 0, 'audio must resume when visible again');
  page.frame(16.7);
  ok(E.time - t1 <= 0.051, 'dt spike after returning: ' + (E.time - t1));
  page.frame(16.7);
  ok(E.time - t1 <= 0.11, 'dt spike on the second frame back: ' + (E.time - t1));
  // rAF stalls without a visibility event (tab throttled): dt is clamped
  const t2 = E.time; page.frame(30000);
  ok(E.time - t2 <= 0.051, 'unclamped dt after a stall: ' + (E.time - t2));
  // window blur pauses; the next tap unpauses and is delivered
  const a2 = page.audioLog.length;
  page.fire('window', 'blur', {});
  ok(E.paused === true, 'blur should pause');
  const t3 = E.time; run60(page, 20);
  ok(E.time === t3, 'time advanced while paused by blur');
  page.keepTexts = true; page.frame(16.7);
  ok(page.lastTexts.indexOf('PAUSED') >= 0, 'PAUSED banner missing');
  page.keepTexts = false;
  page.down(90, E.safe.top + 80); page.up(90, E.safe.top + 80);
  ok(E.paused === false, 'a tap should unpause');
  ok(page.audioLog.slice(a2).filter(x => x === 'suspend').length === 1 && page.audioLog.slice(a2).indexOf('resume') >= 0, 'blur/tap should suspend and resume audio once');
  // pointer held while the page hides: the press is released, nothing is picked
  const turns = G.run.stats.turns;
  const b = findBtn(page, 'STRIKE') || findBtn(page, 'GUARD') || findBtn(page, 'FEINT');
  run60(page, 2);
  const open = page.buttons.filter(q => /STRIKE|GUARD|FEINT/.test(q.label) && !q.disabled)[0];
  if (ok(!!open, 'no move button open for the held-pointer test')) {
    page.down(open.x + 10, open.y + 10);
    page.setHidden(true); page.setHidden(false);
    page.up(open.x + 10, open.y + 10);
    run60(page, 30);
    ok(G.run.stats.turns === turns, 'a press interrupted by a pause must not pick a move');
  }
  // a touch whose pointerup never arrives must not kill input: the next primary touch takes over
  page.down(90, E.safe.top + 80, 71);                                // ...and no up, ever
  run60(page, 5);
  const open2 = page.buttons.filter(q => /STRIKE|GUARD|FEINT/.test(q.label) && !q.disabled)[0];
  if (ok(!!open2, 'no move button open for the lost-pointerup test')) {
    page.down(open2.x + 10, open2.y + 10, 72); page.frame(16.7); page.up(open2.x + 10, open2.y + 10, 72);
    run60(page, 90);
    ok(G.run.stats.turns === turns + 1, 'input is dead after a lost pointerup (touch pointer ids are never reused)');
    for (let i = 0; i < 600 && !(page.R.Scenes.duel.peek() && page.R.Scenes.duel.peek().input); i++) page.frame(16.7);
  }
  // landscape on a touch device: frozen, input ignored
  const pv = page.view, turns4 = G.run.stats.turns;
  page.landscape = true; page.resize({ name: 'landscape', vw: pv.vh, vh: pv.vw, dpr: pv.dpr, st: 0, sb: 21 }); page.frame(16.7);
  ok(E.rotated === true, 'E.rotated not set in landscape');
  const t4 = E.time; run60(page, 20);
  ok(E.time === t4, 'time advanced while rotated');
  for (let i = 0; i < 20; i++) { page.down(10 + i * 8, 100 + i * 9); page.up(10 + i * 8, 100 + i * 9); page.frame(16.7); }
  ok(G.run.stats.turns === turns4, 'input was accepted under the rotate overlay');
  page.landscape = false; page.resize(pv); page.frame(16.7);
  ok(E.rotated === false, 'E.rotated stuck');
  run60(page, 3);
  ok(page.buttons.some(q => /STRIKE|GUARD|FEINT/.test(q.label)), 'duel did not come back after rotating');
  // audio unlock: init must be attempted inside a tap's activation (pointerup / touchend), not only on pointerdown
  const p2 = makePage(makeStore(), VIEWS[0]);
  run60(p2, 30);
  const l0 = p2.audioLog.length;
  p2.down(90, 200);
  const downInit = p2.audioLog.slice(l0).indexOf('init') >= 0, l1 = p2.audioLog.length;
  p2.up(90, 200);
  const upLog = p2.audioLog.slice(l1);
  ok(downInit, 'R.Audio.init() not called on the first pointerdown');
  ok(upLog.indexOf('init') >= 0, 'R.Audio.init() not called on pointerup (touch pointerdown is not a user activation: iOS/Chrome only unlock audio on pointerup/touchend)');
}

// ============================================================================================== 5. scripted reload moments
function scriptedReloads() {
  where = 'scripted';
  // (a) first win, the page is killed on the victory screen: the credits must still be reachable
  let store = makeStore(), page = makePage(store, VIEWS[2]);
  if (!page.alive) return;
  playUntil(page, store, p => p.E.sceneName === 'victory', { what: 'first victory', seed: 5 });
  ok(page.G.meta.memory.wins === 1 && page.G.last && page.G.last.firstWin === true, 'first win not flagged');
  ok(store.parsed().run === null && store.parsed().meta.memory.wins === 1, 'the win was not stored before the victory screen');
  page = makePage(store, VIEWS[2]);                                  // kill + reload
  ok(waitScene(page, 'title', 120), 'reload on victory should land on the title');
  run60(page, 40);
  ok(page.G.meta.memory.wins === 1 && !page.G.hasRun(), 'win lost by the reload');
  tapLabel(page, 'SETTINGS'); waitScene(page, 'settings', 120); run60(page, 30);
  ok(!!findBtn(page, 'REPLAY CREDITS'), 'credits unreachable: the page closed on the first victory screen, so seenCredits was never set and settings hides REPLAY CREDITS');
  if (findBtn(page, 'REPLAY CREDITS')) {
    tapLabel(page, 'REPLAY CREDITS'); ok(waitScene(page, 'credits', 200), 'REPLAY CREDITS did not open the credits');
    page.keepTexts = true; let saw = false;
    for (let i = 0; i < 2400 && page.E.sceneName === 'credits'; i++) { page.frame(33.4); if (page.lastTexts.indexOf('Developed by tangoSHELL · 2026') >= 0) saw = true; }
    page.keepTexts = false;
    ok(saw, 'the credits roll never showed "Developed by tangoSHELL · 2026"');
    ok(waitScene(page, 'settings', 400), 'credits (from settings) should return to settings');
  }
  // (b) the title shows the credit line
  page = makePage(makeStore(), VIEWS[0]); page.keepTexts = true; run60(page, 40);
  ok(page.lastTexts.indexOf('Developed by tangoSHELL · 2026') >= 0, 'title screen lacks the credit line');
  // (c) erase everything: storage, brain, meta, run and the audio mute all reset
  store = makeStore(); page = makePage(store, VIEWS[5]);
  playUntil(page, store, p => p.G.run && p.G.run.duelN >= 2 && p.E.sceneName === 'duel', { what: 'duel 2', seed: 8 });
  page = makePage(store, VIEWS[5]); waitScene(page, 'title', 120); run60(page, 40);
  tapLabel(page, 'SETTINGS'); waitScene(page, 'settings', 120); run60(page, 30);
  tapLabel(page, /^MUTE/); run60(page, 5);
  ok(page.R.Save.data.settings.muted === true && store.parsed().settings.muted === true, 'mute not stored');
  const rb = findBtn(page, /RESET SAVE|HOLD TO ERASE/);
  if (ok(!!rb, 'no reset button')) {
    const l0 = page.audioLog.length;
    page.down(rb.x + 30, rb.y + 10); run60(page, 60);
    ok(page.G.run !== null, 'erased before the hold completed');
    run60(page, 60);
    page.up(rb.x + 30, rb.y + 10);
    ok(waitScene(page, 'title', 300), 'erase should return to the title');
    run60(page, 30);
    const sv = store.parsed();
    ok(page.G.run === null && page.G.meta.memory.runs === 0 && sv && sv.run === null && sv.meta.memory.runs === 0, 'erase left data behind');
    ok(page.R.Save.data.settings.muted === false, 'erase should reset settings');
    ok(page.audioLog.slice(l0).indexOf('setMuted') >= 0, 'after ERASE the settings say MUTE: OFF but R.Audio was never told (audio stays muted until the page reloads)');
    ok(!!findBtn(page, /BEGIN/) && !findBtn(page, 'CONTINUE'), 'title after erase should offer BEGIN');
  }
  // (d) reload at every frame of one turn: the commit never changes, nothing is applied twice
  store = makeStore(); page = makePage(store, VIEWS[6]);
  playUntil(page, store, p => p.G.run && p.G.run.duelN >= 3 && p.E.sceneName === 'duel' && p.G.run.pending && p.R.Scenes.duel.peek().input, { what: 'duel 3 input', seed: 21 });
  const base = store.raw(), snap = JSON.parse(base);
  let verified = 0;
  for (let k = 0; k < (QUICK ? 6 : 16); k++) {
    const st2 = makeStore(); st2.map.set(KEY, base);
    let p = makePage(st2, VIEWS[k % VIEWS.length]);
    waitScene(p, 'title', 120); run60(p, 20); tapLabel(p, 'CONTINUE');
    // let it run k*4 frames into the turn, then kill and reload again
    waitScene(p, 'duel', 200); run60(p, k * 4);
    p = makePage(st2, VIEWS[(k + 3) % VIEWS.length]);
    waitScene(p, 'title', 120); run60(p, 20); tapLabel(p, 'CONTINUE'); waitScene(p, 'duel', 200);
    for (let i = 0; i < 300 && !(p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input); i++) p.frame(16.7);
    const run = p.G.run;
    if (ok(!!run.pending, 'no pending after a double reload')) {
      ok(JSON.stringify(run.pending) === JSON.stringify(snap.run.pending), 'double reload changed the commit');
      ok(coreOf(run.duel) === coreOf(snap.run.duel), 'double reload changed the duel state');
      ok(p.R.Scenes.duel.peek().tell === snap.run.pending.sealed.tell, 'double reload changed the tell');
      verified++;
    }
  }
  // (e) Dealer's Thumb: four cards (2 x 2 layout) can be read, picked and confirmed
  where = 'scripted:4cards';
  store = makeStore(); page = makePage(store, VIEWS[3]);
  run60(page, 30);
  page.G.meta.unlocked.drafts_12 = true;                           // (white box: the relic's unlock)
  tapXY(page, 90, 200);
  if (ok(waitScene(page, 'relic', 200), 'a relic is unlocked but the title did not open the relic choice')) {
    run60(page, 30); tapLabel(page, 'CONFIRM');
    ok(waitScene(page, 'duel', 300) && page.G.run.relicId === 'relic_dealers_thumb', 'the relic was not taken into the run: ' + (page.G.run && page.G.run.relicId));
    playUntil(page, store, p => p.E.sceneName === 'bonfire' && findBtn(p, 'DOSSIER') && !findBtn(p, 'DOSSIER').disabled, { what: '4-card bonfire', seed: 31 });
    ok(page.G.run.offer && page.G.run.offer.choices.length === 4, 'Dealer\'s Thumb should offer 4 cards, got ' + (page.G.run.offer && page.G.run.offer.choices.length));
    const picked = new Set(), bottom = page.E.H - page.E.safe.bottom, cy0 = bottom - 157;
    for (const pt of [[40, cy0 + 8], [130, cy0 + 8], [40, cy0 + 32], [130, cy0 + 32]]) {
      tapXY(page, pt[0], pt[1]); run60(page, 3);
      const okb = findBtn(page, 'CONFIRM');
      ok(okb && !okb.disabled, 'card at ' + pt + ' of the 2 x 2 layout cannot be selected');
    }
    tapLabel(page, 'CONFIRM');
    ok(waitScene(page, 'duel', 600) && page.G.run.duelN === 2 && page.G.run.pBoons.length === 2, 'the 4-card bonfire could not be completed');
  }
  // (f) the boon ledger must list every boon of both fighters, also late in a run
  where = 'scripted:ledger';
  store = makeStore(); page = makePage(store, VIEWS[2]);            // 360x640@1: H = 320, the smallest arena
  playUntil(page, store, p => p.G.run && p.G.run.duelN === 7 && p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input, { what: 'duel 7 input', seed: 41, max: 600000 });
  if (page.G.run && page.G.run.duelN === 7) {
    const seen = new Set(), R = page.R, nameOf = id => ((R.Text.boon[id] || {}).name) || R.Boons.byId[id].name;
    page.keepTexts = true;
    tapXY(page, 90, page.E.safe.top + 26);
    for (let k = 0; k < 3; k++) { run60(page, 3); for (const t of page.lastTexts) seen.add(t); tapXY(page, 90, page.E.safe.top + 120); }
    page.keepTexts = false;
    const missR = page.G.run.rBoons.filter(id => !seen.has(nameOf(id))), missP = page.G.run.pBoons.filter(id => !seen.has(nameOf(id)));
    ok(missR.length === 0 && missP.length === 0, 'the boon ledger does not list ' + missR.length + ' of the Rival\'s ' + page.G.run.rBoons.length + ' boons and ' + missP.length + ' of the player\'s ' + page.G.run.pBoons.length + ' at duel 7');
    run60(page, 5);
    ok(page.R.Scenes.duel.peek().input && page.G.run.stats.turns === page.G.run.stats.turns, 'ledger left the duel in a bad state');
  }
  // (g) an active reveal that was paid for survives a reload
  where = 'scripted:reveal';
  store = makeStore(); page = makePage(store, VIEWS[5]);
  playUntil(page, store, p => p.E.sceneName === 'bonfire' && findBtn(p, 'DOSSIER') && !findBtn(p, 'DOSSIER').disabled, { what: 'bonfire 1', seed: 51 });
  if (page.G.run && page.G.run.pBoons.indexOf('truth_candle') < 0 && page.G.run.rBoons.indexOf('truth_candle') < 0) page.G.run.pBoons.unshift('truth_candle');   // (white box)
  const inputOpen = p => p.G.run && p.G.run.duelN === 2 && p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input;
  playUntil(page, store, inputOpen, { what: 'duel 2 input', seed: 52 });
  run60(page, 3);
  const act = page.buttons.filter(q => q.label === '' && q.w === 22 && !q.disabled)[0];
  if (ok(!!act, 'no usable active button for Candle of Truth')) {
    const sawStamp = p => { p.keepTexts = true; run60(p, 3); p.keepTexts = false; return p.lastTexts.indexOf('TRUE') >= 0 || p.lastTexts.indexOf('FALSE') >= 0; };
    const ch0 = page.G.run.duel.p.charges.truth_candle;
    tapXY(page, act.x + 8, act.y + 8);
    ok(page.G.run.duel.p.charges.truth_candle === ch0 - 1 && sawStamp(page), 'Candle of Truth did not show TRUE/FALSE');
    page = makePage(store, VIEWS[5]);                               // killed, reopened
    waitScene(page, 'title', 120); run60(page, 20); tapLabel(page, 'CONTINUE'); waitScene(page, 'duel', 200);
    for (let i = 0; i < 300 && !inputOpen(page); i++) page.frame(16.7);
    ok(page.G.run.duel.p.charges.truth_candle === ch0 - 1, 'the spent charge came back after a reload');
    ok(sawStamp(page), 'the Candle of Truth reveal was lost by the reload (the charge is spent, TRUE/FALSE is not shown again)');
  }
  where = 'scripted';
  console.log('scripted: first-win kill -> credits, erase, ' + verified + ' double reloads of one committed turn, 4-card bonfire, ledger, active reveal');
}

// ============================================================================================== 6. layout matrix
function layoutTests() {
  const rows = [];
  for (const v of VIEWS) {
    where = 'layout ' + v.name;
    const store = makeStore(), page = makePage(store, v);
    if (!page.alive) continue;
    const E = page.E;
    run60(page, 5);
    const cw = page.canvas.width, ch = page.canvas.height, dw = Math.round(v.vw * v.dpr), dh = Math.round(v.vh * v.dpr);
    ok(E.H >= 320 && E.H <= 400, 'E.H out of range: ' + E.H);
    ok(cw === 180 * E.scale && ch === E.H * E.scale && E.scale === (E.scale | 0) && E.scale >= 1, 'canvas is not an integer multiple: ' + cw + 'x' + ch + ' scale ' + E.scale);
    ok(cw <= dw && ch <= dh, 'canvas larger than the viewport: ' + cw + 'x' + ch + ' in ' + dw + 'x' + dh);
    ok(E.H - E.safe.top - E.safe.bottom >= 268, 'usable height under 268: ' + (E.H - E.safe.top - E.safe.bottom));
    rows.push(v.name + ' -> H ' + E.H + ' x' + E.scale + ' safe ' + E.safe.top + '/' + E.safe.bottom);
    // a tap at the centre of internal pixel (x, y) must map back to (x, y), at every dpr
    let got = null; const real = page.R.Scenes.title.down;
    page.R.Scenes.title.down = function (x, y) { got = [x, y]; };
    for (const pt of [[0, 0], [179, E.H - 1], [90, 160], [1, E.H - 2], [137, 211]]) {
      got = null; page.down(pt[0], pt[1]); page.cancel();
      ok(got && got[0] === pt[0] && got[1] === pt[1], 'pointer maps ' + pt + ' -> ' + got);
    }
    page.R.Scenes.title.down = real;
    // a short session on this viewport (layout validators are live in every scene), with a resize mid-run
    let flipped = false;
    session({ label: 'layout ' + v.name, seed: SEED * 17 + rows.length, runs: QUICK ? 1 : 2, view: v, reloadP: 0.4, style: rows.length % 2 ? 'cheat' : null,
      onFrame(p, mon, f) { if (f % 700 === 350) { p.resize(flipped ? v : VIEWS[(rows.length + 3) % VIEWS.length]); flipped = !flipped; } } });
  }
  console.log('layout: ' + rows.join(' | '));
}

// ============================================================================================== 7. per-frame allocation probe
function perfProbe() {
  where = 'perf';
  const store = makeStore(), out = [];
  let page = makePage(store, VIEWS[5], { perf: true });
  if (!page.alive) return;
  function measure(name, frames) {
    page.trackFresh = true;
    run60(page, 90);                                               // warm-up: every reusable opts object has been seen
    const c0 = Object.assign({}, page.c);
    run60(page, frames || 120);
    const n = frames || 120, c = page.c, d = k => (c[k] - c0[k]) / n;
    const row = { name, wrap: d('wrap'), fresh: d('fresh'), str: d('str'), arr: d('arr'), json: d('json'), canvas: d('createElement'), getContext: d('getContext'), texts: d('texts'), rects: d('fillRect') };
    out.push(row);
    page.trackFresh = false;
    return row;
  }
  function expectClean(row, allow) {
    allow = allow || {};
    for (const k of ['wrap', 'fresh', 'str', 'arr', 'json', 'canvas', 'getContext']) {
      ok(row[k] <= (allow[k] || 0) + 1e-9, () => 'per-frame allocation in ' + row.name + ': ' + k + ' = ' + row[k].toFixed(2) + '/frame');
    }
  }
  run60(page, 60);
  expectClean(measure('title (first launch)'));
  // a player with history: every menu
  playUntil(page, store, p => p.G.meta.memory.runs >= 2 && p.E.sceneName === 'duel' && p.G.run.duelN >= 2 && p.R.Scenes.duel.peek().input, { what: 'duel 2 input', seed: 3, style: 'cheat' });
  run60(page, 200);                                                // any bubble has finished
  expectClean(measure('duel (waiting for input)'));
  tapXY(page, 90, page.E.safe.top + 26);                           // the boon ledger overlay
  expectClean(measure('duel (boon ledger open)'));
  tapXY(page, 90, page.E.safe.top + 100);
  // one whole turn, including the reveal (bursts and floats may allocate at events, never per frame)
  page.trackFresh = true;
  const c0 = Object.assign({}, page.c), f0 = page.frameNo, turns = page.G.run.stats.turns;
  const open = page.buttons.filter(q => /STRIKE|GUARD|FEINT/.test(q.label) && !q.disabled)[0];
  if (open) tapXY(page, open.x + 10, open.y + 10);
  for (let i = 0; i < 400 && !(page.G.run && page.G.run.stats.turns > turns && page.R.Scenes.duel.peek() && page.R.Scenes.duel.peek().input); i++) page.frame(16.7);
  const nf = page.frameNo - f0;
  out.push({ name: 'duel (one full turn, ' + nf + ' frames)', wrap: (page.c.wrap - c0.wrap) / nf, fresh: (page.c.fresh - c0.fresh) / nf, str: (page.c.str - c0.str) / nf, arr: (page.c.arr - c0.arr) / nf,
    json: (page.c.json - c0.json) / nf, canvas: (page.c.createElement - c0.createElement) / nf, getContext: (page.c.getContext - c0.getContext) / nf, texts: 0, rects: 0 });
  page.trackFresh = false;
  playUntil(page, store, p => p.E.sceneName === 'bonfire' && findBtn(p, 'DOSSIER') && !findBtn(p, 'DOSSIER').disabled, { what: 'bonfire choice', seed: 4 });
  run60(page, 200);
  expectClean(measure('bonfire (card choice)'));
  tapXY(page, 30, page.E.H - page.E.safe.bottom - 140);
  expectClean(measure('bonfire (card selected)'));
  tapLabel(page, 'DOSSIER'); waitScene(page, 'dossier', 120);
  expectClean(measure('dossier'));
  page = makePage(store, VIEWS[5], { perf: true });
  waitScene(page, 'title', 60);
  expectClean(measure('title (run in progress)'));
  tapLabel(page, 'UNLOCKS'); waitScene(page, 'unlocks', 120);
  expectClean(measure('unlocks'));
  tapLabel(page, 'BACK'); waitScene(page, 'title', 120); run60(page, 30);
  tapLabel(page, 'SETTINGS'); waitScene(page, 'settings', 120);
  expectClean(measure('settings'));
  if (findBtn(page, 'REPLAY CREDITS')) {                           // (this save has a win)
    tapLabel(page, 'REPLAY CREDITS'); waitScene(page, 'credits', 200);
    expectClean(measure('credits (roll)', 200), { canvas: 0.05, getContext: 0.05 });   // (a font atlas for a colour first used here: once, not per frame)
    tapXY(page, 90, 150); run60(page, 10); tapXY(page, 90, 150); waitScene(page, 'settings', 300); run60(page, 30);
  }
  tapLabel(page, 'BACK'); waitScene(page, 'title', 120); run60(page, 30);
  playUntil(page, store, p => p.E.sceneName === 'death', { what: 'death', seed: 6, style: 'lose' });
  run60(page, 60); tapXY(page, 90, 150); run60(page, 240);
  expectClean(measure('death (final state)'));
  playUntil(page, store, p => p.E.sceneName === 'relic', { what: 'relic', seed: 7, style: 'lose', max: 400000 });
  expectClean(measure('relic'));
  playUntil(page, store, p => p.E.sceneName === 'victory', { what: 'victory', seed: 9, style: 'cheat', max: 600000 });
  run60(page, 60); tapXY(page, 90, 150); run60(page, 240);
  expectClean(measure('victory (final state)'));
  console.log('per-frame allocation proxies at steady state (calls per frame):');
  console.log('  scene                                wrap  freshObj  strOps  arrOps  json  canvas  getCtx');
  for (const r of out) console.log('  ' + (r.name + ' '.repeat(36)).slice(0, 36) + [r.wrap, r.fresh, r.str, r.arr, r.json, r.canvas, r.getContext].map(v => ('       ' + v.toFixed(2)).slice(-8)).join(''));
  console.log('  canvases created over the probe session: ' + page.c.createElement + ' (font atlases + pattern), getContext calls ' + page.c.getContext);
}

// ============================================================================================== 8. Math.random and gameplay
function randomTests() {
  where = 'random';
  // (a) Math.random must not be consulted from the logic modules: trap it and inspect the stack.
  let calls = 0, bad = 0;
  const base = mulberry(SEED + 999);
  const trap = function () {
    calls++;
    const st = new Error().stack;
    if (/[\\/](ai[\\/]brain|game[\\/](combat|boons|run))\.js/.test(st)) { bad++; fail('Math.random reached from a logic module: ' + st.split('\n').slice(1, 5).join(' | ')); }
    return base();
  };
  session({ label: 'random-trap', seed: SEED + 500, runs: QUICK ? 2 : 4, reloadP: 0.5, pageOpt: { randomTrap: trap } });
  where = 'random';
  ok(calls > 0 && bad === 0, 'Math.random trap: ' + bad + ' gameplay calls of ' + calls);
  // (b) with the seed fixed, gameplay does not depend on Math.random at all: two sessions that differ only in
  //     the cosmetic Math.random stream (after boot) must produce the same Rival commits for the same inputs.
  function trace(noiseSeed) {
    const store = makeStore(), noise = mulberry(noiseSeed), log = [];
    let booted = false;
    const page = makePage(store, VIEWS[2], { randomTrap: function () { return booted ? noise() : 0.5; } });
    const saveMs = clock.ms; clock.ms = 1.8e12;
    const G = page.G, R = page.R;
    run60(page, 30);
    tapLabel(page, /BEGIN/);                                         // freshSeed() runs here: Math.random is still the constant
    booted = true;
    let last = -1;
    for (let i = 0; i < 60000 && log.length < 40 && page.E.sceneName !== 'death'; i++) {
      page.frame(33.4);
      const pk = page.E.sceneName === 'duel' ? R.Scenes.duel.peek() : null;
      if (pk && pk.input && G.run.pending && G.run.stats.turns !== last) {
        last = G.run.stats.turns;
        log.push(G.run.pending.sealed.move + G.run.pending.sealed.tell);
        const lp = R.Combat.legal(G.run.duel, 'p'), want = pk.only || lp[(last * 7 + 1) % lp.length];
        const b = findBtn(page, want === 'S' ? 'STRIKE' : want === 'G' ? 'GUARD' : 'FEINT');
        page.down(b.x + 5, b.y + 5); page.up(b.x + 5, b.y + 5);
      } else if (page.E.sceneName === 'bonfire') {
        const okb = findBtn(page, 'CONFIRM');
        if (okb && !okb.disabled) { page.down(okb.x + 5, okb.y + 5); page.up(okb.x + 5, okb.y + 5); }
        else if (i % 9 === 0) { page.down(30, page.E.H - page.E.safe.bottom - 140); page.up(30, page.E.H - page.E.safe.bottom - 140); }
      } else if (i % 11 === 0 && !(pk && pk.input)) { page.down(90, page.E.safe.top + 90); page.up(90, page.E.safe.top + 90); }
    }
    clock.ms = saveMs;
    return log.join(' ');
  }
  const a = trace(1), b = trace(2);
  ok(a.length > 30 && a === b, 'the Rival\'s commits depend on Math.random beyond the seed:\n   ' + a + '\n   ' + b);
}

// ============================================================================================== shared by 9-14
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function canonV(v) {                                                // object keys sorted at every depth
  if (Array.isArray(v)) return v.map(canonV);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canonV(v[k]); return o; }
  return v;
}
// The brain.commit input as one canonical string (the dice state is taken before the commit draws).
function qCanon(q) {
  const c = Object.assign({}, q, { rng: q.rng && typeof q.rng.state === 'function' ? q.rng.state() : null, noTell: !!q.noTell, mimic: q.mimic || null, force: q.force || null });
  return JSON.stringify(canonV(JSON.parse(JSON.stringify(c))));
}
const RNG_INV = 0xdc58aa5d;                                         // mulberry32 adds 0x6d2b79f5 per draw: this is its inverse mod 2^32
const MOVE_LABEL = { S: 'STRIKE', G: 'GUARD', F: 'FEINT' };
function veteranSave(stake) {                                       // every unlock, every face earned, the Vigil at `stake`
  const O = oracle.R.Run, meta = O.defaultMeta();
  O.UNLOCKS.forEach(u => { meta.unlocked[u.id] = true; });
  meta.seenTutorial = true; meta.bosses.max = O.BOSSES.length; meta.vigil.max = O.VIGIL.length; meta.vigil.sel = stake || 0;
  return JSON.stringify({ v: 1, settings: { muted: false, haptics: true, mask: 'porcelain', arena: 'cathedral' }, brain: null, meta, run: null });
}

// Deterministic driver: one page plays cfg.runs runs to the end. Nothing in it reads time or cosmetic output, and
// a run's seed never depends on presentation time (the clock is pinned on the title and relic screens, Math.random
// is the constant 0.5 outside a run), so the gameplay is a function of cfg alone.
//   cfg = { clock0, runs, veteran?, stake?, face?, pre?:[boon ids], relic?, coin?, noise?, dt?, skips?, view?, qHash? }
//   face / pre / relic are test-only injection through R.Run.create (the face drawn, boons granted at the start).
// At each input window the bot plays the tutorial's only move, else the move that beats the sealed one on three
// turns of four and the one it beats on the fourth (falling back to the first legal move); with cfg.coin it throws
// the Coin of Fools on turn 2 when all three moves are open. hk.onInput(x) sees the window first; hk.stop() ends.
// Returns { log, frames, page, store, ended }: log = one entry per turn
//   { run, face, stake, n, ph, t, tut, commit: commitOf(pending), dCommit, dSeal, dWindow, pm, coin[, qHash] }
// (G.rng draws: dCommit from the last resolve to the frame run.pending appears, dSeal from then until the buttons
// light, dWindow from then until the resolve) and one per bonfire { run, draft, pick, rival }.
function drive(cfg, hk) {
  hk = hk || {};
  const store = makeStore();
  if (cfg.veteran) store.map.set(KEY, veteranSave(cfg.stake));
  const saveMs = clock.ms;
  clock.ms = cfg.clock0;
  const noise = mulberry(cfg.noise || 1);
  let menu = true;
  const page = makePage(store, cfg.view || VIEWS[2], {
    ts: 1000, search: cfg.search || '',
    randomTrap: () => (menu || !cfg.noise) ? 0.5 : noise(),
    beforeBoot(p) {
      const R = p.R, K = R.SceneKit;
      p.cardsDrawn = [];                                             // boon cards drawn this frame: { id, x, y, w, h }
      if (K && typeof K.card === 'function') {
        const kc = K.card;
        K.card = function (g, x, y, w, h, info) { if (info && info.id) p.cardsDrawn.push({ id: info.id, x: x | 0, y: y | 0, w, h }); return kc.apply(this, arguments); };
      }
      if (cfg.face || cfg.pre || cfg.relic) {
        const create = R.Run.create;
        R.Run.create = function (meta, o) {
          const oo = Object.assign({}, o);
          if (cfg.face) { oo.boss = cfg.face; oo.anyBoss = true; }
          if (cfg.relic) oo.relicId = cfg.relic;
          const run = create.call(this, meta, oo);
          for (const id of cfg.pre || []) if (run.pBoons.indexOf(id) < 0) run.pBoons.push(id);
          return run;
        };
      }
      if (cfg.qHash) {
        const bc = R.Brain.create;
        R.Brain.create = function () {
          const b = bc.apply(this, arguments), c = b.commit;
          b.commit = function (q) {
            const d = p.G && p.G.run && p.G.run.duel;
            p.lastQ = { key: d ? d.n + '.' + d.phase + '.' + d.turn : '', hash: sha(qCanon(q)).slice(0, 16) };
            return c.apply(this, arguments);
          };
          return b;
        };
      }
      if (hk.beforeBoot) hk.beforeBoot(p);
    }
  });
  const out = { log: [], frames: 0, page, store, ended: 0 };
  if (!page.alive) { clock.ms = saveMs; return out; }
  const G = page.G, R = page.R, E = page.E, log = out.log;
  let rngObj = null, s0 = 0, runIdx = 0, lastKey = null, lastTurns = -1, open = null, sealKey = null, sealRec = null, k = 0, frames = 0, inBonfire = false;
  let draftWant = null, bonfireFrames = 0;
  const since = () => { if (!rngObj) return 0; const s1 = rngObj.state(), n = Math.imul((s1 - s0) >>> 0, RNG_INV) >>> 0; s0 = s1; return n; };
  const tap = (x, y) => { page.down(x, y); page.up(x, y); };
  const tapB = b => tap(b.x + 5, b.y + 5);
  for (; frames < (cfg.maxFrames || 400000); frames++) {
    const sc0 = E.sceneName;
    menu = !G.hasRun();
    if (menu && (sc0 === 'title' || sc0 === 'relic')) clock.ms = cfg.clock0 + runIdx * 3.6e6;
    page.cardsDrawn.length = 0;
    if (!page.frame(menu ? 33.4 : (cfg.dt || 33.4))) break;
    if (G.rng !== rngObj) { rngObj = G.rng; s0 = rngObj ? rngObj.state() : 0; }   // a new run (main.js newRun) or boot
    const run = G.run, key = run ? run.seed + ':' + run.runNo : null;
    if (key !== lastKey) {
      if (lastKey) out.ended++;
      if (key) { runIdx++; lastTurns = run.stats.turns; open = null; sealKey = null; }
      lastKey = key;
      if (!key && out.ended >= (cfg.runs || 1)) break;
    }
    if (hk.stop && hk.stop()) break;
    const sc = E.sceneName, d = run && run.duel, pend = run && run.pending;
    if (open && run && run.stats.turns !== lastTurns) {             // the open turn resolved
      open.pm = d ? d.p.moves[d.p.moves.length - 1] : null;
      open.dWindow = since();
      log.push(open); open = null; lastTurns = run.stats.turns;
    }
    if (run && run.stage === 'bonfire') { inBonfire = true; if (run.offer && run.offer.choices) draftWant = run.offer.choices[0]; }
    else if (inBonfire && run && run.stage === 'duel') {
      inBonfire = false;
      ok(draftWant !== null && run.pBoons.indexOf(draftWant) >= 0, () => 'drive: the bonfire draft took ' + run.pBoons[run.pBoons.length - 1] + ', not the first offered boon ' + draftWant);
      draftWant = null;
      log.push({ run: runIdx, draft: run.duelN - 1, pick: run.pBoons[run.pBoons.length - 1], rival: run.rBoons[run.rBoons.length - 1] });
    }
    const sealed = !!(pend && d && pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase);
    if (sealed && !open) {
      const kk = runIdx + ':' + d.n + ':' + d.phase + ':' + d.turn;
      if (sealKey !== kk) {                                          // the frame the seal appeared in
        sealKey = kk;
        sealRec = { run: runIdx, face: run.boss, stake: run.stake, n: d.n, ph: d.phase, t: d.turn, tut: d.n === 1 && !G.meta.seenTutorial && d.turn <= 3, commit: commitOf(pend), dCommit: since() };
        if (cfg.qHash) sealRec.qHash = page.lastQ && page.lastQ.key === d.n + '.' + d.phase + '.' + d.turn ? page.lastQ.hash : null;
      }
    }
    const pk = sc === 'duel' ? R.Scenes.duel.peek() : null;
    if (pk && pk.input && sealed && !open && sealRec) {               // the buttons lit
      open = sealRec; sealRec = null;
      open.dSeal = since(); open.coin = false;
      if (hk.onInput) hk.onInput({ page, run, d, pend, pk });
      const lp = R.Combat.legal(d, 'p');
      if (!pk.only && cfg.coin && d.p.charges && d.p.charges.coin_of_fools > 0 && lp.length === 3 && d.turn === 2) {
        const acts = page.buttons.filter(q => q.label === '' && q.w === 22 && !q.disabled);
        if (acts.length) { tapB(acts[0]); if (d.intel && d.intel.coin) { open.coin = true; continue; } }
      }
      let want = pk.only;
      if (!want) { const rm = pend.sealed.move; want = (k++ % 4 === 3) ? R.BEATS[rm] : R.LOSES_TO[rm]; if (lp.indexOf(want) < 0) want = lp[0]; }
      const b = findBtn(page, MOVE_LABEL[want]);
      if (b) tapB(b);
      continue;
    }
    if (cfg.skips && sc === 'duel' && !(pk && pk.input) && frames % 5 === 0) tap(90, E.safe.top + 120);
    if (sc === 'title') { const b = findBtn(page, /BEGIN|CONTINUE/); if (b && frames % 7 === 0) tapB(b); }
    else if (sc === 'relic') { const b = findBtn(page, 'CONFIRM'); if (b && frames % 7 === 0) tapB(b); }
    else if (sc === 'bonfire') {
      // The draft is the first offered boon, found by its id among the cards drawn this frame, so the layout of the
      // cards cannot change what is taken. Before the cards show, a tap anywhere only hurries the intro.
      if (++bonfireFrames > 6000) { fail('drive: stuck on the bonfire (no card for the first offered boon ' + draftWant + ' was drawn)'); break; }
      const okb = findBtn(page, 'CONFIRM');
      if (okb && !okb.disabled) tapB(okb);
      else if (frames % 9 === 0) {
        const card = draftWant ? page.cardsDrawn.filter(c => c.id === draftWant)[0] : null;
        if (card) tap(card.x + (card.w >> 1), card.y + (card.h >> 1));
        else tap(90, E.safe.top + 90);
      }
    } else if (sc !== 'duel' && frames % 11 === 0) tap(90, E.safe.top + 90);
    if (sc !== 'bonfire') bonfireFrames = 0;
  }
  out.frames = frames;
  clock.ms = saveMs;
  return out;
}

// Recorder for the blind test: every R.Art / R.UI / Font / audio call (the harness has no pixels), the
// buffer-context calls, the blit to the visible canvas (screen shake offsets), the engine's juice calls (shake,
// flash, hit-stop, haptics) with their arguments and every vibration pattern, hashed per frame.
// take() returns '<sha256 first 16 hex>:<calls>' and clears the log. While rec.on is false nothing is logged (the
// live path turns it on when it swaps: frames before that point cannot differ).
const REC_H = ['text', 'fighter', 'sprite', 'sigil', 'bg', 'panel', 'button', 'bubble', 'bar', 'audio'];
const REC_G = ['fillRect', 'drawImage', 'clearRect', 'strokeRect', 'fillText', 'putImageData', 'translate', 'scale', 'setTransform', 'arc', 'rect', 'moveTo', 'lineTo'];
const REC_V = ['fillRect', 'drawImage', 'clearRect', 'putImageData', 'setTransform', 'translate', 'scale'];
const REC_E = ['shake', 'flash', 'hitStop', 'buzz'];
function recordFrames(page) {
  const log = [], rec = { on: true };
  const js = a => { try { return JSON.stringify(a); } catch (e) { return String(a); } };
  const args = a => Array.prototype.slice.call(a).map(x => (x && typeof x === 'object' && !Array.isArray(x)) ? x.width + 'x' + x.height : x);
  for (const n of REC_H) {
    const f = page.H[n];
    page.H[n] = function () { if (rec.on) log.push(n + js(Array.prototype.slice.call(arguments))); return f.apply(this, arguments); };
  }
  const ctxs = [[page.E && page.E.g, REC_G, ''], [page.vctx, REC_V, 'v.']];
  for (const [g, names, tag] of ctxs) {
    if (!g) continue;
    for (const n of names) {
      const f = g[n];
      g[n] = function () { if (rec.on) log.push(tag + n + js([g.fillStyle, g.globalAlpha, args(arguments)])); return f.apply(this, arguments); };
    }
  }
  const E = page.E;
  if (E) for (const n of REC_E) {
    const f = E[n];
    if (typeof f === 'function') E[n] = function () { if (rec.on) log.push('E.' + n + js(args(arguments))); return f.apply(this, arguments); };
  }
  const nav = page.ctx && page.ctx.navigator;
  if (nav && typeof nav.vibrate === 'function') {
    const f = nav.vibrate;
    nav.vibrate = function () { if (rec.on) log.push('vibrate' + js(Array.prototype.slice.call(arguments))); return f.apply(this, arguments); };
  }
  rec.take = function () { const h = sha(log.join('\n')).slice(0, 16) + ':' + log.length; log.length = 0; return h; };
  return rec;
}

// ============================================================================================== 9. static: where scenes read G.rng
// The gameplay dice (G.rng) may be read by a scene only for the Rival's commit (turn(): `rng: G.rng` in the
// brain.commit query) and for the Coin of Fools pick (useActive(): `S.choice = G.rng.pick(...)`). Every other
// scene randomness uses G.crng. Read from disk (not through script(), so FLOW_HEAD cannot mask it); content
// anchored, the current line numbers are printed. Outside src/scenes, G.rng is only assigned (main.js).
function rngSitesTests() {
  where = 'rngsites';
  const READ = /\.rng\b|\[\s*['"]rng['"]\s*\]|\{[^}]*\brng\b[^}]*\}\s*=\s*(?:G|R\.Game)\b/;
  const COMMIT = /\brng:\s*G\.rng\b/, COIN = /\bS\.choice\s*=\s*G\.rng\.pick\(/;
  const sites = [];
  for (const f of fs.readdirSync(path.join(SRC, 'scenes')).filter(x => x.endsWith('.js')).sort()) {
    const lines = fs.readFileSync(path.join(SRC, 'scenes', f), 'utf8').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((t, i) => { if (READ.test(t)) sites.push({ at: 'scenes/' + f + ':' + (i + 1), file: 'scenes/' + f, kind: COMMIT.test(t) ? 'commit' : COIN.test(t) ? 'coin' : null }); });
  }
  const list = sites.map(s => s.at + (s.kind ? ' (' + s.kind + ')' : '')).join(', ');
  const good = sites.length === 2 && sites.every(s => s.file === 'scenes/duel.js') && sites.some(s => s.kind === 'commit') && sites.some(s => s.kind === 'coin');
  ok(good, 'src/scenes reads the gameplay rng outside the two allowed sites (commit dice in turn(), Coin of Fools pick in useActive()): ' + (list || 'none found'));
  console.log('G.rng sites in src/scenes: ' + (list || 'none'));
  // the rest of src: G.rng / Game.rng is only written, by main.js (newRun and boot)
  const others = [], walk = dir => {
    for (const f of fs.readdirSync(path.join(SRC, dir)).sort()) {
      const rel = dir ? dir + '/' + f : f;
      if (fs.statSync(path.join(SRC, rel)).isDirectory()) { if (rel !== 'scenes') walk(rel); continue; }
      if (!rel.endsWith('.js')) continue;
      fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n?/g, '\n').split('\n').forEach((t, i) => {
        if (/\bG\.rng\b|\bGame\.rng\b/.test(t)) others.push({ at: rel + ':' + (i + 1), write: rel === 'main.js' && /\bG\.rng\s*=[^=]/.test(t) });
      });
    }
  };
  walk('');
  const reads = others.filter(o => !o.write);
  ok(reads.length === 0 && others.length > 0, () => 'G.rng is read outside src/scenes (only main.js may assign it): ' + reads.map(o => o.at).join(', '));
  console.log('G.rng writers outside src/scenes: ' + others.filter(o => o.write).map(o => o.at).join(', '));
}

// ============================================================================================== 10. the screen is blind to the seal
// At an input window with a shown, lying stance, the Rival's sealed move is one of the two non-tell moves. Nothing
// the player can see or hear before the pick may depend on which one: the frames (every recorded draw call) and
// the audio calls must hash identically when only sealed.move is swapped (honest stays false), with ?debug off
// and on. Resume path: the stored save is swapped and booted. Live path: brain.commit is wrapped and the first
// lying commit is swapped as it is sealed. Controls: a glimpsed move and a different tell must change the frames.
// Samples come from deterministic runs with test-only injection (face, boons, relic) so that every stance-showing
// phase of every face, a mimic lie, a Called Shot turn and the Ledger / Tally / Liar's Coin stamp are covered.
function blindTests() {
  where = 'blind';
  const t = Date.now();
  const WANT = ['duels 1-6', 'unmasked:1', 'unmasked:2', 'three_faced:1', 'three_faced:2', 'hours:1', 'hours:2', 'hours:3', 'hours:4',
    'reflection:1', 'reflection:2', 'reflection:3', 'mimic', 'called', 'ledger', 'tally', 'coin stamp'];
  const CFGS = [
    { name: 'unmasked s7 + Stolen Ledger', clock0: 1.86e12, veteran: true, stake: 7, face: 'unmasked', pre: ['stolen_ledger'] },
    { name: 'three_faced s0 + Liar\'s Tally', clock0: 1.861e12, veteran: true, stake: 0, face: 'three_faced', pre: ['liars_tally'] },
    { name: 'hours s0 + Liar\'s Coin', clock0: 1.862e12, veteran: true, stake: 0, face: 'hours', relic: 'relic_liars_coin' },
    { name: 'reflection s0', clock0: 1.863e12, veteran: true, stake: 0, face: 'reflection' }
  ];
  const covered = new Set(), samples = [], liveStarts = {};
  for (const c of CFGS) {
    let lastWin = null;
    drive(c, {
      onInput(x) {
        const R = x.page.R, d = x.d, s = x.pend.sealed;
        const wk = x.run.seed + ':' + x.run.runNo + ':' + d.n + ':' + d.phase, here = x.page.store.raw();
        const prev = lastWin && lastWin.key === wk && lastWin.turn === d.turn - 1 ? lastWin.raw : null;   // this fight's previous window
        lastWin = { key: wk, turn: d.turn, raw: here };
        if (x.pk.only || d.stance === 'none' || s.honest !== false || x.pend.seen_glimpse) return;
        const lies = R.MOVES.filter(m => m !== s.tell), lr = R.Combat.legal(d, 'r');
        if (!lies.every(m => lr.indexOf(m) >= 0)) return;
        const cats = blindCats(R, x.run, d, x.pend.called);
        for (const q of liveKeys(cats)) {                              // starts for the live path: one turn earlier, then this window
          const l = liveStarts[q] = liveStarts[q] || [];
          if (l.length < 3) l.push({ prev, raw: here });
        }
        if (cats.every(q => covered.has(q))) return;
        const raw = x.page.store.raw(), o = raw && JSON.parse(raw);
        if (!(o && o.run && o.run.pending && commitOf(o.run.pending) === commitOf(x.pend))) { fail('blind: the stored save does not hold the open turn\'s seal'); return; }
        const other = lies.filter(m => m !== s.move)[0];
        o.run.pending.sealed.move = other;
        cats.forEach(q => covered.add(q));
        samples.push({ raw, raw2: JSON.stringify(o), cats, label: x.run.boss + ' duel ' + d.n + '.' + d.phase + ' turn ' + d.turn + ' tell ' + s.tell + ' sealed ' + s.move + '/' + other });
      }
    });
  }
  const missing = WANT.filter(q => !covered.has(q));
  ok(missing.length === 0, 'blind: no lying input window was reached for ' + missing.join(', '));
  let compared = 0, live = 0;
  const clockSave = clock.ms;
  samples.forEach((s, i) => {
    const n = i === 0 ? 1100 : 300;                                   // the first sample also covers the 14 s idle heckle
    for (const debug of [false, true]) {
      const a = blindRun(s.raw, debug, n), b = blindRun(s.raw2, debug, n), at = firstDiff(a.hashes, b.hashes);
      ok(a.inputAt >= 0 && a.inputAt === b.inputAt, () => 'blind: the input window did not open in the same frame (' + s.label + ': ' + a.inputAt + ' / ' + b.inputAt + ')');
      ok(at === -1, () => 'frames before the pick differ when only the sealed lie changes (' + s.label + ', frame ' + at + ' of ' + a.hashes.length + ', input at ' + a.inputAt + ', debug ' + debug + ')');
      compared++;
    }
  });
  if (samples.length) {                                             // the recorder must see what does change
    const s = samples[0], g1 = JSON.parse(s.raw), g2 = JSON.parse(s.raw2);
    g1.run.pending.seen_glimpse = true; g2.run.pending.seen_glimpse = true;
    const ga = blindRun(JSON.stringify(g1), false, 300), gb = blindRun(JSON.stringify(g2), false, 300), gat = firstDiff(ga.hashes, gb.hashes);
    ok(gat >= 0, 'control: a glimpsed sealed move must change the frames');
    const t1 = JSON.parse(s.raw), sl = t1.run.pending.sealed;
    sl.tell = oracle.R.MOVES.filter(m => m !== sl.tell && m !== sl.move)[0];
    const ta = blindRun(s.raw, false, 300), tb = blindRun(JSON.stringify(t1), false, 300), tat = firstDiff(ta.hashes, tb.hashes);
    ok(tat >= 0, 'control: a different tell must change the frames');
    console.log('blind controls: a glimpsed move differs from frame ' + gat + ' (input at ' + ga.inputAt + '), a different tell from frame ' + tat);
  }
  // Live path: turn()'s commit branch (a resumed turn takes the pending branch instead). For each category below,
  // a fight in that category is resumed one turn before a lying window (else at it) and the first lying commit of
  // that category is swapped as it is sealed.
  const LIVE_WANT = ['duels 1-6'].concat(oracle.R.Run.BOSSES.map(b => 'final:' + b.id), ['mimic', 'called']);
  const liveCov = new Set(), liveLabels = [];
  for (const want of LIVE_WANT) {
    if (liveCov.has(want)) continue;
    const has = cats => liveKeys(cats).indexOf(want) >= 0;
    let done = false;
    for (const st of liveStarts[want] || []) {
      for (const start of [st.prev, st.raw]) {
        if (done || !start) continue;
        const la0 = blindLive(start, false, false, has);
        if (!la0.target) continue;                                   // that fight ended before such a lie was sealed
        const pair = [[la0, blindLive(start, true, false, has)], [blindLive(start, false, true, has), blindLive(start, true, true, has)]];
        pair.forEach((p, j) => {
          const [la, lb] = p, at = firstDiff(la.hashes, lb.hashes);
          ok(!!lb.swapped && JSON.stringify(la.target) === JSON.stringify(lb.target) && la.inputAt >= 0, () => 'blind live: the swapped commit was not reached the same way (' + JSON.stringify(la.target) + ' / ' + JSON.stringify(lb.target) + ')');
          ok(at === -1, () => 'frames before the pick differ when only the sealed lie changes (live, ' + JSON.stringify(la.target) + ', frame ' + at + ', debug ' + (j === 1) + ')');
          compared++;
        });
        liveKeys(la0.target.cats).forEach(q => liveCov.add(q));
        liveLabels.push('duel ' + la0.target.n + '.' + la0.target.phase + ' turn ' + la0.target.turn + ' [' + la0.target.cats.join(', ') + ']');
        live++; done = true;
      }
      if (done) break;
    }
  }
  const liveMissing = LIVE_WANT.filter(q => !liveCov.has(q));
  ok(liveMissing.length === 0, 'blind live: no lying commit was swapped as it was sealed in ' + liveMissing.join(', '));
  clock.ms = clockSave;
  console.log('blind: ' + samples.length + ' lying windows (' + WANT.filter(q => covered.has(q)).join(', ') + '), ' + live + ' live swaps (' +
    LIVE_WANT.filter(q => liveCov.has(q)).join(', ') + '), ' + compared + ' frame-stream comparisons with ?debug off and on, ' + ((Date.now() - t) / 1000).toFixed(1) + ' s');
  if (VERBOSE) { samples.forEach(s => console.log('  ' + s.label + ' [' + s.cats.join(', ') + ']')); liveLabels.forEach(s => console.log('  live ' + s)); }
}
// Blind-test categories of a lying window or commit (the same names as WANT), and the keys the live path covers.
function blindCats(R, run, d, called) {
  const inf = R.Combat.info(d), cats = [d.n === 7 ? run.boss + ':' + d.phase : 'duels 1-6'];
  if (d.mimic) cats.push('mimic');
  if (called) cats.push('called');
  if (inf.ledger) cats.push('ledger'); else if (inf.tally) cats.push('tally');
  if (inf.coinTurn1 && d.turn === 1) cats.push('coin stamp');
  return cats;
}
function liveKeys(cats) { return cats.map(q => /^(\w+):\d+$/.test(q) ? 'final:' + q.split(':')[0] : q); }
function firstDiff(a, b) { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; }
function blindPage(raw, debug) {
  clock.ms = 1.9e12;
  const store = makeStore(); store.map.set(KEY, raw);
  return makePage(store, VIEWS[2], { randomTrap: mulberry(4242), search: debug ? '?debug' : '', ts: 5000 });
}
// Resume path: boot the save, CONTINUE, then `frames` frames with the input window open and no pick.
function blindRun(raw, debug, frames) {
  const page = blindPage(raw, debug), out = { hashes: [], inputAt: -1 };
  if (!page.alive) return out;
  const rec = recordFrames(page), step = () => { page.frame(16.7); out.hashes.push(rec.take()); };
  for (let i = 0; i < 400 && page.E.sceneName !== 'title'; i++) step();
  for (let i = 0; i < 20; i++) step();
  const b = findBtn(page, /CONTINUE/);
  if (!b) { fail('blind: no CONTINUE on the title'); return out; }
  page.down(b.x + 5, b.y + 5); step(); page.up(b.x + 5, b.y + 5); step();
  for (let i = 0; i < frames; i++) {
    step();
    const pk = page.E.sceneName === 'duel' ? page.R.Scenes.duel.peek() : null;
    if (out.inputAt < 0 && pk && pk.input) out.inputAt = out.hashes.length - 1;
  }
  return out;
}
// Live path: resume, play on with a fixed script, and (swap) seal the other lie on the first lying commit whose two
// lies are both legal and whose blind categories pass want(cats) (any when omitted). Frames are hashed from that
// commit (nothing before it can differ) until 300 frames after that turn's buttons light.
function blindLive(raw, swap, debug, want) {
  const page = blindPage(raw, debug), out = { hashes: [], target: null, swapped: false, inputAt: -1 };
  if (!page.alive) return out;
  const G = page.G, real = G.brain.commit;
  G.brain.commit = function (q) {
    const s = real.apply(this, arguments);
    if (!out.target && !q.force && !q.noTell && s.honest === false) {
      const lies = ['S', 'G', 'F'].filter(m => m !== s.tell);
      const d = G.run.duel, cats = blindCats(page.R, G.run, d, d.intel && d.intel.called);
      if (lies.every(m => q.legalR.indexOf(m) >= 0) && (!want || want(cats))) {
        out.target = { n: d.n, phase: d.phase, turn: d.turn, tell: s.tell, move: s.move, cats };
        rec.on = true;
        if (swap) { out.swapped = true; return Object.assign({}, s, { move: lies.filter(m => m !== s.move)[0] }); }
      }
    }
    return s;
  };
  const rec = recordFrames(page), step = () => { page.frame(16.7); out.hashes.push(rec.take()); };
  rec.on = false;
  for (let i = 0; i < 400 && page.E.sceneName !== 'title'; i++) step();
  for (let i = 0; i < 20; i++) step();
  const cb = findBtn(page, /CONTINUE/);
  if (!cb) return out;
  page.down(cb.x + 5, cb.y + 5); step(); page.up(cb.x + 5, cb.y + 5); step();
  let tail = -1, lastTurn = -1;
  for (let i = 0; i < 20000; i++) {
    step();
    if (tail >= 0) { if (--tail === 0) break; continue; }
    const pk = page.E.sceneName === 'duel' ? page.R.Scenes.duel.peek() : null, run = G.run;
    if (pk && pk.input && run && run.pending) {
      const d = run.duel;
      if (out.target && d.n === out.target.n && d.turn === out.target.turn && d.phase === out.target.phase) { out.inputAt = out.hashes.length - 1; tail = 300; continue; }
      if (run.stats.turns !== lastTurn) {
        lastTurn = run.stats.turns;
        const open = page.buttons.filter(q => /STRIKE|GUARD|FEINT/.test(q.label) && !q.disabled), b = open[(run.stats.turns * 7) % open.length];
        if (b) { page.down(b.x + 4, b.y + 4); step(); page.up(b.x + 4, b.y + 4); }
      }
    } else if (!run || /bonfire|death|victory|credits/.test(page.E.sceneName)) break;
  }
  return out;
}

// ============================================================================================== 11. a tap that only ends a pause
// After a blur the game is paused; the next pointer-down or key press ends the pause. It must not also press a
// button: the player cannot see what is under the finger behind the PAUSED banner. Today engine.js delivers that
// same event to the scene (O13, P1.6), so each case prints its KNOWN row; any other outcome is a FAIL, and once
// the move is no longer picked the row is stale (FAIL until it is removed here and in tools/known.json).
function pauseTapTests() {
  where = 'pausetap';
  const clockSave = clock.ms;
  clock.ms = 1.87e12;
  const store = makeStore(), page = makePage(store, VIEWS[5], { randomTrap: mulberry(9001), ts: 1000 });
  if (!page.alive) { clock.ms = clockSave; return; }
  const E = page.E, G = page.G, R = page.R;
  const free = p => p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input && !p.R.Scenes.duel.peek().only && p.G.run.pending;
  const kinds = [
    ['pause-tap-pointer', 'a pointer-down', (m, b) => { page.down(b.x + 10, b.y + 10); page.frame(16.7); page.up(b.x + 10, b.y + 10); }],
    ['pause-tap-key', 'a key press', m => page.key(m === 'S' ? '1' : m === 'G' ? '2' : '3')]
  ];
  const seen = [];
  for (const [id, what, press] of kinds) {
    if (!playUntil(page, store, free, { what: 'a free input window (' + what + ')', seed: 61 + seen.length })) break;
    run60(page, 10);
    const turns = G.run.stats.turns, lp = R.Combat.legal(G.run.duel, 'p').filter(m => !!findBtn(page, MOVE_LABEL[m]) && !findBtn(page, MOVE_LABEL[m]).disabled);
    if (!ok(lp.length > 0, 'pausetap: no open move button')) break;
    const m = lp[lp.length - 1], btn = Object.assign({}, findBtn(page, MOVE_LABEL[m]));   // where the button was before the pause
    page.fire('window', 'blur', {});
    run60(page, 5);
    if (!ok(E.paused === true, 'pausetap: blur must pause the game')) break;
    press(m, btn);
    run60(page, 90);
    const n = G.run ? G.run.stats.turns - turns : -1, d = G.run && G.run.duel, last = d && d.p.moves.length ? d.p.moves[d.p.moves.length - 1] : null;
    ok(E.paused === false, what + ' must end the pause');
    if (n === 1 && last === m) knownHit(id);                          // today: the move under the finger / key is picked
    else if (n === 0) fail('stale KNOWN row ' + id + ': remove it from tools/known.json in the fixing commit (and assert that ' + what + ' that only ends a pause picks no move)');
    else fail(what + ' that ends a pause changed behaviour in an unexpected way: ' + n + ' turn(s) resolved, last player move ' + last + ', pressed ' + m);
    seen.push(id + ' ' + n);
  }
  clock.ms = clockSave;
  console.log('pausetap: ' + seen.map(s => s.replace(/ (\d+)$/, ': $1 move picked')).join(', '));
}

// ============================================================================================== 12. sim-scene commit parity (feel-10 C4)
// The real duel scene and tools/sim.js fight() must hand brain.commit the same input for the same history. The
// scene's inputs are recorded (sim.commitInput on the scene's q, before the commit draws), with the run seeds,
// clocks, relics, stakes, moves (or 'coin'), drafts and finish times; runChain replays them as a script and logs
// its own. One page per stake, no reloads (boot reseeds G.rng). Faces are drawn naturally from the meta; each
// face must finish at least one run in its last phase. The Coin of Fools is granted and thrown at stake 0.
function parityTests() {
  where = 'parity';
  let sim = null;
  try { sim = require(path.join(__dirname, 'sim.js')); } catch (e) { fail('parity: tools/sim.js cannot be required: ' + (e && e.message)); return; }
  if (!sim || typeof sim.runChain !== 'function' || typeof sim.commitInput !== 'function') { fail('parity: tools/sim.js does not export runChain and commitInput'); return; }
  const t = Date.now(), faces = oracle.R.Run.BOSSES.map(b => b.id), MAXR = 12, lines = [];
  for (const stake of [0, 7]) {
    where = 'parity:' + (stake ? 'vigil' : 'plain') + '-s' + stake;     // fail() dedupes on where up to its first digit
    const rec = { commits: [], runs: [], firstMeta: null, coins: 0 }, covered = {};
    let cur = null, coinNext = false;
    const cfg = { clock0: 1.88e12 + stake * 1e10, veteran: true, stake, runs: MAXR, skips: true, coin: stake === 0, pre: stake === 0 ? ['coin_of_fools'] : null };
    drive(cfg, {
      beforeBoot(p) {
        const R = p.R;
        const bc = R.Brain.create;
        R.Brain.create = function () {
          const b = bc.apply(this, arguments), c = b.commit;
          b.commit = function (q) { rec.commits.push(sim.commitInput(q)); return c.apply(this, arguments); };
          return b;
        };
        const rc = R.Run.create;
        R.Run.create = function (m, o) {
          if (rec.firstMeta === null) rec.firstMeta = JSON.stringify(m);
          const run = rc.apply(this, arguments);
          cur = { seed: o.seed, now: o.now, relicId: o.relicId || null, stake: o.stake, moves: [], drafts: [], finishNow: null, boss: run.boss, commitStart: rec.commits.length, commitEnd: -1, end: null };
          rec.runs.push(cur);
          return run;
        };
        const ua = R.Combat.useActive;
        R.Combat.useActive = function () { const r = ua.apply(this, arguments); if (r && r.ok && r.kind === 'coin') coinNext = true; return r; };
        const rr = R.Run.record;
        R.Run.record = function (run, m, res) {
          if (cur && res && res.pm) { cur.moves.push(coinNext ? 'coin' : res.pm); if (coinNext) rec.coins++; }
          coinNext = false;
          return rr.apply(this, arguments);
        };
        const rp = R.Run.pick;
        R.Run.pick = function (run, id) { const r = rp.apply(this, arguments); if (r && cur) cur.drafts.push(id); return r; };
        const rf = R.Run.finish;
        R.Run.finish = function (run, m, now) {
          if (cur && cur.finishNow === null) {
            cur.finishNow = now; cur.commitEnd = rec.commits.length;
            cur.end = { n: run.duelN, phase: run.phase, last: R.Run.phaseCount(run), stage: run.stage };
            if (run.duelN === 7 && run.phase === cur.end.last) covered[run.boss] = true;
          }
          return rf.apply(this, arguments);
        };
      },
      stop: () => faces.every(f => covered[f]) && rec.runs.length && rec.runs[rec.runs.length - 1].finishNow !== null
    });
    const fin = rec.runs.filter(r => r.finishNow !== null);
    if (!ok(fin.length > 0 && rec.firstMeta, 'parity: the scene finished no run')) continue;
    fin.forEach(r => ok(r.moves.length === r.commitEnd - r.commitStart, () => 'parity: run with seed ' + r.seed + ' resolved ' + r.moves.length + ' exchanges for ' + (r.commitEnd - r.commitStart) + ' commits'));
    const script = { runs: fin.map(r => ({ seed: r.seed, now: r.now, finishNow: r.finishNow, stake: r.stake, relicId: r.relicId, moves: r.moves, drafts: r.drafts })) };
    // The sim's own brain is watched too (host realm, restored right after): if the replay throws because it went
    // another way, the commits it made up to there still locate the first difference.
    const HR = globalThis.RIVAL, realCreate = HR && HR.Brain && HR.Brain.create, seen = [];
    let out = null, err = null;
    if (realCreate) HR.Brain.create = function () { const b = realCreate.apply(this, arguments), c = b.commit; b.commit = function (q) { seen.push(sim.commitInput(q)); return c.apply(this, arguments); }; return b; };
    try {
      out = sim.runChain({ bot: 'script', tag: 'parity', seed: 0, idx: 0, runs: fin.length, unlocks: 'natural', meta: JSON.parse(rec.firstMeta), script,
        commitLog: true, noTiming: true, pre: cfg.pre ? { p: cfg.pre.slice(), r: [] } : null });
    } catch (e) { err = String(e && e.message || e).split('\n')[0]; }
    finally { if (realCreate) HR.Brain.create = realCreate; }
    if (err) fail('parity: the sim could not replay the scene\'s runs: ' + err);
    else if (realCreate) ok(JSON.stringify(out.commits) === JSON.stringify(seen), 'parity: the sim\'s commitLog is not what its brain.commit received');
    const sc = rec.commits.slice(0, fin[fin.length - 1].commitEnd), sm = err ? seen : (out.commits || []);
    let first = -1;
    for (let i = 0; i < Math.max(sc.length, sm.length); i++) if (sc[i] !== sm[i]) { first = i; break; }
    if (!err) ok(sc.length === sm.length, () => 'parity: the scene sealed ' + sc.length + ' times, the sim ' + sm.length);
    if (first >= 0 && sc[first] && sm[first]) {
      const a = JSON.parse(sc[first]), b = JSON.parse(sm[first]), keys = [];
      for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
        if (k === 'q' && a.q && b.q) { for (const j of new Set(Object.keys(a.q).concat(Object.keys(b.q)))) if (JSON.stringify(a.q[j]) !== JSON.stringify(b.q[j])) keys.push('q.' + j); }
        else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) keys.push(k);
      }
      fail('parity: commit input ' + first + ' (duel ' + a.duel + ' phase ' + a.phase + ' turn ' + a.turn + ') differs in ' + keys.join(', '));
    } else ok(first < 0, () => 'parity: commit input ' + first + ' exists on one side only');
    for (const f of faces) ok(!!covered[f], () => 'parity coverage: ' + f + ' stake ' + stake + ' never finished a run in its last phase (' + fin.length + ' runs)');
    const fc = {}; fin.forEach(r => { fc[r.boss] = (fc[r.boss] || 0) + 1; });
    lines.push('stake ' + stake + ': ' + fin.length + ' runs (' + faces.map(f => f + ' ' + (fc[f] || 0)).join(', ') + '), ' + (first < 0 && sc.length === sm.length ? sc.length + '/' + sm.length + ' identical' : 'MISMATCH at ' + first) +
      ', ' + rec.coins + ' coin throws');
  }
  where = 'parity';
  console.log('parity (scene vs sim brain.commit inputs): ' + lines.join('; ') + ', ' + ((Date.now() - t) / 1000).toFixed(1) + ' s');
}

// ============================================================================================== 13. the coercion counter bites
// A forged save (a real input-window save whose own sealed move is then put under a seal, so it is illegal) is the
// one way to make the scene resolve a move the Rival did not seal: validRun accepts it and combat.js coerce()
// replaces the move. The counter must see exactly that one coercion; it is expected here and not a failure.
// (If a later push makes validRun or the scene refuse such a pending, update this control in that push.)
function coerceTests() {
  where = 'coerce:forged';
  const clockSave = clock.ms;
  clock.ms = 1.89e12;
  const store0 = makeStore(), page0 = makePage(store0, VIEWS[2], { randomTrap: mulberry(5150), ts: 1000 });
  if (!page0.alive) { clock.ms = clockSave; return; }
  const free = p => p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input && !p.R.Scenes.duel.peek().only &&
    p.G.run.pending && p.R.Combat.legal(p.G.run.duel, 'r').length === 3;
  if (!playUntil(page0, store0, free, { what: 'an input window with all three Rival moves legal', seed: 71 })) { clock.ms = clockSave; return; }
  const o = JSON.parse(store0.raw()), sm = o.run.pending.sealed.move;
  o.run.duel.r.status.sealed[sm] = 2;
  const store = makeStore(); store.map.set(KEY, JSON.stringify(o));
  const page = makePage(store, VIEWS[2], { randomTrap: mulberry(5151), ts: 1000 });
  const before = COERCE.expected, f0 = fails;
  page.coerceExpected = 1;
  waitScene(page, 'title', 400); run60(page, 20); tapLabel(page, /CONTINUE/);
  for (let i = 0; i < 600 && !(page.E.sceneName === 'duel' && page.R.Scenes.duel.peek() && page.R.Scenes.duel.peek().input); i++) page.frame(16.7);
  const d = page.G.run && page.G.run.duel, lr = d ? page.R.Combat.legal(d, 'r') : [];
  const b = page.buttons.filter(q => /STRIKE|GUARD|FEINT/.test(q.label) && !q.disabled)[0];
  if (ok(!!b && lr.indexOf(sm) < 0, 'coerce control: the forged save did not reach an input window with the sealed move illegal')) {
    const n0 = d.r.moves.length;
    page.down(b.x + 4, b.y + 4); page.up(b.x + 4, b.y + 4);
    run60(page, 120);
    ok(COERCE.expected === before + 1 && page.coerceExpected === 0, 'control: the forged illegal seal must be counted as exactly one Rival coercion (counted ' + (COERCE.expected - before) + ')');
    ok(d.r.moves.length === n0 + 1 && d.r.moves[n0] === lr[0], () => 'control: the coerced Rival move should be legal[0] = ' + lr[0] + ', got ' + d.r.moves[n0]);
    ok(fails === f0, 'control: the forged save raised other failures');
  }
  page.coerceExpected = 0;
  clock.ms = clockSave;
  console.log('coerce control: forged seal ' + sm + ' under a seal -> ' + (COERCE.expected - before) + ' coercion counted, Rival played ' + (d && d.r.moves[d.r.moves.length - 1]));
}

// ============================================================================================== 14. seal trace (opt-in)
// One deterministic run per config through the real duel scene, logging per seal the commit (sealed move, tell,
// honest, pred..., called) and the G.rng draws in three windows. Invariants: no draw between the seal and the
// buttons lighting; exactly one draw (the Coin of Fools pick) in the player's window when the coin is thrown, else
// none; at least one draw per commit except the tutorial's forced ones. Each config also runs with Math.random
// noise, 16.7 ms frames and skip taps, which must give the identical log. Prints "SEALTRACE <sha256 of the log>".
function sealTraceTests() {
  where = 'sealtrace';
  const t = Date.now(), O = oracle.R.Run;
  const CFGS = [{ name: 'T1 fresh', clock0: 1.8e12 }];
  O.BOSSES.forEach((b, i) => [0, 7].forEach(stake => {
    const coin = (i + stake / 7) % 2 === 1;                          // the coin on half of them, both stakes and every face
    CFGS.push({ name: b.id + ' s' + stake + (coin ? ' coin' : ''), clock0: 1.81e12 + (i * 2 + stake / 7) * 1e10, veteran: true, stake, face: b.id, pre: coin ? ['coin_of_fools'] : null, coin });
  }));
  const all = [];
  for (const c of CFGS) {
    where = 'sealtrace:' + c.name;
    const a = drive(Object.assign({ runs: 1, qHash: true }, c)), b = drive(Object.assign({ runs: 1, qHash: true }, c, { noise: 7, dt: 16.7, skips: true }));
    const ja = a.log.map(x => JSON.stringify(x)), jb = b.log.map(x => JSON.stringify(x));
    const first = firstDiff(ja, jb);
    ok(first < 0, () => 'seal trace ' + c.name + ' depends on frame timing, skips or Math.random (entry ' + first + ')\n   ' + ja[first] + '\n   ' + jb[first]);
    const turns = a.log.filter(x => x.commit), cm = turns.map(x => JSON.parse(x.commit));
    for (const x of turns) {
      const at = c.name + ' duel ' + x.n + ' phase ' + x.ph + ' turn ' + x.t;
      ok(x.dSeal === 0, () => 'G.rng drew ' + x.dSeal + ' time(s) between the seal and the buttons lighting (' + at + ')');
      ok(x.dWindow === (x.coin ? 1 : 0), () => 'G.rng drew ' + x.dWindow + ' time(s) in the player\'s window (' + at + (x.coin ? ', Coin of Fools' : '') + ')');
      ok(x.tut ? x.dCommit === 0 : x.dCommit >= 1, () => 'commit drew ' + x.dCommit + ' time(s) (' + at + (x.tut ? ', tutorial: forced' : '') + ')');
      ok(!!x.qHash, () => 'no brain.commit call observed for ' + at);
    }
    const face = c.face || (turns.length ? turns[turns.length - 1].face : null), last = face ? O.BOSSES.find(q => q.id === face).phases.length : 0;
    ok(turns.some(x => x.n === 7 && x.ph === last), () => 'seal trace ' + c.name + ' never reached the last phase (' + last + ') of ' + face);
    if (!c.veteran) ok(turns.filter(x => x.tut).length >= 1, 'seal trace ' + c.name + ': no forced tutorial turn');
    if (c.coin) ok(turns.some(x => x.coin), 'seal trace ' + c.name + ': the Coin of Fools was never thrown');
    if (face === 'three_faced') ok(turns.some((x, i) => x.n === 7 && x.ph === 3 && cm[i].sealed.tell === cm[i].sealed.move && cm[i].sealed.honest), 'seal trace ' + c.name + ': no turn of the Blank (no stance)');
    if (face === 'reflection') ok(cm.some(x => x.sealed.mode === 'mimic'), 'seal trace ' + c.name + ': no mimic commit');
    if (c.stake === 7 || face === 'unmasked') ok(cm.some(x => x.called), 'seal trace ' + c.name + ': no Called Shot');
    const hist = {};
    turns.forEach(x => { const h = x.dCommit + '/' + x.dWindow; hist[h] = (hist[h] || 0) + 1; });
    const fights = new Set(turns.map(x => x.n + (x.n === 7 ? '.' + x.ph : '')));
    console.log('  ' + (c.name + ' '.repeat(20)).slice(0, 20) + turns.length + ' turns, fights ' + [...fights].join(' ') + ', called ' + cm.filter(x => x.called).length + ', mimic ' + cm.filter(x => x.sealed.mode === 'mimic').length +
      ', coin ' + turns.filter(x => x.coin).length + ', draws commit/window ' + JSON.stringify(hist) + ', ' + a.frames + '/' + b.frames + ' frames, ' + (first < 0 ? 'time-independent' : 'TIME-DEPENDENT'));
    all.push({ name: c.name, log: a.log });
  }
  where = 'sealtrace';
  const doc = JSON.stringify(all);
  if (process.env.FLOW_SEAL_OUT) fs.writeFileSync(process.env.FLOW_SEAL_OUT, JSON.stringify(all.map(x => ({ name: x.name, log: x.log })), null, 0).replace(/\},\{/g, '},\n{') + '\n');
  console.log('SEALTRACE ' + sha(doc));
  console.log('seal trace: ' + CFGS.length + ' configs, ' + all.reduce((s, x) => s + x.log.filter(e => e.commit).length, 0) + ' seals, ' + ((Date.now() - t) / 1000).toFixed(1) + ' s');
}

// ============================================================================================== 15. golden fixtures (P1.1)
// tools/fixtures/*.json: saves written by the game code of older commits (tools/fixtures/gen.js), each at one reload
// point: pre (before the turn start), bleed (after the turn start and its bleed tick, before the seal), seal (after
// it, before the buttons light), input (after the pick and a Candle of Truth reveal, before the resolve), post (after
// the resolve); the tutorial with a seal pending; a four-card bonfire whose forget was already applied (as it opens
// and with its cards shown); the final duel between phases (transform).
// The current build must boot each one with no error, keep every stored meta value, resume at the same stage, duel,
// phase and turn, keep a pending commit exactly (commitOf), apply a turn start once (the oracle) and never again once
// saved as done, then play the turn out; a bonfire reopens with the same cards, HP and brain; a save between phases
// becomes exactly one transform. The same saves, edited, drive the P1.1 repairs: the V1 rebuild of an old-shape
// duel-7 save, a run from newer rules (parked, then restored), a face this build does not know (redrawn), a phase
// past the face's count, a stripped run.phase, and shadow high-water keys; plus an empty store and memory-only storage.
const GEN_KEY = 'rival.save.v1.gen';
const FIX_DIR = path.join(ROOT, 'tools', 'fixtures');
function loadFixtures() {
  let names = [];
  try { names = fs.readdirSync(FIX_DIR).filter(f => /\.json$/.test(f)).sort(); } catch (e) { names = []; }
  return names.map(f => ({ file: f, fx: JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8')) }));
}
// The first path at which a value stored in `a` is gone or different in `b` (repairs may only add), or null.
function lostIn(a, b, at) {
  if (a === null || typeof a !== 'object' || Array.isArray(a)) return JSON.stringify(a) === JSON.stringify(b) ? null : at;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return at;
  for (const k of Object.keys(a)) { const d = lostIn(a[k], b[k], at + '.' + k); if (d) return d; }
  return null;
}
function bootSave(entries, opt) {
  const store = makeStore();
  for (const k in entries) store.map.set(k, entries[k]);
  return { store, page: makePage(store, VIEWS[2], Object.assign({ ts: 1000 }, opt || {})) };
}
// From the title: CONTINUE, then frames until the buttons light. `seen` (a Set) collects every text drawn.
function continueToInput(page, seen) {
  waitScene(page, 'title', 200); run60(page, 20);
  if (!tapLabel(page, 'CONTINUE') || !waitScene(page, 'duel', 300)) return false;
  page.keepTexts = !!seen;
  for (let i = 0; i < 2000; i++) {
    const pk = page.R.Scenes.duel.peek();
    if (pk && pk.input) { page.keepTexts = false; return true; }
    if (!page.frame(16.7)) break;
    if (seen) for (const t of page.lastTexts) seen.add(t);
  }
  page.keepTexts = false;
  return false;
}
// Picks a legal move at the open window and runs until the turn resolves. True when it did.
function playTurnOut(page) {
  const G = page.G, R = page.R, d = G.run.duel, pk = R.Scenes.duel.peek(), turns0 = G.run.stats.turns;
  const m = pk.only || R.Combat.legal(d, 'p')[0], b = findBtn(page, MOVE_LABEL[m]);
  if (!b) return false;
  page.down(b.x + 5, b.y + 5); page.up(b.x + 5, b.y + 5);
  for (let i = 0; i < 900 && G.run && G.run.stats.turns === turns0; i++) page.frame(16.7);
  return !!G.run && G.run.stats.turns === turns0 + 1;
}
function sameCommitPoint(sp, sd) { return !!(sp && sd && sp.turn === sd.turn && sp.n === sd.n && sp.phase === sd.phase); }
function fixtureResume(file, fx, tally) {
  const raw = fx.store[KEY], snap = JSON.parse(raw), sr = snap.run, sd = sr && sr.duel, e = fx.expect || {};
  if (!ok(!!(sr && (sd || sr.stage === 'bonfire')), 'fixture ' + file + ' holds no run to resume')) return;
  ok(e.stage === sr.stage && e.duelN === sr.duelN && e.phase === sr.phase && e.turn === (sd ? sd.turn : null) && e.pending === !!sr.pending, 'fixture ' + file + ': its expect block disagrees with its save');
  if (sr.stage === 'bonfire') return bonfireResume(file, fx, tally);
  if (sd.over) {
    if (ok(sd.over === 'p' && sr.duelN === 7 && sd.phase < oracle.R.Run.phaseCount(sr), 'fixture ' + file + ': a finished duel other than a final-duel phase is not covered')) transformResume(file, fx, tally);
    return;
  }
  if (e.tutorial) tally.tutorial++;
  const { store, page } = bootSave(fx.store);
  if (!page.alive) return;
  const G = page.G, R = page.R;
  const lost = lostIn(snap.meta, G.meta, 'meta');
  ok(!lost, () => 'a stored meta value changed at boot: ' + lost);
  if (!ok(!!G.run && !!G.run.duel, 'the run or its duel was dropped at boot')) return;
  ok(G.run.stage === sr.stage && G.run.duelN === sr.duelN && G.run.phase === sr.phase && G.run.duel.turn === sd.turn,
    () => 'resumed at ' + [G.run.stage, G.run.duelN, G.run.phase, G.run.duel.turn] + ', the save was at ' + [sr.stage, sr.duelN, sr.phase, sd.turn]);
  if (sr.boss === undefined) ok(G.run.boss === undefined && R.Run.bossOf(G.run).id === 'unmasked', 'a run from before the faces must resume as The Unmasked');
  else ok(G.run.boss === sr.boss, 'the face changed at boot: ' + sr.boss + ' -> ' + G.run.boss);
  if (!ok(continueToInput(page), 'no input window after CONTINUE')) return;
  const d = G.run.duel, pend = G.run.pending, sp = sr.pending;
  if (e.tutorial && sp && sd.turn <= 2) {                            // turns 1-2 of the tutorial allow only the move that beats its seal
    const pk = R.Scenes.duel.peek();
    ok(!!pk && pk.only === R.LOSES_TO[sp.sealed.move], () => 'the tutorial did not resume as the tutorial (only ' + (pk && pk.only) + ')');
  }
  ok(d.n === sd.n && d.phase === sd.phase && d.turn === sd.turn, () => 'the input window is for duel ' + [d.n, d.phase, d.turn] + ', the save was at ' + [sd.n, sd.phase, sd.turn]);
  if (sameCommitPoint(sp, sd)) {
    ok(!!pend && commitOf(pend) === commitOf(sp), () => 'the pending commit changed on resume:\n   ' + commitOf(sp) + '\n   ' + (pend && commitOf(pend)));
    ok(coreOf(d) === coreOf(sd), () => 'the duel changed on resume: ' + coreOf(sd) + ' -> ' + coreOf(d));
    if (sp.seen_honesty) ok(!!pend && pend.seen_honesty === true, 'the paid Candle of Truth reveal was lost on resume');
    tally.commit++;
  } else {
    const o = oracle.json(JSON.stringify(sd));
    oracle.R.Combat.beginTurn(o);
    ok(d.begun === d.turn && coreOf(d) === coreOf(o), () => 'the turn start was applied twice or wrongly on resume: expected ' + coreOf(o) + ' got ' + coreOf(d));
    if (sd.begun === sd.turn) {                                       // saved after the turn start: nothing of it runs again
      ok(coreOf(d) === coreOf(sd), () => 'a turn start saved as done ran again on resume: stored ' + coreOf(sd) + ' got ' + coreOf(d));
      tally.bleed++;
    }
    tally.begin++;
  }
  ok(playTurnOut(page), 'the resumed turn did not resolve');
  const after = store.parsed();
  ok(after && after.run && after.run.pending === null && after.run.stats.turns === sr.stats.turns + 1, 'the resolve after a resume was not stored');
  tally[fx.sha] = (tally[fx.sha] || 0) + 1;
}
// A bonfire save (four cards, the Ash of Forgetting's forget already applied): it reopens with the same cards and HP,
// the Rival forgets nothing a second time, and taking a card goes on to the next duel.
function bonfireResume(file, fx, tally) {
  const raw = fx.store[KEY], snap = JSON.parse(raw), sr = snap.run, off = sr.offer, e = fx.expect || {}, J = JSON.stringify;
  ok(!!off && e.cards === off.choices.length && e.applied === !!off.applied && e.shown === !!off.seen, 'fixture ' + file + ': its expect block disagrees with its offer');
  const { store, page } = bootSave(fx.store);
  if (!page.alive || !off) return;
  const G = page.G, R = page.R;
  const lost = lostIn(snap.meta, G.meta, 'meta');
  ok(!lost, () => 'a stored meta value changed at boot: ' + lost);
  if (!ok(!!G.run && G.run.stage === 'bonfire' && J(G.run.offer) === J(off) && G.run.pHp === sr.pHp, 'the bonfire, its offer or the HP changed at boot')) return;
  const mind = () => J(G.brain.serialize().c);                        // a second forget would shrink these
  const c0 = mind();
  ok(c0 === J(snap.brain.c), 'the stored brain tables changed at boot');
  waitScene(page, 'title', 200); run60(page, 20);
  if (!ok(tapLabel(page, 'CONTINUE') && waitScene(page, 'bonfire', 300), 'CONTINUE did not reopen the bonfire')) return;
  const seen = new Set();
  page.keepTexts = true;
  for (let i = 0; i < 600; i++) {
    page.frame(16.7);
    for (const s of page.lastTexts) seen.add(s);
    const dos = findBtn(page, 'DOSSIER');
    if (dos && !dos.disabled) break;                                  // the card choice is open
  }
  page.keepTexts = false;
  const names = off.choices.map(id => R.Boons.byId[id].name.toUpperCase()), words = new Set([...seen].join(' ').toUpperCase().split(/\s+/));   // a card wraps its name
  ok(names.length === e.cards && names.every(n => n.split(/\s+/).every(w => words.has(w))), () => 'the reopened bonfire should show its ' + names.length + ' cards: ' + names.join(', '));
  ok(mind() === c0 && J(G.run.offer.choices) === J(off.choices) && G.run.pHp === sr.pHp, 'reopening the bonfire forgot again, changed the cards or healed again');
  const bot = makeBot(mulberry(7), 'cheat');
  bot.noise = 0;
  for (let i = 0; i < 4000 && !(G.run && G.run.stage === 'duel' && G.run.duelN === sr.duelN + 1); i++) { bot.act(page); page.frame(16.7); }
  const got = G.run ? G.run.pBoons.filter(b => sr.pBoons.indexOf(b) < 0) : [];
  ok(!!G.run && G.run.stage === 'duel' && G.run.duelN === sr.duelN + 1 && got.length === 1 && off.choices.indexOf(got[0]) >= 0 && mind() === c0,
    () => 'the resumed bonfire did not end with one offered card taken and nothing forgotten again: ' + J(got));
  const after = store.parsed();
  ok(!!after && !!after.run && after.run.duelN === sr.duelN + 1 && J(after.run.pBoons) === J(G.run && G.run.pBoons), 'the card taken at the resumed bonfire was not stored');
  tally.bonfire++;
  tally[fx.sha] = (tally[fx.sha] || 0) + 1;
}
// A final-duel save between phases (the blow that ended phase k stored, the change not yet): it resumes into phase
// k + 1 exactly as one transform would make it (the oracle: endDuel, nextPhase, the first turn start), one phase heal.
function transformResume(file, fx, tally) {
  const raw = fx.store[KEY], snap = JSON.parse(raw), sr = snap.run, sd = sr.duel;
  const { store, page } = bootSave(fx.store);
  if (!page.alive) return;
  const G = page.G;
  const lost = lostIn(snap.meta, G.meta, 'meta');
  ok(!lost, () => 'a stored meta value changed at boot: ' + lost);
  if (!ok(!!G.run && !!G.run.duel && G.run.duel.over === 'p' && G.run.phase === sr.phase && G.run.duel.phase === sd.phase, 'the save between phases changed at boot')) return;
  const o = oracle.json(raw), OR = oracle.R.Run;
  OR.repairRun(o.run, OR.repairMeta(o.meta));
  OR.endDuel(o.run, o.meta, 'p', null);
  OR.nextPhase(o.run);
  oracle.R.Combat.beginTurn(o.run.duel);
  if (!ok(continueToInput(page), 'no input window after resuming between phases')) return;
  const d = G.run.duel;
  ok(G.run.phase === sd.phase + 1 && d.phase === sd.phase + 1 && d.turn === 1, () => 'resumed between phases ' + sd.phase + ' and ' + (sd.phase + 1) + ' at phase ' + d.phase + ' turn ' + d.turn + ' (run.phase ' + G.run.phase + ')');
  ok(coreOf(d) === coreOf(o.run.duel), () => 'the next phase is not what one transform makes:\n   ' + coreOf(o.run.duel) + '\n   ' + coreOf(d));
  const sv = store.parsed();
  ok(!!sv && !!sv.run && sv.run.phase === sd.phase + 1 && !!sv.run.pending && sv.run.pending.phase === sd.phase + 1, 'the next phase and its seal were not stored');
  ok(playTurnOut(page), 'the first turn of the next phase did not resolve');
  tally.transform++;
  tally[fx.sha] = (tally[fx.sha] || 0) + 1;
}
function fixtureTests() {
  where = 'fixtures';
  const t = Date.now(), all = loadFixtures(), tally = { commit: 0, begin: 0, bleed: 0, tutorial: 0, bonfire: 0, transform: 0 };
  const shas = new Set(all.map(x => x.fx.sha));
  // Every commit's set: the tutorial mid-turn, the bonfire (as it opens and with its cards shown), duel 2's turn at
  // every reload point, the final duel between phases, and the final duel past phase 1 before and after the seal.
  const NEED = ['d1-seal', 'b1-enter', 'b1-cards', 'd2-pre', 'd2-bleed', 'd2-seal', 'd2-input', 'd2-post', 'd7x-transform', 'd7pN-pre', 'd7pN-seal'];
  for (const sha of ['6e8a65b', '42ec57c', '0cba25d']) {
    const have = new Map(all.filter(x => x.fx.sha === sha).map(x => [x.file.slice(sha.length + 1).replace(/\.json$/, '').replace(/^d7p\d+-/, 'd7pN-'), x.fx.expect || {}]));
    const miss = NEED.filter(n => !have.has(n));
    ok(!miss.length, () => 'tools/fixtures is missing saves from ' + sha + ': ' + miss.join(', '));
    const e = n => have.get(n) || {};
    ok(e('d2-bleed').begun === true && e('d2-bleed').pending === false && e('d2-pre').begun === false && e('d2-pre').pending === false, sha + ': the pre and bleed fixtures must hold a turn before and after its start, with no seal');
    ok(e('d1-seal').tutorial === true && e('d1-seal').pending === true, sha + ': the d1 fixture must be the tutorial with a seal pending');
    ok(e('b1-enter').cards === 4 && e('b1-enter').applied === true && e('b1-enter').shown === false && e('b1-cards').shown === true, sha + ': the bonfire fixtures must hold four cards and an applied forget, before and after the cards are shown');
    ok(e('d7x-transform').over === 'p' && e('d7x-transform').duelN === 7, sha + ': the d7x fixture must be the final duel between phases');
  }
  for (const x of all) { where = 'fixtures:' + x.file; fixtureResume(x.file, x.fx, tally); }
  const by = name => { const x = all.find(q => q.file === name); ok(!!x, 'fixture missing: ' + name); return x ? JSON.parse(x.fx.store[KEY]) : null; };
  const J = JSON.stringify;

  // V1: a final-duel save past phase 1 whose duel has an older shape (the corrupt section's intel/tally/begun strip).
  // validRun drops the duel; enter() rebuilds that phase from run.pHp (no second heal), shows its rule cards, no intro.
  for (const name of ['0cba25d-d7p3-seal.json', '6e8a65b-d7p2-seal.json']) {
    where = 'fixtures:v1 ' + name;
    const o = by(name);
    if (!o) continue;
    const k = o.run.phase, hp = o.run.pHp;
    delete o.run.duel.intel; delete o.run.duel.tally; delete o.run.duel.begun; delete o.run.duel.pendingEvents;
    const { page } = bootSave({ [KEY]: J(o) });
    if (!page.alive) continue;
    const G = page.G, R = page.R;
    ok(G.run && G.run.duel === null && G.run.pending === null && G.run.phase === k, 'V1: validRun should drop the old-shape duel and keep phase ' + k);
    const seen = new Set();
    waitScene(page, 'title', 200); run60(page, 20); tapLabel(page, 'CONTINUE');
    page.keepTexts = true;
    for (let i = 0; i < 400 && !(page.E.sceneName === 'duel' && G.run.duel); i++) { page.frame(16.7); for (const s of page.lastTexts) seen.add(s); }
    const d0 = G.run.duel;
    if (!ok(!!d0, 'V1: the duel scene did not start')) { page.keepTexts = false; continue; }
    ok(G.run.phase === k && d0.phase === k && d0.n === 7, () => 'V1: the old-shape duel came back at phase ' + d0.phase + ' (run.phase ' + G.run.phase + '), not ' + k);
    ok(d0.p.hp === hp && !d0.pendingEvents.some(ev => ev.t === 'heal'), () => 'V1: the player came back with ' + d0.p.hp + ' HP, the save had ' + hp + ' (a second phase heal?)');
    page.keepTexts = false;
    ok(continueFrames(page, seen), 'V1: no input window in the rebuilt phase');
    const cards = (R.Run.cfg(G.run, G.run.duel).cards || []).filter(id => R.Text.rules && R.Text.rules[id]).map(id => R.Text.rules[id].name);
    ok(cards.length > 0 && cards.every(c => seen.has(c)), () => 'V1: the rebuilt phase should show its rule cards (' + cards.join(', ') + ')');
    ok(!seen.has('DUEL 7'), 'V1: a rebuilt phase must not replay the duel-7 intro');
    ok(G.run.phase === k && G.run.duel.phase === k && G.run.pending && G.run.pending.phase === k, 'V1: the rebuilt phase did not seal in phase ' + k);
    ok(playTurnOut(page) && G.run.phase === k, 'V1: the first turn of the rebuilt phase did not resolve in phase ' + k);
  }

  // run.req above R.Run.RULES: parked, never played, credits nothing, survives every save; restored by a build that
  // knows those rules once no other run is in progress.
  {
    where = 'fixtures:parked';
    const o = by('0cba25d-d2-seal.json');
    if (o) {
      o.run.req = 99;
      const { store, page } = bootSave({ [KEY]: J(o) });
      if (page.alive) {
        const G = page.G, m = G.meta.memory, sm = o.meta.memory;
        ok(G.run === null && J(page.R.Save.data.parked) === J(o.run), 'run.req 99: the run must be parked as stored, not played');
        ok(m.runs === sm.runs && m.wins === sm.wins && m.deaths === sm.deaths, 'parking a run must credit nothing');
        waitScene(page, 'title', 200); run60(page, 20); tapLabel(page, /BEGIN/);
        for (let i = 0; i < 600 && page.E.sceneName !== 'duel'; i++) { page.frame(16.7); if (page.E.sceneName === 'relic' && findBtn(page, 'CONFIRM')) tapLabel(page, 'CONFIRM'); }
        const sv = store.parsed();
        ok(sv && sv.run && sv.run.req === 0 && sv.run.seed !== o.run.seed && J(sv.parked) === J(o.run), 'run.req 99: a new run is stamped req 0 and the parked run survives its saves');
        sv.run = null;
        const b2 = bootSave({ [KEY]: J(sv) }, { beforeBoot(p) { p.R.Run.RULES = 99; } });
        if (b2.page.alive) {
          ok(J(b2.page.G.run) === J(o.run) && !('parked' in b2.page.R.Save.data), 'a build whose RULES reach run.req must restore the parked run and clear the slot');
          b2.page.G.save();
          const s2 = b2.store.parsed();
          ok(s2 && !('parked' in s2) && J(s2.run) === J(o.run), 'the restored run must be stored as the run, with no parked copy');
          ok(continueToInput(b2.page) && commitOf(b2.page.G.run.pending) === commitOf(o.run.pending), 'the restored run must resume with its commit');
        }
      }
    }
  }

  // A face this build does not know: redrawn from the earned faces and recorded as bosses.last. In the final duel that
  // restarts duel 7 at phase 1; before it, the duel in progress and its commit are kept.
  for (const [name, final] of [['0cba25d-d7p3-seal.json', true], ['0cba25d-d2-seal.json', false]]) {
    where = 'fixtures:unknown face ' + name;
    const o = by(name);
    if (!o) continue;
    o.run.boss = 'face_of_a_later_build';
    const { page } = bootSave({ [KEY]: J(o) });
    if (!page.alive) continue;
    const G = page.G, R = page.R, run = G.run, idx = run ? R.Run.BOSSES.findIndex(b => b.id === run.boss) : -1;
    if (!ok(!!run, 'an unknown face must not drop the run')) continue;
    ok(idx >= 0 && idx < G.meta.bosses.max && G.meta.bosses.last === run.boss, () => 'the unknown face should be redrawn from the earned ones and become bosses.last: ' + run.boss + ' (last ' + G.meta.bosses.last + ')');
    if (final) ok(run.phase === 1 && run.duel === null && run.pending === null, 'an unknown face in the final duel restarts duel 7 at phase 1');
    else ok(run.duel && run.duel.turn === o.run.duel.turn && commitOf(run.pending) === commitOf(o.run.pending), 'an unknown face before duel 7 keeps the duel and its commit');
    if (ok(continueToInput(page), 'no input window after the redraw')) {
      const d = G.run.duel;
      ok(final ? d.n === 7 && d.phase === 1 && d.turn === 1 : d.n === o.run.duel.n && d.turn === o.run.duel.turn, () => 'resumed at duel ' + [d.n, d.phase, d.turn]);
    }
  }

  // A phase past the face's count restarts duel 7 at phase 1; a stripped run.phase comes back from the duel's own.
  {
    where = 'fixtures:phase';
    const o = by('0cba25d-d7p3-seal.json');
    if (o) {
      const over = JSON.parse(J(o)); over.run.phase = 9;
      const a = bootSave({ [KEY]: J(over) });
      if (a.page.alive) ok(a.page.G.run && a.page.G.run.phase === 1 && a.page.G.run.duel === null && a.page.G.run.pending === null, 'a phase past the count must restart duel 7 at phase 1');
      const gone = JSON.parse(J(o)); delete gone.run.phase;
      const b = bootSave({ [KEY]: J(gone) });
      if (b.page.alive) {
        ok(b.page.G.run && b.page.G.run.phase === o.run.phase, 'a stripped run.phase must come back from the duel (' + o.run.phase + ')');
        ok(continueToInput(b.page) && commitOf(b.page.G.run.pending) === commitOf(o.run.pending) && b.page.G.run.phase === o.run.phase, 'a stripped run.phase must resume the same commit in the same phase');
      }
    }
  }

  // Shadow high-water keys: a meta from a build with more faces and lights keeps them; this build plays the clamped
  // view; an older build's lowered max is raised again from hi.
  {
    where = 'fixtures:hi';
    const o = by('0cba25d-d2-pre.json');
    if (o) {
      o.meta.bosses.max = 2; o.meta.bosses.hi = 6;                    // an older build lowered max in place, kept hi
      o.meta.vigil.max = 9; o.meta.vigil.hi = 9; o.meta.vigil.wins = [1, 0, 0, 0, 0, 0, 0, 0, 2, 1];
      const { store, page } = bootSave({ [KEY]: J(o) });
      if (page.alive) {
        const bs = page.G.meta.bosses, vg = page.G.meta.vigil, B = page.R.Run.BOSSES.length, V = page.R.Run.VIGIL.length;
        ok(bs.max === B && bs.hi === 6, () => 'bosses: max ' + bs.max + ' hi ' + bs.hi + ' (want ' + B + ' and 6)');
        ok(vg.max === V && vg.hi === 9 && vg.wins.length === V + 1 && J(vg.winsX) === J({ 8: 2, 9: 1 }), () => 'vigil: ' + J(vg));
        page.G.save();
        const mt = store.parsed().meta;
        ok(mt.bosses.hi === 6 && mt.vigil.hi === 9 && J(mt.vigil.winsX) === J({ 8: 2, 9: 1 }), 'the shadow keys must survive a save');
        const again = bootSave({ [KEY]: store.raw() });
        if (again.page.alive) ok(J(again.page.G.meta) === J(mt), 'the repair of the shadow keys must be idempotent');
      }
    }
  }
  // An empty store, and storage that can be read but not written or not used at all (memory only).
  {
    where = 'fixtures:empty';
    const { store, page } = bootSave({});
    if (page.alive) {
      waitScene(page, 'title', 200); run60(page, 10);
      ok(page.G.run === null && J(page.G.meta) === J(page.R.Run.defaultMeta()) && store.writes === 0 && !page.R.Save.stale, 'an empty store must boot to the title with a fresh profile and write nothing');
    }
    const x = all.find(q => q.file === '0cba25d-d2-seal.json');
    for (const mode of x ? ['failWrite', 'failAll'] : []) {
      where = 'fixtures:memory-only ' + mode;
      const st = makeStore();
      st.map.set(KEY, x.fx.store[KEY]); st.mode = mode;
      const p = makePage(st, VIEWS[2], { ts: 1000 });
      if (!p.alive) continue;
      const sr = JSON.parse(x.fx.store[KEY]).run;
      if (mode === 'failWrite') {                                     // reads work, writes throw: the run resumes and plays on in memory
        ok(continueToInput(p) && commitOf(p.G.run.pending) === commitOf(sr.pending), 'storage that cannot be written must still resume the stored commit');
        ok(playTurnOut(p) && st.raw() === x.fx.store[KEY] && p.R.Save.persistent === false && !p.R.Save.stale, 'memory only: the turn must resolve in memory with nothing written and no stale tab');
      } else {                                                        // every call throws: nothing can be read, a fresh profile in memory
        waitScene(p, 'title', 200); run60(p, 10);
        ok(p.G.run === null && J(p.G.meta) === J(p.R.Run.defaultMeta()) && p.R.Save.persistent === false && !p.R.Save.stale, 'storage that cannot be read must boot a fresh profile in memory');
      }
    }
  }
  where = 'fixtures';
  console.log('fixtures: ' + all.length + ' golden saves (' + [...shas].map(s => s + ' ' + (tally[s] || 0)).join(', ') + ' resumed and played out): ' + tally.commit + ' with the pending commit kept, ' + tally.begin +
    ' with one turn start (' + tally.bleed + ' saved after it), ' + tally.tutorial + ' tutorial, ' + tally.bonfire + ' bonfire, ' + tally.transform + ' between phases; V1 rebuild, parked run, unknown face, phase repairs, shadow keys, empty and memory-only storage; ' + ((Date.now() - t) / 1000).toFixed(1) + ' s');
}
// Frames until the buttons light (already in the duel scene), collecting drawn texts into `seen`.
function continueFrames(page, seen) {
  page.keepTexts = true;
  for (let i = 0; i < 2000; i++) {
    const pk = page.R.Scenes.duel.peek();
    if (pk && pk.input) { page.keepTexts = false; return true; }
    if (!page.frame(16.7)) break;
    for (const s of page.lastTexts) seen.add(s);
  }
  page.keepTexts = false;
  return false;
}

// ============================================================================================== 16. stale second tab (P1.1)
// Two pages on one storage. The tab that did not save last is stale: R.Save refuses its writes (a storage event, or
// the generation key rival.save.v1.gen found changed at its next save), and it reloads from storage when it comes
// back into view or at its next tap or key, which it swallows. A save with nothing new writes nothing (an idle tab
// never makes another stale), a failing generation write alone is not stale, and a tab without storage never is.
function staleTests() {
  where = 'stale';
  const J = JSON.stringify, t = Date.now();
  const inputOpen = p => p.E.sceneName === 'duel' && p.R.Scenes.duel.peek() && p.R.Scenes.duel.peek().input;
  // something new for a tab to save (a save with nothing new writes nothing and takes no generation)
  const touch = P => { P.R.Save.data.tabMark = 1 + (P.R.Save.data.tabMark | 0); };
  const store = makeStore(), A = makePage(store, VIEWS[2]);
  if (!A.alive) return;
  playUntil(A, store, inputOpen, { what: 'tab A: an input window', seed: 61 });
  const B = makePage(store, VIEWS[3]);                              // a second tab opens on the same storage
  if (!B.alive) return;
  waitScene(B, 'title', 200); run60(B, 10);
  ok(!A.R.Save.stale && !B.R.Save.stale, 'no tab is stale before another one saved');
  // an idle second tab hidden and shown again (its flush has nothing new): nothing is written, the first tab stays
  {
    const r0 = store.raw(), wi = store.writes, gi = store.map.get(GEN_KEY);
    B.setHidden(true); B.setHidden(false); run60(B, 3);
    ok(store.writes === wi && store.raw() === r0 && store.map.get(GEN_KEY) === gi, 'an idle tab\'s flush wrote to storage (writes +' + (store.writes - wi) + ', generation ' + gi + ' -> ' + store.map.get(GEN_KEY) + ')');
    ok(A.R.Save.check() === false && !A.R.Save.stale && inputOpen(A) && A.G.save() === true && store.writes === wi, 'an idle second tab must not make the playing tab stale');
  }
  // (a) B earns a face and saves; A hears it through a storage event
  B.G.meta.bosses.max = Math.min(B.R.Run.BOSSES.length, B.G.meta.bosses.max + 1);
  ok(B.G.save() === true, 'G.save must return true when the save reached storage');
  const raw = store.raw(), w0 = store.writes, gen0 = store.map.get(GEN_KEY);
  ok(/^\d+$/.test(gen0 || ''), 'the generation key holds an integer: ' + gen0);
  A.fire('window', 'storage', { key: KEY });
  ok(A.R.Save.stale === true, 'a storage event for the save must make the other tab stale');
  A.setHidden(true);                                                 // its flush: visibilitychange + pagehide
  ok(A.G.save() === false && A.R.Save.commit() === false, 'a stale tab: G.save and R.Save.commit must return false');
  ok(store.writes === w0 && store.raw() === raw && store.map.get(GEN_KEY) === gen0, 'a stale tab wrote to storage');
  A.setHidden(false);                                                // back in view: reloads from storage
  run60(A, 3);
  let sv = store.parsed();
  ok(J(A.G.meta) === J(sv.meta) && A.G.meta.bosses.max === B.G.meta.bosses.max, 'after the reload tab A must have the stored meta (the face tab B earned)');
  ok(J(A.G.run) === J(sv.run), 'after the reload tab A must have the stored run');
  ok(A.E.sceneName === 'title' && A.R.Save.stale === false, 'a reloaded tab starts from the title and is not stale: ' + A.E.sceneName);
  // (b) no storage event (a page restored from the back-forward cache): the next save finds a newer generation
  touch(A);
  ok(A.G.save() === true && store.map.get(GEN_KEY) !== gen0, 'tab A saves again after its reload');
  const raw2 = store.raw(), w2 = store.writes;
  ok(B.G.save() === false && B.R.Save.stale === true, 'without a storage event the next save must find the newer generation and refuse');
  ok(store.raw() === raw2 && store.writes === w2, 'the refused save wrote something');
  // (c) a stale tab swallows its next tap: it reloads, and the tap reaches no scene
  let ev = B.fire('window', 'pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 10, clientY: 10, cancelable: true });
  ok(ev.stopped && ev.defaultPrevented && B.R.Save.stale === false, 'a stale tab must swallow the tap that reloads it');
  B.fire('window', 'pointerup', { pointerId: 1, pointerType: 'touch', button: 0, clientX: 10, clientY: 10, cancelable: true });
  run60(B, 3);
  ok(B.E.sceneName === 'title' && J(B.G.meta) === J(store.parsed().meta), 'the swallowed tap must reload tab B from storage');
  // ... also a tap on a move button (tab B) and a key (tab A) at an open input window: nothing is picked or written.
  // Tab A falls behind a save of B's and finds out when it hides (its flush is refused) and reloads when it is shown
  // again.
  for (const how of ['tap', 'key']) {
    where = 'stale:' + how;
    const P = how === 'tap' ? B : A;
    if (P === A) {
      touch(B);
      ok(B.G.save() === true, 'tab B saves after its reload');
      A.setHidden(true);
      ok(A.R.Save.stale === true, 'a tab whose flush finds a newer generation must be stale');
      A.setHidden(false); run60(A, 3);
      ok(A.R.Save.stale === false && A.E.sceneName === 'title', 'a stale tab shown again must reload from storage');
    }
    if (!ok(continueToInput(P), 'no input window to test the swallowed ' + how)) continue;
    P.fire('window', 'storage', { key: GEN_KEY });
    const before = store.raw(), turns = P.G.run.stats.turns, bt = findBtn(P, 'STRIKE') || findBtn(P, 'GUARD') || findBtn(P, 'FEINT');
    ev = how === 'tap' ? P.down(bt.x + 5, bt.y + 5) : P.key('1');
    if (how === 'tap') P.up(bt.x + 5, bt.y + 5);
    run60(P, 30);
    ok(ev && ev.stopped && P.E.sceneName === 'title' && store.raw() === before && P.G.run && P.G.run.stats.turns === turns, () => 'the ' + how + ' on a stale tab must reload it and pick nothing (scene ' + P.E.sceneName + ')');
  }
  // (d) a failing generation write alone is not stale, and the next save still writes
  where = 'stale:gen-write';
  const s2 = makeStore(), P2 = makePage(s2, VIEWS[2]);
  if (P2.alive) {
    run60(P2, 10);
    s2.failKeys.add(GEN_KEY);
    touch(P2);
    ok(P2.G.save() === true && !P2.R.Save.stale && !s2.map.has(GEN_KEY), 'a failed generation write: the save is written and the tab is not stale');
    touch(P2);
    const w2b = s2.writes;
    ok(P2.G.save() === true && !P2.R.Save.stale && s2.writes === w2b + 1, 'a failed generation write: the next save still writes');
    s2.failKeys.delete(GEN_KEY);
    touch(P2);
    ok(P2.G.save() === true && s2.map.get(GEN_KEY) === '1', 'the generation key is written again once it can be: ' + s2.map.get(GEN_KEY));
  }
  // (f) a generation this code never writes (garbage, or too long to read back as the same number) reads as 0, and
  // the last one wraps to 1: a tab is never made stale by its own saves
  for (const g of ['999999999999999999999', '1e+21', '-3', 'x', '999999999']) {
    where = 'stale:gen ' + g;
    const s4 = makeStore();
    s4.map.set(GEN_KEY, g);
    const P4 = makePage(s4, VIEWS[2]);
    if (!P4.alive) continue;
    run60(P4, 10);
    const got = [];
    for (let i = 0; i < 3; i++) { touch(P4); got.push(P4.G.save() + ':' + s4.map.get(GEN_KEY)); }
    ok(!P4.R.Save.stale && J(got) === J(['true:1', 'true:2', 'true:3']), () => 'stored generation ' + g + ': saves ' + J(got) + (P4.R.Save.stale ? ', and the tab made itself stale' : ''));
  }
  // (g) the save cleared elsewhere (another tab, or by hand): the stale tab reboots to what storage holds (nothing),
  // not to its own copy, and its next save does not bring that copy back
  {
    where = 'stale:cleared';
    const s5 = makeStore(), P5 = makePage(s5, VIEWS[2]);
    if (P5.alive) {
      run60(P5, 10);
      P5.G.meta.memory.runs = 42;
      ok(P5.G.save() === true && s5.parsed().meta.memory.runs === 42, 'the marked save was not written');
      s5.map.clear();
      P5.fire('window', 'storage', { key: null });
      ok(P5.R.Save.stale === true, 'clearing the storage elsewhere must make the tab stale');
      P5.setHidden(true);
      ok(s5.map.size === 0, 'a stale tab wrote its copy back into cleared storage');
      P5.setHidden(false); run60(P5, 3);
      ok(!P5.R.Save.stale && P5.E.sceneName === 'title' && P5.G.meta.memory.runs === 0 && P5.G.run === null, 'a tab reloaded after the save was cleared must start fresh (runs ' + P5.G.meta.memory.runs + ')');
      P5.G.save();
      ok(!s5.map.has(KEY) || s5.parsed().meta.memory.runs === 0, 'the reloaded tab brought its old copy back into storage');
    }
  }
  // (e) without storage (denied, every call throwing, writes failing) a tab is never stale, even after a storage event
  for (const mode of ['deny', 'failAll', 'failWrite']) {
    where = 'stale:' + mode;
    const s3 = makeStore(); s3.mode = mode;
    const P3 = makePage(s3, VIEWS[2]);
    if (!P3.alive) continue;
    run60(P3, 10);
    if (mode !== 'failWrite') P3.fire('window', 'storage', { key: KEY });
    ok(P3.G.save() === false && P3.R.Save.stale === false && s3.map.size === 0, 'storage mode ' + mode + ': memory only, never stale');
  }
  // (h) a tab made stale during the presentation (its pick resolved, the next seal not yet made), with no tap and no
  // hide: it must not seal a turn it cannot save, or its stance would be a free look at a seal the reboot rolls
  // again. It reboots before the next seal, so no new seal is made and no stance shows. With a storage event,
  // without one (the check before the seal), and with the other tab saving during the seal itself (the seal's own
  // save finds the tab stale: it reboots before the stance shows).
  for (const how of ['event', 'no event', 'during the seal']) {
    where = 'stale:presentation ' + how;
    const s6 = makeStore(), P6 = makePage(s6, VIEWS[2]);
    if (!P6.alive) continue;
    playUntil(P6, s6, inputOpen, { what: 'the presentation case: an input window', seed: how === 'event' ? 62 : how === 'no event' ? 63 : 64 });
    if (!ok(inputOpen(P6), 'no input window for the presentation case')) continue;
    const pk = P6.R.Scenes.duel.peek(), m = pk.only || P6.R.Combat.legal(P6.G.run.duel, 'p')[0], b = findBtn(P6, MOVE_LABEL[m]);
    const turns0 = P6.G.run.stats.turns;
    P6.down(b.x + 5, b.y + 5); P6.up(b.x + 5, b.y + 5);
    for (let i = 0; i < 900 && P6.G.run && P6.G.run.stats.turns === turns0; i++) P6.frame(16.7);
    if (!ok(P6.G.run && P6.G.run.stats.turns === turns0 + 1 && !P6.G.run.duel.over && !inputOpen(P6), 'the pick did not resolve into a running duel')) continue;
    const Q = makePage(s6, VIEWS[3]);                                // another tab, on the same storage
    if (!Q.alive) continue;
    waitScene(Q, 'title', 200); run60(Q, 10);
    // a stance shows as the Rival's tell_<move> animation (S.tell itself keeps the last turn's value until then)
    let seals = 0, told = false, qSaved = null, raw = null, w = 0;
    const brain = P6.G.brain, commit0 = brain.commit, fighter0 = P6.H.fighter;
    const otherSaves = () => { touch(Q); qSaved = Q.G.save(); raw = s6.raw(); w = s6.writes; };
    P6.H.fighter = function (who, name) { if (seals > 0 && /^tell_/.test(String(name))) told = true; return fighter0.apply(this, arguments); };
    brain.commit = function () {
      seals++;
      const r = commit0.apply(this, arguments);
      if (how === 'during the seal' && seals === 1) otherSaves();
      return r;
    };
    if (how !== 'during the seal') otherSaves();
    if (how === 'event') P6.fire('window', 'storage', { key: KEY });
    let opened = false;
    for (let i = 0; i < 900 && P6.E.sceneName === 'duel'; i++) {
      if (inputOpen(P6)) { opened = true; break; }
      P6.frame(16.7);
    }
    brain.commit = commit0; P6.H.fighter = fighter0;
    ok(qSaved === true, 'the other tab saves');
    ok(!opened && P6.E.sceneName === 'title', () => 'a tab made stale during the presentation must reboot before its next seal, not open an input window (scene ' + P6.E.sceneName + ')');
    ok(seals === (how === 'during the seal' ? 1 : 0) && !told, () => 'a stale tab sealed ' + seals + ' turn(s)' + (told ? ' and showed a stance' : '') + ' it could not save');
    ok(s6.raw() === raw && s6.writes === w && !P6.R.Save.stale, 'the rebooted tab wrote to storage or stayed stale');
    ok(J(P6.G.run) === J(s6.parsed().run), 'after the reboot the tab must hold the stored run');
  }
  // (i) a tab that goes stale after its seal is saved and before its pick resolves must not show the resolve: the
  // reboot replays the saved seal, and the player would play it again knowing the Rival's move. Three ways in: the
  // other tab saves while a press is held (the event lands between down and up), during the 0.2 s lock-in, or with
  // no event at all during the input window (the tap finds the newer generation and is swallowed). (j) The same for
  // a Keyhole held when the event lands: no glimpse, and the charge stays spent nowhere.
  const openWindow = p => inputOpen(p) && p.G.meta.seenTutorial && !p.R.Scenes.duel.peek().only && p.G.run.pending;
  for (const how of ['held press', 'lock-in', 'no event', 'keyhole']) {
    where = 'stale:resolve ' + how;
    const s7 = makeStore();
    let P7 = makePage(s7, VIEWS[2]);
    if (!P7.alive) continue;
    playUntil(P7, s7, openWindow, { what: 'a post-tutorial input window', seed: 70 + ['held press', 'lock-in', 'no event', 'keyhole'].indexOf(how) });
    if (!ok(openWindow(P7), 'no post-tutorial input window')) continue;
    if (how === 'keyhole') {                                          // hand the player a Keyhole and reload on that save
      const d = P7.G.run.duel;
      if (d.p.boons.indexOf('keyhole') < 0) d.p.boons.push('keyhole');
      d.p.charges = d.p.charges || {}; d.p.charges.keyhole = 1;
      if (P7.G.run.pBoons.indexOf('keyhole') < 0) P7.G.run.pBoons.push('keyhole');
      P7.G.save();
      P7 = makePage(s7, VIEWS[2]);
      if (!ok(P7.alive && continueToInput(P7), 'no input window after the Keyhole reload')) continue;
      run60(P7, 2);
    }
    const X = J(s7.parsed().run.pending && s7.parsed().run.pending.sealed);
    ok(X !== undefined && J(P7.G.run.pending.sealed) === X, 'tab A holds the stored seal');
    const turns0 = s7.parsed().run.stats.turns;
    const shown = [], sig0 = P7.H.sigil;
    P7.H.sigil = function (x, y, state, move, side) { if (side === 'r' && state === 'open' && shown.indexOf(move) < 0) shown.push(move); return sig0.apply(this, arguments); };
    const Q = makePage(s7, VIEWS[3]);
    if (!Q.alive) continue;
    waitScene(Q, 'title', 200); run60(Q, 10);
    const other = () => { touch(Q); return Q.G.save(); };
    let qSaved, ev = null;
    if (how === 'keyhole') {
      const kb = P7.buttons.find(q => q.label === '' && q.w === 22 && q.x === 4);
      if (!ok(!!kb, 'no Keyhole button')) continue;
      P7.down(kb.x + 5, kb.y + 5); P7.frame(16.7);
      qSaved = other(); P7.fire('window', 'storage', { key: KEY });
      P7.up(kb.x + 5, kb.y + 5);
    } else {
      const b = findBtn(P7, MOVE_LABEL[P7.R.Combat.legal(P7.G.run.duel, 'p')[0]]);
      if (how === 'held press') { P7.down(b.x + 5, b.y + 5); P7.frame(16.7); qSaved = other(); P7.fire('window', 'storage', { key: KEY }); P7.up(b.x + 5, b.y + 5); }
      else if (how === 'lock-in') { P7.down(b.x + 5, b.y + 5); P7.up(b.x + 5, b.y + 5); P7.frame(16.7); P7.frame(16.7); qSaved = other(); P7.fire('window', 'storage', { key: KEY }); }
      else { qSaved = other(); ev = P7.down(b.x + 5, b.y + 5); P7.up(b.x + 5, b.y + 5); }
    }
    for (let i = 0; i < 1500 && P7.E.sceneName === 'duel'; i++) P7.frame(16.7);
    const st = s7.parsed();
    ok(qSaved === true, 'the other tab saves');
    ok(shown.length === 0, () => 'a stale tab showed the Rival\'s sealed move (' + J(shown) + ') for a ' + (how === 'keyhole' ? 'glimpse' : 'resolve') + ' it could not save');
    ok(P7.E.sceneName === 'title' && !P7.R.Save.stale, () => 'the stale tab must reboot to the title (scene ' + P7.E.sceneName + ')');
    ok(st.run.stats.turns === turns0 && J(st.run.pending && st.run.pending.sealed) === X, 'the stored run must still hold the same seal, unresolved');
    if (how === 'no event') ok(ev && ev.stopped, 'with no event, the tap must find the newer generation and be swallowed');
    if (how === 'keyhole') ok(st.run.duel.p.charges.keyhole === 1, 'the stored Keyhole charge must stay unspent');
  }
  where = 'stale';
  sv = store.parsed();
  console.log('stale tab: idle second tab, storage event, generation mismatch, swallowed tap and key, failed generation write, garbage and wrapping generations, save cleared elsewhere, deny/failAll/failWrite, stale during the presentation (event, no event, during the seal), stale before the resolve (held press, lock-in, no event) and at a Keyhole; save generation ' + store.map.get(GEN_KEY) + ', ' + ((Date.now() - t) / 1000).toFixed(1) + ' s');
}

// ============================================================================================== go
// New sections go after the old ones: every page draws from the shared sysRand stream, so inserting one earlier
// would change what the later sections play.
const SECTIONS = {
  soak, long: longSession, storage: storageTests, corrupt: corruptTests, pause: pauseTests, scripted: scriptedReloads, layout: layoutTests, perf: perfProbe, random: randomTests,
  rngsites: rngSitesTests, blind: blindTests, pausetap: pauseTapTests, parity: parityTests, coerce: coerceTests, fixtures: fixtureTests, stale: staleTests, sealtrace: sealTraceTests
};
const OPT_IN = ['sealtrace'];                                       // only when named in FLOW_SECTIONS
function main() {
  console.log('test_flow: ' + RUNS + ' runs, seed ' + SEED + (QUICK ? ' (quick)' : ''));
  const pickSec = process.env.FLOW_SECTIONS ? process.env.FLOW_SECTIONS.split(',').map(s => s.trim()) : Object.keys(SECTIONS).filter(k => OPT_IN.indexOf(k) < 0);   // e.g. FLOW_SECTIONS=soak,perf
  for (const k of pickSec) if (!SECTIONS[k]) { where = 'go'; fail('unknown section in FLOW_SECTIONS: ' + k + ' (have ' + Object.keys(SECTIONS).join(',') + ')'); }
  for (const k of Object.keys(SECTIONS)) if (pickSec.indexOf(k) >= 0) SECTIONS[k]();
  console.log('coerce: ' + COERCE.resolves + ' resolves, ' + COERCE.rival + ' Rival coercions' + (COERCE.expected ? ' (+' + COERCE.expected + ' expected in the forged-save control)' : '') +
    (COERCE.player ? ', ' + COERCE.player + ' player-side' : ''));
  const rows = Object.keys(knownSeen);
  console.log((fails ? 'FAILED ' + fails : 'ALL PASS') + ' - ' + checks + ' checks' + (rows.length ? ', ' + rows.length + ' KNOWN row(s) (' + rows.join(', ') + ')' : '') + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  process.exit(fails ? 1 : 0);
}

if (require.main === module) main();
else {
  // The harness for other tools (P1.1 fixtures and the like). Requiring this file runs no section. Shared state:
  // clock (the wall clock every page sees), the sysRand stream, the failure counters (stats(), setWhere()).
  module.exports = {
    KEY, GEN_KEY, VIEWS, SRC, clock, sysRand, oracle, COERCE, KNOWN_ROWS, loadFixtures, bootSave, continueToInput, playTurnOut,
    makeStore, makePage, makeBot, makeMonitor, session, commitOf, coreOf, diffKeys, findBtn, run60, tapXY, tapLabel, waitScene, playUntil,
    collectSaves, bootAndPlay, drive, veteranSave, recordFrames, blindRun, blindLive, qCanon, canonV, mulberry, fail, ok, knownHit,
    setWhere(w) { where = w; }, stats: () => ({ fails, checks, known, knownRows: Object.assign({}, knownSeen), where })
  };
}
