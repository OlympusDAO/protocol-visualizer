import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCurrentModuleAddress,
  setCurrentModule,
} from "../src/events/modules.ts";

test("module lookup follows rolled-back entities and isolates indexer contexts", async () => {
  const original = `0x${"11".repeat(20)}`;
  const discarded = `0x${"22".repeat(20)}`;
  const replacement = `0x${"33".repeat(20)}`;
  const chainId = 999976;
  const store = () => {
    const rows = new Map();
    return {
      rows,
      CurrentModule: {
        get: async (id) => rows.get(id),
        set: (row) => rows.set(row.id, row),
      },
      effect: () => {
        throw Error("Entity-backed lookup must not issue RPC");
      },
    };
  };
  const first = store();
  setCurrentModule(first, chainId, "ROLES", discarded, 100n, 50n);
  const [id, row] = [...first.rows][0];
  first.rows.set(id, {
    ...row,
    address: original,
    lastUpdatedBlockNumber: 49n,
  });
  const lookup = (context) =>
    getCurrentModuleAddress(
      "ROLES",
      "0x524f4c4553",
      original,
      51n,
      chainId,
      context
    );
  assert.equal(await lookup(first), original);
  const second = store();
  setCurrentModule(second, chainId, "ROLES", replacement, 101n, 51n);
  assert.equal(await lookup(second), replacement);
  assert.equal(await lookup(first), original);
});
