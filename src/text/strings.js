// STUB — replaced by the writer
// Minimal R.Text so scenes can run before the real strings land.
(function (R) {
  'use strict';

  var MOVE = { S: 'Strike', G: 'Guard', F: 'Feint' };

  function fill(template, vars) {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m;
    });
  }

  var T = {
    taunts: {},                       // category -> [template]
    boon: {},                         // id -> { name, flavor }
    ui: {
      title: 'SHOW ME MY RIVAL',
      credit: 'Developed by tangoSHELL \u00b7 2026',
      tapToBegin: 'TAP TO BEGIN',
      cont: 'CONTINUE',
      strike: 'STRIKE', guard: 'GUARD', feint: 'FEINT',
      dossier: 'DOSSIER', unlocks: 'UNLOCKS', settings: 'SETTINGS',
      confirm: 'CONFIRM', back: 'BACK', none: 'NONE',
      youDied: 'YOU DIED'
    },
    fill: fill,
    move: function (m) { return MOVE[m] || ''; },
    taunt: function (category, vars, rng) {
      var list = T.taunts[category];
      if (!list || !list.length) return null;
      var i = rng && rng.int ? rng.int(list.length) : 0;
      return fill(list[i], vars);
    },
    dossierLine: function (stat) {
      if (!stat) return 'I am still taking notes.';
      return 'I noticed something about you (' + (stat.pct | 0) + '% of the time).';
    }
  };

  R.Text = T;
})(globalThis.RIVAL = globalThis.RIVAL || {});
