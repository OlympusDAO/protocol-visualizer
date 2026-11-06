import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { getPublicClient, RpcTransientFailure } from "../src/events/rpc.ts";

async function fixture(chainId, handle, run) {
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw);
    const reply = (rpc) => ({ jsonrpc: "2.0", id: rpc.id, result: "0x1" });
    const body = JSON.stringify(
      Array.isArray(input) ? input.map(reply) : reply(input)
    );
    response.writeHead(200, { "content-type": "application/json" });
    handle(response, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env[`ENVIO_RPC_URL_${chainId}`] =
    `http://127.0.0.1:${server.address().port}`;
  try {
    const client = getPublicClient(chainId);
    await run(() =>
      client.request({
        method: "eth_getBalance",
        params: [`0x${"11".repeat(20)}`, "0x1"],
      })
    );
  } finally {
    delete process.env[`ENVIO_RPC_URL_${chainId}`];
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a slow private-proxy response body is awaited once beyond viem's old ten-second deadline", {
  timeout: 20_000,
}, async () => {
  let calls = 0;
  let timer;
  try {
    await fixture(
      999975,
      (response, body) => {
        calls++;
        if (calls === 1) {
          response.write(body.slice(0, 1));
          timer = setTimeout(() => response.end(body.slice(1)), 11_000);
        } else response.end(body);
      },
      async (read) => {
        assert.equal(await read(), "0x1");
        assert.equal(
          calls,
          1,
          "do not cancel and duplicate the proxy's active work"
        );
      }
    );
  } finally {
    clearTimeout(timer);
  }
});

test("stalled proxy bodies exhaust six bounded attempts and allow a later healthy request", {
  timeout: 20_000,
}, async (t) => {
  let calls = 0;
  let deadlines = 0;
  let stalled = true;
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    if (delay === 50_000) {
      deadlines++;
      return original(callback, 50, ...args);
    }
    return original(callback, delay, ...args);
  });
  await fixture(
    999976,
    (response, body) => {
      calls++;
      if (stalled) response.write(body.slice(0, 1));
      else response.end(body);
    },
    async (read) => {
      await assert.rejects(
        read,
        (error) =>
          error.walk?.(
            (cause) => cause instanceof RpcTransientFailure
          ) instanceof RpcTransientFailure
      );
      assert.equal(calls, 6);
      assert.equal(deadlines, 6);
      t.mock.restoreAll();
      stalled = false;
      assert.equal(await read(), "0x1");
      assert.equal(calls, 7);
    }
  );
});
