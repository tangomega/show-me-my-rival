// Headless harness for every menu scene (title, relic, bonfire, dossier, death, victory, credits, settings, unlocks).
// Real: rng, save, palette, font (width/wrap), strings, taunts, dossier text, brain, boons, combat, run, SceneKit + scenes.
// Fake: 2D context, R.Engine (manual clock, coroutines, tweens), R.Art / R.UI / R.FX / R.Audio (recorders), R.Game.
//   node tools/test_scenes.js
'use strict';
const p = require('path'), src = p.join(__dirname, '..', 'src');
for (const f of ['core/rng.js', 'core/save.js', 'art/palette.js', 'art/font.js', 'text/strings.js', 'text/taunts.js', 'text/dossier.js',
  'ai/brain.js', 'game/boons.js', 'game/combat.js', 'game/run.js']) require(p.join(src, f));
const R = globalThis.RIVAL;

// ---------------------------------------------------------------------------------------------- failures
let fails = 0, checks = 0, where = '';
const seen = new Set();
function fail(msg) {
  const k = where + ' :: ' + msg;
  if (seen.has(k)) return;
  seen.add(k); fails++;
  console.log('FAIL [' + where + '] ' + msg);
}
function ok(cond, msg) { checks++; if (!cond) fail(msg); }
function fin(...a) { return a.every(v => typeof v === 'number' && isFinite(v)); }

// ---------------------------------------------------------------------------------------------- recorders
const SPRITES = new Set(('icon_S icon_G icon_F icon_S_big icon_G_big icon_F_big mini_S mini_G mini_F st_guardBroken st_bleed st_fortify st_focus st_sealed ' +
  'act_glimpse act_honesty act_coin tag_RIP tag_TEN tag_BLD tag_TRK tag_GMB tag_INF tag_CHA tag_EXE tag_relic rar_common rar_uncommon rar_rare ' +
  'title_mask logo bonfire_player bonfire_rival lock mask_porcelain mask_mourner mask_jester mask_kintsugi mask_blank').split(' '));
const SFX = new Set('whoosh_s whoosh_f guard_up hit clang clash_s clash_g clash_f guard_break seal crack tick select back heal boon rival_draft deathblow final_blow you_died phase2 bell type unlock step ember'.split(' '));
const MUSIC = new Set(['title', 'drone', 'bonfire', 'boss', 'boss2', 'death', 'credits']);
const BGS = new Set(['cathedral', 'bonfire', 'title']);

const rec = { panels: [], buttons: [], texts: 0, sfx: [], music: [], muted: null, commits: 0 };
function beginFrame() { rec.panels.length = 0; rec.buttons.length = 0; }

const realWidth = R.Font.width;
R.Font.draw = function (g, text, x, y, pal, opts) {
  rec.texts++;
  if (typeof text !== 'string') { fail('Font.draw non-string: ' + String(text)); return; }
  if (!fin(x, y)) { fail('Font.draw NaN position for "' + text + '"'); return; }
  if (!(pal >= 1 && pal <= 31)) fail('Font.draw bad palette ' + pal + ' for "' + text + '"');
  if (/undefined|null|NaN|\{\w+\}/.test(text)) fail('suspicious text "' + text + '"');
  for (const ch of text) if (ch !== '\n' && !R.Font.has(ch) && !'’‘“”– ×'.includes(ch)) fail('glyph missing for "' + ch + '" in "' + text + '"');
  const scale = opts && opts.scale > 1 ? opts.scale | 0 : 1, w = realWidth(text, scale);
  const left = opts && opts.align === 'center' ? x - (w >> 1) : opts && opts.align === 'right' ? x - w : x, right = left + w;
  if (left < 0 || right > 180) fail('text off screen (' + left + '..' + right + '): "' + text + '"');
  if (opts && opts.shadow) return;                               // overlay text (floats, banners): screen bounds only
  let best = null;
  for (const q of rec.panels) {
    if (left >= q.x - 1 && left < q.x + q.w && y >= q.y && y < q.y + q.h && (!best || q.w * q.h < best.w * best.h)) best = q;
  }
  if (best) {
    if (left < best.x + best.pad || right > best.x + best.w - best.pad) fail('text wider than its ' + best.kind + ' (' + left + '..' + right + ' in ' + best.x + '..' + (best.x + best.w) + '): "' + text + '"');
    if (y + 7 * scale > best.y + best.h - 1) fail('text below its ' + best.kind + ' (y ' + y + ', ends ' + (best.y + best.h) + '): "' + text + '"');
  }
};
R.UI = {
  panel(g, x, y, w, h, style) { ok(fin(x, y, w, h) && w > 0 && h > 0, 'panel bad rect ' + [x, y, w, h]); rec.panels.push({ kind: 'panel', x, y, w, h, pad: 3 }); ok(x >= 0 && x + w <= 180, 'panel off screen'); },
  button(g, x, y, w, h, label, st) {
    ok(fin(x, y, w, h) && w > 0 && h > 0, 'button bad rect');
    ok(h >= 20, 'button shorter than 20 px: "' + label + '" h=' + h);
    ok(x >= 0 && x + w <= 180 && y >= E.safe.top && y + h <= E.H - E.safe.bottom, 'button outside the safe area: "' + label + '" ' + [x, y, w, h]);
    if (label) ok(realWidth(label) <= w - 8, 'button label too wide: "' + label + '" ' + realWidth(label) + ' > ' + (w - 8));
    rec.buttons.push({ x, y, w, h, label, disabled: !!(st && st.disabled) });
    rec.panels.push({ kind: 'button', x, y, w, h, pad: 4 });
  },
  bubble(g, x, y, w, lines) {
    ok(lines.length <= 3, 'bubble with ' + lines.length + ' lines');
    for (const l of lines) ok(realWidth(l) <= w - 8, 'bubble line too wide: "' + l + '"');
    return Math.max(1, lines.length) * 9 + 5;
  },
  bubbleH(n) { return Math.max(1, n) * 9 + 5; },
  bar(g, x, y, w, h, frac, lag) { ok(fin(x, y, w, h, frac, lag), 'bar NaN ' + [x, y, w, h, frac, lag]); },
  hit(px, py, x, y, w, h) { return px >= x && py >= y && px < x + w && py < y + h; }
};
R.Art = {
  init() {}, anim() { return null; }, frameAt() { return 0; }, fighter() {}, sigil() {},
  sprite(g, name, x, y) { ok(SPRITES.has(name), 'unknown sprite "' + name + '"'); ok(fin(x, y), 'sprite NaN position ' + name); },
  bg(g, name, t, opts) { ok(BGS.has(name), 'unknown bg ' + name); ok(!opts || opts.floorY === undefined || (fin(opts.floorY) && opts.floorY > 0 && opts.floorY < E.H), 'bg floorY ' + (opts && opts.floorY)); },
  fg() {}
};
R.FX = { create() { return { burst(k, x, y, n) { ok(fin(x, y, n), 'fx.burst NaN'); }, ambient() {}, update() {}, draw() {}, clear() {}, count() { return 0; } }; } };
R.Audio = {
  init() {}, suspend() {}, resume() {}, heartbeat() {},
  setMuted(b) { rec.muted = b; },
  sfx(n) { ok(SFX.has(n), 'unknown sfx "' + n + '"'); rec.sfx.push(n); },
  music(n) { ok(n === null || MUSIC.has(n), 'unknown music "' + n + '"'); rec.music.push(n); }
};
const realCommit = R.Save.commit;
R.Save.commit = function () { rec.commits++; return realCommit.call(R.Save); };

