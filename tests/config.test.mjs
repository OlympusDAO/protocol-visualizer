import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateRailwayFile, validateGraph } from "railway/iac";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const dockerfileContent = (path) => readFileSync(path, "utf8");

const gitOutput = (args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const currentGitBranch = () => {
  const gitBranch =
    gitOutput(["branch", "--show-current"]) ||
    gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (gitBranch && gitBranch !== "HEAD") {
    return gitBranch;
  }

  const fallbackBranch =
    process.env.GITHUB_HEAD_REF?.trim() || process.env.GITHUB_REF_NAME?.trim();
  if (!fallbackBranch) {
    throw new Error("Unable to determine current Git branch for config tests");
  }

  return fallbackBranch;
};

const railwayProject = async (context) => {
  const result = await evaluateRailwayFile(".railway/railway.ts", {
    context: context ?? {
      environment: "local",
      environmentName: "local",
    },
  });
  const graphErrors = validateGraph(result.graph);
  assert.deepEqual(graphErrors, []);
  return result;
};

test("Railway IaC defines expected services, Dockerfiles, watch patterns, and policies", async () => {
  const { desiredConfig } = await railwayProject();
  const services = desiredConfig.services ?? {};
  const buckets = desiredConfig.buckets ?? {};
  const groups = desiredConfig.groups ?? {};

  assert(existsSync(".railway/railway.ts"));
  for (const removedConfig of [
    "railway-hasura.json",
    "railway-indexer.json",
    "railway-frontend.json",
    "railway-snapshot-gateway.json",
    "railway-snapshot-publisher.json",
    "railway-snapshot-monitor.json",
  ]) {
    assert(!existsSync(removedConfig), `${removedConfig} should be removed`);
  }

  const configs = [
    ["hasura", "Dockerfile-hasura", "ON_FAILURE"],
    ["indexer", "Dockerfile-indexer", "ON_FAILURE"],
    ["frontend", "Dockerfile-frontend", "ON_FAILURE"],
    ["snapshot-gateway", "Dockerfile-snapshot-gateway", "ON_FAILURE"],
    ["snapshot-publisher", "Dockerfile-snapshot-publisher", "NEVER"],
    ["snapshot-monitor", "Dockerfile-snapshot-monitor", "NEVER"],
  ];

  for (const [serviceName, dockerfilePath, restartPolicy] of configs) {
    const config = services[serviceName];
    assert(config, `${serviceName} should be defined in Railway IaC`);
    assert.equal(config.build.dockerfilePath, dockerfilePath);
    assert(
      config.build.watchPatterns.every((pattern) => pattern.startsWith("/"))
    );
    assert(config.build.watchPatterns.includes(`/${dockerfilePath}`));
    assert(config.build.watchPatterns.includes("/.railway/railway.ts"));
    assert(existsSync(dockerfilePath));
    assert.equal(config.deploy.restartPolicyType, restartPolicy);
    if (restartPolicy === "ON_FAILURE") {
      assert.equal(config.deploy.restartPolicyMaxRetries, 1);
    }
    assert(
      config.deploy.limitOverride?.containers?.cpu,
      `${serviceName} should define a vCPU limit`
    );
    assert(
      config.deploy.limitOverride?.containers?.memoryBytes,
      `${serviceName} should define a memory limit`
    );
  }

  assert.equal(services.indexer.deploy.healthcheckPath, "/healthz");
  assert.equal(services["snapshot-gateway"].deploy.healthcheckPath, "/ready");
  assert.equal(services["snapshot-publisher"].deploy.cronSchedule, "0 * * * *");
  assert.equal(services["snapshot-monitor"].deploy.cronSchedule, "5 0 * * *");
  assert.deepEqual(
    Object.fromEntries(
      configs.map(([serviceName]) => [
        serviceName,
        services[serviceName].deploy.limitOverride.containers,
      ])
    ),
    {
      frontend: { cpu: 0.5, memoryBytes: 1_000_000_000 },
      hasura: { cpu: 1, memoryBytes: 2_000_000_000 },
      indexer: { cpu: 1, memoryBytes: 2_000_000_000 },
      "snapshot-gateway": { cpu: 1, memoryBytes: 1_000_000_000 },
      "snapshot-monitor": { cpu: 0.25, memoryBytes: 512_000_000 },
      "snapshot-publisher": { cpu: 1, memoryBytes: 1_000_000_000 },
    }
  );
  const [bucketName] = Object.keys(buckets);
  assert.match(bucketName, /^snapshots-local-[a-f0-9]{8}$/);
  assert.equal(buckets[bucketName].region, "sjc");
  assert.deepEqual(Object.keys(groups).sort(), [
    "Data",
    "Private Indexing",
    "Public",
    "Snapshot Jobs",
  ]);

  for (const [serviceName, variableName] of [
    ["hasura", "HASURA_GRAPHQL_ADMIN_SECRET"],
    ["indexer", "ENVIO_RPC_URL_1"],
    ["indexer", "ENVIO_RPC_URL_10"],
    ["indexer", "ENVIO_RPC_URL_42161"],
    ["indexer", "ENVIO_RPC_URL_8453"],
    ["indexer", "ENVIO_RPC_URL_80094"],
    ["indexer", "ENVIO_RPC_URL_11155111"],
    ["indexer", "ENVIO_API_TOKEN"],
    ["indexer", "ETHERSCAN_API_KEY"],
    ["snapshot-monitor", "DISCORD_WEBHOOK_URL"],
    ["frontend", "VITE_PROTOCOL_SNAPSHOT_BASE_URL"],
  ]) {
    const variable = services[serviceName].variables[variableName];
    assert.equal(variable.isOptional, false, `${variableName} is required`);
    assert.equal(
      variable.preserveExisting,
      true,
      `${variableName} preserves existing Railway value`
    );
    assert.match(variable.description, /Required/);
  }

  assert.equal(
    services["snapshot-publisher"].variables.INDEXER_DEPLOYMENT_ID.value,
    "${{indexer.RAILWAY_DEPLOYMENT_ID}}"
  );
  assert.equal(
    services["snapshot-monitor"].variables.INDEXER_DEPLOYMENT_ID.value,
    "${{indexer.RAILWAY_DEPLOYMENT_ID}}"
  );
});

test("Railway IaC fails when the environment name is missing", async () => {
  await assert.rejects(
    () => evaluateRailwayFile(".railway/railway.ts", { context: {} }),
    /Railway environment name is required/
  );
});

test("Railway IaC derives bucket names and uses one source branch per environment", async () => {
  const production = await railwayProject({
    environment: "production",
    environmentName: "production",
  });
  const preview = await railwayProject({
    environment: "protocol-visualizer-pr-50",
    environmentName: "protocol-visualizer-pr-50",
  });

  assert.deepEqual(Object.keys(production.desiredConfig.buckets ?? {}), [
    "snapshots-production-d9746c8d",
  ]);
  assert.deepEqual(Object.keys(preview.desiredConfig.buckets ?? {}), [
    "snapshots-protocol-visualizer-pr-50-910d0da5",
  ]);

  const expectedBranch = currentGitBranch();
  for (const serviceName of Object.keys(production.desiredConfig.services)) {
    if (!production.desiredConfig.services[serviceName].source?.branch) {
      continue;
    }
    assert.equal(
      production.desiredConfig.services[serviceName].source.branch,
      expectedBranch
    );
  }
  for (const serviceName of Object.keys(preview.desiredConfig.services)) {
    if (!preview.desiredConfig.services[serviceName].source?.branch) {
      continue;
    }
    assert.equal(
      preview.desiredConfig.services[serviceName].source.branch,
      expectedBranch
    );
  }
});

test("CI scans every Dockerfile and local image", () => {
  const workflow = readFileSync(".github/workflows/security-scan.yml", "utf8");
  const packageJson = readFileSync("package.json", "utf8");
  for (const name of [
    "indexer",
    "frontend",
    "hasura",
    "snapshot-gateway",
    "snapshot-publisher",
    "snapshot-monitor",
  ]) {
    assert(packageJson.includes(`"docker:build:${name}"`));
    assert(packageJson.includes(`"docker:tag:scan:${name}"`));
    assert(workflow.includes(`protocol-visualizer/${name}:scan`));
  }
  for (const dockerfile of [
    "Dockerfile-indexer",
    "Dockerfile-frontend",
    "Dockerfile-hasura",
    "Dockerfile-snapshot-gateway",
    "Dockerfile-snapshot-publisher",
    "Dockerfile-snapshot-monitor",
  ]) {
    assert(workflow.includes(dockerfile));
  }
  assert.match(
    workflow,
    /image-ref: protocol-visualizer\/indexer:scan[\s\S]*?ignore-unfixed: true/
  );
});

test("Compose includes the Railway-like snapshot services", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  for (const service of [
    "postgres:",
    "hasura:",
    "indexer:",
    "minio:",
    "minio-create-bucket:",
    "snapshot-gateway:",
    "snapshot-publisher:",
    "snapshot-publisher-sample:",
    "snapshot-monitor:",
    "frontend:",
  ]) {
    assert(compose.includes(service));
  }
  assert(compose.includes("Dockerfile-snapshot-monitor"));
  assert(compose.includes("http://hasura:8080/v1/graphql"));
  assert(compose.includes("http://localhost:8082"));
});

