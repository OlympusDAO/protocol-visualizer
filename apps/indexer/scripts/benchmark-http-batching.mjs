import assert from "node:assert/strict";
import http from "node:http";
import { createPublicClient, http as transport } from "viem";
import { getPublicClient } from "../src/events/rpc.ts";

// Transport fixture: equal RPC work and eight concurrent items in both modes.
// Batched mode uses the production boundary; baseline disables HTTP batching.
const latencyMs = 10;
let envelopes = 0;
let rpcItems = 0;
const server = http.createServer(async (req, res) => {
  envelopes++;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw);
  const batch = Array.isArray(payload) ? payload : [payload];
  rpcItems += batch.length;
  await new Promise((done) => setTimeout(done, latencyMs));
  const reply = ({ id }) => ({ id, jsonrpc: "2.0", result: "0x2a" });
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(Array.isArray(payload) ? batch.map(reply) : reply(payload))
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}`;
process.env.ENVIO_RPC_URL_999989 = url;
const clients = {
  unbatched: createPublicClient({
    transport: transport(url, { retryCount: 0 }),
  }),
  batched: getPublicClient(999989),
};
const runs = [];
try {
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const mode of repeat % 2
      ? ["batched", "unbatched"]
      : ["unbatched", "batched"]) {
      envelopes = 0;
      rpcItems = 0;
      const start = performance.now();
      for (let offset = 0; offset < 128; offset += 8) {
        const values = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            clients[mode].request({
              method: "eth_getBalance",
              params: [
                `0x${(offset + i).toString(16).padStart(40, "0")}`,
                "0x1",
              ],
            })
          )
        );
        assert(values.every((value) => value === "0x2a"));
      }
      assert.equal(rpcItems, 128);
      assert.equal(envelopes, mode === "batched" ? 16 : 128);
      runs.push({
        mode,
        envelopes,
        rpcItems,
        durationMs: performance.now() - start,
      });
    }
  }
  console.log(
    JSON.stringify(
      { kind: "HTTP transport fixture", latencyMs, concurrency: 8, runs },
      null,
      2
    )
  );
} finally {
  await new Promise((done) => server.close(done));
}
