import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SITE_FILES = ["index.html", "styles.css", "script.js"];
export const MANIFEST_FILE = "image-manifest.js";
export const BUILD_MARKER = ".birthday-build";
export const BUILD_SIGNATURE = "buaa-birthday static build v1\n";
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|avif|gif)$/i;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

// Check every component, not just the final file: directory symlinks also escape roots.
export async function assertSafePath(path, { optional = false } = {}) {
  const absolute = resolve(path);
  const { root } = parse(absolute);
  let current = root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let info = await lstat(root);
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      info = await lstat(current);
    } catch (error) {
      if (optional && error.code === "ENOENT") return null;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw Object.assign(new Error(`Symlink paths are not allowed: ${current}`), { code: "UNSAFE_PATH" });
    }
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw Object.assign(new Error(`Expected a directory: ${current}`), { code: "ENOTDIR" });
    }
  }
  return info;
}

export async function readSafeFile(path) {
  const info = await assertSafePath(path);
  if (!info.isFile()) {
    const error = new Error(`Expected a regular file: ${path}`);
    error.code = "ENOENT";
    throw error;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Not a regular file: ${path}`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function listFiles(directory, { includeHidden = false, optional = false } = {}) {
  const info = await assertSafePath(directory, { optional });
  if (!info) return [];
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
  const files = [];
  async function visit(current, prefix) {
    const entries = (await readdir(current)).sort(compare);
    for (const name of entries) {
      const path = join(current, name);
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) {
        throw Object.assign(new Error(`Symlinks are not allowed: ${path}`), { code: "UNSAFE_PATH" });
      }
      if (!includeHidden && name.startsWith(".")) continue;
      // These names cannot be represented as a safe URL segment on every platform.
      if (/[\\\u0000-\u001f\u007f]/u.test(name)) throw new Error(`Unsafe asset name: ${path}`);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.isDirectory()) await visit(path, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Only regular files and directories are allowed: ${path}`);
    }
  }
  await visit(directory, "");
  return files.sort(compare);
}

export async function publicFiles(root = PROJECT_ROOT) {
  const files = await listFiles(join(root, "public"), { optional: true });
  for (const file of files) {
    if ([...SITE_FILES, MANIFEST_FILE].includes(file)) {
      throw new Error(`public/${file} conflicts with a reserved site resource`);
    }
  }
  return files;
}

export async function discoverImages(root = PROJECT_ROOT) {
  const files = await listFiles(join(root, "public", "images"), { optional: true });
  return files.filter((file) => IMAGE_EXTENSION.test(file)).map((name) => ({
    src: `/images/${name.split("/").map(encodeURIComponent).join("/")}`,
    name,
  }));
}

export async function imageManifest(root = PROJECT_ROOT) {
  const json = JSON.stringify(await discoverImages(root), null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.BIRTHDAY_IMAGES = ${json};\n`;
}

export async function validateInputs(root = PROJECT_ROOT) {
  const info = await assertSafePath(root);
  if (!info.isDirectory()) throw new Error(`Expected a project directory: ${root}`);
  for (const file of SITE_FILES) await readSafeFile(join(root, file));
  return publicFiles(root);
}

export function isMain(metaUrl) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
