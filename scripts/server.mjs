import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import {
  assertSafePath, BUILD_MARKER, BUILD_SIGNATURE, imageManifest, isMain,
  MANIFEST_FILE, PROJECT_ROOT, readSafeFile, SITE_FILES, validateInputs,
} from "./assets.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".avif": "image/avif",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
  ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};

function requestError(status, message) {
  return Object.assign(new Error(message), { status });
}

function routePath(target) {
  if (!target?.startsWith("/") || target.includes("#")) throw requestError(400, "Bad request");
  const pathname = target.split("?", 1)[0];
  if (pathname === "/") return "index.html";
  const parts = pathname.slice(1).split("/").map((part) => {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw requestError(400, "Bad request");
    }
    if (!decoded || decoded.startsWith(".")) throw requestError(404, "Not found");
    if (/[/\\\u0000-\u001f\u007f]/u.test(decoded)) throw requestError(400, "Bad request");
    return decoded;
  });
  return parts.join("/");
}

export function createStaticServer({ root = PROJECT_ROOT, mode = "dev", onError = () => {} } = {}) {
  if (!["dev", "preview"].includes(mode)) throw new Error(`Unknown server mode: ${mode}`);
  root = resolve(root);
  const siteRoot = mode === "preview" ? join(root, "dist") : root;
  return createServer(async (request, response) => {
    function send(status, body, type = "text/plain; charset=utf-8", headers = {}) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      response.writeHead(status, {
        "Content-Type": type,
        "Content-Length": bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    }
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        send(405, "Method not allowed\n", undefined, { Allow: "GET, HEAD" });
        return;
      }
      const route = routePath(request.url);
      let content;
      if (route === MANIFEST_FILE && mode === "dev") {
        content = await imageManifest(root);
      } else {
        const reserved = SITE_FILES.includes(route) || route === MANIFEST_FILE;
        const file = mode === "preview" || reserved
          ? join(siteRoot, route)
          : join(root, "public", route);
        content = await readSafeFile(file);
      }
      send(200, content, MIME_TYPES[extname(route).toLowerCase()] || "application/octet-stream");
    } catch (error) {
      const missing = ["ENOENT", "ENOTDIR", "EACCES", "ELOOP", "UNSAFE_PATH"].includes(error.code);
      const status = error.status || (missing ? 404 : 500);
      if (status === 500) onError(error);
      send(status, status === 500 ? "Internal server error\n" : `${status === 404 ? "Not found" : "Bad request"}\n`);
    }
  });
}

export async function startServer({
  root = PROJECT_ROOT, mode = "dev", host = "0.0.0.0", port = 5173,
  startupTimeout = 5000, onError,
} = {}) {
  if (mode === "dev") await validateInputs(root);
  else if (mode === "preview") {
    await assertSafePath(join(root, "dist"));
    const marker = await readSafeFile(join(root, "dist", BUILD_MARKER));
    if (marker.toString() !== BUILD_SIGNATURE) throw new Error("Run npm run build before preview");
    for (const file of [...SITE_FILES, MANIFEST_FILE]) await readSafeFile(join(root, "dist", file));
  } else throw new Error(`Unknown server mode: ${mode}`);
  const server = createStaticServer({ root, mode, onError });
  // Stop malformed or slow clients from keeping this local tooling alive indefinitely.
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  await new Promise((resolveListening, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(`Server startup timed out after ${startupTimeout}ms`));
    }, startupTimeout);
    timer.unref();
    const failed = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    server.once("error", failed);
    server.listen({ host, port }, () => {
      clearTimeout(timer);
      server.off("error", failed);
      resolveListening();
    });
  });
  return server;
}

function cliOptions(args) {
  const mode = args.shift() || "dev";
  let host = process.env.HOST || "0.0.0.0";
  let port = process.env.PORT || "5173";
  while (args.length) {
    const arg = args.shift();
    const [flag, inline] = arg.split(/=(.*)/s);
    if (!["--host", "--port"].includes(flag)) throw new Error(`Unknown option: ${arg}`);
    const value = inline ?? args.shift();
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--host") host = value;
    else port = value;
  }
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) throw new Error("PORT must be an integer from 0 to 65535");
  return { mode, host, port: Number(port) };
}

async function main() {
  const options = cliOptions(process.argv.slice(2));
  const server = await startServer({ ...options, onError: (error) => console.error(error.message) });
  const address = server.address();
  const hostname = options.host.includes(":") ? `[${options.host}]` : options.host;
  console.log(`${options.mode === "dev" ? "Development" : "Preview"} static server: http://${hostname}:${address.port}`);
  console.log(`Local: http://localhost:${address.port}`);
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    server.close((error) => {
      if (error) process.exitCode = 1;
    });
    const timer = setTimeout(() => server.closeAllConnections(), 2000);
    timer.unref();
    server.once("close", () => clearTimeout(timer));
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    const hint = error.code === "EADDRINUSE" ? " (choose another PORT or --port)" : "";
    console.error(`Static server failed: ${error.message}${hint}`);
    process.exitCode = 1;
  });
}
