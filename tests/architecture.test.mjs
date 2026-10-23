import assert from "node:assert/strict";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
const {
  getArchitectureView,
  layoutArchitectureSections,
  getSubsystem,
  SUBSYSTEMS,
  layoutContractGraph,
  DEFAULT_CONNECTION_FILTERS,
  FOCUSED_CONNECTION_FILTERS,
} = await import(
  "../apps/frontend/src/components/contract-visualizer/architecture.ts"
);

const node = (id, name, extra = {}) => ({
  id,
  position: { x: 0, y: 0 },
  data: { name, ...extra },
});
const nodes = [
  node("module", "MINTR", { contractType: "module" }),
  node("cooler", "CoolerV2", { contractType: "policy" }),
  node("migrator", "CoolerV2Migrator"),
  node("bridge", "CCIPTokenPoolConfig", { contractType: "policy" }),
  node("actor", "DAO MS", { assigneeAddress: "actor" }),
  node("role-admin", "admin"),
  node("retired", "Operator", {
    kernelInactive: true,
    kernelHistory: "installed",
  }),
];
const edge = (id, source, target, kind, pending = false) => ({
  id,
  source,
  target,
  data: { kind, pending },
});
const edges = [
  edge("owner-cooler", "actor", "cooler", "control"),
  edge("owner-bridge", "actor", "bridge", "control"),
  edge("nominee", "actor", "bridge", "control", true),
  edge("permission", "cooler", "module", "permission"),
  edge("role-use", "role-admin", "cooler", "permission"),
  edge("ref-one", "migrator", "bridge", "reference"),
  edge("ref-two", "cooler", "bridge", "reference"),
];
const filters = {
  permission: true,
  control: true,
  reference: true,
  dependency: true,
};

test("overview defaults hide references and permissions while contract and role focus reveal them", () => {
  assert.deepEqual(
    getArchitectureView(
      nodes,
      edges,
      "overview",
      DEFAULT_CONNECTION_FILTERS,
      null
    ).edges.map((edge) => edge.id),
    ["owner-cooler", "owner-bridge", "nominee"]
  );
  const focused = getArchitectureView(
    nodes,
    edges,
    "overview",
    FOCUSED_CONNECTION_FILTERS,
    "cooler"
  ).edges;
  assert.ok(focused.some((edge) => edge.id === "ref-two"));
  assert.ok(focused.some((edge) => edge.id === "permission"));
  assert.ok(focused.some((edge) => edge.id === "role-use"));
  assert.deepEqual(
    getArchitectureView(
      nodes,
      edges,
      "overview",
      FOCUSED_CONNECTION_FILTERS,
      "role-admin"
    ).edges.map((edge) => edge.id),
    ["role-use"]
  );
});

test("module dependencies have an independent opt-in filter, including public module getters", () => {
  const cards = [
    node("policy", "Operator", { contractType: "policy" }),
    node("module", "PRICE", { contractType: "module" }),
    node("facility", "ConvertibleDepositFacility", { contractType: "policy" }),
  ];
  const links = [
    {
      ...edge("registry", "policy", "module", "reference"),
      data: { kind: "reference", relationship: { kind: "module-dependency" } },
    },
    {
      ...edge("getter", "policy", "module", "reference"),
      data: { kind: "reference", relationship: { kind: "contract-reference" } },
    },
    {
      ...edge("facility", "policy", "facility", "reference"),
      data: { kind: "reference", relationship: { kind: "contract-reference" } },
    },
  ];
  assert.deepEqual(
    getArchitectureView(
      cards,
      links,
      "overview",
      { ...filters, dependency: false },
      null
    ).edges.map((edge) => edge.id),
    ["facility"]
  );
  assert.equal(
    getArchitectureView(cards, links, "overview", filters, null).edges.length,
    3
  );
  assert.deepEqual(
    getArchitectureView(
      cards,
      links,
      "overview",
      { ...filters, reference: false },
      null
    ).edges.map((edge) => edge.id),
    ["registry", "getter"]
  );
});

