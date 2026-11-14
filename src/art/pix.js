// SHOW ME MY RIVAL — indexed-pixel core shared by all art modules. Pure except toCanvas().
// An "img" is { w, h, d: Uint8Array } of palette indices (0 = transparent, 1..31 = R.Pal colours).
// Art is authored as rows of characters:  '.' = 0,  '1'..'9' = 1..9,  'a'..'v' = 10..31.
(function (R) {
  'use strict';

  var CHARS = '.123456789abcdefghijklmnopqrstuv';
  var CODE = {};
  for (var i = 0; i < CHARS.length; i++) CODE[CHARS[i]] = i;
  CODE[' '] = 0; CODE['0'] = 0;

  function make(w, h) { return { w: w, h: h, d: new Uint8Array(w * h) }; }

  // rows: array of equal-length strings (short rows are padded with transparent).
  function parse(rows) {
    var h = rows.length, w = 0, x, y;
    for (y = 0; y < h; y++) if (rows[y].length > w) w = rows[y].length;
    var img = make(w, h);
    for (y = 0; y < h; y++) {
      var r = rows[y];
      for (x = 0; x < r.length; x++) img.d[y * w + x] = CODE[r[x]] || 0;
    }
    return img;
  }

  // Composite src onto dst at (dx,dy). flip mirrors src horizontally. remap: optional array/object index->index.
  function blit(dst, src, dx, dy, flip, remap) {
    var sw = src.w, sh = src.h, dw = dst.w, dh = dst.h, x, y, c, tx, ty;
    for (y = 0; y < sh; y++) {
      ty = dy + y;
      if (ty < 0 || ty >= dh) continue;
      for (x = 0; x < sw; x++) {
        c = src.d[y * sw + (flip ? sw - 1 - x : x)];
        if (!c) continue;
        tx = dx + x;
        if (tx < 0 || tx >= dw) continue;
        if (remap && remap[c] !== undefined) c = remap[c];
        dst.d[ty * dw + tx] = c;
      }
    }
    return dst;
  }

  function clone(img) { var o = make(img.w, img.h); o.d.set(img.d); return o; }
  function flipX(img) { return blit(make(img.w, img.h), img, 0, 0, true); }
  function fill(img, x, y, w, h, c) {
    for (var j = y; j < y + h; j++) {
      if (j < 0 || j >= img.h) continue;
      for (var k = x; k < x + w; k++) if (k >= 0 && k < img.w) img.d[j * img.w + k] = c;
    }
    return img;
  }
  function set(img, x, y, c) { if (x >= 0 && y >= 0 && x < img.w && y < img.h) img.d[y * img.w + x] = c; }
  function get(img, x, y) { return (x >= 0 && y >= 0 && x < img.w && y < img.h) ? img.d[y * img.w + x] : 0; }

  // Every opaque pixel becomes colour c (hit flash / silhouettes).
  function solid(img, c) {
    var o = make(img.w, img.h);
    for (var k = 0; k < img.d.length; k++) if (img.d[k]) o.d[k] = c;
    return o;
  }
  function remapped(img, remap) {
    var o = make(img.w, img.h);
    for (var k = 0; k < img.d.length; k++) { var c = img.d[k]; o.d[k] = (c && remap[c] !== undefined) ? remap[c] : c; }
    return o;
  }
  // 1-px outline in colour c around opaque pixels (4-neighbourhood); returns a new img of the same size.
  function outline(img, c) {
    var o = clone(img), w = img.w, h = img.h, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (img.d[y * w + x]) continue;
      if (get(img, x - 1, y) || get(img, x + 1, y) || get(img, x, y - 1) || get(img, x, y + 1)) o.d[y * w + x] = c;
    }
    return o;
  }

  // RGBA bytes at an integer scale (used by the Node PNG tool and by toCanvas). bg: optional [r,g,b] backdrop.
  function toRGBA(img, scale, bg) {
    scale = scale || 1;
    var W = img.w * scale, H = img.h * scale, out = new Uint8Array(W * H * 4), rgb = R.Pal.rgb, x, y, c, p, sx, sy, o;
    for (y = 0; y < img.h; y++) for (x = 0; x < img.w; x++) {
      c = img.d[y * img.w + x];
      p = c ? rgb[c] : bg;
      if (!p) continue;
      for (sy = 0; sy < scale; sy++) for (sx = 0; sx < scale; sx++) {
        o = ((y * scale + sy) * W + x * scale + sx) * 4;
        out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2]; out[o + 3] = 255;
      }
    }
    return { w: W, h: H, data: out };
  }

  // Browser only: bake an img into a canvas once; draw it later with g.drawImage(canvas, x, y).
  function toCanvas(img) {
    var cv = document.createElement('canvas');
    cv.width = img.w; cv.height = img.h;
    var g = cv.getContext('2d'), id = g.createImageData(img.w, img.h);
    id.data.set(toRGBA(img, 1).data);
    g.putImageData(id, 0, 0);
    return cv;
  }

  R.Pix = { CHARS: CHARS, make: make, parse: parse, blit: blit, clone: clone, flipX: flipX, fill: fill, set: set, get: get,
            solid: solid, remapped: remapped, outline: outline, toRGBA: toRGBA, toCanvas: toCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
