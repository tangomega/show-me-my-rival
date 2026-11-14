// SHOW ME MY RIVAL — title: the mask in the ash, the logo, one big button.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var CANDLE_X = 133;                       // where the title backdrop stands its candle (embers rise from it)

  function memory() { return (G.meta && G.meta.memory) || {}; }

  // (Re)reads the game state: which buttons exist and what they say.
  function refresh() {
    var L = K.layout(), runs = memory().runs | 0, has = !!G.hasRun(), by;
    S.top = L.top; S.bottom = L.bottom;
    S.floorY = L.top + Math.round(L.h * 0.56);
    S.first = runs === 0 && !has;
    S.has = has;
    S.canNew = has && typeof G.abandon === 'function';
    by = S.first ? L.bottom - 72 : L.bottom - 84;
    if (S.canNew) { S.bMain.set(8, by, 108, 40); S.bNew.set(120, by, 52, 40); }
    else S.bMain.set(14, by, 152, 40);
    S.bMain.label = has ? K.ui('continue', K.ui('cont', 'CONTINUE'))
      : S.first ? K.ui('tapToBegin', 'TAP TO BEGIN') : K.ui('begin', 'BEGIN');
    S.bNew.hidden = !S.canNew;
    S.bNew.label = S.arm > 0 ? K.ui('sure', 'SURE?') : K.ui('newRun', 'NEW RUN');
    S.bNew.st.accent = S.arm > 0 ? 18 : 0;
    S.bNew.st.glow = S.arm > 0;
    S.bDos.set(4, L.bottom - 40, 56, 24); S.bUnl.set(62, L.bottom - 40, 56, 24); S.bSet.set(120, L.bottom - 40, 56, 24);
    S.bDos.hidden = S.bUnl.hidden = S.bSet.hidden = S.first;
    S.remember = runs >= 1 ? K.fill(K.ui('titleRemembers', 'It remembers {runs} of you.'), { runs: runs }) : null;
  }

  function begin() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('select'); E.buzz(10);
    G.startFlow();
  }

  function activate(b) {
    if (S.leaving) return;
    if (b === S.bMain) { begin(); return; }
    if (b === S.bNew) {
      if (S.arm > 0) {                                  // second tap: the current run is abandoned
        S.arm = 0;
        K.sfx('select'); E.buzz(20);
        G.abandon();
        if (!G.hasRun()) { S.leaving = true; G.startFlow(); }
        else refresh();
      } else { S.arm = 3; refresh(); }
      return;
    }
    K.sfx('select');
    S.leaving = true;
    E.go(b === S.bDos ? 'dossier' : b === S.bUnl ? 'unlocks' : 'settings', S.fromArgs);
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      S = {
        clock: 0, top: 0, bottom: 320, floorY: 180, first: false, has: false, canNew: false, leaving: false,
        arm: 0, emberT: 0, remember: null, anyDown: false,
        credit: K.ui('credit', 'Developed by tangoSHELL · 2026'),
        fx: R.FX.create(96), bgOpts: { floorY: 0 }, fromArgs: { from: 'title' },
        bMain: K.Button(14, 0, 152, 40, '', { glow: true }),
        bNew: K.Button(120, 0, 52, 40, ''),
        bDos: K.Button(4, 0, 56, 24, K.ui('dossier', 'DOSSIER')),
        bUnl: K.Button(62, 0, 56, 24, K.ui('unlocks', 'UNLOCKS')),
        bSet: K.Button(120, 0, 56, 24, K.ui('settings', 'SETTINGS')),
        btns: null
      };
      S.btns = [S.bMain, S.bNew, S.bDos, S.bUnl, S.bSet];
      refresh();
      S.fx.ambient('ash', 4);
      K.music('title', 1.5);
    },
    exit: function () { S = null; },
    resize: function () { if (S) refresh(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt;
      if (S.arm > 0) { S.arm -= dt; if (S.arm <= 0) { S.arm = 0; refresh(); } }
      S.emberT += dt;
      if (S.emberT >= 0.7) { S.emberT -= 0.7; S.fx.burst('ember', CANDLE_X, S.floorY - 8, 1); }
      S.fx.update(dt);
    },
    draw: function (g) {
      if (!S) return;
      var i;
      S.bgOpts.floorY = S.floorY;
      R.Art.bg(g, 'title', S.clock, S.bgOpts);
      R.Art.sprite(g, 'title_mask', 58, S.floorY - 58);
      S.fx.draw(g);
      R.Art.sprite(g, 'logo', 30, S.top + 14);
      if (S.remember) R.Font.draw(g, S.remember, 90, S.top + 54, 8, K.CS);
      for (i = 0; i < S.btns.length; i++) S.btns[i].draw(g);
      R.Font.draw(g, S.credit, 90, S.bottom - 11, 7, K.C);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      S.anyDown = true;
      K.press(S.btns, x, y);
    },
    up: function (x, y) {
      if (!S || S.leaving) return;
      var was = S.anyDown, b = K.release(S.btns, x, y);
      S.anyDown = false;
      if (b) activate(b);
      else if (S.first && was && x > -999) begin();     // first launch: the whole screen is the button
    },
    key: function (k) { if (S && k === 'OK') begin(); },
    back: function () { if (S && S.arm > 0) { S.arm = 0; refresh(); } }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.title = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
