// SHOW ME MY RIVAL — YOU DIED. Entered on black, after the duel scene has played the death and faded.
// Timeline (DESIGN 14): black -> "YOU DIED" dithers in, spacing widens -> the Rival's parting line ->
// what it learned this run -> unlock cards -> TAP TO RISE. First tap fast-forwards; the exit tap is
// only taken 1.2 s after the first text is on screen.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var SCALE3 = { scale: 3 };

  function* wait(sec) {
    var until = S.clock + sec;
    yield function () { return !S || S.skip || S.clock >= until; };
  }
  function markText() { if (S.firstText < 0) S.firstText = S.clock; }

  function* flow() {
    var i;
    yield* wait(0.5);
    S.died = 0.0001;
    K.sfx('you_died'); E.buzz(200);
    yield* wait(2.5);
    S.sub = true; markText();
    if (S.typer.set(S.parting, 0, true)) {
      yield function () { return !S || S.skip || S.typer.done; };
      yield* wait(1.0);
    }
    for (i = 0; i < S.ins.length; i++) {
      S.insN = i + 1; S.ins[i].t = 0;
      if (!S.skip) K.sfx('tick', { pitch: 0.8 });
      yield* wait(0.3);
    }
    if (S.ins.length) yield* wait(0.6);
    while (!S.skip && S.reel.shown < S.reel.n) {
      S.reel.reveal();
      yield* wait(1.5);
    }
    finish();
  }

  // Everything on screen, final state.
  function finish() {
    var i;
    if (S.died < 3) S.died = 3;
    S.sub = true; markText();
    if (S.parting && !S.typer.active) S.typer.set(S.parting, 0, true);
    S.typer.skip();
    S.insN = S.ins.length;
    for (i = 0; i < S.ins.length; i++) if (S.ins[i].t < 0) S.ins[i].t = 1;
    S.reel.revealAll();
    S.done = true;
  }

  function canLeave() { return S.done && S.firstText >= 0 && S.clock >= S.firstText + 1.2; }

  function tap() {
    if (S.leaving) return;
    if (!S.done) { S.skip = true; return; }             // the coroutine runs out on the next frame
    if (!canLeave()) return;
    S.leaving = true;
    K.sfx('select');
    // "One more run": rise straight into the next attempt (relic choice first, if any are unlocked).
    if (R.Game && R.Game.startFlow) R.Game.startFlow();
    else E.go('title', null, 0.4);
  }

  function layout() {
    var L = K.layout(), y, i;
    S.top = L.top; S.bottom = L.bottom;
    y = L.top + 58;
    S.partY = y;
    y += Math.max(1, S.partN) * 9 + 8;
    S.insY = y;
    if (S.ins.length) {
      y += 11;
      for (i = 0; i < S.ins.length; i++) { S.ins[i].y = y; y += S.ins[i].lines.length * 9 + 4; }
      y += 4;
    }
    S.reelY = Math.min(y, L.bottom - 20 - S.reel.h);
  }

  var scene = {
    enter: function () {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      var last = G.last || {}, T = R.Text || {}, i, st, s, text, chars = [], widths = [], total = 0, ex, cat;
      var duel = last.duel | 0 || 1, score = Math.max(0, Math.min(100, Math.round(last.score || 0)));
      ex = { duel: duel, rivalHp: last.rivalHp | 0, turns: last.turns | 0, score: score, hp: 0 };
      cat = duel === 1 ? 'player_death_duel1' : duel === 7 ? 'player_death_final' : (last.rivalHp | 0) <= 2 ? 'player_death_close' : 'player_death';
      text = K.ui('youDied', 'YOU DIED');
      for (i = 0; i < text.length; i++) { chars.push(text.charAt(i)); widths.push(R.Font.width(text.charAt(i), 3)); total += widths[i]; }
      S = {
        clock: 0, skip: false, done: false, leaving: false, firstText: -1,
        top: 0, bottom: 320, partY: 0, insY: 0, reelY: 0,
        died: 0, chars: chars, widths: widths, wSum: total, sub: false,
        subLine: 'DUEL ' + duel + ' / 7 · PREDICTABILITY ' + score,
        parting: K.taunt(cat, ex) || K.taunt('player_death', ex) || '...',
        partN: 0, typer: K.typer(164, 3),
        ins: [], insN: 0, insHead: K.ui('learned', 'WHAT I LEARNED'),
        reel: K.reel(last.unlocks || []),
        rise: K.ui('tapToRise', 'TAP TO RISE'),
        fx: R.FX.create(80)
      };
      S.partN = K.wrap(S.parting, 164, 3).length;
      for (i = 0; last.insights && i < last.insights.length && i < 3; i++) {
        st = last.insights[i]; s = null;
        try { s = T.taunt && T.tauntVars ? T.taunt('learned_lines', T.tauntVars(st), G.crng) : null; } catch (e) { s = null; }
        if (!s) { try { s = T.dossierLine ? T.dossierLine(st) : null; } catch (e2) { s = null; } }
        if (s) S.ins.push({ lines: K.wrap(s, 156, 3), y: 0, t: -1 });
      }
      layout();
      S.fx.ambient('ash', 2);
      K.music('death', 1.5);
      E.co(function* () { yield* flow(); });
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      var i;
      S.clock += dt;
      if (S.died > 0) S.died += dt;
      S.typer.update(dt);
      S.reel.update(dt);
      S.fx.update(dt);
      for (i = 0; i < S.insN; i++) if (S.ins[i].t >= 0 && S.ins[i].t < 1) S.ins[i].t = Math.min(1, S.ins[i].t + dt * 4);
    },
    draw: function (g) {
      if (!S) return;
      var i, j, x, y, it, lines, gap, w, level, dx;
      g.fillStyle = K.hex(1); g.fillRect(0, 0, 180, E.H);
      S.fx.draw(g);

      // YOU DIED: dithers in over 4 steps while the letter spacing widens for 2 s
      if (S.died > 0) {
        gap = 3 + Math.min(4, Math.floor(S.died * 2));              // 3 -> 7 px between glyphs
        w = S.wSum + (S.chars.length - 1) * gap;
        x = 90 - (w >> 1); y = S.top + 16;
        for (i = 0; i < S.chars.length; i++) {
          if (S.chars[i] !== ' ') R.Font.draw(g, S.chars[i], x, y, 18, SCALE3);
          x += S.widths[i] + gap;
        }
        level = Math.floor(S.died / 0.225) + 1;
        if (level < 4) K.dither(g, 90 - (w >> 1), y, w, 24, level, 3, 1);
        g.fillStyle = K.hex(16); g.fillRect(90 - (w >> 1), y + 27, level >= 4 ? w : 0, 1);
      }
      if (S.sub) R.Font.draw(g, S.subLine, 90, S.top + 46, 7, K.C);

      // the parting line, typed on black
      if (S.typer.active) {
        lines = S.typer.view();
        x = 90 - (S.typer.w >> 1);
        for (i = 0; i < lines.length; i++) R.Font.draw(g, lines[i], x, S.partY + i * 9, 10);
      }

      // what it learned
      if (S.insN > 0) {
        R.Font.draw(g, S.insHead, 8, S.insY, 18);
        for (i = 0; i < S.insN; i++) {
          it = S.ins[i];
          if (it.t < 0) continue;
          dx = Math.round((1 - it.t) * 12);
          g.fillStyle = K.hex(17); g.fillRect(8 + dx, it.y, 1, it.lines.length * 9 - 2);
          for (j = 0; j < it.lines.length; j++) R.Font.draw(g, it.lines[j], 13 + dx, it.y + j * 9, K.ramp(it.t, 11));
        }
      }

      S.reel.draw(g, 4, S.reelY);

      if (S.done && canLeave() && (Math.floor(S.clock * 1.7) & 1) === 0) R.Font.draw(g, S.rise, 90, S.bottom - 14, 10, K.C);
    },
    down: function () { if (S) tap(); },
    key: function () { if (S) tap(); },
    back: function () { if (S) tap(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.death = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
