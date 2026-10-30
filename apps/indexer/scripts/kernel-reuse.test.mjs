import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reuseKernelRead,
  invalidateKernelReads,
} from "../src/events/kernel-reuse.ts";
import proofs from "../src/generated/kernel-read-proofs.json" with {
  type: "json",
};

const store = (rows = new Map()) => ({
  rows,
  get: async (id) => rows.get(id),
  set: (row) => rows.set(row.id, structuredClone(row)),
});
const block = (number) => ({
  number: String(number),
  hash: `0x${String(number).padStart(64, "0")}`,
  timestamp: String(number + 1000),
});
test("active source-proven reads reuse original provenance across restart, invalidate all actions, and fall back after migration or inactivity", async () => {
  const proof = proofs.find((p) => p.getters.includes("ROLES"));
  const ctx = {
    KernelReadCache: store(),
    KernelReadEpoch: store(),
    Contract: store(),
  };
  ctx.Contract.set({
    id: `1:${proof.address}`,
    isEnabled: true,
    kernelHistory: "installed",
  });
  let reads = 0;
  const fresh = async () => {
    reads++;
    return { status: "success", value: `0x${"34".repeat(20)}` };
  };
  const readBlock = async (number) => block(Number(number));
  const args = {
    chainId: 1,
    address: proof.address,
    getter: "ROLES",
    block: block(10),
  };
  const read = (
    input = args,
    context = ctx,
    codeHash = proof.codeHash,
    canonical = readBlock
  ) => reuseKernelRead(context, input, fresh, async () => codeHash, canonical);
  assert.equal((await read()).value, `0x${"34".repeat(20)}`);
  const restarted = {
    ...ctx,
    KernelReadCache: store(new Map(ctx.KernelReadCache.rows)),
  };
  assert.deepEqual(
    (await read({ ...args, block: block(11) }, restarted)).verifiedAt,
    block(10)
  );
  assert.equal(reads, 1);
  for (const action of [0, 1, 2, 3, 4]) {
    await invalidateKernelReads(ctx, {
      chainId: 1,
      block: { ...block(12 + action), number: 12 + action },
      transaction: { hash: `0xtx${action}` },
      logIndex: action,
      params: { action_: action },
    });
    await read({ ...args, block: block(20 + action) });
  }
  assert.equal(reads, 6);
  ctx.Contract.set({
    id: `1:${proof.address}`,
    isEnabled: false,
    kernelHistory: "installed",
  });
  await read({ ...args, block: block(30) });
  await read({ ...args, block: block(31) });
  assert.equal(
    reads,
    8,
    "inactive configureDependencies may mutate without events"
  );
  ctx.Contract.set({
    id: `1:${proof.address}`,
    isEnabled: true,
    kernelHistory: "installed",
  });
  await read({ ...args, block: block(32) }, ctx, "0xwrong", async () => ({
    ...block(10),
    hash: "0xfork",
  }));
  assert.equal(reads, 9);
  await invalidateKernelReads(ctx, {
    chainId: 1,
    block: { number: 40, hash: block(40).hash },
    transaction: { hash: "0xmigrate" },
    logIndex: 0,
    params: { action_: 5 },
  });
  await read({ ...args, block: block(41) });
  await read({ ...args, block: block(42) });
  assert.equal(
    reads,
    11,
    "old Kernel retains active records after migration; reuse stays disabled"
  );
  // A rollback restores both epochs and facts, then canonical checks reject orphan facts.
  const rollback = { ...restarted, KernelReadEpoch: store() };
  await read(
    { ...args, block: block(11) },
    rollback,
    proof.codeHash,
    async (number) => ({ ...block(Number(number)), hash: "0xfork" })
  );
  assert.equal(reads, 12);
  await read({ ...args, address: `0x${"77".repeat(20)}`, block: block(50) });
  assert.equal(reads, 13, "unknown runtime/address is never reusable");
});

test("empty dependency scans persist, keep actual observation block, and never reuse backwards or across invalidation", async () => {
  const proof = proofs.find((p) => p.name === "kernel");
  const ctx = { KernelReadCache: store(), KernelReadEpoch: store() };
  let reads = 0;
  const input = {
    chainId: 1,
    address: proof.address,
    getter: "moduleDependents:MINTR",
    block: block(10),
  };
  const read = async () => {
    reads++;
    return { status: "success", module: `0x${"0".repeat(40)}`, policies: [] };
  };
  const run = (number) =>
    reuseKernelRead(
      ctx,
      { ...input, block: block(number) },
      read,
      async () => proof.codeHash,
      async (number) => block(Number(number))
    );
  await run(10);
  assert.deepEqual((await run(11)).policies, []);
  assert.deepEqual((await run(12)).verifiedAt, block(10));
  assert.equal(reads, 1);
  await run(9);
  assert.equal(reads, 2);
  await invalidateKernelReads(ctx, {
    chainId: 1,
    block: { number: 13, hash: block(13).hash },
    transaction: { hash: "0xupgrade" },
    logIndex: 0,
    params: { action_: 1 },
  });
  await run(14);
  assert.equal(reads, 3);
});
