// SHOW ME MY RIVAL - QA patches for the two files the QA pass may not edit (src/scenes/duel.js, src/main.js).
//   node tools/qa_patches.js            list every patch and whether it still applies cleanly
//   node tools/qa_patches.js --apply    apply all that do (exact text replacement, each `old` must occur once)
//   node tools/qa_patches.js --apply P1 P5     apply only those ids
// tools/test_flow.js --patched runs the whole flow test against the patched sources in memory.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '..', 'src');

const P = [];
function add(id, sev, file, why, pairs) { P.push({ id, sev, file, why, pairs }); }

// -------------------------------------------------------------------------------------------------- main.js
add('P1', 'high', 'main.js',
  'validRun() accepts any object with a string stage, stats and two arrays. (a) A stored run that parses but lacks duelN / hp becomes R.Game.run: ' +
  'CONTINUE throws in R.Run.startDuel on every attempt. (b) A mid-duel save from a build before duel.tally existed (it is not in INTERFACES.md) ' +
  'resumes, then R.Combat.resolve throws inside the turn coroutine (combat.js hurt(): duel.tally.lostP): the engine cancels the coroutine and the ' +
  'duel is soft-locked with all three buttons disabled.',
  [[
`  function validRun(run) {
    return !!(run && typeof run === 'object' && typeof run.stage === 'string' && run.stats && Array.isArray(run.pBoons) && Array.isArray(run.rBoons));
  }`,
`  // A stored run must be complete enough to resume. Anything else (hand-edited or half-written storage, a save from
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
  }`
  ]]);

// -------------------------------------------------------------------------------------------------- duel.js
add('P2', 'med', 'scenes/duel.js',
  'Floating labels are clamped to x 30..150 whatever their width, so long boon names run off the 180 px screen ' +
  '("THE PAINTED SMILE" at the Rival: 92..181, "HEADSMAN\'S PATIENCE": 85..187). Clamp by the text\'s own half width. Also removes the per-frame opts literal.',
  [[
`    f.text = String(text); f.x = x; f.y = y; f.col = col; f.life = 0.9; f.big = !!big;`,
`    f.text = String(text); f.x = x; f.y = y; f.col = col; f.life = 0.9; f.big = !!big;
    f.opts = f.big && f.text.length < 4 ? OPT_CS2 : OPT_CS;
    f.hw = (R.Font.width(f.text, f.opts === OPT_CS2 ? 2 : 1) >> 1) + 2;   // half width (+ shadow): keeps long names on screen`
  ], [
`          R.Font.draw(g, f.text, Math.max(30, Math.min(150, Math.round(f.x))), Math.round(f.y), f.col, { align: 'center', shadow: 1, scale: f.big && f.text.length < 4 ? 2 : 1 });`,
`          R.Font.draw(g, f.text, Math.max(f.hw, Math.min(180 - f.hw, Math.round(f.x))), Math.round(f.y), f.col, f.opts);`
  ], [
`  var STATUS = ['guardBroken', 'bleed', 'fortify', 'focus'];`,
`  var STATUS = ['guardBroken', 'bleed', 'fortify', 'focus'];
  // Shared draw options and names: nothing below may build an object or a string per frame.
  var OPT_R = { align: 'right' }, OPT_C = { align: 'center' }, OPT_CS = { align: 'center', shadow: 1 }, OPT_CS2 = { align: 'center', shadow: 1, scale: 2 };
  var OPT_P2 = { phase2: true }, BAR_P = { ticks: 0 }, BAR_R = { ticks: 0, flip: true };
  var ST_SPR = { guardBroken: 'st_guardBroken', bleed: 'st_bleed', fortify: 'st_fortify', focus: 'st_focus' };
  var ACT_SPR = { glimpse: 'act_glimpse', honesty: 'act_honesty', coin: 'act_coin' };
  var DIGIT = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];`
  ]]);

