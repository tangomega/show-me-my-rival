#!/usr/bin/env node
// SHOW ME MY RIVAL - turn-by-turn text client for persona playtests.
//
// Loads the repo's own game modules from src/ in place (never a copy), in build order (tools/build.js ORDER):
// core/rng, the art and text tables, ai/brain, game/boons, game/combat, game/run, then scenes/_common.js for
// R.SceneKit. It replays the call order of scenes/duel.js turn(), the bonfire, death, victory, credits, relic,
// title, dossier and unlocks scenes, and the R.Game flow of main.js. Scene logic is mirrored line for line;
// tools/playtest/mirror.json pins the source of every src function it mirrors, small helpers included (the MIRROR list
// below), and the self-test fails when one changes. Requiring this file runs no command and leaves the RIVAL globals
// as they were: the client's R.Game and R.Text.taunt are installed only while exec() or selftest() runs.
// One process per command. Each profile lives in <profiles>/<name>/: save.json (the client never calls R.Save)
// and transcript.md (every command and its output).
//
// Fairness: the Rival's commit is made and SAVED TO DISK before the input screen is printed. The move command
// reads it back from disk; nothing the player types reaches brain.commit. Screens are built from public state and
// read run.pending.sealed only for what owned boons and relics reveal in the real game.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const SRC = path.join(REPO, 'src');
const DEFAULT_PROFILES = path.join(HERE, 'profiles');
const MIRROR_FILE = path.join(HERE, 'mirror.json');
const ENV_PROFILES = 'RIVAL_PLAYTEST_PROFILES';      // profiles root override (inherited by child processes)
const ENV_ENTROPY = 'RIVAL_PLAYTEST_ENTROPY';        // test only: profile entropy from this seed instead of the OS
const CMD = 'node tools/playtest/play.js';

globalThis.RIVAL = globalThis.RIVAL || {};
// The pure modules in build order, then the scene kit. Never core/save, core/engine, the other scenes or main.js.
const LOAD = ['core/rng', 'art/palette', 'art/pix', 'art/font', 'text/strings', 'text/taunts', 'text/dossier',
              'ai/brain', 'game/boons', 'game/combat', 'game/run', 'scenes/_common'];
LOAD.forEach(function (f) { require(path.join(SRC, f + '.js')); });
const R = globalThis.RIVAL;
const C = R.Combat, RUN = R.Run, T = R.Text, K = R.SceneKit;
const MOVES = ['S', 'G', 'F'];
const MNAME = { S: 'Strike', G: 'Guard', F: 'Feint' };

const CLOCK0 = 1.7e12;            // virtual clock start (ms)
const TURN_MS = 3000;             // a few seconds per turn
const DRAFT_MS = 20000;           // a bonfire choice
const RUN_GAP_MS = 600000;        // ten minutes between runs
const OPLOG_COMPACT = 400;        // brain ops kept for an exact live session; at a new run beyond this the app "restarts"

function lf(s) { return String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n'); }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function listFiles(dir, skip) {
  const found = [];
  (function walk(d, rel) {
    let names = [];
    try { names = fs.readdirSync(d).sort(); } catch (e) { return; }
    for (const n of names) {
      const full = path.join(d, n), r = rel ? rel + '/' + n : n;
      if (skip && skip(full, r)) continue;
      let st = null;
      try { st = fs.statSync(full); } catch (e) { continue; }
      if (st.isDirectory()) walk(full, r);
      else found.push(r);
    }
  })(dir, '');
  return found;
}
// SHA-256 of a source tree with LF line endings, so a transcript can be tied to a commit.
function treeHash(dir, skip) {
  const h = crypto.createHash('sha256');
  for (const f of listFiles(dir, skip)) { h.update(f + '\n'); h.update(lf(fs.readFileSync(path.join(dir, f), 'utf8'))); h.update('\n\0'); }
  return h.digest('hex');
}
const SRC_HASH = treeHash(SRC);

// ------------------------------------------------------------------ module-level session (one per command)
let P = null;          // profile name
let ST = null;         // the persisted profile state (JSON)
let G = null;          // R.Game-like live objects { brain, meta, run, rng, crng, days, last }
let OUT = [];          // output lines of this command
let SAY = [];          // what the Rival said during this command (for the bonfire `show`)
let QUIET = false;     // no transcript
let CALL_ROOT = null;  // --profiles of this command
let ROOT_OVERRIDE = null;                       // set by the self-test
let ENTROPY_SEED = process.env[ENV_ENTROPY] ? String(process.env[ENV_ENTROPY]) : null;
let TRACE = null;      // self-test only: the seal-before-print trace

function out(s) { OUT.push(s === undefined ? '' : String(s)); }
function fail(msg) { const e = new Error(msg); e.user = true; throw e; }

// ------------------------------------------------------------------ helpers (R.SceneKit where it loads; the rest as the scenes write them)
const ui = K.ui, kfill = K.fill, wrapText = K.wrap;
function mname(m) { return T.move ? T.move(m) : MNAME[m]; }
function boonName(id) { const t = T.boon && T.boon[id]; if (t && t.name) return t.name; const b = R.Boons.byId[id]; return b ? b.name : id; }
function low(f) { return f.hp > 0 && f.hp <= Math.ceil(f.maxHp / 3); }
function hasEv(list, t) { for (let i = 0; i < list.length; i++) if (list[i].t === t) return list[i]; return null; }
function argmaxMove(pred, legal) { let best = legal[0]; for (let i = 1; i < legal.length; i++) if (pred[legal[i]] > pred[best]) best = legal[i]; return best; }
function bubble(text) { return wrapText(text, 160, 3).join(' '); }          // say(): 160 px, 3 lines (the rest is dropped)
function boonInfo(id) { const x = K.boonInfo(id), b = R.Boons.byId[id]; x.active = b && b.active ? b.active : null; return x; }
function boonLine(id, indent) {
  const x = boonInfo(id);
  return (indent || '') + x.name + ' [' + x.id + '] (' + x.tagLine + (x.active ? ' · ACTIVE x' + x.active.charges + '/duel' : '') + ') - ' + x.desc +
    (x.flavor ? '  "' + x.flavor + '"' : '');
}
function faceName(id) { const tb = (T.bosses || {})[id]; return (tb && tb.name) || (RUN.BOSSES.filter(function (b) { return b.id === id; })[0] || {}).name || id; }
function keyOf(p) { return p ? p.n + '/' + p.phase + '/' + p.turn : '-'; }

// ------------------------------------------------------------------ taunts: the real R.Text.taunt algorithm (text/taunts.js), with its
// session-only shuffle bags kept in the profile (cleared on reload, as a page load clears them).
const clientTaunt = (function () {
  function freshOrder(n, rng) {
    const order = []; let i, j, t;
    for (i = 0; i < n; i++) order.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(rng.next() * (i + 1)); if (!(j >= 0 && j <= i)) j = i; t = order[i]; order[i] = order[j]; order[j] = t; }
    return order;
  }
  function draw(list, bag, vars, skip) {
    for (let i = 0; i < bag.order.length; i++) {
      const idx = bag.order[i];
      if (idx === skip) continue;
      const s = T.fill(list[idx], vars);
      if (s !== null) { bag.order.splice(i, 1); bag.last = idx; return s; }
    }
    return null;
  }
  return function bagTaunt(category, vars, rng) {
    const list = T.taunts ? T.taunts[category] : null;
    if (!Array.isArray(list) || list.length === 0) return null;
    const r = rng && typeof rng.next === 'function' ? rng : G.crng;
    const bags = ST.client.bags;
    let bag = bags[category];
    if (!bag || bag.n !== list.length) bag = bags[category] = { n: list.length, order: freshOrder(list.length, r), last: -1 };
    let s = draw(list, bag, vars, -1);
    if (s !== null) return s;
    bag.order = freshOrder(list.length, r);
    s = draw(list, bag, vars, bag.last);
    if (s !== null) return s;
    return draw(list, bag, vars, -1);
  };
})();
// R.SceneKit.taunt reads R.Game.vars and R.Game.crng, as the scenes do. The client's R.Game and R.Text.taunt are
// installed only while a command or the self-test runs, and the previous values come back afterwards, so requiring
// this file leaves the shared RIVAL globals as they were (other suites may load src in the same process).
const CLIENT_GAME = { vars: function (extra) { return vars(extra); }, get crng() { return G ? G.crng : null; } };
let installed = 0, before = null;
function withClient(fn) {
  if (installed++ === 0) {
    before = { hadGame: Object.prototype.hasOwnProperty.call(R, 'Game'), game: R.Game, taunt: T.taunt };
    R.Game = CLIENT_GAME; T.taunt = clientTaunt;
  }
  try { return fn(); } finally {
    if (--installed === 0) {
      if (before.hadGame) R.Game = before.game; else delete R.Game;
      T.taunt = before.taunt; before = null;
    }
  }
}

// R.Game.vars (main.js)
function vars(extra) {
  const m = G.meta.memory, run = G.run, d = run && run.duel, L = G.last;
  const v = {
    runs: m.runs, deaths: m.deaths, wins: m.wins, bestDuel: m.bestDuel,
    streak: Math.max(m.streakL || 0, m.streakW || 0),
    duel: run ? run.duelN : (L ? L.duel : 1),
    turns: run ? run.stats.turns : (L ? L.turns : 0),
    score: run ? G.brain.runScore() : (L ? L.score : 0)
  };
  if (v.score < 45) delete v.score;
  if (G.days > 0) v.days = G.days;
  if (d) { v.hp = d.p.hp; v.rivalHp = d.r.hp; }
  else if (L) { v.hp = L.hp; v.rivalHp = L.rivalHp; }
  if (m.lastWin && m.lastWin.move) { v.lastWinMove = T.move(m.lastWin.move); v.lastWinHp = m.lastWin.hp; }
  if (extra) for (const k in extra) if (extra[k] !== undefined && extra[k] !== null) v[k] = extra[k];
  return v;
}
function taunt(cat, extra) { return K.taunt(cat, extra); }
function speak(text, tag) {           // the Rival says something (a bubble): truncated as the 3-line bubble is
  if (!text) return false;
  const s = bubble(text);
  out('IT' + (tag ? ' (' + tag + ')' : '') + ': "' + s + '"');
  SAY.push(s);
  if (ST.client.S) ST.client.S.silent = 0;
  return true;
}

// ------------------------------------------------------------------ profile state
function profilesRoot() { return CALL_ROOT || ROOT_OVERRIDE || (process.env[ENV_PROFILES] ? path.resolve(process.env[ENV_PROFILES]) : DEFAULT_PROFILES); }
function profileDir(name) { return path.join(profilesRoot(), name); }
function freshSeed() {
  const c = ST.client;
  c.seedCtr = (c.seedCtr || 0) + 1;
  const h = crypto.createHash('sha256').update(String(c.entropy) + '|' + c.seedCtr + '|' + c.clock).digest();
  return (h.readUInt32LE(0) >>> 0) || 1;
}
function entropyFor(name) {
  if (ENTROPY_SEED !== null) return crypto.createHash('sha256').update(ENTROPY_SEED + '|' + name).digest().readUInt32LE(0);
  return crypto.randomBytes(4).readUInt32LE(0);
}
function newState(name, entropy) {
  return {
    v: 1, profile: name, opts: { unlocks: 'natural' },
    brainBase: null, brainOps: [], meta: RUN.defaultMeta(), run: null,
    client: { clock: CLOCK0, entropy: entropy, seedCtr: 0, rng: 1, crng: 1, bags: {}, scene: 'title', S: null, last: null,
              relicPending: null, booted: false, srcHash: SRC_HASH }
  };
}
function wrapBrain(b, ops) {
  return Object.assign({}, b, {
    observe: function (ctx, tell, pm, rm) { ops.push(['o', JSON.parse(JSON.stringify(ctx)), tell, pm, rm]); return b.observe(ctx, tell, pm, rm); },
    beginRun: function (o) { ops.push(['b', JSON.parse(JSON.stringify(o || {}))]); return b.beginRun(o); },
    forget: function (f) { ops.push(['f', f]); return b.forget(f); }
  });
}
// brainBase + the op log replayed: the exact live brain of this session (the save keeps the rounded serialize() too)
function rebuildBrain(base, ops) {
  const b = R.Brain.create(base || null);
  for (const op of ops) {
    if (op[0] === 'o') b.observe(op[1], op[2], op[3], op[4]);
    else if (op[0] === 'b') b.beginRun(op[1]);
    else if (op[0] === 'f') b.forget(op[1]);
  }
  return b;
}
function loadBrain() { return wrapBrain(rebuildBrain(ST.brainBase, ST.brainOps), ST.brainOps); }
function open(name, create) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(name || '')) fail(name ? 'Profile names use letters, digits, - and _ (max 40). Got: ' + name : 'Give a profile name (letters, digits, - and _, max 40).');
  P = name;
  const f = path.join(profileDir(name), 'save.json');
  if (fs.existsSync(f)) ST = JSON.parse(fs.readFileSync(f, 'utf8'));
  else if (create) ST = newState(name, entropyFor(name));
  else fail('No profile "' + name + '". Start one with: ' + CMD + ' new ' + name);
  ST.meta = RUN.repairMeta(ST.meta);
  G = { brain: loadBrain(), meta: ST.meta, run: ST.run, rng: R.RNG.create(1), crng: R.RNG.create(1), days: 0, last: ST.client.last };
  G.rng.setState(ST.client.rng); G.crng.setState(ST.client.crng);
  G.days = G.run ? (G.run.daysAway || 0) : (ST.client.days || 0);
  if (ST.client.srcHash && ST.client.srcHash !== SRC_HASH) out('[note] the game source changed since this profile\'s last command.');
  ST.client.srcHash = SRC_HASH;
  if (!ST.client.booted) boot(true);
}
function save() {
  ST.meta = G.meta; ST.run = G.run; ST.client.last = G.last;
  ST.client.rng = G.rng.state(); ST.client.crng = G.crng.state(); ST.client.days = G.days;
  ST.client.brainSave = G.brain.serialize();          // what the real game stores (rounded); a reload boots from it
  const dir = profileDir(P);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'save.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(ST));
  fs.renameSync(tmp, path.join(dir, 'save.json'));
}
// main.js boot(): brain from the save, a fresh seed for the gameplay and cosmetic streams, run validated.
function boot(first) {
  const c = ST.client;
  if (!first) { ST.brainBase = G.brain.serialize(); ST.brainOps = []; G.brain = loadBrain(); }
  const seed = freshSeed();
  G.rng = R.RNG.create(seed);
  G.crng = R.RNG.create(seed ^ 0x2545f491);
  c.bags = {};
  G.run = validRun(G.run) ? G.run : null;
  G.days = G.run ? (G.run.daysAway || 0) : 0;
  G.last = null;
  c.S = null;
  c.booted = true;
}
// main.js validRun
function validRun(run) {
  if (!(run && typeof run === 'object' && run.stats && typeof run.stats === 'object' && Array.isArray(run.pBoons) && Array.isArray(run.rBoons))) return false;
  if (run.stage !== 'duel' && run.stage !== 'bonfire') return false;
  if (!(run.duelN >= 1 && run.duelN <= 7 && run.pHp >= 0 && run.pMaxHp >= 1)) return false;
  if (run.stage === 'bonfire' && !(run.offer && Array.isArray(run.offer.choices))) return false;
  const d = run.duel, q = run.pending && run.pending.sealed;
  if (d && !(d.turn >= 1 && d.tally && d.p && d.r && d.p.status && d.r.status && d.p.status.sealed && d.r.status.sealed &&
             d.p.counters && d.r.counters && d.p.charges && d.r.charges && Array.isArray(d.p.moves) && Array.isArray(d.r.moves) &&
             Array.isArray(d.p.results) && Array.isArray(d.r.results) && Array.isArray(d.p.boons) && Array.isArray(d.r.boons))) {
    run.duel = null; run.pending = null;
  }
  if (run.pending && !(q && q.pred && typeof q.move === 'string' && typeof q.tell === 'string')) run.pending = null;
  return true;
}
function hasRun() { return !!(G.run && (G.run.stage === 'duel' || G.run.stage === 'bonfire')); }

