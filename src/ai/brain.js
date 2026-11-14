// SHOW ME MY RIVAL — the Rival's mind (R.Brain). Pure: no DOM, no Date, no Math.random; runs under Node.
//
// An ensemble of 13 small experts (E0–E9 habits, T0–T2 tell responses) mixed with Hedge,
// a regret-matching equilibrium solver for the payoff matrix it is handed, and the
// decision procedure of DESIGN §6.5. It learns ONLY inside observe(); commit() never
// touches learning state and never sees the current player move.
//
// Call order per turn (scene author):
//   ctx = R.Combat.ctx(duel); payoff = R.Combat.payoff(duel)
//   sealed = brain.commit({ ctx, payoff, legalR, legalP, exploit, honestyBase, rng })
//   ... player picks pm ...
//   brain.observe(ctx, sealed.tell, pm, sealed.move)   // the SAME pre-exchange ctx object
//
// Where this departs from the letter of DESIGN §6 (each one measured in tools/test_brain.js):
//   * Hedge treats an abstaining expert as asleep: the awake experts are rescaled to the mass
//     they held before the update. Updating only the awake ones, as written, hands all the
//     weight to whoever abstains most (E6 "opening" reached 0.76 after 400 turns).
//   * A turn played with a broken guard teaches only E9 (guard state). Otherwise "Guards after
//     being hit" is diluted by the forced Strike/Feint turns that follow every Feint that lands.
//   * Honesty: the trust slope grows from 0.45 to 1.0, and a MIRROR slope from 0 to 0.7, over
//     the first 150 tell-observed turns of a lifetime (K.H_*). With a flat 0.45 a pure truster
//     still wins 53% of exchanges at honesty base 0.9, and a pure mirrorer is shown 97% honest
//     stances and clashes forever.
//   * The solver is regret matching+ (alternating updates, linear averaging), 300 iterations.
(function (R) {
  'use strict';

  var MOVES = R.MOVES || ['S', 'G', 'F'];
  var BEATS = R.BEATS || { S: 'F', G: 'S', F: 'G' };
  var LOSES_TO = R.LOSES_TO || { S: 'G', G: 'F', F: 'S' };
  var MI = { S: 0, G: 1, F: 2 };
  var NAME = ['Strike', 'Guard', 'Feint'];
  var LOWER = ['strike', 'guard', 'feint'];
  var BEAT = [MI[BEATS.S], MI[BEATS.G], MI[BEATS.F]];            // move i beats BEAT[i]
  var LOSE = [MI[LOSES_TO.S], MI[LOSES_TO.G], MI[LOSES_TO.F]];   // move i loses to LOSE[i]
  // Tell-response categories relative to a shown tell t: 0 COUNTER, 1 MIRROR, 2 UNDER.
  var CAT_MOVE = [], CAT_OF = [];
  (function () {
    for (var t = 0; t < 3; t++) {
      CAT_MOVE[t] = [LOSE[t], t, BEAT[t]];
      CAT_OF[t] = [0, 0, 0];
      CAT_OF[t][LOSE[t]] = 0; CAT_OF[t][t] = 1; CAT_OF[t][BEAT[t]] = 2;
    }
  })();
  var CAT_NAME = ['counter', 'mirror', 'under'];

  // Experts: index, number of keys. 0..9 = E0..E9 (habit), 10..12 = T0..T2 (tell response).
  var NE = 13, NH = 10;
  var SIZES = [1, 3, 9, 3, 9, 2, 1, 3, 4, 4, 1, 3, 3];
  var E_GLOBAL = 0, E_PREV = 1, E_PREV2 = 2, E_LAST = 3, E_LOW = 5, E_OPEN = 6, E_RPREV = 7,
      E_TENSION = 8, E_GUARD = 9, T_ALL = 10, T_STANCE = 11, T_AFTER = 12;

  // Every tunable in one place (R.Brain.K) so the sim can sweep them without editing code.
  var K = {
    PRIOR: 0.5,                 // Dirichlet pseudo-count per move
    MIN_MASS: 0.5,              // an expert abstains while its key holds less decayed mass
    LAMBDA: [0.93, 0.90, 0.85, 0.90, 0.85, 0.90, 0.80, 0.90, 0.88, 0.88, 0.92, 0.88, 0.88],
    HEDGE_ETA: 1.5, HEDGE_DECAY: 0.96, W_FLOOR: 0.02,
    CONF_TURNS: 20,             // confidence ramps in over the first lifetime turns
    TAU_BASE: 1.2, TAU_SLOPE: 0.9, TAU_MIN: 0.05,   // tau = TAU_BASE - TAU_SLOPE * exploit
    EQ_PRIOR_FLOOR: 0.01,       // keeps a dominated move selectable when the read screams for it
    H_MIN: 0.15, H_MAX: 0.97,
    H_TRUST_DOWN: 0.45,         // honesty gained per unit of COUNTER share below 1/3 (spec value)
    H_TRUST_UP: 0.45,           // honesty lost per unit of COUNTER share above 1/3 on first contact (spec value)
    H_TRUST_UP_LATE: 0.75,      // ...growing to this as lifetime tell evidence accumulates
    H_MIRROR_LATE: 0.7,         // honesty lost per unit of MIRROR share above 1/3 (0 on first contact)
    H_RAMP_TURNS: 150,          // lifetime tell-observed turns to reach the *_LATE values
    RUN_DECAY: 0.90, AWAY_DECAY: 0.75, AWAY_DAYS: 7,
    EQ_ITERS: 300, EQ_CACHE: 64,
    EMA_ALPHA: 0.02, SCORE_SCALE: 150,
    BROKEN_DROP: 25, BROKEN_MASS: 8, BROKEN_SAT: 0.75,
    INSIGHT_MIN: 6
  };

  // Dossier stat definitions (DESIGN §7). e = expert, k = fixed key (omitted when the stat scans keys).
  var DEF = {
    fav_move:         { kind: 'habit', e: E_GLOBAL, k: 0, min: 20, skew: 45, ctx: 'always' },
    opening:          { kind: 'habit', e: E_OPEN, k: 0, min: 5, skew: 60, ctx: 'opening' },
    after_loss:       { kind: 'habit', e: E_LAST, k: 1, min: 12, skew: 55, ctx: 'after_loss' },
    after_win:        { kind: 'habit', e: E_LAST, k: 0, min: 12, skew: 55, ctx: 'after_win' },
    repeat:           { kind: 'habit', e: E_PREV, min: 20, skew: 50, low: 12, ctx: 'repeat' },
    two_step:         { kind: 'habit', e: E_PREV, min: 8, skew: 60 },
    loop3:            { kind: 'habit', e: E_PREV2, min: 6, skew: 70 },
    low_hp:           { kind: 'habit', e: E_LOW, k: 1, min: 10, skew: 55, ctx: 'low_hp' },
    tell_trust:       { kind: 'tell', e: T_ALL, k: 0, min: 15, skew: 60, low: 20, ctx: 'tell' },
    tell_by_stance:   { kind: 'tell', e: T_STANCE, min: 8, skew: 65 },
    after_burn:       { kind: 'tell', e: T_AFTER, k: 1, min: 6, skew: 70, low: 20, ctx: 'after_burn' },
    echo_rival:       { kind: 'habit', e: E_RPREV, min: 15, skew: 50, ctx: 'echo' },
    deathblow_nerves: { kind: 'habit', e: E_TENSION, k: 3, min: 6, skew: 60, ctx: 'tension3' },
    broken_panic:     { kind: 'habit', e: E_GUARD, k: 1, min: 6, skew: 85, ctx: 'broken_self' },
    vs_broken:        { kind: 'habit', e: E_GUARD, k: 2, min: 6, skew: 75, ctx: 'broken_foe' },
    predictability:   { kind: 'record', min: 30, skew: 60, low: 25, ctx: 'overall' }
  };
  // Habits whose peak is tracked for "most-broken habit" (single key, single move).
  var PEAK_IDS = ['fav_move', 'opening', 'after_loss', 'after_win', 'low_hp', 'two_step', 'loop3',
                  'deathblow_nerves', 'broken_panic', 'vs_broken'];

  // ---------- small helpers ----------

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function num(x, a, b, d) { return (typeof x === 'number' && isFinite(x)) ? clamp(x, a, b) : d; }
  function int(x, a, b, d) { return (typeof x === 'number' && isFinite(x)) ? clamp(Math.round(x), a, b) : d; }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function r4(x) { return Math.round(x * 10000) / 10000; }
  function mi(m) { var i = MI[m]; return i === undefined ? -1 : i; }

  function newTables() {
    var t = [];
    for (var e = 0; e < NE; e++) {
      var a = new Array(SIZES[e] * 3);
      for (var i = 0; i < a.length; i++) a[i] = 0;
      t.push(a);
    }
    return t;
  }

  function readTables(src, cap, asInt) {
    var t = newTables();
    if (!Array.isArray(src)) return t;
    for (var e = 0; e < NE; e++) {
      var a = src[e];
      if (!Array.isArray(a)) continue;
      var lim = typeof cap === 'function' ? cap(e) : cap;
      for (var i = 0; i < t[e].length; i++) {
        t[e][i] = asInt ? int(a[i], 0, lim, 0) : num(a[i], 0, lim, 0);
      }
    }
    return t;
  }

  function writeTables(t, asInt) {
    var out = [];
    for (var e = 0; e < NE; e++) {
      var a = new Array(t[e].length);
      for (var i = 0; i < a.length; i++) a[i] = asInt ? Math.round(t[e][i]) : r3(t[e][i]);
      out.push(a);
    }
    return out;
  }

  function fresh() {
    var w = [];
    for (var e = 0; e < NE; e++) w.push(1 / NE);
    return { n: 0, runs: 0, w: w, c: newTables(), life: newTables(), run: newTables(),
             t2: 0, ema: 0, rs: 0, rn: 0, pk: {} };
  }

  function load(src) {
    var s = fresh();
    if (!src || typeof src !== 'object' || Array.isArray(src)) return s;
    s.n = int(src.n, 0, 1e9, 0);
    s.runs = int(src.runs, 0, 1e9, 0);
    if (Array.isArray(src.w) && src.w.length === NE) {
      var sum = 0, ok = true, e;
      for (e = 0; e < NE; e++) {
        if (typeof src.w[e] !== 'number' || !isFinite(src.w[e]) || src.w[e] <= 0) { ok = false; break; }
        sum += src.w[e];
      }
      if (ok && sum > 0) {
        var div = Math.abs(sum - 1) < 0.01 ? 1 : sum;          // rounding slack: keep as stored (stable round trip)
        for (e = 0; e < NE; e++) s.w[e] = src.w[e] / div;
      }
    }
    s.c = readTables(src.c, function (e) { return 1 / (1 - K.LAMBDA[e]) + 1; }, false);
    s.life = readTables(src.life, 1e9, true);
    s.run = readTables(src.run, 1e9, true);
    s.t2 = int(src.t2, 0, 2, 0);
    s.ema = num(src.ema, -0.5, 1, 0);
    s.rs = num(src.rs, -1e9, 1e9, 0);
    s.rn = int(src.rn, 0, 1e9, 0);
    if (src.pk && typeof src.pk === 'object') {
      for (var i = 0; i < PEAK_IDS.length; i++) {
        var id = PEAK_IDS[i], p = src.pk[id], d = DEF[id];
        if (!p || typeof p !== 'object') continue;
        var k = int(p.k, 0, SIZES[d.e] - 1, -1), m = int(p.m, 0, 2, -1), pct = num(p.p, 0, 100, -1);
        if (k < 0 || m < 0 || pct < 0) continue;
        if (d.k !== undefined && d.k !== k) continue;
        s.pk[id] = { k: k, m: m, p: Math.round(pct), r: int(p.r, 0, 1e9, 0), s: int(p.s, 0, 9, 0) };
      }
    }
    return s;
  }

  // Legal list -> array of move indices (deduped, order S,G,F). Never empty.
  function legalIdx(list, dflt) {
    var seen = [false, false, false], out = [], i;
    if (Array.isArray(list)) for (i = 0; i < list.length; i++) { var k = mi(list[i]); if (k >= 0) seen[k] = true; }
    for (i = 0; i < 3; i++) if (seen[i]) out.push(i);
    if (out.length) return out;
    return dflt ? dflt.slice() : [0, 1, 2];
  }
  function maskOf(idx) {
    var m = [false, false, false];
    for (var i = 0; i < idx.length; i++) m[idx[i]] = true;
    return m;
  }

  function readPayoff(p) {
    var V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    if (!p || typeof p !== 'object') return V;
    for (var r = 0; r < 3; r++) {
      var row = p[MOVES[r]];
      if (!row || typeof row !== 'object') continue;
      for (var c = 0; c < 3; c++) {
        var v = row[MOVES[c]];
        V[r][c] = (typeof v === 'number' && isFinite(v)) ? clamp(v, -1e4, 1e4) : 0;
      }
    }
    return V;
  }

  // Make p a proper distribution over mask (zeros elsewhere). Never NaN.
  function normalise(p, mask) {
    var sum = 0, n = 0, i;
    for (i = 0; i < 3; i++) {
      if (!mask[i] || !(p[i] > 0) || !isFinite(p[i])) p[i] = 0;
      if (mask[i]) n++;
      sum += p[i];
    }
    if (sum > 0) { for (i = 0; i < 3; i++) p[i] /= sum; }
    else { for (i = 0; i < 3; i++) p[i] = mask[i] ? 1 / (n || 1) : 0; }
    return p;
  }

  function sampleIdx(w, n, u) {
    var total = 0, i;
    for (i = 0; i < n; i++) total += w[i];
    if (!(total > 0)) return Math.min(n - 1, Math.floor(u * n));
    var x = u * total;
    for (i = 0; i < n; i++) { x -= w[i]; if (x < 0) return i; }
    return n - 1;
  }

  // ---------- equilibrium solver (regret matching+, alternating, linear averaging) ----------

  var eqCache = new Map();

  // V: 3x3 (rows = Rival move, cols = player move, value to the Rival). lr/lp: legal move indices.
  // The matrix is rounded to 1e-3 before solving so a cache hit and a cache miss are bit-identical.
  function solve(V, lr, lp) {
    var nr = lr.length, np = lp.length, i, j, it;
    var A = [], key = lr.join('') + '|' + lp.join('') + '|';
    for (i = 0; i < nr; i++) {
      A.push([]);
      for (j = 0; j < np; j++) {
        var q = Math.round(V[lr[i]][lp[j]] * 1000);
        A[i].push(q / 1000);
        key += q + ',';
      }
    }
    var hit = eqCache.get(key);
    if (hit) return hit;

    var rr = [], rp = [], sx = [], sy = [], x = [], y = [], u = [], total;
    for (i = 0; i < nr; i++) { rr.push(0); sx.push(0); x.push(1 / nr); }
    for (j = 0; j < np; j++) { rp.push(0); sy.push(0); y.push(1 / np); }
    for (it = 1; it <= K.EQ_ITERS; it++) {
      // Rival strategy from positive regrets
      total = 0;
      for (i = 0; i < nr; i++) total += rr[i];
      for (i = 0; i < nr; i++) x[i] = total > 0 ? rr[i] / total : 1 / nr;
      // player strategy from positive regrets
      total = 0;
      for (j = 0; j < np; j++) total += rp[j];
      for (j = 0; j < np; j++) y[j] = total > 0 ? rp[j] / total : 1 / np;
      for (i = 0; i < nr; i++) sx[i] += it * x[i];
      for (j = 0; j < np; j++) sy[j] += it * y[j];
      // Rival regrets against y
      var v = 0;
      for (i = 0; i < nr; i++) {
        var a = 0;
        for (j = 0; j < np; j++) a += A[i][j] * y[j];
        u[i] = a; v += x[i] * a;
      }
      for (i = 0; i < nr; i++) rr[i] = Math.max(0, rr[i] + u[i] - v);
      // alternating update: the player answers the Rival's refreshed strategy
      total = 0;
      for (i = 0; i < nr; i++) total += rr[i];
      for (i = 0; i < nr; i++) x[i] = total > 0 ? rr[i] / total : 1 / nr;
      v = 0;
      for (j = 0; j < np; j++) {
        var b = 0;
        for (i = 0; i < nr; i++) b -= A[i][j] * x[i];
        u[j] = b; v += y[j] * b;
      }
      for (j = 0; j < np; j++) rp[j] = Math.max(0, rp[j] + u[j] - v);
    }
    var res = { r: [0, 0, 0], p: [0, 0, 0], v: 0 };
    total = 0;
    for (i = 0; i < nr; i++) total += sx[i];
    for (i = 0; i < nr; i++) res.r[lr[i]] = total > 0 ? sx[i] / total : 1 / nr;
    total = 0;
    for (j = 0; j < np; j++) total += sy[j];
    for (j = 0; j < np; j++) res.p[lp[j]] = total > 0 ? sy[j] / total : 1 / np;
    for (i = 0; i < nr; i++) for (j = 0; j < np; j++) res.v += res.r[lr[i]] * res.p[lp[j]] * A[i][j];

    if (eqCache.size >= K.EQ_CACHE) eqCache.delete(eqCache.keys().next().value);   // FIFO cap
    eqCache.set(key, res);
    return res;
  }

  // ---------- the brain ----------

  function create(serialized) {
    var s = load(serialized);
    var fbState = 0x9e3779b9;
    var fallbackRng = { next: function () {                    // only if the caller forgot q.rng
      fbState = (Math.imul(fbState, 1664525) + 1013904223) >>> 0;
      return fbState / 4294967296;
    } };

    // --- keys ---

    function habitKeys(ctx, out) {
      var p1 = mi(ctx.prev1), p2 = mi(ctx.prev2), pr = mi(ctx.prevR);
      var last = ctx.last === 'W' ? 0 : ctx.last === 'L' ? 1 : ctx.last === 'C' ? 2 : -1;
      var low = (typeof ctx.pHp === 'number' && typeof ctx.pMaxHp === 'number' &&
                 ctx.pHp <= Math.ceil(ctx.pMaxHp / 3)) ? 1 : 0;
      out[0] = 0;
      out[1] = p1;
      out[2] = (p1 >= 0 && p2 >= 0) ? p2 * 3 + p1 : -1;
      out[3] = last;
      out[4] = (last >= 0 && p1 >= 0) ? last * 3 + p1 : -1;
      out[5] = low;
      out[6] = ctx.turn === 1 ? 0 : -1;
      out[7] = pr;
      out[8] = int(ctx.tension, 0, 3, 0);
      out[9] = (ctx.pBroken ? 1 : 0) + (ctx.rBroken ? 2 : 0);   // 0 none, 1 self, 2 foe, 3 both
      return out;
    }
    // T2 key: what the last stance did to the player. Fresh at the start of every duel.
    function afterKey(ctx) { return (typeof ctx.turn === 'number' && ctx.turn > 1) ? s.t2 : 0; }
    function tellKey(e, tell, ctx) {
      if (tell < 0) return -1;
      return e === T_ALL ? 0 : e === T_STANCE ? tell : afterKey(ctx);
    }

    // Expert e's distribution over player moves into out[3]; false = abstains.
    function expertP(e, key, tell, legal, out) {
      if (key < 0) return false;
      var c = s.c[e], o = key * 3, a = c[o], b = c[o + 1], d = c[o + 2];
      if (a + b + d < K.MIN_MASS) return false;
      var p = K.PRIOR;
      if (e < NH) {
        out[0] = legal[0] ? a + p : 0; out[1] = legal[1] ? b + p : 0; out[2] = legal[2] ? d + p : 0;
      } else {
        if (tell < 0) return false;
        var cm = CAT_MOVE[tell];
        out[cm[0]] = legal[cm[0]] ? a + p : 0;
        out[cm[1]] = legal[cm[1]] ? b + p : 0;
        out[cm[2]] = legal[cm[2]] ? d + p : 0;
      }
      var sum = out[0] + out[1] + out[2];
      if (!(sum > 0)) return false;
      out[0] /= sum; out[1] /= sum; out[2] /= sum;
      return true;
    }

    // Tell-independent ensemble (E0–E9). Returns the total active weight; acc holds Σ w·p.
    function habitMix(ctx, legal, acc) {
      var keys = habitKeys(ctx, []), tmp = [0, 0, 0], tw = 0;
      acc[0] = acc[1] = acc[2] = 0;
      for (var e = 0; e < NH; e++) {
        if (!expertP(e, keys[e], -1, legal, tmp)) continue;
        var w = s.w[e];
        acc[0] += w * tmp[0]; acc[1] += w * tmp[1]; acc[2] += w * tmp[2];
        tw += w;
      }
      return tw;
    }

    function predictIdx(ctx, lp) {
      var legal = maskOf(lp), acc = [0, 0, 0];
      var tw = habitMix(ctx, legal, acc);
      if (tw > 0) { acc[0] /= tw; acc[1] /= tw; acc[2] /= tw; }
      return normalise(acc, legal);
    }

    function predict(ctx, legalP) {
      ctx = ctx || {};
      var p = predictIdx(ctx, legalIdx(legalP, ctx.pBroken ? [0, 2] : null));
      return { S: p[0], G: p[1], F: p[2] };
    }

    // --- trust & honesty ---

    function tellShares() {
      var c = s.c[T_ALL], sum = c[0] + c[1] + c[2] + 3 * K.PRIOR;
      return [(c[0] + K.PRIOR) / sum, (c[1] + K.PRIOR) / sum, (c[2] + K.PRIOR) / sum];
    }
    function trust() { return clamp(tellShares()[0], 0, 1); }

    function honesty(base) {
      var hb = num(base, 0, 1, 0.8);
      var sh = tellShares(), L = s.life[T_ALL];
      var g = K.H_RAMP_TURNS > 0 ? Math.min(1, (L[0] + L[1] + L[2]) / K.H_RAMP_TURNS) : 1;
      var dc = sh[0] - 1 / 3, dm = sh[1] - 1 / 3;
      var up = K.H_TRUST_UP + (K.H_TRUST_UP_LATE - K.H_TRUST_UP) * g;
      var h = hb - (dc > 0 ? up : K.H_TRUST_DOWN) * dc - (dm > 0 ? K.H_MIRROR_LATE * g * dm : 0);
      return clamp(h, K.H_MIN, K.H_MAX);
    }

    // --- decision ---

    function commit(q) {
      q = q || {};
      var ctx = q.ctx || {};
      var lr = legalIdx(q.legalR, null);
      var lp = legalIdx(q.legalP, ctx.pBroken ? [0, 2] : null);
      var legalP = maskOf(lp), legalR = maskOf(lr), n = lp.length;
      var V = readPayoff(q.payoff);
      var eq = solve(V, lr, lp);
      var ramp = K.CONF_TURNS > 0 ? Math.min(1, s.n / K.CONF_TURNS) : 1;
      var i, j, e, t, r;

      // pred[t] = conf·P(·|ctx,t) + (1−conf)·eqP for every tell it could legally show
      var base = [0, 0, 0], tmp = [0, 0, 0];
      var bw = habitMix(ctx, legalP, base);
      var preds = [null, null, null], confs = [0, 0, 0];
      for (i = 0; i < lr.length; i++) {
        t = lr[i];
        var acc = [base[0], base[1], base[2]], tw = bw;
        for (e = NH; e < NE; e++) {
          if (!expertP(e, tellKey(e, t, ctx), t, legalP, tmp)) continue;
          var w = s.w[e];
          acc[0] += w * tmp[0]; acc[1] += w * tmp[1]; acc[2] += w * tmp[2];
          tw += w;
        }
        if (tw > 0) { acc[0] /= tw; acc[1] /= tw; acc[2] /= tw; }
        normalise(acc, legalP);
        var conf = 1;
        if (n > 1) {
          var pmax = Math.max(acc[0], acc[1], acc[2]);
          conf = clamp((pmax - 1 / n) / (1 - 1 / n), 0, 1) * ramp;
        }
        for (j = 0; j < 3; j++) acc[j] = conf * acc[j] + (1 - conf) * eq.p[j];
        preds[t] = normalise(acc, legalP);
        confs[t] = conf;
      }

      var move = -1, tell = -1, mode = 'mix';
      var f = q.force;
      if (f && typeof f === 'object' && (mi(f.move) >= 0 || mi(f.tell) >= 0)) {
        // scripted tutorial turn: no dice, no decision
        move = mi(f.move) >= 0 ? mi(f.move) : mi(f.tell);
        tell = mi(f.tell) >= 0 ? mi(f.tell) : move;
        if (!legalR[move]) move = legalR[tell] ? tell : lr[0];
        if (!legalR[tell]) tell = move;
      } else {
        var rng = q.rng;
        if (!rng || typeof rng.next !== 'function') rng = fallbackRng;   // never Math.random
        var exploit = num(q.exploit, 0, 1, 0.5);
        var h = honesty(q.honestyBase);
        var honest = rng.next() < h;
        if (!(rng.next() < exploit)) {
          // 'mix': equilibrium move, tell honest with probability h, otherwise either lie shape
          var wr = [];
          for (i = 0; i < lr.length; i++) wr.push(eq.r[lr[i]]);
          move = lr[sampleIdx(wr, wr.length, rng.next())];
          tell = move;
          if (!honest) {
            var lies = [];
            for (i = 0; i < lr.length; i++) if (lr[i] !== move) lies.push(lr[i]);
            if (lies.length) tell = lies[Math.min(lies.length - 1, Math.floor(rng.next() * lies.length))];
          }
        } else {
          // 'exploit': softmax over (move, tell) pairs on expected value, equilibrium as the prior
          mode = 'exploit';
          var tau = Math.max(K.TAU_MIN, K.TAU_BASE - K.TAU_SLOPE * exploit);
          var pr = [], pt = [], ev = [], best = -Infinity;
          for (i = 0; i < lr.length; i++) {
            r = lr[i];
            for (j = 0; j < lr.length; j++) {
              t = lr[j];
              if (honest && t !== r) continue;
              var pd = preds[t], x = 0;
              for (var p = 0; p < 3; p++) if (legalP[p]) x += pd[p] * V[r][p];
              pr.push(r); pt.push(t); ev.push(x);
              if (x > best) best = x;
            }
          }
          for (i = 0; i < ev.length; i++) {
            ev[i] = (eq.r[pr[i]] + K.EQ_PRIOR_FLOOR) * Math.exp((ev[i] - best) / tau);
          }
          var k = sampleIdx(ev, ev.length, rng.next());
          move = pr[k]; tell = pt[k];
        }
      }

      var pred = preds[tell], top = lp[0];
      for (i = 0; i < lp.length; i++) if (pred[lp[i]] > pred[top]) top = lp[i];
      return {
        move: MOVES[move], tell: MOVES[tell], honest: tell === move,
        pred: { S: pred[0], G: pred[1], F: pred[2] },
        top: MOVES[top], confidence: clamp(confs[tell], 0, 1), mode: mode
      };
    }

    // --- learning ---

    function observe(ctx, tell, pm, rm) {
      var p = mi(pm);
      if (p < 0) return;
      ctx = ctx || {};
      var t = mi(tell), r = mi(rm);
      var restricted = !!ctx.pBroken;                 // Guard was not on the menu
      var legal = restricted ? [true, false, true] : [true, true, true];
      if (!legal[p]) { legal = [true, true, true]; restricted = false; }
      var n = restricted ? 2 : 3;
      var keys = habitKeys(ctx, []);
      var e, o, tmp = [0, 0, 0];
      for (e = NH; e < NE; e++) keys[e] = tellKey(e, t, ctx);

      // 1. what each expert said about this move, before it learns it
      var pe = [], acc = 0, tw = 0;
      for (e = 0; e < NE; e++) {
        if (expertP(e, keys[e], t, legal, tmp)) { pe[e] = tmp[p]; acc += s.w[e] * tmp[p]; tw += s.w[e]; }
        else pe[e] = -1;
      }
      var pAct = tw > 0 ? acc / tw : 1 / n;

      // 2. predictability (lifetime EMA + this run's mean)
      var st = clamp((pAct - 1 / n) / (1 - 1 / n), -0.5, 1);
      s.ema += K.EMA_ALPHA * (st - s.ema);
      s.rs += st; s.rn++;

      // 3. Hedge. An abstaining ("sleeping") expert neither gains nor loses share this turn: the
      //    awake experts are rescaled to the mass they held before the update, so sitting a turn
      //    out is never rewarded over predicting well.
      var awakeBefore = 0, awakeAfter = 0, sum = 0;
      for (e = 0; e < NE; e++) {
        if (pe[e] < 0) continue;
        awakeBefore += s.w[e];
        s.w[e] = Math.pow(s.w[e], K.HEDGE_DECAY) * Math.exp(-K.HEDGE_ETA * (1 - pe[e]));
        awakeAfter += s.w[e];
      }
      var scale = awakeAfter > 0 ? awakeBefore / awakeAfter : 1;
      for (e = 0; e < NE; e++) {
        if (pe[e] >= 0) s.w[e] *= scale;
        if (!(s.w[e] >= K.W_FLOOR)) s.w[e] = K.W_FLOOR;        // floor everyone, asleep or not
        sum += s.w[e];
      }
      for (e = 0; e < NE; e++) s.w[e] /= sum;

      // 4. counts. A turn where Guard was broken says nothing about how much the player likes
      //    Guard, so it teaches only the guard-state expert (E9) and the stats about that state;
      //    every other table (decayed and raw) learns from free choices only.
      for (e = 0; e < NH; e++) {
        if (keys[e] < 0 || (restricted && e !== E_GUARD)) continue;
        o = keys[e] * 3;
        var c = s.c[e], lam = K.LAMBDA[e];
        c[o] *= lam; c[o + 1] *= lam; c[o + 2] *= lam; c[o + p] += 1;
        s.life[e][o + p]++; s.run[e][o + p]++;
      }
      if (t >= 0 && !restricted) {
        var cat = CAT_OF[t][p];
        for (e = NH; e < NE; e++) {
          o = keys[e] * 3;
          var ct = s.c[e], lt = K.LAMBDA[e];
          ct[o] *= lt; ct[o + 1] *= lt; ct[o + 2] *= lt; ct[o + cat] += 1;
          s.life[e][o + cat]++; s.run[e][o + cat]++;
        }
      }

      // 5. what this stance did to the player (key for T2 next turn)
      if (t >= 0 && r >= 0) {
        var lost = BEAT[r] === p;
        if (t !== r && lost) s.t2 = 1;                          // burned: lost on a lie
        else if (t === r && p === LOSE[t]) s.t2 = 2;            // paid: countered an honest stance
        else s.t2 = 0;
      } else s.t2 = 0;

      s.n++;
      trackPeaks(keys, restricted);
    }

    // --- dossier ---

    function strengthOf(pct, n, min, skew) {
      return r3(clamp((pct - skew) / (100 - skew), 0, 1) * Math.min(1, n / (2 * min)));
    }
    function strengthLow(pct, n, min, low) {
      return r3(clamp((low - pct) / low, 0, 1) * Math.min(1, n / (2 * min)));
    }
    function sumAt(tbl, k) { var o = k * 3; return tbl[o] + tbl[o + 1] + tbl[o + 2]; }
    function topAt(tbl, k) {
      var o = k * 3, m = 0;
      if (tbl[o + 1] > tbl[m + o]) m = 1;
      if (tbl[o + 2] > tbl[m + o]) m = 2;
      return m;
    }
    function mk(id, m, pct, n, str, vars) {
      vars = vars || {};
      vars.pct = pct; vars.n = n;
      vars.move = m >= 0 ? NAME[m] : '';
      vars.moveLower = m >= 0 ? LOWER[m] : '';
      if (vars.ctxKey === undefined) vars.ctxKey = DEF[id] && DEF[id].ctx ? DEF[id].ctx : id;
      return { id: id, kind: DEF[id] ? DEF[id].kind : 'record', move: m >= 0 ? MOVES[m] : null,
               pct: pct, n: n, strength: str, vars: vars };
    }

    // Top-move stat on one fixed key (fav_move, opening, after_loss, ...).
    function keyStat(T, id, k, min, extra) {
      var d = DEF[id], tbl = T[d.e], n = sumAt(tbl, k);
      if (n < min || n <= 0) return null;
      var m = topAt(tbl, k), pct = Math.round(100 * tbl[k * 3 + m] / n);
      return mk(id, m, pct, n, strengthOf(pct, n, min, d.skew), extra || {});
    }
    function twoStepAt(T, k, min) {
      var tbl = T[E_PREV], n = sumAt(tbl, k);
      if (n < min || n <= 0) return null;
      var m = topAt(tbl, k);
      if (m === k) return null;                       // "X then X" belongs to `repeat`
      var pct = Math.round(100 * tbl[k * 3 + m] / n);
      return mk('two_step', m, pct, n, strengthOf(pct, n, min, DEF.two_step.skew),
                { prevMove: NAME[k], prev: MOVES[k], ctxKey: 'after_' + MOVES[k] });
    }
    function loop3At(T, k, min) {
      var tbl = T[E_PREV2], n = sumAt(tbl, k);
      if (n < min || n <= 0) return null;
      var m = topAt(tbl, k), a = Math.floor(k / 3), b = k % 3;
      if (a === b && b === m) return null;            // a triple repeat is not a waltz
      var pct = Math.round(100 * tbl[k * 3 + m] / n);
      return mk('loop3', m, pct, n, strengthOf(pct, n, min, DEF.loop3.skew),
                { a: NAME[a], b: NAME[b], prevMove: NAME[b], ctxKey: 'after_' + MOVES[a] + MOVES[b] });
    }
    function repeatStat(T, min) {
      var tbl = T[E_PREV], d = DEF.repeat, n = 0, diag = 0, m = 0, k;
      for (k = 0; k < 3; k++) {
        n += sumAt(tbl, k); diag += tbl[k * 3 + k];
        if (tbl[k * 3 + k] > tbl[m * 3 + m]) m = k;
      }
      if (n < min || n <= 0) return null;
      var pct = Math.round(100 * diag / n);
      var hi = strengthOf(pct, n, min, d.skew), lo = strengthLow(pct, n, min, d.low);
      var variant = pct >= d.skew ? 'repeats' : pct <= d.low ? 'never_repeats' : 'mixed';
      return mk('repeat', variant === 'repeats' ? m : -1, pct, n, Math.max(hi, lo), { variant: variant });
    }
    function echoStat(T, min) {
      var tbl = T[E_RPREV], d = DEF.echo_rival, n = 0, copy = 0, counter = 0, k;
      for (k = 0; k < 3; k++) { n += sumAt(tbl, k); copy += tbl[k * 3 + k]; counter += tbl[k * 3 + LOSE[k]]; }
      if (n < min || n <= 0) return null;
      var variant = counter > copy ? 'counters' : 'copies';
      var pct = Math.round(100 * Math.max(copy, counter) / n);
      return mk('echo_rival', -1, pct, n, strengthOf(pct, n, min, d.skew), { variant: variant });
    }
    function trustStat(T, id, k, min, hiName, loName) {
      var d = DEF[id], tbl = T[d.e], n = sumAt(tbl, k);
      if (n < min || n <= 0) return null;
      var o = k * 3, pct = Math.round(100 * tbl[o] / n);
      var variant = pct >= d.skew ? hiName : pct <= d.low ? loName : 'wary';
      return mk(id, -1, pct, n, Math.max(strengthOf(pct, n, min, d.skew), strengthLow(pct, n, min, d.low)),
                { variant: variant, mirror: Math.round(100 * tbl[o + 1] / n), under: Math.round(100 * tbl[o + 2] / n) });
    }
    function stanceStat(T, min) {
      var tbl = T[T_STANCE], d = DEF.tell_by_stance, best = null;
      for (var t = 0; t < 3; t++) {
        var n = sumAt(tbl, t);
        if (n < min || n <= 0) continue;
        var cat = topAt(tbl, t), pct = Math.round(100 * tbl[t * 3 + cat] / n);
        var st = mk('tell_by_stance', CAT_MOVE[t][cat], pct, n, strengthOf(pct, n, min, d.skew),
                    { tellMove: NAME[t], tell: MOVES[t], variant: CAT_NAME[cat], ctxKey: 'show_' + MOVES[t] });
        if (!best || st.strength > best.strength || (st.strength === best.strength && st.pct > best.pct)) best = st;
      }
      return best;
    }
    function better(a, b) {
      if (!a) return b;
      if (!b) return a;
      return (b.strength > a.strength || (b.strength === a.strength && b.pct > a.pct)) ? b : a;
    }

    // All habit + tell stats from one raw table set. minAll overrides every min n (run insights).
    function buildStats(T, minAll) {
      var out = [], k, st;
      function min(id) { return minAll || DEF[id].min; }
      function add(x) { if (x) out.push(x); }
      add(keyStat(T, 'fav_move', 0, min('fav_move')));
      add(keyStat(T, 'opening', 0, min('opening')));
      add(keyStat(T, 'after_loss', 1, min('after_loss')));
      add(keyStat(T, 'after_win', 0, min('after_win')));
      add(repeatStat(T, min('repeat')));
      st = null;
      for (k = 0; k < 3; k++) st = better(st, twoStepAt(T, k, min('two_step')));
      add(st);
      st = null;
      for (k = 0; k < 9; k++) st = better(st, loop3At(T, k, min('loop3')));
      add(st);
      add(keyStat(T, 'low_hp', 1, min('low_hp')));
      add(trustStat(T, 'tell_trust', 0, min('tell_trust'), 'gullible', 'paranoid'));
      add(stanceStat(T, min('tell_by_stance')));
      add(trustStat(T, 'after_burn', 1, min('after_burn'), 'never_learns', 'sulks'));
      add(echoStat(T, min('echo_rival')));
      add(keyStat(T, 'deathblow_nerves', 3, min('deathblow_nerves')));
      add(keyStat(T, 'broken_panic', 1, min('broken_panic')));
      add(keyStat(T, 'vs_broken', 2, min('vs_broken')));
      return out;
    }

    function byStrength(a, b) { return (b.strength - a.strength) || (b.pct - a.pct); }

    function lifeScore() {
      if (s.n <= 0) return 0;
      var corr = 1 - Math.pow(1 - K.EMA_ALPHA, s.n);            // bias-corrected EMA
      var m = corr > 1e-9 ? s.ema / corr : 0;
      return clamp(Math.round(K.SCORE_SCALE * m), 0, 100);
    }
    function runScore() {
      if (s.rn <= 0) return 0;
      return clamp(Math.round(K.SCORE_SCALE * s.rs / s.rn), 0, 100);
    }

    // Peaks: remember the highest a mocked single-key habit ever got, so we can notice it stopping.
    function notePeak(id, k, m, pct) {
      var cur = s.pk[id];
      if (cur && cur.p >= pct) return;
      s.pk[id] = { k: k, m: m, p: pct, r: s.runs, s: (cur && cur.k === k && cur.m === m) ? cur.s : 0 };
    }
    function trackPeaks(keys, restricted) {
      for (var i = 0; i < PEAK_IDS.length; i++) {
        var id = PEAK_IDS[i], d = DEF[id], k = keys[d.e];
        if (k < 0) continue;
        if (d.k !== undefined && d.k !== k) continue;
        if (restricted && d.e !== E_GUARD) continue;
        var tbl = s.life[d.e], n = sumAt(tbl, k);
        if (n < 2 * d.min) continue;                 // only a settled share may set a peak
        var m = topAt(tbl, k);
        if (id === 'two_step' && m === k) continue;
        if (id === 'loop3' && Math.floor(k / 3) === k % 3 && k % 3 === m) continue;
        var pct = Math.round(100 * tbl[k * 3 + m] / n);
        if (pct >= d.skew) notePeak(id, k, m, pct);
      }
    }
    function brokenMass(e) { return Math.min(K.BROKEN_MASS, K.BROKEN_SAT / (1 - K.LAMBDA[e])); }
    function findBroken() {
      var best = null;
      for (var i = 0; i < PEAK_IDS.length; i++) {
        var id = PEAK_IDS[i], pk = s.pk[id];
        if (!pk) continue;
        var d = DEF[id], c = s.c[d.e], o = pk.k * 3, mass = c[o] + c[o + 1] + c[o + 2];
        if (mass < brokenMass(d.e)) continue;
        var now = 100 * c[o + pk.m] / mass;
        var L = s.life[d.e], ln = L[o] + L[o + 1] + L[o + 2];
        var ref = ln > 0 ? Math.min(pk.p, 100 * L[o + pk.m] / ln) : pk.p;
        var drop = ref - now;
        if (drop >= K.BROKEN_DROP && (!best || drop > best.drop)) {
          best = { id: id, pk: pk, drop: drop, now: now, n: ln };
        }
      }
      return best;
    }
    function brokenStat() {
      var b = findBroken();
      if (!b) return null;
      var d = DEF[b.id], pk = b.pk;
      var vars = { oldMove: LOWER[pk.m], oldMoveName: NAME[pk.m], nowPct: Math.round(b.now),
                   drop: Math.round(b.drop), habitId: b.id, run: pk.r, ctxKey: d.ctx };
      if (b.id === 'two_step') { vars.prevMove = NAME[pk.k]; vars.ctxKey = 'after_' + MOVES[pk.k]; }
      if (b.id === 'loop3') {
        var a = Math.floor(pk.k / 3), bb = pk.k % 3;
        vars.a = NAME[a]; vars.b = NAME[bb]; vars.ctxKey = 'after_' + MOVES[a] + MOVES[bb];
      }
      var st = mk('broken_habit', pk.m, pk.p, b.n, r3(clamp(b.drop / 100, 0, 1)), vars);
      st.kind = 'record';
      return st;
    }

    function dossier() {
      var stats = buildStats(s.life, 0);
      var score = lifeScore();
      if (s.n >= DEF.predictability.min) {
        var d = DEF.predictability;
        var variant = score >= d.skew ? 'predictable' : score <= d.low ? 'ghost' : 'mid';
        var st = mk('predictability', -1, score, s.n, strengthOf(score, s.n, d.min, d.skew), { variant: variant });
        st.kind = 'record';
        stats.push(st);
      }
      var broken = brokenStat();
      if (broken) stats.push(broken);
      stats.sort(byStrength);
      var g = s.life[E_GLOBAL], gn = g[0] + g[1] + g[2];
      var T = s.life[T_ALL], tn = T[0] + T[1] + T[2];
      return {
        samples: s.n,
        predictability: score,
        favorite: gn > 0 ? MOVES[topAt(g, 0)] : null,
        tell: {
          counter: tn > 0 ? Math.round(100 * T[0] / tn) : 0,
          mirror: tn > 0 ? Math.round(100 * T[1] / tn) : 0,
          under: tn > 0 ? Math.round(100 * T[2] / tn) : 0,
          n: tn
        },
        stats: stats,
        broken: broken
      };
    }

    // Strongest mocked habit whose key matches this exact situation (null if none).
    function habitFor(ctx) {
      ctx = ctx || {};
      var T = s.life, keys = habitKeys(ctx, []), cands = [], st;
      function add(x) { if (x && x.strength > 0) cands.push(x); }
      if (keys[E_OPEN] === 0) add(keyStat(T, 'opening', 0, DEF.opening.min));
      if (keys[E_LAST] === 1) add(keyStat(T, 'after_loss', 1, DEF.after_loss.min));
      if (keys[E_LAST] === 0) add(keyStat(T, 'after_win', 0, DEF.after_win.min));
      if (keys[E_LOW] === 1) add(keyStat(T, 'low_hp', 1, DEF.low_hp.min));
      if (keys[E_PREV] >= 0) {
        add(twoStepAt(T, keys[E_PREV], DEF.two_step.min));
        st = repeatStat(T, DEF.repeat.min);
        if (st && st.vars.variant === 'repeats') {          // in this spot "repeat" names a move
          var pm = keys[E_PREV];
          st.move = MOVES[pm]; st.vars.move = NAME[pm]; st.vars.moveLower = LOWER[pm];
        }
        add(st);
      }
      if (keys[E_PREV2] >= 0) add(loop3At(T, keys[E_PREV2], DEF.loop3.min));
      if (keys[E_RPREV] >= 0) {
        st = echoStat(T, DEF.echo_rival.min);
        if (st) {
          var em = st.vars.variant === 'copies' ? keys[E_RPREV] : LOSE[keys[E_RPREV]];
          st.move = MOVES[em]; st.vars.move = NAME[em]; st.vars.moveLower = LOWER[em];
        }
        add(st);
      }
      if (keys[E_TENSION] === 3) add(keyStat(T, 'deathblow_nerves', 3, DEF.deathblow_nerves.min));
      if (keys[E_GUARD] === 1) add(keyStat(T, 'broken_panic', 1, DEF.broken_panic.min));
      if (keys[E_GUARD] === 2) add(keyStat(T, 'vs_broken', 2, DEF.vs_broken.min));
      var best = null;
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (!c.move) continue;                               // a taunt needs a move to name
        if (ctx.pBroken && c.move === 'G') continue;         // never taunt with a move they cannot make
        if (!best || c.strength > best.strength) best = c;
      }
      return best;
    }

    // Up to 3 mocked stats computed on this run's turns only.
    function runInsights() {
      var all = buildStats(s.run, K.INSIGHT_MIN).filter(function (x) { return x.strength > 0; });
      all.sort(byStrength);
      var out = [], seen = {};
      for (var i = 0; i < all.length && out.length < 3; i++) {
        var id = all[i].id;
        if ((id === 'two_step' && seen.loop3) || (id === 'loop3' && seen.two_step)) continue;   // same waltz twice
        seen[id] = true;
        out.push(all[i]);
      }
      return out;
    }

    // --- lifecycle ---

    function scaleCounts(f) {
      for (var e = 0; e < NE; e++) { var c = s.c[e]; for (var i = 0; i < c.length; i++) c[i] *= f; }
    }

    function beginRun(o) {
      var days = (o && typeof o.days === 'number' && isFinite(o.days)) ? o.days : 0;
      // a broken habit is reported for two runs, then its peak is forgotten
      var id;
      for (id in s.pk) if (s.pk[id].s >= 2) delete s.pk[id];
      var b = findBroken();
      if (b) b.pk.s++;
      scaleCounts(days >= K.AWAY_DAYS ? K.AWAY_DECAY : K.RUN_DECAY);
      var sum = 0, e;
      for (e = 0; e < NE; e++) { s.w[e] = Math.sqrt(s.w[e]); sum += s.w[e]; }
      for (e = 0; e < NE; e++) s.w[e] /= sum;
      s.run = newTables();
      s.rs = 0; s.rn = 0; s.t2 = 0;
      s.runs++;
    }

    function forget(f) {
      scaleCounts(num(f, 0, 1, 0.5));
      for (var e = 0; e < NE; e++) s.w[e] = (s.w[e] + 1 / NE) / 2;
    }

    function serialize() {
      var w = [], pk = {}, e, id;
      for (e = 0; e < NE; e++) w.push(r4(s.w[e]));
      for (id in s.pk) { var p = s.pk[id]; pk[id] = { k: p.k, m: p.m, p: p.p, r: p.r, s: p.s }; }
      return { v: 1, n: s.n, runs: s.runs, w: w,
               c: writeTables(s.c, false), life: writeTables(s.life, true), run: writeTables(s.run, true),
               t2: s.t2, ema: r4(s.ema), rs: r3(s.rs), rn: s.rn, pk: pk };
    }

    return {
      serialize: serialize, beginRun: beginRun, commit: commit, predict: predict, observe: observe,
      trust: trust, honesty: honesty, forget: forget, runScore: runScore,
      dossier: dossier, habitFor: habitFor, runInsights: runInsights
    };
  }

  // Equilibrium of a payoff[rm][pm] matrix restricted to the legal moves (for the sim and tests).
  function equilibrium(payoff, legalR, legalP) {
    var eq = solve(readPayoff(payoff), legalIdx(legalR, null), legalIdx(legalP, null));
    return { r: { S: eq.r[0], G: eq.r[1], F: eq.r[2] }, p: { S: eq.p[0], G: eq.p[1], F: eq.p[2] }, value: eq.v };
  }

  R.Brain = {
    create: create,
    equilibrium: equilibrium,
    K: K,
    cacheSize: function () { return eqCache.size; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
