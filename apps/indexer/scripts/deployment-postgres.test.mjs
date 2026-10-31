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
  let rpcCalls = 0;
  const server = http.createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const reply = (rpc) => {
      let result;
      if (rpc.method === "eth_call") {
        rpcCalls++;
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
    EntityFilter,
    { getEffectClient },
    { readVerifiedDeploymentCode },
    { reuseKernelRead },
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
      "db/EntityFilter",
    ].map(native),
    import("../src/events/call-cache.ts"),
    import("../src/events/deployment-state.ts"),
    import("../src/events/kernel-reuse.ts"),
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
  publicConfig.evm.contracts = {};
  publicConfig.entities = publicConfig.entities.filter((entity) =>
    ["VerifiedDeployment", "KernelReadCache", "KernelReadEpoch"].includes(
      entity.name
    )
  );
  const config = Config.fromPublic(publicConfig);
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
    const context = (checkpointId) =>
      UserContext.getHandlerContext({
        config,
        persistence,
        indexerState: state,
        loadManager: LoadManager.make(),
        checkpointId: BigInt(checkpointId),
        isPreload: false,
        isResolved: false,
        item: { kind: 0, chainId: 1 },
        chains: { 1: { id: 1 } },
      });
    const batch = (checkpointId, height) => ({
      totalBatchSize: 0,
      items: [],
      progressedChainsById: {
        1: {
          fetchState: { chainId: 1 },
          progressBlockNumber: height,
          sourceBlockNumber: 20,
          totalEventsProcessed: Math.floor(height / 10),
          progressBlockTime: undefined,
        },
      },
      history: { 1: true },
      checkpointIds: [BigInt(checkpointId)],
      checkpointChainIds: [1],
      checkpointBlockNumbers: [height],
      checkpointBlockHashes: [hash(height)],
      checkpointItemsCount: [0],
      checkpointEventsProcessed: [1],
      registeredAddresses: [],
    });
    const rawCall = (ctx, pin = hash(20)) =>
      getEffectClient(ctx, 1).request({
        method: "eth_call",
        params: [
          { to: address, data: "0x12345678" },
          { blockHash: pin, requireCanonical: true },
        ],
      });
    const rows = (name, ids) =>
      persistence.storage.loadOrThrow(
        EntityFilter.byIds(ids),
        config.userEntitiesByName[name].table
      );

    if (stage === "seed") {
      assert.equal(initial.cleanRun, true);
      for (const [checkpoint, height] of [
        [1, 10],
        [2, 20],
      ]) {
        const ctx = context(checkpoint);
        const deployment = {
          id: deploymentId,
          chainId: 1,
          address,
          creationBlock: 1n,
          creationHash: hash(1),
          codeHash: checkpoint === 1 ? deploymentCodeHash : hash(checkpoint),
          version: "ordinary-runtime-v1",
          verifiedAt: block(1),
        };
        const kernel = {
          id: kernelId,
          chainId: 1,
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
          assert.equal(await rawCall(ctx), "0x1234");
          assert.equal(rpcCalls, 1);
        }
        IndexerState.queueProcessedBatch(state, batch(checkpoint, height));
        await Writing.runOneWrite(state);
      }
    } else {
      assert.equal(initial.cleanRun, false, "resume without resetting storage");
      const ctx = context(4);
      assert.equal(await rawCall(ctx), "0x1234");
      assert.equal(rpcCalls, 0, "production raw-call effect survives restart");
      if (stage === "rollback") {
        assert.equal(initial.chains[0].progressBlockNumber, 20);
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
      if (stage === "check") {
        assert.equal(initial.chains[0].progressBlockNumber, 11);
        assert.equal(initial.checkpointFrontier[1], 4n);
        let fallbackReads = 0;
        const codeContext = {
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
        assert.equal(await rawCall(ctx, hash(11)), "0x1234");
        assert.equal(
          rpcCalls,
          1,
          "replacement block hash has a distinct effect key"
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
