import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import defineInfrastructure, { partial } from "../.railway/railway.ts";

const context = (environment) => createRailwayContext({ environment });
async function infrastructure(environment, branch) {
  const previous = process.env.RAILWAY_SOURCE_BRANCH;
  process.env.RAILWAY_SOURCE_BRANCH = branch;
  try {
    return await defineInfrastructure(context(environment));
  } finally {
    if (previous === undefined) delete process.env.RAILWAY_SOURCE_BRANCH;
    else process.env.RAILWAY_SOURCE_BRANCH = previous;
  }
}

test("IaC owns only the cache pair and keeps PR source branches explicit", async () => {
  assert.equal(partial, "rpc-cache");
  assert(!existsSync("railway-rpc-cache.json"));
  for (const [environment, branch] of [
    ["production", "master"],
    ["protocol-visualizer-pr-82", "feat/robinhood-chain"],
  ]) {
    const definition = await infrastructure(environment, branch);
    assert.equal(definition.name, "protocol-visualizer");
    const [database, cache] = definition.resources;
    assert.deepEqual(
      definition.resources.map((resource) => resource.address),
      ["database.rpc-cache-postgres", "service.rpc-cache"]
    );
    assert.equal(database.engine, "postgres");
    assert.equal(cache.source.repo, "OlympusDAO/protocol-visualizer");
    assert.equal(cache.source.branch, branch);
    assert.equal(cache.build.builder, "DOCKERFILE");
    assert.equal(cache.build.dockerfilePath, "Dockerfile-rpc-cache");
    assert(
      cache.build.watchPatterns.every((pattern) => pattern.startsWith("/"))
    );
    assert(cache.build.watchPatterns.includes("/.railway/**"));
    assert.equal(cache.deploy.healthcheckPath, "/healthcheck");
    assert.equal(cache.deploy.healthcheckTimeout, 30);
    assert.equal(cache.deploy.restartPolicyType, "ON_FAILURE");
    assert.equal(cache.deploy.restartPolicyMaxRetries, 1);
    assert.deepEqual(cache.deploy.multiRegionConfig, {
      "us-west2": { numReplicas: 1 },
    });
    assert.equal(cache.configFile, undefined);
    assert.equal(cache.networking, undefined);
    assert.deepEqual(cache.variables.RPC_CACHE_DATABASE_URL, {
      type: "reference",
      resource: database.address,
      output: "DATABASE_URL",
    });
    const ids = [
      ...readFileSync("apps/indexer/config.yaml", "utf8").matchAll(
        /^ {2}- id: (\d+)$/gm
      ),
    ]
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    const upstreamKeys = Object.keys(cache.variables).filter((key) =>
      key.startsWith("UPSTREAM_RPC_URL_")
    );
    assert.deepEqual(
      upstreamKeys
        .map((key) => Number(key.slice("UPSTREAM_RPC_URL_".length)))
        .sort((a, b) => a - b),
      ids
    );
    for (const key of upstreamKeys)
      assert.deepEqual(cache.variables[key], {
        type: "sharedReference",
        name: key,
      });
  }
});

test("IaC rejects an omitted branch instead of silently targeting the default branch", () => {
  const previous = process.env.RAILWAY_SOURCE_BRANCH;
  delete process.env.RAILWAY_SOURCE_BRANCH;
  try {
    assert.throws(
      () => defineInfrastructure(context("protocol-visualizer-pr-82")),
      /Set RAILWAY_SOURCE_BRANCH/
    );
  } finally {
    if (previous !== undefined) process.env.RAILWAY_SOURCE_BRANCH = previous;
  }
});
