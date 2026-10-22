import assert from "node:assert/strict";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
const { getArchitectureView } = await import(
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

test("architecture overview groups contracts and roles without duplicating shared actors", () => {
  const view = getArchitectureView(
    [...nodes, nodes[4]],
    [...edges, edges[5]],
    "overview",
    filters,
    null
  );
  assert.equal(new Set(view.nodes.map((n) => n.id)).size, view.nodes.length);
  assert.equal(view.nodes.filter((n) => n.id === "actor").length, 1);
  assert.equal(
    view.nodes.find((n) => n.data.subsystemId === "cooler").data.memberCount,
    2
  );
  assert.equal(
    view.nodes.find((n) => n.data.subsystemId === "inactive").data.memberCount,
    1
  );
  const refs = view.edges.find((e) => e.data.kind === "reference");
  assert.equal(refs.data.members.length, 2);
  assert.deepEqual(
    new Set(refs.data.members.map((e) => e.id)),
    new Set(["ref-one", "ref-two"])
  );
  assert.equal(view.edges.filter((e) => e.data.kind === "control").length, 3);
  const controls = view.edges.filter(
    (e) => e.source === "actor" && e.target === "subsystem-bridging"
  );
  assert.equal(new Set(controls.map((e) => e.labelStyle.transform)).size, 2);
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
  assert.equal(view.edges.length, 1);
  assert.equal(view.edges[0].data.kind, "reference");
  const all = getArchitectureView(nodes, edges, "all", filters, null);
  assert.deepEqual(all.nodes, nodes);
  assert.deepEqual(all.edges, edges);
});
