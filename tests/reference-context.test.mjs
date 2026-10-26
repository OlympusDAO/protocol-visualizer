import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import "../apps/indexer/scripts/register-typescript.mjs";
const {
  getRelationshipGraph,
  getRelationshipPath,
  getRelationshipCurve,
  getFunctionTooltip,
} = await import(
  "../apps/frontend/src/components/contract-visualizer/graph.ts"
);
const { getArchitectureView } = await import(
  "../apps/frontend/src/components/contract-visualizer/architecture.ts"
);
const { createSnapshotBatch } = await import(
  "../apps/snapshot-publisher/dist/src/snapshot.js"
);
const { createSnapshotGateway } = await import(
  "../apps/snapshot-gateway/dist/src/server.js"
);
const { decodeProtocolSnapshot } = await import(
  "../apps/frontend/src/services/contracts.ts"
);

const registry = "0xb22764f98dd05c789929716d677382df22c05cb6";
const token = "0x64aa3364f17a4d01c6f1751fd97c2bd3d7e7f1d5";
const current = "0x245cc372c84b3645bf0ffe6538620b04a217988b";
const nominee = "0x953ea3223d2dd3c1a91e9d6cca1bf7af162c9c39";
const admin = (id, source, status) => ({
  id,
  chainId: 1,
  source,
  target: token,
  status,
  kind: "token-admin",
  subject: registry,
  scope: { registry, token },
  provenance: { number: "10", hash: "0xa", timestamp: "1" },
});

test("token administrators connect through their registry with one shared token-context link", () => {
  const relationships = [
    admin("current", current, "current"),
    admin("pending", nominee, "pending"),
  ];
  const graph = getRelationshipGraph(relationships, 1);
  assert.deepEqual(getRelationshipPath(relationships[1]), [
    nominee,
    registry,
    token,
  ]);
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === nominee &&
        edge.target === registry &&
        edge.pending &&
        edge.label === "Pending OHM admin"
    )
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === current && edge.target === registry && !edge.pending
    )
  );
  assert.equal(
    graph.edges.filter(
      (edge) => edge.source === registry && edge.target === token
    ).length,
    1
  );
  assert.equal(
    graph.edges.some(
      (edge) => edge.source === nominee && edge.target === token
    ),
    false
  );
  const nodes = [current, nominee, registry, token].map((id) => ({
    id,
    position: { x: 0, y: 0 },
    data: {
      name:
        id === registry
          ? "TokenAdminRegistry"
          : id === token
            ? "OHM"
            : "DAO MS",
    },
  }));
  const edges = graph.edges.map((edge) => ({
    ...edge,
    data: {
      kind: "control",
      pending: edge.pending,
      relationship: edge.relationship,
      labelText: edge.label,
    },
  }));
  for (const selected of [nominee, token, registry]) {
    const focus = getArchitectureView(
      nodes,
      edges,
      "overview",
      { permission: false, reference: true, control: true },
      selected
    );
    assert.ok(focus.nodes.some((node) => node.id === registry));
    assert.ok(focus.nodes.some((node) => node.id === token));
    assert.ok(focus.nodes.some((node) => node.id === nominee));
    assert.ok(
      focus.edges.some(
        (edge) => edge.source === registry && edge.target === token
      )
    );
  }
  for (const ordered of [relationships, [...relationships].reverse()]) {
    const scopedEdges = getRelationshipGraph(ordered, 1).edges.map((edge) => ({
      ...edge,
      data: { kind: "control", relationship: edge.relationship },
    }));
    for (const selected of [current, nominee, token, registry]) {
      const focus = getArchitectureView(
        nodes,
        scopedEdges,
        "overview",
        { permission: false, reference: true, control: true },
        selected
      );
      const controllers = focus.nodes
        .filter((node) => [current, nominee].includes(node.id))
        .map((node) => node.id);
      assert.deepEqual(
        new Set(controllers),
        new Set(
          [token, registry].includes(selected) ? [current, nominee] : [selected]
        )
      );
    }
  }
  const overview = getArchitectureView(
    nodes,
    edges,
    "overview",
    { permission: false, reference: true, control: true },
    null
  );
  assert.ok(overview.nodes.some((node) => node.id === registry));
});

