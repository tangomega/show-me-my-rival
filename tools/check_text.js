// Text checker for src/text/taunts.js and src/text/dossier.js: pool sizes, variables, length and wrap with real
// values, fill / taunt / bag behaviour, dossier and record lines, boons, unlocks, masks, arenas, rule cards, ui strings,
// the credit, and the fresh-profile check (lines a new player meets must not print "1 deaths" or claim a history
// the profile does not have; today's offenders print as one KNOWN row, ids registered in tools/known.json).
// The fresh-profile check is pattern-based: plural/zero slips are found for any word after a counter, but a history
// claim is found only through a phrase list and a list of generic history markers ("always", "again", "never", ...),
// and every line with a marker needs a human verdict (FRESH_KNOWN or FRESH_OK). A claim worded with none of them is
// not seen.
//   node tools/check_text.js [--verbose]        --verbose also lists each fresh-profile offender
// Exit 1 on any FAIL. Reads only; writes nothing.
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..', 'src');
const VERBOSE = process.argv.includes('--verbose');
const fails = [];
const warn = [];
function ok(c, msg) { if (!c) fails.push(msg); }

function load(withStub) {
  delete globalThis.RIVAL;
  for (const k of Object.keys(require.cache)) if (k.includes(path.join('src', 'text'))) delete require.cache[k];
  if (withStub) globalThis.RIVAL = { Text: { ui: { stubOnly: 'STUB', back: 'stub-back' }, taunts: { stub_cat: ['x'], idle: ['stub'] }, boon: { zzz: { name: 'Z', flavor: 'z' } }, fill: () => 'STUB', move: () => 'STUB' } };
  require(path.join(root, 'text', 'taunts.js'));
  require(path.join(root, 'text', 'dossier.js'));
  return globalThis.RIVAL.Text;
}

// --- stub merge behaviour
let T = load(true);
ok(T.ui.stubOnly === 'STUB' && T.ui.back === 'BACK', 'ui merge/override with stub');
ok(T.taunts.stub_cat && T.taunts.idle.length >= 6, 'taunts merge/override with stub');
ok(T.fill('a{x}', { x: 1 }) === 'A1' && T.move('S') === 'Strike', 'fill/move override stub');
T = load(false);

const ALLOWED = 'pct move moveLower counterMove oldMove prevMove tellMove ctxPhrase runs deaths wins days streak duel bestDuel hp rivalHp turns score boon rivalBoon lastWinMove lastWinHp'.split(' ');
const MOVES = 'move moveLower counterMove oldMove prevMove tellMove lastWinMove'.split(' ');
const MIN = {
  habit_detected: 36, habit_broken: 8, read_you: 20, surprised: 14, lie_worked: 8, lie_caught: 8,
  player_low_hp: 12, rival_low_hp: 12, clash: 4, clash_S: 4, clash_G: 4, clash_F: 4, clash_rupture: 3, clash_deathblow: 4,
  guard_break_player: 8, guard_break_rival: 8, player_death: 16, player_death_duel1: 3, player_death_final: 3, player_death_close: 3,
  rival_defeated: 8, rival_defeated_final: 4, first_run_tutorial: 10, run_50: 4,
  milestone_runs_5: 2, milestone_runs_10: 2, milestone_runs_25: 2, milestone_runs_100: 2, milestone_runs_200: 2,
  returning: 8, lose_streak: 8, win_streak: 6, bonfire_player_pick: 14, bonfire_rival_pick: 10,
  bonfire_rival_pick_G: 2, bonfire_rival_pick_S: 2, bonfire_rival_pick_F: 2, bonfire_rival_pick_repeat: 2, bonfire_rival_pick_predictable: 2, bonfire_rival_pick_trust: 2,
  duel_intro: 12, final_duel_intro: 6, phase2: 6, called_shot_call: 3, called_shot_right: 3, called_shot_wrong: 3,
  idle: 6, learned_lines: 10, victory_summary: 4, credits_footnotes: 8, dossier_headers: 12
};
const counts = {};
let total = 0, totalAll = 0;
for (const k of Object.keys(MIN)) ok(Array.isArray(T.taunts[k]) && T.taunts[k].length >= MIN[k], `category ${k}: ${T.taunts[k] ? T.taunts[k].length : 'MISSING'} < ${MIN[k]}`);
for (const k of Object.keys(T.taunts)) {
  counts[k] = T.taunts[k].length; totalAll += counts[k];
  if (k !== 'first_run_tutorial' && k !== 'dossier_headers') total += counts[k];
}
const fam = ['clash', 'clash_S', 'clash_G', 'clash_F', 'clash_rupture', 'clash_deathblow'].reduce((a, k) => a + counts[k], 0);
ok(fam >= 15, 'clash family < 15');
ok(counts.rival_defeated + counts.rival_defeated_final >= 12, 'rival_defeated family < 12');
ok(total >= 305, `total ${total} < 305`);

// tutorial
const TK = 'intro t1_tell t1_result t2_tell t2_result t3_tell t3_guard t3_strike t3_feint t4_lie first_clash first_tension first_lie bonfire_first bonfire_cards'.split(' ');
const EXACT = {
  intro: 'Ah. A new one. Lovely. Let me teach you how to lose.',
  t1_tell: 'This is my Strike stance. Guard beats Strike. Go on.',
  t1_result: 'Good. A trained crow could do it, but good.',
  t2_tell: 'Now I Guard. A Feint slips past a Guard. Try it.',
  t2_result: 'My guard is broken. No Guard for me next turn. See?',
  t3_tell: 'Strike again. You know what beats it.',
  t3_guard: 'Lesson three: I lie. A Strike would have cut that Feint down.',
  t3_strike: "...You didn't trust me. Good. Strike beats Feint. Remember it.",
  t3_feint: 'A clash. Tension builds. The next hit lands harder.',
  t4_lie: 'Also: I lie. Often.',
  bonfire_first: 'I choose first. You may watch.',
  bonfire_cards: 'Pick one. Choose badly; I enjoy that.'
};
for (const k of TK) ok(typeof T.tutorial[k] === 'string' && T.tutorial[k].length <= 78, 'tutorial.' + k);
for (const k of Object.keys(EXACT)) ok(T.tutorial[k] === EXACT[k], 'tutorial exact ' + k);