const noop = function () {};
const g = new Proxy({
  fillRect(x, y, w, h) { if (!fin(x, y, w, h)) fail('fillRect NaN ' + [x, y, w, h]); else if (w < 0 || h < 0) fail('fillRect negative size ' + [x, y, w, h]); }
}, { get(t, k) { return k in t ? t[k] : noop; }, set() { return true; } });

// ---------------------------------------------------------------------------------------------- fake engine
let E = null, cur = null, curName = '';
function mkEngine(H, top, bottom) {
  const e = {
    W: 180, H, safe: { top, bottom }, time: 0, real: 0, timeScale: 1, paused: false, frame: 0,
    ease: { lin: q => q, in: q => q * q, out: q => 1 - (1 - q) * (1 - q), io: q => q < 0.5 ? 2 * q * q : 1 - 2 * (1 - q) * (1 - q), back: q => q },
    lay: { top, hudY: top, arenaY: top + 34, arenaH: 170, floorY: top + 172, bandY: top + 204, rowY: top + 238, btnY: top + 262, btnH: 52, bottom: top + 314 },
    cos: [], tws: [], timers: [], goCalls: [], gone: null,
    co(genFn) { const c = { it: genFn(), done: false, mode: 0, wait: 0, on: null, cancel() { this.done = true; } }; e.cos.push(c); resume(c); return c; },
    tween(obj, key, to, sec, ease) {
      for (const t of e.tws) if (!t.done && t.obj === obj && t.key === key) t.done = true;
      const t = { obj, key, from: +obj[key] || 0, to, t: 0, dur: sec, ease: typeof ease === 'function' ? ease : (e.ease[ease] || e.ease.lin), done: false, cancel() { this.done = true; } };
      if (!(sec > 0)) { obj[key] = to; t.done = true; return t; }
      e.tws.push(t); return t;
    },
    after(sec, fn) { const t = { t: sec, fn, id: e.timers.length + 1 }; e.timers.push(t); return t.id; },
    cancel(id) { for (const t of e.timers) if (t.id === id) t.fn = null; },
    go(name, args) { ok(!!R.Scenes[name] || name === 'duel', 'E.go to unknown scene ' + name); e.goCalls.push({ name, args: args === undefined ? null : args }); e.gone = name; },
    buzz() {}, shake() {}, flash() {}, hitStop() {}
  };
  return e;
}
function resume(c) {
  let guard = 0;
  while (!c.done) {
    const r = c.it.next();                                       // exceptions propagate: the harness wants them
    if (c.done) return;
    if (r.done) { c.done = true; return; }
    const v = r.value;
    if (typeof v === 'number' && v > 0) { if (c.mode !== 1) c.wait = 0; c.mode = 1; c.wait += v; if (c.wait > 0 || ++guard > 64) return; }
    else if (typeof v === 'function') { c.mode = 2; c.on = v; return; }
    else if (v && typeof v === 'object') { c.mode = 3; c.on = v; if (!v.done) return; }
    else { c.mode = 4; return; }
  }
}
function step(dt) {
  dt = dt || 1 / 60;
  E.time += dt; E.real += dt; E.frame++;
  for (const t of E.timers.slice()) { if (!t.fn) continue; t.t -= dt; if (t.t <= 0) { const f = t.fn; t.fn = null; f(); } }
  for (const c of E.cos.slice()) {
    if (c.done) continue;
    if (c.mode === 1) { c.wait -= dt; if (c.wait <= 0) resume(c); }
    else if (c.mode === 2) { if (c.on()) { c.on = null; c.mode = 0; resume(c); } }
    else if (c.mode === 3) { if (c.on.done) { c.on = null; c.mode = 0; resume(c); } }
    else { c.mode = 0; resume(c); }
  }
  E.cos = E.cos.filter(c => !c.done);
  for (const t of E.tws) { if (t.done) continue; t.t += dt; const q = t.t / t.dur; if (q >= 1) { t.obj[t.key] = t.to; t.done = true; } else t.obj[t.key] = t.from + (t.to - t.from) * t.ease(q); }
  E.tws = E.tws.filter(t => !t.done);
  if (cur && cur.update) cur.update(dt);
  beginFrame();
  if (cur && cur.draw) cur.draw(g);
}
function frames(n) { for (let i = 0; i < n; i++) step(); }
function left() { return !!(E.gone || G.exit); }
function enter(name, args) {
  if (cur && cur.exit) cur.exit();
  E.cos = []; E.tws = []; E.timers = []; E.time = 0; E.real = 0; E.gone = null; E.goCalls.length = 0;
  G.exit = null; G.calls.length = 0;
  cur = R.Scenes[name]; curName = name;
  ok(!!cur, 'scene not registered: ' + name);
  cur.enter(args === undefined ? null : args);
  step();
}
function down(x, y) { if (!left() && cur.down) cur.down(x, y); }
function move(x, y) { if (!left() && cur.move) cur.move(x, y); }
function up(x, y) { if (!left() && cur.up) cur.up(x, y); }
function tap(x, y) { down(x, y); step(); up(x, y); step(); }
function btn(label) { return rec.buttons.find(b => b.label === label || (label instanceof RegExp && label.test(b.label))); }
function tapBtn(label) {
  const b = btn(label);
  if (!b) { fail('button not found: ' + label + ' (have: ' + rec.buttons.map(q => q.label).join(' | ') + ')'); return false; }
  tap(b.x + (b.w >> 1), b.y + (b.h >> 1));
  return true;
}
function lastGo() { return E.goCalls[E.goCalls.length - 1] || null; }

