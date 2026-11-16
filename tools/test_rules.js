// Resolved-config rule lint (tools only: it changes nothing under src/).
//
// Walks every face x phase x stake 0-7, plus duels 1-6, through the real R.Run.create / startDuel / startPhase.
// The rules of each fight are read off the duel those functions build (R.Combat.callsOf, mimic, stance, floor),
// never rebuilt from the table; the look and the rule cards come from R.Run.cfg(run, duel). Checks:
//   (a) every live rule's card is shown at or before the first fight where the rule goes live
//   (b) every card fits the card panel: name <= 150 px, line <= 2 lines at 140 px, every glyph exists,
//       and every card id a face names exists in R.Text.rules (a failure names the faces that use the card)
//   (c) face text: R.Text.bosses name / icon / line, boss_<id>_intro and boss_<id>_p<k> taunts
//   (d) the resolved look is known (who, mask, arena, music, change), cfg and duel agree on each rule,
//       and no table or cfg field is unclassified
//   (e) Mirror Rule: a mimic fight makes no calls
//   (f) a shown stance is never fixed: every stance-shown fight has 0 < honesty base < 1
// plus a static anchor on the scene's rule-card schedule, and a static sim/screen information parity check:
//   - the modeled expressions are read from tools/sim.js and src/scenes/duel.js and evaluated over a grid of states
//     against one SPEC;
//   - the sim's view is pinned whole: every field it writes is either modeled (written exactly once, as an
//     unconditional statement in the player's window) or public with its exact right-hand side in VIEW_PUBLIC; no
//     alias, computed access or extra call may reach view, and the only bot reads of the seal are pinned;
//   - the scene's screen fields written from the seal, and its reads of the seal before the buttons light, are pinned
//     as multisets, so a second (conditional) write or a read through a local FAILs.
//   It is a static check: code that reaches the seal by a route these patterns do not name is not seen.
// Self-tests at the end prove each check can fail (in-memory mutations, restored before exit). A self-test whose
// target is gone from the source is skipped with an INFO line (the main pass FAILs on the same gap).
//
// Output: "FAIL [...] ..." lines, one "KNOWN <id> <push>: ..." row per known-open defect (ids registered in
// tools/known.json), "INFO <id>: ..." lines, and a last summary line. Exit 1 on any FAIL, including an exception
// (printed as "FAIL [load|run] <message>", stack on stderr). Deterministic; writes nothing; runs no sim; makes no
// network request.
//   node tools/test_rules.js [--verbose]        --verbose also prints the resolved table
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const VERBOSE = process.argv.includes('--verbose');
const MODULES = ['core/rng.js', 'art/palette.js', 'art/pix.js', 'art/font.js', 'art/sprites.js', 'text/strings.js', 'text/taunts.js',
  'text/dossier.js', 'ai/brain.js', 'game/boons.js', 'game/combat.js', 'game/run.js'];
let R = null;
function loadModules() {
  for (const f of MODULES) require(path.join(SRC, ...f.split('/')));
  R = globalThis.RIVAL;
  if (!R || !R.Run || !R.Combat || !R.Text || !R.Font || !R.Brain) throw new Error('the src modules did not define RIVAL.Run / Combat / Text / Font / Brain');
}

function norm(s) { return String(s).replace(/\r\n?/g, '\n'); }
function norm1(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function readText(...parts) { return norm(fs.readFileSync(path.join(...parts), 'utf8')); }
function str(v) { return typeof v === 'string' && v.length > 0; }
function cellOf(f) { return f.face + ' d' + f.n + 'p' + f.k + ' s' + f.stake; }
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// Source text without comments. With blankStrings every string literal becomes '' (a quoted word is never read as
// code). Line breaks are kept. A quote left open (a regex literal, say) ends at the line break.
function codeOnly(text, blankStrings) {
  let out = '', i = 0, q = null, block = false;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (block) { if (c === '*' && d === '/') { block = false; i += 2; } else { if (c === '\n') out += '\n'; i++; } continue; }
    if (q) {
      if (c === '\n') { q = null; out += '\n'; i++; continue; }
      if (c === '\\') { if (!blankStrings) out += c + (d || ''); i += 2; continue; }
      if (c === q) { q = null; out += c; i++; continue; }
      if (!blankStrings) out += c;
      i++; continue;
    }
    if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { block = true; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') q = c;
    out += c; i++;
  }
  return out;
}
// Multiset difference, for pinned lists.
function msDiff(got, want) {
  const left = want.slice(), added = [];
  for (const x of got) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else added.push(x); }
  return 'new ' + JSON.stringify(added) + ', gone ' + JSON.stringify(left);
}

// ================================================================================================ tables
// Rows expected from the walk: 4 faces x 8 stakes x (6 duels + 2/3/4/3 phases). A new face or phase must update this.
const ROWS_EXPECTED = 288;
const STAKES = [0, 1, 2, 3, 4, 5, 6, 7];

// Which rule cards (R.Text.rules ids) explain each live rule. A live rule needs one of them shown first.
const RULE_CARDS = {
  calls: ['called_shot'],
  'floor=1': ['embers', 'bell_1', 'reflection'],
  'floor=2': ['bell_2'],
  'floor=3': ['bell_3'],
  'stance=none': ['blank'],
  mimic: ['likeness', 'reflection'],
  copyBoons: ['borrower', 'reflection'],
  'innate:painted_smile': ['jester'],
  'innate:thorned_guard': ['mourner'],
  fortify: ['mourner']
};
// The scene's card schedule (src/scenes/duel.js): rule cards appear only in duel 7, the first phase's in the intro and
// each later phase's at its transformation, or when that phase is rebuilt from an older-shape save (flow(), P1.1 V1:
// the same cards for the same phase). The anchor below fails if the scene's card call sites change.
function shownAt(row, D) {
  return row.n === 7 ? (D.cards || []).filter(id => own(R.Text.rules, id)) : [];
}
// Every line in src/ (outside src/text) that shows or reads rule cards, comments stripped. Matched by text.
const CARD_SITES = [
  'scenes/duel.js: if (rebuilt) yield* showCards(S.form.cards);',
  'scenes/duel.js: if (n === 7) yield* showCards(S.form.cards);',
  'scenes/duel.js: function* showCards(ids) {',
  'scenes/duel.js: var rules = (R.Text && R.Text.rules) || {}, k, until;',
  'scenes/duel.js: yield* showCards(S.form.cards);'
];

const WHO_KNOWN = ['rival', 'rival2', 'mirror'];
const CHANGE_KNOWN = ['shatter', 'swap', 'bell'];
const STANCE_KNOWN = [null, 'none'];
const CFG_KEYS = ['n', 'name', 'rivalHp', 'exploit', 'honesty', 'tau', 'rivalBoons', 'variant', 'phase', 'phases', 'last', 'floor', 'calls',
  'stance', 'mimic', 'innate', 'fortify', 'copyBoons', 'heal', 'who', 'mask', 'arena', 'witch', 'music', 'change', 'cards'];
const FACE_KEYS = ['id', 'name', 'phases'];
const PHASE_KEYS = ['name', 'hp', 'exploit', 'honesty', 'heal', 'floor', 'calls', 'stance', 'mimic', 'innate', 'fortify', 'copyBoons',
  'who', 'mask', 'arena', 'witch', 'music', 'change', 'cards'];
// The faces whose intro / phase-2 line may come from the classic categories (scenes/duel.js bossTaunt fallback).
const TAUNT_FALLBACK = { unmasked: { intro: 'final_duel_intro', p2: 'phase2' } };

const CARD_NAME_PX = 150, CARD_LINE_PX = 140, CARD_LINES = 2;

// Known-open defects, each scheduled for a later push. A failure a row's predicate matches is KNOWN only when its
// cell is pinned below; a new cell is a FAIL, and a pinned cell that no longer fails is a FAIL (remove it in the fix).
const KNOWN = [
  {
    id: 'rule-unsaid-card', push: 'P1.3',
    text: 'B21: at stake 7 calls are live from duel 1, but rule cards show only in duel 7, so no CALLED SHOT card comes first',
    match: f => f.check === 'a' && f.rule === 'calls' && f.n >= 1 && f.n <= 6,
    cells: ['unmasked d1p1 s7', 'three_faced d1p1 s7', 'hours d1p1 s7', 'reflection d1p1 s7']
  },
  {
    id: 'rule-mirror-calls', push: 'P1.2',
    text: 'V2: a mimic phase makes calls (Mirror Rule broken: light 7 adds calls without looking at mimic)',
    match: f => f.check === 'e',
    cells: ['reflection d7p2 s7', 'reflection d7p3 s7']
  }
];

