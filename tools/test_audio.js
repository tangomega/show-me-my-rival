// SHOW ME MY RIVAL — R.Audio test against a strict mock AudioContext.   node tools/test_audio.js   (exit 1 on failure)
// The mock THROWS (and records) on: non-finite param values, exponential ramps to/from <= 0, anything
// scheduled before currentTime - 1 ms, double start, stop before start, out-of-range filter/pan/rate values.
'use strict';
const path = require('path');
const fs = require('fs');
const FILE = path.join(__dirname, '..', 'src', 'audio', 'audio.js');

let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; console.log('    FAIL: ' + msg); } }
function section(t) { console.log('\n=== ' + t + ' ==='); }
function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

// ------------------------------------------------------------------ fake timers
const timers = new Map(); let timerSeq = 0;
globalThis.setInterval = function (fn) { timers.set(++timerSeq, fn); return timerSeq; };
globalThis.clearInterval = function (id) { timers.delete(id); };

// ------------------------------------------------------------------ mock Web Audio
let W;
function world() {
  W = { now: 0, created: 0, events: 0, ctxs: 0, liveSrc: new Set(), connected: new Set(), errors: [], buffers: [], curves: [],
    freqs: null, starts: null, lockResume: false, ooo: 0 };
}
function bad(msg) { const e = new Error('MOCK: ' + msg); W.errors.push(e.message); throw e; }
const fin = Number.isFinite;

