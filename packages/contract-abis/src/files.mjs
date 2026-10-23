import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
export const repoRoot = resolve(packageRoot, "../..");
export const abisDir = join(packageRoot, "abis");
export const overridesDir = join(packageRoot, "overrides");
export const configPath = join(packageRoot, "config.json");
export const MANIFEST = "manifest.json";

export const readJson = async (path) =>
  JSON.parse(await readFile(path, "utf8"));

export async function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  return readJson(path);
}

export async function readOverride(chain, address) {
  const override = await readJsonIfExists(
    join(overridesDir, chain, `${address.toLowerCase()}.json`)
  );
  if (!override) return undefined;
  if (!override.reason || !Array.isArray(override.abi)) {
    throw new Error(
      `overrides/${chain}/${address.toLowerCase()}.json must have reason and abi`
    );
  }
  return override;
}

// The ABI files below `abis/`, as paths relative to it.
export async function listAbiFiles(dir = abisDir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of await readdir(join(dir, entry.name))) {
      if (file.endsWith(".json")) files.push(`${entry.name}/${file}`);
    }
  }
  return files.sort();
}

// Write the manifest and the ABI files, remove the ABI files that are not in
// the registry, then format everything with Biome.
export async function writeRegistry({ manifest, abis }, dir = abisDir) {
  const wanted = new Set(abis.keys());
  for (const file of await listAbiFiles(dir)) {
    if (!wanted.has(file)) await rm(join(dir, file));
  }
  for (const [file, abi] of abis) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), `${JSON.stringify(abi, null, 2)}\n`);
  }
  await writeFile(
    join(dir, MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
  }
  await formatJson([dir, configPath]);
}

export async function formatJson(paths) {
  await promisify(execFile)(
    join(repoRoot, "node_modules/.bin/biome"),
    ["format", "--write", ...paths.map((path) => relative(repoRoot, path))],
    { cwd: repoRoot }
  );
}
