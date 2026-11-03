import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { encodeAbiParameters, toFunctionSelector } from "viem";

// Envio intervals start at the chain start block (13_674_068), not zero.
const height = 26_294_068;
const hashA = `0x${"ab".repeat(32)}`;
const hashB = `0x${"cd".repeat(32)}`;
const owner = `0x${"11".repeat(20)}`;
const migrator = "0xe045bd0a0d85e980aa152064c06eae6b6ae358d2";
const tables = [
  "ChainObservation",
  "ContractState",
  "ContractRelationship",
  "KernelReadCache",
  "VerifiedDeployment",
  "ControlTransition",
];
const encode = (types, values) =>
  encodeAbiParameters(
    types.map((type) => ({ type })),
    values
  );

test("native Envio rejects exhausted HTTP 429 and a late fork without committing entities, then resumes the same block", async () => {
  let phase;
  let throttled = true;
  let throttleCalls = 0;
  let fork = true;
  let flipped = false;
  let pinnedCalls = 0;
  let pinnedCodes = 0;
  let nativeFinalChecks = 0;
  const invocations = [];
  const unexpected = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const part of req) raw += part;
    let httpThrottled = false;
    const reply = (rpc) => {
      let result;
      let error;
      if (rpc.method === "eth_getBlockByNumber") {
        if (Number(BigInt(rpc.params[0])) === height && phase) {
          phase.headers++;
          if (!phase.preload && phase.headers >= 2 && throttled) {
            throttleCalls++;
            phase.throttled = true;
            httpThrottled = true;
            return {
              jsonrpc: "2.0",
              id: rpc.id,
              error: {
                code: 429,
                message: "Too Many Requests fixture-provider-secret",
              },
            };
          }
          if (!phase.preload && phase.headers === 2) {
            nativeFinalChecks++;
            if (fork) flipped = true;
          }
        }
        result = {
          number: rpc.params[0],
          hash: flipped ? hashB : hashA,
          parentHash: hashA,
          timestamp: "0x100",
        };
      } else if (rpc.method === "eth_getCode") {
        pinnedCodes++;
        assert.equal(rpc.params[1].blockHash, hashA);
        assert.equal(rpc.params[1].requireCanonical, true);
        // Synthetic code leaves verified-documentation/deployment mismatches
        // unavailable; this fixture tests batch atomicity, not source binding.
        result = "0x6000";
      } else if (rpc.method === "eth_call") {
        pinnedCalls++;
        assert.equal(rpc.params[1].blockHash, hashA);
        assert.equal(rpc.params[1].requireCanonical, true);
        const selector = rpc.params[0].data.slice(0, 10);
        const is = (signature) => selector === toFunctionSelector(signature);
        if (is("moduleDependents(bytes5,uint256)"))
          error = { code: 3, message: "execution reverted" };
        else if (is("getPeriodicTasks()"))
          result = encode(["address[]", "bytes4[]"], [[], []]);
        else if (is("getSupportedChains()"))
          result = encode(["uint64[]"], [[]]);
        else if (is("getTokenConfig(address)"))
          result = encode(
            ["address", "address", "address"],
            [owner, owner, owner]
          );
        else if (
          [
            "isEnabled()",
            "active()",
            "locallyActive()",
            "isShutdown()",
            "getAllowListEnabled()",
            "isChainSupported(uint64)",
          ].some(is)
        )
          result = encode(["bool"], [false]);
        else if (is("getTrustedRemoteEVM(uint64)"))
          result = encode(["address", "bool"], [owner, false]);
        else if (is("getTrustedRemoteSVM(uint64)"))
          result = encode(["bytes32", "bool"], [hashA, false]);
        else result = encode(["address"], [owner]);
      } else {
        unexpected.push(rpc.method);
        error = { code: -32601, message: "fixture method unavailable" };
      }
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        ...(error ? { error } : { result }),
      };
    };
    const payload = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    const response = Array.isArray(payload)
      ? payload.map(reply)
      : reply(payload);
    if (httpThrottled) res.statusCode = 429;
    res.end(JSON.stringify(response));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const destination = new URL(input instanceof Request ? input.url : input);
    if (destination.origin === "https://sourcify.dev")
      return Promise.resolve(new Response("{}", { status: 404 }));
    assert.equal(
      destination.origin,
      url,
      "runtime fixture must never fetch a real service"
    );
    return originalFetch(input, options);
  };
  try {
    for (const chain of [
      1, 10, 80094, 8453, 42161, 4663, 84532, 421614, 11155111,
    ])
      process.env[`ENVIO_RPC_URL_${chain}`] = url;
    process.env.ENVIO_RPC_MODE = "fallback";
    process.env.ENVIO_API_TOKEN = "fixture";
    const { indexer, createTestIndexer } = await import("envio");
    // Register first so this marker observes Envio's preload/execution mode
    // before the real checkpoint handler. It performs no reads or entity writes.
    indexer.onBlock(
      {
        name: "fixture-execution-marker",
        where: ({ chain }) =>
          chain.id === 1 ? { block: { number: { _every: 10_000 } } } : false,
      },
      ({ context }) => {
        phase = { preload: context.isPreload, headers: 0 };
        invocations.push(phase);
      }
    );
    await import("../src/EventHandlers.ts");
    const runtime = createTestIndexer();
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (name) => [name, await runtime[name].getAll()])
        )
      );
    const before = await snapshot();
    const processBlock = () =>
      runtime.process({
        chains: {
          1: {
            startBlock: height,
            endBlock: height,
            simulate: [
              {
                contract: "Owned",
                event: "OwnershipTransferred",
                srcAddress: migrator,
                block: { number: height, hash: hashA, timestamp: 256 },
                transaction: { hash: hashA },
                params: { user: owner, newOwner: owner },
              },
            ],
          },
        },
      });
    await assert.rejects(processBlock(), (error) => {
      assert.match(String(error), /Indexer RPC temporarily unavailable/);
      assert.doesNotMatch(String(error), /fixture-provider-secret|http:/);
      return true;
    });
    assert.equal(throttleCalls, 6);
    assert.equal(invocations.find((call) => call.throttled)?.headers, 7);
    assert.deepEqual(
      await snapshot(),
      before,
      "exhausted throughput recovery must not commit a partial checkpoint"
    );
    throttled = false;
    await assert.rejects(processBlock(), (error) => {
      assert.match(
        String(error),
        /Canonical observation changed or unavailable/
      );
      assert(!String(error).includes(url));
      return true;
    });
    assert(
      flipped,
      "fork must be injected at the execution callback's final header check"
    );
    assert(
      pinnedCalls > 0 && pinnedCodes > 0,
      "successful hash-pinned calls and code reads precede the fork"
    );
    assert.deepEqual(
      await snapshot(),
      before,
      "failed native batch must leave every committed entity unchanged"
    );
    fork = false;
    flipped = false;
    const result = await processBlock();
    assert(result.changes.length > 0);
    const after = await snapshot();
    assert.equal(after.ChainObservation[0].indexedThrough.hash, hashA);
    assert(after.ContractState.length > 0);
    assert(
      after.ContractRelationship.some(
        (row) => row.subject === migrator && row.getter === "owner"
      )
    );
    assert(
      after.ControlTransition.length > 0,
      "the real ownership event commits with the completed block"
    );
    assert(
      nativeFinalChecks >= 2,
      "failure and recovery reach execution's final check"
    );
    assert(invocations.some((call) => call.preload));
    assert(invocations.some((call) => !call.preload));
    assert(
      invocations
        .filter((call) => !call.preload && !call.throttled)
        .every((call) => call.headers === 2),
      "execution shares one opening header and one fresh final current-height check"
    );
    assert.deepEqual(unexpected, []);
    // createTestIndexer runs IndexerState/BatchProcessing/UserContext/Writing
    // with memory storage; effect persistence and PostgreSQL rollback/restart
    // behavior are outside this test.
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env))
      if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await new Promise((done) => server.close(done));
  }
});