// ------------------------------------------------------------------ R.Game flow (main.js)
function nextGoal() {
  const U = RUN.UNLOCKS, un = G.meta.unlocked || {};
  for (let i = 0; i < U.length; i++) {
    if (un[U[i].id]) continue;
    const t = T.unlock && T.unlock[U[i].id];
    return { id: U[i].id, name: U[i].name, how: (t && t.how) || U[i].how };
  }
  return null;
}
function newRun(relicId, o) {
  o = o || {};
  const t = ST.client.clock, seed = o.seed !== undefined ? (o.seed >>> 0) : freshSeed();
  const vg = RUN.repairMeta(G.meta).vigil, all = ST.opts.unlocks === 'all';
  const stake = all ? (ST.opts.stakeAll | 0) : Math.min(vg.sel, vg.max);
  G.run = RUN.create(G.meta, { seed: seed, relicId: relicId || null, now: t, stake: stake, anyStake: all,
                               boss: o.boss || undefined, anyBoss: !!o.boss, dossier: G.brain.dossier() });
  G.days = G.run.daysAway || 0;
  G.brain.beginRun({ days: G.days });
  G.rng = R.RNG.create(seed ^ 0x5bd1e995);
  G.last = null;
  const notes = [];
  if (o.seed !== undefined) notes.push('seed ' + seed + ' (test option)');
  if (o.boss) notes.push('face forced to ' + faceName(G.run.boss) + ' (test option)');
  if (all) notes.push('all unlocks (test option)');
  out('[client] game source ' + SRC_HASH.slice(0, 16));
  if (notes.length) out('[test] ' + notes.join('; '));
  if (o.start7) start7();
  go('duel');
}
// --start 7: a fixed arrival policy (test shortcut): six bonfires are played by the real endDuel/pick
// (the Rival drafts as usual from its dossier, the player always takes the first card), then HP is set to 17.
function start7() {
  const run = G.run, s = run.stats, taken = [], its = [];
  for (let b = 1; b <= 6; b++) {
    run.duelN = b; run.stage = 'duel'; run.duel = null;
    const off = RUN.endDuel(run, G.meta, 'p', G.brain.dossier());
    for (const e of off.events || []) if (e.t === 'forget') G.brain.forget(e.n || 0.5);
    if (off.rivalPick) its.push(boonName(off.rivalPick));
    const id = off.choices[0];
    if (id) taken.push(boonName(id));
    RUN.pick(run, id);
  }
  s.draftsSynced = s.drafts;                      // the shortcut's drafts do not count toward lifetime unlocks
  run.pHp = Math.min(run.pMaxHp, 17);
  out('[test shortcut --start 7] This run starts at duel 7. Arrival by a fixed policy: six bonfires drafted by the real rules,');
  out('  you took the first card each time (' + (taken.join(', ') || 'none') + '); it drafted ' + (its.join(', ') || 'nothing') + '.');
  out('  Your HP is set to ' + run.pHp + '/' + run.pMaxHp + '. The run still counts toward this profile (runs, deaths, best duel, unlocks).');
}
function resume() {
  const run = G.run;
  if (!run) { go('title'); return; }
  G.days = run.daysAway || 0;
  if (run.stage === 'bonfire' && run.offer) { go('bonfire'); return; }
  if (run.stage === 'duel') {
    const d = run.duel;
    if (d && d.over) {
      if (d.over === 'p' && run.duelN === 7 && d.phase < RUN.phaseCount(run)) {
        RUN.endDuel(run, G.meta, 'p', null);
        RUN.nextPhase(run);
        go('duel');
      } else duelOver(d.over);
      return;
    }
    go('duel');
    return;
  }
  duelOver(run.stage === 'won' ? 'p' : 'r');
}
function duelOver(winner) {
  const run = G.run, meta = G.meta;
  if (!run) { go('title'); return; }
  const d = run.duel;
  if (run.stage !== 'won' && run.stage !== 'dead') RUN.endDuel(run, meta, winner, G.brain.dossier());
  if (run.stage === 'bonfire') {
    const off = run.offer;
    if (off && off.events && !off.applied) {
      for (const e of off.events) if (e.t === 'forget') G.brain.forget(e.n || 0.5);
      off.applied = true;
    }
    go('bonfire');
    return;
  }
  if (run.stage === 'duel') { RUN.nextPhase(run); go('duel'); return; }
  const won = run.stage === 'won';
  run.stats.score = G.brain.runScore();
  const insights = G.brain.runInsights() || [];
  ST.client.clock += 5000;
  const fin = RUN.finish(run, meta, ST.client.clock) || {};
  const unlocks = [];
  for (const u of fin.unlocks || []) unlocks.push({ id: u.id, type: u.type, ref: u.ref, name: u.name, how: u.how });
  const stake = RUN.stakeOf(run), TV = T.vigil || {};
  if (fin.light > 0) {
    const li = K.light(fin.light);
    if (li) unlocks.unshift({ id: 'vigil_' + li.id, type: 'vigil', ref: fin.light, name: li.name, how: T.fill(TV.earned || '{rule}', { rule: li.rule }) });
  }
  if (fin.face) {
    const TB = T.bosses || {}, tf = TB[fin.face] || {};
    unlocks.unshift({ id: 'face_' + fin.face, type: 'face', ref: fin.face, name: tf.name || fin.face, how: tf.line || TB.earned || '' });
  }
  if (!fin.light && won && stake >= RUN.VIGIL.length && meta.vigil.wins[stake] === 1 && TV.lightlessWon) {
    unlocks.unshift({ id: 'vigil_lightless', type: 'vigil', ref: stake, name: TV.lightlessWon.name, how: TV.lightlessWon.how });
  }
  G.last = {
    won: won, duel: run.duelN, phase: run.phase, rivalHp: d ? Math.max(0, d.r.hp) : 0,
    turns: run.stats.turns || 0, score: run.stats.score || 0,
    finishingMove: run.stats.lastMove || null, hp: Math.max(0, run.pHp || 0),
    unlocks: unlocks, firstWin: !!fin.firstWin, insights: insights,
    boons: run.pBoons.slice(), rivalBoons: run.rBoons.slice(),
    reads: run.stats.reads || 0, surprises: run.stats.surprises || 0, tease: nextGoal(), stake: stake, boss: RUN.bossOf(run).id
  };
  G.run = null;
  go(won ? 'victory' : 'death');
}
function abandon() {
  const run = G.run;
  if (!run) fail('There is no run to abandon.');
  if (run.stage !== 'won' && run.stage !== 'dead') RUN.endDuel(run, G.meta, 'r', null);
  run.stats.score = G.brain.runScore();
  RUN.finish(run, G.meta, ST.client.clock);
  G.run = null; G.last = null;
  out('You walk away from the run. It counts as a death. It will remember.');
  go('title');
}

// ------------------------------------------------------------------ scenes
function go(scene) {
  ST.client.scene = scene;
  SAY = [];
  if (scene === 'duel') { enterDuel(); runDuel(); }
  else if (scene === 'bonfire') enterBonfire();
  else if (scene === 'death') renderDeath(true);
  else if (scene === 'victory') renderVictory(true);
  else if (scene === 'relic') renderRelic();
  else renderTitle();
}

