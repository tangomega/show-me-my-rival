// SHOW ME MY RIVAL — before duel 1: the Vigil (how many of the seven lights are out) and the relic choice.
// Reached once a relic is unlocked or a light of the Vigil has been earned.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var CW = 56, NL = 7, VSTEP = 22, VX0 = 90 - 3 * VSTEP;      // candle centres: VX0 + i * VSTEP

  function layout() {
    var L = K.layout(), n = S.items.length, rows = Math.ceil(n / 3), i, r, c, inRow, x0;
    S.top = L.top; S.bottom = L.bottom;
    S.btnY = L.bottom - 42;
    S.vy = L.top + 23;
    var cardsY = S.vy + 27;
    // card height gives way first on a short screen: the detail panel needs about 64 px
    S.ch = Math.max(30, Math.min(44, Math.floor((S.btnY - 4 - 64 - cardsY) / rows) - 4));
    for (i = 0; i < n; i++) {
      r = (i / 3) | 0; c = i % 3;
      inRow = Math.min(3, n - r * 3);
      x0 = (180 - (inRow * CW + (inRow - 1) * 2)) >> 1;
      S.items[i].x = x0 + c * (CW + 2);
      S.items[i].y = cardsY + r * (S.ch + 4);
    }
    S.detY = cardsY + rows * (S.ch + 4);
    S.detH = Math.max(40, S.btnY - 4 - S.detY);
    S.bBack.set(4, S.btnY, 52, 38);
    S.bOk.set(60, S.btnY, 116, 38);
  }

  function cardAt(x, y) {
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (x >= it.x && x < it.x + CW && y >= it.y && y < it.y + S.ch) return i;
    }
    return -1;
  }
  function lightAt(x, y) {
    if (y < S.vy - 3 || y >= S.vy + 23) return -1;
    var i = Math.floor((x - (VX0 - VSTEP / 2)) / VSTEP);
    return i >= 0 && i < NL ? i : -1;
  }

  // Wrap the detail text of light i (0-based) once, when it gains focus or its state changes.
  function viewLight(i) {
    var T = (R.Text && R.Text.vigil) || {}, li = K.light(i + 1), k = i + 1, vg = S.vg;
    var locked = k > vg.max, out = k <= S.sel;
    S.focus = 'vigil'; S.vk = i;
    S.vName = li ? li.name : '';
    S.vNote = 'LIGHT ' + k + ' · ' + (locked ? (T.locked || 'LOCKED') : out ? (T.out || 'OUT') : (T.lit || 'LIT'));
    S.vNoteCol = locked ? 7 : out ? 19 : 21;
    S.vRule = K.wrap(locked ? (vg.max === 0 ? (T.earnFirst || '') : (T.earnNext || '')) : (li ? li.rule : ''), 160, 2);
    S.vLine = K.wrap(locked ? (k === vg.max + 1 ? (T.intro || '') : '') : (li ? li.line : ''), 160, 3);
  }
  function refreshLabel() {
    var T = (R.Text && R.Text.vigil) || {};
    S.right = K.vigilLabel(S.sel) || (S.vg.max > 0 ? (T.allLit || 'ALL SEVEN LIT') : null);
  }

  function tapLight(i) {
    var k = i + 1, vg = S.vg;
    if (k > vg.max) { K.sfx('back'); viewLight(i); return; }
    if (S.sel >= k) { S.sel = k - 1; K.sfx('tick'); }               // relight this one and every one after it
    else { S.sel = k; K.sfx('seal'); E.buzz(14); S.fx.burst('ash', VX0 + i * VSTEP, S.vy + 4, 4); }
    vg.sel = S.sel;
    refreshLabel();
    viewLight(i);
  }

  function confirm() {
    if (S.leaving) return;
    S.leaving = true;
    var it = S.items[S.pick];
    K.sfx('select'); E.buzz(12);
    G.newRun(it && it.info ? it.info.id : null);
  }
  function goBack() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('back');
    G.save();                                     // keeps the Vigil choice
    E.go('title');
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var list = R.Run.relics(G.meta) || [], i;
      var vg = R.Run.repairMeta(G.meta).vigil;
      S = {
        clock: 0, top: 0, bottom: 320, btnY: 0, detY: 0, detH: 0, vy: 0, ch: 44, leaving: false,
        items: [], pick: 0, pressCard: -1, pressLight: -1,
        vg: vg, sel: Math.min(vg.sel, vg.max), focus: 'relic', vk: 0, right: null,
        vName: '', vNote: '', vNoteCol: 7, vRule: [], vLine: [],
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
      refreshLabel();
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
      var i, it, st = S.cst, ty, k, state, x, vg = S.vg;
      g.fillStyle = K.hex(2); g.fillRect(0, 0, 180, E.H);
      K.topBar(g, S.title, S.right);
      // the Vigil: seven lights. Out ones smoke; unearned ones are cold wax.
      for (i = 0; i < NL; i++) {
        k = i + 1;
        state = k > vg.max ? 2 : k <= S.sel ? 1 : 0;
        x = VX0 + i * VSTEP - 3;
        if (S.focus === 'vigil' && S.vk === i) { g.fillStyle = K.hex(4); g.fillRect(x - 5, S.vy - 2, 17, 22); }
        K.candle(g, x, S.vy + (S.pressLight === i ? 1 : 0), state, S.clock, i);
        if (vg.wins[k] > 0) { g.fillStyle = K.hex(22); g.fillRect(x + 2, S.vy + 16, 3, 2); }      // won with this many out
        else if (k === vg.max && (Math.floor(S.clock * 2) & 1)) { g.fillStyle = K.hex(21); g.fillRect(x + 3, S.vy + 16, 1, 1); }   // newest, unbeaten
      }
      S.fx.draw(g);
      for (i = 0; i < S.items.length; i++) {
        it = S.items[i];
        st.sel = i === S.pick; st.pressed = i === S.pressCard; st.label = it.info ? null : S.noneLabel;
        K.card(g, it.x, it.y - (st.sel ? 2 : 0), CW, S.ch, it.info, st);
      }
      R.UI.panel(g, 4, S.detY, 172, S.detH, 'dark');
      ty = S.detY + 5;
      if (S.focus === 'vigil') {
        R.Font.draw(g, S.vName, 10, ty, 10); ty += 9;
        R.Font.draw(g, S.vNote, 10, ty, S.vNoteCol); ty += 11;
        for (i = 0; i < S.vRule.length; i++) { R.Font.draw(g, S.vRule[i], 10, ty, 10); ty += 9; }
        ty += 2;
        for (i = 0; i < S.vLine.length && ty + 7 <= S.detY + S.detH - 3; i++) { R.Font.draw(g, S.vLine[i], 10, ty, 12); ty += 9; }
      } else {
        it = S.items[S.pick];
        if (it && it.info) K.detail(g, 10, ty, 160, it.info, null, 0);
        else {
          R.Font.draw(g, S.noneLabel, 10, ty, 10);
          ty += 11;
          for (i = 0; i < S.noneLines.length; i++) R.Font.draw(g, S.noneLines[i], 10, ty + i * 9, 12);
        }
      }
      S.bBack.draw(g); S.bOk.draw(g);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      if (K.press(S.btns, x, y)) return;
      S.pressLight = lightAt(x, y);
      if (S.pressLight >= 0) return;
      S.pressCard = cardAt(x, y);
      if (S.pressCard >= 0) K.sfx('tick');
    },
    up: function (x, y) {
      if (!S || S.leaving) return;
      var b = K.release(S.btns, x, y), c;
      if (b === S.bOk) confirm();
      else if (b === S.bBack) goBack();
      else if (S.pressLight >= 0) {
        if (lightAt(x, y) === S.pressLight) tapLight(S.pressLight);
      } else if (S.pressCard >= 0) {
        c = cardAt(x, y);
        if (c === S.pressCard) { S.pick = c; S.focus = 'relic'; }
      }
      S.pressCard = -1; S.pressLight = -1;
    },
    key: function (k) { if (S && k === 'OK') confirm(); },
    back: function () { if (S) goBack(); },
    // Test hook: where the lights are and what is chosen.
    peek: function () { return S ? { sel: S.sel, max: S.vg.max, vy: S.vy, x0: VX0, step: VSTEP, focus: S.focus } : null; }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.relic = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
