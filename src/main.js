// SHOW ME MY RIVAL — boot + flow controller (R.Game). Developed by tangoSHELL · 2026.
(function (R) {
  'use strict';

  var E;

  function now() { return Date.now(); }
  function freshSeed() { return ((now() & 0xffffffff) ^ Math.floor(Math.random() * 0x100000000)) >>> 0; }
  // A stored run must be complete enough to resume. Anything else (hand-edited or half-written storage, a save from
  // an older build) is dropped; a current duel or commit of an older shape is dropped alone, so the duel restarts
  // and the run survives.
  function validRun(run) {
    if (!(run && typeof run === 'object' && run.stats && typeof run.stats === 'object' && Array.isArray(run.pBoons) && Array.isArray(run.rBoons))) return false;
    if (run.stage !== 'duel' && run.stage !== 'bonfire') return false;      // 'won' / 'dead' are never resumable
    if (!(run.duelN >= 1 && run.duelN <= 7 && run.pHp >= 0 && run.pMaxHp >= 1)) return false;
    if (run.stage === 'bonfire' && !(run.offer && Array.isArray(run.offer.choices))) return false;
    var d = run.duel, q = run.pending && run.pending.sealed;
    if (d && !(d.turn >= 1 && d.tally && d.p && d.r && d.p.status && d.r.status && d.p.status.sealed && d.r.status.sealed &&
               d.p.counters && d.r.counters && d.p.charges && d.r.charges && Array.isArray(d.p.moves) && Array.isArray(d.r.moves) &&
               Array.isArray(d.p.results) && Array.isArray(d.r.results) && Array.isArray(d.p.boons) && Array.isArray(d.r.boons))) {
      run.duel = null; run.pending = null;
    }
    if (run.pending && !(q && q.pred && typeof q.move === 'string' && typeof q.tell === 'string')) run.pending = null;
    return true;
  }

  // The nearest thing still locked: shown on the death screen as a reason to go again.
  function nextGoal() {
    var U = R.Run.UNLOCKS || [], un = (G.meta && G.meta.unlocked) || {}, i, t;
    for (i = 0; i < U.length; i++) {
      if (un[U[i].id]) continue;
      t = R.Text && R.Text.unlock && R.Text.unlock[U[i].id];
      return { id: U[i].id, name: U[i].name, how: (t && t.how) || U[i].how };
    }
    return null;
  }

  var G = R.Game = {
    brain: null, meta: null, run: null, rng: null, crng: null, days: 0, last: null,

    save: function () {
      try {
        var d = R.Save.data;
        d.brain = G.brain.serialize();
        d.meta = G.meta;
        d.run = G.run;
        R.Save.commit();
      } catch (e) { /* a storage failure must never stop the game */ }
    },

    hasRun: function () { return !!(G.run && (G.run.stage === 'duel' || G.run.stage === 'bonfire')); },

    startFlow: function () {
      if (G.hasRun()) { G.resume(); return; }
      if (R.Run.relics(G.meta).length && R.Scenes.relic) { E.go('relic', { from: 'title' }); return; }
      G.newRun(null);
    },

    newRun: function (relicId) {
      var t = now(), seed = freshSeed();
      G.run = R.Run.create(G.meta, { seed: seed, relicId: relicId || null, now: t });
      G.days = G.run.daysAway || 0;
      G.brain.beginRun({ days: G.days });
      G.rng = R.RNG.create(seed ^ 0x5bd1e995);
      G.last = null;
      G.save();
      E.go('duel', null, 0.5);
    },

    resume: function () {
      var run = G.run;
      if (!run) { E.go('title'); return; }
      G.days = run.daysAway || 0;
      if (run.stage === 'bonfire' && run.offer) { E.go('bonfire', null, 0.4); return; }
      if (run.stage === 'duel') {
        var d = run.duel;
        if (d && d.over) {                       // the page closed between the last blow and the next screen
          if (d.over === 'p' && run.duelN === 7 && d.phase === 1) {
            R.Run.endDuel(run, G.meta, 'p', null);
            R.Run.startPhase2(run);
            G.save();
            E.go('duel', null, 0.4);
          } else G.duelOver(d.over);
          return;
        }
        E.go('duel', null, 0.4);
        return;
      }
      G.duelOver(run.stage === 'won' ? 'p' : 'r');
    },

    duelOver: function (winner) {
      var run = G.run, meta = G.meta;
      if (!run) { E.go('title'); return; }
      var d = run.duel;
      if (run.stage !== 'won' && run.stage !== 'dead') R.Run.endDuel(run, meta, winner, G.brain.dossier());
      if (run.stage === 'bonfire') {
        var off = run.offer;
        if (off && off.events && !off.applied) {
          for (var i = 0; i < off.events.length; i++) if (off.events[i].t === 'forget') G.brain.forget(off.events[i].n || 0.5);
          off.applied = true;
        }
        G.save();
        E.go('bonfire', null, 0.6);
        return;
      }
      if (run.stage === 'duel') {                // duel 7, phase 1 won (normally handled inside the duel scene)
        R.Run.startPhase2(run);
        G.save();
        E.go('duel', null, 0.4);
        return;
      }
      var won = run.stage === 'won';
      run.stats.score = G.brain.runScore();
      var insights = G.brain.runInsights() || [];
      var fin = R.Run.finish(run, meta, now()) || {};
      var unlocks = [], src = fin.unlocks || [];
      for (var k = 0; k < src.length; k++) {
        var u = src[k];
        unlocks.push({ id: u.id, type: u.type, ref: u.ref, name: u.name, how: u.how });
      }
      G.last = {
        won: won, duel: run.duelN, phase: run.phase, rivalHp: d ? Math.max(0, d.r.hp) : 0,
        turns: run.stats.turns || 0, score: run.stats.score || 0,
        finishingMove: run.stats.lastMove || null, hp: Math.max(0, run.pHp || 0),
        unlocks: unlocks, firstWin: !!fin.firstWin, insights: insights,
        boons: run.pBoons.slice(), rivalBoons: run.rBoons.slice(),
        reads: run.stats.reads || 0, surprises: run.stats.surprises || 0, tease: nextGoal()
      };
      G.run = null;
      G.save();
      E.go(won ? 'victory' : 'death', null, won ? 0.9 : 0.7);
    },

    draft: function (boonId) {
      var run = G.run;
      if (!run) { E.go('title'); return; }
      if (!R.Run.pick(run, boonId, G.meta)) return;
      G.save();
      E.go('duel', null, 0.6);
    },

    // Walk away from the current run. It counts as a death; the Rival will remember.
    abandon: function () {
      var run = G.run;
      if (!run) return;
      if (run.stage !== 'won' && run.stage !== 'dead') R.Run.endDuel(run, G.meta, 'r', null);
      run.stats.score = G.brain.runScore();
      R.Run.finish(run, G.meta, now());
      G.run = null; G.last = null;
      G.save();
    },

    vars: function (extra) {
      var m = G.meta.memory, run = G.run, d = run && run.duel, L = G.last, k;
      var v = {
        runs: m.runs, deaths: m.deaths, wins: m.wins, bestDuel: m.bestDuel,
        streak: Math.max(m.streakL || 0, m.streakW || 0),
        duel: run ? run.duelN : (L ? L.duel : 1),
        turns: run ? run.stats.turns : (L ? L.turns : 0),
        score: run ? G.brain.runScore() : (L ? L.score : 0)
      };
      if (v.score < 45) delete v.score;          // lines that quote the score are jabs at predictable play
      if (G.days > 0) v.days = G.days;
      if (d) { v.hp = d.p.hp; v.rivalHp = d.r.hp; }
      else if (L) { v.hp = L.hp; v.rivalHp = L.rivalHp; }
      if (m.lastWin && m.lastWin.move) { v.lastWinMove = R.Text.move(m.lastWin.move); v.lastWinHp = m.lastWin.hp; }
      if (extra) for (k in extra) if (extra[k] !== undefined && extra[k] !== null) v[k] = extra[k];
      return v;
    },

    resetAll: function () {
      R.Save.reset();
      G.brain = R.Brain.create(null);
      G.meta = R.Run.defaultMeta();
      G.run = null; G.last = null; G.days = 0;
      G.save();
      E.go('title', null, 0.6);
    }
  };

  function boot() {
    var storage = null, name;
    try { storage = window.localStorage; } catch (e) { storage = null; }
    R.Save.init(storage);
    var d = R.Save.data;
    E = R.Engine;
    G.brain = R.Brain.create(d.brain || null);
    G.meta = (d.meta && typeof d.meta === 'object') ? d.meta : R.Run.defaultMeta();
    G.run = validRun(d.run) ? d.run : null;
    G.days = G.run ? (G.run.daysAway || 0) : 0;
    var seed = freshSeed();
    G.rng = R.RNG.create(seed);
    G.crng = R.RNG.create(seed ^ 0x2545f491);

    R.Art.init();
    E.init(document.getElementById('game'));
    for (name in R.Scenes) E.scene(name, R.Scenes[name]);

    var first = 'title';
    try { if (/[?&]enginetest\b/.test(window.location.search) && R.Scenes.enginetest) first = 'enginetest'; } catch (e) { /* ignore */ }
    if (first === 'title' && !R.Scenes.title) { E.start(); G.startFlow(); }
    else { E.go(first, null, 0.3); E.start(); }

    var flush = function () { if (G.brain && G.meta) G.save(); };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis.RIVAL = globalThis.RIVAL || {});
