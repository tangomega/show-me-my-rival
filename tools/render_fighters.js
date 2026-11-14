// Dev-only: renders the fighter sprites to PNG contact sheets in tools/out/ so the art can be looked at.
//   node tools/render_fighters.js                 -> every sheet
//   node tools/render_fighters.js tells|action|misc|r2|all|scene     -> one group
//   node tools/render_fighters.js cells "rival:idle:0,rival:tell_S:3,player:tell_F:4:sil" [scale] [cols] [name]
'use strict';
const path = require('path');
require('../src/core/rng.js');
require('../src/art/palette.js');
require('../src/art/pix.js');
require('../src/art/sprites.js');
const R = globalThis.RIVAL;
const { sheet } = require('./png.js');
const Pix = R.Pix, A = R.Art;
const OUT = path.join(__dirname, 'out');
const BG3 = R.Pal.rgb[3], LIGHT = R.Pal.rgb[9];
const ALL = ['idle', 'tell_S', 'tell_G', 'tell_F', 'strike', 'guard', 'feint', 'hit', 'stagger', 'clash', 'death', 'taunt', 'taunt2', 'victory', 'transform'];

function frames(who, name, mask) {
  const a = A.anim(who, name), out = [];
  if (!a) return out;
  for (let f = 0; f < a.n; f++) out.push({ img: A.frameImg(who, name, f, mask) });
  return out;
}
function pad(cells, cols) { const e = { img: Pix.make(1, 1) }; while (cells.length % cols) cells.push(e); return cells; }
function sil(cells) { return cells.map(c => ({ img: Pix.solid(c.img, 1) })); }
function strip(file, rows, cols, scale, bg, silh) {
  let cells = [];
  const order = [];
  for (const r of rows) {
    let fr = frames(r[0], r[1], r[2]);
    if (!fr.length) continue;
    order.push(r.join(' ') + ' (' + fr.length + ')');
    for (let i = 0; i < fr.length; i += cols) cells = cells.concat(pad(fr.slice(i, i + cols), cols));
  }
  if (silh) cells = sil(cells);
  const s = sheet(path.join(OUT, file), R, cells, { scale: scale, cols: cols, bg: bg || BG3 });
  console.log(file + '  ' + s.w + 'x' + s.h + '  rows: ' + order.join(' | '));
}

const groups = {
  tells() {
    const rows = [];
    for (const who of ['player', 'rival']) for (const n of ['idle', 'tell_S', 'tell_G', 'tell_F']) rows.push([who, n]);
    strip('fighters_idle_tells.png', rows, 5, 6);
    strip('fighters_idle_tells_sil.png', rows, 5, 2, LIGHT, true);
    // the four key poses of each fighter side by side (what the player actually has to tell apart)
    const key = [];
    for (const who of ['player', 'rival']) { key.push({ img: A.frameImg(who, 'idle', 0) }); for (const n of ['tell_S', 'tell_G', 'tell_F']) key.push({ img: A.frameImg(who, n, 3) }); }
    sheet(path.join(OUT, 'fighters_key.png'), R, key, { scale: 6, cols: 4, bg: BG3 });
    sheet(path.join(OUT, 'fighters_key_sil.png'), R, sil(key), { scale: 3, cols: 4, bg: LIGHT });
    console.log('fighters_key.png / fighters_key_sil.png: player idle,S,G,F | rival idle,S,G,F');
  },
  action() {
    for (const who of ['player', 'rival']) {
      strip('fighters_action_' + who + '.png', ['strike', 'guard', 'feint', 'hit', 'stagger', 'clash'].map(n => [who, n]), 7, 4);
    }
  },
  misc() {
    for (const who of ['player', 'rival']) {
      strip('fighters_misc_' + who + '.png', ['death', 'taunt', 'taunt2', 'victory', 'transform'].map(n => [who, n]), 12, 3);
    }
  },
  r2() {
    strip('fighters_rival2.png', ALL.map(n => ['rival2', n]), 12, 3);
    const m = [];
    for (const id of ['porcelain', 'mourner', 'jester', 'kintsugi', 'blank']) {
      m.push({ img: A.frameImg('rival', 'idle', 0, id) }); m.push({ img: A.frameImg('rival', 'tell_G', 3, id) }); m.push({ img: A.frameImg('rival', 'taunt2', 2, id) });
    }
    sheet(path.join(OUT, 'fighters_masks.png'), R, m, { scale: 5, cols: 6, bg: BG3 });
    console.log('fighters_masks.png: porcelain, mourner, jester, kintsugi, blank (idle 0, tell_G 3, taunt2 2 each)');
  },
  all() {
    const rows = [];
    for (const who of ['player', 'rival', 'rival2']) for (const n of ALL) rows.push([who, n]);
    strip('fighters_all.png', rows, 12, 2);
  },
  scene() {
    // player (facing right) and Rival (flipped) 92 px apart on a floor line, with the scene's lunge slides applied
    const pairs = [
      ['idle', 0, 0, 'idle', 0, 0], ['idle', 0, 0, 'tell_S', 3, 0], ['idle', 0, 0, 'tell_G', 3, 0], ['idle', 0, 0, 'tell_F', 3, 0],
      ['tell_S', 3, 0, 'idle', 0, 0], ['tell_G', 3, 0, 'idle', 0, 0], ['tell_F', 3, 0, 'idle', 0, 0],
      ['strike', 3, 30, 'guard', 2, 0], ['guard', 2, 0, 'strike', 3, 30], ['feint', 4, 24, 'stagger', 4, -6], ['stagger', 4, -6, 'feint', 4, 24],
      ['clash', 1, 16, 'clash', 1, 16], ['strike', 3, 30, 'hit', 1, -6], ['death', 5, 0, 'taunt', 1, 0], ['victory', 5, 0, 'death', 3, 0]
    ];
    const W = 180, H = 76, FL = 64, cells = [];
    for (const who2 of ['rival', 'rival2']) for (const p of pairs) {
      const img = Pix.make(W, H);
      Pix.fill(img, 0, FL, W, 1, 5); Pix.fill(img, 0, FL + 1, W, H - FL - 1, 2);
      const a = A.frameImg('player', p[0], p[1]), b = Pix.flipX(A.frameImg(who2, p[3], p[4]));
      Pix.blit(img, b, 136 - p[5] - 24, FL - b.h);
      Pix.blit(img, a, 44 + p[2] - 24, FL - a.h);
      cells.push({ img: img });
    }
    sheet(path.join(OUT, 'fighters_scene.png'), R, cells, { scale: 2, cols: 3, bg: BG3 });
    console.log('fighters_scene.png: ' + pairs.map(p => p[0] + '/' + p[3]).join(', ') + '  (x2: rival, then rival2)');
  }
};

const arg = process.argv[2];
if (arg === 'cells') {
  const cells = process.argv[3].split(',').map(s => {
    const p = s.split(':');
    const img = A.frameImg(p[0], p[1], +p[2] || 0, p[4]);
    return { img: p[3] === 'sil' ? Pix.solid(img, 1) : img };
  });
  const silh = /:sil/.test(process.argv[3]);
  const file = (process.argv[6] || 'cells') + '.png';
  sheet(path.join(OUT, file), R, cells, { scale: +process.argv[4] || 6, cols: +process.argv[5] || 4, bg: silh ? LIGHT : BG3 });
  console.log(file);
} else if (arg && groups[arg]) groups[arg]();
else for (const k of Object.keys(groups)) groups[k]();
