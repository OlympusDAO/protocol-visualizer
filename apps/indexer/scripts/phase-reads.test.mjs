import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import {
  withCanonicalObservation,
  CanonicalObservationChanged,
} from "../src/events/canonical-observation.ts";
import {
  getControlGetter,
  getCanonicalCodeHash,
} from "../src/events/effects.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("public readers share phase headers but retain fresh acceptance outside phases and after restart", async () => {
  const chainId = 999927,
    address = `0x${"81".repeat(20)}`,
    value = `0x${"82".repeat(20)}`;
  const hash = `0x${"83".repeat(32)}`,
    forkHash = `0x${"84".repeat(32)}`;
  let canonical = hash;
  let headers = 0,
    calls = 0,
    codes = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const reply = ({ method, id, params }) => {
      let result;
      if (method === "eth_getBlockByNumber") {
        headers++;
        result = {
          number: params[0],
          hash: canonical,
          parentHash: forkHash,
          timestamp: "0x100",
          transactions: [],
        };
      } else if (method === "eth_getCode") {
        codes++;
        result = "0x6000";
      } else if (method === "eth_call") {
        calls++;
        result = `0x${value.slice(2).padStart(64, "0")}`;
      } else throw new Error(`Unexpected ${method}`);
      return { jsonrpc: "2.0", id, result };
    };
    const input = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input))
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env[`ENVIO_RPC_URL_${chainId}`] =
    `http://127.0.0.1:${server.address().port}`;
  const input = {
    chainId,
    address,
    blockNumber: 10n,
    blockHash: hash,
    getter: "owner",
  };
  let context = await makeEffectRuntime();
  try {
    await withCanonicalObservation(chainId, 10n, async (phase) => {
      for (let index = 0; index < 3; index++) {
        assert.equal(
          (
            await getControlGetter(
              context,
              input,
              phase.block,
              phase.readCanonicalBlock
            )
          ).value,
          value
        );
        assert(
          await getCanonicalCodeHash(context, input, phase.readCanonicalBlock)
        );
      }
      return true;
    });
    assert.equal(
      headers,
      2,
      "one opening header and one fresh final check cover all readers"
    );
    assert.equal(calls, 1);
    assert.equal(codes, 1);
    const before = headers;
    assert.equal((await getControlGetter(context, input)).status, "success");
    assert(await getCanonicalCodeHash(context, input));
    assert.equal(
      headers,
      before + 3,
      "standalone getter preflight and both acceptance checks stay fresh"
    );
    await context.flush();
    context = await makeEffectRuntime({ rows: context.rows });
    const beforeCalls = calls;
    await assert.rejects(
      withCanonicalObservation(chainId, 10n, async (phase) => {
        assert.equal(
          (
            await getControlGetter(
              context,
              input,
              phase.block,
              phase.readCanonicalBlock
            )
          ).value,
          value
        );
        canonical = forkHash;
        return true;
      }),
      CanonicalObservationChanged
    );
    assert.equal(
      calls,
      beforeCalls,
      "a persisted hit can be rejected without a fresh EVM call"
    );
    assert.equal(
      (await getControlGetter(context, input)).status,
      "unavailable"
    );
  } finally {
    await new Promise((done) => server.close(done));
  }
});
