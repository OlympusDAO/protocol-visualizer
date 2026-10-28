import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRegistry } from "../src/check.mjs";
import { abiHash, canonicalAbi } from "../src/identity.mjs";
import {
  buildRegistry,
  envEntries,
  mergeAbis,
  SourceUnavailableError,
} from "../src/registry.mjs";

const fn = (name, inputs = []) => ({
  type: "function",
  name,
  inputs: inputs.map((type) => ({ name: "", type })),
  outputs: [],
  stateMutability: "nonpayable",
});

// Distinct leading digits, because a label can fall back to the address.
const address = (n) => `0x${n.toString(16).padEnd(40, "0")}`;

const KERNEL = address(0x100);
const CH_CURRENT = address(0x101);
const CH_V1_0 = address(0x102);
const ROLES_ADMIN = address(0x103);
const OLD_POLICY = address(0x104);
const GOHM_PROXY = address(0x105);
const GOHM_IMPL = address(0x106);
const MULTISIG = address(0x107);
const UNVERIFIED = address(0x108);

const config = {
  env: {
    repo: "OlympusDAO/olympus-v3",
    branch: "master",
    path: "env.json",
    ref: "abc",
  },
  chains: ["arbitrum", "mainnet"],
  excludedChains: { goerli: "Retired network." },
  excludedSections: {
    multisig: { reason: "Multisigs." },
    legacy: { keep: ["gOHM"], reason: "Legacy." },
  },
  exclusions: [],
  labels: [],
};

const env = {
  current: {
    goerli: { olympus: { Kernel: address(0x999) } },
    mainnet: {
      olympus: {
        Kernel: KERNEL,
        multisig: { dao: MULTISIG },
        legacy: { OHMv1: address(0x200) },
        policies: {
          Clearinghouse: CH_CURRENT,
          RolesAdmin: ROLES_ADMIN,
          OldPolicy: OLD_POLICY,
          Factory: address(0),
        },
      },
    },
    arbitrum: { olympus: { legacy: { gOHM: GOHM_PROXY } } },
  },
};

const kernelContracts = {
  1: [
    {
      address: KERNEL,
      name: "Kernel",
      contractType: "KERNEL",
      isEnabled: true,
    },
    {
      address: CH_CURRENT,
      name: "Clearinghouse",
      version: "1.1",
      contractType: "POLICY",
      isEnabled: true,
    },
    {
      address: CH_V1_0,
      name: "Clearinghouse",
      version: "1.0",
      contractType: "POLICY",
      isEnabled: true,
    },
    {
      address: ROLES_ADMIN,
      name: "RolesAdmin",
      contractType: "POLICY",
      isEnabled: true,
    },
  ],
};

const sources = {
  [`1:${KERNEL}`]: { contractName: "Kernel", abi: [fn("executeAction")] },
  [`1:${CH_CURRENT}`]: {
    contractName: "Clearinghouse",
    abi: [fn("sweepIntoSavingsVault")],
  },
  [`1:${CH_V1_0}`]: {
    contractName: "Clearinghouse",
    abi: [fn("sweepIntoDSR")],
  },
  [`1:${ROLES_ADMIN}`]: { contractName: "RolesAdmin", abi: [fn("grantRole")] },
  [`1:${OLD_POLICY}`]: { contractName: "OldPolicy", abi: [fn("old")] },
  [`42161:${GOHM_PROXY}`]: {
    contractName: "TransparentUpgradeableProxy",
    abi: [
      fn("upgradeTo", ["address"]),
      fn("transfer", ["address", "uint256"]),
      { type: "fallback", stateMutability: "payable" },
    ],
    implementation: GOHM_IMPL,
  },
  [`42161:${GOHM_IMPL}`]: {
    contractName: "SynapseERC20",
    abi: [fn("transfer", ["address", "uint256"]), fn("mint")],
  },
};