class Param {
  constructor(v, name, lo, hi) { this._v = v; this._last = v; this._lastT = -1; this.name = name; this.lo = lo; this.hi = hi; }
  get value() { return this._v; }
  set value(v) { this._range(v, 'value='); this._v = v; this._last = v; this._log(v); }
  _log(v) { if (W.freqs && this.name === 'osc.frequency') W.freqs.push(v); }
  _range(v, what) {
    if (!fin(v)) bad(this.name + ' ' + what + ' non-finite ' + v);
    if (this.lo !== undefined && (v < this.lo || v > this.hi)) bad(this.name + ' ' + what + ' out of range ' + v);
  }
  _ev(v, t, what) {
    this._range(v, what);
    if (!fin(t) || t < W.now - 0.001) bad(this.name + '.' + what + ' in the past: t=' + t + ' now=' + W.now);
    if (t < this._lastT - 1e-6) W.ooo++;
    this._lastT = t; W.events++;
  }
  setValueAtTime(v, t) { this._ev(v, t, 'setValueAtTime'); this._last = v; this._log(v); return this; }
  linearRampToValueAtTime(v, t) { this._ev(v, t, 'linearRamp'); this._last = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    this._ev(v, t, 'expRamp');
    if (v <= 0) bad(this.name + ' exponential ramp TO ' + v);
    if (this._last <= 0) bad(this.name + ' exponential ramp FROM ' + this._last);
    this._last = v; return this;
  }
  setTargetAtTime(v, t, tc) {
    this._ev(v, t, 'setTarget');
    if (!fin(tc) || tc < 0) bad(this.name + ' setTarget timeConstant ' + tc);
    this._last = v; if (W.targets && this.name === 'osc.frequency') W.targets.push(v);
    return this;
  }
  cancelScheduledValues(t) { if (!fin(t)) bad('cancel non-finite'); return this; }
}
class Node {
  constructor(kind) { this.kind = kind; W.created++; }
  connect(dst) {
    if (!(dst instanceof Node) && !(dst instanceof Param)) bad(this.kind + '.connect to a non-node');
    W.connected.add(this); return dst;
  }
  disconnect() { W.connected.delete(this); }
}
class Source extends Node {
  constructor(kind) { super(kind); this.onended = null; this._started = false; this._t1 = Infinity; }
  start(when, offset) {
    if (when === undefined) when = W.now;
    if (this._started) bad(this.kind + ' started twice');
    if (!fin(when) || when < W.now - 0.001) bad(this.kind + '.start in the past: ' + when + ' now=' + W.now);
    if (this.kind === 'buffer') {
      if (!this.buffer) bad('buffer source started without a buffer');
      if (offset !== undefined && (!fin(offset) || offset < 0 || offset > this.buffer.duration)) bad('bad buffer offset ' + offset);
      if (!this.loop) this._t1 = when + (this.buffer.duration - (offset || 0)) / this.playbackRate.value;
      if (W.starts) W.starts.push([when, this.buffer]);
    }
    this._started = true; this._t0 = when; W.liveSrc.add(this);
  }
  stop(when) {
    if (!this._started) bad(this.kind + '.stop before start');
    if (when === undefined) when = W.now;
    if (!fin(when) || when < W.now - 0.001) bad(this.kind + '.stop in the past: ' + when);
    this._t1 = Math.min(this._t1, Math.max(when, this._t0));
  }
}
const OSC_TYPES = { sine: 1, square: 1, sawtooth: 1, triangle: 1 };
const BQ_TYPES = { lowpass: 1, highpass: 1, bandpass: 1, lowshelf: 1, highshelf: 1, peaking: 1, notch: 1, allpass: 1 };
class Ctx {
  constructor() { W.ctxs++; W.ctx = this; this.sampleRate = 44100; this.state = 'suspended'; this.destination = new Node('destination'); }
  get currentTime() { return W.now; }
  resume() { if (!W.lockResume) this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  createGain() { const n = new Node('gain'); n.gain = new Param(1, 'gain.gain'); return n; }
  createOscillator() {
    const n = new Source('osc'); let ty = 'sine';
    n.frequency = new Param(440, 'osc.frequency', -22050, 22050); n.detune = new Param(0, 'osc.detune');
    Object.defineProperty(n, 'type', { get() { return ty; }, set(v) { if (!OSC_TYPES[v]) bad('bad osc type ' + v); ty = v; } });
    n.setPeriodicWave = function (w) { if (!w || !w._pw) bad('bad periodic wave'); ty = 'custom'; };
    return n;
  }
  createBufferSource() {
    const n = new Source('buffer');
    n.buffer = null; n.loop = false; n.playbackRate = new Param(1, 'buffer.playbackRate', 0.01, 64); n.detune = new Param(0, 'buffer.detune');
    return n;
  }
  createBiquadFilter() {
    const n = new Node('biquad'); let ty = 'lowpass';
    n.frequency = new Param(350, 'biquad.frequency', 1, 22050); n.Q = new Param(1, 'biquad.Q', -100, 100);
    n.gain = new Param(0, 'biquad.gain'); n.detune = new Param(0, 'biquad.detune');
    Object.defineProperty(n, 'type', { get() { return ty; }, set(v) { if (!BQ_TYPES[v]) bad('bad biquad type ' + v); ty = v; } });
    return n;
  }
  createConvolver() { const n = new Node('convolver'); n.buffer = null; n.normalize = true; return n; }
  createDynamicsCompressor() {
    const n = new Node('compressor');
    n.threshold = new Param(-24, 'comp.threshold', -100, 0); n.knee = new Param(30, 'comp.knee', 0, 40);
    n.ratio = new Param(12, 'comp.ratio', 1, 20); n.attack = new Param(0.003, 'comp.attack', 0, 1); n.release = new Param(0.25, 'comp.release', 0, 1);
    return n;
  }
  createWaveShaper() {
    const n = new Node('shaper'); let c = null;
    Object.defineProperty(n, 'curve', { get() { return c; }, set(v) { if (!(v instanceof Float32Array)) bad('curve not Float32Array'); c = v; W.curves.push(v); } });
    n.oversample = 'none'; return n;
  }
  createStereoPanner() { const n = new Node('panner'); n.pan = new Param(0, 'panner.pan', -1, 1); return n; }
  createDelay(max) { const n = new Node('delay'); n.delayTime = new Param(0, 'delay.delayTime', 0, max || 1); return n; }
  createBuffer(ch, len, sr) {
    if (!(ch >= 1) || !Number.isInteger(len) || len < 1 || !fin(sr)) bad('createBuffer(' + ch + ',' + len + ',' + sr + ')');
    const data = []; for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
    const b = { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData(c) { return data[c]; } };
    W.buffers.push(b); return b;
  }
  createPeriodicWave(re, im) { if (re.length !== im.length) bad('periodic wave arrays differ'); return { _pw: true }; }
}

function advance(dt) {
  if (W.ctx && W.ctx.state !== 'running') return;
  W.now += dt;
  for (const s of Array.from(W.liveSrc)) {
    if (s._t1 <= W.now) {
      W.liveSrc.delete(s);
      if (s.onended) { try { s.onended.call(s, { type: 'ended' }); } catch (e) { W.errors.push('onended threw: ' + e.message); } }
    }
  }
}
function step(dt) { advance(dt); for (const fn of Array.from(timers.values())) fn(); }
function run(sec, dt, each) {
  dt = dt || 0.05;
  const n = Math.round(sec / dt);
  for (let i = 0; i < n; i++) { step(dt); if (each) each(i, i * dt); }
}

const swallowed = [];
function load(opts) {
  opts = opts || {};
  world(); timers.clear();
  delete globalThis.RIVAL; delete require.cache[require.resolve(FILE)];
  if (opts.noAC) { delete globalThis.AudioContext; delete globalThis.webkitAudioContext; }
  else if (opts.webkit) { delete globalThis.AudioContext; globalThis.webkitAudioContext = Ctx; }
  else globalThis.AudioContext = Ctx;
  globalThis.RIVAL = {};
  if (opts.save) globalThis.RIVAL.Save = opts.save;
  require(FILE);
  const A = globalThis.RIVAL.Audio;
  A.onerror = function (e) { swallowed.push((e && e.stack) || String(e)); };
  return A;
}
function clean(label) {
  ok(W.errors.length === 0, label + ': mock violations: ' + W.errors.slice(0, 3).join(' | '));
  ok(swallowed.length === 0, label + ': swallowed exceptions: ' + swallowed.slice(0, 2).join(' | '));
  W.errors.length = 0; swallowed.length = 0;
}

const SFX = ['whoosh_s', 'whoosh_f', 'guard_up', 'hit', 'clang', 'clash_s', 'clash_g', 'clash_f', 'guard_break', 'seal', 'crack', 'tick',
  'select', 'back', 'heal', 'boon', 'rival_draft', 'deathblow', 'final_blow', 'you_died', 'phase2', 'bell', 'type', 'unlock', 'step', 'ember'];
const CUES = ['title', 'drone', 'bonfire', 'boss', 'boss2', 'death', 'credits'];
const API = ['init', 'setMuted', 'suspend', 'resume', 'sfx', 'music', 'heartbeat'];
function pokeAll(A) {
  A.setMuted(true); A.setMuted(false); A.suspend(); A.resume();
  SFX.forEach(function (n) { A.sfx(n); A.sfx(n, { pitch: 2, vol: 0.5 }); });
  A.sfx('nope'); A.sfx(); A.sfx(null, null); A.sfx('constructor'); A.sfx({}, 3);
  A.music('boss', 1); A.music('nope'); A.music(null); A.music(); A.heartbeat(100); A.heartbeat(0); A.heartbeat(NaN); A.heartbeat('x');
}

// ================================================================== 0. no Web Audio at all
section('0. no AudioContext');
(function () {
  const A = load({ noAC: true });
  let threw = null;
  try { pokeAll(A); A.init(); A.init(); pokeAll(A); } catch (e) { threw = e; }
  ok(!threw, 'throws without AudioContext: ' + threw);
  ok(API.every(function (k) { return typeof A[k] === 'function'; }), 'API incomplete');
  ok(A.ready === false && W.created === 0, 'did something without AudioContext');
  clean('no AC');
})();

// ================================================================== 1. before init / init / mute from save
section('1. before init, init, unlock, mute');
(function () {
  let A = load({ webkit: true, save: { data: { settings: { muted: true } } } }), threw = null;
  try { pokeAll(A); } catch (e) { threw = e; }
  ok(!threw, 'throws before init: ' + threw);
  ok(W.created === 0 && W.ctxs === 0 && timers.size === 0, 'created nodes / context / timers before init');
  A = load({ webkit: true, save: { data: { settings: { muted: true } } } });
  A.music('title');
  A.init();
  ok(A.ready === true && W.ctxs === 1, 'init did not create exactly one context (webkit prefix)');
  ok(A.muted === true, 'initial mute not read from R.Save');
  ok(W.ctx.state === 'running', 'context not resumed by init');
  ok(A._dbg().cue === 'title', 'cue requested before init did not start at init');
  const n0 = W.created; A.sfx('clang'); A.sfx('type');
  ok(W.created === n0, 'muted sfx still built nodes');
  A.init(); A.init();
  ok(W.ctxs === 1, 'init not idempotent');
  A.setMuted(false); A.sfx('clang');
  ok(W.created > n0 && A.muted === false, 'unmute did not restore sfx');
  run(3);
  clean('init');
  W.buffers.forEach(function (b, i) {
    let pk = 0, good = true;
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let k = 0; k < d.length; k++) { if (!fin(d[k])) good = false; if (Math.abs(d[k]) > pk) pk = Math.abs(d[k]); } }
    ok(good, 'buffer ' + i + ' has non-finite samples');
    ok(b.length === 1 || (pk > 0.05 && pk < 4), 'buffer ' + i + ' (' + b.duration.toFixed(2) + ' s) peak ' + pk.toFixed(3));
  });
  console.log('    generated buffers: ' + W.buffers.map(function (b) { return b.duration.toFixed(2) + 's'; }).join(', '));