test("never-installed and removed contracts have distinct side sections; legacy history stays unknown", () => {
  const cards = [
    node("active", "CoolerV2"),
    node("never", "CCIPTokenPoolConfig", {
      kernelInactive: true,
      kernelHistory: "never-installed",
    }),
    node("removed", "Operator", {
      kernelInactive: true,
      kernelHistory: "installed",
    }),
    node("unknown", "Policy", { kernelInactive: true }),
  ];
  assert.deepEqual(cards.slice(1).map(getSubsystem), [
    "never-installed",
    "inactive",
    "kernel-history-unknown",
  ]);
  const layout = layoutArchitectureSections(cards);
  const sections = layout.filter((node) => node.type === "group");
  for (const name of [
    "Never installed in Kernel",
    "Removed from Kernel",
    "Kernel history unknown",
  ])
    assert.ok(sections.some((node) => node.data.name === name));
  const side = sections.filter((node) => node.id !== "section-cooler");
  assert.equal(new Set(side.map((node) => node.position.x)).size, 1);
  assert.equal(
    layout.filter((node) => node.type !== "group").length,
    cards.length
  );
});

test("focused CCIP layout routes long links around cards and separates parallel relationship labels", () => {
  const cards = ["dao", "config", "registry", "pool", "checker"].map((id) => ({
    ...node(id, id),
    style: { width: id === "checker" ? 320 : 240 },
  }));
  const links = [
    ["dao", "registry", "OHM admin"],
    ["dao", "pool", "Pool owner"],
    ["config", "pool", "Pending pool owner"],
    ["config", "pool", "pool()"],
    ["registry", "pool", "getPool(address)"],
    ["checker", "config", "CONFIG()"],
    ["checker", "registry", "REGISTRY()"],
    ["checker", "pool", "POOL()"],
    ["checker", "dao", "DAO_MS()"],
  ].map(([source, target, labelText], index) => ({
    id: String(index),
    source,
    target,
    data: { labelText },
  }));
  const layout = layoutContractGraph(cards, links);
  assert.deepEqual(
    layout.nodes.map((node) => node.id),
    cards.map((node) => node.id)
  );
  assert.deepEqual(
    layout.edges.map((edge) => edge.id),
    links.map((edge) => edge.id)
  );
  assert.deepEqual(layoutContractGraph(cards, links), layout);
  for (const edge of layout.edges) {
    const points = edge.data.route.points;
    for (const card of layout.nodes.filter(
      (node) => ![edge.source, edge.target].includes(node.id)
    )) {
      for (let segment = 1; segment < points.length; segment++)
        for (let sample = 0; sample <= 20; sample++) {
          const fraction = sample / 20;
          const x =
            points[segment - 1].x +
            (points[segment].x - points[segment - 1].x) * fraction;
          const y =
            points[segment - 1].y +
            (points[segment].y - points[segment - 1].y) * fraction;
          assert.ok(
            !(
              x > card.position.x &&
              x < card.position.x + card.style.width &&
              y > card.position.y &&
              y < card.position.y + 120
            ),
            `${edge.data.labelText} crosses ${card.id}`
          );
        }
    }
  }
  const parallel = layout.edges.filter(
    (edge) => edge.source === "config" && edge.target === "pool"
  );
  assert.notDeepEqual(
    parallel[0].data.route.points,
    parallel[1].data.route.points
  );
  assert.ok(
    Math.abs(parallel[0].data.route.labelY - parallel[1].data.route.labelY) >=
      24
  );
});

