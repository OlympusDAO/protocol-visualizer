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
const { getRelationshipFields } = await import(
  "../apps/indexer/src/events/ownership-contracts.ts"
);
const {
  getEnablementPresentation,
  getRelationshipGraph,
  getContractPalette,
  getGraphContractName,
  getKernelLabel,
  refreshGraph,
  groupInactiveContracts,
  getPreservedGraphNodes,
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

test("verified address labels repair old unknown names without adding deployments or hiding unresolved addresses", async () => {
  const policy = "0x018b747ca7a2b9346f80aed5a9b7a417fb57f313";
  const bridge = "0x3edd66de21fa6a4b141ad6971cb24f656e66ad4a";
  const unresolved = "0x1505f3ad833e9c82facd8b4d3ff4319b1ef6eb99";
  const batch = await createSnapshotBatch({
    chains: [{ ...chain, chainId: 11155111 }],
    deploymentId: "address-labels",
    additionalContracts: [
      {
        chainId: 11155111,
        address: bridge,
        name: "LZCrossChainBridge",
        labelOnly: true,
      },
    ],
    loadProtocolData: () => ({
      Contract: [
        {
          id: policy,
          address: policy,
          name: "UNKNOWN",
          contractType: "POLICY",
          isEnabled: true,
          lastUpdatedBlockNumber: "1",
          lastUpdatedTimestamp: "1",
        },
      ],
      RoleAssignment: [bridge, unresolved].map((assignee) => ({
        id: assignee,
        role: "test",
        assignee: assignee.toUpperCase().replace("0X", "0x"),
        assigneeName: "UNKNOWN",
        isGranted: true,
        lastUpdatedBlockNumber: "1",
        lastUpdatedTimestamp: "1",
      })),
    }),
  });
  const snapshot = JSON.parse(batch.files[0].body);
  const decoded = decodeProtocolSnapshot(snapshot);
  assert.equal(decoded.contracts[0].name, "LZBridgeAndDelegateConfig");
  assert.equal(decoded.roleAssignments[0].assigneeName, "LZCrossChainBridge");
  assert.equal(decoded.roleAssignments[1].assigneeName, "UNKNOWN");
  assert.equal(decoded.additionalContracts.length, 0);
  assert.equal(
    getRelationshipFields(11155111).some((field) => field.address === bridge),
    false
  );
  snapshot.data.additionalContracts.push({
    id: bridge,
    chainId: 11155111,
    address: bridge,
    name: "UNKNOWN",
    category: "external",
  });
  assert.equal(
    decodeProtocolSnapshot(snapshot).additionalContracts[0].name,
    "LZCrossChainBridge"
  );
  assert.equal(snapshot.data.contracts[0].name, "UNKNOWN");
  snapshot.data.contracts[0].name = "Existing alias";
  assert.equal(
    decodeProtocolSnapshot(snapshot).contracts[0].name,
    "Existing alias"
  );
  snapshot.chainId = 1;
  snapshot.data.contracts[0].name = "UNKNOWN";
  assert.equal(decodeProtocolSnapshot(snapshot).contracts[0].name, "UNKNOWN");
});

test("uninstalled core contracts sit together beside the active graph", () => {
  const active = { id: "active", position: { x: 400, y: 200 }, data: {} };
  const inactive = Array.from({ length: 4 }, (_, i) => ({
    id: `inactive-${i}`,
    position: { x: 0, y: 0 },
    data: { kernelInactive: true },
    style: { width: i === 0 ? 360 : 220 },
  }));
  const nodes = groupInactiveContracts([active], inactive);
  assert.deepEqual(
    nodes.find((node) => node.id === "active"),
    active
  );
  const group = nodes.find((node) => node.type === "group");
  assert.equal(group.data.label, "Not installed in Kernel");
  assert.ok(group.position.x > active.position.x + 180);
  for (const node of nodes.filter((node) => node.data.kernelInactive)) {
    assert.ok(node.position.x >= group.position.x + 24);
    assert.ok(node.position.y >= group.position.y + 48);
    assert.ok(
      node.position.x + node.style.width <= group.position.x + group.style.width
    );
    assert.ok(node.position.y + 100 <= group.position.y + group.style.height);
  }
  const first = nodes.find((node) => node.id === "inactive-0");
  const second = nodes.find((node) => node.id === "inactive-1");
  assert.ok(first.position.x + first.style.width < second.position.x);
  assert.equal(new Set(nodes.map((node) => node.id)).size, nodes.length);
  assert.deepEqual(groupInactiveContracts([active], []), [active]);
  const previous = nodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
  const next = groupInactiveContracts(
    [active],
    [{ ...inactive[0], id: "new-inactive" }, ...inactive]
  );
  const refreshed = refreshGraph(
    next,
    getPreservedGraphNodes(next, previous),
    null
  ).nodes;
  const cells = refreshed
    .filter((node) => node.data.kernelInactive)
    .map((node) => `${node.position.x}:${node.position.y}`);
  assert.equal(new Set(cells).size, 5);
  assert.deepEqual(
    refreshed.find((node) => node.id === "inactive-0").position,
    next.find((node) => node.id === "inactive-0").position
  );
  assert.equal(
    getPreservedGraphNodes(nodes, previous).some(
      (node) => node.id === "inactive-0"
    ),
    true
  );
  const focused = previous
    .filter((node) => node.type !== "group")
    .map((node) => ({ ...node, position: { x: 10, y: 20 } }));
  const focusedRefresh = refreshGraph(
    nodes,
    getPreservedGraphNodes(nodes, focused, previous),
    "inactive-0"
  );
  assert.deepEqual(
    focusedRefresh.nodes.find((node) => node.id === "inactive-0").position,
    { x: 10, y: 20 }
  );
});

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
    }).notices.join(" "),
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

