// SHOW ME MY RIVAL - build: inlines src/**/*.js into src/shell.html and writes index.html.
// Zero dependencies. Usage: node tools/build.js [--out <path>]
//   --out <path>   write the page there instead (resolved against the working folder). The sources are always the
//                  src/ next to this script, so a copy of the repo builds from its own src (tools/test_all.js uses this).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const MARK = '/*__CODE__*/';
const HEADER = '<!--\n  SHOW ME MY RIVAL\n  Developed by tangoSHELL \u00b7 2026\n-->\n';

let outArg = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') {
    if (i + 1 >= argv.length || !argv[i + 1]) { console.error('build: --out needs a path'); process.exit(1); }
    outArg = argv[++i];
  } else if (a.indexOf('--out=') === 0 && a.length > 6) outArg = a.slice(6);
  else { console.error('build: unknown argument ' + a + ' (usage: node tools/build.js [--out <path>])'); process.exit(1); }
}

// Build order is the contract in INTERFACES.md.
const ORDER = [
  'core/rng.js', 'core/save.js',
  'art/palette.js', 'art/pix.js', 'art/font.js', 'art/sprites.js', 'art/icons.js', 'art/backgrounds.js', 'art/ui.js', 'art/fx.js',
  'audio/audio.js',
  'text/strings.js', 'text/taunts.js', 'text/dossier.js',
  'ai/brain.js',
  'game/boons.js', 'game/combat.js', 'game/run.js',
  'core/engine.js'
];

function sceneFiles() {
  const dir = path.join(src, 'scenes');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => 'scenes/' + f);
}

const files = ORDER.concat(sceneFiles(), ['main.js']);
const parts = [];
const missing = [];
for (const rel of files) {
  const file = path.join(src, rel);
  if (!fs.existsSync(file)) { missing.push(rel); continue; }
  let code = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  if (/<!--/.test(code)) console.warn('  warning: "<!--" inside ' + rel + ' (legal, but avoid it inside an inline script)');
  // A literal "</script" would end the inline script block; "<\/script" is identical inside JS strings and regexes.
  code = code.replace(/<\/(script)/gi, '<\\/$1');
  parts.push('// ---- ' + rel + ' ----\n' + code.replace(/\s+$/, '') + '\n');
}
for (const rel of missing) console.log('  note: skipped (not written yet): src/' + rel);

const shellPath = path.join(src, 'shell.html');
if (!fs.existsSync(shellPath)) { console.error('build: src/shell.html is missing'); process.exit(1); }
const shell = fs.readFileSync(shellPath, 'utf8').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
if (shell.split(MARK).length !== 2) { console.error('build: src/shell.html must contain exactly one ' + MARK + ' marker'); process.exit(1); }

const bundle = parts.join(';\n');
const out = HEADER + shell.replace(MARK, () => bundle);   // function form: no "$" substitution surprises
const outPath = outArg ? path.resolve(process.cwd(), outArg) : path.join(root, 'index.html');
if (outArg) fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');

const bytes = Buffer.byteLength(out, 'utf8');
const shown = outArg ? (path.relative(process.cwd(), outPath) || outPath) : 'index.html';
console.log('built ' + shown + ': ' + parts.length + ' files, ' + (bytes / 1024).toFixed(1) + ' KB (' + bytes + ' bytes)');