// ---- duel (scenes/duel.js)
function cfgOf(duel) { return RUN.cfg(G.run, duel); }
function tutorialBeat(turn) {
  const TT = T.tutorial || {};
  if (turn === 1) return { force: { move: 'S', tell: 'S' }, only: 'G', line: TT.t1_tell, observe: false };
  if (turn === 2) return { force: { move: 'G', tell: 'G' }, only: 'F', line: TT.t2_tell, observe: false };
  if (turn === 3) return { force: { move: 'F', tell: 'S' }, only: null, line: TT.t3_tell, observe: true, last: true };
  return null;
}
function tutorialResult(turn, pm) {
  const TT = T.tutorial || {};
  if (turn === 1) return TT.t1_result;
  if (turn === 2) return TT.t2_result;
  if (turn === 3) return pm === 'G' ? TT.t3_guard : (pm === 'S' ? TT.t3_strike : TT.t3_feint);
  return null;
}
function bossTaunt(kind, fallback) {
  const id = RUN.bossOf(G.run).id;
  return taunt('boss_' + id + '_' + kind) || (fallback ? taunt(fallback) : null);
}
function showCards(ids) {
  const rules = T.rules || {};
  for (let k = 0; ids && k < ids.length; k++) {
    const r = rules[ids[k]];
    if (!r) continue;
    out('  [RULE CARD] ' + r.name + ': ' + wrapText(r.line, 140, 2).join(' '));
  }
}
function enterDuel() {
  const run = G.run, meta = G.meta;
  const resumed = !!(run.duel && !run.duel.over);
  const duel = resumed ? run.duel : RUN.startDuel(run);
  const D = cfgOf(duel);
  ST.client.S = {
    tutorial: run.duelN === 1 && !meta.seenTutorial, noStance: D.stance === 'none',
    cool: 0, silent: 0, nHabit: 0, nRead: 0, saidHabit: null, lowSaid: { p: low(duel.p), r: false }, forceLine: false,
    input: false, speech: null, only: null, called: null, coinMove: null
  };
  if (!resumed) intro();
  else out('(The duel resumes where it was left.)');
}
function introLine() {
  const m = G.meta.memory, run = G.run, S = ST.client.S, n = run.duelN, lights = RUN.lightsOut(run);
  let t = null;
  if (S.tutorial) return (T.tutorial && T.tutorial.intro) || null;
  if (n === 7) return bossTaunt('intro', 'final_duel_intro');
  if (n === 1 && lights.length) { t = taunt('vigil_' + lights[lights.length - 1].id); if (t) return t; }
  if (n === 1) {
    const runs = m.runs;
    if (G.days >= 2) t = taunt('returning');
    if (!t && runs === 50) t = taunt('run_50');
    if (!t && (runs === 5 || runs === 10 || runs === 25 || runs === 100 || runs === 200)) t = taunt('milestone_runs_' + runs);
    if (!t && m.streakL >= 3 && G.crng.chance(0.8)) t = taunt('lose_streak', { streak: m.streakL });
    if (!t && m.streakW >= 2) t = taunt('win_streak', { streak: m.streakW });
    if (t) return t;
  }
  const dos = G.brain.dossier();
  if (dos.broken && !run.stats.flags.brokenSaid) {
    run.stats.flags.brokenSaid = true;
    t = taunt('habit_broken', T.tauntVars ? T.tauntVars(dos.broken) : dos.broken.vars);
    if (t) return t;
  }
  if (n === 1) return (m.runs >= 4 && G.crng.chance(0.7)) ? taunt('milestone_runs') : null;
  if (G.crng.chance(0.8)) {
    let open = null;
    for (const st of dos.stats) if (st.id === 'opening' && st.strength > 0) open = st;
    return taunt('duel_intro', open ? (T.tauntVars ? T.tauntVars(open) : open.vars) : null);
  }
  return null;
}
function intro() {
  const run = G.run, n = run.duelN, faces = RUN.repairMeta(G.meta).bosses.max > 1, boss = RUN.bossOf(run);
  const bname = faceName(boss.id);
  const b = String(n === 7 && faces ? bname : (T.duelNames && T.duelNames[n - 1]) || '').toUpperCase();
  out('==== DUEL ' + n + (b ? ' - ' + b : '') + ' ====');
  const line = introLine();
  if (line) speak(line);
  if (n === 1 && run.rivalHead && R.Boons.byId[run.rivalHead]) {
    out('  [CARD] ' + boonName(run.rivalHead).toUpperCase() + ': ' + ((T.vigil || {}).armed || 'It did not come empty-handed.'));
  }
  if (n === 1 && faces) out('  [CARD] ' + bname.toUpperCase() + ': ' + ((T.bosses || {}).omen || 'waits at the altar tonight.'));
  if (n === 7) showCards(cfgOf(run.duel).cards);
}
// flow(): turns until the duel is over, a phase change in duel 7, or the outro.
function runDuel() {
  for (;;) {
    const run = G.run, duel = run.duel;
    if (!duel.over) {
      if (turnBegin() === 'input') { renderDuel(); return; }    // turnBegin saved the commit before this screen exists
      continue;
    }
    if (duel.over === 'p' && run.duelN === 7 && duel.phase < RUN.phaseCount(run)) { transform(); continue; }
    outro(duel.over);
    return;
  }
}
function turnBegin() {
  const run = G.run, duel = run.duel, brain = G.brain, S = ST.client.S;
  const pend = run.pending;
  const resume = !!(pend && pend.turn === duel.turn && pend.n === duel.n && pend.phase === duel.phase);
  if (!resume) {
    const evs = C.beginTurn(duel);
    if (evs && evs.length) printTurnStart(evs);
    if (duel.over) return 'over';
  }
  if (!duel.intel) duel.intel = {};
  const tut = S.tutorial ? tutorialBeat(duel.turn) : null;
  const ctx = C.ctx(duel), legalP = C.legal(duel, 'p'), legalR = C.legal(duel, 'r'), cfg = cfgOf(duel);
  let sealed, called = null;
  if (resume) {
    sealed = pend.sealed; called = pend.called || null;
    duel.intel.called = called;
    if (TRACE) TRACE.last = { k: 'resume', key: keyOf(pend), h: sha(JSON.stringify(sealed)) };
  } else {
    if (C.callsOf(duel) && duel.turn % 3 === 2 && !tut) called = argmaxMove(brain.predict(ctx, legalP), legalP);
    duel.intel.called = called;
    const q = { ctx: ctx, payoff: C.payoff(duel), legalR: legalR, legalP: legalP, exploit: cfg.exploit, honestyBase: cfg.honesty, rng: G.rng };
    if (tut && tut.force) q.force = tut.force;
    if (duel.stance === 'none') q.noTell = true;
    if (duel.mimic) q.mimic = C.ctx(duel, 'r');
    const rngBefore = TRACE ? G.rng.state() >>> 0 : 0;
    sealed = brain.commit(q);
    const rngAfter = TRACE ? G.rng.state() >>> 0 : 0;
    run.pending = { sealed: sealed, turn: duel.turn, n: duel.n, phase: duel.phase, called: called };
    save();                                        // the commit is on disk before the screen exists
    if (TRACE) {
      TRACE.last = { k: 'seal', key: keyOf(run.pending), h: sha(JSON.stringify(sealed)), rngBefore: rngBefore, rngAfter: rngAfter,
                     q: JSON.stringify(Object.assign({}, q, { rng: undefined })) };
    }
  }
  if (TRACE) afterSealCounterfactual(sealed, called, tut, ctx);
  afterSeal(sealed, called, tut, ctx);
  return 'input';
}
// duel.js turn() from the seal to the player's window: the pre-pick line and the window's state. The real game has
// `sealed` in scope here, so this takes it too; nothing in it may depend on the hidden parts of the commit (the
// self-test runs it again against an altered commit and compares).
function afterSeal(sealed, called, tut, ctx) {
  const brain = G.brain, S = ST.client.S;
  S.called = called;
  S.speech = null;
  // pre-pick line: tutorial, Called Shot, or a habit named right when it applies
  if (tut && tut.line) { S.speech = bubble(tut.line); S.silent = 0; }
  else if (called) {
    const t = taunt('called_shot_call', { move: mname(called), moveLower: mname(called).toLowerCase() });
    if (t) { S.speech = bubble(t); S.silent = 0; }
  } else if (!S.tutorial && S.cool <= 0 && S.nHabit < 2) {
    const hab = brain.habitFor(ctx);
    if (hab && hab.strength > 0 && S.saidHabit !== hab.id && G.crng.chance(0.35 * (S.silent >= 3 ? 2 : 1))) {
      const t = taunt('habit_detected', T.tauntVars ? T.tauntVars(hab) : hab.vars);
      if (t) { S.speech = bubble(t); S.silent = 0; S.nHabit++; S.saidHabit = hab.id; S.cool = 1; }
    }
  }
  S.only = tut ? tut.only : null;
  S.coinMove = null;
  S.input = true;
}
// The hidden parts of a commit, changed: the move, the honesty, the predicted move and how sure it is, the mode.
// The stance (the tell) is public and stays.
function altCommit(sealed) {
  const alt = JSON.parse(JSON.stringify(sealed));
  alt.move = MOVES[(MOVES.indexOf(sealed.move) + 1) % 3];
  alt.honest = !sealed.honest;
  alt.top = MOVES[(MOVES.indexOf(sealed.top) + 1) % 3];
  alt.confidence = sealed.confidence > 0.5 ? 0.1 : 0.9;
  alt.pred = { S: 0.7, G: 0.2, F: 0.1 };
  alt.mode = sealed.mode === 'mix' ? 'exploit' : 'mix';
  return alt;
}
// A screen line that may differ between two commits with the same stance: only what an owned boon or relic reveals.
function revealLine(line) {
  const pend = G.run.pending, boons = G.run.duel.p.boons;
  return (/^Stamp on the stance:/.test(line) && (boons.indexOf('relic_liars_coin') >= 0 || pend.seen_honesty)) ||
         (/^Keyhole:/.test(line) && pend.seen_glimpse) ||
         (/^Hint row: IT EXPECTS/.test(line) && boons.indexOf('stolen_ledger') >= 0);
}
// Self-test only: run afterSeal() and the input screen twice from the same state, once with the real commit and once
// with altCommit(), and require the same pre-pick line, window state, shuffle bags, dice and output, and the same
// screen apart from revealLine() lines. Everything it touches is put back before the real afterSeal() runs.
function afterSealCounterfactual(sealed, called, tut, ctx) {
  const pend = G.run.pending, key = keyOf(pend);
  const keep = { S: ST.client.S, bags: ST.client.bags, crng: G.crng.state(), rng: G.rng.state(), out: OUT.length, say: SAY.length };
  const sJson = JSON.stringify(keep.S), bJson = JSON.stringify(keep.bags);
  function once(q) {
    ST.client.S = JSON.parse(sJson); ST.client.bags = JSON.parse(bJson);
    G.crng.setState(keep.crng); G.rng.setState(keep.rng);
    pend.sealed = q;
    afterSeal(q, called, tut, ctx);
    const r = { state: JSON.stringify([ST.client.S, ST.client.bags, G.crng.state() >>> 0, G.rng.state() >>> 0, OUT.slice(keep.out), SAY.slice(keep.say)]),
                screen: duelScreen() };
    OUT.length = keep.out; SAY.length = keep.say;
    return r;
  }
  let a, b;
  try { a = once(sealed); b = once(altCommit(sealed)); }
  finally {
    ST.client.S = keep.S; ST.client.bags = keep.bags; G.crng.setState(keep.crng); G.rng.setState(keep.rng);
    pend.sealed = sealed;
  }
  TRACE.prePick++;
  if (a.state !== b.state) TRACE.problems.push('counterfactual pre-pick for ' + key + ': the pre-pick line or the window state depends on hidden commit fields');
  if (a.screen.length !== b.screen.length) TRACE.problems.push('counterfactual pre-pick for ' + key + ': screen length depends on hidden commit fields');
  else for (let i = 0; i < a.screen.length; i++) {
    if (a.screen[i] !== b.screen[i] && !revealLine(a.screen[i])) {
      TRACE.problems.push('counterfactual pre-pick for ' + key + ': hidden commit field reaches the screen: "' + a.screen[i] + '" vs "' + b.screen[i] + '"');
      break;
    }
  }
}
function turnResolve(pm, coin) {
  const run = G.run, duel = run.duel, brain = G.brain, S = ST.client.S, pend = run.pending;
  const sealed = pend.sealed, called = pend.called || null;
  const tut = S.tutorial ? tutorialBeat(duel.turn) : null;
  const ctx = C.ctx(duel);                       // unchanged since the commit (an active touches only charges/intel)
  S.input = false;
  if (!duel.intel) duel.intel = {};
  duel.intel.called = called;
  duel.intel.honest = sealed.honest; duel.intel.pred = sealed.pred; duel.intel.coin = !!coin;
  const res = C.resolve(duel, pm, sealed.move);
  if (!tut || tut.observe) brain.observe(ctx, S.noStance ? null : sealed.tell, pm, sealed.move);
  RUN.record(run, G.meta, res, sealed);
  run.pending = null;
  if (tut && tut.last) G.meta.seenTutorial = true;
  ST.client.clock += TURN_MS;
  save();
  present(res, pm, coin);
  if (S.cool > 0) S.cool--;
  const line = tut ? tutorialResult(res.turn, pm) : reaction(res, sealed, pm, called);
  if (line) { S.forceLine = false; speak(line); }
  else S.silent++;
  return res;
}
function reaction(res, sealed, pm, called) {
  const duel = G.run.duel, rng = G.crng, S = ST.client.S;
  const pAct = sealed.pred[pm] || 0;
  const boost = S.silent >= 3 ? 2 : 1;
  const v = { move: mname(pm), moveLower: mname(pm).toLowerCase(), hp: duel.p.hp, rivalHp: duel.r.hp,
              tellMove: mname(sealed.tell), counterMove: mname(R.LOSES_TO[pm]) };
  function roll(p) { return rng.chance(Math.min(1, p * boost)); }
  let t = null;
  if (res.over) return null;
  if (called) {
    S.forceLine = true;
    if (pm === called && res.winner === 'r') return taunt('called_shot_right', v);
    if (pm !== called) return taunt('called_shot_wrong', v);
  }
  if (hasEv(res.events, 'rupture')) { S.forceLine = true; return taunt('clash_rupture', v); }
  if (!S.lowSaid.p && low(duel.p)) { S.lowSaid.p = true; S.forceLine = true; return taunt('player_low_hp', v); }
  if (!S.lowSaid.r && low(duel.r)) { S.lowSaid.r = true; S.forceLine = true; return taunt('rival_low_hp', v); }
  if (res.clash && res.tensionAfter >= 3 && res.tensionBefore < 3) return taunt('clash_deathblow', v);
  if (S.cool > 0) return null;
  if (res.guardBreak === 'p' && roll(0.6)) t = taunt('guard_break_player', v);
  else if (res.guardBreak === 'r' && roll(0.6)) t = taunt('guard_break_rival', v);
  else if (pAct > 0.6 && res.winner === 'r' && S.nRead < 2 && roll(0.5)) { t = taunt('read_you', v); S.nRead++; }
  else if (pAct < 0.2 && res.winner === 'p' && roll(0.6)) t = taunt('surprised', v);
  else if (!sealed.honest && res.winner === 'p' && roll(0.4)) t = taunt('lie_caught', v);
  else if (!sealed.honest && res.winner === 'r' && roll(0.3)) t = taunt('lie_worked', v);
  else if (res.clash && roll(0.25)) t = taunt('clash_' + pm, v) || taunt('clash', v);
  if (t) S.cool = 1;
  return t;
}

// ---- floats: the floatText calls of duel.js, in the order they spawn ("you"/"it" = over that fighter)
function side(s) { return s === 'p' ? 'you' : 'it'; }
function eventFloats(evs, F) {                    // showEvents(): bleed, heal, boon names, NOT YET
  for (const e of evs) {
    if (e.t === 'bleed') F.push(side(e.side) + ' -' + (e.n || 1));
    else if (e.t === 'heal') F.push(side(e.side) + ' +' + (e.n || 1));
    else if (e.t === 'boon' && e.id) F.push(side(e.side) + ' ' + boonName(e.id).toUpperCase());
    else if (e.t === 'saved') F.push(side(e.side) + ' NOT YET');
  }
  return F;
}
function floatsLine(F, indent) { if (F.length) out((indent || '') + 'Floats: ' + F.join(' · ')); }