test("Compose requires Envio API token, Etherscan key, and RPC URLs for local indexer runs", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const sampleEnv = readFileSync(".env.compose.sample", "utf8");
  const localDocs = readFileSync("docs/local-stack.md", "utf8");
  const indexerDocs = readFileSync("apps/indexer/README.md", "utf8");
  const railwayDocs = readFileSync("docs/railway-self-hosting.md", "utf8");

  assert(compose.includes("ENVIO_API_TOKEN: ${ENVIO_API_TOKEN:?"));
  for (const chainId of ["1", "10", "42161", "8453", "80094", "11155111"]) {
    assert(compose.includes(`ENVIO_RPC_URL_${chainId}: $`));
    assert(compose.includes(`Set ENVIO_RPC_URL_${chainId} in .env`));
    assert(sampleEnv.includes(`ENVIO_RPC_URL_${chainId}=`));
    assert(localDocs.includes(`ENVIO_RPC_URL_${chainId}`));
  }
  assert(compose.includes("ETHERSCAN_API_KEY: ${ETHERSCAN_API_KEY:?"));
  assert(compose.includes("Set ETHERSCAN_API_KEY in .env"));
  assert(compose.includes("ENVIO_RPC_MODE: ${ENVIO_RPC_MODE:-}"));
  assert(sampleEnv.includes("ENVIO_API_TOKEN=CHANGEME"));
  assert(sampleEnv.includes("ETHERSCAN_API_KEY="));
  assert(sampleEnv.includes("# ENVIO_RPC_MODE="));
  assert(localDocs.includes("fails early"));
  assert(localDocs.includes("token, Etherscan key, and RPC URLs"));
  assert(indexerDocs.includes("required by the local Docker"));
  assert(indexerDocs.includes("repository root `.env`"));
  assert(railwayDocs.includes("ENVIO_API_TOKEN=<envio-api-token>"));
  assert(railwayDocs.includes("ETHERSCAN_API_KEY=<etherscan-api-key>"));
});

