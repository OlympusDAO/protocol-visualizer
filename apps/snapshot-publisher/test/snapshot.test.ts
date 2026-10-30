import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getSampleProtocolData } from "../src/sample-data.js";
import { loadOtherContracts, loadSupportedChains } from "../src/chains.js";
import {
  createProtocolSnapshot,
  createSnapshotFiles,
  createSnapshotBatch,
  fetchProtocolData,
  parseChainIds,
  selectChains,
  validateProtocolSnapshot,
} from "../src/snapshot.js";

const supportedChains = [
  {
    key: "Mainnet",
    chainId: 1,
    name: "Ethereum Mainnet",
    explorerBaseUrl: "https://etherscan.io",
  },
  {
    key: "Optimism",
    chainId: 10,
    name: "Optimism",
    explorerBaseUrl: "https://optimistic.etherscan.io",
  },
];

test("preserves installation history without inferring membership from incomplete coverage", () => {
  const rows = ["installed", "never-installed", "unknown", null].map(
    (kernelHistory, index) => ({
      address: `0x${String(index + 1).padStart(40, "0")}`,
      name: "Policy",
      contractType: "POLICY" as const,
      isEnabled: false,
      kernelHistory: kernelHistory as
        | "installed"
        | "never-installed"
        | "unknown"
        | null,
    })
  );
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-10-23T00:00:00.000Z",
    graphqlData: { KnownContract: rows },
  });
  assert.deepEqual(
    snapshot.data.additionalContracts?.map((row) => row.kernelHistory),
    ["installed", "never-installed", "unknown", "installed"]
  );
  assert.deepEqual(
    snapshot.data.contractStates?.map((row) => row.kernelMembership),
    ["inactive", "inactive", "unknown", "inactive"]
  );
  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
});

test("includes inactive and inventory-only contracts without changing active core", async () => {
  const input = getSampleProtocolData(1);
  const contracts = input.Contract;
  const mainnet = supportedChains[0];
  assert(contracts);
  assert(mainnet);
  const policy = contracts[2];
  assert(policy);
  const inactive = {
    address: "0x0000000000000000000000000000000000000099",
    name: policy.name,
    version: policy.version,
    contractType: policy.contractType,
    isEnabled: false,
  };
  input.KnownContract = [...contracts, inactive];
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-05-25T00:00:00.000Z",
    graphqlData: input,
    additionalContracts: [
      { chainId: 1, address: inactive.address, name: "Inventory duplicate" },
      {
        chainId: 1,
        address: "0x0000000000000000000000000000000000000088",
        name: "External",
      },
    ],
  });
  assert.equal(snapshot.data.contracts.length, contracts.length);
  assert.equal(snapshot.data.additionalContracts?.length, 2);
  assert.equal(
    snapshot.data.additionalContracts?.find(
      (c) => c.address === inactive.address
    )?.category,
    "inactive-core"
  );
  assert.equal(
    snapshot.data.contractStates?.find((c) => c.address === inactive.address)
      ?.kernelMembership,
    "inactive"
  );
  const batch = await createSnapshotBatch({
    chains: [mainnet],
    loadProtocolData: () => ({}),
    additionalContracts: [
      {
        chainId: 1,
        address: "0x0000000000000000000000000000000000000088",
        name: "External",
      },
    ],
  });
  assert.equal(
    batch.ready,
    false,
    "inventory and publication time cannot invent indexing progress"
  );
  assert.equal(batch.indexingProgress.chains.Mainnet?.date, null);
  const observed = await createSnapshotBatch({
    chains: [mainnet],
    loadProtocolData: () => ({}),
    additionalContracts: [
      {
        chainId: 1,
        address: "0x0000000000000000000000000000000000000088",
        name: "External",
      },
    ],
    indexingProgressOverride: {
      chains: {
        Mainnet: {
          chainId: 1,
          block: 123,
          timestamp: null,
          date: null,
        },
      },
    },
  });
  assert.equal(
    observed.ready,
    true,
    "real chain progress permits external-only publication without an optional timestamp"
  );
});

test("creates valid protocol snapshots from GraphQL data", () => {
  const input = getSampleProtocolData(1);
  const relationship = input.ContractRelationship?.[0];
  assert(relationship);
  input.ContractRelationship = JSON.parse(
    JSON.stringify([
      {
        ...relationship,
        subject: null,
        getter: null,
        coverage: null,
        verification: null,
        value: null,
      },
    ])
  );
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-05-25T00:00:00.000Z",
    graphqlData: input,
  });

  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
  assert.equal(snapshot.data.contracts[0]?.type, "kernel");
  assert.equal(snapshot.recordCounts.contracts, input.Contract?.length);
  const serialized = JSON.parse(
    JSON.stringify(snapshot.data.relationships?.[0])
  );
  for (const key of ["subject", "getter", "coverage", "verification"])
    assert.equal(key in serialized, false);
  assert.equal(serialized.value, null);
});

