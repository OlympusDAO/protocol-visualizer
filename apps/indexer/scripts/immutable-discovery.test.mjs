import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverImmutableDeployment,
  ordinaryRuntime,
} from "../src/services/contracts/immutables.ts";
import proof from "./fixtures/immutable-compiler-proof.json" with {
  type: "json",
};
import manifest from "../src/generated/deployment-facts.json" with {
  type: "json",
};

const verified = () => ({
  ...structuredClone(proof),
  runtimeBytecode: {
    ...structuredClone(proof.runtimeBytecode),
    onchainBytecode: manifest[0].runtimeBytecode,
  },
});

test("compiler immutable references and source maps discover actual public immutable getters without an address allowlist", () => {
  const input = verified();
  const result = discoverImmutableDeployment(input, 1, input.address);
  assert.deepEqual(result.immutableGetters, manifest[0].immutableGetters);
  assert.equal(result.creationBlock, manifest[0].creationBlock);
  assert.equal(result.codeHash, manifest[0].codeHash);
  assert(!Object.values(result.immutableGetters).includes("owner()"));
  const otherAddress = `0x${"12".repeat(20)}`;
  const added = discoverImmutableDeployment(
    { ...input, address: otherAddress },
    1,
    otherAddress
  );
  assert.equal(added.address, otherAddress);
  assert.deepEqual(added.immutableGetters, result.immutableGetters);
});

test("automatic immutable eligibility rejects missing compiler proof, source mismatch, bad bindings, proxy code and malformed references", () => {
  const cases = [
    (v) => {
      delete v.runtimeBytecode.immutableReferences;
    },
    (v) => {
      v.runtimeBytecode.sourceMap = "";
    },
    (v) => {
      v.sources["src/periphery/CoolerV2Migrator.sol"].content += "// altered";
    },
    (v) => {
      v.chainId = "10";
    },
    (v) => {
      v.runtimeMatch = null;
    },
    (v) => {
      v.deployment.blockNumber = "0";
    },
    (v) => {
      v.runtimeBytecode.onchainBytecode = `0xf4${v.runtimeBytecode.onchainBytecode.slice(4)}`;
    },
    (v) => {
      v.runtimeBytecode.immutableReferences["4153"][0].start = 1;
    },
    (v) => {
      v.runtimeBytecode.immutableReferences["4153"][0].length = 31;
    },
    (v) => {
      v.proxyResolution = { isProxy: true };
    },
  ];
  for (const patch of cases) {
    const v = verified();
    patch(v);
    assert.equal(discoverImmutableDeployment(v, 1, proof.address), undefined);
  }
});

