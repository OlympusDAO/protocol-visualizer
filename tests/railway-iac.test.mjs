import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";
import {
  existingServiceNames,
  postgresPassword,
  postgresPasswordGenerator,
} from "../.railway/postgres-password-policy.ts";

async function infrastructure(environment) {
  const definition = await defineInfrastructure(
    createRailwayContext({ environment })
  );
  return { definition, resources: definition.resources.flat(Infinity) };
}

test("whole-project IaC retains storage and wires services without embedding secrets", async () => {
  for (const [environment, envioSize] of [
    ["production", 10000],
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
    assert.equal(get("Postgres").networking.privateNetworkEndpoint, "postgres");
    for (const resource of resources) {
      assert.deepEqual(
        Object.keys(resource.networking?.tcpProxies ?? {}),
        [],
        `${resource.name} must not expose a public TCP proxy`
      );
      if (!["frontend", "snapshot-gateway"].includes(resource.name))
        assert.deepEqual(
          Object.keys(resource.networking?.customDomains ?? {}),
          [],
          `${resource.name} must not expose a public domain`
        );
    }
    assert.equal(
      get("Postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:16"
    );
    assert.equal(
      get("rpc-cache-postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:18"
    );
    for (const name of ["Postgres", "rpc-cache-postgres"])
      assert.deepEqual(
        get(name).variables?.POSTGRES_PASSWORD,
        { type: "preserve" },
        `${name} must retain create-time generation without requesting password updates`
      );
    assert.equal(get("destruction-volume").config.sizeMB, envioSize);
    assert.equal(get("destruction-volume").config.allowOnlineResize, true);
    assert.equal(get("destruction-volume").config.region, "us-west2");
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
      assert.equal(node.deploy.restartPolicyType, job ? "NEVER" : undefined);
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
    assert.deepEqual(get("indexer").variables.DATABASE_URL, {
      type: "reference",
      resource: "database.Postgres",
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
  const planning = readFileSync(".github/workflows/railway-config.yml", "utf8");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const workflow = `${planning}\n${ci}`;
  assert(workflow.includes("branches: [master]"));
  assert(!workflow.includes("pull_request_target"));
  assert(
    workflow.includes(
      "github.event_name == 'push' && github.ref == 'refs/heads/master'"
    )
  );
  assert.equal(
    workflow.match(/head.repo.full_name == github.repository/g).length,
    1
  );
  assert(ci.includes("ref: ${{ github.sha }}"));
  assert(!planning.includes("  apply:"));
  assert(planning.includes('".github/workflows/ci.yml"'));
  assert(!workflow.includes("--confirm-destructive"));
  assert(!/^\s+RAILWAY_TOKEN:/m.test(workflow));
  assert.equal(
    workflow.match(/RAILWAY_API_TOKEN: \$\{\{ secrets.RAILWAY_TOKEN \}\}/g)
      .length,
    3
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
      'workflow_id: "railway-config.yml", head_sha: pr.head.sha'
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
  assert(ci.includes("run-id: ${{ needs.railway-plan.outputs.run-id }}"));
  const passwordCheck = ci.indexOf(
    "node scripts/check-cache-database-password.mjs"
  );
  const apply = ci.indexOf("railway config apply --environment production");
  assert(passwordCheck >= 0 && apply > passwordCheck);
  assert(workflow.includes("cancel-in-progress: false"));
  assert(workflow.includes("queue: max"));
  for (const [, action] of workflow.matchAll(/uses: (\S+)/g))
    if (!action.startsWith("./")) assert.match(action, /@[0-9a-f]{40}$/);
});

test("Postgres password policy generates URL-safe secrets only for new databases", () => {
  assert.equal(
    postgresPasswordGenerator,
    '${{ secret(64, "0123456789abcdef") }}'
  );
  for (const name of ["Postgres", "rpc-cache-postgres"]) {
    assert.deepEqual(postgresPassword(name, new Set()), {
      type: "raw",
      value: { defaultValue: postgresPasswordGenerator },
    });
    assert.deepEqual(postgresPassword(name, new Set([name])), {
      type: "preserve",
    });
    assert.deepEqual(postgresPassword(name, undefined), { type: "preserve" });
  }
});

test("database password planning rejects failed or incomplete service lookups", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-password-policy-"));
  const executable = join(directory, "railway");
  const originalPath = process.env.PATH;
  const ctx = createRailwayContext({ environmentId: "fixture-environment" });
  const response = (services, hasNextPage = false) => ({
    data: {
      environment: {
        serviceInstances: {
          edges: services.map((serviceName) => ({ node: { serviceName } })),
          pageInfo: { hasNextPage },
        },
      },
    },
  });
  const fixture = (value) =>
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s' '${JSON.stringify(value)}'\n`,
      {
        mode: 0o755,
      }
    );
  try {
    process.env.PATH = `${directory}:${originalPath}`;
    fixture(response(["Postgres", "rpc-cache-postgres"]));
    assert.deepEqual(
      [...existingServiceNames(ctx)],
      ["Postgres", "rpc-cache-postgres"]
    );
    for (const value of [
      response(["Postgres"], true),
      response([null]),
      response([""]),
      { errors: [{ message: "Not authorized" }] },
      {},
    ]) {
      fixture(value);
      assert.throws(
        () => existingServiceNames(ctx),
        /refusing to plan database password generation/
      );
    }
    writeFileSync(executable, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.throws(
      () => existingServiceNames(ctx),
      /refusing to plan database password generation/
    );
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("infrastructure apply blocks unsafe cache passwords without exposing credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-cache-password-check-"));
  const executable = join(directory, "railway");
  const run = (script, extra = {}) => {
    writeFileSync(executable, script, { mode: 0o755 });
    return spawnSync(
      process.execPath,
      ["scripts/check-cache-database-password.mjs"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          RAILWAY_PROJECT_ID: "fixture-project",
          RAILWAY_ENVIRONMENT_ID: "fixture-environment",
          ...extra,
        },
      }
    );
  };
  const fixture = (value) =>
    `#!/bin/sh\nprintf '%s' '${JSON.stringify(value)}'\n`;
  try {
    assert.equal(run(fixture({ PGPASSWORD: "a0123._~-" })).status, 0);
    for (const password of ["fixture^private", "fixture/private", "", null]) {
      const result = run(fixture({ PGPASSWORD: password }));
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /Coordinate PostgreSQL role and Railway variable rotation/
      );
      if (password) assert(!result.stderr.includes(password));
    }
    const failed = run(
      "#!/bin/sh\nprintf 'fixture-private-cli-output'\nexit 1\n"
    );
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /infrastructure apply is blocked/);
    assert(!failed.stderr.includes("fixture-private-cli-output"));
    assert.equal(
      run(fixture({ PGPASSWORD: "valid" }), { RAILWAY_ENVIRONMENT_ID: "" })
        .status,
      1
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
