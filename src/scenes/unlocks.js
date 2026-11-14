// SHOW ME MY RIVAL — unlocks: every R.Run.UNLOCKS entry, grouped by type. Locked ones show how to earn them.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var GROUPS = [['boon', 'BOONS'], ['relic', 'RELICS'], ['mask', 'MASKS'], ['arena', 'ARENAS']];
  var ROW_H = 26, DET_H = 58;

  function build() {
    var U = (R.Run && R.Run.UNLOCKS) || [], un = (G.meta && G.meta.unlocked) || {}, gi, i, n, got, all = 0, have = 0, head, o;
    S.rows.length = 0; S.contentH = 2;
    // the faces of the final duel come first: earned ones show how often they have been beaten
    var B = (R.Run && R.Run.BOSSES) || [], bs = R.Run.repairMeta(G.meta).bosses, TB = (R.Text && R.Text.bosses) || {}, wins;
    head = { t: 'head', y: S.contentH, h: 18, text: 'FACES', count: bs.max + ' / ' + B.length };
    S.rows.push(head); S.contentH += 18;
    for (i = 0; i < B.length; i++) {
      o = K.unlockInfo({ id: 'face_' + B[i].id, type: 'face', ref: B[i].id, name: B[i].name, how: i < bs.max ? (TB[B[i].id] || {}).line : TB.unseen }, 146, 160);
      o.t = 'row'; o.y = S.contentH; o.h = ROW_H; o.open = i < bs.max;
      if (!o.open) o.descLines = [];
      wins = bs.wins[B[i].id] || 0;
      o.note = o.open ? (wins ? K.fill(TB.winsLabel || 'BEATEN {n}', { n: wins }) : (TB.unbeaten || 'UNBEATEN')) : S.lockedText;
      o.sub = o.open ? B[i].phases.length + ' PHASES · ' + o.note : o.typeLabel;
      S.rows.push(o); S.contentH += ROW_H + 2;
    }
    S.contentH += 4;
    for (gi = 0; gi < GROUPS.length; gi++) {
      n = 0; got = 0;
      head = { t: 'head', y: S.contentH, h: 18, text: GROUPS[gi][1], count: '' };
      S.rows.push(head); S.contentH += 18;
      for (i = 0; i < U.length; i++) {
        if (U[i].type !== GROUPS[gi][0]) continue;
        o = K.unlockInfo(U[i], 146, 160);
        o.t = 'row'; o.y = S.contentH; o.h = ROW_H; o.open = !!un[U[i].id];
        o.sub = o.title ? o.title.toUpperCase() : o.typeLabel;
        o.note = o.open ? o.typeLabel : S.lockedText;
        S.rows.push(o); S.contentH += ROW_H + 2;
        n++; if (o.open) got++;
      }
      head.count = got + ' / ' + n;
      all += n; have += got;
      S.contentH += 4;
    }
    S.total = have + ' / ' + all;
  }

  function layout() {
    var L = K.layout();
    S.top = L.top; S.bottom = L.bottom;
    S.detY = L.bottom - 44 - DET_H - 2;
    S.viewTop = L.top + 19; S.viewH = S.detY - 2 - S.viewTop;
    S.scroll.setBounds(S.viewTop, S.viewH, S.contentH);
    S.bBack.set(40, L.bottom - 40, 100, 36);
  }

  function rowAt(x, y) {
    if (!S.scroll.inView(x, y) || x < 4 || x >= 176) return -1;
    var cy = y - S.viewTop + S.scroll.off(), i, r;
    for (i = 0; i < S.rows.length; i++) {
      r = S.rows[i];
      if (r.t === 'row' && cy >= r.y && cy < r.y + r.h) return i;
    }
    return -1;
  }

  function goBack() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('back');
    E.go(S.from);
  }

  function drawRow(g, r, y, sel) {
    var i;
    if (r.t === 'head') {
      g.fillStyle = K.hex(5); g.fillRect(4, y + 14, 170, 1);
      R.Font.draw(g, r.text, 6, y + 5, 21);
      R.Font.draw(g, r.count, 172, y + 5, 10, K.RT);
      return;
    }
    g.fillStyle = K.hex(1); g.fillRect(4, y, 170, r.h);
    g.fillStyle = K.hex(sel ? 25 : r.open ? r.rarCol : 4); g.fillRect(5, y + 1, 168, r.h - 2);
    g.fillStyle = K.hex(r.open ? 3 : 2); g.fillRect(6, y + 2, 166, r.h - 4);
    if (r.open) {
      K.icon(g, r, 10, y + (r.type === 'mask' ? 6 : 7));
      R.Font.draw(g, r.name, 28, y + 5, 10);
      R.Font.draw(g, r.sub, 28, y + 15, 7);
    } else {
      R.Art.sprite(g, 'lock', 12, y + 9);
      for (i = 0; i < r.howLines.length; i++) R.Font.draw(g, r.howLines[i], 26, y + (r.howLines.length > 1 ? 4 : 9) + i * 9, 8);
    }
  }

  function drawDetail(g) {
    var r = S.sel >= 0 ? S.rows[S.sel] : null, i, y = S.detY + 5, lines;
    R.UI.panel(g, 4, S.detY, 172, DET_H, 'dark');
    if (!r) {
      for (i = 0; i < S.hint.length; i++) R.Font.draw(g, S.hint[i], 90, S.detY + 20 + i * 9, 7, K.C);
      return;
    }
    R.Font.draw(g, r.open ? r.name : '? ? ?', 10, y, r.open ? 10 : 6);
    R.Font.draw(g, r.note, 170, y, r.open ? r.typeCol : 18, K.RT);
    y += 11;
    lines = r.open ? r.descLines : r.howLines;
    for (i = 0; i < lines.length && i < 3; i++) { R.Font.draw(g, lines[i], 10, y, r.open ? 10 : 8); y += 9; }
    if (r.open) {
      y += 2;
      for (i = 0; i < r.howLines.length && y < S.detY + DET_H - 10; i++) { R.Font.draw(g, r.howLines[i], 10, y, 7); y += 9; }
    }
  }

  var scene = {
    enter: function (args) {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      S = {
        clock: 0, from: (args && args.from) || 'title', leaving: false,
        top: 0, bottom: 320, viewTop: 0, viewH: 0, detY: 0, contentH: 0, rows: [], sel: -1, pressRow: -1, total: '',
        title: K.ui('unlocks', 'UNLOCKS'), lockedText: K.ui('locked', 'LOCKED'),
        hint: K.wrap('Tap an entry to read it.', 160, 2),
        scroll: K.scroll(),
        bBack: K.Button(40, 0, 100, 36, K.ui('back', 'BACK')),
        btns: null
      };
      S.btns = [S.bBack];
      build();
      layout();
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt;
      S.scroll.update(dt);
    },
    draw: function (g) {
      if (!S) return;
      var y0 = S.viewTop - S.scroll.off(), i, r, y;
      g.fillStyle = K.hex(2); g.fillRect(0, 0, 180, E.H);
      g.save();
      g.beginPath(); g.rect(0, S.viewTop, 180, S.viewH); g.clip();
      for (i = 0; i < S.rows.length; i++) {
        r = S.rows[i]; y = y0 + r.y;
        if (y + r.h < S.viewTop || y > S.viewTop + S.viewH) continue;
        drawRow(g, r, y, i === S.sel);
      }
      g.restore();
      S.scroll.drawBar(g);
      K.topBar(g, S.title, S.total);
      g.fillStyle = K.hex(2); g.fillRect(0, S.detY - 2, 180, E.H - S.detY + 2);
      g.fillStyle = K.hex(5); g.fillRect(0, S.detY - 2, 180, 1);
      drawDetail(g);
      S.bBack.draw(g);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      if (K.press(S.btns, x, y)) return;
      if (S.scroll.down(x, y)) S.pressRow = rowAt(x, y);
    },
    move: function (x, y) { if (S) S.scroll.move(x, y); },
    up: function (x, y) {
      if (!S || S.leaving) return;
      var b = K.release(S.btns, x, y), dragged = S.scroll.up(), r;
      if (b === S.bBack) goBack();
      else if (!dragged && S.pressRow >= 0) {
        r = rowAt(x, y);
        if (r === S.pressRow) { S.sel = r; K.sfx('tick'); }
      }
      S.pressRow = -1;
    },
    key: function (k) { if (S && k === 'OK') goBack(); },
    back: function () { if (S) goBack(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.unlocks = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
