// THE RIVAL - everything the Rival says out loud.
// Loads after text/strings.js (a stub) and extends R.Text. Pure: no DOM, no Math.random.
//
// Rules every line obeys (tools/out/check_text.js verifies them):
//   - only the template variables of DESIGN.md section 16
//   - at most 78 characters after worst-case expansion ({ctxPhrase} 28, boon names 20,
//     move names 6, numbers 3), ASCII only, and no ALL-CAPS words outside phase 2
//   - it mocks the player's play, never the person
(function (R) {
  'use strict';

  var T = R.Text = R.Text || {};

  var MOVE_NAME = { S: 'Strike', G: 'Guard', F: 'Feint' };
  // Variables that hold a move. A bare 'S' | 'G' | 'F' in one of these is shown as its name.
  var MOVE_KEYS = { move: 1, counterMove: 1, oldMove: 1, prevMove: 1, tellMove: 1, lastWinMove: 1, a: 1, b: 1 };

  // ------------------------------------------------------------------ the lines

  var taunts = {

    // Any habit stat: {ctxPhrase} + {move}/{moveLower} + {pct}. See R.Text.tauntVars.
    habit_detected: [
      "{ctxPhrase}, you {moveLower} {pct}% of the time. I counted. Twice.",
      "{pct}% {move} {ctxPhrase}. Not a duelist. A metronome.",
      "{ctxPhrase}: {move}. {pct}%. I could etch it on the altar.",
      "You {moveLower} {ctxPhrase}. {pct}% of the time. Still.",
      "{pct}% of the time you {moveLower} {ctxPhrase}. Thrilling.",
      "Let me guess: {ctxPhrase}, {move}. {pct}% says so.",
      "{ctxPhrase}: {move}, {pct}%. A hymn I know by heart.",
      "I wrote it down: {move} {ctxPhrase}, {pct}%. In ink.",
      "{pct}%. That's how often you {moveLower} {ctxPhrase}.",
      "You {moveLower} {ctxPhrase}, {pct}%. The bells vary more.",
      "{ctxPhrase}, you {moveLower}. {pct}%. Shall I act surprised?",
      "{move}, {ctxPhrase}. {pct}% of the time. Do go on.",
      "A habit: {move} {ctxPhrase}, {pct}%. I'd fix that. Don't.",
      "{ctxPhrase}, {pct}% {move}. Even the ash is less settled.",
      "You {moveLower} {ctxPhrase}. {pct}%. I checked my sums.",
      "{pct}% {move} {ctxPhrase}. I don't guess. I remember.",
      "Page nine: {move} {ctxPhrase}, {pct}%. Underlined.",
      "{ctxPhrase}, you {moveLower}. {pct}%. A candle has more secrets.",
      "You {moveLower} {ctxPhrase}. Still. {pct}%, by my ledger.",
      "{ctxPhrase}? {move}. {pct}%. You are a very short book.",
      "{pct}% {move} {ctxPhrase}. We both know. Only I admit it.",
      "{ctxPhrase}, it's {move}. {pct}%. How restful.",
      "You'll {moveLower} {ctxPhrase}. You do, {pct}% of the time.",
      "{pct} times in a hundred, you {moveLower} {ctxPhrase}.",
      "{ctxPhrase}, {pct}% {move}. I have had centuries to count.",
      "{move} {ctxPhrase}. {pct}%. Do you hear yourself? I do.",
      "'Always' is unfair. You {moveLower} {ctxPhrase} only {pct}%.",
      "{ctxPhrase}, you {moveLower}. {pct}%. It's almost a comfort.",
      "My notes say {move} {ctxPhrase}, {pct}%. My notes are smug.",
      "{pct}% {move} {ctxPhrase}. A tide has more surprises.",
      "You {moveLower} {ctxPhrase}. {pct}%. Don't stop on my account.",
      "{ctxPhrase}, {pct}% {move}. I set my candles by it.",
      "Ask me what you do {ctxPhrase}. {move}. {pct}%.",
      "{move} {ctxPhrase}, {pct}%. You rhyme with yourself.",
      "{ctxPhrase}, you {moveLower}. {pct}%. I'd bet the mask on it.",
      "{pct}% {move} {ctxPhrase}. Not instinct. A rut.",
      "I know what you do {ctxPhrase}. So do you. {pct}%.",
      "{ctxPhrase}. {move}. {pct}%. Shall I go on? I can go on."
    ],

    // dossier.broken: {oldMove} + {ctxPhrase}.
    habit_broken: [
      "You used to {oldMove} {ctxPhrase}. You stopped. I noticed.",
      "No more {oldMove}? Someone has been reading their dossier.",
      "{oldMove} {ctxPhrase}: gone. I'm almost proud. Almost.",
      "You quit your {oldMove} {ctxPhrase}. I had it framed.",
      "Where did the {oldMove} go? I'd built a whole plan on it.",
      "You changed. I liked your {oldMove} {ctxPhrase}.",
      "The old {oldMove} habit is dead. I'll light it a candle.",
      "So you can learn. Fewer {oldMove}s. I'll adjust my contempt."
    ],

    // It predicted the player's move and won. {move} = the player's move.
    read_you: [
      "I knew. I knew before you did.",
      "{move}. Again. I could set my watch by you, if time still worked here.",
      "Sealed it before you'd even decided.",
      "You telegraph. Not the stance. The soul.",
      "Right on schedule.",
      "{move}. I wrote it down this morning. There is no morning here.",
      "I'd have been disappointed by anything else.",
      "You reached for {move} and I was already there.",
      "Read. Like a hymnal. Large print.",
      "I didn't guess. Guessing is for strangers.",
      "That one was in the notes. Most of you is.",
      "As foretold. By me. Just now.",
      "You think in straight lines. I live at the end of them.",
      "Of course it was {move}. It's always been {move}.",
      "Predictable. I say it with love. No, I don't.",
      "I saw that coming from last week.",
      "You chose. How sweet that you think so.",
      "Same door, same key, same you.",
      "I'd finish your sentences, but they're all {move}.",
      "We've rehearsed this. You just don't remember.",
      "I was waiting where you landed. I usually am.",
      "You went {move}. I was already holding {counterMove}."
    ],

    // The player won with a move it rated unlikely.
    surprised: [
      "...Hm. That wasn't in my notes.",
      "A new trick. Precious. I'll have it memorized by morning.",
      "Do that again. No, don't. I need to write it down.",
      "Unexpected. I'd forgotten the word.",
      "Who taught you that? It wasn't me. I'd remember.",
      "That was not you. I know you. That was someone better.",
      "Interesting. I hate interesting.",
      "A deviation. I'll allow it. I'll also punish it.",
      "You surprised me. Mark the day. I will.",
      "{move}? From you? Now?",
      "A point for improvisation. Don't make it a habit. Or do.",
      "My notes need a new page. I resent the expense.",
      "Well. The mask is smiling. I am not.",
      "So there is someone in there.",
      "I had you down for anything but that.",
      "Luck or learning? I'll know within three turns."
    ],

    // Lying stance, the Rival won. {tellMove} = the stance it showed.
    lie_worked: [
      "You believed me. Adorable. Never change. Really, don't.",
      "The stance said {tellMove}. The stance lies. I taught it everything.",
      "I showed you {tellMove}. I meant none of it.",
      "Trusting the mask. It's painted on, you know.",
      "A stance is a promise. I break those.",
      "You read my body like scripture. It's fiction.",
      "I lied. You bought it. We each did our part.",
      "Still taking my word for it? I wouldn't.",
      "That stance was a rumor. I started it."
    ],

    // Lying stance, the player won.
    lie_caught: [
      "You didn't buy it. When did you get suspicious? I preferred you gullible.",
      "Called my bluff. Enjoy it. I have others.",
      "Caught. I'll lie better. I have the time.",
      "You saw through it. I must be getting honest in my old age.",
      "Doubting me now? After everything I've shown you?",
      "Good. Never trust a mask. Especially this one.",
      "One lie caught. I've told you so many more.",
      "Suspicion suits you. Wear it more often. Or don't.",
      "So you can read. I'll write smaller."
    ],

    player_low_hp: [
      "{hp} health left. I'd say 'careful', but you never are.",
      "You're bleeding on my floor. I just had it ruined.",
      "{hp} left. I've seen you lose from better.",
      "Nearly dead. Your best work happens here. So does your worst.",
      "I can hear your pulse. It's doing most of the fighting.",
      "This is the part where you panic. I've read ahead.",
      "{hp} health. Spend it wisely. You won't.",
      "Breathe. Go on. I'll wait. It won't help.",
      "The candles lean toward you. They do that near the end.",
      "Down to {hp}. Shall I ring the bell now or after?",
      "Careful. This floor remembers everyone who fell on it.",
      "A hit or two. That's all I'm owed.",
      "Low on blood, high on hope. My favorite vintage."
    ],

    rival_low_hp: [
      "A scratch. The mask is fine. That's what matters.",
      "Enjoy this. I've watched you waste better leads.",
      "{rivalHp} health. More than I need, if you stay yourself.",
      "You're winning. Don't let it go to your hands.",
      "Blood on the cloak. It's dark in here. Nobody will know.",
      "Close. This is where you get clever. And die.",
      "Cornered? I've been cornered since before your first death.",
      "Well done. Now finish it. That's the part you fumble.",
      "I'm not worried. The mask can't frown. Convenient.",
      "Don't smile. You haven't won. You've merely not lost yet.",
      "A few good turns and you think you know me.",
      "Go on. End it. I'll make a list of what you did right.",
      "Hurt, yes. Surprised, no. Let's not get carried away."
    ],

    // Any clash (fallback when a flavored bucket is empty).
    clash: [
      "Great minds. And also yours.",
      "Stop copying me. It's embarrassing for both of us.",
      "Same thought. I had it first.",
      "Tension. Can you feel it? I can't feel anything. But still.",
      "We agree. How unsettling.",
      "Another pip. Something is going to give. Someone."
    ],
    // Bind: Strike into Strike.
    clash_S: [
      "Steel on steel. We could do this for eternity. I have.",
      "Blades locked. Don't look at me like that. You started it.",
      "A bind. You push like someone with somewhere to be.",
      "Sparks. Mind the candles. They've outlasted better duels.",
      "Two Strikes. Nobody bleeds. What a waste of good anger."
    ],
    // Standoff: Guard into Guard.
    clash_G: [
      "Two cowards, circling. One of us is doing it ironically.",
      "A standoff. I can wait. Waiting is all I have ever done.",
      "Both guarding. The candles are more aggressive than we are.",
      "You hid. I hid. The cathedral holds its breath.",
      "Shields up, the pair of us. Stirring. Truly."
    ],
    // Masquerade: Feint into Feint. It laughs.
    clash_F: [
      "Ha! We both lied. Finally, an honest moment.",
      "Two feints. Nobody home on either side.",
      "A masquerade. You wear deceit badly. Keep practicing.",
      "We tricked each other into nothing. That's almost friendship.",
      "You feinted at a feint. The ash is laughing. So am I."
    ],
    // A clash at three pips: 1 damage each, that move sealed for both.
    clash_rupture: [
      "Rupture. We both bleed, and nothing is settled. Happy?",
      "Too much tension. It broke. So did a little of each of us.",
      "There. We both pay. I can afford it. Can you?",
      "It tore. One apiece. The next one to blink pays for all of it."
    ],
    // Tension has just reached three pips.
    clash_deathblow: [
      "Three pips. The next hit decides things. Breathe.",
      "Deathblow. Now we find out which of us flinches.",
      "Full tension. The bells are holding their breath.",
      "Three. Whoever lands next lands hard. I intend to.",
      "Here it is. The moment you always rush."
    ],

    guard_break_player: [
      "There goes your guard. You leaned on it like a crutch anyway.",
      "No Guard next turn. Whatever will you do. (I know what you'll do.)",
      "Guard broken. Two doors left. I'm standing behind both.",
      "Crack. That was your favorite hiding place.",
      "Your guard is down. Mine is not. Do the arithmetic.",
      "Strike or Feint. Choose. I already have.",
      "Shield's gone. Now we see what you do when it's frightening.",
      "No hiding next turn. Just you and your instincts. Pity.",
      "I slipped past. You Guard like you're shutting a door on rain."
    ],

    guard_break_rival: [
      "Rude. That guard was an antique.",
      "Fine. My guard is down. Do something clever. I'll wait.",
      "You broke it. Now you'll Strike. Everyone Strikes.",
      "No Guard for me. Two choices left. You'll still guess wrong.",
      "A Feint. From you. I'm almost insulted that it worked.",
      "Guard broken. Don't gloat. You'll need the breath.",
      "Enjoy the opening. I've seen what you do with openings.",
      "Cracked. Well. I never liked hiding anyway. That's a lie.",
      "So you do know how a Feint works. I had wondered."
    ],

    // Death screen parting line.
    player_death: [
      "Death {deaths}. I've started naming them.",
      "Go on, then. Walk back. I'll keep your habits warm.",
      "Dead again. I'll be here. I'm always here.",
      "You died as you lived. Predictably.",
      "{deaths} deaths. The floor knows your shape by now.",
      "Duel {duel}. That's where you stop today. Noted.",
      "Rest. Come back different. You won't, but come back.",
      "I'd bury you, but you keep getting up.",
      "Another candle out. I have so many of yours.",
      "It took {turns} turns. I was in no hurry.",
      "Was that the plan? It looked like the plan. It always does.",
      "The bell tolls for you. It's getting tired of it.",
      "Same mistake, new corpse.",
      "Go home. Sleep. Dream of Guarding at the right time.",
      "I don't enjoy this. That was a lie. You know I lie.",
      "Until next time. There's always a next time with you.",
      "Run {runs} ends here. I'm not complaining.",
      "Predictability: {score}. I barely had to look up."
    ],
    // Died in the very first duel.
    player_death_duel1: [
      "The first duel. You died in the doorway.",
      "Duel one. I had barely started lying.",
      "That was the easy one. I was being gentle.",
      "You fell in the Nave. Most at least reach the pews."
    ],
    // Died in duel 7 or to the Unmasked.
    player_death_final: [
      "So close. You could see the end. It could see you.",
      "At the altar, of all places. Fitting. Come again.",
      "You nearly had me. 'Nearly' is my favorite word of yours.",
      "All that way, to die on the last step. Walk it again."
    ],
    // Died with the Rival almost dead. {rivalHp} = what it had left.
    player_death_close: [
      "I had {rivalHp} left. Does that keep you up?",
      "{rivalHp} health. That's all I had. You'll think about that.",
      "You were {rivalHp} away. I felt it. I'll deny it tomorrow.",
      "{rivalHp} left on my side. Closer than I like. Tell no one."
    ],

    // Duels 1-6: it yields, it does not die.
    rival_defeated: [
      "I yield. Briefly. See you by the fire.",
      "Well struck. I'll be insufferable about it later.",
      "Enough. Take your little victory to the fire. Warm it.",
      "I concede the duel. Not the argument.",
      "Yes, yes. You won. Don't narrate it.",
      "I yield. I learned more losing than you did winning.",
      "A point to you. I'm keeping count. You know I am.",
      "Go and rest. I'll be choosing something unpleasant.",
      "Cleanly done. Now I know you can. That will cost you.",
      "I'll kneel. The mask doesn't bow, so this is all you get."
    ],
    // The Unmasked falls. Quieter. The smirk slips.
    rival_defeated_final: [
      "...Ah. So that's what it's like. From this side.",
      "You learned me. I never thought to guard against that.",
      "Keep the mask. I never knew what was under it either.",
      "All those deaths. You were studying. I thought I was.",
      "Well fought. No joke this time. I can't find one.",
      "Come back anyway. It's a very long eternity."
    ],

    run_50: [
      "Fifty runs. That's not persistence. That's a relationship.",
      "Run fifty. I baked nothing. I did, however, memorize you.",
      "Fifty. I've known pilgrims with less devotion.",
      "Fifty times you've walked in. I've stopped locking the door."
    ],

    // Generic milestone lines ({runs}, {deaths}); the exact milestones follow.
    milestone_runs: [
      "Run {runs}. At this point I'm your longest commitment.",
      "{runs} attempts, {deaths} deaths. The math is not flattering.",
      "Run {runs}. I've kept them all. Filed by cause of death.",
      "{runs} runs. You keep count too, don't you. Don't lie to me."
    ],
    milestone_runs_5: [
      "Run five. Still here. I've stopped assuming you'll quit.",
      "Five runs. Enough to start a file on you. I've started two."
    ],
    milestone_runs_10: [
      "Ten runs. Double digits. The dossier needed a second page.",
      "Run ten. I've had the moon repainted. For you. Don't gloat."
    ],
    milestone_runs_25: [
      "Twenty-five runs. I hum your mistakes while I wait.",
      "Run twenty-five. A quarter of the way to worrying me."
    ],
    milestone_runs_100: [
      "One hundred runs. I should say something kind. A moment. No.",
      "A hundred visits. Even the bells ask after you."
    ],
    milestone_runs_200: [
      "Two hundred. One of us should have learned something by now.",
      "Two hundred. I no longer remember this place without you."
    ],

    // Duel-1 intro after {days} >= 2 away.
    returning: [
      "{days} days. I was beginning to think you'd found a hobby.",
      "Back after {days} days. The candles missed you. I did not.",
      "{days} days away. I rehearsed. Did you?",
      "Gone {days} days. I counted them. There's nothing else to count.",
      "{days} days. I kept your place. And your mistakes.",
      "Gone {days} days and you come back to this? Flattering.",
      "{days} days of silence. Then you. I'd nearly gotten some rest.",
      "{days} days. You'll be rusty. I am not capable of rust.",
      "After {days} days, I wondered if you'd forgotten me. I can't."
    ],

    // {streak} >= 3 lost runs in a row.
    lose_streak: [
      "{streak} deaths running. Should I fight left-handed? I'm asking sincerely.",
      "That's {streak} in a row. I'm running out of ways to pity you.",
      "{streak} straight losses. I'd go easier, but I don't know how.",
      "Lost {streak} running. At some point it's a tradition.",
      "{streak} in a row. Have you tried being someone else?",
      "{streak} losses. I've stopped trying new things. No need.",
      "{streak} defeats in a row. The bell ringer wants a raise.",
      "{streak} deaths, back to back. Change something. Surprise me.",
      "{streak} in a row. I admire the commitment, if not the result."
    ],

    // {streak} >= 2 won runs in a row.
    win_streak: [
      "{streak} wins. Fine. I'm taking notes in a much angrier hand.",
      "Beaten {streak} times running. I liked you better dead.",
      "{streak} in a row. You're becoming a problem. I love problems.",
      "{streak} straight. Don't get comfortable. That's my job.",
      "You've won {streak} running. I've been rereading everything.",
      "{streak} wins. I remember when you were furniture.",
      "{streak} in a row? I'll stop underestimating you. Tomorrow."
    ],

    // The player drafts {boon}.
    bonfire_player_pick: [
      "{boon}? Bold. Wrong, but bold.",
      "{boon}. Of course. You always take the shiny one.",
      "{boon}. I hoped you'd leave that one. Not for my sake.",
      "You took {boon}. I'd have bet the mask on it.",
      "{boon}. A fine choice for someone else.",
      "{boon}. Interesting. I'll plan around it. I already have.",
      "{boon}. The others were better. I won't say which.",
      "{boon}. You're building something. It's adorable.",
      "{boon}. That will help. Not enough, but it will help.",
      "Take {boon}, then. It won't fix the real problem.",
      "{boon}? You read the card this time? All of it?",
      "{boon}. Noted. Everything is noted.",
      "{boon}. Good. I was worried you'd pick wisely.",
      "So it's {boon}. I know how you'll use it. Do you?"
    ],

    // The Rival drafts {rivalBoon} (no particular reason).
    bonfire_rival_pick: [
      "I'll have {rivalBoon}. It goes with the mask.",
      "{rivalBoon}, for me. Read it slowly. Dread it properly.",
      "Mine: {rivalBoon}. Yours: whatever's left.",
      "{rivalBoon}. I've been saving a place for it.",
      "I choose {rivalBoon}. You may gasp.",
      "{rivalBoon}. Don't worry. You'll learn what it does.",
      "First pick is {rivalBoon}. Rank has its privileges.",
      "{rivalBoon}. It's not personal. It's extremely personal.",
      "I'll take {rivalBoon}. You take notes.",
      "{rivalBoon} comes with me. Choose your consolation."
    ],
    // ...because of a habit (run.offer.rivalWhy).
    bonfire_rival_pick_G: [
      "You Guard too much. So: {rivalBoon}.",
      "All that Guarding. {rivalBoon} was made for it.",
      "{rivalBoon}. A gift for the one behind the shield."
    ],
    bonfire_rival_pick_S: [
      "You Strike too often. {rivalBoon} will enjoy that.",
      "So much Striking. I chose {rivalBoon} with you in mind.",
      "{rivalBoon}. For every Strike you can't help throwing."
    ],
    bonfire_rival_pick_F: [
      "You do love a Feint. Hence: {rivalBoon}.",
      "{rivalBoon}. You Feint like it's a secret. It isn't.",
      "Feint, Feint, Feint. Very well. {rivalBoon}."
    ],
    bonfire_rival_pick_repeat: [
      "You repeat yourself. So: {rivalBoon}. You repeat yourself.",
      "{rivalBoon}. For someone who plays the same move twice.",
      "Same move, again and again. {rivalBoon} punishes that."
    ],
    bonfire_rival_pick_predictable: [
      "{rivalBoon}. It feeds on the predictable. It will eat well.",
      "I know your next move. {rivalBoon} pays me for knowing.",
      "You're easy to read. So: {rivalBoon}. Thank you for that."
    ],
    // Either too trusting or too suspicious of the stance: lines fit both.
    bonfire_rival_pick_trust: [
      "I know how you treat my stance. {rivalBoon} bills you for it.",
      "You answer my stance the same way every time. {rivalBoon}.",
      "{rivalBoon}. Because of what you do when I show my hand."
    ],
    // The player is stacking one archetype.
    bonfire_rival_pick_tags: [
      "I see what you're building. {rivalBoon} takes it apart.",
      "Your little collection has a theme. So: {rivalBoon}."
    ],

    // Start of duels 2-6. {move}/{pct} are the opening stat when there is one.
    duel_intro: [
      "Duel {duel}. You open with {move} {pct}% of the time. Just saying.",
      "Rested? Good. I prefer my opponents hopeful.",
      "Again. From the top. You know your part.",
      "Duel {duel}. I lie more from here. I'm telling you honestly.",
      "You're still here. So am I. Only one of us chose it.",
      "The fire did you good. Let me undo that.",
      "{hp} health and a new toy. Let's see how you waste them.",
      "Fewer candles as we go. Have you noticed? You will.",
      "Ready? It doesn't matter. I've decided how this goes.",
      "Shall we? I've been standing here the whole time.",
      "While you rested, I reread you. Cover to cover.",
      "Deeper in. The stances get less honest. So do I.",
      "Duel {duel}. Try something new. I'll pretend it's working.",
      "Back from the fire. You smell of smoke and hope.",
      "You'll open with {move}. You do, {pct}% of the time. Prove me wrong.",
      "{pct}% of your duels begin with {move}. This one too?"
    ],

    final_duel_intro: [
      "Seven. The altar. You know every stone by now; you've died on most of them.",
      "No more lessons. I know you by heart. Come and be known.",
      "The altar. Twelve candles. One of them is yours.",
      "Last time you ended me with a {lastWinMove}. I've thought of little else.",
      "{lastWinHp} health. That's what you had left last time. I counted.",
      "{deaths} deaths to stand here. Was it worth it? Don't answer.",
      "This is the end of the aisle. I'm what's at the end.",
      "Everything I've learned about you is in this room. So am I."
    ],

    // The mask breaks. It may finally raise its voice.
    phase2: [
      "You broke the mask. Do you know how long I painted that smile?",
      "No more face. No more manners. LOOK AT ME.",
      "That was the polite half. This is the rest.",
      "Embers, now. The tension never leaves. NEITHER DO I.",
      "I will name your move before you make it. And be RIGHT.",
      "You wanted to see under the mask. Everyone does. ONCE.",
      "Every death of yours, I kept. They are all in HERE."
    ],

    // Called Shot: it names the move it expects.
    called_shot_call: [
      "You will {moveLower}. I've read this page already.",
      "{move}. That's your next move. Go on. Prove me wrong.",
      "I call it: {move}. Your hand is already moving.",
      "You're about to {moveLower}. I can hear you deciding."
    ],
    // The player played the called move and lost the exchange.
    called_shot_right: [
      "As called. You read from my script beautifully.",
      "{move}. I SAID {move}.",
      "Told you. I always tell you. You never listen.",
      "Called it. Paid in full."
    ],
    // The player played something else.
    called_shot_wrong: [
      "Wrong?! You... deviated. How dare you surprise me now.",
      "No. NO. That is not what you do.",
      "I called it wrong. Here, of all places. Tonight, of all nights.",
      "You broke the script. ...Good. Do it again. I dare you."
    ],

    // 14 seconds without input.
    idle: [
      "Take your time. I have eternity and a very comfortable cloak.",
      "Thinking? That's new. I'll note the date.",
      "No rush. The candles are only burning down forever.",
      "Still deciding? I decided ages ago. It's sealed. Right there.",
      "I can wait. I'm excellent at it. Centuries of practice.",
      "Whatever you pick, you were always going to pick it.",
      "Dust is settling on you. I'd move, if I were you."
    ],

    // Death / victory screen: wraps one runInsights() stat (vars from R.Text.tauntVars).
    learned_lines: [
      "This run: {pct}% {move} {ctxPhrase}.",
      "Tonight you chose {move} {ctxPhrase}, {pct}% of the time.",
      "{ctxPhrase}: {move}, {pct}% this run. I leaned on that.",
      "Lesson: {ctxPhrase}, you {moveLower}. {pct}% this time.",
      "{pct}% {move} {ctxPhrase}. That's where I found you.",
      "For the record: {move} {ctxPhrase}, {pct}%.",
      "{ctxPhrase}, {pct}% {move}. Write it down. I did.",
      "Noted this run: you {moveLower} {ctxPhrase}. {pct}%.",
      "{move} {ctxPhrase}, {pct}%. That goes in the book.",
      "I learned this: {ctxPhrase}, you {moveLower}. {pct}%.",
      "{pct}% of the time, {ctxPhrase}, you chose {move}."
    ],

    // Victory screen.
    victory_summary: [
      "You won. It took {deaths} deaths. I enjoyed every one.",
      "Run {runs}. The one where you finally listened.",
      "{hp} health left. You call that a victory? ...So do I.",
      "Enjoy it. I'm already studying how you did it.",
      "Wins: {wins}. I remember when that number was a joke.",
      "{turns} turns to beat me. I'll want every one of them back."
    ],

    // Credits roll: in-fiction heckles only. The one real credit is R.Text.ui.credit.
    credits_footnotes: [
      "Deaths provided by you. All {deaths} of them.",
      "One duelist was harmed. {deaths} times. I kept count.",
      "Candles lit by me. Every night. Nobody thanks me.",
      "The smile was painted by hand. Mine. It took an age.",
      "Your habits appear courtesy of you.",
      "Ash supplied by everything that came before.",
      "{runs} runs. I was there for all of them.",
      "Bell rung by no one. It rings anyway.",
      "I remain, as ever, your Rival.",
      "You may go now. You won't."
    ]
  };

  // The scripted first duel (DESIGN.md section 17), keyed by beat.
  var tutorial = {
    intro: "Ah. A new one. Lovely. Let me teach you how to lose.",
    t1_tell: "This is my Strike stance. Guard beats Strike. Go on.",
    t1_result: "Good. A trained crow could do it, but good.",
    t2_tell: "Now I Guard. A Feint slips past a Guard. Try it.",
    t2_result: "My guard is broken. No Guard for me next turn. See?",
    t3_tell: "Strike again. You know what beats it.",
    t3_guard: "Lesson three: I lie. A Strike would have cut that Feint down.",
    t3_strike: "...You didn't trust me. Good. Strike beats Feint. Remember it.",
    t3_feint: "A clash. Tension builds. The next hit lands harder.",
    t4_lie: "Also: I lie. Often.",
    first_clash: "Same move, no blood. That is a clash. Tension builds.",
    first_tension: "See the pips? Each one adds to the next hit. Three is the limit.",
    first_lie: "My stance said one thing. I did another. Get used to it.",
    bonfire_first: "I choose first. You may watch.",
    bonfire_cards: "Pick one. Choose badly; I enjoy that."
  };

  // The same lines as a plain category, in beat order (the scene uses R.Text.tutorial).
  taunts.first_run_tutorial = Object.keys(tutorial).map(function (k) { return tutorial[k]; });

  // ------------------------------------------------------------------ helpers

  function moveName(m) {
    if (typeof m !== 'string') return '';
    if (MOVE_NAME[m]) return MOVE_NAME[m];
    var k = m.charAt(0).toUpperCase();
    return (MOVE_NAME[k] && MOVE_NAME[k].toLowerCase() === m.toLowerCase()) ? MOVE_NAME[k] : '';
  }

  function lookup(vars, key) {
    var v = vars[key];
    if ((v === undefined || v === null) && key === 'moveLower') {
      // Derive the verb form from {move} when the caller only passed the move.
      var mv = lookup(vars, 'move');
      return mv === undefined ? undefined : mv.toLowerCase();
    }
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v)) : undefined;
    if (typeof v !== 'string') return undefined;
    if (v === '') return undefined;
    if (MOVE_KEYS[key] && MOVE_NAME[v]) return MOVE_NAME[v];
    return v;
  }

  // Replace {name} with vars[name]. Null if any referenced variable is missing.
  // The first letter of the result is capitalised (a line may start with {ctxPhrase}).
  function fill(template, vars) {
    if (typeof template !== 'string') return null;
    vars = (vars && typeof vars === 'object') ? vars : {};
    var missing = false;
    var out = template.replace(/\{(\w+)\}/g, function (all, key) {
      var v = lookup(vars, key);
      if (v === undefined) { missing = true; return ''; }
      return v;
    });
    if (missing) return null;
    var c = out.charAt(0);
    if (c >= 'a' && c <= 'z') out = c.toUpperCase() + out.slice(1);
    return out;
  }

  // Fallback generator for when the caller passes no rng (never Math.random).
  var lcgState = 0x2545f491;
  var LCG = {
    next: function () {
      lcgState = (Math.imul(lcgState, 1664525) + 1013904223) >>> 0;
      return lcgState / 4294967296;
    }
  };

  // Shuffle bags: session-only, one per category. A line cannot recur until its bag is spent.
  var bags = {};

  function freshOrder(n, rng) {
    var order = [], i, j, t;
    for (i = 0; i < n; i++) order.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(rng.next() * (i + 1));
      if (!(j >= 0 && j <= i)) j = i;          // a misbehaving rng must not break the bag
      t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  function draw(list, bag, vars, skip) {
    for (var i = 0; i < bag.order.length; i++) {
      var idx = bag.order[i];
      if (idx === skip) continue;
      var s = fill(list[idx], vars);
      if (s !== null) {
        bag.order.splice(i, 1);
        bag.last = idx;
        return s;
      }
    }
    return null;
  }

  // Pick a line of `category` whose variables are all present in `vars`.
  // Null if the category does not exist or no line can be filled.
  function taunt(category, vars, rng) {
    var list = T.taunts ? T.taunts[category] : null;
    if (!Array.isArray(list) || list.length === 0) return null;
    var r = (rng && typeof rng.next === 'function') ? rng : LCG;
    var bag = bags[category];
    if (!bag || bag.list !== list) bag = bags[category] = { list: list, order: freshOrder(list.length, r), last: -1 };

    var s = draw(list, bag, vars, -1);
    if (s !== null) return s;
    // Nothing usable is left in the bag: refill it, and avoid an immediate repeat if we can.
    bag.order = freshOrder(list.length, r);
    s = draw(list, bag, vars, bag.last);
    if (s !== null) return s;
    return draw(list, bag, vars, -1);
  }

  // ------------------------------------------------------------------ exports

  T.taunts = Object.assign({}, T.taunts || {}, taunts);
  T.tutorial = Object.assign({}, T.tutorial || {}, tutorial);
  T.move = moveName;
  T.fill = fill;
  T.taunt = taunt;
  T.resetTaunts = function () { bags = {}; };   // forget every shuffle bag (tests, save reset)

})(globalThis.RIVAL = globalThis.RIVAL || {});