add('P3', 'low', 'scenes/duel.js',
  'draw() allocates every frame: 3 option literals while idle (both HP bars, the Rival HP text), more with statuses / actives / hints / stamps / banner / ' +
  'phase-2 bubble / rule card (object literals, "st_" + s, "act_" + kind, String(ch), toUpperCase(), Font.wrap of the rule card). Needs the constants added by P2.',
  [[
`    R.UI.bar(g, 4, y + 4, 72, 7, S.hp.p / d.p.maxHp, S.lag.p / d.p.maxHp, pulse, { ticks: d.p.maxHp });
    R.UI.bar(g, 104, y + 4, 72, 7, S.hp.r / d.r.maxHp, S.lag.r / d.r.maxHp, S.phase2 ? 31 : 18, { ticks: d.r.maxHp, flip: true });`,
`    BAR_P.ticks = d.p.maxHp; BAR_R.ticks = d.r.maxHp;
    R.UI.bar(g, 4, y + 4, 72, 7, S.hp.p / d.p.maxHp, S.lag.p / d.p.maxHp, pulse, BAR_P);
    R.UI.bar(g, 104, y + 4, 72, 7, S.hp.r / d.r.maxHp, S.lag.r / d.r.maxHp, S.phase2 ? 31 : 18, BAR_R);`
  ], [
`    R.Font.draw(g, S.txtR, 176, y + 13, 10, { align: 'right' });`,
`    R.Font.draw(g, S.txtR, 176, y + 13, 10, OPT_R);`
  ], [
`      if (d.p.status[s] > 0) { R.Art.sprite(g, 'st_' + s, px, y + 23); px += 10; }
      if (d.r.status[s] > 0) { R.Art.sprite(g, 'st_' + s, rx, y + 23); rx -= 10; }`,
`      if (d.p.status[s] > 0) { R.Art.sprite(g, ST_SPR[s], px, y + 23); px += 10; }
      if (d.r.status[s] > 0) { R.Art.sprite(g, ST_SPR[s], rx, y + 23); rx -= 10; }`
  ], [
`      R.Art.sprite(g, 'act_' + ((R.Boons.byId[id].active || {}).kind || 'glimpse'), 4 + i * 26 + 5, y + 5 + (S.pressA === i ? 1 : 0));
      if (ch > 0) R.Font.draw(g, String(ch), 4 + i * 26 + 20, y + 15, 22, { align: 'right' });`,
`      R.Art.sprite(g, ACT_SPR[(R.Boons.byId[id].active || OPT_C).kind] || 'act_glimpse', 4 + i * 26 + 5, y + 5 + (S.pressA === i ? 1 : 0));
      if (ch > 0) R.Font.draw(g, DIGIT[ch] || '9', 4 + i * 26 + 20, y + 15, 22, OPT_R);`
  ], [
`    if (hint) R.Font.draw(g, hint, 176, y + 8, S.hint ? ((Math.floor(S.clock * 3) & 1) ? 21 : 19) : 12, { align: 'right' });`,
`    if (hint) R.Font.draw(g, hint, 176, y + 8, S.hint ? ((Math.floor(S.clock * 3) & 1) ? 21 : 19) : 12, OPT_R);`
  ], [
`        R.Font.draw(g, S.stamp ? ui('trueStance', 'TRUE') : ui('falseStance', 'FALSE'), 136, L.floorY - 84, S.stamp ? 28 : 19, { align: 'center', shadow: 1 });`,
`        R.Font.draw(g, S.stamp ? ui('trueStance', 'TRUE') : ui('falseStance', 'FALSE'), 136, L.floorY - 84, S.stamp ? 28 : 19, OPT_CS);`
  ], [
`      if (S.called && S.input) R.Font.draw(g, mname(S.called).toUpperCase() + '?', PX, L.floorY - 84, 31, { align: 'center', shadow: 1 });`,
`      if (S.called && S.input) R.Font.draw(g, S.calledText, PX, L.floorY - 84, 31, OPT_CS);`
  ], [
`    S.called = called;
    S.rSigil = 'sealed';`,
`    S.called = called; S.calledText = called ? mname(called).toUpperCase() + '?' : '';
    S.rSigil = 'sealed';`
  ], [
`          R.Font.draw(g, S.banner.a, 90, L.arenaY + 16, 10, { align: 'center', shadow: 1, scale: 2 });
          R.Font.draw(g, S.banner.b.toUpperCase(), 90, L.arenaY + 36, 21, { align: 'center', shadow: 1 });`,
`          R.Font.draw(g, S.banner.a, 90, L.arenaY + 16, 10, OPT_CS2);
          R.Font.draw(g, S.banner.b, 90, L.arenaY + 36, 21, OPT_CS);`
  ], [
`    S.banner = { t: 0, a: 'DUEL ' + n, b: (R.Text.duelNames && R.Text.duelNames[n - 1]) || '' };`,
`    S.banner = { t: 0, a: 'DUEL ' + n, b: String((R.Text.duelNames && R.Text.duelNames[n - 1]) || '').toUpperCase() };`
  ], [
`      if (S.bub) R.UI.bubble(g, 4, L.bandY + 2, 172, bubbleLines(S.bub), 136, 'up', S.phase2 ? { phase2: true } : null);`,
`      if (S.bub) R.UI.bubble(g, 4, L.bandY + 2, 172, bubbleLines(S.bub), 136, 'up', S.phase2 ? OPT_P2 : null);`
  ], [
`        R.Font.draw(g, S.card.name, 90, L.arenaY + 47, 31, { align: 'center', scale: 1 });
        var cl = R.Font.wrap(S.card.line, 140);
        for (i = 0; i < cl.length && i < 2; i++) R.Font.draw(g, cl[i], 90, L.arenaY + 60 + i * 9, 10, { align: 'center' });`,
`        R.Font.draw(g, S.card.name, 90, L.arenaY + 47, 31, OPT_C);
        var cl = S.card.lines || (S.card.lines = R.Font.wrap(S.card.line, 140));   // wrapped once per card
        for (i = 0; i < cl.length && i < 2; i++) R.Font.draw(g, cl[i], 90, L.arenaY + 60 + i * 9, 10, OPT_C);`
  ]]);

