import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  handleEnablementEvent,
  completeEnablementBlock,
} from "../src/events/enabler.ts";
import {
  getEnablerCapability,
  getEnablerContracts,
} from "../src/events/enabler-contracts.ts";

const address = "0x0000000000000000000000000000000000000001";
const makeStore = () => {
  const rows = new Map();
  return {
    rows,
    get: async (id) => rows.get(id),
    set: (row) => rows.set(row.id, structuredClone(row)),
  };
};
const makeContext = () =>
  Object.fromEntries(
    [
      "ContractState",
      "ContractStateSeed",
      "ControlTransition",
      "ChainObservation",
    ].map((key) => [key, makeStore()])
  );
const event = (logIndex, params = {}) => ({
  chainId: 1,
  srcAddress: address,
  block: { number: 10, hash: "0xcanonical", timestamp: 1700000010 },
  transaction: { hash: "0xtx" },
  logIndex,
  params,
});

test("verified capabilities include non-ERC165 periphery, distinguish unsupported, and retain creation anchors", () => {
  assert.equal(
    getEnablerCapability(1, "0x6593768febf9c95ac857fb7ef244d5738d1c57fd"),
    "supported"
  );
  assert.equal(
    getEnablerCapability(1, "0x2286d7f9639e8158fad1169e76d1fbc38247f54b"),
    "unsupported"
  );
  assert.equal(getEnablerCapability(1, address), "unknown");
  const chains = [1, 10, 4663, 8453, 42161, 80094, 84532, 421614, 11155111];
  const known = chains.flatMap(getEnablerContracts);
  assert.equal(known.length, 70);
  assert(known.every((contract) => contract.startBlock > 0));
  assert.equal(
    getEnablerContracts(1).find(
      (contract) =>
        contract.address === "0x2cea7b722dbd6b03f0e857d11e53ecb698cc2b4e"
    ).dialect,
    "v2"
  );
  const config = readFileSync(
    new URL("../config.yaml", import.meta.url),
    "utf8"
  );
  const chainConfigs = config.split(/(?=\n {2}- id: )/);
  for (const chainId of chains) {
    const configured = chainConfigs.find((part) =>
      part.startsWith(`\n  - id: ${chainId}\n`)
    );
    assert(configured);
    const subscriptions = new Map();
    for (const match of configured.matchAll(
      / {6}- name: (IEnabler(?:V2)?)\n {8}address:\n((?: {10}- "[^"]+"\n)+) {8}start_block: (\d+)/g
    )) {
      for (const address of match[2].matchAll(/"([^"]+)"/g))
        subscriptions.set(address[1], {
          dialect: match[1] === "IEnablerV2" ? "v2" : "v1",
          startBlock: Number(match[3]),
        });
    }
    const contracts = getEnablerContracts(chainId);
    assert.equal(subscriptions.size, contracts.length);
    for (const contract of contracts) {
      assert.equal(
        subscriptions.get(contract.address)?.dialect,
        contract.dialect
      );
      assert(
        subscriptions.get(contract.address)?.startBlock <= contract.startBlock
      );
    }
  }
});

test("legacy and V2 logs assign values once, retain metadata, and allow multiple transitions per transaction", async () => {
  const context = makeContext();
  await handleEnablementEvent(context, event(0), "Enabled", "v1");
  await handleEnablementEvent(context, event(1), "Enabled", "v1");
  assert.equal((await context.ContractState.get(`1:${address}`)).enabled, true);
  await handleEnablementEvent(context, event(2), "Disabled", "v1");
  assert.equal(
    (await context.ContractState.get(`1:${address}`)).enabled,
    false
  );
  assert.equal(context.ControlTransition.rows.size, 3);
  const v2 = makeContext();
  await handleEnablementEvent(v2, event(0), "Enabled", "v2");
  await handleEnablementEvent(
    v2,
    event(1, { by: address, enable: true, data: "0x12", at: 1700000010n }),
    "Transition",
    "v2"
  );
  await handleEnablementEvent(v2, event(2), "Disabled", "v2");
  const disabled = event(3, {
    by: address,
    enable: false,
    data: "0x34",
    at: 1700000010n,
  });
  await handleEnablementEvent(v2, disabled, "Transition", "v2");
  await handleEnablementEvent(v2, disabled, "Transition", "v2");
  assert.equal(v2.ControlTransition.rows.size, 2);
  const state = await v2.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, false);
  assert.equal(state.lastChange.caller, address);
  assert.equal(state.lastChange.data, "0x34");
  assert.equal(state.lastChange.lastTransitionAt, "1700000010");
});

