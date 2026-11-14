// SHOW ME MY RIVAL — settings: mute, haptics, mask, arena, replay credits, erase everything (hold).
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var HOLD = 1.5;

  function st() { return R.Save.data.settings; }
  function commit() { R.Save.commit(); }

  // 'porcelain' / 'cathedral' are always there; the rest come from R.Run.UNLOCKS entries of that type.
  function options(type, base) {
    var out = [base], U = (R.Run && R.Run.UNLOCKS) || [], un = (G.meta && G.meta.unlocked) || {}, i;
    for (i = 0; i < U.length; i++) if (U[i].type === type && un[U[i].id] && out.indexOf(U[i].ref) < 0) out.push(U[i].ref);
    return out;
  }
  function total(type) {
    var U = (R.Run && R.Run.UNLOCKS) || [], n = 1, i;
    for (i = 0; i < U.length; i++) if (U[i].type === type) n++;
    return n;
  }

  // Rebuilds every cached label after a change (never per frame).
  function labels() {
    var s = st(), T = R.Text || {}, m, a;
    if (S.masks.indexOf(s.mask) < 0) s.mask = S.masks[0];
    if (S.arenas.indexOf(s.arena) < 0) s.arena = S.arenas[0];
    S.bMute.label = K.ui('mute', 'MUTE') + ': ' + (s.muted ? 'ON' : 'OFF');
    S.bHap.label = K.ui('haptics', 'HAPTICS') + ': ' + (s.haptics === false ? 'OFF' : 'ON');
    m = T.masks ? T.masks[s.mask] : null; a = T.arenas ? T.arenas[s.arena] : null;
    S.maskName = (m && m.name) || s.mask; S.arenaName = (a && a.name) || s.arena;
    S.maskLine = K.wrap((m && m.line) || '', 164, 2); S.arenaLine = K.wrap((a && a.line) || '', 164, 2);
    S.maskIcon = 'mask_' + s.mask;
    S.maskCount = S.masks.length + '/' + S.maskTotal; S.arenaCount = S.arenas.length + '/' + S.arenaTotal;
    S.bReset.label = S.warn > 0 || S.hold > 0 ? K.ui('holdToErase', 'HOLD TO ERASE') : K.ui('resetSave', 'RESET SAVE');
  }

  function layout() {
    var L = K.layout(), y = L.top + 24, tight = L.h < 300;
    S.top = L.top; S.bottom = L.bottom;
    S.bMute.set(4, y, 84, 24); S.bHap.set(92, y, 84, 24); y += 28;
    S.bMask.set(4, y, 172, 24); S.maskY = y + 26; y += tight ? 46 : 48;
    S.bArena.set(4, y, 172, 24); S.arenaY = y + 26; y += tight ? 46 : 48;
    S.bCred.set(4, y, 172, 24); if (!S.bCred.hidden) y += 28;
    S.bReset.set(4, y, 172, 26); S.warnY = y + 29;
    S.bBack.set(40, L.bottom - 40, 100, 36);
  }

  function cycle(list, key) {
    var s = st(), i = list.indexOf(s[key]);
    if (list.length < 2) { K.sfx('back'); return; }
    s[key] = list[(i + 1) % list.length];
    K.sfx('select'); E.buzz(6);
    labels(); commit();
  }

  function activate(b) {
    var s = st();
    if (b === S.bMute) {
      s.muted = !s.muted;
      if (R.Audio && R.Audio.setMuted) R.Audio.setMuted(s.muted);
      K.sfx('select'); labels(); commit();
    } else if (b === S.bHap) {
      s.haptics = s.haptics === false;
      K.sfx('select'); labels(); commit();
      E.buzz(20);
    } else if (b === S.bMask) cycle(S.masks, 'mask');
    else if (b === S.bArena) cycle(S.arenas, 'arena');
    else if (b === S.bCred) { S.leaving = true; K.sfx('select'); E.go('credits', S.credArgs, 0.5); }
    else if (b === S.bBack) goBack();
  }

  function goBack() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('back');
    E.go(S.from);
  }

  function drawPicker(g, b, name, count, icon) {
    var off = b.st.pressed ? 2 : 0, x = b.x + 8;
    b.draw(g);
    R.Font.draw(g, b.id, x, b.y + 9 + off, 7);
    x += S.keyW + 6;
    if (icon) { R.Art.sprite(g, icon, x, b.y + 5 + off); x += 15; }
    R.Font.draw(g, name, x, b.y + 9 + off, 10);
    R.Font.draw(g, count, b.x + b.w - 8, b.y + 9 + off, 21, K.RT);
  }

  var scene = {
    enter: function (args) {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var from = (args && args.from) || 'title';
      S = {
        clock: 0, from: from, leaving: false, hold: 0, warn: 0, erased: false,
        top: 0, bottom: 320, maskY: 0, arenaY: 0, warnY: 0,
        masks: options('mask', 'porcelain'), arenas: options('arena', 'cathedral'),
        maskTotal: total('mask'), arenaTotal: total('arena'),
        maskName: '', arenaName: '', maskLine: [], arenaLine: [], maskIcon: '', maskCount: '', arenaCount: '',
        title: K.ui('settings', 'SETTINGS'),
        warnLines: K.wrap(K.ui('resetConfirm', 'ERASE EVERYTHING? It will forget you.'), 164, 2),
        keyW: Math.max(R.Font.width(K.ui('mask', 'MASK')), R.Font.width(K.ui('arena', 'ARENA'))),
        credArgs: { from: 'settings', back: from },
        bMute: K.Button(4, 0, 84, 24, ''), bHap: K.Button(92, 0, 84, 24, ''),
        bMask: K.Button(4, 0, 172, 24, '', { id: K.ui('mask', 'MASK') }),
        bArena: K.Button(4, 0, 172, 24, '', { id: K.ui('arena', 'ARENA') }),
        bCred: K.Button(4, 0, 172, 24, K.ui('replayCredits', 'REPLAY CREDITS')),
        bReset: K.Button(4, 0, 172, 26, '', { accent: 18 }),
        bBack: K.Button(40, 0, 100, 36, K.ui('back', 'BACK')),
        btns: null
      };
      S.bCred.hidden = !(G.meta && G.meta.seenCredits);
      S.btns = [S.bMute, S.bHap, S.bMask, S.bArena, S.bCred, S.bBack];
      labels();
      layout();
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt;
      if (S.hold > 0 && !S.erased) {
        S.hold += dt;
        if (S.hold >= HOLD) {                          // held all the way: it forgets you
          S.erased = true; S.leaving = true;
          K.sfx('you_died', { vol: 0.6 }); E.buzz([40, 60, 120]);
          G.resetAll();
        }
      } else if (S.warn > 0) {
        S.warn -= dt;
        if (S.warn <= 0) { S.warn = 0; labels(); }
      }
    },
    draw: function (g) {
      if (!S) return;
      var i, b, w;
      g.fillStyle = K.hex(2); g.fillRect(0, 0, 180, E.H);
      K.topBar(g, S.title);
      S.bMute.draw(g); S.bHap.draw(g);
      drawPicker(g, S.bMask, S.maskName, S.maskCount, S.maskIcon);
      for (i = 0; i < S.maskLine.length; i++) R.Font.draw(g, S.maskLine[i], 8, S.maskY + i * 9, 12);
      drawPicker(g, S.bArena, S.arenaName, S.arenaCount, null);
      for (i = 0; i < S.arenaLine.length; i++) R.Font.draw(g, S.arenaLine[i], 8, S.arenaY + i * 9, 12);
      S.bCred.draw(g);
      b = S.bReset;
      b.st.pressed = S.hold > 0;
      b.draw(g);
      if (S.hold > 0) {                                // the filling bar
        w = Math.round((b.w - 12) * Math.min(1, S.hold / HOLD));
        g.fillStyle = K.hex(1); g.fillRect(b.x + 5, b.y + b.h - 8, b.w - 10, 4);
        g.fillStyle = K.hex(18); g.fillRect(b.x + 6, b.y + b.h - 7, w, 2);
      }
      if (S.hold > 0 || S.warn > 0) {
        for (i = 0; i < S.warnLines.length; i++) R.Font.draw(g, S.warnLines[i], 90, S.warnY + i * 9, 19, K.C);
      }
      S.bBack.draw(g);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      if (S.bReset.hit(x, y)) { S.hold = 0.0001; S.warn = 3; K.sfx('tick'); labels(); return; }
      K.press(S.btns, x, y);
    },
    up: function (x, y) {
      if (!S) return;
      if (S.hold > 0 && !S.erased) { S.hold = 0; S.warn = 3; labels(); }   // let go early: nothing is erased
      if (S.leaving) return;
      var b = K.release(S.btns, x, y);
      if (b) activate(b);
    },
    move: function (x, y) {
      if (S && S.hold > 0 && !S.erased && !S.bReset.hit(x, y)) { S.hold = 0; S.warn = 3; labels(); }   // slid off the button
    },
    key: function (k) { if (S && k === 'OK') goBack(); },
    back: function () { if (S) goBack(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.settings = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
