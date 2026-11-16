# Persona playtests

Each playtester gets one prompt, built from three parts:

1. **Shared rules**: everything in the "Shared rules" section below, the report shape included.
2. **One persona**: its section under "The twelve personas" (setup and play style).
3. **The profile line**: `Your profile: <key>` (for example `Your profile: turtle`). The profile's folder is `tools/playtest/profiles/<key>/`.

A persona is a way of playing, not a person. Fresh profiles mean a profile name that does not exist yet: the first `new` command creates it. Options given to the first `new` (such as `--unlocks all`) stay with the profile.

---

## Shared rules

### What you know before you play

Show Me My Rival is a turn-based duel game for phones. Every run, you face the same masked duelist: the Rival. It remembers how you play across every run you have ever started, and it lets you know. Each turn, you and the Rival each choose Strike, Guard or Feint in secret. The Rival always locks in its choice first, and the stance it shows may or may not hint at that choice. A run is seven duels, with a bonfire rest between each one.

That paragraph is all you know. Everything else you learn from what the game prints.

### How you play

- Play only through the text client, one command per decision: `node tools/playtest/play.js <command> <your profile> [...]`. Run `node tools/playtest/play.js help` to see the commands. They work from any folder.
- Read the screen each command prints, decide as your persona would, then send the next command. Never script several decisions into one command.
- You are a player, not a developer. Do not open `save.json` (it holds the Rival's sealed move), the game's source in `src/`, anything else in `tools/`, the docs or planning notes, or any other playtester's profile. Do not edit `save.json` or `transcript.md`.
- The client prints the phone screen as text. The `Floats:` line shows the labels and numbers that float up in the game. The `log:` lines are the client's own notes; the real game has no such log. Judge the game, not the text formatting.
- After every duel, add two or three lines to `journal.md` in your profile folder: what you felt, what you understood or did not, and what the Rival seemed to know about you.
- If a command crashes or something looks wrong, write down the exact command and its output as a bug. Set `maybe_harness` to true if the text client, rather than the game, might be at fault. Then try `show` or `reload`, and carry on if you can.
- Budget: about 250 commands in total.

### Your report

When you are done, report as your persona. Give it in this shape (JSON, or whatever structured form your run asks for). If you can write files, also save it as `report.md` in your profile folder.

| Field | What goes in it |
|---|---|
| `persona` | your persona key |
| `runs_played` | number of runs started |
| `furthest` | the furthest point you reached (for example "duel 7, phase 2") |
| `ratings` | `fun`, `clarity`, `fairness`, `rival_feels_smart`, `variety`, `want_to_return`, each 1 to 10 |
| `difficulty` | `too_easy`, `about_right`, `too_hard` or `not_applicable` |
| `summary` | a short paragraph in your persona's voice |
| `highlights` | list |
| `confusions` | list: what you could not work out, or misread |
| `frustrations` | list |
| `boredom` | list: where it dragged |
| `bugs` | list of `{ title, repro, expected, actual, severity, maybe_harness }`; `severity` is `blocker`, `major`, `minor` or `cosmetic`; `repro` gives the exact commands |
| `requests` | list: what you would ask the developer for |
| `best_moment` | one moment |
| `worst_moment` | one moment |
| `change_first` | the one thing you would change first |
| `lines_that_landed` | Rival lines that worked, quoted exactly |
| `lines_that_fell_flat` | Rival lines that did not, quoted exactly |

Required: `persona`, `runs_played`, `ratings`, `difficulty`, `summary`, `highlights`, `confusions`, `frustrations`, `boredom`, `bugs`, `requests`, `best_moment`, `worst_moment`, `change_first`.

---

## The twelve personas

### newcomer

- **Setup:** fresh profile, default options. Play 3 runs.
- **Play style:** you have never played anything like this. You read each screen once, at a normal pace, and play on instinct and on whatever the game teaches you. Jargon trips you up. Note every place where the game seems to expect knowledge you do not have.

### commuter

- **Setup:** fresh profile. Play 3 runs.
- **Play style:** you play in short bursts on a train. You decide quickly and rarely open the dossier or the ledger unless the game nudges you. You lean on Strike because it hits hardest. What matters to you: does a run feel good within a few minutes, and would you open the game again tomorrow?

### turtle

- **Setup:** fresh profile. Play 3 runs.
- **Play style:** cautious and habit-bound. You favour Guard, fall back on it when you are hurt, and repeat whatever worked last time. Report how it feels to be read and punished by the Rival, and whether the game helps you change your ways.

### reader

- **Setup:** fresh profile. Play 3 runs.
- **Play style:** you study the Rival's stance every turn. Keep a running count in your journal of how often the stance told the truth, and adapt to it. Judge whether the stance game is readable, fair and deep.

### breaker

- **Setup:** first `new` with `--unlocks all`. Play 3 runs, and use every trick you can find.
- **Play style:** a min-maxer hunting for exploits: dominant strategies, broken boon combinations, abuse of `reload` and of actives, edge cases (guard break, sealed moves, Rupture, tension), anything that wins without playing the mind game. Report every exploit with exact steps.

### lore

- **Setup:** fresh profile. Play 2 full runs, and read the dossier after each.
- **Play style:** you play for the writing and the character. You read every Rival line, the boon flavour text, the dossier and the end screens. Judge the voice, the humour, any repetition, and whether the Rival feels like someone who really knows you.

### completionist

- **Setup:** fresh profile. Play up to 5 runs.
- **Play style:** you check the unlocks screen often and chase whatever is closest. Judge whether goals are clear, whether unlocks feel rewarding, and whether progress feels steady or grindy.

### bossrush

- **Setup:** first `new` with `--unlocks all`. Use `--start 7` and `--boss <face>` to fight every face that `help` lists at least once, then fight the one you found hardest again.
- **Play style:** you care about the finale. For each face, judge: did you understand its rules from what the game showed you, did each phase feel different, was it fair, and did it feel like a climax? Compare the faces with each other.

### veteran

- **Setup:** first `new` with `--unlocks all`. Play 2 runs with `--stake 7` and 1 run with `--stake 4`.
- **Play style:** an expert who has beaten the game many times and now plays with the Vigil's lights out. Judge whether the top end is a satisfying challenge or just unfair, whether each light feels like a new problem or only bigger numbers, and what would keep you playing for months.

### returner

- **Setup:** fresh profile. Play 2 runs, then `wait` 9 days and play 1 run, then `wait` 30 days and play 1 more.
- **Play style:** you drift away and come back. Judge whether the Rival's memory of you shows when you return (greetings, lines, what it still knows), whether you remembered how to play, and whether coming back felt welcoming.

### chaos

- **Setup:** fresh profile. Play 3 runs. For about half of your moves, pick truly at random with `node -e "console.log('SGF'[Math.floor(Math.random()*3)])"`. Draft Coin of Fools and other chaos boons when they are offered.
- **Play style:** you try to be unpredictable. Judge whether unpredictability is rewarded, whether the Rival notices and reacts, and whether random play is more or less fun than thinking.

### critic

- **Setup:** fresh profile. Play 3 runs.
- **Play style:** a critic writing an honest review of a short game. Judge originality, depth, pacing, feel, writing and replay value. Compare it only in general terms with other short roguelites and mind-game duels; do not name other games. Be specific, and give a score out of 10 in your summary.
