// SHOW ME MY RIVAL — combat rules. Pure (no DOM, no Date, no rng). All state is plain JSON.
//
// Timer convention (guardBroken, sealed.<m>): the stored number is "turns this is still active,
// counting the current one". A status applied while resolving turn t with length n is stored as n+1
// and every timer is decremented once at the end of resolve(), so it covers turns t+1..t+n exactly.
(function (R) {
  'use strict';

  var MOVES = R.MOVES || ['S', 'G', 'F'];
  var BEATS = R.BEATS || { S: 'F', G: 'S', F: 'G' };

  var HIT_CAP = 8;          // max damage of a single exchange hit
  var STATUS_CAP = 3;       // fortify / focus cap
  var TENSION_MAX = 3;
  var BREAK_VALUE = 0.86;   // payoff value of one turn of guard break
  var LETHAL_VALUE = 8;     // payoff value of a kill
  var CALLED_BONUS = 2;     // phase 2 Called Shot: extra damage when the called move loses
  var BASE = { S: 3, G: 2, F: 2 };
  var CLASH_KIND = { S: 'bind', G: 'standoff', F: 'masquerade' };

  function other(side) { return side === 'p' ? 'r' : 'p'; }
  function boonOf(id) { return R.Boons && R.Boons.byId[id]; }
  function isLow(f) { return f.hp <= Math.ceil(f.maxHp / 3); }

  function clone(o) {
    if (o === null || typeof o !== 'object') return o;
    var i, c;
    if (Array.isArray(o)) {
      c = new Array(o.length);
      for (i = 0; i < o.length; i++) c[i] = clone(o[i]);
      return c;
    }
    c = {};
    for (var k in o) c[k] = clone(o[k]);
    return c;
  }

  function newIntel() { return { called: null, honest: null, pred: null, coin: false }; }
  function newStatus() { return { guardBroken: 0, bleed: 0, fortify: 0, focus: 0, sealed: { S: 0, G: 0, F: 0 } }; }

  function newFighter(maxHp, hp, boonIds) {
    maxHp = maxHp > 0 ? Math.floor(maxHp) : 1;
    hp = typeof hp === 'number' && hp === hp ? Math.floor(hp) : maxHp;
    if (hp > maxHp) hp = maxHp;
    if (hp < 1) hp = 1;
    var boons = [], charges = {}, i, b;
    if (boonIds) {
      for (i = 0; i < boonIds.length; i++) {
        boons.push(boonIds[i]);
        b = boonOf(boonIds[i]);
        if (b && b.active) charges[b.id] = b.active.charges;
      }
    }
    return { hp: hp, maxHp: maxHp, boons: boons, status: newStatus(), counters: {}, charges: charges, moves: [], results: [] };
  }

  // ---------------------------------------------------------------- hook context

  function X(st, side, my, their) {
    var d = st.duel;
    this._ = st;
    this.duel = d;
    this.side = side;
    this.self = d[side];
    this.foe = d[other(side)];
    this.my = my;
    this.their = their;
    this.dmg = 0;
    this.won = false;
    this.lost = false;
    this.clash = false;
    this.tension = d.tension;
    this.events = st.ev;
    this.base = 0;
    this.taken = 0;
    this.dealt = 0;
    this.pips = 1;
    this.brokeFoe = false;
    this.brokeSelf = false;
    this.foeBleeding = this.foe.status.bleed > 0;
    this.selfBleeding = this.self.status.bleed > 0;
  }
  X.prototype.status = function (target, name, n, opts) {
    return applyStatus(this._, target === 'foe' ? other(this.side) : this.side, name, n, opts);
  };
  X.prototype.heal = function (n) { return heal(this._, this.side, n); };
  X.prototype.cancelBreak = function () { return cancelBreak(this._, this.side); };

  function runHooks(name, fighter, x) {
    var ids = fighter.boons, i, b, h;
    for (i = 0; i < ids.length; i++) {
      b = boonOf(ids[i]);
      h = b && b.hooks[name];
      if (h) h(x);
    }
  }
  function runDamageHooks(name, fighter, x, dmg) {
    var ids = fighter.boons, i, b, h, v;
    for (i = 0; i < ids.length; i++) {
      b = boonOf(ids[i]);
      h = b && b.hooks[name];
      if (h) {
        x.dmg = dmg;
        v = h(x);
        if (typeof v === 'number' && v === v && isFinite(v)) dmg = v;
      }
    }
    x.dmg = dmg;
    return dmg;
  }

  // ---------------------------------------------------------------- statuses

  // Legal moves on the turn the timers refer to: `off` = 0 for "now", 1 for "next turn" while resolving.
  function legalCount(s, off) {
    var n = 0;
    if (s.sealed.S <= off) n++;
    if (s.guardBroken <= off && s.sealed.G <= off) n++;
    if (s.sealed.F <= off) n++;
    return n;
  }

  function applyStatus(st, side, name, n, opts) {
    var f = st.duel[side], s = f.status, off = st.off, ev = st.ev, cur, nv, m, i;
    if (!(n > 0) || f.hp <= 0) return false;
    if (name === 'fortify' || name === 'focus') {
      cur = s[name];
      nv = opts && opts.max ? Math.max(cur, Math.min(STATUS_CAP, n)) : Math.min(STATUS_CAP, cur + n);
      if (nv === cur) return false;
      s[name] = nv;
      ev.push({ t: 'status', side: side, id: name, n: nv, op: 'add' });
      return true;
    }
    if (name === 'bleed') {
      if (n <= s.bleed) return false;
      s.bleed = n;
      ev.push({ t: 'status', side: side, id: 'bleed', n: n, op: 'add' });
      return true;
    }
    if (name === 'guardBroken') {
      cur = s.guardBroken;
      nv = n + off;
      if (nv <= cur) return false;
      if (st.brk && !st.brk[side]) st.brk[side] = { prev: cur };
      s.guardBroken = nv;
      ev.push({ t: 'status', side: side, id: 'guardBroken', n: n, op: 'add' });
      // guardBroken has priority over seals: drop seals until two moves are legal again
      if (legalCount(s, off) < 2) {
        for (i = 0; i < MOVES.length; i++) {
          m = MOVES[i];
          if (m !== 'G' && s.sealed[m] > off) {
            s.sealed[m] = st.pre ? st.pre[side].sealed[m] : 0;
            ev.push({ t: 'status', side: side, id: 'sealed', move: m, n: 0, op: 'remove' });
          }
        }
      }
      return true;
    }
    if (name === 'sealed') {
      m = opts && opts.move;
      if (m !== 'S' && m !== 'G' && m !== 'F') return false;
      cur = s.sealed[m];
      nv = n + off;
      if (nv <= cur) return false;
      s.sealed[m] = nv;
      if (legalCount(s, off) < 2) {          // would leave fewer than 2 legal moves: not applied
        s.sealed[m] = cur;
        ev.push({ t: 'status', side: side, id: 'sealed', move: m, n: 0, op: 'blocked' });
        return false;
      }
      ev.push({ t: 'status', side: side, id: 'sealed', move: m, n: n, op: 'add' });
      return true;
    }
    return false;
  }

  function cancelBreak(st, side) {
    var b = st.brk && st.brk[side];
    if (!b) return false;
    st.duel[side].status.guardBroken = b.prev;
    st.brk[side] = null;
    st.ev.push({ t: 'status', side: side, id: 'guardBroken', n: 0, op: 'remove' });
    return true;
  }

  function heal(st, side, n) {
    var f = st.duel[side];
    if (!(n > 0) || f.hp <= 0) return 0;
    var h = Math.min(Math.floor(n), f.maxHp - f.hp);
    if (h <= 0) return 0;
    f.hp += h;
    var tl = st.duel.tally;
    if (side === 'p') { tl.healP += h; if (st.res) st.res.healP += h; }
    else { tl.healR += h; if (st.res) st.res.healR += h; }
    st.ev.push({ t: 'heal', side: side, n: h });
    return h;
  }

  // Remove HP. `by` = 'exchange' | 'rupture' | 'bleed'. Does not check lethality.
  function hurt(st, side, n, by) {
    var f = st.duel[side], tl = st.duel.tally;
    f.hp -= n;
    if (side === 'p') { tl.lostP += n; if (by === 'bleed') tl.bleedP += n; if (st.res) st.res.dmgP += n; }
    else { tl.lostR += n; if (by === 'bleed') tl.bleedR += n; if (st.res) st.res.dmgR += n; }
  }

  // hp <= 0: give onLethal hooks a chance; returns true if the fighter survived.
  function lethal(st, side, my, their) {
    var d = st.duel, f = d[side];
    var x = new X(st, side, my, their);
    x.lost = true;
    runHooks('onLethal', f, x);
    if (f.hp > 0) {
      st.ev.push({ t: 'saved', side: side, n: f.hp });
      return true;
    }
    f.hp = 0;
    d.over = other(side);
    st.ev.push({ t: 'ko', side: side });
    return false;
  }

  // ---------------------------------------------------------------- duel

  function newDuel(o) {
    o = o || {};
    var duel = {
      n: o.n || 1,
      phase: o.phase === 2 ? 2 : 1,
      turn: 1,
      tension: o.phase === 2 ? 1 : 0,          // Embers: phase 2 starts at (and never drops below) 1 pip
      p: o.p || newFighter(12, 12, []),
      r: o.r || newFighter(6, 6, []),
      over: null,
      pendingEvents: [],
      intel: newIntel(),
      begun: 0,
      tally: { lostP: 0, lostR: 0, bleedP: 0, bleedR: 0, healP: 0, healR: 0, bleedCounted: 0 }
    };
    if (duel.phase === 1) {                    // phase 2 continues duel 7: no second duelStart
      var st = { duel: duel, ev: duel.pendingEvents, res: null, off: 0, brk: null, pre: null };
      runHooks('duelStart', duel.p, new X(st, 'p'));
      runHooks('duelStart', duel.r, new X(st, 'r'));
    }
    return duel;
  }

  function legal(duel, side) {
    var s = duel[side].status, out = [];
    if (s.sealed.S <= 0) out.push('S');
    if (s.guardBroken <= 0 && s.sealed.G <= 0) out.push('G');
    if (s.sealed.F <= 0) out.push('F');
    if (out.length < 2) {                      // cannot happen through the rules; repair bad saves
      out = s.guardBroken > 0 ? ['S', 'F'] : ['S', 'G', 'F'];
    }
    return out;
  }

  function ctx(duel) {
    var p = duel.p, r = duel.r, pm = p.moves, n = pm.length;
    return {
      duel: duel.n, phase: duel.phase, turn: duel.turn,
      prev1: n >= 1 ? pm[n - 1] : null,
      prev2: n >= 2 ? pm[n - 2] : null,
      prevR: r.moves.length ? r.moves[r.moves.length - 1] : null,
      last: p.results.length ? p.results[p.results.length - 1] : null,
      pHp: p.hp, pMaxHp: p.maxHp, rHp: r.hp, rMaxHp: r.maxHp,
      tension: duel.tension,
      pBroken: p.status.guardBroken > 0,
      rBroken: r.status.guardBroken > 0
    };
  }

  function bleedTick(st, side) {
    var f = st.duel[side];
    if (f.status.bleed <= 0 || f.hp <= 0) return;
    f.status.bleed--;
    hurt(st, side, 1, 'bleed');
    st.ev.push({ t: 'bleed', side: side, n: 1, left: f.status.bleed });
    if (f.status.bleed === 0) st.ev.push({ t: 'status', side: side, id: 'bleed', n: 0, op: 'expire' });
    if (f.hp <= 0) lethal(st, side);
  }

  // Start-of-turn step. Idempotent per turn (a reload may call it again for the same turn).
  function beginTurn(duel) {
    var ev = duel.pendingEvents && duel.pendingEvents.length ? duel.pendingEvents.slice() : [];
    duel.pendingEvents = [];
    if (duel.over || duel.begun === duel.turn) return ev;
    duel.begun = duel.turn;
    var st = { duel: duel, ev: ev, res: null, off: 0, brk: null, pre: null };
    bleedTick(st, 'r');                          // Rival first: ties favour the player
    if (!duel.over) bleedTick(st, 'p');
    if (!duel.over) {
      runHooks('turnStart', duel.p, new X(st, 'p'));
      runHooks('turnStart', duel.r, new X(st, 'r'));
    }
    return ev;
  }

  // ---------------------------------------------------------------- resolve

  function emptyResult(duel, pm, rm) {
    return {
      turn: duel.turn, pm: pm, rm: rm, winner: null, clash: false, dmgP: 0, dmgR: 0, healP: 0, healR: 0,
      tensionBefore: duel.tension, tensionAfter: duel.tension, deathblow: false, guardBreak: null,
      events: [], over: duel.over,
      rupture: false, overkill: 0, brokenP: 0, brokenR: 0, called: null
    };
  }

  function doResolve(duel, pm, rm) {
    var P = duel.p, RV = duel.r;
    var res = emptyResult(duel, pm, rm);
    var ev = res.events;
    var T = duel.tension;
    var intel = duel.intel || (duel.intel = newIntel());
    var st = {
      duel: duel, ev: ev, res: res, off: 1,
      brk: { p: null, r: null },
      pre: {
        p: { gb: P.status.guardBroken, sealed: { S: P.status.sealed.S, G: P.status.sealed.G, F: P.status.sealed.F } },
        r: { gb: RV.status.guardBroken, sealed: { S: RV.status.sealed.S, G: RV.status.sealed.G, F: RV.status.sealed.F } }
      }
    };
    var xp = new X(st, 'p', pm, rm), xr = new X(st, 'r', rm, pm);
    var i, m, side, f, s;

    if (pm === rm) {
      // ---- clash -------------------------------------------------------------
      res.clash = true;
      xp.clash = xr.clash = true;
      ev.push({ t: 'clash', kind: CLASH_KIND[pm], move: pm, tension: T });
      runHooks('onClash', P, xp);
      runHooks('onClash', RV, xr);
      if (T >= TENSION_MAX) {
        // Rupture: 1 damage each (never lethal), tension stays 3. It does NOT seal the move: with a
        // move sealed for both, the two moves left always contain a dominant one and the duel locks.
        res.rupture = true;
        ev.push({ t: 'rupture', move: pm });
        for (i = 0; i < 2; i++) {
          side = i === 0 ? 'r' : 'p';
          f = duel[side];
          if (f.hp > 1) {
            hurt(st, side, 1, 'rupture');
            ev.push({ t: 'dmg', side: side, n: 1, by: 'rupture' });
            if (side === 'p') xp.taken = 1; else xr.taken = 1;
          }
        }
      } else {
        duel.tension = Math.min(TENSION_MAX, T + Math.max(1, xp.pips, xr.pips));
        ev.push({ t: 'tension', n: duel.tension, from: T });
      }
      runHooks('afterExchange', P, xp);
      runHooks('afterExchange', RV, xr);
      P.results.push('C');
      RV.results.push('C');
    } else {
      // ---- decisive exchange ---------------------------------------------------
      var w = BEATS[pm] === rm ? 'p' : 'r';
      var l = other(w);
      var W = duel[w], L = duel[l];
      var xw = w === 'p' ? xp : xr, xl = w === 'p' ? xr : xp;
      var wm = xw.my;
      var called = duel.phase === 2 && intel.called ? intel.called : null;
      res.winner = w;
      xw.won = true;
      xl.lost = true;

      var base = BASE[wm];
      xw.base = xl.base = base;
      var dmg = runDamageHooks('outDamage', W, xw, base);

      if (called && w === 'r' && pm === called) {            // Called Shot lands
        dmg += CALLED_BONUS;
        res.called = 'hit';
        ev.push({ t: 'called', side: 'r', move: called, result: 'hit', n: CALLED_BONUS });
      }

      dmg += T;                                               // tension pips
      duel.tension = duel.phase === 2 ? 1 : 0;                // Embers: floor of 1 in phase 2
      if (T > 0) ev.push({ t: 'tension', n: duel.tension, from: T, spent: T });
      if (T >= TENSION_MAX) { res.deathblow = true; ev.push({ t: 'deathblow', side: w }); }

      if (W.status.focus > 0) {                               // winner's focus
        dmg += W.status.focus;
        ev.push({ t: 'status', side: w, id: 'focus', n: 0, op: 'consume', spent: W.status.focus });
        W.status.focus = 0;
      }

      dmg = runDamageHooks('inDamage', L, xl, dmg);           // loser's mitigation hooks

      if (L.status.fortify > 0 && dmg > 0) {                  // loser's fortify: consumed by this hit
        var red = Math.min(L.status.fortify, dmg);
        dmg -= red;
        ev.push({ t: 'status', side: l, id: 'fortify', n: 0, op: 'consume', spent: red });
        L.status.fortify = 0;
      }

      dmg = Math.round(dmg);
      if (!(dmg > 0)) dmg = 0;
      if (dmg > HIT_CAP) {                                    // hit cap
        res.overkill = dmg - HIT_CAP;
        ev.push({ t: 'overkill', side: l, n: dmg - HIT_CAP, raw: dmg });
        dmg = HIT_CAP;
      }

      hurt(st, l, dmg, 'exchange');
      xw.dealt = xl.taken = dmg;
      xw.dmg = xl.dmg = dmg;
      ev.push({ t: 'dmg', side: l, n: dmg, by: 'exchange', move: wm, base: base, tension: T });

      if (L.hp <= 0) lethal(st, l, xl.my, xl.their);

      if (wm === 'F' && L.hp > 0) {                           // Feint beat Guard: guard break
        if (applyStatus(st, l, 'guardBroken', 1)) { xw.brokeFoe = true; xl.brokeSelf = true; }
      }
      if (called && w === 'p' && pm !== called) {             // Called Shot missed: the Rival staggers
        res.called = 'miss';
        ev.push({ t: 'called', side: 'r', move: called, result: 'miss' });
        if (RV.hp > 0 && applyStatus(st, 'r', 'guardBroken', 1)) { xp.brokeFoe = true; xr.brokeSelf = true; }
      }

      runHooks('afterExchange', W, xw);                       // winner first
      if (L.hp > 0) runHooks('afterExchange', L, xl);
      W.results.push('W');
      L.results.push('L');
    }

    P.moves.push(pm);
    RV.moves.push(rm);

    // ---- end of turn: timers tick, expiries are announced --------------------
    for (i = 0; i < 2; i++) {
      side = i === 0 ? 'p' : 'r';
      s = duel[side].status;
      var gb0 = st.pre[side].gb > 0 ? st.pre[side].gb - 1 : 0;   // what it would be with nothing new
      if (s.guardBroken > 0) {
        s.guardBroken--;
        if (s.guardBroken === 0 && st.pre[side].gb > 0) ev.push({ t: 'status', side: side, id: 'guardBroken', n: 0, op: 'expire' });
      }
      var inflicted = s.guardBroken - gb0;
      if (inflicted < 0) inflicted = 0;
      if (side === 'p') res.brokenP = inflicted; else res.brokenR = inflicted;
      for (var j = 0; j < MOVES.length; j++) {
        m = MOVES[j];
        if (s.sealed[m] > 0) {
          s.sealed[m]--;
          if (s.sealed[m] === 0 && st.pre[side].sealed[m] > 0) ev.push({ t: 'status', side: side, id: 'sealed', move: m, n: 0, op: 'expire' });
        }
      }
    }
    res.guardBreak = res.brokenP > 0 ? 'p' : (res.brokenR > 0 ? 'r' : null);
    res.tensionAfter = duel.tension;
    res.over = duel.over;
    duel.intel = newIntel();
    duel.turn++;
    return res;
  }

  function coerce(duel, side, m, notes) {
    var lg = legal(duel, side);
    if (lg.indexOf(m) >= 0) return m;
    notes.push({ t: 'note', side: side, text: 'illegal move replaced', move: m });
    return lg[0];
  }

  // opts.unchecked: resolve the cell even if a move is illegal (used by tests to compare with payoff).
  function resolve(duel, pm, rm, opts) {
    if (duel.over) return emptyResult(duel, pm, rm);
    var notes = [];
    if (!(opts && opts.unchecked)) {
      pm = coerce(duel, 'p', pm, notes);
      rm = coerce(duel, 'r', rm, notes);
    } else {
      if (MOVES.indexOf(pm) < 0) pm = legal(duel, 'p')[0];
      if (MOVES.indexOf(rm) < 0) rm = legal(duel, 'r')[0];
    }
    var res = doResolve(duel, pm, rm);
    if (notes.length) res.events = notes.concat(res.events);
    return res;
  }

  // Complete value of each cell to the Rival, simulated on a copy through doResolve().
  function payoff(duel) {
    var out = { S: { S: 0, G: 0, F: 0 }, G: { S: 0, G: 0, F: 0 }, F: { S: 0, G: 0, F: 0 } };
    if (duel.over) return out;
    var saved = duel.pendingEvents;
    duel.pendingEvents = null;                  // not needed by the simulation; skip copying it
    var i, j, c, r, v;
    for (i = 0; i < 3; i++) {
      for (j = 0; j < 3; j++) {
        c = clone(duel);
        c.pendingEvents = [];
        r = doResolve(c, MOVES[j], MOVES[i]);
        v = r.dmgP - r.dmgR + r.healR - r.healP + BREAK_VALUE * (r.brokenP - r.brokenR);
        if (c.over === 'r') v += LETHAL_VALUE;  // the cell kills the player
        if (c.over === 'p') v -= LETHAL_VALUE;  // the cell kills the Rival
        out[MOVES[i]][MOVES[j]] = v;
      }
    }
    duel.pendingEvents = saved;
    return out;
  }

  // Spend a charge of a player active. The scene performs the reveal / random pick.
  function useActive(duel, boonId) {
    var f = duel && duel.p, b = boonOf(boonId);
    if (!f || !b || !b.active || duel.over) return { ok: false, kind: b && b.active ? b.active.kind : null, left: 0 };
    var left = f.charges[boonId] || 0;
    if (f.boons.indexOf(boonId) < 0 || left <= 0) return { ok: false, kind: b.active.kind, left: 0 };
    if (b.active.kind === 'coin' && duel.intel && duel.intel.coin) return { ok: false, kind: 'coin', left: left };
    f.charges[boonId] = left - 1;
    if (!duel.intel) duel.intel = newIntel();
    if (b.active.kind === 'coin') duel.intel.coin = true;
    return { ok: true, kind: b.active.kind, left: left - 1 };
  }

  // Which passive information displays are live for the player this turn.
  function info(duel) {
    var b = duel.p.boons, c = duel.p.counters;
    var tally = b.indexOf('liars_tally') >= 0;
    return {
      ledger: b.indexOf('stolen_ledger') >= 0,
      tally: tally,
      coinTurn1: b.indexOf('relic_liars_coin') >= 0 && duel.turn === 1,
      tallyHonest: tally ? (c.tally_honest || 0) : 0,
      tallyLie: tally ? (c.tally_lie || 0) : 0
    };
  }

  R.Combat = {
    HIT_CAP: HIT_CAP,
    newFighter: newFighter,
    newDuel: newDuel,
    legal: legal,
    ctx: ctx,
    payoff: payoff,
    beginTurn: beginTurn,
    resolve: resolve,
    useActive: useActive,
    info: info,
    isLow: isLow,
    clone: clone
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
