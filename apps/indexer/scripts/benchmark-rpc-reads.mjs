import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire, registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

const { values } = parseArgs({
  options: {
    "source-root": { type: "string" },
    repetitions: { type: "string", default: "3" },
    "latency-ms": { type: "string", default: "10" },
    limit: { type: "string" },
  },
});
const root = resolve(
  values["source-root"] ?? fileURLToPath(new URL("../../../", import.meta.url))
);
const repetitions = Number(values.repetitions);
const latencyMs = Number(values["latency-ms"]);
const limit = values.limit === undefined ? Infinity : Number(values.limit);
assert(Number.isInteger(repetitions) && repetitions > 0);
assert(Number.isFinite(latencyMs) && latencyMs >= 0);
assert(limit === Infinity || (Number.isInteger(limit) && limit > 0));
const require = createRequire(new URL("../package.json", import.meta.url));
const { keccak256 } = require("viem");
const code = "0x600160005560006000f3";
const codeHash = keccak256(code);
const metadataUrl = pathToFileURL(
  resolve(root, "apps/indexer/src/generated/contract-metadata.json")
).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url !== metadataUrl) return nextLoad(url, context);
    const metadata = JSON.parse(readFileSync(new URL(url), "utf8"));
    for (const chain of Object.values(metadata))
      for (const contract of Object.values(chain))
        for (const fn of Object.values(contract.functionSelectors))
          if (fn.documentation?.source)
            fn.documentation.source.codeHash = codeHash;
    return {
      format: "module",
      source: `export default ${JSON.stringify(metadata)}`,
      shortCircuit: true,
    };
  },
});
const source = (file) =>
  import(pathToFileURL(resolve(root, "apps/indexer/src", file)));
const { getRelationshipFields } = await source("events/ownership-contracts.ts");
const { readControlGetterEffect } = await source("events/effects.ts");
const blockNumber = 17_238_767n;
const blockHash = `0x${"ab".repeat(32)}`;
const target = "0x0000000000000000000000000000000000000999";
const fields = getRelationshipFields(1)
  .filter((field) => field.startBlock <= Number(blockNumber))
  .slice(0, limit);
assert(fields.length > 0);
let counts = {};
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw);
  const respond = async ({ id, method, params }) => {
    counts[method] = (counts[method] ?? 0) + 1;
    await pause(latencyMs);
    let result;
    switch (method) {
      case "eth_getBlockByNumber":
        result = {
          number: params[0],
          hash: blockHash,
          parentHash: `0x${"cd".repeat(32)}`,
          timestamp: "0x65000000",
          transactions: [],
        };
        break;
      case "eth_getCode":
        assert.deepEqual(params[1], { blockHash, requireCanonical: true });
        result = code;
        break;
      case "eth_call":
        assert.deepEqual(params[1], { blockHash, requireCanonical: true });
        result = `0x${target.slice(2).padStart(64, "0")}`;
        break;
      default:
        throw new Error(`Unexpected fixture method ${method}`);
    }
    return { jsonrpc: "2.0", id, result };
  };
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
let sql;
const runs = [];
try {
  if (process.env.RPC_BENCH_DATABASE_URL) {
    const postgres = createRequire(require.resolve("envio"))("postgres");
    sql = postgres(process.env.RPC_BENCH_DATABASE_URL, { max: 1 });
    await sql`CREATE TEMP TABLE rpc_read_benchmark (run int, effect text, id text, output jsonb, PRIMARY KEY(run, effect, id))`;
  }
  for (let run = 0; run < repetitions; run++) {
    const storage = sql
      ? {
          readRows: (effect, ids) =>
            sql`SELECT id, output FROM rpc_read_benchmark WHERE run=${run} AND effect=${effect} AND id IN ${sql(ids)}`,
          writeRows: async (effect, rows) => {
            await sql`INSERT INTO rpc_read_benchmark ${sql(
              rows.map((row) => ({ run, effect, ...row })),
              "run",
              "effect",
              "id",
              "output"
            )} ON CONFLICT DO NOTHING`;
          },
        }
      : { rows: new Map() };
    const runtime = await makeEffectRuntime(storage);
    counts = {};
    const start = performance.now();
    const results = [];
    for (const field of fields) {
      const result = await runtime.effect(readControlGetterEffect, {
        chainId: 1,
        address: field.address,
        blockNumber,
        blockHash,
        getter: field.getter,
      });
      assert.equal(
        result.status,
        "success",
        `${field.address}:${field.getter}`
      );
      results.push(result);
    }
    const elapsedMs = performance.now() - start;
    await runtime.flush();
    const coldCounts = counts;
    const restarted = await makeEffectRuntime(storage);
    counts = {};
    for (const field of fields)
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(
            await restarted.effect(readControlGetterEffect, {
              chainId: 1,
              address: field.address,
              blockNumber,
              blockHash,
              getter: field.getter,
            })
          )
        ),
        JSON.parse(JSON.stringify(results[fields.indexOf(field)]))
      );
    const bytecodeEffect = Object.values(runtime.state.effectState.tables).find(
      ({ effect }) => effect.name === "readPinnedBytecodeHash"
    )?.effect;
    if (bytecodeEffect)
      for (const address of new Set([
        ...fields.map((field) => field.address),
        target,
      ]))
        assert.equal(
          await restarted.effect(bytecodeEffect, {
            chainId: 1,
            address,
            blockHash,
          }),
          codeHash
        );
    assert.equal(
      Object.values(counts).reduce((sum, value) => sum + value, 0),
      0
    );
    runs.push({
      elapsedMs,
      requests: coldCounts,
      resultDigest: createHash("sha256")
        .update(JSON.stringify(results))
        .digest("hex"),
      restartRequests: 0,
      bytecodeRestartVerified: Boolean(bytecodeEffect),
      effects: Object.fromEntries(
        Object.values(runtime.state.effectState.tables).map(({ stats }) => [
          stats.effectName,
          { calls: stats.callCount, queueWaitSeconds: stats.queueWaitSeconds },
        ])
      ),
    });
  }
  console.log(
    JSON.stringify({
      fixture: true,
      storage: sql ? "postgres-adapter" : "memory-adapter",
      envio: require("envio/package.json").version,
      blockNumber: Number(blockNumber),
      getters: fields.length,
      subjects: new Set(fields.map((field) => field.address)).size,
      latencyMs,
      sharedReturnedTarget: true,
      medianElapsedMs: runs.map((run) => run.elapsedMs).sort((a, b) => a - b)[
        Math.floor(runs.length / 2)
      ],
      runs,
    })
  );
} finally {
  await sql?.end({ timeout: 2 });
  await new Promise((done) => server.close(done));
}
