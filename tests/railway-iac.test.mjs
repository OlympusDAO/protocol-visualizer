import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";

async function infrastructure(environment) {
  const definition = await defineInfrastructure(
    createRailwayContext({ environment })
  );
  return { definition, resources: definition.resources.flat(Infinity) };
}

test("whole-project IaC retains storage and wires services without embedding secrets", async () => {
  for (const [environment, envioSize] of [
    ["production", 5000],
    ["protocol-visualizer-pr-82", 50000],
  ]) {
    const { definition, resources } = await infrastructure(environment);
    assert.equal(definition.name, "protocol-visualizer");
    assert.equal(definition.variables.managed, true);
    assert(definition.variables.ignore.includes("RPC_CACHE_MAX_RPS"));
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
      assert.equal(
        node.source.branch,
        environment === "production" ? "master" : undefined
      );
      assert.equal(node.source.checkSuites, true);
      assert.equal(node.build.builder, "DOCKERFILE");
      assert.equal(node.build.dockerfilePath, `Dockerfile-${node.name}`);
      assert(node.build.watchPatterns.every((path) => path.startsWith("/")));
      assert(node.build.watchPatterns.includes("/.railway/**"));
      assert(node.build.watchPatterns.includes(`/Dockerfile-${node.name}`));
      if (!["hasura", "rpc-cache"].includes(node.name))
        assert(node.build.watchPatterns.includes("/package.json"));
      assert(node.variables);
      assert.equal(node.configFile, undefined);
      const job =
        node.name === "snapshot-publisher" || node.name === "snapshot-monitor";
      assert.equal(node.deploy.restartPolicyType, job ? "NEVER" : "ON_FAILURE");
      if (!job) assert.equal(node.deploy.restartPolicyMaxRetries, 1);
    }
    assert.equal(get("indexer").deploy.healthcheckPath, "/healthz");
    assert.equal(get("hasura").deploy.healthcheckTimeout, 300);
    assert.equal(get("snapshot-gateway").deploy.healthcheckPath, "/healthz");
    assert.equal(get("snapshot-publisher").deploy.cronSchedule, "0 * * * *");
    assert.equal(get("snapshot-monitor").deploy.cronSchedule, "5 0 * * *");
    assert.equal(get("rpc-cache").deploy.healthcheckPath, "/healthcheck");
    assert.equal(get("rpc-cache").networking, undefined);
    assert.equal(get("rpc-cache-postgres").networking, undefined);
    const ids = [
      ...readFileSync("apps/indexer/config.yaml", "utf8").matchAll(
        /^ {2}- id: (\d+)$/gm
      ),
    ].map((match) => Number(match[1]));
    for (const [name, prefix] of [
      ["indexer", "ENVIO_RPC_URL_"],
      ["snapshot-publisher", "RPC_URL_"],
      ["snapshot-monitor", "RPC_URL_"],
    ]) {
      const variables = get(name).variables;
      assert.deepEqual(
        Object.keys(variables)
          .filter((key) => key.startsWith(prefix))
          .map((key) => Number(key.slice(prefix.length)))
          .sort((a, b) => a - b),
        [...ids].sort((a, b) => a - b)
      );
      for (const id of ids)
        assert.equal(
          variables[`${prefix}${id}`].value,
          `http://\${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/${id}`
        );
    }
    for (const id of ids)
      assert.deepEqual(get("rpc-cache").variables[`UPSTREAM_RPC_URL_${id}`], {
        type: "preserve",
      });
    assert.deepEqual(get("rpc-cache").variables.RPC_CACHE_DATABASE_URL, {
      type: "reference",
      resource: "database.rpc-cache-postgres",
      output: "DATABASE_URL",
    });
    for (const name of [
      "snapshot-publisher",
      "snapshot-monitor",
      "snapshot-gateway",
    ])
      for (const key of [
        "BUCKET",
        "ACCESS_KEY_ID",
        "SECRET_ACCESS_KEY",
        "REGION",
        "ENDPOINT",
      ])
        assert.deepEqual(get(name).variables[key], {
          type: "reference",
          resource: "bucket.storage",
          output: key,
        });
    for (const key of ["ENVIO_API_TOKEN", "ETHERSCAN_API_KEY"])
      assert.deepEqual(get("indexer").variables[key], { type: "preserve" });
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
  assert(!workflow.includes("--confirm-destructive"));
  assert(!/^\s+RAILWAY_TOKEN:/m.test(workflow));
  assert.equal(
    workflow.match(/RAILWAY_API_TOKEN: \$\{\{ secrets.RAILWAY_TOKEN \}\}/g)
      .length,
    2
  );
  assert(
    workflow.includes(
      "RAILWAY_PROJECT_ID: d733dd5c-7076-48ad-ac8b-a147cb428300"
    )
  );
  assert(
    workflow.includes(
      "RAILWAY_ENVIRONMENT_ID: 1b61e496-b565-42b4-9e5d-8096e28e13cd"
    )
  );
  assert(
    workflow.includes(
      '--workflow railway-config.yml --commit "$PR_HEAD_SHA" --event pull_request --status success'
    )
  );
  assert(
    workflow.includes(
      "plan.environmentId !== process.env.RAILWAY_ENVIRONMENT_ID"
    )
  );
  assert(
    workflow.includes(
      'railway config apply --environment production --plan "$RUNNER_TEMP/railway-plan/railway-plan.json" --yes'
    )
  );
  assert(!workflow.includes("railwayapp/config@"));
  assert.equal(workflow.match(/name: railway-production-plan/g).length, 2);
  assert(workflow.includes("run-id: ${{ steps.plan-run.outputs.run-id }}"));
  assert(workflow.includes("cancel-in-progress: false"));
  assert(workflow.includes("queue: max"));
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g))
    if (!action.startsWith("./")) assert.match(action, /@[0-9a-f]{40}$/);
});