  // a context that refuses to resume must not queue a burst
  A = load(); W.lockResume = true; A.init();
  for (let i = 0; i < 50; i++) A.sfx(SFX[i % SFX.length]);
  ok(A._dbg().live <= 3, 'locked context queued ' + A._dbg().live + ' voices');
  W.lockResume = false; A.sfx('tick'); run(6);
  ok(A._dbg().live === 0 && W.liveSrc.size === 0, 'voices stuck after unlock');
  clean('locked context');
})();

// ================================================================== 2. every SFX
section('2. every SFX at pitch 0.5 / 1 / 2 (nodes, sources, length)');
const A = load();
A.init(); run(0.3);
const BASE = W.connected.size;
ok(W.liveSrc.size === 0, 'sources alive after init: ' + W.liveSrc.size);
console.log('    persistent graph: ' + BASE + ' connected nodes, ' + W.created + ' created at init');
(function () {
  const rows = [];
  SFX.forEach(function (name) {
    [0.5, 1, 2].forEach(function (p) {
      const c0 = W.created, t0 = W.now; let srcs = 0, len = 0;
      A.sfx(name, { pitch: p });
      srcs = W.liveSrc.size;
      ok(srcs > 0, name + ' @' + p + ' made no sound');
      for (let i = 0; i < 160 && W.liveSrc.size; i++) { step(0.05); len = W.now - t0; }
      ok(W.liveSrc.size === 0 && W.connected.size === BASE && A._dbg().live === 0 && A._dbg().type === 0,
        name + ' @' + p + ' leaked: src ' + W.liveSrc.size + ' connected +' + (W.connected.size - BASE) + ' live ' + A._dbg().live);
      if (p === 1) rows.push(pad(name, 12) + pad(W.created - c0, 4) + pad(srcs, 4) + len.toFixed(2) + 's');
    });
  });
  for (let i = 0; i < rows.length; i += 3) console.log('    ' + rows.slice(i, i + 3).map(function (r) { return pad(r, 30); }).join(''));
  // odd options, unknown names
  const c1 = W.created;
  ['nope', '', 'constructor', '__proto__', 'toString'].forEach(function (n) { A.sfx(n); A.sfx(n, { pitch: 2 }); });
  A.sfx(); A.sfx(null); A.sfx(42); A.sfx({});
  ok(W.created === c1, 'unknown sfx names built nodes');
  SFX.forEach(function (n) {
    [{ pitch: NaN }, { pitch: Infinity, vol: -1 }, { pitch: 0, vol: 0 }, { pitch: -3 }, { pitch: '2', vol: 'x' }, { vol: 1e9, pitch: 1e9 }, null, 7, 'x',
      { n: 3 }, { rarity: 'rare' }, { n: 99 }].forEach(function (o) { A.sfx(n, o); });
    run(0.2);
  });
  run(8);
  ok(W.liveSrc.size === 0 && W.connected.size === BASE, 'leak after odd options');
  // pile-up: polyphony cap
  let peak = 0;
  for (let i = 0; i < 300; i++) { A.sfx(SFX[i % SFX.length], { pitch: 0.5 + (i % 7) * 0.25 }); peak = Math.max(peak, A._dbg().live); }
  console.log('    300 sfx in one frame -> peak live voices ' + peak + ', sources ' + W.liveSrc.size);
  ok(peak <= 36, 'polyphony cap exceeded: ' + peak);
  run(8);
  ok(W.liveSrc.size === 0 && W.connected.size === BASE && A._dbg().live === 0, 'leak after pile-up');
  clean('sfx');
})();

