// SHOW ME MY RIVAL - 5x7 proportional pixel font (cell 5x8: 7 px cap height + 1 descender row, line height 9).
// width() and wrap() are DOM-free; draw() lazily builds one glyph atlas per palette colour and scale.
(function (R) {
  'use strict';

  var CELL_W = 6, CELL_H = 8, COLS = 16, LINE_H = 9;

  // Rows top to bottom separated by "/", "#" = ink. Missing rows are empty. Width = longest row.
  var G = {
    'A': '.###./#...#/#...#/#####/#...#/#...#/#...#',
    'B': '####./#...#/#...#/####./#...#/#...#/####.',
    'C': '.###./#...#/#..../#..../#..../#...#/.###.',
    'D': '####./#...#/#...#/#...#/#...#/#...#/####.',
    'E': '####/#.../#.../###./#.../#.../####',
    'F': '####/#.../#.../###./#.../#.../#...',
    'G': '.###./#...#/#..../#.###/#...#/#...#/.###.',
    'H': '#...#/#...#/#...#/#####/#...#/#...#/#...#',
    'I': '###/.#./.#./.#./.#./.#./###',
    'J': '...#/...#/...#/...#/...#/#..#/.##.',
    'K': '#...#/#..#./#.#../##.../#.#../#..#./#...#',
    'L': '#.../#.../#.../#.../#.../#.../####',
    'M': '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#',
    'N': '#...#/##..#/##..#/#.#.#/#..##/#..##/#...#',
    'O': '.###./#...#/#...#/#...#/#...#/#...#/.###.',
    'P': '####./#...#/#...#/####./#..../#..../#....',
    'Q': '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#',
    'R': '####./#...#/#...#/####./#.#../#..#./#...#',
    'S': '.####/#..../#..../.###./....#/....#/####.',
    'T': '#####/..#../..#../..#../..#../..#../..#..',
    'U': '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
    'V': '#...#/#...#/#...#/#...#/.#.#./.#.#./..#..',
    'W': '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
    'X': '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
    'Y': '#...#/#...#/.#.#./..#../..#../..#../..#..',
    'Z': '#####/....#/...#./..#../.#.../#..../#####',

    'a': '//.##./...#/.###/#..#/.###',
    'b': '#.../#.../###./#..#/#..#/#..#/###.',
    'c': '//.##/#../#../#../.##',
    'd': '...#/...#/.###/#..#/#..#/#..#/.###',
    'e': '//.##./#..#/####/#.../.###',
    'f': '.##/#../###/#../#../#../#..',
    'g': '//.###/#..#/#..#/.###/...#/.##.',
    'h': '#.../#.../###./#..#/#..#/#..#/#..#',
    'i': '#//#/#/#/#/#',
    'j': '.#//.#/.#/.#/.#/.#/#.',
    'k': '#.../#.../#..#/#.#./##../#.#./#..#',
    'l': '#./#./#./#./#./#./.#',
    'm': '//##.#./#.#.#/#.#.#/#.#.#/#.#.#',
    'n': '//###./#..#/#..#/#..#/#..#',
    'o': '//.##./#..#/#..#/#..#/.##.',
    'p': '//###./#..#/#..#/###./#.../#...',
    'q': '//.###/#..#/#..#/.###/...#/...#',
    'r': '//#.#/##./#../#../#..',
    's': '//.###/#.../.##./...#/###.',
    't': '.#./.#./###/.#./.#./.#./..#',
    'u': '//#..#/#..#/#..#/#..#/.###',
    'v': '//#.#/#.#/#.#/#.#/.#.',
    'w': '//#...#/#...#/#.#.#/#.#.#/.#.#.',
    'x': '//#.#/#.#/.#./#.#/#.#',
    'y': '//#..#/#..#/#..#/.###/...#/.##.',
    'z': '//####/..#./.#../#.../####',

    '0': '.##./#..#/#..#/#..#/#..#/#..#/.##.',
    '1': '.#./##./.#./.#./.#./.#./###',
    '2': '.##./#..#/...#/..#./.#../#.../####',
    '3': '###./...#/...#/.##./...#/...#/###.',
    '4': '#..#/#..#/#..#/####/...#/...#/...#',
    '5': '####/#.../###./...#/...#/#..#/.##.',
    '6': '.##./#.../#.../###./#..#/#..#/.##.',
    '7': '####/...#/...#/..#./..#./.#../.#..',
    '8': '.##./#..#/#..#/.##./#..#/#..#/.##.',
    '9': '.##./#..#/#..#/.###/...#/...#/.##.',

    ' ': '...',
    '.': '//////#',
    ',': '//////.#/#.',
    '!': '#/#/#/#/#//#',
    '?': '.##./#..#/...#/..#./.#..//.#..',
    '\'': '#/#',
    '"': '#.#/#.#',
    '-': '///###',
    ':': '///#///#',
    ';': '///.#///.#/#.',
    '%': '##..#/##.#./...#./..#../.#.../.#.##/#..##',
    '(': '.#/#./#./#./#./#./.#',
    ')': '#./.#/.#/.#/.#/.#/#.',
    '/': '..#/..#/.#./.#./.#./#../#..',
    '\u00b7': '///#',
    '\u2026': '//////#.#.#',
    '+': '//.#./###/.#.',
    '<': '/..#/.#./#../.#./..#',
    '>': '/#../.#./..#/.#./#..',
    '=': '//###//###',
    '#': '/.#.#./#####/.#.#./#####/.#.#.',
    '*': '/#.#/.#./#.#',
    // extras beyond the spec list
    '_': '//////####',
    '&': '.#../#.#./#.#./.#../#.#.#/#..#./.##.#',
    '[': '##/#./#./#./#./#./##',
    ']': '##/.#/.#/.#/.#/.#/##',
    '|': '#/#/#/#/#/#/#',
    '\\': '#../#../.#./.#./.#./..#/..#',
    '\u2014': '///#####',
    '\u2665': '/.#.#./#####/#####/.###./..#..',
    '\u2192': '//..#../...#./#####/...#./..#..'
  };
  // Typographic characters writers tend to paste, mapped to glyphs we have.
  var ALIAS = { '\u2019': '\'', '\u2018': '\'', '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u00a0': ' ', '\t': ' ', '\u00d7': 'x' };

  var idxOf = {};          // charCode -> glyph index
  var gW = [];             // glyph widths
  var gRows = [];          // glyph row bitmasks (bit 0 = leftmost column)
  var Q = 0, SPACE = 0;

  (function parse() {
    var ch, rows, w, r, c, bits, list, n = 0;
    for (ch in G) {
      rows = G[ch].split('/'); w = 0; list = [];
      for (r = 0; r < rows.length; r++) if (rows[r].length > w) w = rows[r].length;
      for (r = 0; r < CELL_H; r++) {
        bits = 0;
        if (rows[r]) for (c = 0; c < rows[r].length; c++) if (rows[r].charAt(c) === '#') bits |= 1 << c;
        list.push(bits);
      }
      idxOf[ch.charCodeAt(0)] = n; gW[n] = w; gRows[n] = list; n++;
    }
    for (ch in ALIAS) idxOf[ch.charCodeAt(0)] = idxOf[ALIAS[ch].charCodeAt(0)];
    Q = idxOf[63]; SPACE = idxOf[32];
  })();

  function gi(code) { var i = idxOf[code]; return i === undefined ? Q : i; }

  // Width in px of text[a..b) at scale 1 (single line).
  function span(text, a, b) {
    var w = 0, i;
    for (i = a; i < b; i++) w += gW[gi(text.charCodeAt(i))] + 1;
    return w > 0 ? w - 1 : 0;
  }

  function width(text, scale) {
    text = typeof text === 'string' ? text : String(text);
    var best = 0, a = 0, b, w;
    for (;;) {
      b = text.indexOf('\n', a); if (b < 0) b = text.length;
      w = span(text, a, b); if (w > best) best = w;
      if (b >= text.length) break;
      a = b + 1;
    }
    return best * (scale || 1);
  }

  var atlases = {};
  function atlas(pal, scale) {
    var key = pal * 16 + scale, cv = atlases[key];
    if (cv) return cv;
    var n = gW.length, i, r, c, rows, ox, oy, x;
    cv = document.createElement('canvas');
    cv.width = COLS * CELL_W * scale;
    cv.height = Math.ceil(n / COLS) * CELL_H * scale;
    x = cv.getContext('2d');
    x.fillStyle = R.Pal.hex[pal] || R.Pal.hex[10];
    for (i = 0; i < n; i++) {
      rows = gRows[i]; ox = (i % COLS) * CELL_W; oy = ((i / COLS) | 0) * CELL_H;
      for (r = 0; r < CELL_H; r++) for (c = 0; c < 5; c++) {
        if (rows[r] & (1 << c)) x.fillRect((ox + c) * scale, (oy + r) * scale, scale, scale);
      }
    }
    atlases[key] = cv;
    return cv;
  }

  function run(g, text, x, y, pal, scale, align) {
    var a = atlas(pal, scale), n = text.length, s = 0, e, cx, i, k, w, ch = CELL_H * scale;
    for (;;) {
      e = text.indexOf('\n', s); if (e < 0) e = n;
      cx = x;
      if (align) { w = span(text, s, e) * scale; cx = align === 1 ? x - (w >> 1) : x - w; }
      for (i = s; i < e; i++) {
        k = gi(text.charCodeAt(i)); w = gW[k];
        if (k !== SPACE) g.drawImage(a, (k % COLS) * CELL_W * scale, ((k / COLS) | 0) * ch, w * scale, ch, cx, y, w * scale, ch);
        cx += (w + 1) * scale;
      }
      if (e >= n) break;
      s = e + 1; y += LINE_H * scale;
    }
  }

  // opts: { align:'left'|'center'|'right', scale:int, shadow:palIndex }.  "\n" starts a new line.
  function draw(g, text, x, y, pal, opts) {
    if (typeof text !== 'string') text = String(text);
    var scale = 1, align = 0, shadow = 0;
    if (opts) {
      if (opts.scale > 1) scale = opts.scale | 0;
      if (opts.align === 'center') align = 1; else if (opts.align === 'right') align = 2;
      if (opts.shadow) shadow = opts.shadow;
    }
    x = Math.round(x); y = Math.round(y);
    if (shadow) run(g, text, x + scale, y + scale, shadow, scale, align);
    run(g, text, x, y, pal || 10, scale, align);
  }

  // Word wrap to maxPx (at `scale`, default 1). Overlong words are hard-broken. "\n" forces a break.
  function wrap(text, maxPx, scale) {
    text = typeof text === 'string' ? text : String(text);
    var max = Math.max(5, Math.floor(maxPx / (scale || 1)));
    var out = [], paras = text.split('\n'), p, words, i, w, cur, trial, k;
    for (p = 0; p < paras.length; p++) {
      words = paras[p].split(' '); cur = '';
      for (i = 0; i < words.length; i++) {
        w = words[i];
        if (!w) continue;
        trial = cur ? cur + ' ' + w : w;
        if (span(trial, 0, trial.length) <= max) { cur = trial; continue; }
        if (cur) out.push(cur);
        while (span(w, 0, w.length) > max) {
          k = 1;
          while (k < w.length && span(w, 0, k + 1) <= max) k++;
          out.push(w.slice(0, k)); w = w.slice(k);
        }
        cur = w;
      }
      out.push(cur);
    }
    return out;
  }

  // opts as draw(), plus { lineH:int } to override the line pitch.
  function drawLines(g, lines, x, y, pal, opts) {
    var scale = opts && opts.scale > 1 ? opts.scale | 0 : 1;
    var lh = opts && opts.lineH ? opts.lineH : LINE_H * scale, i;
    for (i = 0; i < lines.length; i++) draw(g, lines[i], x, y + i * lh, pal, opts);
  }

  R.Font = {
    lineH: LINE_H,
    capH: 7,
    draw: draw,
    drawLines: drawLines,
    width: width,
    wrap: wrap,
    has: function (ch) { return idxOf[ch.charCodeAt(0)] !== undefined; }
  };
})(globalThis.RIVAL = globalThis.RIVAL || {});