function fakes(overrides = {}) {
  const calls = { etherscan: [], version: [], isActive: [] };
  const sourceMap = { ...sources, ...overrides.sources };
  return {
    calls,
    kernel: async (chainId) => kernelContracts[chainId] ?? null,
    etherscan: async (chainId, addr) => {
      calls.etherscan.push(`${chainId}:${addr}`);
      const source = sourceMap[`${chainId}:${addr}`];
      if (!source)
        throw new SourceUnavailableError("Etherscan has no verified source.");
      return { implementation: null, ...source };
    },
    rpc: {
      version: async (chainId, addr) => {
        calls.version.push(`${chainId}:${addr}`);
        return (
          overrides.versions?.[addr] ??
          { [CH_CURRENT]: "1.1", [CH_V1_0]: "1.0" }[addr] ??
          null
        );
      },
      isActive: async (chainId, addr) => {
        calls.isActive.push(`${chainId}:${addr}`);
        return addr !== OLD_POLICY;
      },
      implementation: async (_chainId, addr) => overrides.slots?.[addr] ?? null,
    },
  };
}

const build = (source, extra = {}) =>
  buildRegistry({
    config,
    env,
    kernel: source.kernel,
    etherscan: source.etherscan,
    rpc: source.rpc,
    ...extra,
  });

const byLabel = (manifest) =>
  Object.fromEntries(
    manifest.deployments.map((deployment) => [
      `${deployment.chain}/${deployment.label}`,
      deployment,
    ])
  );

test("envEntries applies the excluded sections and skips zero addresses", () => {
  const entries = envEntries(env.current.mainnet.olympus, config, "mainnet");
  assert.deepEqual(
    entries.map(([path]) => path),
    [
      "Kernel",
      "policies.Clearinghouse",
      "policies.OldPolicy",
      "policies.RolesAdmin",
    ]
  );
  assert.deepEqual(
    envEntries(env.current.arbitrum.olympus, config, "arbitrum").map(
      ([path]) => path
    ),
    ["legacy.gOHM"]
  );
  assert.throws(
    () => envEntries({ policies: { Bad: "0x1" } }, config, "mainnet"),
    /Invalid address/
  );
});

test("labels come from env.json paths, or from the name and version of a Kernel contract", async () => {
  const { manifest, abis } = await build(fakes());
  const deployments = byLabel(manifest);
  assert.deepEqual(Object.keys(deployments).sort(), [
    "arbitrum/gOHM",
    "mainnet/Clearinghouse",
    "mainnet/ClearinghouseV1_0",
    "mainnet/Kernel",
    "mainnet/RolesAdmin",
  ]);
  assert.deepEqual(deployments["mainnet/Clearinghouse"].origin, {
    env: ["olympus.policies.Clearinghouse"],
    kernel: "POLICY",
  });
  assert.deepEqual(deployments["mainnet/ClearinghouseV1_0"].origin, {
    kernel: "POLICY",
  });
  assert.equal(deployments["mainnet/ClearinghouseV1_0"].version, "1.0");
  assert.deepEqual(abis.get("mainnet/ClearinghouseV1_0.json"), [
    fn("sweepIntoDSR"),
  ]);
});

test("an inactive env.json policy is excluded, and an active Kernel policy is not checked", async () => {
  const source = fakes();
  const { manifest } = await build(source);
  assert.deepEqual(source.calls.isActive, [`1:${OLD_POLICY}`]);
  assert.ok(
    manifest.exclusions.some(
      (exclusion) =>
        exclusion.address === OLD_POLICY &&
        /Inactive policy/.test(exclusion.reason)
    )
  );
  assert.ok(
    manifest.exclusions.some((exclusion) => exclusion.chain === "goerli")
  );
});

test("a proxy gets the implementation ABI plus the proxy-only entries", async () => {
  const { manifest, abis } = await build(fakes());
  const gohm = byLabel(manifest)["arbitrum/gOHM"];
  assert.equal(gohm.contractName, "SynapseERC20");
  assert.deepEqual(gohm.proxy, {
    contractName: "TransparentUpgradeableProxy",
    implementation: GOHM_IMPL,
    implementationSource: "etherscan",
  });
  assert.deepEqual(
    abis.get("arbitrum/gOHM.json").map((entry) => entry.name),
    ["transfer", "mint", "upgradeTo", undefined]
  );
});

test("an Etherscan proxy claim without a fallback function is ignored", async () => {
  const { manifest } = await build(
    fakes({
      sources: {
        [`1:${ROLES_ADMIN}`]: {
          contractName: "RolesAdmin",
          abi: [fn("grantRole")],
          implementation: GOHM_IMPL,
        },
      },
    })
  );
  const rolesAdmin = byLabel(manifest)["mainnet/RolesAdmin"];
  assert.equal(rolesAdmin.contractName, "RolesAdmin");
  assert.equal(rolesAdmin.proxy, undefined);
});

