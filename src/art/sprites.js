// SHOW ME MY RIVAL — fighter sprites (DESIGN 13.2 / 13.3). Everything is palette-indexed pixel data.
//
// How it is built:
//   part   = a small indexed image (R.Pix.parse rows) with a home position inside the 48x48 frame
//   pose   = an explicit set of slots, each { variant, dx, dy } (see ORDER for the layer order), plus optional
//            per-frame extras: under / over (extra body parts), fx (drawn after the outline: arcs, glints)
//   frame  = pose composited into a 48x48 image (48x56 for rival2), feet-centre anchor at x = 24, y = bottom row,
//            then a selective 1-px void outline (broken on candle-lit edges), then the fx layer
// Only R.Art.fighter() touches canvas; R.Art.frameImg() is pure so tools/render_fighters.js can render from Node.
// Fighters are authored facing RIGHT; the candle (arena centre) is therefore on their right.
//
// Pixel rows: '.' = transparent, '1'-'9' = palette 1-9, 'a'-'v' = palette 10-31
//   1 void  2 crypt  4 slate  5 cold stone  6 worn stone  7 ash blue  8 pale ash  9 steel
//   a bone white  b bone  c parchment  d dust brown  e umber  f char  g dried blood  h wine  i blood red  j fresh red
//   n white-hot  o brass dark  p brass  s moon blue  t bruise violet  u feint violet  v witchfire
(function (R) {
  'use strict';

  var Pix = R.Pix;
  var FW = 48, FH = 48, FH2 = 56, AX = 24, HOVER = 3;

  // ---- animation tables (frame counts / durations: DESIGN 13.3) -------------------------------
  function rep(n, ms) { var a = []; while (n--) a.push(ms); return a; }
  // extras (not in the contract): loopFrom = first frame of the looping tail, tail = its length in ms, contact = contact frame
  function A(dur, loop, loopFrom, contact) {
    var t = 0, tail = 0, i;
    for (i = 0; i < dur.length; i++) { t += dur[i]; if (loopFrom && i >= loopFrom) tail += dur[i]; }
    return { n: dur.length, dur: dur, loop: !!loop, total: t, loopFrom: loopFrom || 0, tail: tail, contact: contact === undefined ? -1 : contact, im: [], cv: [] };
  }
  function table(who) {
    var rv = who !== 'player', r2 = who === 'rival2';
    var t = {
      idle: A(r2 ? rep(6, 160) : rep(4, rv ? 260 : 220), true),
      tell_S: A([80, 80, 120, 380, 380], true, 3),
      tell_G: A([80, 80, 120, 380, 380], true, 3),
      tell_F: A([80, 80, 120, 380, 380], true, 3),
      strike: A([70, 70, 60, 80, 100], false, 0, 3),
      guard: A([80, 120, 120, 60], false, 0, 2),
      feint: A([50, 50, 50, 50, 80, 100], false, 0, 4),
      hit: A([50, 90, 110]),
      stagger: A([60, 80, 120, 120, 120, 300, 300], true, 5),
      clash: A([50, 70, 100, 100]),
      death: A(r2 ? rep(11, 90).concat([400]) : rv ? [80, 80, 100, 120, 120, 160, 300] : [80, 80, 100, 120, 140, 160, 200, 400]),
      taunt: A(rv ? rep(12, 110) : rep(4, 120)),
      taunt2: A(rv ? [100, 100, 140, 100, 160] : rep(4, 120)),
      victory: A([120, 120, 160, 160, 200, 400])
    };
    if (who === 'rival') t.transform = A(rep(10, 100));
    return t;
  }
  var ANIMS = { player: table('player'), rival: table('rival'), rival2: table('rival2') };

  function anim(who, name) { var t = ANIMS[who]; return (t && t[name]) || null; }

  // Clamps to the last frame once ms >= total (the contract: scenes do their own modulo for loops).
  function frameAt(a, ms) {
    if (!a) return 0;
    var d = a.dur, n = a.n, i;
    if (!(ms > 0)) return 0;
    for (i = 0; i < n; i++) { if (ms < d[i]) return i; ms -= d[i]; }
    return n - 1;
  }

  // ---- part library helpers -------------------------------------------------------------------
  var PART = {};
  // D: part with a home position (top-left, in 48x48 frame coordinates of the standing pose); pose dx,dy are offsets.
  function D(name, x, y, rows) { PART[name] = { img: Pix.parse(rows), x: x, y: y }; }
  // DA: anchored part (arms pivot at the shoulder, swords at the grip, fx at their centre); pose dx,dy = where the anchor goes.
  function DA(name, ax, ay, rows) { D(name, -ax, -ay, rows); }
  function flipY(img) {
    var o = Pix.make(img.w, img.h), x, y;
    for (y = 0; y < img.h; y++) for (x = 0; x < img.w; x++) o.d[(img.h - 1 - y) * img.w + x] = img.d[y * img.w + x];
    return o;
  }
  // mirrored copies of anchored parts (a blade pointing the other way)
  function DFX(name, src) { var s = PART[src]; PART[name] = { img: Pix.flipX(s.img), x: -(s.img.w - 1 + s.x), y: s.y }; }
  function DFY(name, src) { var s = PART[src]; PART[name] = { img: flipY(s.img), x: s.x, y: -(s.img.h - 1 + s.y) }; }
  // leaning copy: one explicit x shift per row (a digit per row, top to bottom), sign = +1 forward / -1 back
  function DS(name, src, sign, digits) {
    var s = PART[src], w = s.img.w, h = s.img.h, mx = 0, r, c, v, o, k;
    for (r = 0; r < h; r++) { v = +(digits[r] || 0); if (v > mx) mx = v; }
    o = Pix.make(w + mx, h);
    for (r = 0; r < h; r++) {
      k = +(digits[r] || 0); k = sign > 0 ? k : mx - k;
      for (c = 0; c < w; c++) { v = s.img.d[r * w + c]; if (v) o.d[r * o.w + c + k] = v; }
    }
    PART[name] = { img: o, x: s.x - (sign > 0 ? 0 : mx), y: s.y };
  }

  // ---- shared fx parts (drawn after the outline pass, never outlined) --------------------------
  DA('fx.glS1', 2, 2, ['..j..', '..n..', 'jnnnj', '..n..', '..j..']);
  DA('fx.glS2', 1, 1, ['.j.', 'jnj', '.j.']);
  DA('fx.glG1', 2, 2, ['..s..', '..n..', 'snnns', '..n..', '..s..']);
  DA('fx.glG2', 1, 1, ['.s.', 'sns', '.s.']);
  DA('fx.glF1', 2, 2, ['..u..', '..n..', 'unnnu', '..n..', '..u..']);
  DA('fx.glF2', 1, 1, ['.u.', 'unu', '.u.']);

  // ---- compositor -----------------------------------------------------------------------------
  // layer order, back to front
  var ORDER = ['swB', 'offB', 'cape', 'hem', 'legs', 'torso', 'head', 'capeF', 'offM', 'sw', 'arm', 'offF'];
  var FAMILY = { swB: 'sw', sw: 'sw', offB: 'off', offM: 'off', offF: 'off', cape: 'cape', hem: 'cape', capeF: 'cape',
                 legs: 'legs', torso: 'torso', head: 'head', arm: 'arm' };
  // colours whose edge counts as "lit": the outline is left open on their candle side (right) and top
  var LIT = []; [8, 9, 10, 11, 12, 18, 22, 23, 25].forEach(function (c) { LIT[c] = 1; });

  function put(img, name, x, y) { var p = PART[name]; if (p) Pix.blit(img, p.img, p.x + x, p.y + y); }
  function putList(img, list, ox, oy) {
    if (!list) return;
    for (var i = 0; i < list.length; i++) put(img, list[i][0], (list[i][1] || 0) + ox, (list[i][2] || 0) + oy);
  }
  function outline(img) {
    var w = img.w, h = img.h, s = img.d, o = new Uint8Array(s), x, y, l, r, u, d;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (s[y * w + x]) continue;
      l = x > 0 ? s[y * w + x - 1] : 0; r = x < w - 1 ? s[y * w + x + 1] : 0;
      u = y > 0 ? s[(y - 1) * w + x] : 0; d = y < h - 1 ? s[(y + 1) * w + x] : 0;
      if (r || u || (l && !LIT[l]) || (d && !LIT[d])) o[y * w + x] = 1;
    }
    img.d = o;
    return img;
  }

  var MASKS = ['porcelain', 'mourner', 'jester', 'kintsugi', 'blank'], MASK_IX = { porcelain: 0, mourner: 1, jester: 2, kintsugi: 3, blank: 4 };
  var FACE = {}, HEADS = {}, HEADC = {}, SWAP = null;   // filled in by the Rival section

  function headPart(variant, mask, r2) {
    var key = variant + '|' + mask + (r2 ? '|2' : ''), hd, b, img, f, r, c, v, pass;
    if (HEADC[key]) return HEADC[key];
    hd = HEADS[variant] || HEADS.level; b = PART[hd.b];
    img = Pix.clone(b.img);
    for (pass = 0; pass < (r2 ? 2 : 1); pass++) {
      f = pass ? FACE.shatter : (FACE[mask] || FACE.porcelain);
      for (r = 0; r < f.h; r++) for (c = 0; c < f.w; c++) {
        v = f.d[r * f.w + c];
        if (v) Pix.set(img, hd.fx - b.x + hd.sh[r] + c, hd.fy - b.y + r, v);
      }
    }
    return (HEADC[key] = { img: img, x: b.x, y: b.y });
  }

  // S = pose (see the header). Returns a fresh FW x H indexed image.
  function compose(who, S, mask) {
    var r2 = who === 'rival2', pre = who === 'player' ? 'p.' : 'r.', H = r2 ? FH2 : FH;
    var img = Pix.make(FW, H), ox = S.dx || 0, oy = H - FH + (S.dy || 0) - (r2 ? HOVER : 0), i, slot, e, p, name;
    if (S.none) return img;
    putList(img, S.under, ox, oy);
    for (i = 0; i < ORDER.length; i++) {
      slot = ORDER[i]; e = S[slot];
      if (!e) continue;
      if (slot === 'head' && who !== 'player') p = headPart(e[0], mask || 'porcelain', r2 && !S.whole);
      else {
        name = pre + FAMILY[slot] + '.' + e[0];
        if (r2 && SWAP) { p = SWAP(img, slot, e, ox, oy, S); if (p === true) continue; }
        p = PART[name];
      }
      if (p) Pix.blit(img, p.img, p.x + (e[1] || 0) + ox, p.y + (e[2] || 0) + oy);
    }
    putList(img, S.over, ox, oy);
    if (S.cut) dissolve(img, S.cut + H - FH);
    outline(img);
    putList(img, S.fx, ox, oy);
    if (S.ash) putList(img, S.ash, 0, H - FH);
    if (S.white) img = Pix.solid(img, 23);
    return img;
  }

  // top-down dissolve: everything above row `cut` is gone, the 6 rows below it are eaten in an ordered pattern
  var EAT = [5, 1, 4, 0, 3, 2, 5, 0, 3, 1, 4, 2];
  function dissolve(img, cut) {
    var x, y, k;
    for (y = 0; y < img.h && y < cut + 6; y++) for (x = 0; x < img.w; x++) {
      if (y < cut) { img.d[y * img.w + x] = 0; continue; }
      k = y - cut;                                         // 0 = most eaten
      if (EAT[(x * 5 + y * 3) % 12] >= k) img.d[y * img.w + x] = 0;
    }
  }

  // pose helper: copy of base with some slots replaced
  function mod(base, o) { var r = {}, k; for (k in base) r[k] = base[k]; for (k in o) r[k] = o[k]; return r; }

  var FR = { player: {}, rival: {}, rival2: {} };          // FR[who][anim] = [pose per frame]

  // =============================================================================================
  // THE ASHEN (player) — ~30 px, hunched. Umber cloak 2/f/e/d, bone bandages c/b, steel 7/8/9.
  // =============================================================================================

  // ---- legs (wrapped shins, bare feet) ----
  D('p.legs.stand', 18, 37, [
    '...fff..eee.',
    '...fff..eee.',
    '...ffe..eed.',
    '..dcc...cbb.',
    '..dcc...cbb.',
    '..ddc...dcb.',
    '..dcc...cbb.',
    '..dcc...cbb.',
    '..ddc...dcb.',
    '..ddd...ddc.',
    '.dddd...dddc']);
  D('p.legs.step', 18, 37, [
    '...fff.eee.......',
    '...fff..eee......',
    '...ffe..eeed.....',
    '..dcc....cbb.....',
    '..dcc.....cbb....',
    '..ddc.....dcb....',
    '..dcc......cbb...',
    '..dcc......cbb...',
    '..ddc.......dcb..',
    '..ddd.......ddcc.',
    '.dddd.......ddddc']);
  D('p.legs.narrow', 20, 37, [
    '..fffeee.',
    '..fffeee.',
    '..ffeeed.',
    '..dcccbb.',
    '..dcccbb.',
    '..ddcdcb.',
    '..dcccbb.',
    '..dcccbb.',
    '..ddcdcb.',
    '..ddddcc.',
    '.dddddddc']);
  D('p.legs.crouch', 13, 39, [
    '........fffeeee........',
    '......ffffeeeeeee......',
    '....ffff.....eeeeed....',
    '...dcc.........cbb.....',
    '...dcc.........cbb.....',
    '..ddc..........dcb.....',
    '..dcc..........cbb.....',
    '..ddd..........ddcc....',
    '.dddd..........ddddc...']);

  // ---- torso (leather jerkin, belt) ----
  D('p.torso.up', 19, 26, [
    '...eeeee...',
    '..eeeeedd..',
    '.feeeeddd..',
    '.feeedddd..',
    '.feeedddd..',
    '.ffeeddde..',
    '.ffeeedde..',
    '..feeedde..',
    '..feeedde..',
    '..fffffff..',
    '..feeedde..',
    '..feeeddee.',
    '..feeeddde.',
    '..f.ee.dd..']);
  DS('p.torso.back', 'p.torso.up', -1, '22221111000000');
  DS('p.torso.fwd', 'p.torso.up', 1, '33332221110000');

  // ---- cloak ----
  D('p.cape.top', 14, 25, [
    '.....2fff.',
    '....2fffff',
    '...22fffff',
    '...2ffefff',
    '..22ffefff',
    '..2fffeff.',
    '..2ffeeff.',
    '.22ffefff.',
    '.2fffefff.']);
  D('p.cape.hem', 12, 34, [
    '..22ffefffe.',
    '..2fffeffff.',
    '.22fff2efff.',
    '.2fff22efff.',
    '.2fff.2eff2.',
    '22ff..2ff.2.',
    '2ff...2ef...',
    '2f....2f....',
    '2.....2.....']);
  D('p.cape.flare', 5, 27, [
    '.............2ffff...',
    '.........222ffffeff..',
    '.....222ffffffefffff.',
    '..22fffffffeeffffffff',
    '22ffffffffefffffffff.',
    '2ff22fffffffffffffff.',
    '.2...2fff22fffffff...',
    '......2f...2fffff....',
    '............2ff......']);
  D('p.cape.wrap', 18, 25, [
    '...feeee...',
    '..feeeeeed.',
    '.ffeeeeeed.',
    '.feeeeefed.',
    '.feeeeefed.',
    '.feeeeefed.',
    '.feeeeefed.',
    '.feeeeefed.',
    '.feeeeefee.',
    '.feeeefeee.',
    '.feeeefeee.',
    '.ffeeefeee.',
    '.ffeeefeed.',
    '..feeffee..',
    '..fee.fee..',
    '..fe..fe...',
    '..f...f....']);

  // ---- head (hood, void face, one chin glint) ----
  D('p.head.level', 21, 18, [
    '....feee...',
    '...feeeee..',
    '..feeeeeed.',
    '..feee111d.',
    '.ffee11111.',
    '.ffee1111..',
    '.ffeee118..',
    '..ffeee1...',
    '..fffeed...',
    '...ffee....']);

  // ---- sword arm (bandaged; anchor = shoulder) ----
  DA('p.arm.low', 1, 0, [
    '.bb...',
    'cbb...',
    'cbb...',
    'ccb...',
    '.cbb..',
    '.ccbb.',
    '..ccbb',
    '...cdd']);
  DA('p.arm.up', 3, 12, [
    '.dd...',
    '.bb...',
    '.bbc..',
    '.cbb..',
    '..bb..',
    '..bbc.',
    '..cbb.',
    '..cbb.',
    '...bb.',
    '...bbc',
    '...cbb',
    '...cbb',
    '....bb',
    '....c.']);
  DA('p.arm.guard', 1, 0, [
    '.bb.....',
    'cbb.....',
    'cbb.....',
    'cbbbbbbd',
    '.cccbbdd']);
  DA('p.arm.back', 10, 0, [
    '.......bbbbb',
    '...cbbbbcccc',
    '.dbbbccc....',
    '.ddc........']);

  // ---- sword (notched straight sword; anchor = grip) ----
  DA('p.sw.dn45', 1, 1, [
    'd............',
    '.d.7.........',
    '..6..........',
    '.6.9.........',
    '...89........',
    '....89.......',
    '.....89......',
    '......89.....',
    '.......89....',
    '........8....',
    '.........89..',
    '..........89.',
    '...........89',
    '............8']);
  DA('p.sw.dn2', 1, 1, [
    '..7..............',
    'dd699............',
    '..68899..........',
    '.....8899........',
    '.......88.9......',
    '.........8899....',
    '...........8899..',
    '.............889.']);
  DFX('p.sw.bkdn', 'p.sw.dn2');
  DA('p.sw.upb', 7, 14, [
    '9.......',
    '89......',
    '89......',
    '.89.....',
    '.89.....',
    '..8.....',
    '..89....',
    '...89...',
    '...89...',
    '....89..',
    '....89..',
    '.....89.',
    '.....89.',
    '....7667',
    '.......d',
    '.......d']);
  DA('p.sw.up', 1, 14, [
    '.9..',
    '.89.',
    '.89.',
    '.89.',
    '.8..',
    '.89.',
    '.89.',
    '.89.',
    '.89.',
    '.89.',
    '.89.',
    '.89.',
    '.89.',
    '7667',
    '.dd.',
    '.d..']);

  // ---- off arm (far arm: dark sleeve, bandaged hand) ----
  DA('p.off.brace', 0, 0, [
    'ecb',
    'fcc']);
  DA('p.off.palm', 0, 2, [
    '.........b.',
    '........bb.',
    'eeeeeecbbb.',
    'ffffffcbb..',
    '........b..']);

  // ---- poses ----
  var P0 = { cape: ['top'], hem: ['hem'], legs: ['stand'], torso: ['up'], head: ['level'], sw: ['dn45', 29, 35], arm: ['low', 25, 28] };
  var P1 = mod(P0, { cape: ['top', 0, 1], hem: ['hem', -1, 0], torso: ['up', 0, 1], head: ['level', 0, 1], arm: ['low', 25, 29] });
  var P2 = mod(P1, { hem: ['hem', -1, 1] });
  var P3 = mod(P0, { hem: ['hem', 0, 1] });
  FR.player.idle = [P0, P1, P2, P3];

  var PS = { swB: ['upb', 22, 15], cape: ['top', -2, 0], hem: ['hem', -1, 0], legs: ['step'], torso: ['back'], head: ['level', -2, -1], arm: ['up', 23, 27] };
  var PG = { legs: ['narrow'], torso: ['up'], head: ['level'], capeF: ['wrap'], offM: ['brace', 29, 24], sw: ['up', 31, 31], arm: ['guard', 25, 28] };
  var PF = { swB: ['bkdn', 19, 37], offB: ['palm', 30, 33], cape: ['flare'], legs: ['crouch'], torso: ['fwd', 0, 6], head: ['level', 5, 7], arm: ['back', 28, 34] };
  FR.player.tell_S = [
    mod(P0, { sw: ['up', 31, 30], arm: ['guard', 25, 28] }),
    mod(PS, { swB: ['upb', 24, 16], arm: ['up', 25, 28], torso: ['up'], head: ['level'], cape: ['top'] }),
    mod(PS, { dx: -1, dy: -1 }),
    mod(PS, { fx: [['fx.glS1', 16, 3]] }),
    mod(PS, { fx: [['fx.glS2', 19, 9]] })];
  FR.player.tell_G = [
    mod(P0, { sw: ['up', 31, 33], arm: ['guard', 25, 29] }),
    mod(PG, { capeF: null, cape: ['top'], hem: ['hem', 1, 0], offM: null }),
    mod(PG, { dy: -1 }),
    mod(PG, { fx: [['fx.glG1', 31, 30]] }),
    mod(PG, { fx: [['fx.glG2', 31, 30]] })];
  FR.player.tell_F = [
    mod(P0, { dy: 1, sw: null, swB: ['bkdn', 22, 33], arm: ['back', 26, 30] }),
    mod(PF, { torso: ['fwd', 0, 4], head: ['level', 4, 5], offB: null, arm: ['back', 28, 32], swB: ['bkdn', 19, 35] }),
    mod(PF, { dy: 1 }),
    mod(PF, { fx: [['fx.glF1', 39, 33]] }),
    mod(PF, { fx: [['fx.glF2', 39, 32]] })];

  // =============================================================================================
  // THE RIVAL — ~38 px, narrow, upright. Wine coat g/h/i, cape g with h folds, black 2/4/6, mask c/b/a.
  // =============================================================================================

  // ---- legs (thin, black, pointed boots) ----
  D('r.legs.stand', 18, 32, [
    '...44444....',
    '...244446...',
    '..244.446...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...46...',
    '..24...446..',
    '.224...4446.',
    '.2244..44446']);
  D('r.legs.step', 18, 32, [
    '...44444..........',
    '...2444446........',
    '..244..4446.......',
    '..24.....446......',
    '..24......46......',
    '..24......446.....',
    '..24.......46.....',
    '..24.......446....',
    '..24........46....',
    '..24........446...',
    '..24.........46...',
    '..24.........46...',
    '..24.........446..',
    '..24..........46..',
    '.224..........4466',
    '.2244.........4446']);
  D('r.legs.narrow', 20, 32, [
    '.44444..',
    '.244446.',
    '.24446..',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.2446...',
    '.24446..',
    '2244466.',
    '22444466']);
  D('r.legs.crouch', 10, 39, [
    '...........444444.........',
    '........24444.44446.......',
    '.....24444......44466.....',
    '...2444............46.....',
    '..244..............46.....',
    '.224...............46.....',
    '.24................446....',
    '224................4446...',
    '2244...............44446..']);

  // ---- torso (long coat, brass clasp, black sash) ----
  D('r.torso.up', 20, 20, [
    '...hhhh...',
    '..ghhhhp..',
    '.ghhhhhhi.',
    '.ghhhhhhi.',
    '.ghhhhhhi.',
    '.gghhhhhi.',
    '..ghhhhh..',
    '..ghhhhh..',
    '..gghhhh..',
    '..1111p1..',
    '..ghhhhhh.',
    '..ghhhhhh.',
    '.gghhhhhhh',
    '.ghhh.hhhh',
    '.gh....hhi']);
  DS('r.torso.back', 'r.torso.up', -1, '222211110000000');
  DS('r.torso.fwd', 'r.torso.up', 1, '222211110000000');
  D('r.torso.lunge', 19, 29, [
    '..........hhhh.',
    '......ghhhhhhp.',
    '...gghhhhhhhhhi',
    '.gghhhhhhhhhhhi',
    'gghhhhhhhhhhhi.',
    'ghhhhhhhhhhh...',
    'ghhhhhhhh......',
    '.ghhhhhh.......',
    '..ghhh.........']);

  // ---- cape (hangs behind; top carries the high collar wing and the elbow of the hand held behind the back) ----
  D('r.cape.top', 16, 11, [
    '....i.....',
    '....i.....',
    '...hi.....',
    '...hh.....',
    '...ghh....',
    '...ghh....',
    '...gghh...',
    '...gghhh..',
    '...ggghhh.',
    '..gggghhhh',
    '..ggggghhh',
    '.2gggggggh',
    '.2ggghgggg',
    '.2ggghggg.',
    '22gghgggg.',
    '2ggghgggg.',
    '.2gghgggg.',
    '.2gghggg..',
    '..2ghggg..']);
  D('r.cape.hem', 17, 30, [
    '.2ghggg...',
    '.2ghggg...',
    '.2gghgg...',
    '.2gghggg..',
    '.2gghggg..',
    '.2gghg2g..',
    '22gghg2g..',
    '2ggghg2gg.',
    '2gghgg2gg.',
    '2gghg22gg.',
    '2ggh2.2gg.',
    '.2gg...2g.',
    '.2g....2..',
    '..2.......']);
  D('r.cape.flare', 5, 22, [
    '...2gg...................',
    '..2gggghh................',
    '.2ggggggghhh.............',
    '2ggg2gggggghhh...........',
    '2gg.2ggghgggghhh.........',
    '.2...2ggghhggggghhh......',
    '......2gggghhgggggghhh...',
    '.......22ggghhhggggggghh.',
    '.........2gggghhhggggggh.',
    '..........22ggggghhgggggg',
    '............22ggggggggggg',
    '..............222gggggggg',
    '.................2ggggggg']);
  D('r.cape.wrap', 18, 12, [
    '.i.........',
    '.hi........',
    '.hh........',
    '.ghh.......',
    '.ghh.......',
    '.ghh.......',
    '.gghh......',
    '.gghh......',
    '.gghhhhhhh.',
    'gghhhhhhhpi',
    'gghhhhghhhi',
    'gghhhhghhhi',
    'gghhhhghhhi',
    '.ghhhhghhhi',
    '.ghhhhghhh.',
    '.ghhhhghhh.',
    '.ghhhhghhh.',
    '.gghhhghhh.',
    '.gghhhghhh.',
    '.gghhhghhh.',
    '.gghhhghhh.',
    '.gghhhghhh.',
    '.gghhhghh..',
    '.gghhhghh..',
    '.gghhhghh..',
    '.gghhgghh..',
    '.gghhgghh..',
    '.gghhg.gh..',
    '..ghhg.gh..',
    '..gh.g..h..',
    '..g........']);

  // ---- head: black cowl backing + a 7x9 mask face laid on it row by row (so every mask works on every head) ----
  D('r.head.b', 19, 9, [
    '....1441...',
    '...122224..',
    '..1222222..',
    '..12222222.',
    '..12222222.',
    '..12222222.',
    '..12222222.',
    '..12222222.',
    '..1222222..',
    '...122222..',
    '....1222...',
    '.....22....']);
  HEADS.level = { b: 'r.head.b', fx: 22, fy: 11, sh: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  HEADS.tiltB = { b: 'r.head.b', fx: 22, fy: 11, sh: [-1, -1, -1, 0, 0, 0, 0, 1, 1] };   // chin up
  HEADS.tiltF = { b: 'r.head.b', fx: 22, fy: 11, sh: [1, 1, 1, 0, 0, 0, 0, -1, -1] };    // chin down
  FACE.porcelain = Pix.parse([
    '.baaaa.',
    'baaaaaa',
    'baaaaaa',
    'ba11a11',
    'baaaaaa',
    'biaaaai',
    'cbiiii.',
    '.cbaaa.',
    '..cba..']);
  FACE.mourner = Pix.parse([
    '.baaaa.',
    'baaaaaa',
    'baaaaaa',
    'ba11a11',
    'baaaaas',
    'baiiias',
    'cbiaai.',
    '.cbaaa.',
    '..cba..']);
  FACE.jester = Pix.parse([
    '.11aaa.',
    '111aaaa',
    '111aa1a',
    '1aaa111',
    '111aa1a',
    '1i1aaai',
    '11iiii.',
    '.11aaa.',
    '..1ba..']);
  FACE.kintsugi = Pix.parse([
    '.bapaa.',
    'baapaaa',
    'baaappa',
    'ba11a11',
    'bappaaa',
    'bipaaai',
    'cbipii.',
    '.cbpaa.',
    '..cba..']);
  FACE.blank = Pix.parse([
    '.baaaa.',
    'baaaaaa',
    'baaaaaa',
    'baaaaaa',
    'baaaaaa',
    'baaaaaa',
    'cbaaaa.',
    '.cbaaa.',
    '..cba..']);
  FACE.shatter = Pix.parse([
    '...111.',
    '....111',
    '...1111',
    '....vvv',
    '...1111',
    '....111',
    '.....1.',
    '.......',
    '.......']);

  // ---- sword arm (wine sleeve, black glove; anchor = shoulder) ----
  DA('r.arm.cane', 1, 0, [
    '.hh.....',
    'ghhi....',
    'ghhi....',
    '.ghhi...',
    '.ghhi...',
    '..ghh...',
    '..ghhh..',
    '...ghh4.',
    '....g464',
    '.....44.']);
  DA('r.arm.up', 5, 12, [
    '.44....',
    '.46....',
    '.hh....',
    '.ghh...',
    '.ghh...',
    '..hh...',
    '..ghh..',
    '..ghh..',
    '...hh..',
    '...ghh.',
    '...ghh.',
    '....hhh',
    '....ghh',
    '.....g.']);
  DA('r.arm.guard', 1, 0, [
    '.hh....',
    'ghh....',
    'ghh....',
    'ghh....',
    'ghhhh46',
    '.ghhh44',
    '..gg...']);
  DA('r.arm.back', 11, 0, [
    '.......hhhhhh',
    '..4hhhhhgggg.',
    '.464ggg......',
    '.44..........']);

  // ---- estoc (anchor = grip) ----
  DA('r.sw.dnf', 1, 1, [
    '.p...',
    '.o...',
    'opo..',
    '.9...',
    '.9...',
    '.9...',
    '.9...',
    '..9..',
    '..9..',
    '..9..',
    '..9..',
    '...9.',
    '...9.',
    '...9.',
    '...9.',
    '....9',
    '....9',
    '....9',
    '....9']);
  DA('r.sw.upb', 12, 12, [
    '9.............',
    '.9............',
    '..9...........',
    '...9..........',
    '....9.........',
    '.....9........',
    '......9.......',
    '.......9......',
    '........9.....',
    '.........9....',
    '..........9.p.',
    '...........p..',
    '..........p.o.',
    '.............p']);
  DA('r.sw.up', 1, 18, [
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    '.9.',
    'opo',
    '.o.',
    '.p.']);
  DA('r.sw.bkdn3', 17, 1, [
    '................p..',
    '.............999pop',
    '..........999...p..',
    '.......999.........',
    '....999............',
    '.999...............',
    '9..................']);

  // ---- off arm ----
  DA('r.off.brace', 0, 0, [
    'h44',
    'g46']);
  DA('r.off.splay', 0, 3, [
    '..........6..',
    '.........4.6.',
    '........44..6',
    'hhhhhhi4446..',
    'gggggg44466.6',
    '........44.6.',
    '.........4...']);

  // ---- poses ----
  var R0 = { cape: ['top'], hem: ['hem'], legs: ['stand'], torso: ['up'], head: ['tiltB'], sw: ['dnf', 30, 29], arm: ['cane', 25, 21] };
  var R1 = mod(R0, { cape: ['top', 0, 1], torso: ['up', 0, 1], head: ['tiltB', 0, 1] });
  var R2 = mod(R1, { hem: ['hem', -1, 0] });
  var R3 = mod(R0, { hem: ['hem', -1, 0], head: ['level', 1, 0] });
  FR.rival.idle = [R0, R1, R2, R3];

  var RS = { swB: ['upb', 20, 12], cape: ['top', -2, 0], hem: ['hem', -1, 0], legs: ['step'], torso: ['back'], head: ['tiltB', -2, 0], arm: ['up', 23, 22] };
  var RG = { legs: ['narrow'], torso: ['up'], head: ['level'], capeF: ['wrap'], offM: ['brace', 27, 19], sw: ['up', 30, 27], arm: ['guard', 25, 22] };
  var RF = { swB: ['bkdn3', 19, 36], offB: ['splay', 31, 34], cape: ['flare'], legs: ['crouch'], torso: ['lunge', 0, 3], head: ['tiltB', 5, 12], arm: ['back', 29, 34] };
  FR.rival.tell_S = [
    mod(R0, { sw: ['up', 30, 26], arm: ['guard', 25, 21] }),
    mod(RS, { swB: ['upb', 22, 13], arm: ['up', 25, 23], torso: ['up'], head: ['level'], cape: ['top'] }),
    mod(RS, { dx: -1 }),
    mod(RS, { fx: [['fx.glS1', 10, 2]] }),
    mod(RS, { fx: [['fx.glS2', 14, 6]] })];
  FR.rival.tell_G = [
    mod(R0, { sw: ['up', 30, 29], arm: ['guard', 25, 23] }),
    mod(RG, { capeF: null, cape: ['top'], hem: ['hem', 1, 0], offM: null }),
    mod(RG, { dy: -1 }),
    mod(RG, { fx: [['fx.glG1', 30, 26]] }),
    mod(RG, { fx: [['fx.glG2', 30, 26]] })];
  FR.rival.tell_F = [
    mod(R0, { sw: null, swB: ['bkdn3', 20, 28], arm: ['back', 26, 26] }),
    mod(RF, { torso: ['fwd', 2, 5], head: ['tiltB', 4, 6], offB: null, cape: ['top', 2, 5], legs: ['crouch', 0, 0] }),
    mod(RF, { dx: 1 }),
    mod(RF, { fx: [['fx.glF1', 41, 34]] }),
    mod(RF, { fx: [['fx.glF2', 41, 33]] })];

  // =============================================================================================
  // Frames, caches, public API
  // =============================================================================================
  function poseOf(who, name, f) {
    var list = FR[who][name] || (who === 'rival2' && FR.rival[name]) || FR[who].idle || FR.rival.idle;
    return list[f < list.length ? f : list.length - 1];
  }

  // Pure and cached: the composed frame as an indexed image (48x48; 48x56 for rival2). Feet centre = (24, bottom row).
  function frameImg(who, name, f, mask) {
    var t = ANIMS[who], a, mi, row, img;
    if (!t) { who = 'player'; t = ANIMS.player; }
    a = t[name]; if (!a) { name = 'idle'; a = t.idle; }
    f = f | 0; if (f < 0) f = 0; else if (f >= a.n) f = a.n - 1;
    mi = who === 'player' ? 0 : (MASK_IX[mask] || 0);
    row = a.im[mi] || (a.im[mi] = []);
    img = row[f];
    if (!img) img = row[f] = compose(who, poseOf(who, name, f), MASKS[mi]);
    return img;
  }

  // x, y = feet centre. Authored facing right; opts.flip mirrors around x. opts: { flip, mask:id, white:bool, alpha }
  // Canvases are baked lazily, one per who + mask + anim + frame + flip + white; nothing is allocated once cached.
  function fighter(g, who, name, frame, x, y, opts) {
    var t = ANIMS[who], a, mi = 0, k, row, cv, img, al;
    if (!t) { who = 'player'; t = ANIMS.player; }
    a = t[name]; if (!a) { name = 'idle'; a = t.idle; }
    frame = frame | 0; if (frame < 0) frame = 0; else if (frame >= a.n) frame = a.n - 1;
    if (opts && opts.mask && who !== 'player') mi = MASK_IX[opts.mask] || 0;
    k = frame * 4 + (opts && opts.flip ? 2 : 0) + (opts && opts.white ? 1 : 0);
    row = a.cv[mi] || (a.cv[mi] = []);
    cv = row[k];
    if (!cv) {
      if (typeof document === 'undefined') return;
      img = frameImg(who, name, frame, MASKS[mi]);
      if (k & 1) img = Pix.solid(img, 23);
      if (k & 2) img = Pix.flipX(img);
      cv = row[k] = Pix.toCanvas(img);
    }
    al = opts && opts.alpha !== undefined ? opts.alpha : 1;
    if (al <= 0.02) return;
    if (al < 1) g.globalAlpha = al;
    g.drawImage(cv, Math.round(x) - AX, Math.round(y) - cv.height);
    if (al < 1) g.globalAlpha = 1;
  }

  R.Art = R.Art || {};
  R.Art.inits = R.Art.inits || [];
  R.Art.init = function () {
    var list = R.Art.inits, i;
    for (i = 0; i < list.length; i++) { try { list[i](); } catch (e) { /* one art module failing must not stop the others */ } }
  };
  R.Art.anim = anim;
  R.Art.frameAt = frameAt;
  R.Art.frameImg = frameImg;
  R.Art.fighter = fighter;
})(globalThis.RIVAL = globalThis.RIVAL || {});