// ---------------------------------------------------------------------------------------------- fake R.Game
let G = null;
function mkGame() {
  const game = {
    brain: R.Brain.create(null), meta: R.Run.defaultMeta(), run: null,
    rng: R.RNG.create(101), crng: R.RNG.create(202), days: 0, last: null,
    calls: [], exit: null, saves: 0,
    hasRun() { return !!game.run; },
    startFlow() { game.calls.push(['startFlow']); game.exit = 'startFlow'; },
    newRun(id) { game.calls.push(['newRun', id]); game.exit = 'newRun'; },
    resume() { game.calls.push(['resume']); game.exit = 'resume'; },
    duelOver() {},
    draft(id) { game.calls.push(['draft', id]); game.exit = 'draft'; },
    abandon() { game.calls.push(['abandon']); game.run = null; },
    save() { game.saves++; },
    vars(extra) {
      const m = game.meta.memory, r = game.run;
      const v = { runs: m.runs, deaths: m.deaths, wins: m.wins, days: game.days, streak: Math.max(m.streakW, m.streakL), duel: r ? r.duelN : 1,
        bestDuel: m.bestDuel, hp: r ? r.pHp : 0, rivalHp: 0, turns: r ? r.stats.turns : 0, score: game.brain.runScore() };
      if (m.lastWin) { v.lastWinMove = m.lastWin.move; v.lastWinHp = m.lastWin.hp; }
      if (extra) for (const k in extra) v[k] = extra[k];
      return v;
    },
    resetAll() { game.calls.push(['resetAll']); game.exit = 'resetAll'; }
  };
  R.Game = G = game;
  R.Save.init(null);
  if (R.Text.resetTaunts) R.Text.resetTaunts();
  return game;
}
const M = ['S', 'G', 'F'];
function feed(brain, turns, seed) {                                  // a biased, tell-trusting player
  const rng = R.RNG.create(seed || 7);
  let n = 0;
  while (n < turns) {
    let prev1 = null, prev2 = null, prevR = null, last = null, tension = 0;
    for (let t = 1; t <= 9 && n < turns; t++, n++) {
      const ctx = { duel: 1 + (n % 7), phase: 1, turn: t, prev1, prev2, prevR, last, pHp: t > 6 ? 3 : 10, pMaxHp: 12, rHp: 6, rMaxHp: 8, tension, pBroken: false, rBroken: false };
      const rm = M[rng.int(3)], tell = rng.chance(0.7) ? rm : M[rng.int(3)];
      const pm = t === 1 ? 'S' : last === 'L' ? 'G' : rng.chance(0.75) ? R.LOSES_TO[tell] : M[rng.int(3)];
      brain.observe(ctx, tell, pm, rm);
      last = pm === rm ? 'C' : R.BEATS[pm] === rm ? 'W' : 'L'; tension = last === 'C' ? Math.min(3, tension + 1) : 0;
      prev2 = prev1; prev1 = pm; prevR = rm;
    }
  }
}
function unlockAll() { for (const u of R.Run.UNLOCKS) G.meta.unlocked[u.id] = true; }
// A real run advanced to the bonfire after duel `n` (R.Run does the healing, the Rival's draft and the offer).
function runAtBonfire(n, seed, relicId) {
  const run = R.Run.create(G.meta, { seed, relicId: relicId || null, now: 1.7e12 });
  G.brain.beginRun({ days: 0 });
  for (let d = 1; d <= n; d++) {
    const duel = R.Run.startDuel(run);
    let guard = 0;
    while (!duel.over && guard++ < 200) {
      R.Combat.beginTurn(duel);
      if (duel.over) break;
      const lp = R.Combat.legal(duel, 'p'), lr = R.Combat.legal(duel, 'r');
      let pm = lp[0], rm = lr[0];
      for (const a of lp) for (const b of lr) if (R.BEATS[a] === b) { pm = a; rm = b; }
      if (duel.p.hp <= 3) duel.p.hp = Math.min(duel.p.maxHp, 6);     // the test player does not die
      const res = R.Combat.resolve(duel, pm, rm);
      R.Run.record(run, G.meta, res, { move: rm, tell: rm, honest: true, pred: { S: 1 / 3, G: 1 / 3, F: 1 / 3 }, top: 'S', confidence: 0, mode: 'mix' });
    }
    ok(duel.over === 'p', 'test run: duel ' + d + ' not won (' + duel.over + ')');
    R.Run.endDuel(run, G.meta, 'p', G.brain.dossier());
    ok(run.stage === 'bonfire' && run.offer, 'test run: no offer after duel ' + d);
    if (d < n) R.Run.pick(run, run.offer.choices[0], G.meta);
  }
  G.run = run;
  return run;
}
function plainUnlocks(ids) { return R.Run.UNLOCKS.filter(u => ids.includes(u.id)).map(u => ({ id: u.id, type: u.type, ref: u.ref, name: u.name, how: u.how })); }

// ---------------------------------------------------------------------------------------------- fuzz
function fuzz(n, seed) {
  const rng = R.RNG.create(seed);
  for (let i = 0; i < n && !left(); i++) {
    const r = rng.next();
    if (r < 0.10) tap(rng.int(180), rng.int(E.H));
    else if (r < 0.14) {                                             // drag
      let x = rng.int(180), y = rng.int(E.H); const dy = (rng.int(2) ? 1 : -1) * (6 + rng.int(30));
      down(x, y); step();
      for (let k = 0; k < 6; k++) { y += dy; move(x, y); step(); }
      up(x, y); step();
    } else if (r < 0.16 && rec.buttons.length) {
      const b = rec.buttons[rng.int(rec.buttons.length)];
      tap(b.x + rng.int(b.w), b.y + rng.int(b.h));
    } else if (r < 0.17 && cur.key) { if (!left()) cur.key(['S', 'G', 'F', 'OK'][rng.int(4)]); step(); }
    else if (r < 0.175 && cur.back) { if (!left()) cur.back(); step(); }
    else if (r < 0.18) { if (cur.up) cur.up(-9999, -9999); step(); }   // the engine's "pointer released by pause"
    else step();
  }
}