test("a second run keeps known ABIs and makes no Etherscan call for them", async () => {
  const first = await build(fakes());
  const source = fakes();
  const second = await build(source, {
    previous: {
      manifest: first.manifest,
      readAbi: async (file) => first.abis.get(file),
    },
  });
  assert.deepEqual(second.manifest, first.manifest);
  // Only the proxy is checked again, because the fake has no EIP-1967 slot.
  assert.deepEqual(source.calls.etherscan, [`42161:${GOHM_PROXY}`]);
  assert.deepEqual(source.calls.version, []);
  assert.deepEqual(second.counts, {
    kept: 5,
    fetched: 0,
    refetched: 0,
    excluded: 1,
  });
});

test("a proxy upgrade fetches the ABI again", async () => {
  const first = await build(fakes());
  const newImplementation = address(0x300);
  const source = fakes({
    slots: { [GOHM_PROXY]: newImplementation },
    versions: { [GOHM_PROXY]: "2.0" },
    sources: {
      [`42161:${newImplementation}`]: {
        contractName: "SynapseERC20V2",
        abi: [fn("burn")],
      },
    },
  });
  const second = await build(source, {
    previous: {
      manifest: first.manifest,
      readAbi: async (file) => first.abis.get(file),
    },
  });
  const gohm = byLabel(second.manifest)["arbitrum/gOHM"];
  assert.equal(gohm.contractName, "SynapseERC20V2");
  assert.equal(gohm.version, "2.0");
  assert.equal(gohm.proxy.implementationSource, "eip1967");
  assert.equal(second.counts.refetched, 1);
});

test("a missing verified source uses the override, else fails with instructions", async () => {
  const unverifiedEnv = structuredClone(env);
  unverifiedEnv.current.mainnet.olympus.modules = { Lender: UNVERIFIED };
  const source = fakes();
  await assert.rejects(
    buildRegistry({ ...source, config, env: unverifiedEnv }),
    new RegExp(`overrides/mainnet/${UNVERIFIED.toLowerCase()}.json`)
  );
  const lenderOverride = (extra) => async (_chain, addr) =>
    addr === UNVERIFIED
      ? {
          contractName: "OlympusLender",
          reason: "No source.",
          abi: [fn("lend")],
          ...extra,
        }
      : undefined;
  const { manifest } = await buildRegistry({
    ...source,
    config,
    env: unverifiedEnv,
    readOverride: lenderOverride(),
  });
  const lender = byLabel(manifest)["mainnet/Lender"];
  assert.equal(lender.abiSource, "override");
  assert.equal(lender.proxy, undefined);
  await assert.rejects(
    buildRegistry({
      ...source,
      config,
      env: unverifiedEnv,
      readOverride: lenderOverride({ implementation: GOHM_IMPL }),
    }),
    /has an implementation, but the address is not a proxy/
  );
});

const gohmOverride = (implementation, method) => async (_chain, addr) =>
  addr === GOHM_PROXY
    ? {
        contractName: "SynapseERC20",
        reason: "No source.",
        implementation,
        abi: [fn(method)],
      }
    : undefined;

test("a proxy with an unverified implementation uses an override for that implementation", async () => {
  const unverifiedImplementation = address(0x301);
  const source = fakes({
    slots: { [GOHM_PROXY]: unverifiedImplementation },
  });
  await assert.rejects(
    build(source),
    new RegExp(
      `no verified source for the implementation ${unverifiedImplementation}`
    )
  );
  await assert.rejects(
    build(source, { readOverride: gohmOverride(undefined, "mint") }),
    new RegExp(`must have "implementation": "${unverifiedImplementation}"`)
  );
  const { manifest } = await build(source, {
    readOverride: gohmOverride(unverifiedImplementation, "mint"),
  });
  const gohm = byLabel(manifest)["arbitrum/gOHM"];
  assert.equal(gohm.abiSource, "override");
  assert.deepEqual(gohm.proxy, {
    contractName: "TransparentUpgradeableProxy",
    implementation: unverifiedImplementation,
    implementationSource: "eip1967",
  });
});

