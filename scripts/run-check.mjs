// Serves the built site (out/) from this process, runs one check script against it, and stops the server.
//   node scripts/run-check.mjs scripts/balance-check.mjs [/page/ ...]
// The server lives inside this process and stops when the check ends: no detached shell, no polling.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const [task, ...rest] = process.argv.slice(2);
if (!task) { console.error("usage: node scripts/run-check.mjs <check.mjs> [args]"); process.exit(2); }
const root = resolve("out");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = resolve(join(root, p));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}`;
let status = 0;
try {
  const mod = await import(pathToFileURL(resolve(task)).href);
  await mod.default({ base, args: rest });
} catch (e) { console.error("CHECK FAILED:", e); status = 1; }
finally { server.close(); process.exit(status || process.exitCode || 0); }