// ================================================================== 3. music
section('3. music: 120 s per cue, cross-fades, heartbeat, suspend/resume');
function pcs(list) {            // pitch classes relative to D, counting only values within 6 cents of a tempered pitch
  const set = {};
  list.forEach(function (f) { if (!(f > 20)) return; const x = 12 * Math.log2(f / 293.66), r = Math.round(x); if (Math.abs(x - r) < 0.06) set[((r % 12) + 12) % 12] = 1; });
  return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
}
// boss2's lead is doubled a tritone below, so its allowed set is D Locrian plus D Locrian transposed by 6
const SCALE = { boss: [0, 1, 3, 5, 7, 8, 10], boss2: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], credits: [0, 2, 3, 4, 5, 7, 9, 10] };
const NAT = [0, 1, 2, 3, 5, 7, 8, 10];
const stats = {};
(function () {
  let hbBuf = null;
  CUES.forEach(function (name, ci) {
    W.freqs = []; W.targets = []; W.starts = [];
    const c0 = W.created, e0 = W.events; let peakSrc = 0, peakConn = 0, mid = 0, t0 = W.now, susp = 0, sfxN = 0, sfxE = 0;
    A.music(name, ci % 2 ? 1 : 0.3);
    ok(A._dbg().cue === name, name + ' did not start');
    const n1 = W.created; A.music(name, 1);
    ok(W.created === n1, 'music(' + name + ') while already playing rebuilt the cue');
    const built = W.freqs; W.freqs = null;                 // the old cue is still fading: do not log its notes
    run(120, 0.05, function (i, t) {
      if (i === 30) W.freqs = built;
      if (A._dbg().live === 0) {                           // the cue's own voices, not the sfx played over it
        if (W.liveSrc.size > peakSrc) peakSrc = W.liveSrc.size;
        if (W.connected.size > peakConn) peakConn = W.connected.size;
      }
      if (i === 400) A.heartbeat(66);
      if (i === 700) A.heartbeat(100);
      if (i === 900) A.heartbeat(0);
      if (i === 1000) {                                    // tab hidden for a while
        A.suspend(); const tn = W.now, cr = W.created;
        for (let k = 0; k < 100; k++) step(0.05);
        A.sfx('clang'); A.heartbeat(80); A.heartbeat(0);
        ok(W.now === tn && timers.size === 0, name + ': clock/scheduler ran while suspended');
        ok(W.created === cr, name + ': built nodes while suspended');
        A.resume(); susp++;
        ok(W.ctx.state === 'running' && timers.size === 1 && A._dbg().cue === name, name + ': did not resume');
      }
      if (i === 1200) mid = W.connected.size;
      if (i % 97 === 0) {                                  // sfx over the music, kept out of the cue's own statistics
        const fq = W.freqs, cn = W.created, en = W.events; W.freqs = null;
        A.sfx(SFX[(i / 97) % SFX.length | 0]);
        W.freqs = fq; sfxN += W.created - cn; sfxE += W.events - en;
      }
    });
    const p = pcs(W.freqs), bars = W.targets.length, pp = pcs(W.targets);   // pp: pad chord tones
    stats[name] = { peakSrc: peakSrc, perMin: (W.created - c0 - sfxN) / 2, evMin: (W.events - e0 - sfxE) / 2, pcs: p, steady: W.connected.size - mid };
    ok(Math.abs(W.now - t0 - 120) < 0.01, name + ': clock');
    ok(Math.abs(W.connected.size - mid) < 40, name + ': connected nodes drift ' + mid + ' -> ' + W.connected.size);
    const allowed = SCALE[name] || NAT;
    ok(p.every(function (x) { return allowed.indexOf(x) >= 0; }), name + ': out-of-scale pitch classes ' + p.join(','));
    if (name === 'boss') { ok(p.indexOf(7) >= 0 && p.indexOf(1) >= 0 && pp.indexOf(7) >= 0 && pp.indexOf(4) < 0 && pp.indexOf(6) < 0, 'boss pad/lead not D Phrygian: ' + pp.join(',')); ok(Math.abs(bars / 6 - 48) <= 1, 'boss tempo: ' + bars / 6 + ' bars in 120 s (want 48 = 96 bpm)'); }
    if (name === 'boss2') { ok(pp.indexOf(6) >= 0 && pp.indexOf(7) < 0 && pp.indexOf(4) < 0, 'boss2 pad is not Locrian (Ab, no A): ' + pp.join(',')); ok(Math.abs(bars / 6 - 66) <= 1, 'boss2 tempo: ' + bars / 6 + ' bars (want 66 = 132 bpm)'); }
    if (name === 'credits') { ok(pp.indexOf(4) >= 0 && p.indexOf(4) >= 0, 'credits never reaches F sharp (D major)'); ok(Math.abs(bars / 4 - 33) <= 1, 'credits tempo: ' + bars / 4 + ' bars (want 33 = 66 bpm)'); }
    if (name !== 'credits' && name !== 'boss2') ok(p.indexOf(4) < 0, name + ' contains a major third (F sharp)');
    if (!hbBuf) { const h = W.starts.filter(function (s) { return Math.abs(s[1].duration - 0.34) < 0.01; }); ok(h.length > 20, name + ': heartbeat did not play (' + h.length + ')'); hbBuf = h.length ? h[0][1] : null; }
    console.log('    ' + pad(name, 8) + ' peak sources ' + pad(peakSrc, 4) + ' peak connected ' + pad(peakConn, 4) + ' nodes/min ' + pad(stats[name].perMin, 7) +
      ' param events/min ' + pad(Math.round(stats[name].evMin), 6) + ' pitch classes [' + p.join(' ') + ']' + (pp.length ? ' pad [' + pp.join(' ') + ']' : ''));
    clean(name);
  });
  // heartbeat timing, across a music change
  W.starts = []; A.heartbeat(66); const tA = W.now;
  run(10); A.music('drone', 0.5); run(10); const tB = W.now; A.heartbeat(100); run(12); A.music('boss', 0.5); A.heartbeat(0); run(3);
  const beats = W.starts.filter(function (s) { return s[1] === hbBuf; }).map(function (s) { return s[0]; });
  const slow = beats.filter(function (t) { return t < tB; }).length, fast = beats.length - slow;
  let gapMin = 9, gapMax = 0;
  for (let i = 1; i < beats.length; i++) { gapMin = Math.min(gapMin, beats[i] - beats[i - 1]); gapMax = Math.max(gapMax, beats[i] - beats[i - 1]); }
  console.log('    heartbeat: ' + slow + ' beats in 20 s at 66, ' + fast + ' in 12 s at 100, gaps ' + gapMin.toFixed(3) + '..' + gapMax.toFixed(3) + ' s');
  ok(Math.abs(slow - 22) <= 1 && Math.abs(fast - 20) <= 1, 'heartbeat counts ' + slow + '/' + fast);
  ok(gapMin > 0.59 && gapMax < 0.92, 'heartbeat retime not smooth');
  ok(beats.length && beats[beats.length - 1] <= tB + 12.2 && beats[0] - tA < 0.1, 'heartbeat start/stop');
  // rapid switching and starved timers
  for (let i = 0; i < 60; i++) { A.music(i % 5 === 4 ? null : CUES[i % CUES.length], i % 3 ? 0.1 : 2); step(0.03 + (i % 4) * 0.05); }
  ok(A._dbg().dying <= 3, 'dying cues pile up');
  A.music('boss2', 0.3); A.heartbeat(100);
  for (let i = 0; i < 300; i++) step(i % 9 === 0 ? 1.7 : i % 5 === 0 ? 0.31 : 0.016);
  clean('stress');
  W.freqs = W.targets = W.starts = null;
  A.music(null, 1); A.heartbeat(0); A.setMuted(true); A.setMuted(false);
  run(15);
  ok(timers.size === 0, 'scheduler still running in silence');
  ok(W.liveSrc.size === 0, 'sources alive after music(null): ' + W.liveSrc.size);
  ok(W.connected.size === BASE, 'connected nodes ' + W.connected.size + ' != baseline ' + BASE + ' after everything stopped');
  ok(A._dbg().live === 0 && A._dbg().dying === 0, 'voices/cues left over');
  console.log('    after everything: ' + W.liveSrc.size + ' live sources, connected ' + W.connected.size + ' (baseline ' + BASE + '), out-of-order param events ' + W.ooo);
  clean('teardown');
})();

