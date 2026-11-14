// SHOW ME MY RIVAL — seeded RNG + shared move constants. Pure (runs under Node).
(function (R) {
  'use strict';

  R.MOVES = ['S', 'G', 'F'];
  R.BEATS = { S: 'F', G: 'S', F: 'G' };      // key beats value
  R.LOSES_TO = { S: 'G', G: 'F', F: 'S' };   // key loses to value

  function create(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    var rng = {
      next: function () {                     // mulberry32
        s = (s + 0x6d2b79f5) >>> 0;
        var t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int: function (n) { return Math.floor(rng.next() * n); },
      range: function (a, b) { return a + rng.next() * (b - a); },
      chance: function (p) { return rng.next() < p; },
      pick: function (arr) { return arr[Math.floor(rng.next() * arr.length)]; },
      weighted: function (w) {
        var total = 0, i;
        for (i = 0; i < w.length; i++) total += w[i] > 0 ? w[i] : 0;
        if (!(total > 0)) return Math.floor(rng.next() * w.length);
        var r = rng.next() * total;
        for (i = 0; i < w.length; i++) {
          if (w[i] > 0) { r -= w[i]; if (r < 0) return i; }
        }
        return w.length - 1;
      },
      shuffle: function (arr) {
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(rng.next() * (i + 1));
          var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
      },
      state: function () { return s >>> 0; },
      setState: function (u) { s = u >>> 0; }
    };
    return rng;
  }

  function hash(str) {                        // FNV-1a
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  R.RNG = { create: create, hash: hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
