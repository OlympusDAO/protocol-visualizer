import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import http from "node:http";
import {
  compareCurrentStates,
  executorSeedBlock,
  scheduledBlockCount,
  isEvmRevert,
} from "../scripts/benchmark-indexer-current.mjs";
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
test("native processed counts include scheduled callbacks as well as unique logs", () => {
  const chain = { start_block: 26240000, end_block: 26290000 };
  const baseline = [
    { interval: 100 },
    { interval: 10000 },
    { startBlock: chain.start_block, endBlock: chain.start_block, interval: 1 },
    { startBlock: chain.end_block, endBlock: chain.end_block, interval: 1 },
  ];
  assert.equal(scheduledBlockCount(baseline, chain), 509);
  assert.equal(scheduledBlockCount(baseline.slice(2), chain), 2);
  assert.throws(() => scheduledBlockCount([{ interval: 0 }], chain));
});
test("pre-window executor exemption requires the exact creation seed and no observed change", () => {
  const constants = {
    address,
    creationBlockNumber: 10,
    creationTimestamp: 110,
  };
  const row = {
    kernel: address,
    lastUpdatedBlockNumber: "10",
    lastUpdatedTimestamp: "110",
  };
  assert.equal(executorSeedBlock(row, constants, 15, []), "10");
  assert.equal(executorSeedBlock(row, constants, 10, []), null);
  for (const changed of [
    { ...row, lastUpdatedBlockNumber: "9" },
    { ...row, lastUpdatedTimestamp: "111" },
    { ...row, kernel: value },
  ])
    assert.throws(() => executorSeedBlock(changed, constants, 15, []));
  assert.throws(() =>
    executorSeedBlock(row, constants, 15, [
      { address, event: "ActionExecuted", args: { action_: 4 } },
    ])
  );
});
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
  initializationSeeds: [],
  coverage: [
    {
      chainId: 1,
      relationships: [
        `${address}:${state.ContractRelationship[0]?.getter ?? "owner"}`,
      ],
      keycodes: [],
    },
  ],
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
test("getterless metadata changes require unknown state or the matching latest ownership event", () => {
  const { base, head } = fixture();
  for (const state of [base, head])
    Object.assign(state.ContractRelationship[0], {
      getter: "newOwner",
      value: null,
      seed: null,
      lastChange: null,
      verification: { outcome: "unavailable", block: block(20) },
    });
  const receipts = () => {
    const pair = [audit(base), audit(head)];
    for (const receipt of pair) receipt.observations[0].getterless = true;
    return pair;
  };
  assert.doesNotThrow(() => compareCurrentStates(base, head, ...receipts()));
  head.ContractRelationship[0].seed = block(20);
  assert.throws(() => compareCurrentStates(base, head, ...receipts()));
  head.ContractRelationship[0].seed = null;
  const change = { ...block(15), transactionHash: block(15).hash, logIndex: 1 };
  for (const state of [base, head])
    Object.assign(state.ContractRelationship[0], {
      value,
      lastChange: change,
      provenance: change,
    });
  base.ContractRelationship[0].coverage =
    "Pending owner is event-only: no public getter; earlier nominations are unknown until a transfer request or acceptance is replayed.";
  head.ContractRelationship[0].coverage = null;
  const pair = receipts();
  const event = {
    chainId: 1,
    address,
    contract: "ChainlinkOwned",
    event: "OwnershipTransferRequested",
    blockNumber: "15",
    blockHash: change.hash,
    transactionHash: change.transactionHash,
    logIndex: 1,
    args: { to: value },
  };
  for (const receipt of pair) {
    receipt.events = [event];
    receipt.manifestHash = digest(receipt.events);
  }
  assert.doesNotThrow(() => compareCurrentStates(base, head, ...pair));
  for (const receipt of pair) {
    receipt.events = [];
    receipt.manifestHash = digest([]);
  }
  assert.throws(() => compareCurrentStates(base, head, ...pair));
});
test("a missing first registry nominee requires the exact independently audited prior seed", () => {
  const { base, head } = fixture(),
    token = value;
  const getter = `newAdministrator:${token}`;
  for (const state of [base, head])
    state.ContractRelationship[0].getter = getter;
  base.ContractStateSeed = [
    {
      chainId: 1,
      id: "seed",
      address,
      getter,
      boundary: block(10),
      value: address,
    },
  ];
  const transition = {
    id: "transition",
    chainId: 1,
    address,
    kind: `relationship:${getter}`,
    blockNumber: "15",
    blockHash: block(15).hash,
    transactionHash: block(15).hash,
    logIndex: 1,
    previousValue: { address },
    value: { address: value },
  };
  base.ControlTransition = [transition];
  head.ControlTransition = [
    { ...transition, previousValue: { address: null } },
  ];
  const receipts = () => {
    const pair = [audit(base), audit(head)];
    for (const receipt of pair) {
      receipt.events = [
        {
          chainId: 1,
          address,
          contract: "TokenAdminRegistry",
          event: "AdministratorTransferRequested",
          blockNumber: "15",
          blockHash: block(15).hash,
          transactionHash: block(15).hash,
          logIndex: 1,
          args: { token, newAdmin: value },
        },
      ];
      receipt.manifestHash = digest(receipt.events);
    }
    return pair;
  };
  assert.doesNotThrow(() => compareCurrentStates(base, head, ...receipts()));
  base.ContractStateSeed[0].value = value;
  assert.throws(() => compareCurrentStates(base, head, ...receipts()));
  base.ContractStateSeed = [];
  assert.throws(() => compareCurrentStates(base, head, ...receipts()));
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

test("auditor recognizes real viem ESM reverts and rejects ordinary RPC errors", async () => {
  let code = 3;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const request = JSON.parse(body);
    const reply = (rpc) => ({
      jsonrpc: "2.0",
      id: rpc.id,
      error: {
        code,
        message: code === 3 ? "execution reverted" : "method unavailable",
      },
    });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(request) ? request.map(reply) : reply(request)
      )
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const chain = 999971,
    key = `ENVIO_RPC_URL_${chain}`,
    previous = process.env[key];
  process.env[key] = `http://127.0.0.1:${server.address().port}`;
  try {
    const { getPublicClient } = await import(
      "../apps/indexer/src/events/rpc.ts"
    );
    const client = getPublicClient(chain);
    const abi = [
      {
        type: "function",
        name: "newOwner",
        inputs: [],
        outputs: [{ type: "address" }],
        stateMutability: "view",
      },
    ];
    await assert.rejects(
      client.readContract({ address, abi, functionName: "newOwner" }),
      isEvmRevert
    );
    code = -32601;
    await assert.rejects(
      client.readContract({ address, abi, functionName: "newOwner" }),
      (error) => !isEvmRevert(error)
    );
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await new Promise((done) => server.close(done));
  }
});
