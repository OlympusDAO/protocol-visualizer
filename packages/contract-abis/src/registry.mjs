import { chainIdOf } from "./chains.mjs";
import { abiHash, isAbi } from "./identity.mjs";

export const SCHEMA_VERSION = 1;

export const ADDRESS = /^0x[\da-fA-F]{40}$/;
const ZERO_ADDRESS = /^0x0{40}$/;
const LABEL = /^[A-Za-z0-9_]+$/;

export class SourceUnavailableError extends Error {}

// Etherscan also reports contracts that store an implementation address, such
// as factories, as proxies. Without an EIP-1967 slot, a contract counts as a
// proxy only if it forwards calls with a fallback function.
const etherscanImplementation = (source) =>
  source.implementation && source.abi.some((entry) => entry.type === "fallback")
    ? source.implementation
    : null;

export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

const compare = (first, second) =>
  first < second ? -1 : first > second ? 1 : 0;

const addressKey = (chain, address) => `${chain}:${address.toLowerCase()}`;

// Two addresses that can be undefined. Two undefined values are the same.
const sameAddress = (first, second) =>
  first?.toLowerCase() === second?.toLowerCase();

function leaves(value, path = "") {
  if (typeof value === "string") return [[path, value]];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key)
  );
}

// The addresses of `env.current.<chain>.olympus` that are in scope, as
// [path, address] pairs sorted by path.
export function envEntries(section, config, chain) {
  const entries = [];
  for (const [path, address] of leaves(section)) {
    const [name, ...rest] = path.split(".");
    const excluded = config.excludedSections?.[name];
    if (excluded && !excluded.keep?.includes(rest.join("."))) continue;
    if (!ADDRESS.test(address)) {
      throw new Error(
        `Invalid address at ${chain}.olympus.${path}: ${address}`
      );
    }
    if (ZERO_ADDRESS.test(address)) continue;
    entries.push([path, address]);
  }
  return entries.sort(([first], [second]) => compare(first, second));
}

const signature = (entry) =>
  `${entry.type}:${entry.name ?? ""}(${(entry.inputs ?? [])
    .map((input) => input.type)
    .join(",")})`;

// The ABI of a proxy: the implementation ABI, plus the entries that only the
// proxy has, such as upgrade functions and events.
export function mergeAbis(implementation, proxy) {
  const seen = new Set(implementation.map(signature));
  return [
    ...implementation,
    ...proxy.filter(
      (entry) => entry.type !== "constructor" && !seen.has(signature(entry))
    ),
  ];
}

// The label of a deployment. See README.md for the rules. An env.json name
// does not get a version, so that the label of the current contract does not
// change when the Kernel adds or removes another version.
export function labelFor(candidate, resolved, labelOverrides) {
  const override = labelOverrides.get(
    addressKey(candidate.chain, candidate.address)
  );
  if (override) return override;
  if (candidate.env.length > 0) return candidate.env[0].split(".").pop();
  const name = resolved.contractName || candidate.kernel?.name;
  if (!name) return undefined;
  const version = resolved.version || candidate.kernel?.version;
  // A contract that has no version, such as a deployment from before
  // VERSION() existed, is named after its address.
  return version
    ? `${name}V${version.replaceAll(".", "_")}`
    : `${name}_${candidate.address.slice(0, 10).toLowerCase()}`;
}

/**
 * Build the registry from its sources. All network access goes through the
 * injected functions, so that the tests can replace them.
 *
 * - `env`: the parsed olympus-v3 env.json.
 * - `kernel(chainId)`: the enabled Kernel contracts of a chain, or null if the
 *   indexer does not cover the chain.
 * - `etherscan(chainId, address)`: `{contractName, abi, implementation}`.
 *   Throws SourceUnavailableError if the contract has no verified source.
 * - `rpc.version`, `rpc.isActive`, `rpc.implementation`: on-chain reads. Each
 *   returns null if the call reverts or the value is empty.
 * - `previous`: the committed manifest and a `readAbi(file)` function.
 * - `readOverride(chain, address)`: the manual ABI, or undefined.
 */