test("normal contract metadata processing discovers an added contract automatically", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ContractProcessor } = await import(
    "../src/services/contracts/processor.ts"
  );
  const root = mkdtempSync(join(tmpdir(), "pv-auto-immutable-"));
  const previousCwd = process.cwd(),
    previousFetch = globalThis.fetch;
  const address = `0x${"34".repeat(20)}`;
  const v = { ...verified(), address };
  let lookups = 0;
  globalThis.fetch = async (url) => {
    assert(
      String(url).startsWith(
        `https://sourcify.dev/server/v2/contract/1/${address}`
      )
    );
    lookups++;
    return Response.json(v);
  };
  process.chdir(root);
  try {
    const processor = new ContractProcessor(
      {
        getContractAbi: async () =>
          v.metadata.output.abi.filter((fn) => fn.name === "CHREG"),
        getContractSourceCode: async () => "contract Added {}",
      },
      1
    );
    const result = await processor.processContract(address, "Added");
    assert.equal(lookups, 1);
    assert.equal(result.immutableDeployment.address, address);
    assert.equal(
      Object.keys(result.immutableDeployment.immutableGetters).length,
      7
    );
  } finally {
    process.chdir(previousCwd);
    globalThis.fetch = previousFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("an uncatalogued contract uses persisted automatic deployment discovery and preserves fork and code boundaries", async () => {
  const http = await import("node:http");
  const { makeEffectRuntime } = await import("./fixtures/effect-runtime.mjs");
  const { readDeploymentGetter } = await import(
    "../src/events/deployment-getters.ts"
  );
  const v = verified(),
    address = `0x${"56".repeat(20)}`;
  v.address = address;
  const currentHash = `0x${"ab".repeat(32)}`,
    creationHash = `0x${"cd".repeat(32)}`,
    priorHash = `0x${"ef".repeat(32)}`;
  const value = "0x69a3e97027d21a5984b6a543b36603ffbc6543a4";
  let sourceCalls = 0,
    sourceStatus = 200,
    evmCalls = 0,
    canonicalHash = currentHash;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    const reply = (rpc) => {
      let result;
      if (rpc.method === "eth_getBlockByNumber")
        result = {
          number: rpc.params[0],
          hash:
            BigInt(rpc.params[0]) === BigInt(v.deployment.blockNumber)
              ? creationHash
              : canonicalHash,
          parentHash: priorHash,
          timestamp: "0x100",
        };
      else if (rpc.method === "eth_getCode")
        result =
          rpc.params[1].blockHash === priorHash
            ? "0x"
            : manifest[0].runtimeBytecode;
      else if (rpc.method === "eth_call") {
        evmCalls++;
        result = `0x${"0".repeat(24)}${value.slice(2)}`;
      } else throw Error(`Unexpected ${rpc.method}`);
      return { id: rpc.id, jsonrpc: "2.0", result };
    };
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body))
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://sourcify.dev/")) {
      sourceCalls++;
      return sourceStatus === 200
        ? Response.json(v)
        : new Response(null, { status: sourceStatus });
    }
    return previousFetch(url, init);
  };
  // A separate chain client avoids process-global transport memoization from other tests.
  const chainId = 999974;
  v.chainId = String(chainId);
  process.env[`ENVIO_RPC_URL_${chainId}`] =
    `http://127.0.0.1:${server.address().port}`;
  try {
    const input = {
      chainId,
      address,
      getter: "CHREG",
      blockNumber: BigInt(v.deployment.blockNumber) + 10n,
      blockHash: currentHash,
    };
    let context = await makeEffectRuntime();
    const result = await readDeploymentGetter(context, input);
    assert.equal(result.status, "success");
    assert.equal(result.value, value);
    assert.equal(result.verifiedAt.number, v.deployment.blockNumber);
    await context.flush();
    context = await makeEffectRuntime({ rows: context.rows });
    assert.equal((await readDeploymentGetter(context, input)).value, value);
    assert.equal(sourceCalls, 1);
    assert.equal(evmCalls, 1);
    assert.equal(
      await readDeploymentGetter(context, { ...input, getter: "owner" }),
      undefined
    );
    assert.equal(
      await readDeploymentGetter(context, {
        ...input,
        blockNumber: BigInt(v.deployment.blockNumber) - 1n,
      }),
      undefined
    );
    const unknown = { ...input, address: `0x${"78".repeat(20)}` };
    sourceStatus = 404;
    const beforeMissing = sourceCalls;
    assert.equal(await readDeploymentGetter(context, unknown), undefined);
    assert.equal(await readDeploymentGetter(context, unknown), undefined);
    assert.equal(
      sourceCalls,
      beforeMissing + 1,
      "same-batch missing-source lookup is coalesced"
    );
    await context.flush();
    context = await makeEffectRuntime({ rows: context.rows });
    sourceStatus = 200;
    v.address = unknown.address;
    assert.equal((await readDeploymentGetter(context, unknown)).value, value);
    assert.equal(
      sourceCalls,
      beforeMissing + 2,
      "a later verified upload becomes eligible without a manual refresh"
    );
    sourceStatus = 503;
    const retryable = { ...input, address: `0x${"90".repeat(20)}` };
    const beforeFailure = sourceCalls;
    assert.equal(await readDeploymentGetter(context, retryable), undefined);
    await context.flush();
    context = await makeEffectRuntime({ rows: context.rows });
    assert.equal(await readDeploymentGetter(context, retryable), undefined);
    assert.equal(
      sourceCalls,
      beforeFailure + 2,
      "source service failures are not persisted"
    );
    sourceStatus = 200;
    canonicalHash = `0x${"ff".repeat(32)}`;
    assert.equal(await readDeploymentGetter(context, input), undefined);
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("ordinary runtime checks never trust arbitrary trailing bytes as a metadata boundary", () => {
  assert.equal(ordinaryRuntime("0x60005bff0002"), false);
  assert.equal(ordinaryRuntime("0x60005bf40002"), false);
  assert.equal(
    ordinaryRuntime("0x60ff00"),
    true,
    "PUSH data is not executable SELFDESTRUCT"
  );
  assert.equal(ordinaryRuntime(`0xef0100${"12".repeat(20)}`), false);
});

test("a separately compiled new contract with an inherited-interface immutable getter is discovered automatically", async () => {
  const { default: added } = await import(
    "./fixtures/immutable-added-compiler-proof.json",
    { with: { type: "json" } }
  );
  const result = discoverImmutableDeployment(added, 1, added.address);
  assert.deepEqual(Object.values(result.immutableGetters), ["TOKEN()"]);
  assert.equal(result.address, added.address);
});
