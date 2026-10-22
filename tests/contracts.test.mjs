import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
import { createSnapshotBatch } from "../apps/snapshot-publisher/dist/src/snapshot.js";
import { createSnapshotGateway } from "../apps/snapshot-gateway/dist/src/server.js";
import { getSampleProtocolData } from "../apps/snapshot-publisher/src/sample-data.ts";

const { decodeProtocolSnapshot, getAdditionalGraphContracts } = await import(
  "../apps/frontend/src/services/contracts.ts"
);
const {
  getEnablementPresentation,
  getContractPalette,
  getGraphContractName,
  getKernelLabel,
  refreshGraph,
} = await import(
  "../apps/frontend/src/components/contract-visualizer/graph.ts"
);

const chain = {
  key: "Robinhood",
  chainId: 4663,
  name: "Robinhood",
  explorerBaseUrl: "https://explorer.robinhood.com",
};
const address = "0x00000000000000000000000000000000000000aa";
const block = { number: "123", hash: "0xcanonical", timestamp: "1700000000" };

test("sample snapshot demonstrates Kernel active and Contract disabled independently", async () => {
  const sample = getSampleProtocolData(4663);
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "sample-enablement",
    additionalContracts: [],
    loadProtocolData: () => sample,
  });
  const data = decodeProtocolSnapshot(JSON.parse(batch.files[0].body));
  const policy = data.contracts.find((contract) => contract.type === "policy");
  const state = data.contractStates.find(
    (entry) => entry.address === policy.address
  );
  assert.equal(policy.isEnabled, true);
  assert.equal(state.enabled, false);
  assert.equal(state.kernelMembership, "active");
  assert.equal(getEnablementPresentation(state).badge, "Contract disabled");
});

test("graph keeps Kernel membership independent from three-state enablement", () => {
  const state = {
    enabled: false,
    enablerCapability: "supported",
    indexedThrough: block,
    verification: { outcome: "mismatch", getterValue: "true", block },
  };
  const view = getEnablementPresentation(state);
  assert.equal(getKernelLabel({ isEnabled: true }), "Kernel active");
  assert.equal(
    getKernelLabel({ category: "inactive-core" }),
    "Kernel inactive"
  );
  assert.equal(view.badge, "Contract disabled");
  assert.match(view.warning, /indexed false.*getter true.*123/);
  assert.equal(
    getEnablementPresentation({ ...state, enabled: true }).badge,
    "Contract enabled"
  );
  assert.equal(getEnablementPresentation().badge, null);
  assert.equal(
    getEnablementPresentation({ ...state, enabled: null }).badge,
    null
  );
  assert.match(
    getEnablementPresentation({
      ...state,
      enablerCapability: "unsupported",
      enabled: null,
    }).details.join(" "),
    /does not implement IEnabler/
  );
  assert.equal(
    getEnablementPresentation({
      ...state,
      verification: { outcome: "unavailable", block },
    }).badge,
    "Contract disabled"
  );
  assert.match(
    getEnablementPresentation({
      ...state,
      verification: { outcome: "unavailable", block },
    }).details.join(" "),
    /unavailable/
  );
});

test("graph refresh keeps selection and positions, normalizes duplicate identities, and retains deployed versions", () => {
  const prior = [{ id: "0xaa", position: { x: 12, y: 34 } }];
  const refreshed = refreshGraph(
    [
      { id: "0xAA", position: { x: 0, y: 0 }, data: "disabled" },
      { id: "0xaa", position: { x: 1, y: 1 }, data: "duplicate" },
      { id: "0xbb", position: { x: 9, y: 9 } },
    ],
    prior,
    "0xAA"
  );
  assert.equal(refreshed.nodes.length, 2);
  assert.equal(refreshed.selectedNode, "0xaa");
  assert.deepEqual(refreshed.nodes[0].position, { x: 12, y: 34 });
  assert.equal(refreshed.nodes[0].data, "disabled");
  assert.equal(refreshGraph([], prior, "0xaa").selectedNode, null);
  assert.equal(
    getContractPalette({ category: "inactive-core", contractType: "POLICY" }),
    "policy"
  );
  assert.equal(
    getContractPalette({ category: "inactive-core", contractType: "MODULE" }),
    "module"
  );
  assert.equal(getContractPalette({ category: "external" }), "external");
  assert.equal(
    getGraphContractName({ name: "Operator", version: "1.4" }),
    "Operator (1.4)"
  );
});