add('P4', 'med', 'scenes/duel.js',
  'Boon ledger: both lists share one panel of arenaH + 30 px and the loops stop at bandY + 10, so from about duel 4 the Rival\'s boons are cut off ' +
  '(duel 7: 6-7 player boons fill the panel; none or one of the Rival\'s six is listed, and the "ITS BOONS" header lands on the panel edge). ' +
  'DESIGN pillar 2 needs every Rival boon readable before the pick. One page per fighter (ITS first), panel down to the buttons\' bottom edge, ' +
  'descriptions wrapped once per open instead of every frame. Also makes the ledger tap target 20 px tall (was 16).',
  [[
`  function drawOverlay(g) {
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
  }`,
`  // Boon ledger: one page per fighter (S.overlay 1 = its boons, 2 = yours). Wrapped once when it opens.
  function ledgerPage(ids) {
    var out = [], i, b;
    for (i = 0; i < ids.length; i++) { b = R.Boons.byId[ids[i]]; out.push({ name: boonName(ids[i]), lines: R.Font.wrap(b ? b.desc : '', 158) }); }
    return out;
  }
  function openLedger() { S.ledger = [ledgerPage(S.duel.r.boons), ledgerPage(S.duel.p.boons)]; S.overlay = 1; sfx('tick'); }
  function drawOverlay(g) {
    var its = S.overlay === 1, list = S.ledger[its ? 0 : 1], y = L.arenaY + 6, bot = L.btnY + L.btnH, i, k;
    R.UI.panel(g, 4, L.arenaY, 172, bot - L.arenaY, 'dark');
    R.Font.draw(g, its ? 'ITS BOONS' : 'YOUR BOONS', 10, y, its ? 19 : 21);
    R.Font.draw(g, its ? 'TAP: YOURS' : 'TAP: CLOSE', 170, y, 7, OPT_R);
    y += 12;
    if (!list.length) R.Font.draw(g, '(none yet)', 10, y, 7);
    for (i = 0; i < list.length && y + 9 + list[i].lines.length * 8 <= bot - 3; i++) {
      R.Font.draw(g, list[i].name, 10, y, 10); y += 9;
      for (k = 0; k < list[i].lines.length; k++) { R.Font.draw(g, list[i].lines[k], 14, y, 8); y += 8; }
      y += 2;
    }
  }`
  ], [
`      if (S.overlay) { S.overlay = false; sfx('back'); return; }
      S.tapped = true;
      if (y >= L.hudY + 18 && y < L.hudY + 34 && x >= 74 && x < 106) { S.overlay = true; sfx('tick'); return; }`,
`      if (S.overlay) { S.overlay = S.overlay === 1 ? 2 : 0; sfx(S.overlay ? 'tick' : 'back'); return; }
      S.tapped = true;
      if (y >= L.hudY + 14 && y < L.hudY + 34 && x >= 74 && x < 106) { openLedger(); return; }`
  ], [
`    back: function () { if (S) S.overlay = !S.overlay; }`,
`    back: function () { if (!S) return; if (S.overlay) S.overlay = 0; else openLedger(); },
    resize: function () { if (S) layout(); }       // update() does not run while paused / in hit-stop: keep the layout current`
  ]]);