// ---- the client's own event log (the game has none: it only floats labels and numbers)
function who(s) { return s === 'p' ? 'You' : 'It'; }
function whose(s) { return s === 'p' ? 'Your' : 'Its'; }
function guardText(s, n) { return ui('guardBroken', 'GUARD BROKEN') + ': ' + (s === 'p' ? 'you' : 'it') + ' cannot Guard ' + (n > 1 ? 'for the next ' + n + ' turns' : 'next turn'); }
function eventText(e) {
  switch (e.t) {
    case 'bleed': return who(e.side) + (e.side === 'p' ? ' bleed' : ' bleeds') + ': -' + (e.n || 1) + ' HP' + (e.left > 0 ? ' (' + e.left + ' more)' : '');
    case 'heal': return who(e.side) + (e.side === 'p' ? ' heal' : ' heals') + ' +' + (e.n || 1);
    case 'saved': return 'NOT YET - ' + (e.side === 'p' ? 'you hold on' : 'it holds on') + ' at ' + e.n + ' HP';
    case 'overkill': return ui('overkill', 'OVERKILL') + ' (the hit is capped at ' + C.HIT_CAP + ')';
    case 'deathblow': return ui('deathblow', 'DEATHBLOW') + ' (' + (e.side === 'p' ? 'yours' : 'its') + ')';
    case 'called': return e.result === 'hit' ? 'CALLED SHOT lands: +' + (e.n || 2) + ' damage' : 'CALLED SHOT defied';
    case 'tension': return e.spent ? 'Tension spent (+' + e.spent + ' damage), back to ' + e.n : 'Tension ' + e.from + ' -> ' + e.n;
    case 'status': {
      const nm = e.id === 'guardBroken' ? 'guard break' : e.id === 'sealed' ? mname(e.move) + ' seal' : e.id;
      if (e.op === 'add') {
        if (e.id === 'guardBroken') return guardText(e.side, e.n || 1);
        if (e.id === 'sealed') return whose(e.side) + ' ' + mname(e.move) + ' is SEALED for ' + e.n + ' turn' + (e.n === 1 ? '' : 's');
        return whose(e.side) + ' ' + nm + ' is now ' + e.n;
      }
      if (e.op === 'expire') return whose(e.side) + ' ' + nm + ' ends';
      if (e.op === 'consume') return whose(e.side) + ' ' + nm + ' is used up' + (e.spent ? ' (' + e.spent + ')' : '');
      if (e.op === 'remove') return e.id === 'guardBroken' ? whose(e.side) + ' guard break is cancelled' : whose(e.side) + ' ' + nm + ' is dropped (a guard break takes priority)';
      return null;                                 // 'blocked': nothing happened
    }
    default: return null;                          // clash / dmg / info / note / rupture: said elsewhere or not shown
  }
}
// Effects, then the boons that fired as a separate list (their engine order says nothing about cause).
// After an exchange, a guard break is reported once, from the result (res.brokenP / res.brokenR), as the game
// shows one GUARD BROKEN from res.guardBreak; the add/remove events behind it are not repeated.
function clientLog(evs, res) {
  const parts = [], boons = [];
  if (res) for (const s of ['p', 'r']) { const n = s === 'p' ? res.brokenP : res.brokenR; if (n > 0) parts.push(guardText(s, n)); }
  for (const e of evs) {
    if (e.t === 'boon') { if (e.id) boons.push(boonName(e.id) + (e.side === 'p' ? ' (yours)' : ' (its)')); continue; }
    if (res && e.t === 'status' && e.id === 'guardBroken' && (e.op === 'add' || e.op === 'remove')) continue;
    const s = eventText(e);
    if (s) parts.push(s);
  }
  return (parts.length ? parts.join('; ') + '.' : '') + (boons.length ? (parts.length ? ' ' : '') + 'Boons that fired: ' + boons.join(', ') + '.' : '');
}
function printTurnStart(evs) {
  const F = eventFloats(evs, []), lg = clientLog(evs, null);
  if (!F.length && !lg) return;
  out('Turn start.' + (F.length ? ' Floats: ' + F.join(' · ') : ''));
  if (lg) out('   log: ' + lg);
}
// present(): what the reveal floats, then the client's log line
function present(res, pm, coin) {
  const duel = G.run.duel, rm = res.rm;
  out('>> You: ' + mname(pm).toUpperCase() + (coin ? ' (the coin chose it)' : '') + '. It: ' + mname(rm).toUpperCase() + '.');
  const F = ['you ' + mname(pm).toUpperCase(), 'it ' + mname(rm).toUpperCase()];
  let head;
  if (res.clash) {
    if (hasEv(res.events, 'rupture')) {
      if (res.dmgP) F.push('you -' + res.dmgP);
      if (res.dmgR) F.push('it -' + res.dmgR);
      F.push(ui('rupture', 'RUPTURE'));
      head = 'CLASH. ' + ui('rupture', 'RUPTURE') + ': ' + (res.dmgP ? 'you -' + res.dmgP : 'you hold at 1 HP') + ', ' + (res.dmgR ? 'it -' + res.dmgR : 'it holds at 1 HP') + '.';
    } else head = 'CLASH. No blood.';
    if (res.tensionAfter > res.tensionBefore && res.tensionAfter >= 3 && res.tensionBefore < 3) F.push(ui('deathblow', 'DEATHBLOW'));
  } else {
    const w = res.winner, ls = w === 'p' ? 'r' : 'p', dmg = ls === 'p' ? res.dmgP : res.dmgR;
    F.push(side(ls) + ' ' + (dmg > 0 ? '-' + dmg : '0'));
    if (hasEv(res.events, 'overkill')) F.push(ui('overkill', 'OVERKILL'));
    if (res.guardBreak === ls) F.push(ui('guardBroken', 'GUARD BROKEN'));
    head = (w === 'p' ? 'You win the exchange' : 'It wins the exchange') + ': ' + dmg + ' damage to ' + (w === 'p' ? 'it' : 'you') +
           ((w === 'p' ? pm : rm) === 'G' ? ' (riposte)' : '') + '.' + (res.over ? ' The final blow.' : '');
  }
  eventFloats(res.events, F);
  floatsLine(F, '   ');
  const lg = clientLog(res.events, res);
  out('   log: ' + head + (lg ? ' ' + lg : ''));
  out('   HP: you ' + Math.max(0, duel.p.hp) + '/' + duel.p.maxHp + ', it ' + Math.max(0, duel.r.hp) + '/' + duel.r.maxHp + '. Tension ' + duel.tension + '/3.');
}
function transform() {
  const run = G.run, S = ST.client.S, old = run.duel;
  const next = RUN.cfg(run, { n: 7, phase: old.phase + 1 });
  if (next.change === 'bell') {
    const n = next.phase - 1;
    out('~~ The candles gutter. The bell tolls ' + n + (n === 1 ? ' time' : ' times') + '. ~~');
  } else if (next.change === 'swap') {
    speak('...');
    out('~~ It turns away and comes back wearing another face. ~~');
  } else {
    speak('...');
    out('~~ The mask breaks. ~~');
  }
  RUN.endDuel(run, G.meta, 'p', null);
  const duel = RUN.nextPhase(run);
  const D = cfgOf(duel);
  S.noStance = D.stance === 'none';
  S.lowSaid.r = false;
  out('==== ' + faceName(RUN.bossOf(run).id).toUpperCase() + ' - PHASE ' + duel.phase + '/' + D.phases + ': ' + String(D.name).toUpperCase() + ' ====');
  out('It rises with ' + duel.r.hp + '/' + duel.r.maxHp + ' HP.');
  save();
  speak(bossTaunt('p' + duel.phase, 'phase2'));
  showCards(D.cards);
}
function outro(winner) {
  const run = G.run, duel = run.duel, fin2 = run.duelN === 7 && duel.phase >= RUN.phaseCount(run);
  ST.client.S.input = false;
  if (winner === 'p') {
    out('** It falls. **');
    speak(taunt(fin2 ? 'rival_defeated_final' : 'rival_defeated', { hp: duel.p.hp }));
    duelOver('p');
  } else {
    out('** You fall. **');
    duelOver('r');
  }
}
function hintFor(duel, S) {
  if (S.called) return 'IT CALLS: ' + mname(S.called).toUpperCase();
  if (duel.p.status.guardBroken > 0) return ui('guardBroken', 'GUARD BROKEN');
  if (duel.tension >= 3) return ui('deathblow', 'DEATHBLOW');
  return null;
}
function statusText(f) {
  const s = f.status, a = [];
  if (s.guardBroken > 0) a.push('GUARD BROKEN (' + s.guardBroken + ' turn' + (s.guardBroken === 1 ? '' : 's') + ' left, this one included)');
  if (s.bleed > 0) a.push('BLEED ' + s.bleed + ' (1 per turn)');
  if (s.fortify > 0) a.push('FORTIFY ' + s.fortify);
  if (s.focus > 0) a.push('FOCUS ' + s.focus);
  for (const m of MOVES) if (s.sealed && s.sealed[m] > 0) a.push(mname(m).toUpperCase() + ' SEALED (' + s.sealed[m] + ' turn' + (s.sealed[m] === 1 ? '' : 's') + ' left, this one included)');
  return a.length ? a.join(', ') : '-';
}
function activesOf(duel) {
  const a = [];
  for (const id of duel.p.boons) { const b = R.Boons.byId[id]; if (b && b.active && a.length < 3) a.push(id); }
  return a;
}
// The input screen. Reads run.pending.sealed ONLY for what owned boons/relics reveal in the real game.
function duelScreen() {
  const run = G.run, duel = run.duel, S = ST.client.S, pend = run.pending, sealed = pend.sealed, D = cfgOf(duel);
  const L = [];
  const lights = RUN.lightsOut(run);
  let head = 'DUEL ' + duel.n + '/7';
  if (duel.n === 7) head += ' - ' + faceName(RUN.bossOf(run).id).toUpperCase() + (D.phases > 1 ? ' - PHASE ' + duel.phase + '/' + D.phases + ': ' + String(D.name).toUpperCase() : '');
  else head += ' - ' + String((T.duelNames || [])[duel.n - 1] || D.name).toUpperCase();
  L.push('---------------------------------------------------------------');
  L.push(head + (S.tutorial ? '   (first duel: the tutorial)' : ''));
  L.push('Run #' + run.runNo + ' · run turn ' + (run.stats.turns + 1) + ' · duel turn ' + duel.turn + ' · duels won this run: ' + (run.duelN - 1) +
         (lights.length ? ' · VIGIL: ' + K.vigilLabel(lights.length) : ''));
  L.push('YOU ' + duel.p.hp + '/' + duel.p.maxHp + '   IT ' + duel.r.hp + '/' + duel.r.maxHp +
         '   TENSION [' + '#'.repeat(duel.tension) + '.'.repeat(3 - duel.tension) + '] ' + duel.tension + '/3');
  L.push('Your status: ' + statusText(duel.p));
  L.push('Its status:  ' + statusText(duel.r));
  if (S.noStance) L.push('Its stance: (it shows no stance)');
  else L.push('Its stance: ' + mname(sealed.tell).toUpperCase());
  // reveals: exactly where the game draws them
  const info = C.info(duel);
  let stamp = null;
  if (info.coinTurn1 && duel.turn === 1) stamp = sealed.honest;
  if (pend.seen_honesty) stamp = sealed.honest;
  if (stamp !== null && !S.noStance) L.push('Stamp on the stance: ' + (stamp ? ui('trueStance', 'TRUE') : ui('falseStance', 'FALSE')));
  if (pend.seen_glimpse) L.push('Keyhole: through the wax you see ' + mname(sealed.move).toUpperCase());
  let infoLine = null;
  if (info.ledger) infoLine = 'IT EXPECTS ' + mname(sealed.top).toUpperCase() + (sealed.confidence > 0.66 ? ' !!!' : sealed.confidence > 0.33 ? ' !!' : ' !');
  else if (info.tally) infoLine = 'HONESTY ~' + (Math.round(G.brain.honesty(D.honesty) * 10) * 10) + '%';
  const hint = hintFor(duel, S);
  if (hint || infoLine) L.push('Hint row: ' + (hint || infoLine));        // duel.js drawButtons: S.hint || S.infoLine
  if (S.speech) L.push('IT: "' + S.speech + '"');
  const lp = C.legal(duel, 'p');
  const mv = [];
  for (const m of MOVES) {
    let tag = '';
    if (lp.indexOf(m) < 0) tag = m === 'G' && duel.p.status.guardBroken > 0 ? ' (unavailable: guard broken)' : ' (unavailable: sealed)';
    else if (S.only && S.only !== m) tag = ' (locked by the tutorial)';
    mv.push(m + '=' + mname(m).toUpperCase() + tag);
  }
  L.push('Moves: ' + mv.join('   '));
  const acts = activesOf(duel);
  if (acts.length) {
    L.push('Actives: ' + acts.map(function (id) {
      const ch = duel.p.charges[id] || 0;
      return boonName(id) + ' [' + id + '] x' + ch + (ch <= 0 ? ' (spent)' : S.only ? ' (not during the tutorial)' : '');
    }).join('   '));
  }
  L.push('> move S|G|F' + (acts.length ? ' · active <id>' : '') + ' · ledger · dossier · show');
  return L;
}
function renderDuel() {
  if (TRACE) traceScreen();
  for (const l of duelScreen()) out(l);
}
// Self-test only: the screen about to print must show a commit that is already on disk, unchanged: the same as the
// one in memory and, when this command sealed or resumed the turn, the very commit it sealed or resumed.
function traceScreen() {
  TRACE.screens++;
  const pend = G.run.pending, key = keyOf(pend), tr = TRACE.last;
  let disk = null;
  try { disk = JSON.parse(fs.readFileSync(path.join(profileDir(P), 'save.json'), 'utf8')); } catch (e) { disk = null; }
  const dp = disk && disk.run && disk.run.pending;
  if (!dp || keyOf(dp) !== key) TRACE.problems.push('seal-before-print: screen for ' + key + ' printed before its commit was saved');
  else if (JSON.stringify(dp.sealed) !== JSON.stringify(pend.sealed) || (tr && (tr.key !== key || sha(JSON.stringify(dp.sealed)) !== tr.h))) {
    TRACE.problems.push('seal-before-print: on-disk commit for ' + key + ' differs from the sealed commit');
  }
}

// ---- bonfire (scenes/bonfire.js)
function enterBonfire() {
  const run = G.run, o = run.offer, mem = G.meta.memory, TT = T.tutorial || {};
  const firstEver = (mem.runs | 0) <= 1 && (mem.deaths | 0) === 0 && (mem.wins | 0) === 0 && (o.bonfire || run.duelN) === 1;
  out('==== BONFIRE ' + (o.bonfire || run.duelN) + ' - ' + ui('rest', 'REST') + ' ====');
  if (!o.seen) {
    const F = [];
    if (o.healed > 0) F.push('you ' + kfill(ui('healed', '+{n}'), { n: o.healed }));
    let n = 0;
    for (const e of o.events || []) {
      if (e && e.t === 'boon' && e.id && n < 3) { F.push(boonInfo(e.id).name.toUpperCase()); n++; }
      else if (e && e.t === 'forget') F.push('it IT FORGETS');
    }
    floatsLine(F);
    if (o.healed > 0) out('   log: you rest, +' + o.healed + ' HP.');
    if (o.rivalPick) {
      if (firstEver && TT.bonfire_first) speak(TT.bonfire_first);
      const v = { rivalBoon: boonInfo(o.rivalPick).name };
      let t = null;
      if (o.rivalWhy) t = taunt('bonfire_rival_pick_' + o.rivalWhy, v);
      speak(t || taunt('bonfire_rival_pick', v));
    }
    o.seen = true;
    ST.client.bonfireSaid = SAY.slice();
    if (firstEver && TT.bonfire_cards) { speak(TT.bonfire_cards); ST.client.bonfireSaid = SAY.slice(); }
  } else ST.client.bonfireSaid = [];
  save();
  for (const l of bonfireScreen()) out(l);
}
function bonfireScreen() {
  const run = G.run, o = run.offer, L = [];
  const next = (o.bonfire || run.duelN) + 1, names = T.duelNames || [];
  const nextB = next === 7 && RUN.repairMeta(G.meta).bosses.max > 1 ? faceName(RUN.bossOf(run).id).toUpperCase() : (names[next - 1] ? String(names[next - 1]).toUpperCase() : '');
  L.push('---------------------------------------------------------------');
  L.push('BONFIRE ' + (o.bonfire || run.duelN) + ' · YOU ' + run.pHp + '/' + run.pMaxHp + ' HP · NEXT: DUEL ' + next + (nextB ? ' - ' + nextB : ''));
  if (o.rivalPick) {
    L.push(ui('itChoosesFirst', 'IT CHOOSES FIRST') + ':');
    L.push(boonLine(o.rivalPick, '  '));
  }
  L.push(ui('pickOne', 'PICK ONE') + ':');
  (o.choices || []).slice(0, 4).forEach(function (id) { L.push(boonLine(id, '  ')); });
  if (!(o.choices || []).length) L.push('  (No cards are left to offer. Continue with: draft none)');
  L.push('YOURS: ' + (run.pBoons.slice(0, 7).map(boonName).join(', ') || '-'));
  L.push('ITS:   ' + (run.rBoons.slice(0, 7).map(boonName).join(', ') || '-'));
  L.push('> draft <boonId> · ledger · dossier · show');
  return L;
}
function draft(id) {
  const run = G.run;
  const ch = run.offer.choices || [];
  if (!id) fail('draft needs a card id' + (ch.length ? '. Choices: ' + ch.join(', ') : ', or: draft none'));
  if (ch.length && ch.indexOf(id) < 0) fail('"' + id + '" is not one of the cards. Choices: ' + ch.join(', '));
  const line = G.crng.chance(0.7) ? taunt('bonfire_player_pick', { boon: boonInfo(id).name }) : null;
  out('You take ' + (ch.length ? boonName(id) : 'nothing') + '.');
  if (line) speak(line);
  if (!RUN.pick(run, id, G.meta)) fail('Draft refused.');
  ST.client.clock += DRAFT_MS;
  go('duel');
}

