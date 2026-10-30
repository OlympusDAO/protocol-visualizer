import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { keccak256 } from "viem";
import { getBytecodeHash } from "../src/events/code-cache.ts";
import { readPinnedControlGetter } from "../src/events/control-reads.ts";
import { processAbiMetadata } from "../src/services/contracts/abi.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

const subject = `0x${"12".repeat(20)}`;
const target = `0x${"34".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const fork = `0x${"cd".repeat(32)}`;
const bytecode = "0x6001600055";
let fixtureChain = 999980;

async function fixture(run) {
  const calls = [];
  let failure = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const respond = (rpc) => {
      calls.push({ chain: req.url, ...rpc });
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        ...(failure === "malformed"
          ? { result: null }
          : failure
            ? { error: { code: -32000, message: "fixture transport failure" } }
            : { result: rpc.params[0] === target ? "0x" : bytecode }),
      };
    };
    const payload = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(respond) : respond(payload)
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chains = [++fixtureChain, ++fixtureChain];
  for (const id of chains)
    process.env[`ENVIO_RPC_URL_${id}`] =
      `http://127.0.0.1:${server.address().port}/${id}`;
  try {
    await run({
      calls,
      fail: (value) => {
        failure = value;
      },
      chains,
    });
  } finally {
    for (const id of chains) delete process.env[`ENVIO_RPC_URL_${id}`];
    await new Promise((resolve) => server.close(resolve));
  }
}

test("bytecode facts deduplicate in flight, persist through runtime restart and isolate chain, address and block hash", async () => {
  await fixture(async ({ calls, chains: [chain, otherChain] }) => {
    let runtime = await makeEffectRuntime();
    const pin = { address: subject, blockHash: hash, requireCanonical: true };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => getBytecodeHash(runtime, chain, pin))
    );
    assert.deepEqual(results, Array(8).fill(keccak256(bytecode)));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params[1], {
      blockHash: hash,
      requireCanonical: true,
    });
    await runtime.flush();
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    assert.equal(
      await getBytecodeHash(runtime, chain, {
        ...pin,
        address: subject.toUpperCase().replace("0X", "0x"),
        blockHash: hash.toUpperCase().replace("0X", "0x"),
      }),
      keccak256(bytecode)
    );
    assert.equal(calls.length, 1);
    await getBytecodeHash(runtime, otherChain, pin);
    await getBytecodeHash(runtime, chain, { ...pin, blockHash: fork });
    assert.equal(
      await getBytecodeHash(runtime, chain, { ...pin, address: target }),
      keccak256("0x")
    );
    assert.equal(calls.length, 4);
    await runtime.flush();
    const restarted = await makeEffectRuntime({ rows: runtime.rows });
    assert.equal(
      await getBytecodeHash(restarted, chain, { ...pin, address: target }),
      keccak256("0x")
    );
    assert.equal(
      calls.length,
      4,
      "legitimate empty code is cached only at its pinned block"
    );
    await getBytecodeHash(restarted, chain, {
      ...pin,
      address: target,
      blockHash: fork,
    });
    assert.equal(calls.length, 5);
  });
});

test("failed code reads are not persisted and cannot become evidence of absent code", async () => {
  await fixture(async ({ calls, fail, chains: [chain] }) => {
    let runtime = await makeEffectRuntime();
    const pin = { address: subject, blockHash: hash, requireCanonical: true };
    fail(true);
    assert.equal(await getBytecodeHash(runtime, chain, pin), undefined);
    await runtime.flush();
    assert.equal(runtime.rows.size, 0);
    fail("malformed");
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    assert.equal(await getBytecodeHash(runtime, chain, pin), undefined);
    await runtime.flush();
    assert.equal(runtime.rows.size, 0);
    fail(false);
    runtime = await makeEffectRuntime({ rows: runtime.rows });
    assert.equal(
      await getBytecodeHash(runtime, chain, pin),
      keccak256(bytecode)
    );
    assert.equal(calls.length, 3);
  });
});

test("cached bytecode keeps getter results and fresh canonical checks, including a fork after the getter or target-code read", async () => {
  await fixture(async ({ calls, chains: [chain] }) => {
    const runtime = await makeEffectRuntime();
    const metadata = processAbiMetadata(
      [
        {
          type: "function",
          name: "destination",
          inputs: [],
          outputs: [{ type: "address" }],
          stateMutability: "view",
        },
      ],
      undefined,
      {
        url: "https://sourcify.dev/fixture",
        codeHash: keccak256(bytecode),
        match: "exact",
      }
    );
    const input = {
      chainId: chain,
      address: subject,
      blockNumber: 10n,
      blockHash: hash,
      getter: "destination",
    };
    let headers = 0;
    let forkAt = Infinity;
    const client = {
      getBlock: async () => ({ hash: ++headers >= forkAt ? fork : hash }),
      readContract: async () => target,
    };
    const readCodeHash = (pin) => getBytecodeHash(runtime, chain, pin);
    const first = await readPinnedControlGetter(
      client,
      input,
      metadata,
      readCodeHash
    );
    assert.equal(first.status, "success");
    assert.equal(first.targetCode, "absent");
    assert.equal(headers, 3);
    assert.equal(calls.length, 2);
    headers = 0;
    assert.deepEqual(
      await readPinnedControlGetter(client, input, metadata, readCodeHash),
      first
    );
    assert.equal(headers, 3);
    assert.equal(calls.length, 2);
    for (forkAt of [2, 3]) {
      headers = 0;
      assert.equal(
        (await readPinnedControlGetter(client, input, metadata, readCodeHash))
          .status,
        "unavailable"
      );
    }
    headers = 0;
    forkAt = Infinity;
    assert.equal(
      (
        await readPinnedControlGetter(
          client,
          input,
          metadata,
          async () => undefined
        )
      ).status,
      "unavailable"
    );
  });
});
