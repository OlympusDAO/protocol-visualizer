import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { parseAbi } from "viem";
import { getEffectClient } from "../src/events/call-cache.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("raw calls persist once and decode independently; full RPC parameters isolate keys", async () => {
  let count = 0;
  let failure = false;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const payload = JSON.parse(raw);
    const reply = ({ id }) => {
      count++;
      return {
        id,
        jsonrpc: "2.0",
        ...(failure
          ? { error: { code: 3, message: "execution reverted" } }
          : { result: `0x${"0".repeat(63)}1` }),
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
  for (const id of [999960, 999961])
    process.env[`ENVIO_RPC_URL_${id}`] =
      `http://127.0.0.1:${server.address().port}`;
  try {
    let runtime = await makeEffectRuntime();
    const client = getEffectClient(runtime, 999960);
    const address = `0x${"12".repeat(20)}`;
    const hash = `0x${"ab".repeat(32)}`;
    const args = {
      address,
      blockHash: hash,
      requireCanonical: true,
      functionName: "value",
    };
    const results = await Promise.all([
      client.readContract({
        ...args,
        abi: parseAbi(["function value() view returns (uint256)"]),
      }),
      client.readContract({
        ...args,
        abi: parseAbi(["function value() view returns (address)"]),
      }),
    ]);
    assert.deepEqual(results, [1n, `0x${"0".repeat(39)}1`]);
    assert.equal(count, 1);
    await runtime.flush();
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    const restarted = getEffectClient(runtime, 999960);
    const call = { to: address, data: "0x3fa4f245" };
    const pin = { blockHash: hash, requireCanonical: true };
    await restarted.request({ method: "eth_call", params: [call, pin] });
    assert.equal(count, 1);
    for (const params of [
      [{ ...call, from: address }, pin],
      [{ ...call, gas: "0x123" }, pin],
      [{ ...call, value: "0x1" }, pin],
      [{ ...call, data: "0x12345678" }, pin],
      [{ ...call, to: `0x${"34".repeat(20)}` }, pin],
      [call, { ...pin, blockHash: `0x${"cd".repeat(32)}` }],
      [call, pin, { [address]: { balance: "0x1" } }],
    ])
      await restarted.request({ method: "eth_call", params });
    await getEffectClient(runtime, 999961).request({
      method: "eth_call",
      params: [call, pin],
    });
    assert.equal(count, 9);
    for (const height of ["latest", "0xa"]) {
      await restarted.request({ method: "eth_call", params: [call, height] });
      await restarted.request({ method: "eth_call", params: [call, height] });
    }
    assert.equal(count, 13, "numeric heights and latest never persist");
    failure = true;
    const params = [{ ...call, data: "0x99999999" }, pin];
    await assert.rejects(restarted.request({ method: "eth_call", params }));
    await runtime.flush();
    failure = false;
    const recovered = getEffectClient(
      await makeEffectRuntime({ rows: runtime.rows }),
      999960
    );
    await recovered.request({ method: "eth_call", params });
    assert.equal(count, 15, "reverts are not persisted or retried");
  } finally {
    await new Promise((done) => server.close(done));
  }
});