test("parallel reference curves and captions have distinct lanes and documentation remains literal", () => {
  const relationship = {
    ...admin("a", current, "reference"),
    kind: "contract-reference",
    scope: undefined,
    getter: "target",
    functionContext: {
      signature: "target()",
      notice: "Target {expression} <script>text</script>",
      source: {
        url: "https://sourcify.dev/example",
        codeHash: "0x1234",
        match: "exact",
      },
    },
  };
  const graph = getRelationshipGraph(
    [
      relationship,
      {
        ...relationship,
        id: "b",
        getter: "otherTarget",
        functionContext: { signature: "otherTarget()" },
      },
    ],
    1
  );
  const curves = graph.edges.map((edge) =>
    getRelationshipCurve(0, 0, 300, 200, edge.labelOffset * 2.5)
  );
  assert.equal(new Set(curves.map((curve) => curve.path)).size, 2);
  assert.ok(Math.abs(curves[0].labelY - curves[1].labelY) >= 30);
  assert.equal(
    getFunctionTooltip([relationship.functionContext]),
    "target() — Target {expression} <script>text</script>"
  );
  assert.equal(
    getFunctionTooltip([
      {
        ...relationship.functionContext,
        source: { ...relationship.functionContext.source, match: "code" },
      },
    ]),
    "target()"
  );
  assert.deepEqual(
    graph.edges.map((edge) => edge.label),
    ["target()", "otherTarget()"]
  );
});

test("optional getter documentation and code evidence survive publisher, gateway and legacy-compatible decoding", async () => {
  const permissionSignatures = [
    ["updateMovingAverage()()", "updateMovingAverage()"],
    ["mintOhm(address,uint256)()", "mintOhm(address,uint256)"],
    [
      "getPriceIn(address,address,uint8)(uint256,uint48)",
      "getPriceIn(address,address,uint8)",
    ],
    [
      "configure((address,uint256)[])((address,uint256)[])",
      "configure((address,uint256)[])",
    ],
    ["mintOhm(address,uint256)", "mintOhm(address,uint256)"],
    ["legacyName", "legacyName"],
  ];
  const relationship = {
    ...admin("reference", current, "reference"),
    kind: "contract-reference",
    scope: undefined,
    getter: "target",
    functionContext: {
      signature: "target()",
      notice: "Inherited target",
      details: "More detail",
      params: {},
      returns: { _0: "The destination" },
      source: { url: "https://sourcify.dev/example", codeHash: "0x1234" },
    },
    targetCode: "present",
  };
  const chain = {
    key: "Mainnet",
    chainId: 1,
    name: "Ethereum Mainnet",
    explorerBaseUrl: "https://etherscan.io",
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "reference-context",
    additionalContracts: [
      { chainId: 1, address: current, name: "Documented source" },
    ],
    loadProtocolData: () => ({
      Contract: [
        {
          id: "1-policy",
          chainId: 1,
          address: current,
          name: "Policy",
          contractType: "POLICY",
          isEnabled: true,
          lastUpdatedTimestamp: "1",
          lastUpdatedBlockNumber: "10",
          policyPermissions: permissionSignatures.map(([signature]) => ({
            keycode: "MINTR",
            function: signature,
          })),
        },
      ],
      ContractRelationship: [relationship],
      ChainObservation: [
        { chainId: 1, indexedThrough: relationship.provenance },
      ],
    }),
  });
  assert.equal(batch.ready, true);
  const objects = new Map(batch.files.map((file) => [file.key, file.body]));
  const reader = {
    getObject: async (key) => ({ body: objects.get(key) }),
    headObject: async (key) => {
      assert.ok(objects.has(key));
    },
  };
  const server = createServer(
    createSnapshotGateway({ reader, chains: [chain], openapiPath: "unused" })
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/chains/1/protocol`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    const data = decodeProtocolSnapshot(payload);
    assert.deepEqual(
      data.contracts[0].policyPermissions.map(
        (permission) => permission.function
      ),
      permissionSignatures.map(([, signature]) => signature)
    );
    assert.deepEqual(
      data.relationships[0].functionContext,
      relationship.functionContext
    );
    assert.equal(data.relationships[0].targetCode, "present");
    delete payload.data.relationships[0].functionContext;
    delete payload.data.relationships[0].targetCode;
    const legacy = decodeProtocolSnapshot(payload);
    assert.equal(
      getRelationshipGraph(legacy.relationships, 1).edges[0].label,
      "target()"
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
