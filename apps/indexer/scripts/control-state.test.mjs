import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, custom, fallback } from "viem";
import {
  applyControlTransition,
  completeControlBlock,
  seedControlState,
  verifyControlState,
} from "../src/events/control-state.ts";
import { readPinnedControlGetter } from "../src/events/control-reads.ts";

const address = "0x0000000000000000000000000000000000000001";
const block = (number, hash = `0x${number}`) => ({
  number: String(number),
  hash,
  timestamp: String(1700000000 + number),
});
const event = (number, hash = `0x${number}`) => ({
  chainId: 1,
  srcAddress: address,
  block: { number, hash, timestamp: 1700000000 + number },
  transaction: { hash: "0xtx" },
  logIndex: 2,
});
const makeStore = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
  };
};
const makeContext = () => ({
  ContractState: makeStore(),
  ContractStateSeed: makeStore(),
  ControlTransition: makeStore(),
  ContractRelationship: makeStore(),
  ChainObservation: makeStore(),
});

test("completed-block seed boundary, duplicate delivery, verification, and entity rollback", async () => {
  const context = makeContext();
  await seedControlState(context, 1, address, block(10), {
    status: "success",
    value: "false",
  });
  await assert.rejects(
    () => applyControlTransition(context, event(10), "enabled", true),
    /seed boundary/
  );
  const checkpoint = structuredClone(
    Object.fromEntries(
      Object.entries(context).map(([key, store]) => [key, [...store.rows]])
    )
  );
  await applyControlTransition(context, event(11), "enabled", true);
  await applyControlTransition(context, event(11), "enabled", true);
  await assert.rejects(
    () =>
      applyControlTransition(
        context,
        { ...event(11), logIndex: 1 },
        "enabled",
        false
      ),
    /canonical log order/
  );
  assert.equal(context.ControlTransition.rows.size, 1);
  assert.deepEqual([...context.ControlTransition.rows.values()][0].value, {
    enabled: true,
  });
  assert.deepEqual(
    [...context.ControlTransition.rows.values()][0].previousValue,
    { enabled: false }
  );
  assert.equal((await context.ContractState.get(`1:${address}`)).enabled, true);
  await completeControlBlock(context, 1, block(11), [address]);
  await verifyControlState(context, 1, address, block(11), {
    status: "success",
    value: "false",
  });
  let state = await context.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, true);
  assert.equal(state.verification.outcome, "mismatch");
  assert.equal(state.verification.getterValue, "false");
  await completeControlBlock(context, 1, block(12), [address]);
  await verifyControlState(context, 1, address, block(12), {
    status: "unavailable",
    reason: "historical read unavailable",
  });
  await seedControlState(context, 1, address, block(12), {
    status: "unavailable",
    reason: "historical read unavailable",
  });
  state = await context.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, true);
  assert.equal(state.verification.outcome, "unavailable");
  // Model Envio restoring its entity stores. This is a helper-level test, not runtime rollback proof.
  const restored = makeContext();
  for (const [key, entries] of Object.entries(checkpoint))
    for (const [, row] of entries) restored[key].set(row);
  assert.equal(
    (await restored.ContractState.get(`1:${address}`)).enabled,
    false
  );
  assert.equal(restored.ControlTransition.rows.size, 0);
  await applyControlTransition(
    restored,
    event(11, "0xreplacement"),
    "enabled",
    true
  );
  assert.equal(
    [...restored.ControlTransition.rows.values()][0].blockHash,
    "0xreplacement"
  );
});

test("hash-pinned getter rejects changed canonical blocks and never reads latest", async () => {
  const hashes = ["0xa", "0xa", "0xb", "0xb"];
  const calls = [];
  const values = [false, true];
  const client = {
    getBlock: async (input) => {
      calls.push(input);
      return { hash: hashes.shift() };
    },
    readContract: async (input) => {
      calls.push(input);
      assert.equal(input.requireCanonical, true);
      assert(input.blockHash === "0xa" || input.blockHash === "0xb");
      assert.equal(input.blockNumber, undefined);
      return values.shift();
    },
  };
  assert.deepEqual(
    await readPinnedControlGetter(client, {
      chainId: 1,
      address,
      blockNumber: 10n,
      blockHash: "0xa",
      getter: "isEnabled",
    }),
    { status: "success", value: "false" }
  );
  assert.deepEqual(
    await readPinnedControlGetter(client, {
      chainId: 1,
      address,
      blockNumber: 10n,
      blockHash: "0xb",
      getter: "isEnabled",
    }),
    { status: "success", value: "true" }
  );
  assert(
    calls.every((call) =>
      call.functionName
        ? call.requireCanonical === true
        : call.blockNumber === 10n
    )
  );
  let changedReads = 0;
  const changed = {
    getBlock: async () => ({ hash: "0xorphan" }),
    readContract: async () => {
      changedReads += 1;
      return false;
    },
  };
  assert.equal(
    (
      await readPinnedControlGetter(changed, {
        chainId: 1,
        address,
        blockNumber: 10n,
        blockHash: "0xb",
        getter: "isEnabled",
      })
    ).status,
    "unavailable"
  );
  assert.equal(changedReads, 0);
});

test("a fallback provider cannot read another fork under the requested block hash", async () => {
  const hash = `0x${"a".repeat(64)}`;
  const alternateCalls = [];
  const primary = custom({
    request: async ({ method }) => {
      if (method === "eth_getBlockByNumber")
        return { hash, number: "0xa", timestamp: "0x6553f100" };
      throw new Error("primary historical call unavailable");
    },
  });
  const alternate = custom({
    request: async ({ method, params }) => {
      assert.equal(method, "eth_call");
      alternateCalls.push(params[1]);
      if (typeof params[1] === "object")
        throw new Error("requested hash is not canonical on this provider");
      return `0x${"1".padStart(64, "0")}`;
    },
  });
  const client = createPublicClient({
    transport: fallback([primary, alternate], { retryCount: 0 }),
  });
  const result = await readPinnedControlGetter(client, {
    chainId: 1,
    address,
    blockNumber: 10n,
    blockHash: hash,
    getter: "isEnabled",
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(alternateCalls, [
    { blockHash: hash, requireCanonical: true },
  ]);
});

test("an unavailable seed stays unknown and a changing hash rejects the read result", async () => {
  const context = makeContext();
  await seedControlState(context, 1, address, block(10), {
    status: "unavailable",
    reason: "historical getter read unavailable",
  });
  const state = await context.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, null);
  assert.equal(state.enablerCapability, "unknown");
  assert.equal(state.verification.outcome, "unavailable");
  assert.equal(context.ContractStateSeed.rows.size, 0);
  const hashes = ["0xa", "0xb"];
  const client = {
    getBlock: async () => ({ hash: hashes.shift() }),
    readContract: async () => true,
  };
  const result = await readPinnedControlGetter(client, {
    chainId: 1,
    address,
    blockNumber: 10n,
    blockHash: "0xa",
    getter: "isEnabled",
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.reason, /during getter read/);
});
