// SHOW ME MY RIVAL — icons, sigils and menu sprites (DESIGN 13.5). Loads after sprites.js and replaces its
// placeholder R.Art.sprite / R.Art.sigil. Everything is palette-indexed pixel rows (R.Pix.parse); canvases are
// baked lazily, one per sprite, the first time it is drawn (and all at once from R.Art.init).
//
// Pixel rows: '.' = transparent, '1'-'9' = palette 1-9, 'a'-'v' = palette 10-31
//   1 void  2 crypt  3 night stone  4 slate  5 cold stone  6 worn stone  7 ash blue  8 pale ash  9 steel
//   a bone white  b bone  c parchment  d dust brown  e umber  f char  g dried blood  h wine  i blood red  j fresh red
//   k ember  l candle amber  m flame core  n white-hot  o brass dark  p brass  q deep teal  r cold teal  s moon blue
//   t bruise violet  u feint violet  v witchfire
(function (R) {
  'use strict';

  var Pix = R.Pix;

  // ============================================================================================
  // Move icons — each readable by shape alone: Strike = diagonal blade, Guard = kite shield with a
  // vertical bar, Feint = crescent with a three-dot trail.
  // ============================================================================================
  var SRC = {
    icon_S: [
      '.........j',
      '.......ij.',
      '......98..',
      '.....98...',
      '....98....',
      '.p.98.....',
      '..p8......',
      '.d.p......',
      'd...p.....',
      '..........'
    ],
    icon_G: [
      '.ssssssss.',
      'srrrssrrrq',
      'srrrssrrrq',
      'srrrssrrrq',
      'srrrssrrrq',
      '.srrssrrq.',
      '.srrssrrq.',
      '..srssrq..',
      '...rssq...',
      '....sq....'
    ],
    icon_F: [
      '...uuu....',
      '.uuut.....',
      'uuut......',
      'uut.......',
      'uut..u.u.t',
      'uut.......',
      'uuut......',
      '.uuut.....',
      '...uuu....',
      '..........'
    ],
    icon_S_big: [
      '.................jn.',
      '................jjj.',
      '...............ijj..',
      '..............98i...',
      '.............987....',
      '............987.....',
      '...........987......',
      '..........987.......',
      '.........987........',
      '........987.........',
      '..pp...987..........',
      '..opp.987...........',
      '...opp87............',
      '....opp.............',
      '...deopp............',
      '..de..opp...........',
      '.de....op...........',
      'pp..................',
      'op..................',
      '....................'
    ],
    icon_G_big: [
      '..qqqqqqqqqqqqqqqq..',
      '.qssssssssssssssssq.',
      '.qsrrrrrssssrrrrrrq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '.qsrrrrrssssrrrrrqq.',
      '..qsrrrrssssrrrrqq..',
      '..qsrrrrssssrrrrqq..',
      '...qsrrrssssrrrqq...',
      '...qsrrrssssrrrqq...',
      '....qsrrssssrrqq....',
      '.....qsrssssrqq.....',
      '......qsssssqq......',
      '.......qsssqq.......',
      '........qsqq........',
      '.........qq.........'
    ],
    icon_F_big: [
      '....................',
      '.......uuuuu........',
      '.....uuuuut.........',
      '....uuuut...........',
      '...uuuut............',
      '..uuuut.............',
      '..uuut..............',
      '.uuuut..............',
      '.uuut...............',
      '.uuut.....uu..uu..tt',
      '.uuut.....uu..uu..tt',
      '.uuut...............',
      '.uuuut..............',
      '..uuut..............',
      '..uuuut.............',
      '...uuuut............',
      '....uuuut...........',
      '.....uuuuut.........',
      '.......uuuuu........',
      '....................'
    ],
    mini_S: [
      '.....j',
      '....9.',
      '...9..',
      'p.9...',
      '.p....',
      'd.p...'
    ],
    mini_G: [
      'ssssss',
      'srssrq',
      'srssrq',
      '.rssq.',
      '.rssq.',
      '..sq..'
    ],
    mini_F: [
      '..uu..',
      '.u....',
      'u..u.u',
      'u.....',
      '.u....',
      '..uu..'
    ],

    // ---- statuses 8x8 ------------------------------------------------------------------------
    st_guardBroken: [
      'sss.....',
      'srr.rrq.',
      'srr..rrq',
      'sr.j.rrq',
      'srr..rrq',
      '.sr.rrq.',
      '..s.rq..',
      '....q...'
    ],
    st_bleed: [
      '...j....',
      '...ij...',
      '..jii...',
      '..jiii..',
      '.jiiiig.',
      '.jniiig.',
      '.iiiiig.',
      '..iigg..'
    ],
    st_fortify: [
      '88888887',
      '86666665',
      '86666665',
      '75555554',
      '887.8887',
      '665.8665',
      '665.8665',
      '554.7554'
    ],
    st_focus: [
      '....l...',
      '...lm...',
      '.llmmll.',
      'lmn11nml',
      'lmn11nml',
      '.llmmll.',
      '...ll...',
      '........'
    ],
    st_sealed: [
      '..hhh...',
      '.hihhhh.',
      'hihhhhhg',
      'hhhgghhg',
      'hhhgghhg',
      '.hhhhhg.',
      '..hhgg..',
      '...hg...'
    ],
    lock: [
      '..8998..',
      '.8....7.',
      '.8....7.',
      'pmpppppo',
      'ppp11ppo',
      'ppp11poo',
      'pppp1poo',
      '.oooooo.'
    ],

    // ---- active boons 12x12 ------------------------------------------------------------------
    act_glimpse: [
      '...pppppp...',
      '..pmmpppppo.',
      '.pmp1111ppo.',
      '.pp111111po.',
      '.pp111s11po.',
      '.pp111111po.',
      '.ppp1111ppo.',
      '.pppp11pppo.',
      '.pppp11pppo.',
      '.ppp1111poo.',
      '..pp1111oo..',
      '...oooooo...'
    ],
    act_honesty: [
      '.....l......',
      '....lml.....',
      '...lmnml....',
      '...lmnml....',
      '....lml.....',
      '.....1......',
      '....aabc....',
      '....aabc....',
      '...aaabc....',
      '....aabc....',
      '..oppppppo..',
      '...oooooo...'
    ],
    act_coin: [
      '....pppp....',
      '..ppmmmmpp..',
      '.pmmppppppo.',
      '.pmppppppoo.',
      'pmppoppoppoo',
      'pmpppppppppo',
      'pmpppppppppo',
      'pppoppppoppo',
      '.pppoooopoo.',
      '.ppppppppoo.',
      '..ppoooooo..',
      '....oooo....'
    ],

    // ---- archetype tags 12x12 ----------------------------------------------------------------
    tag_RIP: [
      '............',
      '.sssssss..9.',
      '.srrrrrq.98.',
      '.srrrrrq98..',
      '.srrrrr98...',
      '.srrrr98....',
      '..srr98q....',
      '..sr98q.....',
      '..pp8q......',
      '.d.pp.......',
      'd...p.......',
      '............'
    ],
    tag_TEN: [
      '............',
      '.....l......',
      '....lml.....',
      '...lmnml....',
      '....lml.....',
      '..l..l..l...',
      '.lml...lml..',
      'lmnml.lmnml.',
      '.lml...lml..',
      '..l.....l...',
      '............',
      '............'
    ],
    tag_BLD: [
      '.....j......',
      '.....ij.....',
      '....jii.....',
      '....jiii....',
      '...jiiii....',
      '...jiiiii...',
      '..jiiiiiig..',
      '..jniiiiig..',
      '..jniiiiig..',
      '..iiiiiigg..',
      '...iiiigg...',
      '....iggg....'
    ],
    tag_TRK: [
      '...uuuu.....',
      '.uuut.......',
      '.uut..aaaa..',
      'uut..aaaaab.',
      'uu...a1aa1b.',
      'uu...aaaaab.',
      'uu...iaaaib.',
      'uut..biiibb.',
      '.uut..abbb..',
      '.uuut.......',
      '...uuuu.....',
      '............'
    ],
    tag_GMB: [
      '............',
      '..aaaaaaab..',
      '.aaaaaaaabc.',
      '.aa11aa11bc.',
      '.aa11aa11bc.',
      '.aaaa11aabc.',
      '.aaaa11aabc.',
      '.aa11aa11bc.',
      '.aa11aa11bc.',
      '.abbbbbbbbc.',
      '..ccccccccc.',
      '............'
    ],
    tag_INF: [
      '............',
      '............',
      '....ssss....',
      '..ssaaaass..',
      '.saaarraaas.',
      'saaar11raaas',
      'saaar11raaas',
      '.saaarraaas.',
      '..ssaaaass..',
      '....ssss....',
      '............',
      '............'
    ],
    tag_CHA: [
      '............',
      '...kkkkkk...',
      '..kk....kk..',
      '.kk..ll..kk.',
      '.k..l..l..k.',
      '.k.l.mm.l.k.',
      '.k.l.m..l.k.',
      '.k.ll..ll.k.',
      '.kk.llll.kk.',
      '..kk.....k..',
      '...kkkk.....',
      '............'
    ],
    tag_EXE: [
      '.......de...',
      '..998..de...',
      '.99888.de...',
      '.9888877e...',
      '99888877e...',
      '9988887de...',
      'j9888..de...',
      '.j98...de...',
      '..j....de...',
      '.......de...',
      '.......de...',
      '.......de...'
    ],
    tag_relic: [
      '.....pp.....',
      '....pmmp....',
      '...pmppop...',
      '..pmppppop..',
      '.pppppppppo.',
      '.oooooooooo.',
      '.pm1pjjp1po.',
      '.pp1pjip1po.',
      '.pp1pppp1po.',
      '.pp1pppp1po.',
      '.pppppppppo.',
      '.oooooooooo.'
    ],

    // ---- rarity pips --------------------------------------------------------------------------
    rar_common: [
      '.7.',
      '787',
      '.7.'
    ],
    rar_uncommon: [
      '.p...p.',
      'pmp.pmp',
      '.p...p.'
    ],
    rar_rare: [
      '.u...u...u.',
      'uau.uau.uau',
      '.u...u...u.'
    ],

    // ---- mask previews 12x14 ------------------------------------------------------------------
    mask_porcelain: [
      '...aaaaaa...',
      '..aaaaaaab..',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.a111aa111b.',
      '.aaaaaaaabb.',
      '.aaaaabaabb.',
      '.aaaaabaabb.',
      '.iaaaaaaaib.',
      '.aiiiiiiiab.',
      '..aaaaaabb..',
      '...aaaabb...',
      '....bbbb....'
    ],
    mask_mourner: [
      '...aaaaaa...',
      '..aaaaaaab..',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.a111aa111b.',
      '.aaaaaaasbb.',
      '.aaaaabasbb.',
      '.aaaaabaabb.',
      '.aaaaaaasab.',
      '.aaiiiiiabb.',
      '..iaaaaaib..',
      '...aaaabb...',
      '....bbbb....'
    ],
    mask_jester: [
      '...411aaa...',
      '..4111aaab..',
      '.41111aaaab.',
      '.41111aaaab.',
      '.41a11aaaab.',
      '.4aaa1a111b.',
      '.41a11aaabb.',
      '.41111aaabb.',
      '.41111aaabb.',
      '.i1111aaaib.',
      '.4iiiiiiiab.',
      '..4111aabb..',
      '...411abb...',
      '....44bb....'
    ],
    mask_kintsugi: [
      '...aaapaa...',
      '..aaaapaab..',
      '.aaaapaaaab.',
      '.aaaapaaaab.',
      '.aaaaapaaab.',
      '.a111pa111b.',
      '.aaaaapaabb.',
      '.aaaaappabb.',
      '.aaaapbaapb.',
      '.iaaapaaaib.',
      '.aiiiiiiiab.',
      '..aapaaabb..',
      '...apaabb...',
      '....bbbb....'
    ],
    mask_blank: [
      '...aaaaaa...',
      '..aaaaaaab..',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.aaaaaaaaab.',
      '.aaaaaaaabb.',
      '.aaaaaaaabb.',
      '.aaaaabaabb.',
      '.aaaaabaabb.',
      '.aaaaaaabbb.',
      '.aaaaaaabbb.',
      '..aaaaabbb..',
      '...aaabbb...',
      '....bbbb....'
    ],

    // ---- bonfire: the Ashen, seated, sword across the knees (faces right, toward the fire) -------
    bonfire_player: [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '............fff.................',
      '..........ffeeeff...............',
      '.........feeeeeeef..............',
      '........feeeeeeeeed.............',
      '........feeeeeeeeeed............',
      '.......feeeeee1111ed............',
      '.......feeeee111111d............',
      '.......feeeee111111d............',
      '.......feeeeee11118d............',
      '.......ffeeeeee111d.............',
      '......fffeeeeeeeeed.............',
      '.....ffeefeeeeeeeeed............',
      '....ffeeefeeeeeeeeeed...........',
      '....feeeeffeeeeeeeeeed..........',
      '...ffeeeeefeeeeeebbbed..........',
      '...feeeeeeffeeeecbbbbbd.........',
      '...feeeeeeeffeeeeecbbcbb........',
      '..ffeeeeeeeefffeeeeeebbcd.......',
      '..feeeeeeeeeeeopp99999999999998.',
      '..feeeeeeeeeeeeo.8888888888888..',
      '..feeeeeeeeeeeeedddddddddd......',
      '.ffeeeeeeeeeeeeeeeeeeeeeeddd....',
      '.feeeeefeeeeeeeeeeeeeeeeeeedd...',
      '.feefeefeeffeeeeeeeeefffeeeed...',
      'ffeeffeffeffeeeeeeffffeeeeeed...',
      'fe.ef.fe.fffeeefffff..ccdcdd....',
      'f..f..f...ffffff......cccdd.....'
    ],

    // ---- bonfire: the Rival on a toppled pillar, legs crossed, hands to the fire (faces left) -----
    bonfire_rival: [
      '..............hh................',
      '...........aaaaahh..............',
      '..........aaaaaabhh.............',
      '.........aaaaaaabhh.............',
      '.........a1aa1aabhg.............',
      '.........aaaaaaabhg.............',
      '.........iaaaaiabhg.............',
      '..........iiiiabbhg.............',
      '..........aaaabbhhg.............',
      '...........abbhhhhgg............',
      '...........ihhphhhhg............',
      '..........ihhhhhhhhgg...........',
      '.........ihhhhhhhhhhg...........',
      '...11.44ihhhhhhhhhhhgg..........',
      '..1114444hhhhhhhhhhhhg..........',
      '...11.44hhhghhhhhhhhhg..........',
      '.........ihhghhhhhhhhgg.........',
      '.........ihhhghhhhhhhhg.........',
      '........ihhhhhghhhhhhhg.........',
      '.....5544444hhhghhhhhhgg........',
      '...544444444444hhhhhhhhg........',
      '...4444444444444hhhhhhgg........',
      '...4444..33444.ghhhhggg.........',
      '....444....444..gggg............',
      '....4444...444..................',
      '.....444...444..................',
      '.....4444..444..................',
      '......444..444..................',
      '....11444.1444..................',
      '....1111.11111..................',
      '................................',
      '................................'
    ]
  };

  // ---- the title mask (64x64): porcelain, tilted in the ash; candle on its right ------------------
  SRC.title_mask = [
    '................................................................',
    '................................................................',
    '................................dcccccb.........................',
    '............................ddcccccccbbcccb.....................',
    '..........................ddccccccbbbbaaaaacb...................',
    '........................ddcccccbbbbbbaaaaaaaacb.................',
    '.......................dcccccbbbbbbbaaaaaaaaaabdb...............',
    '.....................ddccccbbbbbbbbaaaaaaaaaaadabb..............',
    '....................dcccccbbbbbbbbaaaaaaaaaaaacaabb.............',
    '...................dcccccbbbbbbbbaaaaaaaaaaaacaaaabb............',
    '...................dccccbbbbbbbbaaaaaaaaaaaaacaaaaabb...........',
    '..................dccccbbbbbbbbaaaaaaaaaaaaacaaaaacabb..........',
    '.................dccccbbbbbbbbaaaaaaaaaaaaaaacaaccaaab..........',
    '.................dcccbbbbbbbbbaaaaaaaaaaaaaaaadcaaaaaab.........',
    '................dccccbbbbbbbbaaaaaaaaaaaaaaaaacaaaaaaab.........',
    '................dcccbbbbbbbbbaaaaaaaaaaaaaaaacaaaaaaaaam........',
    '...............dccccbbbbbbbbaaaaaaaaaaaaaaaacaaaaaaaaaam........',
    '...............dcccbbbbbbbbaaaaaaaaaaaaaaaaacaaaaaaaaaam........',
    '...............dcccbbbbbbbaaaaaaaaaaaaaaaaacaaaaaaaaaaaam.......',
    '...............dccbbbbbbaaaaaaaaaaaaaaaaaaaccaaaaaaaaaaam.......',
    '..............dcccbbbbaaaaaaaaaaaaaaaaaaaacaacaaaaaaaaaam.......',
    '..............dcccbbcccccaaaaaaaaaaaaaaaaaaaadaaaaaaaaaam.......',
    '..............dccbbc1111ccccbbbaaaaaaaaaaaaaaadaaaaaaaaam.......',
    '..............dccbb11111111cccbbaaaaaaaaaaaaaacaaaaaaaaam.......',
    '..............dccbbb111111111ccbbaaaaaaaaaaaadaaaaaaaaaam.......',
    '..............dcccbbbbb1111111ccbaaaaaaaaaaaadaaaaaaaaaam.......',
    '.............dccccbbbbbbbb11111cbbaaaaaacccccccaaaaaaaaam.......',
    '.............dccccbbbbbbbbbbb111bbaaaacc111111cccaaaaaaam.......',
    '.............dccccbbbbbbbbbbbbbbbbaaaa11111111111ccaaaaam.......',
    '.............dccccbbbbbbbbaaaabbbbaaaa111111111111caaaam........',
    '.............dccccbbbbbbbaaaaabbbbaaaaaaaaaa1111111aaaam........',
    '.............dccccbbbbbbaaaaaabbbaaaaaaaaaaaaaadaaaaaaal........',
    '.............dcchcbbbbbbaaaaaabbbaaaaaaaaaaaaaaacaaaaaal........',
    '.............dcchcbbbbbaaaaaabbbbaaaaaaaaaaaaaaacaaaaal.........',
    '.............dccccbbbbbaaaaaabbbbaaaaaaaaaaaaaacaaaaaal.........',
    '.............dcccibbbbbaaaaaabbbaaaaaaaaaaaaaaacaaaaaal.........',
    '.............dcccibbbbbaaaaaabbbaaaaaaaaaaaaaaaacaaaal..........',
    '.............dccccibbbbaaaaaabbbaaaaaaaaaaaaaaaaacaaal..........',
    '..............dcccibbbbaaaaaaabaaaaaaaaaaaaaaaaaaaaaal..........',
    '..............dccciibbbaaaaaaaaaaaaaaaaaaaaaaaaaahaal...........',
    '..............dcccbijbbaaaaaaaaaaaaaaaaaaaaaaaaahaaal...........',
    '..............dcccbbijjaaaaaaaaaaaaaaaaaaaaaaaaiaaal............',
    '..............dcccbbbiijaaaaaaaaaaaaaaaaaaaaaaiaaaal............',
    '...............dccbbbbiijjaaaaaaaaaaaaaaaaaaaiaaaal.............',
    '...............dcccbbbbiijjaaaaaaaaaaaaaaaaiiaaaaal.............',
    '...............dcccbbbbaiiijjjaaaaaaaaajjjiiaaaaal..............',
    '................dccbbbbbaaiiiijjjjjjjjjiiiaaaaaal...............',
    '................dcccbbbbaaaaiiiiiiiiiiiiaaaaaaaal...............',
    '.................dccbbbbaaaaaaaaaaaaaaaaaaaaaaal................',
    '.................dccbbbbaaaaaaaaaaaaaaaaaaaaaal.................',
    '..................dccbbbbaaaaaaaaaaaaaaaaaaaal..................',
    '..................dccbbbbaaaaaaaaaaaaaaaaaaal...................',
    '...................dccbbbaaaaaaaaaaaaaaaaaal....................',
    '....................dccbbbaaaaaaaaaaaaaaaal.....................',
    '....................dccbbbaaaaaaaaaaaaaaal......................',
    '.....................dccbbaaaaaaaaaaaaall.......................',
    '.....................55656aaaaaaaaaaall.........................',
    '..................5564444465565aaaal55555.......................',
    '...............665444444544444456555444455555d..................',
    '............5554444443334344444444455444444444555d55............',
    '............4444443333333334333444443343354444444444d555........',
    '............44433433333333333333334343333333334444444444........',
    '............33333333333333333333333333333333333333434444........',
    '............34333333343333333433333334333333343333333333........'
  ];
  // frame 1: the painted smile is one pixel wider at each end (the title's idle gag)
  var SMILE_WIDER = [[16, 31, 17], [15, 30, 16], [50, 38, 17], [51, 37, 16]];

  // ---- logo lettering (hand-drawn serif capitals, 22 px; the I is a blade) ------------------------
  var LET = {
    R: [
      'aaaaaaaaaaaaaaa.......',
      '.aaaaaaaaaaaaaaaa.....',
      '...aaaa.....aaaaaa....',
      '...aaaa......aaaaa....',
      '...aaaa.......aaaa....',
      '...aaaa.......aaaa....',
      '...aaaa.......aaaa....',
      '...aaaa.......aaaa....',
      '...aaaa......aaaaa....',
      '...aaaa.....aaaaa.....',
      '...aaaaaaaaaaaaa......',
      '...aaaaaaaaaaa........',
      '...aaaa..aaaa.........',
      '...aaaa...aaaa........',
      '...aaaa....aaaa.......',
      '...aaaa.....aaaa......',
      '...aaaa......aaaa.....',
      '...aaaa.......aaaa....',
      '...aaaa........aaaa...',
      '...aaaa.........aaaa..',
      '.aaaaaaaa........aaaaa',
      'aaaaaaaaaa........aaaa',
      '...................aa.'
    ],
    I: [
      'aaaaaaaaaa',
      '.aaaaaaaa.',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '...aaaa...',
      '....aaa...',
      '....aa....',
      '....aa....',
      '....a.....'
    ],
    V: [
      'aaaaaaaaaa.....aaaaaaaaa',
      '.aaaaaaaa.......aaaaaaa.',
      '..aaaaa............aa...',
      '..aaaaa............aa...',
      '...aaaaa..........aa....',
      '...aaaaa..........aa....',
      '....aaaaa.........aa....',
      '....aaaaa........aa.....',
      '.....aaaaa.......aa.....',
      '.....aaaaa.......aa.....',
      '......aaaaa.....aa......',
      '......aaaaa.....aa......',
      '.......aaaaa....aa......',
      '.......aaaaa...aa.......',
      '........aaaaa..aa.......',
      '........aaaaa..aa.......',
      '.........aaaaaaa........',
      '.........aaaaaaa........',
      '..........aaaaa.........',
      '..........aaaaa.........',
      '...........aaa..........',
      '...........aaa..........',
      '............a...........'
    ],
    A: [
      '...........a............',
      '..........aaa...........',
      '..........aaaa..........',
      '.........aaaaa..........',
      '.........aaaaaa.........',
      '........aaaaaaa.........',
      '........aa.aaaaa........',
      '.......aa..aaaaa........',
      '.......aa...aaaaa.......',
      '......aa....aaaaa.......',
      '......aa.....aaaaa......',
      '.....aa......aaaaa......',
      '.....aa......aaaaa......',
      '....aaaaaaaaaaaaaaa.....',
      '....aaaaaaaaaaaaaaa.....',
      '...aa..........aaaaa....',
      '...aa..........aaaaa....',
      '..aa............aaaaa...',
      '..aa............aaaaa...',
      '..aa............aaaaa...',
      '.aaaaaa.......aaaaaaaaa.',
      'aaaaaaaa.....aaaaaaaaaaa'
    ],
    L: [
      'aaaaaaaaaa........',
      '.aaaaaaaa.........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa...........',
      '...aaaa..........a',
      '...aaaa..........a',
      '...aaaa.........aa',
      '...aaaa.........aa',
      '...aaaa........aaa',
      '.aaaaaaaaaaaaaaaaa',
      'aaaaaaaaaaaaaaaaaa'
    ]
  };
  // small caps for "SHOW ME MY" (5x7, ash)
  var SM = {
    S: ['.888.', '8...8', '8....', '.888.', '....8', '8...8', '.888.'],
    H: ['8...8', '8...8', '8...8', '88888', '8...8', '8...8', '8...8'],
    O: ['.888.', '8...8', '8...8', '8...8', '8...8', '8...8', '.888.'],
    W: ['8...8', '8...8', '8...8', '8.8.8', '8.8.8', '88.88', '8...8'],
    M: ['8...8', '88.88', '8.8.8', '8.8.8', '8...8', '8...8', '8...8'],
    E: ['8888', '8...', '8...', '888.', '8...', '8...', '8888'],
    Y: ['8...8', '8...8', '.8.8.', '..8..', '..8..', '..8..', '..8..']
  };

  // ---- sigil (16x16): a wax seal stamped with a glyph ------------------------------------------
  var SEAL = [
    '.....gggggg.....',
    '...gghhhhhhgg...',
    '..ghiihhhhhhhg..',
    '.ghihhhhhhhhhhg.',
    '.ghhhhhhhhhhhhg.',
    'ghhhhhhhhhhhhhhg',
    'ghhhhhhhhhhhhhgg',
    'ghhhhhhhhhhhhhgg',
    'ghhhhhhhhhhhhhgg',
    'ghhhhhhhhhhhhhgg',
    'ghhhhhhhhhhhhggg',
    '.ghhhhhhhhhhhgg.',
    '.ghhhhhhhhhhggg.',
    '..gghhhhhhgggg..',
    '...gggggggggg...',
    '.....gggggg.....'
  ];
  // the Rival's stamp: its mask (raised, catching the light); 8x8 placed at (4,4)
  var GLYPH_R = [
    '..iiii..',
    '.iiiiii.',
    '.igiigig',
    '.iiiiiig',
    '.giiiigg',
    '.iggggig',
    '..iiiig.',
    '...gggg.'
  ];
  // the player's stamp: the hood
  var GLYPH_P = [
    '..iiii..',
    '.iiiiii.',
    '.iiggiig',
    '.iggggig',
    '.iggggig',
    '.iiggiig',
    '.iiiiiig',
    '..gggggg'
  ];
  var WAX_P = { 16: 5, 17: 7, 18: 8, 19: 9 };                 // wine wax -> ash wax (the player's seal)
  var RING = [
    '.....AAAAAA.....',
    '....A222222A....',
    '...2222222222...',
    '.A222222222222B.',
    '.A222222222222B.',
    'A22222222222222B',
    'A22222222222222B',
    'A22222222222222B',
    'A22222222222222B',
    'A22222222222222B',
    'A22222222222222B',
    '.A222222222222B.',
    '.A222222222222B.',
    '...2222222222...',
    '....B222222B....',
    '.....BBBBBB.....'
  ];
  // the crack runs top to bottom through these columns (one per row)
  var CRACK_X = [8, 8, 7, 7, 8, 9, 8, 7, 7, 8, 9, 9, 8, 7, 8, 8];

  // ============================================================================================
  var IMG = {};
  (function build() {
    var k, i, j, x, y, img, o, c;
    for (k in SRC) IMG[k] = Pix.parse(SRC[k]);

    // disabled move icons: desaturated to stone (5 / 6, darkest parts 4)
    var OFF = [0, 4, 4, 4, 4, 5, 6, 6, 6, 6, 6, 6, 6, 5, 5, 4, 4, 4, 5, 5, 6, 6, 6, 6, 5, 5, 4, 5, 6, 4, 5, 6];
    ['icon_S', 'icon_G', 'icon_F', 'icon_S_big', 'icon_G_big', 'icon_F_big', 'mini_S', 'mini_G', 'mini_F'].forEach(function (n) {
      IMG[n + '_off'] = Pix.remapped(IMG[n], OFF);
    });

    // title mask, frame 1
    img = Pix.clone(IMG.title_mask);
    for (i = 0; i < SMILE_WIDER.length; i++) Pix.set(img, SMILE_WIDER[i][0], SMILE_WIDER[i][1], SMILE_WIDER[i][2]);
    IMG['title_mask#1'] = img;

    // logo: 120x38. "SHOW ME MY" (ash) over "RIVAL" (bone) over a blood underline that drips once.
    img = Pix.make(120, 38);
    var words = ['SHOW', 'ME', 'MY'], w = 0, g;
    for (i = 0; i < words.length; i++) { for (j = 0; j < words[i].length; j++) w += SM[words[i][j]][0].length + 3; w += 6; }
    x = (120 - (w - 9)) >> 1;
    for (i = 0; i < words.length; i++) {
      for (j = 0; j < words[i].length; j++) { g = Pix.parse(SM[words[i][j]]); Pix.blit(img, g, x, 0); x += g.w + 3; }
      x += 6;
    }
    var LX = { R: 8, I: 35, V: 49, A: 67, L: 94 };
    for (k in LX) Pix.blit(img, Pix.parse(LET[k]), LX[k], 9);
    // lower third of the capitals falls into shadow (bone), like the mask
    for (y = 27; y < 33; y++) for (x = 0; x < 120; x++) if (img.d[y * 120 + x] === 10 && (y > 28 || ((x + y) & 1))) img.d[y * 120 + x] = 11;
    Pix.fill(img, 5, 33, 110, 1, 18); Pix.fill(img, 4, 34, 112, 1, 18); Pix.fill(img, 6, 35, 108, 1, 17);
    Pix.set(img, 4, 34, 17); Pix.set(img, 115, 34, 17);
    Pix.set(img, 39, 35, 18); Pix.set(img, 39, 36, 18); Pix.set(img, 39, 37, 18);       // the drip, under the blade
    IMG.logo = img;

    // sigils: sealed (Rival wine / player ash), 3 crack frames each (24x24, drawn at -4,-4), open rings
    var seal = Pix.parse(SEAL), sr = Pix.clone(seal), sp = Pix.clone(seal);
    Pix.blit(sr, Pix.parse(GLYPH_R), 4, 4);
    Pix.blit(sp, Pix.parse(GLYPH_P), 4, 4);
    sp = Pix.remapped(sp, WAX_P);
    IMG.sigil_r = sr; IMG.sigil_p = sp;
    [['r', sr], ['p', sp]].forEach(function (e) {
      var s = e[1], f0 = Pix.make(24, 24), f1 = Pix.make(24, 24), f2 = Pix.make(24, 24), cx, part, dx, dy, half;
      // 0: hairline
      Pix.blit(f0, s, 4, 4);
      for (y = 0; y < 16; y++) if (Pix.get(s, CRACK_X[y], y)) Pix.set(f0, 4 + CRACK_X[y], 4 + y, 23);
      Pix.set(f0, 4 + CRACK_X[5] + 1, 9, 22); Pix.set(f0, 4 + CRACK_X[10] - 1, 14, 22);
      // 1: split, light leaking through the gap
      for (y = 0; y < 16; y++) {
        cx = CRACK_X[y];
        for (x = 0; x < 16; x++) {
          c = Pix.get(s, x, y); if (!c) continue;
          Pix.set(f1, 4 + x + (x < cx ? -1 : 1), 4 + y, c);
        }
        if (Pix.get(s, cx, y)) { Pix.set(f1, 4 + cx, 4 + y, 23); Pix.set(f1, 4 + cx - 1, 4 + y, y % 3 === 1 ? 23 : 22); }
      }
      Pix.set(f1, 4 + CRACK_X[7] - 2, 11, 22); Pix.set(f1, 4 + CRACK_X[8] + 1, 12, 22);
      // 2: six shards parting around a white-hot core
      for (y = 0; y < 16; y++) {
        cx = CRACK_X[y]; part = y < 5 ? 0 : y < 11 ? 1 : 2;
        for (x = 0; x < 16; x++) {
          c = Pix.get(s, x, y); if (!c) continue;
          half = x < cx ? -1 : 1;
          if (x === cx || (y === 5 || y === 10)) continue;              // the break lines are gone
          dx = half * (part === 1 ? 4 : 3); dy = part === 0 ? -2 : part === 2 ? 2 : 0;
          Pix.set(f2, 4 + x + dx, 4 + y + dy, c);
        }
      }
      Pix.fill(f2, 11, 9, 2, 6, 23); Pix.fill(f2, 9, 11, 6, 2, 23);
      Pix.fill(f2, 10, 10, 4, 4, 23); Pix.set(f2, 8, 12, 22); Pix.set(f2, 15, 11, 22); Pix.set(f2, 12, 7, 22); Pix.set(f2, 11, 16, 22);
      IMG['crack_' + e[0] + '0'] = f0; IMG['crack_' + e[0] + '1'] = f1; IMG['crack_' + e[0] + '2'] = f2;
    });
    var ring = RING.map(function (r) { return r.replace(/A/g, 'x').replace(/B/g, 'y'); });
    function ringOf(light, dark) {
      var ch = Pix.CHARS;
      return Pix.parse(ring.map(function (r) { return r.replace(/x/g, ch[light]).replace(/y/g, ch[dark]); }));
    }
    var MOVES = { S: [19, 18], G: [28, 27], F: [30, 29] };
    for (k in MOVES) {
      o = ringOf(MOVES[k][0], MOVES[k][1]);
      Pix.blit(o, IMG['icon_' + k], 3, 3);
      IMG['open_' + k] = o;
    }
    IMG.open_none = ringOf(7, 5);
  })();

  // ============================================================================================
  // Canvas cache + public API
  // ============================================================================================
  var CV = {};                                   // name -> canvas | null
  var VAR = {};                                  // name -> [variant key by frame*2+flip]
  function canvasOf(name) {
    var c = CV[name], img;
    if (c !== undefined) return c;
    img = IMG[name];
    if (!img && name.length > 2 && name.slice(-2) === '~f' && IMG[name.slice(0, -2)]) img = IMG[name] = Pix.flipX(IMG[name.slice(0, -2)]);
    if (!img) return (CV[name] = null);
    if (typeof document === 'undefined') return null;
    return (CV[name] = Pix.toCanvas(img));
  }
  function variant(name, frame, flip) {
    var row = VAR[name] || (VAR[name] = []), i = frame * 2 + (flip ? 1 : 0), k = row[i];
    if (k === undefined) {
      k = frame && IMG[name + '#' + frame] ? name + '#' + frame : name;
      if (flip) k += '~f';
      row[i] = k;
    }
    return k;
  }

  // x, y = top-left. Unknown names draw nothing. opts: { flip:bool, frame:int }
  function sprite(g, name, x, y, opts) {
    var c;
    if (opts && (opts.frame || opts.flip)) name = variant(name, opts.frame | 0, !!opts.flip);
    c = canvasOf(name);
    if (c) g.drawImage(c, Math.round(x), Math.round(y));
  }

  var crackT = [-1, -1];                         // E.time at which each side's seal started to crack
  var SEALED = ['sigil_r', 'sigil_p'];
  var CRACKS = [['crack_r0', 'crack_r1', 'crack_r2'], ['crack_p0', 'crack_p1', 'crack_p2']];
  var OPEN = { S: 'open_S', G: 'open_G', F: 'open_F' };

  // x, y = top-left of the 16x16 cell. state: 'sealed' | 'crack' | 'open' | 'gone'. side: 'p' | 'r'.
  // 'crack' plays its 3 frames (60 ms each) from the moment the state is first drawn; `frame` forces one.
  function sigil(g, x, y, state, move, side, frame) {
    var s = side === 'p' ? 1 : 0, c, now, f;
    x = Math.round(x); y = Math.round(y);
    if (state !== 'crack') crackT[s] = -1;
    if (!state || state === 'gone') return;
    if (state === 'open') {
      c = canvasOf(OPEN[move] || 'open_none');
      if (c) g.drawImage(c, x, y);
    } else if (state === 'crack') {
      now = R.Engine ? R.Engine.time || 0 : 0;
      if (crackT[s] < 0 || now < crackT[s]) crackT[s] = now;
      f = frame === undefined ? Math.floor((now - crackT[s]) / 0.06) : frame | 0;
      c = canvasOf(CRACKS[s][f < 0 ? 0 : f > 2 ? 2 : f]);
      if (c) g.drawImage(c, x - 4, y - 4);
    } else {
      c = canvasOf(SEALED[s]);
      if (c) g.drawImage(c, x, y);
    }
  }

  function warm() { for (var k in IMG) canvasOf(k); }

  R.Art = R.Art || {};
  R.Art.sprite = sprite;
  R.Art.sigil = sigil;
  R.Art.spriteImg = function (name) { return IMG[name] || null; };      // indexed source (tools, other art modules)
  R.Art.spriteNames = function () { return Object.keys(IMG); };
  R.Art.inits = R.Art.inits || [];
  R.Art.inits.push(warm);
})(globalThis.RIVAL = globalThis.RIVAL || {});
