import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handlePeriodicTaskEvent,
  completeHeartTasks,
  heartTaskAnchorsCanonical,
  observeLegacyTaskState,
  handleLegacyTaskEvent,
  getLegacyTaskGetter,
} from "../src/events/heart-tasks.ts";
import { readPinnedControlGetter } from "../src/events/control-reads.ts";
import { controlAnchorsCanonical } from "../src/events/enabler.ts";

const heart = "0x0000000000000000000000000000000000000001";
const a = "0x0000000000000000000000000000000000000002";
const b = "0x0000000000000000000000000000000000000003";
const task = (address, selector = "0x00000000") => ({ address, selector });
const block = (number) => ({
  number: String(number),
  hash: `0xblock${number}`,
  timestamp: String(number + 1700000000),
});
const store = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
  };
};
const context = () => ({
  HeartTasks: store(),
  ContractStateSeed: store(),
  ControlTransition: store(),
});
const event = (number, logIndex, params) => ({
  chainId: 1,
  srcAddress: heart,
  block: { ...block(number), number, timestamp: number + 1700000000 },
  transaction: { hash: "0xtx" },
  logIndex,
  params,
});
const complete = (ctx, number, tasks) =>
  completeHeartTasks(
    ctx,
    1,
    heart,
    block(number),
    tasks === undefined
      ? { status: "unavailable", reason: "timeout" }
      : { status: "success", value: JSON.stringify(tasks) }
  );
const row = (ctx) => ctx.HeartTasks.rows.get(`1:${heart}`);

test("Heart task order survives insertion, removal, duplicate delivery and getter mismatch", async () => {
  const ctx = context();
  await complete(ctx, 10, [task(a)]);
  const insert = event(11, 0, {
    task_: b,
    customSelector_: "0x12345678",
    index_: 0n,
  });
  await handlePeriodicTaskEvent(ctx, insert, "PeriodicTaskAdded");
  await handlePeriodicTaskEvent(ctx, insert, "PeriodicTaskAdded");
  assert.deepEqual(row(ctx).tasks, [task(b, "0x12345678"), task(a)]);
  assert.equal(ctx.ControlTransition.rows.size, 1);
  await complete(ctx, 11, [task(a)]);
  assert.equal(row(ctx).verification.outcome, "mismatch");
  assert.deepEqual(row(ctx).tasks, [task(b, "0x12345678"), task(a)]);
  await handlePeriodicTaskEvent(
    ctx,
    event(12, 0, { task_: b, index_: 0n }),
    "PeriodicTaskRemoved"
  );
  await complete(ctx, 12, [task(a)]);
  assert.deepEqual(row(ctx).tasks, [task(a)]);
  assert.equal(row(ctx).verification.outcome, "match");
  await complete(ctx, 13);
  assert.deepEqual(row(ctx).tasks, [task(a)]);
  assert.equal(row(ctx).verification.outcome, "unavailable");
  await assert.rejects(
    () =>
      handlePeriodicTaskEvent(
        ctx,
        event(9, 0, { task_: b, customSelector_: "0x00000000", index_: 0n }),
        "PeriodicTaskAdded"
      ),
    /seed boundary/
  );
});

test("A partial replay stays unknown until a successful completed-block seed; an empty list is known", async () => {
  const ctx = context();
  await handlePeriodicTaskEvent(
    ctx,
    event(10, 0, { task_: a, customSelector_: "0x00000000", index_: 0n }),
    "PeriodicTaskAdded"
  );
  assert.equal(row(ctx).tasks, null);
  await complete(ctx, 10);
  assert.equal(row(ctx).tasks, null);
  await complete(ctx, 11, [task(a)]);
  assert.deepEqual(row(ctx).tasks, [task(a)]);
  await handlePeriodicTaskEvent(
    ctx,
    event(12, 0, { task_: a, index_: 0n }),
    "PeriodicTaskRemoved"
  );
  await complete(ctx, 12, []);
  assert.deepEqual(row(ctx).tasks, []);
  assert.equal(row(ctx).verification.outcome, "match");
});

test("Periodic task tuple reads preserve custom selectors, reject malformed arrays and changing canonical hashes", async () => {
  let changed = false;
  let changeDuringRead = false;
  let value = [
    [a, b],
    ["0x00000000", "0x12345678"],
  ];
  const client = {
    getBlock: async () => ({ hash: changed ? "0xother" : "0xhash" }),
    readContract: async (input) => {
      assert.equal(input.blockHash, "0xhash");
      assert.equal(input.requireCanonical, true);
      assert.equal(input.functionName, "getPeriodicTasks");
      if (changeDuringRead) changed = true;
      return value;
    },
  };
  const input = {
    chainId: 1,
    address: heart,
    blockNumber: 10n,
    blockHash: "0xhash",
    getter: "getPeriodicTasks",
  };
  assert.deepEqual(
    JSON.parse((await readPinnedControlGetter(client, input)).value),
    [task(a), task(b, "0x12345678")]
  );
  value = [[a], []];
  assert.equal(
    (await readPinnedControlGetter(client, input)).status,
    "unavailable"
  );
  value = [[a], ["0x00000000"]];
  changed = true;
  assert.match(
    (await readPinnedControlGetter(client, input)).reason,
    /before getter read/
  );
  changed = false;
  changeDuringRead = true;
  assert.match(
    (await readPinnedControlGetter(client, input)).reason,
    /during getter read/
  );
});

