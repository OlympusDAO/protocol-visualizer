import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { keccak256 } from "viem";
import { getBytecodeHash } from "../src/events/code-cache.ts";
import { getCanonicalCodeHash } from "../src/events/effects.ts";
import { getImmutableDeployment } from "../src/events/deployment-facts.ts";
import { processVerifiedContractMetadata } from "../src/services/contracts/abi.ts";
import { makeEffectRuntime } from "./fixtures/effect-runtime.mjs";

const address = `0x${"71".repeat(20)}`;
const target = `0x${"72".repeat(20)}`;
const currentHash = `0x${"73".repeat(32)}`;
const creationHash = `0x${"74".repeat(32)}`;
const priorHash = `0x${"75".repeat(32)}`;
const forkHash = `0x${"76".repeat(32)}`;
const beforeHash = `0x${"77".repeat(32)}`;
const code = "0x6001600055";
let nextChain = 999930;

function verified(chainId) {
  return {
    chainId: String(chainId),
    address,
    runtimeMatch: "exact_match",
    compilation: { language: "Solidity" },
    deployment: { blockNumber: "10" },
    proxyResolution: { isProxy: false },
    runtimeBytecode: { onchainBytecode: code, immutableReferences: {} },
    metadata: { output: { abi: [] } },
  };
}

test("ordinary verified deployment metadata does not depend on an immutable getter or ABI function", () => {
  const value = verified(1);
  const result = processVerifiedContractMetadata(value, 1, address);
  assert.equal(result.ordinaryDeployment.codeHash, keccak256(code));
  assert.equal(result.ordinaryDeployment.creationBlock, "10");
  assert.equal(result.immutableDeployment, undefined);
  for (const patch of [
    { runtimeBytecode: { onchainBytecode: "0x" } },
    { runtimeBytecode: { onchainBytecode: "0xf400" } },
    { runtimeBytecode: { onchainBytecode: "0xf200" } },
    { runtimeBytecode: { onchainBytecode: "0xff00" } },
    { runtimeBytecode: { onchainBytecode: `0xef0100${address.slice(2)}` } },
    { proxyResolution: { isProxy: true } },
    { deployment: { blockNumber: "0" } },
  ])
    assert.equal(
      processVerifiedContractMetadata({ ...value, ...patch }, 1, address)
        .ordinaryDeployment,
      undefined
    );
});

