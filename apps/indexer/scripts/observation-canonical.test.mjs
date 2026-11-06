import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { toFunctionSelector } from "viem";
import {
  getControlGetter,
  getBridgeConfiguration,
  getModuleDependencies,
  getCanonicalCodeHash,
} from "../src/events/effects.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("persisted successful observations reject orphaned pins after restart and read replacement-fork state", async () => {
  const chainId = 999957,
    address = `0x${"77".repeat(20)}`;
  const originalHash = `0x${"ab".repeat(32)}`,
    replacementHash = `0x${"cd".repeat(32)}`;
  const originalTarget = `0x${"11".repeat(20)}`,
    replacementTarget = `0x${"22".repeat(20)}`;
  let canonicalHash = originalHash,
    target = originalTarget;
  let calls = 0,
    codes = 0,
    headers = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const reply = (rpc) => {
      let result, error;
      if (rpc.method === "eth_getBlockByNumber") {
        headers++;
        result = {
          number: rpc.params[0],
          hash: canonicalHash,
          timestamp: "0x100",
          parentHash: replacementHash,
        };
      } else if (rpc.method === "eth_getCode") {
        codes++;
        result = "0x6000";
      } else if (rpc.method === "eth_call") {
        calls++;
        if (
          rpc.params[0].data.startsWith(
            toFunctionSelector("moduleDependents(bytes5,uint256)")
          )
        )
          error = { code: 3, message: "execution reverted" };
        else result = `0x${target.slice(2).padStart(64, "0")}`;
      } else throw new Error(`Unexpected ${rpc.method}`);
      return {
        id: rpc.id,
        jsonrpc: "2.0",
        ...(error ? { error } : { result }),
      };
    };
    const payload = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(reply) : reply(payload)
      )
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  process.env[`ENVIO_RPC_URL_${chainId}`] =
    `http://127.0.0.1:${server.address().port}`;
  const input = (hash) => ({
    chainId,
    address,
    blockNumber: 10n,
    blockHash: hash,
  });
  const observation = (hash) => ({ number: "10", hash, timestamp: "256" });
  const reads = [
    (context, hash) =>
      getControlGetter(
        context,
        { ...input(hash), getter: "owner" },
        observation(hash)
      ),
    (context, hash) =>
      getBridgeConfiguration(context, {
        ...input(hash),
        kind: "bridge",
        selectors: [],
      }),
    (context, hash) =>
      getModuleDependencies(context, {
        ...input(hash),
        kernel: address,
        keycode: "MINTR",
      }),
  ];
  try {
    let context = await makeEffectRuntime();
    const original = [];
    for (const read of reads) {
      const result = await read(context, originalHash);
      assert.equal(result.status, "success");
      original.push(result);
    }
    const originalCode = await getCanonicalCodeHash(
      context,
      input(originalHash)
    );
    assert(originalCode);
    await context.flush();
    context = await makeEffectRuntime({ rows: context.rows });
    const before = { calls, codes, headers };
    for (const [index, read] of reads.entries())
      assert.deepEqual(
        JSON.parse(JSON.stringify(await read(context, originalHash))),
        JSON.parse(JSON.stringify(original[index]))
      );
    assert.equal(
      calls,
      before.calls,
      "persisted raw calls avoid repeated EVM requests"
    );
    assert.equal(
      codes,
      before.codes,
      "persisted code facts avoid repeated code requests"
    );
    assert(
      headers > before.headers,
      "a cache hit still needs a fresh canonical acceptance check"
    );
    canonicalHash = replacementHash;
    target = replacementTarget;
    // Use a fresh loader, retaining the persisted old-fork results.
    context = await makeEffectRuntime({ rows: context.rows });
    assert.equal(
      await getCanonicalCodeHash(context, input(originalHash)),
      undefined,
      "an orphaned persisted code observation cannot establish current deployment"
    );
    for (const read of reads)
      assert.equal(
        (await read(context, originalHash)).status,
        "unavailable",
        "an orphaned persisted result must not be accepted as canonical"
      );
    const replacement = [];
    for (const read of reads) {
      const result = await read(context, replacementHash);
      assert.equal(result.status, "success");
      replacement.push(result);
    }
    assert.equal(replacement[0].value, replacementTarget);
    assert.equal(JSON.parse(replacement[1].value).token, replacementTarget);
    assert.equal(replacement[2].module, replacementTarget);
    assert(
      calls > before.calls,
      "the replacement hash must not borrow old-fork calls"
    );
  } finally {
    delete process.env[`ENVIO_RPC_URL_${chainId}`];
    await new Promise((done) => server.close(done));
  }
});
