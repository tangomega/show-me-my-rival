// SHOW ME MY RIVAL — backgrounds (DESIGN 13.4): the cathedral arena, the bonfire cloister, the title ash.
//
// How it is built:
//   tiles    = hand-drawn palette-indexed pixel rows (window tracery, statue, rubble, pew, candles, flames, bell, fire)
//   surfaces = walls / floor / pillars / vault assembled into an indexed buffer from deterministic (seeded) masonry
//              and 2x2 ordered dither; every pixel is a palette index on the grid
//   light    = candle pools are a palette remap of the stone under them (cold stone -> warm), cut out as sprites
//   bake     = one static canvas per (scene, variant class, arena, phase 2), built lazily; per frame we draw that
//              canvas plus a handful of small sprites (flames, glows, pools, chains) and 1-px motes
// Art is anchored to opts.floorY (the floor / ground line). Nothing is allocated per frame.
//
// Pixel rows: '.' = transparent, '1'-'9' = palette 1-9, 'a'-'v' = palette 10-31 (see icons.js for the legend)
(function (R) {
  'use strict';

  var Pix = R.Pix, P = R.Pal.hex, W = 180;

  // ---- deterministic helpers -----------------------------------------------------------------
  function h32(x, y, s) {
    var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  }
  function rnd(x, y, s) { return h32(x, y, s) / 4294967296; }
  var B4 = [0, 2, 3, 1];
  function dth(x, y, lv) { return B4[((y & 1) << 1) | (x & 1)] < lv; }        // true for lv of every 4 pixels (2x2 ordered)
  function remapAll(img, map) { for (var i = 0; i < img.d.length; i++) { var c = img.d[i]; if (c && map[c] !== undefined) img.d[i] = map[c]; } return img; }
  function bake(img) { return typeof document === 'undefined' ? null : Pix.toCanvas(img); }
  function dims() {
    var E = R.Engine;
    return E && E.H ? E : DEF;
  }
  var DEF = { W: 180, H: 320, time: 0, real: 0 };

  // ============================================================================================
  // Hand-drawn tiles
  // ============================================================================================
  var WINDOW = [
    '...............4444444444...............',
    '............4444444444444444............',
    '..........44442222222222224444..........',
    '........444422qqqqq22qqrrr224444........',
    '.......44422q2qqqqq22qqrrrrr22444.......',
    '......4442qqq22qqqq22qqrrrrrrr2444......',
    '.....4422qqqqq2qqqq22qqrrrrsssr2244.....',
    '....4422qqqqqq2qqq2222rrrrsssssr2244....',
    '...4442q2qqqqqq2222222rrrssssss2r2444...',
    '...442qqq2qqq22qqqq22qrrrssssssssr244...',
    '..442qqqqq2q22qqqqq22qrrrssssssssrr244..',
    '..442qqqqqq2qqqqqqq22qrrrssssssssrr244..',
    '.442qqqqqq2q2qqqqqq22rrrrrssssssrrrr244.',
    '.44222qqq22qq2qqqqq22rrrrrrssssrrrrr244.',
    '.42qq222q2qqqq2qq222222rrrrrrrrrrrrrr24.',
    '442qqqqq2qqqqqq22qq22qq22rrrrrrrrrrrr244',
    '442qqqqq2qqqqqq22qr22rq22rrrrrrrrrrrr244',
    '442qqqqq2qqqqq2qq2r22r2qq2qrrrrrrrrrr244',
    '442qqqq22qqqqq2qrr2222rrq2qrrrrrrqqqq244',
    '4422222222222222222222222222222222222244',
    '4422222222222222222222222222222222222244',
    '442qqqq22qqqqq2qrr2222rrq2qqqqq22qqqq244',
    '442qqqqq2qqqqq2qq2r22r2qq2qqqqq2qqqqq244',
    '442qqqqq2qqqqqq22qr22rq22qqqqqq2qqqqq244',
    '442qqqqq2qqqqqq22qq22qq22qqqqqq2qqqqq244',
    '.42qq222q2qqqq2rr222222qq2qqqq2r222qq24.',
    '.44222qqq22qq2rrrrr22qqqqq2qq22rrr22244.',
    '.442qqqqqq2q2rrrrrr22qqqqqq2q2rrrrrr244.',
    '..442qqqqqq2rrrrrrr22qqqqqqq2rrrrrr244..',
    '..442qqqqq2q22rrrrr22qqqqq22r2rrrrr244..',
    '...442qqq2qqq22rrrr22qqqq22rrr2rrr244...',
    '...4442q2qqqqqq2222222222rrrrrr2r2444...',
    '....4422qqqqqq2qqq2222qqq2rrrrrr2244....',
    '.....4422qqqqq2qqqq22qqqq2rrrrr2244.....',
    '......4442qqq22qqqq22qqqq22rrr2444......',
    '.......44422q2qqqqq22qqqqq2r22444.......',
    '........444422qqqqq22qqqqq224444........',
    '..........44442222222222224444..........',
    '............4444444444444444............',
    '...............4444444444...............'
  ];
  var BLOCK_A = [
    '.66666665.',
    '6555555543',
    '6555555543',
    '6555455543',
    '6555555443',
    '.554444433',
    '..3333333.'
  ];
  var BLOCK_B = [
    '.666665',
    '6555554',
    '6555543',
    '.554443',
    '..3333.'
  ];
  var BLOCK_C = [
    '.665.',
    '65543',
    '.443.'
  ];
  var PEW = [                                    // a broken pew: one carved end still standing, the bench fallen from it
    '..d....................',
    '.ded...................',
    '.eed...................',
    '.eeed..................',
    '.efeedd................',
    '.efeeeeddd.............',
    '.efe.feeeeddd..........',
    '.efe.f.feeeeeddd.......',
    '.efe.f.f..feeeeeddd....',
    '.efe.f.f..f..feeeeedd..',
    '.efe.f.f..f..f.feeeeedd',
    'eefe.f.f..f..f..f.feeee',
    'efff.f.f..f..f..f...fff'
  ];
  // candle flames, 5x7, bottom row sits on the wick
  var FLAMES = [
    ['..l..', '..l..', '.lml.', '.lnl.', '.lnl.', '.kmk.', '..k..'],
    ['.....', '..l..', '.lml.', '.lnl.', '.lnl.', '.kmk.', '..k..'],
    ['...l.', '..l..', '.lml.', '.lnl.', '.lmk.', '.kmk.', '..k..'],
    ['.....', '.....', '.....', '..l..', '.lml.', '.kmk.', '..k..'],         // guttering
    ['.....', '.....', '.....', '.....', '..l..', '..m..', '..k..']          // nearly out
  ];
  var GLOW = [                                   // checker-dither halo, centred on the flame (9x9)
    '....o....',
    '...o.o...',
    '..o.l.o..',
    '.o.l.l.o.',
    'o.l...l.o',
    '.o.l.l.o.',
    '..o.l.o..',
    '...o.o...',
    '....o....'
  ];
  var GLOW_LOW = [
    '.........',
    '.........',
    '....o....',
    '...o.o...',
    '..o...o..',
    '...o.o...',
    '....o....',
    '.........',
    '.........'
  ];
  var CENSER = [                                 // an unlit iron lamp on the end of a chain
    '...6...',
    '..5.6..',
    '.5...6.',
    '.55o66.',
    '5544556',
    '5444456',
    '.54445.',
    '..545..',
    '...4...'
  ];
  var STATUE_SPANS = [                            // [left, right] per row, 26 wide: a headless saint on a plinth
    [12, 13], [11, 14], [11, 14], [10, 15], [6, 19], [5, 20], [4, 21], [4, 21], [3, 21], [3, 22], [3, 22], [3, 22], [3, 21], [3, 19], [3, 18],
    [4, 18], [4, 18], [4, 18], [4, 18], [4, 18], [4, 18], [4, 18], [4, 18], [4, 18], [4, 18],
    [4, 19], [4, 19], [4, 19], [4, 19], [4, 19], [4, 19], [4, 19], [4, 19], [4, 19], [4, 19],
    [3, 20], [3, 20], [3, 20], [3, 20], [3, 20], [3, 20], [3, 20], [3, 20],
    [2, 21], [2, 21], [2, 21], [2, 21], [2, 21], [2, 22], [1, 23],
    [0, 25], [0, 25], [1, 24], [2, 23], [2, 23], [2, 23], [2, 23], [2, 23], [2, 23], [1, 24], [0, 25], [0, 25]
  ];
  var FG_PEW_W = [                                // width per row of the near pew-end silhouette (left edge), 46 rows
    0, 5, 7, 8, 8, 7, 6, 8, 10, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11,
    17, 18, 18, 17, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12, 13, 13, 13, 13
  ];
  var FG_RUBBLE_W = [0, 0, 3, 5, 6, 9, 10, 12, 13, 15, 15, 16];     // near rubble, right edge (rows up from the bottom)

  // ---- bonfire tiles --------------------------------------------------------------------------
  var BELL = [                                   // the cathedral bell, sunk to its waist, its side broken open (34 x 24)
    '...............eeee...............',
    '..............ee..ee..............',
    '..............e....f..............',
    '.............feeeeeef.............',
    '...........ffeeeeeeeeff...........',
    '.........ffeeeeeeeeeeeeff.........',
    '........feeeeeeeoeeeeeeeef........',
    '.......feeeeeeeoo1oeeeeeeef.......',
    '.......feeeeeeoo11ooeeeeeef.......',
    '......feeeeeeoop111ooeeeeeef......',
    '......feeeeeoop1111pooeeeeef......',
    '......feeeeeoop11111pooeeeef......',
    '.....feeeeeoop1111111poeeeeef.....',
    '.....feeeeoopl1111111pooeeeef.....',
    '.....feeeeoopl11111111pooeeef.....',
    '....feeeeoopl1g1111g111pooeeef....',
    '....feeeeoopl1gg111gg11lpoeeef....',
    '...feeeeeopl1ggg11gggg11lpoeeef...',
    '...feeeeoopl1gggggggggg1lpooeef...',
    '..feeeeeoplggggkggggkggglpooeeef..',
    '..feeeeooplgggkkkggkkkkgglpooeef..',
    '.feeeeeooplggkkkkkkkkkkkgklpoeeef.',
    '.feeeeooplkgkkkkkkkkkkkkkgklpoeef.',
    'feeeeeooplkkkkkkkkkkkkkkkkklpooeef'
  ];
  var FIRE = [
    [
      '........k.......',
      '........k.......',
      '.......kk.......',
      '.......klk......',
      '......kklk......',
      '......kllk..k...',
      '...k..kllkk.k...',
      '...k.kklllk.....',
      '..kk.klllmlk....',
      '..kkkkllmmlk.k..',
      '..klkklmmmllkk..',
      '.kklllmmmmmlkk..',
      '.kllmmmnnmmllk..',
      '.klmmmnnnnmmlkk.',
      'kklmmnnnnnnmllk.',
      'kllmmnnnnnnmmlk.'
    ],
    [
      '................',
      '......k.........',
      '......kk....k...',
      '.......kk...k...',
      '.......klk......',
      '..k...kkllk.....',
      '..k...klllk.....',
      '..kk.kkllmlk.k..',
      '...kkkllmmlk.kk.',
      '..kkkllmmmlkkk..',
      '..kllllmmmmllk..',
      '.kkllmmmnmmmlk..',
      '.kllmmnnnnmmlkk.',
      'kklmmmnnnnnmmlk.',
      'kllmmnnnnnnmmlk.',
      'kllmmnnnnnnmllk.'
    ],
    [
      '................',
      '................',
      '..........k.....',
      '.........kk.....',
      '....k...kkk.....',
      '....k...klk..k..',
      '....kk.kkllk.k..',
      '...kkk.kllmk....',
      '...klkkklmmlk...',
      '..kkllkllmmlkk..',
      '..kllllmmmmllk..',
      '.kklmmmmnmmmlk..',
      '.klmmmnnnnmmllk.',
      'kklmmnnnnnnmmlk.',
      'kllmmnnnnnnmmlk.',
      'kklmmnnnnnnmllk.'
    ]
  ];
  var FALLEN = [                                 // a toppled column: the Rival's seat (44 x 11)
    '..666666666666666666666666666666666666666...',
    '.65555555555555555555555555555555555555556..',
    '6554444444444444444444444444444444444444555.',
    '6545555555555555555555555555555555555555445.',
    '6545555555555555555555555555555555555555545.',
    '6544444444444444444444444444444444444444545.',
    '6545555555555555555555555555555555555555545.',
    '6544444444444444444444444444444444444444445.',
    '.544333333333333333333333333333333333333344.',
    '..43333333333333333333333333333333333333334.',
    '...3333333333333333333333333333333333333....'
  ];

  // ============================================================================================
  // Cathedral
  // ============================================================================================
  var TOP = 288, BOT = 72;                       // rows baked above / below the floor line
  var BAY = [[12, 63], [116, 167]];              // the two dark bays that frame the fighters
  var SPRING = -94, ARCH_R = 32.5;               // arch springing line (rows above the floor) and radius
  var WIN_X = 70, WIN_Y = -131;
  // candles: [x, flame-bottom row relative to the floor, wax height]
  var CANDLES = [[100, -6, 5], [17, -13, 5], [161, -13, 5], [105, -4, 3], [25, -4, 3], [152, -9, 3]];
  var ALTAR = [[58, -4, 3], [64, -6, 5], [70, -4, 3], [76, -5, 4], [82, -4, 3], [88, -6, 5], [93, -4, 3], [98, -5, 4], [104, -4, 3],
               [110, -6, 5], [116, -4, 3], [122, -5, 4], [17, -13, 5], [161, -13, 5]];
  var LIT_COUNT = [0, 6, 6, 5, 4, 3, 4, 14];     // by duel number
  var WARM = {                                   // stone under candlelight: [dim, near the flame]
    1: [1, 15], 2: [15, 14], 3: [15, 14], 4: [14, 13], 5: [14, 13], 6: [13, 12], 7: [13, 12], 8: [12, 11],
    13: [12, 12], 14: [13, 12], 15: [14, 13], 26: [14, 14]
  };
  var WITCH = {                                  // ...and under witchfire
    1: [1, 26], 2: [26, 26], 3: [26, 27], 4: [26, 27], 5: [27, 27], 6: [27, 28], 13: [27, 27], 14: [26, 27], 15: [26, 26], 16: [26, 26]
  };
  var MOON = { 2: 26, 3: 26, 4: 26, 5: 27, 6: 27, 7: 28, 13: 7, 14: 5, 15: 4 };       // stone / floor in the moonbeam
  var BLOOD = { 26: 16, 27: 17, 28: 19 };
  var BLOOD_FLOOR = { 13: 17, 14: 16, 15: 16 };                               // where a blood moon pools on the flagstones
  var DAWN = { 2: 4, 3: 5, 4: 6, 5: 7, 6: 8, 26: 7, 27: 8, 28: 9, 15: 14, 14: 13 };
  var SINK = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 13: 14, 14: 15, 15: 1 };             // phase 2: the walls sink toward void

  function beamL(fy) { return 77 - (fy + 92) * 0.348; }                   // the moonbeam: from under the window, down and to the left
  function beamR(fy) { return 103 - (fy + 92) * 0.25; }
  var HOLE = [-121, -123, -126, -125, -128, -131, -130, -133, -132, -135, -133, -134, -130, -131, -128, -126, -127, -123, -121, -119];   // ragged top of the gap over the right arch (x = 139..)

  // Which side of the pointed arch is (x, fy) on?  0 = outside, 1 = the arch band, 2 = inside the bay.
  function archAt(b, x, fy) {
    var x0 = BAY[b][0], x1 = BAY[b][1], cx = (x0 + x1) / 2, hw = (x1 - x0 + 1) / 2, ox, r;
    if (x < x0 - 6 || x > x1 + 6) return 0;
    if (fy > SPRING) return (x >= x0 && x <= x1) ? 2 : 0;
    ox = x + 0.5 < cx ? cx + (ARCH_R - hw) : cx - (ARCH_R - hw);            // centre of this half's arc
    r = Math.sqrt((x + 0.5 - ox) * (x + 0.5 - ox) + (fy - SPRING) * (fy - SPRING));
    if (r < ARCH_R) return 2;
    return r < ARCH_R + 5 ? 1 : 0;
  }
  function archAngle(b, x, fy) {
    var x0 = BAY[b][0], x1 = BAY[b][1], cx = (x0 + x1) / 2, hw = (x1 - x0 + 1) / 2;
    var ox = x + 0.5 < cx ? cx + (ARCH_R - hw) : cx - (ARCH_R - hw);
    return Math.atan2(SPRING - fy, Math.abs(x + 0.5 - ox));                 // 0 at the springer, ~1.2 at the crown
  }
  // The breaks: the left arch has lost a few stones low on its left haunch, the right arch its whole crown.
  function broken(b, x, fy) {
    var a = archAngle(b, x, fy), cx = (BAY[b][0] + BAY[b][1]) / 2;
    if (b === 0) return x < cx && a > 0.34 && a < 0.62;
    return x > cx - 6 && a > 0.80;
  }

  function buildCathedral(vc, arena, p2) {
    var H = TOP + BOT, img = Pix.make(W, H), x, y, fy, c, i, b, a, k, n, t;
    var altar = vc === 7;

    // --- L0/L1: vault and far wall, coursed masonry at very low contrast
    for (y = 0; y < H; y++) {
      fy = y - TOP;
      for (x = 0; x < W; x++) {
        if (fy >= -150) c = 3;
        else if (fy >= -153) c = fy === -151 ? 5 : fy === -152 ? 4 : 2;        // a string course, then the clerestory in shadow
        else if (fy >= -206) c = 2;
        else if (fy >= -210) c = dth(x, y, 2) ? 2 : 1;
        else c = 1;
        img.d[y * W + x] = c;
      }
    }
    for (y = TOP - 150; y < TOP; y++) {                                      // joints: most are worn away
      fy = y - TOP; k = Math.floor((fy + 160) / 8);
      for (x = 0; x < W; x++) {
        n = Math.floor((x + (k & 1) * 8) / 16);
        if ((fy + 160) % 8 === 0 && rnd(n, k, 1) < 0.42) img.d[y * W + x] = 2;
        else if ((x + (k & 1) * 8) % 16 === 0 && rnd(n, k, 2) < 0.30) img.d[y * W + x] = 2;
      }
    }
    // vault ribs: thin stepped lines rising from the piers and meeting overhead
    function rib(xa, fya, xb, fyb) {
      var steps = Math.abs(fyb - fya), s, rx, ry, cur;
      for (s = 0; s <= steps; s++) {
        rx = Math.round(xa + (xb - xa) * (s / steps) * (s / steps)); ry = TOP + fya + Math.round((fyb - fya) * s / steps);
        cur = Pix.get(img, rx, ry);
        if (cur) { Pix.set(img, rx, ry, cur >= 3 ? 4 : cur === 2 ? 3 : 2); Pix.set(img, rx + 1, ry, cur >= 3 ? 4 : cur === 2 ? 3 : 2); }
      }
    }
    rib(67, -150, 89, -250); rib(111, -150, 90, -250); rib(67, -150, 30, -240); rib(111, -150, 150, -240);
    rib(5, -150, 30, -240); rib(173, -150, 150, -240);

    // --- the two bays: darker recesses under pointed arches (calm and dark behind each fighter)
    for (b = 0; b < 2; b++) {
      for (y = TOP - 140; y < TOP; y++) {
        fy = y - TOP;
        for (x = BAY[b][0] - 6; x <= BAY[b][1] + 6; x++) {
          a = archAt(b, x, fy);
          if (a === 2) {
            c = 2;
            k = Math.floor((fy + 160) / 8); n = Math.floor((x + (k & 1) * 8) / 16);
            if ((fy + 160) % 8 === 0 && rnd(n, k, 5) < 0.16) c = 1;          // a few joints, barely there
            img.d[y * W + x] = c;
          } else if (a === 1) {
            if (broken(b, x, fy)) { img.d[y * W + x] = 2; continue; }
            c = 4;
            if (archAt(b, x, fy + 1) === 2 || archAt(b, x + (x < (BAY[b][0] + BAY[b][1]) / 2 ? 1 : -1), fy) === 2) c = 5;      // lit lip
            t = Math.floor(archAngle(b, x, fy) * 5.2);
            if (t !== Math.floor(archAngle(b, x + 1, fy) * 5.2) || t !== Math.floor(archAngle(b, x, fy + 1) * 5.2)) c = 3;   // voussoir joints
            img.d[y * W + x] = c;
          }
        }
      }
    }
    // the fallen crown leaves a ragged hole in the wall above the right arch
    for (i = 0; i < HOLE.length; i++) {
      x = 139 + i;
      for (fy = HOLE[i]; fy < -100; fy++) {
        if (archAt(1, x, fy) === 2) break;
        img.d[(TOP + fy) * W + x] = fy === HOLE[i] ? 1 : 2;                   // a void lip under the broken edge
      }
    }

    // --- rose window and its light
    Pix.blit(img, Pix.parse(WINDOW), WIN_X, TOP + WIN_Y);

    // --- L2: wall piers flanking the window (far, low contrast)
    for (i = 0; i < 2; i++) {
      var px0 = i ? 108 : 64, inner = i ? px0 : px0 + 7, outer = i ? px0 + 7 : px0;
      for (y = TOP - 150; y < TOP; y++) {
        fy = y - TOP;
        for (x = px0; x < px0 + 8; x++) img.d[y * W + x] = x === inner ? (fy < -60 ? 26 : 5) : x === outer ? 3 : 4;
        if ((fy + 150) % 30 === 29) for (x = px0 + 1; x < px0 + 7; x++) img.d[y * W + x] = 3;
      }
      Pix.fill(img, px0 - 1, TOP + SPRING - 2, 10, 2, 5); Pix.fill(img, px0 - 1, TOP + SPRING, 10, 3, 4); Pix.fill(img, px0, TOP + SPRING + 3, 8, 1, 3);
      Pix.fill(img, px0 - 1, TOP - 5, 10, 5, 4); Pix.fill(img, px0 - 1, TOP - 6, 10, 1, 5);
    }
    // the shaft of moonlight hangs in the air in front of the wall: checker in the core, 25% at the edges and low down
    for (y = TOP - 91; y < TOP; y++) {
      fy = y - TOP;
      for (x = 36; x < 110; x++) {
        a = Math.min(x - beamL(fy), beamR(fy) - x);
        if (a < 0) continue;
        c = img.d[y * W + x];
        if (MOON[c] === undefined || c > 6) continue;
        if (dth(x, y, a < 3 || fy > -40 ? 1 : 2) && !(a < 3 && fy > -40)) img.d[y * W + x] = MOON[c];
      }
    }

    // --- the altar (duel 7): a broken saint between the piers, rim-lit by the moon
    if (altar) {
      for (i = 0; i < STATUE_SPANS.length; i++) {
        y = TOP - STATUE_SPANS.length + i;
        for (x = STATUE_SPANS[i][0]; x <= STATUE_SPANS[i][1]; x++) {
          c = x >= STATUE_SPANS[i][1] ? 5 : x <= STATUE_SPANS[i][0] + 1 ? 1 : 2;
          if (i >= 50) c = x >= STATUE_SPANS[i][1] - 1 ? 5 : (i === 50 || i === 59) ? 5 : 4;         // plinth
          else if (i > 14 && (x === 9 || x === 14) && i < 49) c = 1;                                  // robe folds
          else if (i > 5 && i < 49 && x === 12 && i > 20) c = 4;                                      // the sword it leans on
          img.d[y * W + 77 + x] = c;
        }
      }
      Pix.fill(img, 77 + 10, TOP - STATUE_SPANS.length + 20, 5, 1, 4);       // crossguard
    }

    // --- floor: flagstones, darker with depth; the first row is the floor line
    for (y = TOP; y < H; y++) {
      fy = y - TOP;
      k = fy < 1 ? -1 : Math.floor((fy - 1) / 7);                            // course
      for (x = 0; x < W; x++) {
        if (fy === 0) c = rnd(x >> 2, 0, 11) < 0.3 ? 14 : 13;
        else {
          t = (fy - 1) % 7; n = Math.floor((x + k * 11 + (k & 1) * 9) / 22);
          a = (x + k * 11 + (k & 1) * 9) % 22;
          if (k === 0) c = t === 6 ? 15 : a === 0 ? 15 : t === 0 ? (rnd(n, k, 12) < 0.55 ? 13 : 14) : 14;
          else if (k === 1) c = t === 6 ? 1 : a === 0 ? 1 : t === 0 ? 14 : 15;
          else if (k === 2) c = t === 6 || a === 0 ? 1 : t === 0 ? 15 : 2;
          else if (k === 3) c = t === 0 ? 2 : 1;
          else c = 1;
          if (k === 0 && rnd(n, k, 13) < 0.25 && t > 0 && t < 6 && a > 0) c = 15;                    // a darker slab
        }
        img.d[y * W + x] = c;
      }
    }
    // moonlight pooled on the floor where the shaft lands
    for (y = TOP; y < TOP + 16; y++) {
      fy = y - TOP;
      for (x = 30; x < 110; x++) {
        a = Math.min(x - (beamL(0) - fy * 0.9), (beamR(0) - fy * 0.5) - x);
        if (a < 0) continue;
        c = img.d[y * W + x];
        t = arena === 1 || vc === 6 ? BLOOD_FLOOR[c] : MOON[c];
        if (t === undefined) continue;
        if ((a >= 2 && fy < 9) || dth(x, y, fy < 13 ? 2 : 1)) img.d[y * W + x] = t;
      }
    }

    // --- L3: rubble, the toppled pew, cold candle stubs
    var blockA = Pix.parse(BLOCK_A), blockB = Pix.parse(BLOCK_B), blockC = Pix.parse(BLOCK_C);
    Pix.blit(img, blockA, 13, TOP - 7); Pix.blit(img, blockC, 23, TOP - 3);
    Pix.blit(img, blockA, 156, TOP - 7, true); Pix.blit(img, blockB, 149, TOP - 5); Pix.blit(img, blockC, 144, TOP - 3, true);
    Pix.blit(img, blockC, 160, TOP - 10);
    if (!altar) Pix.blit(img, Pix.parse(PEW), 73, TOP - 16);

    // --- near pillars at the screen edges (most contrast in the scene, still stone-dark)
    for (i = 0; i < 2; i++) {
      for (y = 0; y < TOP; y++) {
        fy = y - TOP;
        for (k = 0; k < 12; k++) {
          x = i ? W - 1 - k : k;                                            // k = 0 at the screen edge, 11 toward the nave
          c = k >= 10 ? 6 : k < 3 ? 4 : (k === 5 || k === 8) ? 4 : 5;
          if (fy < -100) c = k >= 10 ? 5 : k < 4 ? 3 : 4;                    // above the capital it recedes
          if (fy < -165) c = k >= 10 ? 4 : 3;
          if (fy < -215) c = k >= 10 ? 3 : 2;
          if (fy >= -100 && (fy + 100) % 26 === 25) c = k >= 10 ? 5 : 4;     // drum joints
          img.d[y * W + x] = c;
        }
      }
      // capital and base
      for (k = 0; k < 15; k++) {
        x = i ? W - 1 - k : k;
        for (fy = -102; fy < -90; fy++) {
          c = fy === -102 ? 6 : fy === -101 ? 7 : fy < -98 ? 6 : fy < -93 ? (k < (fy > -96 ? 13 : 14) ? 5 : 0) : (k < 13 ? 4 : 0);   // abacus, echinus, necking
          if (c) img.d[(TOP + fy) * W + x] = c;
        }
        for (fy = -9; fy < 0; fy++) {
          c = fy === -9 ? (k < 13 ? 6 : 0) : fy < -6 ? (k < 13 ? 5 : 0) : fy === -6 ? (k < 15 ? 6 : 0) : (k < 15 ? (k > 12 ? 6 : 5) : 0);
          if (fy === -1 && c) c = 4;
          if (c) img.d[(TOP + fy) * W + x] = c;
        }
      }
    }

    // --- static chains (the swaying ends are sprites)
    for (i = 0; i < 2; i++) {
      x = i ? 111 : 67;
      for (y = 0; y < TOP - 104; y++) chainPx(img, x, y, y);
    }

    // --- tone: arena, blood moon, phase 2
    tone(img, vc, arena, p2);
    return img;
  }

  // One pixel row of chain at (x, y): links alternate face-on (3 wide) and edge-on (1 wide).
  function chainPx(img, x, y, i) {
    var t = i % 6;
    if (t === 0 || t === 3) { Pix.set(img, x, y, 5); }
    else if (t < 3) { Pix.set(img, x - 1, y, 4); Pix.set(img, x + 1, y, 5); }
    else Pix.set(img, x, y, 4);
  }
  function tone(img, vc, arena, p2) {
    if (arena === 2) remapAll(img, DAWN);
    if (arena === 1 || vc === 6) remapAll(img, BLOOD);
    if (vc >= 3 && vc <= 5 && arena !== 2) {                                 // the later duels are colder: the pale blocks go out
      for (var i = 0; i < img.d.length; i++) if (img.d[i] === 6 && ((i % W) > 14 && (i % W) < W - 15)) img.d[i] = 5;
    }
    if (p2) remapAll(img, SINK);
    return img;
  }

  // Candle bodies (wax + brass foot) go on after toning so they keep their colour.
  function drawCandles(img, list, nLit) {
    var i, c, x, y, h;
    for (i = 0; i < list.length; i++) {
      c = list[i]; x = c[0]; y = TOP + c[1] + 1; h = c[2];
      Pix.fill(img, x - 1, y, 3, h, 11); Pix.fill(img, x + 1, y, 1, h, 12);
      Pix.set(img, x - 1, y, 10); Pix.set(img, x, y, 10);
      if (h > 3) Pix.set(img, x - 1, y + 2, 10);
      Pix.set(img, x, y - 1, 1);                                             // wick
      if (i >= nLit) { Pix.fill(img, x - 1, y, 3, h, 12); Pix.fill(img, x - 1, y, 2, 1, 11); Pix.set(img, x + 1, y, 13); }   // cold stub
      Pix.fill(img, x - 2, y + h - 1, 5, 1, 24); Pix.set(img, x - 2, y + h - 1, 25);
    }
  }

  var POOL_RX = 14, POOL_RY = 11;
  // Light: remap the stone around each lit candle. Returns a new image; scale shrinks the pools.
  function lightPass(base, list, nLit, table, scale) {
    var out = Pix.clone(base), i, c, x, y, x0, x1, y0, y1, cx, cy, v, best, d, col, row, st, rx = POOL_RX * scale, ry = POOL_RY * scale;
    for (i = 0; i < nLit; i++) {
      c = list[i]; cx = c[0]; cy = TOP + c[1] - 2;
      x0 = Math.max(0, Math.floor(cx - rx)); x1 = Math.min(W - 1, Math.ceil(cx + rx));
      y0 = Math.max(0, Math.floor(cy - ry)); y1 = Math.min(base.h - 1, Math.ceil(cy + ry * 1.3));
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
        best = 0;
        for (var j = 0; j < nLit; j++) {
          var q = list[j], dx = (x - q[0]) / rx, dy = (y - (TOP + q[1] - 2)) / (y > TOP + q[1] - 2 ? ry * 1.3 : ry);
          d = dx * dx + dy * dy;
          if (d < 1) { v = (1 - Math.sqrt(d)) * 3.2; if (v > best) best = v; }
        }
        if (best <= 0) continue;
        col = base.d[y * W + x]; row = table[col];
        if (!row) continue;
        // falloff: 25% dither, checker, flat dim, then a small brighter core
        st = best < 0.45 ? 0 : best < 0.95 ? (dth(x, y, 1) ? 1 : 0) : best < 1.45 ? (dth(x, y, 2) ? 1 : 0) : best < 2.3 ? 1
           : best < 2.6 ? (dth(x, y, 2) ? 2 : 1) : 2;
        if (st > 0) out.d[y * W + x] = row[st - 1];
      }
    }
    return out;
  }
  // The pixels of `lit` that differ from `base` inside a box around one candle, as a sprite.
  function cutPool(base, lit, c, scale) {
    var rx = Math.ceil(POOL_RX * scale), ry = Math.ceil(POOL_RY * scale), x0 = Math.max(0, c[0] - rx), y0 = Math.max(0, TOP + c[1] - 2 - ry);
    var w = Math.min(W, c[0] + rx + 1) - x0, h = Math.min(base.h, TOP + c[1] - 2 + Math.ceil(ry * 1.3) + 1) - y0, s = Pix.make(w, h), x, y, any = false;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var a = lit.d[(y0 + y) * W + x0 + x];
      if (a !== base.d[(y0 + y) * W + x0 + x]) { s.d[y * w + x] = a; any = true; }
    }
    return { cv: any ? bake(s) : null, img: s, x: x0, y: y0 - TOP };
  }

  var flameCv = null;                                    // [normal x5, witch x5]
  var glowCv = null;                                     // [normal, low, witch, witch low]
  function flames() {
    var i, im;
    if (flameCv) return;
    flameCv = []; glowCv = [];
    for (i = 0; i < 5; i++) flameCv.push(bake(Pix.parse(FLAMES[i])));
    for (i = 0; i < 5; i++) flameCv.push(bake(Pix.remapped(Pix.parse(FLAMES[i]), { 21: 31, 22: 23, 20: 27 })));
    im = Pix.parse(GLOW); glowCv.push(bake(im)); glowCv.push(bake(Pix.parse(GLOW_LOW)));
    glowCv.push(bake(Pix.remapped(im, { 21: 31, 24: 27 }))); glowCv.push(bake(Pix.remapped(Pix.parse(GLOW_LOW), { 21: 31, 24: 27 })));
  }

  // ---- cathedral cache: one entry per (variant class, arena, phase 2) ---------------------------
  var cath = [];
  function variantClass(v) { v = v | 0; return v < 3 ? 1 : v > 7 ? 7 : v; }     // duels 1 and 2 share a bake
  function cathedral(v, arena, p2) {
    var a = arena === 'blood_moon' ? 1 : arena === 'pale_dawn' ? 2 : 0, key = (v * 3 + a) * 2 + (p2 ? 1 : 0), e = cath[key];
    if (e) return e;
    var list = v === 7 ? ALTAR : CANDLES, nLit = Math.min(list.length, LIT_COUNT[v]), table = p2 ? WITCH : WARM;
    var base = buildCathedral(v, a, p2), lit1, lit2, lit3, i, ch;
    drawCandles(base, list, nLit);
    lit1 = lightPass(base, list, nLit, table, 1); lit2 = lightPass(base, list, nLit, table, 0.86); lit3 = lightPass(base, list, nLit, table, 0.5);
    e = { img: base, cv: bake(base), list: list, n: nLit, pools: [], lit: lit1, chain: null, chainImg: null, mote: [0, 0] };
    for (i = 0; i < nLit; i++) e.pools.push([cutPool(base, lit1, list[i], 1), cutPool(base, lit2, list[i], 0.86), cutPool(base, lit3, list[i], 0.5)]);
    ch = Pix.make(9, 40);                                                   // swaying chain end + censer
    for (i = 0; i < 31; i++) chainPx(ch, 4, i, TOP - 104 + i);
    Pix.blit(ch, Pix.parse(CENSER), 1, 31);
    tone(ch, v, a, p2);
    e.chainImg = ch; e.chain = bake(ch);
    e.mote[0] = a === 1 || v === 6 ? 17 : a === 2 ? 8 : 27; e.mote[1] = a === 1 || v === 6 ? 19 : a === 2 ? 9 : 28;
    cath[key] = e;
    return e;
  }

  function drawCathedral(g, t, opts, E) {
    var v = variantClass(opts && opts.variant), p2 = !!(opts && opts.phase2), e = cathedral(v, opts && opts.arena, p2);
    var floorY = Math.round(opts && opts.floorY > 0 ? opts.floorY : (E.lay ? E.lay.floorY : 172)), y0 = floorY - TOP;
    var gut = opts && opts.gutter > 0 ? (opts.gutter > 1 ? 1 : opts.gutter) : 0, H = E.H, i, c, s, fr, st, sway, k, fy, mx, pool, off = p2 ? 5 : 0;
    // the Vigil: lights put out before the run stay out here too (the last candle never goes)
    var dark = opts && opts.snuffed > 0 ? Math.min(e.n - 1, Math.ceil(opts.snuffed * (e.n - 1) / 7)) : 0;
    flames();
    if (e.cv) g.drawImage(e.cv, 0, y0);
    g.fillStyle = P[1];
    if (y0 > 0) g.fillRect(0, 0, W, y0);
    if (y0 + TOP + BOT < H) g.fillRect(0, y0 + TOP + BOT, W, H - (y0 + TOP + BOT));
    // chain ends sway one pixel on a two-second cycle, out of step with each other
    if (e.chain) {
      sway = Math.floor(t * 0.5 * 4) % 4; sway = sway === 1 ? 1 : sway === 3 ? -1 : 0;
      g.drawImage(e.chain, 67 - 4 + sway, floorY - 104);
      g.drawImage(e.chain, 111 - 4 - sway, floorY - 104);
    }
    // dust in the moonbeam
    for (i = 0; i < 12; i++) {
      fy = -88 + ((i * 29 + t * (2 + (i % 3))) % 84);
      k = ((i * 0.618) % 1);
      mx = beamL(fy) + 2 + (beamR(fy) - beamL(fy) - 4) * k + Math.sin(t * 0.4 + i * 1.7) * 1.5;
      g.fillStyle = P[e.mote[i & 1]];
      g.fillRect(mx | 0, (floorY + fy) | 0, 1, 1);
    }
    // candles: pools of lit stone first, then halo + flame. `gutter` dims them one after another.
    for (k = 0; k < 2; k++) for (i = 0; i < e.n; i++) {
      if (i >= e.n - dark) continue;
      c = e.list[i];
      s = gut <= 0 ? 0 : gut * 1.6 - 0.6 * (e.n > 1 ? i / (e.n - 1) : 0);
      st = s < 0.25 ? 0 : s < 0.6 ? 1 : s < 0.95 ? 2 : 3;                    // 0 burning, 1 guttering, 2 nearly out, 3 out
      if (st === 3) continue;
      fr = h32(i, Math.floor(t / (0.12 + (h32(i, 7, 3) % 7) * 0.01)), 5) % 3;     // 120-180 ms per flicker frame
      if (k === 0) {
        pool = e.pools[i][st === 0 ? (fr === 1 ? 1 : 0) : 2];
        if (st < 2 && pool.cv) g.drawImage(pool.cv, pool.x, floorY + pool.y);
        continue;
      }
      if (st < 2 && glowCv[0]) g.drawImage(glowCv[(st ? 1 : 0) + (p2 ? 2 : 0)], c[0] - 4, floorY + c[1] - 7);
      if (flameCv[0]) g.drawImage(flameCv[off + (st === 0 ? fr : st === 1 ? 3 : 4)], c[0] - 2, floorY + c[1] - 6);
    }
  }

  // ---- cathedral foreground: near silhouettes + bottom vignette, drawn over the fighters -----------
  var FG_TOP = 14, FG_H = 46;
  var fgCv = null, fgImg = null;
  function buildFg() {
    var img = Pix.make(W, FG_H), x, y, w, n = FG_RUBBLE_W.length;
    for (y = 0; y < FG_H; y++) {
      w = FG_PEW_W[y] || 0;
      for (x = 0; x < w; x++) img.d[y * W + x] = 1;
      if (w > 3 && y > 6 && y < 40) img.d[y * W + w - 1] = y === 25 || y === 26 ? 15 : 2;          // the faintest edge light
    }
    for (y = 0; y < n; y++) {
      w = FG_RUBBLE_W[y];
      for (x = 0; x < w; x++) img.d[(FG_H - n + y) * W + W - 1 - x] = 1;
      if (w > 4) img.d[(FG_H - n + y) * W + W - w] = 2;
    }
    for (y = FG_TOP + 26; y < FG_H; y++) for (x = 0; x < W; x++) {             // vignette: two dither steps into the band below
      if (dth(x, y, y < FG_TOP + 29 ? 1 : 2)) img.d[y * W + x] = 1;
    }
    return img;
  }
  function drawFg(g, t, opts, E) {
    var floorY = Math.round(opts && opts.floorY > 0 ? opts.floorY : (E.lay ? E.lay.floorY : 172)), i, x, y, top, span;
    if (!fgImg) { fgImg = buildFg(); fgCv = bake(fgImg); }
    if (fgCv) g.drawImage(fgCv, 0, floorY - FG_TOP);
    top = floorY - 140; span = 168;
    for (i = 0; i < 20; i++) {                                              // stateless ash fall, 8-14 px/s
      y = top + ((i * 53 + t * (8 + (i % 7))) % span);
      x = (i * 37 + Math.sin(t * 0.6 + i) * 5 + 180) % W;
      g.fillStyle = P[i & 1 ? 7 : 8]; g.fillRect(x | 0, y | 0, 1, 1);
    }
  }

  // ============================================================================================
  // Bonfire: a night cloister, a fire in a sunken bell
  // ============================================================================================
  var BTOP = 210, BBOT = 48;
  var COLS = [10, 63, 116, 169];                 // arcade column centres
  var BELL_X = 73;
  var bon = null;
  var FIRELIT = {
    3: [15, 14, 14], 4: [14, 14, 13], 5: [14, 13, 13], 6: [13, 13, 12], 7: [13, 12, 12],
    14: [14, 13, 13], 15: [15, 14, 13]
  };
  function buildBonfire() {
    var H = BTOP + BBOT, img = Pix.make(W, H), x, y, fy, c, i, k, n, a, d, t;
    for (y = 0; y < H; y++) {
      fy = y - BTOP;
      for (x = 0; x < W; x++) {
        // sky
        c = fy < -150 ? 1 : fy < -138 ? (dth(x, y, fy < -146 ? 1 : fy < -142 ? 2 : 3) ? 2 : 1) : 2;
        if (fy < -72 && rnd(x, y, 21) < 0.006) c = rnd(x, y, 22) < 0.3 ? 7 : 5;                    // stars
        // the cloister wall: a parapet line, then stone down to the ground
        if (fy >= -72) {
          c = fy === -72 ? 4 : fy < -68 ? 3 : 3;
          k = Math.floor((fy + 72) / 7); n = Math.floor((x + (k & 1) * 9) / 18);
          if ((fy + 72) % 7 === 6 && rnd(n, k, 23) < 0.4) c = 2;
          else if ((x + (k & 1) * 9) % 18 === 0 && rnd(n, k, 24) < 0.3) c = 2;
        }
        img.d[y * W + x] = c;
      }
    }
    // three round-headed openings onto the dark walk behind, one behind each figure and one behind the fire
    for (i = 0; i < 3; i++) {
      var ax0 = COLS[i] + 4, ax1 = COLS[i + 1] - 4, acx = (ax0 + ax1) / 2, ar = (ax1 - ax0 + 1) / 2, spring = -34;
      for (y = BTOP - 66; y < BTOP; y++) {
        fy = y - BTOP;
        for (x = ax0 - 3; x <= ax1 + 3; x++) {
          d = fy > spring ? Math.abs(x + 0.5 - acx) : Math.sqrt((x + 0.5 - acx) * (x + 0.5 - acx) + (fy - spring) * (fy - spring));
          if (d < ar) img.d[y * W + x] = fy > -9 ? 2 : 1;
          else if (d < ar + 3 && fy <= spring) {
            t = Math.floor(Math.atan2(spring - fy, x + 0.5 - acx) * 5);
            img.d[y * W + x] = d < ar + 1 ? 5 : (t !== Math.floor(Math.atan2(spring - fy, x + 1.5 - acx) * 5) ? 3 : 4);
          }
        }
      }
    }
    // columns
    for (i = 0; i < 4; i++) {
      x = COLS[i];
      for (y = BTOP - 34; y < BTOP; y++) {
        Pix.fill(img, x - 3, y, 7, 1, 4); Pix.set(img, x - 3, y, 3); Pix.set(img, x + 3, y, 3);
        Pix.set(img, x + (x < 90 ? 2 : -2), y, 5);
      }
      Pix.fill(img, x - 5, BTOP - 37, 11, 2, 5); Pix.fill(img, x - 4, BTOP - 35, 9, 1, 4);
      Pix.fill(img, x - 5, BTOP - 3, 11, 3, 4); Pix.fill(img, x - 5, BTOP - 4, 11, 1, 5);
    }
    // ground: trodden ash, darker toward the bottom edge
    for (y = BTOP; y < H; y++) {
      fy = y - BTOP;
      for (x = 0; x < W; x++) {
        c = fy === 0 ? (rnd(x >> 1, 0, 26) < 0.35 ? 14 : 15) : fy < 5 ? 15 : fy < 7 ? (dth(x, y, 2) ? 15 : 1) : 1;
        if (fy > 0 && fy < 5 && rnd(x >> 1, y, 27) < 0.05) c = 14;
        img.d[y * W + x] = c;
      }
    }
    // the fallen column the Rival sits on, the bell, an ash mound around it
    Pix.blit(img, Pix.parse(FALLEN), 116, BTOP - 11);
    // firelight: three flat bands of warm remap around the bell mouth
    var out = Pix.clone(img), v, row, st;
    for (y = BTOP - 60; y < BTOP + 22; y++) for (x = 20; x < 160; x++) {
      a = (x - 90) / 62; d = (y - (BTOP - 12)) / (y > BTOP - 12 ? 26 : 44);
      v = 1 - Math.sqrt(a * a + d * d);
      if (v <= 0) continue;
      v *= 3.3; row = FIRELIT[img.d[y * W + x]];
      if (!row) continue;
      st = v < 0.5 ? 0 : v < 0.7 ? (dth(x, y, 2) ? 1 : 0) : v < 1.4 ? 1 : v < 1.6 ? (dth(x, y, 2) ? 2 : 1) : v < 2.3 ? 2 : v < 2.5 ? (dth(x, y, 2) ? 3 : 2) : 3;
      if (st) out.d[y * W + x] = row[st - 1];
    }
    Pix.blit(out, Pix.parse(BELL), BELL_X, BTOP - 23);
    for (x = 66; x < 114; x++) {                                             // ash banked against the bell
      n = Math.round(2.2 - Math.abs(x - 90) / 14 + rnd(x >> 1, 3, 28) * 1.5);
      for (k = 0; k < n; k++) out.d[(BTOP - 1 - k) * W + x] = k === n - 1 ? (Math.abs(x - 90) < 16 ? 13 : 14) : (Math.abs(x - 90) < 14 ? 14 : 15);
    }
    return out;
  }
  function bonfire() {
    var i, f, img, gl, x, y, d, bell = Pix.parse(BELL);
    if (bon) return bon;
    img = buildBonfire();
    bon = { img: img, cv: bake(img), fire: [], fireImg: [], glow: [], glowImg: [] };
    for (i = 0; i < 6; i++) {
      f = Pix.parse(FIRE[i % 3]);
      if (i >= 3) f = Pix.flipX(f);
      bon.fireImg.push(f); bon.fire.push(bake(f));
    }
    for (i = 0; i < 2; i++) {                                               // glow: the lit rim of the breach flares and settles
      gl = Pix.make(40, 30);
      for (y = 0; y < bell.h; y++) for (x = 0; x < bell.w; x++) {
        d = bell.d[y * bell.w + x];
        if (d === 25 && i === 0) gl.d[(y + 6) * 40 + x + 3] = 21;
        else if (d === 21) gl.d[(y + 6) * 40 + x + 3] = i === 0 ? 22 : 21;
      }
      bon.glowImg.push(gl); bon.glow.push(bake(gl));
    }
    return bon;
  }
  function drawBonfire(g, t, opts, E) {
    var b = bonfire(), floorY = Math.round(opts && opts.floorY > 0 ? opts.floorY : (E.lay ? E.lay.floorY : 172)), y0 = floorY - BTOP, H = E.H;
    var fr = Math.floor(t * 10) % 6;
    if (b.cv) g.drawImage(b.cv, 0, y0);
    g.fillStyle = P[1];
    if (y0 > 0) g.fillRect(0, 0, W, y0);
    if (floorY + BBOT < H) g.fillRect(0, floorY + BBOT, W, H - floorY - BBOT);
    if (b.glow[0]) g.drawImage(b.glow[fr % 3 === 0 ? 1 : 0], BELL_X - 3, floorY - 29);
    if (b.fire[0]) g.drawImage(b.fire[fr], 82, floorY - 17);
  }

  // ============================================================================================
  // Title: near-black ash, one candle
  // ============================================================================================
  var TTOP = 250, TBOT = 190, CANDLE_X = 133;
  var ttl = null;
  function buildTitle() {
    var H = TTOP + TBOT, img = Pix.make(W, H), x, y, fy, c, top, v, row, st, a, d;
    for (y = 0; y < H; y++) {
      fy = y - TTOP;
      for (x = 0; x < W; x++) {
        top = Math.round(Math.sin(x / 17) * 1.4 + Math.sin(x / 5.3 + 1) * 0.7 + (x > 50 && x < 128 ? -1.5 : 0));   // dune line
        if (fy < top) {
          c = fy >= Math.round(-6 + Math.sin(x / 23 + 2) * 2 + Math.sin(x / 9) * 0.8) ? 2 : 1;      // far drifts, one step off black
        } else {
          d = fy - top;
          c = d === 0 ? (rnd(x >> 1, 1, 31) < 0.4 ? 4 : 3) : d < 9 ? 3 : d < 11 ? (dth(x, y, 2) ? 3 : 2) : d < 30 ? 2 : d < 32 ? (dth(x, y, 2) ? 2 : 1) : 1;
          if (d > 1 && d < 9 && rnd(x, y, 33) < 0.03) c = rnd(x, y, 34) < 0.3 ? 5 : 4;              // flecks
        }
        img.d[y * W + x] = c;
      }
    }
    // the mask's shadow, thrown away from the candle
    for (y = TTOP - 1; y < TTOP + 5; y++) for (x = 52; x < 80; x++) {
      a = (x - 67) / 12; d = (y - TTOP - 1) / 3;
      if (a * a + d * d < 1 && (a * a + d * d < 0.5 || dth(x, y, 2))) img.d[y * W + x] = 1;
    }
    // candlelight on the ash
    var WARM_T = { 1: [1, 1, 15], 2: [2, 15, 15], 3: [15, 14, 14], 4: [14, 14, 13], 5: [13, 13, 12] }, out = Pix.clone(img);
    for (y = TTOP - 30; y < TTOP + 16; y++) for (x = CANDLE_X - 40; x < W; x++) {
      a = (x - CANDLE_X) / 38; d = (y - (TTOP - 6)) / (y > TTOP - 6 ? 18 : 24);
      v = (1 - Math.sqrt(a * a + d * d)) * 3.2;
      if (v <= 0) continue;
      row = WARM_T[img.d[y * W + x]]; if (!row) continue;
      st = v < 0.5 ? 0 : v < 0.7 ? (dth(x, y, 2) ? 1 : 0) : v < 1.4 ? 1 : v < 1.6 ? (dth(x, y, 2) ? 2 : 1) : v < 2.3 ? 2 : v < 2.5 ? (dth(x, y, 2) ? 3 : 2) : 3;
      if (st) out.d[y * W + x] = row[st - 1];
    }
    // the candle: a fat stub leaning in the ash, wax run down one side
    Pix.fill(out, CANDLE_X - 2, TTOP - 4, 5, 6, 11); Pix.fill(out, CANDLE_X + 1, TTOP - 4, 2, 6, 12);
    Pix.fill(out, CANDLE_X - 2, TTOP - 4, 3, 1, 10); Pix.set(out, CANDLE_X - 2, TTOP - 3, 10); Pix.set(out, CANDLE_X - 2, TTOP - 2, 10);
    Pix.set(out, CANDLE_X - 3, TTOP - 1, 11); Pix.set(out, CANDLE_X - 3, TTOP, 11); Pix.set(out, CANDLE_X - 3, TTOP + 1, 12);
    Pix.set(out, CANDLE_X, TTOP - 5, 1);
    Pix.fill(out, CANDLE_X - 4, TTOP + 2, 9, 1, 13); Pix.fill(out, CANDLE_X - 3, TTOP + 3, 7, 1, 14);
    return out;
  }
  function drawTitle(g, t, opts, E) {
    var floorY = Math.round(opts && opts.floorY > 0 ? opts.floorY : Math.round(E.H * 0.56)), y0 = floorY - TTOP, H = E.H, fr, i, x, y;
    if (!ttl) { ttl = { img: buildTitle(), cv: null }; ttl.cv = bake(ttl.img); }
    flames();
    if (ttl.cv) g.drawImage(ttl.cv, 0, y0);
    g.fillStyle = P[1];
    if (y0 > 0) g.fillRect(0, 0, W, y0);
    if (floorY + TBOT < H) g.fillRect(0, floorY + TBOT, W, H - floorY - TBOT);
    for (i = 0; i < 9; i++) {                                               // motes hanging in the warm air
      y = floorY - 6 - ((i * 23 + t * (3 + (i % 4))) % 70);
      x = CANDLE_X - 46 + ((i * 41) % 84) + Math.sin(t * 0.5 + i * 2.1) * 3;
      g.fillStyle = P[i % 3 === 0 ? 13 : 5]; g.fillRect(x | 0, y | 0, 1, 1);
    }
    fr = h32(1, Math.floor(t / 0.14), 5) % 3;
    if (glowCv[0]) g.drawImage(glowCv[0], CANDLE_X - 5, floorY - 13);
    if (flameCv[0]) g.drawImage(flameCv[fr], CANDLE_X - 2, floorY - 11);
  }

  // ============================================================================================
  // Public API
  // ============================================================================================
  // name: 'cathedral' | 'bonfire' | 'title'. t = seconds. Paints the whole buffer.
  // opts: { floorY, variant:1..7, gutter:0..1, snuffed:0..7, phase2:bool, arena:'cathedral'|'blood_moon'|'pale_dawn' }
  function bg(g, name, t, opts) {
    var E = dims();
    t = t > 0 ? t : 0;
    if (name === 'bonfire') drawBonfire(g, t, opts, E);
    else if (name === 'title') drawTitle(g, t, opts, E);
    else drawCathedral(g, t, opts, E);
  }
  // Foreground layer drawn over the fighters (cathedral only).
  function fg(g, name, t, opts) {
    if (name !== 'cathedral') return;
    drawFg(g, t > 0 ? t : 0, opts, dims());
  }

  R.Art = R.Art || {};
  R.Art.bg = bg;
  R.Art.fg = fg;
  R.Art.inits = R.Art.inits || [];
  R.Art.inits.push(function () { flames(); cathedral(1, 'cathedral', false); bonfire(); if (!ttl) { ttl = { img: buildTitle(), cv: null }; ttl.cv = bake(ttl.img); } if (!fgImg) { fgImg = buildFg(); fgCv = bake(fgImg); } });
})(globalThis.RIVAL = globalThis.RIVAL || {});
