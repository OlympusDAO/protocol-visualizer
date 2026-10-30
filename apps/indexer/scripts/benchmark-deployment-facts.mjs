import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import {
  getControlGetter,
  readControlGetterEffect,
} from "../src/events/effects.ts";
import deployments from "../src/generated/deployment-facts.json" with {
  type: "json",
};
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

const require = createRequire(import.meta.url);
const postgres = createRequire(require.resolve("envio"))("postgres");
const deployment = deployments[0],
  creation = BigInt(deployment.creationBlock);
const block = (number) => ({
  number: String(number),
  hash: `0x${BigInt(number).toString(16).padStart(64, "0")}`,
  timestamp: String(Number(number) + 1700000000),
});
const target = `0x${"34".repeat(20)}`,
  raw = `0x${target.slice(2).padStart(64, "0")}`;
let counts = {};
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const respond = async (rpc) => {
    counts[rpc.method] = (counts[rpc.method] ?? 0) + 1;
    await pause(10);
    let result;
    if (rpc.method === "eth_getBlockByNumber") {
      const n = BigInt(rpc.params[0]),
        b = block(n);
      result = {
        ...b,
        number: rpc.params[0],
        timestamp: `0x${Number(b.timestamp).toString(16)}`,
        parentHash: block(n - 1n).hash,
      };
    } else if (rpc.method === "eth_getCode")
      result =
        rpc.params[0] === deployment.address
          ? rpc.params[1].blockHash === block(creation - 1n).hash
            ? "0x"
            : deployment.runtimeBytecode
          : "0x6000";
    else if (rpc.method === "eth_call") result = raw;
    else throw new Error(`Unexpected ${rpc.method}`);
    return { jsonrpc: "2.0", id: rpc.id, result };
  };
  const payload = JSON.parse(body);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      Array.isArray(payload)
        ? await Promise.all(payload.map(respond))
        : await respond(payload)
    )
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
const mode = process.argv[2] ?? "after";
assert(["before", "after"].includes(mode));
const sql = postgres(process.env.RPC_BENCH_DATABASE_URL, { max: 1 }),
  runs = [];
try {
  await sql`CREATE TEMP TABLE deployment_benchmark (run int, effect text, id text, output jsonb, PRIMARY KEY(run,effect,id))`;
  for (let run = 0; run < 3; run++) {
    const storage = {
      readRows: (effect, ids) =>
        sql`SELECT id,output FROM deployment_benchmark WHERE run=${run} AND effect=${effect} AND id IN ${sql(ids)}`,
      writeRows: async (effect, rows) => {
        await sql`INSERT INTO deployment_benchmark ${sql(
          rows.map((row) => ({
            run,
            effect,
            ...row,
            output: sql.json(row.output),
          })),
          "run",
          "effect",
          "id",
          "output"
        )} ON CONFLICT DO NOTHING`;
      },
    };
    let runtime = await makeEffectRuntime(storage);
    counts = {};
    const start = performance.now();
    let cold;
    for (let checkpoint = 0; checkpoint < 10; checkpoint++) {
      const b = block(creation + 100n + BigInt(checkpoint));
      for (const signature of Object.values(deployment.immutableGetters)) {
        const input = {
          chainId: 1,
          address: deployment.address,
          blockNumber: BigInt(b.number),
          blockHash: b.hash,
          getter: signature.replace("()", ""),
        };
        const result =
          mode === "after"
            ? await getControlGetter(runtime, input, b)
            : await runtime.effect(readControlGetterEffect, input);
        assert.equal(result.status, "success");
        assert.equal(result.value, target);
        if (mode === "after")
          assert.equal(result.verifiedAt.number, deployment.creationBlock);
      }
      if (checkpoint === 0) {
        cold = { ...counts };
        counts = {};
      }
      await runtime.flush();
      // Separate checkpoint loaders: the persisted cache, not batch memoization, must provide reuse.
      runtime = await makeEffectRuntime(storage);
    }
    runs.push({
      elapsedMs: performance.now() - start,
      coldRequests: cold,
      warmNineCheckpoints: counts,
    });
  }
  console.log(
    JSON.stringify({
      fixture: true,
      storage: "postgres-adapter",
      mode,
      checkpoints: 10,
      gettersPerBlock: 7,
      latencyMs: 10,
      restartEveryCheckpoint: true,
      medianElapsedMs: runs.map((r) => r.elapsedMs).sort((a, b) => a - b)[1],
      runs,
    })
  );
} finally {
  await sql.end();
  await new Promise((done) => server.close(done));
}
