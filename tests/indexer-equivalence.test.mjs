import assert from "node:assert/strict";
import { test } from "node:test";
import { digest } from "../scripts/benchmark-indexer.mjs";
import { compareAuditedStates } from "../scripts/benchmark-indexer-equivalence.mjs";

const block = (number) => ({
  number: String(number),
  hash: `0x${number.toString(16).padStart(64, "0")}`,
  timestamp: String(number * 12),
});
function fixture() {
  const address = `0x${"1".repeat(40)}`;
  const value = `0x${"2".repeat(40)}`;
  const id = `1:${address}:foo`;
  const row = {
    id,
    chainId: 1,
    subject: address,
    getter: "foo",
    value,
    provenance: block(10),
    seed: block(10),
    indexedThrough: block(20),
    verification: { outcome: "match", getterValue: value, block: block(20) },
    functionContext: { signature: "foo()" },
    coverage: null,
    targetCode: null,
  };
  const seed = {
    id: `${id}:${block(10).hash}`,
    chainId: 1,
    address,
    getter: "foo",
    value,
    boundary: block(10),
  };
  const base = {
    ContractRelationship: [row],
    ContractStateSeed: [seed],
    Contract: [],
  };
  const head = structuredClone(base);
  head.ContractRelationship[0].provenance = block(1);
  head.ContractRelationship[0].seed = block(1);
  head.ContractRelationship[0].verification.block = block(1);
  head.ContractStateSeed[0].id = `${id}:${block(1).hash}`;
  head.ContractStateSeed[0].boundary = block(1);
  const make = (state) => ({
    protocol: "protocol-visualizer-robinhood-oracle-v2",
    stateHash: digest(state),
    start: 10,
    current: block(20),
    identity: {},
    validatedDeployments: 0,
    validatedKernelFacts: 0,
    manifest: {
      hash: "a".repeat(64),
      addedTopicLogs: 0,
      dynamicRegistrations: 0,
    },
    observations: [
      { id, kind: "readable", value, observed: value, targetCode: "present" },
    ],
    seedObservations: state.ContractStateSeed.map((seed) => ({
      id: seed.id,
      value: seed.value,
      boundary: seed.boundary,
    })),
  });
  const a = make(base),
    b = make(head);
  b.observations[0].proof = { kind: "immutable", block: block(1) };
  return { base, head, a, b };
}

test("equivalence admits audited immutable provenance and seed moves without losing values", () => {
  const { base, head, a, b } = fixture();
  const comparison = compareAuditedStates(base, head, a, b);
  assert.equal(comparison.relationships, 1);
  assert.equal(comparison.accepted.immutable, 1);
  assert.equal(comparison.accepted.seeds, 1);
});

test("equivalence rejects unexplained data, stale audits, missing proofs and lost history", () => {
  const mutations = [
    (x) => {
      x.head.ContractRelationship[0].value = `0x${"3".repeat(40)}`;
    },
    (x) => {
      x.head.ContractRelationship[0].functionContext.signature = "different()";
    },
    (x) => {
      x.head.ContractRelationship[0].verification.outcome = "unavailable";
    },
    (x) => {
      x.head.ContractRelationship[0].verification.unrecognized = true;
    },
    (x) => {
      delete x.b.observations[0].proof;
    },
    (x) => {
      x.head.ContractStateSeed = [];
    },
    (x) => {
      x.b.manifest.addedTopicLogs = 1;
    },
    (x) => {
      x.b.validatedDeployments = 1;
    },
    (x) => {
      const wrong = `0x${"9".repeat(40)}`;
      x.base.ContractStateSeed[0].value = wrong;
      x.head.ContractStateSeed[0].value = wrong;
      x.a.stateHash = digest(x.base);
    },
  ];
  for (const mutate of mutations) {
    const x = fixture();
    mutate(x);
    x.b.stateHash = digest(x.head);
    assert.throws(() => compareAuditedStates(x.base, x.head, x.a, x.b));
  }
  const x = fixture();
  x.b.stateHash = "old";
  assert.throws(() => compareAuditedStates(x.base, x.head, x.a, x.b));
});
