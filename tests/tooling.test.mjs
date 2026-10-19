import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { discoverImages, imageManifest, MANIFEST_FILE } from "../scripts/assets.mjs";
import { buildSite } from "../scripts/build.mjs";
import { startServer } from "../scripts/server.mjs";

const execFileAsync = promisify(execFile);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXeQAAAAASUVORK5CYII=", "base64");
const HTML = '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><img src="/images/a%20photo.png"><script src="/image-manifest.js"></script><script src="/script.js"></script></body></html>';

async function put(root, relative, content) {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "buaa-tooling-"));
  t.after(() => rm(root, { recursive: true }));
  await put(root, "index.html", HTML);
  await put(root, "styles.css", "body { color: #123; }\n");
  await put(root, "script.js", "window.siteLoaded = true;\n");
  await mkdir(join(root, "public", "images"), { recursive: true });
  return root;
}

function manifestValue(source) {
  const sandbox = { window: {} };
  runInNewContext(source.toString(), sandbox, { timeout: 1000 });
  return JSON.parse(JSON.stringify(sandbox.window.BIRTHDAY_IMAGES));
}

async function serve(t, root, mode = "dev") {
  const server = await startServer({ root, mode, host: "127.0.0.1", port: 0 });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return server;
}

function get(server, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const client = request({ host: "127.0.0.1", port: server.address().port, path, method, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
      }));
      response.on("error", reject);
    });
    client.setTimeout(2000, () => client.destroy(new Error("Request timed out")));
    client.on("error", reject);
    client.end();
  });
}

async function installCli(root, filename) {
  await mkdir(join(root, "scripts"), { recursive: true });
  for (const name of [filename, "assets.mjs"]) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, "scripts", name));
  }
  return join(root, "scripts", filename);
}

test("manifest discovers real regular files recursively with deterministic, encoded URLs", async (t) => {
  const root = await fixture(t);
  const names = [
    "family/नमस्ते #1%.PNG", "a photo.png", "percent%2Fname.jpeg", "animation.GIF",
    "one.jpg", "two.webp", "three.avif", "odd </script>.png",
  ];
  // A slash in a filename is a directory separator; punctuation in each segment is encoded once.
  for (const name of names) await put(root, `public/images/${name}`, PNG);
  await put(root, "public/images/notes.txt", "not an image");
  await put(root, "public/images/vector.svg", "<svg/>");
  await put(root, "public/images/.private.png", PNG);
  await put(root, "public/images/.hidden/nested.png", PNG);
  await mkdir(join(root, "public/images/directory.jpg"));

  const expected = [...names].sort().map((name) => ({
    src: `/images/${name.split("/").map(encodeURIComponent).join("/")}`, name,
  }));
  assert.deepEqual(await discoverImages(root), expected);
  const source = await imageManifest(root);
  assert.deepEqual(manifestValue(source), expected);
  assert.ok(!source.includes("</script>"));
  assert.ok(expected.some(({ src }) => src.includes("%252F")));
  assert.ok(expected.some(({ src }) => src.includes("%23") && src.includes("%25")));
});

test("missing or empty image directories produce an empty manifest without default URLs", async (t) => {
  const root = await fixture(t);
  assert.deepEqual(manifestValue(await imageManifest(root)), []);
  await rm(join(root, "public"), { recursive: true });
  assert.equal(await imageManifest(root), "window.BIRTHDAY_IMAGES = [];\n");
});