test("Legacy task events retain evidence while getter-only states can recover without invented events", async () => {
  const ctx = { ...context(), ContractState: store() };
  await handleLegacyTaskEvent(ctx, event(10, 0, {}), false);
  await observeLegacyTaskState(ctx, 1, heart, block(10), "isShutdown", {
    status: "success",
    value: "true",
  });
  assert.equal(ctx.ContractState.rows.get(`1:${heart}`).enabled, false);
  await observeLegacyTaskState(ctx, 1, heart, block(11), "isShutdown", {
    status: "success",
    value: "false",
  });
  const recovered = ctx.ContractState.rows.get(`1:${heart}`);
  assert.equal(recovered.enabled, true);
  assert.equal(recovered.enablerCapability, "unsupported");
  assert.equal(recovered.lastChange.number, "10");
  assert.equal(ctx.ControlTransition.rows.size, 1);
  await observeLegacyTaskState(ctx, 1, heart, block(12), "active", {
    status: "success",
    value: "false",
  });
  assert.equal(ctx.ContractState.rows.get(`1:${heart}`).enabled, false);
  await handleLegacyTaskEvent(ctx, event(13, 0, {}), true);
  await observeLegacyTaskState(ctx, 1, heart, block(13), "locallyActive", {
    status: "success",
    value: "false",
  });
  assert.equal(ctx.ContractState.rows.get(`1:${heart}`).enabled, true);
  assert.equal(
    ctx.ContractState.rows.get(`1:${heart}`).verification.outcome,
    "mismatch"
  );
  assert.equal(
    getLegacyTaskGetter(11155111, "0xf8abe1d9502bbcad4576433490d851d03c22a6b4"),
    undefined
  );
});

test("An orphaned task anchor prevents checkpoint advancement and entity restoration removes the orphan", async () => {
  const ctx = context();
  await complete(ctx, 10, [task(a)]);
  const checkpoint = structuredClone(ctx.HeartTasks.rows);
  await handlePeriodicTaskEvent(
    ctx,
    event(11, 0, { task_: b, customSelector_: "0x00000000", index_: 0n }),
    "PeriodicTaskAdded"
  );
  assert.equal(
    await heartTaskAnchorsCanonical(ctx, 1, block(12), [heart], async () => ({
      ...block(11),
      hash: "0xreplacement",
    })),
    false
  );
  assert.equal(row(ctx).indexedThrough.number, "10");
  assert.equal(row(ctx).verification.outcome, "unavailable");
  ctx.HeartTasks.rows.clear();
  for (const [id, state] of checkpoint) ctx.HeartTasks.rows.set(id, state);
  ctx.ControlTransition.rows.clear();
  assert.equal(
    await heartTaskAnchorsCanonical(
      ctx,
      1,
      block(12),
      [heart],
      async (number) => block(Number(number))
    ),
    true
  );
  await complete(ctx, 12, [task(a)]);
  assert.deepEqual(row(ctx).tasks, [task(a)]);
  assert.equal(ctx.ControlTransition.rows.size, 0);
});

test("An earlier canonical event cannot validate a later orphaned Heart seed", async () => {
  const ctx = context();
  await handlePeriodicTaskEvent(
    ctx,
    event(10, 0, { task_: a, index_: 0n, customSelector_: "0x00000000" }),
    "PeriodicTaskAdded"
  );
  await complete(ctx, 11, [task(a)]);
  const canonical = async (number) => ({
    ...block(Number(number)),
    hash: Number(number) === 11 ? "0xreplacement" : block(Number(number)).hash,
  });
  assert.equal(
    await heartTaskAnchorsCanonical(ctx, 1, block(12), [heart], canonical),
    false
  );
  assert.equal(row(ctx).indexedThrough.number, "11");
});

test("Failed getter-only reads retain their successful origin and reject its orphaned block", async () => {
  const ctx = { ...context(), ContractState: store() };
  await observeLegacyTaskState(ctx, 1, heart, block(10), "active", {
    status: "success",
    value: "true",
  });
  await observeLegacyTaskState(ctx, 1, heart, block(11), "active", {
    status: "success",
    value: "false",
  });
  await observeLegacyTaskState(ctx, 1, heart, block(12), "active", {
    status: "unavailable",
    reason: "timeout",
  });
  const state = ctx.ContractState.rows.get(`1:${heart}`);
  assert.equal(state.enabled, false);
  assert.equal(state.indexedThrough.number, "11");
  assert.equal(state.verification.block.number, "12");
  const canonical = async (number) => ({
    ...block(Number(number)),
    hash: Number(number) === 11 ? "0xreplacement" : block(Number(number)).hash,
  });
  assert.equal(
    await controlAnchorsCanonical(ctx, 1, block(13), [heart], canonical),
    false
  );
  assert.equal(
    ctx.ContractState.rows.get(`1:${heart}`).indexedThrough.number,
    "11"
  );
});
