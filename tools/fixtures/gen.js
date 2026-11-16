// SHOW ME MY RIVAL - golden save fixtures written by older builds. Run by hand (never by test_all); the JSON it
// writes is committed and read by FLOW_SECTIONS=fixtures node tools/test_flow.js.
//
//   node tools/fixtures/gen.js [--sha 6e8a65b,42ec57c,0cba25d] [--out tools/fixtures]
//
// Each commit's src/ is exported with git archive into a temporary folder and played headlessly through the
// test_flow harness (tools/test_flow.js with FLOW_SRC pointing at that folder), so every fixture holds the exact text
// that build wrote to storage. Runs are played (every pick wins; menus and bonfires by the harness bot) until:
//   d1   the tutorial (the first run's duel 1), turn 2: seal (the build's own write at the commit);
//   b1   the first bonfire: enter (the build's own write as it opens: four cards, a forget already applied) and cards
//        (its own write once the cards are shown);
//   d2   duel 2, turn 2, at the reload points of a turn: pre (before the turn start; a flush), bleed (after the turn
//        start, while its bleed tick is shown, before the seal; a flush), seal, input (after the Candle of Truth
//        reveal and the pick, before the resolve; a flush) and post (the build's own write at the resolve);
//   d7x  the final duel between phases: transform (its own write at the blow that ends phase 1);
//   d7pN the final duel past phase 1 (a later run when a phase ends before its turn 2), turn 2: pre and seal.
// Test-only injection, all before the build writes: every run starts with the Candle of Truth, the Dealer's Thumb
// and the Ash of Forgetting; the player starts duel 2's turn 2 bleeding; 42ec57c plays with two lights of the Vigil
// out; 0cba25d starts with three faces earned and meets The Hours (through R.Run.create).
// Fixtures hold no names and no paths. Without git history it prints "skipped: no git history" and exits 0.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const KEY = 'rival.save.v1', GEN_KEY = 'rival.save.v1.gen';

// ------------------------------------------------------------------------------------------- per-commit setup
const SETUP = {
  '6e8a65b': { what: 'before the Vigil and the faces', altarPhase: 2 },
  '42ec57c': { what: 'the Vigil, no faces', stake: 2, altarPhase: 2 },
  '0cba25d': { what: 'the faces', faces: 3, face: 'hours', altarPhase: 3 }
};

if (process.env.FIX_CHILD) child(process.env.FIX_CHILD, process.env.FIX_OUT);
else parent();

// ------------------------------------------------------------------------------------------- parent
function parent() {
  const argv = process.argv.slice(2);
  let shas = Object.keys(SETUP), out = __dirname;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sha' && argv[i + 1]) shas = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--out' && argv[i + 1]) out = path.resolve(argv[++i]);
    else { console.log('usage: node tools/fixtures/gen.js [--sha a,b,c] [--out dir]'); process.exit(2); }
  }
  for (const sha of shas) {
    if (!SETUP[sha]) { console.log('gen: no setup for ' + sha + ' (known: ' + Object.keys(SETUP).join(', ') + ')'); process.exit(2); }
    try { cp.execFileSync('git', ['cat-file', '-e', sha + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); }
    catch (e) { console.log('skipped: no git history'); process.exit(0); }
  }
  fs.mkdirSync(out, { recursive: true });
  let code = 0;
  for (const sha of shas) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rival-fixture-'));
    try {
      const tar = cp.execFileSync('git', ['-c', 'core.autocrlf=false', 'archive', '--format=tar', sha, 'src'], { cwd: ROOT, maxBuffer: 64 << 20 });
      untar(tar, tmp);
      const r = cp.spawnSync(process.execPath, [__filename], {
        stdio: 'inherit', env: Object.assign({}, process.env, { FIX_CHILD: sha, FIX_OUT: out, FLOW_SRC: path.join(tmp, 'src') })
      });
      if (r.status !== 0) { console.log('gen: ' + sha + ' FAILED'); code = 1; }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  process.exit(code);
}

// Minimal ustar reader for git archive output: regular files and folders, pax headers for long names.
function untar(buf, dir) {
  let off = 0, longName = null;
  const root = path.resolve(dir);
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => { const s = h.subarray(a, b).toString('utf8'), z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); };
    let name = str(0, 100);
    const prefix = str(345, 500), size = parseInt(str(124, 136).trim() || '0', 8), type = h[156] ? String.fromCharCode(h[156]) : '0';
    if (prefix) name = prefix + '/' + name;
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8')); longName = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = null; }
    const dest = path.resolve(root, name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error('archive entry outside the folder: ' + name);
    if (type === '5') fs.mkdirSync(dest, { recursive: true });
    else if (type === '0') { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, body); }
  }
}

