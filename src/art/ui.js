// SHOW ME MY RIVAL - UI primitives (DESIGN 13.5). Each function is self-contained: fillRects in palette colours only.
(function (R) {
  'use strict';

  var P = R.Pal.hex;
  var ICON2 = { S: 'icon_S_big', G: 'icon_G_big', F: 'icon_F_big' };
  var ICON1 = { S: 'icon_S', G: 'icon_G', F: 'icon_F' };
  var MINI = { S: 'mini_S', G: 'mini_G', F: 'mini_F' };
  var HI = { 18: 19, 31: 23, 27: 28, 29: 30, 21: 22, 25: 22 };
  var CENTER = { align: 'center' };

  function now() { return R.Engine ? R.Engine.real || 0 : 0; }

  // Rectangle with 1-px corners cut.
  function rr(g, x, y, w, h, c) {
    g.fillStyle = P[c];
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
  }
  // Rectangle with 2-px stepped corners.
  function rr2(g, x, y, w, h, c) {
    g.fillStyle = P[c];
    g.fillRect(x + 2, y, w - 4, h);
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillRect(x, y + 2, w, h - 4);
  }

  // style: 'stone' (default) | 'dark' | 'card'
  function panel(g, x, y, w, h, style) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    if (style === 'dark') {
      rr(g, x, y, w, h, 1);
      g.fillStyle = P[5]; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = P[2]; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    } else if (style === 'card') {
      rr(g, x, y, w, h, 1);
      g.fillStyle = P[25]; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = P[24]; g.fillRect(x + 1, y + h - 2, w - 2, 1); g.fillRect(x + w - 2, y + 1, 1, h - 2);
      g.fillStyle = P[3]; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = P[4]; g.fillRect(x + 2, y + 2, w - 4, 1);
    } else {
      rr(g, x, y, w, h, 1);
      g.fillStyle = P[4]; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = P[6]; g.fillRect(x + 1, y + 1, w - 2, 1); g.fillRect(x + 1, y + 1, 1, h - 2);
      g.fillStyle = P[3]; g.fillRect(x + 1, y + h - 2, w - 2, 1); g.fillRect(x + w - 2, y + 1, 1, h - 2);
    }
  }

  // st: { pressed, disabled, icon, glow, accent:palIndex, broken }
  //   icon   = move letter 'S'|'G'|'F' (20x20 icon above the label when the button is tall, else 10x10 beside it)
  //            or any sprite name (drawn centred as a 12x12 icon)
  //   accent = palette index of the move-colour stripe;  broken = cracked "not legal this turn" overlay
  function button(g, x, y, w, h, label, st) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    var pressed = !!(st && st.pressed), disabled = !!(st && st.disabled);
    var icon = st && st.icon ? st.icon : null, isMove = icon === 'S' || icon === 'G' || icon === 'F';
    var frame = 25, face = 4, text = 10, off = 0, cy, tw, lx, i, j, cx;
    if (disabled) { frame = 5; face = 3; text = 6; }
    else if (pressed) { frame = 24; face = 3; off = 2; }
    else if (st && st.glow && ((now() * 2) | 0) % 2 === 0) frame = 22;

    rr(g, x, y, w, h, 1);                                   // outline
    rr(g, x + 1, y + 1, w - 2, h - 2, frame);               // brass frame
    if (!disabled && !pressed) {                            // frame shadow (bottom + right)
      g.fillStyle = P[24];
      g.fillRect(x + 2, y + h - 2, w - 4, 1); g.fillRect(x + w - 2, y + 2, 1, h - 4);
    }
    g.fillStyle = P[1]; g.fillRect(x + 3, y + 3, w - 6, h - 6);   // inner line
    g.fillStyle = P[face]; g.fillRect(x + 4, y + 4, w - 8, h - 8);
    if (!disabled && !pressed) { g.fillStyle = P[5]; g.fillRect(x + 4, y + 4, w - 8, 1); }
    else if (pressed) { g.fillStyle = P[2]; g.fillRect(x + 4, y + 4, w - 8, 2); }
    if (st && st.accent && h >= 20) {                       // move-colour stripe along the bottom of the face
      g.fillStyle = P[disabled ? 5 : st.accent]; g.fillRect(x + 6, y + h - 7, w - 12, 2);
    }

    if (isMove && h >= 36 && R.Art) {
      cy = y + ((h - 34) >> 1) + off;                       // 20 icon + 4 gap + 7 text, sitting above the stripe
      cx = x + ((w - 20) >> 1);
      R.Art.sprite(g, ICON2[icon], cx, cy);
      if (disabled) {                                       // grey the icon out with a checker of the face colour
        g.fillStyle = P[face];
        for (j = 0; j < 20; j++) for (i = j & 1; i < 20; i += 2) g.fillRect(cx + i, cy + j, 1, 1);
      }
      if (label) R.Font.draw(g, label, x + (w >> 1), cy + 24, text, CENTER);
      if (!disabled && R.BEATS && MINI[R.BEATS[icon]]) {    // "beats" hint in the corner
        g.fillStyle = P[2]; g.fillRect(x + w - 13, y + 5 + off, 8, 8);
        R.Art.sprite(g, MINI[R.BEATS[icon]], x + w - 12, y + 6 + off);
      }
    } else if (isMove && R.Art) {
      tw = label ? R.Font.width(label) + 3 : 0;
      lx = x + ((w - 10 - tw) >> 1);
      cy = y + ((h - 10) >> 1) + off;
      R.Art.sprite(g, ICON1[icon], lx, cy);
      if (label) R.Font.draw(g, label, lx + 13, cy + 2, text);
    } else if (icon && R.Art) {
      cy = y + ((h - (label ? 22 : 12)) >> 1) + off;
      R.Art.sprite(g, icon, x + ((w - 12) >> 1), cy);
      if (label) R.Font.draw(g, label, x + (w >> 1), cy + 15, text, CENTER);
    } else if (label) {
      R.Font.draw(g, label, x + (w >> 1), y + ((h - 7) >> 1) + off, text, CENTER);
    }
    if (st && st.broken) {                                  // jagged crack across the face
      cx = x + (w >> 1) - 5; cy = y + 6;
      for (i = 0, j = 0; cy + j < y + h - 8; i++, j += 4) {
        g.fillStyle = P[1]; g.fillRect(cx + (i & 1 ? 4 : 0) + (i % 3), cy + j, 2, 5);
        g.fillStyle = P[19]; g.fillRect(cx + (i & 1 ? 4 : 0) + (i % 3) + 2, cy + j, 1, 4);
      }
    }
  }

  function bubbleH(nLines) { return Math.max(1, nLines) * 9 + 5; }

  // Speech bubble; (x, y) = top-left of the body, tail tip 5 px outside it at tailX. Returns the body height.
  // tailDir 'up' | 'down' | null (no tail). opts: { phase2:bool } = inverted void/witchfire style.
  function bubble(g, x, y, w, lines, tailX, tailDir, opts) {
    x |= 0; y |= 0; w |= 0;
    var p2 = !!(opts && (opts.phase2 || opts === 'p2')), fill = p2 ? 1 : 10, border = p2 ? 31 : 1, shade = p2 ? 2 : 12, ink = p2 ? 31 : 1;
    var h = bubbleH(lines.length), i, tx, ty, k, half;
    if (p2 && ((now() * 5) | 0) % 2) x += 1;                // border jitter every 200 ms
    rr2(g, x, y, w, h, border);
    g.fillStyle = P[fill];
    g.fillRect(x + 2, y + 1, w - 4, h - 2);
    g.fillRect(x + 1, y + 2, w - 2, h - 4);
    g.fillStyle = P[shade]; g.fillRect(x + 2, y + h - 2, w - 4, 1);
    if (tailDir === 'up' || tailDir === 'down') {
      tx = Math.max(x + 6, Math.min(x + w - 7, tailX | 0));
      for (k = 0; k < 5; k++) {                             // 6x5 tail, tip is 2 px wide
        half = (k + 1) >> 1;
        ty = tailDir === 'up' ? y - 5 + k : y + h + 4 - k;
        g.fillStyle = P[border]; g.fillRect(tx - half, ty, 2 + half * 2, 1);
        if (k > 0) { g.fillStyle = P[fill]; g.fillRect(tx - half + 1, ty, half * 2, 1); }
      }
      g.fillStyle = P[fill]; g.fillRect(tx - 1, tailDir === 'up' ? y : y + h - 1, 4, 1);          // open the border
      if (tailDir === 'down') { g.fillStyle = P[shade]; g.fillRect(tx - 1, y + h - 2, 4, 1); }
    }
    for (i = 0; i < lines.length; i++) R.Font.draw(g, lines[i], x + 4, y + 3 + i * 9, ink);
    return h;
  }

  // HP bar. frac / lagFrac in 0..1; palIndex = fill colour (default 18).
  // opts: { ticks:int (max HP: one notch per HP), flip:bool (fill anchored to the right edge, empties from the left) }.
  function bar(g, x, y, w, h, frac, lagFrac, palIndex, opts) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    var iw = w - 2, ih = h - 2, pal = palIndex || 18, rtl = !!(opts && (opts.flip || opts.rtl)), n = opts && opts.ticks ? opts.ticks | 0 : 0;
    var f = frac > 1 ? 1 : frac > 0 ? frac : 0, l = lagFrac > 1 ? 1 : lagFrac > 0 ? lagFrac : 0, fw, lw, i, tx;
    fw = Math.round(iw * f); if (f > 0 && fw < 1) fw = 1;
    lw = Math.round(iw * l);
    g.fillStyle = P[1]; g.fillRect(x, y, w, h);
    g.fillStyle = P[3]; g.fillRect(x + 1, y + 1, iw, ih);
    if (lw > fw) { g.fillStyle = P[10]; g.fillRect(rtl ? x + 1 + iw - lw : x + 1 + fw, y + 1, lw - fw, ih); }
    if (fw > 0) {
      g.fillStyle = P[pal]; g.fillRect(rtl ? x + 1 + iw - fw : x + 1, y + 1, fw, ih);
      g.fillStyle = P[HI[pal] || pal]; g.fillRect(rtl ? x + 1 + iw - fw : x + 1, y + 1, fw, 1);
    }
    if (n > 1 && iw / n >= 2) {
      g.fillStyle = P[1];
      for (i = 1; i < n; i++) {
        tx = Math.round(iw * i / n);
        g.fillRect(rtl ? x + 1 + iw - tx : x + tx, y + h - 1 - (ih >> 1), 1, ih >> 1);
      }
    }
  }

  function hit(px, py, x, y, w, h) { return px >= x && py >= y && px < x + w && py < y + h; }

  R.UI = { panel: panel, button: button, bubble: bubble, bubbleH: bubbleH, bar: bar, hit: hit };
})(globalThis.RIVAL = globalThis.RIVAL || {});