// ---------------------------------------------------------------------------------------------- static text checks
function staticChecks() {
  where = 'static';
  const K = R.SceneKit, F = R.Font;
  ok(!!K, 'R.SceneKit missing');
  for (const name of ['title', 'relic', 'bonfire', 'dossier', 'death', 'victory', 'credits', 'settings', 'unlocks']) ok(!!R.Scenes[name], 'R.Scenes.' + name + ' missing');
  for (const b of R.Boons.list) {
    const tall = K.boonInfo(b.id, 48, 160), wide = K.boonInfo(b.id, 60, 160);
    for (const l of tall.nameLines) ok(F.width(l) <= 48, 'tall card name line too wide: ' + l);
    ok(tall.nameLines.join(' ') === tall.name, 'tall card name truncated: ' + tall.name);
    if (b.who !== 'rival' && !b.relic) {
      ok(wide.nameLines.length <= 2, 'wide card name needs 3 lines: ' + wide.name);
      for (const l of wide.nameLines) ok(F.width(l) <= 61, 'wide card name line too wide: ' + l);
      if (wide.nameLines[1]) ok(F.width(wide.nameLines[1]) <= 49, 'wide card 2nd line collides with the rarity pips: ' + wide.name);
    }
    ok(F.wrap(b.desc, 160).length <= 2, 'desc needs > 2 lines @160: ' + b.id);
    ok(F.wrap(b.desc, 104).length <= 3, 'desc needs > 3 lines @104: ' + b.id);
    ok(F.wrap(tall.flavor, 160).length <= 2, 'flavor needs > 2 lines @160: ' + b.id);
    ok(F.width(tall.name) <= 104, 'boon name wider than the pick panel: ' + tall.name);
    ok(F.width(tall.tagLine) <= 146, 'tag line too wide: ' + tall.tagLine);
  }
  for (const u of R.Run.UNLOCKS) {
    const o = K.unlockInfo(u, 138, 160), o2 = K.unlockInfo(u, 146, 160);
    ok(F.wrap(o.how, 138).length <= 2, 'unlock "how" needs > 2 lines @138: ' + u.id);
    ok(F.width(o.name) + F.width(o.typeLabel) <= 132, 'reel name + type label collide: ' + o.name);
    ok(F.width(o.name) <= 140 && F.width((o.title || '').toUpperCase()) <= 140, 'unlock row text too wide: ' + o.name);
    ok(o2.howLines.every(l => F.width(l) <= 146), 'unlock how line too wide');
    ok(!!(o.icon || o.swatch), 'unlock without icon: ' + u.id);
    if (o.icon) ok(SPRITES.has(o.icon), 'unlock icon is not a sprite: ' + o.icon);
  }
}

// ---------------------------------------------------------------------------------------------- scenarios
function sTitle() {
  // fresh save: minimal, the whole screen begins
  mkGame(); enter('title'); frames(30);
  ok(rec.buttons.length === 1 && /BEGIN/.test(rec.buttons[0].label), 'first launch should show only BEGIN, got ' + rec.buttons.map(b => b.label));
  ok(rec.music.includes('title'), 'title music not requested');
  tap(20, E.safe.top + 30);
  ok(G.exit === 'startFlow', 'first launch: tap anywhere should begin');
  // returning player, no run
  mkGame(); G.meta.memory.runs = 7; G.meta.memory.deaths = 7; enter('title'); frames(600);
  ok(rec.buttons.length === 4, 'returning title should have 4 buttons, has ' + rec.buttons.length);
  for (const [label, scene] of [['DOSSIER', 'dossier'], ['UNLOCKS', 'unlocks'], ['SETTINGS', 'settings']]) {
    enter('title'); frames(5); tapBtn(label);
    const go = lastGo();
    ok(go && go.name === scene && go.args && go.args.from === 'title', label + ' should go to ' + scene + " with {from:'title'}");
  }
  enter('title'); frames(5); tap(90, E.safe.top + 100);
  ok(!left(), 'returning title: a tap on the art must not start anything');
  tapBtn('BEGIN'); ok(G.exit === 'startFlow', 'BEGIN -> startFlow');
  // run in progress
  mkGame(); G.meta.memory.runs = 3; runAtBonfire(1, 900 + E.H);
  enter('title'); frames(20);
  ok(!!btn('CONTINUE') && !!btn('NEW RUN'), 'title with a run needs CONTINUE and NEW RUN');
  tapBtn('NEW RUN'); ok(!G.calls.length, 'one tap on NEW RUN must not abandon');
  ok(!!btn('SURE?'), 'NEW RUN should ask for a second tap');
  frames(200); ok(!!btn('NEW RUN') && !G.calls.length, 'NEW RUN confirmation should time out');
  tapBtn('NEW RUN'); tapBtn('SURE?');
  ok(G.calls[0] && G.calls[0][0] === 'abandon' && G.exit === 'startFlow', 'second tap abandons and starts over: ' + JSON.stringify(G.calls));
  mkGame(); G.meta.memory.runs = 3; runAtBonfire(1, 950 + E.H); enter('title'); frames(5); tapBtn('CONTINUE'); ok(G.exit === 'startFlow', 'CONTINUE -> startFlow');
  delete G.abandon; enter('title'); frames(5); ok(!btn('NEW RUN'), 'NEW RUN must hide when R.Game.abandon is missing');
  mkGame(); G.meta.memory.runs = 12; enter('title'); fuzz(600, 5);
}

function sRelic() {
  mkGame(); unlockAll(); G.meta.memory.runs = 4;
  const relics = R.Run.relics(G.meta).map(b => b.id);
  ok(relics.length === 6, 'expected 6 relics, got ' + relics.length);
  enter('relic'); frames(600);
  tapBtn('CONFIRM');
  ok(G.calls[0] && G.calls[0][0] === 'newRun' && relics.includes(G.calls[0][1]), 'CONFIRM -> newRun(first relic): ' + JSON.stringify(G.calls));
  // every card, then NONE
  for (let i = 0; i <= relics.length; i++) {
    enter('relic'); frames(3);
    const r = (i / 3) | 0, c = i % 3, inRow = Math.min(3, relics.length + 1 - r * 3), x0 = (180 - (inRow * 56 + (inRow - 1) * 2)) >> 1;
    // mirrors relic.js layout(): the Vigil strip sits above the cards, and card height shrinks on short screens
    const rows = Math.ceil((relics.length + 1) / 3), cardsY = E.safe.top + 50, btnY = E.H - E.safe.bottom - 42;
    const ch = Math.max(30, Math.min(44, Math.floor((btnY - 4 - 64 - cardsY) / rows) - 4));
    tap(x0 + c * 58 + 28, cardsY + r * (ch + 4) + (ch >> 1)); frames(3);
    tapBtn('CONFIRM');
    const want = i < relics.length ? relics[i] : null;
    ok(G.calls[0] && G.calls[0][1] === want, 'relic card ' + i + ' -> newRun(' + want + '), got ' + JSON.stringify(G.calls));
  }
  // the Vigil: light k is at x = 24 + (k - 1) * 22, just under the title strip
  const lightX = k => 24 + (k - 1) * 22, lightY = () => E.safe.top + 23 + 8;
  mkGame(); unlockAll(); enter('relic'); frames(3);
  tap(lightX(1), lightY()); frames(2);
  ok(G.meta.vigil.sel === 0 && R.Scenes.relic.peek().focus === 'vigil', 'an unearned light was put out: sel ' + G.meta.vigil.sel);
  G.meta.vigil.max = 4; enter('relic'); frames(3);
  tap(lightX(3), lightY()); frames(2);
  ok(G.meta.vigil.sel === 3, 'tapping light 3 should put out 1-3, sel ' + G.meta.vigil.sel);
  tap(lightX(6), lightY()); frames(2);
  ok(G.meta.vigil.sel === 3, 'a locked light changed the Vigil: sel ' + G.meta.vigil.sel);
  tap(lightX(4), lightY()); frames(2);
  ok(G.meta.vigil.sel === 4, 'tapping light 4 should put out 1-4, sel ' + G.meta.vigil.sel);
  tap(lightX(2), lightY()); frames(2);
  ok(G.meta.vigil.sel === 1, 'tapping an out light should relight it and those after it, sel ' + G.meta.vigil.sel);
  tap(lightX(1), lightY()); frames(2);
  ok(G.meta.vigil.sel === 0, 'all lights should be lit again, sel ' + G.meta.vigil.sel);
  tap(lightX(4), lightY()); frames(600);
  tapBtn('CONFIRM'); ok(G.exit === 'newRun' && G.meta.vigil.sel === 4, 'CONFIRM after setting the Vigil: ' + G.exit + ' sel ' + G.meta.vigil.sel);
  G.meta.vigil.max = 7; G.meta.vigil.sel = 7; G.meta.vigil.wins = [3, 2, 1, 1, 1, 1, 1, 1]; enter('relic'); frames(3);
  for (let k = 1; k <= 7; k++) { tap(lightX(k), lightY()); frames(40); }      // relights all, then puts them out one by one
  ok(G.meta.vigil.sel === 7, 'tapping each light in turn should end lightless, sel ' + G.meta.vigil.sel);
  enter('relic'); frames(3); tapBtn('BACK'); ok(lastGo() && lastGo().name === 'title', 'relic BACK -> title');
  mkGame(); G.meta.unlocked.first_death = true; enter('relic'); frames(30); fuzz(600, 9);
  if (G.exit === 'newRun') ok(G.calls[0][1] === null || G.calls[0][1] === 'relic_ashen_flask', 'fuzzed relic pick invalid');
}

