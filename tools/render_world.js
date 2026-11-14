// Dev-only: renders the world + UI art (icons, sigils, UI kit, backgrounds) to PNG in tools/out/ so it can be looked at.
//   node tools/render_world.js            -> every sheet
//   node tools/render_world.js icons|ui|title|cathedral|bonfire|menus [scale]
// The game's real draw code runs here against a tiny fake 2D context that records into an indexed image
// (fillRect in palette colours + unscaled/integer-scaled drawImage of baked canvases), so the mock-ups show
// exactly what the player sees for one frame.
'use strict';
const path = require('path');

// ---- fake canvas (palette-indexed) ---------------------------------------------------------------
const HEX2IDX = {};
let PixRef = null;
function FakeCtx(cv) { this.cv = cv; this._fill = 1; this.globalAlpha = 1; }
Object.defineProperty(FakeCtx.prototype, 'fillStyle', {
  set(v) { const i = HEX2IDX[String(v).toLowerCase()]; if (i === undefined) throw new Error('non-palette fillStyle ' + v); this._fill = i; },
  get() { return this._fill; }
});
FakeCtx.prototype.fillRect = function (x, y, w, h) {
  if (x !== (x | 0) || y !== (y | 0) || w !== (w | 0) || h !== (h | 0)) throw new Error('fractional fillRect ' + [x, y, w, h]);
  if (this.globalAlpha < 0.5) return;
  PixRef.fill(this.cv.img, x, y, w, h, this._fill);
};
FakeCtx.prototype.clearRect = function (x, y, w, h) { PixRef.fill(this.cv.img, x, y, w, h, 0); };
FakeCtx.prototype.drawImage = function (src, a, b, c, d, e, f, g, h) {
  const s = src.img, dst = this.cv.img;
  if (this.globalAlpha < 0.5) return;
  if (c === undefined) { PixRef.blit(dst, s, a, b); return; }
  if (e === undefined) throw new Error('5-arg drawImage unsupported');
  const sc = g / c;                                           // integer scale only
  if (sc !== (sc | 0) || h / d !== sc) throw new Error('non-integer drawImage scale');
  for (let y = 0; y < h; y++) for (let x = 0; x < g; x++) {
    const v = PixRef.get(s, a + ((x / sc) | 0), b + ((y / sc) | 0));
    if (v) PixRef.set(dst, e + x, f + y, v);
  }
};
FakeCtx.prototype.createImageData = function (w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; };
FakeCtx.prototype.putImageData = function (id) {
  const img = this.cv.img, d = id.data;
  for (let i = 0; i < img.w * img.h; i++) {
    if (!d[i * 4 + 3]) { img.d[i] = 0; continue; }
    const hx = '#' + ((1 << 24) | (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]).toString(16).slice(1);
    img.d[i] = HEX2IDX[hx] || 0;
  }
};
function FakeCanvas() { this._w = 1; this._h = 1; this.img = null; }
for (const k of ['width', 'height']) Object.defineProperty(FakeCanvas.prototype, k, {
  get() { return k === 'width' ? this._w : this._h; },
  set(v) { if (k === 'width') this._w = v; else this._h = v; this.img = PixRef.make(this._w, this._h); }
});
FakeCanvas.prototype.getContext = function () { return this.ctx || (this.ctx = new FakeCtx(this)); };
globalThis.document = { createElement() { return new FakeCanvas(); } };

for (const f of ['core/rng.js', 'art/palette.js', 'art/pix.js', 'art/font.js', 'art/sprites.js', 'art/icons.js', 'art/backgrounds.js', 'art/ui.js']) {
  require(path.join(__dirname, '..', 'src', f));
}
const R = globalThis.RIVAL;
const { writePNG } = require('./png.js');
const Pix = R.Pix, A = R.Art;
PixRef = Pix;
for (let i = 1; i < R.Pal.hex.length; i++) HEX2IDX[R.Pal.hex[i]] = i;
R.BEATS = R.BEATS || { S: 'F', G: 'S', F: 'G' };
const OUT = path.join(__dirname, 'out');

function canvas(w, h, bg) { const c = new FakeCanvas(); c.width = w; c.height = h; if (bg) Pix.fill(c.img, 0, 0, w, h, bg); return c; }
function save(name, cv, scale) {
  const px = Pix.toRGBA(cv.img || cv, scale || 4, [255, 0, 255]);
  writePNG(path.join(OUT, name), px.w, px.h, px.data);
  console.log(name + '  ' + px.w + 'x' + px.h);
}
function engine(H, real) {
  R.Engine = { W: 180, H: H, real: real || 0, time: real || 0, safe: { top: 0, bottom: 0 },
    lay: { top: 0, hudY: 0, arenaY: 34, arenaH: 170 + Math.min(40, H - 320), floorY: 172 + Math.min(40, H - 320) } };
}

