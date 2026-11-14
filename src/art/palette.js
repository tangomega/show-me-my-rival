// SHOW ME MY RIVAL - the 32-colour palette (DESIGN 13.1). Index 0 is transparent.
(function (R) {
  'use strict';

  var hex = [
    null,
    '#0b0a10', '#16141f', '#221f2e', '#2f2c3d', '#403e52', '#56566c', '#74768c', '#9a9cae',
    '#c4c6d0', '#ecebe4', '#cfc4a6', '#9c8f76', '#6b5f52', '#463b36', '#2c2423', '#3a1418',
    '#6e1a20', '#a3242a', '#d8483a', '#f08a4a', '#f6b44c', '#fde08a', '#fff6d0', '#8a5a2a',
    '#c08a3c', '#1d3340', '#2f5d6e', '#6fa6b0', '#4a2c5e', '#8a4fa0', '#a8e04a'
  ];
  var names = [
    'transparent',
    'void', 'crypt', 'nightStone', 'slateShadow', 'coldStone', 'wornStone', 'ashBlue', 'paleAsh',
    'steelLight', 'boneWhite', 'bone', 'parchment', 'dustBrown', 'umber', 'char', 'driedBlood',
    'wine', 'bloodRed', 'freshRed', 'ember', 'candleAmber', 'flameCore', 'whiteHot', 'brassDark',
    'brass', 'deepTeal', 'coldTeal', 'moonBlue', 'bruiseViolet', 'feintViolet', 'witchfire'
  ];

  var C = {}, rgb = [null], i, n;
  for (i = 0; i < names.length; i++) C[names[i]] = i;
  for (i = 1; i < hex.length; i++) {
    n = parseInt(hex[i].slice(1), 16);
    rgb[i] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  R.Pal = {
    hex: hex,
    rgb: rgb,
    C: C,
    names: names,
    // Move colour-coding: [dark, light]
    move: { S: [18, 19], G: [27, 28], F: [29, 30] }
  };
})(globalThis.RIVAL = globalThis.RIVAL || {});