function sBonfire() {
  const K = R.SceneKit;
  // bonfire 1 of the very first run: tutorial lines, full intro, no taps
  mkGame(); let run = runAtBonfire(1, 1000 + E.H * 7 + E.safe.top);
  let offer = run.offer, choices = offer.choices.slice();
  ok(choices.length === 3, 'bonfire 1 should offer 3');
  rec.sfx.length = 0;
  enter('bonfire'); ok(!btn('CONFIRM') || btn('CONFIRM').disabled, 'CONFIRM must start disabled');
  frames(900);
  ok(rec.sfx.includes('rival_draft') && rec.sfx.includes('boon') && rec.music.includes('bonfire'), 'bonfire sounds missing: ' + [...new Set(rec.sfx)]);
  if (offer.healed > 0) ok(rec.sfx.includes('heal'), 'heal sfx missing');
  ok(offer.seen === true && G.saves > 0, 'bonfire should mark the offer seen and save');
  ok(btn('CONFIRM') && btn('CONFIRM').disabled, 'CONFIRM disabled until a card is selected');
  tapBtn('CONFIRM'); frames(120); ok(!left(), 'disabled CONFIRM must do nothing');
  // tap card 2, read the Rival's pick (CONFIRM locks), re-select, confirm
  const cy = btn('CONFIRM').y - 3 - 66 - 2 - 46;
  tap(62 + 28, cy + 20); frames(2);
  ok(!btn('CONFIRM').disabled, 'CONFIRM enabled after selecting a card');
  tap(40, Math.max(E.safe.top + 2, cy - 3 - 20 - 36 - 78) + 20); frames(2);
  ok(btn('CONFIRM').disabled, 'CONFIRM must lock while the Rival pick is in the detail panel');
  tap(8, cy - 3 - 20 + 10); frames(2);                               // strip (the player has no boons yet: nothing)
  tap(170, cy - 3 - 20 + 10); frames(2);                             // strip: the Rival's boon
  tap(4 + 28, cy + 20); frames(2);
  tapBtn('CONFIRM'); frames(600);
  ok(G.exit === 'draft' && G.calls.filter(c => c[0] === 'draft').length === 1 && G.calls[0][1] === choices[0], 'draft(choice 0) expected, got ' + JSON.stringify(G.calls));

  // dossier round trip: the second entry skips straight to the cards
  mkGame(); run = runAtBonfire(2, 2000 + E.H * 7 + E.safe.top); choices = run.offer.choices.slice();
  enter('bonfire'); for (let i = 0; i < 40 && btn('DOSSIER') && btn('DOSSIER').disabled; i++) { tap(90, 60); frames(10); }
  ok(btn('DOSSIER') && !btn('DOSSIER').disabled, 'tapping should fast-forward the intro');
  tapBtn('DOSSIER');
  ok(lastGo() && lastGo().name === 'dossier' && lastGo().args.from === 'bonfire', "DOSSIER -> dossier {from:'bonfire'}");
  delete run.offer.seen;                                             // the module memo alone must be enough
  enter('bonfire'); frames(3);
  ok(btn('DOSSIER') && !btn('DOSSIER').disabled, 're-entered bonfire should be at the card choice at once');
  tap(120 + 28, btn('CONFIRM').y - 3 - 66 - 2 - 46 + 20); frames(2); tapBtn('CONFIRM'); frames(600);
  ok(G.exit === 'draft' && G.calls[0][1] === choices[2], 'draft(choice 2) after the dossier round trip: ' + JSON.stringify(G.calls));

  // bonfire 5 with Dealer's Thumb: a 4-card offer, and both strips are populated
  mkGame(); unlockAll(); G.meta.memory.runs = 9; G.meta.memory.deaths = 8; feed(G.brain, 300, 3);
  run = runAtBonfire(5, 3000 + E.H * 7 + E.safe.top, 'relic_dealers_thumb'); choices = run.offer.choices.slice();
  ok(choices.length === 4, 'Dealer\'s Thumb should give 4 choices, got ' + choices.length);
  ok(run.pBoons.length === 5 && run.rBoons.length === 5, 'bonfire 5 boon counts ' + run.pBoons.length + '/' + run.rBoons.length);
  enter('bonfire'); frames(900);
  const cy4 = btn('CONFIRM').y - 3 - 66 - 2 - 46;
  for (let i = 0; i < 4; i++) { tap(4 + (i & 1) * 87 + 40, cy4 + (i >> 1) * 24 + 11); frames(2); ok(!btn('CONFIRM').disabled, '4-card grid: card ' + i + ' not selectable'); }
  for (let i = 0; i < 5; i++) { tap(4 + i * 13 + 6, cy4 - 3 - 20 + 10); frames(2); ok(btn('CONFIRM').disabled, 'viewing own boon ' + i + ' should lock CONFIRM'); }
  for (let i = 0; i < 5; i++) { tap(164 - i * 13 + 6, cy4 - 3 - 20 + 10); frames(2); }
  tap(4 + 87 + 40, cy4 + 24 + 11); frames(2); tapBtn('CONFIRM'); frames(600);
  ok(G.exit === 'draft' && G.calls[0][1] === choices[3], 'draft(choice 3) from the grid: ' + JSON.stringify(G.calls));

  // every rivalWhy category speaks
  for (const why of [null, 'G', 'S', 'F', 'repeat', 'predictable', 'trust', 'tags']) {
    mkGame(); G.meta.memory.runs = 5; G.meta.memory.deaths = 4; run = runAtBonfire(3, 4000 + E.H + (why ? why.length * 31 + why.charCodeAt(0) : 0));
    run.offer.rivalWhy = why;
    enter('bonfire'); frames(700);
  }
  // fuzz: must end in a valid draft or the dossier, never anything else
  for (let s = 0; s < 6; s++) {
    mkGame(); G.meta.memory.runs = 2 + s; G.meta.memory.deaths = 1; if (s & 1) unlockAll();
    run = runAtBonfire(1 + (s % 6), 5000 + s * 97 + E.H, s === 3 ? 'relic_dealers_thumb' : null); choices = run.offer.choices.slice();
    enter('bonfire'); fuzz(2500, 40 + s); frames(400);
    if (G.exit) ok(G.exit === 'draft' && choices.includes(G.calls[G.calls.length - 1][1]), 'fuzz: invalid draft ' + JSON.stringify(G.calls));
    else if (E.gone) ok(E.gone === 'dossier', 'fuzz: bonfire left to ' + E.gone);
  }
  void K;
}