// ---- death / victory / credits / title / relic
function reelLines(unlocks) {                     // R.SceneKit.reel: the first 12 unlocks, as unlock cards
  return K.reel(unlocks || []).items.map(function (x) {
    return '  [' + x.typeLabel + '] ' + x.name + (x.howLines.length ? ' - ' + x.howLines.join(' ') : '');
  });
}
function renderDeath(first) {
  const last = G.last || {};
  const duel = last.duel | 0 || 1, score = Math.max(0, Math.min(100, Math.round(last.score || 0)));
  if (first) {
    const ex = { duel: duel, rivalHp: last.rivalHp | 0, turns: last.turns | 0, score: score, hp: 0 };
    const cat = duel === 1 ? 'player_death_duel1' : duel === 7 ? 'player_death_final' : (last.rivalHp | 0) <= 2 ? 'player_death_close' : 'player_death';
    last.parting = taunt(cat, ex) || taunt('player_death', ex) || '...';
    last.ins = [];
    for (let i = 0; last.insights && i < last.insights.length && i < 3; i++) {
      const st = last.insights[i]; let s = null;
      try { s = T.taunt && T.tauntVars ? T.taunt('learned_lines', T.tauntVars(st), G.crng) : null; } catch (e) { s = null; }
      if (!s) { try { s = T.dossierLine ? T.dossierLine(st) : null; } catch (e2) { s = null; } }
      if (s) last.ins.push(wrapText(s, 156, 3).join(' '));
    }
    save();
  }
  out('==== ' + ui('youDied', 'YOU DIED') + ' ====');
  out('DUEL ' + duel + ' / 7 · PREDICTABILITY ' + score);
  if ((last.turns | 0) > 0) out('READ YOU: ' + (last.reads | 0) + ' · SURPRISED IT: ' + (last.surprises | 0));
  out('IT: "' + wrapText(last.parting, 164, 3).join(' ') + '"');
  if (last.ins && last.ins.length) { out(ui('learned', 'WHAT I LEARNED')); for (const s of last.ins) out('  ' + s); }
  if (last.unlocks && last.unlocks.length) { out(ui('unlocked', 'UNLOCKED') + ':'); for (const l of reelLines(last.unlocks)) out(l); }
  if (last.tease && last.tease.how) out(wrapText('Next: ' + last.tease.how, 164, 2).join(' '));
  out('> new <profile> [options] (one more run) · dossier · unlocks');
}
function renderVictory(first) {
  const last = G.last || {};
  const score = Math.max(0, Math.min(100, Math.round(last.score || 0)));
  if (first) { last.line = taunt('victory_summary', { hp: last.hp | 0, turns: last.turns | 0, score: score, duel: 7 }) || ''; save(); }
  out('==== ' + ui('victory', 'THE MASK FALLS') + ' ====');
  if (last.line) out('IT: "' + wrapText(last.line, 160, 3).join(' ') + '"');
  out('TURNS ' + (last.turns | 0) + ' · PREDICTABILITY ' + score + (last.finishingMove ? ' · FINISHING MOVE ' + mname(last.finishingMove).toUpperCase() : '') + ' · HP LEFT ' + (last.hp | 0));
  out('BOONS: ' + ((last.boons || []).slice(0, 8).map(boonName).join(', ') || 'NONE'));
  if (last.unlocks && last.unlocks.length) { out(ui('unlocked', 'UNLOCKED') + ':'); for (const l of reelLines(last.unlocks)) out(l); }
  if (first && last.firstWin) credits();
  out('> new <profile> [options] · dossier · unlocks');
}
function credits() {                              // scenes/credits.js build() and enter()
  const mem = G.meta.memory;
  const deaths = mem.deaths | 0, runs = mem.runs | 0, wins = mem.wins | 0, turns = mem.totalTurns | 0;
  const v = vars(), pool = (T.taunts && T.taunts.credits_footnotes) || [], notes = [];
  if (v.deaths === undefined) v.deaths = deaths;
  if (v.runs === undefined) v.runs = runs;
  if (v.wins === undefined) v.wins = wins;
  for (const tpl of pool) { let s = null; try { s = T.fill(tpl, v); } catch (e) { s = null; } if (s) notes.push(s); }
  const lastLine = notes.length ? notes.pop() : "You may go now. You won't.";
  if (notes.length > 1) G.crng.shuffle(notes);
  G.meta.seenCredits = true;
  out('~~ THE CREDITS ROLL ~~');
  out('  What burns here comes back as ash. What dies here comes back.');
  out('  IN ORDER OF DISAPPEARANCE');
  out('  THE RIVAL - as itself' + (notes[0] ? '   * ' + notes[0] : ''));
  out('  YOU - ' + deaths + (deaths === 1 ? ' death, ' : ' deaths, ') + runs + (runs === 1 ? ' attempt' : ' attempts') + (notes[1] ? '   * ' + notes[1] : ''));
  out('  THE MASK - ' + (wins > 1 ? 'broken ' + wins + ' times' : wins === 1 ? 'broken once' : 'unbroken') + (notes[2] ? '   * ' + notes[2] : ''));
  out('  YOUR HABITS - ' + turns + (turns === 1 ? ' move, noted' : ' moves, every one noted') + (notes[3] ? '   * ' + notes[3] : ''));
  if (notes[4]) out('  ' + notes[4]);
  out('  ' + ui('credit', 'Developed by tangoSHELL · 2026'));
  out('  IT: "' + lastLine + '"');
  out('  ' + ui('willRemember', 'It will remember.'));
}
function renderTitle() {
  const runs = G.meta.memory.runs | 0;
  out('==== ' + ui('title', 'SHOW ME MY RIVAL') + ' ====');
  if (runs >= 1) out(kfill(ui('titleRemembers', 'It remembers {runs} of you.'), { runs: runs }));
  out(ui('credit', 'Developed by tangoSHELL · 2026'));
  out(hasRun() ? '> show (continue the run) · abandon · dossier · unlocks' : '> new <profile> [options] · dossier · unlocks');
}
function renderRelic() {
  const list = RUN.relics(G.meta), vg = RUN.repairMeta(G.meta).vigil, TV = T.vigil || {}, all = ST.opts.unlocks === 'all';
  const sel = all ? (ST.opts.stakeAll | 0) : Math.min(vg.sel, vg.max);
  const right = K.vigilLabel(sel) || (vg.max > 0 ? (TV.allLit || 'ALL SEVEN LIT') : '');      // relic.js refreshLabel
  out('==== ' + ui('chooseRelic', 'CHOOSE A RELIC') + ' ====' + (right ? '   ' + right : ''));
  out((TV.title || 'THE VIGIL') + ' (seven lights; lights 1..N go out together):');
  for (let k = 1; k <= 7; k++) {
    const li = K.light(k), locked = k > vg.max && !all, isOut = k <= sel;
    let s = '  ' + k + '. ' + (isOut ? '[OUT]   ' : locked ? '[LOCKED]' : '[LIT]   ') + ' ';
    if (locked) s += (vg.max === 0 ? (TV.earnFirst || '') : (TV.earnNext || '')) + (k === vg.max + 1 && TV.intro ? '  "' + TV.intro + '"' : '');
    else s += li.name + ' - ' + li.rule + (vg.wins[k] > 0 ? '  (won with ' + k + ' out)' : '');
    out(s);
  }
  out('Relics:');
  for (const b of list.slice(0, 8)) out(boonLine(b.id, '  '));
  out('  ' + ui('none', 'NONE') + ' [none] - No relic. Just you, and what it already knows.');
  out('> relic <relicId|none> [--stake N] (N = lights out, 0..' + (all ? 7 : vg.max) + ')');
}

// ---- ledger / dossier / unlocks
function ledger() {
  const run = G.run;
  if (!run) fail('No run in progress: the ledger is a duel screen.');
  const d = run.duel, its = d && ST.client.scene === 'duel' ? d.r.boons : run.rBoons, yours = d && ST.client.scene === 'duel' ? d.p.boons : run.pBoons;
  out('==== LEDGER ====');
  out('ITS BOONS:'); if (!its.length) out('  (none yet)'); for (const id of its) out(boonLine(id, '  '));
  out('YOUR BOONS:'); if (!yours.length) out('  (none yet)'); for (const id of yours) out(boonLine(id, '  '));
  const lights = RUN.lightsOut(run);
  if (lights.length) {
    out('VIGIL: ' + K.vigilLabel(RUN.stakeOf(run)));
    for (const l of lights) { const li = K.light(l.k); if (li) out('  ' + li.name + ' - ' + li.rule); }
  }
}
function dossier() {
  let dos = null;
  try { dos = G.brain.dossier(); } catch (e) { dos = null; }
  const mem = G.meta.memory, stats = (dos && dos.stats) || [], samples = dos ? dos.samples | 0 : 0;
  let topKind = 'habit', known = false, shown = 0;
  function header(kind, n) { return T.dossierHeader ? T.dossierHeader(kind, n) : 'ON THE SUBJECT OF YOU'; }
  function line(st) { try { return T.dossierLine(st) || ''; } catch (e) { return ''; } }
  out('==== ' + ui('dossier', 'DOSSIER') + ' ====' + (samples > 0 ? '   ' + samples + ' TURNS' : ''));
  for (const st of stats) {
    if (st.id === 'predictability') known = true;
    else if (st.id !== 'broken_habit' && shown === 0) { topKind = st.kind === 'tell' ? 'tell' : 'habit'; shown = 1; }
  }
  if (samples <= 0) {
    out('-- ' + header('habit', 0) + ' --');
    out(T.dossierEmpty && T.dossierEmpty.length ? T.dossierEmpty[G.crng.int(T.dossierEmpty.length)] : "I don't know you yet. Give it time.");
  } else {
    out('-- ' + header(topKind, samples) + ' --');
    const score = Math.max(0, Math.min(100, Math.round(dos.predictability || 0)));
    out('PREDICTABILITY ' + (known ? score : '??') + ' - ' + (T.predictabilityLine ? T.predictabilityLine(known ? score : NaN) : ''));
    shown = 0;
    for (let i = 0; i < stats.length && shown < 16; i++) {
      const st = stats[i];
      if (st.id === 'predictability' || st.id === 'broken_habit' || st.id === 'record') continue;
      const s = line(st);
      if (!s) continue;
      out((st.strength > 0 ? (st.move ? '[' + st.move + '] ' : '* ') : '  ') + wrapText(s, 154, 4).join(' '));
      shown++;
    }
    if (!shown) out(T.dossierEmpty && T.dossierEmpty[1] ? T.dossierEmpty[1] : 'Blank pages. They will not stay blank.');
    const tell = dos.tell;
    if (tell && tell.n > 0) {
      out('-- ' + header('tell', tell.n) + ' --');
      out('BELIEVE ' + Math.max(0, tell.counter | 0) + '% · COPY ' + Math.max(0, tell.mirror | 0) + '% · DEFY ' + Math.max(0, tell.under | 0) + '%');
    }
    if (dos.broken) { const s = line(dos.broken); if (s) { out('-- A HABIT YOU BROKE --'); out(s); } }
  }
  let rows = [];
  try { rows = T.recordLines ? T.recordLines(mem) || [] : []; } catch (e) { rows = []; }
  if (rows.length) {
    out('-- ' + header('record', mem.runs | 0) + ' --');
    for (const r of rows) out(String(r.label || '') + ': ' + String(r.value || '') + (r.jab ? ' - ' + r.jab : ''));
  }
}
function unlocks() {
  const U = RUN.UNLOCKS, un = G.meta.unlocked || {}, B = RUN.BOSSES, bs = RUN.repairMeta(G.meta).bosses, TB = T.bosses || {};
  const GROUPS = [['boon', 'BOONS'], ['relic', 'RELICS'], ['mask', 'MASKS'], ['arena', 'ARENAS']];
  const L = [];
  let all = 0, have = 0;
  L.push('-- FACES ' + bs.max + ' / ' + B.length + ' --');
  for (let i = 0; i < B.length; i++) {
    const open = i < bs.max, wins = bs.wins[B[i].id] || 0;
    if (open) L.push('  ' + faceName(B[i].id) + ' - ' + B[i].phases.length + ' PHASES · ' + (wins ? kfill(TB.winsLabel || 'BEATEN {n}', { n: wins }) : (TB.unbeaten || 'UNBEATEN')) + ' - ' + ((TB[B[i].id] || {}).line || ''));
    else L.push('  ? ? ? (' + ui('locked', 'LOCKED') + ') - ' + (TB.unseen || ''));
  }
  for (const gr of GROUPS) {
    let n = 0, got = 0; const rows = [];
    for (const u of U) {
      if (u.type !== gr[0]) continue;
      const tu = T.unlock ? T.unlock[u.id] : null, open = !!un[u.id];
      let name = u.name, desc = '';
      if (u.type === 'boon' || u.type === 'relic') { const x = boonInfo(u.ref); name = x.name; desc = x.desc + (x.rival ? ' (ITS BOON)' : ''); }
      else if (u.type === 'mask') { const x = T.masks && T.masks[u.ref]; if (x) { name = x.name; desc = x.line; } }
      else if (u.type === 'arena') { const x = T.arenas && T.arenas[u.ref]; if (x) { name = x.name; desc = x.line; } }
      const how = (tu && tu.how) || u.how || '';
      rows.push(open ? '  ' + name + (tu && tu.name ? ' (' + tu.name.toUpperCase() + ')' : '') + ' - ' + desc : '  ? ? ? (' + ui('locked', 'LOCKED') + ') - ' + how);
      n++; if (open) got++;
    }
    L.push('-- ' + gr[1] + ' ' + got + ' / ' + n + ' --');
    for (const r of rows) L.push(r);
    all += n; have += got;
  }
  out('==== ' + ui('unlocks', 'UNLOCKS') + ' ====   ' + have + ' / ' + all);
  for (const l of L) out(l);
  const vg = RUN.repairMeta(G.meta).vigil;
  out('(The Vigil is not listed here in the game; it lives on the relic screen. Lights earned: ' + vg.max + ' / 7.)');
}

