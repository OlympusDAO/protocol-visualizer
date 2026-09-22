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

const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;

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
    "mainnet/ClearinghouseV1_0",
    "mainnet/ClearinghouseV1_1",
    "mainnet/Kernel",
    "mainnet/RolesAdmin",
  ]);
  assert.deepEqual(deployments["mainnet/ClearinghouseV1_1"].origin, {
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
    /mainnet modules\.Lender .*overrides\/mainnet\/0x0+108\.json/
  );
  const { manifest } = await buildRegistry({
    ...source,
    config,
    env: unverifiedEnv,
    readOverride: async (_chain, addr) =>
      addr === UNVERIFIED
        ? {
            contractName: "OlympusLender",
            reason: "No source.",
            abi: [fn("lend")],
          }
        : undefined,
  });
  const lender = byLabel(manifest)["mainnet/Lender"];
  assert.equal(lender.abiSource, "override");
});

test("a proxy with an unverified implementation uses the override of the proxy", async () => {
  const unverifiedImplementation = address(0x301);
  const source = fakes({
    slots: { [GOHM_PROXY]: unverifiedImplementation },
  });
  await assert.rejects(
    build(source),
    /no verified source for the implementation 0x0+301/
  );
  const { manifest } = await build(source, {
    readOverride: async (_chain, addr) =>
      addr === GOHM_PROXY
        ? {
            contractName: "SynapseERC20",
            reason: "No source.",
            abi: [fn("mint")],
          }
        : undefined,
  });
  const gohm = byLabel(manifest)["arbitrum/gOHM"];
  assert.equal(gohm.abiSource, "override");
  assert.equal(gohm.proxy, undefined);
});

test("a shared name gets a version only where a version exists", async () => {
  const source = fakes();
  const { manifest } = await build({
    ...source,
    // The current Clearinghouse has no VERSION() and no Kernel version.
    kernel: async (chainId) =>
      chainId === 1
        ? kernelContracts[1].map((contract) =>
            contract.address === CH_CURRENT
              ? { ...contract, version: undefined }
              : contract
          )
        : null,
    rpc: {
      ...source.rpc,
      version: async (_chainId, addr) => (addr === CH_V1_0 ? "1.0" : null),
    },
  });
  assert.deepEqual(
    manifest.deployments
      .filter((deployment) => deployment.contractName === "Clearinghouse")
      .map((deployment) => deployment.label)
      .sort(),
    ["Clearinghouse", "ClearinghouseV1_0"]
  );
});

test("label collisions and missing versions fail, and a config label resolves them", async () => {
  const noVersion = {
    ...fakes(),
    rpc: { ...fakes().rpc, version: async () => null },
  };
  await assert.rejects(
    buildRegistry({
      ...noVersion,
      config,
      env,
      kernel: async (chainId) =>
        chainId === 1
          ? kernelContracts[1].map((contract) => ({
              ...contract,
              version: undefined,
            }))
          : null,
    }),
    /has no version/
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
          { chain: "mainnet", address: CH_V1_0, label: "ClearinghouseV1_1" },
        ],
      },
    }),
    /label ClearinghouseV1_1 is also the label/
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
    "mainnet/ClearinghouseV1_0: config.json gives the label ClearinghouseOld.",
    "mainnet/ClearinghouseV1_1: olympus.policies.Clearinghouse is in an excluded section.",
    "mainnet/Kernel: the address is excluded in config.json.",
    "mainnet/RolesAdmin: olympus.policies.RolesAdmin is in an excluded section.",
  ]);
});
