import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync("services/rpc-cache/erpc.js", "utf8");
const ids = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
const env = {
  RPC_CACHE_DATABASE_URL: "postgresql://cache:fixture@cache-db/cache",
  ...Object.fromEntries(
    ids.map((id) => [`UPSTREAM_RPC_URL_${id}`, `https://rpc.example/${id}`])
  ),
};
const config = (environment = env) =>
  JSON.parse(
    JSON.stringify(
      vm.runInNewContext(
        source.replace("export default", "globalThis.config ="),
        { process: { env: environment } }
      )
    )
  );

const assertSnapshotRpcRouting = (compose) => {
  for (const id of ids) {
    assert.match(
      compose,
      new RegExp(`^ {2}RPC_URL_${id}: http://rpc-cache:4000/pv/evm/${id}$`, "m")
    );
  }
};

test("RPC cache covers precisely the indexer chains with private project paths", () => {
  const cfg = config();
  const indexerIds = [
    ...readFileSync("apps/indexer/config.yaml", "utf8").matchAll(
      /^ {2}- id: (\d+)$/gm
    ),
  ]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  assert.deepEqual(
    cfg.projects[0].networks.map((n) => n.evm.chainId).sort((a, b) => a - b),
    indexerIds
  );
  assert.deepEqual(
    cfg.projects[0].upstreams.map((u) => u.evm.chainId).sort((a, b) => a - b),
    indexerIds
  );
  assert.equal(cfg.projects[0].id, "pv");
  const compose = readFileSync("docker-compose.yml", "utf8");
  for (const id of ids) {
    assert(
      compose.includes(
        `ENVIO_RPC_URL_${id}: http://rpc-cache:4000/pv/evm/${id}`
      )
    );
    assert(compose.includes(`UPSTREAM_RPC_URL_${id}: $`));
  }
  assertSnapshotRpcRouting(compose);
});

test("snapshot RPC routing checks reject missing entries even when indexer entries remain", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  for (const mutated of [
    compose.replace(/^ {2}RPC_URL_1:.*\n/m, ""),
    compose.replace(/^x-snapshot-rpc-env:[\s\S]*?(?=^\S)/m, ""),
  ]) {
    for (const id of ids) {
      assert(
        mutated.includes(
          `ENVIO_RPC_URL_${id}: http://rpc-cache:4000/pv/evm/${id}`
        )
      );
    }
    assert.throws(() => assertSnapshotRpcRouting(mutated), {
      code: "ERR_ASSERTION",
    });
  }
});

test("runtime configuration requires named credentials without printing values", () => {
  for (const name of Object.keys(env)) {
    const missing = { ...env, [name]: "" };
    assert.throws(
      () => config(missing),
      new RegExp(`Missing or invalid ${name}`)
    );
  }
  assert.throws(
    () => config({ ...env, RPC_CACHE_MAX_RPS: "zero" }),
    /positive integer/
  );
});

test("immutable policies require known finality and disable speculative upstream work", () => {
  const cfg = config();
  assert(
    cfg.database.evmJsonRpcCache.policies.every(
      (p) => p.finality === "finalized" && p.ttl === "0s"
    )
  );
  const project = cfg.projects[0];
  assert.equal(
    project.networkDefaults.evm.fallbackFinalityDepth,
    Number.MAX_SAFE_INTEGER
  );
  assert.equal(
    project.networkDefaults.directiveDefaults.skipInterpolation,
    true
  );
  for (const fs of [
    ...project.networkDefaults.failsafe,
    ...project.upstreamDefaults.failsafe,
  ]) {
    assert.equal(fs.hedge, undefined);
    assert.equal(fs.consensus, undefined);
  }
  const logs = cfg.database.evmJsonRpcCache.policies.filter(
    (p) => p.method === "eth_getLogs"
  );
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].params, [{ fromBlock: "0x*", toBlock: "0x*" }]);
  assert.equal(cfg.server.includeErrorDetails, false);
  assert.equal(cfg.logLevel, "disabled");
});
