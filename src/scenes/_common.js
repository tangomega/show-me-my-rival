// SHOW ME MY RIVAL — R.SceneKit: helpers shared by every menu scene.
// ("_common" sorts before the other scene files, so it is loaded first.)
//   layout()            -> { top, bottom, h } from E.safe (one reused object)
//   Button / press / release   rect + label + pressed state, drawn with R.UI.button
//   typer(maxW, maxLines)      typewriter line / bubble text
//   scroll()                   vertical drag-to-scroll with inertia and clamped bounds
//   boonInfo / unlockInfo / card / icon / detail   boon + unlock cards
//   reel(unlocks)              the "UNLOCKED" card carousel on the death and victory screens
//   dither, ramp, wrap, fill, ui, taunt, sfx, music, hex, topBar
(function (R) {
  'use strict';

  var RAR_COL = { common: 7, uncommon: 25, rare: 30 };
  var TYPE_LABEL = { boon: 'BOON', relic: 'RELIC', mask: 'MASK', arena: 'ARENA', vigil: 'LIGHT' };
  var TYPE_COL = { boon: 21, relic: 30, mask: 11, arena: 28, vigil: 22 };
  var ARENA_SWATCH = { cathedral: [26, 28], blood_moon: [16, 18], pale_dawn: [7, 22] };
  var BAYER = [0, 2, 3, 1];
  var RAMP = [3, 5, 7, 8];                        // fade-in ramp for text on black (then the real colour)

  var L = { top: 0, bottom: 320, h: 320 };

  var K = {
    C: { align: 'center' },
    CS: { align: 'center', shadow: 1 },
    RT: { align: 'right' },
    RS: { align: 'right', shadow: 1 },
    LS: { shadow: 1 },
    C2: { align: 'center', scale: 2 },
    C2S: { align: 'center', scale: 2, shadow: 1 },
    RAR_COL: RAR_COL
  };

  function hex(i) { return R.Pal.hex[i]; }
  function sfx(n, o) { if (R.Audio && R.Audio.sfx) R.Audio.sfx(n, o); }
  function music(n, f) { if (R.Audio && R.Audio.music) R.Audio.music(n, f); }
  function ui(k, d) { var u = R.Text && R.Text.ui; return (u && typeof u[k] === 'string' && u[k]) || d; }

  // Template fill that never returns null: unknown variables are dropped.
  function fill(tpl, vars) {
    var s = null;
    if (R.Text && R.Text.fill) { try { s = R.Text.fill(tpl, vars); } catch (e) { s = null; } }
    if (typeof s === 'string' && s) return s;
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) {
      return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '';
    });
  }

  // One Rival line. Always the cosmetic rng, never the gameplay stream.
  function taunt(cat, extra) {
    var G = R.Game;
    if (!R.Text || !R.Text.taunt) return null;
    var v = G && G.vars ? G.vars(extra) : (extra || {});
    try { return R.Text.taunt(cat, v, G ? G.crng : null); } catch (e) { return null; }
  }

  function wrap(text, maxPx, maxLines) {
    if (text === null || text === undefined || text === '') return [];
    var ls = R.Font.wrap(String(text), maxPx);
    if (maxLines && ls.length > maxLines) ls.length = maxLines;
    return ls;
  }

  K.hex = hex; K.sfx = sfx; K.music = music; K.ui = ui; K.fill = fill; K.taunt = taunt; K.wrap = wrap;

  // ------------------------------------------------------------------ layout
  K.layout = function () {
    var E = R.Engine;
    L.top = E.safe.top | 0;
    L.bottom = E.H - (E.safe.bottom | 0);
    L.h = L.bottom - L.top;
    return L;
  };

  // Menu chrome: a title strip under the safe inset. `right` is an optional right-aligned note.
  K.topBar = function (g, title, right) {
    g.fillStyle = hex(2); g.fillRect(0, 0, 180, L.top + 18);
    g.fillStyle = hex(5); g.fillRect(0, L.top + 18, 180, 1);
    R.Font.draw(g, title, right ? 6 : 90, L.top + 6, 21, right ? null : K.C);
    if (right) R.Font.draw(g, right, 174, L.top + 6, 7, K.RT);
  };

  // Text colour for a fade-in on black: k = 0..1.
  K.ramp = function (k, col) {
    if (k >= 1) return col;
    var i = Math.floor((k < 0 ? 0 : k) * 5);
    return i >= RAMP.length ? col : RAMP[i];
  };

  // Ordered dither cover. level 0 = solid cover ... 4 = nothing drawn; `cell` = dither pixel size.
  K.dither = function (g, x, y, w, h, level, cell, pal) {
    var cx, cy, i, j, cw, chh;
    if (level >= 4) return;
    g.fillStyle = hex(pal || 1);
    if (level <= 0) { g.fillRect(x, y, w, h); return; }
    cell = cell > 0 ? cell : 1;
    for (j = 0, cy = y; cy < y + h; j++, cy += cell) {
      chh = cy + cell > y + h ? y + h - cy : cell;
      for (i = 0, cx = x; cx < x + w; i++, cx += cell) {
        if (BAYER[(j & 1) * 2 + (i & 1)] < level) continue;
        cw = cx + cell > x + w ? x + w - cx : cell;
        g.fillRect(cx, cy, cw, chh);
      }
    }
  };

  // ------------------------------------------------------------------ buttons
  function Button(x, y, w, h, label, opts) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.label = label || '';
    this.id = (opts && opts.id) || null;
    this.hidden = false;
    this.st = {
      pressed: false, disabled: !!(opts && opts.disabled), glow: !!(opts && opts.glow),
      accent: (opts && opts.accent) || 0, icon: (opts && opts.icon) || null
    };
  }
  Button.prototype.set = function (x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; return this; };
  // Hit rect is never less than 20 px tall.
  Button.prototype.hit = function (px, py) {
    if (this.hidden) return false;
    var y = this.y, h = this.h;
    if (h < 20) { y -= (20 - h) >> 1; h = 20; }
    return px >= this.x && px < this.x + this.w && py >= y && py < y + h;
  };
  Button.prototype.draw = function (g) {
    if (!this.hidden) R.UI.button(g, this.x, this.y, this.w, this.h, this.label, this.st);
  };
  K.Button = function (x, y, w, h, label, opts) { return new Button(x, y, w, h, label, opts); };

  // down: returns the button that took the press (or null).
  K.press = function (list, px, py) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b.hidden && !b.st.disabled && b.hit(px, py)) { b.st.pressed = true; sfx('tick'); return b; }
    }
    return null;
  };
  // up: clears every pressed state; returns the button that was activated (released inside) or null.
  K.release = function (list, px, py) {
    var got = null;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.st.pressed) {
        b.st.pressed = false;
        if (!b.hidden && !b.st.disabled && b.hit(px, py)) got = b;
      }
    }
    return got;
  };

  // ------------------------------------------------------------------ typewriter
  function Typer(maxW, maxLines) {
    this.maxW = maxW; this.maxLines = maxLines || 3;
    this.lines = []; this.vis = [];
    this.n = 0; this.shown = -1; this.total = 0; this.acc = 0;
    this.active = false; this.done = true; this.sticky = false; this.hold = 0;
    this.w = 0;                                   // px width of the widest full line
    this.blip = true;
  }
  // hold = seconds the finished text stays (ignored when sticky).
  Typer.prototype.set = function (text, hold, sticky) {
    if (!text) { this.clear(); return false; }
    var ls = wrap(text, this.maxW, this.maxLines), i, w;
    this.lines = ls; this.vis.length = 0;
    this.total = 0; this.w = 0;
    for (i = 0; i < ls.length; i++) {
      this.total += ls[i].length;
      w = R.Font.width(ls[i]); if (w > this.w) this.w = w;
    }
    this.n = 0; this.shown = -1; this.acc = 0;
    this.active = true; this.done = false;
    this.sticky = !!sticky; this.hold = hold === undefined || hold === null ? 1.9 : hold;
    return true;
  };
  Typer.prototype.clear = function () { this.active = false; this.done = true; this.vis.length = 0; this.n = 0; this.shown = -1; };
  Typer.prototype.skip = function () { if (this.active && !this.done) { this.n = this.total; this.done = true; } };
  Typer.prototype.release = function (hold) { this.sticky = false; this.hold = hold === undefined ? 1.5 : hold; };
  Typer.prototype.update = function (dt) {
    if (!this.active) return;
    if (!this.done) {
      this.acc += dt;
      while (this.acc >= 0.028 && this.n < this.total) {
        this.acc -= 0.028; this.n++;
        if (this.blip && (this.n & 1) === 0) sfx('type');
      }
      if (this.n >= this.total) this.done = true;
    } else if (!this.sticky) {
      this.hold -= dt;
      if (this.hold <= 0) this.active = false;
    }
  };
  // The lines as typed so far (one reused array; substrings are only cut when a character is added).
  Typer.prototype.view = function () {
    if (this.shown === this.n) return this.vis;
    var left = this.n, i, ln;
    this.vis.length = 0;
    for (i = 0; i < this.lines.length && left > 0; i++) {
      ln = this.lines[i];
      this.vis.push(left >= ln.length ? ln : ln.substring(0, left));
      left -= ln.length;
    }
    this.shown = this.n;
    return this.vis;
  };
  K.typer = function (maxW, maxLines) { return new Typer(maxW, maxLines); };

  // ------------------------------------------------------------------ vertical scroll
  function Scroll() {
    this.y = 0; this.max = 0; this.v = 0;
    this.top = 0; this.h = 0;
    this.drag = false; this.moved = false;
    this.lastY = 0; this.startY = 0; this.prevY = 0;
  }
  Scroll.prototype.setBounds = function (viewTop, viewH, contentH) {
    this.top = viewTop; this.h = viewH;
    this.max = contentH > viewH ? contentH - viewH : 0;
    if (this.y > this.max) this.y = this.max;
    if (this.y < 0) this.y = 0;
  };
  Scroll.prototype.inView = function (px, py) { return py >= this.top && py < this.top + this.h; };
  Scroll.prototype.down = function (px, py) {
    if (!this.inView(px, py)) return false;
    this.drag = true; this.moved = false; this.v = 0;
    this.lastY = this.startY = py; this.prevY = this.y;
    return true;
  };
  Scroll.prototype.move = function (px, py) {
    if (!this.drag) return;
    if (!this.moved && Math.abs(py - this.startY) > 3) this.moved = true;
    if (this.moved) {
      this.y -= py - this.lastY;
      if (this.y < 0) this.y = 0; else if (this.y > this.max) this.y = this.max;
    }
    this.lastY = py;
  };
  // Returns true when the gesture was a drag (so the caller should not treat it as a tap).
  Scroll.prototype.up = function () {
    var was = this.drag && this.moved;
    this.drag = false;
    if (!was) this.v = 0;
    return was;
  };
  Scroll.prototype.update = function (dt) {
    if (dt <= 0) return;
    if (this.drag) {
      var inst = (this.y - this.prevY) / dt;
      this.v = this.v * 0.55 + inst * 0.45;
      this.prevY = this.y;
      return;
    }
    if (this.v !== 0) {
      this.y += this.v * dt;
      this.v *= Math.pow(0.04, dt);
      if (this.y <= 0) { this.y = 0; this.v = 0; }
      else if (this.y >= this.max) { this.y = this.max; this.v = 0; }
      else if (this.v > -5 && this.v < 5) this.v = 0;
    }
  };
  Scroll.prototype.off = function () { return Math.round(this.y); };
  // Thin position bar on the right edge of the view (only when there is something to scroll).
  Scroll.prototype.drawBar = function (g) {
    if (this.max <= 0) return;
    var th = Math.max(10, Math.round(this.h * this.h / (this.h + this.max)));
    var ty = this.top + Math.round((this.h - th) * (this.y / this.max));
    g.fillStyle = hex(3); g.fillRect(177, this.top, 2, this.h);
    g.fillStyle = hex(this.drag ? 25 : 6); g.fillRect(177, ty, 2, th);
  };
  K.scroll = function () { return new Scroll(); };

  // ------------------------------------------------------------------ boon / unlock info (build in enter, never per frame)
  // nameW = px available for the name on a card tile; detailW = px for desc/flavor lines.
  K.boonInfo = function (id, nameW, detailW) {
    var b = R.Boons && R.Boons.byId ? R.Boons.byId[id] : null;
    var t = R.Text && R.Text.boon ? R.Text.boon[id] : null;
    var name = (t && t.name) || (b && b.name) || String(id);
    var rar = b && RAR_COL[b.rarity] ? b.rarity : 'common';
    var tags = b && b.tags ? b.tags : [];
    var relic = !!(b && b.relic);
    var tagLine = relic ? 'RELIC' : rar.toUpperCase();
    for (var i = 0; i < tags.length; i++) tagLine += ' · ' + tags[i];
    return {
      id: id, name: name, desc: b ? b.desc : '', flavor: (t && t.flavor) || '',
      rarity: rar, rarCol: RAR_COL[rar], rarSprite: 'rar_' + rar,
      icon: relic || !tags.length ? 'tag_relic' : 'tag_' + tags[0],
      relic: relic, rival: !!(b && b.who === 'rival'), swatch: null,
      tagLine: tagLine,
      nameLines: wrap(name, nameW || 48, 3),
      descLines: wrap(b ? b.desc : '', detailW || 164, 3),
      flavorLines: wrap((t && t.flavor) || '', detailW || 164, 2)
    };
  };

  // u = an R.Run.UNLOCKS entry (or the plain { id, type, ref, name, how } copy in R.Game.last.unlocks).
  K.unlockInfo = function (u, howW, detailW) {
    var T = R.Text || {}, tu = T.unlock ? T.unlock[u.id] : null, x;
    var o = {
      id: u.id, type: u.type, ref: u.ref, name: u.name || String(u.ref),
      title: (tu && tu.name) || '', how: (tu && tu.how) || u.how || '',
      icon: null, swatch: null, candle: u.type === 'vigil', desc: '', rival: false, rarCol: 25,
      typeLabel: TYPE_LABEL[u.type] || 'ITEM', typeCol: TYPE_COL[u.type] || 10,
      nameLines: null, howLines: null, descLines: null
    };
    if (u.type === 'boon' || u.type === 'relic') {
      x = K.boonInfo(u.ref, 48, detailW || 164);
      o.name = x.name; o.icon = x.icon; o.desc = x.desc; o.rival = x.rival; o.rarCol = x.rarCol;
      if (x.rival) { o.typeLabel = 'ITS BOON'; o.typeCol = 19; }
    } else if (u.type === 'mask') {
      x = T.masks ? T.masks[u.ref] : null;
      if (x && x.name) o.name = x.name;
      o.desc = (x && x.line) || ''; o.icon = 'mask_' + u.ref;
    } else if (u.type === 'arena') {
      x = T.arenas ? T.arenas[u.ref] : null;
      if (x && x.name) o.name = x.name;
      o.desc = (x && x.line) || ''; o.swatch = ARENA_SWATCH[u.ref] || ARENA_SWATCH.cathedral;
    }
    o.nameLines = wrap(o.name, 48, 3);
    o.howLines = wrap(o.how, howW || 138, 2);
    o.descLines = wrap(o.desc, detailW || 164, 3);
    return o;
  };

  // 12x12 icon of a boonInfo / unlockInfo (arenas have no sprite: a two-tone palette swatch).
  K.icon = function (g, o, x, y) {
    if (o.icon) R.Art.sprite(g, o.icon, x, y);
    else if (o.candle) K.candle(g, x + 2, y - 2, 0, R.Engine ? R.Engine.time : 0, 3);
    else if (o.swatch) {
      g.fillStyle = hex(1); g.fillRect(x, y, 12, 12);
      g.fillStyle = hex(o.swatch[0]); g.fillRect(x + 1, y + 1, 10, 10);
      g.fillStyle = hex(o.swatch[1]); g.fillRect(x + 4, y + 3, 4, 4);
      g.fillStyle = hex(1); g.fillRect(x + 1, y + 8, 10, 1);
    }
  };

  // A light of the Vigil: a 7x14 candle with its top-left at (x, y). state 0 = lit, 1 = put out, 2 = locked.
  K.candle = function (g, x, y, state, t, seed) {
    x |= 0; y |= 0;
    var f, lean;
    if (state === 0) {
      f = Math.floor((t || 0) * 7 + (seed || 0) * 1.7) % 4;
      lean = f === 1 ? -1 : f === 3 ? 1 : 0;
      g.fillStyle = hex(21); g.fillRect(x + 3 + lean, y + (f === 2 ? 1 : 0), 1, 2); g.fillRect(x + 2, y + 2, 3, 3);
      g.fillStyle = hex(20); g.fillRect(x + 2, y + 4, 1, 1); g.fillRect(x + 4, y + 4, 1, 1);
      g.fillStyle = hex(22); g.fillRect(x + 3, y + 2, 1, 3);
      g.fillStyle = hex(23); g.fillRect(x + 3, y + 3, 1, 1);
    } else if (state === 1) {                       // a thread of smoke off the dead wick
      f = Math.floor((t || 0) * 3 + (seed || 0)) % 3;
      g.fillStyle = hex(6); g.fillRect(x + 3 + (f === 1 ? 1 : 0), y + 2, 1, 1); g.fillRect(x + 3 - (f === 2 ? 1 : 0), y, 1, 1);
      g.fillStyle = hex(14); g.fillRect(x + 3, y + 4, 1, 1);
    }
    g.fillStyle = hex(1); g.fillRect(x + 3, y + 5, 1, 1);
    g.fillStyle = hex(state === 0 ? 11 : state === 1 ? 7 : 5); g.fillRect(x + 2, y + 6, 3, 6);
    g.fillStyle = hex(state === 0 ? 10 : state === 1 ? 8 : 6); g.fillRect(x + 2, y + 6, 1, 6);
    g.fillStyle = hex(state === 0 ? 12 : state === 1 ? 6 : 4); g.fillRect(x + 4, y + 7, 1, 5);
    g.fillStyle = hex(state === 2 ? 5 : 24); g.fillRect(x + 1, y + 12, 5, 1);
    g.fillStyle = hex(state === 2 ? 4 : 25); g.fillRect(x, y + 13, 7, 1);
  };

  // Text for light k (1..7) of the Vigil: { k, id, name, rule } with the numbers filled in.
  K.light = function (k) {
    var V = (R.Run && R.Run.VIGIL) || [], v = V[k - 1], T = (R.Text && R.Text.vigil) || {}, t = v && T.lights ? T.lights[v.id] : null;
    if (!v) return null;
    var tune = R.Run.VIGIL_TUNE || {};
    var vars = { heal: R.Run.HEAL - (tune.healCut || 0), base: R.Run.HEAL, hp: tune.hp || 1 };
    return { k: k, id: v.id, name: (t && t.name) || v.name, rule: fill((t && t.rule) || '', vars), line: (t && t.line) || '' };
  };
  // "3 DARK" / "LIGHTLESS" / "" for a stake.
  K.vigilLabel = function (stake) {
    var T = (R.Text && R.Text.vigil) || {}, n = (R.Run.VIGIL || []).length;
    if (!(stake > 0)) return '';
    return stake >= n ? (T.lightless || 'LIGHTLESS') : fill(T.dark || '{n} DARK', { n: stake });
  };

  // Boon card. Tall tiles (h >= 30): icon + rarity pips on top, name centred below (up to 3 lines).
  // Wide tiles (h < 30): icon left, name to its right (up to 2 lines).
  // st: { sel:bool, dim:bool, pressed:bool, label:string (drawn instead of info, e.g. "NONE") }
  K.card = function (g, x, y, w, h, info, st) {
    x |= 0; y |= 0;
    var sel = !!(st && st.sel), dim = !!(st && st.dim), i, n, ty, ink;
    var E = R.Engine, on = sel && (Math.floor((E ? E.time : 0) * 3) & 1) === 0;
    var frame = dim ? 5 : (info ? info.rarCol : 7);
    if (st && st.pressed) y += 1;
    g.fillStyle = hex(1); g.fillRect(x + 1, y, w - 2, h); g.fillRect(x, y + 1, w, h - 2);
    g.fillStyle = hex(on ? 23 : frame); g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = hex(dim ? 2 : 3); g.fillRect(x + 3, y + 3, w - 6, h - 6);
    g.fillStyle = hex(dim ? 3 : (sel ? 5 : 4)); g.fillRect(x + 3, y + 3, w - 6, 1);
    ink = dim ? 6 : 10;
    if (!info) {
      if (st && st.label) R.Font.draw(g, st.label, x + (w >> 1), y + ((h - 7) >> 1), ink, K.C);
      return;
    }
    n = info.nameLines.length;
    if (h >= 30) {
      K.icon(g, info, x + 5, y + 4);
      R.Art.sprite(g, info.rarSprite, x + w - 16, y + 8);
      ty = y + (n >= 3 ? 16 : n === 2 ? 20 : 24);
      for (i = 0; i < n; i++) R.Font.draw(g, info.nameLines[i], x + (w >> 1), ty + i * 9, ink, K.C);
    } else {
      K.icon(g, info, x + 4, y + ((h - 12) >> 1) - 1);
      if (n > 2) n = 2;
      ty = y + ((h - (n * 9 - 2)) >> 1);
      for (i = 0; i < n; i++) R.Font.draw(g, info.nameLines[i], x + 20, ty + i * 9, ink);
      R.Art.sprite(g, info.rarSprite, x + w - 15, y + h - 6);
    }
  };

  // Detail panel body for a boonInfo: name, kind note, rarity + tags, exact desc, flavor.
  // Draws inside (x, y, w); the caller draws the panel. Returns nothing; needs about 62 px of height.
  K.detail = function (g, x, y, w, info, note, noteCol) {
    var i, ty = y;
    R.Font.draw(g, info.name, x, ty, info.rival ? 19 : 10);
    if (note) R.Font.draw(g, note, x + w, ty, noteCol || 7, K.RT);
    ty += 9;
    R.Font.draw(g, info.tagLine, x, ty, info.rarCol);
    R.Art.sprite(g, info.rarSprite, x + w - 11, ty + 2);
    ty += 10;
    for (i = 0; i < info.descLines.length; i++) { R.Font.draw(g, info.descLines[i], x, ty, 10); ty += 9; }
    ty += 2;
    for (i = 0; i < info.flavorLines.length; i++) { R.Font.draw(g, info.flavorLines[i], x, ty, 12); ty += 9; }
  };

  // ------------------------------------------------------------------ unlock reel (death / victory)
  function Reel(unlocks) {
    var i;
    this.items = [];
    for (i = 0; unlocks && i < unlocks.length && i < 12; i++) this.items.push(K.unlockInfo(unlocks[i], 138));
    this.n = this.items.length;
    this.shown = 0; this.cur = -1; this.flip = 9; this.cycle = 0;
    this.header = '';
    this.h = this.n ? 62 : 0;
    this.title = ui('unlocked', 'UNLOCKED');
  }
  Reel.prototype.label = function () { this.header = this.n > 1 ? this.title + ' ' + (this.cur + 1) + '/' + this.n : this.title; };
  // Flip the next card in. Returns false when there is nothing left.
  Reel.prototype.reveal = function (quiet) {
    if (this.shown >= this.n) return false;
    this.cur = this.shown; this.shown++;
    this.flip = 0; this.cycle = 0; this.label();
    if (!quiet) { sfx('unlock'); if (R.Engine) R.Engine.buzz([10, 30, 10]); }
    return true;
  };
  Reel.prototype.revealAll = function () {
    if (this.shown >= this.n) return;
    this.shown = this.n;
    if (this.cur < 0) this.cur = 0;
    this.flip = 0; this.cycle = 0; this.label();
    sfx('unlock');
  };
  Reel.prototype.update = function (dt) {
    if (!this.n || this.shown === 0) return;
    this.flip += dt;
    if (this.shown >= this.n && this.n > 1) {      // everything revealed: keep cycling so each can be read
      this.cycle += dt;
      if (this.cycle >= 2.8) { this.cycle = 0; this.cur = (this.cur + 1) % this.n; this.flip = 0; this.label(); }
    }
  };
  Reel.prototype.draw = function (g, x, y) {
    if (!this.n || this.shown === 0) return;
    var it = this.items[this.cur], H = 36, cy = y + 10, k, hh, i, cx;
    R.Font.draw(g, this.header, x + 86, y, 21, K.C);
    k = this.flip < 0.2 ? Math.floor(this.flip / 0.05) : 4;
    if (k < 4) {                                    // the flip: a bright sliver opening to full height
      hh = Math.max(2, (H * (k + 1) / 5) | 0);
      g.fillStyle = hex(1); g.fillRect(x, cy + ((H - hh) >> 1), 172, hh);
      g.fillStyle = hex(k < 2 ? 23 : 22); g.fillRect(x + 1, cy + ((H - hh) >> 1) + 1, 170, hh - 2);
    } else {
      R.UI.panel(g, x, cy, 172, H, 'card');
      K.icon(g, it, x + 7, cy + (it.type === 'mask' ? 6 : 7));
      R.Font.draw(g, it.name, x + 26, cy + 5, 10);
      R.Font.draw(g, it.typeLabel, x + 166, cy + 5, it.typeCol, K.RT);
      for (i = 0; i < it.howLines.length; i++) R.Font.draw(g, it.howLines[i], x + 26, cy + 15 + i * 9, 8);
    }
    if (this.n > 1) {
      cx = x + 86 - ((this.n * 8 - 3) >> 1);
      for (i = 0; i < this.n; i++) {
        g.fillStyle = hex(i === this.cur ? 22 : i < this.shown ? 25 : 5);
        g.fillRect(cx + i * 8, y + 10 + H + 5, 5, 3);
      }
    }
  };
  K.reel = function (unlocks) { return new Reel(unlocks); };

  R.SceneKit = K;
})(globalThis.RIVAL = globalThis.RIVAL || {});
