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
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..'), SRC = path.join(ROOT, 'src');
const argv = process.argv.slice(2), flags = argv.filter(a => a.startsWith('--')), nums = argv.filter(a => !a.startsWith('--'));
const QUICK = flags.includes('--quick'), VERBOSE = flags.includes('--verbose');
const RUNS = +nums[0] > 0 ? +nums[0] : (QUICK ? 30 : 200), SEED = +nums[1] > 0 ? +nums[1] : 1;
const KEY = 'rival.save.v1';

// Defects in files this test's author may not edit (reported to the lead with a patch). A failure whose message
// matches one of these is printed as KNOWN-OPEN and does not fail the run. Delete an entry once its patch is in.
const KNOWN_OPEN = [
];

// ---------------------------------------------------------------------------------------------- failures
let fails = 0, known = 0, checks = 0, where = 'init';
const seenFail = new Set();
function fail(msg) {
  const isKnown = KNOWN_OPEN.some(re => re.test(msg));
  const k = msg.replace(/\d+/g, '#');
  if (seenFail.has(k)) return;
  seenFail.add(k);
  if (isKnown) { known++; console.log('KNOWN-OPEN [' + where + '] ' + msg); return; }
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
const SCENE_FILES = fs.readdirSync(path.join(SRC, 'scenes')).filter(f => f.endsWith('.js')).sort().map(f => 'scenes/' + f);
const scripts = {};
function script(rel) {
  if (!scripts[rel]) scripts[rel] = new vm.Script(fs.readFileSync(path.join(SRC, rel), 'utf8'), { filename: path.join(SRC, rel) });
  return scripts[rel];
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
      if (who !== 'player' && who !== 'rival' && who !== 'rival2') return null;
      if (name === 'transform' && who === 'player') return null;
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
// window.localStorage itself throws, as in a sandboxed iframe)
function makeStore() {
  const st = {
    map: new Map(), mode: 'ok', writes: 0, failed: 0, lastBytes: 0,
    api: {
      getItem(k) { if (st.mode === 'failAll') throw new Error('SecurityError'); return st.map.has(k) ? st.map.get(k) : null; },
      setItem(k, v) {
        if (st.mode !== 'ok') { st.failed++; throw new Error('QuotaExceededError'); }
        st.writes++; st.lastBytes = String(v).length; st.map.set(k, String(v));
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

function makePage(store, view, opt) {
  opt = opt || {};
  const page = {
    store, view, ts: 1000 + Math.floor(sysRand() * 1e6), frameNo: 0, rafCb: null, timeouts: [], tid: 0,
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
  function listen(map) { return function (type, fn) { page.c.listeners++; (map[type] = map[type] || []).push(fn); }; }
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
  page.fire = function (target, type, ev) {
    const list = (target === 'window' ? page.lw : page.ld)[type];
    if (!list) return;
    ev = ev || {};
    if (!ev.preventDefault) ev.preventDefault = function () {};
    ev.type = type;
    for (let i = 0; i < list.length; i++) {
      try { list[i](ev); } catch (e) { fail('exception in ' + type + ' handler @' + page.scene() + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
    }
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
  page.down = (x, y, id) => page.fire('window', 'pointerdown', { pointerId: id || 1, pointerType: 'touch', button: 0, clientX: cx(x), clientY: cy(y), cancelable: true });
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
function coreOf(d) {
  const f = x => ({ hp: x.hp, maxHp: x.maxHp, status: x.status, charges: x.charges, counters: x.counters, moves: x.moves, results: x.results, boons: x.boons });
  return JSON.stringify({ n: d.n, phase: d.phase, turn: d.turn, tension: d.tension, over: d.over, begun: d.begun, p: f(d.p), r: f(d.r), tally: d.tally });
}
function makeMonitor(store) {
  const mon = {
    exp: null, runKey: undefined, turns: 0, duelN: 0, phase: 1, commit: null, inputOpen: false, pendingStr: null,
    offers: {}, bonfireHp: {}, after: null, phase2Hp: null, lastDuelHp: 0, sig: '', sigAt: 0, simSec: 0, runStartSec: 0,
    count: { runs: 0, deaths: 0, wins: 0, abandons: 0, turns: 0, bonfires: 0, fourCard: 0, phase2: 0, credits: 0, midTurnReloads: 0, midTurnVerified: 0,
      betweenTurnVerified: 0, bonfireReloadVerified: 0, lethalReloads: 0, transformReloads: 0, relicRuns: 0, tutorialTurns: 0, calledShots: 0, activesUsed: 0, persistedEqual: 0 },
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
    mon.inputOpen = false; mon.pendingStr = null;
    const G = page.G;
    if (!mon.trust) { mon.sync(page); return; }
    let snap = null;
    try { snap = snapRaw ? JSON.parse(snapRaw) : null; } catch (e) { snap = null; }
    if (!ok(!!snap, 'reload: storage had no parseable save although writes succeed')) { mon.sync(page); return; }
    ok(J(G.run) === J(snap.run), () => 'reload: R.Game.run differs from the stored run (stage ' + (snap.run && snap.run.stage) + ')');
    ok(J(G.meta) === J(snap.meta), 'reload: R.Game.meta differs from the stored meta');
    const m = G.meta.memory;
    ok(m.runs === mon.exp.runs && m.wins === mon.exp.wins && m.deaths === mon.exp.deaths,
      () => 'reload lost progress: stored runs/wins/deaths ' + [m.runs, m.wins, m.deaths] + ' but ' + [mon.exp.runs, mon.exp.wins, mon.exp.deaths] + ' happened (' + before + ')');
    ok(mon.keyOf(G.run) === mon.runKey, () => 'reload: the run in storage is ' + mon.keyOf(G.run) + ', live was ' + mon.runKey + ' (' + before + ')');
    if (G.run) {
      ok(G.run.stats.turns === mon.turns, () => 'reload: stored stats.turns ' + G.run.stats.turns + ' != live ' + mon.turns + ' (' + before + ')');
      ok(G.run.duelN === mon.duelN, () => 'reload: stored duelN ' + G.run.duelN + ' != live ' + mon.duelN + ' (' + before + ')');
    }
    mon.after = snap.run ? { run: snap.run, turns: snap.run.stats ? snap.run.stats.turns : 0 } : null;
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
      }
      mon.runKey = key; mon.turns = 0; mon.duelN = key ? 1 : 0; mon.phase = 1; mon.commit = null; mon.inputOpen = false; mon.after = null; mon.phase2Hp = null;
    }
    const m = meta.memory;
    ok(m && m.runs === mon.exp.runs && m.wins === mon.exp.wins && m.deaths === mon.exp.deaths,
      () => 'meta.memory runs/wins/deaths ' + [m.runs, m.wins, m.deaths] + ' != what happened ' + [mon.exp.runs, mon.exp.wins, mon.exp.deaths] + ' @' + E.sceneName);
    if (!run) { mon.progress(page, 'norun|' + E.sceneName + '|' + page.buttons.length); return; }

    // ---- structure
    const st = run.stats, d = run.duel;
    ok(run.duelN >= mon.duelN && run.duelN <= 7, () => 'duelN regressed or overflowed: ' + mon.duelN + ' -> ' + run.duelN);
    if (run.duelN > mon.duelN) { ok(run.duelN === mon.duelN + 1, 'duelN skipped'); mon.duelN = run.duelN; mon.phase = 1; mon.phase2Hp = null; }
    ok(!(mon.phase === 2 && run.phase === 1 && run.duelN === 7), 'phase regressed 2 -> 1');
    if (run.phase === 2 && mon.phase === 1) {                      // the transformation just happened
      mon.phase = 2; mon.count.phase2++;
      if (d) { mon.phase2Hp = d.p.hp; ok(d.p.hp === Math.min(d.p.maxHp, Math.max(1, mon.lastDuelHp) + R.Run.PHASE2_HEAL), () => 'phase-2 heal wrong: ' + mon.lastDuelHp + ' -> ' + d.p.hp); }
    }
    if (d && d.phase === 1) mon.lastDuelHp = d.p.hp;
    ok(fin(run.pHp, run.pMaxHp) && run.pHp >= 0 && run.pHp <= run.pMaxHp, 'run.pHp out of range: ' + run.pHp + '/' + run.pMaxHp);
    if (d) ok(fin(d.p.hp, d.r.hp) && d.p.hp <= d.p.maxHp && d.r.hp <= d.r.maxHp, 'duel hp out of range');
    const relic = run.relicId ? 1 : 0, done = run.stage === 'bonfire' ? run.duelN : run.duelN - 1;
    if (run.stage === 'duel' || run.stage === 'bonfire') {
      ok(run.pBoons.length === relic + (run.stage === 'bonfire' ? done - 1 : done), () => 'player boons ' + run.pBoons.length + ' at duel ' + run.duelN + ' stage ' + run.stage + ' (relic ' + relic + '): a reward was duplicated or lost');
      ok(run.rBoons.length === done, () => 'Rival boons ' + run.rBoons.length + ' after ' + done + ' finished duels (stage ' + run.stage + ')');
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
    ok(sum === st.turns, () => 'stats.turns ' + st.turns + ' != turns on record ' + sum);
    if (mon.phase2Hp !== null && d && d.phase === 2) ok(d.p.hp === mon.phase2Hp, () => 'player hp changed between the transformation and the first phase-2 exchange: ' + mon.phase2Hp + ' -> ' + d.p.hp);

    // ---- the commit
    const pend = run.pending;
    if (pend && d) {
      const s = J(pend);
      if (mon.commit && mon.commit.n === pend.n && mon.commit.phase === pend.phase && mon.commit.turn === pend.turn) {
        ok(s === mon.commit.str, () => 'the committed move/tell for duel ' + pend.n + ' turn ' + pend.turn + ' changed: ' + mon.commit.str + ' -> ' + s);
      } else {
        ok(pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase, 'run.pending is for another turn');
        mon.commit = { n: pend.n, phase: pend.phase, turn: pend.turn, move: pend.sealed.move, tell: pend.sealed.tell, str: s, reloaded: false };
        if (pend.called) mon.count.calledShots++;
      }
    }
    const pk = E.sceneName === 'duel' ? R.Scenes.duel.peek() : null;
    if (pk && pk.input) {
      if (ok(!!pend && !!d && pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase, 'input is enabled but the Rival has not committed for this turn')) {
        if (!mon.inputOpen) {
          mon.inputOpen = true;
          ok(pk.tell === pend.sealed.tell, 'the stance shown is not the committed tell');
          ok(R.Combat.legal(d, 'r').indexOf(pend.sealed.move) >= 0, 'the committed move is not legal');
          if (pk.only) mon.count.tutorialTurns++;
          if (mon.trust) {
            const saved = store.parsed();
            ok(saved && saved.run && J(saved.run.pending) === J(pend), 'input enabled before the commit reached storage');
            if (saved && saved.run && J(saved.run) === J(run)) mon.count.persistedEqual++;
            else ok(false, () => 'at the input window the stored run differs from the live run: ' + diffKeys(saved && saved.run, run));
          }
          const a = mon.after;                                     // first input window after a reload
          if (a && a.run.duel && a.turns === st.turns && a.run.duelN === run.duelN && a.run.phase === run.phase && !a.run.duel.over && a.run.stage === 'duel') {
            const sp = a.run.pending;
            if (sp && sp.turn === a.run.duel.turn) {
              ok(coreOf(d) === coreOf(a.run.duel), () => 'mid-turn reload changed the duel: ' + coreOf(a.run.duel) + ' -> ' + coreOf(d));
              ok(J(pend) === J(sp), 'mid-turn reload changed the commit');
              mon.commit.reloaded = true;
            } else {
              const o = oracle.json(J(a.run.duel));
              oracle.R.Combat.beginTurn(o);
              ok(coreOf(d) === coreOf(o), () => 'reload between turns: turn start applied wrongly (expected ' + coreOf(o) + ' got ' + coreOf(d) + ')');
              mon.count.betweenTurnVerified++;
            }
            mon.after = null;
          }
        } else ok(J(pend) === mon.pendingStr, 'run.pending changed while the input window was open');
        mon.pendingStr = J(pend);
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
  mon.trust = store.mode === 'ok';
  const reloadP = o.reloadP === undefined ? 1 : o.reloadP;
  let page = makePage(store, o.view || rng.pick(VIEWS), o.pageOpt);
  if (!page.alive) return { page, mon, store, ended: 0 };
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
    if (d && d.phase === 2 && d.turn === 1 && !run.pending) return 'E:transform2';
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
    mon.reloaded(page, raw, before);
    return true;
  }
  where = o.label || 'session';
  while (ended < o.runs && frames < maxFrames && fails < 40) {
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
  const per = Math.max(1, Math.round(RUNS / 10));
  let left = RUNS, i = 0, bytes = [], maxDbg = { t: 0, c: 0, w: 0 }, listenersGrew = 0;
  while (left > 0 && fails < 40) {
    const n = Math.min(per, left);
    const res = session({
      label: 'soak#' + i, seed: SEED * 1000 + i, runs: n,
      pageOpt: { realDraw: i % 3 === 0 },
      onRunEnd(page) { bytes.push(page.store.lastBytes); },
      onFrame(page) {
        if (page.frameNo === 5) page.E.debug = true;               // the engine's own t/c/w readout
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
  ok(c.midTurnVerified > 0, 'no mid-turn reload was verified');
  ok(c.bonfireReloadVerified > 0, 'no bonfire reload was verified');
  ok(c.lethalReloads > 0 && c.transformReloads > 0, 'no reload after a lethal blow / during the transformation');
  console.log('soak: ' + total.runs + ' runs (' + c.wins + ' wins, ' + c.deaths + ' deaths incl. ' + c.abandons + ' abandoned), ' + c.turns + ' turns, ' + c.bonfires + ' bonfires (' + c.fourCard +
    ' with 4 cards), ' + c.phase2 + ' phase-2, ' + c.relicRuns + ' relic runs, ' + c.calledShots + ' called shots, ' + c.tutorialTurns + ' tutorial turns');
  console.log('      ' + total.frames + ' frames, ' + total.reloads + ' reloads: ' + Object.keys(total.kinds).sort().map(k => k + ' ' + total.kinds[k]).join(', '));
  console.log('      verified: mid-turn commit unchanged ' + c.midTurnVerified + '/' + c.midTurnReloads + ' reloads (the rest never resolved that turn before the next reload), between-turn state ' +
    c.betweenTurnVerified + ', bonfire offers ' + c.bonfireReloadVerified + ', stored==live at input ' + c.persistedEqual);
  console.log('      engine peak timers/coroutines/tweens: ' + maxDbg.t + '/' + maxDbg.c + '/' + maxDbg.w + '; save size first/last run: ' + bytes[0] + ' / ' + bytes[bytes.length - 1] + ' bytes (max ' + Math.max.apply(null, bytes) + ')');
  ok(maxDbg.c <= 4, 'coroutines pile up: ' + maxDbg.c);
  ok(maxDbg.t <= 16 && maxDbg.w <= 24, 'timers/tweens pile up: ' + maxDbg.t + '/' + maxDbg.w);
  ok(Math.max.apply(null, bytes) < 200000, 'the save grows too large: ' + Math.max.apply(null, bytes) + ' bytes');
}

// ============================================================================================== 2. storage failures
function storageTests() {
  for (const mode of ['failWrite', 'failAll', 'deny']) {
    const store = makeStore(); store.mode = mode;
    const res = session({ label: 'storage:' + mode, seed: SEED * 31 + mode.length, runs: QUICK ? 3 : 6, store, reloadP: 0.5 });
    where = 'storage:' + mode;
    ok(res.ended >= (QUICK ? 3 : 6), 'runs did not finish with storage mode ' + mode + ' (' + res.ended + ')');
    ok(store.map.size === 0, 'something was written although storage is failing');
    if (res.page.alive) ok(res.page.R.Save.persistent === false, 'R.Save.persistent should be false when writes fail');
  }
  // storage starts failing in the middle of a session, then comes back
  const store = makeStore();
  let flips = 0;
  const res = session({
    label: 'storage:flaky', seed: SEED * 77, runs: QUICK ? 3 : 6, store, reloadP: 0,
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
  const res = session({ label, seed: SEED * 13 + label.length, runs: runs || 1, store, reloadP: 0.3, maxFrames: 400000 });
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
    ['v', o => { delete o.v; }]
  ];
  let m = 0;
  for (const [name, fn] of strips) {
    const picks = QUICK ? [rng.pick(saves)] : [rng.pick(saves), rng.pick(saves), rng.pick(saves)];
    for (const s of picks) {
      const o = JSON.parse(s.raw); fn(o);
      bootAndPlay('oldshape:' + name + ' (' + s.tag + ')#' + (m++), JSON.stringify(o), 1);
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
  page.setHidden(true);
  ok(E.paused === true, 'E.paused must be true while hidden');
  ok(page.audioLog.slice(a0).indexOf('suspend') >= 0, 'audio must suspend on visibilitychange');
  ok(store.writes > w0, 'hiding the page must flush a save');
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
  // landscape on a touch device: frozen, input ignored
  page.landscape = true; page.fire('window', 'resize', {}); page.frame(16.7);
  ok(E.rotated === true, 'E.rotated not set in landscape');
  const t4 = E.time; run60(page, 20);
  ok(E.time === t4, 'time advanced while rotated');
  page.landscape = false; page.fire('window', 'resize', {}); page.frame(16.7);
  ok(E.rotated === false, 'E.rotated stuck');
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
  console.log('scripted: first-win kill -> credits, erase, ' + verified + ' double reloads of one committed turn');
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
  tapLabel(page, 'BACK'); waitScene(page, 'title', 120); run60(page, 30);
  playUntil(page, store, p => p.E.sceneName === 'death', { what: 'death', seed: 6, style: 'lose' });
  run60(page, 60); tapXY(page, 90, 150); run60(page, 240);
  expectClean(measure('death (final state)'));
  playUntil(page, store, p => p.E.sceneName === 'relic', { what: 'relic', seed: 7, style: 'lose', max: 400000 });
  expectClean(measure('relic'));
  playUntil(page, store, p => p.E.sceneName === 'victory', { what: 'victory', seed: 9, style: 'cheat', max: 600000 });
  run60(page, 60); tapXY(page, 90, 150); run60(page, 240);
  expectClean(measure('victory (final state)'));
  tapXY(page, 90, 150); waitScene(page, 'credits', 300);
  if (page.E.sceneName === 'credits') expectClean(measure('credits (roll)', 200));
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

// ============================================================================================== go
console.log('test_flow: ' + RUNS + ' runs, seed ' + SEED + (QUICK ? ' (quick)' : ''));
soak();
storageTests();
corruptTests();
pauseTests();
scriptedReloads();
layoutTests();
perfProbe();
randomTests();
console.log((fails ? 'FAILED ' + fails : 'ALL PASS') + ' - ' + checks + ' checks' + (known ? ', ' + known + ' known-open defect(s) awaiting the lead\'s patch' : '') + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(fails ? 1 : 0);
