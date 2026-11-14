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

// ---- groups --------------------------------------------------------------------------------------
const groups = {
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
if (arg && groups[arg]) groups[arg](sc);
else if (arg) { console.error('unknown group ' + arg); process.exit(1); }
else for (const k of Object.keys(groups)) groups[k](0);

module.exports = { canvas, save, engine, groups, R };