test("development serves HTML, CSS, JavaScript and public assets at the site root", async (t) => {
  const root = await fixture(t);
  await put(root, "public/images/a photo.png", PNG);
  await put(root, "public/images/trips/नमस्ते #100%?.png", PNG);
  await put(root, "public/images/%2e%2e/literal.png", PNG);
  await put(root, "public/fonts/a.woff2", "font-data");
  const server = await serve(t, root);
  for (const route of ["/", "/index.html?cache=bust"]) {
    const result = await get(server, route);
    assert.equal(result.status, 200);
    assert.match(result.headers["content-type"], /^text\/html/);
    assert.equal(result.body.toString(), HTML);
  }
  for (const [route, type] of [["/styles.css", "text/css"], ["/script.js", "text/javascript"], ["/fonts/a.woff2", "font/woff2"]]) {
    const result = await get(server, route);
    assert.equal(result.status, 200);
    assert.ok(result.headers["content-type"].startsWith(type));
    assert.equal(result.headers["x-content-type-options"], "nosniff");
  }
  const photo = await get(server, "/images/a%20photo.png?version=1");
  assert.equal(photo.status, 200);
  assert.equal(photo.headers["content-type"], "image/png");
  assert.deepEqual(photo.body, PNG);
  assert.equal((await get(server, "/public/images/a%20photo.png")).status, 404);
  const manifest = await get(server, "/image-manifest.js");
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers["content-type"], /^text\/javascript/);
  for (const { src } of manifestValue(manifest.body)) assert.equal((await get(server, src)).status, 200);
});

test("development regenerates the manifest on every GET and HEAD", async (t) => {
  const root = await fixture(t);
  const server = await serve(t, root);
  assert.deepEqual(manifestValue((await get(server, "/image-manifest.js")).body), []);
  await put(root, "public/images/trip #%.png", PNG);
  const first = await get(server, "/image-manifest.js");
  assert.deepEqual(manifestValue(first.body), [{ src: "/images/trip%20%23%25.png", name: "trip #%.png" }]);
  const head = await get(server, "/image-manifest.js", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), first.body.length);
  assert.equal(head.body.length, 0);
  await unlink(join(root, "public/images/trip #%.png"));
  assert.deepEqual(manifestValue((await get(server, "/image-manifest.js")).body), []);
});

test("missing files, directories, private project files and hidden public files return 404", async (t) => {
  const root = await fixture(t);
  await put(root, "public/images/existing.png", PNG);
  for (const file of ["package.json", "README.md", "scripts/server.mjs", "tests/secret.js", ".env", "public/.env", "public/images/.secret.png", "public/.private/note.txt"]) {
    await put(root, file, "PRIVATE");
  }
  const server = await serve(t, root);
  for (const route of ["/missing.png", "/images", "/images/", "/images/existing.png/child", "/some-page", "/package.json", "/README.md", "/scripts/server.mjs", "/tests/secret.js", "/.env", "/%2eenv", "/images/.secret.png", "/.private/note.txt"]) {
    const result = await get(server, route);
    assert.equal(result.status, 404, route);
    assert.equal(result.body.toString(), "Not found\n");
  }
  const head = await get(server, "/missing.png", "HEAD");
  assert.equal(head.status, 404);
  assert.equal(head.body.length, 0);
});

test("raw and percent-encoded traversal or malformed paths never expose files", async (t) => {
  const root = await fixture(t);
  await put(root, "private.txt", "PRIVATE");
  const server = await serve(t, root);
  // Raw HTTP preserves dot segments that URL/fetch clients would normalize away.
  for (const route of ["/../private.txt", "/%2e%2e/private.txt", "/images/%2E%2E/%2e%2e/private.txt", "/%252e%252e/private.txt", "/images%2f..%2fprivate.txt", "/images%5c..%5cprivate.txt", "/%00", "/%", "/%C0%AF", "//private.txt", "/images/..\\private.txt"]) {
    const result = await get(server, route);
    assert.ok([400, 404].includes(result.status), `${route}: ${result.status}`);
    assert.ok(!result.body.includes("PRIVATE"));
    assert.ok(!result.body.includes(root));
  }
});

test("GET and HEAD work; mutation methods receive 405 with Allow", async (t) => {
  const root = await fixture(t);
  const server = await serve(t, root);
  const head = await get(server, "/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(HTML));
  assert.equal(head.body.length, 0);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const response = await get(server, "/", method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, "GET, HEAD");
  }
});

