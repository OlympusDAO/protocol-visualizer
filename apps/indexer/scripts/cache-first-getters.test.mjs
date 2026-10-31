import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { getControlGetter } from "../src/events/effects.ts";
import proofs from "../src/generated/kernel-read-proofs.json" with {
  type: "json",
};

const block = (number) => ({
  number: String(number),
  hash: `0x${String(number).padStart(64, "0")}`,
  timestamp: String(number + 1000),
});

test("a valid Kernel entity fact bypasses deployment discovery and effects while preserving its actual verification block", async () => {
  const proof = proofs.find((row) => row.getters.includes("ROLES"));
  const value = `0x${"34".repeat(20)}`;
  let effects = 0;
  let forked = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const reply = ({ id, method, params }) => {
      assert.equal(method, "eth_getBlockByNumber");
      const number = Number(BigInt(params[0]));
      return {
        jsonrpc: "2.0",
        id,
        result: {
          number: params[0],
          hash: forked ? `0x${"ff".repeat(32)}` : block(number).hash,
          parentHash: block(number - 1).hash,
          timestamp: `0x${(number + 1000).toString(16)}`,
          transactions: [],
        },
      };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(request) ? request.map(reply) : reply(request)
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
  const context = {
    effect: async () => {
      effects++;
      throw new Error("A cached entity must not need an effect");
    },
    KernelReadEpoch: { get: async () => undefined },
    Contract: {
      get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
    },
    KernelReadCache: {
      get: async () => ({
        epoch: "initial",
        result: { status: "success", value },
        verifiedAt: block(10),
      }),
    },
  };
  const read = () =>
    getControlGetter(
      context,
      {
        chainId: 1,
        address: proof.address,
        getter: "ROLES",
        blockNumber: 11n,
        blockHash: block(11).hash,
      },
      block(11)
    );
  try {
    const result = await read();
    assert.equal(result.status, "success");
    assert.equal(result.value, value);
    assert.deepEqual(result.verifiedAt, block(10));
    assert.equal(
      effects,
      0,
      "Kernel state must be checked before source/code discovery"
    );
    forked = true;
    assert.equal((await read()).status, "unavailable");
    assert.equal(
      effects,
      0,
      "an orphaned entity fact is rejected without a discovery detour"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
