import { chainIdOf } from "./chains.mjs";
import { abiHash, isAbi } from "./identity.mjs";
import { SCHEMA_VERSION, stable } from "./registry.mjs";

// Offline integrity check of the committed registry. Returns a list of
// problems; an empty list means the registry is consistent.
export async function checkRegistry({ manifest, files, readAbi, config }) {
  const problems = [];
  if (!manifest) return ["abis/manifest.json is missing."];
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    problems.push(`manifest.json has schemaVersion ${manifest.schemaVersion}.`);
  }
  if (
    JSON.stringify(stable(manifest.env)) !== JSON.stringify(stable(config.env))
  ) {
    problems.push("manifest.json env differs from config.json env.");
  }
  const configKey = (chain, address) => `${chain}:${address.toLowerCase()}`;
  const excluded = new Set(
    (config.exclusions ?? []).map((entry) =>
      configKey(entry.chain, entry.address)
    )
  );
  const labels = new Map(
    (config.labels ?? []).map((entry) => [
      configKey(entry.chain, entry.address),
      entry.label,
    ])
  );
  const listed = new Set();
  const addresses = new Set();
  for (const deployment of manifest.deployments ?? []) {
    const name = `${deployment.chain}/${deployment.label}`;
    const expected = `${deployment.chain}/${deployment.label}.json`;
    if (deployment.abi !== expected) {
      problems.push(`${name}: abi must be ${expected}.`);
    }
    if (!config.chains.includes(deployment.chain)) {
      problems.push(`${name}: chain is not in config.json.`);
    } else if (chainIdOf(deployment.chain) !== deployment.chainId) {
      problems.push(`${name}: chainId does not match viem/chains.`);
    }
    if (listed.has(deployment.abi)) {
      problems.push(`${name}: two deployments use ${deployment.abi}.`);
    }
    listed.add(deployment.abi);
    const key = `${deployment.chainId}:${deployment.address.toLowerCase()}`;
    if (addresses.has(key)) {
      problems.push(
        `${name}: the address ${deployment.address} is listed two times.`
      );
    }
    addresses.add(key);
    // A config.json change without a sync leaves the manifest out of date.
    const addressKey = configKey(deployment.chain, deployment.address);
    if (config.excludedChains?.[deployment.chain]) {
      problems.push(`${name}: the chain is excluded in config.json.`);
    }
    if (excluded.has(addressKey)) {
      problems.push(`${name}: the address is excluded in config.json.`);
    }
    const label = labels.get(addressKey);
    if (label && label !== deployment.label) {
      problems.push(`${name}: config.json gives the label ${label}.`);
    }
    for (const path of deployment.origin?.env ?? []) {
      const [, section, ...rest] = path.split(".");
      const rule = config.excludedSections?.[section];
      if (rule && !rule.keep?.includes(rest.join("."))) {
        problems.push(`${name}: ${path} is in an excluded section.`);
      }
    }
    const abi = await readAbi(deployment.abi);
    if (!isAbi(abi)) {
      problems.push(`${name}: ${deployment.abi} is missing or is not an ABI.`);
    } else if (abiHash(abi) !== deployment.abiHash) {
      problems.push(`${name}: ${deployment.abi} does not match its abiHash.`);
    }
  }
  for (const file of files) {
    if (!listed.has(file)) {
      problems.push(`abis/${file} is not in manifest.json.`);
    }
  }
  return problems;
}