export async function buildRegistry({
  config,
  env,
  kernel,
  etherscan,
  rpc,
  previous = { manifest: undefined, readAbi: async () => undefined },
  readOverride = async () => undefined,
  log = () => {},
}) {
  if (!env?.current || typeof env.current !== "object") {
    throw new Error("env.json has no current section");
  }
  const exclusions = [];
  const errors = [];
  const counts = { kept: 0, fetched: 0, refetched: 0, excluded: 0 };

  for (const [section, { reason, keep }] of Object.entries(
    config.excludedSections ?? {}
  )) {
    exclusions.push({
      section: `olympus.${section}`,
      reason,
      ...(keep ? { keep } : {}),
    });
  }
  const excludedAddresses = new Map(
    (config.exclusions ?? []).map((exclusion) => [
      addressKey(exclusion.chain, exclusion.address),
      exclusion.reason,
    ])
  );
  const labelOverrides = new Map(
    (config.labels ?? []).map((entry) => [
      addressKey(entry.chain, entry.address),
      entry.label,
    ])
  );

  const candidates = new Map();
  const candidate = (chain, address) => {
    const key = addressKey(chain, address);
    if (!candidates.has(key)) {
      candidates.set(key, {
        chain,
        chainId: chainIdOf(chain),
        address,
        env: [],
        kernel: null,
      });
    }
    return candidates.get(key);
  };

  for (const chain of Object.keys(env.current).sort()) {
    if (config.excludedChains?.[chain]) {
      exclusions.push({ chain, reason: config.excludedChains[chain] });
      continue;
    }
    if (!config.chains.includes(chain)) {
      throw new Error(
        `Unknown chain ${chain} in env.json. Add it to chains or excludedChains in config.json.`
      );
    }
    const section = env.current[chain]?.olympus;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`env.json has no olympus section for ${chain}`);
    }
    for (const [path, address] of envEntries(section, config, chain)) {
      candidate(chain, address).env.push(path);
    }
  }

  for (const chain of config.chains) {
    const contracts = await kernel(chainIdOf(chain));
    if (!contracts) continue;
    for (const contract of contracts) {
      if (!contract.isEnabled) continue;
      if (!ADDRESS.test(contract.address)) {
        throw new Error(
          `Invalid Kernel address on ${chain}: ${contract.address}`
        );
      }
      candidate(chain, contract.address).kernel = {
        type: contract.contractType,
        name: contract.name,
        version: contract.version ?? undefined,
      };
    }
  }

  const previousDeployments = new Map(
    (previous.manifest?.deployments ?? []).map((deployment) => [
      addressKey(deployment.chain, deployment.address),
      deployment,
    ])
  );

  const currentImplementation = async ({ chainId, address }) => {
    const slot = await rpc.implementation(chainId, address);
    if (slot) return { implementation: slot, implementationSource: "eip1967" };
    const implementation = etherscanImplementation(
      await etherscan(chainId, address)
    );
    return implementation
      ? { implementation, implementationSource: "etherscan" }
      : null;
  };

  // A manual ABI. The manual ABI of a proxy names the implementation that it
  // describes, so that a sync after an upgrade does not use it for the new
  // implementation.
  const fromOverride = (override, proxy) => {
    if (!sameAddress(override.implementation, proxy?.implementation)) {
      throw new SourceUnavailableError(
        proxy
          ? `The manual ABI must have "implementation": "${proxy.implementation}", the current implementation of the proxy.`
          : "The manual ABI has an implementation, but the address is not a proxy."
      );
    }
    return {
      abi: override.abi,
      abiSource: "override",
      contractName: override.contractName,
      ...(proxy ? { proxy } : {}),
    };
  };

  // The manual ABI of an address, if Etherscan has no verified source for the
  // address or for the implementation of the proxy at the address.
  const overrideFor = async (entry, error, proxy) => {
    const override = await readOverride(entry.chain, entry.address);
    if (!override) throw error;
    return fromOverride(override, proxy);
  };

  const fetchAbi = async (entry) => {
    // Read the slot first, so that a proxy without a verified source is also
    // a proxy.
    const slot = await rpc.implementation(entry.chainId, entry.address);
    let source;
    try {
      source = await etherscan(entry.chainId, entry.address);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      if (!slot) return overrideFor(entry, error);
    }
    const implementation = slot ?? etherscanImplementation(source);
    if (!implementation) {
      return {
        abi: source.abi,
        abiSource: "etherscan",
        contractName: source.contractName,
      };
    }
    const proxy = {
      ...(source ? { contractName: source.contractName } : {}),
      implementation,
      implementationSource: slot ? "eip1967" : "etherscan",
    };
    let target;
    try {
      target = await etherscan(entry.chainId, implementation);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      return overrideFor(
        entry,
        new SourceUnavailableError(
          `Etherscan has no verified source for the implementation ${implementation}.`
        ),
        proxy
      );
    }
    return {
      abi: mergeAbis(target.abi, source?.abi ?? []),
      abiSource: "etherscan",
      contractName: target.contractName,
      proxy,
    };
  };

  // A new ABI, with the version read on-chain. `fallbackVersion` is used if
  // the contract has no readable VERSION().
  const fetchWithVersion = async (entry, fallbackVersion) => {
    const fetched = await fetchAbi(entry);
    const version =
      (await rpc.version(entry.chainId, entry.address)) ?? fallbackVersion;
    return { ...fetched, ...(version ? { version } : {}) };
  };

  const resolveAbi = async (entry) => {
    const known = previousDeployments.get(
      addressKey(entry.chain, entry.address)
    );
    const knownAbi = known ? await previous.readAbi(known.abi) : undefined;
    if (known && isAbi(knownAbi) && abiHash(knownAbi) === known.abiHash) {
      // Check a proxy before reuse, also if its ABI is manual.
      if (known.proxy) {
        const current = await currentImplementation(entry);
        if (!sameAddress(current?.implementation, known.proxy.implementation)) {
          log(
            `Proxy ${entry.chain} ${entry.address} changed its implementation. Fetching the ABI again.`
          );
          counts.refetched++;
          return fetchWithVersion(entry, known.version);
        }
      }
      if (known.abiSource !== "override") {
        counts.kept++;
        return { ...pick(known), abi: knownAbi };
      }
      // If the manual ABI and the manifest do not agree about the
      // implementation, fetch again. The fetch compares the manual ABI with
      // the chain, not with the manifest.
      const override = await readOverride(entry.chain, entry.address);
      if (
        override &&
        sameAddress(override.implementation, known.proxy?.implementation)
      ) {
        counts.kept++;
        return { ...pick(known), ...fromOverride(override, known.proxy) };
      }
    }
    counts.fetched++;
    return fetchWithVersion(entry);
  };

  const deployments = [];
  const abis = new Map();
  const labels = new Map();
  const ordered = [...candidates.values()].sort(
    (first, second) =>
      compare(first.chain, second.chain) ||
      compare(first.address.toLowerCase(), second.address.toLowerCase())
  );

  for (const entry of ordered) {
    const name = `${entry.chain} ${entry.env[0] ?? entry.kernel?.name} (${entry.address})`;
    const reason = excludedAddresses.get(
      addressKey(entry.chain, entry.address)
    );
    if (reason) {
      exclusions.push(exclusionFor(entry, reason));
      counts.excluded++;
      continue;
    }
    if (
      !entry.kernel &&
      entry.env.some((path) => path.startsWith("policies."))
    ) {
      const active = await rpc.isActive(entry.chainId, entry.address);
      if (active === false) {
        exclusions.push(
          exclusionFor(entry, "Inactive policy: isActive() returns false.")
        );
        counts.excluded++;
        continue;
      }
    }

    let resolved;
    try {
      resolved = await resolveAbi(entry);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      errors.push(
        `${name}: ${error.message} Add or correct the manual ABI in overrides/${entry.chain}/${entry.address.toLowerCase()}.json, or add an exclusion in config.json.`
      );
      continue;
    }
    if (!isAbi(resolved.abi)) {
      errors.push(`${name}: the ABI is empty or invalid.`);
      continue;
    }

    const label = labelFor(entry, resolved, labelOverrides);
    if (!label) {
      errors.push(
        `${name}: the contract has no name, so it has no label. Add a label in config.json.`
      );
      continue;
    }
    if (!LABEL.test(label)) {
      errors.push(`${name}: the label ${label} is not a valid file name.`);
      continue;
    }
    const labelKey = `${entry.chain}/${label}`;
    if (labels.has(labelKey)) {
      errors.push(
        `${name}: the label ${label} is also the label of ${labels.get(labelKey)}. Add a label in config.json.`
      );
      continue;
    }
    labels.set(labelKey, entry.address);

    const file = `${entry.chain}/${label}.json`;
    abis.set(file, resolved.abi);
    // The same version as the label: VERSION() on-chain, else the Kernel index.
    const version = resolved.version || entry.kernel?.version;
    deployments.push({
      abi: file,
      abiHash: abiHash(resolved.abi),
      abiSource: resolved.abiSource,
      address: entry.address,
      chain: entry.chain,
      chainId: entry.chainId,
      ...(resolved.contractName ? { contractName: resolved.contractName } : {}),
      label,
      origin: {
        ...(entry.env.length > 0
          ? { env: entry.env.map((path) => `olympus.${path}`) }
          : {}),
        ...(entry.kernel ? { kernel: entry.kernel.type } : {}),
      },
      ...(resolved.proxy ? { proxy: resolved.proxy } : {}),
      ...(version ? { version } : {}),
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `The ABI registry has ${errors.length} problem(s):\n- ${errors.join("\n- ")}`
    );
  }

  deployments.sort(
    (first, second) =>
      compare(first.chain, second.chain) || compare(first.label, second.label)
  );
  const manifest = stable({
    schemaVersion: SCHEMA_VERSION,
    env: config.env,
    scope:
      "Live Olympus EVM contracts: the in-scope addresses of env.json current, plus the enabled Kernel modules and policies. See exclusions.",
    deployments,
    exclusions: exclusions.sort((first, second) =>
      compare(JSON.stringify(first), JSON.stringify(second))
    ),
  });
  return { manifest, abis, counts };
}

const pick = ({ abiSource, contractName, proxy, version }) => ({
  abiSource,
  ...(contractName ? { contractName } : {}),
  ...(proxy ? { proxy } : {}),
  ...(version ? { version } : {}),
});

const exclusionFor = (entry, reason) => ({
  address: entry.address,
  chain: entry.chain,
  chainId: entry.chainId,
  ...(entry.env.length > 0
    ? { env: entry.env.map((path) => `olympus.${path}`) }
    : {}),
  reason,
});
