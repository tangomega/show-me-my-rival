// SHOW ME MY RIVAL — the dossier: the Rival's notebook about the player. Scrolls; works from the title and mid-run.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var X0 = 8, TW = 164;                           // text column
  var MINI = { S: 'mini_S', G: 'mini_G', F: 'mini_F' };

  // ------------------------------------------------------------------ content (built once in enter)
  function add(it) { it.y = S.contentH; S.items.push(it); S.contentH += it.h; return it; }
  function head(text) { if (text) add({ t: 'head', h: 20, text: String(text) }); }
  function para(text, col, center) {
    var ls = K.wrap(text, TW, 6);
    if (ls.length) add({ t: 'text', h: ls.length * 9 + 5, lines: ls, col: col, center: !!center });
  }
  function header(kind, n) {
    var T = R.Text || {};
    if (T.dossierHeader) return T.dossierHeader(kind, n);
    if (T.dossierHeaders && T.dossierHeaders.length) return T.dossierHeaders[Math.abs(n | 0) % T.dossierHeaders.length];
    return kind === 'record' ? 'FOR THE RECORD' : kind === 'tell' ? 'ON TRUSTING A MASK' : 'ON THE SUBJECT OF YOU';
  }
  function line(stat) {
    var T = R.Text || {}, s = null;
    try { s = T.dossierLine ? T.dossierLine(stat) : null; } catch (e) { s = null; }
    return s || '';
  }

  function build() {
    var T = R.Text || {}, dos = null, mem = (G.meta && G.meta.memory) || {}, i, st, ls, rows, topKind = 'habit', known = false, shown = 0;
    try { dos = G.brain ? G.brain.dossier() : null; } catch (e) { dos = null; }
    var stats = (dos && dos.stats) || [], samples = dos ? dos.samples | 0 : 0;
    S.items.length = 0; S.contentH = 4;
    S.note = samples > 0 ? samples + ' TURNS' : '';

    for (i = 0; i < stats.length; i++) {
      if (stats[i].id === 'predictability') known = true;
      else if (stats[i].id !== 'broken_habit' && shown === 0) { topKind = stats[i].kind === 'tell' ? 'tell' : 'habit'; shown = 1; }
    }

    if (samples <= 0) {
      head(header('habit', 0));
      var empty = T.dossierEmpty && T.dossierEmpty.length ? T.dossierEmpty[G.crng ? G.crng.int(T.dossierEmpty.length) : 0] : "I don't know you yet. Give it time.";
      add({ t: 'gap', h: 10 });
      para(empty, 10, true);
      add({ t: 'gap', h: 10 });
    } else {
      head(header(topKind, samples));
      // predictability gauge
      var score = Math.max(0, Math.min(100, Math.round(dos.predictability || 0)));
      ls = K.wrap(T.predictabilityLine ? T.predictabilityLine(known ? score : NaN) : '', TW, 4);
      add({ t: 'gauge', h: 24 + ls.length * 9 + 6, frac: known ? score / 100 : 0, num: known ? String(score) : '??',
            col: !known ? 6 : score <= 25 ? 28 : score < 60 ? 21 : 18, lines: ls, label: 'PREDICTABILITY' });
      // habits and tells, strongest first
      shown = 0;
      for (i = 0; i < stats.length && shown < 16; i++) {
        st = stats[i];
        if (st.id === 'predictability' || st.id === 'broken_habit' || st.id === 'record') continue;
        ls = K.wrap(line(st), TW - 10, 4);
        if (!ls.length) continue;
        add({ t: 'stat', h: ls.length * 9 + 5, lines: ls, col: st.strength > 0 ? 10 : 7, icon: st.strength > 0 && st.move ? MINI[st.move] : null, hot: st.strength > 0 });
        shown++;
      }
      if (!shown) para(T.dossierEmpty && T.dossierEmpty[1] ? T.dossierEmpty[1] : 'Blank pages. They will not stay blank.', 7, false);
      // the tell-trust split
      var tell = dos.tell;
      if (tell && tell.n > 0) {
        var c = Math.max(0, tell.counter | 0), m = Math.max(0, tell.mirror | 0), u = Math.max(0, tell.under | 0), sum = c + m + u || 1;
        var wc = Math.round(TW * c / sum), wm = Math.round(TW * m / sum);
        if (wc + wm > TW) wm = TW - wc;
        head(header('tell', tell.n));
        add({ t: 'tell', h: 36, wc: wc, wm: wm, wu: TW - wc - wm, sc: c + '%', sm: m + '%', su: u + '%' });
      }
      // the habit they broke
      if (dos.broken) {
        ls = K.wrap(line(dos.broken), TW, 4);
        if (ls.length) { head('A HABIT YOU BROKE'); add({ t: 'text', h: ls.length * 9 + 5, lines: ls, col: 21, center: false }); }
      }
    }

    // lifetime record
    rows = [];
    try { rows = T.recordLines ? T.recordLines(mem) || [] : []; } catch (e2) { rows = []; }
    if (rows.length) {
      head(header('record', mem.runs | 0));
      for (i = 0; i < rows.length; i++) {
        ls = K.wrap(rows[i].jab || '', TW, 3);
        add({ t: 'rec', h: 10 + ls.length * 9 + 5, label: String(rows[i].label || ''), value: String(rows[i].value || ''), lines: ls });
      }
    }
    S.contentH += 8;
  }

  function layout() {
    var L = K.layout();
    S.top = L.top; S.bottom = L.bottom;
    S.viewTop = L.top + 19; S.viewH = L.bottom - 44 - S.viewTop;
    S.scroll.setBounds(S.viewTop, S.viewH, S.contentH);
    S.bBack.set(40, L.bottom - 40, 100, 36);
  }

  function goBack() {
    if (S.leaving) return;
    S.leaving = true;
    K.sfx('back');
    E.go(S.from);
  }

  // ------------------------------------------------------------------ drawing
  function drawItem(g, it, y) {
    var i, x;
    switch (it.t) {
      case 'head':
        g.fillStyle = K.hex(5); g.fillRect(X0, y + 8, TW, 1);
        g.fillStyle = K.hex(2); g.fillRect(90 - (it.w >> 1) - 4, y + 4, it.w + 8, 9);
        R.Font.draw(g, it.text, 90, y + 5, 21, K.C);
        break;
      case 'text':
        for (i = 0; i < it.lines.length; i++) R.Font.draw(g, it.lines[i], it.center ? 90 : X0, y + i * 9, it.col, it.center ? K.C : null);
        break;
      case 'gauge':
        R.Font.draw(g, it.label, X0, y, 7);
        R.Font.draw(g, it.num, X0 + TW, y, 10, K.RT);
        R.UI.bar(g, X0, y + 10, TW, 8, it.frac, it.frac, it.col, null);
        g.fillStyle = K.hex(1);
        g.fillRect(X0 + Math.round(TW * 0.25), y + 10, 1, 8); g.fillRect(X0 + Math.round(TW * 0.6), y + 10, 1, 8);
        for (i = 0; i < it.lines.length; i++) R.Font.draw(g, it.lines[i], X0, y + 23 + i * 9, 11);
        break;
      case 'stat':
        if (it.icon) R.Art.sprite(g, it.icon, X0, y);
        else { g.fillStyle = K.hex(it.hot ? 18 : 5); g.fillRect(X0 + 1, y + 2, 3, 3); }
        for (i = 0; i < it.lines.length; i++) R.Font.draw(g, it.lines[i], X0 + 10, y + i * 9, it.col);
        break;
      case 'tell':
        g.fillStyle = K.hex(1); g.fillRect(X0 - 1, y - 1, TW + 2, 11);
        x = X0;
        if (it.wc > 0) { g.fillStyle = K.hex(28); g.fillRect(x, y, it.wc, 9); x += it.wc; }
        if (it.wm > 0) { g.fillStyle = K.hex(21); g.fillRect(x, y, it.wm, 9); x += it.wm; }
        if (it.wu > 0) { g.fillStyle = K.hex(30); g.fillRect(x, y, it.wu, 9); }
        g.fillStyle = K.hex(1);
        if (it.wc > 0 && it.wc < TW) g.fillRect(X0 + it.wc, y, 1, 9);
        if (it.wu > 0 && it.wc + it.wm < TW) g.fillRect(X0 + it.wc + it.wm, y, 1, 9);
        R.Font.draw(g, 'BELIEVE', 35, y + 13, 28, K.C); R.Font.draw(g, it.sc, 35, y + 22, 10, K.C);
        R.Font.draw(g, 'COPY', 90, y + 13, 21, K.C); R.Font.draw(g, it.sm, 90, y + 22, 10, K.C);
        R.Font.draw(g, 'DEFY', 145, y + 13, 30, K.C); R.Font.draw(g, it.su, 145, y + 22, 10, K.C);
        break;
      case 'rec':
        R.Font.draw(g, it.label, X0, y, 7);
        R.Font.draw(g, it.value, X0 + TW, y, 10, K.RT);
        for (i = 0; i < it.lines.length; i++) R.Font.draw(g, it.lines[i], X0, y + 10 + i * 9, 11);
        break;
    }
  }

  var scene = {
    enter: function (args) {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var i;
      S = {
        clock: 0, from: (args && args.from) || 'title', leaving: false,
        top: 0, bottom: 320, viewTop: 0, viewH: 0, contentH: 0, items: [], note: '',
        title: K.ui('dossier', 'DOSSIER'),
        scroll: K.scroll(),
        bBack: K.Button(40, 0, 100, 36, K.ui('back', 'BACK')),
        btns: null
      };
      S.btns = [S.bBack];
      build();
      for (i = 0; i < S.items.length; i++) if (S.items[i].t === 'head') S.items[i].w = R.Font.width(S.items[i].text);
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
      var y0 = S.viewTop - S.scroll.off(), i, it, y;
      g.fillStyle = K.hex(2); g.fillRect(0, 0, 180, E.H);
      g.save();
      g.beginPath(); g.rect(0, S.viewTop, 180, S.viewH); g.clip();
      for (i = 0; i < S.items.length; i++) {
        it = S.items[i]; y = y0 + it.y;
        if (y + it.h < S.viewTop || y > S.viewTop + S.viewH) continue;
        drawItem(g, it, y);
      }
      g.restore();
      S.scroll.drawBar(g);
      K.topBar(g, S.title, S.note);
      g.fillStyle = K.hex(2); g.fillRect(0, S.bottom - 44, 180, E.H - S.bottom + 44);
      g.fillStyle = K.hex(5); g.fillRect(0, S.bottom - 44, 180, 1);
      S.bBack.draw(g);
    },
    down: function (x, y) {
      if (!S || S.leaving) return;
      if (K.press(S.btns, x, y)) return;
      S.scroll.down(x, y);
    },
    move: function (x, y) { if (S) S.scroll.move(x, y); },
    up: function (x, y) {
      if (!S || S.leaving) return;
      var b = K.release(S.btns, x, y);
      S.scroll.up();
      if (b === S.bBack) goBack();
    },
    key: function (k) { if (S && k === 'OK') goBack(); },
    back: function () { if (S) goBack(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.dossier = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