// ================================================================================================ the walk
function rowOf(face, stake, run, d) {
  const D = R.Run.cfg(run, d);
  return {
    face, stake, n: d.n, k: d.phase,
    calls: R.Combat.callsOf(d), mimic: !!d.mimic, stance: d.stance === undefined ? null : d.stance, floor: R.Combat.floorOf(d),
    duel: { floor: d.floor, stance: d.stance === undefined ? null : d.stance, mimic: !!d.mimic, n: d.n, phase: d.phase },
    D
  };
}
// Every fight of every face (or of the listed faces) at every stake, in fight order. A malformed row that makes the
// game code throw is a walk failure for that face and stake, not a crash.
function walk(faceIds) {
  const rows = [], errs = [];
  for (const b of R.Run.BOSSES) {
    if (faceIds && !faceIds.includes(b.id)) continue;
    for (const s of STAKES) {
      let at = 'R.Run.create';
      try {
        const run = R.Run.create(R.Run.defaultMeta(), { seed: 31, now: 1.7e12, boss: b.id, anyBoss: true, stake: s, anyStake: true });
        if (run.boss !== b.id || R.Run.stakeOf(run) !== s) { errs.push('run for ' + b.id + ' s' + s + ' got face ' + run.boss + ' stake ' + R.Run.stakeOf(run)); continue; }
        for (let n = 1; n <= 7; n++) { at = 'startDuel d' + n; run.duelN = n; rows.push(rowOf(b.id, s, run, R.Run.startDuel(run))); }
        for (let k = 2; k <= b.phases.length; k++) { at = 'startPhase p' + k; rows.push(rowOf(b.id, s, run, R.Run.startPhase(run, k))); }
      } catch (e) {
        errs.push('face ' + b.id + ' s' + s + ': ' + at + ' threw: ' + (e && e.message ? e.message : String(e)));
      }
    }
  }
  return { rows, errs };
}

// ================================================================================================ checks
let checks = 0;
function mk(fails) {
  return function (cond, f) { checks++; if (!cond) fails.push(f); return !!cond; };
}

// The live rules of one fight, as keys of RULE_CARDS.
function liveRules(row) {
  const out = [], D = row.D;
  if (row.calls) out.push('calls');
  if (row.floor > 0) out.push('floor=' + row.floor);
  if (row.stance === 'none') out.push('stance=none');
  if (row.mimic) out.push('mimic');
  if (D.copyBoons) out.push('copyBoons');
  for (const id of D.innate || []) out.push('innate:' + id);
  if (D.fortify > 0) out.push('fortify');
  return out;
}

// (a) card coverage, cumulative per (face, stake) in fight order; once per (face, stake, rule).
function checkCoverage(rows) {
  const fails = [], ok = mk(fails);
  const shown = new Map(), live = new Map();
  for (const row of rows) {
    const key = row.face + '/' + row.stake;
    if (!shown.has(key)) { shown.set(key, new Set()); live.set(key, new Set()); }
    const sh = shown.get(key), seen = live.get(key);
    for (const id of shownAt(row, row.D)) sh.add(id);
    for (const rule of liveRules(row)) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      const base = { check: 'a', rule, face: row.face, stake: row.stake, n: row.n, k: row.k };
      const ids = RULE_CARDS[rule];
      if (!ids) { ok(false, Object.assign(base, { msg: 'rule ' + rule + ' is live but has no card mapping in RULE_CARDS' })); continue; }
      ok(ids.some(id => sh.has(id)), Object.assign(base, { msg: 'rule ' + rule + ' live before any of [' + ids.join(', ') + '] was shown' }));
    }
  }
  for (const rule of Object.keys(RULE_CARDS)) for (const id of RULE_CARDS[rule]) {
    ok(!!R.Text.rules[id], { check: 'a', msg: 'RULE_CARDS ' + rule + ' names card ' + id + ', which is not in R.Text.rules' });
  }
  return fails;
}

// (b) card fit. One card as the scene draws it: name centred, line wrapped at 140 px, only two lines drawn.
function cardFit(ok, label, name, line) {
  if (!ok(str(name) && str(line), { check: 'b', msg: label + ': card needs a name and a line' })) return;
  const nw = R.Font.width(name);
  ok(nw <= CARD_NAME_PX, { check: 'b', msg: label + ': card name "' + name + '" is ' + nw + ' px (max ' + CARD_NAME_PX + ')' });
  const ls = R.Font.wrap(line, CARD_LINE_PX);
  ok(ls.length <= CARD_LINES, { check: 'b', msg: label + ': card line wraps to ' + ls.length + ' lines at ' + CARD_LINE_PX + ' px (only ' + CARD_LINES + ' are drawn): ' + JSON.stringify(ls) });
  for (const l of ls) ok(R.Font.width(l) <= CARD_LINE_PX, { check: 'b', msg: label + ': wrapped line "' + l + '" is ' + R.Font.width(l) + ' px' });
  for (const ch of new Set((name + line).split(''))) ok(R.Font.has(ch), { check: 'b', msg: label + ': glyph ' + JSON.stringify(ch) + ' is not in the font' });
}
function checkCards(rows) {
  const fails = [], ok = mk(fails);
  const rules = R.Text.rules || {};
  // which faces and phases name each card (cfg.cards), so a card failure says whose card it is
  const namedBy = new Map();
  for (const row of rows) for (const id of Array.isArray(row.D.cards) ? row.D.cards : []) {
    if (!namedBy.has(id)) namedBy.set(id, new Set());
    namedBy.get(id).add(row.face + ' p' + row.k);
  }
  const whose = id => namedBy.has(id) ? 'named by ' + [...namedBy.get(id)].join(', ') : 'named by no face';
  ok(Object.keys(rules).length > 0, { check: 'b', msg: 'R.Text.rules is empty' });
  for (const id of Object.keys(rules)) cardFit(ok, 'rule card ' + id + ' (' + whose(id) + ')', rules[id] && rules[id].name, rules[id] && rules[id].line);
  // every id a face names must exist: the scene silently skips unknown ids
  const done = new Set();
  for (const row of rows) {
    const cards = row.D.cards;
    if (cards === null) continue;
    if (!ok(Array.isArray(cards), { check: 'b', face: row.face, stake: row.stake, n: row.n, k: row.k, msg: 'cards is not an array' })) continue;
    for (const id of cards) {
      const key = row.face + '/' + row.k + '/' + id;
      if (done.has(key)) continue;
      done.add(key);
      ok(own(rules, id), { check: 'b', face: row.face, stake: row.stake, n: row.n, k: row.k, msg: 'card id "' + id + '" is not in R.Text.rules (the scene would skip it)' });
    }
  }
  // the two other cards the scene draws in the same panel: the omen (which face waits) and the Empty Hand (light 4)
  const TB = R.Text.bosses || {};
  for (const b of R.Run.BOSSES) cardFit(ok, 'omen card ' + b.id, String((TB[b.id] && TB[b.id].name) || b.name).toUpperCase(), TB.omen);
  const armed = (R.Text.vigil || {}).armed;
  for (const b of R.Boons.list) {
    if (b.relic) continue;
    const nm = ((R.Text.boon && R.Text.boon[b.id] && R.Text.boon[b.id].name) || b.name || b.id).toUpperCase();
    cardFit(ok, 'Empty Hand card ' + b.id, nm, armed);
  }
  return fails;
}

// (c) face text.
function checkFaceText(faces, artSrc) {
  const fails = [], ok = mk(fails);
  const TB = R.Text.bosses || {}, TT = R.Text.taunts || {};
  const nonEmpty = cat => Array.isArray(TT[cat]) && TT[cat].length > 0 && TT[cat].every(str);
  for (const b of faces) {
    const t = TB[b.id];
    ok(!!t && str(t.name) && str(t.icon) && str(t.line), { check: 'c', face: b.id, msg: 'R.Text.bosses.' + b.id + ' needs name, icon and line' });
    if (t && str(t.icon)) ok(new RegExp('(^|[\\s{,])' + t.icon.replace(/[^\w]/g, '') + '\\s*:').test(artSrc), { check: 'c', face: b.id, msg: 'icon "' + t.icon + '" is not defined in src/art' });
    const kinds = ['intro'];
    for (let k = 2; k <= b.phases.length; k++) kinds.push('p' + k);
    for (const kind of kinds) {
      const cat = 'boss_' + b.id + '_' + kind, fb = TAUNT_FALLBACK[b.id] && TAUNT_FALLBACK[b.id][kind];
      if (nonEmpty(cat)) { ok(true); continue; }
      if (fb) ok(nonEmpty(fb), { check: 'c', face: b.id, msg: 'no ' + cat + ' and its fallback ' + fb + ' is empty' });
      else ok(false, { check: 'c', face: b.id, msg: 'taunt category ' + cat + ' is missing or empty' });
    }
  }
  return fails;
}

