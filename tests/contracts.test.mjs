import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
import { createSnapshotBatch } from "../apps/snapshot-publisher/dist/src/snapshot.js";
import { createSnapshotGateway } from "../apps/snapshot-gateway/dist/src/server.js";

const { decodeProtocolSnapshot, getAdditionalGraphContracts } = await import(
  "../apps/frontend/src/services/contracts.ts"
);

const chain = {
  key: "Robinhood",
  chainId: 4663,
  name: "Robinhood",
  explorerBaseUrl: "https://explorer.robinhood.com",
};
const address = "0x00000000000000000000000000000000000000aa";
const block = { number: "123", hash: "0xcanonical", timestamp: "1700000000" };

test("legacy data defaults to unknown control state and no additional nodes", () => {
  const data = decodeProtocolSnapshot({
    schemaVersion: "1.0.0",
    data: { contracts: [], roles: [], roleAssignments: [] },
  });
  assert.deepEqual(getAdditionalGraphContracts(data), []);
  assert.deepEqual(data.contractStates, []);
  assert.equal(data.observation, null);
  assert.throws(
    () => decodeProtocolSnapshot({ schemaVersion: "2.0.0", data }),
    /Unsupported snapshot schema version: 2.0.0/
  );
});

test("additional-only state roundtrips publisher, gateway, and frontend without invented core membership", async () => {
  const state = {
    id: `4663:${address}`,
    chainId: 4663,
    address,
    enablerCapability: "supported",
    enabled: false,
    seed: block,
    lastChange: null,
    indexedThrough: block,
    verification: { outcome: "mismatch", getterValue: "true", block },
  };
  const relationship = {
    id: "owner-link",
    chainId: 4663,
    kind: "owner",
    source: "0x00000000000000000000000000000000000000bb",
    target: address,
    status: "current",
    provenance: block,
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "reader-roundtrip",
    additionalContracts: [{ chainId: 4663, address, name: "External pool" }],
    loadProtocolData: () => ({
      ContractState: [state],
      ContractRelationship: [relationship],
      ChainObservation: [{ chainId: 4663, indexedThrough: block }],
    }),
  });
  assert.equal(batch.ready, true);
  assert.equal(batch.files.at(-1).publishLast, true);
  const objects = new Map(batch.files.map((file) => [file.key, file.body]));
  const reader = {
    getObject: async (key) => ({ body: objects.get(key) }),
    headObject: async (key) => {
      assert(objects.has(key));
    },
  };
  const server = createServer(
    createSnapshotGateway({ reader, chains: [chain], openapiPath: "unused" })
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/chains/4663/protocol`
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.schemaVersion, "1.1.0");
    const data = decodeProtocolSnapshot(payload);
    assert.deepEqual(data.contracts, []);
    assert.equal(getAdditionalGraphContracts(data)[0].name, "External pool");
    assert.equal(data.contractStates[0].kernelMembership, "unknown");
    assert.equal(data.contractStates[0].enabled, false);
    assert.deepEqual(data.contractStates[0].verification, state.verification);
    assert.deepEqual(data.relationships, [relationship]);
    assert.deepEqual(data.observation.indexedThrough, block);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("graph inventory normalizes addresses and omits duplicates of active core", () => {
  const core = { chainId: 4663, address: address.toUpperCase() };
  const data = {
    contracts: [core],
    additionalContracts: [
      { ...core, name: "Duplicate" },
      { chainId: 4663, address: "0xBB", name: "External" },
      { chainId: 4663, address: "0xbb", name: "External" },
    ],
  };
  assert.equal(getAdditionalGraphContracts(data).length, 1);
  assert.equal(getAdditionalGraphContracts(data)[0].id, "4663:0xbb");
});

test("unavailable getter verification keeps established state in a manifest-last batch", async () => {
  const state = {
    id: `4663:${address}`,
    chainId: 4663,
    address,
    enabled: true,
    enablerCapability: "supported",
    seed: block,
    lastChange: null,
    indexedThrough: block,
    verification: {
      outcome: "unavailable",
      block,
      reason: "historical getter read unavailable",
    },
  };
  const batch = await createSnapshotBatch({
    chains: [chain],
    deploymentId: "unavailable-read",
    additionalContracts: [{ chainId: 4663, address, name: "External pool" }],
    loadProtocolData: () => ({
      ContractState: [state],
      ChainObservation: [{ chainId: 4663, indexedThrough: block }],
    }),
  });
  assert.equal(batch.ready, true);
  assert.equal(batch.files.at(-1).publishLast, true);
  const snapshot = JSON.parse(batch.files[0].body);
  assert.equal(snapshot.data.contractStates[0].enabled, true);
  assert.deepEqual(snapshot.data.contractStates[0].seed, block);
  assert.deepEqual(
    snapshot.data.contractStates[0].verification,
    state.verification
  );
});
