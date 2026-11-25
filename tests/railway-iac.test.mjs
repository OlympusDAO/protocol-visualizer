import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import { test } from "node:test";
import { createRailwayContext } from "railway/iac";
import { existingResources, tcpRemovals } from "../.railway/postgres-policy.ts";
import defineInfrastructure from "../.railway/railway.ts";

async function infrastructure(environment) {
  const definition = await defineInfrastructure(
    createRailwayContext({ environment })
  );
  // Assert the evaluated, serialized SDK/project output, not authoring inputs.
  // Native CLI compilation is a separate boundary and is not modeled here.
  return {
    definition,
    resources: JSON.parse(JSON.stringify(definition)).resources.flat(Infinity),
  };
}

test("whole-project IaC retains storage and wires services without embedding secrets", async () => {
  for (const environment of ["production", "protocol-visualizer-pr-82"]) {
    const { definition, resources } = await infrastructure(environment);
    assert.equal(definition.name, "protocol-visualizer");
    assert.equal(definition.variables.managed, true);
    assert(definition.variables.ignore.includes("RPC_CACHE_MAX_RPS"));
    assert.deepEqual(resources.map((r) => r.address).sort(), [
      "bucket.monitor-state",
      "bucket.storage",
      "database.Postgres",
      "database.rpc-cache-postgres",
      "group.Data",
      "group.Private Indexing",
      "group.Public",
      "service.frontend",
      "service.hasura",
      "service.indexer",
      "service.indexer-monitor",
      "service.rpc-cache",
      "service.snapshot-gateway",
      "service.snapshot-monitor",
      "service.snapshot-publisher",
      "volume.destruction-volume",
      "volume.rpc-cache-postgres-volume",
    ]);
    const get = (name) => resources.find((r) => r.name === name);
    assert.deepEqual(
      resources
        .filter(
          (r) => Object.keys(r.networking?.customDomains ?? {}).length > 0
        )
        .map((r) => r.name)
        .sort(),
      environment === "production" ? ["frontend", "snapshot-gateway"] : []
    );
    assert.equal(get("Postgres").networking.privateNetworkEndpoint, "postgres");
    assert(
      get("frontend").build.watchPatterns.includes(
        "/packages/snapshot-artifacts/src/**"
      )
    );
    assert(
      get("indexer").build.watchPatterns.includes(
        "/packages/snapshot-artifacts/src/observation-constants.ts"
      )
    );
    for (const resource of resources) {
      assert.deepEqual(
        Object.entries(resource.networking?.tcpProxies ?? {})
          .filter(([, value]) => value !== null)
          .map(([port]) => port),
        [],
        `${resource.name} must not expose a public TCP proxy`
      );
      if (!["frontend", "snapshot-gateway"].includes(resource.name))
        assert.deepEqual(
          Object.keys(resource.networking?.customDomains ?? {}),
          [],
          `${resource.name} must not expose a public domain`
        );
      if (["service", "database"].includes(resource.type)) {
        assert.deepEqual(
          resource.networking.tcpProxies,
          tcpRemovals(resource.name)
        );
        if (!["frontend", "snapshot-gateway"].includes(resource.name)) {
          assert.deepEqual(resource.networking.serviceDomains, {});
          assert.deepEqual(resource.networking.customDomains, {});
        }
      }
    }
    assert.equal(
      get("Postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:4fc833b43d2aaf6ecc9b18615f5533602b723a32d0e2efe2dae8ca0f7217c863"
    );
    assert.equal(
      get("rpc-cache-postgres").image,
      "ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:4fc833b43d2aaf6ecc9b18615f5533602b723a32d0e2efe2dae8ca0f7217c863"
    );
    for (const name of ["Postgres", "rpc-cache-postgres"])
      assert.equal(
        get(name).defaultMountPath,
        "/var/lib/postgresql/data",
        `${name} must preserve the native production mount contract`
      );
    for (const name of ["Postgres", "rpc-cache-postgres"])
      assert.deepEqual(
        get(name).variables?.POSTGRES_PASSWORD,
        { type: "preserve" },
        `${name} must retain create-time generation without requesting password updates`
      );
    assert.equal(get("destruction-volume").config.sizeMB, 20000);
    assert.equal(get("destruction-volume").config.allowOnlineResize, true);
    assert.equal(get("destruction-volume").config.region, "us-west2");
    assert.equal(get("rpc-cache-postgres-volume").config.sizeMB, 20000);
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
      assert(
        !node.build.watchPatterns.some((path) => path.startsWith("/.railway/"))
      );
      assert(node.build.watchPatterns.includes(`/Dockerfile-${node.name}`));
      if (!["hasura", "rpc-cache"].includes(node.name))
        assert(node.build.watchPatterns.includes("/package.json"));
      assert(node.variables);
      assert.equal(node.configFile, undefined);
      const job = [
        "indexer-monitor",
        "snapshot-publisher",
        "snapshot-monitor",
      ].includes(node.name);
      assert.equal(node.deploy.restartPolicyType, job ? "NEVER" : undefined);
      if (!job) assert.equal(node.deploy.restartPolicyMaxRetries, 1);
    }
    assert.equal(get("indexer").deploy.healthcheckPath, "/healthz");
    assert.equal(get("hasura").deploy.healthcheckTimeout, 300);
    assert.equal(get("snapshot-gateway").deploy.healthcheckPath, "/healthz");
    assert.equal(get("snapshot-publisher").deploy.cronSchedule, "0 * * * *");
    assert.equal(get("snapshot-monitor").deploy.cronSchedule, "5 0 * * *");
    assert.equal(get("rpc-cache").deploy.healthcheckPath, "/healthcheck");
    assert.deepEqual(get("rpc-cache").networking, {
      serviceDomains: {},
      customDomains: {},
      tcpProxies: { 4000: null, 4001: null },
    });
    assert.deepEqual(get("rpc-cache-postgres").networking, {
      serviceDomains: {},
      customDomains: {},
      tcpProxies: { 5432: null },
    });
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

test("indexer monitor schedules one private metrics job with a dedicated state bucket", async () => {
  for (const environment of ["production", "protocol-visualizer-pr-82"]) {
    const { definition, resources } = await infrastructure(environment);
    const monitor = resources.find((node) => node.name === "indexer-monitor");
    const indexer = resources.find((node) => node.name === "indexer");
    assert.equal(monitor.groupId, "Private Indexing");
    assert.deepEqual(monitor.source, indexer.source);
    assert.deepEqual(monitor.build, {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-indexer-monitor",
      watchPatterns: [
        "/Dockerfile-indexer-monitor",
        "/apps/indexer-monitor/package.json",
        "/apps/indexer-monitor/src/**",
        "/apps/indexer-monitor/tsconfig.json",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
      ],
      buildEnvironment: "V3",
    });
    assert.deepEqual(monitor.variables, {
      ...Object.fromEntries(
        [
          "BUCKET",
          "ENDPOINT",
          "REGION",
          "ACCESS_KEY_ID",
          "SECRET_ACCESS_KEY",
        ].map((key) => [
          key,
          { type: "reference", resource: "bucket.monitor-state", output: key },
        ])
      ),
      INDEXER_METRICS_URL: {
        type: "literal",
        value:
          "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:${{indexer.PORT}}/metrics",
      },
      DISCORD_WEBHOOK_URL: { type: "preserve" },
      DISCORD_WEBHOOK_URL_PREVIEW: {
        type: "sharedReference",
        name: "DISCORD_WEBHOOK_URL_PREVIEW",
      },
      MONITOR_NAME: {
        type: "literal",
        value: "Visualizer",
      },
      MONITOR_COOLDOWN_MINUTES: { type: "preserve" },
    });
    const isIgnored = (service, key) =>
      definition.variables.ignore.some((pattern) => {
        const [nameOrGlob, glob] = pattern.split("/");
        return glob === undefined
          ? matchesGlob(key, nameOrGlob)
          : nameOrGlob === service && matchesGlob(key, glob);
      });
    for (const name of [
      "indexer-monitor",
      "snapshot-monitor",
      "snapshot-publisher",
    ]) {
      const service = resources.find((node) => node.name === name);
      assert.deepEqual(service.variables.DISCORD_WEBHOOK_URL, {
        type: "preserve",
      });
      assert.deepEqual(service.variables.DISCORD_WEBHOOK_URL_PREVIEW, {
        type: "sharedReference",
        name: "DISCORD_WEBHOOK_URL_PREVIEW",
      });
      assert.equal(
        service.variables.DISCORD_PRODUCTION_ENVIRONMENT_ID,
        undefined
      );
    }
    for (const key of Object.keys(monitor.variables))
      assert.equal(
        isIgnored(monitor.name, key),
        false,
        `${key} is IaC managed`
      );
    assert.equal(isIgnored(monitor.name, "MONITOR_INTERVAL_SECONDS"), false);
    for (const name of ["snapshot-monitor", "snapshot-publisher"])
      for (const key of ["MONITOR_STATE_KEY", "MONITOR_STALE_CHAIN_HOURS"])
        assert.equal(isIgnored(name, key), true);
    assert.deepEqual(monitor.deploy, {
      cronSchedule: "*/15 * * * *",
      restartPolicyType: "NEVER",
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 1000000000 } },
      multiRegionConfig: { "us-west2": { numReplicas: 1 } },
    });
    assert.deepEqual(monitor.networking, {
      tcpProxies: {},
      serviceDomains: {},
      customDomains: {},
    });
    assert.equal(monitor.volumeAttachments, undefined);
  }
});

test("production release uses trusted merged code and no PR Railway workflow or plan artifacts", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert(!existsSync(".github/workflows/railway-config.yml"));
  assert(!ci.includes("pull_request_target"));
  const release = ci.split("\n  railway-apply:")[1];
  assert(
    release.includes(
      "github.event_name == 'push' && github.ref == 'refs/heads/master'"
    )
  );
  assert.match(
    release,
    /environment:\n {6}name: production\n {6}deployment: false/
  );
  assert(release.includes("ref: ${{ github.sha }}"));
  assert(!ci.includes("secrets.RAILWAY_TOKEN"));
  assert(!ci.includes("--confirm-destructive"));
  assert(!ci.includes("plan.environmentId !=="));
  assert(!ci.includes("plan.sourceTree !=="));
  assert(
    ci.includes(
      'await require("./scripts/railway-release.cjs").apply({ core });'
    )
  );
  assert.equal(
    (ci.match(/node scripts\/check-cache-database-password.mjs/g) ?? []).length,
    1
  );
  const cache = release.indexOf(
    "node scripts/check-cache-database-password.mjs"
  );
  const plan = release.indexOf("- name: Plan production changes");
  const apply = release.indexOf("- name: Apply reviewed production plan");
  assert(plan >= 0 && plan < cache && cache < apply);
  const token = release.indexOf('test -n "$RAILWAY_API_TOKEN"');
  assert(token >= 0 && token < cache);
  assert(release.includes("cancel-in-progress: false"));
  assert(release.includes("queue: max"));
  for (const [, action] of ci.matchAll(/^ *uses: (\S+)/gm))
    if (!action.startsWith("./")) assert.match(action, /@[0-9a-f]{40}$/);
});