// A whole duel screen for one frame: background, fighters (the real sprites, or flat stand-ins), foreground,
// sigils, HUD, speech band and buttons, laid out like scenes/duel.js does for a buffer H pixels tall.
function duelMock(H, o) {
  o = o || {};
  const cv = canvas(180, H, 1), g = cv.getContext('2d'), U = R.UI, F = R.Font, hex = R.Pal.hex;
  const t = o.t === undefined ? 1.37 : o.t;
  engine(H, t);
  const extra = H - 320, add = Math.min(40, extra), btnAdd = Math.max(0, Math.min(24, extra - 40));
  const arenaY = 34, arenaH = 170 + add, floorY = arenaY + arenaH - 32, bandY = arenaY + arenaH, rowY = bandY + 34, btnY = rowY + 24, btnH = 52 + btnAdd;
  const opts = { variant: o.variant || 1, gutter: o.gutter || 0, phase2: !!o.phase2, floorY: floorY, arena: o.arena || 'cathedral' };
  A.bg(g, 'cathedral', t, opts);
  if (o.standin) {
    const sil = (x, h, c) => { g.fillStyle = hex[c]; g.fillRect(x - 6, floorY - h, 12, h); g.fillRect(x - 4, floorY - h - 7, 8, 7); };
    sil(44, 23, 14); sil(136, 30, 17);
  } else if (!o.empty) {
    A.fighter(g, o.phase2 ? 'rival2' : 'rival', o.rAnim || 'tell_S', o.rFrame === undefined ? 3 : o.rFrame, 136, floorY, { flip: true, mask: o.mask });
    A.fighter(g, 'player', o.pAnim || 'idle', 0, 44, floorY, { flip: false });
  }
  A.fg(g, 'cathedral', t, opts);
  if (!o.empty) {
    A.sigil(g, 128, floorY - 70, o.rSigil || 'sealed', o.rMove || null, 'r', 1);
    if (o.pSigil) A.sigil(g, 36, floorY - 68, o.pSigil, o.pMove || null, 'p', 1);
  }
  // HUD
  g.fillStyle = hex[2]; g.fillRect(0, 0, 180, 33); g.fillStyle = hex[5]; g.fillRect(0, 33, 180, 1);
  U.bar(g, 4, 4, 72, 7, 9 / 12, 10 / 12, 18, { ticks: 12 });
  U.bar(g, 104, 4, 72, 7, 5 / 7, 5 / 7, o.phase2 ? 31 : 18, { ticks: 7, flip: true });
  F.draw(g, '9/12', 4, 13, 10); F.draw(g, '5/7', 176, 13, 10, { align: 'right' });
  for (let i = 1; i <= 7; i++) { g.fillStyle = hex[i < opts.variant ? 21 : i === opts.variant ? 10 : i === 7 ? 18 : 5]; g.fillRect(77 + (i - 1) * 4, 6, 3, 3); }
  A.sprite(g, 'st_bleed', 4, 23); A.sprite(g, 'st_fortify', 14, 23); A.sprite(g, 'st_guardBroken', 168, 23); A.sprite(g, 'st_focus', 158, 23);
  // band + buttons
  g.fillStyle = hex[2]; g.fillRect(0, bandY, 180, H - bandY); g.fillStyle = hex[5]; g.fillRect(0, bandY, 180, 1);
  if (o.line !== null) U.bubble(g, 4, bandY + 2, 172, o.line || ['You always open with Strike.', 'Always.'], 136, 'up', o.phase2 ? { phase2: true } : null);
  U.button(g, 4, rowY + 1, 22, 22, '', {}); A.sprite(g, 'act_glimpse', 9, rowY + 5);
  F.draw(g, 'Its guard is broken', 176, rowY + 8, 12, { align: 'right' });
  const M = ['S', 'G', 'F'], LAB = ['STRIKE', 'GUARD', 'FEINT'], ACC = [18, 27, 29];
  for (let i = 0; i < 3; i++) U.button(g, 4 + i * 58, btnY, 56, btnH, LAB[i], { icon: M[i], accent: ACC[i], disabled: o.locked === i, broken: o.locked === i });
  return cv;
}

