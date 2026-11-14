// SHOW ME MY RIVAL — the bonfire: rest, the Rival drafts first (and says why), then the player picks.
// The Rival's pick and both boon lists stay on screen while the player chooses: that is the counter-draft.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var memo = { key: null, step: 0 };           // which bonfire has already played its intro (dossier round trip)
  var L = { top: 0, bottom: 320, btnY: 0, detY: 0, cardsY: 0, stripY: 0, floorY: 0, panelY: 0, header: false };
  var PX = 44, RX = 136;                       // seated figures (centre x)
  var DET_H = 66, CARD_H = 46, STRIP_H = 20;
  var NOTE = { choice: '', pick: 'ITS PICK', own: 'YOURS', its: 'ITS' };
  var NOTE_COL = { choice: 7, pick: 19, own: 28, its: 19 };

  function layout() {
    var b = K.layout(), n = S.cards.length, i, c, x0;
    L.top = b.top; L.bottom = b.bottom;
    L.btnY = b.bottom - 40;
    L.detY = L.btnY - 3 - DET_H;
    L.cardsY = L.detY - 2 - CARD_H;
    L.stripY = L.cardsY - 3 - STRIP_H;
    L.floorY = L.stripY - 36;
    L.panelY = Math.max(b.top + 2, L.floorY - 78);
    L.header = L.panelY - 11 >= b.top + 1;
    if (n <= 3) {
      x0 = (180 - (n * 56 + (n - 1) * 2)) >> 1;
      for (i = 0; i < n; i++) { c = S.cards[i]; c.x = x0 + i * 58; c.y = L.cardsY; c.w = 56; c.h = CARD_H; }
    } else {
      for (i = 0; i < n; i++) { c = S.cards[i]; c.x = 4 + (i & 1) * 87; c.y = L.cardsY + (i >> 1) * 24; c.w = 85; c.h = 22; }
    }
    S.bDos.set(4, L.btnY, 56, 38);
    S.bOk.set(64, L.btnY, 112, 38);
    S.emberArea.x = 80; S.emberArea.y = L.floorY - 36; S.emberArea.w = 20; S.emberArea.h = 26;
  }

  // ------------------------------------------------------------------ small helpers
  function floatText(text, x, y, col) {
    var f = null, i;
    for (i = 0; i < S.floats.length; i++) if (S.floats[i].life <= 0) { f = S.floats[i]; break; }
    if (!f) { if (S.floats.length >= 6) return; f = { text: '', x: 0, y: 0, col: 10, life: 0 }; S.floats.push(f); }
    f.text = String(text); f.x = x; f.y = y; f.col = col; f.life = 1.3;
  }
  function hpText() {
    var n = Math.round(S.hpShown);
    if (n !== S.hpN) { S.hpN = n; S.hpStr = n + '/' + S.hpMax; }
  }
  function setView(info, kind) { S.view = info; S.kind = kind; S.note = NOTE[kind]; S.noteCol = NOTE_COL[kind]; }

  function* wait(sec) {
    var until = S.clock + sec;
    S.tapped = false;
    yield function () { return !S || S.clock >= until || S.tapped; };
    if (S) S.tapped = false;
  }
  function* sayWait(text, hold) {
    if (!S.typer.set(text, 0, true)) return;
    S.tapped = false;
    yield function () { return !S || S.typer.done || S.tapped; };
    S.typer.skip();
    yield* wait(hold);
  }

  function rivalLine() {
    var o = S.offer, v = { rivalBoon: S.rv.info.name }, t = null;
    if (o.rivalWhy) t = K.taunt('bonfire_rival_pick_' + o.rivalWhy, v);
    return t || K.taunt('bonfire_rival_pick', v);
  }

  // ------------------------------------------------------------------ the sequence
  function* flow(skipIntro) {
    var o = S.offer, T = (R.Text && R.Text.tutorial) || {}, i, c, e, n = 0;
    if (!skipIntro) {
      yield* wait(0.5);
      // (a) the rest
      if (o.healed > 0) {
        K.sfx('heal'); E.buzz(10);
        S.fx.burst('heal', PX, L.floorY - 14, 12);
        floatText(K.fill(K.ui('healed', '+{n}'), { n: o.healed }), PX, L.floorY - 40, 22);
        E.tween(S, 'hpShown', S.hp, 0.6);
      }
      for (i = 0; o.events && i < o.events.length; i++) {
        e = o.events[i];
        if (e && e.t === 'boon' && e.id && n < 3) { floatText(K.boonInfo(e.id, 48).name.toUpperCase(), 62, L.floorY - 52 - n * 9, 21); n++; }
        else if (e && e.t === 'forget') { floatText('IT FORGETS', RX - 14, L.floorY - 44, 28); S.fx.burst('ash', RX, L.floorY - 24, 10); }
      }
      yield* wait(1.1);
      // (b) the Rival drafts first
      if (S.rv.info) {
        if (S.firstEver && T.bonfire_first) yield* sayWait(T.bonfire_first, 0.8);
        S.rv.shown = true; S.rv.rise = 0;
        E.tween(S.rv, 'rise', 1, 0.45, 'out');
        K.sfx('rival_draft'); E.buzz(12);
        S.fx.burst('ember', 90, L.floorY - 16, 8);
        yield* wait(0.5);
        S.rv.text = true;
        yield* sayWait(rivalLine(), 1.3);
      }
    }
    // (c) the player's cards
    S.hpShown = S.hp; S.banner = 9;
    S.rv.shown = S.rv.text = !!S.rv.info;
    if (!(S.rv.rise < 1 && S.rv.rise > 0)) S.rv.rise = 1;
    for (i = 0; i < S.cards.length; i++) {
      c = S.cards[i];
      c.shown = true;
      if (!skipIntro) {
        c.oy = 10; E.tween(c, 'oy', 0, 0.2, 'out');
        K.sfx('boon', { pitch: 1 + i * 0.06 });
        yield 0.14;
      }
    }
    S.step = 1; S.tapped = false;
    memo.key = S.key; memo.step = 1;
    if (!o.seen) { o.seen = true; G.save(); }       // a reload resumes at the card choice
    if (!skipIntro && S.firstEver && T.bonfire_cards) S.typer.set(T.bonfire_cards, 2.6, false);
    else if (S.typer.active) S.typer.release(1.6);
  }

  function* leave(card) {
    var line = G.crng.chance(0.7) ? K.taunt('bonfire_player_pick', { boon: card.info.name }) : null;
    K.sfx('select'); E.buzz(15);
    S.fx.burst('ember', card.x + (card.w >> 1), card.y + 8, 10);
    S.typer.clear();
    yield 0.3;
    if (line) yield* sayWait(line, 1.2);
    else yield 0.25;
    G.draft(card.info.id);
  }

  function confirm() {
    if (S.step !== 1 || S.sel < 0) return;
    var card = S.cards[S.sel];
    if (S.view !== card.info) return;
    S.step = 2;
    E.co(function* () { yield* leave(card); });
  }
  function toDossier() {
    if (S.step !== 1) return;
    S.step = 3;
    K.sfx('select');
    E.go('dossier', S.dosArgs);
  }

  // ------------------------------------------------------------------ hit tests
  function cardAt(x, y) {
    for (var i = 0; i < S.cards.length; i++) {
      var c = S.cards[i];
      if (c.shown && x >= c.x && x < c.x + c.w && y >= c.y - 3 && y < c.y + c.h) return i;
    }
    return -1;
  }
  function pickAt(x, y) { return S.rv.text && x >= 4 && x < 176 && y >= L.panelY && y < L.panelY + 44; }
  // >= 0: the player's boon i; <= -2: the Rival's boon (-2 - j); -1: nothing.
  function stripAt(x, y) {
    if (y < L.stripY || y >= L.stripY + STRIP_H) return -1;
    if (x >= 4 && x < 4 + S.pStrip.length * 13) return ((x - 4) / 13) | 0;
    if (x < 176 && x >= 176 - S.rStrip.length * 13) return -2 - (((175 - x) / 13) | 0);
    return -1;
  }

  // ------------------------------------------------------------------ drawing
  function drawGround(g) {
    var y = L.floorY + 9;
    R.UI.bar(g, 6, y, 62, 7, S.hpShown / S.hpMax, S.hpShown / S.hpMax, 18, S.barOpts);
    R.Font.draw(g, S.hpStr, 72, y, 10, K.LS);
    R.Font.draw(g, S.nextA, 174, y, 8, K.RS);
    if (S.nextB) R.Font.draw(g, S.nextB, 174, y + 10, 21, K.RS);
  }

  function drawPick(g) {
    var rv = S.rv, k, x, y, i;
    if (!rv.shown) return;
    k = rv.rise;
    x = Math.round(62 + (120 - 62) * k); y = Math.round(L.floorY - 48 + (L.panelY - (L.floorY - 48)) * k);
    if (rv.text) {
      if (L.header) R.Font.draw(g, S.pickHead, 90, L.panelY - 10, 19, K.CS);
      R.UI.panel(g, 4, L.panelY, 114, 44, 'dark');
      R.Font.draw(g, rv.info.name, 9, L.panelY + 4, 19);
      for (i = 0; i < rv.desc.length; i++) R.Font.draw(g, rv.desc[i], 9, L.panelY + 14 + i * 9, 10);
    }
    S.cst.sel = S.view === rv.info; S.cst.dim = false; S.cst.pressed = S.pressPick;
    K.card(g, x, y, 56, 44, rv.info, S.cst);
  }

  function drawStrip(g) {
    var y = L.stripY, i, x, info, np = S.pStrip.length, nr = S.rStrip.length;
    var blink = (Math.floor(S.clock * 2.5) & 1) === 0;
    g.fillStyle = K.hex(2); g.fillRect(0, y, 180, E.H - y);
    g.fillStyle = K.hex(5); g.fillRect(0, y, 180, 1);
    g.fillStyle = K.hex(3); g.fillRect(0, y + STRIP_H - 1, 180, 1);
    for (i = 0; i < np; i++) {
      info = S.pStrip[i]; x = 4 + i * 13;
      if (S.view === info) { g.fillStyle = K.hex(5); g.fillRect(x - 1, y + 2, 14, 16); }
      K.icon(g, info, x, y + 3);
      g.fillStyle = K.hex(28); g.fillRect(x + 1, y + 16, 10, 1);
    }
    for (i = 0; i < nr; i++) {
      info = S.rStrip[i]; x = 164 - i * 13;
      if (S.view === info) { g.fillStyle = K.hex(5); g.fillRect(x - 1, y + 2, 14, 16); }
      K.icon(g, info, x, y + 3);
      g.fillStyle = K.hex(i === nr - 1 && blink ? 23 : 18); g.fillRect(x + 1, y + 16, 10, 1);
    }
    if (np + nr <= 9) {
      R.Font.draw(g, 'YOU', 6 + np * 13, y + 7, 6);
      R.Font.draw(g, 'IT', 174 - nr * 13, y + 7, 6, K.RT);
    }
  }

  function drawCards(g) {
    var i, c, st = S.cst;
    for (i = 0; i < S.cards.length; i++) {
      c = S.cards[i];
      if (!c.shown) continue;
      st.sel = i === S.sel; st.pressed = i === S.pressCard;
      st.dim = S.step === 2 && i !== S.sel;
      K.card(g, c.x, c.y + Math.round(c.oy) - (st.sel ? (c.h >= 30 ? 3 : 1) : 0), c.w, c.h, c.info, st);
    }
  }

  function drawDetail(g) {
    var i;
    R.UI.panel(g, 4, L.detY, 172, DET_H, 'dark');
    if (S.view) { K.detail(g, 10, L.detY + 5, 160, S.view, S.note, S.noteCol); return; }
    if (S.step < 1) return;
    R.Font.draw(g, S.pickOne, 90, L.detY + 14, 21, K.C);
    for (i = 0; i < S.hint.length; i++) R.Font.draw(g, S.hint[i], 90, L.detY + 28 + i * 9, 8, K.C);
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var run = G.run, o = run && run.offer, mem = (G.meta && G.meta.memory) || {}, i, skip, key, next, names;
      if (!run || !o) { S = null; E.go('title'); return; }
      key = run.seed + ':' + (o.bonfire || run.duelN);
      skip = (memo.key === key && memo.step >= 1) || !!o.seen;
      next = (o.bonfire || run.duelN) + 1;
      names = (R.Text && R.Text.duelNames) || [];
      S = {
        clock: 0, step: 0, tapped: false, key: key, offer: o,
        firstEver: (mem.runs | 0) <= 1 && (mem.deaths | 0) === 0 && (mem.wins | 0) === 0 && (o.bonfire || run.duelN) === 1,
        cards: [], sel: -1, view: null, kind: '', note: '', noteCol: 7,
        pressCard: -1, pressPick: false, pressStrip: -1,
        rv: { info: o.rivalPick ? K.boonInfo(o.rivalPick, 48, 160) : null, desc: null, shown: false, text: false, rise: 0 },
        pStrip: [], rStrip: [],
        hp: run.pHp, hpMax: Math.max(1, run.pMaxHp), hpShown: skip ? run.pHp : Math.max(0, run.pHp - (o.healed || 0)), hpN: -1, hpStr: '',
        barOpts: { ticks: Math.max(1, run.pMaxHp) },
        nextA: 'NEXT: DUEL ' + next, nextB: names[next - 1] ? String(names[next - 1]).toUpperCase() : '',
        banner: skip ? 9 : 0, restText: K.ui('rest', 'REST'),
        pickHead: K.ui('itChoosesFirst', 'IT CHOOSES FIRST'), pickOne: K.ui('pickOne', 'PICK ONE'),
        hint: K.wrap('Tap a card to read it. Its pick is above.', 160, 2),
        typer: K.typer(164, 3), fx: R.FX.create(160), floats: [],
        emberArea: { x: 80, y: 0, w: 20, h: 26 }, bgOpts: { floorY: 0 }, dosArgs: { from: 'bonfire' },
        cst: { sel: false, dim: false, pressed: false, label: null },
        bDos: K.Button(4, 0, 56, 38, K.ui('dossier', 'DOSSIER')),
        bOk: K.Button(64, 0, 112, 38, K.ui('confirm', 'CONFIRM')),
        btns: null
      };
      S.btns = [S.bDos, S.bOk];
      if (S.rv.info) S.rv.desc = K.wrap(S.rv.info.desc, 104, 3);
      for (i = 0; o.choices && i < o.choices.length && i < 4; i++) {
        S.cards.push({ info: K.boonInfo(o.choices[i], o.choices.length > 3 ? 60 : 48, 160), x: 0, y: 0, w: 56, h: CARD_H, oy: 0, shown: false });
      }
      for (i = 0; i < run.pBoons.length && i < 7; i++) S.pStrip.push(K.boonInfo(run.pBoons[i], 48, 160));
      for (i = 0; i < run.rBoons.length && i < 6; i++) {
        S.rStrip.push(run.rBoons[i] === o.rivalPick && S.rv.info ? S.rv.info : K.boonInfo(run.rBoons[i], 48, 160));
      }
      layout();
      hpText();
      S.fx.ambient('ember', 7, S.emberArea);
      K.music('bonfire', 1.2);
      E.co(function* () { yield* flow(skip); });
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      var i, f;
      S.clock += dt;
      if (S.banner < 9) S.banner += dt;
      S.typer.update(dt);
      S.fx.update(dt);
      hpText();
      for (i = 0; i < S.floats.length; i++) { f = S.floats[i]; if (f.life > 0) { f.life -= dt; f.y -= 12 * dt; } }
      S.bOk.st.disabled = !(S.step === 1 && S.sel >= 0 && S.view === S.cards[S.sel].info);
      S.bOk.st.glow = !S.bOk.st.disabled;
      S.bDos.st.disabled = S.step !== 1;
    },
    draw: function (g) {
      if (!S) return;
      var i, f;
      S.bgOpts.floorY = L.floorY;
      R.Art.bg(g, 'bonfire', S.clock, S.bgOpts);
      R.Art.sprite(g, 'bonfire_player', PX - 16, L.floorY - 32);
      R.Art.sprite(g, 'bonfire_rival', RX - 16, L.floorY - 32);
      S.fx.draw(g);
      drawGround(g);
      drawPick(g);
      drawStrip(g);
      drawCards(g);
      drawDetail(g);
      S.bDos.draw(g); S.bOk.draw(g);
      if (S.typer.active) R.UI.bubble(g, 4, L.floorY + 6, 172, S.typer.view(), RX - 2, 'up');
      for (i = 0; i < S.floats.length; i++) {
        f = S.floats[i];
        if (f.life > 0 && (f.life > 0.3 || (Math.floor(f.life * 30) & 1))) R.Font.draw(g, f.text, Math.round(f.x), Math.round(f.y), f.col, K.CS);
      }
      if (S.banner < 1.5 && !S.rv.shown && (S.banner < 1.2 || (Math.floor(S.banner * 20) & 1))) {
        R.Font.draw(g, S.restText, 90, L.top + 8, 22, K.C2S);
      }
    },
    down: function (x, y) {
      if (!S) return;
      if (S.step !== 1) { S.tapped = true; return; }
      if (K.press(S.btns, x, y)) return;
      S.pressCard = cardAt(x, y);
      if (S.pressCard >= 0) { K.sfx('tick'); return; }
      if (pickAt(x, y)) { S.pressPick = true; return; }
      S.pressStrip = stripAt(x, y);
    },
    up: function (x, y) {
      if (!S) return;
      var b = K.release(S.btns, x, y), c, s;
      if (S.step === 1) {
        if (b === S.bOk) confirm();
        else if (b === S.bDos) toDossier();
        else if (S.pressCard >= 0) {
          c = cardAt(x, y);
          if (c === S.pressCard) { S.sel = c; setView(S.cards[c].info, 'choice'); E.buzz(6); }
        } else if (S.pressPick) {
          if (pickAt(x, y)) { K.sfx('tick'); setView(S.rv.info, 'pick'); }
        } else if (S.pressStrip !== -1) {
          s = stripAt(x, y);
          if (s === S.pressStrip) {
            K.sfx('tick');
            if (s >= 0) setView(S.pStrip[s], 'own');
            else { c = S.rStrip[-2 - s]; setView(c, c === S.rv.info ? 'pick' : 'its'); }
          }
        }
      }
      S.pressCard = -1; S.pressPick = false; S.pressStrip = -1;
    },
    key: function (k) {
      if (!S) return;
      if (S.step !== 1) { S.tapped = true; return; }
      var i = k === 'S' ? 0 : k === 'G' ? 1 : k === 'F' ? 2 : -1;
      if (i >= 0 && i < S.cards.length) { S.sel = i; setView(S.cards[i].info, 'choice'); K.sfx('tick'); }
      else if (k === 'OK') confirm();
    },
    pause: function () { if (S && G) G.save(); },
    back: function () { if (S) S.tapped = true; }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.bonfire = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
