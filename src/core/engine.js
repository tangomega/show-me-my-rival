// SHOW ME MY RIVAL - engine: integer-scaled 180xH buffer, loop, scenes, timers, coroutines, tweens, input, pause.
(function (R) {
  'use strict';

  var W = 180, MIN_H = 320, MAX_H = 400, MAX_DT = 0.05;

  var canvas = null, vctx = null;          // visible canvas (device pixels)
  var buf = null, g = null;                // internal 180 x H buffer
  var probe = null;                        // safe-area probe element
  var scenes = {}, cur = null;
  var started = false, lastTs = -1;

  // layout (device px unless noted)
  var cw = 0, ch = 0, offL = 0, offT = 0, cssPer = 1, cssL = 0, cssT = 0;
  var lastVw = -1, lastVh = -1, lastDpr = -1, lastSt = -1, lastSb = -1, safeOverride = null;

  // juice
  var hs = 0;                              // hit-stop seconds left (real time)
  var shMag = 0, shDur = 0, shT = 0, shX = 0, shY = 0, wasShaking = false;
  var flCol = 0, flDur = 0, flT = 0;

  // scene transition: 0 none, 1 fading out, 2 fading in
  var trPhase = 0, trT = 0, trDur = 0;
  var hasNext = false, nxName = '', nxArgs = null, nxFade = 0.25;

  // timers (parallel preallocated arrays)
  var tCap = 64, tN = 0, tTime = new Float64Array(tCap), tId = new Int32Array(tCap), tFn = new Array(tCap), nextId = 1;
  // coroutines and tweens (handles are allocated on creation, never per frame)
  var cos = [], coN = 0, tws = [], twN = 0;

  // input
  var ptrId = null, ptrLive = false, ptrX = 0, ptrY = 0, gestured = false;
  var KEYS = { '1': 'S', '2': 'G', '3': 'F', 's': 'S', 'S': 'S', 'g': 'G', 'G': 'G', 'f': 'F', 'F': 'F', 'Enter': 'OK', ' ': 'OK' };

  // debug readout
  var dbgAcc = 0, dbgFrames = 0, dbgWork = 0, dbgText = '';
  var DBG_OPTS = { shadow: 1 }, CENTER = { align: 'center', shadow: 1 };

  var E = {
    W: W, H: MIN_H,
    safe: { top: 0, bottom: 0 },
    // Shared vertical layout per DESIGN section 3 (recomputed on resize). All values are internal px:
    //   top/hudY = safe.top, usable = H - safe.top - safe.bottom, extra = usable - 320, arenaY/arenaH,
    //   floorY (fighters' feet), bandY (speech band), rowY (active row), btnY/btnH, bottom (end of the buttons)
    lay: { top: 0, hudY: 0, extra: 0, usable: 320, arenaY: 34, arenaH: 170, floorY: 172, bandY: 204, rowY: 238, btnY: 262, btnH: 52, bottom: 314 },
    time: 0,              // scaled seconds since scene enter (frozen by hit-stop)
    real: 0,              // unscaled seconds since scene enter (keeps running through hit-stop; for UI blinks)
    frame: 0,
    timeScale: 1,
    paused: false,
    rotated: false,       // landscape on a touch device: the CSS overlay is up, updates are frozen
    scale: 1,             // device px per internal px
    dpr: 1,
    debug: false,
    sceneName: '',
    ease: {
      lin: function (p) { return p; },
      in: function (p) { return p * p; },
      out: function (p) { return 1 - (1 - p) * (1 - p); },
      io: function (p) { return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p); },
      back: function (p) { var s = 1.70158; p -= 1; return p * p * ((s + 1) * p + s) + 1; }
    }
  };

  function hex(i) { return R.Pal.hex[i] || '#000'; }
  function warn(e) { if (typeof console !== 'undefined') console.error(e); }
  function audio(fn) { try { if (R.Audio && R.Audio[fn]) R.Audio[fn](); } catch (e) { warn(e); } }

  // ---------------------------------------------------------------- layout
  function computeLay() {
    var L = E.lay, usable = E.H - E.safe.top - E.safe.bottom, extra = usable - 320;
    var add = extra > 40 ? 40 : extra < -52 ? -52 : extra;       // arena grows (or, on a short safe screen, shrinks) at its top
    var btnAdd = extra - 40; btnAdd = btnAdd < 0 ? 0 : btnAdd > 24 ? 24 : btnAdd;
    L.top = L.hudY = E.safe.top; L.extra = extra; L.usable = usable;
    L.arenaY = L.top + 34; L.arenaH = 170 + add;
    L.floorY = L.arenaY + L.arenaH - 32;
    L.bandY = L.arenaY + L.arenaH;
    L.rowY = L.bandY + 34;
    L.btnY = L.rowY + 24; L.btnH = 52 + btnAdd;
    L.bottom = L.btnY + L.btnH;
  }

  function readSafe(which) {
    if (safeOverride) return safeOverride[which];
    if (!probe || !window.getComputedStyle) return 0;
    var cs = window.getComputedStyle(probe), v = parseFloat(which ? cs.paddingBottom : cs.paddingTop);
    return v > 0 ? v : 0;
  }

  function layout(force) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var vw = window.innerWidth || document.documentElement.clientWidth || 360;
    var vh = window.innerHeight || document.documentElement.clientHeight || 640;
    var st = readSafe(0), sb = readSafe(1);
    if (!force && vw === lastVw && vh === lastVh && dpr === lastDpr && st === lastSt && sb === lastSb) return;
    lastVw = vw; lastVh = vh; lastDpr = dpr; lastSt = st; lastSb = sb;

    var dw = Math.max(1, Math.round(vw * dpr)), dh = Math.max(1, Math.round(vh * dpr));
    var H = Math.floor(W * vh / vw); H = H < MIN_H ? MIN_H : H > MAX_H ? MAX_H : H;
    var s = Math.min(Math.floor(dw / W), Math.floor(dh / H)); if (s < 1) s = 1;
    // With the scale fixed, take any spare whole rows (still within 320..400) instead of letterboxing them.
    var H2 = Math.floor(dh / s); H2 = H2 > MAX_H ? MAX_H : H2; if (H2 > H) H = H2;

    cw = W * s; ch = H * s;
    offL = Math.floor((dw - cw) / 2); offT = Math.floor((dh - ch) / 2);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    canvas.style.width = (cw / dpr) + 'px'; canvas.style.height = (ch / dpr) + 'px';
    canvas.style.left = (offL / dpr) + 'px'; canvas.style.top = (offT / dpr) + 'px';
    vctx.imageSmoothingEnabled = false;
    if (buf.width !== W) buf.width = W;
    if (buf.height !== H) buf.height = H;
    g.imageSmoothingEnabled = false;

    cssPer = s / dpr; cssL = offL / dpr; cssT = offT / dpr;
    E.H = H; E.scale = s; E.dpr = dpr;
    E.safe.top = Math.ceil(Math.max(0, st - cssT) / cssPer - 0.001);
    E.safe.bottom = Math.ceil(Math.max(0, sb - (vh - cssT - ch / dpr)) / cssPer - 0.001);
    var mm = window.matchMedia ? window.matchMedia('(orientation: landscape) and (pointer: coarse)') : null;
    E.rotated = !!(mm && mm.matches);
    computeLay();
    wasShaking = true;                                           // repaint the whole visible canvas once
    if (cur && cur.resize) cur.resize(W, H);
  }

  // ---------------------------------------------------------------- timers
  E.after = function (sec, fn) {
    if (tN >= tCap) {                                            // rare: grow
      var c2 = tCap * 2, t2 = new Float64Array(c2), i2 = new Int32Array(c2);
      t2.set(tTime); i2.set(tId); tTime = t2; tId = i2; tFn.length = c2; tCap = c2;
    }
    var id = nextId++;
    tTime[tN] = sec > 0 ? sec : 0; tId[tN] = id; tFn[tN] = fn; tN++;
    return id;
  };
  E.cancel = function (id) {
    for (var i = 0; i < tN; i++) if (tId[i] === id) { tFn[i] = null; tId[i] = 0; return true; }
    return false;
  };
  function stepTimers(dt) {
    var n = tN, i, j, fn;
    for (i = 0; i < n; i++) {
      if (!tFn[i]) continue;
      tTime[i] -= dt;
      if (tTime[i] <= 0) { fn = tFn[i]; tFn[i] = null; tId[i] = 0; fn(); }
    }
    for (i = 0, j = 0; i < tN; i++) {                            // compact, keeping order
      if (tFn[i]) { if (i !== j) { tTime[j] = tTime[i]; tId[j] = tId[i]; tFn[j] = tFn[i]; tFn[i] = null; } j++; }
    }
    tN = j;
  }

  // ---------------------------------------------------------------- coroutines
  // yield <number>: wait scaled seconds.  yield <function>: wait until it returns truthy.
  // yield <handle with .done> (coroutine or tween): wait for it.  bare yield: wait one frame.
  function Co(it) { this.it = it; this.done = false; this.mode = 0; this.wait = 0; this.on = null; }
  Co.prototype.cancel = function () { this.done = true; this.it = null; this.on = null; };

  function resume(c) {
    var r, v, guard = 0;
    while (!c.done) {
      try { r = c.it.next(); } catch (e) { warn(e); c.cancel(); return; }
      if (c.done) return;                                        // cancelled itself
      if (r.done) { c.cancel(); return; }
      v = r.value;
      if (typeof v === 'number' && v > 0) {
        if (c.mode !== 1) c.wait = 0;
        c.mode = 1; c.wait += v;                                 // carry the overshoot so sequences stay on the beat
        if (c.wait > 0 || ++guard > 64) return;
      } else if (typeof v === 'function') { c.mode = 2; c.on = v; return; }
      else if (v && typeof v === 'object') { c.mode = 3; c.on = v; if (!v.done) return; }
      else { c.mode = 4; return; }
    }
  }
  E.co = function (genFn) {
    var c = new Co(genFn());
    cos[coN++] = c;
    resume(c);                                                   // runs up to the first yield right away
    return c;
  };
  function stepCos(dt) {
    var n = coN, i, j, c;
    for (i = 0; i < n; i++) {
      c = cos[i];
      if (!c || c.done) continue;
      if (c.mode === 1) { c.wait -= dt; if (c.wait <= 0) resume(c); }
      else if (c.mode === 2) { if (c.on()) { c.on = null; c.mode = 0; resume(c); } }
      else if (c.mode === 3) { if (c.on.done) { c.on = null; c.mode = 0; resume(c); } }
      else { c.mode = 0; resume(c); }
    }
    for (i = 0, j = 0; i < coN; i++) { c = cos[i]; if (c && !c.done) { cos[j++] = c; } }
    for (i = j; i < coN; i++) cos[i] = null;
    coN = j;
  }

  // ---------------------------------------------------------------- tweens
  function Tw() { this.obj = null; this.key = ''; this.from = 0; this.to = 0; this.t = 0; this.dur = 0; this.ease = null; this.done = false; }
  Tw.prototype.cancel = function () { this.done = true; this.obj = null; };

  // ease: function(p) or a name in E.ease ('lin' default, 'in', 'out', 'io', 'back'). A new tween on the same
  // obj/key replaces the old one. The returned handle has .done and .cancel() and can be yielded on.
  E.tween = function (obj, key, to, sec, ease) {
    var i, t;
    for (i = 0; i < twN; i++) { t = tws[i]; if (t && !t.done && t.obj === obj && t.key === key) t.cancel(); }
    t = new Tw();
    t.obj = obj; t.key = key; t.from = +obj[key] || 0; t.to = to; t.dur = sec;
    t.ease = typeof ease === 'function' ? ease : (E.ease[ease] || E.ease.lin);
    if (!(sec > 0)) { obj[key] = to; t.done = true; t.obj = null; return t; }
    tws[twN++] = t;
    return t;
  };
  function stepTweens(dt) {
    var n = twN, i, j, t, p;
    for (i = 0; i < n; i++) {
      t = tws[i];
      if (!t || t.done) continue;
      t.t += dt; p = t.t / t.dur;
      if (p >= 1) { t.obj[t.key] = t.to; t.done = true; t.obj = null; }
      else t.obj[t.key] = t.from + (t.to - t.from) * t.ease(p);
    }
    for (i = 0, j = 0; i < twN; i++) { t = tws[i]; if (t && !t.done) { tws[j++] = t; } }
    for (i = j; i < twN; i++) tws[i] = null;
    twN = j;
  }

  function clearAll() {
    var i;
    for (i = 0; i < tN; i++) { tFn[i] = null; tId[i] = 0; }
    tN = 0;
    for (i = 0; i < coN; i++) { if (cos[i]) cos[i].cancel(); cos[i] = null; }
    coN = 0;
    for (i = 0; i < twN; i++) { if (tws[i]) tws[i].cancel(); tws[i] = null; }
    twN = 0;
  }

  // ---------------------------------------------------------------- juice
  E.hitStop = function (sec) { if (sec > hs) hs = sec; };
  E.shake = function (px, sec) { shMag = px > 0 ? px : 0; shDur = shT = sec > 0 ? sec : 0; };
  E.flash = function (palIndex, sec) { flCol = palIndex; flDur = flT = sec > 0 ? sec : 0; };
  E.buzz = function (pattern) {
    try {
      if (R.Save && R.Save.data && R.Save.data.settings && R.Save.data.settings.haptics === false) return false;
      if (typeof navigator === 'undefined' || !navigator.vibrate) return false;
      // Browsers block (and log) vibration before the first real tap; skip the call until there has been one.
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
      return !!navigator.vibrate(pattern);
    } catch (e) { /* ignore */ }
    return false;
  };

  // ---------------------------------------------------------------- scenes
  E.scene = function (name, def) { scenes[name] = def || {}; return def; };

  // fadeSec is the length of EACH leg (out, then in), drawn as a 4-step fade. The swap never happens inside the
  // caller: it is applied at the start of a later frame, so calling go() from update/timers/input is always safe.
  E.go = function (name, args, fadeSec) {
    nxName = name; nxArgs = args === undefined ? null : args;
    nxFade = fadeSec === undefined || fadeSec === null ? 0.25 : (fadeSec > 0 ? fadeSec : 0);
    hasNext = true;
  };

  function releasePointer() {
    if (ptrLive && cur && cur.up) { ptrLive = false; cur.up(-9999, -9999); }
    ptrLive = false; ptrId = null;
  }

  function swap() {
    var guard = 0, name, def;
    while (hasNext && guard++ < 8) {                             // enter() may redirect with another go()
      hasNext = false; name = nxName;
      releasePointer();
      if (cur && cur.exit) { try { cur.exit(); } catch (e) { warn(e); } }
      clearAll();
      hs = 0; shT = 0; shX = shY = 0; flT = 0;
      E.timeScale = 1; E.time = 0; E.real = 0;
      def = scenes[name] || (R.Scenes && R.Scenes[name]);          // scene files register on R.Scenes
      if (!def) { warn('RIVAL: unknown scene "' + name + '"'); def = {}; }
      cur = def; E.sceneName = name;
      if (cur.enter) {
        try { cur.enter(nxArgs); }
        catch (e2) {                                               // a scene that cannot start (bad save...) must not
          warn(e2);                                                // strand the player on a dead screen: back to the title
          if (name !== 'title') { nxName = 'title'; nxArgs = null; nxFade = 0.25; hasNext = true; }
        }
      }
    }
    trDur = nxFade;
  }

  // ---------------------------------------------------------------- pause
  function setPaused(p) {
    if (p === E.paused) return;
    E.paused = p;
    if (p) {
      releasePointer();
      audio('suspend');
      if (cur && cur.pause) { try { cur.pause(); } catch (e) { warn(e); } }
    } else {
      lastTs = -1;                                               // restart the frame clock: no dt spike
      audio('resume');
      if (cur && cur.resume) { try { cur.resume(); } catch (e2) { warn(e2); } }
    }
  }
  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }

  // ---------------------------------------------------------------- frame
  function frame(ts) {
    requestAnimationFrame(frame);
    var raw, dt, t0, a, k;
    if (lastTs < 0) lastTs = ts;
    raw = (ts - lastTs) / 1000; lastTs = ts;
    if (!(raw > 0)) raw = 0; if (raw > MAX_DT) raw = MAX_DT;
    if (E.paused || E.rotated) raw = 0;
    t0 = E.debug ? performance.now() : 0;

    // transition bookkeeping (real time)
    if (hasNext && trPhase !== 1) { trPhase = 1; trT = 0; trDur = cur ? nxFade : 0; }
    if (trPhase === 1) {
      trT += raw;
      if (trT >= trDur) { swap(); trPhase = 2; trT = 0; if (!(trDur > 0)) trPhase = 0; }
    } else if (trPhase === 2) {
      trT += raw;
      if (trT >= trDur) trPhase = 0;
    }

    // update
    dt = raw * E.timeScale;
    if (hs > 0) { hs -= raw; dt = 0; }
    E.real += raw;
    if (dt > 0) {
      E.time += dt; E.frame++;
      stepTimers(dt); stepCos(dt); stepTweens(dt);
      if (cur && cur.update) cur.update(dt);
    }

    // draw
    g.globalAlpha = 1;
    g.fillStyle = hex(1); g.fillRect(0, 0, W, E.H);
    if (cur && cur.draw) cur.draw(g);
    g.globalAlpha = 1;
    if (flT > 0) {                                               // flash: 4 discrete alpha steps
      k = Math.ceil(4 * flT / flDur); if (k > 4) k = 4;
      g.globalAlpha = 0.85 * k / 4; g.fillStyle = hex(flCol); g.fillRect(0, 0, W, E.H); g.globalAlpha = 1;
      flT -= raw;
    }
    if (trPhase) {                                               // fade: 4 discrete steps to black and back
      a = trDur > 0 ? trT / trDur : 1; if (a > 1) a = 1;
      k = trPhase === 1 ? Math.ceil(a * 4) : 4 - Math.floor(a * 4);
      if (k > 0) { g.globalAlpha = k / 4; g.fillStyle = hex(1); g.fillRect(0, 0, W, E.H); g.globalAlpha = 1; }
    }
    if (E.paused && !hidden()) {
      g.fillStyle = hex(1); g.fillRect(0, (E.H >> 1) - 9, W, 17);
      g.fillStyle = hex(5); g.fillRect(0, (E.H >> 1) - 9, W, 1); g.fillRect(0, (E.H >> 1) + 7, W, 1);
      R.Font.draw(g, 'PAUSED', W >> 1, (E.H >> 1) - 4, 10, CENTER);
    }
    if (E.debug) drawDebug(raw, t0);

    // shake + blit (whole internal pixels)
    if (shT > 0) {
      k = Math.max(1, Math.round(shMag * shT / shDur));
      shX = ((Math.random() * (2 * k + 1)) | 0) - k; shY = ((Math.random() * (2 * k + 1)) | 0) - k;
      shT -= raw;
    } else { shX = 0; shY = 0; }
    if (shX || shY || wasShaking) { vctx.fillStyle = hex(1); vctx.fillRect(0, 0, cw, ch); }
    wasShaking = !!(shX || shY);
    vctx.drawImage(buf, 0, 0, W, E.H, shX * E.scale, shY * E.scale, cw, ch);
  }

  function drawDebug(raw, t0) {
    dbgAcc += raw; dbgFrames++; dbgWork += performance.now() - t0;
    if (dbgAcc >= 0.5 || !dbgText) {
      dbgText = (dbgAcc > 0 ? Math.round(dbgFrames / dbgAcc) : 0) + 'fps ' + (dbgWork / Math.max(1, dbgFrames)).toFixed(2) + 'ms t' + tN + ' c' + coN + ' w' + twN;
      dbgAcc = 0; dbgFrames = 0; dbgWork = 0;
    }
    R.Font.draw(g, dbgText, 2, E.H - 10 - E.safe.bottom, 31, DBG_OPTS);
  }

  // ---------------------------------------------------------------- input
  function firstGesture() {
    if (gestured) return;
    gestured = true;
    try { if (R.Audio && R.Audio.init) R.Audio.init(); } catch (e) { warn(e); }
  }
  // A touch pointerdown / touchstart is not a user activation (iOS Safari, Chrome): an AudioContext created there
  // stays suspended. Releases and key presses are activations, so every one retries (a no-op once audio runs).
  function gestureEnd() { try { if (gestured && R.Audio && R.Audio.init) R.Audio.init(); } catch (e) { warn(e); } }
  function blocked() { return trPhase === 1 || hasNext || E.rotated; }
  function ix(clientX) { return Math.floor((clientX - cssL) / cssPer); }
  function iy(clientY) { return Math.floor((clientY - cssT) / cssPer); }

  function pDown(id, cx, cy) {
    firstGesture();
    if (E.paused && !hidden()) setPaused(false);
    if (ptrId !== null && ptrId === id) releasePointer();        // its "up" was lost (released outside the window)
    if (ptrId !== null) return;                                  // first pointer only
    ptrId = id; ptrX = ix(cx); ptrY = iy(cy);
    ptrLive = !blocked() && !!cur;
    if (ptrLive && cur.down) cur.down(ptrX, ptrY);
  }
  function pMove(id, cx, cy) {
    if (id !== ptrId) return;
    ptrX = ix(cx); ptrY = iy(cy);
    if (ptrLive && cur && cur.move) cur.move(ptrX, ptrY);
  }
  function pUp(id, cx, cy, cancelled) {
    if (id !== ptrId) return;
    ptrId = null;
    if (!ptrLive) return;
    ptrLive = false;
    if (cancelled) { if (cur && cur.up) cur.up(-9999, -9999); return; }
    ptrX = ix(cx); ptrY = iy(cy);
    if (cur && cur.up) cur.up(ptrX, ptrY);
  }

  function kill(e) { if (e.cancelable) e.preventDefault(); }

  function bind() {
    var opt = { passive: false }, i;
    if (window.PointerEvent) {
      window.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        // A new primary pointer while another one is still tracked: that one's up/cancel never arrived (touch
        // ids are never reused, so the same-id check in pDown cannot catch it). Without this, input stays dead.
        if (e.isPrimary && ptrId !== null && ptrId !== e.pointerId) releasePointer();
        pDown(e.pointerId, e.clientX, e.clientY);
      }, opt);
      window.addEventListener('pointermove', function (e) { pMove(e.pointerId, e.clientX, e.clientY); }, opt);
      window.addEventListener('pointerup', function (e) { gestureEnd(); pUp(e.pointerId, e.clientX, e.clientY, false); }, opt);
      window.addEventListener('pointercancel', function (e) { pUp(e.pointerId, e.clientX, e.clientY, true); }, opt);
    } else {
      // Fallback for browsers without Pointer Events: touches (first finger) and the mouse.
      window.addEventListener('touchstart', function (e) {
        var t = e.changedTouches[0];
        if (ptrId !== null && e.touches && e.touches.length === e.changedTouches.length) releasePointer();   // no other finger is down: the tracked one was lost
        if (t) pDown('t' + t.identifier, t.clientX, t.clientY);
      }, opt);
      window.addEventListener('touchmove', function (e) { for (i = 0; i < e.changedTouches.length; i++) pMove('t' + e.changedTouches[i].identifier, e.changedTouches[i].clientX, e.changedTouches[i].clientY); }, opt);
      window.addEventListener('touchend', function (e) { gestureEnd(); for (i = 0; i < e.changedTouches.length; i++) pUp('t' + e.changedTouches[i].identifier, e.changedTouches[i].clientX, e.changedTouches[i].clientY, false); }, opt);
      window.addEventListener('touchcancel', function (e) { for (i = 0; i < e.changedTouches.length; i++) pUp('t' + e.changedTouches[i].identifier, 0, 0, true); }, opt);
      window.addEventListener('mousedown', function (e) { if (e.button === 0) pDown('m', e.clientX, e.clientY); });
      window.addEventListener('mousemove', function (e) { pMove('m', e.clientX, e.clientY); });
      window.addEventListener('mouseup', function (e) { gestureEnd(); pUp('m', e.clientX, e.clientY, false); });
    }
    // Kill scroll, pinch, double-tap zoom, long-press menus and selection.
    var stop = ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'selectstart', 'dblclick', 'dragstart'];
    for (i = 0; i < stop.length; i++) document.addEventListener(stop[i], kill, opt);

    window.addEventListener('keydown', function (e) {
      var k = e.key, m;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === '`') { E.debug = !E.debug; return; }
      if (e.repeat) return;
      firstGesture();
      if (E.paused && !hidden()) setPaused(false);
      m = KEYS[k];
      if (m) { if (cur && cur.key && !blocked()) cur.key(m); e.preventDefault(); }
      else if (k === 'Escape' || k === 'Backspace') { if (cur && cur.back && !blocked()) cur.back(); e.preventDefault(); }
    });

    document.addEventListener('visibilitychange', function () { setPaused(hidden()); });
    window.addEventListener('pagehide', function () { setPaused(true); });
    window.addEventListener('pageshow', function () { if (!hidden()) setPaused(false); });
    window.addEventListener('blur', function () { setPaused(true); });
    window.addEventListener('focus', function () { if (!hidden()) setPaused(false); });

    var relayout = function () { layout(false); };
    var later = function () { layout(false); setTimeout(relayout, 120); setTimeout(relayout, 450); };   // iOS reports late
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', relayout);
  }

  // ---------------------------------------------------------------- boot
  E.init = function (cv) {
    var q = '', m;
    canvas = cv || document.getElementById('game');
    vctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    buf = document.createElement('canvas'); buf.width = W; buf.height = MIN_H;
    g = buf.getContext('2d', { alpha: false }) || buf.getContext('2d');
    E.canvas = canvas; E.buffer = buf; E.g = g;
    probe = document.getElementById('safe');
    if (!probe) {                                                // shell without a probe: make one
      probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
      document.body.appendChild(probe);
    }
    try { q = window.location.search || ''; } catch (e) { q = ''; }
    if (/[?&]debug\b/.test(q)) E.debug = true;
    m = /[?&]safe=(\d+),(\d+)/.exec(q);                          // dev aid: ?safe=47,34 fakes the insets (CSS px)
    if (m) safeOverride = [+m[1], +m[2]];
    layout(true);
    return E;
  };

  E.start = function () {
    if (started) return;
    started = true;
    bind();
    E.paused = hidden();
    lastTs = -1;
    requestAnimationFrame(frame);
  };

  // Re-run the layout by hand (e.g. after toggling fullscreen).
  E.relayout = function () { layout(true); };

  R.Engine = E;
})(globalThis.RIVAL = globalThis.RIVAL || {});
