import assert from "node:assert/strict";
import { test } from "node:test";
import { getKernelConstants } from "../src/constants.ts";
import { handleKernelActionExecuted } from "../src/events/kernel.ts";
import {
  getCoreContracts,
  seedCoreContracts,
} from "../src/events/kernel-history.ts";

test("only completed creation coverage establishes never-installed; Kernel event history wins", async () => {
  const rows = new Map();
  const context = {
    Contract: {
      get: async (id) => rows.get(id),
      set: (row) => rows.set(row.id, row),
    },
  };
  const contract = getCoreContracts(1).find(
    (row) => row.name === "CCIPTokenPoolConfig"
  );
  assert.ok(contract?.startBlock);
  const block = {
    number: String(contract.startBlock),
    hash: "0xcanonical",
    timestamp: "1790000000",
  };
  const id = `1:${contract.address}`;
  await seedCoreContracts(context, 1, 0, block, [contract], async () => false);
  assert.equal(rows.size, 0, "no code means no deployed node");
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  assert.equal(rows.get(id).kernelHistory, "never-installed");
  rows.clear();
  await seedCoreContracts(
    context,
    1,
    contract.startBlock + 1,
    { ...block, number: String(contract.startBlock + 1) },
    [contract],
    async () => true
  );
  assert.equal(
    rows.get(id).kernelHistory,
    "unknown",
    "late coverage cannot prove never installed"
  );
  rows.set(id, {
    ...rows.get(id),
    kernelHistory: "installed",
    isEnabled: false,
  });
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  assert.equal(
    rows.get(id).kernelHistory,
    "installed",
    "removed contracts retain their event history"
  );
  rows.clear();
  await seedCoreContracts(
    context,
    1,
    0,
    block,
    [{ ...contract, startBlock: undefined }],
    async () => true
  );
  assert.equal(
    rows.get(id).kernelHistory,
    "unknown",
    "missing creation anchors remain unknown"
  );
});

test("activation and removal events retain prior installation independently of current activity", async () => {
  const store = () => {
    const rows = new Map();
    return {
      get: async (id) => rows.get(id),
      set: (row) => rows.set(row.id, row),
    };
  };
  const context = Object.fromEntries(
    ["Contract", "ContractEvent", "ActionExecutedEvent"].map((key) => [
      key,
      store(),
    ])
  );
  context.effect = async (_effect, input) =>
    input.policyAddress
      ? { permissions: [], usedLatestFallback: false }
      : { roleToFunctions: {}, functionSelectors: {} };
  const kernel = getKernelConstants(1).address;
  context.Contract.set({ id: `1:${kernel.toLowerCase()}` });
  const contract = getCoreContracts(1).find(
    (row) => row.name === "CCIPTokenPoolConfig"
  );
  const block = {
    number: String(contract.startBlock),
    timestamp: "1790000000",
    hash: "0xcanonical",
  };
  await seedCoreContracts(context, 1, 0, block, [contract], async () => true);
  const id = `1:${contract.address}`;
  assert.equal(
    (await context.Contract.get(id)).kernelHistory,
    "never-installed"
  );
  for (const action of [2, 3, 2]) {
    await handleKernelActionExecuted(
      {
        chainId: 1,
        srcAddress: kernel,
        block: { number: contract.startBlock + 1, timestamp: 1790000001 },
        transaction: { hash: `0xtx${action}` },
        logIndex: action,
        params: { action_: action, target_: contract.address },
      },
      context
    );
    const row = await context.Contract.get(id);
    assert.equal(row.kernelHistory, "installed");
    assert.equal(row.isEnabled, action === 2);
  }
});