test("database planning preserves larger volumes and rejects incomplete lookups", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-password-policy-"));
  const executable = join(directory, "railway");
  const originalPath = process.env.PATH;
  const ctx = createRailwayContext({ environmentId: "fixture-environment" });
  const response = (services, hasNextPage = false, volumes = []) => ({
    data: {
      environment: {
        serviceInstances: {
          edges: services.map((serviceName) => ({
            node: {
              serviceName,
              serviceId: serviceName,
              domains: { serviceDomains: [], customDomains: [] },
            },
          })),
          pageInfo: { hasNextPage },
        },
        config: {
          services: Object.fromEntries(services.map((name) => [name, {}])),
        },
        volumeInstances: {
          edges: volumes.map(([name, sizeMB]) => ({
            node: { sizeMB, volume: { name } },
          })),
          pageInfo: { hasNextPage: false },
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
    const production = await defineInfrastructure(
      createRailwayContext({
        environment: "production",
        environmentId: "1b61e496-b565-42b4-9e5d-8096e28e13cd",
      })
    );
    const renamedProduction = await defineInfrastructure(
      createRailwayContext({
        environment: "renamed-production",
        environmentId: "1b61e496-b565-42b4-9e5d-8096e28e13cd",
      })
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(renamedProduction)),
      JSON.parse(JSON.stringify(production))
    );
    assert.deepEqual(
      [...existingResources(ctx).tcpPorts.keys()],
      ["Postgres", "rpc-cache-postgres"]
    );
    for (const marker of [null, { isDeleted: true }]) {
      const deleted = response(["indexer"]);
      deleted.data.environment.config.services["removed-id"] = marker;
      fixture(deleted);
      assert.deepEqual(
        [...existingResources(ctx).tcpPorts.keys()],
        ["indexer"]
      );
    }
    for (const marker of [
      false,
      "true",
      { isDeleted: false },
      { isDeleted: "true" },
      {},
      [],
    ]) {
      const active = response(["indexer"]);
      active.data.environment.config.services["unmatched-id"] = marker;
      fixture(active);
      assert.throws(() => existingResources(ctx), /safe existing Railway/);
    }
    for (const marker of [null, false, "true", []]) {
      const incomplete = response(["indexer"]);
      incomplete.data.environment.config.services.indexer = marker;
      fixture(incomplete);
      assert.throws(() => existingResources(ctx), /safe existing Railway/);
    }
    const imported = response([
      "Postgres",
      "hasura",
      "indexer",
      "indexer-monitor",
      "snapshot-publisher",
      "snapshot-monitor",
    ]);
    for (const name of [
      "hasura",
      "indexer",
      "indexer-monitor",
      "snapshot-publisher",
      "snapshot-monitor",
    ])
      imported.data.environment.config.services[name] = {
        networking: { tcpProxies: { 15432: {} } },
      };
    fixture(imported);
    const desired = await defineInfrastructure(
      createRailwayContext({
        environment: "production",
        environmentId: "fixture-environment",
      })
    );
    const serialized = JSON.parse(JSON.stringify(desired)).resources.flat(
      Infinity
    );
    for (const name of [
      "hasura",
      "indexer",
      "indexer-monitor",
      "snapshot-publisher",
      "snapshot-monitor",
    ]) {
      const networking = serialized.find((r) => r.name === name).networking;
      assert.deepEqual(networking.serviceDomains, {});
      assert.deepEqual(networking.customDomains, {});
      assert.deepEqual(networking.tcpProxies, tcpRemovals(name, ["15432"]));
      assert.equal(networking.tcpProxies["15432"], null);
    }
    assert.deepEqual(
      serialized.find((r) => r.name === "Postgres").networking.tcpProxies,
      { 5432: null }
    );
    for (const kind of ["serviceDomains", "customDomains"]) {
      for (const name of ["hasura", "indexer-monitor"]) {
        const exposed = response([name]);
        exposed.data.environment.serviceInstances.edges[0].node.domains[
          kind
        ].push({ domain: "fixture.example" });
        fixture(exposed);
        assert.throws(
          () => existingResources(ctx),
          /Verify private HTTP domains/
        );
      }
    }
    const incompleteDomain = response(["indexer"]);
    delete incompleteDomain.data.environment.serviceInstances.edges[0].node
      .domains;
    const incompleteConfig = response(["indexer"]);
    delete incompleteConfig.data.environment.config.services.indexer;
    const unaccountedConfig = response(["indexer"]);
    unaccountedConfig.data.environment.config.services["unaccounted-id"] = {};
    const badPort = response(["indexer"]);
    badPort.data.environment.config.services.indexer = {
      networking: { tcpProxies: { invalid: {} } },
    };
    for (const incomplete of [
      incompleteDomain,
      incompleteConfig,
      unaccountedConfig,
      badPort,
      response(["unexpected-service"]),
    ]) {
      fixture(incomplete);
      assert.throws(
        () => existingResources(ctx),
        /Verify private HTTP domains/
      );
    }
    for (const value of [null, []]) {
      const malformed = response([]);
      malformed.data.environment.config.services = value;
      fixture(malformed);
      assert.throws(() => existingResources(ctx), /safe existing Railway/);
    }
    const activeWithoutConfig = response(["indexer"]);
    delete activeWithoutConfig.data.environment.config.services;
    fixture(activeWithoutConfig);
    assert.throws(() => existingResources(ctx), /safe existing Railway/);
    const empty = response([]);
    delete empty.data.environment.config.services;
    fixture(empty);
    const fresh = await defineInfrastructure(ctx);
    for (const db of fresh.resources
      .flat(Infinity)
      .filter((r) => r.type === "database"))
      assert.deepEqual(db.variables.POSTGRES_PASSWORD, {
        type: "raw",
        value: { defaultValue: '${{ secret(64, "0123456789abcdef") }}' },
      });
    assert.equal(
      existingResources(ctx).tcpPorts.size,
      0,
      "new previews may have no existing services"
    );
    fixture(
      response(["Postgres", "rpc-cache-postgres"], false, [
        ["destruction-volume", 10000],
        ["rpc-cache-postgres-volume", 50000],
      ])
    );
    for (const environment of ["production", "protocol-visualizer-pr-97"]) {
      const definition = await defineInfrastructure(
        createRailwayContext({
          environment,
          environmentId: "fixture-environment",
        })
      );
      for (const db of definition.resources
        .flat(Infinity)
        .filter((r) => r.type === "database"))
        assert.deepEqual(db.variables.POSTGRES_PASSWORD, { type: "preserve" });
      const volumes = definition.resources
        .flat(Infinity)
        .filter((resource) => resource.type === "volume");
      assert.deepEqual(
        volumes.map((resource) => [resource.name, resource.config.sizeMB]),
        [
          ["destruction-volume", 20000],
          ["rpc-cache-postgres-volume", 50000],
        ]
      );
    }
    for (const value of [
      response(["Postgres"], true),
      response([null]),
      response([""]),
      response(["Postgres"], false, [["", 50000]]),
      response(["Postgres"], false, [["destruction-volume", null]]),
      response(["Postgres"], false, [["destruction-volume", 0]]),
      response(["Postgres"], false, [
        ["destruction-volume", 10000],
        ["destruction-volume", 50000],
      ]),
      {
        data: {
          environment: {
            ...response(["Postgres"]).data.environment,
            volumeInstances: { edges: [], pageInfo: { hasNextPage: true } },
          },
        },
      },
      { errors: [{ message: "Not authorized" }] },
      {},
    ]) {
      fixture(value);
      assert.throws(
        () => existingResources(ctx),
        /refusing to plan database passwords or capacity/
      );
    }
    writeFileSync(executable, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    assert.throws(
      () => existingResources(ctx),
      /refusing to plan database passwords or capacity/
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
