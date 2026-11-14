// SHOW ME MY RIVAL - build checker: index.html must be fully self-contained and carry the credits.
// Usage: node tools/check.js   (exit 1 on any failure)
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..', 'index.html');
if (!fs.existsSync(file)) { console.error('check: index.html not found (run node tools/build.js first)'); process.exit(1); }
const html = fs.readFileSync(file, 'utf8');
const lower = html.toLowerCase();
const fails = [];

// Which source file does an offset in index.html come from? (uses the "// ---- path ----" markers from build.js)
function where(idx) {
  const line = html.slice(0, idx).split('\n').length;
  const mk = html.lastIndexOf('// ---- ', idx);
  const m = mk >= 0 ? /^\/\/ ---- (\S+) ----/.exec(html.slice(mk, mk + 200)) : null;
  const ls = html.lastIndexOf('\n', idx - 1) + 1;
  let le = html.indexOf('\n', idx); if (le < 0) le = html.length;
  const text = html.slice(ls, le).trim();
  return 'line ' + line + (m ? ' [src/' + m[1] + ']' : '') + ': ' + (text.length > 90 ? text.slice(0, 90) + '...' : text);
}

// Plain substring bans (case-insensitive): nothing that could make, or look like, an external request.
const banned = ['http://', 'https://', 'fetch(', 'xmlhttprequest', 'import(', '<img', '<script src', '@import', 'url('];
for (const needle of banned) {
  let i = -1, n = 0;
  while ((i = lower.indexOf(needle, i + 1)) >= 0) {
    if (n++ < 5) fails.push('forbidden "' + needle + '" at ' + where(i));
  }
  if (n > 5) fails.push('...and ' + (n - 5) + ' more "' + needle + '"');
}

// <link> is only allowed as the empty-favicon stub: href="data:,"
const linkRe = /<link\b[^>]*>/gi;
let m;
while ((m = linkRe.exec(html))) {
  const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
  const v = href ? (href[1] !== undefined ? href[1] : href[2] !== undefined ? href[2] : href[3]) : null;
  if (v !== 'data:,') fails.push('<link> with href other than "data:," at ' + where(m.index));
}

// Required content.
if (!/<title>SHOW ME MY RIVAL<\/title>/.test(html)) fails.push('missing <title>SHOW ME MY RIVAL</title>');
if (!/<meta\s+name="author"\s+content="tangoSHELL"\s*\/?>/.test(html)) fails.push('missing <meta name="author" content="tangoSHELL">');
const head = /^\s*<!--([\s\S]*?)-->/.exec(html);
if (!head) fails.push('file does not start with an HTML header comment');
else {
  if (head[1].indexOf('SHOW ME MY RIVAL') < 0) fails.push('header comment lacks "SHOW ME MY RIVAL"');
  if (head[1].indexOf('Developed by tangoSHELL \u00b7 2026') < 0) fails.push('header comment lacks "Developed by tangoSHELL \u00b7 2026"');
}
if (html.indexOf('/*__CODE__*/') >= 0) fails.push('unreplaced /*__CODE__*/ marker');
if ((lower.match(/<\/script>/g) || []).length !== (lower.match(/<script\b/g) || []).length) fails.push('unbalanced <script> tags (a "</script>" leaked into the code?)');

const bytes = Buffer.byteLength(html, 'utf8');
console.log('index.html: ' + (bytes / 1024).toFixed(1) + ' KB (' + bytes + ' bytes), ' + html.split('\n').length + ' lines');
if (fails.length) {
  console.error('CHECK FAILED (' + fails.length + '):');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('check OK: no external requests, credits present');