add('P5', 'low', 'scenes/duel.js',
  'Keyhole / Candle of Truth: the charge is spent and saved, but the reveal lives only in scene state (S.glass / S.stamp). ' +
  'If the page is closed and reopened before the pick, the charge is gone and the information is not shown again.',
  [[
`      else if (kind === 'honesty') S.stamp = sealed.honest;
    };`,
`      else if (kind === 'honesty') S.stamp = sealed.honest;
      if (run.pending) run.pending['seen_' + kind] = true;      // saved by useActive(): a reload shows it again
    };
    if (resume && pend.seen_glimpse) S.glass = sealed.move;
    if (resume && pend.seen_honesty) S.stamp = sealed.honest;`
  ]]);

module.exports = P;

// Returns { text, applied:[ids], skipped:[{id, n, why}] } for one source file's text.
module.exports.applyTo = function (file, text, only) {
  const applied = [], skipped = [];
  text = text.replace(/\r\n/g, '\n');
  for (const p of P) {
    if (p.file !== file || (only && only.length && only.indexOf(p.id) < 0)) continue;
    let t = text, okAll = true, n = 0;
    for (const [a, b] of p.pairs) {
      n++;
      const parts = t.split(a);
      if (parts.length !== 2) { okAll = false; skipped.push({ id: p.id, n, why: parts.length === 1 ? (t.indexOf(b) >= 0 ? 'already applied' : 'old text not found') : 'old text is ambiguous' }); break; }
      t = parts.join(b);
    }
    if (okAll) { text = t; applied.push(p.id); }
  }
  return { text, applied, skipped };
};

if (require.main === module) {
  const args = process.argv.slice(2), apply = args.indexOf('--apply') >= 0, only = args.filter(a => /^P\d+$/.test(a));
  for (const file of Array.from(new Set(P.map(p => p.file)))) {
    const full = path.join(SRC, file), raw = fs.readFileSync(full, 'utf8');
    const res = module.exports.applyTo(file, raw, only);
    for (const p of P) {
      if (p.file !== file || (only.length && only.indexOf(p.id) < 0)) continue;
      const sk = res.skipped.find(s => s.id === p.id);
      console.log(p.id + ' [' + p.sev + '] src/' + file + ' (' + p.pairs.length + ' edit' + (p.pairs.length > 1 ? 's' : '') + '): ' + (sk ? 'NOT APPLICABLE - ' + sk.why + ' (edit ' + sk.n + ')' : (apply ? 'applied' : 'applies cleanly')));
      console.log('    ' + p.why);
    }
    if (apply && res.applied.length) fs.writeFileSync(full, raw.indexOf('\r\n') >= 0 ? res.text.replace(/\n/g, '\r\n') : res.text, 'utf8');
  }
  if (!apply) console.log('\n(nothing written; pass --apply to write)');
}
