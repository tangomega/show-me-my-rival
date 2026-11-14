// PLACEHOLDER — replaced by the pixel artist
// Programmer art: fighters are fillRect puppets; frame counts and durations are the real ones (DESIGN 13.3).
(function (R) {
  'use strict';

  var P = R.Pal.hex;
  var WHITE = false;                       // current draw is a white-flash frame
  function c(i) { return P[WHITE ? 23 : i]; }

  // ---- animation tables -------------------------------------------------------------------
  function rep(n, ms) { var a = []; while (n--) a.push(ms); return a; }
  // extra (not in the contract): loopFrom = first frame of the looping tail, contact = contact frame index
  function A(dur, loop, loopFrom, contact) {
    var t = 0, tail = 0, i;
    for (i = 0; i < dur.length; i++) { t += dur[i]; if (loopFrom && i >= loopFrom) tail += dur[i]; }
    return { n: dur.length, dur: dur, loop: !!loop, total: t, loopFrom: loopFrom || 0, tail: tail, contact: contact === undefined ? -1 : contact };
  }
  function table(who) {
    var rv = who !== 'player', r2 = who === 'rival2';
    var t = {
      idle: A(r2 ? rep(6, 160) : rep(4, rv ? 260 : 220), true),
      tell_S: A([80, 80, 120, 380, 380], true, 3),
      tell_G: A([80, 80, 120, 380, 380], true, 3),
      tell_F: A([80, 80, 120, 380, 380], true, 3),
      strike: A([70, 70, 60, 80, 100], false, 0, 3),
      guard: A([80, 120, 120, 60], false, 0, 2),
      feint: A([50, 50, 50, 50, 80, 100], false, 0, 4),
      hit: A([50, 90, 110]),
      stagger: A([60, 80, 120, 120, 120, 300, 300], true, 5),
      clash: A([50, 70, 100, 100]),
      death: A(r2 ? rep(11, 90).concat([400]) : rv ? [80, 80, 100, 120, 120, 160, 300] : [80, 80, 100, 120, 140, 160, 200, 400]),
      taunt: A(rv ? rep(12, 110) : rep(4, 120)),
      taunt2: A(rv ? [100, 100, 140, 100, 160] : rep(4, 120)),
      victory: A([120, 120, 160, 160, 200, 400])
    };
    if (who === 'rival') t.transform = A(rep(10, 100));
    return t;
  }
  var ANIMS = { player: table('player'), rival: table('rival'), rival2: table('rival2') };

  function anim(who, name) { var t = ANIMS[who]; return (t && t[name]) || null; }

  // Clamps to the last frame once ms >= total (the contract: scenes do their own modulo for loops).
  function frameAt(a, ms) {
    if (!a) return 0;
    var d = a.dur, n = a.n, i;
    if (!(ms > 0)) return 0;
    for (i = 0; i < n; i++) { if (ms < d[i]) return i; ms -= d[i]; }
    return n - 1;
  }

  // ---- pose (one reused object) -----------------------------------------------------------
  // forward-facing space: +x = toward the opponent. sa = sword angle in degrees (0 level forward, -90 up, 90 down).
  var S = { ox: 0, oy: 0, cr: 0, ln: 0, wd: 0, sa: 0, hx: 0, hy: 0, off: 0, alt: 0, gl: 0, fade: 0, arc: 0, daze: 0, white: false, r2: false };
  var CLASH_X = [-1, -4, -3, -1], FLICK = [35, -10, 60, 35];

  function pose(who, name, f) {
    var rv = who !== 'player', k, n;
    S.ox = 0; S.oy = 0; S.cr = 0; S.ln = 0; S.wd = 0; S.sa = 35; S.hx = 5; S.hy = 0;
    S.off = 0; S.alt = 0; S.gl = 0; S.fade = 0; S.arc = 0; S.daze = 0; S.white = false; S.r2 = who === 'rival2';
    switch (name) {
      case 'idle':
        S.cr = (f === 1 || f === 2) ? 1 : 0; if (rv && f === 3) S.ln = 1;
        if (S.r2) S.oy = (f % 3 === 1) ? -1 : 0;
        break;
      case 'tell_S':                                    // tallest: sword overhead-back
        k = Math.min(f, 2) / 2; S.sa = 35 - 145 * k; S.ln = -2 * k; S.wd = 2 * k; S.hy = -5 * k; S.hx = 5 - 4 * k;
        if (f === 4) S.gl = 19; break;
      case 'tell_G':                                    // narrowest: vertical blade in front
        k = Math.min(f, 2) / 2; S.sa = 35 - 125 * k; S.hx = 5 + 2 * k; S.wd = -2 * k; S.off = k === 1 ? 1 : 0;
        if (f === 4) S.gl = 28; break;
      case 'tell_F':                                    // widest and lowest: blade reversed behind the hip
        k = Math.min(f, 2) / 2; S.cr = 6 * k; S.wd = 6 * k; S.sa = 35 + 115 * k; S.hx = 5 - 9 * k; S.hy = 3 * k; S.off = k === 1 ? 2 : 0;
        if (f === 4) S.gl = 30; break;
      case 'strike':
        if (f === 0) { S.sa = -110; S.ln = -1; S.hy = -5; S.hx = 1; }
        else if (f === 1) { S.sa = -35; S.ox = 3; S.hy = -3; }
        else if (f === 2) { S.sa = 0; S.ox = 6; S.wd = 3; }
        else if (f === 3) { S.sa = 40; S.ox = 9; S.wd = 5; S.ln = 2; S.arc = 1; }
        else { S.sa = 45; S.ox = 5; S.wd = 3; S.ln = 1; }
        break;
      case 'guard':
        if (f === 0) { S.sa = -60; S.hx = 6; }
        else if (f === 1) { S.sa = -90; S.hx = 7; S.off = 1; }
        else if (f === 2) { S.sa = -90; S.hx = 7; S.off = 1; S.cr = 2; S.gl = 28; }
        else { S.sa = -45; S.hx = 6; }
        break;
      case 'feint':
        if (f < 2) { S.sa = -70; S.hy = -4; S.ox = 1 + f; }
        else if (f === 2) { S.cr = 5; S.sa = 20; S.ox = 2; }
        else if (f === 3) { S.cr = 5; S.ox = 5; S.sa = 150; S.hx = -4; S.wd = 3; if (S.r2) S.fade = 0.8; }
        else if (f === 4) { S.cr = 4; S.ox = 10; S.sa = 8; S.hx = 8; S.wd = 6; S.arc = 2; }
        else { S.cr = 2; S.ox = 5; S.sa = 20; S.wd = 3; }
        break;
      case 'hit':
        S.ox = f === 2 ? -1 : -2; S.ln = f === 2 ? 0 : -2; S.white = f === 0; S.sa = 60; if (rv) S.off = 5;
        break;
      case 'stagger':
        if (f === 0) { S.ox = -1; S.sa = -150; }
        else if (f === 1) { S.ox = -3; S.sa = -170; S.cr = 2; }
        else { S.ox = -3; S.cr = 6; S.sa = 170; S.ln = -1; S.wd = 3; if (f >= 5) S.daze = f - 4; }
        break;
      case 'clash':
        S.ox = CLASH_X[f] || 0; S.sa = -25; S.hx = 7; break;
      case 'death':
        n = ANIMS[who].death.n;
        S.cr = Math.min(8, f * 2); S.ln = Math.min(3, f); S.sa = 80; S.hy = Math.min(6, f * 2);
        S.fade = f >= n - 4 ? Math.min(1, (f - (n - 5)) / 4) : 0;
        break;
      case 'taunt':
        if (rv) { S.off = 4; S.alt = f & 1; S.sa = 80; S.hx = 2; } else { S.ln = 1; S.cr = (f === 1 || f === 2) ? 1 : 0; }
        break;
      case 'taunt2':
        if (rv) { S.off = 3; S.alt = f & 1; S.ln = f === 2 ? 2 : 0; S.sa = 80; S.hx = 2; } else S.sa = FLICK[f] || 35;
        break;
      case 'victory':
        if (rv) { k = Math.min(f, 3); S.ln = k * 2; S.cr = k; S.off = 2; S.sa = 150; S.hx = -3; if (S.r2) { S.oy = -Math.min(6, f * 2); S.ln = 0; S.cr = 0; } }
        else { S.sa = 90; S.hx = 8; if (f >= 2) { S.cr = 6; S.wd = 2; S.hy = -4; } }
        break;
      case 'transform':                                 // kneel -> hand on mask -> shatter (white) -> rise as rival2
        if (f < 3) { S.cr = 3 + f * 1.5; S.off = 5; S.sa = 80; }
        else if (f < 5) { S.cr = 6; S.off = 5; S.white = true; S.sa = 80; }
        else { S.r2 = true; S.cr = Math.max(0, 9 - f) * 1.5; S.oy = 3 - Math.min(3, f - 5); S.sa = 35 - (f - 5) * 6; }
        break;
    }
  }

  // ---- drawing helpers --------------------------------------------------------------------
  var G = null, CX = 0, D = 1;             // current context, centre x, facing (+1 right / -1 left)
  function r(x, y, w, h, col) {            // rect in forward-facing space
    G.fillStyle = c(col);
    G.fillRect(D > 0 ? CX + x : CX - x - w, y, w, h);
  }
  function line(x0, y0, x1, y1, t, col) {  // stepped line of t x t squares
    var dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy)) | 0, i;
    if (n < 1) n = 1;
    for (i = 0; i <= n; i++) r(Math.round(x0 + dx * i / n), Math.round(y0 + dy * i / n), t, t, col);
  }

  // x, y = feet centre. All fighters face RIGHT; opts.flip mirrors. opts: { flip, mask:id, white:bool, alpha }
  function fighter(g, who, name, frame, x, y, opts) {
    var rv = who !== 'player', r2, a, cr, legH, bodyH, hipY, topY, headY, ln, wd, sx, sy, hx, hy, rad, L, tx, ty, i, mask, t;
    if (!ANIMS[who]) who = 'player';
    if (!ANIMS[who][name]) name = 'idle';
    pose(who, name, frame | 0);
    r2 = S.r2;
    a = (opts && opts.alpha !== undefined ? opts.alpha : 1) * (1 - S.fade);
    if (a <= 0.02) return;
    WHITE = S.white || !!(opts && opts.white);
    G = g; D = opts && opts.flip ? -1 : 1;                       // authored facing right; flip mirrors around x
    CX = Math.round(x) + Math.round(S.ox) * D;
    y = Math.round(y + S.oy) - (r2 ? 3 : 0);
    g.globalAlpha = a;

    cr = Math.round(S.cr); ln = Math.round(S.ln); wd = Math.round(S.wd);
    legH = Math.max(3, (rv ? 13 : 10) - cr);
    bodyH = rv ? 17 : 13;
    hipY = y - legH; topY = hipY - bodyH; headY = topY - (rv ? 8 : 7);

    // legs (or phase-2 tendrils)
    if (r2) {
      t = R.Engine ? R.Engine.real * 5 : frame;
      for (i = 0; i < 4; i++) r(-6 + i * 3 + Math.round(Math.sin(t + i * 1.7)), hipY - 1, 2, legH + 2 + ((i * 2 + (frame | 0)) % 3), i & 1 ? 29 : 16);
    } else {
      r(-4 - (wd >> 1), hipY, 3, legH, rv ? 1 : 13);
      r(1 + wd, hipY, 3, legH, rv ? 1 : 13);
      if (cr >= 6) r(1 + wd, y - 2, 6, 2, rv ? 1 : 13);          // kneeling shin
    }
    // cloak + torso
    r(-6 + (ln >> 1), topY + 5, rv ? 11 : 13, bodyH - 3, rv ? 16 : 15);
    r(-5 + ln, topY, rv ? 9 : 10, bodyH - 3, rv ? 17 : 14);
    if (rv) r(1 + ln, topY + 1, 2, 2, 25);                         // brass clasp
    else { r(-7, hipY + 1, 2, 3, 14); r(-3, hipY + 2, 2, 3, 15); r(2, hipY + 1, 2, 2, 14); }   // ragged tongues
    // head
    if (rv) {
      mask = (opts && opts.mask) || 'porcelain';
      r(-4 + ln, headY - 2, 9, 3, 17);                             // high collar behind the mask
      r(-3 + ln, headY, 7, 8, 10); r(-3 + ln, headY, 2, 8, 11);
      if (r2) { r(-3 + ln, headY, 3, 8, 1); r(-2 + ln, headY + 3, 1, 3, 31); }       // shattered half + witchfire eye
      else if (mask === 'jester') r(-3 + ln, headY, 3, 8, 1);
      if (mask !== 'blank') {
        r(2 + ln, headY + 3, 2, 1, 1); if (!r2) r(-1 + ln, headY + 3, 2, 1, 1);      // slit eyes
        if (mask === 'mourner') { r(0 + ln, headY + 5, 4, 1, 18); r(2 + ln, headY + 4, 1, 2, 28); }
        else r(-1 + ln, headY + 6, 5, 1, 18);                                        // the smile, one pixel too wide
        if (mask === 'kintsugi') { r(1 + ln, headY, 1, 3, 25); r(0 + ln, headY + 3, 1, 3, 25); }
      }
    } else {
      r(-4 + ln, headY, 9, 8, 14); r(-4 + ln, headY, 3, 8, 15);                      // hood
      r(0 + ln, headY + 2, 4, 5, 1); r(2 + ln, headY + 6, 1, 1, 8);                  // void face, chin glint
    }
    // sword arm + sword
    sx = 2 + ln; sy = topY + 3;
    hx = sx + Math.round(S.hx); hy = sy + 5 + Math.round(S.hy);
    rad = S.sa * Math.PI / 180; L = rv ? 17 : 13;
    tx = hx + Math.round(Math.cos(rad) * L); ty = hy + Math.round(Math.sin(rad) * L);
    line(sx, sy, hx, hy, 2, rv ? 1 : 11);
    line(hx, hy, tx, ty, 1, 9);
    if (!rv) line(hx, hy + 1, hx + Math.round(Math.cos(rad) * (L - 3)), hy + 1 + Math.round(Math.sin(rad) * (L - 3)), 1, 8);
    else if (r2) r(tx, ty, 1, 1, 31);
    r(hx - 1, hy - 1, 3, 3, rv ? 25 : 13);                                           // guard / grip
    // off arm
    if (S.off === 1) line(sx - 3, sy + 1, (hx + tx) >> 1, (hy + ty) >> 1, 2, rv ? 1 : 14);
    else if (S.off === 2) { line(sx - 2, sy + 1, sx + 7, sy + 2, 2, rv ? 1 : 14); r(sx + 8, sy, 2, 5, rv ? 1 : 11); }
    else if (S.off === 3) { line(sx - 2, sy + 1, sx + 5 + S.alt, sy - 5, 2, 1); r(sx + 5 + S.alt * 2, sy - 9, 1, 4, 1); }
    else if (S.off === 4) { r(sx + 2 - S.alt, sy + 3, 3, 3, 1); r(sx + 6 + S.alt * 2, sy + 3, 3, 3, 1); }
    else if (S.off === 5) line(sx - 2, sy + 1, 2 + ln, headY + 4, 2, 1);
    else if (!rv) r(-6, topY + 4, 2, 6, 15);
    // extras
    if (S.gl) {
      if (S.gl === 19) r(tx - 1, ty - 1, 3, 3, 19);
      else if (S.gl === 28) r(hx - 2, hy - 2, 5, 5, 28);
      else r(sx + 8, sy + 1, 3, 3, 30);
    }
    if (S.arc === 1) { r(8, topY - 6, 5, 2, 23); r(13, topY - 3, 3, 4, 23); r(15, topY + 2, 2, 6, r2 ? 31 : 22); r(12, topY + 9, 3, 3, 23); }
    else if (S.arc === 2) { r(tx - 6, ty, 10, 1, 23); r(tx - 2, ty - 1, 5, 1, r2 ? 31 : 30); }
    if (S.daze) { r(S.daze === 1 ? -4 : 2, headY - 5, 2, 2, 22); r(S.daze === 1 ? 4 : -2, headY - 7, 1, 1, 23); }
    g.globalAlpha = 1; WHITE = false;
  }

  // ---- icons, sprites, sigil --------------------------------------------------------------
  function b(g, x, y, u, bx, by, bw, bh, col) { g.fillStyle = P[col]; g.fillRect(x + bx * u, y + by * u, bw * u, bh * u); }

  function icon(g, m, x, y, u) {           // 10x10 at u = 1
    var i;
    if (m === 'S') {
      for (i = 0; i < 6; i++) b(g, x, y, u, 3 + i, 6 - i, 2, 1, i >= 4 ? 19 : 9);
      for (i = 0; i < 4; i++) b(g, x, y, u, 4 + i, 6 - i, 1, 1, 8);
      b(g, x, y, u, 1, 5, 2, 1, 25); b(g, x, y, u, 3, 7, 2, 1, 25); b(g, x, y, u, 2, 6, 1, 1, 25);
      b(g, x, y, u, 1, 7, 1, 1, 13); b(g, x, y, u, 0, 8, 1, 1, 13);
    } else if (m === 'G') {
      b(g, x, y, u, 1, 1, 8, 5, 27); b(g, x, y, u, 2, 6, 6, 2, 27); b(g, x, y, u, 3, 8, 4, 1, 27); b(g, x, y, u, 4, 9, 2, 1, 27);
      b(g, x, y, u, 4, 1, 2, 8, 28); b(g, x, y, u, 1, 1, 8, 1, 28);
    } else {
      b(g, x, y, u, 3, 0, 3, 1, 30); b(g, x, y, u, 1, 1, 3, 1, 30); b(g, x, y, u, 1, 2, 2, 1, 30); b(g, x, y, u, 0, 3, 2, 3, 30);
      b(g, x, y, u, 1, 6, 2, 1, 30); b(g, x, y, u, 1, 7, 3, 1, 30); b(g, x, y, u, 3, 8, 3, 1, 30);
      b(g, x, y, u, 4, 4, 1, 1, 29); b(g, x, y, u, 6, 4, 1, 1, 30); b(g, x, y, u, 8, 4, 1, 1, 29);
    }
  }
  function mini(g, m, x, y) {              // 6x6
    var i;
    if (m === 'S') { for (i = 0; i < 6; i++) b(g, x, y, 1, i, 5 - i, 1, 1, i >= 4 ? 19 : 9); b(g, x, y, 1, 0, 3, 2, 1, 25); }
    else if (m === 'G') { b(g, x, y, 1, 0, 0, 6, 3, 27); b(g, x, y, 1, 1, 3, 4, 2, 27); b(g, x, y, 1, 2, 5, 2, 1, 27); b(g, x, y, 1, 2, 0, 2, 5, 28); }
    else { b(g, x, y, 1, 1, 0, 3, 1, 30); b(g, x, y, 1, 0, 1, 2, 4, 30); b(g, x, y, 1, 1, 5, 3, 1, 30); b(g, x, y, 1, 4, 3, 1, 1, 29); }
  }

  // Static sprites as flat [x, y, w, h, colour, ...] lists.
  var MASK = [1, 0, 10, 14, 10, 0, 2, 12, 10, 10, 0, 2, 2, 10, 11, 2, 5, 3, 1, 1, 7, 5, 3, 1, 1];
  var SMILE = [2, 10, 8, 1, 18, 1, 9, 1, 1, 18, 10, 9, 1, 1, 18];
  var RECTS = {
    st_guardBroken: [1, 0, 6, 4, 27, 2, 4, 4, 2, 27, 3, 6, 2, 1, 27, 1, 0, 2, 1, 28, 4, 0, 1, 2, 1, 3, 2, 1, 2, 1, 4, 4, 1, 3, 1],
    st_bleed: [3, 0, 2, 2, 19, 2, 2, 4, 2, 19, 1, 4, 6, 3, 18, 2, 7, 4, 1, 18, 2, 4, 1, 2, 23],
    st_fortify: [0, 1, 8, 6, 6, 0, 1, 8, 1, 8, 0, 6, 8, 1, 4, 0, 4, 8, 1, 4, 3, 2, 1, 2, 4, 5, 5, 1, 1, 4],
    st_focus: [1, 3, 6, 3, 21, 2, 2, 4, 5, 21, 3, 0, 2, 2, 22, 3, 3, 2, 3, 1],
    st_sealed: [2, 0, 4, 8, 17, 1, 1, 6, 6, 17, 0, 3, 8, 2, 17, 3, 3, 2, 2, 16, 2, 1, 2, 1, 18],
    lock: [2, 0, 4, 1, 8, 1, 1, 1, 3, 8, 6, 1, 1, 3, 8, 0, 3, 8, 5, 25, 0, 7, 8, 1, 24, 3, 5, 2, 2, 1],
    act_glimpse: [2, 4, 8, 4, 10, 1, 5, 10, 2, 10, 4, 3, 4, 6, 10, 5, 4, 2, 4, 27, 5, 5, 2, 2, 1],
    act_honesty: [1, 6, 2, 2, 28, 3, 8, 2, 2, 28, 5, 6, 2, 2, 28, 7, 4, 2, 2, 28, 9, 2, 2, 2, 28],
    act_coin: [3, 1, 6, 10, 25, 1, 3, 10, 6, 25, 4, 2, 4, 8, 22, 5, 4, 2, 4, 24],
    bonfire_player: [10, 6, 10, 9, 14, 10, 6, 4, 9, 15, 15, 9, 4, 5, 1, 17, 13, 1, 1, 8, 6, 15, 18, 11, 14, 6, 15, 6, 11, 15, 8, 26, 20, 4, 13, 24, 22, 4, 6, 13],
    bonfire_rival: [12, 2, 8, 9, 10, 18, 2, 2, 9, 11, 13, 5, 2, 1, 1, 16, 5, 2, 1, 1, 13, 8, 5, 1, 18, 10, 11, 12, 13, 17, 16, 11, 6, 13, 16, 4, 22, 22, 4, 1, 4, 24, 4, 6, 1, 6, 16, 6, 2, 1, 2, 28, 28, 4, 5],
    title_mask: [8, 2, 48, 60, 11, 2, 10, 60, 40, 11, 10, 4, 44, 56, 10, 4, 12, 56, 36, 10, 14, 26, 14, 3, 1, 36, 26, 14, 3, 1, 16, 46, 32, 3, 18, 12, 43, 5, 3, 18, 47, 43, 5, 3, 18],
    mask_porcelain: MASK.concat(SMILE),
    mask_mourner: MASK.concat([3, 10, 6, 1, 18, 2, 11, 1, 1, 18, 9, 11, 1, 1, 18, 8, 6, 1, 3, 28]),
    mask_jester: MASK.concat([1, 0, 5, 2, 1, 0, 2, 6, 10, 1, 1, 12, 5, 2, 1, 2, 5, 3, 1, 10, 6, 10, 4, 1, 18]),
    mask_kintsugi: MASK.concat(SMILE, [6, 0, 1, 4, 25, 5, 4, 1, 3, 25, 6, 7, 1, 3, 25, 7, 10, 1, 4, 25]),
    mask_blank: MASK.slice(0, 15)
  };
  var TAGS = { RIP: ['R', 19], TEN: ['T', 21], BLD: ['B', 18], TRK: ['K', 30], GMB: ['G', 25], INF: ['I', 28], CHA: ['C', 20], EXE: ['E', 9], relic: ['\u2665', 22] };
  var RAR = { rar_common: [1, 7], rar_uncommon: [2, 25], rar_rare: [3, 30] };
  var MOVE_OF = { icon_S: 'S', icon_G: 'G', icon_F: 'F', icon_S_big: 'S', icon_G_big: 'G', icon_F_big: 'F', mini_S: 'S', mini_G: 'G', mini_F: 'F' };

  // x, y = top-left. Unknown names draw nothing. Names: the list in INTERFACES.md ("Art conventions").
  function sprite(g, name, x, y, opts) {
    x = Math.round(x); y = Math.round(y);
    var m = MOVE_OF[name], list = RECTS[name], i, t;
    if (m) {
      if (name.length > 6) icon(g, m, x, y, 2);
      else if (name.charAt(0) === 'm') mini(g, m, x, y);
      else icon(g, m, x, y, 1);
    } else if (list) {
      for (i = 0; i < list.length; i += 5) b(g, x, y, 1, list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]);
      if (name === 'title_mask' && opts && opts.frame) { b(g, x, y, 1, 9, 40, 4, 3, 18); b(g, x, y, 1, 51, 40, 4, 3, 18); }
    } else if (name === 'logo') {                             // 120x34 two-line wordmark
      R.Font.draw(g, 'SHOW ME MY', x + 60, y, 8, CENTER);
      R.Font.draw(g, 'RIVAL', x + 60, y + 10, 10, CENTER3);
      b(g, x, y, 1, 20, 32, 80, 2, 18);
    } else if (RAR[name]) {
      for (i = 0; i < RAR[name][0]; i++) b(g, x, y, 1, i * 4, 0, 3, 3, RAR[name][1]);
    } else if (name.lastIndexOf('tag_', 0) === 0 && (t = TAGS[name.slice(4)])) {
      b(g, x, y, 1, 0, 0, 12, 12, 1); b(g, x, y, 1, 1, 1, 10, 10, t[1]); b(g, x, y, 1, 2, 2, 8, 8, 2);
      R.Font.draw(g, t[0], x + 6, y + 3, t[1], CENTER);
    }
  }
  var CENTER = { align: 'center' }, CENTER3 = { align: 'center', scale: 3 };

  function disc(g, x, y, s, col) {         // s = 16 or 14
    g.fillStyle = P[col];
    g.fillRect(x + 4, y, s - 8, s); g.fillRect(x + 2, y + 1, s - 4, s - 2); g.fillRect(x + 1, y + 2, s - 2, s - 4); g.fillRect(x, y + 4, s, s - 8);
  }
  // x, y = top-left of the 16x16 box. state: 'sealed'|'crack'|'open'|'gone'
  function sigil(g, x, y, state, move, side) {
    x = Math.round(x); y = Math.round(y);
    if (state === 'gone' || !state) return;
    var pl = side === 'p', mc;
    if (state === 'open') {
      mc = R.Pal.move[move] || R.Pal.move.S;
      disc(g, x, y, 16, mc[1]); disc(g, x + 1, y + 1, 14, 2);
      if (R.Pal.move[move]) icon(g, move, x + 3, y + 3, 1);
      return;
    }
    disc(g, x, y, 16, pl ? 15 : 16); disc(g, x + 1, y + 1, 14, pl ? 14 : 17);
    b(g, x, y, 1, 5, 4, 6, 7, 11); b(g, x, y, 1, 6, 6, 1, 1, 1); b(g, x, y, 1, 9, 6, 1, 1, 1); b(g, x, y, 1, 6, 9, 4, 1, 18);   // mask glyph
    if (state === 'crack') {
      b(g, x, y, 1, 8, 0, 1, 3, 23); b(g, x, y, 1, 7, 3, 1, 3, 23); b(g, x, y, 1, 8, 6, 1, 2, 23); b(g, x, y, 1, 9, 8, 1, 3, 23);
      b(g, x, y, 1, 8, 11, 1, 3, 23); b(g, x, y, 1, 7, 14, 1, 2, 23); b(g, x, y, 1, 6, 5, 1, 1, 22); b(g, x, y, 1, 10, 9, 1, 1, 22);
    }
  }

  R.Art = R.Art || {};
  R.Art.init = function () { /* placeholder art draws directly; nothing to cache */ };
  R.Art.anim = anim;
  R.Art.frameAt = frameAt;
  R.Art.fighter = fighter;
  R.Art.sprite = sprite;
  R.Art.sigil = sigil;
})(globalThis.RIVAL = globalThis.RIVAL || {});