test("an upgrade does not reuse the override of the old implementation", async () => {
  const oldImplementation = address(0x302);
  const newImplementation = address(0x303);
  const gohm = (result) => byLabel(result.manifest)["arbitrum/gOHM"];
  const gohmAbi = (result) =>
    result.abis.get("arbitrum/gOHM.json").map((entry) => entry.name);
  const first = await build(
    fakes({ slots: { [GOHM_PROXY]: oldImplementation } }),
    { readOverride: gohmOverride(oldImplementation, "oldMethod") }
  );
  assert.equal(gohm(first).proxy.implementation, oldImplementation);
  const previous = {
    manifest: first.manifest,
    readAbi: async (file) => first.abis.get(file),
  };

  const unchanged = await build(
    fakes({ slots: { [GOHM_PROXY]: oldImplementation } }),
    { previous, readOverride: gohmOverride(oldImplementation, "oldMethod") }
  );
  assert.equal(unchanged.counts.refetched, 0);
  assert.deepEqual(gohmAbi(unchanged), ["oldMethod"]);

  // A verified new implementation replaces the override.
  const verified = await build(
    fakes({
      slots: { [GOHM_PROXY]: newImplementation },
      sources: {
        [`42161:${newImplementation}`]: {
          contractName: "SynapseERC20V2",
          abi: [fn("newMethod")],
        },
      },
    }),
    { previous, readOverride: gohmOverride(oldImplementation, "oldMethod") }
  );
  assert.equal(gohm(verified).abiSource, "etherscan");
  assert.equal(gohm(verified).proxy.implementation, newImplementation);
  assert.equal(verified.counts.refetched, 1);
  assert.deepEqual(gohmAbi(verified), [
    "newMethod",
    "upgradeTo",
    "transfer",
    undefined,
  ]);

  // An unverified new implementation needs an override for it.
  const unverified = fakes({ slots: { [GOHM_PROXY]: newImplementation } });
  await assert.rejects(
    build(unverified, {
      previous,
      readOverride: gohmOverride(oldImplementation, "oldMethod"),
    }),
    new RegExp(`must have "implementation": "${newImplementation}"`)
  );
  const updated = await build(unverified, {
    previous,
    readOverride: gohmOverride(newImplementation, "newMethod"),
  });
  assert.equal(gohm(updated).proxy.implementation, newImplementation);
  assert.deepEqual(gohmAbi(updated), ["newMethod"]);
});

test("a manual ABI that does not agree with the manifest is fetched again", async () => {
  const implementation = address(0x304);
  const source = fakes({ slots: { [GOHM_PROXY]: implementation } });
  const readOverride = gohmOverride(implementation, "mint");
  const first = await build(source, { readOverride });
  // A manifest entry without the proxy, such as one from before manual ABIs
  // had an implementation.
  const { proxy, ...legacy } = byLabel(first.manifest)["arbitrum/gOHM"];
  assert.equal(proxy.implementation, implementation);
  const previous = {
    manifest: {
      ...first.manifest,
      deployments: first.manifest.deployments.map((deployment) =>
        deployment.address === GOHM_PROXY ? legacy : deployment
      ),
    },
    readAbi: async (file) => first.abis.get(file),
  };
  const second = await build(source, { previous, readOverride });
  assert.deepEqual(byLabel(second.manifest)["arbitrum/gOHM"].proxy, proxy);
  assert.equal(second.counts.fetched, 1);
});

test("a proxy without a verified source gets the ABI of its verified implementation", async () => {
  const { manifest, abis } = await build(
    fakes({
      slots: { [GOHM_PROXY]: GOHM_IMPL },
      sources: { [`42161:${GOHM_PROXY}`]: undefined },
    })
  );
  const gohm = byLabel(manifest)["arbitrum/gOHM"];
  assert.equal(gohm.contractName, "SynapseERC20");
  assert.deepEqual(gohm.proxy, {
    implementation: GOHM_IMPL,
    implementationSource: "eip1967",
  });
  assert.deepEqual(
    abis.get("arbitrum/gOHM.json"),
    sources[`42161:${GOHM_IMPL}`].abi
  );
});

test("the version comes from the Kernel index if VERSION() cannot be read", async () => {
  const source = fakes();
  const { manifest } = await build({
    ...source,
    rpc: { ...source.rpc, version: async () => null },
  });
  assert.equal(byLabel(manifest)["mainnet/ClearinghouseV1_0"].version, "1.0");
});