// =====================================================================================================
// PLACEHOLDER STATICS — overridden by src/art/icons.js
// (R.Art.sprite / R.Art.sigil: fillRect programmer art, kept working until the icon artist's file loads)
// =====================================================================================================
(function (R) {
  'use strict';

  var P = R.Pal.hex;

  // ---- icons, sprites, sigil --------------------------------------------------------------
  function b(g, x, y, u, bx, by, bw, bh, col) { g.fillStyle = P[col]; g.fillRect(x + bx * u, y + by * u, bw * u, bh * u); }

  function icon(g, m, x, y, u) {           // 10x10 at u = 1
    var i;
    if (m === 'S') {
      for (i = 0; i < 6; i++) b(g, x, y, u, 3 + i, 6 - i, 2, 1, i >= 4 ? 19 : 9);
      for (i = 0; i < 4; i++) b(g, x, y, u, 4 + i, 6 - i, 1, 1, 8);
      b(g, x, y, u, 1, 5, 2, 1, 25); b(g, x, y, u, 3, 7, 2, 1, 25); b(g, x, y, u, 2, 6, 1, 1, 25);
      b(g, x, y, u, 1, 7, 1, 1, 13); b(g, x, y, u, 0, 8, 1, 1, 13);
    } else if (m === 'G') {
      b(g, x, y, u, 1, 1, 8, 5, 27); b(g, x, y, u, 2, 6, 6, 2, 27); b(g, x, y, u, 3, 8, 4, 1, 27); b(g, x, y, u, 4, 9, 2, 1, 27);
      b(g, x, y, u, 4, 1, 2, 8, 28); b(g, x, y, u, 1, 1, 8, 1, 28);
    } else {
      b(g, x, y, u, 3, 0, 3, 1, 30); b(g, x, y, u, 1, 1, 3, 1, 30); b(g, x, y, u, 1, 2, 2, 1, 30); b(g, x, y, u, 0, 3, 2, 3, 30);
      b(g, x, y, u, 1, 6, 2, 1, 30); b(g, x, y, u, 1, 7, 3, 1, 30); b(g, x, y, u, 3, 8, 3, 1, 30);
      b(g, x, y, u, 4, 4, 1, 1, 29); b(g, x, y, u, 6, 4, 1, 1, 30); b(g, x, y, u, 8, 4, 1, 1, 29);
    }
  }
  function mini(g, m, x, y) {              // 6x6
    var i;
    if (m === 'S') { for (i = 0; i < 6; i++) b(g, x, y, 1, i, 5 - i, 1, 1, i >= 4 ? 19 : 9); b(g, x, y, 1, 0, 3, 2, 1, 25); }
    else if (m === 'G') { b(g, x, y, 1, 0, 0, 6, 3, 27); b(g, x, y, 1, 1, 3, 4, 2, 27); b(g, x, y, 1, 2, 5, 2, 1, 27); b(g, x, y, 1, 2, 0, 2, 5, 28); }
    else { b(g, x, y, 1, 1, 0, 3, 1, 30); b(g, x, y, 1, 0, 1, 2, 4, 30); b(g, x, y, 1, 1, 5, 3, 1, 30); b(g, x, y, 1, 4, 3, 1, 1, 29); }
  }

  // Static sprites as flat [x, y, w, h, colour, ...] lists.
  var MASK = [1, 0, 10, 14, 10, 0, 2, 12, 10, 10, 0, 2, 2, 10, 11, 2, 5, 3, 1, 1, 7, 5, 3, 1, 1];
  var SMILE = [2, 10, 8, 1, 18, 1, 9, 1, 1, 18, 10, 9, 1, 1, 18];
  var RECTS = {
    st_guardBroken: [1, 0, 6, 4, 27, 2, 4, 4, 2, 27, 3, 6, 2, 1, 27, 1, 0, 2, 1, 28, 4, 0, 1, 2, 1, 3, 2, 1, 2, 1, 4, 4, 1, 3, 1],
    st_bleed: [3, 0, 2, 2, 19, 2, 2, 4, 2, 19, 1, 4, 6, 3, 18, 2, 7, 4, 1, 18, 2, 4, 1, 2, 23],
    st_fortify: [0, 1, 8, 6, 6, 0, 1, 8, 1, 8, 0, 6, 8, 1, 4, 0, 4, 8, 1, 4, 3, 2, 1, 2, 4, 5, 5, 1, 1, 4],
    st_focus: [1, 3, 6, 3, 21, 2, 2, 4, 5, 21, 3, 0, 2, 2, 22, 3, 3, 2, 3, 1],
    st_sealed: [2, 0, 4, 8, 17, 1, 1, 6, 6, 17, 0, 3, 8, 2, 17, 3, 3, 2, 2, 16, 2, 1, 2, 1, 18],
    lock: [2, 0, 4, 1, 8, 1, 1, 1, 3, 8, 6, 1, 1, 3, 8, 0, 3, 8, 5, 25, 0, 7, 8, 1, 24, 3, 5, 2, 2, 1],
    act_glimpse: [2, 4, 8, 4, 10, 1, 5, 10, 2, 10, 4, 3, 4, 6, 10, 5, 4, 2, 4, 27, 5, 5, 2, 2, 1],
    act_honesty: [1, 6, 2, 2, 28, 3, 8, 2, 2, 28, 5, 6, 2, 2, 28, 7, 4, 2, 2, 28, 9, 2, 2, 2, 28],
    act_coin: [3, 1, 6, 10, 25, 1, 3, 10, 6, 25, 4, 2, 4, 8, 22, 5, 4, 2, 4, 24],
    bonfire_player: [10, 6, 10, 9, 14, 10, 6, 4, 9, 15, 15, 9, 4, 5, 1, 17, 13, 1, 1, 8, 6, 15, 18, 11, 14, 6, 15, 6, 11, 15, 8, 26, 20, 4, 13, 24, 22, 4, 6, 13],
    bonfire_rival: [12, 2, 8, 9, 10, 18, 2, 2, 9, 11, 13, 5, 2, 1, 1, 16, 5, 2, 1, 1, 13, 8, 5, 1, 18, 10, 11, 12, 13, 17, 16, 11, 6, 13, 16, 4, 22, 22, 4, 1, 4, 24, 4, 6, 1, 6, 16, 6, 2, 1, 2, 28, 28, 4, 5],
    title_mask: [8, 2, 48, 60, 11, 2, 10, 60, 40, 11, 10, 4, 44, 56, 10, 4, 12, 56, 36, 10, 14, 26, 14, 3, 1, 36, 26, 14, 3, 1, 16, 46, 32, 3, 18, 12, 43, 5, 3, 18, 47, 43, 5, 3, 18],
    mask_porcelain: MASK.concat(SMILE),
    mask_mourner: MASK.concat([3, 10, 6, 1, 18, 2, 11, 1, 1, 18, 9, 11, 1, 1, 18, 8, 6, 1, 3, 28]),
    mask_jester: MASK.concat([1, 0, 5, 2, 1, 0, 2, 6, 10, 1, 1, 12, 5, 2, 1, 2, 5, 3, 1, 10, 6, 10, 4, 1, 18]),
    mask_kintsugi: MASK.concat(SMILE, [6, 0, 1, 4, 25, 5, 4, 1, 3, 25, 6, 7, 1, 3, 25, 7, 10, 1, 4, 25]),
    mask_blank: MASK.slice(0, 15)
  };
  var TAGS = { RIP: ['R', 19], TEN: ['T', 21], BLD: ['B', 18], TRK: ['K', 30], GMB: ['G', 25], INF: ['I', 28], CHA: ['C', 20], EXE: ['E', 9], relic: ['\u2665', 22] };
  var RAR = { rar_common: [1, 7], rar_uncommon: [2, 25], rar_rare: [3, 30] };
  var MOVE_OF = { icon_S: 'S', icon_G: 'G', icon_F: 'F', icon_S_big: 'S', icon_G_big: 'G', icon_F_big: 'F', mini_S: 'S', mini_G: 'G', mini_F: 'F' };

  // x, y = top-left. Unknown names draw nothing. Names: the list in INTERFACES.md ("Art conventions").
  function sprite(g, name, x, y, opts) {
    x = Math.round(x); y = Math.round(y);
    var m = MOVE_OF[name], list = RECTS[name], i, t;
    if (m) {
      if (name.length > 6) icon(g, m, x, y, 2);
      else if (name.charAt(0) === 'm') mini(g, m, x, y);
      else icon(g, m, x, y, 1);
    } else if (list) {
      for (i = 0; i < list.length; i += 5) b(g, x, y, 1, list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]);
      if (name === 'title_mask' && opts && opts.frame) { b(g, x, y, 1, 9, 40, 4, 3, 18); b(g, x, y, 1, 51, 40, 4, 3, 18); }
    } else if (name === 'logo') {                             // 120x34 two-line wordmark
      R.Font.draw(g, 'SHOW ME MY', x + 60, y, 8, CENTER);
      R.Font.draw(g, 'RIVAL', x + 60, y + 10, 10, CENTER3);
      b(g, x, y, 1, 20, 32, 80, 2, 18);
    } else if (RAR[name]) {
      for (i = 0; i < RAR[name][0]; i++) b(g, x, y, 1, i * 4, 0, 3, 3, RAR[name][1]);
    } else if (name.lastIndexOf('tag_', 0) === 0 && (t = TAGS[name.slice(4)])) {
      b(g, x, y, 1, 0, 0, 12, 12, 1); b(g, x, y, 1, 1, 1, 10, 10, t[1]); b(g, x, y, 1, 2, 2, 8, 8, 2);
      R.Font.draw(g, t[0], x + 6, y + 3, t[1], CENTER);
    }
  }
  var CENTER = { align: 'center' }, CENTER3 = { align: 'center', scale: 3 };

  function disc(g, x, y, s, col) {         // s = 16 or 14
    g.fillStyle = P[col];
    g.fillRect(x + 4, y, s - 8, s); g.fillRect(x + 2, y + 1, s - 4, s - 2); g.fillRect(x + 1, y + 2, s - 2, s - 4); g.fillRect(x, y + 4, s, s - 8);
  }
  // x, y = top-left of the 16x16 box. state: 'sealed'|'crack'|'open'|'gone'
  function sigil(g, x, y, state, move, side) {
    x = Math.round(x); y = Math.round(y);
    if (state === 'gone' || !state) return;
    var pl = side === 'p', mc;
    if (state === 'open') {
      mc = R.Pal.move[move] || R.Pal.move.S;
      disc(g, x, y, 16, mc[1]); disc(g, x + 1, y + 1, 14, 2);
      if (R.Pal.move[move]) icon(g, move, x + 3, y + 3, 1);
      return;
    }
    disc(g, x, y, 16, pl ? 15 : 16); disc(g, x + 1, y + 1, 14, pl ? 14 : 17);
    b(g, x, y, 1, 5, 4, 6, 7, 11); b(g, x, y, 1, 6, 6, 1, 1, 1); b(g, x, y, 1, 9, 6, 1, 1, 1); b(g, x, y, 1, 6, 9, 4, 1, 18);   // mask glyph
    if (state === 'crack') {
      b(g, x, y, 1, 8, 0, 1, 3, 23); b(g, x, y, 1, 7, 3, 1, 3, 23); b(g, x, y, 1, 8, 6, 1, 2, 23); b(g, x, y, 1, 9, 8, 1, 3, 23);
      b(g, x, y, 1, 8, 11, 1, 3, 23); b(g, x, y, 1, 7, 14, 1, 2, 23); b(g, x, y, 1, 6, 5, 1, 1, 22); b(g, x, y, 1, 10, 9, 1, 1, 22);
    }
  }
  R.Art = R.Art || {};
  R.Art.sprite = sprite;
  R.Art.sigil = sigil;
})(globalThis.RIVAL = globalThis.RIVAL || {});
