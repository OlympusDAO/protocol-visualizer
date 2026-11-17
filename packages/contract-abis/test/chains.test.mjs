import assert from "node:assert/strict";
import { test } from "node:test";
import { chainIdOf } from "../src/chains.mjs";

test("chainIdOf maps env.json chain names to viem chain IDs", () => {
  assert.equal(chainIdOf("mainnet"), 1);
  assert.equal(chainIdOf("robinhood"), 4663);
  assert.equal(chainIdOf("arbitrum-sepolia"), 421614);
  assert.equal(chainIdOf("base-sepolia"), 84532);
});

test("chainIdOf rejects a chain that viem/chains does not have", () => {
  assert.throws(() => chainIdOf("solana-devnet"), /has no chain solana-devnet/);
});