test("an env.json label does not change when the Kernel removes another version", async () => {
  const source = fakes();
  const withoutV1_0 = await build({
    ...source,
    kernel: async (chainId) =>
      chainId === 1
        ? kernelContracts[1].filter((contract) => contract.address !== CH_V1_0)
        : null,
  });
  const withV1_0 = await build(source);
  for (const { manifest } of [withoutV1_0, withV1_0]) {
    assert.equal(
      byLabel(manifest)["mainnet/Clearinghouse"].address,
      CH_CURRENT
    );
  }
  assert.equal(
    byLabel(withoutV1_0.manifest)["mainnet/ClearinghouseV1_0"],
    undefined
  );
});

test("a Kernel contract without a version uses its address, and a config label wins", async () => {
  const source = fakes();
  const { manifest } = await build({
    ...source,
    rpc: { ...source.rpc, version: async () => null },
    kernel: async (chainId) =>
      chainId === 1
        ? kernelContracts[1].map((contract) => ({
            ...contract,
            version: undefined,
          }))
        : null,
  });
  assert.ok(
    byLabel(manifest)[`mainnet/Clearinghouse_${CH_V1_0.slice(0, 10)}`],
    "the Kernel contract is named after its address"
  );
  const labelled = await build(fakes(), {
    config: {
      ...config,
      labels: [
        { chain: "mainnet", address: CH_V1_0, label: "ClearinghouseV1" },
      ],
    },
  });
  assert.ok(byLabel(labelled.manifest)["mainnet/ClearinghouseV1"]);
  await assert.rejects(
    build(fakes(), {
      config: {
        ...config,
        labels: [
          { chain: "mainnet", address: CH_V1_0, label: "Clearinghouse" },
        ],
      },
    }),
    /label Clearinghouse is also the label/
  );
});

test("an unknown env.json chain fails", async () => {
  await assert.rejects(
    build(fakes(), { env: { current: { solana: { olympus: {} } } } }),
    /Unknown chain solana/
  );
});

test("mergeAbis keeps implementation entries and drops the proxy constructor", () => {
  const merged = mergeAbis(
    [fn("transfer", ["address", "uint256"])],
    [
      { type: "constructor", inputs: [] },
      fn("transfer", ["address", "uint256"]),
      fn("admin"),
    ]
  );
  assert.deepEqual(
    merged.map((entry) => entry.name),
    ["transfer", "admin"]
  );
});

test("abiHash ignores parameter names and order", () => {
  const first = [fn("a", ["uint256"]), fn("b")];
  const second = [
    fn("b"),
    { ...fn("a", ["uint256"]), inputs: [{ name: "amount", type: "uint256" }] },
  ];
  assert.equal(abiHash(first), abiHash(second));
  assert.equal(canonicalAbi(first).length, 2);
});

test("checkRegistry finds hash mismatches and unlisted files", async () => {
  const { manifest, abis } = await build(fakes());
  const readAbi = async (file) => abis.get(file);
  assert.deepEqual(
    await checkRegistry({ manifest, files: [...abis.keys()], readAbi, config }),
    []
  );
  const problems = await checkRegistry({
    manifest,
    files: [...abis.keys(), "mainnet/Extra.json"],
    readAbi: async (file) =>
      file === "mainnet/Kernel.json" ? [fn("changed")] : abis.get(file),
    config,
  });
  assert.deepEqual(problems, [
    "mainnet/Kernel: mainnet/Kernel.json does not match its abiHash.",
    "abis/mainnet/Extra.json is not in manifest.json.",
  ]);
});

test("checkRegistry finds config.json changes that were not synced", async () => {
  const { manifest, abis } = await build(fakes());
  const problems = await checkRegistry({
    manifest,
    files: [...abis.keys()],
    readAbi: async (file) => abis.get(file),
    config: {
      ...config,
      excludedSections: {
        ...config.excludedSections,
        policies: { reason: "x" },
      },
      exclusions: [{ chain: "mainnet", address: KERNEL, reason: "x" }],
      labels: [
        { chain: "mainnet", address: CH_V1_0, label: "ClearinghouseOld" },
      ],
    },
  });
  assert.deepEqual(problems.sort(), [
    "mainnet/Clearinghouse: olympus.policies.Clearinghouse is in an excluded section.",
    "mainnet/ClearinghouseV1_0: config.json gives the label ClearinghouseOld.",
    "mainnet/Kernel: the address is excluded in config.json.",
    "mainnet/RolesAdmin: olympus.policies.RolesAdmin is in an excluded section.",
  ]);
});