function sDossier() {
  mkGame(); enter('dossier', { from: 'title' }); frames(120);                 // nothing known
  tapBtn('BACK'); ok(lastGo() && lastGo().name === 'title', 'dossier BACK -> title');
  mkGame(); G.meta.memory.runs = 1; feed(G.brain, 12, 4); enter('dossier', { from: 'title' }); frames(60);   // a few turns
  mkGame(); feed(G.brain, 400, 7);
  const m = G.meta.memory; m.runs = 23; m.deaths = 21; m.wins = 2; m.streakL = 4; m.bestDuel = 8;
  m.closestLoss = { duel: 6, rivalHp: 1 }; m.fastestDeath = { duel: 1, turns: 4 }; m.lastWin = { move: 'F', hp: 2, run: 19, ts: 1 };
  const dos = G.brain.dossier();
  ok(dos.samples === 400 && dos.stats.length >= 5, 'fed brain should have a full dossier (' + dos.samples + ', ' + dos.stats.length + ')');
  const before = rec.texts;
  enter('dossier', { from: 'bonfire' }); frames(600);
  ok(rec.texts - before > 600 * 8, 'dossier draws too little text');
  // drag to the bottom and back; the bounds clamp
  const vy = E.safe.top + 60;
  for (let k = 0; k < 30; k++) { down(90, vy + 120); step(); for (let j = 1; j <= 8; j++) { move(90, vy + 120 - j * 14); step(); } up(90, vy + 8); frames(20); }
  frames(120);
  for (let k = 0; k < 30; k++) { down(90, vy); step(); for (let j = 1; j <= 8; j++) { move(90, vy + j * 14); step(); } up(90, vy + 112); frames(20); }
  ok(!left(), 'dragging must not leave the dossier');
  down(90, vy); step(); move(90, vy - 9999); step(); move(90, vy + 9999); step(); up(-9999, -9999); frames(30);
  tapBtn('BACK'); ok(lastGo() && lastGo().name === 'bonfire', 'dossier BACK -> bonfire (mid-run)');
  enter('dossier', { from: 'bonfire' }); fuzz(600, 77);
  if (E.gone) ok(E.gone === 'bonfire', 'dossier fuzz exit ' + E.gone);
}

function scrollProbe() {                                                 // inertia + clamping of the shared helper
  where = 'scroll';
  const s = R.SceneKit.scroll(); s.setBounds(20, 200, 900);
  ok(s.max === 700, 'scroll max'); ok(!s.down(5, 10) && s.down(5, 100), 'scroll.down outside/inside the view');
  for (let i = 1; i <= 10; i++) { s.move(5, 100 - i * 6); s.update(1 / 60); }
  ok(s.y === 60 && s.up() === true, 'drag moved ' + s.y);
  let y0 = s.y; for (let i = 0; i < 30; i++) s.update(1 / 60);
  ok(s.y > y0 + 20, 'no inertia after release (' + y0 + ' -> ' + s.y + ')');
  for (let i = 0; i < 600; i++) s.update(1 / 60);
  const rest = s.y; s.update(1 / 60); ok(s.y === rest && s.v === 0, 'inertia never settles');
  s.down(5, 100); s.move(5, 100000); ok(s.y === 0, 'clamp top'); s.move(5, -100000); ok(s.y === s.max, 'clamp bottom'); s.up();
  s.down(5, 100); s.move(5, 101); ok(s.up() === false && s.off() === Math.round(s.y), 'a 1 px wobble is a tap, not a drag');
  s.setBounds(20, 200, 100); ok(s.max === 0 && s.y === 0, 'short content does not scroll');
}

