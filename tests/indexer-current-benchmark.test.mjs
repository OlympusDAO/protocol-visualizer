import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareCurrentStates } from "../scripts/benchmark-indexer-current.mjs";
import {
  currentStateEntities,
  currentStateProtocol,
  digest,
  entityDigests,
  parseOptions,
} from "../scripts/benchmark-indexer.mjs";

const address = `0x${"12".repeat(20)}`,
  value = `0x${"34".repeat(20)}`;
const block = (n) => ({
  number: String(n),
  hash: `0x${n.toString(16).padStart(64, "0")}`,
  timestamp: String(n + 100),
});
const tables =
  "ActionExecutedEvent ContractEvent KernelExecutorEvent RoleEvent ContractStateSeed".split(
    " "
  );
function fixture() {
  const base = Object.fromEntries(
    [...currentStateEntities, ...tables].map((name) => [name, []])
  );
  base.ChainObservation = [{ chainId: 1, id: "1", indexedThrough: block(20) }];
  base.ContractRelationship = [
    {
      chainId: 1,
      id: "fixture",
      subject: address,
      getter: "owner",
      value,
      lastChange: null,
      seed: block(10),
      provenance: block(10),
      indexedThrough: block(20),
      verification: { outcome: "match", getterValue: value, block: block(10) },
    },
  ];
  const head = Object.fromEntries(
    currentStateEntities.map((name) => [name, structuredClone(base[name])])
  );
  head.ChainObservation[0].verificationVersion = 1;
  const row = head.ContractRelationship[0];
  row.seed = block(20);
  row.provenance = block(20);
  row.verification.block = block(20);
  return { base, head };
}
const audit = (state) => ({
  protocol: currentStateProtocol,
  stateHash: digest(
    Object.fromEntries(
      Object.entries(state).map(([name, rows]) => [
        name,
        entityDigests(name, rows).exact,
      ])
    )
  ),
  ends: [{ chainId: 1, ...block(20) }],
  events: [],
  manifestHash: digest([]),
  eventCounts: { 1: 0 },
  coverage: [{ chainId: 1, relationships: [`${address}:owner`], keycodes: [] }],
  observations: state.ContractRelationship.map((row) => ({
    key: `${row.chainId}:${row.id}`,
    value: row.value,
    verification: row.verification.block,
    seed: row.seed,
  })),
});

test("current-state profile is explicit and keeps its finite one-process treatment", () => {
  const options = parseOptions(["--current-state", "--oracle-ref", "HEAD"]);
  assert.equal(options.currentState, true);
  assert.equal(options.nativeWorkers, 1);
  assert.equal(options.rpcCredits, 100);
  assert.equal(options.start, 26240000);
  const holdout = parseOptions([
    "--current-state",
    "--native-workers",
    "1",
    "--oracle-ref",
    "HEAD",
  ]);
  assert.equal(holdout.getterHistory, false);
  for (const extra of [
    [],
    ["--native-workers", "2", "--oracle-ref", "HEAD"],
    ["--rpc-credits", "50", "--oracle-ref", "HEAD"],
    ["--queued-admission", "--oracle-ref", "HEAD"],
    ["--getter-history", "--oracle-ref", "HEAD"],
    ["--start", "1", "--oracle-ref", "HEAD"],
  ])
    assert.throws(
      () => parseOptions(["--current-state", ...extra]),
      /invalid_arguments/
    );
});
test("current-state comparison admits only audited observation-boundary changes", () => {
  const { base, head } = fixture();
  const accepted = compareCurrentStates(base, head, audit(base), audit(head));
  assert.deepEqual(accepted.map((row) => row.field).sort(), [
    "provenance",
    "seed",
    "verification",
    "verificationVersion",
  ]);
});
test("unknown proof fields, lost event provenance and current-value changes fail closed", () => {
  for (const change of [
    (x) => {
      x.head.ContractRelationship[0].verification.unrecognizedProof = {
        madeUp: true,
      };
    },
    (x) => {
      x.head.ContractRelationship[0].verification.eventReplay = {
        profile: "invented",
        block: block(20),
      };
    },
    (x) => {
      x.head.ContractRelationship[0].lastChange = {
        ...block(15),
        transactionHash: block(15).hash,
        logIndex: 1,
      };
    },
    (x) => {
      x.head.ContractRelationship[0].value = address;
    },
    (x) => {
      x.head.ChainObservation[0].indexedThrough = block(19);
    },
    (x) => {
      delete x.head.Role;
    },
  ]) {
    const x = fixture();
    change(x);
    assert.throws(() =>
      compareCurrentStates(x.base, x.head, audit(x.base), audit(x.head))
    );
  }
});
test("shared omissions and stale oracle receipts cannot make a comparison pass", () => {
  const { base, head } = fixture(),
    a = audit(base),
    b = audit(head);
  head.ContractRelationship[0].value = address;
  b.stateHash = audit(head).stateHash;
  assert.throws(
    () => compareCurrentStates(base, head, a, b),
    /Expected values/
  );
  const x = fixture();
  x.base.ContractRelationship = [];
  x.head.ContractRelationship = [];
  assert.throws(
    () => compareCurrentStates(x.base, x.head, audit(x.base), audit(x.head)),
    /missing independently expected/
  );
});
test("failed campaign preflight invalidates a prior accepted output without printing private inputs", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-current-failure-")),
    output = join(directory, "result.json");
  try {
    writeFileSync(
      output,
      JSON.stringify({ status: "accepted", throughputGainPercent: 100 })
    );
    const run = spawnSync(
      process.execPath,
      [
        "--",
        "scripts/benchmark-indexer-current.mjs",
        "--baseline",
        "missing-current-benchmark-ref",
        "--env-file",
        join(directory, "private-input-sentinel"),
        "--output",
        output,
      ],
      { encoding: "utf8" }
    );
    assert.notEqual(run.status, 0);
    assert.equal(JSON.parse(readFileSync(output, "utf8")).status, "failed");
    assert.doesNotMatch(run.stdout + run.stderr, /private-input-sentinel/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