// ================================================================== 4. typewriter spam
section('4. two minutes of `type` at 18 Hz');
(function () {
  const c0 = W.created; let peakSrc = 0, peakConn = 0;
  A.music('drone', 0.2); run(2);
  const b = W.connected.size, s0 = W.liveSrc.size;
  run(120, 1 / 18, function (i) {
    A.sfx('type', i % 40 < 20 ? undefined : { pitch: 0.5 });
    peakSrc = Math.max(peakSrc, W.liveSrc.size - s0); peakConn = Math.max(peakConn, W.connected.size - b);
  });
  console.log('    peak extra sources ' + peakSrc + ', peak extra connected nodes ' + peakConn + ', nodes created ' + (W.created - c0) + ' (' + ((W.created - c0) / 2160).toFixed(2) + ' per blip incl. drone bells)');
  ok(peakSrc <= 12 && peakConn <= 24, 'type spam not bounded');
  A.music(null, 0.2); run(8);
  ok(W.liveSrc.size === 0 && W.connected.size === BASE, 'leak after type spam');
  clean('type');
})();

const size = fs.statSync(FILE).size;
console.log('\naudio.js ' + (size / 1024).toFixed(1) + ' KB; boss creates ' + stats.boss.perMin + ' nodes/min, boss2 ' + stats.boss2.perMin + ' nodes/min');
ok(size < 48 * 1024, 'audio.js is ' + size + ' bytes');
console.log(passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