async function fixture(run) {
  const chainId = ++nextChain,
    calls = [];
  let sourceCalls = 0;
  const state = {
    creation: creationHash,
    current: currentHash,
    priorCode: "0x",
    runtime: code,
    sourceStatus: 200,
    source: verified(chainId),
    failCode: false,
  };
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const reply = (rpc) => {
      calls.push(rpc);
      let result;
      if (rpc.method === "eth_getBlockByNumber")
        result = {
          number: rpc.params[0],
          hash: BigInt(rpc.params[0]) === 10n ? state.creation : state.current,
          parentHash: priorHash,
          timestamp: "0x100",
        };
      else if (rpc.method === "eth_getCode") {
        if (state.failCode) return { jsonrpc: "2.0", id: rpc.id, result: null };
        result =
          rpc.params[0] === target || rpc.params[1].blockHash === beforeHash
            ? "0x"
            : rpc.params[1].blockHash === priorHash
              ? state.priorCode
              : state.runtime;
      } else throw Error(`Unexpected ${rpc.method}`);
      return { jsonrpc: "2.0", id: rpc.id, result };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env[`ENVIO_RPC_URL_${chainId}`] =
    `http://127.0.0.1:${server.address().port}`;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).startsWith("https://sourcify.dev/")) {
      sourceCalls++;
      return Promise.resolve(
        state.sourceStatus === 200
          ? Response.json(state.source)
          : new Response(null, { status: state.sourceStatus })
      );
    }
    return previousFetch(url, init);
  };
  const entities = new Map();
  const store = {
    get: async (id) => entities.get(id),
    set: (entity) => entities.set(entity.id, structuredClone(entity)),
  };
  let effects = 0;
  async function runtime(rows) {
    const context = await makeEffectRuntime({ rows });
    const effect = context.effect.bind(context);
    context.effect = (...args) => {
      effects++;
      return effect(...args);
    };
    context.VerifiedDeployment = store;
    return context;
  }
  try {
    await run({
      chainId,
      state,
      entities,
      calls,
      sourceCalls: () => sourceCalls,
      effects: () => effects,
      runtime,
      pin: {
        address,
        blockHash: currentHash,
        blockNumber: 20n,
        requireCanonical: true,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    delete process.env[`ENVIO_RPC_URL_${chainId}`];
    await new Promise((resolve) => server.close(resolve));
  }
}

test("independent readers of one cold deployment write equivalent creation facts", async () => {
  await fixture(async ({ chainId, runtime, pin, entities }) => {
    const contexts = await Promise.all([
      runtime(new Map()),
      runtime(new Map()),
    ]);
    const writes = [];
    for (const context of contexts) {
      const store = context.VerifiedDeployment;
      context.VerifiedDeployment = {
        get: store.get,
        set: (row) => {
          writes.push(structuredClone(row));
          store.set(row);
        },
      };
    }
    assert.deepEqual(
      await Promise.all(
        contexts.map((context) => getBytecodeHash(context, chainId, pin))
      ),
      [keccak256(code), keccak256(code)]
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    assert.equal(writes[0].creationHash, creationHash);
    assert.equal(writes[0].verifiedAt.number, "10");
    assert.deepEqual([...entities.values()], [writes[0]]);
  });
});

test("native chain-scoped reload reuses deployment facts without an entity chainId", async () => {
  await fixture(async ({ chainId, runtime, pin, entities, effects }) => {
    let context = await runtime();
    await getBytecodeHash(context, chainId, pin);
    await context.flush();
    const saved = [...entities.values()][0];
    delete saved.chainId; // Envio strips the physical scope column on reads.
    context = await runtime(context.rows);
    context.chain = { id: chainId };
    const before = effects();
    assert.equal(await getBytecodeHash(context, chainId, pin), keccak256(code));
    assert.equal(effects(), before, "reload must bypass the effect loader");
    await assert.rejects(
      () => getBytecodeHash(context, chainId + 1, pin),
      /chain scope/
    );
  });
});

test("ordinary deployment code survives restart and entity hits bypass effects; rollback discards lifetime facts", async () => {
  await fixture(
    async ({
      chainId,
      entities,
      calls,
      sourceCalls,
      effects,
      runtime,
      pin,
    }) => {
      let context = await runtime();
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.equal(entities.size, 1);
      const saved = [...entities.values()][0];
      assert.equal(saved.creationBlock, 10n);
      assert.equal(saved.creationHash, creationHash);
      assert.equal(saved.codeHash, keccak256(code));
      assert.deepEqual(saved.verifiedAt, {
        number: "10",
        hash: creationHash,
        timestamp: "256",
      });
      await context.flush();
      context = await runtime(context.rows);
      const effectsBefore = effects(),
        codeBefore = calls.filter((c) => c.method === "eth_getCode").length;
      assert.equal(
        await getBytecodeHash(context, chainId, { ...pin, blockNumber: 30n }),
        keccak256(code)
      );
      assert.equal(
        effects(),
        effectsBefore,
        "entity hit does not enter the effect loader"
      );
      assert.equal(
        calls.filter((c) => c.method === "eth_getCode").length,
        codeBefore
      );
      assert.equal(sourceCalls(), 1);
      assert.deepEqual([...entities.values()][0].verifiedAt, saved.verifiedAt);
      const beforePublicRead = effects();
      assert.equal(
        await getCanonicalCodeHash(context, {
          chainId,
          address,
          blockNumber: 30n,
          blockHash: currentHash,
        }),
        keccak256(code)
      );
      assert.equal(
        effects(),
        beforePublicRead,
        "the public code reader must use the verified deployment entity before effects"
      );
      const beforeCanonicalHit = effects();
      let canonicalReads = 0;
      assert.equal(
        await getBytecodeHash(
          context,
          chainId,
          pin,
          async (_chainId, number) => {
            canonicalReads++;
            return {
              hash: number === 10n ? creationHash : currentHash,
              parentHash: priorHash,
              timestamp: 256n,
            };
          }
        ),
        keccak256(code)
      );
      assert.ok(canonicalReads >= 2);
      assert.equal(effects(), beforeCanonicalHit);
      entities.clear();
      context = await runtime(context.rows);
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.equal(entities.size, 1);
      assert.ok(
        effects() > effectsBefore,
        "rolled-back proof must be accepted again before lifetime reuse"
      );
    }
  );
});

test("lifetime facts reject forks, predeployment and redeployment and do not prove referenced target code", async () => {
  await fixture(
    async ({ chainId, entities, state, calls, effects, runtime, pin }) => {
      let context = await runtime();
      await getBytecodeHash(context, chainId, pin);
      assert.equal(entities.size, 1);
      let before = effects();
      assert.equal(
        await getBytecodeHash(context, chainId, { ...pin, address: target }),
        keccak256("0x")
      );
      assert.ok(effects() > before);
      assert.equal(
        entities.size,
        1,
        "empty target code is never a lifetime fact"
      );
      before = effects();
      assert.equal(
        await getBytecodeHash(context, chainId, {
          ...pin,
          blockHash: beforeHash,
          blockNumber: 9n,
        }),
        keccak256("0x")
      );
      assert.ok(effects() > before, "an entity cannot answer precreation code");
      await context.flush();
      context = await runtime(context.rows);
      state.creation = forkHash;
      state.current = forkHash;
      state.priorCode = code;
      before = effects();
      assert.equal(
        await getBytecodeHash(context, chainId, {
          ...pin,
          blockHash: forkHash,
        }),
        keccak256(code)
      );
      assert.ok(
        effects() > before,
        "a forked creation hash cannot reuse the entity"
      );
      assert.equal(
        [...entities.values()][0].creationHash,
        creationHash,
        "a nonempty creation parent cannot replace the lifetime fact"
      );
      assert.ok(
        calls
          .filter((c) => c.method === "eth_getCode")
          .every((c) => c.params[1].requireCanonical)
      );
    }
  );
});

test("conclusive no-immutable discovery persists across restart while incomplete proof can recover", async () => {
  await fixture(
    async ({ chainId, entities, state, sourceCalls, runtime, pin }) => {
      const input = { ...pin, chainId };
      let context = await runtime();
      assert.equal(await getImmutableDeployment(context, input), undefined);
      await context.flush();
      context = await runtime(context.rows);
      assert.equal(await getImmutableDeployment(context, input), undefined);
      assert.equal(
        sourceCalls(),
        1,
        "empty compiler references conclusively exclude immutable getters"
      );
      assert.equal(entities.size, 0);

      state.source.runtimeBytecode.immutableReferences = {
        1: [{ start: 1, length: 32 }],
      };
      context = await runtime();
      assert.equal(await getImmutableDeployment(context, input), undefined);
      await context.flush();
      context = await runtime(context.rows);
      assert.equal(await getImmutableDeployment(context, input), undefined);
      assert.equal(
        sourceCalls(),
        3,
        "incomplete source-map/compiler proof is not a permanent negative"
      );
    }
  );
});

test("unavailable source and code do not permanently poison ordinary deployment discovery", async () => {
  await fixture(
    async ({ chainId, entities, state, sourceCalls, runtime, pin }) => {
      state.sourceStatus = 503;
      let context = await runtime();
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.equal(entities.size, 0);
      await context.flush();
      state.sourceStatus = 200;
      context = await runtime(context.rows);
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.equal(entities.size, 1);
      assert.equal(sourceCalls(), 2);
      entities.clear();
      state.failCode = true;
      context = await runtime();
      assert.equal(await getBytecodeHash(context, chainId, pin), undefined);
      await context.flush();
      assert.equal(context.rows.size, 0);
      state.failCode = false;
      context = await runtime(context.rows);
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.equal(entities.size, 1);
    }
  );
});

test("invalid deployment identity or missing provenance falls back to exact proof", async () => {
  await fixture(async ({ chainId, entities, effects, runtime, pin }) => {
    let context = await runtime();
    await getBytecodeHash(context, chainId, pin);
    await context.flush();
    const saved = structuredClone([...entities.values()][0]);
    for (const patch of [
      { address: target },
      { version: "unknown" },
      { creationHash: forkHash },
      { verifiedAt: { ...saved.verifiedAt, number: "9" } },
      { verifiedAt: { ...saved.verifiedAt, hash: forkHash } },
      { verifiedAt: undefined },
    ]) {
      entities.set(saved.id, { ...saved, ...patch });
      context = await runtime(context.rows);
      const before = effects();
      assert.equal(
        await getBytecodeHash(context, chainId, pin),
        keccak256(code)
      );
      assert.ok(
        effects() > before,
        "invalid entity data cannot provide a lifetime hit"
      );
    }
  });
});

test("verified unsafe runtimes without compiler references persist a conclusive negative", async () => {
  await fixture(async ({ chainId, state, sourceCalls, runtime, pin }) => {
    state.runtime = "0xf400";
    state.source.runtimeBytecode = { onchainBytecode: state.runtime };
    let context = await runtime();
    assert.equal(
      await getImmutableDeployment(context, { ...pin, chainId }),
      undefined
    );
    await context.flush();
    context = await runtime(context.rows);
    assert.equal(
      await getImmutableDeployment(context, { ...pin, chainId }),
      undefined
    );
    assert.equal(
      sourceCalls(),
      1,
      "unsafe runtime proof does not depend on an immutable reference map"
    );
  });
});

test("deployment entity reuse reduces code reads over ten public canonical observations", async () => {
  await fixture(
    async ({ chainId, entities, state, calls, effects, runtime }) => {
      const measurements = {};
      for (const mode of ["exact", "deployment"]) {
        entities.clear();
        let rows = new Map();
        const start = calls.length,
          beforeEffects = effects();
        for (let number = 20; number < 30; number++) {
          state.current = `0x${number.toString(16).padStart(64, "0")}`;
          const context = await runtime(rows);
          if (mode === "exact") delete context.VerifiedDeployment;
          assert.equal(
            await getCanonicalCodeHash(context, {
              chainId,
              address,
              blockNumber: BigInt(number),
              blockHash: state.current,
            }),
            keccak256(code)
          );
          await context.flush();
          rows = context.rows;
        }
        const requests = {};
        for (const call of calls.slice(start))
          requests[call.method] = (requests[call.method] ?? 0) + 1;
        measurements[mode] = {
          requests,
          effectEntries: effects() - beforeEffects,
        };
      }
      assert.equal(measurements.exact.requests.eth_getCode, 10);
      assert.equal(measurements.deployment.requests.eth_getCode, 3);
      process.stdout.write(
        `Deployment reuse fixture: ${JSON.stringify(measurements)}\n`
      );
    }
  );
});
