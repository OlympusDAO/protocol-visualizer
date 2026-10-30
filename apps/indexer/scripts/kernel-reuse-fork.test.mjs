import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import http from "node:http";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/,
  ""
);
const require = createRequire(`${root}/apps/indexer/package.json`);
const { keccak256, toFunctionSelector } = require("viem");
const code = "0x6001600055",
  codeHash = keccak256(code);
registerHooks({
  load(url, c, next) {
    if (
      url.endsWith("/generated/kernel-read-proofs.json") ||
      url.endsWith("/generated/contract-metadata.json")
    ) {
      const data = JSON.parse(readFileSync(new URL(url), "utf8"));
      if (Array.isArray(data)) for (const p of data) p.codeHash = codeHash;
      else
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
    return next(url, c);
  },
});
const { makeEffectRuntime } = await import(
  `${root}/apps/indexer/scripts/fixtures/effect-runtime.mjs`
);
const { getControlGetter } = await import(
  `${root}/apps/indexer/src/events/effects.ts`
);
const { default: proofs } = await import(
  `${root}/apps/indexer/src/generated/kernel-read-proofs.json`,
  { with: { type: "json" } }
);
const kernel = proofs.find((p) => p.name === "kernel").address;
const subject = proofs.find((p) => p.name === "rolesadmin").address;
const target = `0x${"34".repeat(20)}`;
const block = (n) => ({
  number: String(n),
  hash: `0x${n.toString(16).padStart(64, "0")}`,
  timestamp: String(n + 1700000000),
});
let fork = false,
  forkOnCode = false,
  wrongKernelCode = false,
  kernelPointer = kernel,
  getterTarget = target;
const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const reply = (rpc) => {
    let result;
    if (rpc.method === "eth_getBlockByNumber") {
      const b = block(Number(BigInt(rpc.params[0])));
      result = {
        ...b,
        number: rpc.params[0],
        timestamp: "0x100",
        parentHash: block(9).hash,
        hash: fork && b.number === "11" ? `0x${"ff".repeat(32)}` : b.hash,
      };
    } else if (rpc.method === "eth_getCode") {
      result =
        wrongKernelCode && rpc.params[0].toLowerCase() === kernel
          ? "0x6002"
          : code;
      if (forkOnCode && rpc.params[0].toLowerCase() === target) fork = true;
    } else if (rpc.method === "eth_call")
      result = `0x${(rpc.params[0].data === toFunctionSelector("kernel()") ? kernelPointer : getterTarget).slice(2).padStart(64, "0")}`;
    return { id: rpc.id, jsonrpc: "2.0", result };
  };
  const payload = JSON.parse(raw);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload))
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
try {
  const rows = new Map(),
    store = () => ({
      get: async (id) => rows.get(id),
      set: (row) => rows.set(row.id, structuredClone(row)),
    });
  const ctx = {
    ...(await makeEffectRuntime()),
    KernelReadCache: store(),
    KernelReadEpoch: store(),
    Contract: {
      get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
    },
  };
  const input = (n) => ({
    chainId: 1,
    address: subject,
    getter: "ROLES",
    blockNumber: BigInt(n),
    blockHash: block(n).hash,
  });
  await getControlGetter(ctx, input(10), block(10));
  forkOnCode = true;
  const result = await getControlGetter(ctx, input(11), block(11));
  assert.equal(fork, true);
  assert.equal(
    result.status,
    "unavailable",
    "a fork during target-code refresh must reject reuse"
  );
  fork = false;
  forkOnCode = false;
  for (const binding of ["wrong-runtime", "wrong-pointer", "matching"]) {
    rows.clear();
    const context = { ...ctx, ...(await makeEffectRuntime()) };
    wrongKernelCode = binding === "wrong-runtime";
    kernelPointer =
      binding === "wrong-pointer" ? `0x${"56".repeat(20)}` : kernel;
    getterTarget = target;
    assert.equal(
      (await getControlGetter(context, input(20), block(20))).value,
      target
    );
    getterTarget = `0x${"78".repeat(20)}`;
    const next = await getControlGetter(context, input(21), block(21));
    assert.equal(
      next.value,
      binding === "matching" ? target : getterTarget,
      binding
    );
    assert.equal(
      [...rows.values()].filter((row) => row.result).length,
      binding === "matching" ? 1 : 0,
      binding
    );
  }
} finally {
  await new Promise((done) => server.close(done));
}
