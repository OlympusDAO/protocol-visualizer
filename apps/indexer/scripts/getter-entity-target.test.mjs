import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { keccak256 } from "viem";
import manifest from "../src/generated/deployment-facts.json" with {
  type: "json",
};
import { getControlGetter } from "../src/events/effects.ts";
import { withCanonicalObservation } from "../src/events/canonical-observation.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("mutable getter facts classify targets through independently verified entity code", async () => {
  const source = manifest[0],
    target = `0x${"87".repeat(20)}`,
    number = 26290000n;
  const hash = (height) => `0x${height.toString(16).padStart(64, "0")}`;
  const entities = new Map();
  for (const [address, creationBlock, codeHash] of [
    [source.address, BigInt(source.creationBlock), source.codeHash],
    [target, 10n, keccak256("0x6000")],
  ])
    entities.set(`verified-deployment:1:${address}`, {
      id: `verified-deployment:1:${address}`,
      chainId: 1,
      address,
      creationBlock,
      creationHash: hash(creationBlock),
      codeHash,
      version: "ordinary-runtime-v1",
      verifiedAt: {
        number: creationBlock.toString(),
        hash: hash(creationBlock),
        timestamp: "256",
      },
    });
  let codes = 0,
    calls = 0,
    headers = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const reply = ({ method, id, params }) => {
      let result;
      if (method === "eth_getBlockByNumber") {
        headers++;
        const height = BigInt(params[0]);
        result = {
          number: params[0],
          hash: hash(height),
          parentHash: hash(height - 1n),
          timestamp: "0x100",
          transactions: [],
        };
      } else if (method === "eth_call") {
        calls++;
        result = `0x${target.slice(2).padStart(64, "0")}`;
      } else if (method === "eth_getCode") {
        codes++;
        result =
          params[0] === source.address ? source.runtimeBytecode : "0x6000";
      } else throw new Error(`Unexpected ${method}`);
      return { jsonrpc: "2.0", id, result };
    };
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
  const context = await makeEffectRuntime();
  context.VerifiedDeployment = {
    get: async (id) => entities.get(id),
    set: (row) => entities.set(row.id, row),
  };
  try {
    await withCanonicalObservation(1, number, async (phase) => {
      const result = await getControlGetter(
        context,
        {
          chainId: 1,
          address: source.address,
          getter: "owner",
          blockNumber: number,
          blockHash: hash(number),
        },
        phase.block,
        phase.readCanonicalBlock
      );
      assert.equal(result.status, "success");
      assert.equal(result.value, target);
      assert.equal(result.targetCode, "present");
      return true;
    });
    assert.equal(
      codes,
      0,
      "the fact effect must not bypass verified source or target entity code"
    );
    assert.equal(calls, 1);
    assert.equal(
      headers,
      6,
      "current, source creation and target creation each get opening/final checks"
    );
  } finally {
    await new Promise((done) => server.close(done));
  }
});
