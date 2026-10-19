import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import {
  discoverImages, imageManifest, listFiles, PROJECT_ROOT, readSafeFile, validateInputs,
} from "./assets.mjs";

async function check() {
  const publicAssets = await validateInputs(PROJECT_ROOT);
  const html = (await readSafeFile(join(PROJECT_ROOT, "index.html"))).toString();
  if (!/<!doctype\s+html\s*>/i.test(html) || !/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    throw new Error("index.html must be an HTML document with a doctype, html, and body");
  }
  for (const file of ["styles.css", "script.js"]) {
    if (!(await readSafeFile(join(PROJECT_ROOT, file))).length) throw new Error(`${file} must not be empty`);
  }
  const scripts = ["script.js"];
  for (const directory of ["scripts", "tests"]) {
    for (const file of await listFiles(join(PROJECT_ROOT, directory))) scripts.push(`${directory}/${file}`);
  }
  scripts.push(...publicAssets.map((file) => `public/${file}`));
  const javascript = scripts.filter((file) => /\.(?:[cm]?js)$/i.test(file));
  for (const file of javascript) {
    const result = spawnSync(process.execPath, ["--check", join(PROJECT_ROOT, file)], {
      encoding: "utf8", timeout: 10000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Syntax check failed for ${file}:\n${result.error?.message || result.stderr}`);
    }
  }
  new Script(await imageManifest(PROJECT_ROOT), { filename: "image-manifest.js" });
  const photos = await discoverImages(PROJECT_ROOT);
  console.log(`Checked ${javascript.length} JavaScript files, HTML structure, safe public paths, and manifest (${photos.length} photos).`);
}

check().catch((error) => {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
});