// (d) resolved look, cfg/duel agreement, unclassified fields.
function checkLook(rows, faces, cues) {
  const fails = [], ok = mk(fails);
  for (const b of faces) {
    for (const key of Object.keys(b)) ok(FACE_KEYS.includes(key), { check: 'd', face: b.id, msg: 'unclassified face field "' + key + '": classify it in tools/test_rules.js' });
    b.phases.forEach((ph, i) => {
      if (!ok(!!ph && typeof ph === 'object', { check: 'd', face: b.id, msg: 'phase ' + (i + 1) + ' is not an object: ' + JSON.stringify(ph) })) return;
      for (const key of Object.keys(ph)) ok(PHASE_KEYS.includes(key), { check: 'd', face: b.id, msg: 'phase ' + (i + 1) + ': unclassified phase field "' + key + '": classify it in tools/test_rules.js (and in RULE_CARDS if it is a rule)' });
    });
  }
  for (const row of rows) {
    const D = row.D, c = { face: row.face, stake: row.stake, n: row.n, k: row.k, check: 'd' };
    const at = m => Object.assign({}, c, { msg: m });
    for (const key of Object.keys(D)) ok(CFG_KEYS.includes(key), at('unclassified cfg field "' + key + '": classify it in tools/test_rules.js'));
    ok(D.n === row.n && D.phase === row.k, at('cfg is for d' + D.n + 'p' + D.phase + ', the duel is d' + row.n + 'p' + row.k));
    ok(WHO_KNOWN.includes(D.who), at('who "' + D.who + '" is not one of ' + WHO_KNOWN.join('/')));
    ok(!!(R.Art.anim && R.Art.anim(D.who, 'idle')), at('who "' + D.who + '" has no idle animation'));
    ok(D.mask === null || own(R.Text.masks || {}, D.mask), at('mask "' + D.mask + '" is not in R.Text.masks'));
    ok(D.arena === null || own(R.Text.arenas || {}, D.arena), at('arena "' + D.arena + '" is not in R.Text.arenas'));
    ok(cues.has(D.music), at('music "' + D.music + '" is not an audio cue'));
    if (row.n < 7 || row.k === 1) ok(D.change === null, at('change "' + D.change + '" on a fight that does not follow a phase'));
    else ok(CHANGE_KNOWN.includes(D.change), at('change "' + D.change + '" is not one of ' + CHANGE_KNOWN.join('/')));
    ok(STANCE_KNOWN.includes(D.stance), at('stance "' + D.stance + '" is not null or none'));
    // one source per rule: the scene reads the look and the stance from cfg, the rules from the duel
    ok(D.stance === row.duel.stance, at('cfg stance ' + D.stance + ' but duel stance ' + row.duel.stance));
    ok(D.mimic === row.duel.mimic, at('cfg mimic ' + D.mimic + ' but duel mimic ' + row.duel.mimic));
    ok(D.floor === row.duel.floor, at('cfg floor ' + D.floor + ' but duel floor ' + row.duel.floor));
    ok(Number.isInteger(row.floor) && row.floor >= 0 && row.floor <= 3, at('floor ' + row.floor + ' out of 0..3'));
    ok(D.heal === null || (typeof D.heal === 'number' && D.heal >= 0), at('heal ' + D.heal));
    ok(typeof D.witch === 'boolean' && typeof D.copyBoons === 'boolean', at('witch / copyBoons must be booleans'));
    ok(typeof D.fortify === 'number' && D.fortify >= 0, at('fortify ' + D.fortify));
    for (const id of D.innate || []) ok(!!(R.Boons.byId[id] && R.Text.boon && R.Text.boon[id]), at('innate boon "' + id + '" is not a known boon with text'));
  }
  return fails;
}

// (e) Mirror Rule and (f) stance honesty.
function checkMirrorHonesty(rows) {
  const fails = [], ok = mk(fails);
  const K = R.Brain.K || {};
  ok(K.H_MIN > 0 && K.H_MAX < 1, { check: 'f', msg: 'the brain honesty clamp must stay inside (0, 1): H_MIN ' + K.H_MIN + ', H_MAX ' + K.H_MAX });
  for (const row of rows) {
    const c = { face: row.face, stake: row.stake, n: row.n, k: row.k };
    ok(!(row.mimic && row.calls), Object.assign({ check: 'e', msg: 'Mirror Rule: mimic fight makes calls' }, c));
    if (row.stance === 'none') continue;
    const h = row.D.honesty;
    ok(typeof h === 'number' && h > 0 && h < 1, Object.assign({ check: 'f', msg: 'stance is shown but honesty base is ' + h + ' (must be strictly between 0 and 1)' }, c));
  }
  return fails;
}