test("legacy data defaults to unknown control state and no additional nodes", () => {
  const data = decodeProtocolSnapshot({
    schemaVersion: "1.0.0",
    data: { contracts: [], roles: [], roleAssignments: [] },
  });
  assert.deepEqual(getAdditionalGraphContracts(data), []);
  assert.deepEqual(data.contractStates, []);
  assert.equal(data.observation, null);
  assert.throws(
    () => decodeProtocolSnapshot({ schemaVersion: "2.0.0", data }),
    /Unsupported snapshot schema version: 2.0.0/
  );
});

test("additional-only state roundtrips publisher, gateway, and frontend without invented core membership", async () => {
  const lastChange = {
    ...block,
    transactionHash: "0xtx",
    logIndex: 2,
    caller: address,
    data: "0x1234",
    lastTransitionAt: "1700000000",
  };
  const state = {
    id: `4663:${address}`,
    chainId: 4663,
    address,
    enablerCapability: "supported",
    enabled: false,
    seed: block,
    lastChange,
    indexedThrough: block,
    verification: { outcome: "mismatch", getterValue: "true", block },
  };
  const relationship = {
    id: "owner-link",
    chainId: 4663,
    kind: "owner",
    source: "0x00000000000000000000000000000000000000bb",
    target: address,
    status: "current",
    provenance: block,
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "reader-roundtrip",
    additionalContracts: [{ chainId: 4663, address, name: "External pool" }],
    loadProtocolData: () => ({
      ContractState: [state],
      ContractRelationship: [relationship],
      ChainObservation: [{ chainId: 4663, indexedThrough: block }],
    }),
  });
  assert.equal(batch.ready, true);
  assert.equal(batch.files.at(-1).publishLast, true);
  const objects = new Map(batch.files.map((file) => [file.key, file.body]));
  const reader = {
    getObject: async (key) => ({ body: objects.get(key) }),
    headObject: async (key) => {
      assert(objects.has(key));
    },
  };
  const server = createServer(
    createSnapshotGateway({ reader, chains: [chain], openapiPath: "unused" })
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/chains/4663/protocol`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.schemaVersion, "1.1.0");
    const data = decodeProtocolSnapshot(payload);
    assert.deepEqual(data.contracts, []);
    assert.equal(getAdditionalGraphContracts(data)[0].name, "External pool");
    assert.equal(data.contractStates[0].kernelMembership, "unknown");
    assert.equal(data.contractStates[0].enabled, false);
    assert.deepEqual(data.contractStates[0].verification, state.verification);
    assert.deepEqual(data.contractStates[0].lastChange, lastChange);
    assert.deepEqual(data.relationships, [relationship]);
    assert.deepEqual(data.observation.indexedThrough, block);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("graph inventory normalizes addresses and omits duplicates of active core", () => {
  const core = { chainId: 4663, address: address.toUpperCase() };
  const data = {
    contracts: [core],
    additionalContracts: [
      { ...core, name: "Duplicate" },
      { chainId: 4663, address: "0xBB", name: "External" },
      { chainId: 4663, address: "0xbb", name: "External" },
    ],
  };
  assert.equal(getAdditionalGraphContracts(data).length, 1);
  assert.equal(getAdditionalGraphContracts(data)[0].id, "4663:0xbb");
});

test("unavailable getter verification keeps established state in a manifest-last batch", async () => {
  const state = {
    id: `4663:${address}`,
    chainId: 4663,
    address,
    enabled: true,
    enablerCapability: "supported",
    seed: block,
    lastChange: null,
    indexedThrough: block,
    verification: {
      outcome: "unavailable",
      block,
      reason: "historical getter read unavailable",
    },
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "unavailable-read",
    additionalContracts: [{ chainId: 4663, address, name: "External pool" }],
    loadProtocolData: () => ({
      ContractState: [state],
      ChainObservation: [{ chainId: 4663, indexedThrough: block }],
    }),
  });
  assert.equal(batch.ready, true);
  assert.equal(batch.files.at(-1).publishLast, true);
  const snapshot = JSON.parse(batch.files[0].body);
  assert.equal(snapshot.data.contractStates[0].enabled, true);
  assert.deepEqual(snapshot.data.contractStates[0].seed, block);
  assert.deepEqual(
    snapshot.data.contractStates[0].verification,
    state.verification
  );
});
