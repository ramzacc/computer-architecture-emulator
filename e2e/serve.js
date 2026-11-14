import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};
const host = "127.0.0.1";
const port = 8788;

const server = createServer(async (request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname); }
  catch { response.writeHead(400).end("Bad request"); return; }
  const file = normalize(join(root, pathname.endsWith("/") ? `${pathname}index.html` : pathname));
  if (file !== root.replace(/[\\/]$/, "") && !file.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const data = await readFile(file);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, host, () => console.log(`Serving public/ at http://${host}:${port}/`));