// Scene anchor: the card schedule shownAt() copies must not drift.
function scanCardSites(files) {
  const got = [];
  for (const [rel, text] of files) {
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      if (/showCards\(|Text\.rules|\.rules\[/.test(line)) got.push(rel + ': ' + line);
    }
  }
  return got;
}
function checkCardSites(files) {
  const fails = [], ok = mk(fails);
  const got = scanCardSites(files).sort(), want = CARD_SITES.slice().sort();
  ok(JSON.stringify(got) === JSON.stringify(want), {
    check: 'anchor',
    msg: "the scene's rule-card schedule changed: update shownAt() and CARD_SITES in tools/test_rules.js in the same commit. " +
      'Now: ' + JSON.stringify(got.filter(x => !want.includes(x))) + ' gone: ' + JSON.stringify(want.filter(x => !got.includes(x)))
  });
  return fails;
}

// ================================================================================================ sim/screen parity
// One SPEC for what the screen shows and what the sim hands the bot, from the same turn state. The sim's view lines
// (tools/sim.js) and the scene's info / hint / stamp code (src/scenes/duel.js) are read as text, evaluated over a grid
// of states, and compared with the SPEC and with each other. The one declared difference: on hint turns (IT CALLS,
// GUARD BROKEN, DEATHBLOW) the screen's hint row replaces the Ledger / Tally line, but the bot still gets them.
// P1.3 closes it (two-line hint row) and must delete HIDDEN_BY_HINT in the same commit as the sim view lines.
const HIDDEN_BY_HINT = true;
const MV = m => R.Text.move(m);
const UI = (k, d) => (R.Text.ui && R.Text.ui[k]) || d;
function dots(c) { return c > 0.66 ? 3 : c > 0.33 ? 2 : 1; }
function pctOf(st) { return Math.round(st.h * 10) * 10; }
const SPEC = {
  hint: st => st.called ? 'IT CALLS: ' + MV(st.called).toUpperCase() : st.gb > 0 ? UI('guardBroken', 'GUARD BROKEN') : st.tension >= 3 ? UI('deathblow', 'DEATHBLOW') : null,
  infoLine: st => st.ledger ? 'IT EXPECTS ' + MV(st.top).toUpperCase() + ' ' + '!'.repeat(dots(st.conf)) : st.tally ? 'HONESTY ~' + pctOf(st) + '%' : null,
  screen: st => ({ row: SPEC.hint(st) || SPEC.infoLine(st), stamp: st.coin && st.turn === 1 && !st.noStance ? st.honest : null, tell: st.noStance ? null : st.tell }),
  bot: st => ({
    stamp: st.coin && st.turn === 1 && !st.noStance ? st.honest : null,
    ledger: st.ledger ? { top: st.top, dots: dots(st.conf) } : null,
    tallyH: !st.ledger && st.tally ? pctOf(st) : null,
    tell: st.noStance ? null : st.tell
  })
};
function botRow(b) { return b.ledger ? 'IT EXPECTS ' + MV(b.ledger.top).toUpperCase() + ' ' + '!'.repeat(b.ledger.dots) : b.tallyH !== null && b.tallyH !== undefined ? 'HONESTY ~' + b.tallyH + '%' : null; }

// The sim's view, pinned whole (tools/sim.js). The modeled fields are evaluated against SPEC; every other field the
// sim writes is public and pinned with its exact right-hand side (whitespace collapsed). A new field, a changed public
// value or a second write of any field FAILs until SPEC and these tables change in the same commit.
const VIEW_DECL = '{ info: { stamp: null, ledger: null, tallyH: null }, rng: botRng }';
const VIEW_MODELED = ['info.stamp', 'info.ledger', 'info.tallyH', 'tell'];
const VIEW_PUBLIC = {
  use: 'function (id) {', n: 'duel.n', phase: 'duel.phase', turn: 'duel.turn', ctx: 'ctx', legalP: 'legalP', legalR: 'legalR',
  clashRun: 'clashRun', called: 'called', payoff: 'payoff', tension: 'duel.tension', mimic: '!!duel.mimic',
  pHp: 'duel.p.hp', rHp: 'duel.r.hp', pBoons: 'duel.p.boons', rBoons: 'duel.r.boons', charges: 'duel.p.charges', boredHit: '0'
};
const VIEW_WINDOW = ['const inf = C.info(duel);', 'bot.pick('];                  // the player's window in fight()
const VIEW_CALLS = ['bot.pick', 'bot.after', 'JSON.stringify'];                  // the only calls handed view or view.info
const SIM_BOT_SEAL = ['bot.after(view, pm, sealed.move, res)'];                 // bot calls that read the seal (after the resolve)
// The only route from the seal to a bot before it picks: view.use, the Keyhole / Candle of Truth reveals (the same
// two the scene's S.reveal shows).
const SIM_REVEALS = ["if (r.kind === 'glimpse') return cur.sealed.move;", "if (r.kind === 'honesty') return cur.sealed.honest;"];
// The scene (src/scenes/duel.js): every write of a drawn turn field (or of any S field from the seal) that is not a
// reset, as "<field> <- <seal reads or other>", and the scene's reads of the seal between the commit and the moment the
// buttons light. Both multisets are pinned.
const SCREEN_FIELDS = ['tell', 'stanceText', 'stamp', 'infoLine', 'hint', 'called', 'calledText', 'glass', 'noStance'];
const SCREEN_WRITES = [
  'called <- other', 'calledText <- other', 'glass <- sealed.move', 'glass <- sealed.move', 'hint <- other', 'infoLine <- other',
  'infoLine <- sealed.confidence+sealed.top', 'noStance <- other', 'stamp <- sealed.honest', 'stamp <- sealed.honest', 'stamp <- sealed.honest',
  'stanceText <- sealed.tell', 'tell <- sealed.tell'
];
const SCREEN_WINDOW = ['sealed = brain.commit(q);', 'S.input = true;'];
const SCREEN_READS = { '(whole)': 1, confidence: 2, honest: 3, move: 2, tell: 3, top: 1 };

// The argument list of every call in code (strings blanked), at its own depth only: [{ callee, args, at }].
const NOT_CALLS = ['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'with', 'delete', 'void', 'new', 'yield'];
function callsIn(code) {
  const out = [];
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g)) {
    const callee = m[1].replace(/\s+/g, '');
    if (NOT_CALLS.includes(callee) || /(^|\.)function$/.test(callee)) continue;
    let depth = 1, i = m.index + m[0].length, own1 = '';
    for (; i < code.length && depth > 0; i++) {
      const ch = code[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (depth === 1 && !(ch === '(' || ch === '[' || ch === '{')) own1 += ch;
      else if (depth === 2 && (ch === '(' || ch === '[' || ch === '{')) own1 += ' ';
    }
    out.push({ callee, args: norm1(own1), full: norm1(code.slice(m.index + m[0].length, i - 1)), at: m.index });
  }
  return out;
}
// Why a write at `at` is not an unconditional statement of the block that holds `from`, or null.
function guarded(code, from, at) {
  let br = 0, pa = 0;
  for (const ch of code.slice(from, at)) { if (ch === '{') br++; else if (ch === '}') br--; else if (ch === '(') pa++; else if (ch === ')') pa--; }
  if (br !== 0) return 'inside a block that opens after ' + JSON.stringify(VIEW_WINDOW[0]);
  if (pa !== 0) return 'inside an open parenthesis';
  const ls = code.lastIndexOf('\n', at - 1) + 1, before = code.slice(ls, at).trim();
  if (before && !/;$/.test(before)) return 'after "' + before + '" on its line';
  if (!before) { const prev = code.slice(from, ls).replace(/\s+$/, ''); if (prev && !/[;{}]$/.test(prev)) return 'after a line that ends "' + prev.slice(-24).trim() + '"'; }
  return null;
}
function checkSimView(simText, fails) {
  const FILE = 'tools/sim.js';
  const bad = msg => fails.push({ check: 'parity', msg: msg + ' (' + FILE + '); the sim and the screen must change in lockstep: update SPEC / VIEW_PUBLIC in tools/test_rules.js' });
  const code = codeOnly(simText, true), kept = codeOnly(simText, false);
  const n0 = fails.length;
  checks++;
  const decl = [...code.matchAll(/\b(?:const|let|var)\s+view\s*=\s*([^;\n]*);/g)].map(m => norm1(m[1]));
  if (decl.length !== 1 || decl[0] !== VIEW_DECL) bad('the view declaration changed: ' + JSON.stringify(decl) + ', pinned ' + JSON.stringify(VIEW_DECL));
  const assigns = (code.match(/(?<![.\w$])view\s*=(?!=)/g) || []).length;
  if (assigns !== 1) bad('view itself is assigned ' + assigns + ' times (only its declaration may)');
  // every field write, by path
  const writes = new Map();
  for (const m of code.matchAll(/(?<![.\w$])view((?:\s*\.\s*[\w$]+)+)\s*[-+*\/%&|^?]{0,3}=(?!=)/g)) {
    const p = m[1].replace(/\s+/g, '').slice(1);
    const rest = code.slice(m.index + m[0].length), end = rest.search(/;|\n/);
    if (!writes.has(p)) writes.set(p, []);
    writes.get(p).push({ at: m.index, rhs: norm1(end < 0 ? rest : rest.slice(0, end)) });
  }
  for (const m of code.matchAll(/(?<![.\w$])view(?:\.[\w$]+)+\s*(?:\+\+|--)|(?:\+\+|--)\s*view\b|\bdelete\s+view\b/g)) bad('a view field changed in place: ' + norm1(m[0]));
  for (const m of code.matchAll(/(?<![.\w$])view(?:\s*\.\s*[\w$]+)*\s*\[/g)) bad('computed access on view: ' + norm1(m[0]) + '...');
  for (const m of code.matchAll(/(?:[^=!<>]=|:|\[|\breturn\b|=>|\?)\s*view(?:\.info)?\s*(?=[;,)\]}\n])/g)) bad('an alias of view: ' + norm1(m[0]));
  for (const c of callsIn(code)) {
    const hasView = /(?<![.\w$])view(?![\w$])/.test(c.args);
    if (hasView && !VIEW_CALLS.includes(c.callee)) bad('view handed to ' + c.callee + '(' + c.full + ')');
    if (c.callee === 'bot.pick' && c.full !== 'view') bad('bot.pick(' + c.full + ') (pinned: bot.pick(view))');
    if (/^bot\.[\w$]+$/.test(c.callee) && /(?<![.\w$])(sealed|cur)(?![\w$])/.test(c.full) && !SIM_BOT_SEAL.includes(c.callee + '(' + c.full + ')')) bad('a bot call reads the seal: ' + c.callee + '(' + c.full + ')');
  }
  // the field set: modeled or public, nothing else
  for (const [p, ws] of writes) {
    if (VIEW_MODELED.includes(p)) continue;
    if (!own(VIEW_PUBLIC, p)) { bad('new view field: view.' + p + ' = ' + ws[0].rhs + ' (model it in SPEC or pin it in VIEW_PUBLIC)'); continue; }
    if (ws.length !== 1) bad('view.' + p + ' is written ' + ws.length + ' times (pinned once)');
    for (const w of ws) if (w.rhs !== VIEW_PUBLIC[p]) bad('view.' + p + ' = ' + w.rhs + ' (pinned: ' + VIEW_PUBLIC[p] + ')');
  }
  for (const p of Object.keys(VIEW_PUBLIC).concat(VIEW_MODELED)) if (!writes.has(p)) bad('view.' + p + ' is no longer written');
  // the modeled writes: once each, unconditional, inside the player's window
  const a = code.indexOf(VIEW_WINDOW[0]), b = a < 0 ? -1 : code.indexOf(VIEW_WINDOW[1], a);
  if (a < 0 || b < 0) bad('extractor broke: the player\'s window ' + JSON.stringify(VIEW_WINDOW[0]) + ' ... ' + JSON.stringify(VIEW_WINDOW[1]) + ' not found');
  for (const p of VIEW_MODELED) {
    const ws = writes.get(p) || [];
    if (ws.length > 1) bad('view.' + p + ' is written ' + ws.length + ' times (expected once: a second write, conditional or not, hands the bot something SPEC does not model)');
    if (ws.length !== 1 || a < 0 || b < 0) continue;
    if (ws[0].at < a || ws[0].at > b) { bad('view.' + p + ' is written outside the player\'s window'); continue; }
    const why = guarded(code, a, ws[0].at);
    if (why) bad('view.' + p + ' is written ' + why + ' (a modeled write must be an unconditional statement)');
  }
  // the reveals
  const rev = kept.split('\n').map(l => l.trim()).filter(l => /(?<![.\w$])cur\s*(\.\s*sealed\b|\[)/.test(l)).sort();
  if (JSON.stringify(rev) !== JSON.stringify(SIM_REVEALS.slice().sort())) bad('the reveal lines that read cur.sealed changed: ' + msDiff(rev, SIM_REVEALS));
  return fails.length === n0;
}
function checkScreenWrites(duelText, fails) {
  const FILE = 'src/scenes/duel.js';
  const bad = msg => fails.push({ check: 'parity', msg: msg + ' (' + FILE + '); the sim and the screen must change in lockstep: check SPEC, then update SCREEN_WRITES / SCREEN_READS in tools/test_rules.js' });
  const code = codeOnly(duelText, true);
  const n0 = fails.length;
  checks++;
  const got = [];
  for (const m of code.matchAll(/(?<![.\w$])S\s*\.\s*([\w$]+)\s*[-+*\/%&|^?]{0,3}=(?!=)/g)) {
    const rest = code.slice(m.index + m[0].length), end = rest.search(/;|\n/);
    const rhs = norm1((end < 0 ? rest : rest.slice(0, end)).replace(/\}\s*$/, ''));
    const src = [...new Set([...rhs.matchAll(/(?<![.\w$])sealed(?:\s*\.\s*[\w$]+)?/g)].map(x => x[0].replace(/\s+/g, '')))].sort();
    if (!SCREEN_FIELDS.includes(m[1]) && !src.length) continue;
    if (!src.length && /^(null|''|""|false|true|0)$/.test(rhs)) continue;
    got.push(m[1] + ' <- ' + (src.length ? src.join('+') : 'other'));
  }
  got.sort();
  const want = SCREEN_WRITES.slice().sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) bad('the drawn turn fields written outside a reset changed: ' + msDiff(got, want));
  const a = code.indexOf(SCREEN_WINDOW[0]), b = a < 0 ? -1 : code.indexOf(SCREEN_WINDOW[1], a);
  if (a < 0 || b < 0) bad('extractor broke: the input window ' + JSON.stringify(SCREEN_WINDOW[0]) + ' ... ' + JSON.stringify(SCREEN_WINDOW[1]) + ' not found');
  else {
    const reads = {};
    for (const m of code.slice(a + SCREEN_WINDOW[0].length, b).matchAll(/(?<![.\w$])sealed(?![\w$])(\s*\.\s*[\w$]+|\s*:)?/g)) {
      if (m[1] && m[1].trim() === ':') continue;                       // an object key named sealed, not a read
      const k = m[1] ? m[1].replace(/[\s.]+/g, '') : '(whole)';
      reads[k] = (reads[k] || 0) + 1;
    }
    const sortObj = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    if (sortObj(reads) !== sortObj(SCREEN_READS)) bad('the scene\'s reads of the seal before the buttons light changed: now ' + sortObj(reads) + ', pinned ' + sortObj(SCREEN_READS));
  }
  return fails.length === n0;
}

