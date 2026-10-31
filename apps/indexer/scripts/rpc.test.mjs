import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { inspect } from "node:util";
import { getPublicClient } from "../src/events/rpc.ts";
import { RpcTransientFailure } from "../src/events/rpc.ts";
import { readPinnedControlGetter } from "../src/events/control-reads.ts";
import { readPinnedBridgeConfiguration } from "../src/events/bridge-reads.ts";
import { readPinnedModuleDependencies } from "../src/events/module-dependencies.ts";
import { getControlBlock } from "../src/events/effects.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("RPC clients require a configured endpoint, retry the private proxy, and sanitize exhaustion", async () => {
  delete process.env.ENVIO_RPC_URL_999991;
  assert.throws(() => getPublicClient(999991), /Missing ENVIO_RPC_URL_999991/);
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    res.writeHead(503);
    res.end("fixture-provider-credential");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.ENVIO_RPC_URL_999992 = `http://127.0.0.1:${server.address().port}/?apiKey=fixture-provider-credential`;
    process.env.ENVIO_RPC_URL_FALLBACK_999992 = "http://127.0.0.1:1";
    await assert.rejects(
      getControlBlock(await makeEffectRuntime(), 999992, 10),
      (error) => {
        assert.doesNotMatch(error.message, /127\.0\.0\.1|http:/);
        assert.doesNotMatch(
          inspect(error, { depth: 12 }),
          /fixture-provider-credential|127\.0\.0\.1/
        );
        assert.match(error.message, /Indexer RPC temporarily unavailable/);
        return true;
      }
    );
    assert.equal(calls, 6);
  } finally {
    delete process.env.ENVIO_RPC_URL_999992;
    delete process.env.ENVIO_RPC_URL_FALLBACK_999992;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("proxy recovery queues bounded cross-chain pressure and never retries EVM reverts", async () => {
  let calls = 0,
    envelopes = 0,
    active = 0,
    peak = 0;
  const server = http.createServer(async (req, res) => {
    envelopes++;
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    const requests = Array.isArray(payload) ? payload : [payload];
    calls += requests.length;
    active += requests.length;
    peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 20));
    active -= requests.length;
    res.setHeader("content-type", "application/json");
    if (calls <= 1) {
      res.writeHead(429);
      res.end();
      return;
    }
    const reply = ({ id, method }) => ({
      id,
      jsonrpc: "2.0",
      ...(method === "eth_call"
        ? { error: { code: 3, message: "execution reverted" } }
        : { result: "0x2a" }),
    });
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? requests.map(reply) : reply(payload)
      )
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  for (const id of [999993, 999994])
    process.env[`ENVIO_RPC_URL_${id}`] =
      `http://127.0.0.1:${server.address().port}/${id}`;
  try {
    assert.equal(
      await getPublicClient(999993).getBlockNumber({ cacheTime: 0 }),
      42n
    );
    assert.equal(calls, 2);
    const beforeEnvelopes = envelopes;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        getPublicClient(999993 + (i % 2)).request({ method: "eth_blockNumber" })
      )
    );
    assert(results.every((value) => value === "0x2a"));
    assert.equal(
      calls,
      42,
      "all 40 distinct logical requests reached the proxy"
    );
    assert(peak <= 8, `maximum logical in-flight RPCs: ${peak}`);
    assert(
      envelopes - beforeEnvelopes <= 10,
      "HTTP batching packs 40 logical requests into at most ten cross-chain envelopes"
    );
    const before = calls;
    await assert.rejects(
      getPublicClient(999993).readContract({
        address: `0x${"12".repeat(20)}`,
        abi: [
          {
            type: "function",
            name: "value",
            inputs: [],
            outputs: [{ type: "address" }],
            stateMutability: "view",
          },
        ],
        functionName: "value",
      })
    );
    assert.equal(calls, before + 1);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("JSON-RPC capacity codes recover, while historical and EVM failures are terminal", async () => {
  let errorCode = 429;
  let calls = 0;
  let errorMessage = "private-provider-credential";
  let errorData;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    const reply = ({ id }) => {
      calls++;
      return {
        id,
        jsonrpc: "2.0",
        ...(calls <= 2
          ? {
              error: {
                code: errorCode,
                message: errorMessage,
                data: errorData,
              },
            }
          : { result: "0x2a" }),
      };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(reply) : reply(payload)
      )
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env.ENVIO_RPC_URL_999997 = `http://127.0.0.1:${server.address().port}`;
  const client = getPublicClient(999997);
  try {
    for (const code of [429, -32007, -32016]) {
      errorCode = code;
      calls = 0;
      assert.equal(await client.request({ method: "eth_blockNumber" }), "0x2a");
      assert.equal(calls, 3, `capacity code ${code} recovers`);
    }
    for (const failure of [
      { code: -32603, message: "historical state is not available" },
      { code: 3, message: "execution reverted" },
      { code: -32603, message: "execution reverted", data: "0x12345678" },
    ]) {
      errorCode = failure.code;
      errorMessage = failure.message;
      errorData = failure.data;
      calls = 0;
      await assert.rejects(client.request({ method: "eth_blockNumber" }));
      assert.equal(calls, 1, `${failure.message} is not retried`);
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("transient exhaustion crosses getter, bridge, optional router and dependency catches", async () => {
  const hash = `0x${"ab".repeat(32)}`;
  const address = `0x${"12".repeat(20)}`;
  const fail = () => {
    throw new Error("wrapped", { cause: new RpcTransientFailure() });
  };
  const input = {
    chainId: 1,
    address,
    blockNumber: 10n,
    blockHash: hash,
    getter: "owner",
  };
  await assert.rejects(
    readPinnedControlGetter({ getBlock: fail }, input),
    RpcTransientFailure
  );
  await assert.rejects(
    readPinnedBridgeConfiguration(
      { getBlock: fail },
      { ...input, kind: "pool", selectors: [] }
    ),
    RpcTransientFailure
  );
  const client = {
    getBlock: async () => ({ hash }),
    readContract: async ({ functionName }) =>
      functionName === "moduleDependents" ? fail() : address,
  };
  await assert.rejects(
    readPinnedModuleDependencies(client, {
      ...input,
      kernel: address,
      keycode: "MINTR",
    }),
    RpcTransientFailure
  );
  const optional = {
    getBlock: async () => ({ hash }),
    readContract: async ({ functionName }) => {
      if (functionName === "isChainSupported") return fail();
      return address;
    },
  };
  await assert.rejects(
    readPinnedBridgeConfiguration(
      optional,
      { ...input, kind: "bridge", selectors: ["1"] },
      async () => hash
    ),
    RpcTransientFailure
  );
});

test("a partial HTTP batch retries only the capacity-limited item", async () => {
  const counts = new Map();
  let envelopes = 0;
  const server = http.createServer(async (req, res) => {
    envelopes++;
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    const reply = ({ id, params }) => {
      const address = params[0];
      const count = (counts.get(address) ?? 0) + 1;
      counts.set(address, count);
      return {
        id,
        jsonrpc: "2.0",
        ...(address.endsWith("00") && count === 1
          ? { error: { code: 429, message: "capacity" } }
          : { result: "0x2a" }),
      };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(reply) : reply(payload)
      )
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env.ENVIO_RPC_URL_999998 = `http://127.0.0.1:${server.address().port}`;
  try {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        getPublicClient(999998).request({
          method: "eth_getBalance",
          params: [`0x${i.toString(16).padStart(40, "0")}`, "0x1"],
        })
      )
    );
    assert(results.every((value) => value === "0x2a"));
    assert.equal(envelopes, 2);
    assert.equal([...counts.values()].filter((value) => value === 2).length, 1);
    assert.equal(
      [...counts.values()].reduce((a, b) => a + b),
      9
    );
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("a saturated indexer queue rejects overflow, drains, and recovers across chains", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let admitted;
  const firstBatch = new Promise((resolve) => {
    admitted = resolve;
  });
  let count = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw),
      batch = Array.isArray(payload) ? payload : [payload];
    count += batch.length;
    admitted();
    await gate;
    const reply = ({ id }) => ({ id, jsonrpc: "2.0", result: "0x2a" });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(payload) ? batch.map(reply) : reply(payload))
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  for (const chain of [999995, 999996])
    process.env[`ENVIO_RPC_URL_${chain}`] =
      `http://127.0.0.1:${server.address().port}/${chain}`;
  try {
    const calls = Array.from({ length: 265 }, (_, index) =>
      getPublicClient(999995 + (index % 2)).request({
        method: "eth_blockNumber",
      })
    );
    const settled = Promise.allSettled(calls);
    await firstBatch;
    const overflow = await Promise.any(
      calls.map((call) =>
        call.then(
          () => {
            throw new Error("Proxy completed while gated");
          },
          (error) => error
        )
      )
    );
    assert.match(overflow.message, /Indexer RPC temporarily unavailable/);
    assert(count <= 8, "only active permits reach the proxy before release");
    release();
    const results = await settled;
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      264
    );
    assert.equal(count, 264);
    assert.equal(
      await getPublicClient(999996).getBlockNumber({ cacheTime: 0 }),
      42n
    );
    assert.equal(
      count,
      265,
      "overflow does not leak permits after queue drain"
    );
  } finally {
    release();
    await new Promise((done) => server.close(done));
  }
});
