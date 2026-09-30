// Development-only static test host. The deployed application needs no server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/network-test\//, '/');
  const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1');
