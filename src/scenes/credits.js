// SHOW ME MY RIVAL — end credits. Earned on the first win; replayable from settings.
// A slow roll over the dawn cathedral (22 s), then the one real credit alone on screen, then the
// Rival's last word. Everything in the roll is in-fiction; the only real credit is R.Text.ui.credit.
(function (R) {
  'use strict';

  var E, G, K, S = null;
  var ROLL_T = 22;                               // seconds the roll takes, whatever the screen height

  // ------------------------------------------------------------------ roll content (built once)
  function add(it, gapAfter) { it.y = S.contentH; S.items.push(it); S.contentH += it.h + (gapAfter || 0); }
  function text(str, col, gapAfter) {
    var ls = K.wrap(str, 164, 4);
    if (ls.length) add({ t: 'text', h: ls.length * 9, lines: ls, col: col }, gapAfter);
  }
  function cast(role, detail, foot) {
    var fl = foot ? K.wrap('* ' + foot, 160, 3) : [];
    add({ t: 'cast', h: 21 + (fl.length ? 4 + fl.length * 9 : 0), role: role, lines: K.wrap(detail, 164, 2), foot: fl }, 24);
  }

  function build() {
    var mem = (G.meta && G.meta.memory) || {}, T = R.Text || {};
    var deaths = mem.deaths | 0, runs = mem.runs | 0, wins = mem.wins | 0, turns = mem.totalTurns | 0;
    var vars = G.vars ? G.vars() : {}, pool = (T.taunts && T.taunts.credits_footnotes) || [], notes = [], i, s, last;
    if (vars.deaths === undefined) vars.deaths = deaths;
    if (vars.runs === undefined) vars.runs = runs;
    if (vars.wins === undefined) vars.wins = wins;
    for (i = 0; i < pool.length; i++) {
      s = null;
      try { s = T.fill ? T.fill(pool[i], vars) : null; } catch (e) { s = null; }
      if (s) notes.push(s);
    }
    last = notes.length ? notes.pop() : "You may go now. You won't.";
    if (notes.length > 1 && G.crng && G.crng.shuffle) G.crng.shuffle(notes);
    S.finalLine = last;

    S.items.length = 0; S.contentH = 0;
    add({ t: 'logo', h: 34 }, 30);
    text('What burns here comes back as ash.', 11, 3);
    text('What dies here comes back.', 11, 40);
    text('IN ORDER OF DISAPPEARANCE', 21, 18);
    cast('THE RIVAL', 'as itself', notes[0]);
    cast('YOU', deaths + (deaths === 1 ? ' death, ' : ' deaths, ') + runs + (runs === 1 ? ' attempt' : ' attempts'), notes[1]);
    cast('THE MASK', wins > 1 ? 'broken ' + wins + ' times' : wins === 1 ? 'broken once' : 'unbroken', notes[2]);
    cast('YOUR HABITS', turns + (turns === 1 ? ' move, noted' : ' moves, every one noted'), notes[3]);
    if (notes[4]) text(notes[4], 12, 0);
  }

  function layout() {
    var L = K.layout();
    S.top = L.top; S.bottom = L.bottom; S.h = L.h;
    S.floorY = L.top + Math.round(L.h * 0.62);
    S.speed = (L.h + S.contentH) / ROLL_T;
  }

  function leave() {
    if (S.leaving) return;
    S.leaving = true;
    if (S.from === 'settings') E.go('settings', S.backArgs, 0.5);
    else E.go('title', null, 0.8);
  }

  function* flow() {
    yield function () { return !S || S.roll >= S.h + S.contentH; };
    S.phase = 1; S.pt = 0;                       // the credit, alone
    yield 4.8;
    S.phase = 2; S.pt = 0;                       // the Rival's last word
    S.typer.set(S.finalLine, 0, true);
    yield function () { return !S || S.typer.done; };
    yield 1.6;
    S.phase = 3; S.pt = 0;                       // "It will remember."
    K.sfx('bell', { pitch: 0.7 });
    yield 3.0;
    leave();
  }

  function tap() {
    if (S.leaving) return;
    if (S.hint > 0 && S.clock >= 3) { K.sfx('back'); leave(); return; }
    S.hint = 2.5;
  }

  // fade k for a phase that ramps in over 0.6 s and (if out > 0) back out before `out`
  function fade(t, out) {
    var k = t / 0.6;
    if (out > 0 && t > out - 0.6) k = (out - t) / 0.6;
    return k < 0 ? 0 : k > 1 ? 1 : k;
  }

  function drawItem(g, it, y) {
    var i;
    if (it.t === 'logo') { R.Art.sprite(g, 'logo', 30, y); return; }
    if (it.t === 'text') {
      for (i = 0; i < it.lines.length; i++) R.Font.draw(g, it.lines[i], 90, y + i * 9, it.col, K.CS);
      return;
    }
    R.Font.draw(g, it.role, 90, y, 10, K.CS);
    for (i = 0; i < it.lines.length && i < 1; i++) R.Font.draw(g, it.lines[i], 90, y + 11, 8, K.CS);
    for (i = 0; i < it.foot.length; i++) R.Font.draw(g, it.foot[i], 90, y + 25 + i * 9, 19, K.CS);
  }

  var scene = {
    enter: function (args) {
      E = R.Engine; G = R.Game; K = R.SceneKit;
      S = {
        clock: 0, roll: 0, phase: 0, pt: 0, hint: 0, leaving: false,
        from: (args && args.from) || 'victory', backArgs: { from: (args && args.back) || 'title' },
        top: 0, bottom: 320, h: 320, floorY: 200, speed: 30,
        items: [], contentH: 0, finalLine: '',
        credit: K.ui('credit', 'Developed by tangoSHELL · 2026'),
        remember: K.ui('willRemember', 'It will remember.'),
        skipHint: K.ui('tapAgainSkip', 'tap again to skip'),
        typer: K.typer(160, 3), fx: R.FX.create(120),
        bgOpts: { arena: 'pale_dawn', floorY: 0, variant: 1, gutter: 0, phase2: false }
      };
      build();
      layout();
      if (G.meta) G.meta.seenCredits = true;
      if (G.save) G.save();
      S.fx.ambient('ash', 5);
      K.music('credits', 1.5);
      E.co(function* () { yield* flow(); });
    },
    exit: function () { S = null; },
    resize: function () { if (S) layout(); },
    update: function (dt) {
      if (!S) return;
      S.clock += dt; S.pt += dt;
      if (S.phase === 0) S.roll += S.speed * dt;
      if (S.hint > 0) S.hint -= dt;
      S.typer.update(dt);
      S.fx.update(dt);
    },
    draw: function (g) {
      if (!S) return;
      var i, it, y, y0, k, lines, x, mid = S.top + (S.h >> 1);
      S.bgOpts.floorY = S.floorY;
      R.Art.bg(g, 'cathedral', S.clock, S.bgOpts);
      S.fx.draw(g);

      if (S.phase === 0) {
        y0 = S.bottom - Math.floor(S.roll);                       // pixel-snapped
        for (i = 0; i < S.items.length; i++) {
          it = S.items[i]; y = y0 + it.y;
          if (y > S.bottom || y + it.h < S.top - 2) continue;
          drawItem(g, it, y);
        }
      } else if (S.phase === 1) {
        k = fade(S.pt, 4.8);
        if (k > 0) {
          g.fillStyle = K.hex(1); g.fillRect(0, mid - 14, 180, 27);
          g.fillStyle = K.hex(K.ramp(k, 24)); g.fillRect(0, mid - 14, 180, 1); g.fillRect(0, mid + 12, 180, 1);
          R.Font.draw(g, S.credit, 90, mid - 4, K.ramp(k, 10), K.C);
        }
      } else {
        if (S.typer.active) {
          lines = S.typer.view();
          x = 90 - (S.typer.w >> 1);
          for (i = 0; i < lines.length; i++) R.Font.draw(g, lines[i], x, mid - 24 + i * 9, 10, K.LS);
        }
        if (S.phase === 3) R.Font.draw(g, S.remember, 90, mid + 12, K.ramp(fade(S.pt, 0), 19), K.CS);
      }

      if (S.hint > 0) R.Font.draw(g, S.skipHint, 90, S.bottom - 12, 7, K.CS);
    },
    down: function () { if (S) tap(); },
    key: function () { if (S) tap(); },
    back: function () { if (S) tap(); }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.credits = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
