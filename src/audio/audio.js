// SHOW ME MY RIVAL — R.Audio. Every sound is synthesised at runtime with the Web Audio API; no assets.
// Chain: sfx voices -> 4 buses (fixed reverb-send levels) -> sfxBus ┐
//        music cue (dry fader + wet fader) -> music low-pass -> musBus ┴-> master -> limiter -> out
//        one shared convolver (generated 1.8 s dark impulse) is "the cathedral".
// Monophonic music parts (bass, lead, kick, snare, pad) are persistent oscillators driven by
// AudioParam automation, so a looping cue creates almost no nodes after it has started.
(function (R) {
  'use strict';

  var G = globalThis;
  var MASTER = 0.8, LOOK = 0.15, TICK = 50, MAXV = 24;
  var ctx = null, sr = 44100, ready = false, failed = false, muted = false, mutedSet = false, held = false;
  var master, sfxBus, musBus, musLP, musSendLP, revIn, typeBus, hbGain, B = [];
  var white, brown, typeBuf, type2Buf, hbBuf, crackBuf = null, pulse = null, curves = {};
  var live = 0, liveType = 0, timer = null;
  var cue = null, dying = [], want = null, hbWant = 0;
  var hbBpm = 0, hbNext = 0, hbLast = -9, duck = false;
  var E0 = {}, H = -99, X = -98;
  var D1 = 36.708, D2 = 73.416, D3 = 146.83, D4 = 293.66;

  // ------------------------------------------------------------------ helpers
  function num(x, d) { return typeof x === 'number' && isFinite(x) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function fq(f) { return clamp(f, 8, 18000); }
  function rnd() { return Math.random(); }
  function st(n) { return Math.pow(2, n / 12); }
  function now() { return ctx.currentTime; }
  function nop() {}
  function kill(n) { try { n.disconnect(); } catch (e) {} }
  function srcEnd() { kill(this); }
  function quiet(p) { if (p && p.catch) p.catch(nop); }
  function gainNode(v, dst) { var g = ctx.createGain(); g.gain.value = v; if (dst) g.connect(dst); return g; }
  function biq(type, f, q, dst) {
    var b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = fq(f); b.Q.value = q || 0.7;   // (low/high-pass Q is in dB)
    if (dst) b.connect(dst);
    return b;
  }
  function setType(o, type) {
    if (type !== 'pulse') o.type = type;
    else if (pulse) o.setPeriodicWave(pulse);
    else o.type = 'square';
  }
  // 0 -> pk over `a` (exponential when x), optional hold, exponential fall to silence at t + d
  function env(p, t, a, d, pk, hold, x) {
    if (pk < 0.0002) pk = 0.0002;
    p.setValueAtTime(0.0001, t);
    if (x) p.exponentialRampToValueAtTime(pk, t + a); else p.linearRampToValueAtTime(pk, t + a);
    if (hold) p.setValueAtTime(pk, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(d, a + (hold || 0) + 0.005));
  }

  // ------------------------------------------------------------------ voices
  // A voice owns its nodes and disconnects all of them when its last source ends.
  function voice(dst, vol, mus) {
    var v = { n: [], s: 0, o: mus ? dst : gainNode(vol, dst), m: mus, end: null };
    v.end = function () { if (--v.s <= 0 && v.n) vDone(v); };
    if (!mus) live++;
    return v;
  }
  function vDone(v) {
    for (var i = 0; i < v.n.length; i++) kill(v.n[i]);
    v.n = null;
    if (!v.m) { kill(v.o); live--; }
  }
  function track(v, s, t0, t1, off) {
    v.s++; v.n.push(s); s.onended = v.end;
    if (off === undefined) s.start(t0); else s.start(t0, off);
    s.stop(t1);
  }
  // o: { f1 glide target, gt glide time, a attack, s hold, x exp attack, c detune cents, d destination }
  function osc(v, type, f, t, dur, pk, o) {
    o = o || E0;
    var s = ctx.createOscillator(), g = ctx.createGain();
    setType(s, type);
    s.frequency.setValueAtTime(fq(f), t);
    if (o.f1) s.frequency.exponentialRampToValueAtTime(fq(o.f1), t + (o.gt || dur));
    if (o.c) s.detune.value = o.c;
    env(g.gain, t, o.a || 0.004, dur, pk, o.s, o.x);
    s.connect(g); g.connect(o.d || v.o); v.n.push(g);
    track(v, s, t, t + dur + 0.02);
    return s;
  }
  // o: { b brown, ft filter type, f, f1, gt, q, a, s, x, d }
  function noise(v, t, dur, pk, o) {
    var s = ctx.createBufferSource(), g = ctx.createGain(), len = dur + 0.03, fl = null;
    s.buffer = o.b ? brown : white;
    if (len > 1.8) s.loop = true;
    env(g.gain, t, o.a || 0.002, dur, pk, o.s, o.x);
    if (o.ft) {
      fl = biq(o.ft, o.f, o.q, g);
      if (o.f1) { fl.frequency.setValueAtTime(fq(o.f), t); fl.frequency.exponentialRampToValueAtTime(fq(o.f1), t + (o.gt || dur)); }
      s.connect(fl); v.n.push(fl);
    } else s.connect(g);
    g.connect(o.d || v.o); v.n.push(g);
    track(v, s, t, t + len, s.loop ? rnd() : rnd() * (1.9 - len));
    return fl;
  }
  // tremolo / ring-mod stage: returns the node to play into
  function trem(v, t, f, dur, depth, dst) {
    var g = gainNode(1 - depth, dst || v.o), l = ctx.createOscillator(), lg = gainNode(depth, g.gain);
    l.frequency.value = f; l.connect(lg); v.n.push(g, lg);
    track(v, l, t, t + dur);
    return g;
  }
  // steel: four inharmonic partials, each a square + triangle pair beating 12 cents apart
  var MP = [523, 784, 1178, 1661], MG = [1, 0.8, 0.65, 0.5];
  function metal(v, t, m, dur, pk, bend, dst) {
    var hp = biq('highpass', 300, 0.5, dst || v.o), i, f, d;
    v.n.push(hp);
    for (i = 0; i < 4; i++) {
      f = MP[i] * m; d = dur * (1 - i * 0.13);
      osc(v, 'square', f, t, d, pk * MG[i] * 0.13, { a: 0.005, c: -6, f1: bend ? f * bend : 0, gt: 0.3, d: hp });
      osc(v, 'triangle', f, t, d, pk * MG[i] * 0.3, { a: 0.005, c: 6, f1: bend ? f * bend : 0, gt: 0.3, d: hp });
    }
    osc(v, 'sine', 2637 * m, t, dur * 0.4, pk * 0.1, { d: hp });
    osc(v, 'sine', 3951 * m, t, dur * 0.3, pk * 0.07, { d: hp });
    noise(v, t, 0.012, pk * 0.5, { ft: 'highpass', f: 2500, d: hp });
  }
  // FM bell: sine carrier, modulator at 3.5x whose index collapses, plus the octave
  function fmBell(v, f, t, dur, pk, idx) {
    var c = osc(v, 'sine', f, t, dur, pk, { a: 0.003 }), m = ctx.createOscillator(), mg = ctx.createGain(), fm = fq(f * 3.5);
    m.frequency.value = fm;
    mg.gain.setValueAtTime(fm * idx, t);
    mg.gain.exponentialRampToValueAtTime(fm * 0.02, t + dur * 0.6);
    m.connect(mg); mg.connect(c.frequency); v.n.push(mg);
    track(v, m, t, t + dur + 0.02);
    osc(v, 'sine', f * 2, t, dur * 0.5, pk * 0.3, { a: 0.003 });
  }
  function laugh(v, t, p) {
    osc(v, 'triangle', 700 * p, t, 0.08, 0.9, { f1: 1100 * p, gt: 0.07 });
    osc(v, 'triangle', 1100 * p, t + 0.09, 0.09, 0.8, { f1: 700 * p, gt: 0.07 });
  }
  var CHIME = [880, 1174.66, 1396.91], RAR = { common: 1, uncommon: 2, rare: 3 };
  function chime(v, t, p, o) {
    var n = clamp((o.n || o.notes || RAR[o.rarity] || +o.rarity || 2) | 0, 1, 3), k, e;
    for (k = 0; k < n; k++) {
      for (e = 0; e < 3; e++) osc(v, 'triangle', CHIME[k] * p, t + k * 0.09 + e * 0.17, 0.5, 0.8 * Math.pow(0.3, e));
      osc(v, 'sine', CHIME[k] * p * 2, t + k * 0.09, 0.15, 0.15);
    }
    return n;
  }
  function lpTo(f, t, tc) { musLP.frequency.setTargetAtTime(f, t, tc); musSendLP.frequency.setTargetAtTime(f, t, tc); }

  // ------------------------------------------------------------------ SFX
  var S = Object.create(null), M = Object.create(null);
  function def(name, bus, trim, crit, fn) { S[name] = fn; M[name] = [bus, trim, crit]; }

  def('tick', 1, 0.13, 0, function (v, t, p) {
    osc(v, 'triangle', 880 * p, t, 0.04, 0.9);
    osc(v, 'square', 1760 * p, t, 0.014, 0.1);
  });
  def('select', 1, 0.16, 0, function (v, t, p) {
    osc(v, 'triangle', 660 * p, t, 0.06, 0.8); osc(v, 'square', 660 * p, t, 0.04, 0.1);
    osc(v, 'triangle', 990 * p, t + 0.045, 0.09, 0.8); osc(v, 'square', 990 * p, t + 0.045, 0.04, 0.1);
  });
  def('back', 1, 0.16, 0, function (v, t, p) {
    osc(v, 'triangle', 440 * p, t, 0.11, 0.8, { f1: 330 * p, gt: 0.07 });
    osc(v, 'square', 440 * p, t, 0.07, 0.1, { f1: 330 * p, gt: 0.07 });
  });
  def('seal', 1, 0.5, 0, function (v, t, p) {            // wax stamp
    noise(v, t, 0.04, 1.6, { ft: 'bandpass', f: 300 * p, q: 4 });
    osc(v, 'sine', 90 * p, t, 0.16, 1, { f1: 50 * p, gt: 0.12 });
    osc(v, 'triangle', 180 * p, t, 0.12, 0.3, { f1: 100 * p, gt: 0.1 });
  });
  def('crack', 2, 0.3, 0, function (v, t, p) {
    noise(v, t, 0.012, 1, { ft: 'highpass', f: 6000 * p });
    noise(v, t + 0.04, 0.012, 0.8, { ft: 'highpass', f: 6000 * p });
    noise(v, t + 0.09, 0.014, 1, { ft: 'highpass', f: 6000 * p });
    osc(v, 'sine', 2400 * p, t, 0.12, 0.35);
  });
  def('whoosh_s', 1, 0.34, 0, function (v, t, p) {
    noise(v, t, 0.16, 1.6, { ft: 'bandpass', f: 400 * p, f1: 2400 * p, gt: 0.14, q: 1.5, a: 0.02 });
  });
  def('whoosh_f', 1, 0.24, 0, function (v, t, p) {
    var d = v.o, fl;
    if (ctx.createStereoPanner) {                        // slight stereo wobble
      d = ctx.createStereoPanner(); d.connect(v.o); v.n.push(d);
      d.pan.setValueAtTime(-0.5, t); d.pan.linearRampToValueAtTime(0.5, t + 0.09); d.pan.linearRampToValueAtTime(-0.3, t + 0.2);
    }
    fl = noise(v, t, 0.21, 1.4, { ft: 'bandpass', f: 2000 * p, f1: 500 * p, gt: 0.09, q: 1.8, a: 0.025, d: d });
    fl.frequency.exponentialRampToValueAtTime(fq(1800 * p), t + 0.18);
  });
  def('guard_up', 1, 0.36, 0, function (v, t, p) {
    osc(v, 'triangle', 147 * p, t, 0.16, 0.9, { a: 0.01 });
    osc(v, 'triangle', 294 * p, t, 0.12, 0.3, { a: 0.01 });
    noise(v, t, 0.11, 0.8, { b: 1, ft: 'lowpass', f: 600 * p, a: 0.01 });
  });
  def('hit', 1, 0.5, 1, function (v, t, p) {
    osc(v, 'sine', 120 * p, t, 0.16, 1, { f1: 45 * p, gt: 0.12, a: 0.002 });
    osc(v, 'triangle', 240 * p, t, 0.11, 0.4, { f1: 90 * p, gt: 0.09, a: 0.002 });
    noise(v, t, 0.09, 0.8, { ft: 'lowpass', f: 800 * p });
  });
  def('clang', 2, 0.44, 1, function (v, t, p) { metal(v, t, p, 0.55, 1); });
  def('clash_s', 2, 0.38, 0, function (v, t, p) {        // bind: two strikes, the second shimmering
    metal(v, t, 0.8 * p, 0.3, 0.8);
    metal(v, t + 0.06, 0.8 * p, 0.7, 0.9, 0, trem(v, t, 30, 0.85, 0.5));
  });
  def('clash_g', 1, 0.4, 0, function (v, t, p) {         // standoff: no transient
    osc(v, 'triangle', 98 * p, t, 0.3, 1, { a: 0.03 });
    osc(v, 'triangle', 196 * p, t, 0.24, 0.35, { a: 0.03 });
    noise(v, t, 0.22, 0.8, { b: 1, ft: 'lowpass', f: 600 * p, a: 0.03 });
  });
  def('clash_f', 2, 0.22, 0, function (v, t, p) { laugh(v, t, p); });
  def('guard_break', 2, 0.5, 1, function (v, t, p) {
    metal(v, t, p, 0.6, 1, 0.7);
    noise(v, t, 0.45, 1.1, { ft: 'lowpass', f: 3000 * p, f1: 500 * p, gt: 0.4, a: 0.004 });
    osc(v, 'sine', 55 * p, t, 0.5, 1, { f1: 38 * p, gt: 0.4 });
    osc(v, 'triangle', 110 * p, t, 0.35, 0.5, { f1: 76 * p, gt: 0.3 });
  });
  def('bell', 3, 0.3, 1, function (v, t, p) { fmBell(v, 392 * p, t, 0.45, 0.8, 2); });
  def('deathblow', 2, 0.5, 1, function (v, t, p) {       // inhale, then the stab
    var lp = biq('lowpass', 240 * p, 3, v.o), t2 = t + 0.6;
    v.n.push(lp);
    noise(v, t, 0.64, 1.2, { ft: 'bandpass', f: 300 * p, f1: 1600 * p, gt: 0.6, q: 0.8, a: 0.6, x: 1 });
    osc(v, 'sawtooth', 49 * p, t2, 0.8, 1, { a: 0.005, d: lp });
    osc(v, 'sawtooth', 98 * p, t2, 0.6, 0.5, { a: 0.005, d: lp });
    osc(v, 'triangle', 98 * p, t2, 0.5, 0.3, { a: 0.005 });
  });
  // Fired on contact, so the recipe's pre-swell cannot lead it: the music drops under a 400 Hz
  // low-pass at the blow and the noise becomes the air rushing back in afterwards.
  def('final_blow', 1, 0.6, 1, function (v, t, p) {
    lpTo(400, t, 0.015); lpTo(18000, t + 1, 0.4);
    metal(v, t, 0.75 * p, 1.5, 1);
    metal(v, t, 1.5 * p, 0.6, 0.45);
    noise(v, t, 0.03, 1.2, { ft: 'highpass', f: 1500 });
    noise(v, t + 0.02, 0.9, 0.35, { ft: 'bandpass', f: 2400 * p, f1: 500 * p, gt: 0.8, q: 0.7, a: 0.03 });
    osc(v, 'sine', 80 * p, t, 0.9, 1, { f1: 40 * p, gt: 0.5 });
    osc(v, 'triangle', 160 * p, t, 0.6, 0.4, { f1: 80 * p, gt: 0.5 });
  });
  def('heal', 3, 0.24, 0, function (v, t, p) {
    osc(v, 'sine', 293.66 * p, t, 0.5, 0.35, { a: 0.08 });
    osc(v, 'sine', 440 * p, t, 0.5, 0.25, { a: 0.08 });
    osc(v, 'triangle', 587.33 * p, t, 0.3, 0.7);
    osc(v, 'triangle', 698.46 * p, t + 0.06, 0.3, 0.7);
    osc(v, 'triangle', 880 * p, t + 0.12, 0.4, 0.7);
  });
  def('boon', 3, 0.22, 0, function (v, t, p, o) { chime(v, t, p, o); });
  def('rival_draft', 3, 0.22, 0, function (v, t, p, o) {
    laugh(v, t + 0.3 + 0.09 * chime(v, t, p * 0.7071, o), p * 0.8);
  });
  def('you_died', 3, 0.4, 1, function (v, t, p) {
    var lp = biq('lowpass', 600 * p, 1, v.o);
    v.n.push(lp);
    osc(v, 'sawtooth', 73.42 * p, t, 3.3, 0.5, { a: 0.3, s: 1, c: -5, d: lp });
    osc(v, 'sawtooth', 110 * p, t, 3.3, 0.4, { a: 0.3, s: 1, c: 4, d: lp });
    osc(v, 'sawtooth', 146.83 * p, t, 3.3, 0.4, { a: 0.3, s: 1, c: -3, d: lp });
    osc(v, 'sawtooth', 155.56 * p, t + 1, 2.3, 0.35, { a: 0.4, s: 0.2, d: lp });   // the E flat arrives late
  });
  def('phase2', 2, 0.5, 1, function (v, t, p) {
    var k, t2 = t + 0.5, bp = biq('bandpass', 200 * p, 8, trem(v, t2, 14, 1, 0.4));
    for (k = 0; k < 12; k++) osc(v, 'sine', (2000 + rnd() * 4000) * p, t + rnd() * 0.5, 0.03 + rnd() * 0.06, 0.2 + rnd() * 0.3, { a: 0.002 });
    noise(v, t, 0.6, 1, { ft: 'lowpass', f: 5000 * p, f1: 400 * p, gt: 0.5, a: 0.003 });
    osc(v, 'sine', 80 * p, t, 1, 1, { f1: 36 * p, gt: 0.6 });
    osc(v, 'triangle', 120 * p, t, 0.7, 0.4, { f1: 60 * p, gt: 0.5 });
    v.n.push(bp);                                         // what is under the mask
    bp.frequency.setValueAtTime(fq(200 * p), t2);
    bp.frequency.exponentialRampToValueAtTime(fq(3000 * p), t2 + 0.9);
    osc(v, 'sawtooth', 55 * p, t2, 0.95, 2, { a: 0.05, s: 0.6, d: bp });
    osc(v, 'sawtooth', 110.6 * p, t2, 0.95, 1.2, { a: 0.05, s: 0.6, d: bp });
  });
  def('unlock', 3, 0.22, 0, function (v, t, p) {
    var f = [293.66, 440, 587.33, 698.46], k;
    for (k = 0; k < 4; k++) osc(v, 'triangle', f[k] * p, t + k * 0.1, k === 3 ? 0.5 : 0.25, 0.7);
    noise(v, t, 0.5, 0.25, { ft: 'highpass', f: 5000, a: 0.12 });
  });
  def('step', 1, 0.32, 0, function (v, t, p) {
    noise(v, t, 0.05, 0.9, { b: 1, ft: 'lowpass', f: 500 * p });
    osc(v, 'sine', 70 * p, t, 0.05, 0.9);
    osc(v, 'triangle', 140 * p, t, 0.04, 0.35);
  });
  def('ember', 1, 0.14, 0, function (v, t, p) {
    noise(v, t, 0.01 + rnd() * 0.03, 0.4 + rnd() * 1.2, { ft: 'bandpass', f: (1000 + rnd() * 3000) * p, q: 2 });
  });
  M.type = [0, 1, 0];

  // typewriter blip: one pre-rendered buffer source per blip, nothing else
  function typeEnd() { liveType--; kill(this); }
  function typeBlip(t, p, vol) {
    if (liveType >= 4) return;
    var s = ctx.createBufferSource(), low = p < 0.75, g;
    s.buffer = low ? type2Buf : typeBuf;
    s.playbackRate.value = clamp((low ? p * 2 : p) * (0.88 + rnd() * 0.24), 0.1, 8);
    if (vol === 1) { s.connect(typeBus); s.onended = typeEnd; }
    else { g = gainNode(vol, typeBus); s.connect(g); s.onended = function () { liveType--; kill(s); kill(g); }; }
    liveType++;
    s.start(t); s.stop(t + 0.5);
  }

  function sfx(name, opts) {
    if (!ready || muted || held) return;
    var m = M[name], p, vol, v, t;
    if (!m) return;
    wake();
    if (ctx.state && ctx.state !== 'running' && live >= 3) return;   // do not queue a burst behind a locked context
    opts = opts && typeof opts === 'object' ? opts : E0;
    p = clamp(num(opts.pitch, 1), 0.1, 8); vol = clamp(num(opts.vol, 1), 0, 4); t = now();
    if (name === 'type') { typeBlip(t, p, vol); return; }
    if (live >= (m[2] ? MAXV + 12 : MAXV)) return;
    v = voice(B[m[0]], vol * m[1]);
    try { S[name](v, t, p, opts); } catch (e) { if (!v.s && v.n) vDone(v); oops(e); }
  }

  // ------------------------------------------------------------------ generated buffers
  function mkNoise() {
    var n = sr * 2 | 0, i, b = 0, mx = 0, w, d, dr;
    white = ctx.createBuffer(1, n, sr); brown = ctx.createBuffer(1, n, sr);
    w = white.getChannelData(0); d = brown.getChannelData(0);
    for (i = 0; i < n; i++) { w[i] = rnd() * 2 - 1; b = (b + 0.02 * w[i]) / 1.02; d[i] = b; }
    dr = (d[n - 1] - d[0]) / n;                            // remove drift so the loop seam does not click
    for (i = 0; i < n; i++) { d[i] -= dr * i; if (Math.abs(d[i]) > mx) mx = Math.abs(d[i]); }
    for (i = 0; i < n; i++) d[i] *= 0.9 / (mx || 1);
  }
  function mkImpulse() {
    var n = sr * 1.8 | 0, b = ctx.createBuffer(2, n, sr), c, i, k, d, lp, x;
    for (c = 0; c < 2; c++) {
      d = b.getChannelData(c); lp = 0;
      for (i = 0; i < n; i++) {
        x = i / n;
        lp += (rnd() * 2 - 1 - lp) * (0.6 - 0.5 * x);     // the tail darkens as it dies
        d[i] = lp * Math.pow(1 - x, 2.6) * (i < 200 ? i / 200 : 1);
      }
      for (k = 0; k < 6; k++) d[(0.004 + rnd() * 0.07) * sr | 0] += (rnd() < 0.5 ? -1 : 1) * (0.7 - k * 0.08);   // early slaps off stone
    }
    return b;
  }
  function mkType(f, len, ring) {
    var n = sr * len | 0, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), i, t, x, lp = 0;
    for (i = 0; i < n; i++) {
      t = i / sr;
      x = ring ? (2 * ((t * f) % 1) - 1) * Math.sin(6.2832 * 30 * t + 1) : ((t * f) % 1 < 0.5 ? 1 : -1);
      lp += (x - lp) * 0.3;
      d[i] = lp * Math.min(1, i / 40) * Math.exp(-t / (len * 0.3)) * Math.min(1, (n - i) / 40);
    }
    return b;
  }
  function mkHeart() {
    var n = sr * 0.34 | 0, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), k, i, t, ph, off, m;
    for (k = 0; k < 2; k++) {                              // lub, then a softer dub 140 ms later
      off = k * 0.14 * sr | 0; ph = 0; m = sr * 0.2 | 0;
      for (i = 0; i < m && off + i < n; i++) {
        t = i / sr;
        ph += 6.2832 * Math.max(38, (k ? 64 : 60) * Math.pow(0.667, t / 0.07)) / sr;
        d[off + i] += (k ? 0.42 : 0.6) * Math.min(1, t / 0.004) * Math.exp(-t / 0.035) * Math.min(1, (m - i) / 60) *
          (Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph));   // harmonics: phone speakers have no 50 Hz
      }
    }
    return b;
  }
  function mkCrackle() {                                   // 5.3 s of fire: about 9 crackles a second
    var n = sr * 5.3 | 0, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), k, i, pos, len, a, c, amp, l1, l2;
    for (k = 0; k < 48; k++) {
      len = (0.008 + rnd() * 0.03) * sr | 0; pos = rnd() * (n - len - 1) | 0;
      a = 1 - Math.exp(-6.2832 * (1000 + rnd() * 3000) / sr); c = a * 0.35;
      amp = (0.15 + rnd() * rnd() * 0.85) * 2.5; l1 = l2 = 0;
      for (i = 0; i < len; i++) {
        l1 += (rnd() * 2 - 1 - l1) * a; l2 += (l1 - l2) * c;
        d[pos + i] += (l1 - l2) * amp * Math.exp(-i / (len * 0.25));
      }
    }
    return b;
  }
  function mkPulse() {                                     // 25 % duty, band-limited
    if (!ctx.createPeriodicWave) return null;
    var n = 24, re = new Float32Array(n), im = new Float32Array(n), k;
    for (k = 1; k < n; k++) re[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * 0.25);
    return ctx.createPeriodicWave(re, im);
  }
  function curve(k) {
    if (curves[k]) return curves[k];
    var c = new Float32Array(1024), i, th = (Math.exp(k) - Math.exp(-k)) / (Math.exp(k) + Math.exp(-k)), e;
    for (i = 0; i < 1024; i++) { e = Math.exp(2 * k * (i / 511.5 - 1)); c[i] = (e - 1) / (e + 1) / th; }
    return (curves[k] = c);
  }

  // ------------------------------------------------------------------ music: cue plumbing
  function newCue(name) { return { name: name, n: [], src: [], seq: [], killAt: 0, out: gainNode(0, musLP), send: gainNode(0, musSendLP) }; }
  function cg(c, val, dst) { var g = gainNode(val, dst); c.n.push(g); return g; }
  function cf(c, type, f, q, dst) { var b = biq(type, f, q, dst); c.n.push(b); return b; }
  function cbus(c, lvl, snd) { var g = cg(c, lvl, c.out); if (snd) g.connect(cg(c, snd, c.send)); return g; }
  function cosc(c, type, f, cents, lvl, dst) {
    var o = ctx.createOscillator();
    setType(o, type); o.frequency.value = f; if (cents) o.detune.value = cents;
    o.connect(cg(c, lvl, dst)); o.start(now());
    c.src.push(o); c.n.push(o);
    return o;
  }
  function cnoise(c, buf, dst) {
    var s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.connect(dst); s.start(now(), rnd() * 1.5);
    c.src.push(s); c.n.push(s);
  }
  function clfo(c, f, depth, param) {
    var o = ctx.createOscillator(), g = cg(c, depth);
    o.frequency.value = f; o.connect(g); if (param) g.connect(param); o.start(now());
    c.src.push(o); c.n.push(o);
    return g;
  }
  function cseq(c, dur, t0, fn) { c.seq.push({ next: t0, step: 0, dur: dur, fn: fn }); }
  function grit(c, k, dst) {
    var pre = cg(c, 1.6), ws = ctx.createWaveShaper();
    ws.curve = curve(k); pre.connect(ws); ws.connect(dst); c.n.push(ws);
    return pre;
  }
  // monosynth: persistent oscillators (type, freq multiple, level triples) behind one envelope gain
  function mono(c, dst, spec) {
    var m = { g: cg(c, 0.0001, dst), o: [], k: [] }, i;
    for (i = 0; i < spec.length; i += 3) { m.o.push(cosc(c, spec[i], 110, 0, spec[i + 2], m.g)); m.k.push(spec[i + 1]); }
    return m;
  }
  function mnote(m, f, t, dur, pk, a, sus, f1, gt) {
    var g = m.g.gain, i, p;
    for (i = 0; i < m.o.length; i++) {
      p = m.o[i].frequency; p.setValueAtTime(fq(f * m.k[i]), t);
      if (f1) p.exponentialRampToValueAtTime(fq(f1 * m.k[i]), t + gt);
    }
    g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(pk, t + a);
    if (sus) g.exponentialRampToValueAtTime(pk * sus, t + dur * 0.6);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function dispose(c) {
    var i;
    for (i = 0; i < c.src.length; i++) { try { c.src[i].stop(); } catch (e) {} }
    for (i = 0; i < c.n.length; i++) kill(c.n[i]);
    kill(c.out); kill(c.send);
    c.src.length = c.n.length = c.seq.length = 0;
  }

  // ------------------------------------------------------------------ music: the cues
  var CUES = Object.create(null);

  // D + A saws under a slow low-pass, wind, and a lone bell somewhere in the nave
  function mkDrone(c, t, lvl, fixed, wind, bell) {
    var bus = cbus(c, lvl, 0.2), lp = cf(c, 'lowpass', fixed || 190, 1, bus), wg, bp, bb;
    cosc(c, 'sawtooth', D1, -4, 1, lp); cosc(c, 'sawtooth', D1 * 1.5, 4, 0.8, lp);
    cosc(c, 'sawtooth', D2, 3, 0.4, lp); cosc(c, 'sawtooth', D2 * 1.5, -3, 0.25, lp);
    cosc(c, 'sine', D3, 0, 0.07, bus); cosc(c, 'sine', D3 * 1.5 + 0.3, 0, 0.05, bus);   // a ghost fifth small speakers can carry
    if (!fixed) clfo(c, 0.07, 70, lp.frequency);
    if (wind) {
      wg = cg(c, 0.5, cbus(c, 0.5 * wind, 0.4)); bp = cf(c, 'bandpass', 400, 0.7, wg);
      cnoise(c, white, bp); clfo(c, 0.05, 0.3, wg.gain); clfo(c, 0.031, 130, bp.frequency);
    }
    if (bell) {
      bb = cbus(c, 0.2, 0.7);
      cseq(c, 0, t + 3 + rnd() * 3, function (i, tt) {
        fmBell(voice(bb, 0, 1), D4 * st([0, 3, 7][rnd() * 3 | 0]), tt, 3.5, 0.8, 1.4);
        return 6 + rnd() * 8;
      });
    }
  }
  CUES.drone = function (c, t) { mkDrone(c, t, 0.34, 0, 1, 1); };
  CUES.death = function (c, t) { mkDrone(c, t, 0.085, 150, 0.3, 0); };       // -12 dB, filter pinned, no bell

  var BOX = [12, 7, 3, 2, 0, X, 7, X, X, X, X, X, X, X, X, X, 12, 7, 3, 2, 0, X, 1, X, X, X, X, X, X, X, X, X];
  CUES.title = function (c, t) {
    var box = cbus(c, 0.22, 0.6);
    mkDrone(c, t, 0.3, 0, 1, 0);
    cseq(c, 1, t + 2.5, function (i, tt) {                 // music box, 60 bpm, 8 bars; the second answer sours to E flat
      var n = BOX[i & 31], v;
      if (n === X) return;
      v = voice(box, 0, 1);
      osc(v, 'triangle', D4 * st(n), tt, 1.8, 0.8);
      osc(v, 'sine', D4 * st(n) * 4, tt, 0.25, 0.12);
    });
  };

  var BON = [7, X, 3, 0, X, X, 2, X, -2, -5, X, X];
  CUES.bonfire = function (c, t) {
    var fire = cbus(c, 0.5, 0.1), pad = cbus(c, 0.2, 0.5), mel = cbus(c, 0.2, 0.55), pg = cg(c, 0, pad), ch = [0, 3, 7, 10, 14], k;
    if (!crackBuf) crackBuf = mkCrackle();
    cnoise(c, crackBuf, cg(c, 0.6, fire));
    cnoise(c, brown, cf(c, 'lowpass', 320, 1, cg(c, 0.35, fire)));
    for (k = 0; k < 5; k++) cosc(c, 'sine', D3 * st(ch[k]), 0, 0.3 - k * 0.04, pg);   // Dm9
    pg.gain.setTargetAtTime(0.8, t, 0.7);                  // 2 s swell
    clfo(c, 0.09, 0.15, pg.gain);
    cseq(c, 0, t + 0.3, function (i, tt) {                 // stray live crackles over the loop
      noise(voice(fire, 0, 1), tt, 0.01 + rnd() * 0.03, 0.3 + rnd() * 0.8, { ft: 'bandpass', f: 1000 + rnd() * 3000, q: 2 });
      return 0.2 + rnd() * 0.8;
    });
    cseq(c, 0.4, t + 2.4, function (i, tt) {               // 6/8 at 50: two bars of tune, two of fire
      var s = i % 48, n;
      if (s % 24 >= 12) return;
      n = s === 33 ? 0 : BON[s % 12];                      // the second time it comes home to D
      if (n !== X) osc(voice(mel, 0, 1), 'triangle', D4 * st(n), tt, 1.3, 0.8, { a: 0.015 });
    });
  };

  // Boss. Lead phrases: semitones from D4 per quarter note, four bars each (H holds, X rests).
  var PH = [
    [[0, 1, 3, 1], [0, H, -5, H], [-4, -5, -7, -5], [0, H, H, H]],      // A  the motif
    [[0, 1, 3, 1], [0, H, -5, H], [-4, -5, -7, -5], [0, H, -2, 1]],     // A' turns back on itself
    [[7, H, 5, 3], [1, H, 0, H], [3, 1, 0, -2], [0, H, H, H]],          // B  the answer, from above
    [[7, H, 8, 7], [5, H, 3, 1], [0, 1, -2, 1], [0, H, H, X]]           // B'
  ];
  var CHD = [[0, 3, 7], [1, 8, 12], [-2, 1, 5], [0, 7, 12]];            // Dm, Eb(maj7, no 3rd), Cm, D5
  var BASS = [0, 0, 0, 1, 0, 0, -2, 0], BASSC = [-2, -2, -2, 0, -2, -2, -4, -2];
  // per 4-bar block of a 32-bar loop: phrase (-1 = lead out), octave, eighth-note stutter
  var FORM1 = [0, 1, 2, 3, -1, -1, 0, 3], FORM2 = [0, 1, 2, 3, -1, 0, 2, 3];
  var OCT = [1, 1, 1, 1, 1, 1, 2, 1], STUT = [0, 0, 0, 1, 0, 1, 1, 1];

  function mkBoss(c, t, two) {
    var sd = 15 / (two ? 132 : 96), form = two ? FORM2 : FORM1, k,
      bassBus = cbus(c, two ? 0.26 : 0.34, 0.06), leadBus = cbus(c, two ? 0.22 : 0.26, 0.4), drumBus = cbus(c, 0.38, 0.12),
      snBus = cbus(c, 0.6, 0.45), padBus = cbus(c, 0.2, 0.5), bellBus = cbus(c, 0.3, 0.7),
      bassLP = cf(c, 'lowpass', two ? 440 : 300, two ? 9 : 5, two ? grit(c, 3, bassBus) : bassBus),
      leadLP = cf(c, 'lowpass', two ? 2400 : 1700, 3, two ? grit(c, 2, leadBus) : leadBus),
      padG = cg(c, 0, two ? cg(c, 0.65, padBus) : padBus), padLP = cf(c, 'lowpass', two ? 1300 : 900, 1, padG),
      bass = mono(c, bassLP, ['sawtooth', 1, 1, 'sawtooth', 2, 0.3]),
      lead = mono(c, leadLP, two ? ['pulse', 1, 1, 'sawtooth', 0.70711, 0.6] : ['pulse', 1, 1]),   // phase 2: doubled a tritone below
      kick = mono(c, drumBus, ['sine', 1, 1, 'triangle', 2, 0.3]),
      body = mono(c, snBus, ['triangle', 1, 0.5]),
      sg = cg(c, 0.0001, snBus), vib = clfo(c, 5, 9), pads = [];
    cnoise(c, white, cf(c, 'bandpass', 1800, 0.8, sg));
    for (k = 0; k < lead.o.length; k++) vib.connect(lead.o[k].detune);
    for (k = 0; k < 6; k++) pads.push(cosc(c, 'sawtooth', D3, k & 1 ? 7 : -7, 0.33, padLP));
    if (two) clfo(c, 14, 0.35, padG.gain);                 // 14 Hz tremolo
    function fx(n) { return two && ((n % 12) + 12) % 12 === 7 ? n - 1 : n; }   // Locrian: A -> A flat
    function kk(tt, pk, short) { mnote(kick, 105, tt, short ? sd * 0.9 : 0.2, pk, 0.003, 0, 42, 0.09); }
    function sn(tt, pk, short) {
      env(sg.gain, tt, 0.002, short ? sd * 0.9 : 0.2, pk);
      mnote(body, 200, tt, 0.09, pk * 0.6, 0.002, 0, 140, 0.08);
    }
    cseq(c, sd, t + 0.05, function (i, tt) {
      var s = i & 15, bar = i >> 4, bi = bar & 3, b32 = bar & 31, blk = b32 >> 2, ph = form[blk],
        fill = (b32 & 7) === 7, row = CHD[bi], q, n, len;
      if (!s) {                                            // pad: glide to the bar's chord and swell
        for (k = 0; k < 6; k++) pads[k].frequency.setTargetAtTime(D3 * st(fx(row[k >> 1])), tt, 0.02);
        padG.gain.setTargetAtTime(0.3, tt, 0.015); padG.gain.setTargetAtTime(1, tt + 0.05, 0.3);
        if (!(b32 & 7) || (ph < 0 && !(bar & 1)))          // the bell tolls on the long downbeats
          fmBell(voice(bellBus, 0, 1), D4 * (ph < 0 && (bar & 2) ? st(fx(-5)) : 1), tt, 3.2, 0.7, 1.5);
      }
      if (two || !(s & 1)) {                               // bass: 8ths (16ths with an octave kick in phase 2)
        n = (bi === 2 ? BASSC : BASS)[s >> 1];
        if (two && (s & 7) === 7) n += 12;
        mnote(bass, D2 * st(n), tt, sd * (two ? 0.9 : 1.7), two && (s & 1) ? 0.6 : 0.9, 0.004, 0.4);
      }
      if (ph >= 0 && !(s & 1)) {                           // lead
        row = PH[ph][bi]; q = s >> 2; n = row[q];
        if (STUT[blk] && two) {
          while (q > 0 && row[q] === H) q--;
          if (row[q] > X) mnote(lead, D4 * OCT[blk] * st(fx(row[q])), tt, 1.8 * sd, s & 2 ? 0.6 : 0.9, 0.008, 0.5);
        } else if (!(s & 2) && n > X) {
          len = 1; while (q + len < 4 && row[q + len] === H) len++;
          mnote(lead, D4 * OCT[blk] * st(fx(n)), tt, (len * 4 - 0.4) * sd, 0.9, 0.012, 0.6);
        }
      }
      if (two) {                                           // drums
        if (!(s & 3) && !duck) kk(tt, 0.95);               // in Deathblow the heartbeat replaces the kick
        if (s === 4 || s === 12) sn(tt, 0.8, fill && s === 12);
        if ((bi & 1) && s === 14 && !duck) kk(tt, 0.6);
        if (fill && s > 12) sn(tt, 0.3 + (s - 12) * 0.15, 1);
      } else {
        if (s === 0 || s === 8) kk(tt, 0.9);
        if (s === 12 && (ph >= 0 || blk === 5)) sn(tt, 0.8);
        if (bi === 3 && s === 14) kk(tt, 0.6, 1);
        if (fill && (s === 10 || s === 11 || s === 15)) kk(tt, 0.55, s !== 11);
      }
    });
  }
  CUES.boss = function (c, t) { mkBoss(c, t, false); };
  CUES.boss2 = function (c, t) { mkBoss(c, t, true); };

  // Credits: the motif in D Dorian at 66 on a triangle; Dm - Em - Am - and at last D major.
  var CCH = [[0, 3, 7, 12], [2, 5, 9, 14], [-5, 7, 10, 14], [0, 4, 7, 16]], CRT = [0, 2, 7, 0];
  var CLD = [[0, 2, 3, 2], [0, H, -5, H], [-3, -5, -7, -5], [0, H, H, H]], CARP = [0, 4, 7, 12];
  CUES.credits = function (c, t) {
    var q = 60 / 66, k, pads = [], padG = cg(c, 0, cbus(c, 0.2, 0.6)),
      lead = mono(c, cbus(c, 0.24, 0.55), ['triangle', 1, 1, 'sine', 2, 0.18]),
      bass = mono(c, cbus(c, 0.3, 0.2), ['sine', 1, 1, 'triangle', 2, 0.3]),
      vib = clfo(c, 4.5, 6);
    for (k = 0; k < 4; k++) pads.push(cosc(c, 'sine', D3, k & 1 ? 4 : -4, 0.3 - k * 0.04, padG));
    for (k = 0; k < 2; k++) vib.connect(lead.o[k].detune);
    cseq(c, q, t + 0.05, function (i, tt) {
      var s = i & 3, bi = (i >> 2) & 3, two = (i >> 4) & 1, row = CLD[bi], n, len;
      if (!s) {
        for (k = 0; k < 4; k++) pads[k].frequency.setTargetAtTime(D3 * st(CCH[bi][k]), tt, 0.08);
        padG.gain.setTargetAtTime(0.5, tt, 0.05); padG.gain.setTargetAtTime(1, tt + 0.15, 0.6);
        mnote(bass, D2 * st(CRT[bi]), tt, q * 3.8, 0.8, 0.03, 0.5);
      }
      if (two && bi === 3) { mnote(lead, D4 * st(CARP[s]), tt, q * 0.95, 0.85, 0.02, 0.6); return; }   // the major chord, spelled out
      n = row[s];
      if (n > X) {
        len = 1; while (s + len < 4 && row[s + len] === H) len++;
        mnote(lead, D4 * (two ? 2 : 1) * st(n), tt, (len - 0.08) * q, 0.9, 0.02, 0.6);
      }
    });
  };

  // ------------------------------------------------------------------ scheduler
  function runSeqs(c, t) {
    var i, q, n, d;
    for (i = 0; i < c.seq.length; i++) {
      q = c.seq[i];
      if (q.next < t - 0.02) {                             // a late tick: skip what was missed, never burst
        if (q.dur) { n = Math.ceil((t - q.next) / q.dur); q.step += n; q.next += n * q.dur; } else q.next = t;
      }
      n = 0;
      while (q.next < t + LOOK && n++ < 8) {
        d = 0;
        try { d = q.fn(q.step, q.next > t ? q.next : t); } catch (e) { oops(e); }
        q.step++; q.next += num(d, 0) > 0 ? d : (q.dur || 1);
      }
    }
  }
  function beat(t) {
    var s = ctx.createBufferSource();
    s.buffer = hbBuf; s.connect(hbGain); s.onended = srcEnd;
    s.start(t); s.stop(t + 0.5);
  }
  function runHb(t) {
    var n = 0;
    if (hbNext < t - 0.02) hbNext = t + 0.02;
    while (hbNext < t + LOOK && n++ < 4) {
      if (!muted) beat(hbNext > t ? hbNext : t);
      hbLast = hbNext; hbNext += 60 / hbBpm;
    }
  }
  function tick() {
    try {
      if (!ready || held) return;
      var t = now(), i;
      for (i = dying.length - 1; i >= 0; i--) {
        if (t >= dying[i].killAt) { dispose(dying[i]); dying.splice(i, 1); } else runSeqs(dying[i], t);
      }
      if (cue) runSeqs(cue, t);
      if (hbBpm > 0) runHb(t);
      if (!cue && !dying.length && hbBpm <= 0) stopTimer();
    } catch (e) { oops(e); }
  }
  function startTimer() { if (timer === null && !held) timer = G.setInterval(tick, TICK); }
  function stopTimer() { if (timer !== null) { G.clearInterval(timer); timer = null; } }

  // ------------------------------------------------------------------ public API
  function wake() {
    if (!held && ctx.state && ctx.state !== 'running' && ctx.resume) quiet(ctx.resume());
  }
  function unlock() {                                      // iOS: a one-sample silent buffer inside the gesture
    var s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, sr); s.connect(ctx.destination); s.onended = srcEnd;
    s.start(now()); s.stop(now() + 0.05);
  }
  function build() {
    var comp = ctx.createDynamicsCompressor(), pre, conv, i, SEND = [0, 0.12, 0.3, 0.6];
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 14;
    comp.attack.value = 0.002; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    master = gainNode(muted ? 0 : MASTER, comp);
    sfxBus = gainNode(1, master); musBus = gainNode(0.55, master);
    musLP = biq('lowpass', 18000, 0.5, musBus);
    revIn = gainNode(1);
    musSendLP = biq('lowpass', 18000, 0.5, revIn);
    pre = ctx.createDelay(0.1); pre.delayTime.value = 0.022;
    conv = ctx.createConvolver(); conv.buffer = mkImpulse();
    revIn.connect(pre); pre.connect(conv);
    conv.connect(biq('lowpass', 4200, 0.5, gainNode(0.7, master)));
    for (i = 0; i < 4; i++) { B[i] = gainNode(1, sfxBus); if (SEND[i]) B[i].connect(gainNode(SEND[i], revIn)); }
    typeBus = gainNode(0.07, B[1]);
    hbGain = gainNode(0.75, biq('lowpass', 300, 0.5, B[0]));
    mkNoise();
    typeBuf = mkType(180, 0.018, 0); type2Buf = mkType(90, 0.036, 1);
    hbBuf = mkHeart(); pulse = mkPulse();
  }
  function init() {
    if (failed) return;
    if (ctx) { if (ready && ctx.state && ctx.state !== 'running') { unlock(); wake(); } return; }
    var AC = G.AudioContext || G.webkitAudioContext, sv;
    if (!AC) { failed = true; return; }
    try {
      ctx = new AC(); sr = ctx.sampleRate;
      sv = R.Save && R.Save.data && R.Save.data.settings;
      if (!mutedSet && sv) muted = !!sv.muted;
      build();
    } catch (e) { failed = true; oops(e); return; }
    ready = true; A.ready = true; A.muted = muted;
    unlock(); wake();
    if (want) music(want, 1);
    if (hbWant) heartbeat(hbWant);
  }
  function setMuted(b) {
    muted = !!b; mutedSet = true; A.muted = muted;
    if (ready) master.gain.setTargetAtTime(muted ? 0 : MASTER, now(), 0.01);   // ~30 ms, no click
  }
  function suspend() {
    held = true;
    if (!ready) return;
    stopTimer();
    if (ctx.suspend) quiet(ctx.suspend());
  }
  function resume() {
    held = false;
    if (!ready) return;
    if (ctx.resume) quiet(ctx.resume());
    if (cue || dying.length || hbBpm > 0) { startTimer(); tick(); }
  }
  function music(name, fade) {
    if (name === undefined || name === '') name = null;
    if (name !== null && !CUES[name]) return;
    if (!ready) { want = name; return; }
    if ((cue ? cue.name : null) === name) return;
    var t = now(), c, old = cue;
    fade = clamp(num(fade, 1), 0.02, 10);
    wake();
    if (old) {                                             // fade the old cue, then tear it down in tick()
      cue = null;
      old.out.gain.setTargetAtTime(0, t, fade / 4); old.send.gain.setTargetAtTime(0, t, fade / 4);
      old.out.gain.setTargetAtTime(0, t + fade * 0.8, 0.02); old.send.gain.setTargetAtTime(0, t + fade * 0.8, 0.02);
      old.killAt = t + fade + 0.1;
      dying.push(old);
      if (dying.length > 3) dispose(dying.shift());
    }
    if (name) {
      c = newCue(name);
      try { CUES[name](c, t); } catch (e) { dispose(c); c = null; oops(e); }
      if (c) {
        c.out.gain.setTargetAtTime(1, t, fade / 3); c.send.gain.setTargetAtTime(1, t, fade / 3);
        cue = c;
      }
    }
    startTimer();
    if (!held) tick();
  }
  function heartbeat(bpm) {
    bpm = num(bpm, 0); bpm = bpm > 0 ? clamp(bpm, 20, 240) : 0;
    if (!ready) { hbWant = bpm; return; }
    if (bpm === hbBpm) return;
    var was = hbBpm, t = now(), d = bpm >= 90;
    hbBpm = bpm;
    if (d !== duck) { duck = d; lpTo(d ? 700 : 18000, t, 0.2); }   // Deathblow: the music sinks under the pulse
    if (!bpm) return;
    hbNext = was ? Math.max(t + 0.02, hbLast + 60 / bpm) : t + 0.03;
    wake(); startTimer();
    if (!held) runHb(t);
  }
  function oops(e) { try { if (A.onerror) A.onerror(e); } catch (x) {} }   // dev hook; audio never throws into the game
  function safe(f) { return function (a, b) { try { return f(a, b); } catch (e) { oops(e); } }; }

  var A = R.Audio = {
    ready: false,
    muted: false,
    init: safe(init),
    setMuted: safe(setMuted),
    suspend: safe(suspend),
    resume: safe(resume),
    sfx: safe(sfx),            // (name, opts?)  opts: { vol, pitch }; boon / rival_draft also take { n: 1..3 } or { rarity }
    music: safe(music),        // (name|null, fadeSec = 1)
    heartbeat: safe(heartbeat),// (bpm|0)
    _dbg: function () { return { live: live, type: liveType, cue: cue ? cue.name : null, dying: dying.length, timer: timer !== null, hb: hbBpm }; }
  };
})(globalThis.RIVAL = globalThis.RIVAL || {});