// ------------------------------------------------------------------ commands
const ALIASES = { play: 'move', use: 'active' };
const OPTIONS = { new: ['unlocks', 'stake', 'boss', 'relic', 'start', 'seed'], relic: ['stake'] };
const COMMANDS = ['new', 'show', 'move', 'active', 'relic', 'draft', 'ledger', 'dossier', 'unlocks', 'reload', 'wait', 'abandon'];
function parseOpts(args, allowed) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.indexOf('--') !== 0) { o._.push(a); continue; }
    const k = a.slice(2);
    if (!allowed || allowed.indexOf(k) < 0) fail('Unknown option --' + k + '. See: ' + CMD + ' help');
    const v = args[i + 1];
    if (v === undefined || v.indexOf('--') === 0) fail('Option --' + k + ' needs a value.');
    o[k] = v; i++;
  }
  return o;
}
function stakeOpt(v) {
  if (!/^\d+$/.test(String(v))) fail('--stake takes a number of lights out, 0..7.');
  return Math.max(0, Math.min(7, parseInt(v, 10)));
}
function awaitingInput() { return ST.client.scene === 'duel' && G.run && G.run.duel && G.run.pending && ST.client.S && ST.client.S.input; }
function ensureScene() {
  // A profile whose last command left the duel without a live scene (should not happen) resumes like a reload.
  if (ST.client.scene === 'duel' && !(awaitingInput())) { if (hasRun()) resume(); else go('title'); return false; }
  return true;
}
function cmdShow() {
  const sc = ST.client.scene;
  if (sc === 'duel') { if (ensureScene()) renderDuel(); }
  else if (sc === 'bonfire') {
    if (!G.run || !G.run.offer) { go('title'); return; }
    for (const s of ST.client.bonfireSaid || []) out('IT (earlier): "' + s + '"');
    for (const l of bonfireScreen()) out(l);
  }
  else if (sc === 'death') renderDeath(false);
  else if (sc === 'victory') renderVictory(false);
  else if (sc === 'relic') renderRelic();
  else renderTitle();
}
function cmdNew(o) {
  if (hasRun()) fail('A run is in progress (' + (G.run.stage === 'bonfire' ? 'at a bonfire' : 'duel ' + G.run.duelN) + '). Finish it, or: ' + CMD + ' abandon ' + P);
  if (o.unlocks) {
    if (o.unlocks !== 'natural' && o.unlocks !== 'all') fail('--unlocks is natural or all');
    ST.opts.unlocks = o.unlocks;
  }
  if (ST.opts.unlocks === 'all') RUN.UNLOCKS.forEach(function (u) { G.meta.unlocked[u.id] = true; });
  if (o.boss && !RUN.BOSSES.some(function (b) { return b.id === o.boss; })) fail('Unknown face: ' + o.boss + '. Faces: ' + RUN.BOSSES.map(function (b) { return b.id; }).join(', '));
  if (o.start !== undefined && o.start !== '7') fail('--start only takes 7');
  if (o.seed !== undefined && !/^\d+$/.test(o.seed)) fail('--seed takes a non-negative integer');
  if (o.relic && o.relic !== 'none' && !RUN.relics(G.meta).some(function (b) { return b.id === o.relic; })) fail('Relic not owned: ' + o.relic + '. Owned: ' + (RUN.relics(G.meta).map(function (b) { return b.id; }).join(', ') || 'none'));
  const stake = o.stake !== undefined ? stakeOpt(o.stake) : null;
  // ten minutes since the previous run; a long op log means the app was closed between sessions
  if (G.meta.memory.runs > 0) ST.client.clock += RUN_GAP_MS;
  if (ST.brainOps.length > OPLOG_COMPACT) boot(false);
  const vg = RUN.repairMeta(G.meta).vigil;
  if (stake !== null) {
    if (ST.opts.unlocks === 'all') ST.opts.stakeAll = stake; else vg.sel = Math.min(stake, vg.max);
    if (ST.opts.unlocks !== 'all' && stake > vg.max) out('[stake clamped to the ' + vg.max + ' light' + (vg.max === 1 ? '' : 's') + ' this profile has earned]');
  }
  const pend = { seed: o.seed !== undefined ? Number(o.seed) : undefined, boss: o.boss || null, start7: o.start === '7' };
  if (o.relic === undefined && (RUN.relics(G.meta).length || vg.max > 0)) {      // main.js startFlow: the relic screen first
    ST.client.relicPending = pend;
    go('relic');
    return;
  }
  newRun(o.relic && o.relic !== 'none' ? o.relic : null, pend);
}
function cmdRelic(id, o) {
  if (ST.client.scene !== 'relic') fail('The relic choice is not on screen.');
  if (!id) fail('relic needs a relic id, or: relic none');
  const vg = RUN.repairMeta(G.meta).vigil;
  if (id !== 'none' && !RUN.relics(G.meta).some(function (b) { return b.id === id; })) fail('Not a relic you own: ' + id);
  if (o.stake !== undefined) {
    const n = stakeOpt(o.stake);
    if (ST.opts.unlocks === 'all') ST.opts.stakeAll = n; else vg.sel = Math.min(n, vg.max);
  }
  const pend = ST.client.relicPending || {};
  ST.client.relicPending = null;
  newRun(id !== 'none' ? id : null, pend);
}
function parseMove(s) {
  s = String(s || '').toUpperCase();
  if (s === 'S' || s === '1' || s === 'STRIKE') return 'S';
  if (s === 'G' || s === '2' || s === 'GUARD') return 'G';
  if (s === 'F' || s === '3' || s === 'FEINT') return 'F';
  return null;
}
function cmdMove(m) {
  if (!awaitingInput()) fail('No move is being asked for right now. Use: ' + CMD + ' show ' + P);
  const pm = parseMove(m);
  if (!pm) fail('Move is S, G or F.');
  const duel = G.run.duel, S = ST.client.S;
  if (C.legal(duel, 'p').indexOf(pm) < 0) fail(mname(pm) + ' is not available this turn (' + (pm === 'G' && duel.p.status.guardBroken > 0 ? 'guard broken' : 'sealed') + ').');
  if (S.only && S.only !== pm) fail('The tutorial wants ' + mname(S.only).toUpperCase() + ' this turn.');
  const res = turnResolve(pm, false);
  runDuel();
  return res;
}
// duel.js useActive()
function cmdActive(id) {
  if (!awaitingInput()) fail('Actives can be used only while a move is being asked for.');
  const duel = G.run.duel, S = ST.client.S;
  const acts = activesOf(duel);
  if (!id) fail('active needs a boon id. Yours: ' + (acts.join(', ') || 'none'));
  if (acts.indexOf(id) < 0) fail('Not one of your actives: ' + id + '. Yours: ' + (acts.join(', ') || 'none'));
  if (S.only || !(duel.p.charges && duel.p.charges[id] > 0)) fail('That active cannot be used now.');
  const r = C.useActive(duel, id);
  if (!r || !r.ok) fail('That active cannot be used now.');
  floatsLine(['you ' + boonName(id).toUpperCase()]);
  out('   log: you use ' + boonName(id) + ' (' + r.left + ' left this duel).');
  if (r.kind === 'coin') {
    const lp = C.legal(duel, 'p');
    const pm = G.rng.pick(lp);
    S.coinMove = pm;
    out('The coin decides for you.');
    const res = turnResolve(pm, true);
    runDuel();
    return res;
  }
  const pend = G.run.pending;
  if (r.kind === 'glimpse' || r.kind === 'honesty') pend['seen_' + r.kind] = true;
  save();
  renderDuel();
  return null;
}
function cmdReload() {
  out('(The app is closed and opened again.)');
  boot(false);
  renderTitle();
  if (hasRun()) { out('(You tap CONTINUE.)'); resume(); }
  else ST.client.scene = 'title';
}
function cmdWait(days) {
  const d = Number(days);
  if (days === undefined || !(d >= 0 && d <= 3650)) fail('wait takes a number of days (0..3650).');
  ST.client.clock += Math.round(d * 86.4e6);
  out('(' + d + ' day' + (d === 1 ? '' : 's') + ' pass. The game was not opened.)');
}

function usage() {
  const faces = RUN.BOSSES.map(function (b) { return b.id; }).join('|');
  return [
    'Commands (any folder works; add --profiles <dir> to use another profiles folder):',
    '  ' + CMD + ' new <profile> [--unlocks natural|all] [--stake N] [--boss ' + faces + '] [--relic <id>|none] [--start 7] [--seed N]',
    '  ' + CMD + ' show <profile>               reprint the current screen',
    '  ' + CMD + ' move <profile> S|G|F         also 1|2|3 or STRIKE|GUARD|FEINT (alias: play)',
    '  ' + CMD + ' active <profile> <boonId>    use an active boon (alias: use)',
    '  ' + CMD + ' relic <profile> <relicId|none> [--stake N]',
    '  ' + CMD + ' draft <profile> <boonId|none>',
    '  ' + CMD + ' ledger|dossier|unlocks <profile>',
    '  ' + CMD + ' reload <profile>             close and reopen the app',
    '  ' + CMD + ' wait <profile> <days>        days pass without opening the game (0..3650)',
    '  ' + CMD + ' abandon <profile>            walk away from the run (counts as a death)',
    '  ' + CMD + ' selftest [--quick] [--seed N] [--profiles <dir>] [--keep]',
    '  ' + CMD + ' pins [--update]              check or refresh the scene-mirror pins',
    'Faces: ' + RUN.BOSSES.map(function (b) { return b.id; }).join(', '),
    'Test options (the game has none of these): --unlocks all, --start 7, --boss, --seed, and --stake beyond the lights earned.'
  ].join('\n');
}

// One command. Returns { out, ok, res?, user?, crash?, err? }.
function exec(argv, opts) { return withClient(function () { return execCommand(argv, opts); }); }
function execCommand(argv, opts) {
  opts = opts || {};
  OUT = []; SAY = []; QUIET = !!opts.quiet; P = null; CALL_ROOT = null;
  if (TRACE) TRACE.last = null;                   // self-test: what this command seals or resumes
  argv = (argv || []).map(String);
  let ret = null;
  try {
    const pi = argv.indexOf('--profiles');
    if (pi >= 0) {
      const v = argv[pi + 1];
      if (!v || v.indexOf('--') === 0) fail('Option --profiles needs a folder.');
      CALL_ROOT = path.resolve(v);
      argv.splice(pi, 2);
    }
    let cmd = argv[0];
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { out(usage()); return { out: OUT.join('\n'), ok: true }; }
    if (ALIASES[cmd]) cmd = ALIASES[cmd];
    if (COMMANDS.indexOf(cmd) < 0) fail('Unknown command: ' + cmd + '\n' + usage());
    const o = parseOpts(argv.slice(2), OPTIONS[cmd]);
    open(argv[1], cmd === 'new');
    switch (cmd) {
      case 'new': cmdNew(o); break;
      case 'show': cmdShow(); break;
      case 'move': ret = cmdMove(o._[0]); break;
      case 'active': ret = cmdActive(o._[0]); break;
      case 'relic': cmdRelic(o._[0], o); break;
      case 'draft':
        if (ST.client.scene !== 'bonfire' || !G.run || !G.run.offer) fail('There is no bonfire on screen.');
        draft(o._[0]); break;
      case 'ledger': ledger(); break;
      case 'dossier': dossier(); break;
      case 'unlocks': unlocks(); break;
      case 'reload': cmdReload(); break;
      case 'wait': cmdWait(o._[0]); break;
      case 'abandon': abandon(); break;
    }
    save();
  } catch (e) {
    if (!e.user) { out('INTERNAL ERROR: ' + (e && e.stack || e)); finishOut(argv); return { out: OUT.join('\n'), ok: false, crash: true, err: e }; }
    out('! ' + e.message);
    finishOut(argv);
    return { out: OUT.join('\n'), ok: false, user: true };
  }
  finishOut(argv);
  return { out: OUT.join('\n'), ok: true, res: ret };
}
function finishOut(argv) {
  if (QUIET || !P) return;
  try {
    const dir = profileDir(P);
    if (!fs.existsSync(dir)) return;
    fs.appendFileSync(path.join(dir, 'transcript.md'), '\n$ ' + CMD + ' ' + argv.join(' ') + '\n```\n' + OUT.join('\n') + '\n```\n');
  } catch (e) { /* the transcript must never stop play */ }
}

