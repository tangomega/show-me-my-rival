// SHOW ME MY RIVAL - everything written down rather than said: the dossier, card flavor, unlocks, menus.
// Loads after text/strings.js and text/taunts.js and extends R.Text. Pure: no DOM.
// Nothing in here throws on bad input; a malformed stat gets a generic line.
(function (R) {
  'use strict';

  var T = R.Text = R.Text || {};

  var MOVE_NAME = { S: 'Strike', G: 'Guard', F: 'Feint' };
  var MOVE_VARS = { move: 1, counterMove: 1, oldMove: 1, prevMove: 1, tellMove: 1, a: 1, b: 1 };
  var MAX_LINE = 78;
  var MAX_CTX = 28;
  var GENERIC = "I'm still studying this one. Give it time.";

  // ------------------------------------------------------------------ tolerant readers

  function num(x) { return (typeof x === 'number' && isFinite(x)) ? x : null; }

  // 'S' | 'Strike' | 'strike' -> 'Strike'; anything else -> ''.
  function nm(x) {
    if (typeof x !== 'string' || !x) return '';
    if (MOVE_NAME[x]) return MOVE_NAME[x];
    var n = MOVE_NAME[x.charAt(0).toUpperCase()];
    return (n && n.toLowerCase() === x.toLowerCase()) ? n : '';
  }

  // Local stand-in so this file also works without taunts.js.
  function fill(template, vars) {
    if (typeof T.fill === 'function') return T.fill(template, vars);
    var missing = false;
    var out = String(template).replace(/\{(\w+)\}/g, function (all, k) {
      var v = vars ? vars[k] : undefined;
      if (v === undefined || v === null || v === '') { missing = true; return ''; }
      return String(v);
    });
    return missing ? null : out.charAt(0).toUpperCase() + out.slice(1);
  }

  // One flat, safe view of a stat: id, variant, pct, n and every move as a display name.
  function read(stat) {
    var s = (stat && typeof stat === 'object') ? stat : {};
    var v = (s.vars && typeof s.vars === 'object') ? s.vars : {};
    var pct = num(v.pct); if (pct === null) pct = num(s.pct);
    if (pct !== null) pct = Math.max(0, Math.min(100, Math.round(pct)));
    var n = num(s.n); if (n === null) n = num(v.n);
    if (n !== null) n = Math.max(0, Math.round(n));
    return {
      id: typeof s.id === 'string' ? s.id : '',
      variant: typeof v.variant === 'string' ? v.variant : '',
      pct: pct,
      n: n,
      move: nm(v.move) || nm(s.move),
      prevMove: nm(v.prevMove),
      a: nm(v.a),
      b: nm(v.b),
      tellMove: nm(v.tellMove),
      oldMove: nm(v.oldMove),
      // broken_habit: which habit was broken, if the brain says so
      habit: typeof v.habit === 'string' ? v.habit : (typeof v.habitId === 'string' ? v.habitId : ''),
      ctx: (typeof v.ctxPhrase === 'string' && v.ctxPhrase && v.ctxPhrase.length <= MAX_CTX) ? v.ctxPhrase : '',
      vars: v
    };
  }

  // ------------------------------------------------------------------ context phrases

  // "{ctxPhrase}, you {moveLower} {pct}% of the time." Lower case, at most 28 characters.
  function ctxOf(id, o) {
    switch (id) {
      case 'fav_move': return 'in general';
      case 'opening': return 'on the first turn';
      case 'after_loss': return 'after you take a hit';
      case 'after_win': return 'after you land a hit';
      case 'repeat': return 'given the chance';
      case 'two_step': return o.prevMove ? 'after a ' + o.prevMove : 'after your last move';
      case 'loop3': return (o.a && o.b) ? 'after ' + o.a + ' then ' + o.b : 'in your little waltz';
      case 'low_hp': return "when you're nearly dead";
      case 'tell_trust': return 'when I show a stance';
      case 'tell_by_stance': return o.tellMove ? 'when I show you ' + o.tellMove : 'when I show you a stance';
      case 'after_burn': return 'right after I fool you';
      case 'echo_rival': return o.variant === 'counters' ? 'one move too late' : 'one move behind me';
      case 'deathblow_nerves': return 'at three pips';
      case 'broken_panic': return 'with your guard broken';
      case 'vs_broken': return 'when my guard is broken';
      case 'predictability': return 'in general';
      case 'broken_habit':
        if (o.ctx) return o.ctx;
        if (o.habit && o.habit !== 'broken_habit') return ctxOf(o.habit, o);
        return 'by habit';
      default: return 'as a rule';
    }
  }

  function ctxPhrase(stat) {
    try {
      var o = read(stat);
      var c = ctxOf(o.id, o);
      return (typeof c === 'string' && c && c.length <= MAX_CTX) ? c : 'as a rule';
    } catch (e) {
      return 'as a rule';
    }
  }

  // Stats that are not about one move get a verb that fits the same sentences:
  // "{ctxPhrase}, you {moveLower} {pct}% of the time." The low side of a two-sided stat
  // is flipped (8% repeats becomes "you switch 92% of the time") so the line stays a boast.
  function verbFor(o) {
    var low = false;
    switch (o.id) {
      case 'repeat':
        low = o.variant === 'never_repeats' || (o.variant !== 'repeats' && o.pct !== null && o.pct <= 25);
        return { move: low ? 'Switch' : 'Repeat', flip: low };
      case 'tell_trust':
        low = o.variant === 'paranoid' || (o.variant !== 'gullible' && o.pct !== null && o.pct <= 35);
        return { move: low ? 'Doubt' : 'Trust', flip: low };
      case 'after_burn':
        low = o.variant === 'sulks' || (o.variant !== 'never_learns' && o.pct !== null && o.pct <= 35);
        return { move: low ? 'Doubt' : 'Trust', flip: low };
      case 'echo_rival':
        return { move: o.variant === 'counters' ? 'Counter' : 'Copy', flip: false };
      default:
        return null;
    }
  }

  // Everything a taunt template may ask of a stat: {pct, move, moveLower, ctxPhrase, ...stat.vars}.
  function tauntVars(stat) {
    var out = {};
    try {
      var o = read(stat), k, val;
      for (k in o.vars) {
        if (!Object.prototype.hasOwnProperty.call(o.vars, k)) continue;
        val = o.vars[k];
        if (typeof val === 'number' && isFinite(val)) out[k] = val;
        else if (typeof val === 'string' && val) out[k] = (MOVE_VARS[k] && nm(val)) ? nm(val) : val;
      }
      if (o.a) out.a = o.a;
      if (o.b) out.b = o.b;
      if (o.prevMove) out.prevMove = o.prevMove;
      if (o.tellMove) out.tellMove = o.tellMove;
      if (o.oldMove) out.oldMove = o.oldMove;
      else if (o.id === 'broken_habit' && o.move) out.oldMove = o.move;

      var pct = o.pct, move = o.move, verb = verbFor(o);
      if (verb) {
        move = verb.move;
        if (verb.flip && pct !== null) pct = 100 - pct;
      }
      if (pct !== null) out.pct = pct; else delete out.pct;
      if (move) { out.move = move; out.moveLower = move.toLowerCase(); }
      else { delete out.move; delete out.moveLower; }
      if (o.n !== null) out.n = o.n;
      out.ctxPhrase = ctxPhrase(stat);
    } catch (e) {
      out.ctxPhrase = 'as a rule';
    }
    return out;
  }

  // ------------------------------------------------------------------ dossier sentences

  // Three phrasings per id; two-sided stats are keyed by vars.variant with '_' as the neutral line.
  var LINES = {
    fav_move: [
      "You {moveLower} {pct}% of the time. It's less a choice than a pulse.",
      "{move} is {pct}% of everything you do. I checked. {n} turns.",
      "{pct}% {move}, across {n} turns. You have a type."
    ],
    opening: [
      "You open with {move} {pct}% of duels. I open with knowing that.",
      "First move: {move}, {pct}% of the time. Hello to you too.",
      "Every duel starts the same. {move}. {pct}%. Like a greeting."
    ],
    after_loss: [
      "After taking a hit you {moveLower} {pct}% of the time. Pain makes you honest.",
      "Hurt you, and you {moveLower}. {pct}%. I hurt you on purpose.",
      "{pct}% {move} after a wound. You flinch in one direction."
    ],
    after_win: [
      "After landing one you {moveLower} {pct}% of the time. Success makes you simple.",
      "Win an exchange and you {moveLower}. {pct}%. Pride is a tell.",
      "{pct}% {move} after a hit lands. You celebrate the same way each time."
    ],
    repeat: {
      repeats: [
        "You repeat your last move {pct}% of the time. I heard you the first time.",
        "Same move twice, {pct}% of the time. An echo with a sword.",
        "{pct}% of your moves are the one before. I only have to listen once."
      ],
      never_repeats: [
        "You repeat a move {pct}% of the time. Never is also a pattern.",
        "Never the same move twice. So I cross one off and pick from two.",
        "You switch every turn. You think it's cunning. It's a schedule."
      ],
      _: [
        "You repeat your last move {pct}% of the time. I keep count."
      ]
    },
    two_step: [
      "{prevMove}, then {move}. {pct}% of the time. I hum along.",
      "After {prevMove} comes {move}. {pct}%. Dusk follows day less reliably.",
      "{prevMove} leads you to {move}, {pct}% of the time. I know the dance."
    ],
    loop3: [
      "{a}, {b}, {move}. Your little waltz. {pct}% of the time.",
      "{a}, then {b}, then {move}. {pct}%. I tap my foot.",
      "Three steps: {a}, {b}, {move}. {pct}%. You dance; I lead."
    ],
    low_hp: [
      "Near death you {moveLower} {pct}% of the time. Fear has one idea.",
      "At death's door you knock the same way. {move}. {pct}%.",
      "{pct}% {move} when you're dying. That's when I stop guessing."
    ],
    tell_trust: {
      gullible: [
        "You believe my stance {pct}% of the time. I'm touched. And lying.",
        "{pct}% of the time you take my stance at its word. It has no word.",
        "I show, you obey. {pct}%. I've had candles with more doubt."
      ],
      paranoid: [
        "You believe my stance {pct}% of the time. So lately I tell the truth.",
        "Only {pct}% trust. You doubt everything. Doubt reads just as easily.",
        "You trust me {pct}% of the time. Wise. Useless, but wise."
      ],
      _: [
        "You believe my stance {pct}% of the time. I keep the figure handy."
      ]
    },
    tell_by_stance: [
      "When I show {tellMove} you {moveLower} {pct}% of the time. So I show it.",
      "Show you {tellMove}, get {move}. {pct}%. Like ringing a bell.",
      "My {tellMove} stance pulls {move} out of you. {pct}%. Reliably."
    ],
    after_burn: {
      never_learns: [
        "Fooled once, you trust me again {pct}% of the time. Bless you.",
        "I lie, it hurts, and {pct}% of the time you believe the next one.",
        "Burned, then trusting again: {pct}%. You forgive faster than I lie."
      ],
      sulks: [
        "Fooled once, you trust me again only {pct}% of the time. You sulk.",
        "After a lie lands you believe me {pct}% of the time. So then I'm honest.",
        "One lie and you stop listening. {pct}% trust. A grudge is a pattern too."
      ],
      _: [
        "After a lie lands, you trust my next stance {pct}% of the time."
      ]
    },
    echo_rival: {
      copies: [
        "You copy what I just did {pct}% of the time. Flattering. Fatal.",
        "{pct}% of your moves are my last one. I'm fighting my own shadow.",
        "Whatever I play, you play next. {pct}%. I lead; you follow."
      ],
      counters: [
        "You answer my last move {pct}% of the time. I've moved on by then.",
        "{pct}% of the time you counter what I already did. One turn late.",
        "You fight the turn before this one. {pct}%. I live in this one."
      ],
      _: [
        "My last move decides your next, {pct}% of the time."
      ]
    },
    deathblow_nerves: [
      "At three pips you {moveLower} {pct}% of the time. Nerves are a tell.",
      "Full tension, and it's {move}. {pct}%. The big moment has one answer.",
      "{pct}% {move} at Deathblow. When it matters most, you think least."
    ],
    broken_panic: [
      "Guard broken, you {moveLower} {pct}% of the time. Panic has a favorite.",
      "Take your guard away and you {moveLower}. {pct}%. Every time, nearly.",
      "{pct}% {move} with your guard down. Two choices, and you use one."
    ],
    vs_broken: [
      "When my guard breaks you {moveLower} {pct}% of the time. I plan my falls.",
      "Break my guard and it's {move}. {pct}%. You smell blood the same way.",
      "{pct}% {move} once my guard is gone. Even your greed keeps a schedule."
    ],
    broken_habit: [
      "You used to {oldMove} {ctxPhrase}. You stopped. I noticed.",
      "{oldMove} {ctxPhrase}: retired. My notes are in mourning.",
      "You broke your {oldMove} habit. I'm keeping the old page anyway."
    ],
    record: [
      "Your record. I keep it better than you do.",
      "The ledger. Every entry is you. Most are deaths.",
      "For the record. There is always a record."
    ]
  };

  // A stat that is shown but not yet skewed enough to mock (strength 0) gets an honest shrug
  // instead of a boast. The two-sided stats use their neutral '_' line for this.
  var MILD = {
    fav_move: "You {moveLower} {pct}% of the time. Barely a preference. I'll wait.",
    opening: "You open with {move} {pct}% of duels. Not a habit. Not yet.",
    after_loss: "After a hit you {moveLower} {pct}% of the time. Nothing I can use.",
    after_win: "After landing one you {moveLower} {pct}% of the time. Unremarkable.",
    two_step: "{prevMove}, then {move}: {pct}% of the time. Loose. I'm patient.",
    loop3: "{a}, {b}, {move}: {pct}%. Not a waltz yet. A shuffle.",
    low_hp: "Near death you {moveLower} {pct}% of the time. You keep your head.",
    tell_by_stance: "When I show {tellMove} you {moveLower} {pct}% of the time. Hardly a leash.",
    echo_rival: "My last move sways your next {pct}% of the time. Faintly.",
    deathblow_nerves: "At three pips you {moveLower} {pct}% of the time. Steadier than I'd like.",
    broken_panic: "Guard broken, you {moveLower} {pct}% of the time. Sensible. Annoying.",
    vs_broken: "When my guard breaks you {moveLower} {pct}% of the time. No pattern there."
  };

  // One mocking sentence for a brain stat. The phrasing is picked from stat.n, so the
  // same data reads the same way every time the screen is drawn.
  function dossierLine(stat) {
    try {
      var o = read(stat);
      if (o.id === 'predictability') return predictabilityLine(o.pct === null ? NaN : o.pct);
      var set = Object.prototype.hasOwnProperty.call(LINES, o.id) ? LINES[o.id] : null;
      if (!set) return GENERIC;
      var mild = typeof stat.strength === 'number' && stat.strength <= 0 && o.id !== 'broken_habit' && o.id !== 'record';
      if (!Array.isArray(set)) set = (!mild && Object.prototype.hasOwnProperty.call(set, o.variant)) ? set[o.variant] : set._;
      if (!Array.isArray(set) || !set.length) return GENERIC;

      var vars = {
        pct: o.pct, n: o.n, move: o.move, moveLower: o.move ? o.move.toLowerCase() : undefined,
        prevMove: o.prevMove, a: o.a, b: o.b, tellMove: o.tellMove,
        oldMove: o.oldMove || (o.id === 'broken_habit' ? o.move : ''),
        ctxPhrase: ctxOf(o.id, o)
      };
      if (mild && typeof MILD[o.id] === 'string') {
        var m = fill(MILD[o.id], vars);
        if (typeof m === 'string' && m && m.length <= MAX_LINE) return m;
      }
      var start = (o.n === null ? 0 : o.n) % set.length;
      for (var i = 0; i < set.length; i++) {
        var s = fill(set[(start + i) % set.length], vars);
        if (typeof s === 'string' && s && s.length <= MAX_LINE) return s;
      }
      return GENERIC;
    } catch (e) {
      return GENERIC;
    }
  }

  // ------------------------------------------------------------------ predictability gauge

  var PREDICT = [
    { max: 25, lines: [                         // grudging respect
      "Predictability {score}. I can't read you. I hate that. Well done.",
      "{score}. You are fog with a sword. I'm almost impressed.",
      "A score of {score}. Either you're good or you're guessing. Keep at it."
    ] },
    { max: 45, lines: [
      "Predictability {score}. I catch you now and then. It's enough.",
      "{score}. Mostly smoke, some mirror. I'm working on it.",
      "A score of {score}. You have habits. They're just shy."
    ] },
    { max: 60, lines: [
      "Predictability {score}. I read you like a letter. A short one.",
      "{score}. I know your move before you do, often enough.",
      "A score of {score}. You're becoming familiar. Not a compliment."
    ] },
    { max: 80, lines: [
      "Predictability {score}. You're not dueling me. You're reciting.",
      "{score}. I've stopped guessing. I just wait where you'll be.",
      "A score of {score}. I could fight you by post."
    ] },
    { max: 100, lines: [                        // savage
      "Predictability {score}. I could beat you with the mask on backwards.",
      "{score}. You are a sundial. I am the sun.",
      "A score of {score}. I don't need the dossier. I need a calendar."
    ] }
  ];
  var PREDICT_UNKNOWN = "I'm still measuring you. Hold still.";

  function predictabilityLine(score) {
    var sc = num(score);
    if (sc === null) return PREDICT_UNKNOWN;
    sc = Math.max(0, Math.min(100, Math.round(sc)));
    for (var i = 0; i < PREDICT.length; i++) {
      if (sc <= PREDICT[i].max) {
        var set = PREDICT[i].lines;
        return fill(set[sc % set.length], { score: sc }) || PREDICT_UNKNOWN;
      }
    }
    return PREDICT_UNKNOWN;
  }

  // ------------------------------------------------------------------ lifetime record

  function band(value, steps) {          // steps: [[max, text], ...], last entry is the catch-all
    for (var i = 0; i < steps.length; i++) if (value <= steps[i][0]) return steps[i][1];
    return steps[steps.length - 1][1];
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // Rows for the dossier's record block: [{ id, label, value, jab }]. Rows without data are skipped.
  function recordLines(memory) {
    var rows = [];
    try {
      var m = (memory && typeof memory === 'object') ? memory : {};
      var runs = num(m.runs), deaths = num(m.deaths), wins = num(m.wins), best = num(m.bestDuel);
      var sw = num(m.streakW) || 0, sl = num(m.streakL) || 0;
      var played = runs !== null && runs >= 1;

      if (played) rows.push({ id: 'runs', label: 'RUNS', value: String(runs), jab: band(runs, [
        [1, "A first visit. Mind the ash."],
        [9, "Early days. I'm still sharpening the pencil."],
        [49, "You keep coming back. I keep being here."],
        [99, "At this point it's a standing appointment."],
        [Infinity, "I've known cathedrals with shorter histories."]]) });

      if (deaths !== null && (played || deaths > 0)) rows.push({ id: 'deaths', label: 'DEATHS', value: String(deaths), jab: band(deaths, [
        [0, "None yet. Give it a minute."],
        [9, "I remember each one fondly."],
        [49, "I've started naming them."],
        [Infinity, "The floor is mostly you now."]]) });

      if (wins !== null && (played || wins > 0)) rows.push({ id: 'wins', label: 'WINS', value: String(wins), jab: band(wins, [
        [0, "Nothing here. I dusted anyway."],
        [1, "Once. I've framed it. Facing the wall."],
        [4, "A few. I'm told this builds character."],
        [Infinity, "Too many. I'm taking it personally."]]) });

      if (best !== null && best >= 1) {
        var b = Math.min(8, Math.round(best));
        rows.push({ id: 'best', label: 'FARTHEST', value: b >= 8 ? 'THE UNMASKED' : 'DUEL ' + b, jab:
          b >= 8 ? (wins ? "You've seen all of me. You came back anyway." : "You saw under the mask. It saw you back.")
          : b === 7 ? "You've seen the altar. Not what's under the mask."
          : b === 1 ? "You've never seen duel 2. It's lovely."
          : "You've never seen duel " + (b + 1) + ". It's right there." });
      }

      var cl = m.closestLoss;
      if (cl && typeof cl === 'object' && num(cl.rivalHp) !== null) {
        var rh = Math.max(0, Math.round(cl.rivalHp)), cd = num(cl.duel);
        var where = cd !== null ? "Duel " + Math.round(cd) + ". " : "";
        rows.push({ id: 'closest', label: 'CLOSEST LOSS', value: rh + ' HP LEFT', jab:
          rh <= 2 ? "I had " + rh + " left. Does that keep you up?"
          : rh <= 5 ? where + "Close. 'Close' is my favorite."
          : where + "Not close. Still your closest." });
      }

      var fd = m.fastestDeath;
      if (fd && typeof fd === 'object' && num(fd.turns) !== null) {
        var ft = Math.max(0, Math.round(fd.turns));
        rows.push({ id: 'fastest', label: 'FASTEST DEATH', value: plural(ft, 'TURN', 'TURNS'), jab: band(ft, [
          [5, "Over before the candles noticed."],
          [12, "Brief. I barely got to gloat."],
          [Infinity, "Your quickest. It still felt long."]]) });
      }

      var lw = m.lastWin;
      if (lw && typeof lw === 'object') {
        var lm = nm(lw.move), lh = num(lw.hp), lr = num(lw.run);
        var how = lm ? "A " + lm : "A win";
        rows.push({ id: 'lastWin', label: 'LAST WIN', value: lr !== null ? 'RUN ' + Math.round(lr) : (lm ? lm.toUpperCase() : 'ONCE'), jab:
          lh === null ? how + " finished me. I replay it nightly."
          : lh <= 3 ? how + ", with " + Math.round(lh) + " health left. Barely counts."
          : how + ", with " + Math.round(lh) + " health left. I replay it." });
      }

      if (sw >= 1) rows.push({ id: 'streak', label: 'STREAK', value: plural(Math.round(sw), 'WIN', 'WINS'), jab: band(sw, [
        [1, "One win. Don't call it a streak."],
        [3, "Stop it. I mean that."],
        [Infinity, "I've begun to dread the door opening."]]) });
      else if (sl >= 1) rows.push({ id: 'streak', label: 'STREAK', value: plural(Math.round(sl), 'DEATH', 'DEATHS'), jab: band(sl, [
        [2, "A stumble. So far."],
        [5, "That's not a streak. That's a habit."],
        [Infinity, "I'd offer advice, but this is funnier."]]) });
    } catch (e) { /* return what we have */ }
    return rows;
  }

  // ------------------------------------------------------------------ dossier furniture

  var HEADERS = {
    habit: [
      "ON THE SUBJECT OF YOU",
      "WHEN YOU ARE FRIGHTENED",
      "YOUR LITTLE WALTZES",
      "A CREATURE OF HABIT",
      "WHAT YOU THINK IS SECRET",
      "HABITS, ALPHABETICAL"
    ],
    tell: [
      "ON TRUSTING A MASK",
      "WHAT YOU BELIEVE",
      "LIES YOU HAVE ENJOYED"
    ],
    record: [
      "A HISTORY OF YOUR DEATHS",
      "THE LEDGER",
      "FOR THE RECORD",
      "HOW IT USUALLY ENDS",
      "KNOWN WEAKNESSES"
    ]
  };

  // A section title for a stat kind ('habit' | 'tell' | 'record'); n picks the variant.
  function dossierHeader(kind, n) {
    var set = HEADERS[kind] || HEADERS.habit;
    var i = num(n); i = i === null ? 0 : Math.abs(Math.round(i));
    return set[i % set.length];
  }

  // ------------------------------------------------------------------ boons and relics

  // Display name + one line of flavor. Some flavor is the Rival's own note in the margin.
  var BOON = {
    coiled_riposte: { name: "Coiled Riposte", flavor: "Patience first. Then the blade. In that order." },
    thorned_guard: { name: "Thorned Guard", flavor: "A shield that bites the hand that tests it." },
    stone_patience: { name: "Stone Patience", flavor: "Stand still long enough and you become the wall." },
    iron_oath: { name: "Iron Oath", flavor: "An oath holds exactly once. Spend it well." },
    resonance: { name: "Resonance", flavor: "When two blades agree, the whole nave hums." },
    ash_veil: { name: "Ash Veil", flavor: "What has already burned is hard to burn again." },
    deathblow_creed: { name: "Deathblow Creed", flavor: "At three pips, do not pray. Finish." },
    mirror_etiquette: { name: "Mirror Etiquette", flavor: "Meet yourself, bow, and take something for it." },
    serrated_edge: { name: "Serrated Edge", flavor: "It cuts shallower. It keeps cutting." },
    paper_cuts: { name: "Paper Cuts", flavor: "Small lies, lovingly applied." },
    salt_the_wound: { name: "Salt the Wound", flavor: "Mercy for the bleeding is a waste of good salt." },
    carrion_comfort: { name: "Carrion Comfort", flavor: "Something always feeds. It may as well be you." },
    vampires_curtsy: { name: "Vampire's Curtsy", flavor: "A bow, a smile, a small theft of blood." },
    long_con: { name: "The Long Con", flavor: "The best lies are still working a turn later." },
    turtle_cracker: { name: "Turtle Cracker", flavor: "For those who hide twice in the same shell." },
    debt_collector: { name: "Debt Collector", flavor: "An open guard is a debt. Collect in steel." },
    cornered: { name: "Cornered", flavor: "Nothing fights like a thing with nowhere left." },
    spite: { name: "Spite", flavor: "Hurt me properly and I will remember where." },
    three_faces: { name: "Three Faces", flavor: "Wear a different one each turn. Let it lose count." },
    first_blood: { name: "First Blood", flavor: "Arrive already angry." },
    headsman: { name: "Headsman's Patience", flavor: "Wait until the neck is offered. Then be brief." },
    no_encores: { name: "No Encores", flavor: "I heard it the first time." },
    painted_smile: { name: "The Painted Smile", flavor: "The smile is paint. The teeth behind it are not." },
    mourning_veil: { name: "Mourning Veil", flavor: "It grieves in advance. For you." },
    hungry_mask: { name: "Hungry Mask", flavor: "It eats what it expects. You fed it." },
    sealing_wax: { name: "Sealing Wax", flavor: "Lose with a move and I keep it. Briefly." },
    spare_mask: { name: "Spare Mask", flavor: "One always keeps a second face. I keep several." },
    keyhole: { name: "Keyhole", flavor: "A seal is only wax. Look through it. (Rude.)" },
    truth_candle: { name: "Candle of Truth", flavor: "The one flame it cannot lie in front of." },
    stolen_ledger: { name: "Stolen Ledger", flavor: "Its notes on you. (Give those back.)" },
    liars_tally: { name: "Liar's Tally", flavor: "Count the lies. It hates being counted." },
    coin_of_fools: { name: "Coin of Fools", flavor: "Even it cannot predict a coin. Nor can you." },
    broken_pattern: { name: "Broken Pattern", flavor: "Do the one thing it is sure you will not." },
    ash_of_forgetting: { name: "Ash of Forgetting", flavor: "Feed the fire its notes. (I'll only rewrite them.)" },
    last_candle: { name: "Last Candle", flavor: "When the rest go dark, this one refuses." },
    ember_hoard: { name: "Ember Hoard", flavor: "Warmth, saved for the worst night." },
    relic_ashen_flask: { name: "Ashen Flask", flavor: "It tastes of the last fire. It helps anyway." },
    relic_dented_buckler: { name: "Dented Buckler", flavor: "Every dent is a blow that did not kill you." },
    relic_rusty_nail: { name: "Rusty Nail", flavor: "Pulled from a pew. It was holding a grudge." },
    relic_cracked_mirror: { name: "Cracked Mirror", flavor: "It shows two of you. Both look tense." },
    relic_dealers_thumb: { name: "Dealer's Thumb", flavor: "It was on the scale the whole time." },
    relic_liars_coin: { name: "Liar's Coin", flavor: "Heads, true. Tails, false. It lands once a duel." }
  };

  // ------------------------------------------------------------------ unlocks

  // name = the entry's title in the unlock list; how = the condition, as a dare.
  var UNLOCK = {
    first_death: { name: "First of Many", how: "Die once. It gets easier." },
    die_5: { name: "Slow Learner", how: "Die 5 times. You're nearly there." },
    die_15: { name: "In Mourning", how: "Die 15 times. I'll wear black." },
    die_duel1: { name: "The Doorway", how: "After run 1: die in the first duel. Go on." },
    lose_3_row: { name: "A Tradition", how: "Lose 3 runs in a row. No effort required." },
    reach_3: { name: "Third Bell", how: "Reach duel 3. The bar is on the floor." },
    reach_5: { name: "The Wake", how: "Reach duel 5. I'll act surprised." },
    reach_7: { name: "The Altar", how: "Reach duel 7. Bring a candle for the altar." },
    first_win: { name: "Unmasked", how: "Beat me. All of me. Good luck." },
    win_2: { name: "Not a Fluke", how: "Beat me twice. Once was a rounding error." },
    win_3: { name: "Daybreak", how: "Beat me three times. I'll allow a sunrise." },
    no_guard_duel: { name: "No Shield", how: "Win a duel of 5+ turns. Never Guard." },
    no_strike_duel: { name: "No Blade", how: "Win a duel of 5+ turns. Never Strike." },
    flawless_duel: { name: "Untouched", how: "Win duel 2 or later without a scratch." },
    deathblows_5: { name: "Steady Hands", how: "Win 5 exchanges at three pips. Steady now." },
    bleed_20: { name: "Red Floor", how: "Deal 20 bleed damage. Mind my floor." },
    ghost_run: { name: "Fog", how: "Reach duel 4 with predictability under 35." },
    ghost_win: { name: "No One", how: "Beat me with predictability under 40." },
    read_25: { name: "Open Book", how: "Get read 25 times. You're feeding it." },
    broken_15: { name: "Cracked", how: "Have your guard broken 15 times. Easy." },
    drafts_12: { name: "Collector", how: "Draft 12 boons. Choose badly; I enjoy it." },
    lies_15: { name: "Skeptic", how: "Beat 15 of my lying stances. Doubt me." },
    runs_10: { name: "Regular", how: "Start 10 runs. You will. I know you." }
  };

  // ------------------------------------------------------------------ cosmetics, places, rules

  var MASKS = {
    porcelain: { name: "Porcelain", line: "The original. It has smiled through worse than you." },
    mourner: { name: "The Mourner", line: "Worn for your fifteen funerals. Black suits me." },
    jester: { name: "The Jester", line: "For the one who died in the doorway." },
    kintsugi: { name: "Kintsugi", line: "You broke it twice. I mended it in gold. Out of spite." },
    blank: { name: "The Blank", line: "You gave me nothing to read. So I wear nothing." }
  };

  var ARENAS = {
    cathedral: { name: "The Cathedral", line: "No roof, many candles. It's home." },
    blood_moon: { name: "Blood Moon", line: "Ten runs in, I had the moon repainted." },
    pale_dawn: { name: "Pale Dawn", line: "Morning, after three defeats. I didn't order it." }
  };

  // Duel n is DUEL_NAMES[n - 1]; index 7 is phase 2 of the final duel.
  var DUEL_NAMES = ["The Nave", "Vespers", "The Leak", "Draught", "The Wake", "Blood Moon", "The Altar", "The Unmasked"];

  var RULES = {
    embers: { name: "EMBERS", line: "Tension never falls below one pip." },
    called_shot: { name: "CALLED SHOT", line: "Obey, lose: +2. Defy, win: its guard breaks." }
  };

  // The Vigil (stakes). Seven lights; each one the player puts out hands the Rival what it guarded.
  // Keys are R.Run.VIGIL ids. rule may use {heal} {base} {hp}. line = the Rival, on that light going out.
  var VIGIL = {
    title: "THE VIGIL",
    intro: "Seven lights keep watch over you. Put one out, and what it guarded is mine.",
    earnFirst: "Beat the Unmasked to earn the right to put it out.",
    earnNext: "Win with every earned light out to earn this one.",
    allLit: "ALL SEVEN LIT",
    dark: "{n} DARK",
    lightless: "LIGHTLESS",
    lit: "LIT", out: "OUT", locked: "LOCKED",
    earned: "You may put it out. {rule}",
    lightlessWon: { name: "Lightless", how: "You beat it in the dark. There is nothing darker." },
    armed: "It did not come empty-handed.",
    lights: {
      benefit_of_doubt: { name: "The Benefit of the Doubt", rule: "It acts on what it knows one duel sooner.",
        line: "I used to wonder if I had you right. I have stopped wondering." },
      kinder_fire: { name: "The Kinder Fire", rule: "Bonfires heal {heal}, not {base}.",
        line: "The fire was kind to you. I had a word with it." },
      honest_face: { name: "The Honest Face", rule: "Its stances start lying one duel sooner.",
        line: "I wore an honest face for you. It never fit." },
      empty_hand: { name: "The Empty Hand", rule: "It arrives with a boon already drafted.",
        line: "I used to arrive with nothing. Manners. I am past them." },
      moments_peace: { name: "A Moment's Peace", rule: "No healing when the mask breaks.",
        line: "You caught your breath while I changed. Not tonight." },
      glass_jaw: { name: "The Glass Jaw", rule: "It has +{hp} health in every duel.",
        line: "You thought my jaw was glass. I let you think it." },
      unsaid: { name: "The Unsaid", rule: "It calls your move out loud in every duel.",
        line: "Some things I was too polite to say. I am cured." }
    }
  };

  // ------------------------------------------------------------------ menus

  var UI = {
    tapToBegin: "TAP TO BEGIN",
    continue: "CONTINUE",
    newRun: "NEW RUN",
    dossier: "DOSSIER",
    unlocks: "UNLOCKS",
    settings: "SETTINGS",
    back: "BACK",
    confirm: "CONFIRM",
    none: "NONE",
    mute: "MUTE",
    haptics: "HAPTICS",
    mask: "MASK",
    arena: "ARENA",
    replayCredits: "REPLAY CREDITS",
    resetSave: "RESET SAVE",
    resetConfirm: "ERASE EVERYTHING? It will forget you.",
    holdToErase: "HOLD TO ERASE",
    youDied: "YOU DIED",
    victory: "THE MASK FALLS",
    guardBroken: "GUARD BROKEN",
    deathblow: "DEATHBLOW",
    sealed: "SEALED",
    overkill: "OVERKILL",
    rupture: "RUPTURE",
    trueStance: "TRUE",
    falseStance: "FALSE",
    chooseRelic: "CHOOSE A RELIC",
    itChoosesFirst: "IT CHOOSES FIRST",
    pickOne: "PICK ONE",
    rest: "REST",
    healed: "+{n}",
    locked: "LOCKED",
    credit: "Developed by tangoSHELL · 2026",
    titleRemembers: "It remembers {runs} of you.",
    strike: "STRIKE",
    guard: "GUARD",
    feint: "FEINT",
    rotate: "ROTATE YOUR DEVICE"
  };

  // ------------------------------------------------------------------ exports

  var flatHeaders = HEADERS.habit.concat(HEADERS.tell, HEADERS.record);

  T.dossierLine = dossierLine;
  T.ctxPhrase = ctxPhrase;
  T.tauntVars = tauntVars;
  T.predictabilityLine = predictabilityLine;
  T.recordLines = recordLines;
  T.dossierHeaders = flatHeaders;
  T.dossierHeadersByKind = HEADERS;
  T.dossierHeader = dossierHeader;
  T.dossierEmpty = [
    "I don't know you yet. Give it time.",
    "Blank pages. They won't stay blank.",
    "Nothing to report. Go and make mistakes.",
    "A stranger. How refreshing. How brief."
  ];
  T.boon = Object.assign({}, T.boon || {}, BOON);
  T.unlock = Object.assign({}, T.unlock || {}, UNLOCK);
  T.masks = MASKS;
  T.arenas = ARENAS;
  T.duelNames = DUEL_NAMES;
  T.rules = RULES;
  T.vigil = VIGIL;
  T.ui = Object.assign({}, T.ui || {}, UI);
  if (T.taunts) T.taunts.dossier_headers = flatHeaders;   // the section-16 category name

})(globalThis.RIVAL = globalThis.RIVAL || {});