// The bonfire screen laid out like scenes/bonfire.js (cards are stand-ins drawn with the real card panel + icons).
function bonfireMock(H, o) {
  o = o || {};
  const cv = canvas(180, H, 1), g = cv.getContext('2d'), U = R.UI, F = R.Font, hex = R.Pal.hex, t = o.t === undefined ? 0.93 : o.t;
  engine(H, t);
  const btnY = H - 40, detY = btnY - 3 - 66, cardsY = detY - 2 - 46, stripY = cardsY - 3 - 20, floorY = stripY - 36, panelY = Math.max(2, floorY - 78);
  A.bg(g, 'bonfire', t, { floorY: floorY });
  A.sprite(g, 'bonfire_player', 44 - 16, floorY - 32);
  A.sprite(g, 'bonfire_rival', 136 - 16, floorY - 32);
  U.bar(g, 6, floorY + 9, 62, 7, 9 / 12, 9 / 12, 18, { ticks: 12 });
  F.draw(g, '9/12', 72, floorY + 9, 10, { shadow: 1 });
  F.draw(g, 'NEXT: DUEL 3', 174, floorY + 9, 8, { align: 'right', shadow: 1 });
  F.draw(g, 'THE LIAR', 174, floorY + 19, 21, { align: 'right', shadow: 1 });
  if (o.pick) {
    U.panel(g, 4, panelY, 114, 44, 'dark');
    F.draw(g, 'Whetstone', 9, panelY + 4, 19); F.draw(g, 'Strike wins deal +1.', 9, panelY + 14, 10);
  }
  g.fillStyle = hex[2]; g.fillRect(0, stripY, 180, H - stripY); g.fillStyle = hex[5]; g.fillRect(0, stripY, 180, 1);
  const tags = ['tag_RIP', 'tag_TEN', 'tag_BLD', 'tag_TRK', 'tag_GMB', 'tag_INF', 'tag_CHA', 'tag_EXE', 'tag_relic'];
  for (let i = 0; i < 3; i++) A.sprite(g, tags[i], 4 + i * 13, stripY + 3);
  for (let i = 0; i < 2; i++) A.sprite(g, tags[7 - i], 164 - i * 13, stripY + 3);
  for (let i = 0; i < 3; i++) {
    const x = 4 + i * 58, y = cardsY - (i === 1 ? 3 : 0);
    U.panel(g, x, y, 56, 46, 'card');
    A.sprite(g, tags[3 + i], x + 5, y + 4); A.sprite(g, ['rar_common', 'rar_uncommon', 'rar_rare'][i], x + 40, y + 8);
    F.draw(g, ['Cold Read', 'Loaded Die', 'Open Eye'][i], x + 28, y + 24, 10, { align: 'center' });
  }
  U.panel(g, 4, detY, 172, 66, 'dark');
  F.draw(g, 'Loaded Die', 10, detY + 5, 10); F.draw(g, 'UNCOMMON · GMB', 10, detY + 14, 25);
  F.draw(g, 'Clashes deal 1 to the Rival.', 10, detY + 24, 10);
  U.button(g, 4, btnY, 56, 38, 'DOSSIER', {}); U.button(g, 64, btnY, 112, 38, 'CONFIRM', { glow: true });
  if (o.bubble) U.bubble(g, 4, floorY + 6, 172, ['Sit. You have earned', 'the right to lose slower.'], 134, 'up');
  return cv;
}
function titleMock(H, o) {
  o = o || {};
  const cv = canvas(180, H, 1), g = cv.getContext('2d'), U = R.UI, F = R.Font, t = o.t === undefined ? 0.5 : o.t;
  engine(H, t);
  const floorY = Math.round(H * 0.56);
  A.bg(g, 'title', t, { floorY: floorY });
  A.sprite(g, 'title_mask', 58, floorY - 58);
  A.sprite(g, 'logo', 30, 14);
  F.draw(g, 'It remembers 12 of you.', 90, 54, 8, { align: 'center', shadow: 1 });
  U.button(g, 14, H - 84, 152, 40, 'CONTINUE', { glow: true });
  U.button(g, 4, H - 40, 56, 24, 'DOSSIER', {}); U.button(g, 62, H - 40, 56, 24, 'UNLOCKS', {}); U.button(g, 120, H - 40, 56, 24, 'SETTINGS', {});
  F.draw(g, 'Developed by tangoSHELL · 2026', 90, H - 11, 7, { align: 'center' });
  return cv;
}