test("contract sections separate infrastructure, proposal helpers and Olympus tokens", () => {
  const sections = {
    "reserve-tokens": [
      "USDS",
      "sUSDS",
      "DAI",
      "sDAI",
      "DaiUsdsMigrator",
      "Mock sUSDS",
      "MockDaiUsds",
    ],
    ccip: [
      "TokenAdminRegistry",
      "CCIP RBACTimelock",
      "CCIPLockReleaseTokenPool",
      "LockReleaseTokenPool (1.5.1)",
    ],
    proposals: [
      "ConvertibleDepositActivator",
      "MigrationProposalHelper",
      "CCIPTokenPoolConfigProposalChecker",
    ],
    governance: [
      "TreasuryCustodian",
      "CCIPTokenPoolConfig (1.0)",
      "CCIPTokenPoolConfigTimelock",
    ],
    tokens: [
      "OHM (2.0)",
      "sOHM",
      "gOHM",
      "gOHM (Synapse)",
      "Staking",
      "V1Migrator",
    ],
    "bond-protocol": ["BondFixedTermSDA"],
    bridging: ["CCIPCrossChainBridge", "LZCrossChainBridge"],
    cooler: ["CoolerV2Composites"],
  };
  const cards = [];
  for (const [section, names] of Object.entries(sections)) {
    for (const name of names) {
      // Referenced controllers can enter the graph through the address-node path.
      const card = node(name, name, { assigneeAddress: name });
      assert.equal(getSubsystem(card), section, name);
      cards.push(card);
    }
  }
  const layout = layoutArchitectureSections(cards);
  for (const section of Object.keys(sections))
    assert.ok(layout.some((card) => card.id === `section-${section}`));
  assert.equal(
    layout.filter((card) => card.type !== "group").length,
    cards.length
  );
  assert.equal(
    SUBSYSTEMS.find((section) => section.id === "tokens").name,
    "Olympus Tokens"
  );
  assert.equal(getSubsystem(node("policy-ms", "Policy MS")), null);
  assert.equal(
    getSubsystem(
      node("unknown", "Unknown address", { assigneeAddress: "unknown" })
    ),
    null
  );
});

test("focused permissions remain visible even when the source graph fades them", () => {
  const faded = edges.map((edge) => ({ ...edge, style: { opacity: 0.1 } }));
  const focus = getArchitectureView(
    nodes,
    faded,
    "overview",
    filters,
    "cooler"
  );
  assert.ok(focus.edges.length > 0);
  assert.ok(focus.edges.every((edge) => edge.style.opacity === 1));
  assert.ok(faded.every((edge) => edge.style.opacity === 0.1));
});

test("architecture sections preserve visible canonical contracts, shared actors and exact connections", () => {
  const view = getArchitectureView(
    [...nodes, nodes[4]],
    [...edges, edges[5]],
    "overview",
    filters,
    null
  );
  assert.equal(view.nodes.length, nodes.length);
  assert.equal(view.edges.length, edges.length);
  assert.equal(view.nodes.filter((node) => node.id === "actor").length, 1);
  const sectioned = layoutArchitectureSections(view.nodes);
  assert.deepEqual(
    new Set(
      sectioned.filter((node) => node.type !== "group").map((node) => node.id)
    ),
    new Set(nodes.map((node) => node.id))
  );
  for (const node of sectioned.filter((node) => node.type !== "group")) {
    const containers = sectioned.filter(
      (group) =>
        group.type === "group" &&
        node.position.x >= group.position.x &&
        node.position.x + (node.style?.width ?? 180) <=
          group.position.x + group.style.width &&
        node.position.y >= group.position.y + 50 &&
        node.position.y + 120 <= group.position.y + group.style.height
    );
    assert.equal(containers.length, 1);
  }
  assert.ok(
    sectioned.some((node) => node.data.label === "Removed from Kernel")
  );
  assert.deepEqual(layoutArchitectureSections(view.nodes), sectioned);
  assert.deepEqual(layoutArchitectureSections([]), []);
});

test("subsystem drilldown reveals its contracts and immediate boundary without following shared owners", () => {
  const view = getArchitectureView(nodes, edges, "cooler", filters, null);
  assert.deepEqual(
    new Set(view.nodes.map((n) => n.id)),
    new Set(["cooler", "migrator", "module", "bridge", "actor", "role-admin"])
  );
  assert.equal(
    view.nodes.some((n) => n.id === "retired"),
    false
  );
  const focus = getArchitectureView(
    nodes,
    edges,
    "bridging",
    filters,
    "retired"
  );
  assert.deepEqual(
    focus.nodes.map((n) => n.id),
    ["retired"]
  );
});

test("relationship filters retain distinct pending controls and full graph remains available", () => {
  const view = getArchitectureView(
    nodes,
    edges,
    "overview",
    { ...filters, permission: false, control: false },
    null
  );
  assert.equal(view.edges.length, 2);
  assert.ok(view.edges.every((edge) => edge.data.kind === "reference"));
  const all = getArchitectureView(nodes, edges, "all", filters, null);
  assert.deepEqual(all.nodes, nodes);
  assert.deepEqual(all.edges, edges);
});
