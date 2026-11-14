// THE RIVAL — boons (36) + relics (6). Pure data table with hook functions (runs under Node).
// Hooks are looked up by boon id at call time; nothing here is ever stored on game state.
//
// Hook argument `x` (built by R.Combat / R.Run):
//   duel, self, foe, side, my, their, dmg, won, lost, clash, tension, events   (contract fields)
//   base        base damage of the exchange (3/2/2)
//   taken/dealt final damage this fighter took / dealt in the exchange (afterExchange)
//   pips        onClash: pips this clash will add (a hook may raise it)
//   brokeFoe / brokeSelf   a guard break was inflicted this exchange (afterExchange)
//   foeBleeding / selfBleeding   bleed status as it was BEFORE the exchange
//   status(target:'self'|'foe', name, n, opts) -> bool   apply a status through the combat rules
//   heal(n) -> healed   heal self (capped at max HP)        cancelBreak() -> bool
//   onRest:  { run, side:'p', self:{hp,maxHp}, low, heal (mutable), events }
//   onDraft: { run, side:'p', size (mutable), events }
(function (R) {
  'use strict';

  var C = 'common', U = 'uncommon', RA = 'rare';

  function low(f) { return f.hp <= Math.ceil(f.maxHp / 3); }
  function prev(f, k) { var m = f.moves; return m.length >= k ? m[m.length - k] : null; }
  function fire(x, id, extra) {
    var e = { t: 'boon', side: x.side, id: id };
    if (extra) { for (var k in extra) e[k] = extra[k]; }
    x.events.push(e);
  }
  function intel(x) { return (x.duel && x.duel.intel) || {}; }
  // Capped heal with a per-duel counter. Only counts when HP actually moved.
  function cappedHeal(x, id, max) {
    var c = x.self.counters;
    if ((c[id] || 0) >= max) return 0;
    var h = x.heal(1);
    if (h > 0) { c[id] = (c[id] || 0) + 1; fire(x, id, { n: h }); }
    return h;
  }

  var list = [];
  var byId = {};

  function def(id, name, rarity, who, tags, unlock, desc, active, hooks, relic) {
    var b = {
      id: id, name: name, desc: desc, rarity: rarity, who: who, relic: !!relic,
      tags: tags, unlock: unlock || null, active: active || null, hooks: hooks || {}
    };
    list.push(b);
    byId[id] = b;
  }

  // ---------------------------------------------------------------- both (21)

  def('coiled_riposte', 'Coiled Riposte', U, 'both', ['RIP', 'EXE'], null,
    'Strike deals +2 if you Guarded last turn', null, {
      outDamage: function (x) {
        if (x.my === 'S' && prev(x.self, 1) === 'G') { fire(x, 'coiled_riposte', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  def('thorned_guard', 'Thorned Guard', C, 'both', ['RIP'], null,
    'Guard beating Strike deals +1', null, {
      outDamage: function (x) {
        if (x.my === 'G') { fire(x, 'thorned_guard', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      }
    });

  def('stone_patience', 'Stone Patience', C, 'both', ['RIP', 'TEN'], null,
    'Guard and take 0 damage: gain fortify 1 (no stack)', null, {
      afterExchange: function (x) {
        if (x.my === 'G' && x.taken === 0 && x.self.status.fortify < 1) {
          fire(x, 'stone_patience');
          x.status('self', 'fortify', 1, { max: true });
        }
      }
    });

  def('iron_oath', 'Iron Oath', U, 'both', ['RIP'], 'reach_5',
    'First guard break on you each duel is negated', null, {
      afterExchange: function (x) {
        if (x.brokeSelf && !x.self.counters.iron_oath) {
          if (x.cancelBreak()) { x.self.counters.iron_oath = 1; fire(x, 'iron_oath'); }
        }
      }
    });

  def('resonance', 'Resonance', C, 'both', ['TEN'], null,
    'Your clashes add 2 tension pips instead of 1', null, {
      onClash: function (x) {
        if (x.tension < 3 && x.pips < 2) { x.pips = 2; fire(x, 'resonance'); }
      }
    });

  def('ash_veil', 'Ash Veil', U, 'both', ['TEN', 'RIP'], 'reach_5',
    'Tension adds up to 2 less to damage you take', null, {
      inDamage: function (x) {
        var red = Math.min(2, x.tension || 0, x.dmg);
        if (red > 0) { fire(x, 'ash_veil', { n: red }); return x.dmg - red; }
        return x.dmg;
      }
    });

  def('deathblow_creed', 'Deathblow Creed', RA, 'both', ['TEN', 'EXE'], 'reach_7',
    'Win at 3 tension pips: +2 damage on top', null, {
      outDamage: function (x) {
        if (x.tension === 3) { fire(x, 'deathblow_creed', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  def('mirror_etiquette', 'Mirror Etiquette', C, 'both', ['TEN'], null,
    'Clash S: focus 1. G: fortify 1. F: heal 1 (2 per duel)', null, {
      onClash: function (x) {
        if (x.my === 'S') {
          if (x.status('self', 'focus', 1)) fire(x, 'mirror_etiquette', { kind: 'focus' });
        } else if (x.my === 'G') {
          if (x.status('self', 'fortify', 1)) fire(x, 'mirror_etiquette', { kind: 'fortify' });
        } else {
          cappedHeal(x, 'mirror_etiquette', 2);
        }
      }
    });

  def('serrated_edge', 'Serrated Edge', C, 'both', ['BLD', 'EXE'], null,
    'Strike wins deal -1 damage but apply bleed 3', null, {
      outDamage: function (x) {
        if (x.my === 'S') { fire(x, 'serrated_edge', { n: -1 }); return x.dmg - 1; }
        return x.dmg;
      },
      afterExchange: function (x) {
        if (x.won && x.my === 'S') x.status('foe', 'bleed', 3);
      }
    });

  def('paper_cuts', 'Paper Cuts', C, 'both', ['BLD', 'TRK'], null,
    'Feint wins apply bleed 2', null, {
      afterExchange: function (x) {
        if (x.won && x.my === 'F') { fire(x, 'paper_cuts'); x.status('foe', 'bleed', 2); }
      }
    });

  def('salt_the_wound', 'Salt the Wound', U, 'both', ['BLD'], null,
    'Your wins deal +1 against a bleeding foe', null, {
      outDamage: function (x) {
        if (x.foeBleeding) { fire(x, 'salt_the_wound', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      }
    });

  def('carrion_comfort', 'Carrion Comfort', U, 'both', ['BLD', 'GMB'], 'bleed_20',
    'Beat a bleeding foe: heal 1 (max 3 per duel)', null, {
      afterExchange: function (x) {
        if (x.won && x.foeBleeding) cappedHeal(x, 'carrion_comfort', 3);
      }
    });

  def('vampires_curtsy', "Vampire's Curtsy", C, 'both', ['TRK', 'GMB'], null,
    'Feint wins heal 1 (max 3 per duel)', null, {
      afterExchange: function (x) {
        if (x.won && x.my === 'F') cappedHeal(x, 'vampires_curtsy', 3);
      }
    });

  def('long_con', 'The Long Con', U, 'both', ['TRK'], 'no_guard_duel',
    'Guard breaks you inflict last 2 turns', null, {
      afterExchange: function (x) {
        if (x.brokeFoe && x.status('foe', 'guardBroken', 2)) fire(x, 'long_con');
      }
    });

  def('turtle_cracker', 'Turtle Cracker', U, 'both', ['TRK'], 'no_strike_duel',
    'Feint beats Guard: +2 if foe also Guarded last turn', null, {
      outDamage: function (x) {
        if (x.my === 'F' && x.their === 'G' && prev(x.foe, 1) === 'G') {
          fire(x, 'turtle_cracker', { n: 2 });
          return x.dmg + 2;
        }
        return x.dmg;
      }
    });

  def('debt_collector', 'Debt Collector', U, 'both', ['TRK', 'EXE'], 'no_guard_duel',
    'Strike wins deal +2 against a guard-broken foe', null, {
      outDamage: function (x) {
        if (x.my === 'S' && x.foe.status.guardBroken > 0) { fire(x, 'debt_collector', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  def('cornered', 'Cornered', C, 'both', ['GMB'], null,
    'At low HP (a third or less) your wins deal +1', null, {
      outDamage: function (x) {
        if (low(x.self)) { fire(x, 'cornered', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      }
    });

  def('spite', 'Spite', C, 'both', ['GMB'], null,
    'Lose an exchange for 3+ damage: gain focus 2 (no stack)', null, {
      afterExchange: function (x) {
        if (x.lost && x.taken >= 3 && x.self.status.focus < 2) {
          fire(x, 'spite');
          x.status('self', 'focus', 2, { max: true });
        }
      }
    });

  def('three_faces', 'Three Faces', C, 'both', ['CHA'], null,
    '+1 if your winning move differs from your last two moves', null, {
      outDamage: function (x) {
        var a = prev(x.self, 1), b = prev(x.self, 2);
        if (a && b && x.my !== a && x.my !== b) { fire(x, 'three_faces', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      }
    });

  def('first_blood', 'First Blood', C, 'both', ['EXE'], null,
    'Start each duel with focus 1', null, {
      duelStart: function (x) {
        if (x.status('self', 'focus', 1)) fire(x, 'first_blood');
      }
    });

  def('headsman', "Headsman's Patience", RA, 'both', ['EXE', 'GMB'], 'first_win',
    'Strike wins deal +2 against a foe at low HP', null, {
      outDamage: function (x) {
        if (x.my === 'S' && low(x.foe)) { fire(x, 'headsman', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  // ---------------------------------------------------------------- rival only (6)

  def('no_encores', 'No Encores', U, 'rival', ['CHA'], null,
    'Foe repeats a move: that move is sealed for 1 turn', null, {
      afterExchange: function (x) {
        if (x.their && prev(x.foe, 1) === x.their) {
          if (x.status('foe', 'sealed', 1, { move: x.their })) fire(x, 'no_encores', { move: x.their });
        }
      }
    });

  def('painted_smile', 'The Painted Smile', U, 'rival', ['INF'], null,
    'When its stance lied, the exchange winner deals +1', null, {
      outDamage: function (x) {
        if (intel(x).honest === false) { fire(x, 'painted_smile', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      },
      inDamage: function (x) {
        if (intel(x).honest === false) { fire(x, 'painted_smile', { n: 1 }); return x.dmg + 1; }
        return x.dmg;
      }
    });

  def('mourning_veil', 'Mourning Veil', C, 'rival', ['RIP'], null,
    'Starts each duel with fortify 2', null, {
      duelStart: function (x) {
        if (x.status('self', 'fortify', 2)) fire(x, 'mourning_veil');
      }
    });

  def('hungry_mask', 'Hungry Mask', RA, 'rival', ['CHA'], 'read_25',
    'Wins a turn it read (over 60%): heals 1 (max 3 per duel)', null, {
      afterExchange: function (x) {
        var p = intel(x).pred;
        if (x.won && p && p[x.their] > 0.60) cappedHeal(x, 'hungry_mask', 3);
      }
    });

  def('sealing_wax', 'Sealing Wax', RA, 'rival', ['TRK'], 'broken_15',
    'When it wins, the move you lost with is sealed 1 turn', null, {
      afterExchange: function (x) {
        if (x.won && x.status('foe', 'sealed', 1, { move: x.their })) fire(x, 'sealing_wax', { move: x.their });
      }
    });

  def('spare_mask', 'Spare Mask', RA, 'rival', ['GMB'], 'first_win',
    'Once per run, not in duel 7: survives at 1 HP, fortify 1', null, {
      onLethal: function (x) {
        var c = x.self.counters;
        if (x.self.hp > 0 || c.spent_spare_mask || x.duel.n >= 7) return;
        c.spent_spare_mask = 1;
        x.self.hp = 1;
        fire(x, 'spare_mask');
        x.status('self', 'fortify', 1);
      }
    });

  // ---------------------------------------------------------------- player only (9)

  def('keyhole', 'Keyhole', RA, 'player', ['INF'], 'flawless_duel',
    'Once per duel: reveal its sealed move this turn', { charges: 1, kind: 'glimpse' }, {});

  def('truth_candle', 'Candle of Truth', U, 'player', ['INF'], null,
    "Once per duel: stamp this turn's stance TRUE or FALSE", { charges: 1, kind: 'honesty' }, {});

  def('stolen_ledger', 'Stolen Ledger', U, 'player', ['INF', 'CHA'], 'reach_7',
    'Each turn shows its top guess for your move', null, {
      turnStart: function (x) { x.events.push({ t: 'info', side: x.side, id: 'stolen_ledger' }); }
    });

  def('liars_tally', "Liar's Tally", C, 'player', ['INF'], null,
    "Shows its honesty % and this duel's honest/lie count", null, {
      duelStart: function (x) { x.self.counters.tally_honest = 0; x.self.counters.tally_lie = 0; },
      afterExchange: function (x) {
        var h = intel(x).honest, c = x.self.counters;
        if (h === true) c.tally_honest = (c.tally_honest || 0) + 1;
        else if (h === false) c.tally_lie = (c.tally_lie || 0) + 1;
      }
    });

  def('coin_of_fools', 'Coin of Fools', U, 'player', ['CHA'], null,
    '3 per duel: play a random legal move; +2 if it wins', { charges: 3, kind: 'coin' }, {
      outDamage: function (x) {
        if (intel(x).coin === true) { fire(x, 'coin_of_fools', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  def('broken_pattern', 'Broken Pattern', U, 'player', ['CHA'], 'ghost_run',
    '+2 when you win with a move it rated below 20%', null, {
      outDamage: function (x) {
        var p = intel(x).pred;
        if (p && typeof p[x.my] === 'number' && p[x.my] < 0.20) { fire(x, 'broken_pattern', { n: 2 }); return x.dmg + 2; }
        return x.dmg;
      }
    });

  def('ash_of_forgetting', 'Ash of Forgetting', RA, 'player', ['CHA'], 'ghost_run',
    'Each bonfire: it forgets half of what it knows of you', null, {
      onRest: function (x) {
        fire(x, 'ash_of_forgetting');
        x.events.push({ t: 'forget', side: x.side, id: 'ash_of_forgetting', n: 0.5 });
      }
    });

  def('last_candle', 'Last Candle', RA, 'player', ['GMB'], 'die_5',
    'Once per run: survive at 1 HP and gain fortify 2', null, {
      onLethal: function (x) {
        var c = x.self.counters;
        if (x.self.hp > 0 || c.spent_last_candle) return;
        c.spent_last_candle = 1;
        x.self.hp = 1;
        fire(x, 'last_candle');
        x.status('self', 'fortify', 2);
      }
    });

  def('ember_hoard', 'Ember Hoard', C, 'player', ['GMB'], null,
    'Bonfires heal +1, or +3 if you arrive at low HP', null, {
      onRest: function (x) {
        var n = x.low ? 3 : 1;
        x.heal += n;
        fire(x, 'ember_hoard', { n: n });
      }
    });

  // ---------------------------------------------------------------- relics (6)

  def('relic_ashen_flask', 'Ashen Flask', RA, 'player', [], 'first_death',
    'Bonfires heal +2', null, {
      onRest: function (x) { x.heal += 2; fire(x, 'relic_ashen_flask', { n: 2 }); }
    }, true);

  def('relic_dented_buckler', 'Dented Buckler', RA, 'player', ['RIP'], 'reach_3',
    'Start duels with fortify 1; first riposte each duel +1', null, {
      duelStart: function (x) {
        x.self.counters.relic_dented_buckler = 0;
        if (x.status('self', 'fortify', 1)) fire(x, 'relic_dented_buckler');
      },
      outDamage: function (x) {
        if (x.my === 'G' && !x.self.counters.relic_dented_buckler) {
          x.self.counters.relic_dented_buckler = 1;
          fire(x, 'relic_dented_buckler', { n: 1 });
          return x.dmg + 1;
        }
        return x.dmg;
      }
    }, true);

  def('relic_rusty_nail', 'Rusty Nail', RA, 'player', ['BLD'], 'lose_3_row',
    'Your first win each duel applies bleed 2', null, {
      duelStart: function (x) { x.self.counters.relic_rusty_nail = 0; },
      afterExchange: function (x) {
        if (x.won && !x.self.counters.relic_rusty_nail) {
          x.self.counters.relic_rusty_nail = 1;
          fire(x, 'relic_rusty_nail');
          x.status('foe', 'bleed', 2);
        }
      }
    }, true);

  def('relic_cracked_mirror', 'Cracked Mirror', RA, 'player', ['TEN'], 'deathblows_5',
    'First clash each duel: 2 pips and you gain fortify 1', null, {
      duelStart: function (x) { x.self.counters.relic_cracked_mirror = 0; },
      onClash: function (x) {
        if (x.self.counters.relic_cracked_mirror) return;
        x.self.counters.relic_cracked_mirror = 1;
        fire(x, 'relic_cracked_mirror');
        if (x.tension < 3 && x.pips < 2) x.pips = 2;
        x.status('self', 'fortify', 1);
      }
    }, true);

  def('relic_dealers_thumb', "Dealer's Thumb", RA, 'player', [], 'drafts_12',
    'Draft from 4 choices instead of 3', null, {
      onDraft: function (x) { if (x.size < 4) x.size = 4; }
    }, true);

  def('relic_liars_coin', "Liar's Coin", RA, 'player', ['INF'], 'lies_15',
    'Turn 1 of each duel: stance is stamped TRUE or FALSE', null, {
      turnStart: function (x) {
        if (x.duel.turn === 1) x.events.push({ t: 'info', side: x.side, id: 'relic_liars_coin' });
      }
    }, true);

  R.Boons = {
    list: list,
    byId: byId,
    TAGS: ['RIP', 'TEN', 'BLD', 'TRK', 'GMB', 'INF', 'CHA', 'EXE'],
    isLow: low
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(globalThis.RIVAL = globalThis.RIVAL || {});