test("preserves token scope and distinct references beside control on the same addresses", () => {
  const input = getSampleProtocolData(1);
  const base = input.ContractRelationship?.[0];
  assert(base);
  const scope = { registry: base.source, token: base.target ?? base.source };
  input.ContractRelationship = [
    {
      ...base,
      id: "token-admin",
      kind: "token-admin",
      status: "current",
      scope,
    },
    { ...base, id: "pool-owner", kind: "pool-owner", status: "current" },
    {
      ...base,
      id: "configured-pool",
      kind: "configured-pool",
      status: "reference",
      getter: "pool",
    },
    {
      ...base,
      id: "pending-admin",
      kind: "token-admin",
      status: "pending",
      scope,
    },
  ];
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-10-22T00:00:00.000Z",
    graphqlData: input,
  });
  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(snapshot.data.relationships)),
    input.ContractRelationship
  );
});

test("rejects mismatched record counts", () => {
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: "2026-05-25T00:00:00.000Z",
    graphqlData: getSampleProtocolData(1),
  });
  snapshot.recordCounts.contracts = 100;

  assert.match(
    validateProtocolSnapshot(snapshot).join("; "),
    /recordCounts\.contracts/
  );
});

test("creates manifest last", async () => {
  const files = await createSnapshotFiles({
    chains: supportedChains,
    loadProtocolData: (chainId) => getSampleProtocolData(chainId),
    deploymentId: "deployment-a",
    now: new Date("2026-05-25T00:00:00.000Z"),
    publicOrigin: "https://snapshots.example.com",
  });

  assert.equal(files.at(-1)?.key, "v1/manifest.json");
  assert.equal(files.at(-1)?.publishLast, true);
  assert(
    files.some(
      (file) => file.key === "v1/deployments/deployment-a/chain/1/protocol.json"
    )
  );
  const manifest = JSON.parse(files.at(-1)?.body ?? "{}");
  assert.equal(manifest.indexerDeploymentId, "deployment-a");
  assert.equal(
    manifest.artifacts["1"],
    "v1/deployments/deployment-a/chain/1/protocol.json"
  );
  assert.equal(manifest.chains[0].path, "/v1/chains/1/protocol");
  assert.equal(manifest.indexingProgress.chains.Mainnet.chainId, 1);
});

test("chain selection is allowlisted", () => {
  assert.deepEqual(parseChainIds("1,10", supportedChains), [1, 10]);
  assert.deepEqual(parseChainIds(undefined, supportedChains), [1, 10]);
  assert.throws(
    () => selectChains([999], supportedChains),
    /Unsupported chain id/
  );
});

test("chain loading excludes historical entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "protocol-chains-"));
  const configPath = path.join(directory, "chains.json");
  const previous = process.env.PROTOCOL_CHAINS_CONFIG_PATH;
  const active = { ...supportedChains[0], availability: "indexed" };
  const historical = { ...supportedChains[1], availability: "historical" };
  process.env.PROTOCOL_CHAINS_CONFIG_PATH = configPath;
  try {
    await writeFile(configPath, JSON.stringify([active, historical]));
    assert.deepEqual(await loadSupportedChains(), [active]);
  } finally {
    if (previous === undefined) delete process.env.PROTOCOL_CHAINS_CONFIG_PATH;
    else process.env.PROTOCOL_CHAINS_CONFIG_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("validates other-contract inventory before returning typed entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "protocol-inventory-"));
  const configPath = path.join(directory, "other-contracts.json");
  const previous = process.env.OTHER_CONTRACTS_CONFIG_PATH;
  process.env.OTHER_CONTRACTS_CONFIG_PATH = configPath;
  const valid = {
    chainId: 1,
    address: "0x0000000000000000000000000000000000000001",
    name: "Pool",
    startBlock: 0,
  };
  try {
    for (const invalid of [
      {},
      [{ ...valid, chainId: 0 }],
      [{ ...valid, address: "0x1234" }],
      [{ ...valid, address: "0x0000000000000000000000000000000000000000" }],
      [{ ...valid, name: "" }],
      [{ ...valid, startBlock: -1 }],
      [{ ...valid, labelOnly: "true" }],
    ]) {
      await writeFile(configPath, JSON.stringify(invalid));
      await assert.rejects(loadOtherContracts(), /other-contract inventory/);
    }
    await writeFile(configPath, JSON.stringify([valid]));
    assert.deepEqual(await loadOtherContracts(), [valid]);
    await writeFile(
      configPath,
      JSON.stringify([{ ...valid, labelOnly: true }])
    );
    assert.deepEqual(await loadOtherContracts(), [
      { ...valid, labelOnly: true },
    ]);
  } finally {
    if (previous === undefined) delete process.env.OTHER_CONTRACTS_CONFIG_PATH;
    else process.env.OTHER_CONTRACTS_CONFIG_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports Hasura network failures with safe context", async () => {
  const originalFetch = globalThis.fetch;
  let sawAbortSignal = false;
  globalThis.fetch = async (_url, init) => {
    sawAbortSignal = init?.signal instanceof AbortSignal;
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () =>
        fetchProtocolData(
          "http://user:password@hasura:8080/v1/graphql?secret=value",
          1,
          "admin-secret"
        ),
      (error) => {
        assert(error instanceof Error);
        assert.match(
          error.message,
          /Hasura GraphQL request to http:\/\/hasura:8080\/v1\/graphql for chain 1 failed before response: fetch failed/
        );
        assert.match(error.message, /hasura PORT/);
        assert.doesNotMatch(
          error.message,
          /password|secret=value|admin-secret/
        );
        return true;
      }
    );
    assert.equal(sawAbortSignal, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