test("Env samples and docs keep optional variables commented", () => {
  const composeSample = readFileSync(".env.compose.sample", "utf8");
  const indexerSample = readFileSync("apps/indexer/.env.sample", "utf8");
  const publisherDocs = readFileSync(
    "apps/snapshot-publisher/README.md",
    "utf8"
  );
  const gatewayDocs = readFileSync("apps/snapshot-gateway/README.md", "utf8");
  const monitorDocs = readFileSync("apps/snapshot-monitor/README.md", "utf8");
  const railwayDocs = readFileSync("docs/railway-self-hosting.md", "utf8");

  for (const content of [
    composeSample,
    indexerSample,
    publisherDocs,
    gatewayDocs,
    monitorDocs,
    railwayDocs,
  ]) {
    assert(content.includes("Required"));
    assert(content.includes("Optional"));
  }

  assert(composeSample.includes("ENVIO_API_TOKEN=CHANGEME"));
  assert(composeSample.includes("# DISCORD_WEBHOOK_URL="));
  assert(composeSample.includes("# SNAPSHOT_CHAIN_IDS="));
  assert(indexerSample.includes("HASURA_GRAPHQL_ENDPOINT="));
  assert(indexerSample.includes("# ENVIO_API_TOKEN="));
  assert(indexerSample.includes("# ENVIO_PG_SCHEMA="));
  assert(
    publisherDocs.includes(
      "INDEXER_DEPLOYMENT_ID=${{indexer.RAILWAY_DEPLOYMENT_ID}}"
    )
  );
  assert(publisherDocs.includes("# DISCORD_WEBHOOK_URL="));
  assert(gatewayDocs.includes("# PORT=8080"));
  assert(
    monitorDocs.includes(
      "INDEXER_DEPLOYMENT_ID=${{indexer.RAILWAY_DEPLOYMENT_ID}}"
    )
  );
  assert(monitorDocs.includes("# MONITOR_STALE_CHAIN_HOURS=24"));
  assert(railwayDocs.includes("# ENVIO_RPC_MODE="));
  assert(railwayDocs.includes("# DISCORD_WEBHOOK_URL=<discord webhook url>"));
  assert(
    railwayDocs.includes(
      "INDEXER_DEPLOYMENT_ID=${{indexer.RAILWAY_DEPLOYMENT_ID}}"
    )
  );
});