test("disabled additional contracts retain observed references through publisher, gateway and frontend", async () => {
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
    provenance: lastChange,
    subject: address,
    getter: "owner",
    value: "0x00000000000000000000000000000000000000bb",
    seed: block,
    lastChange,
    indexedThrough: block,
    verification: { outcome: "mismatch", getterValue: address, block },
    coverage: "Indexed ownership events",
  };
  const reference = {
    ...relationship,
    id: "cooler-reference",
    kind: "cooler-reference",
    source: address,
    target: relationship.source,
    status: "reference",
    getter: "COOLERV2",
    value: relationship.source,
    provenance: block,
    lastChange: null,
    verification: { outcome: "match", getterValue: relationship.source, block },
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "reader-roundtrip",
    additionalContracts: [{ chainId: 4663, address, name: "CoolerV2Migrator" }],
    loadProtocolData: () => ({
      ContractState: [state],
      ContractRelationship: [relationship, reference],
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
    assert.equal(getAdditionalGraphContracts(data)[0].name, "CoolerV2Migrator");
    assert.equal(data.contractStates[0].kernelMembership, "unknown");
    assert.equal(data.contractStates[0].enabled, false);
    assert.deepEqual(data.contractStates[0].verification, state.verification);
    assert.deepEqual(data.contractStates[0].lastChange, lastChange);
    assert.deepEqual(data.relationships, [relationship, reference]);
    const graph = getRelationshipGraph(data.relationships, 4663);
    assert.equal(graph.edges.length, 2);
    assert.ok(
      graph.edges.some(
        (edge) =>
          edge.source === address &&
          edge.target === relationship.source &&
          edge.relationship.getter === "COOLERV2" &&
          edge.label === "COOLERV2()"
      )
    );
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

test("sample ownership keeps one holder for governor and guardian with a separate nominee", async () => {
  const sample = getSampleProtocolData(4663);
  const relationships = sample.ContractRelationship;
  assert.ok(relationships?.length >= 4);
  const governor = relationships.find(
    (entry) => entry.kind === "governor" && entry.status === "current"
  );
  const guardian = relationships.find((entry) => entry.kind === "guardian");
  const pending = relationships.find((entry) => entry.status === "pending");
  assert.equal(governor.source, guardian.source);
  assert.notEqual(pending.source, governor.source);
  assert.equal(pending.kind, "governor");
  assert.equal(
    relationships.find((entry) => entry.kind === "owner").source,
    sample.RoleAssignment[0].assignee
  );
});

test("relationship graph shares address identities, preserves kinds/scopes, and excludes unset/self links", () => {
  const holder = "0x00000000000000000000000000000000000000bb";
  const base = {
    id: "same-field",
    chainId: 4663,
    source: holder.toUpperCase().replace("0X", "0x"),
    target: address,
    status: "current",
    provenance: block,
  };
  const graph = getRelationshipGraph(
    [
      { ...base, kind: "governor" },
      { ...base, kind: "guardian" },
      { ...base, kind: "owner" },
      { ...base, kind: "governor", status: "pending" },
      { ...base, kind: "owner", scope: { token: holder } },
      {
        ...base,
        kind: "token-admin",
        scope: { registry: address, token: holder },
      },
      { ...base, kind: "pool-owner" },
      { ...base, kind: "configured-pool", status: "reference" },
      {
        ...base,
        kind: "registered-pool",
        status: "reference",
        getter: `getPool:${holder}`,
        scope: { registry: address, token: holder },
      },
      { ...base, kind: "owner", target: null, status: "unset" },
      {
        ...base,
        kind: "authority-reference",
        target: holder,
        status: "reference",
      },
      { ...base, kind: "owner", chainId: 1 },
    ],
    4663
  );
  assert.deepEqual(new Set(graph.addresses), new Set([holder, address]));
  assert.equal(graph.edges.length, 9);
  assert.equal(new Set(graph.edges.map((edge) => edge.labelOffset)).size, 9);
  assert.equal(new Set(graph.edges.map((edge) => edge.id)).size, 9);
  assert.equal(
    graph.edges.find((edge) => edge.relationship.getter?.startsWith("getPool:"))
      .label,
    "getPool(address)"
  );
  assert.equal(
    graph.edges.find((edge) => edge.relationship.kind === "configured-pool")
      .label,
    "Configured pool"
  );
  assert.equal(graph.edges.filter((edge) => edge.pending).length, 1);
  assert.match(
    graph.edges.find((edge) => edge.pending).label,
    /Pending governor/
  );
  assert.equal(
    graph.edges.every((edge) => edge.source === holder),
    true
  );
  const existing = [{ id: holder, position: { x: 1, y: 2 } }];
  const refreshed = refreshGraph(
    [
      ...existing,
      {
        id: holder.toUpperCase().replace("0X", "0x"),
        position: { x: 0, y: 0 },
      },
    ],
    existing,
    holder
  );
  assert.equal(refreshed.nodes.length, 1);
});
