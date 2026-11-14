// SHOW ME MY RIVAL - engine test scene ('enginetest'). Exercises the engine, font, UI, FX and placeholder art.
// Not part of the game: delete this file once the real scenes exist.
(function (R) {
  'use strict';

  var E = R.Engine, F = R.Font, UI = R.UI, A = R.Art, P = R.Pal.hex;
  var RV = { flip: true, mask: 'porcelain' }, BGO = { floorY: 0, variant: 1, gutter: 0, phase2: false, arena: 'cathedral' };
  var BAR_P = { ticks: 12 }, BAR_R = { ticks: 9, flip: true }, P2 = { phase2: true };
  var ST = ['st_guardBroken', 'st_bleed', 'st_fortify', 'st_focus', 'st_sealed', 'lock', 'rar_common', 'rar_uncommon', 'rar_rare'];
  var TAG = ['tag_RIP', 'tag_TEN', 'tag_BLD', 'tag_TRK', 'tag_GMB', 'tag_INF', 'tag_CHA', 'tag_EXE', 'tag_relic', 'act_glimpse', 'act_honesty', 'act_coin'];
  var NAMES = ['idle', 'tell_S', 'tell_G', 'tell_F', 'strike', 'guard', 'feint', 'hit', 'stagger', 'clash', 'death', 'taunt', 'taunt2', 'victory', 'transform'];
  var NUM = []; for (var q = 0; q < 32; q++) NUM.push(String(q));
  var MOVES = ['S', 'G', 'F'], LABELS = ['STRIKE', 'GUARD', 'FEINT'], BX = [4, 62, 120];
  var SIGIL = ['sealed', 'crack', 'open', 'open', 'open', 'gone'], SIGIL_MOVE = ['S', 'S', 'S', 'G', 'F', 'S'];
  var TEXTS = [
    'You open with Strike 61% of the time. I wrote it down. Twice.',
    'Wrapping test: an overlongwordthatmustbehardbrokensomewhere, then calm.',
    'Tap STRIKE, GUARD or FEINT. Keys 1/2/3 work too; Esc restarts the scene.'
  ];
  var RIGHT = { align: 'right' }, CENTER = { align: 'center', shadow: 1 }, SH = { shadow: 1 }, BIG = { scale: 2, shadow: 1 };
  var BTN = [{ pressed: false, icon: 'S', accent: 19 }, { pressed: false, icon: 'G', accent: 28, glow: true }, { pressed: false, icon: 'F', accent: 30 }];
  var EMBER_AREA = { x: 80, y: 0, w: 20, h: 40 };
  var UPLEFT = { dir: -2.4, spread: 1.2 }, UPRIGHT = { dir: -0.8, spread: 1.2 };

  var fx = null, idx = 0, t = 0, who2 = 'rival', runN = 1, pauses = 0;
  var ov = { p: null, r: null, t: 0, dur: 0 };
  var hp = { p: 1, pl: 1, r: 1, rl: 1 };
  var pressed = -1, last = 'tap a button';
  var full = [], vis = ['', '', ''], visN = 0, shown = 0, lastShown = -1;
  var info = '', infoKey = -1;

  // frameAt clamps, so loops are the scene's job: plain modulo, or the 2-frame hold tail of tells/stagger.
  function frameOf(a, ms) {
    if (a.loop && ms >= a.total) ms = a.loopFrom ? a.total - a.tail + ((ms - a.total) % a.tail) : ms % a.total;
    return A.frameAt(a, ms);
  }

  function slotDur() {
    var a = A.anim('player', NAMES[idx]) || A.anim(who2, NAMES[idx]);
    if (!a) return 0;
    return a.loop ? Math.max(1500, a.total + 2 * (a.tail || a.total)) : a.total + 350;
  }

  function fire(i) {
    var L = E.lay, y = L.floorY - 18;
    last = LABELS[i] + ' pressed';
    ov.t = 0;
    if (i === 0) {                                              // strike lands
      ov.p = 'strike'; ov.r = 'hit';
      E.after(0.2, function () {
        E.buzz(30); E.hitStop(0.09); E.shake(3, 0.15); E.flash(23, 0.12);
        fx.burst('spark', 126, y, 12, UPRIGHT); fx.burst('blood', 132, y, 6, UPRIGHT);
        hp.r = Math.max(0, hp.r - 0.17);
        E.after(0.3, function () { E.tween(hp, 'rl', hp.r, 0.4, 'lin'); });
        if (hp.r <= 0) E.after(1.2, function () { hp.r = 1; E.tween(hp, 'rl', 1, 0.3); });
      });
    } else if (i === 1) {                                       // guard broken: coroutine waiting on a tween and a predicate
      ov.p = 'stagger'; ov.r = 'strike';
      E.co(function* () {
        yield 0.2;
        E.buzz([20, 40, 20]); E.hitStop(0.14); E.shake(2, 0.2); E.flash(28, 0.16);
        fx.burst('shard', 52, y, 16); fx.burst('dust', 44, L.floorY, 8);
        hp.p = Math.max(0.1, hp.p - 0.2);
        var mark = E.time + 0.3;
        yield function () { return E.time >= mark; };
        yield E.tween(hp, 'pl', hp.p, 0.35, 'out');
        last = 'coroutine + tween done';
      });
    } else {                                                    // feint: slow motion, heal, embers
      ov.p = 'feint'; ov.r = 'taunt2';
      E.buzz(8); E.flash(30, 0.2);
      E.timeScale = 0.35;
      E.after(0.3, function () { E.timeScale = 1; });
      fx.burst('ember', 44, y, 14); fx.burst('heal', 44, y + 8, 12); fx.burst('ash', 136, y, 10, UPLEFT);
      hp.p = Math.min(1, hp.p + 0.25); E.tween(hp, 'pl', hp.p, 0.3);
    }
    ov.dur = Math.max(A.anim('player', ov.p).total, A.anim(who2, ov.r).total) + 300;
  }

  function buildVisible() {
    var left = shown, i;
    visN = 0;
    for (i = 0; i < full.length && i < 3 && left > 0; i++) {
      vis[i] = left >= full[i].length ? full[i] : full[i].slice(0, left);
      left -= full[i].length; visN++;
    }
    vis.length = visN;
    lastShown = shown;
  }

  R.Scenes = R.Scenes || {};
  R.Scenes.enginetest = {
    enter: function (args) {
      runN = args && args.n ? args.n : 1;
      idx = 0; t = 0; who2 = 'rival'; ov.p = ov.r = null; pressed = -1; infoKey = -1;
      hp.p = hp.pl = hp.r = hp.rl = 1;
      fx = fx || R.FX.create(256);
      fx.clear();
      fx.ambient('ash', 2);
      EMBER_AREA.y = E.lay.floorY - 62;
      fx.ambient('ember', 3, EMBER_AREA);
      E.co(function* () {                                       // typewriter, 28 ms per character
        var k, total, i;
        for (;;) {
          for (k = 0; k < TEXTS.length; k++) {
            full = F.wrap(TEXTS[k], 164); total = 0;
            for (i = 0; i < full.length && i < 3; i++) total += full[i].length;
            shown = 0;
            while (shown < total) { shown++; yield 0.028; }
            yield 2.4;
          }
        }
      });
    },
    exit: function () { if (fx) fx.clear(); },
    pause: function () { pauses++; },
    resume: function () { last = 'resumed (pauses: ' + pauses + ')'; },
    resize: function () { EMBER_AREA.y = E.lay.floorY - 62; infoKey = -1; },

    update: function (dt) {
      t += dt * 1000;
      if (ov.p) { ov.t += dt * 1000; if (ov.t >= ov.dur) ov.p = ov.r = null; }
      if (t >= slotDur()) {
        t = 0; idx = (idx + 1) % NAMES.length;
        if (idx === NAMES.length - 1 && who2 === 'rival2') idx = 0;         // rival2 has no transform
        if (idx === 0) who2 = who2 === 'rival' ? 'rival2' : 'rival';
      }
      fx.update(dt);
    },

    draw: function (g) {
      var L = E.lay, W = E.W, H = E.H, top = L.top, i, a, fr, pn, rn, pt, st, y, key;
      RV.mask = R.Save.data.settings.mask;
      BGO.floorY = L.floorY; BGO.phase2 = who2 === 'rival2';

      A.bg(g, 'cathedral', E.real, BGO);

      // sigils cycle through their states
      st = ((E.real / 0.8) | 0) % SIGIL.length;
      A.sigil(g, 128, L.floorY - 70 + Math.round(Math.sin(E.real * 5.2)), SIGIL[st], SIGIL_MOVE[st], 'r');
      A.sigil(g, 36, L.floorY - 68 + Math.round(Math.sin(E.real * 5.2 + 1)), SIGIL[st], SIGIL_MOVE[st], 'p');

      // fighters: every animation in turn, or the override started by a button
      pn = ov.p || (A.anim('player', NAMES[idx]) ? NAMES[idx] : 'idle');
      rn = ov.r || (A.anim(who2, NAMES[idx]) ? NAMES[idx] : 'idle');
      pt = ov.p ? ov.t : t;
      a = A.anim('player', pn); fr = frameOf(a, pt);
      A.fighter(g, 'player', pn, fr, 44, L.floorY, null);
      F.draw(g, pn, 44, L.floorY + 5, 10, CENTER); F.draw(g, NUM[fr], 44, L.floorY + 14, 7, CENTER);
      a = A.anim(who2, rn); fr = frameOf(a, pt);
      A.fighter(g, who2, rn, fr, 136, L.floorY, RV);
      F.draw(g, rn, 136, L.floorY + 5, 10, CENTER); F.draw(g, NUM[fr], 136, L.floorY + 14, 7, CENTER);
      F.draw(g, who2, 90, L.floorY + 14, 21, CENTER);

      A.fg(g, 'cathedral', E.real, BGO);
      fx.draw(g);

      // HUD
      g.fillStyle = P[2]; g.fillRect(0, 0, W, top + 33);
      g.fillStyle = P[5]; g.fillRect(0, top + 33, W, 1);
      UI.bar(g, 4, top + 4, 72, 7, hp.p, hp.pl, 18, BAR_P);
      UI.bar(g, 104, top + 4, 72, 7, hp.r, hp.rl, who2 === 'rival2' ? 31 : 18, BAR_R);
      F.draw(g, NUM[Math.round(hp.p * 12)] + '/12', 4, top + 13, 10);
      F.draw(g, NUM[Math.round(hp.r * 9)] + '/9', 176, top + 13, 10, RIGHT);
      key = W * 1e6 + H * 1e3 + E.scale * 10 + E.safe.top + E.safe.bottom * 0.01 + E.dpr * 0.0001;
      if (key !== infoKey) {
        infoKey = key;
        info = W + 'x' + H + ' s' + E.scale + ' dpr' + (Math.round(E.dpr * 100) / 100) + ' safe ' + E.safe.top + '/' + E.safe.bottom;
      }
      F.draw(g, info, 90, top + 23, 7, CENTER);

      // font sample
      y = L.arenaY + 3;
      F.draw(g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4, y, 10, SH);
      F.draw(g, 'abcdefghijklmnopqrstuvwxyz', 4, y + 9, 11, SH);
      F.draw(g, '0123456789 .,!?\'"-:;%()/\u00b7\u2026+<>=#*', 4, y + 18, 22, SH);
      F.draw(g, 'Rival 42!', 4, y + 28, 10, BIG);
      F.draw(g, 'g,j;p q y', 176, y + 30, 19, { align: 'right', scale: 2, shadow: 1 });
      F.draw(g, 'unknown: \u00e9\u00f1~ run ' + runN, 4, y + 47, 8, SH);
      for (i = 0; i < ST.length; i++) A.sprite(g, ST[i], 90 + i * 9, y + 47);
      for (i = 0; i < TAG.length; i++) A.sprite(g, TAG[i], 60 + (i % 6) * 11, y + 58 + ((i / 6) | 0) * 13);

      // band + speech bubble (typewriter)
      g.fillStyle = P[2]; g.fillRect(0, L.bandY, W, H - L.bandY);
      g.fillStyle = P[5]; g.fillRect(0, L.bandY, W, 1);
      if (shown !== lastShown) buildVisible();
      if (visN > 0) UI.bubble(g, 4, L.bandY + 1, 172, vis, 136, 'up', who2 === 'rival2' ? P2 : null);

      // active row: the three panel styles + hint text
      UI.panel(g, 4, L.rowY + 1, 22, 22, 'stone'); A.sprite(g, 'icon_S', 10, L.rowY + 7);
      UI.panel(g, 30, L.rowY + 1, 22, 22, 'dark'); A.sprite(g, 'icon_G', 36, L.rowY + 7);
      UI.panel(g, 56, L.rowY + 1, 22, 22, 'card'); A.sprite(g, 'icon_F', 62, L.rowY + 7);
      F.draw(g, last, 84, L.rowY + 4, 21);
      F.draw(g, 't ' + E.time.toFixed(1) + ' x' + E.timeScale, 84, L.rowY + 13, 7);

      // buttons at the DESIGN section 3 rects
      for (i = 0; i < 3; i++) {
        BTN[i].pressed = pressed === i;
        UI.button(g, BX[i], L.btnY, 56, L.btnH, LABELS[i], BTN[i]);
      }

      // safe-area guides (witchfire dashes) and corner markers (1-px checker: must look crisp)
      g.fillStyle = P[31];
      for (i = 0; i < W; i += 4) {
        if (E.safe.top > 0) g.fillRect(i, E.safe.top - 1, 2, 1);
        if (E.safe.bottom > 0) g.fillRect(i, H - E.safe.bottom, 2, 1);
      }
      for (i = 0; i < 16; i++) if (((i >> 2) + i) & 1) {
        g.fillRect(i & 3, i >> 2, 1, 1); g.fillRect(W - 4 + (i & 3), H - 4 + (i >> 2), 1, 1);
      }
    },

    down: function (x, y) {
      var L = E.lay, i;
      pressed = -1;
      for (i = 0; i < 3; i++) if (UI.hit(x, y, BX[i], L.btnY, 56, L.btnH)) pressed = i;
      if (pressed < 0) { fx.burst('spark', x, y, 6); last = 'tap ' + x + ',' + y; }
    },
    move: function (x, y) {
      if (pressed >= 0 && !UI.hit(x, y, BX[pressed], E.lay.btnY, 56, E.lay.btnH)) pressed = -1;
    },
    up: function (x, y) {
      var i = pressed;
      pressed = -1;
      if (i >= 0 && UI.hit(x, y, BX[i], E.lay.btnY, 56, E.lay.btnH)) fire(i);
    },
    key: function (k) {
      var i = MOVES.indexOf(k);
      if (i >= 0) fire(i);
      else if (k === 'OK') E.go('enginetest', { n: runN + 1 }, 0.4);
    },
    back: function () { E.go('enginetest', { n: runN + 1 }); }
  };
})(globalThis.RIVAL = globalThis.RIVAL || {});
