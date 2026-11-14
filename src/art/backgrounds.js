// PLACEHOLDER — replaced by the pixel artist
// Flat backdrops made of fillRects. Art is anchored to opts.floorY (default: R.Engine.lay.floorY).
(function (R) {
  'use strict';

  var P = R.Pal.hex;
  var CANDLES = [14, 120, 40, 128, 88, 116, 96, 118, 140, 128, 166, 120];   // arena-relative x, y pairs
  var PILLARS = [8, 46, 122, 160];

  function f(g, x, y, w, h, col) { g.fillStyle = P[col]; g.fillRect(x, y, w, h); }
  function dims() {
    var E = R.Engine;
    return E && E.lay ? E : { W: 180, H: 320, lay: { arenaY: 34, arenaH: 170, floorY: 172 } };
  }
  // 3x5 flame with a cheap per-candle flicker; gutter 0..1 shrinks it.
  function flame(g, x, y, t, i, gutter, col) {
    var fr = ((t * 7 + i * 2.3) | 0) % 3, h = gutter > 0.5 ? 2 : 5 - (fr === 2 ? 1 : 0);
    if (gutter <= 0.5) { g.fillStyle = P[col]; g.globalAlpha = 0.25; g.fillRect(x - 3, y - 7, 9, 9); g.globalAlpha = 1; }
    f(g, x, y - h, 3, h, col); f(g, x + 1, y - h + 1, 1, Math.max(1, h - 2), col === 31 ? 23 : 22);
    if (fr === 1 && gutter <= 0.5) f(g, x + 1, y - h - 1, 1, 1, col);
    f(g, x, y, 3, 4, 11); f(g, x - 1, y + 4, 5, 1, 24);
  }

  // name: 'cathedral' | 'bonfire' | 'title'. t = seconds. Paints the whole buffer.
  // opts: { floorY, variant:1..7, gutter:0..1, phase2:bool, arena:'cathedral'|'blood_moon'|'pale_dawn' }
  function bg(g, name, t, opts) {
    var E = dims(), W = E.W, H = E.H, L = E.lay, i, oy, fl, col, n, gut = opts && opts.gutter ? opts.gutter : 0, p2 = !!(opts && opts.phase2);
    var floorY = opts && opts.floorY > 0 ? opts.floorY : 0, arena = opts && opts.arena, moon = arena === 'blood_moon' ? 17 : arena === 'pale_dawn' ? 12 : 27;
    f(g, 0, 0, W, H, 1);
    if (name === 'bonfire') {
      fl = floorY || L.floorY;
      f(g, 0, 0, W, fl - 60, 2); f(g, 0, fl - 60, W, 60, 3); f(g, 0, fl, W, H - fl, 15);
      for (i = 0; i < 5; i++) f(g, 6 + i * 40, fl - 70, 10, 70, 4);                 // cloister columns
      f(g, 70, fl - 16, 40, 16, 5); f(g, 74, fl - 22, 32, 6, 5); f(g, 76, fl - 12, 28, 12, 1);   // the bell
      g.fillStyle = P[21]; g.globalAlpha = 0.18; g.fillRect(70, fl - 34, 40, 24); g.globalAlpha = 1;
      i = ((t * 10) | 0) % 6;
      f(g, 82, fl - 8 - (i % 3), 16, 8 + (i % 3), 20); f(g, 85, fl - 12 - (i % 2) * 2, 10, 10, 21); f(g, 88, fl - 9 - (i % 3), 4, 7, 22);
      return;
    }
    if (name === 'title') {
      fl = floorY || Math.round(H * 0.62);
      f(g, 0, 0, W, fl, 2); f(g, 0, fl, W, H - fl, 3); f(g, 0, fl, W, 1, 5);
      for (i = 0; i < 24; i++) f(g, (i * 53) % W, fl + 3 + ((i * 17) % Math.max(1, H - fl - 6)), 3 + (i % 3), 1, i & 1 ? 5 : 7);   // ash
      flame(g, 132, fl - 2, t, 0, 0, 21);
      return;
    }
    // cathedral
    oy = (floorY || L.floorY) - 138;                       // arena-relative y -> screen y
    col = p2 ? 31 : 21;
    f(g, 0, 0, W, oy + 20, 2); f(g, 0, oy + 20, W, 118, 3);
    f(g, 70, oy + 8, 40, 40, arena === 'blood_moon' ? 16 : 26); f(g, 74, oy + 12, 32, 32, moon); f(g, 89, oy + 8, 2, 40, 3); f(g, 70, oy + 27, 40, 2, 3);   // rose window
    g.fillStyle = P[arena === 'blood_moon' ? 18 : arena === 'pale_dawn' ? 22 : 28]; g.globalAlpha = 0.10; g.fillRect(78, oy + 48, 30, 90); g.globalAlpha = 1;                            // moonbeam
    for (i = 0; i < 4; i++) { f(g, PILLARS[i], 0, 12, oy + 138, 5); f(g, PILLARS[i], 0, 3, oy + 138, 6); f(g, PILLARS[i] - 2, oy + 132, 16, 6, 4); }
    f(g, 0, oy + 138, W, H - oy - 138, 13);                // flagstones
    f(g, 0, oy + 138, W, 1, 12);
    for (i = 0; i < 6; i++) f(g, i * 34 - 6, oy + 146 + (i % 2) * 9, 22, 1, 14);
    f(g, 0, oy + 162, W, H, 15);
    n = opts && opts.variant > 2 ? Math.max(3, 8 - opts.variant) : 6;   // later duels burn fewer candles
    for (i = 0; i < n; i++) flame(g, CANDLES[i * 2], oy + CANDLES[i * 2 + 1], t, i, gut, col);
  }

  // Foreground layer drawn over the fighters.
  function fg(g, name, t, opts) {
    var E = dims(), W = E.W, L = E.lay, i, y, x, bottom, top, span;
    if (name !== 'cathedral') return;
    bottom = (opts && opts.floorY > 0 ? opts.floorY : L.floorY) + 32; top = L.arenaY; span = Math.max(40, bottom - top);
    f(g, 0, bottom - 34, 9, 34, 1); f(g, 9, bottom - 22, 7, 22, 1);          // pew silhouette, left edge
    g.fillStyle = P[1];
    for (y = 0; y < 6; y++) for (x = (y & 1); x < W; x += 2 + (5 - y)) g.fillRect(x, bottom - 1 - y, 1, 1);   // bottom vignette
    for (i = 0; i < 20; i++) {                                                 // stateless ash fall, 8-14 px/s
      y = top + ((i * 53 + t * (8 + (i % 7))) % span);
      x = (i * 37 + Math.sin(t * 0.6 + i) * 5 + 180) % W;
      g.fillStyle = P[i & 1 ? 7 : 8]; g.fillRect(x | 0, y | 0, 1, 1);
    }
  }

  R.Art = R.Art || {};
  R.Art.bg = bg;
  R.Art.fg = fg;
})(globalThis.RIVAL = globalThis.RIVAL || {});
