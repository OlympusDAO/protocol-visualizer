import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { keccak256 } from "viem";
import { getDeploymentFact } from "../src/events/deployment-facts.ts";
import { getControlGetter } from "../src/events/effects.ts";
import manifest from "../src/generated/deployment-facts.json" with {
  type: "json",
};
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

const deployment = manifest[0];
const creation = BigInt(deployment.creationBlock);
const hash = `0x${"11".repeat(32)}`;
const creationHash = `0x${"22".repeat(32)}`;
const priorHash = `0x${"33".repeat(32)}`;
const fork = `0x${"44".repeat(32)}`;
const raw = `0x${"00".repeat(12)}${"55".repeat(20)}`;
const data = Object.keys(deployment.immutableGetters)[0];

test("verified deployment facts obey lifetime boundaries, raw allowlist, canonical forks and persisted restarts", async () => {
  assert.equal(keccak256(deployment.runtimeBytecode), deployment.codeHash);
  const calls = [];
  let wrongRuntime = false;
  let priorCode = "0x";
  let currentHash = hash;
  let deployedHash = creationHash;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const response = (rpc) => {
      calls.push(rpc);
      let result;
      if (rpc.method === "eth_getBlockByNumber") {
        const number = BigInt(rpc.params[0]);
        result = {
          number: rpc.params[0],
          hash: number === creation ? deployedHash : currentHash,
          parentHash: priorHash,
          timestamp: "0x100",
        };
      } else if (rpc.method === "eth_getCode") {
        result =
          rpc.params[1].blockHash === priorHash
            ? priorCode
            : wrongRuntime
              ? "0x6000"
              : deployment.runtimeBytecode;
      } else if (rpc.method === "eth_call") result = raw;
      else throw new Error(`Unexpected ${rpc.method}`);
      return { jsonrpc: "2.0", id: rpc.id, result };
    };
    const payload = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(response) : response(payload)
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
  try {
    const input = {
      chainId: 1,
      address: deployment.address,
      blockNumber: creation + 100n,
      blockHash: hash,
      data,
    };
    let runtime = await makeEffectRuntime();
    const getter = await getControlGetter(runtime, {
      ...input,
      getter: deployment.immutableGetters[data].replace("()", ""),
    });
    assert.equal(getter.status, "success");
    assert.equal(getter.verifiedAt.number, deployment.creationBlock);
    calls.length = 0;
    runtime = await makeEffectRuntime();
    for (const patch of [
      { chainId: 10 },
      { address: `0x${"66".repeat(20)}` },
      { blockNumber: creation - 1n },
      { data: "0x8da5cb5b" }, // owner() is mutable, despite its address return type.
      { data: `${data}00` },
    ])
      assert.equal(
        await getDeploymentFact(runtime, { ...input, ...patch }),
        undefined
      );
    assert.equal(
      calls.length,
      0,
      "unknown/predeployment/non-allowlisted calls keep the normal read path"
    );

    wrongRuntime = true;
    assert.equal(await getDeploymentFact(runtime, input), undefined);
    await runtime.flush();
    assert.equal(
      runtime.rows.size,
      0,
      "runtime mismatch cannot persist a deployment fact"
    );
    wrongRuntime = false;
    priorCode = "0x6000";
    runtime = await makeEffectRuntime();
    assert.equal(await getDeploymentFact(runtime, input), undefined);
    await runtime.flush();
    assert.equal(
      runtime.rows.size,
      0,
      "an earlier incarnation does not prove the declared creation boundary"
    );

    priorCode = "0x";
    runtime = await makeEffectRuntime();
    const fact = await getDeploymentFact(runtime, input);
    assert.deepEqual(fact, {
      codeHash: deployment.codeHash,
      data: raw,
      verifiedAt: {
        number: deployment.creationBlock,
        hash: creationHash,
        timestamp: "256",
      },
    });
    await runtime.flush();
    const reads = () =>
      calls.filter((rpc) => ["eth_getCode", "eth_call"].includes(rpc.method));
    const beforeRestart = reads().length;
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    assert.deepEqual(
      await getDeploymentFact(runtime, {
        ...input,
        blockNumber: creation + 200n,
      }),
      fact
    );
    assert.equal(
      reads().length,
      beforeRestart,
      "facts and raw immutable return bytes survive a runtime restart"
    );
    assert.deepEqual(
      (await getDeploymentFact(runtime, { ...input, data: undefined }))
        .codeHash,
      deployment.codeHash
    );
    assert.equal(
      reads().length,
      beforeRestart,
      "code-only consumers reuse the same deployment proof"
    );

    currentHash = fork;
    assert.equal(
      await getDeploymentFact(runtime, input),
      undefined,
      "a stale requested block pin is rejected"
    );
    currentHash = hash;
    deployedHash = fork;
    const afterFork = await getDeploymentFact(runtime, input);
    assert.equal(afterFork.verifiedAt.hash, fork);
    assert.equal(
      reads().length,
      beforeRestart + 3,
      "a forked deployment requires new prior/runtime/raw verification"
    );
    assert.ok(reads().every((rpc) => rpc.params[1].requireCanonical === true));
  } finally {
    delete process.env.ENVIO_RPC_URL_1;
    await new Promise((resolve) => server.close(resolve));
  }
});
