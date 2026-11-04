import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChainObservation } from "../src/index.js";
import { verifyCurrentObservation } from "../src/indexer-progress.js";

test("publication requires a recent, canonical, completed full verification", async () => {
  const hash = `0x${"12".repeat(32)}`;
  const observation: ChainObservation = {
    chainId: 1,
    indexedThrough: { number: "1000", hash, timestamp: "1234" },
    verificationVersion: 1,
  };
  let head = 1099;
  let observedHash = hash;
  let observedNumber = "0x3e8";
  let fail = false;
  let requests = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://private-proxy.example/1");
    requests++;
    if (fail) return new Response("private-provider-error", { status: 429 });
    const { params } = JSON.parse(init?.body as string);
    return Response.json({
      result: {
        number:
          params[0] === "latest" ? `0x${head.toString(16)}` : observedNumber,
        hash: observedHash,
        timestamp: "0x4d2",
      },
    });
  };
  const check = (value: ChainObservation | undefined = observation) =>
    verifyCurrentObservation(1, value, {
      RPC_URL_1: "https://private-proxy.example/1",
    });
  try {
    assert.equal(await verifyCurrentObservation(1, undefined), false);
    for (const value of [
      { ...observation, verificationVersion: undefined },
      { ...observation, verificationVersion: 2 },
      { ...observation, chainId: 10 },
      {
        ...observation,
        indexedThrough: { ...observation.indexedThrough, hash: "bad" },
      },
    ])
      assert.equal(await check(value), false);
    assert.equal(requests, 0);
    assert.equal(await check(), true, "lag 99 is recent");
    head = 1100;
    assert.equal(await check(), false, "lag 100 is stale");
    head = 999;
    assert.equal(await check(), false, "future observations fail");
    head = 1001;
    observedHash = `0x${"34".repeat(32)}`;
    assert.equal(await check(), false, "orphaned observation fails");
    observedHash = hash;
    observedNumber = "0x3e7";
    assert.equal(await check(), false, "wrong returned block fails");
    observedNumber = "0x3e8";
    assert.equal(
      await check({
        ...observation,
        indexedThrough: { ...observation.indexedThrough, timestamp: "1" },
      }),
      false
    );
    fail = true;
    assert.equal(await check(), false, "capacity failures cannot promote");
    globalThis.fetch = async () => {
      throw Error("private-provider-secret");
    };
    assert.equal(await check(), false, "transport failures cannot promote");
    fail = false;
  } finally {
    globalThis.fetch = saved;
  }
});
