import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  abisDir,
  configPath,
  MANIFEST,
  packageRoot,
  readJson,
  readJsonIfExists,
  readOverride,
  repoRoot,
  writeRegistry,
} from "../src/files.mjs";
import { chainIdOf } from "../src/chains.mjs";
import { buildRegistry } from "../src/registry.mjs";
import {
  createEtherscanSource,
  createKernelSource,
  createRpcSource,
  fetchEnv,
  latestEnvRef,
} from "../src/sources.mjs";

const { values } = parseArgs({
  options: { latest: { type: "boolean", default: false } },
});

for (const path of [join(packageRoot, ".env"), join(repoRoot, ".env")]) {
  if (existsSync(path)) process.loadEnvFile(path);
}
const apiKey = process.env.ETHERSCAN_API_KEY;
if (!apiKey) throw new Error("Set ETHERSCAN_API_KEY to sync the ABI registry.");

const config = await readJson(configPath);
const rpc = createRpcSource(config.chains.map(chainIdOf));
// With --latest, the new ref is saved only after the registry builds, so a
// failed run leaves config.json and the manifest unchanged.
const previousRef = config.env.ref;
if (values.latest) {
  const ref = await latestEnvRef(config.env);
  if (ref !== previousRef) {
    console.log(`env.json ref: ${previousRef} -> ${ref}`);
    config.env.ref = ref;
  }
}

const registry = await buildRegistry({
  config,
  env: await fetchEnv(config.env),
  kernel: createKernelSource(
    process.env.PROTOCOL_SNAPSHOT_BASE_URL || config.snapshotBaseUrl
  ),
  etherscan: createEtherscanSource(apiKey),
  rpc,
  previous: {
    manifest: await readJsonIfExists(join(abisDir, MANIFEST)),
    readAbi: (file) => readJsonIfExists(join(abisDir, file)),
  },
  readOverride,
  log: console.log,
});

// Replace only the ref, so that config.json keeps the Biome format.
if (config.env.ref !== previousRef) {
  const text = await readFile(configPath, "utf8");
  const updated = text.replace(
    `"ref": "${previousRef}"`,
    `"ref": "${config.env.ref}"`
  );
  if (updated === text)
    throw new Error("config.json has no env.ref to update.");
  await writeFile(configPath, updated);
}
await writeRegistry(registry);
const { kept, fetched, refetched, excluded } = registry.counts;
console.log(
  `Wrote ${registry.manifest.deployments.length} ABIs: ${kept} kept, ${fetched} fetched, ${refetched} fetched again after a proxy upgrade. ${excluded} addresses excluded.`
);
