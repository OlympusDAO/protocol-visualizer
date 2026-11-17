import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters } from "viem";
import { decodeVersion, latestEnvRef } from "../src/sources.mjs";

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

test("latestEnvRef returns the last commit that changed env.json", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(new URL(url));
    return Response.json([{ sha: "abc123" }]);
  });
  const ref = await latestEnvRef({
    repo: "OlympusDAO/olympus-v3",
    branch: "master",
    path: "src/scripts/env.json",
  });
  assert.equal(ref, "abc123");
  assert.equal(requests[0].pathname, "/repos/OlympusDAO/olympus-v3/commits");
  assert.equal(requests[0].searchParams.get("sha"), "master");
  assert.equal(requests[0].searchParams.get("path"), "src/scripts/env.json");
});

test("latestEnvRef fails if env.json has no commit", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json([]));
  await assert.rejects(
    latestEnvRef({ repo: "o/r", branch: "master", path: "env.json" }),
    /has no commit/
  );
});
