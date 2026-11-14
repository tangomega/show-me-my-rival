// SHOW ME MY RIVAL - pooled particles. Typed arrays, no allocation after create().
(function (R) {
  'use strict';

  var TAU = Math.PI * 2, UP = -Math.PI / 2;
  // g = gravity px/s^2, drag = 1/s, sp = speed range px/s, life = seconds, size = px, sway = px/s side drift.
  var KINDS = {
    spark: { g: 260, drag: 3.0, sp0: 40, sp1: 120, l0: 0.15, l1: 0.40, size: 1, sway: 0, dir: 0, spread: TAU, cols: [23, 22, 21, 20] },
    blood: { g: 340, drag: 0.8, sp0: 30, sp1: 95, l0: 0.30, l1: 0.65, size: 2, sway: 0, dir: UP, spread: 1.8, cols: [19, 18, 18, 16] },
    ash: { g: 14, drag: 1.6, sp0: 4, sp1: 22, l0: 0.9, l1: 2.0, size: 1, sway: 7, dir: UP, spread: TAU, cols: [8, 7, 7, 6] },
    ember: { g: -34, drag: 0.7, sp0: 6, sp1: 24, l0: 0.7, l1: 1.6, size: 1, sway: 6, dir: UP, spread: 1.2, cols: [20, 21, 22, 19] },
    shard: { g: 400, drag: 0.4, sp0: 50, sp1: 125, l0: 0.35, l1: 0.70, size: 2, sway: 0, dir: UP, spread: TAU, cols: [23, 10, 9, 28] },
    dust: { g: -10, drag: 3.2, sp0: 8, sp1: 30, l0: 0.30, l1: 0.65, size: 2, sway: 2, dir: UP, spread: Math.PI, cols: [13, 12, 7] },
    heal: { g: -46, drag: 1.3, sp0: 5, sp1: 20, l0: 0.6, l1: 1.1, size: 1, sway: 4, dir: UP, spread: 1.0, cols: [22, 23, 10, 21] },
    // ambient variants (constant drift, no gravity/drag, live until they leave the area)
    ashAmb: { g: 0, drag: 0, sp0: 8, sp1: 14, l0: 99, l1: 99, size: 1, sway: 5, dir: -UP, spread: 0.3, cols: [8, 7, 7] },
    emberAmb: { g: 0, drag: 0, sp0: 9, sp1: 20, l0: 1.6, l1: 3.2, size: 1, sway: 7, dir: UP, spread: 0.5, cols: [20, 21, 22] }
  };
  var ORDER = ['spark', 'blood', 'ash', 'ember', 'shard', 'dust', 'heal', 'ashAmb', 'emberAmb'];
  var AMB = { ash: 'ashAmb', ember: 'emberAmb' };

  function create(max) {
    max = max > 0 ? max | 0 : 256;
    var px = new Float32Array(max), py = new Float32Array(max), vx = new Float32Array(max), vy = new Float32Array(max);
    var life = new Float32Array(max), life0 = new Float32Array(max);
    var kind = new Uint8Array(max), col = new Uint8Array(max), size = new Uint8Array(max);
    var n = 0, cursor = 0, clock = 0;
    // ambient emitters: one slot per ambient-capable kind
    var amb = { ash: { rate: 0, acc: 0, x: 0, y: 0, w: 0, h: 0 }, ember: { rate: 0, acc: 0, x: 0, y: 0, w: 0, h: 0 } };

    function slot() {
      if (n < max) return n++;
      cursor = (cursor + 1) % max;       // pool full: recycle round-robin
      return cursor;
    }

    function spawn(kname, x, y, dir, spread, speedMul, colors) {
      var K = KINDS[kname], i = slot();
      var a = dir + (Math.random() - 0.5) * spread;
      var sp = (K.sp0 + Math.random() * (K.sp1 - K.sp0)) * speedMul;
      var cs = colors || K.cols;
      px[i] = x; py[i] = y; vx[i] = Math.cos(a) * sp; vy[i] = Math.sin(a) * sp;
      life[i] = life0[i] = K.l0 + Math.random() * (K.l1 - K.l0);
      kind[i] = ORDER.indexOf(kname);
      col[i] = cs[(Math.random() * cs.length) | 0];
      size[i] = K.size === 2 && Math.random() < 0.5 ? 2 : 1;
      return i;
    }

    function ambSpawn(name, e, anywhere) {
      var W = e.w, H = e.h, i;
      if (name === 'ash') i = spawn('ashAmb', e.x + Math.random() * W, anywhere ? e.y + Math.random() * H : e.y - 2, -UP, 0.3, 1, null);
      else i = spawn('emberAmb', e.x + Math.random() * W, anywhere ? e.y + Math.random() * H : e.y + H + 1, UP, 0.5, 1, null);
      return i;
    }

    var fx = {
      max: max,
      count: function () { return n; },

      // opts: { dir:radians (0 = right, -PI/2 = up), spread:radians, speed:multiplier, colors:[palIndex] }
      burst: function (kname, x, y, count, opts) {
        var K = KINDS[kname], i;
        if (!K) return;
        var dir = opts && opts.dir !== undefined ? opts.dir : K.dir;
        var spread = opts && opts.spread !== undefined ? opts.spread : K.spread;
        var speed = opts && opts.speed !== undefined ? opts.speed : 1;
        var colors = opts && opts.colors && opts.colors.length ? opts.colors : null;
        for (i = 0; i < (count | 0); i++) spawn(kname, x, y, dir, spread, speed, colors);
      },

      // Continuous emitter. kind 'ash' (falls from the top of the area) or 'ember' (rises from its bottom).
      // perSec 0 stops it. Optional area {x,y,w,h} in internal px (default: the whole screen).
      ambient: function (kname, perSec, area) {
        var e = amb[kname], E = R.Engine, i, k, was;
        if (!e) return;
        was = e.rate;
        e.rate = perSec > 0 ? perSec : 0;
        e.x = area ? area.x : 0; e.y = area ? area.y : 0;
        e.w = area ? area.w : (E ? E.W : 180); e.h = area ? area.h : (E ? E.H : 320);
        if (e.rate > 0 && !was) {           // pre-warm so the screen is not empty for the first seconds
          k = Math.min(max >> 1, Math.round(e.rate * (kname === 'ash' ? e.h / 11 : 2.2)));
          for (i = 0; i < k; i++) ambSpawn(kname, e, true);
        }
      },

      update: function (dt) {
        var i, K, k, name, e, d;
        if (dt <= 0) return;
        clock += dt;
        for (name in amb) {
          e = amb[name];
          if (e.rate > 0) {
            e.acc += e.rate * dt;
            while (e.acc >= 1) { e.acc -= 1; ambSpawn(name, e, false); }
          }
        }
        for (i = 0; i < n; i++) {
          K = KINDS[ORDER[kind[i]]];
          life[i] -= dt;
          k = kind[i];
          if (life[i] <= 0 || (k === 7 && py[i] > amb.ash.y + amb.ash.h + 2)) {
            n--;                              // swap-remove
            if (i < n) {
              px[i] = px[n]; py[i] = py[n]; vx[i] = vx[n]; vy[i] = vy[n];
              life[i] = life[n]; life0[i] = life0[n]; kind[i] = kind[n]; col[i] = col[n]; size[i] = size[n];
            }
            i--;
            continue;
          }
          vy[i] += K.g * dt;
          if (K.drag) { d = 1 - K.drag * dt; if (d < 0) d = 0; vx[i] *= d; vy[i] *= d; }
          px[i] += (vx[i] + (K.sway ? Math.sin(clock * 1.7 + i * 2.4) * K.sway : 0)) * dt;
          py[i] += vy[i] * dt;
        }
      },

      draw: function (g) {
        var P = R.Pal.hex, i, last = -1, s;
        for (i = 0; i < n; i++) {
          if (col[i] !== last) { last = col[i]; g.fillStyle = P[last]; }
          s = size[i] === 2 && life[i] > life0[i] * 0.35 ? 2 : 1;
          g.fillRect(px[i] | 0, py[i] | 0, s, s);
        }
      },

      // Removes every particle and stops the ambient emitters.
      clear: function () {
        n = 0; cursor = 0;
        amb.ash.rate = amb.ash.acc = 0; amb.ember.rate = amb.ember.acc = 0;
      }
    };
    return fx;
  }

  R.FX = { create: create, KINDS: KINDS };
})(globalThis.RIVAL = globalThis.RIVAL || {});