test("Compose third-party images are pinned by digest", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const imageLines = compose
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("image: "));
  for (const line of imageLines) {
    assert.match(line, /@sha256:[a-f0-9]{64}$/);
  }
});

test("Docker context excludes local, generated, and secret-prone artifacts", () => {
  const dockerignore = readFileSync(".dockerignore", "utf8").split(/\r?\n/);
  for (const pattern of [
    ".pnpm-store",
    "**/.pnpm-store",
    ".envio",
    "**/.envio",
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",
    "build",
    "**/build",
    "**/dist",
    "coverage",
    "**/coverage",
    "**/.gitignore",
    "**/.dockerignore",
    "**/.eslintrc.json",
    "**/README.md",
    ".github",
    ".vscode",
    "apps/indexer/scripts/*.test.mjs",
  ]) {
    assert(
      dockerignore.includes(pattern),
      `.dockerignore should include ${pattern}`
    );
  }
});

test("Snapshot packages publish only runtime files", () => {
  assert.deepEqual(readJson("apps/snapshot-gateway/package.json").files, [
    "dist/src",
    "openapi.json",
  ]);
  for (const packagePath of [
    "apps/snapshot-publisher/package.json",
    "apps/snapshot-monitor/package.json",
    "packages/snapshot-artifacts/package.json",
  ]) {
    assert.deepEqual(readJson(packagePath).files, ["dist/src"]);
  }
});

test("Dockerfiles remove package managers from runtime images", () => {
  for (const dockerfile of [
    "Dockerfile-snapshot-gateway",
    "Dockerfile-snapshot-publisher",
    "Dockerfile-snapshot-monitor",
  ]) {
    const content = dockerfileContent(dockerfile);
    assert(content.includes("@sha256:"));
    for (const artifact of [
      "/usr/local/lib/node_modules/corepack",
      "/usr/local/lib/node_modules/npm",
      "/usr/local/bin/corepack",
      "/usr/local/bin/npm",
      "/usr/local/bin/npx",
      "/usr/local/bin/pnpm",
      "/usr/local/bin/pnpx",
    ]) {
      assert(
        content.includes(artifact),
        `${dockerfile} should remove ${artifact}`
      );
    }
    assert(
      !content.includes('CMD ["pnpm"'),
      `${dockerfile} should not use pnpm as runtime command`
    );
  }

  const indexer = dockerfileContent("Dockerfile-indexer");
  assert(indexer.includes("gcr.io/distroless/nodejs24-debian13@sha256:"));
  assert(
    !indexer.includes('CMD ["pnpm"'),
    "Dockerfile-indexer should not use pnpm as runtime command"
  );
});

test("Snapshot service Dockerfiles prune source and test artifacts", () => {
  for (const [dockerfile, app] of [
    ["Dockerfile-snapshot-gateway", "snapshot-gateway"],
    ["Dockerfile-snapshot-publisher", "snapshot-publisher"],
    ["Dockerfile-snapshot-monitor", "snapshot-monitor"],
  ]) {
    const content = dockerfileContent(dockerfile);
    assert(content.includes("pnpm deploy --legacy"));
    for (const artifact of [
      `/deploy/${app}/node_modules/.modules.yaml`,
      `/deploy/${app}/node_modules/.pnpm/lock.yaml`,
      `find /deploy/${app} -type f -name "*.d.ts" -delete`,
    ]) {
      assert(
        content.includes(artifact),
        `${dockerfile} should prune ${artifact}`
      );
    }
  }
});

test("Frontend and indexer Dockerfiles prune scaffold and local-only files", () => {
  const frontend = dockerfileContent("Dockerfile-frontend");
  assert(frontend.includes("libxml2"));
  for (const asset of [
    "50x.html",
    "file.svg",
    "globe.svg",
    "next.svg",
    "vercel.svg",
    "window.svg",
  ]) {
    assert(frontend.includes(`/usr/share/nginx/html/${asset}`));
  }

  const indexer = dockerfileContent("Dockerfile-indexer");
  assert(!indexer.includes("/app/apps/indexer/.env"));
  assert(!indexer.includes("/app/apps/indexer/README.md"));
  assert(!indexer.includes("/app/apps/indexer/scripts/start-envio.test.mjs"));
});

test("Hasura Dockerfile uses targeted package upgrades", () => {
  const hasura = dockerfileContent("Dockerfile-hasura");
  assert(hasura.includes("@sha256:"));
  assert(hasura.includes("--only-upgrade"));
  assert(!hasura.includes("apt-get upgrade"));
  assert(hasura.includes("USER hasura"));
});
