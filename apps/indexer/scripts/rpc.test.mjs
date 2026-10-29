import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { getPublicClient } from "../src/events/rpc.ts";

test("RPC clients require a configured endpoint and never retry outside eRPC", async () => {
  delete process.env.ENVIO_RPC_URL_999991;
  assert.throws(() => getPublicClient(999991), /Missing ENVIO_RPC_URL_999991/);
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    res.writeHead(503);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.ENVIO_RPC_URL_999992 = `http://127.0.0.1:${server.address().port}`;
    process.env.ENVIO_RPC_URL_FALLBACK_999992 = "http://127.0.0.1:1";
    await assert.rejects(getPublicClient(999992).getBlockNumber());
    assert.equal(calls, 1);
  } finally {
    delete process.env.ENVIO_RPC_URL_999992;
    delete process.env.ENVIO_RPC_URL_FALLBACK_999992;
    await new Promise((resolve) => server.close(resolve));
  }
});