// ------------------------------------------------------------------ mirror pins
// Every src function whose logic this client copies or follows, small helpers included (the Called Shot target, the
// low-HP test, the 3-line bubble cut, the move lock...). The pin is the SHA-256 of its LF-normalised source, from the
// declaration line to the closing brace at the same indentation (`grep` keeps only the matching lines). R.SceneKit
// helpers are called directly and need no pin. Pure drawing, layout, sound and hit-test functions are not mirrored.
const MIRROR = [
  { file: 'src/scenes/duel.js', fns: ['mname', 'boonName', 'taunt', 'low', 'hasEv', 'say', 'cfgOf', 'setForm', 'argmaxMove', 'setLegal', 'hintFor',
                                     'tutorialBeat', 'tutorialResult', 'flow', 'introLine', 'intro', 'turn', 'reaction',
                                     'showEvents', 'present', 'outro', 'bossTaunt', 'showCards', 'transform', 'canPick', 'useActive', 'pick',
                                     'ledgerPage', 'vigilPage', 'openLedger', 'enter'] },
  { file: 'src/scenes/duel.js', fn: 'drawButtons', part: 'hint row', grep: /S\.hint \|\| S\.infoLine/ },
  { file: 'src/scenes/bonfire.js', fns: ['rivalLine', 'flow', 'leave', 'enter'] },
  { file: 'src/scenes/death.js', fns: ['tap', 'enter'] },
  { file: 'src/scenes/victory.js', fns: ['tap', 'enter'] },
  { file: 'src/scenes/credits.js', fns: ['cast', 'build', 'enter'] },
  { file: 'src/scenes/dossier.js', fns: ['header', 'line', 'build'] },
  { file: 'src/scenes/unlocks.js', fns: ['build'] },
  { file: 'src/scenes/relic.js', fns: ['viewLight', 'refreshLabel', 'tapLight', 'confirm', 'enter'] },
  { file: 'src/scenes/title.js', fns: ['memory', 'refresh', 'begin', 'activate'] },
  { file: 'src/main.js', fns: ['validRun', 'nextGoal', 'hasRun', 'startFlow', 'newRun', 'resume', 'duelOver', 'draft', 'abandon', 'vars', 'boot'] },
  { file: 'src/text/taunts.js', fns: ['freshOrder', 'draw', 'taunt'] }
].reduce(function (all, m) {
  if (m.fns) m.fns.forEach(function (fn) { all.push({ file: m.file, fn: fn }); });
  else all.push(m);
  return all;
}, []);
function pinId(m) { return m.file + ':' + m.fn + (m.part ? ' (' + m.part + ')' : ''); }
function extractPin(m) {
  let text;
  try { text = lf(fs.readFileSync(path.join(REPO, m.file), 'utf8')); } catch (e) { return { err: 'file not found' }; }
  const lines = text.split('\n');
  const n = m.fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp('^(\\s*)(?:function\\*?\\s+' + n + '\\s*\\(|' + n + '\\s*:\\s*function\\*?\\s*\\(|(?:var\\s+)?(?:[\\w$]+\\.)*' + n + '\\s*=\\s*function\\*?\\s*\\()');
  const hits = [];
  for (let i = 0; i < lines.length; i++) { const x = decl.exec(lines[i]); if (x) hits.push({ i: i, ind: x[1] }); }
  if (hits.length !== 1) return { err: hits.length ? 'declared ' + hits.length + ' times' : 'function not found' };
  const start = hits[0].i;
  let end = start;
  if (/\{\s*$/.test(lines[start].replace(/\s\/\/.*$/, ''))) {        // multi-line: up to the brace at the same indentation
    const close = new RegExp('^' + hits[0].ind + '\\}');
    end = -1;
    for (let i = start + 1; i < lines.length; i++) if (close.test(lines[i])) { end = i; break; }
    if (end < 0) return { err: 'closing brace not found' };
  }
  let body = lines.slice(start, end + 1);
  if (m.grep) body = body.filter(function (l) { return m.grep.test(l); });
  if (!body.length) return { err: 'no matching lines' };
  return { start: start + 1, end: end + 1, sha256: sha(body.join('\n')) };
}
function checkPins() {
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8')); } catch (e) { saved = null; }
  const want = {}, rows = [], problems = [];
  if (!saved || !Array.isArray(saved.pins)) problems.push('mirror pins: tools/playtest/mirror.json is missing or unreadable (create it with: ' + CMD + ' pins --update)');
  else for (const p of saved.pins) want[pinId(p)] = p.sha256;
  for (const m of MIRROR) {
    const id = pinId(m), x = extractPin(m);
    let state = 'ok';
    if (x.err) state = 'changed (' + x.err + ')';
    else if (saved && !want[id]) state = 'unpinned';
    else if (saved && want[id] !== x.sha256) state = 'changed';
    rows.push({ id: id, m: m, x: x, state: state });
    if (state === 'unpinned') problems.push('mirror pin missing for ' + id + ': mirror it into tools/playtest/play.js, then update the pin');
    else if (state !== 'ok' && saved) problems.push('scene logic changed in ' + id + ': mirror it into tools/playtest/play.js, then update the pin' + (x.err ? ' (' + x.err + ')' : ''));
    delete want[id];
  }
  for (const id in want) problems.push('mirror pin for ' + id + ' is no longer in the mirror list: update the pins');
  return { rows: rows, problems: problems, ok: rows.filter(function (r) { return r.state === 'ok'; }).length };
}
function cmdPins(update) {
  const c = checkPins(), L = [];
  for (const r of c.rows) L.push((r.state === 'ok' ? 'ok       ' : r.state === 'unpinned' ? 'UNPINNED ' : 'CHANGED  ') + r.id + (r.x.err ? '  (' + r.x.err + ')' : '  lines ' + r.x.start + '-' + r.x.end));
  if (update) {
    const bad = c.rows.filter(function (r) { return r.x.err; });
    if (bad.length) { L.push('! Cannot pin: ' + bad.map(function (r) { return r.id + ' (' + r.x.err + ')'; }).join(', ')); return { text: L.join('\n'), code: 1 }; }
    const doc = {
      about: 'SHA-256 of the LF-normalised source of each src function that tools/playtest/play.js mirrors, from its declaration line to its closing brace (a "part" entry hashes only its matching lines). The self-test fails when one changes. Mirror the change into play.js first, then refresh with: ' + CMD + ' pins --update',
      pins: c.rows.map(function (r) { const p = { file: r.m.file, fn: r.m.fn }; if (r.m.part) p.part = r.m.part; p.sha256 = r.x.sha256; return p; })
    };
    fs.writeFileSync(MIRROR_FILE, JSON.stringify(doc, null, 1) + '\n');
    L.push('Wrote ' + c.rows.length + ' pins to tools/playtest/mirror.json.');
    return { text: L.join('\n'), code: 0 };
  }
  for (const p of c.problems) L.push('FAIL: ' + p);
  L.push(c.problems.length ? c.problems.length + ' pin problem(s).' : 'All ' + c.ok + ' pins match.');
  return { text: L.join('\n'), code: c.problems.length ? 1 : 0 };
}

// ------------------------------------------------------------------ self-test
// No absolute local paths in the tracked client files (patterns built from pieces so they do not match themselves).
function pathScan(skipRoot) {
  const pats = [new RegExp('(^|[^A-Za-z0-9])[A-Za-z]:[\\\\/]'), new RegExp('[\\\\/]' + 'Us' + 'ers' + '[\\\\/]'), new RegExp('/' + 'home' + '/'),
                new RegExp('App' + 'Data', 'i'), new RegExp('scratch' + 'pad', 'i')];
  const hits = [];
  const files = listFiles(HERE, function (full, rel) { return rel === 'profiles' || (skipRoot && path.resolve(full) === skipRoot); });
  for (const f of files) {
    const lines = lf(fs.readFileSync(path.join(HERE, f), 'utf8')).split('\n');
    lines.forEach(function (l, i) { for (const re of pats) if (re.test(l)) { hits.push('tools/playtest/' + f + ':' + (i + 1)); break; } });
  }
  return hits;
}
// What a misdirected self-test write would leave behind: a change in src/, a _selftest_ entry outside its own
// profiles folder (repo root, tools/, this folder, the working folder), or a change in the default profiles folder.
// (Files that people edit, such as this folder's docs, are not compared: they may change while the test runs.)
function outsideSnapshot(root) {
  const r = path.resolve(root);
  const snap = { src: treeHash(SRC), stray: [], profiles: null };
  for (const d of [process.cwd(), REPO, path.join(REPO, 'tools'), HERE, DEFAULT_PROFILES]) {
    if (path.resolve(d) === r) continue;
    let names = [];
    try { names = fs.readdirSync(d); } catch (e) { names = []; }
    for (const nm of names) if (nm.indexOf('_selftest_') === 0) snap.stray.push(path.join(d, nm));
  }
  snap.stray.sort();
  if (r !== path.resolve(DEFAULT_PROFILES) && fs.existsSync(DEFAULT_PROFILES)) {
    snap.profiles = listFiles(DEFAULT_PROFILES).map(function (f) { const s = fs.statSync(path.join(DEFAULT_PROFILES, f)); return f + ':' + s.size + ':' + s.mtimeMs; }).join('\n');
  }
  return JSON.stringify(snap);
}
function selftest(opts) { return withClient(function () { return runSelftest(opts); }); }
function runSelftest(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const quick = !!opts.quick, keep = !!opts.keep;
  const seed = opts.seed !== undefined ? (Number(opts.seed) >>> 0) : 1;
  const made = opts.profiles ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'rival-playtest-'));
  const root = opts.profiles ? path.resolve(String(opts.profiles)) : made;
  fs.mkdirSync(root, { recursive: true });
  const prev = { root: ROOT_OVERRIDE, entropy: ENTROPY_SEED, envP: process.env[ENV_PROFILES], envE: process.env[ENV_ENTROPY] };
  ROOT_OVERRIDE = root; ENTROPY_SEED = String(seed);
  process.env[ENV_PROFILES] = root; process.env[ENV_ENTROPY] = String(seed);
  const outsideBefore = outsideSnapshot(root);
  const log = [], problems = [];
  function bad(s) { problems.push(s); if (problems.length <= 25) log.push('FAIL: ' + s); }
  const prefix = '_selftest_';
  function clearOld() { if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) if (d.indexOf(prefix) === 0) fs.rmSync(path.join(root, d), { recursive: true, force: true }); }
  const LEAK = [/\bhonest\s*[:=]/i, /\bexploit\b/i, /\bconfidence\b/i, /\bpred\b/i, /\bmode\s*[:=]/i, /sealed\.\w/i, /"(move|tell|honest|top|pred)"\s*:/i,
                /\bequilibrium\b/i, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/];
  // client wording that the earlier scratch client printed and a playtest triaged as its own artifacts
  const ARTIFACT = [[/\b(you|it) -0\b/, '"-0" damage'], [/\bIts THE /, '"Its THE ..." boon line'], [/\bis lifted\b/, '"is lifted"'],
                    [/(\byou cannot Guard\b[^\n]*\byou cannot Guard\b)|(\bit cannot Guard\b[^\n]*\bit cannot Guard\b)/, 'a doubled "cannot Guard" line']];
  const dice = R.RNG.create(crypto.createHash('sha256').update('selftest|' + seed).digest().readUInt32LE(0) || 1);
  const n = { screens: 0, runs: 0, cover: 0, turns: 0, reloads: 0, indep: 0, illegal: 0, seals: 0, replays: 0, invariance: 0, wins: 0, phases: 0, bonfires: 0, actives: 0, tutorials: 0 };
  const faces = {}, stakes = {}, endings = {};
  const cov = { stance: 0, noTell: 0, mimic: 0, called: 0, coin: 0, resumed: 0, tutorial: 0 };
  let cliOk = true, pins = null, paths = [];
  function readState(name) { return JSON.parse(fs.readFileSync(path.join(profileDir(name), 'save.json'), 'utf8')); }
  function rawState(name) { return fs.readFileSync(path.join(profileDir(name), 'save.json'), 'utf8'); }
  function writeRaw(name, s) { fs.writeFileSync(path.join(profileDir(name), 'save.json'), s); }
  function scan(text, ctx) {
    n.screens++;
    for (const re of LEAK) if (re.test(text)) { bad('leak pattern ' + re + ' in ' + ctx + ':\n' + text.split('\n').filter(function (l) { return re.test(l); }).slice(0, 2).join('\n')); break; }
    for (const a of ARTIFACT) if (a[0].test(text)) bad('client wording artifact (' + a[1] + ') in ' + ctx + ': ' + text.split('\n').filter(function (l) { return a[0].test(l); })[0]);
    if (/HONESTY ~/.test(text) && !/liars_tally/.test(JSON.stringify((ST && ST.run && ST.run.duel && ST.run.duel.p.boons) || []))) bad('honesty % shown without Liar\'s Tally in ' + ctx);
  }
  function drain() { while (TRACE.problems.length) bad(TRACE.problems.shift()); }
  let curSeal = null, resumedKey = null;
  function run(argv, ctx) {
    const r = exec(argv, { quiet: false });
    drain();
    if (r.crash) { bad('crash on ' + argv.join(' ') + ': ' + (r.err && r.err.stack)); throw new Error('selftest-abort'); }
    scan(r.out, ctx || argv.join(' '));
    const tr = TRACE.last;                       // exec() clears it: only what this command sealed or resumed
    if (tr && tr.k === 'seal') { curSeal = tr; resumedKey = null; }
    else if (tr && tr.k === 'resume') resumedKey = tr.key;
    return r;
  }
  // counterfactual render: the input screen must not change when the hidden parts of the commit change
  function invarianceCheck() {                   // on the state just opened; restores it
    if (!awaitingInput()) return;
    const sealed = G.run.pending.sealed;
    const a = duelScreen();
    G.run.pending.sealed = altCommit(sealed);
    const b = duelScreen();
    G.run.pending.sealed = sealed;
    n.invariance++;
    if (a.length !== b.length) { bad('screen length depends on hidden commit fields'); return; }
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !revealLine(a[i])) bad('hidden commit field reaches the screen: "' + a[i] + '" vs "' + b[i] + '"');
  }
  // The commit that made this screen, replayed from the saved brain (brainBase + op log) and the saved dice state:
  // it must come out identical, so the seal depends on nothing but the state before the player's window.
  function replayCommit(tr) {
    const b = rebuildBrain(ST.brainBase, ST.brainOps);
    const rng = R.RNG.create(1); rng.setState(tr.rngBefore);
    const q = JSON.parse(tr.q); q.rng = rng;
    const again = b.commit(q);
    n.replays++;
    if (sha(JSON.stringify(again)) !== tr.h || (rng.state() >>> 0) !== tr.rngAfter) bad('counterfactual commit for ' + tr.key + ': replaying it from the saved brain and dice does not reproduce the sealed commit');
  }
  // The sealed move must not depend on the move then played: restore the same save and play S, G and F in turn.
  // Legal moves must resolve against the sealed move; illegal ones (sealed, guard broken, tutorial-locked) must be
  // refused and leave the save byte-identical.
  function independence(name, sealed, kind, lp, only) {
    const raw = rawState(name);
    for (const m of MOVES) {
      writeRaw(name, raw);
      const legal = lp.indexOf(m) >= 0 && !(only && only !== m);
      const rr = exec(['move', name, m], { quiet: true });
      drain();
      if (rr.crash) { bad('crash in the independence check: ' + (rr.err && rr.err.stack)); break; }
      scan(rr.out, 'independence check, move ' + m);
      if (legal) {
        if (!rr.ok || !rr.res) bad('legal move ' + m + ' refused in the independence check: ' + rr.out.split('\n').pop());
        else if (rr.res.rm !== sealed.move) bad('Rival move ' + rr.res.rm + ' differs from the sealed ' + sealed.move + ' when the player plays ' + m);
      } else {
        n.illegal++;
        if (rr.ok) bad('illegal move ' + m + ' was accepted');
        if (rawState(name) !== raw) bad('refused move ' + m + ' changed the save');
      }
    }
    writeRaw(name, raw);
    n.indep++;
    for (const k in kind) if (kind[k] && k !== 'coin') cov[k]++;
  }

  const FACES = RUN.BOSSES.map(function (b) { return b.id; });
  const blankFace = RUN.BOSSES.filter(function (b) { return b.phases.some(function (p) { return p.stance === 'none'; }); }).map(function (b) { return b.id; })[0] || null;
  const mirrorFace = RUN.BOSSES.filter(function (b) { return b.phases.some(function (p) { return p.mimic; }); }).map(function (b) { return b.id; })[0] || null;
  const coinId = Object.keys(R.Boons.byId).filter(function (id) { const b = R.Boons.byId[id]; return b.who === 'player' && b.active && b.active.kind === 'coin'; })[0] || null;
  const PLAN = [];
  ['natural', 'all'].forEach(function (u) {
    FACES.forEach(function (f, fi) {
      const name = prefix + u + '_' + f;
      if (quick) PLAN.push({ name: name, unlocks: u, face: f, stake: [0, 4, 7][fi % 3], start7: fi !== 0 });
      else for (let i = 0; i < 6; i++) PLAN.push({ name: name, unlocks: u, face: f, stake: [0, 4, 7][i % 3], start7: (i + fi) % 2 === 1 });
    });
  });
  PLAN.forEach(function (job, ji) { job.oracle = ji % 2 ? 0.25 : 0.65; });
  const planned = PLAN.length;
  // coverage scenarios: every turn checked, a policy that peeks at the commit to win (to reach every phase)
  if (coinId) PLAN.push({ name: prefix + 'cover_coin', unlocks: 'all', stake: 7, relic: 'none', oracle: 1, every: true, coin: true, cover: true });
  if (blankFace) PLAN.push({ name: prefix + 'cover_blank', unlocks: 'all', face: blankFace, stake: 0, relic: 'none', start7: true, oracle: 1, every: true, reloadAt: 2, cover: true });
  if (mirrorFace) PLAN.push({ name: prefix + 'cover_mirror', unlocks: 'all', face: mirrorFace, stake: 0, relic: 'none', start7: true, oracle: 1, every: true, reloadAt: 2, cover: true });
  // and one fresh profile that plays into the sealed move after the tutorial, so a run always ends on the death screen
  PLAN.push({ name: prefix + 'cover_death', unlocks: 'natural', stake: 0, relic: 'none', oracle: 0, lose: true, cover: true });

  try {
    TRACE = { screens: 0, prePick: 0, problems: [], last: null };
    clearOld();
    for (const job of PLAN) {
      const args = ['new', job.name, '--unlocks', job.unlocks, '--stake', String(job.stake)];
      if (job.face) args.push('--boss', job.face);
      if (job.start7) args.push('--start', '7');
      if (job.relic) args.push('--relic', job.relic);
      run(args);
      open(job.name, false);
      if (ST.client.scene === 'relic') {
        const owned = RUN.relics(G.meta).map(function (b) { return b.id; });
        const pick = dice.next() < 0.4 || !owned.length ? 'none' : owned[dice.int(owned.length)];
        run(['relic', job.name, pick]);
      }
      open(job.name, false);
      if (!G.run) { bad('no run after new for ' + job.name); continue; }
      if (job.cover) n.cover++; else n.runs++;
      faces[G.run.boss] = (faces[G.run.boss] || 0) + 1;
      stakes[RUN.stakeOf(G.run)] = (stakes[RUN.stakeOf(G.run)] || 0) + 1;
      if (ST.client.S && ST.client.S.tutorial) n.tutorials++;
      let steps = 0, lastPhase = 1, coinDone = false, calledDone = false;
      for (;;) {
        if (++steps > 900) { bad('stuck: more than 900 commands in one run of ' + job.name); break; }
        open(job.name, false);
        const sc = ST.client.scene;
        if (sc === 'death' || sc === 'victory' || sc === 'title') { endings[sc] = (endings[sc] || 0) + 1; if (sc === 'victory') n.wins++; break; }
        if (sc === 'bonfire') {
          n.bonfires++;
          if (job.coin && !coinDone && G.run.offer.choices.indexOf(coinId) < 0) {      // fixture: put the coin among the cards
            const st = readState(job.name);
            if (st.run.offer.choices.length) st.run.offer.choices[0] = coinId; else st.run.offer.choices.push(coinId);
            writeRaw(job.name, JSON.stringify(st));
            open(job.name, false);
          }
          const ch = G.run.offer.choices;
          if (dice.next() < 0.1) run(['show', job.name]);
          if (dice.next() < 0.08) { run(['reload', job.name]); n.reloads++; }
          if (dice.next() < 0.05) run(['ledger', job.name]);
          run(['draft', job.name, job.coin && !coinDone && ch.indexOf(coinId) >= 0 ? coinId : ch.length ? ch[dice.int(ch.length)] : 'none']);
          continue;
        }
        if (sc !== 'duel' || !awaitingInput()) { bad('unexpected state ' + sc + ' in ' + job.name); break; }
        if (G.run.duel.phase > lastPhase) { n.phases++; lastPhase = G.run.duel.phase; }
        const key = keyOf(G.run.pending);
        const sealed = JSON.parse(JSON.stringify(G.run.pending.sealed));
        const sampled = G.run.duel.turn === 1 || G.run.duel.turn === 3;     // --quick: turn 1 and a later turn of each duel and phase
        // 1. the commit on screen is the one traced at its seal, and it replays identically from the saved state
        if (!curSeal || curSeal.key !== key) bad('seal-before-print: the commit for ' + key + ' (' + job.name + ') was never traced as it was sealed');
        else if (curSeal.h !== sha(JSON.stringify(G.run.pending.sealed))) bad('counterfactual commit for ' + key + ' (' + job.name + '): the commit on screen is not the one sealed for this turn');
        else if (!curSeal.done) {
          curSeal.done = true; n.seals++;
          if (job.every || !quick || sampled || G.run.pending.called) replayCommit(curSeal);
        }
        // 2. the input screen never shows hidden fields
        invarianceCheck();
        // 3. reload mid-turn keeps the same commit
        if (dice.next() < 0.06 || (job.reloadAt && G.run.duel.turn === job.reloadAt)) {
          run(['reload', job.name]); n.reloads++;
          const st2 = readState(job.name);
          if (!st2.run || !st2.run.pending || JSON.stringify(st2.run.pending.sealed) !== JSON.stringify(sealed)) bad('reload changed the sealed commit (' + job.name + ')');
          open(job.name, false);
          if (!awaitingInput()) { bad('reload did not return to the input screen'); break; }
        }
        const duel = G.run.duel, S = ST.client.S, lp = C.legal(duel, 'p'), only = S.only;
        const kind = { stance: !S.noStance && !duel.mimic, noTell: duel.stance === 'none', mimic: !!duel.mimic, called: !!G.run.pending.called,
                       tutorial: !!S.only, resumed: resumedKey === key };
        // 4. an active, sometimes (decided before the independence check, so a coin turn is checked too)
        const acts = activesOf(duel).filter(function (id) { return duel.p.charges[id] > 0; });
        let act = null;
        if (acts.length && !S.only) {
          const coins = acts.filter(function (id) { return (R.Boons.byId[id].active || {}).kind === 'coin'; });
          if (job.coin && !coinDone && coins.length) act = coins[0];
          else if (dice.next() < 0.3) act = acts[dice.int(acts.length)];
        }
        const isCoin = !!(act && (R.Boons.byId[act].active || {}).kind === 'coin');
        // 5. the sealed move does not depend on which move is then played (all three, from the same save)
        const check = job.every || !quick || sampled || kind.called || kind.resumed || isCoin;
        if (check) { independence(job.name, sealed, kind, lp, only); if (kind.called) calledDone = true; }
        if (dice.next() < 0.04) run(['show', job.name]);
        if (dice.next() < 0.02) run(['dossier', job.name]);
        if (dice.next() < 0.02) run(['ledger', job.name]);
        if (act) {
          const r = run(['active', job.name, act]); n.actives++;
          if (!r.ok) { bad('active ' + act + ' refused: ' + r.out.split('\n').pop()); break; }
          if (r.res) {                                            // a coin played the move
            if (r.res.rm !== sealed.move) bad('coin turn: resolved Rival move differs from the sealed one');
            else if (isCoin && check) { cov.coin++; coinDone = true; }
            n.turns++;
            if (job.coin && coinDone && calledDone && hasLiveRun(job.name)) { run(['abandon', job.name]); endings.abandoned = (endings.abandoned || 0) + 1; break; }
            continue;
          }
          open(job.name, false);
          if (!awaitingInput()) { bad('active left the input screen'); break; }
          if (JSON.stringify(readState(job.name).run.pending.sealed) !== JSON.stringify(sealed)) bad('an active changed the sealed commit');
        }
        // the policy: the harness peeks at the commit to win more often (to reach bonfires, phases, victories).
        // An active that reveals (Keyhole, Candle of Truth) changes neither the legal moves nor the tutorial lock.
        // The losing policy plays a move that loses to the sealed one (R.LOSES_TO: key loses to value).
        let pm;
        if (only) pm = only;
        else if (job.lose) { const l = lp.filter(function (m) { return R.LOSES_TO[m] === sealed.move; }); pm = l.length ? l[0] : lp[dice.int(lp.length)]; }
        else if (dice.next() < job.oracle) { const w = R.LOSES_TO[sealed.move]; pm = lp.indexOf(w) >= 0 ? w : lp[dice.int(lp.length)]; }
        else pm = lp[dice.int(lp.length)];
        const r = run(['move', job.name, pm]);
        if (!r.ok) { bad('move refused: ' + r.out.split('\n').pop()); break; }
        if (r.res && r.res.rm !== sealed.move) bad('resolved Rival move differs from the sealed one');
        n.turns++;
        if (job.coin && coinDone && calledDone && hasLiveRun(job.name)) { run(['abandon', job.name]); endings.abandoned = (endings.abandoned || 0) + 1; break; }
      }
      run(['unlocks', job.name]);
    }
    // coverage: at least one independence check in each kind of turn the game has
    const need = { stance: true, noTell: !!blankFace, mimic: !!mirrorFace, called: true, coin: !!coinId, resumed: true, tutorial: true };
    for (const k in need) if (need[k] && !cov[k]) bad('coverage: no independence check in a ' + k + ' turn');
    if (!endings.death) bad('coverage: no run ended on the death screen');
    // every commit that reached an input screen was replayed (full), or at least some were (quick)
    if (!quick && n.replays !== n.seals) bad('counterfactual commit replays ' + n.replays + ' for ' + n.seals + ' sealed turns: every sealed turn must be replayed in a full run');
    if (n.seals !== n.turns) bad('sealed turns seen ' + n.seals + ' but turns played ' + n.turns + ': a turn was played without its seal being checked');
    if (!n.replays) bad('no counterfactual commit replay ran');
    if (TRACE.prePick < n.seals) bad('counterfactual pre-pick checks ' + TRACE.prePick + ' for ' + n.seals + ' sealed turns');
    if (!blankFace) log.push('NOTE: no face has a phase without a stance; noTell coverage skipped');
    if (!mirrorFace) log.push('NOTE: no face has a mimic phase; mimic coverage skipped');
    if (!coinId) log.push('NOTE: no coin active exists; coin coverage skipped');

    // a few real processes: one command per process, from another working folder, user errors exit 1
    const cp = require('child_process');
    const pn = prefix + 'cli';
    function spawn(a, env) { return cp.spawnSync(process.execPath, [__filename].concat(a), { encoding: 'utf8', cwd: root, env: env || process.env }); }
    function cli(a, code) {
      code = code || 0;
      const r = spawn(a);
      if (r.status !== code || /INTERNAL ERROR/.test(r.stdout)) { cliOk = false; bad('CLI ' + a.join(' ') + ' exited ' + r.status + ' (expected ' + code + '): ' + (r.stdout + r.stderr).slice(0, 300)); }
      scan(r.stdout, 'cli ' + a.join(' '));
      return r.stdout;
    }
    function sealedOf(name) { const st = readState(name); return JSON.stringify(st.run && st.run.pending && st.run.pending.sealed); }
    let o1 = cli(['new', pn, '--seed', '42']);
    if (!/^Moves: /m.test(o1) || !/first duel: the tutorial/.test(o1)) { cliOk = false; bad('CLI new: no tutorial input screen with a Moves line'); }
    o1 = cli(['move', pn, 'X'], 1);
    if (!/^! Move is S, G or F\./m.test(o1)) { cliOk = false; bad('bad move not rejected: ' + o1); }
    o1 = cli(['move', pn, 'S'], 1);
    if (!/^! The tutorial wants GUARD this turn\./m.test(o1)) { cliOk = false; bad('tutorial lock not enforced: ' + o1); }
    const s1 = sealedOf(pn);
    cli(['show', pn]); cli(['reload', pn]);
    if (s1 !== sealedOf(pn)) { cliOk = false; bad('CLI reload changed the commit'); }
    const env2 = Object.assign({}, process.env); delete env2[ENV_PROFILES];
    const rf = spawn(['show', pn, '--profiles', root], env2);
    if (rf.status !== 0 || !/^Moves: /m.test(rf.stdout)) { cliOk = false; bad('CLI --profiles flag did not reach the profile: ' + (rf.stdout + rf.stderr).slice(0, 300)); }
    cli(['play', pn, 'G']); cli(['move', pn, 'F']); cli(['move', pn, '1']);
    cli(['use', pn, 'no_such_boon'], 1);
    cli(['dossier', pn]); cli(['ledger', pn]); cli(['unlocks', pn]); cli(['wait', pn, '3']);
    cli(['help']); cli(['no_such_command', pn], 1);

    pins = checkPins();
    for (const p of pins.problems) bad(p);
    paths = pathScan(path.resolve(root));
    for (const p of paths) bad('absolute local path in ' + p);
  } catch (e) {
    if (!(e && e.message === 'selftest-abort')) bad('selftest crashed: ' + (e && e.stack || e));
  } finally {
    n.seal = TRACE ? TRACE.screens : 0;
    n.prePick = TRACE ? TRACE.prePick : 0;
    TRACE = null;
    ROOT_OVERRIDE = prev.root; ENTROPY_SEED = prev.entropy;
    if (prev.envP === undefined) delete process.env[ENV_PROFILES]; else process.env[ENV_PROFILES] = prev.envP;
    if (prev.envE === undefined) delete process.env[ENV_ENTROPY]; else process.env[ENV_ENTROPY] = prev.envE;
  }
  if (outsideSnapshot(root) !== outsideBefore) bad('the self-test wrote outside its profiles folder (src/ changed, a _selftest_ entry appeared elsewhere, or the default profiles folder changed)');
  if (!keep) {
    if (made) fs.rmSync(made, { recursive: true, force: true });
    else clearOld();
  } else process.stderr.write('selftest profiles kept in ' + root + '\n');
  const ms = Date.now() - t0;
  const summary = [
    'SELFTEST ' + (problems.length ? 'FAILED (' + problems.length + ' problems)' : 'PASSED'),
    'mode ' + (quick ? 'quick' : 'full') + ' · seed ' + seed + ' · game source ' + SRC_HASH.slice(0, 16),
    'runs ' + n.runs + ' (planned ' + planned + ') + coverage runs ' + n.cover + ' · turns ' + n.turns + ' · screens scanned ' + n.screens + ' · invariance checks ' + n.invariance,
    'endings ' + JSON.stringify(endings) + ' · victories ' + n.wins + ' · phase changes seen ' + n.phases + ' · bonfires ' + n.bonfires + ' · actives used ' + n.actives + ' · tutorials ' + n.tutorials,
    'faces ' + JSON.stringify(faces) + ' · stakes (effective) ' + JSON.stringify(stakes),
    'seal-before-print checks ' + n.seal + ' · reloads ' + n.reloads + ' (commit unchanged) · sealed turns ' + n.seals + ' · counterfactual commit replays ' + n.replays +
      ' · counterfactual pre-pick checks ' + n.prePick,
    'move-independence checks ' + n.indep + ' (S, G and F each; illegal moves refused, save unchanged: ' + n.illegal + ')',
    'coverage ' + Object.keys(cov).map(function (k) { return k + ' ' + cov[k]; }).join(' · '),
    'mirror pins ' + (pins ? pins.ok + '/' + pins.rows.length : 'not checked') + ' · path scan ' + (paths.length ? 'FAILED' : 'ok') + ' · CLI subprocess path ' + (cliOk ? 'ok' : 'FAILED'),
    'time ' + (ms / 1000).toFixed(1) + ' s'
  ];
  for (const l of log.slice(0, 30)) summary.push(l);
  return { ok: problems.length === 0, text: summary.join('\n') };
}
function hasLiveRun(name) { open(name, false); return hasRun() && awaitingInput(); }

