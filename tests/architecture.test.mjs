import assert from "node:assert/strict";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
const {
  getArchitectureView,
  layoutArchitectureSections,
  getSubsystem,
  SUBSYSTEMS,
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
  node("retired", "Operator", { kernelInactive: true }),
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
const filters = { permission: true, control: true, reference: true };

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
    proposals: ["ConvertibleDepositActivator", "MigrationProposalHelper"],
    governance: [
      "TreasuryCustodian",
      "CCIPTokenPoolConfig (1.0)",
      "CCIPTokenPoolConfigTimelock",
    ],
    tokens: ["OHM (2.0)", "sOHM", "gOHM", "Staking", "V1Migrator"],
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
