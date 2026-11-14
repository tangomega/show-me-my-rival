// SHOW ME MY RIVAL — the duel scene: turn flow, reveal choreography, taunts, HUD.
// Fairness: the Rival's commit lives in a local `sealed` inside the turn coroutine.
// Input handlers can only write S.choice; they never hold a reference to the sealed move.
(function (R) {
  'use strict';

  var E, G, S = null;
  var L = { top: 0, hudY: 0, arenaY: 34, arenaH: 170, floorY: 172, bandY: 204, rowY: 238, btnY: 262, btnH: 52 };
  var MOVES = ['S', 'G', 'F'];
  var ANIM = { S: 'strike', G: 'guard', F: 'feint' };
  var MCOL = { S: 19, G: 28, F: 30 };
  var BTN_X = { S: 4, G: 62, F: 120 };
  var PX = 44, RX = 136;                       // fighter feet x
  var STATUS = ['guardBroken', 'bleed', 'fortify', 'focus'];

  function hex(i) { return R.Pal.hex[i]; }
  function sfx(n, o) { if (R.Audio) R.Audio.sfx(n, o); }
  function ui(k, d) { var u = R.Text && R.Text.ui; return (u && u[k]) || d; }
  function mname(m) { return R.Text && R.Text.move ? R.Text.move(m) : ({ S: 'Strike', G: 'Guard', F: 'Feint' })[m]; }
  function boonName(id) {
    var t = R.Text && R.Text.boon && R.Text.boon[id];
    if (t && t.name) return t.name;
    var b = R.Boons.byId[id];
    return b ? b.name : id;
  }
  function taunt(cat, extra) {
    if (!R.Text || !R.Text.taunt) return null;
    return R.Text.taunt(cat, G.vars(extra), G.crng);   // cosmetic rng: never the gameplay stream
  }
  function low(f) { return f.hp > 0 && f.hp <= Math.ceil(f.maxHp / 3); }
  function hasEv(list, t) { for (var i = 0; i < list.length; i++) if (list[i].t === t) return list[i]; return null; }

  // ------------------------------------------------------------------ layout
  function layout() {
    var top = E.safe.top | 0, bot = E.safe.bottom | 0;
    var avail = E.H - top - bot, ex = avail - 320;
    var arenaH = 170, btnH = 52;
    if (ex >= 0) { arenaH += Math.min(ex, 40); btnH += Math.max(0, Math.min(ex - 40, 24)); }
    else { arenaH = Math.max(118, arenaH + ex); }
    L.top = top; L.hudY = top; L.arenaY = top + 34; L.arenaH = arenaH;
    L.floorY = L.arenaY + arenaH - 32;
    L.bandY = L.arenaY + arenaH; L.rowY = L.bandY + 34; L.btnY = L.rowY + 24; L.btnH = btnH;
  }

  // ------------------------------------------------------------------ actors
  function mkActor(who, x, flip) {
    return { who: who, x: x, ox: 0, oy: 0, anim: 'idle', def: null, t: 0, mode: 'loop', white: 0, flip: flip, hidden: false };
  }
  function play(a, name, mode) {
    var def = R.Art.anim(a.who, name) || R.Art.anim(a.who, 'idle');
    a.anim = name; a.def = def; a.t = 0;
    a.mode = mode || (def.loop ? 'loop' : 'once');
  }
  function frameOf(a) {
    var d = a.def, t = a.t;
    if (a.mode === 'loop') return R.Art.frameAt(d, t % d.total);
    if (t < d.total) return R.Art.frameAt(d, t);
    if (a.mode === 'tell' && d.n >= 2) return d.n - 2 + (Math.floor((t - d.total) / 380) % 2);
    return d.n - 1;
  }
  function tickActor(a, ms) {
    a.t += ms;
    if (a.white > 0) a.white -= ms;
    if (a.mode === 'once' && a.t >= a.def.total) play(a, 'idle', 'loop');
  }
  function slide(a, to, sec) { return E.tween(a, 'ox', to, sec); }

  // ------------------------------------------------------------------ bubble + floats
  function say(text, sticky) {
    if (!text) return false;
    var lines = R.Font.wrap(text, 160);
    if (lines.length > 3) lines.length = 3;
    var total = 0;
    for (var i = 0; i < lines.length; i++) total += lines[i].length;
    S.bub = { lines: lines, vis: [], n: 0, shown: -1, total: total, acc: 0, done: false, hold: sticky ? 3.2 : 1.9, sticky: !!sticky };
    S.silent = 0;
    return true;
  }
  function tickBubble(dt) {
    var b = S.bub;
    if (!b) return;
    if (!b.done) {
      b.acc += dt;
      while (b.acc >= 0.028 && b.n < b.total) {
        b.acc -= 0.028; b.n++;
        if ((b.n & 1) === 0) sfx('type');
      }
      if (b.n >= b.total) b.done = true;
    } else {
      b.hold -= dt;
      if (b.hold <= 0) S.bub = null;
    }
  }
  function bubbleLines(b) {
    if (b.shown === b.n) return b.vis;
    var left = b.n;
    b.vis.length = 0;
    for (var i = 0; i < b.lines.length && left > 0; i++) {
      var ln = b.lines[i];
      b.vis.push(left >= ln.length ? ln : ln.substring(0, left));
      left -= ln.length;
    }
    b.shown = b.n;
    return b.vis;
  }
  function* sayWait(text, hold) {
    if (!say(text, true)) return;
    S.tapped = false;
    yield function () { return !S.bub || S.bub.done || S.tapped; };
    if (S.bub && !S.bub.done) { S.bub.n = S.bub.total; S.bub.done = true; }
    S.tapped = false;
    var until = S.clock + (hold == null ? 1.2 : hold);
    yield function () { return S.clock >= until || S.tapped; };
    S.tapped = false;
  }
  function floatText(text, x, y, col, big) {
    var f = null, i;
    for (i = 0; i < S.floats.length; i++) if (S.floats[i].life <= 0) { f = S.floats[i]; break; }
    if (!f) { if (S.floats.length >= 10) return; f = {}; S.floats.push(f); }
    f.text = String(text); f.x = x; f.y = y; f.col = col; f.life = 0.9; f.big = !!big;
  }
  function sideX(side) { return side === 'p' ? PX : RX; }
  function headY() { return L.floorY - 46; }

  // ------------------------------------------------------------------ helpers
  function cfgOf(duel) { return duel.phase === 2 ? R.Run.DUELS.phase2 : R.Run.DUELS[duel.n]; }
  function argmaxMove(pred, legal) {
    var best = legal[0], i;
    for (i = 1; i < legal.length; i++) if (pred[legal[i]] > pred[best]) best = legal[i];
    return best;
  }
  function syncHp() {
    var d = S.duel;
    S.hp.p = d.p.hp; S.hp.r = d.r.hp;
    if (S.lag.p < S.hp.p) S.lag.p = S.hp.p;
    if (S.lag.r < S.hp.r) S.lag.r = S.hp.r;
    hpText();
  }
  function hpText() {
    var d = S.duel;
    S.txtP = Math.max(0, Math.round(S.hp.p)) + '/' + d.p.maxHp;
    S.txtR = Math.max(0, Math.round(S.hp.r)) + '/' + d.r.maxHp;
  }
  function hurt(side, n) {
    if (n <= 0) return;
    S.hp[side] = Math.max(0, S.hp[side] - n);
    S.lagWait[side] = 0.3;
    hpText();
  }
  function mood() {
    var d = S.duel;
    S.deathblow = d.tension >= 3;
    if (R.Audio) R.Audio.heartbeat(S.deathblow ? 100 : (low(d.p) ? 66 : 0));
  }
  function setLegal() {
    var lp = R.Combat.legal(S.duel, 'p');
    S.legal.S = lp.indexOf('S') >= 0; S.legal.G = lp.indexOf('G') >= 0; S.legal.F = lp.indexOf('F') >= 0;
    return lp;
  }
  function hintFor(duel) {
    if (S.called) return 'IT CALLS: ' + mname(S.called).toUpperCase();
    if (duel.p.status.guardBroken > 0) return ui('guardBroken', 'GUARD BROKEN');
    if (duel.tension >= 3) return ui('deathblow', 'DEATHBLOW');
    return null;
  }

  // ------------------------------------------------------------------ tutorial script
  function tutorialBeat(turn) {
    var T = (R.Text && R.Text.tutorial) || {};
    if (turn === 1) return { force: { move: 'S', tell: 'S' }, only: 'G', line: T.t1_tell, observe: false };
    if (turn === 2) return { force: { move: 'G', tell: 'G' }, only: 'F', line: T.t2_tell, observe: false };
    if (turn === 3) return { force: { move: 'F', tell: 'S' }, only: null, line: T.t3_tell, observe: true, last: true };
    return null;
  }
  function tutorialResult(turn, pm) {
    var T = (R.Text && R.Text.tutorial) || {};
    if (turn === 1) return T.t1_result;
    if (turn === 2) return T.t2_result;
    if (turn === 3) return pm === 'G' ? T.t3_guard : (pm === 'S' ? T.t3_strike : T.t3_feint);
    return null;
  }

  // ------------------------------------------------------------------ main flow
  function* flow(resumed) {
    var run = G.run;
    if (!resumed) yield* intro();
    for (;;) {
      while (!S.duel.over) yield* turn();
      var winner = S.duel.over;
      if (winner === 'p' && run.duelN === 7 && S.duel.phase === 1) {
        yield* transform();
        continue;
      }
      yield* outro(winner);
      return;
    }
  }

  function introLine() {
    var m = G.meta.memory, run = G.run, n = run.duelN, t = null;
    if (S.tutorial) return (R.Text.tutorial && R.Text.tutorial.intro) || null;
    if (n === 7) return taunt('final_duel_intro');
    if (n === 1) {
      var runs = m.runs;
      if (G.days >= 2) t = taunt('returning');
      if (!t && runs === 50) t = taunt('run_50');
      if (!t && (runs === 5 || runs === 10 || runs === 25 || runs === 100 || runs === 200)) t = taunt('milestone_runs_' + runs);
      if (!t && m.streakL >= 3 && G.crng.chance(0.8)) t = taunt('lose_streak', { streak: m.streakL });
      if (!t && m.streakW >= 2) t = taunt('win_streak', { streak: m.streakW });
      if (t) return t;
    }
    var dos = G.brain.dossier();
    if (dos.broken && !run.stats.flags.brokenSaid) {
      run.stats.flags.brokenSaid = true;
      t = taunt('habit_broken', R.Text.tauntVars ? R.Text.tauntVars(dos.broken) : dos.broken.vars);
      if (t) return t;
    }
    if (G.crng.chance(0.8)) {
      var open = null;
      for (var i = 0; i < dos.stats.length; i++) if (dos.stats[i].id === 'opening' && dos.stats[i].strength > 0) open = dos.stats[i];
      return taunt('duel_intro', open ? (R.Text.tauntVars ? R.Text.tauntVars(open) : open.vars) : null);
    }
    return null;
  }

  function* intro() {
    var n = S.duelN;
    S.banner = { t: 0, a: 'DUEL ' + n, b: (R.Text.duelNames && R.Text.duelNames[n - 1]) || '' };
    S.rv.ox = 50; play(S.rv, 'idle', 'loop');
    slide(S.rv, 0, 0.5);
    sfx('step');
    yield 0.25; sfx('step');
    yield 0.45;
    var line = introLine();
    if (line) {
      play(S.rv, n === 7 ? 'taunt2' : 'taunt', 'once');
      yield* sayWait(line, 1.0);
    } else {
      yield 0.4;
    }
  }

  function* turn() {
    var duel = S.duel, run = G.run, brain = G.brain;
    var pend = run.pending;
    var resume = !!(pend && pend.turn === duel.turn && pend.n === duel.n && pend.phase === duel.phase);
    S.resolving = false;

    // 1. turn start (skipped when resuming a turn whose commit was already saved)
    if (!resume) {
      var evs = R.Combat.beginTurn(duel);
      if (evs && evs.length) yield* showEvents(evs, true);
      syncHp();
      if (duel.over) return;
    }
    mood();
    if (!duel.intel) duel.intel = {};

    var tut = S.tutorial ? tutorialBeat(duel.turn) : null;
    var ctx = R.Combat.ctx(duel);
    var legalP = setLegal();
    var legalR = R.Combat.legal(duel, 'r');
    var cfg = cfgOf(duel);

    // 2. the Rival commits. Nothing below this line can change its move.
    var sealed, called = null;
    if (resume) {
      sealed = pend.sealed; called = pend.called || null;
      duel.intel.called = called;
    } else {
      if (duel.phase === 2 && duel.turn % 3 === 2) called = argmaxMove(brain.predict(ctx, legalP), legalP);
      duel.intel.called = called;
      var q = { ctx: ctx, payoff: R.Combat.payoff(duel), legalR: legalR, legalP: legalP,
                exploit: cfg.exploit, honestyBase: cfg.honesty, rng: G.rng };
      if (tut && tut.force) q.force = tut.force;
      sealed = brain.commit(q);
      run.pending = { sealed: sealed, turn: duel.turn, n: duel.n, phase: duel.phase, called: called };
      G.save();
    }
    S.called = called;
    S.rSigil = 'sealed'; S.rSigilT = 0; S.pSigil = 'gone'; S.glass = null; S.stamp = null;
    sfx('seal');
    yield 0.3;

    // 3. stance (the tell) — public information
    S.tell = sealed.tell;
    play(S.rv, 'tell_' + sealed.tell, 'tell');
    yield 0.35;

    var info = R.Combat.info ? R.Combat.info(duel) : null;
    S.infoLine = null;
    if (info) {
      if (info.coinTurn1 && duel.turn === 1) S.stamp = sealed.honest;
      if (info.ledger) S.infoLine = 'IT EXPECTS ' + mname(sealed.top).toUpperCase() + (sealed.confidence > 0.66 ? ' !!!' : sealed.confidence > 0.33 ? ' !!' : ' !');
      else if (info.tally) S.infoLine = 'HONESTY ~' + (Math.round(brain.honesty(cfg.honesty) * 10) * 10) + '%';
    }

    // pre-pick line: tutorial, Called Shot, or the Rival naming your habit right when it applies
    var spoke = false;
    if (tut && tut.line) spoke = say(tut.line, true);
    else if (called) { spoke = say(taunt('called_shot_call', { move: mname(called), moveLower: mname(called).toLowerCase() }), true); sfx('bell', { pitch: 0.7 }); }
    else if (!S.tutorial && S.cool <= 0 && S.nHabit < 2) {
      var hab = brain.habitFor(ctx);
      if (hab && hab.strength > 0 && S.saidHabit !== hab.id && G.crng.chance(0.35 * (S.silent >= 3 ? 2 : 1))) {
        spoke = say(taunt('habit_detected', R.Text.tauntVars ? R.Text.tauntVars(hab) : hab.vars));
        if (spoke) { S.nHabit++; S.saidHabit = hab.id; S.cool = 1; }
      }
    }

    // 4. the player's window. Only S.choice is written by input.
    S.only = tut ? tut.only : null;
    S.glow = tut ? tut.only : null;
    S.reveal = function (kind) {               // active boons (Keyhole / Candle of Truth)
      if (kind === 'glimpse') S.glass = sealed.move;
      else if (kind === 'honesty') S.stamp = sealed.honest;
    };
    S.choice = null; S.coin = false; S.idleT = 0;
    S.fast = false; E.timeScale = 1;
    S.hint = hintFor(duel);
    S.input = true;
    yield function () { return S.choice !== null; };
    S.input = false; S.reveal = null; S.glow = null;
    var pm = S.choice;
    if (S.bub && !S.bub.sticky) S.bub = null;

    // lock-in
    S.pSigil = 'sealed'; S.pSigilT = 0;
    sfx('select'); E.buzz(8);
    yield 0.2;

    // 5. resolve the rules now; everything after this is presentation
    duel.intel.honest = sealed.honest; duel.intel.pred = sealed.pred; duel.intel.coin = S.coin;
    var tensionBefore = duel.tension;
    var res = R.Combat.resolve(duel, pm, sealed.move);
    if (!tut || tut.observe) brain.observe(ctx, sealed.tell, pm, sealed.move);
    R.Run.record(run, G.meta, res, sealed);
    run.pending = null;
    if (tut && tut.last) G.meta.seenTutorial = true;
    G.save();

    S.resolving = true;
    yield* present(res, sealed, pm, tensionBefore);

    // 6. the Rival comments
    S.called = null; S.infoLine = null; S.stamp = null; S.glass = null;
    if (S.cool > 0) S.cool--;
    var line = tut ? tutorialResult(res.turn, pm) : reaction(res, sealed, pm, called);
    if (line) {
      if (tut || S.forceLine) { S.forceLine = false; if (!res.over) yield* sayWait(line, tut ? 1.4 : 0.7); else say(line, true); }
      else say(line);
    } else S.silent++;
    if (!res.over) { play(S.pl, 'idle', 'loop'); play(S.rv, 'idle', 'loop'); }
    S.rSigil = 'gone'; S.pSigil = 'gone';
    mood();
  }

  // Which line (if any) the Rival says after an exchange. Sets S.forceLine for big moments.
  function reaction(res, sealed, pm, called) {
    var duel = S.duel, rng = G.crng, t = null;
    var pAct = sealed.pred[pm] || 0;
    var boost = S.silent >= 3 ? 2 : 1;
    var v = { move: mname(pm), moveLower: mname(pm).toLowerCase(), hp: duel.p.hp, rivalHp: duel.r.hp,
              tellMove: mname(sealed.tell), counterMove: mname(R.LOSES_TO[pm]) };
    function roll(p) { return rng.chance(Math.min(1, p * boost)); }
    if (res.over) return null;                                   // outro handles it
    // forced moments
    if (called) {
      S.forceLine = true;
      if (pm === called && res.winner === 'r') return taunt('called_shot_right', v);
      if (pm !== called) return taunt('called_shot_wrong', v);
    }
    if (hasEv(res.events, 'rupture')) { S.forceLine = true; return taunt('clash_rupture', v); }
    if (!S.lowSaid.p && low(duel.p)) { S.lowSaid.p = true; S.forceLine = true; return taunt('player_low_hp', v); }
    if (!S.lowSaid.r && low(duel.r)) { S.lowSaid.r = true; S.forceLine = true; return taunt('rival_low_hp', v); }
    if (res.clash && res.tensionAfter >= 3 && res.tensionBefore < 3) return taunt('clash_deathblow', v);
    // optional, with cooldown
    if (S.cool > 0) return null;
    if (res.guardBreak === 'p' && roll(0.6)) t = taunt('guard_break_player', v);
    else if (res.guardBreak === 'r' && roll(0.6)) t = taunt('guard_break_rival', v);
    else if (pAct > 0.6 && res.winner === 'r' && S.nRead < 2 && roll(0.5)) { t = taunt('read_you', v); S.nRead++; }
    else if (pAct < 0.2 && res.winner === 'p' && roll(0.6)) { t = taunt('surprised', v); if (t) play(S.rv, 'taunt2', 'once'); }
    else if (!sealed.honest && res.winner === 'p' && roll(0.4)) t = taunt('lie_caught', v);
    else if (!sealed.honest && res.winner === 'r' && roll(0.3)) t = taunt('lie_worked', v);
    else if (res.clash && roll(0.25)) t = taunt('clash_' + pm, v) || taunt('clash', v);
    if (t) S.cool = 1;
    return t;
  }

  // ------------------------------------------------------------------ presentation
  function* showEvents(evs, pause) {
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i], x = sideX(e.side);
      if (e.t === 'bleed') {
        S.fx.burst('blood', x, L.floorY - 24, 4);
        floatText('-' + (e.n || 1), x, headY(), 19);
        hurt(e.side, e.n || 1);
        play(e.side === 'p' ? S.pl : S.rv, 'hit', 'once');
        sfx('hit', { pitch: 0.6 });
        if (pause) yield 0.25;
      } else if (e.t === 'heal') {
        S.fx.burst('heal', x, L.floorY - 20, 6);
        floatText('+' + (e.n || 1), x, headY(), 28);
        sfx('heal');
      } else if (e.t === 'boon' && e.id) {
        floatText(boonName(e.id).toUpperCase(), x, headY() - 10 - (i % 2) * 8, 21);
      } else if (e.t === 'saved') {
        floatText('NOT YET', x, headY() - 10, 23); E.flash(23, 0.2); sfx('bell');
      }
    }
  }

  function* present(res, sealed, pm, tensionBefore) {
    var P = S.pl, V = S.rv, rm = res.rm;
    var fin = !!res.over;
    var cx = 90, cy = L.floorY - 26;

    // pre-reveal hold: the room goes quiet and dark around the two of them
    S.hush = true;
    if (fin) {
      S.noSkip = true; E.timeScale = 1;
      if (R.Audio) R.Audio.heartbeat(0);
      sfx('deathblow');
      E.buzz(12); yield 0.35; E.buzz(12); yield 0.35;
    } else {
      yield (tensionBefore >= 3 ? 0.5 : 0.35);
    }

    // both sigils crack open at the same instant
    S.rSigil = 'crack'; S.pSigil = 'crack'; S.rSigilT = 0; S.pSigilT = 0;
    sfx('crack');
    S.fx.burst('shard', RX, L.floorY - 62, 6);
    S.fx.burst('shard', PX, L.floorY - 60, 6);
    yield 0.18;
    S.rSigil = 'open'; S.pSigil = 'open'; S.shownP = pm; S.shownR = rm;
    S.hush = false;
    floatText(mname(pm).toUpperCase(), PX, L.floorY - 80, MCOL[pm]);
    floatText(mname(rm).toUpperCase(), RX, L.floorY - 82, MCOL[rm]);
    yield 0.14;

    // exchange
    if (fin) E.timeScale = 0.35;
    play(P, ANIM[pm], 'stay'); play(V, ANIM[rm], 'stay');
    sfx(pm === 'S' ? 'whoosh_s' : pm === 'F' ? 'whoosh_f' : 'guard_up');
    sfx(rm === 'S' ? 'whoosh_s' : rm === 'F' ? 'whoosh_f' : 'guard_up', { pitch: 0.85 });
    // Close the 92 px between them so the blades actually meet (about 44 px between feet at contact).
    var wgt = { S: 3, F: 2.5, G: 0.5 }, gap = (pm === 'G' && rm === 'G') ? 12 : 60;
    var stepP = Math.round(gap * wgt[pm] / (wgt[pm] + wgt[rm])), stepR = gap - stepP;
    slide(P, stepP, 0.18); slide(V, -stepR, 0.18);
    yield 0.2;

    // contact
    if (fin) E.timeScale = 1;
    if (res.clash) {
      E.hitStop(0.07);
      S.fx.burst('spark', cx, cy, pm === 'G' ? 4 : 10);
      sfx('clash_' + pm.toLowerCase());
      E.shake(1, 0.1); E.buzz(10);
      play(P, 'clash', 'once'); play(V, 'clash', 'once');
      slide(P, stepP - 5, 0.08); slide(V, -stepR + 5, 0.08);
      var rup = hasEv(res.events, 'rupture');
      if (rup) {
        yield 0.1;
        play(P, 'hit', 'once'); play(V, 'hit', 'once');
        P.white = 60; V.white = 60;
        hurt('p', res.dmgP); hurt('r', res.dmgR);
        if (res.dmgP) floatText('-' + res.dmgP, PX, headY(), 19);
        if (res.dmgR) floatText('-' + res.dmgR, RX, headY(), 19);
        E.shake(3, 0.2); sfx('guard_break'); E.buzz([20, 40, 20]);
        floatText(ui('rupture', 'RUPTURE'), cx, cy - 22, 23, true);
      }
      yield 0.25;
      slide(P, 0, 0.2); slide(V, 0, 0.2);
      if (res.tensionAfter > res.tensionBefore) {
        S.pipPop = 0.3; sfx('bell', { pitch: 1 + 0.18 * res.tensionAfter });
        if (res.tensionAfter >= 3 && res.tensionBefore < 3) {
          yield 0.15;
          sfx('deathblow'); E.shake(2, 0.3); E.buzz(30);
          floatText(ui('deathblow', 'DEATHBLOW'), cx, cy - 22, 21, true);
          mood();
          yield 0.35;
        }
      }
      yield 0.2;
    } else {
      var w = res.winner, loser = w === 'p' ? V : P, win = w === 'p' ? P : V;
      var ls = w === 'p' ? 'r' : 'p', lx = Math.round(loser.x + loser.ox), dir = ls === 'p' ? -1 : 1;
      var dmg = ls === 'p' ? res.dmgP : res.dmgR;
      var broke = res.guardBreak === ls;
      var riposte = (w === 'p' ? pm : rm) === 'G';
      var stop = fin ? 0.32 : broke ? 0.14 : (dmg >= 4 ? 0.13 : 0.09);
      E.hitStop(stop);
      loser.white = 60;
      if (fin) { E.flash(23, 0.18); sfx('final_blow'); E.buzz(60); }
      E.shake(fin ? 4 : dmg >= 6 ? 4 : dmg >= 4 ? 3 : 2, fin ? 0.35 : 0.15);
      if (riposte) { S.fx.burst('spark', lx - dir * 20, cy - 4, 12); sfx('clang'); }
      else if (broke) { S.fx.burst('shard', lx - dir * 8, cy, 16); sfx('guard_break'); }
      else { S.fx.burst('spark', lx - dir * 6, cy, 8); sfx('hit'); }
      if (dmg > 0) {
        S.fx.burst('blood', lx, cy + 2, fin ? 14 : 6, { dir: dir > 0 ? 0 : Math.PI });
        floatText('-' + dmg, lx, headY(), 19, dmg >= 4);
      } else floatText('0', lx, headY(), 8);
      hurt(ls, dmg);
      if (ls === 'p') E.buzz(broke ? [20, 40, 20] : 30);
      if (hasEv(res.events, 'overkill')) floatText(ui('overkill', 'OVERKILL'), cx, cy - 30, 23, true);
      if (tensionBefore > 0) S.pipPop = 0.3;
      play(loser, broke ? 'stagger' : 'hit', (fin || broke) ? 'stay' : 'once');
      slide(loser, loser.ox + dir * 6, 0.08);
      if (broke) floatText(ui('guardBroken', 'GUARD BROKEN'), lx, headY() - 12, 28, true);
      if (fin) { S.fx.burst('ash', lx, cy, 12); yield 0.5; }
      yield broke ? 0.45 : 0.25;
      slide(win, 0, 0.25);
      if (!fin) slide(loser, 0, 0.25);
      yield 0.2;
    }

    // boon triggers, heals, saves
    yield* showEvents(res.events, false);
    syncHp();
    setLegal();
    if (hasEv(res.events, 'boon') || hasEv(res.events, 'heal')) yield 0.3;
    S.noSkip = false;
  }

  function* outro(winner) {
    var duel = S.duel, run = G.run, fin2 = run.duelN === 7 && duel.phase === 2;
    E.timeScale = 1; S.resolving = false; S.input = false;
    if (R.Audio) R.Audio.heartbeat(0);
    if (winner === 'p') {
      S.rSigil = 'gone'; S.pSigil = 'gone';
      slide(S.rv, 0, 0.3);
      play(S.rv, 'death', 'stay');
      if (fin2) { if (R.Audio) R.Audio.music(null, 1.5); S.fx.burst('ash', RX, L.floorY - 20, 24); }
      yield 0.5;
      play(S.pl, 'victory', 'stay');
      var line = taunt(fin2 ? 'rival_defeated_final' : 'rival_defeated', { hp: duel.p.hp });
      yield* sayWait(line, fin2 ? 2.2 : 1.1);
      G.duelOver('p');
    } else {
      if (R.Audio) R.Audio.music(null, 1.2);
      S.dying = 0.001;
      play(S.pl, 'death', 'stay');
      S.fx.burst('ash', PX, L.floorY - 20, 30);
      play(S.rv, 'taunt', 'once');
      E.buzz(200);
      yield 1.5;
      G.duelOver('r');
    }
  }

  // The mask breaks. Duel 7, phase 1 -> phase 2.
  function* transform() {
    var run = G.run, T = R.Text || {};
    E.timeScale = 1; S.noSkip = true; S.resolving = false;
    S.rSigil = 'gone'; S.pSigil = 'gone'; S.bub = null;
    if (R.Audio) { R.Audio.music(null, 0.4); R.Audio.heartbeat(0); }
    play(S.rv, 'stagger', 'stay'); slide(S.rv, 0, 0.3);
    play(S.pl, 'idle', 'loop'); slide(S.pl, 0, 0.3);
    yield 0.8;
    say('...', true);
    yield 0.9;
    S.bub = null;
    play(S.rv, 'transform', 'stay');
    var total = S.rv.def.total / 1000;
    yield total * 0.45;
    E.flash(23, 0.25); E.shake(4, 0.5); sfx('phase2'); E.buzz([40, 60, 120]);
    S.fx.burst('shard', RX, L.floorY - 40, 16);
    E.tween(S, 'gutter', 1, 0.8);
    yield total * 0.55 + 0.5;
    // it rises
    R.Run.endDuel(run, G.meta, 'p', null);       // closes phase 1 (no bonfire: the run stays in stage 'duel')
    var duel = R.Run.startPhase2(run);
    S.duel = duel; S.phase2 = true;
    S.rv.who = 'rival2'; play(S.rv, 'idle', 'loop');
    E.flash(31, 0.3);
    if (R.Audio) R.Audio.music('boss2', 0.3);
    E.tween(S, 'gutter', 0, 0.6);
    S.hp.r = 0; S.lag.r = 0; S.hp.p = duel.p.hp; S.lag.p = duel.p.hp; hpText();
    S.lowSaid.r = false;
    S.fx.burst('heal', PX, L.floorY - 20, 8); sfx('heal');
    var k, steps = duel.r.hp;
    for (k = 1; k <= steps; k++) { S.hp.r = k; S.lag.r = k; hpText(); sfx('tick', { pitch: 0.8 + k * 0.05 }); yield 0.07; }
    G.save();
    play(S.rv, 'taunt', 'once');
    yield* sayWait(taunt('phase2'), 1.2);
    var rules = T.rules || {};
    var cards = [rules.embers || { name: 'EMBERS', line: 'Tension never falls below one.' },
                 rules.called_shot || { name: 'CALLED SHOT', line: 'It names your move. Prove it wrong.' }];
    for (k = 0; k < cards.length; k++) {
      S.card = cards[k]; sfx('boon'); S.tapped = false;
      var until = S.clock + 2.4;
      yield function () { return S.clock >= until || S.tapped; };
    }
    S.card = null; S.tapped = false; S.noSkip = false;
  }

  // ------------------------------------------------------------------ input
  function btnAt(x, y) {
    if (y < L.btnY || y >= L.btnY + L.btnH) return null;
    for (var i = 0; i < 3; i++) { var m = MOVES[i]; if (x >= BTN_X[m] && x < BTN_X[m] + 56) return m; }
    return null;
  }
  function canPick(m) { return S.legal[m] && (!S.only || S.only === m); }
  function activeAt(x, y) {
    if (y < L.rowY + 1 || y >= L.rowY + 23) return -1;
    for (var i = 0; i < S.actives.length; i++) { var ax = 4 + i * 26; if (x >= ax && x < ax + 22) return i; }
    return -1;
  }
  function useActive(i) {
    var id = S.actives[i], duel = S.duel;
    if (!S.input || S.only || !(duel.p.charges && duel.p.charges[id] > 0)) { sfx('back'); return; }
    var r = R.Combat.useActive(duel, id);
    if (!r || !r.ok) { sfx('back'); return; }
    sfx('boon'); E.buzz(10);
    floatText(boonName(id).toUpperCase(), PX, headY() - 10, 21);
    if (r.kind === 'coin') {
      var lp = R.Combat.legal(duel, 'p');
      S.coin = true; S.choice = G.rng.pick(lp);
    } else if (S.reveal) S.reveal(r.kind);
    G.save();
  }
  function pick(m) {
    if (!S.input || S.choice !== null) return;
    if (!canPick(m)) { sfx('back'); return; }
    S.choice = m;
  }

  // ------------------------------------------------------------------ drawing
  var HUSH = null;
  function hushPattern(g) {                      // 50% checker of void, baked once
    if (!HUSH) {
      var c = document.createElement('canvas'); c.width = 2; c.height = 2;
      var cg = c.getContext('2d'); cg.fillStyle = hex(1); cg.fillRect(0, 0, 1, 1); cg.fillRect(1, 1, 1, 1);
      HUSH = g.createPattern(c, 'repeat');
    }
    return HUSH;
  }
  function diamond(g, x, y, col) {
    g.fillStyle = hex(col);
    g.fillRect(x + 3, y, 1, 7); g.fillRect(x + 2, y + 1, 3, 5); g.fillRect(x + 1, y + 2, 5, 3); g.fillRect(x, y + 3, 7, 1);
  }
  function drawHud(g) {
    var d = S.duel, y = L.hudY, i;
    g.fillStyle = hex(2); g.fillRect(0, 0, 180, y + 33);
    g.fillStyle = hex(5); g.fillRect(0, y + 33, 180, 1);
    var pulse = low(d.p) && (Math.floor(S.clock * 2.2) & 1) ? 19 : 18;
    R.UI.bar(g, 4, y + 4, 72, 7, S.hp.p / d.p.maxHp, S.lag.p / d.p.maxHp, pulse, { ticks: d.p.maxHp });
    R.UI.bar(g, 104, y + 4, 72, 7, S.hp.r / d.r.maxHp, S.lag.r / d.r.maxHp, S.phase2 ? 31 : 18, { ticks: d.r.maxHp, flip: true });
    R.Font.draw(g, S.txtP, 4, y + 13, 10);
    R.Font.draw(g, S.txtR, 176, y + 13, 10, { align: 'right' });
    // duel pips
    var n = S.duelN;
    for (i = 1; i <= 7; i++) {
      var c = i < n ? 21 : i === n ? ((Math.floor(S.clock * 2) & 1) ? 10 : 7) : 5;
      if (i === 7 && i > n) c = 18;
      g.fillStyle = hex(c); g.fillRect(77 + (i - 1) * 4, y + 6, 3, 3);
    }
    // tension pips
    var lit = d.tension, pop = S.pipPop > 0;
    for (i = 0; i < 3; i++) {
      var on = i < lit;
      diamond(g, 76 + i * 10, y + 14 - (on && pop ? 1 : 0), on ? ((Math.floor(S.clock * 8 + i) & 1) ? 22 : 21) : 4);
    }
    // boon ledger button
    g.fillStyle = hex(S.ledgerHot ? 25 : 24); g.fillRect(83, y + 23, 14, 9);
    g.fillStyle = hex(3); g.fillRect(84, y + 24, 12, 7);
    g.fillStyle = hex(12); g.fillRect(86, y + 26, 8, 1); g.fillRect(86, y + 28, 8, 1);
    // statuses
    var px = 4, rx = 168, s;
    for (i = 0; i < STATUS.length; i++) {
      s = STATUS[i];
      if (d.p.status[s] > 0) { R.Art.sprite(g, 'st_' + s, px, y + 23); px += 10; }
      if (d.r.status[s] > 0) { R.Art.sprite(g, 'st_' + s, rx, y + 23); rx -= 10; }
    }
    for (i = 0; i < 3; i++) {
      var m = MOVES[i];
      if (d.p.status.sealed && d.p.status.sealed[m] > 0) { R.Art.sprite(g, 'st_sealed', px, y + 23); px += 10; }
      if (d.r.status.sealed && d.r.status.sealed[m] > 0) { R.Art.sprite(g, 'st_sealed', rx, y + 23); rx -= 10; }
    }
  }

  function drawActor(g, a, who) {
    if (a.hidden) return;
    R.Art.fighter(g, who || a.who, a.anim, frameOf(a), Math.round(a.x + a.ox), L.floorY + Math.round(a.oy),
      a === S.rv ? S.rvOpts[a.white > 0 ? 1 : 0] : S.plOpts[a.white > 0 ? 1 : 0]);
  }

  function drawButtons(g) {
    var i, m, y = L.rowY;
    g.fillStyle = hex(2); g.fillRect(0, L.bandY, 180, E.H - L.bandY);
    g.fillStyle = hex(5); g.fillRect(0, L.bandY, 180, 1);
    // active boons
    for (i = 0; i < S.actives.length; i++) {
      var id = S.actives[i], ch = (S.duel.p.charges && S.duel.p.charges[id]) || 0;
      R.UI.button(g, 4 + i * 26, y + 1, 22, 22, '', { disabled: ch <= 0 || !S.input, pressed: S.pressA === i });
      R.Art.sprite(g, 'act_' + ((R.Boons.byId[id].active || {}).kind || 'glimpse'), 4 + i * 26 + 5, y + 5 + (S.pressA === i ? 1 : 0));
      if (ch > 0) R.Font.draw(g, String(ch), 4 + i * 26 + 20, y + 15, 22, { align: 'right' });
    }
    var hint = S.input ? (S.hint || S.infoLine) : null;
    if (hint) R.Font.draw(g, hint, 176, y + 8, S.hint ? ((Math.floor(S.clock * 3) & 1) ? 21 : 19) : 12, { align: 'right' });
    // moves
    for (i = 0; i < 3; i++) {
      m = MOVES[i];
      var dis = !S.input || !canPick(m);
      S.bst.pressed = S.press === m && !dis;
      S.bst.disabled = dis;
      S.bst.icon = m;
      S.bst.glow = S.input && S.glow === m;
      S.bst.accent = MCOL[m];
      S.bst.broken = S.input && !S.legal[m];
      R.UI.button(g, BTN_X[m], L.btnY, 56, L.btnH, S.labels[m], S.bst);
    }
  }

  function drawOverlay(g) {
    var d = S.duel, y = L.arenaY + 4, i, id, b;
    R.UI.panel(g, 4, L.arenaY, 172, L.bandY - L.arenaY + 30, 'dark');
    R.Font.draw(g, 'YOUR BOONS', 10, y + 2, 21); y += 12;
    if (!d.p.boons.length) { R.Font.draw(g, '(none yet)', 10, y, 7); y += 10; }
    for (i = 0; i < d.p.boons.length && y < L.bandY + 10; i++) {
      id = d.p.boons[i]; b = R.Boons.byId[id];
      R.Font.draw(g, boonName(id), 10, y, 10); y += 9;
      var ls = R.Font.wrap(b ? b.desc : '', 158);
      for (var k = 0; k < ls.length; k++) { R.Font.draw(g, ls[k], 14, y, 8); y += 8; }
      y += 2;
    }
    y += 3; R.Font.draw(g, 'ITS BOONS', 10, y, 19); y += 12;
    if (!d.r.boons.length) { R.Font.draw(g, '(none yet)', 10, y, 7); y += 10; }
    for (i = 0; i < d.r.boons.length && y < L.bandY + 10; i++) {
      id = d.r.boons[i]; b = R.Boons.byId[id];
      R.Font.draw(g, boonName(id), 10, y, 10); y += 9;
      var lr = R.Font.wrap(b ? b.desc : '', 158);
      for (var j = 0; j < lr.length; j++) { R.Font.draw(g, lr[j], 14, y, 8); y += 8; }
      y += 2;
    }
  }

  var scene = {
    enter: function (args) {
      E = R.Engine; G = R.Game;
      var run = G.run, meta = G.meta;
      layout();
      var resumed = !!(run.duel && !run.duel.over);
      var duel = resumed ? run.duel : R.Run.startDuel(run);
      var st = R.Save.data.settings;
      S = {
        duel: duel, duelN: run.duelN, clock: 0, phase2: duel.phase === 2, tutorial: run.duelN === 1 && !meta.seenTutorial,
        pl: mkActor('player', PX, false), rv: mkActor(duel.phase === 2 ? 'rival2' : 'rival', RX, true),
        plOpts: [{ flip: false, white: false }, { flip: false, white: true }],
        rvOpts: [{ flip: true, white: false, mask: st.mask }, { flip: true, white: true, mask: st.mask }],
        fx: R.FX.create(220), floats: [], bub: null,
        hp: { p: duel.p.hp, r: duel.r.hp }, lag: { p: duel.p.hp, r: duel.r.hp }, lagWait: { p: 0, r: 0 }, txtP: '', txtR: '',
        legal: { S: true, G: true, F: true }, input: false, choice: null, coin: false, press: null, pressA: -1,
        only: null, glow: null, reveal: null, hint: null, infoLine: null, called: null, tell: null,
        rSigil: 'gone', pSigil: 'gone', rSigilT: 0, pSigilT: 0, shownP: null, shownR: null, glass: null, stamp: null,
        resolving: false, hush: false, fast: false, noSkip: false, tapped: false, overlay: false, ledgerHot: false,
        deathblow: false, bars: 0, gutter: 0, pipPop: 0, banner: null, card: null, dying: 0,
        cool: 0, silent: 0, nHabit: 0, nRead: 0, saidHabit: null, lowSaid: { p: low(duel.p), r: false }, forceLine: false,
        idleT: 0, idleSaid: false,
        actives: [], bst: { pressed: false, disabled: false, icon: 'S', glow: false, accent: 0, broken: false },
        labels: { S: ui('strike', 'STRIKE'), G: ui('guard', 'GUARD'), F: ui('feint', 'FEINT') },
        bgOpts: { variant: run.duelN, gutter: 0, phase2: duel.phase === 2, floorY: 0, arena: st.arena }
      };
      for (var i = 0; i < duel.p.boons.length; i++) {
        var b = R.Boons.byId[duel.p.boons[i]];
        if (b && b.active && S.actives.length < 3) S.actives.push(b.id);
      }
      play(S.pl, 'idle', 'loop'); play(S.rv, 'idle', 'loop');
      hpText(); setLegal();
      S.fx.ambient('ash', 5);
      if (R.Audio) R.Audio.music(run.duelN === 7 ? (duel.phase === 2 ? 'boss2' : 'boss') : 'drone', 1);
      G.save();
      E.co(function* () { yield* flow(resumed); });
    },
    exit: function () {
      E.timeScale = 1;
      if (R.Audio) R.Audio.heartbeat(0);
      S = null;
    },
    update: function (dt) {
      if (!S) return;
      var ms = dt * 1000, i;
      S.clock += dt;
      layout();
      tickActor(S.pl, ms); tickActor(S.rv, ms);
      S.rSigilT += dt; S.pSigilT += dt;
      S.fx.update(dt);
      tickBubble(dt);
      for (i = 0; i < S.floats.length; i++) { var f = S.floats[i]; if (f.life > 0) { f.life -= dt; f.y -= 16 * dt; } }
      // lag bars
      var sides = 'pr';
      for (i = 0; i < 2; i++) {
        var s = sides[i];
        if (S.lag[s] > S.hp[s]) {
          if (S.lagWait[s] > 0) S.lagWait[s] -= dt;
          else S.lag[s] = Math.max(S.hp[s], S.lag[s] - 6.5 * dt);
        }
      }
      if (S.pipPop > 0) S.pipPop -= dt;
      var wantBars = S.deathblow ? 6 : 0;
      if (S.bars < wantBars) S.bars = Math.min(wantBars, S.bars + 30 * dt);
      else if (S.bars > wantBars) S.bars = Math.max(wantBars, S.bars - 30 * dt);
      if (S.banner) { S.banner.t += dt; if (S.banner.t > 2.2) S.banner = null; }
      if (S.dying > 0) S.dying = Math.min(1, S.dying + dt * 0.8);
      // idle heckle
      if (S.input && !S.tutorial && !S.idleSaid) {
        S.idleT += dt;
        if (S.idleT > 14) { S.idleSaid = true; if (G.crng.chance(0.5)) say(taunt('idle')); }
      }
    },
    draw: function (g) {
      if (!S) return;
      var o = S.bgOpts, i;
      o.gutter = Math.max(S.gutter, S.deathblow ? 0.7 : 0); o.phase2 = S.phase2; o.floorY = L.floorY;
      R.Art.bg(g, 'cathedral', S.clock, o);
      if (S.hush) { g.fillStyle = hushPattern(g); g.fillRect(0, L.arenaY, 180, L.arenaH); }
      // loser of the moment is drawn first so the winner's blade overlaps
      drawActor(g, S.rv); drawActor(g, S.pl);
      S.fx.draw(g);
      R.Art.fg(g, 'cathedral', S.clock, o);
      // sigils
      var bob = (Math.floor(S.clock * 1.7) & 1);
      if (S.rSigil !== 'gone') {
        var rs = S.glass && S.rSigil === 'sealed' ? 'open' : S.rSigil;
        var drop = S.rSigil === 'sealed' ? Math.max(0, 6 - Math.floor(S.rSigilT * 40)) : 0;
        R.Art.sigil(g, 128, L.floorY - 70 - drop + bob, rs, S.rSigil === 'sealed' ? S.glass : S.shownR, 'r');
      }
      if (S.pSigil !== 'gone') {
        var dp = S.pSigil === 'sealed' ? Math.max(0, 6 - Math.floor(S.pSigilT * 40)) : 0;
        R.Art.sigil(g, 36, L.floorY - 68 - dp + bob, S.pSigil, S.shownP, 'p');
      }
      if (S.stamp !== null && S.input) {
        R.Font.draw(g, S.stamp ? ui('trueStance', 'TRUE') : ui('falseStance', 'FALSE'), 136, L.floorY - 84, S.stamp ? 28 : 19, { align: 'center', shadow: 1 });
      }
      if (S.called && S.input) R.Font.draw(g, mname(S.called).toUpperCase() + '?', PX, L.floorY - 84, 31, { align: 'center', shadow: 1 });
      // floating numbers / labels
      for (i = 0; i < S.floats.length; i++) {
        var f = S.floats[i];
        if (f.life > 0 && (f.life > 0.25 || (Math.floor(f.life * 30) & 1))) {
          R.Font.draw(g, f.text, Math.max(30, Math.min(150, Math.round(f.x))), Math.round(f.y), f.col, { align: 'center', shadow: 1, scale: f.big && f.text.length < 4 ? 2 : 1 });
        }
      }
      // deathblow letterbox
      if (S.bars >= 1) {
        var k = Math.floor(S.bars);
        g.fillStyle = hex(1); g.fillRect(0, L.arenaY, 180, k); g.fillRect(0, L.bandY - k, 180, k);
      }
      if (S.banner) {
        var bt = S.banner.t;
        if (bt < 1.9 || (Math.floor(bt * 20) & 1)) {
          R.Font.draw(g, S.banner.a, 90, L.arenaY + 16, 10, { align: 'center', shadow: 1, scale: 2 });
          R.Font.draw(g, S.banner.b.toUpperCase(), 90, L.arenaY + 36, 21, { align: 'center', shadow: 1 });
        }
      }
      if (S.dying > 0) {                         // the arena drains to black in steps
        g.fillStyle = hex(1);
        g.globalAlpha = Math.floor(S.dying * 4) / 4; g.fillRect(0, L.arenaY, 180, L.arenaH); g.globalAlpha = 1;
        drawActor(g, S.pl);
      }
      drawHud(g);
      drawButtons(g);
      if (S.bub) R.UI.bubble(g, 4, L.bandY + 2, 172, bubbleLines(S.bub), 136, 'up', S.phase2 ? { phase2: true } : null);
      if (S.card) {
        R.UI.panel(g, 14, L.arenaY + 40, 152, 44, 'card');
        R.Font.draw(g, S.card.name, 90, L.arenaY + 47, 31, { align: 'center', scale: 1 });
        var cl = R.Font.wrap(S.card.line, 140);
        for (i = 0; i < cl.length && i < 2; i++) R.Font.draw(g, cl[i], 90, L.arenaY + 60 + i * 9, 10, { align: 'center' });
      }
      if (S.overlay) drawOverlay(g);
    },
    down: function (x, y) {
      if (!S) return;
      if (S.overlay) { S.overlay = false; sfx('back'); return; }
      S.tapped = true;
      if (y >= L.hudY + 18 && y < L.hudY + 34 && x >= 74 && x < 106) { S.overlay = true; sfx('tick'); return; }
      var a = activeAt(x, y);
      if (a >= 0) { S.pressA = a; return; }
      var m = btnAt(x, y);
      if (m && S.input) { S.press = m; if (canPick(m)) sfx('tick'); return; }
      if (S.resolving && !S.noSkip && !S.fast) { S.fast = true; E.timeScale = 3; }
    },
    up: function (x, y) {
      if (!S) return;
      if (S.pressA >= 0) { var a = activeAt(x, y); if (a === S.pressA) useActive(a); S.pressA = -1; return; }
      if (S.press) { var m = btnAt(x, y); if (m === S.press) pick(m); S.press = null; }
    },
    key: function (k) {
      if (!S) return;
      k = String(k).toLowerCase();
      var m = k === '1' || k === 's' ? 'S' : k === '2' || k === 'g' ? 'G' : k === '3' || k === 'f' ? 'F' : null;
      if (m) pick(m); else S.tapped = true;
    },
    // Test hook: public information only (what a player can see on screen).
    peek: function () { return S ? { input: S.input, tell: S.tell, legal: S.legal, only: S.only, called: S.called } : null; },
    pause: function () { if (S && G) G.save(); },
    back: function () { if (S) S.overlay = !S.overlay; }
  };

  R.Scenes = R.Scenes || {};
  R.Scenes.duel = scene;
})(globalThis.RIVAL = globalThis.RIVAL || {});