function sDeath() {
  // duel-1 death, nothing learned, watch it all
  mkGame(); G.meta.memory.runs = 1; G.meta.memory.deaths = 1;
  G.last = { won: false, duel: 1, phase: 1, rivalHp: 5, turns: 4, score: 80, finishingMove: null, hp: 0, unlocks: plainUnlocks(['first_death']), firstWin: false, insights: [], boons: [], rivalBoons: [] };
  rec.sfx.length = 0; rec.music.length = 0;
  enter('death'); frames(20); tap(90, 100); ok(!left(), 'death: first tap only fast-forwards');
  frames(30); tap(90, 100); ok(!left(), 'death: exit not accepted before 1.2 s of text');
  frames(80); tap(90, 100);
  ok(G.exit === 'startFlow' && !E.gone, 'death -> R.Game.startFlow() (rises straight into the next run)');
  ok(rec.sfx.filter(s => s === 'you_died').length === 1 && rec.music.includes('death'), 'you_died once + death music: ' + rec.sfx);
  // duel-7 death with three unlocks and three insights, untouched for 600 frames
  mkGame(); feed(G.brain, 200, 5); G.brain.beginRun({ days: 0 }); feed(G.brain, 120, 6);
  const m = G.meta.memory; m.runs = 14; m.deaths = 13;
  const ins = G.brain.runInsights();
  ok(ins.length === 3, 'expected 3 run insights, got ' + ins.length);
  G.last = { won: false, duel: 7, phase: 2, rivalHp: 2, turns: 61, score: 100, finishingMove: null, hp: 0,
    unlocks: plainUnlocks(['reach_7', 'die_15']), firstWin: false, insights: ins, boons: ['resonance'], rivalBoons: ['no_encores'] };
  ok(G.last.unlocks.length === 3, 'expected 3 unlock entries, got ' + G.last.unlocks.length);
  rec.sfx.length = 0;
  enter('death'); frames(240); tap(-1, -1); G.exit = null;               // (a stray pause-release style input is ignored)
  mkGame(); G.meta.memory.runs = 14; G.meta.memory.deaths = 13;
  G.last = { won: false, duel: 7, phase: 2, rivalHp: 2, turns: 61, score: 100, finishingMove: null, hp: 0, unlocks: plainUnlocks(['reach_7', 'die_15']), firstWin: false, insights: ins, boons: [], rivalBoons: [] };
  rec.sfx.length = 0;
  enter('death'); frames(1200);
  ok(!left(), 'death must wait for a tap');
  ok(rec.sfx.filter(s => s === 'unlock').length === 3, 'three unlock flips expected, got ' + rec.sfx.filter(s => s === 'unlock').length);
  tap(90, 200); ok(G.exit === 'startFlow' && !E.gone, 'death (full sequence) -> R.Game.startFlow()');
  // close loss
  mkGame(); G.meta.memory.runs = 5; G.meta.memory.deaths = 5;
  G.last = { won: false, duel: 4, phase: 1, rivalHp: 1, turns: 30, score: 12, finishingMove: null, hp: 0, unlocks: [], firstWin: false, insights: ins.slice(0, 1), boons: [], rivalBoons: [] };
  enter('death'); fuzz(900, 3); frames(200); if (!left()) tap(90, 90);
  ok(G.exit === 'startFlow' && !E.gone, 'death (fuzz) -> R.Game.startFlow()');
  mkGame(); G.last = null; enter('death'); frames(600); tap(1, 1); ok(G.exit === 'startFlow', 'death with no R.Game.last still exits');
}

function sVictory() {
  mkGame(); feed(G.brain, 150, 8);
  const m = G.meta.memory; m.runs = 31; m.deaths = 30; m.wins = 1;
  G.last = { won: true, duel: 7, phase: 2, rivalHp: 0, turns: 74, score: 38, finishingMove: 'S', hp: 3, unlocks: plainUnlocks(['first_win', 'ghost_win']), firstWin: true,
    insights: G.brain.runInsights(), boons: ['relic_ashen_flask', 'resonance', 'paper_cuts', 'spite', 'cornered', 'first_blood', 'three_faces'], rivalBoons: [] };
  enter('victory'); frames(1200);
  ok(!left(), 'victory must wait for a tap');
  tap(90, 200); ok(lastGo() && lastGo().name === 'credits', 'first win -> credits');
  G.last.firstWin = false; G.last.unlocks = []; G.last.boons = []; G.last.finishingMove = null;
  enter('victory'); frames(10); tap(5, 5); ok(!left(), 'victory: first tap fast-forwards'); frames(20); tap(5, 5); ok(!left(), 'victory: too early to leave');
  frames(90); tap(5, 5); ok(lastGo() && lastGo().name === 'title', 'later win -> title');
  G.last.firstWin = true; G.last.unlocks = plainUnlocks(['win_3']);
  enter('victory'); fuzz(900, 12); frames(200); if (!left()) tap(9, 9);
  ok(lastGo() && lastGo().name === 'credits', 'victory (fuzz) -> credits');
}

function sCredits() {
  mkGame(); const m = G.meta.memory; m.runs = 31; m.deaths = 30; m.wins = 1; m.totalTurns = 1234;
  rec.music.length = 0;
  enter('credits', { from: 'victory' });
  ok(G.meta.seenCredits === true && G.saves === 1 && rec.music.includes('credits'), 'credits must set seenCredits, save and play music');
  let n = 0; while (!left() && n < 60 * 60) { step(); n++; }
  const secs = n / 60;
  ok(lastGo() && lastGo().name === 'title', 'credits -> title');
  if (E.H === 320 && !E.safe.top) console.log('credits length: ' + secs.toFixed(1) + ' s');
  ok(secs >= 30 && secs <= 36, 'credits run ' + secs.toFixed(1) + ' s (want 30-35)');
  // skipping: one tap shows the hint, nothing leaves before 3 s
  enter('credits', { from: 'settings', back: 'title' });
  frames(30); tap(9, 9); frames(20); tap(9, 9); frames(20); tap(9, 9);
  ok(!left(), 'credits must not skip in the first 3 s');
  frames(130); tap(9, 9);                                        // 3.4 s in, hint from the last tap still up
  ok(lastGo() && lastGo().name === 'settings' && lastGo().args && lastGo().args.from === 'title', 'replayed credits skip back to settings');
  enter('credits', { from: 'victory' }); frames(400); tap(9, 9); ok(!left(), 'a single tap only shows the hint'); frames(200); tap(9, 9); ok(!left(), 'hint expired: one tap again'); frames(30); tap(9, 9);
  ok(E.gone === 'title', 'second tap skips');
  mkGame(); enter('credits'); fuzz(600, 2);
}