test("build CLI copies the complete static site and public tree, with a usable manifest", async (t) => {
  const root = await fixture(t);
  await put(root, "public/images/a photo.png", PNG);
  await put(root, "public/nested/party.txt", "Happy birthday!");
  await put(root, "public/.env", "PRIVATE");
  await put(root, "public/images/.gitkeep", "");
  await put(root, "package.json", '{"private":true}');
  await put(root, "tests/private.js", "PRIVATE");
  const cli = await installCli(root, "build.mjs");
  const result = await execFileAsync(process.execPath, [cli], { cwd: root, timeout: 5000 });
  assert.match(result.stdout, /Built static site/);
  const dist = join(root, "dist");
  for (const file of ["index.html", "styles.css", "script.js"]) {
    assert.deepEqual(await readFile(join(dist, file)), await readFile(join(root, file)));
  }
  assert.deepEqual(await readFile(join(dist, "images/a photo.png")), PNG);
  assert.equal(await readFile(join(dist, "nested/party.txt"), "utf8"), "Happy birthday!");
  const images = manifestValue(await readFile(join(dist, MANIFEST_FILE)));
  assert.deepEqual(images, [{ src: "/images/a%20photo.png", name: "a photo.png" }]);
  for (const { src } of images) {
    const relative = src.slice(1).split("/").map(decodeURIComponent).join("/");
    assert.ok((await lstat(join(dist, relative))).isFile());
  }
  for (const absent of ["public", ".env", "images/.gitkeep", "scripts", "tests", "package.json"]) {
    await assert.rejects(lstat(join(dist, absent)), { code: "ENOENT" });
  }
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith(".birthday-build-")), []);
});

test("build safely replaces generated dist and removes stale photos and files", async (t) => {
  const root = await fixture(t);
  await put(root, "public/images/old.png", PNG);
  await put(root, "public/stale.txt", "stale");
  await buildSite(root);
  await unlink(join(root, "public/images/old.png"));
  await unlink(join(root, "public/stale.txt"));
  await put(root, "public/images/new.png", PNG);
  await put(root, "script.js", "window.updated = true;\n");
  await buildSite(root);
  const dist = join(root, "dist");
  await assert.rejects(lstat(join(dist, "stale.txt")), { code: "ENOENT" });
  await assert.rejects(lstat(join(dist, "images/old.png")), { code: "ENOENT" });
  assert.equal(await readFile(join(dist, "script.js"), "utf8"), "window.updated = true;\n");
  assert.deepEqual(manifestValue(await readFile(join(dist, MANIFEST_FILE))), [{ src: "/images/new.png", name: "new.png" }]);
  assert.deepEqual((await readdir(root)).filter((name) => name.startsWith(".birthday-build-")), []);
});

test("build preserves unrecognized output and rejects public resource collisions", async (t) => {
  const root = await fixture(t);
  await put(root, "dist/precious.txt", "keep me");
  await assert.rejects(buildSite(root), /unrecognized dist/);
  assert.equal(await readFile(join(root, "dist/precious.txt"), "utf8"), "keep me");
  await rm(join(root, "dist"), { recursive: true });
  for (const file of ["index.html", "styles.css", "script.js", MANIFEST_FILE]) {
    await put(root, `public/${file}`, "collision");
    await assert.rejects(buildSite(root), /conflicts with a reserved site resource/);
    await unlink(join(root, "public", file));
    await assert.rejects(lstat(join(root, "dist")), { code: "ENOENT" });
  }
});

