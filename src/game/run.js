// SHOW ME MY RIVAL — run structure: duel table, bonfire offers, the Rival's draft, meta, unlocks, memory.
// Pure (no DOM, no Date — `now` is passed in; randomness only from run.rngState via R.RNG).
(function (R) {
  'use strict';

  // =====================================================================================
  // BALANCE CONSTANTS — the balance pass edits this block (and may also overwrite
  // R.Run.HEAL / R.Run.PHASE2_HEAL / R.Run.PLAYER_MAX_HP / R.Run.DUELS[n].rivalHp at runtime:
  // every function reads them from R.Run at call time).
  // =====================================================================================
  var PLAYER_MAX_HP = 26;                         // one pool for the whole run: bonfires top it up, they do not refill it
  var HEAL = 6;                                   // bonfire heal
  var PHASE2_HEAL = 4;                            // heal at the phase-2 transformation
  var RIVAL_HP = [6, 7, 8, 8, 9, 10, 9];          // duels 1..7 (duel 7 = phase 1). Duel 1 must stay >= 6: the tutorial deals 2+2 before its turn 3
  var PHASE2_HP = 7;                              // The Unmasked
  var EXPLOIT = [0.30, 0.50, 0.65, 0.75, 0.85, 0.95, 1.00];
  var PHASE2_EXPLOIT = 1.00;
  var HONESTY = [0.97, 0.90, 0.82, 0.74, 0.64, 0.50, 0.42];
  var PHASE2_HONESTY = 0.35;
  // Offer rarity weights [common, uncommon, rare] by bonfire number (1..6)
  var RARITY_WEIGHTS = [null, [70, 27, 3], [70, 27, 3], [50, 40, 10], [50, 40, 10], [35, 45, 20], [35, 45, 20]];
  var OFFER_SIZE = 3;
  var RIVAL_CANDIDATES = 3;                       // hidden candidates the Rival chooses among
  var SYNERGY = 1.5;                              // Rival pick: shares a tag with a boon it owns
  var JITTER_LO = 0.8, JITTER_HI = 1.2;
  var COUNTER_CAP = 8;                            // counter multipliers stack up to this
  var WHY_THRESHOLD = 3;                          // counter >= this sets offer.rivalWhy
  var SHARE_G = 0.40, SHARE_S = 0.40, SHARE_F = 0.35;
  var REPEAT_PCT = 45, PREDICTABLE = 55, TRUST_HI = 60, TRUST_LO = 20;
  // The Vigil (stakes): run.stake = how many of the seven lights are out. Each light adds one rule to all the ones before it.
  // healCut: bonfires heal HEAL - this (light 2). hp: extra Rival health in every duel (light 6). callsFrom: first duel with Called Shot (light 7).
  var VT = { healCut: 2, hp: 1, callsFrom: 1 };
  // =====================================================================================

  // Order matters: light k is VIGIL[k - 1], and a run with stake s has lights 1..s out.
  var VIGIL = [
    { id: 'benefit_of_doubt', name: 'The Benefit of the Doubt' },   // 1: the exploit curve runs one duel early
    { id: 'kinder_fire', name: 'The Kinder Fire' },                 // 2: bonfires heal less
    { id: 'honest_face', name: 'The Honest Face' },                 // 3: the honesty curve runs one duel early
    { id: 'empty_hand', name: 'The Empty Hand' },                   // 4: the Rival drafts once before duel 1
    { id: 'moments_peace', name: "A Moment's Peace" },              // 5: no heal at the phase-2 transformation
    { id: 'glass_jaw', name: 'The Glass Jaw' },                     // 6: the Rival has more health in every duel
    { id: 'unsaid', name: 'The Unsaid' }                            // 7: Called Shot in every duel
  ];
  var VIGIL_MAX = VIGIL.length;
  // The rules a run is made under. A newer build that changes what a stored run means raises it; a build whose
  // R.Run.RULES is below a run's run.req parks that run (keeps it, never plays it). Read as R.Run.RULES at call time.
  var RULES = 0;

  var NAMES = ['The Nave', 'Vespers', 'The Leak', 'Draught', 'The Wake', 'Blood Moon', 'The Altar'];
  var VARIANTS = ['nave', 'vespers', 'leak', 'draught', 'wake', 'bloodmoon', 'altar'];
  var RARITIES = ['common', 'uncommon', 'rare'];

  function tau(e) { return Math.round((1.2 - 0.9 * e) * 100) / 100; }   // display copy of R.Brain.K.TAU_BASE - TAU_SLOPE * e

  var DUELS = [null];
  (function () {
    for (var i = 0; i < 7; i++) {
      DUELS.push({
        n: i + 1, name: NAMES[i], rivalHp: RIVAL_HP[i], exploit: EXPLOIT[i], honesty: HONESTY[i],
        tau: tau(EXPLOIT[i]), rivalBoons: i, variant: VARIANTS[i]
      });
    }
    DUELS.phase2 = {
      n: 7, name: 'The Unmasked', rivalHp: PHASE2_HP, exploit: PHASE2_EXPLOIT, honesty: PHASE2_HONESTY,
      tau: tau(PHASE2_EXPLOIT), rivalBoons: 6, variant: 'unmasked'
    };
  })();

  // ---------------------------------------------------------------- the final duel: the Faces at the Altar
  // Order = unlock order: beating a face once earns the next; a run then draws one from those earned.
  // Phase 1 of every face starts from the duel-7 row of DUELS, later phases from DUELS.phase2, unless the
  // phase gives its own hp / exploit / honesty. Per phase:
  //   name, hp, exploit, honesty   numbers (optional)
  //   heal        player heal on entering this phase (default PHASE2_HEAL; phases 2+ only)
  //   floor       tension floor 0..3          calls   Called Shot is live
  //   stance      'none' = it shows no stance  mimic   it picks its move the way the player would
  //   innate      [boon ids] it holds for this phase only      fortify  it starts the phase with this much
  //   copyBoons   it also holds every boon of the player's that it is able to hold
  //   who, mask, arena, witch, music   how it looks and sounds (scene)
  //   change      how the previous phase ends: 'shatter' | 'swap' | 'bell'      cards  [R.Text.rules ids] shown after
  var BOSSES = [
    { id: 'unmasked', name: 'The Unmasked', phases: [
      { name: 'The Altar' },
      { name: 'The Unmasked', floor: 1, calls: true, who: 'rival2', witch: true, music: 'boss2', change: 'shatter', cards: ['embers', 'called_shot'] }
    ] },
    // Three masks, three moods. Each face leans on one thing: the lie, the guard, and finally nothing to read at all.
    { id: 'three_faced', name: 'The Three-Faced', phases: [
      { name: 'The Jester', hp: 5, honesty: 0.30, mask: 'jester', innate: ['painted_smile'], cards: ['jester'] },
      { name: 'The Mourner', hp: 4, heal: 3, mask: 'mourner', innate: ['thorned_guard'], fortify: 1, change: 'swap', cards: ['mourner'] },
      { name: 'The Blank', hp: 5, heal: 3, mask: 'blank', stance: 'none', music: 'boss2', change: 'swap', cards: ['blank'] }
    ] },
    // The night passes in four short fights; every bell raises the tension floor by one.
    { id: 'hours', name: 'The Hours', phases: [
      { name: 'Vespers', hp: 4, cards: ['hours'] },
      { name: 'Compline', hp: 4, heal: 3, floor: 1, change: 'bell', cards: ['bell_1'] },
      { name: 'Matins', hp: 4, heal: 3, floor: 2, arena: 'blood_moon', music: 'boss2', change: 'bell', cards: ['bell_2'] },
      { name: 'Lauds', hp: 4, heal: 3, floor: 3, arena: 'pale_dawn', music: 'boss2', change: 'bell', cards: ['bell_3'] }
    ] },
    // It stops predicting the player and starts being the player: first their boons, then their habits, then both.
    { id: 'reflection', name: 'The Reflection', phases: [
      { name: 'The Borrower', hp: 5, copyBoons: true, cards: ['borrower'] },
      { name: 'The Likeness', hp: 5, heal: 3, who: 'mirror', mimic: true, change: 'shatter', cards: ['likeness'] },
      { name: 'The Reflection', hp: 5, heal: 3, who: 'mirror', mimic: true, copyBoons: true, floor: 1, witch: true, music: 'boss2', change: 'swap', cards: ['reflection'] }
    ] }
  ];

  // ---------------------------------------------------------------- helpers

  function byId(id) { return R.Boons.byId[id]; }
  function isLow(hp, maxHp) { return hp <= Math.ceil(maxHp / 3); }
  function num(v, d) { return typeof v === 'number' && v === v && isFinite(v) ? v : d; }

  function rngOf(run) {
    var rng = R.RNG.create(1);
    rng.setState(num(run.rngState, 0x9e3779b9) >>> 0);
    return rng;
  }

  // ---------------------------------------------------------------- meta

  function defaultMeta() {
    return {
      unlocked: {}, seenCredits: false, seenTutorial: false,
      counters: { deathblows: 0, bleedDealt: 0, reads: 0, guardBroken: 0, drafts: 0, liesCaught: 0 },
      memory: {
        runs: 0, wins: 0, deaths: 0, streakW: 0, streakL: 0, bestDuel: 0,
        closestLoss: null, fastestDeath: null, lastWin: null,
        lastPlayed: 0, firstPlayed: 0, lastFavorite: null, favorites: [], totalTurns: 0
      },
      // max: lights the player has earned the right to put out. sel: how many they choose to. wins[s]: wins with s out.
      vigil: { max: 0, sel: 0, wins: [0, 0, 0, 0, 0, 0, 0, 0] },
      // max: how many faces (BOSSES, in order) have been earned. wins: { id: n }. last: the face of the previous run.
      bosses: { max: 1, wins: {}, last: null }
    };
  }
  function bossIndex(id) { for (var i = 0; i < BOSSES.length; i++) if (BOSSES[i].id === id) return i; return -1; }
  function bossOf(run) { var i = run ? bossIndex(run.boss) : -1; return BOSSES[i < 0 ? 0 : i]; }
  function phaseCount(run) { return bossOf(run).phases.length; }
  function clampStake(v) { v = Math.floor(num(v, 0)); return v < 0 ? 0 : v > VIGIL_MAX ? VIGIL_MAX : v; }
  function stakeOf(run) { return run ? clampStake(run.stake) : 0; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function hiOf(v) { return typeof v === 'number' && v > 0 && isFinite(v) ? Math.floor(v) : 0; }
  // The rules a stored run needs (0 for a run made before run.req existed, or a garbage value).
  function reqOf(run) { var q = run && typeof run === 'object' ? run.req : 0; return typeof q === 'number' && q > 0 ? Math.floor(q) : 0; }

  // A stored run whose face or phase this build cannot read is repaired, never dropped and never silently fought as
  // another face. A missing run.boss (a run from before the faces) still means The Unmasked. A missing or garbage
  // run.phase comes back from the duel's own phase, else 1. A face this build does not know is redrawn from the
  // earned faces on the run's own face stream (the one create() draws from) and becomes meta.bosses.last; in the
  // final duel that restarts duel 7 at phase 1, and so does a phase past the face's count.
  // In place. Returns { redrawn, restart }.
  function repairRun(run, meta) {
    var out = { redrawn: false, restart: false };
    if (!isObj(run)) return out;
    meta = repair(meta);
    var d = isObj(run.duel) ? run.duel : null, ph = run.phase, atAltar = run.duelN === 7 && run.stage === 'duel';
    if (typeof ph !== 'number' || !isFinite(ph)) ph = d && typeof d.phase === 'number' && isFinite(d.phase) ? d.phase : 1;
    run.phase = Math.max(1, Math.floor(ph));
    if (run.boss !== undefined && run.boss !== null && bossIndex(run.boss) < 0) {
      var bs = meta.bosses, faces = [], fi;
      for (fi = 0; fi < bs.max; fi++) faces.push(BOSSES[fi].id);
      run.boss = faces[R.RNG.create((num(run.seed, 0) ^ 0x7f4a7c15) >>> 0).int(faces.length)];
      bs.last = run.boss;
      out.redrawn = true;
      if (atAltar) out.restart = true;
    }
    if (run.phase > phaseCount(run)) { run.phase = 1; if (atAltar) out.restart = true; }
    if (out.restart) { run.phase = 1; run.duel = null; run.pending = null; }
    return out;
  }

  // Fill in anything a stored meta is missing (older saves, hand-edited storage). In place.
  function repair(meta) {
    if (!meta || typeof meta !== 'object') return defaultMeta();
    var d = defaultMeta(), k, g;
    if (!meta.unlocked || typeof meta.unlocked !== 'object') meta.unlocked = {};
    if (typeof meta.seenCredits !== 'boolean') meta.seenCredits = !!meta.seenCredits;
    if (typeof meta.seenTutorial !== 'boolean') meta.seenTutorial = !!meta.seenTutorial;
    var groups = ['counters', 'memory'];
    for (g = 0; g < groups.length; g++) {
      var name = groups[g];
      if (!meta[name] || typeof meta[name] !== 'object') meta[name] = {};
      for (k in d[name]) {
        var dv = d[name][k], v = meta[name][k];
        if (typeof dv === 'number') { if (typeof v !== 'number' || v !== v) meta[name][k] = dv; }
        else if (Array.isArray(dv)) { if (!Array.isArray(v)) meta[name][k] = []; }
        else if (v === undefined) meta[name][k] = dv;
      }
    }
    // Shadow high-water keys: vigil.hi and bosses.hi (the most lights / faces ever earned) and vigil.winsX (wins with
    // more lights out than this build has). They are never clamped or dropped, so a build with fewer lights or faces
    // that saves this meta cannot lower what a later build reads back; max and wins stay the clamped view it plays.
    var vg = meta.vigil, wx;
    if (!vg || typeof vg !== 'object') vg = meta.vigil = d.vigil;
    vg.max = clampStake(Math.max(num(vg.max, 0), hiOf(vg.hi)));
    vg.sel = Math.min(clampStake(vg.sel), vg.max);
    if (!Array.isArray(vg.wins)) vg.wins = [];
    for (k = VIGIL_MAX + 1; k < vg.wins.length; k++) {
      wx = Math.max(0, Math.floor(num(vg.wins[k], 0)));
      if (!(wx > 0)) continue;
      if (!isObj(vg.winsX)) vg.winsX = {};
      vg.winsX[String(k)] = Math.max(hiOf(vg.winsX[String(k)]), wx);
    }
    for (k = 0; k <= VIGIL_MAX; k++) vg.wins[k] = Math.max(0, Math.floor(num(vg.wins[k], 0)));
    vg.wins.length = VIGIL_MAX + 1;
    var bs = meta.bosses;
    if (!bs || typeof bs !== 'object') bs = meta.bosses = d.bosses;
    bs.max = Math.max(1, Math.min(BOSSES.length, Math.floor(Math.max(num(bs.max, 1), hiOf(bs.hi)))));
    if (!bs.wins || typeof bs.wins !== 'object') bs.wins = {};
    if (bossIndex(bs.last) < 0) bs.last = null;
    return meta;
  }

  function newStats() {
    return {
      turns: 0, moves: { S: 0, G: 0, F: 0 }, wins: 0, losses: 0, clashes: 0,
      reads: 0, surprises: 0, liesCaught: 0, duelTurns: [], flags: {},
      // extras (not in the contract, all plain JSON)
      liesWorked: 0, deathblows: 0, guardBroken: 0, repeats: 0, repeatOpp: 0,
      drafts: 0, draftsSynced: 0, bleedDealt: 0, bleedSynced: 0,
      lastMove: null, lowHpEnd: false, spent: { p: {}, r: {} }
    };
  }
  function statsOf(run) {
    var d = newStats(), s = run.stats, k;
    if (!s || typeof s !== 'object') { run.stats = d; return d; }
    for (k in d) if (s[k] === undefined || s[k] === null && d[k] !== null) s[k] = d[k];
    if (!s.spent.p) s.spent.p = {};
    if (!s.spent.r) s.spent.r = {};
    return s;
  }

  function relics(meta) {
    meta = repair(meta);
    return R.Boons.list.filter(function (b) { return b.relic && (!b.unlock || meta.unlocked[b.unlock]); });
  }

  // Draftable boons for a side ('p' | 'r'): never relics, only unlocked ones.
  function pool(meta, side) {
    meta = repair(meta);
    var who = side === 'r' ? 'rival' : 'player';
    return R.Boons.list.filter(function (b) {
      return !b.relic && (b.who === 'both' || b.who === who) && (!b.unlock || meta.unlocked[b.unlock]);
    });
  }

  // ---------------------------------------------------------------- run lifecycle

  function create(meta, o) {
    meta = repair(meta);
    o = o || {};
    var now = num(o.now, 0);
    var mem = meta.memory;
    var days = mem.lastPlayed > 0 && now > mem.lastPlayed ? Math.floor((now - mem.lastPlayed) / 86.4e6) : 0;
    mem.runs++;
    if (!mem.firstPlayed) mem.firstPlayed = now;
    mem.lastPlayed = now;
    if (mem.bestDuel < 1) mem.bestDuel = 1;

    var relicId = null;
    if (o.relicId) {
      var owned = relics(meta);
      for (var i = 0; i < owned.length; i++) if (owned[i].id === o.relicId) relicId = o.relicId;
    }
    var seed = num(o.seed, 1) >>> 0;
    var maxHp = R.Run.PLAYER_MAX_HP;
    var stake = clampStake(o.stake);
    if (!o.anyStake && stake > meta.vigil.max) stake = meta.vigil.max;      // only earned lights (the sim passes anyStake)
    var run = {
      seed: seed,
      rngState: (seed ^ 0x51ed270b) >>> 0,
      duelN: 1, phase: 1, stage: 'duel',
      pHp: maxHp, pMaxHp: maxHp,
      pBoons: relicId ? [relicId] : [],        // the relic is the first boon the player owns
      rBoons: [],
      duel: null, offer: null, pending: null,
      relicId: relicId,
      stats: newStats(),
      runNo: mem.runs,                         // extra: this run's ordinal
      daysAway: days,                          // extra: days since the previous visit (for brain.beginRun)
      finished: null,
      stake: stake,                            // the Vigil: how many lights are out for this run
      rivalHead: null,                         // The Empty Hand: the boon the Rival walked in with
      boss: BOSSES[0].id,                      // the face it will wear in duel 7
      req: R.Run.RULES                         // the rules it is made under: a build below them parks it
    };
    // Which face: any earned one, but not the one from the previous run (its own stream: the run's rng is untouched).
    var bs = meta.bosses, bi = bossIndex(o.boss);
    if (bi >= 0 && (o.anyBoss || bi < bs.max)) run.boss = BOSSES[bi].id;
    else if (bs.max >= 2) {
      var faces = [], fi;
      for (fi = 0; fi < bs.max; fi++) if (BOSSES[fi].id !== bs.last) faces.push(BOSSES[fi].id);
      run.boss = faces[R.RNG.create((seed ^ 0x7f4a7c15) >>> 0).int(faces.length)];
    }
    bs.last = run.boss;
    if (stake >= 4) {                          // The Empty Hand: it drafts once before duel 1 (bonfire-1 odds)
      var rng = rngOf(run);
      var head = rivalDraft(run, meta, o.dossier || null, rng);
      run.rngState = rng.state();
      if (head.id) { run.rBoons.push(head.id); run.rivalHead = head.id; }
    }
    return run;
  }

  // ---------------------------------------------------------------- the Vigil

  // Effective duel table row for this run (see VIGIL for which light does what).
  // Phase k of this run's face before the Vigil touches it: { def, base, k, hp, exploit, honesty }.
  function finalRow(run, k) {
    var D = R.Run.DUELS, b = bossOf(run);
    k = Math.max(1, Math.min(b.phases.length, Math.floor(num(k, 1))));
    var def = b.phases[k - 1], base = k === 1 ? D[7] : D.phase2;
    return { def: def, base: base, k: k, hp: num(def.hp, base.rivalHp), exploit: num(def.exploit, base.exploit), honesty: num(def.honesty, base.honesty) };
  }
  // Everything a fight needs to know about itself: the numbers (after the Vigil) and, in duel 7, the phase's rules and look.
  function cfg(run, duel) {
    var D = R.Run.DUELS, s = stakeOf(run);
    var n = duel ? duel.n : run.duelN, fin = n >= 7;
    var row = fin ? finalRow(run, duel ? duel.phase : run.phase) : null;
    var base = fin ? row.base : D[n], def = fin ? row.def : null, count = fin ? phaseCount(run) : 1, k = fin ? row.k : 1;
    var hp = fin ? row.hp : base.rivalHp, ex = fin ? row.exploit : base.exploit, ho = fin ? row.honesty : base.honesty;
    if (s >= 1) {                                // one step early: the next duel's (or phase's) numbers
      var next = !fin ? (n < 6 ? D[n + 1] : finalRow(run, 1)) : (k < count ? finalRow(run, k + 1) : null);
      if (next) {
        ex = next.exploit;
        if (s >= 3) ho = fin ? (ho + next.honesty) / 2 : next.honesty;
      }
    }
    if (s >= 6) hp += VT.hp;
    return {
      n: base.n, name: (def && def.name) || base.name, rivalHp: hp, exploit: ex, honesty: ho, tau: tau(ex),
      rivalBoons: base.rivalBoons, variant: base.variant,
      phase: k, phases: count, last: !fin || k >= count,
      floor: def ? num(def.floor, 0) : 0, calls: !!(def && def.calls), stance: (def && def.stance) || null, mimic: !!(def && def.mimic),
      innate: (def && def.innate) || null, fortify: def ? num(def.fortify, 0) : 0, copyBoons: !!(def && def.copyBoons),
      heal: def && typeof def.heal === 'number' ? def.heal : null,
      who: (def && def.who) || 'rival', mask: (def && def.mask) || null, arena: (def && def.arena) || null, witch: !!(def && def.witch),
      music: (def && def.music) || (fin ? 'boss' : 'drone'), change: (def && def.change) || null, cards: (def && def.cards) || null
    };
  }
  // The Rival's fighter for a fight: its drafted boons plus whatever this phase lends it.
  function rivalFighter(run, D) {
    var ids = run.rBoons.slice(), i, b, inn = D.innate || [];
    for (i = 0; i < inn.length; i++) if (ids.indexOf(inn[i]) < 0 && byId(inn[i])) ids.push(inn[i]);
    if (D.copyBoons) {
      for (i = 0; i < run.pBoons.length; i++) {
        b = byId(run.pBoons[i]);
        if (b && !b.relic && b.who === 'both' && !b.active && ids.indexOf(b.id) < 0) ids.push(b.id);
      }
    }
    var r = R.Combat.newFighter(D.rivalHp, D.rivalHp, ids);
    if (D.fortify > 0) r.status.fortify = D.fortify;
    return r;
  }
  function duelOpts(run, D, n, k, p, r) {
    return { n: n, phase: k, p: p, r: r, floor: D.floor, calls: D.calls || callsOn(run, n), stance: D.stance, mimic: D.mimic };
  }
  function healOf(run) { return Math.max(0, R.Run.HEAL - (stakeOf(run) >= 2 ? VT.healCut : 0)); }
  function phaseHealOf(run, D) { return stakeOf(run) >= 5 ? 0 : (D && D.heal !== null && D.heal !== undefined ? D.heal : R.Run.PHASE2_HEAL); }
  function callsOn(run, n) { return stakeOf(run) >= 7 && n >= VT.callsFrom; }
  // The lights that are out for this run, in order: [{ k, id, name }].
  function lightsOut(run) {
    var out = [], s = stakeOf(run), i;
    for (i = 0; i < s; i++) out.push({ k: i + 1, id: VIGIL[i].id, name: VIGIL[i].name });
    return out;
  }

  function applySpent(fighter, spent) {
    for (var k in spent) if (spent[k]) fighter.counters[k] = 1;
  }
  // Once-per-run effects are remembered on the run, not on the per-duel fighter.
  function syncSpent(run) {
    var s = statsOf(run), d = run.duel, k;
    if (!d) return;
    for (k in d.p.counters) if (k.indexOf('spent_') === 0 && d.p.counters[k]) s.spent.p[k] = 1;
    for (k in d.r.counters) if (k.indexOf('spent_') === 0 && d.r.counters[k]) s.spent.r[k] = 1;
  }
  function syncBleed(run) {
    var s = statsOf(run), d = run.duel;
    if (!d || !d.tally) return;
    var seen = d.tally.bleedCounted || 0;
    if (d.tally.bleedR > seen) { s.bleedDealt += d.tally.bleedR - seen; d.tally.bleedCounted = d.tally.bleedR; }
  }
  function syncCounters(run, meta) {
    var s = statsOf(run), c = meta.counters;
    if (s.bleedDealt > s.bleedSynced) { c.bleedDealt += s.bleedDealt - s.bleedSynced; s.bleedSynced = s.bleedDealt; }
    if (s.drafts > s.draftsSynced) { c.drafts += s.drafts - s.draftsSynced; s.draftsSynced = s.drafts; }
  }

  function startDuel(run) {
    var s = statsOf(run);
    if (run.duelN < 1) run.duelN = 1;
    if (run.duelN > 7) run.duelN = 7;
    var D = cfg(run, { n: run.duelN, phase: 1 });
    var p = R.Combat.newFighter(run.pMaxHp, run.pHp, run.pBoons);
    var r = rivalFighter(run, D);
    applySpent(p, s.spent.p);
    applySpent(r, s.spent.r);
    run.phase = 1;
    run.stage = 'duel';
    run.pending = null;
    run.offer = null;
    run.duel = R.Combat.newDuel(duelOpts(run, D, run.duelN, 1, p, r));
    return run.duel;
  }

  // Close the books on the fight that just ended (a duel, or one phase of duel 7). Idempotent.
  function closeSegment(run, winner) {
    var s = statsOf(run), d = run.duel;
    if (!d || d.closed) return;
    d.closed = true;
    var moves = d.p.moves, turns = moves.length;
    s.duelTurns.push(turns);
    run.pHp = Math.max(0, d.p.hp);
    s.lowHpEnd = isLow(d.p.hp, d.p.maxHp);
    syncSpent(run);
    syncBleed(run);
    if (winner === 'p') {
      if (turns >= 5 && moves.indexOf('G') < 0) s.flags.noGuardDuel = true;
      if (turns >= 5 && moves.indexOf('S') < 0) s.flags.noStrikeDuel = true;
      if (d.n >= 2 && d.tally && d.tally.lostP === 0) s.flags.flawlessDuel = true;
    }
  }

  // Final duel only: the Rival changes into phase k of its face. Keeps the player fighter (boons, counters, charges).
  // opts.rebuild: phase k is rebuilt for a stored run whose duel was dropped (an older duel shape): the player comes
  // back from run.pHp with no second phase heal and no heal event; the Rival's per-duel counters and charges start
  // over, and the seal of the turn in progress is made again.
  function startPhase(run, k, opts) {
    var s = statsOf(run), rebuild = !!(opts && opts.rebuild);
    var old = run.duel;
    run.duelN = 7;
    k = Math.max(2, Math.min(phaseCount(run), Math.floor(num(k, 2))));
    var D = cfg(run, { n: 7, phase: k });
    var p, r;
    if (old) {
      closeSegment(run, 'p');
      p = old.p;
      if (p.hp < 1) p.hp = 1;
    } else {
      p = R.Combat.newFighter(run.pMaxHp, run.pHp, run.pBoons);
      applySpent(p, s.spent.p);
    }
    p.status = { guardBroken: 0, bleed: 0, fortify: 0, focus: 0, sealed: { S: 0, G: 0, F: 0 } };
    p.moves = [];
    p.results = [];
    var healed = rebuild ? 0 : Math.max(0, Math.min(phaseHealOf(run, D), p.maxHp - p.hp));
    p.hp += healed;
    r = rivalFighter(run, D);
    if (old) {                                   // same duel: per-duel caps and charges carry over
      var key;                                   // (not k: that is the phase number)
      for (key in old.r.counters) r.counters[key] = old.r.counters[key];
      for (key in old.r.charges) r.charges[key] = old.r.charges[key];
    }
    applySpent(r, s.spent.r);
    run.phase = k;
    run.stage = 'duel';
    run.pending = null;
    run.pHp = p.hp;
    run.duel = R.Combat.newDuel(duelOpts(run, D, 7, k, p, r));
    if (healed > 0) run.duel.pendingEvents.push({ t: 'heal', side: 'p', n: healed });
    return run.duel;
  }
  function startPhase2(run) { return startPhase(run, 2); }
  function nextPhase(run) { return startPhase(run, (run.phase || 1) + 1); }

  // Per-turn bookkeeping. `sealed` (the Rival's commit) may be null. Returns the §6.6 signals.
  function record(run, meta, result, sealed) {
    meta = repair(meta);
    var s = statsOf(run), c = meta.counters;
    var sig = { read: false, surprised: false, lieCaught: false, lieWorked: false };
    if (!result || !result.pm) return sig;
    var pm = result.pm, d = run.duel;

    s.turns++;
    if (s.moves[pm] !== undefined) s.moves[pm]++;
    meta.memory.totalTurns++;

    var prev = d && d.p.moves.length >= 2 ? d.p.moves[d.p.moves.length - 2] : null;
    if (prev) { s.repeatOpp++; if (prev === pm) s.repeats++; }

    if (result.clash) s.clashes++;
    else if (result.winner === 'p') {
      s.wins++;
      if (result.deathblow) { s.deathblows++; c.deathblows++; }
    } else if (result.winner === 'r') s.losses++;

    if (result.guardBreak === 'p') { s.guardBroken++; c.guardBroken++; }

    if (sealed) {
      var pAct = sealed.pred && typeof sealed.pred[pm] === 'number' ? sealed.pred[pm] : null;
      if (pAct !== null) {
        if (pAct < 0.20) { s.surprises++; sig.surprised = true; }
        if (pAct > 0.60 && result.winner === 'r') { s.reads++; c.reads++; sig.read = true; }
      }
      if (sealed.honest === false) {
        if (result.winner === 'p') { s.liesCaught++; c.liesCaught++; sig.lieCaught = true; }
        else if (result.winner === 'r') { s.liesWorked++; sig.lieWorked = true; }
      }
    }

    s.lastMove = pm;
    if (d) {
      run.pHp = Math.max(0, d.p.hp);
      syncSpent(run);
      syncBleed(run);
    }
    syncCounters(run, meta);
    run.pending = null;
    return sig;
  }

  // ---------------------------------------------------------------- drafting

  function has(arr, id) { return arr.indexOf(id) >= 0; }
  function tagsOf(ids) {
    var t = {}, i, j, b;
    for (i = 0; i < ids.length; i++) {
      b = byId(ids[i]);
      if (b) for (j = 0; j < b.tags.length; j++) t[b.tags[j]] = (t[b.tags[j]] || 0) + 1;
    }
    return t;
  }
  function sharesTag(b, tags) {
    for (var i = 0; i < b.tags.length; i++) if (tags[b.tags[i]]) return true;
    return false;
  }

  // One rarity-weighted draw: roll the rarity among those that still have candidates, then uniform.
  function drawOne(cands, weights, rng) {
    if (!cands.length) return null;
    var buckets = [[], [], []], i, w = [0, 0, 0];
    for (i = 0; i < cands.length; i++) {
      var ri = RARITIES.indexOf(cands[i].rarity);
      buckets[ri < 0 ? 0 : ri].push(cands[i]);
    }
    for (i = 0; i < 3; i++) w[i] = buckets[i].length ? weights[i] : 0;
    return rng.pick(buckets[rng.weighted(w)]);
  }
  function drawN(cands, n, weights, rng, oneActive) {
    var out = [], left = cands.slice(), hasActive = false, b;
    while (out.length < n && left.length) {
      b = drawOne(left, weights, rng);
      out.push(b);
      if (b.active) hasActive = true;
      left = left.filter(function (c) { return c !== b && !(oneActive && hasActive && c.active); });
    }
    return out;
  }

  function statById(dossier, id) {
    var st = dossier && dossier.stats;
    if (!st || !st.length) return null;
    for (var i = 0; i < st.length; i++) if (st[i] && st[i].id === id) return st[i];
    return null;
  }

  // What the Rival knows that is relevant to drafting. `dossier` may be null.
  function evidence(run, dossier) {
    var s = statsOf(run), m = s.moves, n = m.S + m.G + m.F;
    var fav = null, st;
    if (dossier) {
      st = statById(dossier, 'fav_move');
      fav = dossier.favorite || (st && st.strength > 0 ? st.move : null) || null;
    }
    var repeatPct = null;
    st = statById(dossier, 'repeat');
    if (st && typeof st.pct === 'number') repeatPct = st.pct;
    else if (s.repeatOpp >= 8) repeatPct = 100 * s.repeats / s.repeatOpp;   // fallback: this run only

    var pred = typeof s.score === 'number' ? s.score : (dossier && typeof dossier.predictability === 'number' ? dossier.predictability : null);

    var trust = null;
    st = statById(dossier, 'tell_trust');
    if (st && typeof st.pct === 'number') trust = st.pct;
    else if (dossier && dossier.tell && dossier.tell.n >= 15) {
      var tl = dossier.tell, sum = num(tl.counter, 0) + num(tl.mirror, 0) + num(tl.under, 0);
      if (sum > 0) trust = 100 * num(tl.counter, 0) / sum;
    }
    return {
      G: (n > 0 && m.G / n >= SHARE_G) || fav === 'G',
      S: (n > 0 && m.S / n >= SHARE_S) || fav === 'S',
      F: (n > 0 && m.F / n >= SHARE_F) || fav === 'F',
      repeat: repeatPct !== null && repeatPct >= REPEAT_PCT,
      predictable: pred !== null && pred >= PREDICTABLE,
      trust: trust !== null && (trust >= TRUST_HI || trust <= TRUST_LO),
      tags: tagsOf(run.pBoons),
      lowHp: !!s.lowHpEnd
    };
  }

  // [evidence key, rivalWhy value (null = not nameable), { boonId: multiplier }]
  var COUNTERS = [
    ['G', 'G', { turtle_cracker: 4, long_con: 3, paper_cuts: 2, debt_collector: 2 }],
    ['S', 'S', { thorned_guard: 4, coiled_riposte: 2.5, stone_patience: 2, mourning_veil: 2 }],
    ['F', 'F', { serrated_edge: 3, iron_oath: 4, first_blood: 2, headsman: 2 }],
    ['repeat', 'repeat', { no_encores: 4, sealing_wax: 2.5 }],
    ['predictable', 'predictable', { hungry_mask: 4 }],
    ['trust', 'trust', { painted_smile: 3 }],
    ['TEN', 'tags', { ash_veil: 3, deathblow_creed: 2 }],
    ['TRK', 'tags', { iron_oath: 4 }],
    ['BLD', 'tags', { carrion_comfort: 0.5, vampires_curtsy: 2 }],
    ['RIP', 'tags', { turtle_cracker: 3, long_con: 2 }],
    ['lowHp', null, { headsman: 3, salt_the_wound: 1.5 }]
  ];

  function counterFor(id, ev) {
    var mult = 1, why = null, best = 0, i, row, on, m;
    for (i = 0; i < COUNTERS.length; i++) {
      row = COUNTERS[i];
      m = row[2][id];
      if (!m) continue;
      on = row[1] === 'tags' ? (ev.tags[row[0]] || 0) >= 2 : !!ev[row[0]];
      if (!on) continue;
      mult *= m;
      if (row[1] && m > best) { best = m; why = row[1]; }
    }
    if (mult > COUNTER_CAP) mult = COUNTER_CAP;
    return { mult: mult, why: why };
  }

  function rivalDraft(run, meta, dossier, rng) {
    var bonfire = run.duelN;
    var weights = RARITY_WEIGHTS[bonfire] || RARITY_WEIGHTS[6];
    var avail = pool(meta, 'r').filter(function (b) {
      if (has(run.rBoons, b.id) || has(run.pBoons, b.id)) return false;
      if (b.id === 'spare_mask' && bonfire >= 6) return false;      // cannot trigger in duel 7
      return true;
    });
    var cands = drawN(avail, RIVAL_CANDIDATES, weights, rng, false);
    if (!cands.length) return { id: null, why: null };
    var ev = evidence(run, dossier), own = tagsOf(run.rBoons);
    var w = [], cs = [], i, c;
    for (i = 0; i < cands.length; i++) {
      c = counterFor(cands[i].id, ev);
      cs.push(c);
      w.push(1 * c.mult * (sharesTag(cands[i], own) ? SYNERGY : 1) * rng.range(JITTER_LO, JITTER_HI));
    }
    i = rng.weighted(w);
    return { id: cands[i].id, why: cs[i].mult >= WHY_THRESHOLD ? cs[i].why : null, counter: cs[i].mult };
  }

  function buildChoices(run, meta, rng) {
    var bonfire = run.duelN, i, b;
    var weights = RARITY_WEIGHTS[bonfire] || RARITY_WEIGHTS[6];
    var x = { run: run, side: 'p', size: OFFER_SIZE, events: [] };
    for (i = 0; i < run.pBoons.length; i++) {
      b = byId(run.pBoons[i]);
      if (b && b.hooks.onDraft) b.hooks.onDraft(x);
    }
    var avail = pool(meta, 'p').filter(function (c) { return !has(run.pBoons, c.id) && !has(run.rBoons, c.id); });
    var out = drawN(avail, x.size, weights, rng, true);
    // From bonfire 2: at least one choice shares a tag with something the player owns
    if (bonfire >= 2 && out.length) {
      var own = tagsOf(run.pBoons), any = false;
      for (i = 0; i < out.length; i++) if (sharesTag(out[i], own)) any = true;
      if (!any) {
        var keep = out.slice(0, out.length - 1);
        var keepActive = keep.some(function (c) { return !!c.active; });
        var cands = avail.filter(function (c) {
          return sharesTag(c, own) && keep.indexOf(c) < 0 && !(keepActive && c.active);
        });
        b = drawOne(cands, weights, rng);
        if (b) out[out.length - 1] = b;
      }
    }
    return out.map(function (c) { return c.id; });
  }

  // winner 'p': heal + Rival's pick + offer (stage 'bonfire'), or stage 'won' after phase 2.
  // winner 'r': stage 'dead'. Duel 7 phase 1 won: the run stays in stage 'duel' — call startPhase2.
  function endDuel(run, meta, winner, dossier) {
    meta = repair(meta);
    var s = statsOf(run), i, b;
    closeSegment(run, winner);
    syncCounters(run, meta);
    run.pending = null;
    if (winner !== 'p') { run.stage = 'dead'; run.offer = null; return null; }
    if (run.duelN >= 7) {
      if (run.phase >= phaseCount(run)) run.stage = 'won';
      else { run.stage = 'duel'; s.flags.phase1Won = true; }
      run.offer = null;
      return null;
    }
    if (run.stage === 'bonfire' && run.offer) return run.offer;      // already built (double call)

    // 1. rest
    var x = {
      run: run, side: 'p', self: { hp: run.pHp, maxHp: run.pMaxHp },
      low: isLow(run.pHp, run.pMaxHp), heal: healOf(run), events: []
    };
    for (i = 0; i < run.pBoons.length; i++) {
      b = byId(run.pBoons[i]);
      if (b && b.hooks.onRest) b.hooks.onRest(x);
    }
    var healed = Math.max(0, Math.min(Math.floor(num(x.heal, 0)), run.pMaxHp - run.pHp));
    run.pHp += healed;

    // 2. the Rival drafts first, 3. the player's choices
    var rng = rngOf(run);
    var pick = rivalDraft(run, meta, dossier || null, rng);
    if (pick.id) run.rBoons.push(pick.id);
    var choices = buildChoices(run, meta, rng);
    run.rngState = rng.state();

    run.offer = {
      rivalPick: pick.id, rivalWhy: pick.why, choices: choices, healed: healed,
      events: x.events,                    // extra: onRest events ({t:'boon'}, {t:'forget', n:0.5})
      bonfire: run.duelN                   // extra: bonfire number 1..6
    };
    run.stage = 'bonfire';
    return run.offer;
  }

  // The player drafts. `meta` is optional (contract signature is pick(run, boonId)); when given,
  // the lifetime draft counter is updated at once, otherwise at the next record/endDuel/finish.
  function pick(run, boonId, meta) {
    var s = statsOf(run);
    if (run.stage !== 'bonfire' || !run.offer) return false;
    var ch = run.offer.choices || [];
    if (ch.length) {
      if (ch.indexOf(boonId) < 0) return false;
      run.pBoons.push(boonId);
      s.drafts++;
    }
    if (meta) syncCounters(run, repair(meta));
    run.offer = null;
    run.duel = null;
    run.pending = null;
    run.duelN++;
    run.phase = 1;
    run.stage = 'duel';
    return true;
  }

  // ---------------------------------------------------------------- unlocks

  var UNLOCKS = [];
  function unlock(id, type, ref, name, how, check) {
    UNLOCKS.push({ id: id, type: type, ref: ref, name: name, how: how, check: check });
  }
  function boonName(id) { var b = byId(id); return b ? b.name : id; }
  function mem(meta) { return meta.memory; }

  (function () {
    var c;
    unlock('first_death', 'relic', 'relic_ashen_flask', boonName('relic_ashen_flask'), 'Die once.',
      function (m) { return mem(m).deaths >= 1; });
    unlock('die_5', 'boon', 'last_candle', boonName('last_candle'), 'Die 5 times.',
      function (m) { return mem(m).deaths >= 5; });
    unlock('die_15', 'mask', 'mourner', 'The Mourner', 'Die 15 times.',
      function (m) { return mem(m).deaths >= 15; });
    unlock('die_duel1', 'mask', 'jester', 'The Jester', 'Die in duel 1 (run 2 or later).',
      function (m, run, o) { return !!o.died && run.duelN === 1 && mem(m).runs >= 2; });
    unlock('lose_3_row', 'relic', 'relic_rusty_nail', boonName('relic_rusty_nail'), 'Lose 3 runs in a row.',
      function (m) { return mem(m).streakL >= 3; });
    unlock('reach_3', 'relic', 'relic_dented_buckler', boonName('relic_dented_buckler'), 'Reach duel 3.',
      function (m) { return mem(m).bestDuel >= 3; });
    c = function (m) { return mem(m).bestDuel >= 5; };
    unlock('reach_5', 'boon', 'iron_oath', boonName('iron_oath'), 'Reach duel 5.', c);
    unlock('reach_5', 'boon', 'ash_veil', boonName('ash_veil'), 'Reach duel 5.', c);
    c = function (m) { return mem(m).bestDuel >= 7; };
    unlock('reach_7', 'boon', 'deathblow_creed', boonName('deathblow_creed'), 'Reach duel 7.', c);
    unlock('reach_7', 'boon', 'stolen_ledger', boonName('stolen_ledger'), 'Reach duel 7.', c);
    c = function (m) { return mem(m).wins >= 1; };
    unlock('first_win', 'boon', 'headsman', boonName('headsman'), 'Beat the Unmasked.', c);
    unlock('first_win', 'boon', 'spare_mask', boonName('spare_mask'), 'Beat the Unmasked.', c);
    unlock('win_2', 'mask', 'kintsugi', 'Kintsugi', 'Beat the Unmasked twice.',
      function (m) { return mem(m).wins >= 2; });
    unlock('win_3', 'arena', 'pale_dawn', 'Pale Dawn', 'Beat the Unmasked three times.',
      function (m) { return mem(m).wins >= 3; });
    c = function (m, run) { return !!(run && run.stats && run.stats.flags && run.stats.flags.noGuardDuel); };
    unlock('no_guard_duel', 'boon', 'long_con', boonName('long_con'), 'Win a duel of 5+ turns without Guard.', c);
    unlock('no_guard_duel', 'boon', 'debt_collector', boonName('debt_collector'), 'Win a duel of 5+ turns without Guard.', c);
    unlock('no_strike_duel', 'boon', 'turtle_cracker', boonName('turtle_cracker'), 'Win a duel of 5+ turns without Strike.',
      function (m, run) { return !!(run && run.stats && run.stats.flags && run.stats.flags.noStrikeDuel); });
    unlock('flawless_duel', 'boon', 'keyhole', boonName('keyhole'), 'Win duel 2 or later without losing HP.',
      function (m, run) { return !!(run && run.stats && run.stats.flags && run.stats.flags.flawlessDuel); });
    unlock('deathblows_5', 'relic', 'relic_cracked_mirror', boonName('relic_cracked_mirror'), 'Win 5 exchanges at 3 tension pips.',
      function (m) { return m.counters.deathblows >= 5; });
    unlock('bleed_20', 'boon', 'carrion_comfort', boonName('carrion_comfort'), 'Deal 20 bleed damage.',
      function (m) { return m.counters.bleedDealt >= 20; });
    c = function (m, run, o) { return typeof o.score === 'number' && o.duel >= 4 && o.score < 35; };
    unlock('ghost_run', 'boon', 'broken_pattern', boonName('broken_pattern'), 'End a run at duel 4+ with predictability under 35.', c);
    unlock('ghost_run', 'boon', 'ash_of_forgetting', boonName('ash_of_forgetting'), 'End a run at duel 4+ with predictability under 35.', c);
    unlock('ghost_win', 'mask', 'blank', 'The Blank', 'Beat the Unmasked with predictability under 40.',
      function (m, run, o) { return !!o.won && typeof o.score === 'number' && o.score < 40; });
    unlock('read_25', 'boon', 'hungry_mask', boonName('hungry_mask'), 'Get read 25 times.',
      function (m) { return m.counters.reads >= 25; });
    unlock('broken_15', 'boon', 'sealing_wax', boonName('sealing_wax'), 'Have your guard broken 15 times.',
      function (m) { return m.counters.guardBroken >= 15; });
    unlock('drafts_12', 'relic', 'relic_dealers_thumb', boonName('relic_dealers_thumb'), 'Draft 12 boons.',
      function (m) { return m.counters.drafts >= 12; });
    unlock('lies_15', 'relic', 'relic_liars_coin', boonName('relic_liars_coin'), 'Win 15 exchanges against a lying stance.',
      function (m) { return m.counters.liesCaught >= 15; });
    unlock('runs_10', 'arena', 'blood_moon', 'Blood Moon', 'Start 10 runs.',
      function (m) { return mem(m).runs >= 10; });
  })();

  function entriesFor(ids) {
    return UNLOCKS.filter(function (u) { return ids.indexOf(u.id) >= 0; });
  }

  // End of run (stage 'won' or 'dead'; any other stage counts as an abandoned run).
  // The caller sets run.stats.score = brain.runScore() first. Safe to call twice.
  function finish(run, meta, now) {
    meta = repair(meta);
    var s = statsOf(run), m = meta.memory, i, u;
    if (run.finished) return { unlocks: entriesFor(run.finished.unlocks || []), firstWin: !!run.finished.firstWin, light: run.finished.light || 0, face: run.finished.face || null };
    now = num(now, m.lastPlayed);

    closeSegment(run, run.stage === 'won' ? 'p' : (run.stage === 'dead' ? 'r' : null));
    syncCounters(run, meta);

    var won = run.stage === 'won', died = run.stage === 'dead';
    var reached = Math.min(8, Math.max(1, run.duelN + (run.duelN >= 7 && run.phase >= 2 ? 1 : 0)));
    var score = typeof s.score === 'number' && s.score === s.score ? s.score : undefined;
    var outcome = { won: won, died: died, duel: reached, score: score };

    if (reached > m.bestDuel) m.bestDuel = reached;
    if (won) {
      m.wins++;
      m.streakW++;
      m.streakL = 0;
      m.lastWin = { move: s.lastMove, hp: run.pHp, run: num(run.runNo, m.runs), ts: now };
    } else if (died) {
      m.deaths++;
      m.streakL++;
      m.streakW = 0;
      var rivalHp = run.duel && run.duel.r ? Math.max(0, run.duel.r.hp) : null;
      if (rivalHp !== null) {
        var cl = m.closestLoss;
        if (!cl || rivalHp < cl.rivalHp || (rivalHp === cl.rivalHp && reached >= cl.duel)) m.closestLoss = { duel: reached, rivalHp: rivalHp };
      }
      if (!m.fastestDeath || s.turns < m.fastestDeath.turns) m.fastestDeath = { duel: reached, turns: s.turns };
    }
    if (s.turns > 0) {
      var fav = 'S';
      if (s.moves.G > s.moves[fav]) fav = 'G';
      if (s.moves.F > s.moves[fav]) fav = 'F';
      m.lastFavorite = fav;
      m.favorites.push(fav);
      while (m.favorites.length > 10) m.favorites.shift();
    }
    if (now > m.lastPlayed) m.lastPlayed = now;
    if (!m.firstPlayed) m.firstPlayed = now;

    var ids = [];
    for (i = 0; i < UNLOCKS.length; i++) {
      u = UNLOCKS[i];
      if (meta.unlocked[u.id] || ids.indexOf(u.id) >= 0) continue;
      var ok = false;
      try { ok = !!u.check(meta, run, outcome); } catch (e) { ok = false; }
      if (ok) ids.push(u.id);
    }
    for (i = 0; i < ids.length; i++) meta.unlocked[ids[i]] = true;

    // The Vigil: a win with every earned light out earns the next one. light = its number (1..7), or 0.
    var light = 0, vg = meta.vigil, st = stakeOf(run);
    if (won) {
      vg.wins[st]++;
      if (st >= vg.max && vg.max < VIGIL_MAX) { vg.max = st + 1; light = vg.max; vg.hi = Math.max(hiOf(vg.hi), vg.max); }
    }

    // The faces: beating the newest earned face earns the next. face = its id, or null.
    var face = null, bs = meta.bosses, bx = bossIndex(bossOf(run).id);
    if (won) {
      bs.wins[BOSSES[bx].id] = num(bs.wins[BOSSES[bx].id], 0) + 1;
      if (bx === bs.max - 1 && bs.max < BOSSES.length) { bs.max++; face = BOSSES[bs.max - 1].id; bs.hi = Math.max(hiOf(bs.hi), bs.max); }
    }

    var firstWin = won && m.wins === 1;
    run.finished = { unlocks: ids, firstWin: firstWin, outcome: outcome, light: light, face: face };
    return { unlocks: entriesFor(ids), firstWin: firstWin, light: light, face: face };
  }

  R.Run = {
    PLAYER_MAX_HP: PLAYER_MAX_HP,
    HEAL: HEAL,
    PHASE2_HEAL: PHASE2_HEAL,
    DUELS: DUELS,
    UNLOCKS: UNLOCKS,
    VIGIL: VIGIL,
    BOSSES: BOSSES,
    RULES: RULES,
    bossIndex: bossIndex,
    bossOf: bossOf,
    phaseCount: phaseCount,
    reqOf: reqOf,
    repairRun: repairRun,
    startPhase: startPhase,
    nextPhase: nextPhase,
    VIGIL_TUNE: VT,
    cfg: cfg,
    healOf: healOf,
    stakeOf: stakeOf,
    lightsOut: lightsOut,
    RARITY_WEIGHTS: RARITY_WEIGHTS,
    defaultMeta: defaultMeta,
    repairMeta: repair,
    relics: relics,
    pool: pool,
    create: create,
    startDuel: startDuel,
    startPhase2: startPhase2,
    record: record,
    endDuel: endDuel,
    pick: pick,
    finish: finish
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