function wrap(s, cols) {
  const lines = []; let cur = '';
  for (const w of s.split(' ')) {
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= cols) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function worst(tpl) {
  return tpl.replace(/\{(\w+)\}/g, (a, k) => k === 'ctxPhrase' ? 'x'.repeat(28) : (k === 'boon' || k === 'rivalBoon') ? 'b'.repeat(20) : MOVES.includes(k) ? 'mmmmmm' : '999');
}

// real-value pools for the wrap test
const HABITS = ['fav_move', 'opening', 'after_loss', 'after_win', 'repeat', 'two_step', 'loop3', 'low_hp', 'tell_trust', 'tell_by_stance', 'after_burn', 'echo_rival', 'deathblow_nerves', 'broken_panic', 'vs_broken'];
const VARIANTS = [undefined, 'gullible', 'paranoid', 'never_learns', 'sulks', 'repeats', 'never_repeats', 'copies', 'counters', 'bogus'];
const ALLIDS = HABITS.concat(['predictability', 'broken_habit', 'record']);
const LET = ['S', 'G', 'F'];
function mkStat(id, variant, m, pct, n) {
  const N = T.move(m);
  return { id, kind: 'habit', move: m, pct, n, strength: 0.5, vars: { pct, n, move: N, moveLower: N.toLowerCase(), variant, prevMove: N, a: N, b: N, tellMove: N, oldMove: N } };
}
const statVarSets = [];
for (const id of HABITS) for (const v of VARIANTS) for (const m of LET) for (const pct of [100, 8]) statVarSets.push(T.tauntVars(mkStat(id, v, m, pct, 40)));
const brokenVarSets = [];
for (const h of HABITS.concat([undefined])) for (const m of LET) { const s = mkStat('broken_habit', undefined, m, 20, 10); s.vars.habit = h; brokenVarSets.push(T.tauntVars(s)); }
const boonNames = Object.keys(T.boon).map(k => T.boon[k].name);

const seen = new Map();
let ohAh = 0;
const tight = [];
for (const cat of Object.keys(T.taunts)) {
  if (cat === 'dossier_headers') continue;
  for (const line of T.taunts[cat]) {
    const id = cat + ': ' + JSON.stringify(line);
    ok(typeof line === 'string' && line.length > 0, 'not a string ' + id);
    const vars = (line.match(/\{(\w+)\}/g) || []).map(s => s.slice(1, -1));
    for (const v of vars) ok(ALLOWED.includes(v), 'bad var ' + v + ' in ' + id);
    const w = worst(line);
    ok(w.length <= 78, `too long (${w.length}) ` + id);
    ok(/^[\x20-\x7e]+$/.test(line), 'non-ASCII ' + id);
    ok(!/\s\s/.test(line) && line === line.trim(), 'spacing ' + id);
    if (!/^(phase2|called_shot_)/.test(cat)) ok(!/\b[A-Z]{2,}\b/.test(line.replace(/\{\w+\}/g, '')), 'shouting ' + id);
    if (/^(Oh|Ah)[,.]/.test(line)) ohAh++;
    if (cat !== 'first_run_tutorial') { ok(!seen.has(line), 'duplicate ' + id + ' also in ' + seen.get(line)); seen.set(line, cat); }
    if (/damn|hell\b/i.test(line)) warn.push('language? ' + id);

    // real expansion wrap test: 26 cols x 3 lines
    let sets;
    if (cat === 'habit_detected' || cat === 'learned_lines') {
      sets = statVarSets;
      for (const v of vars) ok(['ctxPhrase', 'move', 'moveLower', 'pct'].includes(v), 'habit line uses non-stat var ' + id);
    } else if (cat === 'habit_broken') sets = brokenVarSets;
    else {
      sets = [];
      const base = { pct: 100, runs: 200, deaths: 999, wins: 100, days: 365, streak: 12, duel: 7, bestDuel: 8, hp: 12, rivalHp: 12, turns: 199, score: 100, lastWinHp: 12 };
      for (const m of LET) {
        const N = T.move(m);
        const b = Object.assign({}, base, { move: N, moveLower: N.toLowerCase(), counterMove: N, oldMove: N, prevMove: N, tellMove: N, lastWinMove: N });
        if (vars.includes('boon') || vars.includes('rivalBoon')) for (const bn of boonNames) sets.push(Object.assign({}, b, { boon: bn, rivalBoon: bn }));
        else sets.push(b);
      }
    }
    let worstReal = 0, worstLines = 0, ex = '';
    for (const s of sets) {
      const out = T.fill(line, s);
      ok(out !== null, 'unfillable with real vars ' + id + ' ' + JSON.stringify(s));
      if (out === null) break;
      const wl = wrap(out, 26).length;
      if (out.length > worstReal) worstReal = out.length;
      if (wl > worstLines) { worstLines = wl; ex = out; }
    }
    ok(worstReal <= 78, `real expansion too long (${worstReal}) ` + id);
    ok(worstLines <= 3, `wraps to ${worstLines} lines: ` + JSON.stringify(wrap(ex, 26)));
  }
}
ok(ohAh <= 2, 'too many Oh/Ah openers: ' + ohAh);

// --- fill
ok(T.fill('{ctxPhrase}, you {moveLower}.', { ctxPhrase: 'on the first turn', moveLower: 'guard' }) === 'On the first turn, you guard.', 'fill basic');
ok(T.fill('{a} and {b}', { a: 1 }) === null, 'fill missing -> null');
ok(T.fill('{a}', { a: undefined }) === null && T.fill('{a}', { a: null }) === null && T.fill('{a}', null) === null && T.fill('{a}') === null, 'fill undefined -> null');
ok(T.fill('no vars', null) === 'No vars' && T.fill('...x', {}) === '...x' && T.fill('{pct}% x', { pct: 61.6 }) === '62% x', 'fill misc');
ok(T.fill(null, {}) === null && T.fill(42, {}) === null, 'fill bad template');
ok(T.fill('{move} {moveLower}', { move: 'G' }) === 'Guard guard', 'fill move letters');
ok(T.move('S') === 'Strike' && T.move('G') === 'Guard' && T.move('F') === 'Feint' && T.move('x') === '' && T.move(null) === '', 'move()');

// --- taunt
ok(T.taunt('nope', {}) === null, 'taunt missing category');
ok(T.taunt('habit_detected', {}) === null && T.taunt('habit_detected') === null, 'taunt no usable line');
ok(T.taunt('first_run_tutorial') !== null, 'taunt tutorial alias');
for (const cat of Object.keys(T.taunts)) {
  if (cat === 'dossier_headers') continue;
  T.resetTaunts();
  const full = { pct: 61, move: 'Guard', moveLower: 'guard', counterMove: 'Feint', oldMove: 'Guard', prevMove: 'Strike', tellMove: 'Strike', ctxPhrase: 'on the first turn', runs: 12, deaths: 9, wins: 1, days: 3, streak: 4, duel: 3, bestDuel: 5, hp: 4, rivalHp: 2, turns: 44, score: 70, boon: 'Coiled Riposte', rivalBoon: 'No Encores', lastWinMove: 'Strike', lastWinHp: 3 };
  const n = T.taunts[cat].length;
  for (let round = 0; round < 3; round++) {
    const got = new Set();
    for (let i = 0; i < n; i++) {
      const s = T.taunt(cat, full, round === 1 ? { next: () => 0.37 } : undefined);
      ok(typeof s === 'string' && s.indexOf('{') < 0, `taunt(${cat}) unfilled: ${s}`);
      got.add(s);
    }
    ok(got.size === n, `bag repeat in ${cat}: ${got.size}/${n}`);
  }
}
// no immediate repeat across a refill, and partial-vars bag
T.resetTaunts();
{ let prev = null, bad = 0; for (let i = 0; i < 400; i++) { const s = T.taunt('run_50'); if (s === prev) bad++; prev = s; } ok(bad === 0, 'immediate repeat across refill: ' + bad); }
{
  T.resetTaunts();
  const usable = T.taunts.player_death.filter(l => T.fill(l, { deaths: 3 }) !== null).length;
  const got = new Set();
  for (let i = 0; i < usable; i++) got.add(T.taunt('player_death', { deaths: 3 }));
  ok(got.size === usable, 'partial vars bag ' + got.size + '/' + usable);
  ok(T.taunt('player_death', { deaths: 3 }) !== null, 'refill with partial vars');
}
{
  const src = fs.readFileSync(path.join(root, 'text', 'taunts.js'), 'utf8') + fs.readFileSync(path.join(root, 'text', 'dossier.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  ok(!/Math\.random|document\.|window\.|localStorage|Date\.now/.test(code), 'forbidden API in source');
}
// every habit line reachable for every habit stat
for (const vs of statVarSets) for (const l of T.taunts.habit_detected.concat(T.taunts.learned_lines)) ok(T.fill(l, vs) !== null, 'habit line not fillable for ' + JSON.stringify(vs));

// --- dossier lines
const garbage = [undefined, null, 0, 'x', [], {}, { id: 5 }, { id: 'fav_move' }, { id: 'fav_move', vars: null }, { id: 'two_step', vars: { pct: 'a', move: {} } }, { id: 'loop3', pct: NaN, n: -3, vars: { a: 7 } }, { id: 'zzz', vars: { variant: 3 } }, { id: 'tell_trust', vars: { variant: 'x'.repeat(500), pct: 1e9 } }, { id: 'broken_habit', vars: { oldMove: 'x'.repeat(200), ctxPhrase: 'y'.repeat(200) } }, { id: '__proto__' }, { id: 'constructor', vars: { variant: 'constructor' } }, { id: 'repeat', vars: { variant: 'constructor', pct: 50 } }, { id: 'toString' }, { id: 'broken_habit', vars: { habit: 'broken_habit' } }, { id: 'broken_habit', vars: { habit: 'toString' } }];
for (const g of garbage) {
  try {
    const d = T.dossierLine(g), c = T.ctxPhrase(g), tv = T.tauntVars(g);
    ok(typeof d === 'string' && d.length > 0 && d.length <= 78, 'dossierLine garbage ' + JSON.stringify(g) + ' -> ' + d);
    ok(typeof c === 'string' && c.length > 0 && c.length <= 28, 'ctxPhrase garbage ' + JSON.stringify(g));
    ok(tv && typeof tv === 'object' && typeof tv.ctxPhrase === 'string', 'tauntVars garbage');
  } catch (e) { fails.push('THROW on garbage ' + JSON.stringify(g) + ': ' + e.message); }
}
const dl = new Map();
let maxD = 0;
for (const id of ALLIDS) for (const v of VARIANTS) for (const m of LET) for (const pct of [100, 8, 55]) for (const n of [0, 1, 2, 99999]) {
  try {
    const s = mkStat(id, v, m, pct, n);
    if (id === 'broken_habit') s.vars.habit = 'tell_by_stance';
    const d = T.dossierLine(s), c = T.ctxPhrase(s);
    ok(typeof d === 'string' && d.length > 0 && d.length <= 78, `dossierLine ${id}/${v} too long (${d.length}): ${d}`);
    ok(d.indexOf('{') < 0 && d.indexOf('undefined') < 0 && d.indexOf('null') < 0, 'dossierLine unfilled ' + d);
    ok(d !== "I'm still studying this one. Give it time.", `dossierLine fell back to generic for ${id}/${v}`);
    ok(d === T.dossierLine(s), 'dossierLine not deterministic');
    ok(typeof c === 'string' && c.length <= 28 && c.length > 0 && /^[a-z]/.test(c), `ctxPhrase ${id}: ${c}`);
    maxD = Math.max(maxD, d.length);
    const key = id + '/' + v; if (!dl.has(key)) dl.set(key, new Set());
    dl.get(key).add(d.replace(/\d+/g, '#').replace(/Strike|Guard|Feint|strike|guard|feint/g, 'M'));
  } catch (e) { fails.push(`THROW ${id}/${v}: ${e.message}`); }
}
for (const id of HABITS.concat(['broken_habit'])) {
  const k = id + '/undefined';
  const twoSided = ['repeat', 'tell_trust', 'after_burn', 'echo_rival'].includes(id);
  ok(dl.get(k).size === (twoSided ? 1 : 3), `phrasings for ${k}: ${dl.get(k).size}`);
}
for (const [id, vs] of [['repeat', ['repeats', 'never_repeats']], ['tell_trust', ['gullible', 'paranoid']], ['after_burn', ['never_learns', 'sulks']], ['echo_rival', ['copies', 'counters']]]) for (const v of vs) ok(dl.get(id + '/' + v).size === 3, `phrasings ${id}/${v}: ${dl.get(id + '/' + v).size}`);
// all raw dossier templates: worst-case length
{
  const src = fs.readFileSync(path.join(root, 'text', 'dossier.js'), 'utf8');
  const block = src.slice(src.indexOf('var LINES = {'), src.indexOf('// One mocking sentence'));
  const tpls = block.match(/"[^"\n]+"/g).map(s => s.slice(1, -1));
  ok(tpls.length >= 55, 'dossier templates found: ' + tpls.length);
  const dup = new Set();
  for (const t of tpls) {
    const w = t.replace(/\{(\w+)\}/g, (a, k) => k === 'ctxPhrase' ? 'x'.repeat(28) : k === 'n' ? '99999' : k === 'pct' ? '100' : 'mmmmmm');
    ok(w.length <= 78, `dossier template too long (${w.length}): ${t}`);
    ok(/^[\x20-\x7e]+$/.test(t), 'dossier non-ASCII ' + t);
    ok(!dup.has(t), 'dossier dup ' + t); dup.add(t);
  }
}
// strength 0 (shown, not mocked): a mild line, never the generic fallback
for (const id of HABITS) for (const v of VARIANTS) for (const m of LET) {
  const s = mkStat(id, v, m, 100, 99999); s.strength = 0;
  const d = T.dossierLine(s);
  ok(d.length <= 78 && d.indexOf('{') < 0 && d !== "I'm still studying this one. Give it time.", `mild dossierLine ${id}/${v}: ${d}`);
  ok(d !== T.dossierLine(mkStat(id, 'zz', m, 100, 99999)) || ['repeat', 'tell_trust', 'after_burn'].includes(id), `mild line missing for ${id}`);
}
// tauntVars shape
{
  const tv = T.tauntVars(mkStat('after_loss', undefined, 'G', 71, 30));
  ok(tv.pct === 71 && tv.move === 'Guard' && tv.moveLower === 'guard' && tv.ctxPhrase === 'after you take a hit', 'tauntVars basic ' + JSON.stringify(tv));
  const tv2 = T.tauntVars({ id: 'repeat', move: null, pct: 8, n: 30, vars: { pct: 8, variant: 'never_repeats' } });
  ok(tv2.pct === 92 && tv2.moveLower === 'switch', 'tauntVars flip ' + JSON.stringify(tv2));
  const tv3 = T.tauntVars({ id: 'two_step', move: 'F', pct: 70, n: 9, vars: { prevMove: 'S' } });
  ok(tv3.ctxPhrase === 'after a Strike' && tv3.move === 'Feint' && tv3.prevMove === 'Strike', 'tauntVars letters ' + JSON.stringify(tv3));
}
// predictability
for (let s = -5; s <= 105; s++) { const l = T.predictabilityLine(s); ok(typeof l === 'string' && l.length <= 78 && l.indexOf('{') < 0, 'predictabilityLine ' + s + ': ' + l); }
for (const g of [undefined, null, NaN, 'x', {}]) ok(typeof T.predictabilityLine(g) === 'string', 'predictabilityLine garbage');
{
  const bands = [[0, 25], [26, 45], [46, 60], [61, 80], [81, 100]];
  for (const [a, b] of bands) { const set = new Set(); for (let s = a; s <= b; s++) set.add(T.predictabilityLine(s).replace(/\d+/g, '#')); ok(set.size === 3, `predictability band ${a}-${b}: ${set.size} variants`); }
}

// record lines
const mems = [null, undefined, {}, 5, { runs: 0 }, { runs: 1, deaths: 0, wins: 0, streakW: 0, streakL: 0, bestDuel: 1, closestLoss: null, fastestDeath: null, lastWin: null },
  { runs: 999, deaths: 990, wins: 9, streakW: 0, streakL: 12, bestDuel: 8, closestLoss: { duel: 7, rivalHp: 1 }, fastestDeath: { duel: 1, turns: 3 }, lastWin: { move: 'S', hp: 12, run: 998, ts: 1 } },
  { runs: 40, deaths: 30, wins: 10, streakW: 10, streakL: 0, bestDuel: 6, closestLoss: { duel: 6, rivalHp: 12 }, fastestDeath: { duel: 3, turns: 199 }, lastWin: { move: 'Strike', hp: 2, run: 40 } },
  { runs: 7, deaths: 7, wins: 0, streakL: 7, bestDuel: 3, closestLoss: { duel: 3, rivalHp: 4 }, fastestDeath: { duel: 1, turns: 9 }, lastWin: {} },
  { runs: 'x', deaths: null, closestLoss: 'no', fastestDeath: [], lastWin: 3, bestDuel: NaN }];
let rowsFull = 0;
for (const m of mems) {
  try {
    const rows = T.recordLines(m);
    ok(Array.isArray(rows), 'recordLines not array');
    for (const r of rows) {
      ok(typeof r.label === 'string' && typeof r.value === 'string' && typeof r.jab === 'string' && r.jab.length <= 52 && r.jab.length > 0, 'record row ' + JSON.stringify(r));
      ok(r.value.length <= 14, 'record value long ' + r.value);
    }
    rowsFull = Math.max(rowsFull, rows.length);
  } catch (e) { fails.push('recordLines THROW ' + e.message); }
}
ok(rowsFull === 8, 'recordLines full rows = ' + rowsFull);
ok(T.recordLines(null).length === 0 && T.recordLines({ runs: 0 }).length === 0, 'recordLines empty');

// headers / empty
ok(T.dossierHeaders.length >= 12, 'headers count');
for (const h of T.dossierHeaders) ok(h.length <= 26 && h === h.toUpperCase(), 'header ' + h);
ok(T.dossierEmpty.length === 4 && T.dossierEmpty.every(l => l.length <= 78), 'dossierEmpty');

// boons / unlocks
const BOONS = 'coiled_riposte thorned_guard stone_patience iron_oath resonance ash_veil deathblow_creed mirror_etiquette serrated_edge paper_cuts salt_the_wound carrion_comfort vampires_curtsy long_con turtle_cracker debt_collector cornered spite three_faces first_blood headsman no_encores painted_smile mourning_veil hungry_mask sealing_wax spare_mask keyhole truth_candle stolen_ledger liars_tally coin_of_fools broken_pattern ash_of_forgetting last_candle ember_hoard relic_ashen_flask relic_dented_buckler relic_rusty_nail relic_cracked_mirror relic_dealers_thumb relic_liars_coin'.split(' ');
ok(BOONS.length === 42 && Object.keys(T.boon).length === 42, 'boon count ' + Object.keys(T.boon).length);
const fl = new Set();
for (const id of BOONS) {
  const b = T.boon[id];
  ok(b && b.name.length <= 20 && b.name.length > 0 && b.flavor.length <= 60 && b.flavor.length > 0, 'boon ' + id + ' ' + JSON.stringify(b));
  if (b) { ok(!fl.has(b.flavor), 'dup flavor'); fl.add(b.flavor); }
}
const UNL = 'first_death die_5 die_15 die_duel1 lose_3_row reach_3 reach_5 reach_7 first_win win_2 win_3 no_guard_duel no_strike_duel flawless_duel deathblows_5 bleed_20 ghost_run ghost_win read_25 broken_15 drafts_12 lies_15 runs_10'.split(' ');
ok(UNL.length === 23 && Object.keys(T.unlock).length === 23, 'unlock count');
for (const id of UNL) { const u = T.unlock[id]; ok(u && u.name.length <= 20 && u.how.length <= 48 && u.how.length > 0, 'unlock ' + id + ' ' + JSON.stringify(u)); }

for (const k of ['porcelain', 'mourner', 'jester', 'kintsugi', 'blank']) ok(T.masks[k] && T.masks[k].name && T.masks[k].line && T.masks[k].line.length <= 60, 'mask ' + k);
for (const k of ['cathedral', 'blood_moon', 'pale_dawn']) ok(T.arenas[k] && T.arenas[k].name && T.arenas[k].line && T.arenas[k].line.length <= 60, 'arena ' + k);
ok(Array.isArray(T.duelNames) && T.duelNames.length === 8 && T.duelNames[0] === 'The Nave' && T.duelNames[7] === 'The Unmasked', 'duelNames');
for (const k of ['embers', 'called_shot']) ok(T.rules[k] && T.rules[k].name && T.rules[k].line.length <= 44, 'rule ' + k + ' ' + (T.rules[k] && T.rules[k].line.length));
const UIK = 'tapToBegin continue newRun dossier unlocks settings back confirm none mute haptics mask arena replayCredits resetSave resetConfirm holdToErase youDied victory guardBroken deathblow sealed overkill rupture trueStance falseStance chooseRelic itChoosesFirst pickOne rest healed locked credit titleRemembers strike guard feint rotate'.split(' ');
for (const k of UIK) ok(typeof T.ui[k] === 'string' && T.ui[k].length > 0, 'ui.' + k);
ok(T.ui.credit === 'Developed by tangoSHELL · 2026', 'credit exact');
ok(T.ui.resetConfirm === 'ERASE EVERYTHING? It will forget you.' && T.ui.healed === '+{n}' && T.ui.titleRemembers === 'It remembers {runs} of you.', 'ui exact strings');
ok(T.fill(T.ui.healed, { n: 5 }) === '+5' && T.fill(T.ui.titleRemembers, { runs: 12 }) === 'It remembers 12 of you.', 'ui templates');
{ const all = JSON.stringify(T); ok(!/studio|produced by|directed by|written by|music by|art by/i.test(all), 'invented credit?'); }

// --- fresh profile: the lines a new player meets, filled with the counters a new save actually has at that moment.
// A save starts at runs 0, deaths 0, wins 0 (R.Run.defaultMeta); R.Run.create adds the run as it starts, and
// R.Run.finish adds the death or the win before the death / victory screen. Each pool below is filled with the
// states in which its scene can show it, plus the vars that scene passes (main.js G.vars and the scene's extras).
// A filled line offends when it prints a plural or zero slip ("1 deaths", "0 times", "All 0 of them", or any plural
// word right after a counter that is 0 or 1: "1 corpses", "1 tries") or claims a history the profile does not have
// ("Dead again." on the first death). History claims are found two ways: FRESH_HISTORY names definite claims with the
// counter each one needs, and FRESH_MARKERS names generic history words; a line with a marker is an offender when it
// is frozen in FRESH_KNOWN, fine when it is reviewed in FRESH_OK, and a FAIL when it is in neither (a person decides).
// Today's offenders are frozen in FRESH_KNOWN (one KNOWN row until P1.3). A template outside the list that offends is
// a FAIL, and so is a frozen one that no longer offends or no longer exists: remove it from FRESH_KNOWN in the commit
// that fixes it. A FRESH_OK entry that is gone or has no marker any more is a FAIL too (remove it).
const FRESH = {
  run1: { runs: 1, deaths: 0, wins: 0, bestDuel: 1, streak: 0 },             // the first run
  death1: { runs: 1, deaths: 1, wins: 0, bestDuel: 3, streak: 1 },           // the first death screen
  run2: { runs: 2, deaths: 1, wins: 0, bestDuel: 3, streak: 1 },             // the run after it
  win1: { runs: 1, deaths: 0, wins: 1, bestDuel: 8, streak: 1, lastWinMove: 'Strike', lastWinHp: 5 },   // a first-run win
  win2: { runs: 2, deaths: 1, wins: 1, bestDuel: 8, streak: 1, lastWinMove: 'Strike', lastWinHp: 5 },   // a win after one death
  face1: { runs: 2, deaths: 0, wins: 1, bestDuel: 8, streak: 1, lastWinMove: 'Strike', lastWinHp: 5 },  // the next face, after a first-run win
  face2: { runs: 3, deaths: 1, wins: 1, bestDuel: 8, streak: 1, lastWinMove: 'Strike', lastWinHp: 5 }   // the next face, after one death and a win
};
const bossCats = Object.keys(T.taunts).filter(k => /^boss_\w+_(intro|p\d+)$/.test(k)).sort();
const FRESH_POOLS = [
  // [where the line is shown, categories, profile states, vars the scene adds]
  ['death screen', ['player_death', 'player_death_duel1', 'player_death_final', 'player_death_close'], ['death1'], { duel: 3, turns: 30, score: 70, hp: 0, rivalHp: 3 }],
  ['low hp', ['player_low_hp', 'rival_low_hp'], ['run1', 'run2'], { duel: 3, turns: 20, score: 70, hp: 4, rivalHp: 3 }],
  ['final duel (the first face)', ['final_duel_intro', 'phase2'], ['run1', 'run2'], { duel: 7, turns: 80, score: 70, hp: 9, rivalHp: 9 }],
  ['final duel (later faces)', bossCats, ['face1', 'face2'], { duel: 7, turns: 80, score: 70, hp: 9, rivalHp: 9 }],
  ['final blow', ['rival_defeated_final'], ['run1', 'run2'], { duel: 7, turns: 90, score: 70, hp: 5, rivalHp: 0 }],
  ['victory screen', ['victory_summary'], ['win1', 'win2'], { duel: 7, turns: 120, score: 70, hp: 5 }],
  ['credits', ['credits_footnotes'], ['win1', 'win2'], { duel: 7, turns: 120, score: 70, hp: 5, rivalHp: 0 }]
];
const FRESH_SLIPS = [
  /\b0 (deaths?|times?|runs?|wins?|attempts?|duels?)\b/i,
  /\b1 (deaths|times|runs|wins|attempts|duels)\b/i,
  /\ball [01] of them\b/i,
  /\b(run|death|wins:?) 0\b/i
];
// The profile counters a template can print. A plural word right after one of them, when it is 0 or 1, is a slip,
// whatever the noun ("{deaths} corpses" -> "1 corpses"); so is "all {counter} of" at 0 or 1. A counter used as a
// label ("Run {runs} ends", "Wins: {wins}") counts nothing, so the word after it is not checked.
const FRESH_COUNTERS = ['runs', 'deaths', 'wins', 'streak', 'bestDuel'];
const COUNTER_LABEL = { runs: /\bruns?:?\s*$/i, deaths: /\bdeaths?:?\s*$/i, wins: /\bwins?:?\s*$/i, streak: /\bstreak:?\s*$/i, bestDuel: /\bduel:?\s*$/i };
const NOT_PLURAL = new Set(('is was has does this its us thus yes plus always perhaps unless whereas towards afterwards besides sometimes ' +
  'status focus bonus chaos lens canvas minus versus series species news alas gas bus his hers ours yours theirs as across less').split(' '));
const IRREGULAR_PLURAL = new Set('people men women children feet teeth mice dice geese'.split(' '));
function isPlural(word) {
  const w = word.toLowerCase();
  if (IRREGULAR_PLURAL.has(w)) return true;
  if (NOT_PLURAL.has(w) || w.length < 3 || /ss$/.test(w)) return false;
  return /s$/.test(w);
}
function counterSlips(tpl, vars) {
  const why = [];
  for (const m of tpl.matchAll(/\{(\w+)\}\s+([A-Za-z]+)/g)) {
    const v = vars[m[1]];
    if (!FRESH_COUNTERS.includes(m[1]) || COUNTER_LABEL[m[1]].test(tpl.slice(0, m.index))) continue;
    if ((v === 0 || v === 1) && isPlural(m[2])) why.push('"{' + m[1] + '} ' + m[2] + '" with ' + m[1] + ' ' + v);
  }
  for (const m of tpl.matchAll(/\ball \{(\w+)\} of\b/gi)) {
    const v = vars[m[1]];
    if (FRESH_COUNTERS.includes(m[1]) && typeof v === 'number' && v <= 1) why.push('"all {' + m[1] + '} of" with ' + m[1] + ' ' + v);
  }
  return why;
}
// History claims: [phrase, the counter the claim needs, the least it needs to be true].
const FRESH_HISTORY = [
  [/\b(dead|died) again\b/i, 'deaths', 2],
  [/\b(back|here) again\b/i, 'runs', 2],
  [/\bso many of yours\b|\b(all those|all these|so many) (deaths|corpses)\b/i, 'deaths', 2],
  [/\bevery death\b/i, 'deaths', 2],
  [/\bsame mistake\b/i, 'deaths', 2],
  [/\bdied on most\b/i, 'deaths', 2],
  [/\bkeep getting up\b/i, 'deaths', 2],
  [/\bgetting tired of\b/i, 'deaths', 2],
  [/\byour first death\b/i, 'deaths', 1],
  [/\bI've (seen|watched) you (lose|die|fall|waste)\b/i, 'deaths', 1],
  [/\bfinally\b/i, 'runs', 2],
  [/\bI remember when\b/i, 'runs', 2],
  [/\blast time\b/i, 'runs', 2]
];
// Generic history words: a line a new player can meet that uses one needs a verdict (FRESH_KNOWN or FRESH_OK).
const FRESH_MARKERS = /\b(always|never|again|anymore|any more|still|ever|by now|as usual|like always|once more|every time|each time|this time|last time|next time|so often|so many|how many|another|all (?:those|these|of them|of you)|every (?:one|last)|used to|before|remember\w*|kept|keep (?:getting|coming|dying|losing|trying|falling|failing)|I've (?:seen|watched|known|had|counted|buried|started|named|lost count))\b/i;
// Today's offenders, by template ('<category>: <template>'), frozen at P1.0. Shrinks as P1.3 fixes them; never grows.
const FRESH_KNOWN = [
  "player_death: Death {deaths}. I've started naming them.",
  "player_death: Dead again. I'll be here. I'm always here.",
  "player_death: {deaths} deaths. The floor knows your shape by now.",
  "player_death: I'd bury you, but you keep getting up.",
  "player_death: Another candle out. I have so many of yours.",
  "player_death: The bell tolls for you. It's getting tired of it.",
  "player_death: Same mistake, new corpse.",
  "player_death: Until next time. There's always a next time with you.",
  "player_low_hp: {hp} left. I've seen you lose from better.",
  "rival_low_hp: Enjoy this. I've watched you waste better leads.",
  "rival_low_hp: Cornered? I've been cornered since before your first death.",
  "final_duel_intro: Seven. The altar. You know every stone by now; you've died on most of them.",
  "final_duel_intro: {deaths} deaths to stand here. Was it worth it? Don't answer.",
  "phase2: Every death of yours, I kept. They are all in HERE.",
  "rival_defeated_final: All those deaths. You were studying. I thought I was.",
  "victory_summary: You won. It took {deaths} deaths. I enjoyed every one.",
  "victory_summary: Run {runs}. The one where you finally listened.",
  "victory_summary: Wins: {wins}. I remember when that number was a joke.",
  "credits_footnotes: Deaths provided by you. All {deaths} of them.",
  "credits_footnotes: One duelist was harmed. {deaths} times. I kept count.",
  "credits_footnotes: {runs} runs. I was there for all of them."
];
// Lines a new player can meet that use a history marker but claim nothing the profile lacks (reviewed at P1.0): they
// speak of this run, this fight, a rule, or invite a return.
const FRESH_OK = [
  "player_death: Was that the plan? It looked like the plan. It always does.",
  "player_death_final: At the altar, of all places. Fitting. Come again.",
  "player_death_final: All that way, to die on the last step. Walk it again.",
  "player_low_hp: {hp} health left. I'd say 'careful', but you never are.",
  "player_low_hp: Careful. This floor remembers everyone who fell on it.",
  "phase2: Embers, now. The tension never leaves. NEITHER DO I.",
  "phase2: I will name your move before you make it. And be RIGHT.",
  "boss_hours_intro: Listen for the bell. Each time, the air gets sharper.",
  "boss_hours_p3: Matins. The dead of night. Two pips, always.",
  "boss_reflection_intro: I kept a copy of everything you drafted. It suits me.",
  "boss_three_faced_intro: Tonight I am several people. All of them know you.",
  "rival_defeated_final: You learned me. I never thought to guard against that.",
  "rival_defeated_final: Keep the mask. I never knew what was under it either.",
  "rival_defeated_final: Well fought. No joke this time. I can't find one.",
  "victory_summary: {turns} turns to beat me. I'll want every one of them back.",
  "credits_footnotes: Ash supplied by everything that came before.",
  "credits_footnotes: I remain, as ever, your Rival."
];
// Fills every pool with its fresh states. hard: definite offenders (slip, counter slip, FRESH_HISTORY); marked: lines
// with a generic history marker; seen: every template a fresh state can fill.
function freshScan(TT) {
  const hard = new Map(), marked = new Map(), seen = new Set(), problems = [];
  const add = (map, id, hit) => { if (!map.has(id)) map.set(id, []); map.get(id).push(hit); };
  for (const [where, cats, states, extra] of FRESH_POOLS) {
    if (!cats.length) problems.push('fresh profile: no categories for ' + where);
    for (const cat of cats) {
      if (!(Array.isArray(TT.taunts[cat]) && TT.taunts[cat].length > 0)) problems.push('fresh profile: category ' + cat + ' (' + where + ') is missing');
      for (const line of TT.taunts[cat] || []) {
        const id = cat + ': ' + line;
        for (const st of states) {
          const vars = Object.assign({}, FRESH[st], extra);
          const out = TT.fill(line, vars);
          if (out === null) continue;                          // not usable with this profile: the picker skips it
          seen.add(id);
          const why = [];
          for (const re of FRESH_SLIPS) if (re.test(out)) why.push('slip ' + re.source);
          why.push(...counterSlips(line, vars));
          for (const [re, counter, min] of FRESH_HISTORY) if (re.test(out) && vars[counter] < min) why.push('claims ' + counter + ' >= ' + min);
          if (why.length) add(hard, id, { state: st, text: out, why: why.join(', ') });
          const mk = out.match(FRESH_MARKERS);
          if (mk) add(marked, id, { state: st, text: out, why: 'history marker "' + mk[0] + '"' });
        }
      }
    }
  }
  return { hard, marked, seen, problems };
}
// The verdict against a frozen list and a reviewed list: { fails, offenders, still }.
function freshVerdict(TT, known, reviewed) {
  const r = freshScan(TT), out = r.problems.slice(), frozen = new Set(known), okSet = new Set(reviewed);
  const offenders = new Map(r.hard);
  const show = (id, hits) => id + ' -> ' + JSON.stringify(hits[0].text) + ' (' + hits[0].state + ': ' + hits[0].why + ')';
  for (const [id, hits] of r.marked) {
    if (r.hard.has(id)) continue;
    if (frozen.has(id)) offenders.set(id, hits.map(h => Object.assign({}, h, { why: h.why + ', reviewed: claims a history a new profile lacks' })));
    else if (!okSet.has(id)) out.push('fresh profile: unreviewed history marker in a line a new player can meet: ' + show(id, hits) + ' - add it to FRESH_KNOWN if it claims a history the profile lacks, else to FRESH_OK');
  }
  for (const [id, hits] of offenders) if (!frozen.has(id)) out.push('fresh profile: ' + show(id, hits));
  for (const id of reviewed) {
    if (frozen.has(id)) out.push('fresh profile: ' + id + ' is in both FRESH_KNOWN and FRESH_OK');
    else if (!r.seen.has(id)) out.push('fresh profile: FRESH_OK entry is gone (or no new player meets it): ' + id + ' - remove it from FRESH_OK');
    else if (!r.marked.has(id) && !r.hard.has(id)) out.push('fresh profile: FRESH_OK entry has no history marker any more: ' + id + ' - remove it from FRESH_OK');
  }
  const still = known.filter(id => offenders.has(id));
  if (known.length && !still.length) out.push('stale KNOWN row fresh-profile-plurals: remove it from tools/known.json in the fixing commit (and empty FRESH_KNOWN in tools/check_text.js)');
  else for (const id of known) if (!offenders.has(id)) out.push('fresh profile: frozen template no longer offends (or is gone): ' + id + ' - remove it from FRESH_KNOWN in the fixing commit');
  return { fails: out, offenders, still, scan: r };
}
{
  const v = freshVerdict(T, FRESH_KNOWN, FRESH_OK);
  fails.push(...v.fails);
  if (v.still.length) {
    const per = {};
    for (const id of v.still) { const c = id.slice(0, id.indexOf(':')); per[c] = (per[c] || 0) + 1; }
    console.log('KNOWN fresh-profile-plurals P1.3: ' + v.still.length + ' lines print a plural/zero slip or claim a history a new profile lacks (' +
      Object.keys(per).map(c => c + ' x' + per[c]).join(', ') + ')');
    if (VERBOSE) for (const id of v.still) for (const h of v.offenders.get(id)) console.log('  ' + h.state.padEnd(6) + ' ' + JSON.stringify(h.text) + '  [' + h.why + ']');
  }
  // self-tests: each rule can fail on a line nobody listed. In memory only: every added line is removed again, the
  // added lines carry "zz" so they never equal a real one, and the list entries they drop are picked from today's
  // verdict, so a text fix in P1.3 does not break them (a self-test with no target left is skipped, INFO).
  const skipped = [], snap = JSON.stringify(T.taunts);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bites = (what, cat, line, re, known, reviewed) => {
    const arr = T.taunts[cat];
    if (line !== null && !Array.isArray(arr)) { skipped.push(what); return; }
    if (line !== null) arr.push(line);
    let got;
    try { got = freshVerdict(T, known || FRESH_KNOWN, reviewed || FRESH_OK).fails; } finally { if (line !== null) arr.pop(); }
    ok(got.some(f => re.test(f)), 'fresh-profile self-test: ' + what + ' was not caught');
  };
  bites('a plural noun the slip list does not name', 'player_death', '{deaths} corpses on the zz floor.', /^fresh profile: player_death: \{deaths\} corpses on the zz floor\. .*"\{deaths\} corpses" with deaths 1/);
  bites('a plural word after a run count', 'player_death', '{runs} tries and zz to show.', /^fresh profile: player_death: \{runs\} tries and zz to show\. .*"\{runs\} tries" with runs 1/);
  bites('all {counter} of them at 1', 'credits_footnotes', 'Credits owed: all {wins} of them, zz.', /^fresh profile: credits_footnotes: Credits owed: all \{wins\} of them, zz\. /);
  bites('a history claim in unlisted words', 'player_low_hp', 'Breathe, zz. You always panic here.', /^fresh profile: unreviewed history marker .*player_low_hp: Breathe, zz\. You always panic here\. /);
  bites('a FRESH_OK entry that is gone', 'player_death', null, /^fresh profile: FRESH_OK entry is gone .*player_death: zz gone/, null, FRESH_OK.concat(['player_death: zz gone']));
  const frozenNow = v.still[0], reviewedNow = FRESH_OK.find(id => v.scan.marked.has(id) && !v.scan.hard.has(id) && !FRESH_KNOWN.includes(id));
  if (frozenNow === undefined) skipped.push('a frozen offender dropped from FRESH_KNOWN', 'an empty FRESH_KNOWN while lines offend');
  else {
    bites('a frozen offender dropped from FRESH_KNOWN', 'player_death', null, new RegExp('^fresh profile: (unreviewed history marker in a line a new player can meet: )?' + esc(frozenNow) + ' -> '), FRESH_KNOWN.filter(id => id !== frozenNow));
    bites('an empty FRESH_KNOWN while lines offend', 'player_death', null, new RegExp('^fresh profile: (unreviewed history marker in a line a new player can meet: )?' + esc(frozenNow) + ' -> '), []);
  }
  if (reviewedNow === undefined) skipped.push('a reviewed line dropped from FRESH_OK');
  else bites('a reviewed line dropped from FRESH_OK', 'player_death', null, new RegExp('^fresh profile: unreviewed history marker in a line a new player can meet: ' + esc(reviewedNow) + ' -> '), null, FRESH_OK.filter(id => id !== reviewedNow));
  ok(JSON.stringify(T.taunts) === snap, 'fresh-profile self-test: T.taunts not restored');
  if (skipped.length) console.log('INFO self-test: check_text skipped ' + skipped.length + ' fresh-profile self-tests with no target left: ' + skipped.join('; '));
}

// cross-check with the real boon table if it loads (last: it replaces nothing in R.Text)
try {
  require(path.join(root, 'core', 'rng.js')); require(path.join(root, 'game', 'boons.js'));
  const list = globalThis.RIVAL.Boons && globalThis.RIVAL.Boons.list;
  if (list) {
    for (const b of list) ok(!!T.boon[b.id], 'R.Boons id without text: ' + b.id);
    for (const id of BOONS) ok(list.some(b => b.id === id), 'text id not in R.Boons: ' + id);
    console.log('cross-checked against R.Boons (' + list.length + ' boons)');
  }
} catch (e) { warn.push('could not cross-check R.Boons: ' + e.message); }

// --- report
console.log(Object.keys(T.taunts).map(k => k + ' ' + counts[k]).join(' | '));
console.log('TOTAL taunt lines (excl. tutorial + headers):', total, '| incl.:', totalAll, '| longest dossier line:', maxD);
if (warn.length) console.log('WARN:\n  ' + warn.join('\n  '));
if (fails.length) {
  for (const f of fails.slice(0, 80)) console.log('FAIL ' + f);
  if (fails.length > 80) console.log('FAIL ... and ' + (fails.length - 80) + ' more');
  console.log('check_text: FAILED ' + fails.length);
  process.exitCode = 1;
} else console.log('ALL CHECKS PASSED');
