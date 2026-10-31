import assert from "node:assert/strict";
import http from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";
import proofs from "../src/generated/kernel-read-proofs.json" with {
  type: "json",
};

const root = resolve(process.argv[2] ?? "../..");
const { getControlGetter } = await import(
  pathToFileURL(resolve(root, "apps/indexer/src/events/effects.ts"))
);
const proof = proofs.find((row) => row.getters.includes("ROLES"));
const value = `0x${"34".repeat(20)}`;
const block = (number) => ({
  number: String(number),
  hash: `0x${String(number).padStart(64, "0")}`,
  timestamp: String(number + 1000),
});
let counts = {};
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  const reply = async ({ id, method, params }) => {
    counts[method] = (counts[method] ?? 0) + 1;
    await pause(10);
    const result =
      method === "eth_getCode"
        ? "0x6000"
        : method === "eth_getBlockByNumber"
          ? {
              number: params[0],
              hash: block(Number(BigInt(params[0]))).hash,
              parentHash: block(Number(BigInt(params[0])) - 1).hash,
              timestamp: "0x1000",
              transactions: [],
            }
          : undefined;
    assert(result !== undefined, `Unexpected ${method}`);
    return { jsonrpc: "2.0", id, result };
  };
  const input = JSON.parse(body);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      Array.isArray(input)
        ? await Promise.all(input.map(reply))
        : await reply(input)
    )
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
const runs = [];
try {
  for (let run = 0; run < 3; run++) {
    counts = {};
    let effects = 0;
    const rows = new Map();
    const start = performance.now();
    for (let number = 11; number <= 20; number++) {
      const runtime = await makeEffectRuntime({ rows });
      const context = {
        ...runtime,
        effect: (...args) => {
          effects++;
          return runtime.effect(...args);
        },
        KernelReadEpoch: { get: async () => undefined },
        KernelReadCache: {
          get: async () => ({
            epoch: "initial",
            result: { status: "success", value },
            verifiedAt: block(10),
          }),
        },
        Contract: {
          get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
        },
      };
      const result = await getControlGetter(
        context,
        {
          chainId: 1,
          address: proof.address,
          getter: "ROLES",
          blockNumber: BigInt(number),
          blockHash: block(number).hash,
        },
        block(number)
      );
      assert.equal(result.value, value);
      assert.deepEqual(result.verifiedAt, block(10));
      await runtime.flush();
    }
    runs.push({
      milliseconds: performance.now() - start,
      requests: { ...counts },
      effects,
    });
  }
  const times = runs.map((run) => run.milliseconds).sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify(
      {
        fixture: true,
        latencyMillisecondsPerRpc: 10,
        preseededKernelFact: true,
        checkpoints: 10,
        loaderRestartPerCheckpoint: true,
        medianMilliseconds: times[1],
        runs,
      },
      null,
      2
    ) + "\n"
  );
} finally {
  await new Promise((done) => server.close(done));
}
