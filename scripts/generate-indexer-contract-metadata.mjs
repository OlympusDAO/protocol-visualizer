#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const inputPath = path.join(
  repoRoot,
  "apps",
  "indexer",
  "data",
  "contract-cache.json"
);
const outputPath = path.join(
  repoRoot,
  "apps",
  "indexer",
  "src",
  "generated",
  "contract-metadata.json"
);

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, childValue]) => [key, sortObject(childValue)])
  );
}

const rawCache = JSON.parse(await readFile(inputPath, "utf8"));
const metadata = {};

for (const [chainId, contracts] of Object.entries(rawCache)) {
  metadata[chainId] = {};

  for (const [address, cacheEntry] of Object.entries(contracts)) {
    if (!cacheEntry?.processedData) {
      continue;
    }

    metadata[chainId][address.toLowerCase()] = cacheEntry.processedData;
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(sortObject(metadata), null, 2)}\n`
);

console.log(`Generated ${outputPath}`);
