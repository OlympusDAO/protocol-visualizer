import assert from "node:assert/strict";
import { digest, entityDigests } from "./benchmark-indexer.mjs";

const caches = new Set([
  "VerifiedDeployment",
  "KernelReadCache",
  "KernelReadEpoch",
]);
const coverage =
  "Source/runtime-verified ownership events maintain this value after its initial canonical getter verification.";
const eventReason =
  "Current value is derived from verified ownership events; retained RPC fields describe the last actual read.";
const equal = (a, b) =>
  a === undefined || b === undefined ? a === b : digest(a) === digest(b);
const map = (rows) => new Map(rows.map((row) => [row.id, row]));
const same = (a, b) => assert.ok(equal(a, b), "unexplained state difference");

// Compare physical records first. Each normalization below requires the oracle's
// canonical/read/proof checks; an unknown field or lost observation fails closed.
export function compareAuditedStates(base, head, a, b) {
  for (const [state, audit] of [
    [base, a],
    [head, b],
  ]) {
    assert.equal(audit.protocol, "protocol-visualizer-robinhood-oracle-v2");
    assert.equal(audit.stateHash, digest(state));
    assert.equal(audit.manifest.addedTopicLogs, 0);
    assert.equal(audit.manifest.dynamicRegistrations, 0);
    assert.equal(audit.observations.length, state.ContractRelationship.length);
    assert.equal(
      audit.validatedDeployments,
      state.VerifiedDeployment?.length ?? 0
    );
    assert.equal(
      audit.validatedKernelFacts,
      state.KernelReadCache?.length ?? 0
    );
    assert.equal(audit.seedObservations.length, state.ContractStateSeed.length);
    const seeds = map(audit.seedObservations);
    for (const seed of state.ContractStateSeed) {
      assert.equal(seeds.get(seed.id)?.value, seed.value);
      same(seeds.get(seed.id).boundary, seed.boundary);
    }
  }
  same(a.current, b.current);
  same(a.manifest, b.manifest);
  same(a.identity, b.identity);
  const names = [
    ...new Set([...Object.keys(base), ...Object.keys(head)]),
  ].filter((name) => !caches.has(name));
  assert.equal(
    names.length,
    Object.keys(base).filter((name) => !caches.has(name)).length
  );
  const accepted = {
    immutable: 0,
    kernel: 0,
    ownership: 0,
    coverage: 0,
    targetCode: 0,
    seeds: 0,
  };
  const observations = [a, b].map((audit) => map(audit.observations));
  const rows = [base, head].map((state) => map(state.ContractRelationship));
  same([...rows[0].keys()].toSorted(), [...rows[1].keys()].toSorted());
  for (const [id, old] of rows[0]) {
    const next = rows[1].get(id);
    const observed = observations.map((items) => items.get(id));
    for (const [row, oracle] of [
      [old, observed[0]],
      [next, observed[1]],
    ]) {
      assert.ok(oracle, "missing oracle observation");
      if (oracle.kind === "readable") {
        assert.equal(row.value, oracle.value);
        assert.equal(row.verification.getterValue, oracle.observed);
        assert.ok(["match", "unperformed"].includes(row.verification.outcome));
      } else {
        assert.equal(oracle.kind, "getterless");
        assert.equal(oracle.getterlessProof.noFallback, true);
        assert.equal(oracle.getterlessProof.reverted, true);
        assert.match(oracle.getterlessProof.codeHash, /^0x[0-9a-f]{64}$/);
        assert.match(oracle.getterlessProof.sourceHash, /^[0-9a-f]{64}$/);
        assert.equal(row.verification.outcome, "unavailable");
        assert.equal(row.value, oracle.value);
      }
    }
    const proof = observed[1].proof;
    const normalized = structuredClone(next);
    const changed = new Set(
      [...Object.keys(old), ...Object.keys(next)].filter(
        (key) => !equal(old[key], next[key])
      )
    );
    for (const key of changed) {
      if (["seed", "provenance"].includes(key)) {
        assert.ok(proof && ["immutable", "kernel"].includes(proof.kind));
        if (key === "seed") assert.equal(proof.kind, "immutable");
        same(next[key], proof.block);
        assert.ok(BigInt(old[key].number) >= BigInt(proof.block.number));
      } else if (key === "verification") {
        for (const field of new Set([
          ...Object.keys(old.verification),
          ...Object.keys(next.verification),
        ])) {
          const before = old.verification[field];
          const after = next.verification[field];
          if (equal(before, after)) continue;
          if (field === "block") {
            assert.ok(proof);
            same(after, proof.block);
            assert.ok(BigInt(before.number) >= BigInt(after.number));
          } else if (field === "eventReplay") {
            assert.equal(before, undefined);
            assert.equal(proof?.kind, "ownership");
            same(after, { ...proof.policy, block: proof.block });
          } else if (field === "getterValue") {
            assert.equal(proof?.kind, "ownership");
            assert.equal(after, observed[1].observed);
          } else if (field === "outcome") {
            assert.equal(proof?.kind, "ownership");
            assert.equal(before, "match");
            assert.equal(after, "unperformed");
            assert.equal(next.verification.reason, eventReason);
          } else if (field === "reason") {
            assert.equal(proof?.kind, "ownership");
            assert.equal(before, undefined);
            assert.equal(after, eventReason);
          } else assert.fail(`unknown verification difference: ${field}`);
        }
      } else if (key === "coverage") {
        assert.ok(observed[1].coverageProof);
        assert.equal(next.coverage, coverage);
        accepted.coverage++;
      } else if (key === "targetCode") {
        assert.equal(old.targetCode, null);
        assert.ok(["present", "absent"].includes(next.targetCode));
        assert.equal(next.targetCode, observed[1].targetCode);
        accepted.targetCode++;
      } else assert.fail(`unknown relationship difference: ${key}`);
      normalized[key] = old[key];
    }
    if (proof && changed.size) accepted[proof.kind]++;
    same(normalized, old);
  }

  const seeds = [base, head].map((state) => map(state.ContractStateSeed));
  const oldMissing = [...seeds[0]]
    .filter(([id]) => !seeds[1].has(id))
    .map(([, row]) => row);
  const newMissing = [...seeds[1]]
    .filter(([id]) => !seeds[0].has(id))
    .map(([, row]) => row);
  assert.equal(oldMissing.length, newMissing.length);
  const seedKey = (row) =>
    `${row.chainId}:${row.address}:${row.getter}:${row.value}`;
  const replacements = new Map(newMissing.map((row) => [seedKey(row), row]));
  assert.equal(replacements.size, newMissing.length);
  for (const seed of oldMissing) {
    const replacement = replacements.get(seedKey(seed));
    assert.ok(replacement, "lost seed history");
    const proof = observations[1].get(
      `${seed.chainId}:${seed.address}:${seed.getter}`
    )?.proof;
    assert.equal(proof?.kind, "immutable");
    assert.equal(
      seed.value,
      observations[1].get(`${seed.chainId}:${seed.address}:${seed.getter}`)
        .value
    );
    assert.equal(
      seed.value,
      observations[1].get(`${seed.chainId}:${seed.address}:${seed.getter}`)
        .observed
    );
    assert.equal(seed.boundary.number, String(a.start));
    same(replacement.boundary, proof.block);
    assert.equal(
      replacement.id,
      `${replacement.chainId}:${replacement.address}:${replacement.getter}:${proof.block.hash}`
    );
    const normalized = { ...replacement, id: seed.id, boundary: seed.boundary };
    same(normalized, seed);
    accepted.seeds++;
  }
  for (const [id, seed] of seeds[0])
    if (seeds[1].has(id)) same(seed, seeds[1].get(id));
  for (const name of names) {
    assert.ok(base[name] && head[name], "functional entity coverage differs");
    if (["ContractRelationship", "ContractStateSeed"].includes(name)) continue;
    same(
      entityDigests(name, base[name]).semantic,
      entityDigests(name, head[name]).semantic
    );
  }
  return {
    accepted,
    sharedEntityTypes: names.length,
    commonStateHash: digest(
      Object.fromEntries(
        names
          .toSorted()
          .map((name) => [name, entityDigests(name, base[name]).semantic])
      )
    ),
    relationships: rows[0].size,
  };
}
