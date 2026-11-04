import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { encodeAbiParameters, toFunctionSelector } from "viem";
import { CanonicalObservationChanged } from "../src/events/canonical-observation.ts";
import { parseContractName } from "../src/events/contractParsing.ts";
import {
  getKernelExecutor,
  getModuleForKeycode,
  getModuleKeycode,
  getRequestedPolicyPermissions,
  getRolesAdmin,
} from "../src/events/effects.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

test("Kernel reads persist by hash, reject forks and missing pins, and never fall back to latest", async () => {
  const chain = 999974,
    address = `0x${"77".repeat(20)}`;
  const hash = `0x${"ab".repeat(32)}`,
    fork = `0x${"cd".repeat(32)}`;
  const first = `0x${"11".repeat(20)}`,
    second = `0x${"22".repeat(20)}`;
  const keycode = "0x524f4c4553";
  const permissionsSelector = toFunctionSelector("requestPermissions()");
  const keycodeSelector = toFunctionSelector("KEYCODE()");
  const requests = [];
  let canonical = hash,
    headers = 0,
    flipAt = 0,
    error,
    invalidKeycode = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    const reply = (rpc) => {
      requests.push(rpc);
      let result;
      if (rpc.method === "eth_getBlockByNumber") {
        if (++headers === flipAt) canonical = fork;
        result = {
          number: rpc.params[0],
          hash: canonical,
          timestamp: "0x100",
          transactions: [],
        };
      } else if (rpc.method === "eth_call") {
        if (error) return { jsonrpc: "2.0", id: rpc.id, error };
        const value = rpc.params[1]?.blockHash === hash ? first : second;
        const selector = rpc.params[0].data.slice(0, 10);
        result =
          selector === permissionsSelector
            ? encodeAbiParameters(
                [
                  {
                    type: "tuple[]",
                    components: [
                      { name: "keycode", type: "bytes5" },
                      { name: "funcSelector", type: "bytes4" },
                    ],
                  },
                ],
                [[{ keycode, funcSelector: "0x12345678" }]]
              )
            : selector === keycodeSelector
              ? encodeAbiParameters(
                  [{ type: "bytes5" }],
                  [invalidKeycode ? "0x0000000000" : keycode]
                )
              : encodeAbiParameters([{ type: "address" }], [value]);
      } else
        return {
          jsonrpc: "2.0",
          id: rpc.id,
          error: { code: -32601, message: "Unsupported fixture method" },
        };
      return { jsonrpc: "2.0", id: rpc.id, result };
    };
    const input = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(input) ? input.map(reply) : reply(input))
    );
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const variable = `ENVIO_RPC_URL_${chain}`;
  process.env[variable] = `http://127.0.0.1:${server.address().port}`;
  const reads = (runtime, expected) => [
    () => getRequestedPolicyPermissions(runtime, chain, address, 0n, expected),
    () => getModuleKeycode(runtime, chain, address, 0n, expected),
    () => getModuleForKeycode(runtime, chain, address, keycode, 0n, expected),
    () => getKernelExecutor(runtime, address, chain, 0n),
    () => getRolesAdmin(runtime, address, chain, 0n),
  ];
  const calls = () => requests.filter((rpc) => rpc.method === "eth_call");
  try {
    let runtime = await makeEffectRuntime();
    for (const read of reads(runtime, canonical)) await read();
    assert.equal(calls().length, 5);
    assert(
      requests
        .filter((rpc) => rpc.method === "eth_getBlockByNumber")
        .every((rpc) => rpc.params[0] === "0x0")
    );
    await runtime.flush();
    assert.equal(runtime.rows.size, 5);
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    for (const read of reads(runtime, canonical)) await read();
    assert.equal(calls().length, 5, "same-hash cache survives restart");

    canonical = fork;
    const before = requests.length;
    for (const read of reads(runtime, hash).slice(0, 3))
      await assert.rejects(read(), CanonicalObservationChanged);
    assert.equal(
      calls().length,
      5,
      "orphaned events fail before using an effect"
    );
    assert(requests.length > before);
    assert.equal(await getKernelExecutor(runtime, address, chain, 0n), second);
    assert.equal(
      await getModuleForKeycode(runtime, chain, address, keycode, 0n, fork),
      second
    );
    assert.equal(
      calls().length,
      7,
      "replacement hash has separate persisted facts"
    );

    canonical = hash;
    flipAt = headers + 2;
    await assert.rejects(
      getKernelExecutor(runtime, address, chain, 0n),
      CanonicalObservationChanged
    );
    assert.equal(
      calls().length,
      7,
      "cached facts still need a fresh closing check"
    );
    flipAt = 0;
    canonical = hash;
    const beforeInvalid = requests.length;
    await assert.rejects(
      getKernelExecutor(runtime, address, chain, undefined),
      CanonicalObservationChanged
    );
    await assert.rejects(
      getModuleKeycode(runtime, chain, address, 0n, undefined),
      CanonicalObservationChanged
    );
    for (const missing of [null, undefined]) {
      for (const read of reads(runtime, missing).slice(0, 3))
        await assert.rejects(read(), CanonicalObservationChanged);
    }
    assert.equal(
      requests.length,
      beforeInvalid,
      "missing pins never request latest"
    );

    for (const failure of [
      { code: -32000, message: "historical state not available" },
      { code: -32602, message: "Unsupported block hash pin" },
    ]) {
      error = failure;
      runtime = await makeEffectRuntime();
      for (const read of reads(runtime, canonical))
        await assert.rejects(read());
      await runtime.flush();
      assert.equal(
        runtime.rows.size,
        0,
        "unavailable reads must not persist substitute values"
      );
      await assert.rejects(
        parseContractName(0, address, chain, 0n, runtime, hash)
      );
    }
    error = undefined;
    invalidKeycode = true;
    await assert.rejects(
      parseContractName(0, address, chain, 0n, await makeEffectRuntime(), hash),
      /Invalid module keycode/
    );
    assert(
      calls().every(
        (rpc) =>
          rpc.params[1]?.requireCanonical === true &&
          [hash, fork].includes(rpc.params[1]?.blockHash)
      ),
      "all contract calls stay hash pinned"
    );
  } finally {
    delete process.env[variable];
    await new Promise((done) => server.close(done));
  }
});
