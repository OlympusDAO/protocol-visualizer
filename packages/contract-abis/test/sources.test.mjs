import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters } from "viem";
import { decodeVersion } from "../src/sources.mjs";

test("decodeVersion reads each VERSION() shape", () => {
  const encode = (types, values) =>
    encodeAbiParameters(
      types.map((type) => ({ type })),
      values
    );
  assert.equal(decodeVersion(encode(["uint8", "uint8"], [1, 2])), "1.2");
  assert.equal(decodeVersion(encode(["string"], ["1.2"])), "1.2");
  assert.equal(decodeVersion(encode(["uint256"], [3n])), "3");
  assert.equal(decodeVersion("0x"), null);
  assert.equal(decodeVersion(encode(["uint256", "uint256"], [300n, 1n])), null);
});
