// Dev-only: minimal PNG writer (no dependencies) so art can be rendered to an image and looked at.
//   const { writePNG, sheet } = require('./png.js');
//   writePNG('tools/out/x.png', w, h, rgbaUint8Array);
//   sheet('tools/out/x.png', R, [ { img, label? }, ... ], { scale: 4, cols: 8, bg: [22,20,31] });
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
}

// Lay out many indexed images (R.Pix imgs) in a grid on a solid backdrop and write one PNG.
// cells: [{ img }] ; opts: { scale=4, cols=8, bg=[r,g,b], gap=2 }
function sheet(file, R, cells, opts) {
  opts = opts || {};
  const scale = opts.scale || 4, cols = opts.cols || 8, gap = opts.gap === undefined ? 2 : opts.gap;
  const bg = opts.bg || [34, 31, 46];
  let cw = 1, ch = 1;
  for (const c of cells) { if (c.img.w > cw) cw = c.img.w; if (c.img.h > ch) ch = c.img.h; }
  const rows = Math.ceil(cells.length / cols);
  const W = (cols * (cw + gap) + gap) * scale, H = (rows * (ch + gap) + gap) * scale;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  cells.forEach((c, i) => {
    const ox = (gap + (i % cols) * (cw + gap)) * scale, oy = (gap + Math.floor(i / cols) * (ch + gap)) * scale;
    const px = R.Pix.toRGBA(c.img, scale);
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
      const s = (y * px.w + x) * 4;
      if (!px.data[s + 3]) continue;
      const d = ((oy + y) * W + ox + x) * 4;
      out[d] = px.data[s]; out[d + 1] = px.data[s + 1]; out[d + 2] = px.data[s + 2];
    }
  });
  writePNG(file, W, H, out);
  return { w: W, h: H };
}

module.exports = { writePNG, sheet };