// ------------------------------------------------------------------------------------------- child (one commit)
function child(sha, out) {
  const H = require('../test_flow.js');
  const cfg = SETUP[sha];
  const store = H.makeStore();
  H.clock.ms = 1.76e12;
  const page = H.makePage(store, H.VIEWS[2], {
    ts: 1000,
    beforeBoot(p) {
      if (!cfg.face) return;
      const create = p.R.Run.create;                               // the final duel's face (test-only injection)
      p.R.Run.create = function (meta, o) { return create.call(this, meta, Object.assign({}, o, { boss: cfg.face, anyBoss: true })); };
    }
  });
  if (!page.alive) { console.log(sha + ': the page did not boot'); process.exit(1); }
  const G = page.G, R = page.R, E = page.E;
  H.run60(page, 20);
  if (cfg.stake) { const vg = G.meta.vigil; vg.max = cfg.stake; vg.sel = cfg.stake; }
  if (cfg.faces) G.meta.bosses.max = cfg.faces;
  G.save();

  const targets = [
    { id: 'd1', kind: 'turn', duelN: 1, phase: 1, turn: 2, points: ['seal'] },
    { id: 'b1', kind: 'bonfire', duelN: 1, points: ['enter', 'cards'] },
    { id: 'd2', kind: 'turn', duelN: 2, phase: 1, turn: 2, points: ['pre', 'bleed', 'seal', 'input', 'post'], candle: true, bleed: true },
    { id: 'd7x', kind: 'transform', points: ['transform'] },
    { id: 'd7p' + cfg.altarPhase, kind: 'turn', duelN: 7, phase: cfg.altarPhase, turn: 2, points: ['pre', 'seal'] }
  ];
  // Every run starts with these (test-only): the Candle of Truth (a paid reveal at d2's input point), the Dealer's
  // Thumb (four cards at a bonfire) and the Ash of Forgetting (a bonfire forget the build applies once, offer.applied).
  const GIFTS = ['truth_candle', 'relic_dealers_thumb', 'ash_of_forgetting'];
  const rng = H.mulberry(11), bot = H.makeBot(rng, 'cheat');
  bot.noise = 0;
  const wrote = [];
  let t = null, frames = 0, runKey = null;
  const save = () => { G.save(); return store.raw(); };
  const phasesOf = run => R.Run.phaseCount ? R.Run.phaseCount(run) : 2;
  const tag = (o, run) => run.stage + ':' + run.duelN + ':' + run.phase + ':t' + (run.duel ? run.duel.turn : 0) + (run.duel && run.duel.over ? run.duel.over : '') + (run.pending ? 'P' : '');
  function emit(id, point, raw) {
    const o = JSON.parse(raw), run = o.run, d = run && run.duel, off = run && run.offer;
    const fx = {
      about: 'Golden save written by the game code of commit ' + sha + ' (' + cfg.what + '), reload point "' + point + '". Made by tools/fixtures/gen.js; read by FLOW_SECTIONS=fixtures node tools/test_flow.js.',
      sha, made: 'real', point, tag: tag(o, run),
      store: { [KEY]: raw },
      expect: {
        stage: run.stage, duelN: run.duelN, phase: run.phase, turn: d ? d.turn : null, pending: !!run.pending,
        begun: !!(d && d.begun === d.turn), over: d && d.over || null, boss: run.boss === undefined ? null : run.boss,
        seen: !!(run.pending && run.pending.seen_honesty), tutorial: run.duelN === 1 && !(o.meta && o.meta.seenTutorial),
        cards: run.stage === 'bonfire' && off ? off.choices.length : null, applied: !!(off && off.applied), shown: !!(off && off.seen)
      }
    };
    if (store.map.has(GEN_KEY)) fx.store[GEN_KEY] = store.map.get(GEN_KEY);
    const name = sha + '-' + id + '-' + point + '.json';
    const text = JSON.stringify(fx, null, 1) + '\n';
    if (/[A-Za-z]:\\|\/Users\/|\/home\//.test(text)) { console.log(sha + ': a fixture would hold a local path'); process.exit(1); }
    fs.writeFileSync(path.join(out, name), text);
    wrote.push(name + ' (' + text.length + ' bytes)');
  }
  // The move that beats the sealed one (the tutorial's only move while it lasts): the bot wins every exchange.
  function pickWin(d, pend, pk) {
    const lp = R.Combat.legal(d, 'p'), win = R.LOSES_TO[pend.sealed.move];
    const m = pk.only || (lp.indexOf(win) >= 0 ? win : lp[0]);
    const b = H.findBtn(page, m === 'S' ? 'STRIKE' : m === 'G' ? 'GUARD' : 'FEINT');
    if (!b || b.disabled) return false;
    page.down(b.x + 5, b.y + 5); page.up(b.x + 5, b.y + 5);
    return true;
  }
  function finish() {
    for (const p of t.points) if (t.snap[p]) emit(t.id, p, t.snap[p]); else console.log(sha + ': no "' + p + '" point for ' + t.id);
    targets.shift(); t = null;
  }
  for (; frames < 900000 && targets.length; frames++) {
    if (!page.frame(33.4)) break;
    const run = G.run, d = run && run.duel, k = run ? run.seed + ':' + run.runNo : null;
    if (k !== runKey) {                                               // a new run: it starts with the gifts
      runKey = k; t = null;
      if (run && run.duelN === 1 && !run.duel) for (const g of GIFTS) if (run.pBoons.indexOf(g) < 0 && run.rBoons.indexOf(g) < 0) run.pBoons.push(g);
    }
    const want = targets[0], pend = run && run.pending;
    const pk = E.sceneName === 'duel' ? R.Scenes.duel.peek() : null;
    if (want.kind !== 'turn') {                                       // the build's own writes, read back from storage
      const sv = store.parsed(), sr = sv && sv.run, sd = sr && sr.duel;
      if (!t) t = Object.assign({ snap: {} }, want);
      if (want.kind === 'bonfire' && sr && sr.stage === 'bonfire' && sr.duelN === want.duelN && sr.offer) {
        if (!t.snap.enter) {
          t.snap.enter = store.raw();
          if (!(sr.offer.choices.length === 4 && sr.offer.applied === true)) console.log(sha + ': bonfire ' + want.duelN + ' has ' + sr.offer.choices.length + ' cards, applied ' + sr.offer.applied);
        }
        if (sr.offer.seen && !t.snap.cards) { t.snap.cards = store.raw(); finish(); continue; }
      }
      if (want.kind === 'transform' && sr && sr.stage === 'duel' && sr.duelN === 7 && sd && sd.over === 'p' && sd.phase < phasesOf(sr)) {
        t.snap.transform = store.raw(); finish(); continue;
      }
      if (!bot.held && pk && pk.input && pend && d) pickWin(d, pend, pk);   // play on
      else bot.act(page);
      continue;
    }
    const at = !!(run && d && run.stage === 'duel' && run.duelN === want.duelN && d.phase === want.phase && d.turn === want.turn && !d.over);
    if (at && !t) {
      t = Object.assign({ snap: {}, turns0: run.stats.turns, picked: false, lit: false }, want);
      if (want.bleed && d.begun !== d.turn) d.p.status.bleed = Math.max(d.p.status.bleed | 0, 2);   // the turn start ticks a bleed
    }
    if (!t) {                                                         // play on: menus and bonfires by the bot, every pick a win
      if (!bot.held && pk && pk.input && pend && d) pickWin(d, pend, pk);
      else bot.act(page);
      continue;
    }
    const mine = !!(pend && d && pend.turn === d.turn && pend.n === d.n && pend.phase === d.phase && d.turn === t.turn);
    if (run && run.stats.turns > t.turns0) {                          // the turn resolved: the build's own write
      t.snap.post = store.raw();
      finish();
      continue;
    }
    if (!at) { console.log(sha + ': ' + t.id + ' ended before its turn resolved'); t = null; continue; }
    if (!mine) {                                                      // before the seal: what a flush would store
      const p = d.begun === d.turn ? 'bleed' : 'pre';
      if (t.points.indexOf(p) >= 0) t.snap[p] = save();
      continue;
    }
    if (!t.snap.seal) t.snap.seal = store.raw();                      // the build's own write at the commit
    if (t.points.indexOf('input') < 0) { if (pk && pk.input) finish(); continue; }   // no input point: play on
    if (t.picked) { if (!t.snap.input) t.snap.input = save(); continue; }           // the lock-in, before the resolve
    if (!(pk && pk.input)) continue;
    if (t.candle && !t.lit) {
      const act = page.buttons.filter(q => q.label === '' && q.w === 22 && !q.disabled)[0];
      if (act) { page.down(act.x + 8, act.y + 8); page.up(act.x + 8, act.y + 8); }
      else console.log(sha + ': no Candle of Truth to light at ' + t.id);
      t.lit = true;
      continue;
    }
    t.picked = pickWin(d, pend, pk);
  }
  const st = H.stats();
  console.log(sha + ': ' + wrote.length + ' fixtures in ' + frames + ' frames' + (st.fails ? ', ' + st.fails + ' harness complaint(s) about this older build (not fixture errors)' : ''));
  for (const w of wrote) console.log('  ' + w);
  process.exit(targets.length ? 1 : 0);
}
