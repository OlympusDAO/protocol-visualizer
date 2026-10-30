import assert from "node:assert/strict";
import { test } from "node:test";
import { readPinnedBridgeConfiguration } from "../src/events/bridge-reads.ts";
import {
  handleBridgeConfigurationEvent,
  completeBridgeConfigurations,
  bridgeAnchorsCanonical,
} from "../src/events/bridge-config.ts";

const address = `0x${"1".repeat(40)}`,
  router = `0x${"2".repeat(40)}`,
  token = `0x${"3".repeat(40)}`;
const block = (number) => ({
  number: String(number),
  timestamp: "1700000000",
  hash: `0x${String(number).padStart(64, "0")}`,
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
  BridgeConfiguration: store(),
  ControlTransition: store(),
});
const contract = { address, kind: "pool", startBlock: 1 };
const config = {
  token,
  router,
  codeHash: `0x${"a".repeat(64)}`,
  routes: [],
  allowList: null,
};

test("SVM trusted remotes retain bytes32 identifiers and use the SVM getter", async () => {
  const calls = [];
  const selector = "124615329519749607",
    remote = `0x${"ab".repeat(32)}`;
  const result = await readPinnedBridgeConfiguration(
    {
      getBlock: async () => ({ hash: block(10).hash }),
      getCode: async () => "0x6000",
      readContract: async (input) => {
        calls.push(input.functionName);
        return {
          getRouter: router,
          OHM: token,
          isChainSupported: true,
          getTrustedRemoteSVM: { remoteAddress: remote, isSet: true },
        }[input.functionName];
      },
    },
    {
      address,
      kind: "bridge",
      blockNumber: 10n,
      blockHash: block(10).hash,
      selectors: [selector],
    }
  );
  assert.equal(result.status, "success");
  assert.equal(JSON.parse(result.value).routes[0].trustedRemote, remote);
  assert.ok(calls.includes("getTrustedRemoteSVM"));
  assert.ok(!calls.includes("getTrustedRemoteEVM"));
});

test("pool configuration reads preserve opaque remote identifiers, unlimited limits, and canonical hash binding", async () => {
  const calls = [];
  const rpc = {
    getBlock: async () => ({ hash: block(10).hash }),
    getCode: async () => "0x6000",
    readContract: async (input) => {
      calls.push(input);
      return {
        getRouter: router,
        getToken: token,
        getSupportedChains: [123n],
        getAllowListEnabled: false,
        isChainSupported: true,
        getRemoteToken: "0x1234",
        getRemotePools: ["0x5678"],
        getCurrentOutboundRateLimiterState: {
          tokens: 0n,
          lastUpdated: 1,
          isEnabled: false,
          capacity: 0n,
          rate: 0n,
        },
        getCurrentInboundRateLimiterState: [0n, 1, true, 100n, 2n],
      }[input.functionName];
    },
  };
  const input = {
    address,
    kind: "pool",
    blockNumber: 10n,
    blockHash: block(10).hash,
    selectors: [],
  };
  const result = await readPinnedBridgeConfiguration(rpc, input);
  assert.equal(result.status, "success");
  const actual = JSON.parse(result.value);
  assert.equal(actual.allowList, null);
  assert.equal(actual.routes[0].remoteToken, "0x1234");
  assert.deepEqual(actual.routes[0].outbound, {
    isEnabled: false,
    capacity: "0",
    rate: "0",
  });
  assert.equal(actual.routes[0].inbound.rate, "2");
  assert.ok(
    calls.every(
      (call) => call.blockHash === input.blockHash && call.requireCanonical
    )
  );
  let headers = 0;
  const unavailable = await readPinnedBridgeConfiguration(
    {
      ...rpc,
      getBlock: async () => ({ hash: block(++headers === 1 ? 10 : 11).hash }),
    },
    input
  );
  assert.equal(unavailable.status, "unavailable");
});

test("configuration events invalidate observations, deduplicate, preserve state on read failures, and recover after rollback", async () => {
  const ctx = context();
  const read = async () => ({
    status: "success",
    value: JSON.stringify(config),
  });
  await completeBridgeConfigurations(ctx, 1, block(10), [contract], read);
  const id = `1:${address}`,
    initial = structuredClone(ctx.BridgeConfiguration.rows);
  const event = {
    chainId: 1,
    srcAddress: address,
    block: { number: 11, hash: block(11).hash, timestamp: 1700000000 },
    transaction: { hash: "0xtransaction" },
    logIndex: 0,
    params: { remoteChainSelector: 123n },
  };
  await handleBridgeConfigurationEvent(ctx, event, "pool");
  await handleBridgeConfigurationEvent(ctx, event, "pool");
  assert.equal(ctx.ControlTransition.rows.size, 1);
  assert.deepEqual(ctx.BridgeConfiguration.rows.get(id).selectors, ["123"]);
  assert.equal(
    ctx.BridgeConfiguration.rows.get(id).verification.outcome,
    "unperformed"
  );
  await completeBridgeConfigurations(
    ctx,
    1,
    block(12),
    [contract],
    async () => ({ status: "unavailable", reason: "timeout" })
  );
  assert.deepEqual(ctx.BridgeConfiguration.rows.get(id).configuration, config);
  assert.equal(ctx.BridgeConfiguration.rows.get(id).observedAt.number, "10");
  assert.equal(
    await bridgeAnchorsCanonical(
      ctx,
      1,
      block(12),
      [contract],
      async (number) => ({ ...block(number), hash: "0xorphan" })
    ),
    false
  );
  const restored = context();
  for (const row of initial.values()) restored.BridgeConfiguration.set(row);
  assert.equal(
    await bridgeAnchorsCanonical(
      restored,
      1,
      block(12),
      [contract],
      async (number) => block(number)
    ),
    true
  );
  await completeBridgeConfigurations(restored, 1, block(12), [contract], read);
  assert.equal(
    restored.BridgeConfiguration.rows.get(id).observedAt.number,
    "12"
  );
});