test("symlink inputs and output paths are rejected without touching their targets", async (t) => {
  const root = await fixture(t);
  await put(root, "precious/sentinel.txt", "keep me");
  await symlink(join(root, "precious"), join(root, "dist"), "dir");
  await assert.rejects(buildSite(root), /[Ss]ymlink/);
  assert.equal(await readFile(join(root, "precious/sentinel.txt"), "utf8"), "keep me");
  await unlink(join(root, "dist"));

  await symlink(join(root, "precious/sentinel.txt"), join(root, "public/images/link.png"));
  await assert.rejects(discoverImages(root), /[Ss]ymlink/);
  await assert.rejects(buildSite(root), /[Ss]ymlink/);
  await unlink(join(root, "public/images/link.png"));

  await symlink(join(root, "precious"), join(root, "public/linked-directory"), "dir");
  await assert.rejects(buildSite(root), /[Ss]ymlink/);
  await unlink(join(root, "public/linked-directory"));

  await unlink(join(root, "styles.css"));
  await symlink(join(root, "precious/sentinel.txt"), join(root, "styles.css"));
  await assert.rejects(buildSite(root), /[Ss]ymlink/);
  await unlink(join(root, "styles.css"));
  await put(root, "styles.css", "body {}\n");

  await buildSite(root);
  await symlink(join(root, "precious"), join(root, "dist/linked-directory"), "dir");
  await assert.rejects(buildSite(root), /[Ss]ymlink/);
  assert.equal(await readFile(join(root, "precious/sentinel.txt"), "utf8"), "keep me");
  assert.equal(await readFile(join(root, "dist/index.html"), "utf8"), HTML);
});

test("static reads cannot follow file or directory symlinks introduced after startup", async (t) => {
  const root = await fixture(t);
  await put(root, "precious/secret.txt", "PRIVATE");
  const server = await serve(t, root);
  await symlink(join(root, "precious/secret.txt"), join(root, "public/leak.txt"));
  await symlink(join(root, "precious"), join(root, "public/linked"), "dir");
  assert.equal((await get(server, "/leak.txt")).status, 404);
  assert.equal((await get(server, "/linked/secret.txt")).status, 404);
});

test("preview serves only the built snapshot, including manifest and root-mapped assets", async (t) => {
  const root = await fixture(t);
  await assert.rejects(startServer({ root, mode: "preview", port: 0 }), { code: "ENOENT" });
  await put(root, "public/images/a photo.png", PNG);
  await put(root, "public/party.txt", "published");
  await put(root, "package.json", "PRIVATE");
  await put(root, "scripts/private.mjs", "PRIVATE");
  await put(root, "public/.secret", "PRIVATE");
  await buildSite(root);
  await put(root, "index.html", "changed after build");
  await put(root, "public/images/not-built.png", PNG);
  const server = await serve(t, root, "preview");
  assert.equal((await get(server, "/")).body.toString(), HTML);
  assert.equal((await get(server, "/party.txt")).body.toString(), "published");
  const manifest = await get(server, "/image-manifest.js");
  assert.deepEqual(manifestValue(manifest.body), [{ src: "/images/a%20photo.png", name: "a photo.png" }]);
  assert.deepEqual((await get(server, "/images/a%20photo.png")).body, PNG);
  for (const route of ["/images/not-built.png", "/public/images/a%20photo.png", "/package.json", "/scripts/private.mjs", "/.secret", "/.birthday-build", "/missing"]) {
    assert.equal((await get(server, route)).status, 404, route);
  }
  const head = await get(server, "/styles.css", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test("a busy port fails promptly, including the CLI, without retrying on another port", { timeout: 10000 }, async (t) => {
  const root = await fixture(t);
  const server = await serve(t, root);
  const port = server.address().port;
  await assert.rejects(startServer({ root, host: "127.0.0.1", port }), { code: "EADDRINUSE" });
  const cli = await installCli(root, "server.mjs");
  await assert.rejects(
    execFileAsync(process.execPath, [cli, "dev", "--host", "127.0.0.1", "--port", String(port)], { timeout: 5000 }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /EADDRINUSE/);
      assert.match(error.stderr, /choose another PORT or --port/);
      assert.ok(!error.killed);
      return true;
    },
  );
});
