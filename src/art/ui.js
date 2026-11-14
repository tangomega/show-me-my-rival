// SHOW ME MY RIVAL — UI kit (DESIGN 13.5): buttons, panels, speech bubble, HP bar.
// One family: a void outline, a bevelled band (lit top/left, shadowed bottom/right), a flat face for text.
// Frames are 9-slices assembled from hand-drawn corner tiles into palette-indexed images, baked into canvases
// once per (size, style, state) and then drawn with a single drawImage. Text never sits on texture.
(function (R) {
  'use strict';

  var Pix = R.Pix, P = R.Pal.hex;
  var ICON2 = { S: 'icon_S_big', G: 'icon_G_big', F: 'icon_F_big' };
  var ICON2_OFF = { S: 'icon_S_big_off', G: 'icon_G_big_off', F: 'icon_F_big_off' };
  var ICON1 = { S: 'icon_S', G: 'icon_G', F: 'icon_F' };
  var ICON1_OFF = { S: 'icon_S_off', G: 'icon_G_off', F: 'icon_F_off' };
  var MINI = { S: 'mini_S', G: 'mini_G', F: 'mini_F' };
  var HI = { 17: 18, 18: 19, 19: 20, 31: 23, 27: 28, 26: 27, 29: 30, 30: 10, 21: 22, 20: 21, 25: 22, 24: 25, 28: 10, 7: 8, 5: 6 };
  var LO = { 18: 17, 19: 18, 31: 27, 27: 26, 28: 27, 29: 1, 30: 29, 21: 20, 22: 21, 25: 24, 7: 5, 10: 11, 23: 22 };
  var CENTER = { align: 'center' };

  function now() { return R.Engine ? R.Engine.real || 0 : 0; }

  // ---- 9-slice tiles (rows; '#' = the face colour) ---------------------------------------------
  // Brass button frame: void, 2 px brass (lit top/left = p, shadow bottom/right = o), void.
  var T_BUTTON = {
    c: 5, t: [1, 25, 25, 1], l: [1, 25, 25, 1], b: [1, 24, 24, 1], r: [1, 24, 24, 1],
    tl: ['.1111', '1mppp', '1pppp', '1pp11', '1pp1#'],
    tr: ['1111.', 'pppo1', 'ppoo1', '11oo1', '#1oo1'],
    bl: ['1pp1#', '1pp11', '1pooo', '1oooo', '.1111'],
    br: ['#1oo1', '11oo1', 'oooo1', 'oooo1', '1111.']
  };
  // Card: the same brass, one pixel thinner.
  var T_CARD = {
    c: 4, t: [1, 25, 1], l: [1, 25, 1], b: [1, 24, 1], r: [1, 24, 1],
    tl: ['.111', '1mpp', '1p11', '1p1#'],
    tr: ['111.', 'ppo1', '11o1', '#1o1'],
    bl: ['1p1#', '1p11', '1poo', '.111'],
    br: ['#1o1', '11o1', 'ooo1', '111.']
  };
  // Stone slab: lit edge 6, shadow edge 3.
  var T_STONE = {
    c: 3, t: [1, 6], l: [1, 6], b: [1, 3], r: [1, 3],
    tl: ['.11', '176', '16#'],
    tr: ['11.', '651', '#31'],
    bl: ['16#', '153', '.11'],
    br: ['#31', '331', '11.']
  };
  // Dark plate: a cold-stone line with brass studs in the corners.
  var T_DARK = {
    c: 3, t: [1, 5], l: [1, 5], b: [1, 4], r: [1, 4],
    tl: ['.11', '1p5', '15#'],
    tr: ['11.', '5p1', '#41'],
    bl: ['15#', '1o4', '.11'],
    br: ['#41', '4o1', '11.']
  };
  var TAIL_UP = ['....11.', '...1#1.', '..1##1.', '.1###1.', '1####1.', '.####..'];
  var REMAP_GLOW = { 25: 22, 24: 25, 22: 23 };
  var REMAP_PRESSED = { 25: 24, 22: 24 };
  var REMAP_OFF = { 25: 5, 24: 4, 22: 6 };

  function tile(rows, face, remap) {
    var ch = Pix.CHARS[face], out = [], i, img;
    for (i = 0; i < rows.length; i++) out.push(rows[i].split('#').join(ch));
    img = Pix.parse(out);
    return remap ? Pix.remapped(img, remap) : img;
  }
  function col(c, remap) { return remap && remap[c] !== undefined ? remap[c] : c; }

  // Assemble a w x h frame from a tile set. face / hi / lo = face colour, its top row, its bottom row (0 = none).
  function slice(w, h, T, face, hi, lo, remap) {
    var img = Pix.make(w, h), n = T.t.length, c = T.c, i;
    Pix.fill(img, n, n, w - 2 * n, h - 2 * n, face);
    if (hi) Pix.fill(img, n, n, w - 2 * n, 1, hi);
    if (lo) Pix.fill(img, n, h - n - 1, w - 2 * n, 1, lo);
    for (i = 0; i < n; i++) {
      Pix.fill(img, c, i, w - 2 * c, 1, col(T.t[i], remap));
      Pix.fill(img, c, h - 1 - i, w - 2 * c, 1, col(T.b[i], remap));
      Pix.fill(img, i, c, 1, h - 2 * c, col(T.l[i], remap));
      Pix.fill(img, w - 1 - i, c, 1, h - 2 * c, col(T.r[i], remap));
    }
    Pix.fill(img, 0, 0, c, c, 0); Pix.fill(img, w - c, 0, c, c, 0); Pix.fill(img, 0, h - c, c, c, 0); Pix.fill(img, w - c, h - c, c, c, 0);
    Pix.blit(img, tile(T.tl, hi || face, remap), 0, 0);
    Pix.blit(img, tile(T.tr, hi || face, remap), w - c, 0);
    Pix.blit(img, tile(T.bl, lo || face, remap), 0, h - c);
    Pix.blit(img, tile(T.br, lo || face, remap), w - c, h - c);
    return img;
  }

  function line(img, x0, y0, x1, y1, c) {
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx - dy, e2;
    for (;;) {
      Pix.set(img, x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      e2 = 2 * e;
      if (e2 > -dy) { e -= dy; x0 += sx; }
      if (e2 < dx) { e += dx; y0 += sy; }
    }
  }
  // The "not legal this turn" crack: a jagged void line across the face with a chipped light edge.
  var CRACK = [0, 0, 0.16, 0.34, 0.33, 0.24, 0.50, 0.58, 0.63, 0.47, 0.82, 0.86, 1, 1];
  var BRANCH = [0.50, 0.58, 0.40, 0.80, 0.46, 1.0];
  function crack(img, x, y, w, h) {
    var lay = Pix.make(img.w, img.h), i, px, py, c;
    for (i = 0; i + 3 < CRACK.length; i += 2) {
      line(lay, x + Math.round(CRACK[i] * w), y + Math.round(CRACK[i + 1] * h), x + Math.round(CRACK[i + 2] * w), y + Math.round(CRACK[i + 3] * h), 1);
    }
    for (i = 0; i + 3 < BRANCH.length; i += 2) {
      line(lay, x + Math.round(BRANCH[i] * w), y + Math.round(BRANCH[i + 1] * h), x + Math.round(BRANCH[i + 2] * w), y + Math.round(BRANCH[i + 3] * h), 1);
    }
    for (py = 0; py < lay.h; py++) for (px = 0; px < lay.w; px++) {
      if (!lay.d[py * lay.w + px]) continue;
      c = Pix.get(img, px, py - 1);
      if (!Pix.get(lay, px, py - 1) && (c === 3 || c === 4)) Pix.set(img, px, py - 1, 5);      // chipped upper lip
      Pix.set(img, px, py, 1);
    }
  }

  // state: 0 normal, 1 glow (lit phase), 2 pressed, 3 disabled, 4 disabled + broken
  function buttonImg(w, h, state, accent) {
    var img, remap = state === 1 ? REMAP_GLOW : state === 2 ? REMAP_PRESSED : state >= 3 ? REMAP_OFF : null;
    if (state === 2) { img = slice(w, h, T_BUTTON, 3, 2, 0, remap); Pix.fill(img, 4, 5, w - 8, 1, 2); }
    else if (state >= 3) img = slice(w, h, T_BUTTON, 3, 0, 2, remap);
    else img = slice(w, h, T_BUTTON, 4, 5, 3, remap);
    if (accent && h >= 20 && w >= 24) {                     // move-colour stripe set into the bottom of the face
      var sy = h - (h < 30 ? 6 : 8) + (state === 2 && h >= 30 ? 1 : 0), face = state === 0 || state === 1 ? 4 : 3;
      var hi = state >= 3 ? 5 : state === 2 ? accent : (HI[accent] || accent);
      var lo = state >= 3 ? 4 : state === 2 ? (LO[accent] || accent) : accent;
      Pix.fill(img, 6, sy, w - 12, 2, 1);                   // void bed, corners knocked off
      Pix.set(img, 6, sy, face); Pix.set(img, w - 7, sy, face);
      Pix.fill(img, 7, sy, w - 14, 1, hi);
      Pix.fill(img, 7, sy + 1, w - 14, 1, lo);
    }
    if (state === 4) crack(img, 7, 7, w - 15, h - 17);
    return img;
  }

  function panelImg(w, h, style) {
    if (style === 1) return slice(w, h, T_DARK, 2, 3, 1, null);
    if (style === 2) return slice(w, h, T_CARD, 3, 4, 2, null);
    return slice(w, h, T_STONE, 4, 5, 0, null);
  }

  function bubbleImg(w, h, p2) {
    var img = Pix.make(w, h), border = p2 ? 31 : 1, fill = p2 ? 1 : 10, shade = p2 ? 2 : 12;
    Pix.fill(img, 3, 0, w - 6, h, border); Pix.fill(img, 0, 3, w, h - 6, border);
    Pix.fill(img, 1, 1, w - 2, h - 2, border);
    Pix.set(img, 1, 1, 0); Pix.set(img, w - 2, 1, 0); Pix.set(img, 1, h - 2, 0); Pix.set(img, w - 2, h - 2, 0);
    Pix.fill(img, 0, 0, 1, 3, 0); Pix.fill(img, 0, 0, 3, 1, 0); Pix.fill(img, w - 1, 0, 1, 3, 0); Pix.fill(img, w - 3, 0, 3, 1, 0);
    Pix.fill(img, 0, h - 3, 1, 3, 0); Pix.fill(img, 0, h - 1, 3, 1, 0); Pix.fill(img, w - 1, h - 3, 1, 3, 0); Pix.fill(img, w - 3, h - 1, 3, 1, 0);
    Pix.fill(img, 3, 1, w - 6, h - 2, fill); Pix.fill(img, 1, 3, w - 2, h - 6, fill); Pix.fill(img, 2, 2, w - 4, h - 4, fill);
    Pix.fill(img, 3, h - 2, w - 6, 1, shade); Pix.set(img, 2, h - 3, shade); Pix.set(img, w - 3, h - 3, shade);
    if (!p2) { Pix.fill(img, w - 2, 4, 1, h - 7, 11); }                       // right edge falls off the light
    return img;
  }
  function tailImg(dir, p2) {
    var border = p2 ? 'v' : '1', fill = p2 ? '1' : 'a', out, x, y;
    var img = Pix.parse(TAIL_UP.map(function (r) { return r.split('1').join('B').split('#').join(fill).split('B').join(border); }));
    if (dir === 'up') return img;
    out = Pix.make(img.w, img.h);
    for (y = 0; y < img.h; y++) for (x = 0; x < img.w; x++) out.d[(img.h - 1 - y) * img.w + x] = img.d[y * img.w + x];
    for (x = 0; x < out.w; x++) if (out.d[x] === (p2 ? 1 : 10)) out.d[x] = p2 ? 2 : 12;           // carries the shade row
    return out;
  }

  // ---- canvas cache (integer keys; nothing is allocated once a frame is warm) ---------------------
  var cache = new Map();
  function bake(img) { return typeof document === 'undefined' ? null : Pix.toCanvas(img); }
  function put(key, img) {
    var cv = bake(img);
    if (cache.size > 160) cache.clear();
    if (cv) cache.set(key, cv);
    return cv;
  }
  // key layout: kind(0..3) | w(10 bits) | h(10 bits) | a(6 bits) | b(3 bits)
  function keyOf(kind, w, h, a, b) { return (((kind * 1024 + w) * 1024 + h) * 64 + a) * 8 + b; }

  // style: 'stone' (default) | 'dark' | 'card'
  function panel(g, x, y, w, h, style) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (w < 8 || h < 8) return;
    var s = style === 'dark' ? 1 : style === 'card' ? 2 : 0, key = keyOf(1, w, h, 0, s), cv = cache.get(key);
    if (!cv) cv = put(key, panelImg(w, h, s));
    if (cv) g.drawImage(cv, x, y);
  }

  // st: { pressed, disabled, icon, glow, accent:palIndex, broken }
  //   icon   = move letter 'S'|'G'|'F' (20x20 icon above the label when the button is tall, else 10x10 beside it)
  //            or any sprite name (drawn centred as a 12x12 icon)
  //   accent = palette index of the move-colour stripe;  broken = cracked "not legal this turn" overlay
  function button(g, x, y, w, h, label, st) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (w < 12 || h < 12) return;
    var pressed = !!(st && st.pressed), disabled = !!(st && st.disabled), broken = !!(st && st.broken);
    var icon = st && st.icon ? st.icon : null, isMove = icon === 'S' || icon === 'G' || icon === 'F';
    var accent = st && st.accent > 0 && st.accent < 32 ? st.accent | 0 : 0;
    var state = disabled || broken ? (broken ? 4 : 3) : pressed ? 2 : (st && st.glow && ((now() * 2) | 0) % 2 === 0) ? 1 : 0;
    var text = state >= 3 ? 6 : state === 2 ? 11 : 10, off = state === 2 ? 2 : 0;
    var key = keyOf(0, w, h, accent, state), cv = cache.get(key), cy, cx, tw, lx, A = R.Art;
    if (!cv) cv = put(key, buttonImg(w, h, state, accent));
    if (cv) g.drawImage(cv, x, y);

    if (isMove && h >= 36 && A) {
      cy = y + ((h - 34) >> 1) + off;                       // 20 icon + 4 gap + 7 text, sitting above the stripe
      cx = x + ((w - 20) >> 1);
      A.sprite(g, state >= 3 ? ICON2_OFF[icon] : ICON2[icon], cx, cy);
      if (label) R.Font.draw(g, label, x + (w >> 1), cy + 24, text, CENTER);
      if (state < 3 && R.BEATS && MINI[R.BEATS[icon]]) {    // "beats" hint: a small inset in the corner
        g.fillStyle = P[1]; g.fillRect(x + w - 14, y + 5 + off, 10, 9);
        g.fillStyle = P[state === 2 ? 2 : 3]; g.fillRect(x + w - 13, y + 5 + off, 8, 8);
        A.sprite(g, MINI[R.BEATS[icon]], x + w - 12, y + 6 + off);
      }
    } else if (isMove && A) {
      tw = label ? R.Font.width(label) + 3 : 0;
      lx = x + ((w - 10 - tw) >> 1);
      cy = y + ((h - 10) >> 1) + off;
      A.sprite(g, state >= 3 ? ICON1_OFF[icon] : ICON1[icon], lx, cy);
      if (label) R.Font.draw(g, label, lx + 13, cy + 2, text);
    } else if (icon && A) {
      cy = y + ((h - (label ? 22 : 12)) >> 1) + off;
      A.sprite(g, icon, x + ((w - 12) >> 1), cy);
      if (label) R.Font.draw(g, label, x + (w >> 1), cy + 15, text, CENTER);
    } else if (label) {
      R.Font.draw(g, label, x + (w >> 1), y + ((h - 7) >> 1) + off, text, CENTER);
    }
    if (broken && A && w >= 30 && h >= 30) {                // cracked-shield mark, top-left inset
      g.fillStyle = P[1]; g.fillRect(x + 4, y + 5, 11, 10);
      g.fillStyle = P[2]; g.fillRect(x + 5, y + 5, 10, 9);
      A.sprite(g, 'st_guardBroken', x + 6, y + 5);
    }
  }

  function bubbleH(nLines) { return Math.max(1, nLines) * 9 + 5; }

  // Speech bubble; (x, y) = top-left of the body, tail tip 5 px outside it at tailX. Returns the body height.
  // tailDir 'up' | 'down' | null (no tail). opts: { phase2:bool } = inverted void/witchfire style.
  var tails = [null, null, null, null];
  function bubble(g, x, y, w, lines, tailX, tailDir, opts) {
    x |= 0; y |= 0; w |= 0;
    var p2 = !!(opts && (opts.phase2 || opts === 'p2')), ink = p2 ? 31 : 1;
    var h = bubbleH(lines.length), i, tx, ti, key, cv, tc;
    if (w < 14) return h;
    if (p2 && ((now() * 5) | 0) % 2) x += 1;                // border jitter every 200 ms
    key = keyOf(2, w, h, 0, p2 ? 1 : 0); cv = cache.get(key);
    if (!cv) cv = put(key, bubbleImg(w, h, p2));
    if (cv) g.drawImage(cv, x, y);
    if (tailDir === 'up' || tailDir === 'down') {
      tx = Math.max(x + 8, Math.min(x + w - 8, tailX | 0));
      ti = (tailDir === 'up' ? 0 : 1) + (p2 ? 2 : 0);
      tc = tails[ti];
      if (!tc) tc = tails[ti] = bake(tailImg(tailDir, p2));
      if (tc) g.drawImage(tc, tx - 4, tailDir === 'up' ? y - 5 : y + h - 1);
    }
    for (i = 0; i < lines.length; i++) R.Font.draw(g, lines[i], x + 4, y + 3 + i * 9, ink);
    return h;
  }

  // HP bar. frac / lagFrac in 0..1; palIndex = fill colour (default 18).
  // opts: { ticks:int (max HP: one notch per HP), flip:bool (fill anchored to the right edge, empties from the left) }.
  function bar(g, x, y, w, h, frac, lagFrac, palIndex, opts) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    var iw = w - 2, ih = h - 2, pal = palIndex || 18, rtl = !!(opts && (opts.flip || opts.rtl)), n = opts && opts.ticks ? opts.ticks | 0 : 0;
    var f = frac > 1 ? 1 : frac > 0 ? frac : 0, l = lagFrac > 1 ? 1 : lagFrac > 0 ? lagFrac : 0, fw, lw, i, tx, fx, lx;
    if (iw < 1 || ih < 1) return;
    fw = Math.round(iw * f); if (f > 0 && fw < 1) fw = 1;
    lw = Math.round(iw * l);
    // frame: void, with the corners knocked off and a lit lower lip
    g.fillStyle = P[1]; g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
    g.fillStyle = P[3]; g.fillRect(x + 1, y + 1, iw, ih);
    g.fillStyle = P[2]; g.fillRect(x + 1, y + 1, iw, 1);                        // recess shadow
    if (lw > fw) {                                                              // lag chunk (bone)
      lx = rtl ? x + 1 + iw - lw : x + 1 + fw;
      g.fillStyle = P[10]; g.fillRect(lx, y + 1, lw - fw, ih);
      if (ih >= 3) { g.fillStyle = P[11]; g.fillRect(lx, y + ih, lw - fw, 1); }
    }
    if (fw > 0) {
      fx = rtl ? x + 1 + iw - fw : x + 1;
      g.fillStyle = P[pal]; g.fillRect(fx, y + 1, fw, ih);
      g.fillStyle = P[HI[pal] || pal]; g.fillRect(fx, y + 1, fw, 1);            // lighter top row
      if (ih >= 4) { g.fillStyle = P[LO[pal] || pal]; g.fillRect(fx, y + ih, fw, 1); }
    }
    if (n > 1 && iw / n >= 2) {                                                 // one notch per HP
      for (i = 1; i < n; i++) {
        tx = Math.round(iw * i / n);
        tx = rtl ? x + 1 + iw - tx : x + tx;
        g.fillStyle = P[1]; g.fillRect(tx, y + h - 1 - (ih >> 1), 1, ih >> 1);
        g.fillStyle = P[2]; g.fillRect(tx, y + 1, 1, ih - (ih >> 1));
      }
      if (fw > 0) {                                                             // inside the fill the notch top stays blood-dark
        g.fillStyle = P[LO[pal] || pal];
        for (i = 1; i < n; i++) {
          tx = Math.round(iw * i / n);
          tx = rtl ? x + 1 + iw - tx : x + tx;
          if (tx >= fx && tx < fx + fw) g.fillRect(tx, y + 1, 1, ih - (ih >> 1));
        }
      }
    }
  }

  function hit(px, py, x, y, w, h) { return px >= x && py >= y && px < x + w && py < y + h; }

  R.UI = { panel: panel, button: button, bubble: bubble, bubbleH: bubbleH, bar: bar, hit: hit };
})(globalThis.RIVAL = globalThis.RIVAL || {});
