import { chainIdOf } from "./chains.mjs";
import { abiHash, isAbi } from "./identity.mjs";

export const SCHEMA_VERSION = 1;

const ADDRESS = /^0x[\da-fA-F]{40}$/;
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

// The label of a deployment. See README.md for the rules. `shared` is true
// when other deployments on the same chain have the same contract name.
export function labelFor(candidate, resolved, labelOverrides, shared = false) {
  const override = labelOverrides.get(
    addressKey(candidate.chain, candidate.address)
  );
  if (override) return override;
  const version = resolved.version || candidate.kernel?.version;
  const suffix = version ? `V${version.replaceAll(".", "_")}` : undefined;
  if (candidate.env.length > 0) {
    const base = candidate.env[0].split(".").pop();
    // A versioned env.json name, such as OlympusRangeV2, keeps its name.
    if (!shared || !suffix || /V\d+(_\d+)*$/.test(base)) return base;
    return `${base}${suffix}`;
  }
  const name = resolved.contractName || candidate.kernel?.name;
  if (!name || !suffix) return undefined;
  return `${name}${suffix}`;
}

// Deployments with the same contract name on one chain. A proxy counts
// under its own name, not the name of its implementation.
const groupName = (entry, resolved) =>
  `${entry.chain}:${resolved.proxy?.contractName ?? resolved.contractName ?? entry.kernel?.name ?? entry.address}`;

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

  // The manual ABI of an address, if Etherscan has no verified source for the
  // address or for the implementation of the proxy at the address.
  const overrideFor = async (entry, error) => {
    const override = await readOverride(entry.chain, entry.address);
    if (!override) throw error;
    return {
      abi: override.abi,
      abiSource: "override",
      contractName: override.contractName,
    };
  };

  const fetchAbi = async (entry) => {
    let source;
    try {
      source = await etherscan(entry.chainId, entry.address);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      return overrideFor(entry, error);
    }
    const slot = await rpc.implementation(entry.chainId, entry.address);
    const implementation = slot ?? etherscanImplementation(source);
    if (!implementation) {
      return {
        abi: source.abi,
        abiSource: "etherscan",
        contractName: source.contractName,
      };
    }
    let target;
    try {
      target = await etherscan(entry.chainId, implementation);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      return overrideFor(
        entry,
        new SourceUnavailableError(
          `Etherscan has no verified source for the implementation ${implementation}.`
        )
      );
    }
    return {
      abi: mergeAbis(target.abi, source.abi),
      abiSource: "etherscan",
      contractName: target.contractName,
      proxy: {
        contractName: source.contractName,
        implementation,
        implementationSource: slot ? "eip1967" : "etherscan",
      },
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
      if (known.abiSource === "override") {
        const override = await readOverride(entry.chain, entry.address);
        if (override) {
          counts.kept++;
          return { ...pick(known), abi: override.abi };
        }
      } else if (known.proxy) {
        const current = await currentImplementation(entry);
        if (
          current?.implementation.toLowerCase() !==
          known.proxy.implementation.toLowerCase()
        ) {
          log(
            `Proxy ${entry.chain} ${entry.address} changed its implementation. Fetching the ABI again.`
          );
          counts.refetched++;
          return fetchWithVersion(entry, known.version);
        }
        counts.kept++;
        return { ...pick(known), abi: knownAbi };
      } else {
        counts.kept++;
        return { ...pick(known), abi: knownAbi };
      }
    }
    counts.fetched++;
    return fetchWithVersion(entry);
  };

  const deployments = [];
  const abis = new Map();
  const labels = new Map();
  const resolvedEntries = [];
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
        `${name}: ${error.message} Add a manual ABI in overrides/${entry.chain}/${entry.address.toLowerCase()}.json, or an exclusion in config.json.`
      );
      continue;
    }
    if (!isAbi(resolved.abi)) {
      errors.push(`${name}: the ABI is empty or invalid.`);
      continue;
    }
    resolvedEntries.push({ entry, name, resolved });
  }

  const groupSizes = new Map();
  for (const { entry, resolved } of resolvedEntries) {
    const key = groupName(entry, resolved);
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }

  for (const { entry, name, resolved } of resolvedEntries) {
    const label = labelFor(
      entry,
      resolved,
      labelOverrides,
      groupSizes.get(groupName(entry, resolved)) > 1
    );
    if (!label) {
      errors.push(
        `${name}: the Kernel contract has no version, so it has no label. Add a label in config.json.`
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
      ...(resolved.version ? { version: resolved.version } : {}),
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
