import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { queuedAdmission } from "../scripts/benchmark-indexer-admission.mjs";

test("benchmark admission retries capacity only and preserves mixed batch results", async () => {
  const calls = new Map();
  const envelopes = [];
  const upstream = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const payload = JSON.parse(text);
    const batch = Array.isArray(payload);
    const items = batch ? payload : [payload];
    envelopes.push(items.length);
    const results = items.map((item) => {
      const count = (calls.get(item.id) ?? 0) + 1;
      calls.set(item.id, count);
      const error =
        item.id === "revert"
          ? { code: 3, message: "execution reverted", data: "0x" }
          : item.id === "generic"
            ? { code: -32603, message: "RPC request failed" }
            : item.id === "capacity" && count < 3
              ? { code: -32007, message: "RPC request failed" }
              : undefined;
      return {
        jsonrpc: "2.0",
        id: item.id,
        ...(error ? { error } : { result: "0x1234" }),
      };
    });
    response.writeHead(200, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify(batch ? results : results[0]));
  });
  await new Promise((accept) => upstream.listen(0, "127.0.0.1", accept));
  const relay = await queuedAdmission(
    `http://127.0.0.1:${upstream.address().port}`
  );
  try {
    const ids = ["success", "capacity", "revert", "generic"];
    const response = await fetch(`${relay.origin}/pv/evm/1`, {
      method: "POST",
      body: JSON.stringify(
        ids.map((id) => ({
          jsonrpc: "2.0",
          id,
          method: "eth_call",
          params: [],
        }))
      ),
    });
    const results = await response.json();
    assert.deepEqual(
      results.map((item) => item.id),
      ids
    );
    assert.equal(results[0].result, "0x1234");
    assert.equal(results[1].result, "0x1234");
    assert.equal(results[2].error.code, 3);
    assert.equal(results[3].error.code, -32603);
    assert.deepEqual(
      [...calls],
      [
        ["success", 1],
        ["capacity", 3],
        ["revert", 1],
        ["generic", 1],
      ]
    );
    assert.deepEqual(relay.stats, {
      requests: 4,
      capacityRetries: 2,
      exhausted: 0,
    });
    assert.deepEqual(envelopes, [4, 1, 1]);
    assert.equal((await fetch(`${relay.origin}/other`)).status, 404);
  } finally {
    await relay.close();
    await new Promise((accept) => upstream.close(accept));
  }
});

test("benchmark admission exhausts visibly without leaking upstream text", async () => {
  const upstream = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const item = JSON.parse(text);
    response.writeHead(429, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: item.id,
        error: { code: -32007, message: "provider-private-sentinel" },
      })
    );
  });
  await new Promise((accept) => upstream.listen(0, "127.0.0.1", accept));
  const relay = await queuedAdmission(
    `http://127.0.0.1:${upstream.address().port}`
  );
  try {
    const response = await fetch(`${relay.origin}/pv/evm/1`, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [],
      }),
    });
    const text = await response.text();
    assert.equal(JSON.parse(text).error.code, -32005);
    assert.doesNotMatch(text, /provider-private-sentinel/);
    assert.equal(relay.stats.exhausted, 1);
    assert.ok(relay.stats.capacityRetries > 1);
  } finally {
    await relay.close();
    await new Promise((accept) => upstream.close(accept));
  }
});
