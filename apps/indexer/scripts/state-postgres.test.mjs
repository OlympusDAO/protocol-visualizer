import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const envio = pathToFileURL(require.resolve("envio"));
const native = (name) => import(new URL(`./src/${name}.res.mjs`, envio));
const hash = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const block = (n) => ({
  number: String(n),
  hash: hash(n),
  timestamp: String(n + 100),
});
const address = `0x${"12".repeat(20)}`;
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
  for (const id of [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532])
    process.env[`ENVIO_RPC_URL_${id}`] = "http://127.0.0.1:1";
  const [
    Config,
    PgStorage,
    Persistence,
    IndexerState,
    UserContext,
    LoadManager,
    Rollback,
    Writing,
  ] = await Promise.all(
    [
      "Config",
      "PgStorage",
      "Persistence",
      "IndexerState",
      "UserContext",
      "LoadManager",
      "Rollback",
      "Writing",
    ].map(native)
  );
  const { getModuleDependencyFields, completeModuleDependencies } =
    await import("../src/events/module-dependencies.ts");
  const { getObservedPoolFields } = await import(
    "../src/events/ownership-contracts.ts"
  );
  const { handleAuthorityEvent, relationshipId } = await import(
    "../src/events/ownership.ts"
  );
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
      "Contract",
      "ContractRelationship",
      "ControlTransition",
      "ChainObservation",
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
      for (const chainId of [1, 10])
        for (const [checkpoint, height] of [
          [1, 10],
          [2, 20],
        ]) {
          const ctx = context(checkpoint, chainId);
          await seedQueries(ctx, chainId, height);
          ctx.ChainObservation.set({
            id: "same-observation",
            indexedThrough: block(height),
            verificationVersion: 1,
          });
          IndexerState.queueProcessedBatch(
            state,
            batch(checkpoint, height, chainId)
          );
          await Writing.runOneWrite(state);
        }
    } else {
      assert.equal(initial.cleanRun, false);
      const ctx = context(4),
        second = context(4, 10);
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

      assert.equal((await ctx.Contract.get("same-module")).chainId, undefined);
      assert.equal((await second.Contract.get("same-module")).name, "TRSRY");
      assert.equal(
        (await ctx.Contract.getWhere({ name: { _eq: "TRSRY" } })).length,
        0
      );
      assert.equal(
        (await second.Contract.getWhere({ name: { _eq: "TRSRY" } })).length,
        1
      );
      if (stage === "rollback") {
        assert.equal(
          initial.chains.find((c) => c.id === 1).progressBlockNumber,
          20
        );
        assert.equal(
          (await ctx.ChainObservation.get("same-observation")).indexedThrough
            .number,
          "20"
        );
        await Rollback.executeRollback(
          state,
          1,
          10,
          () => {},
          () => {}
        );
        assert.ok(state.rollback);
        IndexerState.queueProcessedBatch(state, batch(4, 11));
        await Writing.runOneWrite(state);
        assert.equal(state.rollback, undefined);
      }
      assert.deepEqual(
        (await ctx.ChainObservation.get("same-observation")).indexedThrough,
        block(10)
      );
      assert.deepEqual(
        (await second.ChainObservation.get("same-observation")).indexedThrough,
        block(20)
      );
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
          initial.chains.find((c) => c.id === 1).progressBlockNumber,
          11
        );
        assert.equal(
          initial.chains.find((c) => c.id === 10).progressBlockNumber,
          20
        );
        assert.equal(initial.checkpointFrontier[1], 4n);
      }
    }
  } finally {
    if (state) IndexerState.stop(state);
    await persistence.storage.close();
  }
}
const stage = process.argv.find((argument) => argument.startsWith("--stage="));
if (stage) {
  await runStage(stage.slice("--stage=".length));
} else {
  test("native PostgreSQL preserves current state, chain isolation and rollback across process restarts", {
    skip:
      !process.env.PV_CACHE_POSTGRES_URL &&
      process.env.PV_REQUIRE_POSTGRES !== "1",
  }, async () => {
    assert.ok(
      process.env.PV_CACHE_POSTGRES_URL,
      "PV_CACHE_POSTGRES_URL is required when PV_REQUIRE_POSTGRES=1"
    );
    const url = localDatabaseUrl();
    const Postgres = require(
      require.resolve("postgres", { paths: [require.resolve("envio")] })
    );
    const admin = Postgres(url.toString(), { max: 1, connect_timeout: 5 });
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
      console.log(`Native SQL fixture completed stage: ${phase}`);
    }
    console.log(`Native SQL rollback fixture passed; completed ${database}`);
  });
}
