// Controlled source-bound fixtures; never an estimate of live provider billing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire, registerHooks } from "node:module";
import { setTimeout as pause } from "node:timers/promises";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";
const require = createRequire(import.meta.url);
const { keccak256, toFunctionSelector } = require("viem");
const code = "0x6001600055",
  codeHash = keccak256(code);
registerHooks({
  load(url, context, next) {
    if (url.endsWith("/generated/kernel-read-proofs.json")) {
      const data = JSON.parse(readFileSync(new URL(url), "utf8"));
      for (const proof of data) proof.codeHash = codeHash;
      return {
        format: "module",
        source: `export default ${JSON.stringify(data)}`,
        shortCircuit: true,
      };
    }
    if (url.endsWith("/generated/contract-metadata.json")) {
      const data = JSON.parse(readFileSync(new URL(url), "utf8"));
      for (const chain of Object.values(data))
        for (const contract of Object.values(chain))
          for (const fn of Object.values(contract.functionSelectors))
            if (fn.documentation?.source)
              fn.documentation.source.codeHash = codeHash;
      return {
        format: "module",
        source: `export default ${JSON.stringify(data)}`,
        shortCircuit: true,
      };
    }
    return next(url, context);
  },
});
const { default: proofs } = await import(
  "../src/generated/kernel-read-proofs.json",
  { with: { type: "json" } }
);
const { getControlGetter, getModuleDependencies, readControlGetterEffect } =
  await import("../src/events/effects.ts");
const { getEffectClient } = await import("../src/events/call-cache.ts");
const { readPinnedModuleDependencies } = await import(
  "../src/events/module-dependencies.ts"
);
const kernel = proofs.find((p) => p.name === "kernel").address;
const fields = proofs.flatMap((p) =>
  p.getters.map((getter) => ({ address: p.address, getter }))
);
const block = (number) => ({
  number: String(number),
  hash: `0x${BigInt(number).toString(16).padStart(64, "0")}`,
  timestamp: String(number + 1700000000),
});
const target = `0x${"34".repeat(20)}`;
const depsSelector = toFunctionSelector("moduleDependents(bytes5,uint256)");
let counts = {};
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const respond = async (rpc) => {
    counts[rpc.method] = (counts[rpc.method] ?? 0) + 1;
    await pause(10);
    let result, error;
    if (rpc.method === "eth_getBlockByNumber") {
      const b = block(Number(BigInt(rpc.params[0])));
      result = {
        ...b,
        number: rpc.params[0],
        timestamp: `0x${Number(b.timestamp).toString(16)}`,
        parentHash: block(Number(b.number) - 1).hash,
      };
    } else if (rpc.method === "eth_getCode") result = code;
    else if (rpc.method === "eth_call") {
      const data = rpc.params[0].data;
      if (data.startsWith(depsSelector) && BigInt(`0x${data.slice(-64)}`) >= 2n)
        error = { code: 3, message: "execution reverted" };
      else
        result = `0x${(data === toFunctionSelector("kernel()") ? kernel : data.startsWith(depsSelector) ? `0x${(Number(BigInt(`0x${data.slice(-64)}`)) + 1).toString(16).padStart(40, "0")}` : target).slice(2).padStart(64, "0")}`;
    } else throw new Error(`Unexpected ${rpc.method}`);
    return { id: rpc.id, jsonrpc: "2.0", ...(error ? { error } : { result }) };
  };
  const payload = JSON.parse(raw);
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
const postgres = createRequire(require.resolve("envio"))("postgres");
const sql = postgres(process.env.RPC_BENCH_DATABASE_URL, { max: 1 });
const runs = [];
try {
  await sql`CREATE TEMP TABLE kernel_benchmark (run int, namespace text, id text, output jsonb, PRIMARY KEY(run,namespace,id))`;
  for (let run = 0; run < 3; run++) {
    const readRows = (namespace, ids) =>
      sql`SELECT id,output FROM kernel_benchmark WHERE run=${run} AND namespace=${namespace} AND id IN ${sql(ids)}`;
    const writeRows = async (namespace, rows) => {
      await sql`INSERT INTO kernel_benchmark ${sql(
        rows.map((row) => ({ run, namespace, ...row })),
        "run",
        "namespace",
        "id",
        "output"
      )} ON CONFLICT (run,namespace,id) DO UPDATE SET output=EXCLUDED.output`;
    };
    let runtime = await makeEffectRuntime({ readRows, writeRows });
    const entities = {};
    const entity = (name) => ({
      get: async (id) => {
        const pending = entities[`${name}:${id}`];
        if (pending) return pending;
        return (await readRows(name, [id]))[0]?.output;
      },
      set: (row) => {
        entities[`${name}:${row.id}`] = structuredClone(row);
      },
    });
    const ctx = () => ({
      ...runtime,
      KernelReadEpoch: entity("epoch"),
      KernelReadCache: entity("facts"),
      Contract: {
        get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
      },
    });
    counts = {};
    let cold, warm;
    const start = performance.now();
    for (let number = 17000000; number < 17000010; number++) {
      const b = block(number);
      for (const field of fields) {
        const input = {
          chainId: 1,
          ...field,
          blockNumber: BigInt(number),
          blockHash: b.hash,
        };
        const result =
          mode === "after"
            ? await getControlGetter(ctx(), input, b)
            : await runtime.effect(readControlGetterEffect, input);
        assert.equal(result.status, "success");
        if (mode === "after" && number > 17000000)
          assert.equal(result.verifiedAt.number, "17000000");
      }
      for (const keycode of ["ROLES", "MINTR", "TRSRY"]) {
        const input = {
          chainId: 1,
          kernel,
          keycode,
          blockNumber: BigInt(number),
          blockHash: b.hash,
        };
        const result =
          mode === "after"
            ? await getModuleDependencies(ctx(), input)
            : await readPinnedModuleDependencies(
                getEffectClient(runtime, 1),
                input
              );
        assert.equal(result.status, "success");
        assert.equal(result.policies.length, 2);
        if (mode === "after" && number > 17000000)
          assert.equal(result.verifiedAt.number, "17000000");
      }
      if (number === 17000000) {
        cold = { ...counts };
        counts = {};
      }
      if (number === 17000004) {
        await runtime.flush();
        for (const name of ["epoch", "facts"]) {
          const rows = Object.entries(entities)
            .filter(([key]) => key.startsWith(`${name}:`))
            .map(([, output]) => ({ id: output.id, output }));
          if (rows.length) await writeRows(name, rows);
        }
        for (const key of Object.keys(entities)) delete entities[key];
        runtime = await makeEffectRuntime({ readRows, writeRows });
      }
    }
    warm = { ...counts };
    runs.push({
      elapsedMs: performance.now() - start,
      coldRequests: cold,
      warmNineCheckpoints: warm,
    });
  }
  console.log(
    JSON.stringify({
      fixture: true,
      storage: "postgres-adapter",
      mode,
      pointerOperationsPerBlock: fields.length,
      dependencyScansPerBlock: 3,
      checkpoints: 10,
      latencyMs: 10,
      restartAfterCheckpoint: 5,
      medianElapsedMs: runs.map((r) => r.elapsedMs).sort((a, b) => a - b)[1],
      runs,
    })
  );
} finally {
  await sql.end();
  await new Promise((done) => server.close(done));
}
