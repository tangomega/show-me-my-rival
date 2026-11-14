// SHOW ME MY RIVAL — relic choice before duel 1 (only reached once a relic is unlocked).
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var CW = 56, CH = 44;

  function layout() {
    var L = K.layout(), n = S.items.length, rows = Math.ceil(n / 3), i, r, c, inRow, x0;
    S.top = L.top; S.bottom = L.bottom;
    S.btnY = L.bottom - 42;
    for (i = 0; i < n; i++) {
      r = (i / 3) | 0; c = i % 3;
      inRow = Math.min(3, n - r * 3);
      x0 = (180 - (inRow * CW + (inRow - 1) * 2)) >> 1;
      S.items[i].x = x0 + c * (CW + 2);
      S.items[i].y = L.top + 24 + r * (CH + 4);
    }
    S.detY = L.top + 24 + rows * (CH + 4);
    S.detH = Math.max(40, S.btnY - 4 - S.detY);
    S.bBack.set(4, S.btnY, 52, 38);
    S.bOk.set(60, S.btnY, 116, 38);
  }

  function cardAt(x, y) {
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (x >= it.x && x < it.x + CW && y >= it.y && y < it.y + CH) return i;
    }
    return -1;
  }

  function confirm() {
    if (S.leaving) return;
    S.leaving = true;
    var it = S.items[S.sel];
    K.sfx('select'); E.buzz(12);
    G.newRun(it && it.info ? it.info.id : null);
  }
  function goBack() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('back');
    E.go('title');
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var list = R.Run.relics(G.meta) || [], i;
      S = {
        clock: 0, top: 0, bottom: 320, btnY: 0, detY: 0, detH: 0, leaving: false,
        items: [], sel: 0, pressCard: -1,
        cst: { sel: false, dim: false, pressed: false, label: null },
        title: K.ui('chooseRelic', 'CHOOSE A RELIC'),
        noneLabel: K.ui('none', 'NONE'),
        noneLines: K.wrap('No relic. Just you, and what it already knows.', 160, 3),
        fx: R.FX.create(64),
        bBack: K.Button(4, 0, 52, 38, K.ui('back', 'BACK')),
        bOk: K.Button(60, 0, 116, 38, K.ui('confirm', 'CONFIRM'), { glow: true }),
        btns: null
      };
      S.btns = [S.bBack, S.bOk];
      for (i = 0; i < list.length && i < 8; i++) S.items.push({ info: K.boonInfo(list[i].id, 48, 160), x: 0, y: 0 });
      S.items.push({ info: null, x: 0, y: 0 });
      layout();
      S.fx.ambient('ash', 3);
      K.music('title', 1);
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt;
      S.fx.update(dt);
    },
    draw: function (g) {
      if (!S) return;
      var i, it, st = S.cst, ty;
      g.fillStyle = K.hex(2); g.fillRect(0, 0, 180, E.H);
      S.fx.draw(g);
      K.topBar(g, S.title);
      for (i = 0; i < S.items.length; i++) {
        it = S.items[i];
        st.sel = i === S.sel; st.pressed = i === S.pressCard; st.label = it.info ? null : S.noneLabel;
        K.card(g, it.x, it.y - (st.sel ? 2 : 0), CW, CH, it.info, st);
      }
      R.UI.panel(g, 4, S.detY, 172, S.detH, 'dark');
      it = S.items[S.sel];
      if (it && it.info) K.detail(g, 10, S.detY + 5, 160, it.info, null, 0);
      else {
        R.Font.draw(g, S.noneLabel, 10, S.detY + 5, 10);
        ty = S.detY + 16;
        for (i = 0; i < S.noneLines.length; i++) R.Font.draw(g, S.noneLines[i], 10, ty + i * 9, 12);
      }
      S.bBack.draw(g); S.bOk.draw(g);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      if (K.press(S.btns, x, y)) return;
      S.pressCard = cardAt(x, y);
      if (S.pressCard >= 0) K.sfx('tick');
    },
    up: function (x, y) {
      if (!S || S.leaving) return;
      var b = K.release(S.btns, x, y), c;
      if (b === S.bOk) confirm();
      else if (b === S.bBack) goBack();
      else if (S.pressCard >= 0) {
        c = cardAt(x, y);
        if (c === S.pressCard) S.sel = c;
      }
      S.pressCard = -1;
    },
    key: function (k) { if (S && k === 'OK') confirm(); },
    back: function () { if (S) goBack(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.relic = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