test("completed block seeds no-event contracts, keeps constructor logs, and preserves established state on failed verification", async () => {
  const context = makeContext();
  const block = { number: "10", hash: "0xcanonical", timestamp: "1700000010" };
  const contract = { address, startBlock: 10, dialect: "v1" };
  const canonicalBlock = async (number) => ({ ...block, number });
  await completeEnablementBlock(
    context,
    1,
    block,
    [contract],
    async () => ({
      status: "success",
      value: "false",
    }),
    canonicalBlock
  );
  let state = await context.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, false);
  assert.equal(state.verification.outcome, "match");
  assert.deepEqual(state.seed, block);
  const fromEvent = makeContext();
  await handleEnablementEvent(fromEvent, event(0), "Enabled", "v1");
  await completeEnablementBlock(
    fromEvent,
    1,
    block,
    [contract],
    async () => ({
      status: "success",
      value: "false",
    }),
    canonicalBlock
  );
  state = await fromEvent.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, true);
  assert.equal(state.seed, null);
  assert.equal(state.verification.outcome, "mismatch");
  await completeEnablementBlock(
    fromEvent,
    1,
    { ...block, number: "11", hash: "0xnext" },
    [contract],
    async () => ({ status: "unavailable", reason: "unavailable" }),
    canonicalBlock
  );
  state = await fromEvent.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, true);
  assert.equal(state.verification.outcome, "unavailable");
  const unknown = makeContext();
  await completeEnablementBlock(
    unknown,
    1,
    block,
    [contract],
    async () => ({
      status: "unavailable",
      reason: "unavailable",
    }),
    canonicalBlock
  );
  state = await unknown.ContractState.get(`1:${address}`);
  assert.equal(state.enabled, null);
  assert.equal(state.enablerCapability, "supported");
});

test("checkpoint cannot verify or advance coverage across an indexed-state fork", async () => {
  for (const number of [10, 11]) {
    const context = makeContext();
    await handleEnablementEvent(context, event(0), "Disabled", "v1");
    const block = {
      number: String(number),
      hash: "0xother-fork",
      timestamp: "1700000011",
    };
    let reads = 0;
    await completeEnablementBlock(
      context,
      1,
      block,
      [{ address, startBlock: 10, dialect: "v1" }],
      async () => {
        reads++;
        return { status: "success", value: "false" };
      },
      async (number) => ({ ...block, number })
    );
    const state = await context.ContractState.get(`1:${address}`);
    assert.equal(state.enabled, false);
    assert.equal(state.lastChange.hash, "0xcanonical");
    assert.equal(state.indexedThrough, null);
    assert.equal(state.verification.outcome, "unavailable");
    assert.equal(context.ChainObservation.rows.size, 0);
    assert.equal(reads, 0);
  }
});

test("a new contract boundary checks existing chain anchors before seeding or advancing observation", async () => {
  const context = makeContext();
  await handleEnablementEvent(context, event(0), "Disabled", "v1");
  const added = "0x0000000000000000000000000000000000000002";
  const block = { number: "11", hash: "0xother-fork", timestamp: "1700000011" };
  await completeEnablementBlock(
    context,
    1,
    block,
    [
      { address, startBlock: 10, dialect: "v1" },
      { address: added, startBlock: 11, dialect: "v1" },
    ],
    async () => ({ status: "success", value: "false" }),
    async (number) => ({ ...block, number })
  );
  assert.equal(await context.ContractState.get(`1:${added}`), undefined);
  assert.equal(context.ContractStateSeed.rows.size, 0);
  assert.equal(context.ChainObservation.rows.size, 0);
  assert.equal(
    (await context.ContractState.get(`1:${address}`)).verification.outcome,
    "unavailable"
  );
});
