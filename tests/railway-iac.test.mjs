import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";

async function infrastructure(environment, branch) {
  const previous = process.env.RAILWAY_SOURCE_BRANCH;
  if (branch) process.env.RAILWAY_SOURCE_BRANCH = branch;
  else delete process.env.RAILWAY_SOURCE_BRANCH;
  try {
    const definition = await defineInfrastructure(
      createRailwayContext({ environment })
    );
    return { definition, resources: definition.resources.flat(Infinity) };
  } finally {
    if (previous === undefined) delete process.env.RAILWAY_SOURCE_BRANCH;
    else process.env.RAILWAY_SOURCE_BRANCH = previous;
  }
}

test("whole-project IaC retains all services, storage and groups without managing secrets", async () => {
  for (const [environment, branch, envioSize] of [
    ["production", undefined, 5000],
    ["protocol-visualizer-pr-82", "feat/robinhood-chain", 50000],
  ]) {
    const { definition, resources } = await infrastructure(environment, branch);
    assert.equal(definition.name, "protocol-visualizer");
    assert.deepEqual(definition.variables, { managed: false });
    assert.deepEqual(resources.map((r) => r.address).sort(), [
      "bucket.storage",
      "database.Postgres",
      "database.rpc-cache-postgres",
      "group.Data",
      "group.Private Indexing",
      "group.Public",
      "service.frontend",
      "service.hasura",
      "service.indexer",
      "service.rpc-cache",
      "service.snapshot-gateway",
      "service.snapshot-monitor",
      "service.snapshot-publisher",
      "volume.destruction-volume",
      "volume.postgres-volume",
    ]);
    const get = (name) => resources.find((r) => r.name === name);
    assert.equal(
      get("Postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:16"
    );
    assert.equal(
      get("rpc-cache-postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:18"
    );
    assert.equal(get("destruction-volume").config.sizeMB, envioSize);
    assert.equal(get("postgres-volume").config.sizeMB, 50000);
    assert.equal(get("storage").config.region, "sjc");
    for (const node of resources.filter((r) => r.type === "service")) {
      assert.equal(node.source.branch, branch ?? "master");
      assert.equal(node.source.checkSuites, true);
      assert.equal(node.build.builder, "DOCKERFILE");
      assert.equal(node.build.dockerfilePath, `Dockerfile-${node.name}`);
      assert(node.build.watchPatterns.every((path) => path.startsWith("/")));
      assert(node.build.watchPatterns.includes("/.railway/**"));
      assert(node.build.watchPatterns.includes(`/Dockerfile-${node.name}`));
      if (!["hasura", "rpc-cache"].includes(node.name))
        assert(node.build.watchPatterns.includes("/package.json"));
      assert.equal(node.variables, undefined);
      assert.equal(node.configFile, undefined);
      const job =
        node.name === "snapshot-publisher" || node.name === "snapshot-monitor";
      assert.equal(node.deploy.restartPolicyType, job ? "NEVER" : "ON_FAILURE");
      if (!job) assert.equal(node.deploy.restartPolicyMaxRetries, 1);
    }
    assert.equal(get("indexer").deploy.healthcheckPath, "/healthz");
    assert.equal(get("hasura").deploy.healthcheckTimeout, 300);
    assert.equal(get("snapshot-gateway").deploy.healthcheckPath, "/ready");
    assert.equal(get("snapshot-publisher").deploy.cronSchedule, "0 * * * *");
    assert.equal(get("snapshot-monitor").deploy.cronSchedule, "5 0 * * *");
    assert.equal(get("rpc-cache").deploy.healthcheckPath, "/healthcheck");
    assert.equal(get("rpc-cache").networking, undefined);
    assert.equal(get("rpc-cache-postgres").networking, undefined);
    for (const [name, domain] of [
      ["frontend", "protocol-visualizer.olympusdao.finance"],
      ["snapshot-gateway", "protocol-visualizer-api.olympusdao.finance"],
    ]) {
      if (environment === "production")
        assert.equal(get(name).networking.customDomains[domain].port, 8080);
      else
        assert.equal(
          Object.keys(get(name).networking?.customDomains ?? {}).length,
          0
        );
    }
  }
});

test("preview planning requires an explicit branch; production always uses master", async () => {
  const previous = process.env.RAILWAY_SOURCE_BRANCH;
  delete process.env.RAILWAY_SOURCE_BRANCH;
  try {
    assert.throws(
      () =>
        defineInfrastructure(
          createRailwayContext({ environment: "protocol-visualizer-pr-82" })
        ),
      /Set RAILWAY_SOURCE_BRANCH/
    );
    const { resources } = await infrastructure(
      "production",
      "unmerged-feature"
    );
    assert(
      resources
        .filter((r) => r.type === "service")
        .every((r) => r.source.branch === "master")
    );
  } finally {
    if (previous !== undefined) process.env.RAILWAY_SOURCE_BRANCH = previous;
  }
});

test("Railway workflow applies only reviewed merges and blocks destructive changes", () => {
  const workflow = readFileSync(".github/workflows/railway-config.yml", "utf8");
  assert(workflow.includes("branches: [master]"));
  assert(!workflow.includes("pull_request_target"));
  assert(
    workflow.includes(
      "github.event.action == 'closed' && github.event.pull_request.merged"
    )
  );
  assert.equal(
    workflow.match(/head.repo.full_name == github.repository/g).length,
    2
  );
  assert(
    workflow.includes("ref: ${{ github.event.pull_request.merge_commit_sha }}")
  );
  assert.equal(workflow.match(/confirm-destructive: "false"/g).length, 2);
  assert.equal(
    workflow.match(/artifact-name: railway-production-plan/g).length,
    2
  );
  assert(workflow.includes("cancel-in-progress: false"));
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g))
    if (!action.startsWith("./")) assert.match(action, /@[0-9a-f]{40}$/);
});
