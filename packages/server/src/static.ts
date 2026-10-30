/** Minimal static file server for the built client (packages/client/dist). */
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function serveStatic(root: string) {
  const base = resolve(root);
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(base, rel));
    if (file !== base && !file.startsWith(base + sep)) return false; // path traversal guard
    let target = file;
    try {
      if (!statSync(target).isFile()) throw new Error('not file');
    } catch {
      if (extname(rel)) return false; // a missing asset is a real 404
      target = join(base, 'index.html'); // single-page app fallback
      try { statSync(target); } catch { return false; }
    }
    const ext = extname(target);
    // Hashed assets from Vite can be cached forever; index.html must always be fresh so deploys land.
    const immutable = target.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return true; }
    createReadStream(target).pipe(res);
    return true;
  };
}
