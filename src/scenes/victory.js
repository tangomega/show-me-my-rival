// SHOW ME MY RIVAL — victory: quiet. Dawn, ash, the fallen mask, what it cost.
(function (R) {
  'use strict';

  var E, G, K, S = null;

  function* wait(sec) {
    var until = S.clock + sec;
    yield function () { return !S || S.skip || S.clock >= until; };
  }
  function markText() { if (S.firstText < 0) S.firstText = S.clock; }

  function* flow() {
    var i;
    yield* wait(1.0);
    S.head = 0.0001; markText();
    if (!S.skip) K.sfx('bell', { pitch: 0.8 });
    yield* wait(1.4);
    S.panel = true;
    if (S.typer.set(S.line, 0, true)) {
      yield function () { return !S || S.skip || S.typer.done; };
      yield* wait(0.7);
    }
    for (i = 0; i < S.rows.length; i++) {
      S.rowN = i + 1;
      if (!S.skip) K.sfx('tick', { pitch: 1 + i * 0.05 });
      yield* wait(0.28);
    }
    yield* wait(0.5);
    while (!S.skip && S.reel.shown < S.reel.n) {
      S.reel.reveal();
      yield* wait(1.5);
    }
    finish();
  }

  function finish() {
    if (S.head < 2) S.head = 2;
    markText();
    S.panel = true;
    if (S.line && !S.typer.active) S.typer.set(S.line, 0, true);
    S.typer.skip();
    S.rowN = S.rows.length;
    S.reel.revealAll();
    S.done = true;
  }

  function canLeave() { return S.done && S.firstText >= 0 && S.clock >= S.firstText + 1.2; }

  function tap() {
    if (S.leaving) return;
    if (!S.done) { S.skip = true; return; }
    if (!canLeave()) return;
    S.leaving = true;
    K.sfx('select');
    if (S.firstWin) E.go('credits', S.credArgs, 0.6);
    else E.go('title', null, 0.4);
  }

  function layout() {
    var L = K.layout(), spare;
    S.top = L.top; S.bottom = L.bottom;
    S.panelH = 10 + Math.max(1, S.lineN) * 9 + 5 + S.rows.length * 10 + (S.boons.length ? 16 : 0) + 4;
    // bottom-up: prompt, unlock reel, summary panel; the scene takes what is left
    S.reelY = L.bottom - 20 - S.reel.h;
    S.panelY = S.reelY - 4 - S.panelH;
    spare = S.panelY - (L.top + 30);
    S.floorY = S.panelY - 10 - Math.max(0, Math.min(30, (spare - 76) >> 1));
    S.maskY = Math.max(L.top + 28, S.floorY - 54);
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var last = G.last || {}, T = R.Text || {}, i, fm;
      var score = Math.max(0, Math.min(100, Math.round(last.score || 0)));
      fm = last.finishingMove && T.move ? T.move(last.finishingMove) : '';
      S = {
        clock: 0, skip: false, done: false, leaving: false, firstText: -1, firstWin: !!last.firstWin,
        top: 0, bottom: 320, floorY: 100, maskY: 40, panelY: 0, panelH: 0, reelY: 0,
        head: 0, title: K.ui('victory', 'THE MASK FALLS'),
        line: K.taunt('victory_summary', { hp: last.hp | 0, turns: last.turns | 0, score: score, duel: 7 }) || '',
        lineN: 0, typer: K.typer(160, 3), panel: false,
        rows: [], rowN: 0, boons: [], boonLabel: 'BOONS',
        reel: K.reel(last.unlocks || []),
        prompt: last.firstWin ? K.ui('tapToContinue', 'TAP TO CONTINUE') : K.ui('tapToRise', 'TAP TO RISE'),
        fx: R.FX.create(120), bgOpts: { arena: 'pale_dawn', floorY: 0, variant: 7, gutter: 1, phase2: false },
        credArgs: { from: 'victory' }
      };
      S.lineN = K.wrap(S.line, 160, 3).length;
      S.rows.push({ label: 'TURNS', value: String(last.turns | 0) });
      S.rows.push({ label: 'PREDICTABILITY', value: String(score) });
      if (fm) S.rows.push({ label: 'FINISHING MOVE', value: fm.toUpperCase() });
      S.rows.push({ label: 'HP LEFT', value: String(last.hp | 0) });
      for (i = 0; last.boons && i < last.boons.length && i < 8; i++) S.boons.push(K.boonInfo(last.boons[i], 48));
      if (!S.boons.length) S.rows.push({ label: 'BOONS', value: 'NONE' });
      layout();
      S.fx.ambient('ash', 5);
      K.music(null, 1.5);
      E.co(function* () { yield* flow(); });
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt;
      if (S.head > 0) S.head += dt;
      S.typer.update(dt);
      S.reel.update(dt);
      S.fx.update(dt);
    },
    draw: function (g) {
      if (!S) return;
      var i, y, lines, level;
      S.bgOpts.floorY = S.floorY;
      R.Art.bg(g, 'cathedral', S.clock, S.bgOpts);
      R.Art.sprite(g, 'title_mask', 58, S.maskY);
      S.fx.draw(g);

      if (S.head > 0) {
        R.Font.draw(g, S.title, 90, S.top + 8, 10, K.C2S);
        level = Math.floor(S.head / 0.2) + 1;
        if (level < 4) K.dither(g, 10, S.top + 8, 160, 18, level, 2, 1);
      }

      if (S.panel) {
        R.UI.panel(g, 4, S.panelY, 172, S.panelH, 'dark');
        y = S.panelY + 6;
        if (S.typer.active) {
          lines = S.typer.view();
          for (i = 0; i < lines.length; i++) R.Font.draw(g, lines[i], 10, y + i * 9, 10);
        }
        y += Math.max(1, S.lineN) * 9 + 3;
        g.fillStyle = K.hex(5); g.fillRect(10, y, 160, 1);
        y += 4;
        for (i = 0; i < S.rowN; i++) {
          R.Font.draw(g, S.rows[i].label, 10, y, 7);
          R.Font.draw(g, S.rows[i].value, 170, y, i === 1 ? 21 : 10, K.RT);
          y += 10;
        }
        if (S.boons.length && S.rowN >= S.rows.length) {
          R.Font.draw(g, S.boonLabel, 10, y + 3, 7);
          for (i = 0; i < S.boons.length; i++) K.icon(g, S.boons[i], 170 - (S.boons.length - i) * 13, y);
        }
      }

      S.reel.draw(g, 4, S.reelY);
      if (S.done && canLeave() && (Math.floor(S.clock * 1.7) & 1) === 0) R.Font.draw(g, S.prompt, 90, S.bottom - 14, 10, K.CS);
    },
    down: function () { if (S) tap(); },
    key: function () { if (S) tap(); },
    back: function () { if (S) tap(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.victory = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
