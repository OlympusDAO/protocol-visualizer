import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { keccak256 } from "viem";

const require = createRequire(import.meta.url);
const envio = pathToFileURL(require.resolve("envio"));
const native = (name) => import(new URL(`./src/${name}.res.mjs`, envio));
const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const block = (number) => ({
  number: String(number),
  hash: hash(number),
  timestamp: String(number + 100),
});
const address = `0x${"12".repeat(20)}`;
const deploymentId = `verified-deployment:1:${address}`;
const deploymentCode = "0x6001600055";
const deploymentCodeHash = keccak256(deploymentCode);

function localDatabaseUrl(fresh = false) {
  const url = new URL(process.env.PV_CACHE_POSTGRES_URL);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.search, "", "connection options must not override the host");
  if (fresh) assert.match(url.pathname, /^\/pv_cache_rollback_[a-f0-9]{32}$/);
  return url;
}

async function runStage(stage) {
  const url = localDatabaseUrl(true);
  assert.ok(["seed", "rollback", "check"].includes(stage));
  Object.assign(process.env, {
    ENVIO_API_TOKEN: "fixture",
    ENVIO_HASURA: "false",
    ENVIO_PG_HOST: url.hostname,
    ENVIO_PG_PORT: url.port || "5432",
    ENVIO_PG_USER: decodeURIComponent(url.username),
    ENVIO_PG_PASSWORD: decodeURIComponent(url.password),
    ENVIO_PG_DATABASE: url.pathname.slice(1),
    ENVIO_PG_SSL_MODE: "false",
    LOG_LEVEL: "warn",
  });
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const reply = (rpc) => {
      let result;
      if (rpc.method === "eth_call") {
        result = "0x1234";
      } else if (rpc.method === "eth_getCode") {
        result = rpc.params[1].blockHash === hash(0) ? "0x" : deploymentCode;
      } else {
        assert.equal(rpc.method, "eth_getBlockByNumber");
        const number = Number(BigInt(rpc.params[0]));
        result = {
          number: rpc.params[0],
          hash: hash(number),
          parentHash: hash(number - 1),
          timestamp: `0x${(number + 100).toString(16)}`,
        };
      }
      return { jsonrpc: "2.0", id: rpc.id, result };
    };
    const payload = JSON.parse(raw);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        Array.isArray(payload) ? payload.map(reply) : reply(payload)
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const rpcUrl = `http://127.0.0.1:${server.address().port}`;
  for (const chain of [
    1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532,
  ])
    process.env[`ENVIO_RPC_URL_${chain}`] = rpcUrl;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const destination = new URL(input instanceof Request ? input.url : input);
    if (destination.origin === "https://sourcify.dev")
      return Promise.resolve(
        Response.json({
          chainId: "1",
          address,
          runtimeMatch: "exact_match",
          compilation: { language: "Solidity" },
          deployment: { blockNumber: "1" },
          proxyResolution: { isProxy: false },
          runtimeBytecode: {
            onchainBytecode: deploymentCode,
            immutableReferences: {},
          },
          metadata: { output: { abi: [] } },
        })
      );
    assert.equal(
      destination.origin,
      rpcUrl,
      "fixture must not call real services"
    );
    return originalFetch(input, options);
  };

  const [
    Config,
    PgStorage,
    Persistence,
    IndexerState,
    UserContext,
    LoadManager,
    Rollback,
    Writing,
    { readVerifiedDeploymentCode },
    { reuseKernelRead },
    { getModuleDependencyFields, completeModuleDependencies },
    { getObservedPoolFields },
    { handleAuthorityEvent, relationshipId },
    { default: proofs },
  ] = await Promise.all([
    ...[
      "Config",
      "PgStorage",
      "Persistence",
      "IndexerState",
      "UserContext",
      "LoadManager",
      "Rollback",
      "Writing",
    ].map(native),
    import("../src/events/deployment-state.ts"),
    import("../src/events/kernel-reuse.ts"),
    import("../src/events/module-dependencies.ts"),
    import("../src/events/ownership-contracts.ts"),
    import("../src/events/ownership.ts"),
    import("../src/generated/kernel-read-proofs.json", {
      with: { type: "json" },
    }),
  ]);
  const publicConfig = Config.getPublicConfigJson();
  const chain = Object.values(publicConfig.evm.chains).find(
    (row) => row.id === 1
  );
  publicConfig.evm.chains = {
    fixture: {
      ...chain,
      startBlock: 1,
      endBlock: 100,
      maxReorgDepth: 100,
      contracts: [],
    },
  };
  publicConfig.evm.chains.second = {
    ...publicConfig.evm.chains.fixture,
    id: 10,
  };
  publicConfig.evm.contracts = {};
  publicConfig.entities = publicConfig.entities.filter((entity) =>
    [
      "VerifiedDeployment",
      "KernelReadCache",
      "KernelReadEpoch",
      "ContractRelationship",
      "ControlTransition",
      "Contract",
      "ChainObservation",
      "ContractStateSeed",
    ].includes(entity.name)
  );
  const config = Config.fromPublic(publicConfig);
  assert.equal(
    config.defaultCrossChain,
    false,
    "exercise native chain-scoped storage"
  );
  // Synthetic checkpoints retain history; no source fetcher or fork detector runs.
  config.shouldSaveFullHistory = true;
  const persistence = PgStorage.makePersistenceFromConfig(config, undefined);
  let state;
  try {
    await Persistence.initForRun(persistence, config, false, false);
    const initial = Persistence.getInitializedState(persistence);
    state = IndexerState.makeFromDbState(
      config,
      persistence,
      initial,
      {
        10: {
          onEventRegistrations: [],
          onBlockRegistrations: [
            { index: 0, name: "fixture", interval: 1, handler: async () => {} },
          ],
        },
        1: {
          onEventRegistrations: [],
          onBlockRegistrations: [
            { index: 0, name: "fixture", interval: 1, handler: async () => {} },
          ],
        },
      },
      false,
      false,
      false,
      undefined,
      undefined,
      undefined,
      (error) => {
        throw error;
      },
      () => {}
    );
    const proof = proofs.find((row) => row.name === "kernel");
    const getter = "moduleDependents:MINTR";
    const kernelId = `1:${proof.address}:${proof.codeHash}:${getter}:v1`;
    const context = (checkpointId, chainId = 1) =>
      UserContext.getHandlerContext({
        config,
        persistence,
        indexerState: state,
        loadManager: LoadManager.make(),
        checkpointId: BigInt(checkpointId),
        isPreload: false,
        isResolved: false,
        item: { kind: 0, chainId },
        chains: { 1: { id: 1 }, 10: { id: 10 } },
      });
    const batch = (checkpointId, height, chainId = 1) => ({
      totalBatchSize: 0,
      items: [],
      progressedChainsById: {
        [chainId]: {
          fetchState: { chainId },
          progressBlockNumber: height,
          sourceBlockNumber: 20,
          totalEventsProcessed: Math.floor(height / 10),
          progressBlockTime: undefined,
        },
      },
      history: { [chainId]: true },
      checkpointIds: [BigInt(checkpointId)],
      checkpointChainIds: [chainId],
      checkpointBlockNumbers: [height],
      checkpointBlockHashes: [hash(height)],
      checkpointItemsCount: [0],
      checkpointEventsProcessed: [1],
      registeredAddresses: [],
    });
    const rows = async (name, ids) =>
      (await Promise.all(ids.map((id) => context(4)[name].get(id)))).filter(
        Boolean
      );

    const pool = (chainId) => `0x${String(chainId).padStart(40, "0")}`;
    const seedQueries = async (ctx, chainId, height) => {
      const event = (to, logIndex, from = pool(chainId)) => ({
        chainId,
        srcAddress: address,
        block: { number: height, timestamp: height + 100, hash: hash(height) },
        transaction: { hash: hash(height) },
        logIndex,
        params: { from, to, _effectiveImmediately: false },
      });
      if (height === 10) {
        await handleAuthorityEvent(
          ctx,
          event(pool(chainId), 0),
          "governor",
          "Pulled"
        );
        await handleAuthorityEvent(
          ctx,
          event(pool(chainId + 100), 1),
          "governor",
          "Pushed"
        );
      } else
        await handleAuthorityEvent(
          ctx,
          event(pool(chainId + 100), 0),
          "governor",
          "Pulled"
        );
      ctx.Contract.set({
        id: "same-module",
        address,
        name: chainId === 1 ? "MINTR" : "TRSRY",
        contractType: "MODULE",
        isEnabled: true,
        lastUpdatedTimestamp: 1n,
        lastUpdatedBlockNumber: 1n,
      });
      ctx.ContractRelationship.set({
        id: "same-dependency",
        subject: address,
        getter: `moduleDependents:${chainId === 1 ? "MINTR" : "TRSRY"}`,
        kind: "module-dependency",
        value: pool(chainId),
        source: address,
        target: pool(chainId),
        status: "reference",
        provenance: block(height),
        seed: block(height),
        lastChange: null,
        indexedThrough: block(height),
        verification: { outcome: "match", block: block(height) },
      });
      ctx.ControlTransition.set({
        id: "same-registration",
        address,
        kind: "relationship:getPool:fixture",
        previousValue: { address: null },
        value: { address: pool(chainId) },
        blockNumber: BigInt(height),
        blockHash: hash(height),
        timestamp: 1n,
        transactionHash: hash(height),
        logIndex: 0,
      });
    };
    if (stage === "seed") {
      assert.equal(initial.cleanRun, true);
      for (const [checkpoint, height] of [
        [1, 10],
        [2, 20],
      ]) {
        const ctx = context(checkpoint);
        await seedQueries(ctx, 1, height);
        const deployment = {
          id: deploymentId,
          address,
          creationBlock: 1n,
          creationHash: hash(1),
          codeHash: checkpoint === 1 ? deploymentCodeHash : hash(checkpoint),
          version: "ordinary-runtime-v1",
          verifiedAt: block(1),
        };
        const kernel = {
          id: kernelId,
          epoch: "initial",
          result: { status: "success", value: String(checkpoint) },
          verifiedAt: block(height),
        };
        if (checkpoint === 1) {
          assert.equal(
            await readVerifiedDeploymentCode(ctx, 1, {
              address,
              blockNumber: 10n,
              blockHash: hash(10),
            }),
            deploymentCodeHash
          );
          assert.equal(
            (
              await reuseKernelRead(
                ctx,
                {
                  chainId: 1,
                  address: proof.address,
                  getter,
                  block: block(10),
                },
                async () => kernel.result,
                async () => proof.codeHash,
                async (height) => block(Number(height))
              )
            ).value,
            "1"
          );
        } else {
          ctx.VerifiedDeployment.set(deployment);
          ctx.KernelReadCache.set(kernel);
        }
        if (checkpoint === 2) {
          ctx.VerifiedDeployment.set({
            ...deployment,
            id: `${deploymentId}:new`,
          });
          ctx.KernelReadCache.set({ ...kernel, id: `${kernelId}:new` });
        }
        IndexerState.queueProcessedBatch(state, batch(checkpoint, height));
        await Writing.runOneWrite(state);
      }
      // Deliberately collide IDs: chain prefixes must not be our only isolation.
      for (const [checkpoint, height] of [
        [1, 10],
        [2, 20],
      ]) {
        const second = context(checkpoint, 10);
        await seedQueries(second, 10, height);
        second.VerifiedDeployment.set({
          id: deploymentId,
          address,
          creationBlock: 1n,
          creationHash: hash(1),
          codeHash: hash(100 + checkpoint),
          version: "ordinary-runtime-v1",
          verifiedAt: block(1),
        });
        second.KernelReadCache.set({
          id: kernelId,
          epoch: "second",
          result: { status: "success", value: "second" },
          verifiedAt: block(height),
        });
        IndexerState.queueProcessedBatch(state, batch(checkpoint, height, 10));
        await Writing.runOneWrite(state);
      }
    } else {
      assert.equal(initial.cleanRun, false, "resume without resetting storage");
      const ctx = context(4);
      const second = context(4, 10);
      for (const chainId of [1, 10]) {
        const scoped = context(4, chainId);
        const keycode = chainId === 1 ? "MINTR" : "TRSRY";
        assert.deepEqual(
          (await getModuleDependencyFields(scoped, chainId)).map(
            (field) => field.getter
          ),
          [`moduleDependents:${keycode}`]
        );
        const reads = [];
        await completeModuleDependencies(
          scoped,
          chainId,
          block(21),
          [],
          async (keycode) => {
            reads.push(keycode);
            return { status: "unavailable", reason: "fixture" };
          },
          async () => undefined
        );
        assert.deepEqual(reads, [keycode]);
        const fields = await getObservedPoolFields(scoped, chainId, [
          {
            address,
            getter: "getPool:fixture",
            kind: "registered-pool",
            startBlock: 1,
          },
        ]);
        assert.deepEqual(
          [
            ...new Set(
              fields
                .filter((field) => field.kind === "pool-owner")
                .map((field) => field.address)
            ),
          ],
          [pool(chainId)]
        );
        await assert.rejects(
          () => getModuleDependencyFields(scoped, chainId === 1 ? 10 : 1),
          /chain scope/
        );
      }

      assert.equal(
        (await second.VerifiedDeployment.get(deploymentId)).codeHash,
        hash(102)
      );
      assert.equal(
        (await second.KernelReadCache.get(kernelId)).result.value,
        "second"
      );
      assert.equal(
        (await second.VerifiedDeployment.get(deploymentId)).chainId,
        undefined
      );
      assert.equal(
        (await ctx.VerifiedDeployment.get(deploymentId)).chainId,
        undefined
      );
      for (const [store, filter] of [
        ["VerifiedDeployment", { address: { _eq: address } }],
        ["KernelReadCache", { epoch: { _eq: "second" } }],
      ]) {
        assert.equal((await second[store].getWhere(filter)).length, 1);
        if (store === "KernelReadCache")
          assert.equal((await ctx[store].getWhere(filter)).length, 0);
      }
      if (stage === "rollback") {
        assert.equal(
          initial.chains.find((chain) => chain.id === 1).progressBlockNumber,
          20
        );
        assert.equal(
          (await rows("VerifiedDeployment", [deploymentId]))[0].codeHash,
          hash(2)
        );
        assert.equal(
          (await rows("KernelReadCache", [kernelId]))[0].result.value,
          "2"
        );
        assert.equal(
          (
            await rows("VerifiedDeployment", [
              deploymentId,
              `${deploymentId}:new`,
            ])
          ).length,
          2
        );
        assert.equal(
          (await rows("KernelReadCache", [kernelId, `${kernelId}:new`])).length,
          2
        );
        await Rollback.executeRollback(
          state,
          1,
          10,
          () => {},
          () => {}
        );
        assert.ok(
          state.rollback,
          "rollback must await a durable replacement batch"
        );
        IndexerState.queueProcessedBatch(state, batch(4, 11));
        await Writing.runOneWrite(state);
        assert.equal(state.rollback, undefined);
      }
      const deployments = await rows("VerifiedDeployment", [
        deploymentId,
        `${deploymentId}:new`,
      ]);
      assert.equal(deployments.length, 1);
      assert.equal(deployments[0].codeHash, deploymentCodeHash);
      const kernels = await rows("KernelReadCache", [
        kernelId,
        `${kernelId}:new`,
      ]);
      assert.equal(kernels.length, 1);
      assert.equal(kernels[0].result.value, "1");
      assert.deepEqual(kernels[0].verifiedAt, block(10));
      const pendingId = (chainId) =>
        relationshipId(chainId, address, "newGovernor");
      const firstPending = await ctx.ContractRelationship.get(pendingId(1));
      assert.equal(firstPending.status, "pending");
      assert.equal(firstPending.value, pool(101));
      assert.equal(
        (await second.ContractRelationship.get(pendingId(10))).status,
        "unset"
      );
      if (stage === "check") {
        assert.equal(
          initial.chains.find((chain) => chain.id === 1).progressBlockNumber,
          11
        );
        assert.equal(
          initial.chains.find((chain) => chain.id === 10).progressBlockNumber,
          20
        );
        assert.equal(initial.checkpointFrontier[1], 4n);
        let fallbackReads = 0;
        const codeContext = {
          chain: ctx.chain,
          VerifiedDeployment: ctx.VerifiedDeployment,
          effect: async () => {
            fallbackReads++;
            return undefined;
          },
        };
        const pin = { address, blockNumber: 11n, blockHash: hash(11) };
        const header = async (_chain, height) => ({
          hash: hash(Number(height)),
        });
        assert.equal(
          await readVerifiedDeploymentCode(codeContext, 1, pin, header),
          deploymentCodeHash
        );
        assert.equal(fallbackReads, 0);
        assert.equal(
          await readVerifiedDeploymentCode(codeContext, 1, pin, async () => ({
            hash: hash(99),
          })),
          undefined
        );
        assert.equal(
          fallbackReads,
          1,
          "an orphaned SQL fact takes the exact path"
        );
        assert.equal(
          await readVerifiedDeploymentCode(
            codeContext,
            1,
            pin,
            async (_chain, height) => ({
              hash: height === 1n ? hash(99) : hash(Number(height)),
            })
          ),
          undefined
        );
        assert.equal(fallbackReads, 2, "reject an orphaned creation anchor");
        const readKernel = (canonical) =>
          reuseKernelRead(
            ctx,
            { chainId: 1, address: proof.address, getter, block: block(11) },
            async () => {
              assert.fail("valid SQL Kernel fact must not need a fresh getter");
            },
            async () =>
              assert.fail("valid SQL Kernel fact needs no runtime RPC"),
            canonical
          );
        const reused = await readKernel(async (height) =>
          block(Number(height))
        );
        assert.equal(reused.value, "1");
        assert.deepEqual(reused.verifiedAt, block(10));
        assert.equal(
          (await readKernel(async () => ({ ...block(11), hash: hash(99) })))
            .status,
          "unavailable"
        );
        let freshKernelReads = 0;
        const orphaned = await reuseKernelRead(
          ctx,
          { chainId: 1, address: proof.address, getter, block: block(11) },
          async () => {
            freshKernelReads++;
            return { status: "unavailable", reason: "fresh fixture read" };
          },
          async () => assert.fail("failed fresh reads cannot seed a fact"),
          async (height) => ({
            ...block(Number(height)),
            hash: height === "10" ? hash(99) : hash(Number(height)),
          })
        );
        assert.equal(orphaned.status, "unavailable");
        assert.equal(orphaned.value, undefined);
        assert.equal(
          freshKernelReads,
          1,
          "reject an orphaned stored Kernel anchor"
        );
      }
    }
  } finally {
    if (state) IndexerState.stop(state);
    await persistence.storage.close();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

const stage = process.argv.find((argument) => argument.startsWith("--stage="));
if (stage) {
  await runStage(stage.slice("--stage=".length));
} else {
  test("native PostgreSQL rollback restores both fact entities across process restarts", {
    skip: !process.env.PV_CACHE_POSTGRES_URL,
  }, async () => {
    const url = localDatabaseUrl();
    const Postgres = require(
      require.resolve("postgres", { paths: [require.resolve("envio")] })
    );
    const admin = Postgres(url.toString(), { max: 1 });
    const database = `pv_cache_rollback_${randomUUID().replaceAll("-", "")}`;
    try {
      await admin.unsafe(`CREATE DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
    url.pathname = `/${database}`;
    for (const phase of ["seed", "rollback", "check"]) {
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          fileURLToPath(new URL("./register-typescript.mjs", import.meta.url)),
          fileURLToPath(import.meta.url),
          `--stage=${phase}`,
        ],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env: { ...process.env, PV_CACHE_POSTGRES_URL: url.toString() },
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      assert.equal(child.status, 0, `${phase}: ${child.stderr}`);
    }
    console.log(`Native SQL rollback fixture passed; retained ${database}`);
  });
}
