/**
 * Static file server for the browser tests.
 *
 * Playwright's webServer config cannot invoke a package-manager script under
 * Bazel: the package manager is not necessarily present in the test action, and
 * `vite preview` would serve the source tree's dist/ rather than the bundle
 * Bazel declared as test data. This serves a directory given on argv instead,
 * so the same entry point works locally and under Bazel.
 *
 * Usage: node preview-server.mjs <root-dir> <port>
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const [, , rootArg, portArg] = process.argv;
if (!rootArg || !portArg) {
  console.error('usage: preview-server.mjs <root-dir> <port>');
  process.exit(2);
}
const root = normalize(rootArg);
const port = Number(portArg);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  // Strip the query string and refuse to escape the served root.
  const rawPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = normalize(rawPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const filePath = join(root, relative === '' ? 'index.html' : relative);

  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not Found');
  }
});

server.listen(port, () => {
  console.log(`preview-server: serving ${root} on http://localhost:${port}`);
});