function sSettings() {
  mkGame(); enter('settings', { from: 'title' }); frames(60);
  ok(!btn('REPLAY CREDITS'), 'REPLAY CREDITS hidden until the credits were seen');
  mkGame(); G.meta.memory.wins = 1; enter('settings', { from: 'title' }); frames(10);     // won, but the page closed before the roll started
  ok(!!btn('REPLAY CREDITS'), 'REPLAY CREDITS must be offered to anyone who has won, even if seenCredits was never stored');
  mkGame(); enter('settings', { from: 'title' }); frames(60);
  let c0 = rec.commits;
  tapBtn(/^MUTE/); ok(R.Save.data.settings.muted === true && rec.muted === true && rec.commits === c0 + 1 && !!btn('MUTE: ON'), 'MUTE toggle');
  tapBtn(/^MUTE/); ok(R.Save.data.settings.muted === false && rec.muted === false && rec.commits === c0 + 2, 'MUTE toggle back');
  tapBtn(/^HAPTICS/); ok(R.Save.data.settings.haptics === false && !!btn('HAPTICS: OFF') && rec.commits === c0 + 3, 'HAPTICS toggle');
  const pick = rec.buttons.filter(b => b.w === 172 && b.h === 24);
  ok(pick.length === 2, 'mask + arena pickers expected, got ' + pick.length);
  tap(pick[0].x + 80, pick[0].y + 12); tap(pick[1].x + 80, pick[1].y + 12);
  ok(R.Save.data.settings.mask === 'porcelain' && R.Save.data.settings.arena === 'cathedral' && rec.commits === c0 + 3, 'locked pickers must not change');
  tapBtn('BACK'); ok(lastGo() && lastGo().name === 'title', 'settings BACK -> title');
  // everything unlocked
  mkGame(); unlockAll(); G.meta.seenCredits = true; enter('settings', { from: 'bonfire' }); frames(10);
  const pk = rec.buttons.filter(b => b.w === 172 && b.h === 24 && !b.label);
  const masks = new Set(), arenas = new Set(); c0 = rec.commits;
  for (let i = 0; i < 5; i++) { tap(pk[0].x + 80, pk[0].y + 12); masks.add(R.Save.data.settings.mask); frames(3); }
  for (let i = 0; i < 3; i++) { tap(pk[1].x + 80, pk[1].y + 12); arenas.add(R.Save.data.settings.arena); frames(3); }
  ok(masks.size === 5 && R.Save.data.settings.mask === 'porcelain', 'mask cycle: ' + [...masks]);
  ok(arenas.size === 3 && R.Save.data.settings.arena === 'cathedral', 'arena cycle: ' + [...arenas]);
  ok(rec.commits === c0 + 8, 'every change commits (' + (rec.commits - c0) + ')');
  // reset: a tap warns, a short hold cancels, a full hold erases
  const rb = btn('RESET SAVE'); ok(!!rb, 'RESET SAVE button');
  tap(rb.x + 50, rb.y + 10); frames(30); ok(!G.calls.length && !!btn('HOLD TO ERASE'), 'tap on reset only warns');
  down(rb.x + 50, rb.y + 10); frames(60); up(rb.x + 50, rb.y + 10); frames(60); ok(!G.calls.length, 'a 1 s hold must not erase');
  down(rb.x + 50, rb.y + 10); frames(40); move(rb.x + 50, rb.y - 40); frames(80); up(rb.x + 50, rb.y - 40); ok(!G.calls.length, 'sliding off cancels the hold');
  frames(240); ok(!!btn('RESET SAVE'), 'warning should time out');
  down(rb.x + 50, rb.y + 10); frames(89); ok(!G.calls.length, 'not yet at 1.48 s'); frames(4);
  ok(G.calls.length === 1 && G.calls[0][0] === 'resetAll', 'holding 1.5 s -> resetAll: ' + JSON.stringify(G.calls));
  frames(30); ok(G.calls.length === 1, 'resetAll only once');
  mkGame(); unlockAll(); G.meta.seenCredits = true; enter('settings', { from: 'bonfire' }); frames(5);
  tapBtn('REPLAY CREDITS'); ok(lastGo() && lastGo().name === 'credits' && lastGo().args.from === 'settings' && lastGo().args.back === 'bonfire', 'REPLAY CREDITS args');
  enter('settings', { from: 'bonfire' }); frames(5); tapBtn('BACK'); ok(lastGo().name === 'bonfire', 'settings BACK -> args.from');
  for (let s = 0; s < 3; s++) { mkGame(); if (s) unlockAll(); G.meta.seenCredits = s > 1; enter('settings', { from: 'title' }); fuzz(700, 60 + s); ok(G.exit !== 'resetAll', 'fuzz taps must never erase the save'); }
}

function sUnlocks() {
  mkGame(); enter('unlocks', { from: 'title' }); frames(600);
  const top = E.safe.top + 19;
  for (let i = 0; i < 6; i++) { tap(60, top + 30 + i * 28); frames(2); }
  for (let k = 0; k < 14; k++) { down(90, top + 100); step(); for (let j = 1; j <= 8; j++) { move(90, top + 100 - j * 11); step(); } up(90, top + 12); frames(12); tap(60, top + 40); frames(2); }
  ok(!left(), 'unlocks: scrolling and row taps stay on the screen');
  tapBtn('BACK'); ok(lastGo() && lastGo().name === 'title', 'unlocks BACK -> title');
  mkGame(); unlockAll(); enter('unlocks', { from: 'title' }); frames(30);
  for (let k = 0; k < 14; k++) { for (let i = 0; i < 5; i++) { tap(60, top + 26 + i * 28); frames(2); } down(90, top + 100); step(); for (let j = 1; j <= 8; j++) { move(90, top + 100 - j * 9); step(); } up(90, top + 28); frames(10); }
  mkGame(); G.meta.unlocked.first_death = true; G.meta.unlocked.die_15 = true; G.meta.unlocked.runs_10 = true; enter('unlocks', { from: 'title' }); fuzz(800, 31);
  if (E.gone) ok(E.gone === 'title', 'unlocks fuzz exit ' + E.gone);
}

// ---------------------------------------------------------------------------------------------- run
const SCEN = [['title', sTitle], ['relic', sRelic], ['bonfire', sBonfire], ['dossier', sDossier], ['death', sDeath], ['victory', sVictory], ['credits', sCredits], ['settings', sSettings], ['unlocks', sUnlocks]];
const files = ['_common.js', 'title.js', 'relic.js', 'bonfire.js', 'dossier.js', 'death.js', 'victory.js', 'credits.js', 'settings.js', 'unlocks.js'];
E = R.Engine = mkEngine(320, 0, 0);
for (const f of files) require(p.join(src, 'scenes', f));
{                                                                  // cards are panels too, for the text-fits check
  const K = R.SceneKit, card = K.card;
  K.card = function (g2, x, y, w, h, info, st) {
    ok(fin(x, y, w, h) && x >= 0 && x + w <= 180, 'card bad rect ' + [x, y, w, h]);
    rec.panels.push({ kind: 'card', x: x | 0, y: (y | 0) + (st && st.pressed ? 1 : 0), w, h, pad: 3 });
    return card.call(K, g2, x, y, w, h, info, st);
  };
}
mkGame();
staticChecks();
scrollProbe();
for (const [H, top, bottom] of [[320, 0, 0], [320, 14, 10], [400, 0, 0], [400, 14, 10], [356, 22, 16]]) {
  for (const [name, fn] of SCEN) {
    E = R.Engine = mkEngine(H, top, bottom);
    mkGame();
    where = name + ' @' + H + (top ? '+safe' + top + '/' + bottom : '');
    try { fn(); } catch (e) { fail('EXCEPTION ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e)); }
    if (cur && cur.exit) { try { cur.exit(); } catch (e2) { fail('exit threw ' + e2); } cur = null; }
  }
}
console.log((fails ? 'FAILED ' + fails : 'OK') + ' - ' + checks + ' checks, ' + rec.texts + ' text draws');
process.exit(fails ? 1 : 0);
