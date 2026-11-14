// Dev-only static server for previewing the build. Not part of the game.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.md': 'text/plain; charset=utf-8', '.json': 'application/json' };
http.createServer((req, res) => {
  // Dev helper: POST /shot/<name> with a PNG body saves tools/out/<name>.png (used to review frames).
  if (req.method === 'POST' && req.url.indexOf('/shot/') === 0) {
    const name = req.url.slice(6).replace(/[^a-z0-9_-]/gi, '') || 'shot';
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      fs.mkdirSync(path.join(root, 'tools', 'out'), { recursive: true });
      fs.writeFileSync(path.join(root, 'tools', 'out', name + '.png'), Buffer.concat(chunks));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(port, () => console.log('serving ' + root + ' on http://localhost:' + port));