// ------------------------------------------------------------------ main
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'selftest') {
    const o = {};
    let err = null;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--quick') o.quick = true;
      else if (a === '--keep') o.keep = true;
      else if (a === '--seed' && /^\d+$/.test(argv[i + 1] || '')) o.seed = Number(argv[++i]);
      else if (a === '--profiles' && argv[i + 1] && argv[i + 1].indexOf('--') !== 0) o.profiles = argv[++i];
      else { err = 'Unknown or incomplete selftest option: ' + a + '. Use: ' + CMD + ' selftest [--quick] [--seed N] [--profiles <dir>] [--keep]'; break; }
    }
    if (err) { process.stdout.write('! ' + err + '\n'); process.exit(1); }
    const r = selftest(o);
    process.stdout.write(r.text + '\n');
    process.exit(r.ok ? 0 : 1);
  }
  if (argv[0] === 'pins') {
    const extra = argv.slice(1).filter(function (a) { return a !== '--update'; });
    if (extra.length) { process.stdout.write('! pins takes only --update\n'); process.exit(1); }
    const r = cmdPins(argv.indexOf('--update') >= 0);
    process.stdout.write(r.text + '\n');
    process.exit(r.code);
  }
  const r = exec(argv);
  process.stdout.write(r.out + '\n');
  process.exit(r.crash ? 2 : r.user ? 1 : 0);
}
module.exports = { exec: exec, selftest: selftest, checkPins: checkPins };
