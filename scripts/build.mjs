import { lstat, mkdir, mkdtemp, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertSafePath, BUILD_MARKER, BUILD_SIGNATURE, imageManifest, isMain,
  listFiles, MANIFEST_FILE, PROJECT_ROOT, readSafeFile, SITE_FILES, validateInputs,
} from "./assets.mjs";

async function inspectOutput(output) {
  const info = await assertSafePath(output, { optional: true });
  if (!info) return false;
  if (!info.isDirectory()) throw new Error("dist must be a real directory, not a file or symlink");
  // Inspect hidden entries too before moving or removing a previous build.
  await listFiles(output, { includeHidden: true });
  let signature;
  try {
    signature = await readSafeFile(join(output, BUILD_MARKER));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (signature?.toString() !== BUILD_SIGNATURE) {
    throw new Error("Refusing to replace an unrecognized dist directory; move it aside before building");
  }
  return true;
}

async function removeOwnedTree(directory) {
  // Only called for our freshly-created staging directory. No forced recursive deletion.
  const files = await listFiles(directory, { includeHidden: true });
  for (const file of files) await unlink(join(directory, file));
  async function removeDirectories(path) {
    for (const name of await readdir(path)) {
      const child = join(path, name);
      const info = await lstat(child);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe cleanup path: ${child}`);
      await removeDirectories(child);
    }
    await rmdir(path);
  }
  await removeDirectories(directory);
}

export async function buildSite(root = PROJECT_ROOT) {
  root = resolve(root);
  const files = await validateInputs(root);
  const output = join(root, "dist");
  await inspectOutput(output);
  const workspace = await mkdtemp(join(root, ".birthday-build-"));
  // Mirror a public root so discovery uses the copied snapshot, not changing inputs.
  const stage = join(workspace, "public");
  const previous = join(workspace, "previous");
  let hasPrevious = false;
  let preserveWorkspace = false;
  try {
    await mkdir(stage);
    async function copy(source, relative) {
      const destination = join(stage, relative);
      const content = await readSafeFile(source);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, { flag: "wx" });
    }
    for (const file of SITE_FILES) await copy(join(root, file), file);
    for (const file of files) await copy(join(root, "public", file), file);
    await writeFile(join(stage, MANIFEST_FILE), await imageManifest(workspace), { flag: "wx" });
    await writeFile(join(stage, BUILD_MARKER), BUILD_SIGNATURE, { flag: "wx" });

    if (await inspectOutput(output)) {
      await rename(output, previous);
      hasPrevious = true;
    }
    try {
      await rename(stage, output);
    } catch (error) {
      if (hasPrevious) {
        try {
          await rename(previous, output);
        } catch (restoreError) {
          preserveWorkspace = true;
          throw new AggregateError([error, restoreError], `Build failed; previous dist is preserved at ${previous}`);
        }
      }
      throw error;
    }
    return output;
  } finally {
    if (!preserveWorkspace) await removeOwnedTree(workspace);
  }
}

if (isMain(import.meta.url)) {
  buildSite().then(
    (output) => console.log(`Built static site in ${output}`),
    (error) => {
      console.error(`Build failed: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