// ---- groups --------------------------------------------------------------------------------------
const groups = {
  menus(scale) {
    scale = scale || 3;
    save('world_bonfire.png', bonfireMock(400, { bubble: true }), scale);
    save('world_bonfire_320.png', bonfireMock(320, { pick: true }), scale);
    save('world_title.png', titleMock(400), scale);
    save('world_title_320.png', titleMock(320, { t: 3.3 }), scale);
  },
  cathedral(scale) {
    scale = scale || 3;
    save('world_cath_v1.png', duelMock(400, { variant: 1 }), scale);
    save('world_cath_v1_320.png', duelMock(320, { variant: 2, rAnim: 'idle', rFrame: 0, pSigil: 'sealed', locked: 1 }), scale);
    save('world_cath_v1_standin.png', duelMock(400, { variant: 1, standin: true, line: null }), scale);
    save('world_cath_v1_empty.png', duelMock(400, { variant: 1, empty: true, line: null }), scale);
    save('world_cath_v4.png', duelMock(400, { variant: 4, rAnim: 'tell_G' }), scale);
    save('world_cath_v6.png', duelMock(400, { variant: 6, rAnim: 'tell_F', rSigil: 'open', rMove: 'F', pSigil: 'open', pMove: 'S' }), scale);
    save('world_cath_v7.png', duelMock(400, { variant: 7, rAnim: 'idle', rFrame: 0 }), scale);
    save('world_cath_v7_p2.png', duelMock(400, { variant: 7, phase2: true, rAnim: 'idle', rFrame: 0 }), scale);
    save('world_cath_gutter.png', duelMock(400, { variant: 1, gutter: 0.7, line: null }), scale);
    save('world_cath_blood.png', duelMock(400, { variant: 1, arena: 'blood_moon' }), scale);
    save('world_cath_dawn.png', duelMock(400, { variant: 1, arena: 'pale_dawn' }), scale);
  },

  icons(scale) {
    scale = scale || 8;
    const cv = canvas(150, 150, 4), g = cv.getContext('2d');
    let x = 2, y = 2;
    const row = (names, step, h, bg) => {
      x = 2;
      for (const n of names) {
        if (bg) { g.fillStyle = R.Pal.hex[bg]; g.fillRect(x - 1, y - 1, step, h + 2); }
        A.sprite(g, n, x, y); x += step + 1;
      }
      y += h + 3;
    };
    row(['icon_S_big', 'icon_G_big', 'icon_F_big', 'icon_S_big_off', 'icon_G_big_off', 'icon_F_big_off'], 22, 20);
    row(['icon_S', 'icon_G', 'icon_F', 'icon_S_off', 'icon_G_off', 'icon_F_off', 'mini_S', 'mini_G', 'mini_F'], 12, 10);
    row(['icon_S', 'icon_G', 'icon_F', 'mini_S', 'mini_G', 'mini_F', 'st_guardBroken', 'st_bleed', 'st_fortify', 'st_focus', 'st_sealed', 'lock'], 11, 10, 2);
    row(['act_glimpse', 'act_honesty', 'act_coin', 'rar_common', 'rar_uncommon', 'rar_rare'], 14, 12, 3);
    row(['tag_RIP', 'tag_TEN', 'tag_BLD', 'tag_TRK', 'tag_GMB', 'tag_INF', 'tag_CHA', 'tag_EXE', 'tag_relic'], 14, 12, 3);
    row(['mask_porcelain', 'mask_mourner', 'mask_jester', 'mask_kintsugi', 'mask_blank'], 14, 14, 3);
    // sigils: sealed r/p, crack frames, open S/G/F, glass (open, no move)
    x = 4; y += 4;
    const sig = (state, move, side, fr) => { A.sigil(g, x, y, state, move, side, fr); x += 24; };
    g.fillStyle = R.Pal.hex[2]; g.fillRect(0, y - 6, 150, 28);
    sig('sealed', null, 'r'); sig('crack', null, 'r', 0); sig('crack', null, 'r', 1); sig('crack', null, 'r', 2);
    sig('open', 'S', 'r'); sig('open', 'G', 'r');
    y += 28; x = 4;
    g.fillStyle = R.Pal.hex[3]; g.fillRect(0, y - 6, 150, 28);
    sig('sealed', null, 'p'); sig('crack', null, 'p', 0); sig('crack', null, 'p', 1); sig('crack', null, 'p', 2);
    sig('open', 'F', 'p'); sig('open', null, 'p');
    save('world_icons.png', cv, scale);
  },

  ui(scale) {
    scale = scale || 4;
    const cv = canvas(180, 330, 2), g = cv.getContext('2d'), U = R.UI, F = R.Font;
    const X = [4, 62, 120], M = ['S', 'G', 'F'], LAB = ['STRIKE', 'GUARD', 'FEINT'], ACC = [18, 27, 29];
    engine(320, 0);
    for (let i = 0; i < 3; i++) U.button(g, X[i], 4, 56, 52, LAB[i], { icon: M[i], accent: ACC[i] });
    U.button(g, X[0], 60, 56, 52, LAB[0], { icon: 'S', accent: 18, pressed: true });
    U.button(g, X[1], 60, 56, 52, LAB[1], { icon: 'G', accent: 27, disabled: true, broken: true });
    U.button(g, X[2], 60, 56, 52, LAB[2], { icon: 'F', accent: 29, disabled: true });
    U.button(g, 14, 116, 152, 40, 'TAP TO BEGIN', { glow: true });
    R.Engine.real = 0.6;
    U.button(g, 4, 160, 56, 24, 'DOSSIER', { glow: true });
    U.button(g, 62, 160, 56, 24, 'UNLOCKS', { pressed: true });
    U.button(g, 120, 160, 56, 24, 'SETTINGS', { disabled: true });
    for (let i = 0; i < 3; i++) {
      U.button(g, 4 + i * 26, 188, 22, 22, '', { disabled: i === 2, pressed: i === 1 });
      A.sprite(g, ['act_glimpse', 'act_honesty', 'act_coin'][i], 4 + i * 26 + 5, 188 + 4 + (i === 1 ? 1 : 0));
    }
    U.button(g, 84, 188, 44, 22, 'SURE?', { accent: 18 });
    U.button(g, 132, 188, 44, 22, 'GUARD', { icon: 'G' });
    // bars
    U.bar(g, 4, 214, 72, 7, 9 / 12, 11 / 12, 18, { ticks: 12 });
    U.bar(g, 104, 214, 72, 7, 5 / 8, 5 / 8, 18, { ticks: 8, flip: true });
    U.bar(g, 4, 224, 72, 7, 1, 1, 19, { ticks: 10 });
    U.bar(g, 104, 224, 72, 7, 3 / 9, 6 / 9, 31, { ticks: 9, flip: true });
    U.bar(g, 4, 234, 160, 8, 0.62, 0.62, 21, null);
    // bubbles
    U.bubble(g, 4, 250, 172, ['You guard when you are afraid.', 'You are afraid a lot.'], 136, 'up');
    U.bubble(g, 4, 282, 110, ['Predictable.'], 30, 'down');
    U.bubble(g, 118, 282, 58, ['...again?'], 150, 'up', { phase2: true });
    // panels
    U.panel(g, 4, 304, 54, 22, 'stone'); F.draw(g, 'Stone', 10, 311, 10);
    U.panel(g, 62, 304, 54, 22, 'dark'); F.draw(g, 'Dark', 68, 311, 10);
    U.panel(g, 120, 304, 56, 22, 'card'); F.draw(g, 'Card', 126, 311, 10);
    save('world_ui.png', cv, scale);
  },

  title(scale) {
    scale = scale || 6;
    const cv = canvas(132, 112, 2), g = cv.getContext('2d');
    A.sprite(g, 'logo', 6, 4);
    A.sprite(g, 'title_mask', 2, 46);
    A.sprite(g, 'title_mask', 68, 46, { frame: 1 });
    save('world_title_art.png', cv, scale);
    const fig = canvas(72, 36, 2), g2 = fig.getContext('2d');
    A.sprite(g2, 'bonfire_player', 2, 2); A.sprite(g2, 'bonfire_rival', 38, 2);
    save('world_figures.png', fig, 8);
  }
};

const arg = process.argv[2], sc = +process.argv[3] || 0;
if (arg === 'crop') {
  // node tools/render_world.js crop '{"variant":1}' x y w h [scale] [H]  -> world_crop.png (a zoomed piece of a duel mock-up)
  const o = JSON.parse(process.argv[3] || '{}'), a = process.argv.slice(4).map(Number);
  const full = (o.kind === 'bonfire' ? bonfireMock : o.kind === 'title' ? titleMock : duelMock)(a[5] || 400, o), part = Pix.make(a[2], a[3]);
  Pix.blit(part, full.img, -a[0], -a[1]);
  save('world_crop.png', part, a[4] || 8);
} else if (arg && groups[arg]) groups[arg](sc);
else if (arg) { console.error('unknown group ' + arg); process.exit(1); }
else for (const k of Object.keys(groups)) groups[k](0);

module.exports = { canvas, save, engine, groups, R };
