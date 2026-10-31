import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { getControlGetter } from "../src/events/effects.ts";
import { RpcTransientFailure } from "../src/events/rpc.ts";
import proofs from "../src/generated/kernel-read-proofs.json" with {
  type: "json",
};

const block = (number) => ({
  number: String(number),
  hash: `0x${String(number).padStart(64, "0")}`,
  timestamp: String(number + 1000),
});

test("Kernel pointer failure drains a sibling deployment writer before returning", async () => {
  const proof = proofs.find((row) => row.getters.includes("ROLES"));
  const kernel = proofs.find(
    (row) => row.chainId === 1 && row.name === "kernel"
  );
  const held = Promise.withResolvers();
  const writes = [];
  let settled = false;
  const context = {
    KernelReadEpoch: { get: async () => undefined },
    KernelReadCache: {
      get: async () => undefined,
      set: () => assert.fail("failed verification must not seed Kernel reuse"),
    },
    Contract: {
      get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
    },
    VerifiedDeployment: {
      get: async (id) => {
        if (id.endsWith(kernel.address)) {
          await held.promise;
          return undefined;
        }
        return {
          chainId: 1,
          address: proof.address,
          creationBlock: 10n,
          creationHash: block(10).hash,
          codeHash: proof.codeHash,
          version: "ordinary-runtime-v1",
          verifiedAt: block(10),
        };
      },
      set: (row) => writes.push({ row, afterReturn: settled }),
    },
    effect: async (effect, input) => {
      if (effect.name === "readControlGetter") {
        if (input.getter === "kernel") throw new RpcTransientFailure();
        return { status: "success", value: `0x${"34".repeat(20)}` };
      }
      if (effect.name === "readPinnedBytecodeHash") return kernel.codeHash;
      if (effect.name === "discoverVerifiedOrdinaryDeploymentV2")
        return input.address === kernel.address
          ? JSON.stringify({
              ordinaryDeployment: {
                chainId: 1,
                address: kernel.address,
                creationBlock: "10",
                codeHash: kernel.codeHash,
                version: "ordinary-runtime-v1",
                sourceUrl: "https://example.invalid/verified",
              },
            })
          : undefined;
      if (effect.name === "verifyStaticDeployment") return true;
      assert.fail(`Unexpected effect: ${effect.name}`);
    },
  };
  const done = getControlGetter(
    context,
    {
      chainId: 1,
      address: proof.address,
      getter: "ROLES",
      blockNumber: 30_000_000n,
      blockHash: block(30_000_000).hash,
    },
    block(30_000_000),
    async (_chain, height) => ({
      number: height,
      hash: block(Number(height)).hash,
      parentHash: block(Number(height) - 1).hash,
      timestamp: height + 1000n,
    })
  ).then(
    () => {
      settled = true;
      assert.fail("the transient pointer failure must propagate");
    },
    (error) => {
      settled = true;
      return error;
    }
  );
  try {
    await tick();
    assert.equal(
      settled,
      false,
      "the delayed deployment branch is still owned"
    );
  } finally {
    held.resolve();
    await tick();
  }
  assert.ok((await done) instanceof RpcTransientFailure);
  assert.equal(
    writes.length,
    1,
    "fault injection reaches a real deployment write"
  );
  assert.equal(
    writes[0].afterReturn,
    false,
    "no nested entity write outlives the reader"
  );
});

test("a valid Kernel entity fact bypasses deployment discovery and effects while preserving its actual verification block", async () => {
  const proof = proofs.find((row) => row.getters.includes("ROLES"));
  const value = `0x${"34".repeat(20)}`;
  let effects = 0;
  let forked = false;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const reply = ({ id, method, params }) => {
      assert.equal(method, "eth_getBlockByNumber");
      const number = Number(BigInt(params[0]));
      return {
        jsonrpc: "2.0",
        id,
        result: {
          number: params[0],
          hash: forked ? `0x${"ff".repeat(32)}` : block(number).hash,
          parentHash: block(number - 1).hash,
          timestamp: `0x${(number + 1000).toString(16)}`,
          transactions: [],
        },
      };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Array.isArray(request) ? request.map(reply) : reply(request)
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ENVIO_RPC_URL_1 = `http://127.0.0.1:${server.address().port}`;
  const context = {
    effect: async () => {
      effects++;
      throw new Error("A cached entity must not need an effect");
    },
    KernelReadEpoch: { get: async () => undefined },
    Contract: {
      get: async () => ({ isEnabled: true, kernelHistory: "installed" }),
    },
    KernelReadCache: {
      get: async () => ({
        epoch: "initial",
        result: { status: "success", value },
        verifiedAt: block(10),
      }),
    },
  };
  const read = () =>
    getControlGetter(
      context,
      {
        chainId: 1,
        address: proof.address,
        getter: "ROLES",
        blockNumber: 11n,
        blockHash: block(11).hash,
      },
      block(11)
    );
  try {
    const result = await read();
    assert.equal(result.status, "success");
    assert.equal(result.value, value);
    assert.deepEqual(result.verifiedAt, block(10));
    assert.equal(
      effects,
      0,
      "Kernel state must be checked before source/code discovery"
    );
    forked = true;
    assert.equal((await read()).status, "unavailable");
    assert.equal(
      effects,
      0,
      "an orphaned entity fact is rejected without a discovery detour"
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