function grab(fails, text, re, what, file, once) {
  const all = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  checks++;
  if (!all || (once && all.length !== 1)) {
    fails.push({ check: 'parity', msg: (all ? what + ' found ' + all.length + ' times' : 'extractor broke: ' + what + ' not found') + ' in ' + file + ' (expected ' + (once ? 'once' : 'at least once') + '); the sim and the screen must change in lockstep: update SPEC in tools/test_rules.js' });
    return null;
  }
  return text.match(re);
}
// Build evaluators from the two sources. Returns null when an extractor broke (failures recorded). The modeled sim
// writes are counted by checkSimView (exactly once each), so here they are only located.
function parityModel(simText, duelText, fails) {
  const SIM = 'tools/sim.js', SCN = 'src/scenes/duel.js';
  const sStamp = grab(fails, simText, /\bview\.info\.stamp = ([^;\n]+);/, 'view.info.stamp', SIM, false);
  const sLedger = grab(fails, simText, /\bview\.info\.ledger = ([^;\n]+);/, 'view.info.ledger', SIM, false);
  const sTally = grab(fails, simText, /\bview\.info\.tallyH = ([^;\n]+);/, 'view.info.tallyH', SIM, false);
  const sTell = grab(fails, simText, /\bview\.tell = ([^;\n]+);/, 'view.tell', SIM, false);
  const sCalled = grab(fails, simText, /\bif \(([^\n]*?)\) called = argmaxMove\(brain\.predict\(ctx, legalP\), legalP\);/, 'the call decision', SIM, true);
  const anchors = [
    [simText, /\bconst noStance = duel\.stance === 'none';/, 'noStance from duel.stance', SIM],
    [simText, /\bconst inf = C\.info\(duel\);/, 'inf = C.info(duel)', SIM],
    [simText, /\bview\.called = called;/, 'view.called = called', SIM],
    [simText, /exploit: cfg\.exploit, honestyBase: cfg\.honesty/, 'commit exploit / honestyBase', SIM],
    [simText, /\bif \(noStance\) cq\.noTell = true;/, 'noTell on stance none', SIM],
    [simText, /\bif \(duel\.mimic\) cq\.mimic = C\.ctx\(duel, 'r'\);/, 'mimic ctx', SIM],
    [duelText, /\bS\.noStance = D\.stance === 'none';/, 'S.noStance from cfg stance', SCN],
    [duelText, /\bif \(S\.noStance\) \{ S\.tell = null;[^\n]*\}\n[ \t]*else \{\n[ \t]*S\.tell = sealed\.tell;/, 'stance hidden on noStance', SCN],
    [duelText, /\bS\.called = called;/, 'S.called = called', SCN],
    [duelText, /exploit: cfg\.exploit, honestyBase: cfg\.honesty/, 'commit exploit / honestyBase', SCN],
    [duelText, /\bif \(duel\.stance === 'none'\) q\.noTell = true;/, 'noTell on stance none', SCN],
    [duelText, /\bif \(duel\.mimic\) q\.mimic = R\.Combat\.ctx\(duel, 'r'\);/, 'mimic ctx', SCN],
    [duelText, /\bS\.hint = hintFor\(duel\);/, 'S.hint = hintFor(duel)', SCN]
  ];
  let anchorsOk = true;
  for (const [t, re, what, file] of anchors) if (!grab(fails, t, re, what, file, false)) anchorsOk = false;
  const cInfo = grab(fails, duelText, /(var info = R\.Combat\.info \? R\.Combat\.info\(duel\) : null;\n[ \t]*S\.infoLine = null;\n([ \t]*)if \(info\) \{\n[\s\S]*?\n\2\})/, 'the info block', SCN, true);
  const cHint = grab(fails, duelText, /\n([ \t]*)function hintFor\(duel\) \{\n([\s\S]*?)\n\1\}/, 'hintFor()', SCN, true);
  const cRow = grab(fails, duelText, /\bvar hint = S\.input \? \(([^()\n]+)\) : null;/, 'the hint row', SCN, true);
  const cStampDraw = grab(fails, duelText, /\bif \((S\.stamp !== null[^\n{]*)\) \{\n[ \t]*R\.Font\.draw\(g, S\.stamp \? ui\('trueStance'/, 'the stamp draw', SCN, true);
  const cCalled = grab(fails, duelText, /\bif \(([^\n]*?)\) called = argmaxMove\(brain\.predict\(ctx, legalP\), legalP\);/, 'the call decision', SCN, true);
  if (!(sStamp && sLedger && sTally && sTell && sCalled && cInfo && cHint && cRow && cStampDraw && cCalled && anchorsOk)) return null;
  // The call decision is the same rule on both sides; the scene also skips calls in the scripted tutorial (declared).
  const callScene = cCalled[1].replace(/\bR\.Combat\./g, 'C.').replace(/\s*&&\s*!tut\b/, '');
  checks++;
  if (callScene !== sCalled[1]) fails.push({ check: 'parity', msg: 'call decision differs: sim "' + sCalled[1] + '", screen "' + cCalled[1] + '"' });
  try {
    return {
      sim: new Function('inf', 'noStance', 'sealed', 'brain', 'cfg', 'view',
        'view.info.stamp = ' + sStamp[1] + ';\nview.info.ledger = ' + sLedger[1] + ';\nview.info.tallyH = ' + sTally[1] + ';\nview.tell = ' + sTell[1] + ';'),
      info: new Function('R', 'duel', 'S', 'sealed', 'mname', 'brain', 'cfg', cInfo[1]),
      hint: new Function('S', 'mname', 'ui', 'duel', cHint[2]),
      row: new Function('S', 'return S.input ? (' + cRow[1] + ') : null;'),
      stampShown: new Function('S', 'return ' + cStampDraw[1] + ';')
    };
  } catch (e) {
    fails.push({ check: 'parity', msg: 'extracted code does not compile: ' + e.message });
    return null;
  }
}
function* gridStates() {
  for (const called of [null, 'G']) for (const gb of [0, 1]) for (const tension of [0, 3]) for (const ledger of [false, true])
    for (const tally of [false, true]) for (const coin of [false, true]) for (const turn of [1, 2]) for (const noStance of [false, true])
      for (const conf of [0.2, 0.33, 0.34, 0.5, 0.66, 0.67, 0.9]) for (const h of [0.42, 0.97]) for (const honest of [true, false]) for (const top of ['S', 'F'])
        yield { called, gb, tension, ledger, tally, coin, turn, noStance, conf, h, honest, top, tell: top === 'S' ? 'G' : 'S' };
}
function checkParity(simText, duelText) {
  const fails = [];
  checkSimView(simText, fails);
  checkScreenWrites(duelText, fails);
  const m = parityModel(simText, duelText, fails);
  const stat = { states: 0, info: 0, hintInfo: 0, hidden: 0 };
  if (!m) return { fails, stat };
  const mname = MV, ui = UI;
  const bad = { screen: 0, sim: 0, parity: 0 }, first = {};
  const miss = (kind, st, got, want) => { bad[kind]++; if (!first[kind]) first[kind] = { st, got, want }; };
  for (const st of gridStates()) {
    stat.states++;
    const boons = [];
    if (st.ledger) boons.push('stolen_ledger');
    if (st.tally) boons.push('liars_tally');
    if (st.coin) boons.push('relic_liars_coin');
    const duel = { turn: st.turn, tension: st.tension, p: { boons, counters: {}, status: { guardBroken: st.gb } } };
    const sealed = { honest: st.honest, top: st.top, confidence: st.conf, tell: st.tell };
    const brain = { honesty: () => st.h }, cfg = { honesty: 0.5 };
    // the screen, as the scene computes it on the input window
    const S = { input: true, called: st.called, noStance: st.noStance, stamp: null, infoLine: null, hint: null };
    let screen, bot;
    try {
      m.info(R, duel, S, sealed, mname, brain, cfg);
      S.hint = m.hint(S, mname, ui, duel);
      screen = { row: m.row(S), stamp: m.stampShown(S) ? S.stamp : null, tell: S.noStance ? null : sealed.tell };
      const view = { info: {} };
      m.sim(R.Combat.info(duel), st.noStance, sealed, brain, cfg, view);
      bot = { stamp: view.info.stamp, ledger: view.info.ledger, tallyH: view.info.tallyH, tell: view.tell };
    } catch (e) {
      fails.push({ check: 'parity', msg: 'extracted code threw: ' + e.message });
      return { fails, stat };
    }
    const wantS = SPEC.screen(st), wantB = SPEC.bot(st);
    if (JSON.stringify(screen) !== JSON.stringify(wantS)) miss('screen', st, screen, wantS);
    if (JSON.stringify(bot) !== JSON.stringify(wantB)) miss('sim', st, bot, wantB);
    // parity: everything the bot is handed is on screen, and the reverse, except the declared class
    const br = botRow(bot), hint = SPEC.hint(st);
    if (br !== null) stat.info++;
    if (hint && br !== null) {
      stat.hintInfo++;
      if (screen.row !== br) { if (HIDDEN_BY_HINT && screen.row === hint) stat.hidden++; else miss('parity', st, screen.row, br); }
    } else if (screen.row !== (hint || br)) miss('parity', st, screen.row, hint || br);
    if (screen.stamp !== bot.stamp) miss('parity', st, 'stamp ' + screen.stamp, 'stamp ' + bot.stamp);
    if (screen.tell !== bot.tell) miss('parity', st, 'tell ' + screen.tell, 'tell ' + bot.tell);
  }
  const label = { screen: 'the screen (src/scenes/duel.js) differs from SPEC', sim: 'the sim view (tools/sim.js) differs from SPEC', parity: 'the bot is handed information the screen does not show (or the reverse)' };
  for (const kind of ['screen', 'sim', 'parity']) {
    checks++;
    if (bad[kind]) fails.push({ check: 'parity', msg: label[kind] + ' in ' + bad[kind] + ' of ' + stat.states + ' states; first ' + JSON.stringify(first[kind].st) + ' got ' + JSON.stringify(first[kind].got) + ' want ' + JSON.stringify(first[kind].want) });
  }
  return { fails, stat };
}

// ================================================================================================ KNOWN rows
// Splits failures into KNOWN cells and real failures, and adds the stale / new-cell failures.
function classify(fails) {
  const real = [], rows = KNOWN.map(k => ({ k, hit: new Set() }));
  for (const f of fails) {
    const r = rows.find(x => x.k.match(f));
    if (!r) { real.push(f); continue; }
    const cell = cellOf(f);
    if (r.k.cells.includes(cell)) r.hit.add(cell);
    else real.push(Object.assign({}, f, { msg: f.msg + ' (a new cell for KNOWN ' + r.k.id + ', which pins only ' + r.k.cells.join(', ') + ')' }));
  }
  const known = [];
  for (const r of rows) {
    if (r.hit.size === 0) { real.push({ check: 'known', msg: 'stale KNOWN row ' + r.k.id + ': remove it from tools/known.json in the fixing commit (and from KNOWN in tools/test_rules.js)' }); continue; }
    for (const cell of r.k.cells) if (!r.hit.has(cell)) real.push({ check: 'known', msg: 'KNOWN ' + r.k.id + ' cell ' + cell + ' no longer fails: remove it from KNOWN in tools/test_rules.js in the fixing commit' });
    known.push({ id: r.k.id, push: r.k.push, text: r.k.text, cells: r.k.cells.filter(c => r.hit.has(c)) });
  }
  return { real, known };
}
function failLine(f) {
  const where = f.face !== undefined && f.n !== undefined ? ' ' + f.face + ' s' + f.stake + ' d' + f.n + 'p' + f.k : f.face !== undefined ? ' ' + f.face : '';
  return 'FAIL [' + f.check + (f.rule ? ' ' + f.rule : '') + where + '] ' + f.msg;
}

// ================================================================================================ run
function sources() {
  const files = [];
  const walkDir = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name), r = rel ? rel + '/' + name : name;
      if (fs.statSync(full).isDirectory()) { if (r !== 'text') walkDir(full, r); }
      else if (name.endsWith('.js')) files.push([r, readText(full)]);
    }
  };
  walkDir(SRC, '');
  const artSrc = files.filter(([r]) => r.startsWith('art/')).map(([, t]) => t).join('\n');
  const cues = new Set();
  for (const mm of readText(SRC, 'audio', 'audio.js').matchAll(/CUES\.(\w+)\s*=/g)) cues.add(mm[1]);
  return { files, artSrc, cues, sim: readText(ROOT, 'tools', 'sim.js'), duel: readText(SRC, 'scenes', 'duel.js') };
}

// Every check over the walk; a check that throws on malformed data is a FAIL of that check, not a crash.
function lintAll(src, faceIds) {
  const faces = faceIds ? R.Run.BOSSES.filter(b => faceIds.includes(b.id)) : R.Run.BOSSES;
  const w = walk(faceIds);
  const fails = w.errs.map(e => ({ check: 'walk', msg: e }));
  const run = (check, fn) => { try { fails.push(...fn()); } catch (e) { fails.push({ check, msg: 'the check threw: ' + (e && e.message ? e.message : String(e)) }); } };
  run('a', () => checkCoverage(w.rows));
  run('b', () => checkCards(w.rows));
  run('c', () => checkFaceText(faces, src.artSrc));
  run('d', () => checkLook(w.rows, faces, src.cues));
  run('e', () => checkMirrorHonesty(w.rows));
  return { rows: w.rows, fails };
}

// ---- self-tests: each check must be able to fail. In-memory only (tables and copies of the source text); every
// mutation is restored. Targets are picked from the walk or found by the same extractors the checks use, so a change
// in src does not break them; a target that is gone is skipped (INFO), because the main pass already FAILs on it.
function selfTests(src, base, parityOk) {
  const self = [], skipped = [];
  const expect = (cond, msg) => { checks++; if (!cond) self.push({ check: 'self-test', msg }); };
  const before = JSON.stringify(R.Run.BOSSES);
  const withFace = (face, fn) => { R.Run.BOSSES.push(face); try { return fn(); } finally { R.Run.BOSSES.pop(); } };
  {   // 1. a scratch face through the real walk: a mimic phase with a tension floor and no cards
    const res = withFace({ id: 'zz_scratch', name: 'scratch', phases: [{ name: 'a' }, { name: 'b', mimic: true, floor: 2, change: 'swap', cards: [] }] }, () => lintAll(src, ['zz_scratch']));
    const got = res.fails, has = pred => got.some(pred);
    expect(res.rows.length === STAKES.length * 8, 'scratch face: the walk gave ' + res.rows.length + ' rows, expected ' + STAKES.length * 8);
    for (const s of STAKES) {
      expect(has(f => f.check === 'a' && f.rule === 'mimic' && f.stake === s && f.n === 7 && f.k === 2), 'scratch face: (a) mimic not caught at stake ' + s);
      expect(has(f => f.check === 'a' && f.rule === 'floor=2' && f.stake === s && f.n === 7 && f.k === 2), 'scratch face: (a) floor=2 not caught at stake ' + s);
    }
    for (const r of res.rows) if (r.mimic && r.calls) expect(has(f => f.check === 'e' && f.stake === r.stake && f.n === r.n && f.k === r.k), 'scratch face: (e) missed a mimic fight that calls at ' + cellOf(r));
    expect(has(f => f.check === 'c' && f.face === 'zz_scratch'), 'scratch face: (c) missing face text not caught');
    expect(JSON.stringify(R.Run.BOSSES) === before, 'scratch face: R.Run.BOSSES not restored');
  }
  {   // 1b. a malformed face (a phase that is not an object) is reported, not a crash
    let res = null, threw = null;
    try { res = withFace({ id: 'zz_broken', name: 'broken', phases: [{ name: 'a' }, null] }, () => lintAll(src, ['zz_broken'])); } catch (e) { threw = e; }
    expect(!threw, 'malformed face: lintAll threw ' + (threw && threw.message));
    expect(!!res && res.fails.some(f => f.check === 'walk' || f.check === 'd'), 'malformed face: no walk or (d) failure reported');
    expect(JSON.stringify(R.Run.BOSSES) === before, 'malformed face: R.Run.BOSSES not restored');
  }
  {   // 2. stale detection: with no failures every KNOWN row is stale; with light 7 switched off the calls rows are
    const none = classify([]);
    for (const k of KNOWN) expect(none.real.some(f => f.msg.indexOf('stale KNOWN row ' + k.id + ':') === 0), 'no failures: KNOWN ' + k.id + ' was not reported stale');
    const VT = R.Run.VIGIL_TUNE;
    if (!VT || typeof VT.callsFrom !== 'number') skipped.push('stale KNOWN rows with light 7 off (R.Run.VIGIL_TUNE.callsFrom is gone)');
    else {
      const was = VT.callsFrom;
      let got;
      VT.callsFrom = 8;
      try { got = classify(lintAll(src, null).fails); } finally { VT.callsFrom = was; }
      for (const k of KNOWN.filter(x => x.id === 'rule-unsaid-card' || x.id === 'rule-mirror-calls')) {
        expect(got.real.some(f => f.msg.indexOf('stale KNOWN row ' + k.id + ':') === 0), 'callsFrom 8: KNOWN ' + k.id + ' did not go stale');
      }
      expect(R.Run.VIGIL_TUNE.callsFrom === was, 'callsFrom not restored');
    }
  }
  {   // 3. a fixed stance: the first stance-shown final phase at stake 0 set to honesty 1, through the real walk
    const tgt = base.rows.find(r => r.n === 7 && r.stake === 0 && r.stance !== 'none' && !r.mimic);
    if (!tgt) skipped.push('(f) through the walk (no stance-shown final phase at stake 0)');
    else {
      const ph = R.Run.BOSSES.find(b => b.id === tgt.face).phases[tgt.k - 1];
      const hadH = own(ph, 'honesty'), oldH = ph.honesty;
      let got;
      ph.honesty = 1;
      try { got = lintAll(src, [tgt.face]).fails; } finally { if (hadH) ph.honesty = oldH; else delete ph.honesty; }
      expect(got.some(f => f.check === 'f' && f.face === tgt.face && f.stake === 0 && f.n === 7 && f.k === tgt.k), 'honesty 1 on ' + tgt.face + ' p' + tgt.k + ': (f) not caught');
      expect(JSON.stringify(R.Run.BOSSES) === before, 'honesty mutation: R.Run.BOSSES not restored');
    }
    // (e) and (f) on edited copies of a row
    const row = base.rows[0];
    if (!row) skipped.push('(e) and (f) on edited rows (the walk gave no rows)');
    else {
      const edited = (o, d) => Object.assign({}, row, o, { D: Object.assign({}, row.D, d || {}) });
      const ef = rows => checkMirrorHonesty(rows).filter(f => f.check === 'e' || f.check === 'f').map(f => f.check).join('');
      expect(ef([edited({ mimic: true, calls: true, stance: null }, { honesty: 0.5 })]) === 'e', '(e) a mimic fight that calls was not caught');
      expect(ef([edited({ mimic: true, calls: false, stance: null }, { honesty: 0.5 })]) === '', '(e) fired on a mimic fight with no calls');
      expect(ef([edited({ mimic: false, calls: false, stance: null }, { honesty: 1 })]) === 'f' && ef([edited({ mimic: false, calls: false, stance: null }, { honesty: 0 })]) === 'f', '(f) a stance that always or never tells the truth was not caught');
      expect(ef([edited({ mimic: false, calls: false, stance: 'none' }, { honesty: 1 })]) === '', '(f) fired on a phase that shows no stance');
    }
  }
  {   // 4. a card that does not fit and a card id that does not exist, on a scratch face; the failure names the face
    const rules = R.Text.rules;
    let got;
    rules.zz_scratch_card = { name: 'A NAME FAR TOO WIDE FOR THE PANEL', line: 'A line long enough that it can only wrap onto three lines inside the card panel, never two.' };
    try { got = withFace({ id: 'zz_scratch', name: 'scratch', phases: [{ name: 'a', cards: ['zz_scratch_card', 'zz_missing'] }, { name: 'b', change: 'swap', cards: [] }] }, () => lintAll(src, ['zz_scratch']).fails); }
    finally { delete rules.zz_scratch_card; }
    expect(got.some(f => f.check === 'b' && /zz_scratch_card \(named by zz_scratch p1\): card name/.test(f.msg)), 'card fit: wide name not caught (or the face not named)');
    expect(got.some(f => f.check === 'b' && /zz_scratch_card \(named by zz_scratch p1\): card line wraps to [3-9] lines/.test(f.msg)), 'card fit: a card of 3+ lines not caught (or the face not named)');
    expect(got.some(f => f.check === 'b' && f.face === 'zz_scratch' && /"zz_missing" is not in R\.Text\.rules/.test(f.msg)), 'card fit: missing card id not caught');
    expect(JSON.stringify(R.Run.BOSSES) === before && !own(R.Text.rules, 'zz_scratch_card'), 'card mutation not restored');
  }
  {   // 5. the scene anchor, the parity model and the view / screen guards, on edited copies of the source text
    const extra = src.files.map(([r, t]) => [r, r === 'scenes/duel.js' ? t + '\nyield* showCards(S.form.cards);\n' : t]);
    expect(checkCardSites(extra).length === 1, 'anchor: a new showCards call site was not caught');
    if (!parityOk) skipped.push('the parity self-tests (the main pass already FAILs parity on the real source)');
    else {
      const SIMV = /the sim view \(tools\/sim\.js\) differs/, SCREEN = /the screen \(src\/scenes\/duel\.js\) differs/;
      const VIEWG = /\(tools\/sim\.js\); the sim and the screen must change in lockstep/, SCRG = /\(src\/scenes\/duel\.js\); the sim and the screen must change in lockstep/;
      // edit one source at the first match of re (to: a string or a function of the match) and expect a failure like want
      const mutate = (what, side, re, to, want) => {
        const text = side === 'sim' ? src.sim : src.duel;
        if (!re.test(text)) { skipped.push(what); return; }
        const m = text.replace(re, to);
        if (m === text) { skipped.push(what); return; }
        const pf = (side === 'sim' ? checkParity(m, src.duel) : checkParity(src.sim, m)).fails;
        expect(pf.some(f => want.test(f.msg)), 'parity: ' + what + ' was not caught' + (pf.length ? ' as expected (first: ' + pf[0].msg.slice(0, 160) + ')' : ''));
      };
      const TALLY = /\bview\.info\.tallyH = [^;\n]+;/, HINT = /\bS\.hint = hintFor\(duel\);/;
      // the model, each side
      mutate('a sim view without the Ledger', 'sim', /(\bview\.info\.ledger = )[^;\n]+;/, '$1null;', SIMV);
      mutate('a sim view without the Tally', 'sim', /(\bview\.info\.tallyH = )[^;\n]+;/, '$1null;', SIMV);
      mutate('a sim view without the coin stamp', 'sim', /(\bview\.info\.stamp = )[^;\n]+;/, '$1null;', SIMV);
      mutate('a hint row that never shows', 'duel', /(\bvar hint = S\.input \? \()[^()\n]+(\) : null;)/, '$1null$2', SCREEN);
      mutate('a stamp draw with its condition inverted', 'duel', /(\bif \()(S\.stamp !== null)([^\n{]*)(\) \{\n[ \t]*R\.Font\.draw\(g, S\.stamp \?)/, '$1$2 && !($2$3)$4', SCREEN);
      // the view guards: a second conditional write, a new field, a guarded write, an alias, the bot handed the seal,
      // a public field from the seal, view handed to a helper
      mutate('a second, conditional view.info.stamp write', 'sim', TALLY, s => s + '\n      if (inf.tally) view.info.stamp = sealed.honest;', VIEWG);
      mutate('a second, conditional view.info.ledger write', 'sim', TALLY, s => s + '\n      if (called) view.info.ledger = { top: sealed.move, dots: 3 };', VIEWG);
      mutate('a new view field', 'sim', TALLY, s => s + ' view.zzPeek = sealed.move;', VIEWG);
      mutate('a modeled view write inside a block', 'sim', /\bview\.info\.stamp = [^;\n]+;/, s => 'if (called) {\n        ' + s + '\n      }', VIEWG);
      mutate('a write through an alias of view.info', 'sim', TALLY, s => s + '\n      const zzv = view.info; zzv.stamp = sealed.honest;', VIEWG);
      mutate('bot.pick handed the seal', 'sim', /\bbot\.pick\(view\)/, 'bot.pick(view, sealed)', VIEWG);
      mutate('view handed to a helper', 'sim', TALLY, s => s + '\n      zzLeak(view, sealed);', VIEWG);
      const pub = Object.keys(VIEW_PUBLIC).find(k => k !== 'use');
      mutate('a public view field read from the seal', 'sim', new RegExp('\\bview\\.' + pub + ' = [^;\\n]+;'), 'view.' + pub + ' = sealed.move;', VIEWG);
      mutate('a reveal that hands the bot the stance', 'sim', /\breturn cur\.sealed\.honest;/, s => s + '\n    if (r.kind === \'zz\') return cur.sealed.tell;', VIEWG);
      // the screen guards: a second conditional stance write, a seal read through a local
      mutate('a second, conditional S.tell write', 'duel', HINT, s => s + '\n    if (S.called) S.tell = sealed.move;', SCRG);
      mutate('a seal read through a local', 'duel', HINT, s => s + '\n    var zzPeek = sealed.move; S.bub = zzPeek;', SCRG);
    }
  }
  return { self, skipped };
}

function main(src) {
  const out = [];
  const base = lintAll(src, null);
  checks++;
  if (base.rows.length !== ROWS_EXPECTED) base.fails.push({ check: 'walk', msg: 'the walk gave ' + base.rows.length + ' rows, expected ' + ROWS_EXPECTED + ' (a face or phase was added or removed: update ROWS_EXPECTED)' });
  checks++;
  if (src.cues.size === 0 || !src.cues.has('boss')) base.fails.push({ check: 'd', msg: 'extractor broke: no CUES.<name> = assignments found in src/audio/audio.js' });
  base.fails.push(...checkCardSites(src.files));
  const par = checkParity(src.sim, src.duel);
  base.fails.push(...par.fails);
  const cls = classify(base.fails);

  if (VERBOSE) {
    out.push('face         s  fight  calls mimic stance floor copy innate                       fort cards                    who    mask      arena      music change  honesty');
    for (const r of base.rows) {
      const D = r.D;
      out.push([r.face.padEnd(12), String(r.stake).padEnd(2), ('d' + r.n + 'p' + r.k).padEnd(6), String(r.calls).padEnd(5), String(r.mimic).padEnd(5),
        String(r.stance).padEnd(6), String(r.floor).padEnd(5), String(D.copyBoons).padEnd(4), JSON.stringify(D.innate).padEnd(28), String(D.fortify).padEnd(4),
        JSON.stringify(D.cards).padEnd(24), String(D.who).padEnd(6), String(D.mask).padEnd(9), String(D.arena).padEnd(10), String(D.music).padEnd(5), String(D.change).padEnd(7),
        String(Math.round(D.honesty * 1000) / 1000)].join(' '));
    }
  }

  const st = selfTests(src, base, par.fails.length === 0);

  // ---- report
  const real = cls.real.concat(st.self);
  for (const f of real) out.push(failLine(f));
  for (const k of cls.known) out.push('KNOWN ' + k.id + ' ' + k.push + ': ' + k.text + ' - ' + k.cells.length + ' cells: ' + k.cells.join(', '));
  if (HIDDEN_BY_HINT) {
    out.push('INFO simview: HIDDEN_BY_HINT - on hint turns (IT CALLS / GUARD BROKEN / DEATHBLOW) the bot is handed the Ledger/Tally the screen replaces ' +
      'with the hint: ' + par.stat.hidden + ' of ' + par.stat.info + ' Ledger/Tally states in a static grid of ' + par.stat.states +
      '; closes in P1.3 with the sim view lines (tools/sim.js view.info.ledger / tallyH) and the two-line hint row');
  }
  if (st.skipped.length) out.push('INFO self-test: test_rules skipped ' + st.skipped.length + ' self-tests with no target left in the source (the main pass FAILs on the same gap): ' + st.skipped.join('; '));
  const knownTxt = cls.known.map(k => k.id + ' x' + k.cells.length).join(', ');
  if (real.length) out.push('test_rules: FAILED ' + real.length + ' - ' + checks + ' checks, ' + base.rows.length + ' rows' + (knownTxt ? ', known: ' + knownTxt : ''));
  else out.push('test_rules: ALL PASS - ' + checks + ' checks, ' + base.rows.length + ' rows, ' + cls.known.length + ' known (' + knownTxt + ')');
  process.stdout.write(out.join('\n') + '\n');
  process.exitCode = real.length ? 1 : 0;
}

// An exception anywhere (a missing source file, a module that does not load, a bug here) is one FAIL line and the
// summary line, never only a stack trace.
let stage = 'load';
try {
  loadModules();
  const src = sources();
  stage = 'run';
  main(src);
} catch (e) {
  const msg = String(e && e.message ? e.message : e).split('\n')[0];
  process.stdout.write('FAIL [' + stage + '] ' + msg + '\n' +
    'test_rules: FAILED 1 - the lint stopped on an exception while it ' + (stage === 'load' ? 'loaded src' : 'ran') + ' (stack on stderr)\n');
  process.stderr.write(String((e && e.stack) || e) + '\n');
  process.exitCode = 1;
}
