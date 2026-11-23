import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { createRailwayContext } from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";

const railwayServices = defineInfrastructure(
  createRailwayContext({ environment: "production" })
).resources.flat(Infinity);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const dockerfileContent = (path) => readFileSync(path, "utf8");

test("frontend builds retain dependency ordering and dist output without caching external sources", () => {
  assert.deepEqual(readJson("turbo.json").tasks["frontend#build"], {
    dependsOn: ["^build"],
    outputs: ["dist/**"],
    cache: false,
  });
});

test("chain catalog and indexer agree on indexed networks", () => {
  const chains = readJson("packages/protocol-config/protocol-chains.json");
  assert.equal(
    new Set(chains.map((chain) => chain.chainId)).size,
    chains.length
  );
  const indexedIds = chains
    .filter((chain) => chain.availability === "indexed")
    .map((chain) => chain.chainId)
    .sort((a, b) => a - b);
  const configuredIds = [
    ...readFileSync("apps/indexer/config.yaml", "utf8").matchAll(
      /^ {2}- id: (\d+)$/gm
    ),
  ]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  assert.deepEqual(configuredIds, indexedIds);
});

test("other contracts are valid, unique chain-scoped identities", () => {
  const contracts = readJson("packages/protocol-config/other-contracts.json");
  const identities = new Set();
  for (const contract of contracts) {
    assert.match(contract.address, /^0x[0-9a-f]{40}$/);
    assert.notEqual(contract.address, `0x${"0".repeat(40)}`);
    const identity = `${contract.chainId}:${contract.address}`;
    assert(!identities.has(identity), identity);
    identities.add(identity);
  }
});

test("snapshot pre-deploy commands fail on missing RPC settings and validate without running jobs", () => {
  const chains = readJson(
    "packages/protocol-config/protocol-chains.json"
  ).filter((chain) => chain.availability !== "historical");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("RPC_URL_") && name !== "DISCORD_WEBHOOK_URL"
    )
  );
  environment.PROTOCOL_CHAINS_CONFIG_PATH = resolve(
    "packages/protocol-config/protocol-chains.json"
  );
  environment.SNAPSHOT_CHAIN_IDS = "1";
  const configured = Object.fromEntries(
    chains.map(({ chainId }) => [
      `RPC_URL_${chainId}`,
      "https://rpc.example/configured",
    ])
  );
  for (const [service, entry] of [
    ["snapshot-publisher", "publish.js"],
    ["snapshot-monitor", "index.js"],
  ]) {
    const command = railwayServices.find((node) => node.name === service).deploy
      .preDeployCommand;
    assert.deepEqual(command, [`node dist/src/${entry} --check-config`]);
    const run = (variables) =>
      spawnSync(process.execPath, [`dist/src/${entry}`, "--check-config"], {
        cwd: resolve(`apps/${service}`),
        env: { ...environment, ...variables },
        encoding: "utf8",
        timeout: 5000,
      });
    const missing = run({
      RPC_URL_1: "  ",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Missing required RPC variables: RPC_URL_1/);
    for (const webhook of [undefined, "", "  "]) {
      const missingWebhook = run({
        ...configured,
        DISCORD_WEBHOOK_URL: webhook,
      });
      assert.equal(missingWebhook.status, 1);
      assert.match(missingWebhook.stderr, /DISCORD_WEBHOOK_URL is required/);
    }
    const valid = run({
      ...configured,
      DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout, "");
    const subset = run({
      RPC_URL_1: configured.RPC_URL_1,
      DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
    });
    assert.equal(
      subset.status,
      service === "snapshot-publisher" ? 0 : 1,
      subset.stderr
    );
  }
});

test("snapshot jobs log missing webhooks and exit unsuccessfully on startup", () => {
  for (const [service, entry] of [
    ["snapshot-publisher", "publish.js"],
    ["snapshot-monitor", "index.js"],
  ]) {
    for (const webhook of [undefined, "", "  "]) {
      const env = { ...process.env, DISCORD_WEBHOOK_URL: webhook };
      delete env.SNAPSHOT_OUTPUT_DIR;
      const result = spawnSync(process.execPath, [`dist/src/${entry}`], {
        cwd: resolve(`apps/${service}`),
        env,
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /DISCORD_WEBHOOK_URL is required/);
      assert.doesNotMatch(result.stdout, /completed successfully/);
    }
  }
});

test("CI exposes complete image coverage using existing build, scan and integration commands", () => {
  const workflow = readFileSync(".github/workflows/security-scan.yml", "utf8");
  const { scripts } = readJson("package.json");
  const validator = readFileSync("scripts/validate-images.sh", "utf8");
  const dockerfiles = readFileSync("scripts/scan-dockerfiles.mjs", "utf8");
  for (const name of [
    "indexer",
    "frontend",
    "hasura",
    "snapshot-gateway",
    "snapshot-publisher",
    "snapshot-monitor",
    "rpc-cache",
  ]) {
    assert(scripts["docker:build"].includes(`docker:build:${name}`));
    assert(validator.includes(name));
    assert(workflow.includes(`- image: ${name}\n`));
  }
  for (const dockerfile of [
    "Dockerfile-indexer",
    "Dockerfile-frontend",
    "Dockerfile-hasura",
    "Dockerfile-snapshot-gateway",
    "Dockerfile-snapshot-publisher",
    "Dockerfile-snapshot-monitor",
    "Dockerfile-rpc-cache",
  ]) {
    assert(existsSync(dockerfile));
  }
  assert(workflow.includes("fail-fast: false"));
  assert(workflow.includes("run: pnpm run docker:build:${{ matrix.image }}"));
  assert(workflow.includes("run: pnpm run docker:scan -- ${{ matrix.image }}"));
  assert(workflow.includes("Dockerfile-${{ matrix.image }}"));
  assert(workflow.includes("name: Cache + integration"));
  assert(workflow.includes("run: pnpm run docker:build:indexer"));
  assert(
    workflow.includes(
      "name: Scan application image\n        if: ${{ !cancelled() && steps.build.outcome == 'success' }}"
    )
  );
  assert(
    workflow.includes(
      "name: Check Dockerfile\n        if: ${{ !cancelled() && steps.bootstrap.outcome == 'success' }}"
    )
  );
  assert(
    workflow.includes(
      "name: Check runtime image policy\n        if: ${{ !cancelled() && matrix.image == 'rpc-cache' && steps.bootstrap.outcome == 'success' }}"
    )
  );
  assert(
    workflow.includes(
      "!cancelled() && matrix.image == 'rpc-cache' && steps.build.outcome == 'success' && steps.companion.outcome == 'success'"
    )
  );
  assert.match(workflow, /run: pnpm run docker:scan:runtime/);
  assert.match(workflow, /run: pnpm test:integration/);
  assert.match(validator, /pnpm run "docker:build:\$image"/);
  assert.match(validator, /pnpm run docker:scan -- "\$image"/);
  assert.match(validator, /pnpm run docker:scan:dockerfiles/);
  assert.match(validator, /pnpm run docker:scan:runtime/);
  assert(dockerfiles.includes("dockerfile:Dockerfile-*"));
  assert(dockerfiles.includes('"node_modules"'));
  assert.match(workflow, /workflow_dispatch:/);
  assert(!workflow.includes("pnpm audit"));
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert(!ci.includes("docker:build:"));
});

test("Dependabot treats the snapshot gateway as TypeScript", () => {
  const dependabot = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(
    dependabot,
    /package-ecosystem: "npm"\s+directory: "\/apps\/snapshot-gateway"/
  );
});

test("Dependency audit skips fork PRs and uses the pinned action for same-repository PRs", () => {
  const auditWorkflow = readFileSync(".github/workflows/audit.yml", "utf8");
  assert(
    auditWorkflow.includes(
      "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"
    )
  );
  assert(
    auditWorkflow.includes(
      "JamesRobertWiseman/pnpm-audit@ef62519bd4eb8b0b063989599c2ebbf5dd5f5f28"
    )
  );
  assert(auditWorkflow.includes("if: github.event_name == 'pull_request'"));
  assert(auditWorkflow.includes("if: github.event_name != 'pull_request'"));
  assert(auditWorkflow.includes("run: pnpm audit --audit-level moderate"));
  assert(auditWorkflow.includes("level: moderate"));
  assert(auditWorkflow.includes("fails: true"));
  assert(!auditWorkflow.includes("workflow_call:"));
  assert(auditWorkflow.includes("pull_request:"));
  const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert(ciWorkflow.includes("branches: [master]"));
  assert(!ciWorkflow.includes("uses: ./.github/workflows/audit.yml"));
  assert(auditWorkflow.includes("branches: [master]"));
  assert(auditWorkflow.includes('cron: "0 0 * * 1"'));
});

test("Compose includes the Railway-like snapshot services", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  for (const service of [
    "postgres:",
    "rpc-cache:",
    "rpc-cache-postgres:",
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
  for (const chainId of [
    "1",
    "10",
    "42161",
    "421614",
    "84532",
    "4663",
    "8453",
    "80094",
    "11155111",
  ]) {
    assert(
      compose.includes(
        `ENVIO_RPC_URL_${chainId}: http://rpc-cache:4000/pv/evm/${chainId}`
      )
    );
    assert(compose.includes(`Set UPSTREAM_RPC_URL_${chainId} in .env`));
    assert(sampleEnv.includes(`UPSTREAM_RPC_URL_${chainId}=`));
    assert(localDocs.includes(`UPSTREAM_RPC_URL_${chainId}`));
  }
  assert(compose.includes("ETHERSCAN_API_KEY: ${ETHERSCAN_API_KEY:?"));
  assert(compose.includes("Set ETHERSCAN_API_KEY in .env"));
  assert(compose.includes("ENVIO_RPC_MODE: ${ENVIO_RPC_MODE:-}"));
  assert(compose.includes('PORT: "8080"'));
  assert(sampleEnv.includes("ENVIO_API_TOKEN=CHANGEME"));
  assert(sampleEnv.includes("ETHERSCAN_API_KEY="));
  assert(sampleEnv.includes("# ENVIO_RPC_MODE="));
  assert(localDocs.includes("fails early"));
  assert(localDocs.includes("token, Etherscan key, and RPC URLs"));
  assert(indexerDocs.includes("required by the local Docker"));
  assert(indexerDocs.includes("repository root `.env`"));
  assert(indexerDocs.includes("PORT=9898"));
  assert(indexerDocs.includes("indexer.railway.internal:9898/metrics"));
  assert(sampleEnv.includes("PORT=9898"));
  assert(railwayDocs.includes("ENVIO_API_TOKEN=<envio-api-token>"));
  assert(railwayDocs.includes("ETHERSCAN_API_KEY=<etherscan-api-key>"));
  assert(railwayDocs.includes("PORT=8080"));
  assert(railwayDocs.includes("hasura.railway.internal:8080"));
  assert(railwayDocs.includes("PORT=9898"));
  assert(railwayDocs.includes("INDEXER_METRICS_URL"));
  assert(railwayDocs.includes("indexer.railway.internal:9898"));
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
  assert(composeSample.includes("\nDISCORD_WEBHOOK_URL="));
  assert(composeSample.includes("# SNAPSHOT_CHAIN_IDS="));
  assert(indexerSample.includes("HASURA_GRAPHQL_ENDPOINT="));
  assert(indexerSample.includes("# ENVIO_API_TOKEN="));
  assert(indexerSample.includes("# ENVIO_PG_SCHEMA="));
  assert(publisherDocs.includes("# INDEXER_DEPLOYMENT_ID="));
  assert(publisherDocs.includes("\nDISCORD_WEBHOOK_URL="));
  assert(publisherDocs.includes("indexer.PORT=9898"));
  assert(gatewayDocs.includes("# PORT=8080"));
  assert(monitorDocs.includes("indexer.PORT=9898"));
  assert(monitorDocs.includes("# MONITOR_STALE_CHAIN_HOURS=24"));
  assert(railwayDocs.includes("# ENVIO_RPC_MODE="));
  assert(
    railwayDocs.includes(
      "\nDISCORD_WEBHOOK_URL=${{shared.DISCORD_WEBHOOK_URL}}"
    )
  );
});

test("every local Compose host binding is explicitly loopback-only", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const blocks = [...compose.matchAll(/^    ports:\n((?:      - .+\n)+)/gm)];
  assert(blocks.length > 0);
  for (const [, ports] of blocks)
    for (const line of ports.trim().split("\n"))
      assert.match(
        line.trim(),
        /^- "127\.0\.0\.1:\$\{[A-Z_]+:-\d+\}:\d+"$/,
        line
      );
});

test("fresh local PG18 volumes use the official image parent mount and versioned names", () => {
  const compose = readFileSync("docker-compose.yml", "utf8");
  const ref =
    "postgres:18.6-alpine3.24@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b";
  assert.equal(compose.split(ref).length - 1, 2);
  assert(compose.includes("postgres18-data:/var/lib/postgresql"));
  assert(compose.includes("rpc-cache-postgres18-data:/var/lib/postgresql"));
  assert.equal(
    compose.match(/PGDATA: \/var\/lib\/postgresql\/18\/docker/g).length,
    2
  );
  assert(!compose.includes("postgres:17"));
  const runbook = readFileSync("docs/postgresql18-rebuild.md", "utf8");
  assert(
    runbook.includes(
      "After the approved volume operation, generate and review a fresh native plan"
    )
  );
  assert(runbook.includes("Obtain renewed approval for that exact plan"));
  assert(runbook.includes("railway-self-hosting.md#5-apply-the-reviewed-plan"));
  assert(runbook.includes("Keep all writers paused until verification passes"));
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
    "index.html",
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

test("Snapshot monitor runs tests in CI, not during image builds", () => {
  const monitorPackage = readJson("apps/snapshot-monitor/package.json");
  const monitorDockerfile = dockerfileContent("Dockerfile-snapshot-monitor");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  assert.equal(monitorPackage.scripts.build, "tsc");
  assert.equal(monitorPackage.scripts.test, "node --test dist/test/*.test.js");
  const root = readJson("package.json");
  assert(root.scripts.test.startsWith("turbo run test &&"));
  assert(workflow.includes("command: pnpm test"));
  assert.equal(readJson("turbo.json").tasks.test.cache, false);
  assert(workflow.includes("if: matrix.build == true"));
  assert(
    !monitorDockerfile.includes(
      "COPY packages/protocol-config/protocol-chains.json ./packages/protocol-config/protocol-chains.json"
    ),
    "Dockerfile-snapshot-monitor should not copy test-only configuration"
  );
});

test("Frontend and indexer Dockerfiles prune scaffold and local-only files", () => {
  const frontend = dockerfileContent("Dockerfile-frontend");
  assert(frontend.includes("libxml2"));
  assert(frontend.includes("/usr/share/nginx/html/50x.html"));
  assert(existsSync("apps/frontend/public/token.svg"));
  assert(
    readFileSync("apps/frontend/index.html", "utf8").includes("/token.svg")
  );

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

test("source commands separate checks, artifact builds and all ordinary tests", () => {
  const { scripts } = readJson("package.json");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.equal(scripts.build, "turbo run build");
  assert.equal(
    scripts.check,
    "turbo run lint:check && biome check . --linter-enabled=false && biome lint tests services/rpc-cache/integration.test.mjs --only=suspicious/noFocusedTests --only=suspicious/noSelfCompare && biome lint scripts/railway-release.cjs --error-on-warnings && pnpm run lint:actions"
  );
  assert.equal(
    scripts.lint,
    "turbo run lint && biome check --write . --linter-enabled=false && biome lint tests services/rpc-cache/integration.test.mjs --only=suspicious/noFocusedTests --only=suspicious/noSelfCompare && biome lint scripts/railway-release.cjs --error-on-warnings && pnpm run lint:actions"
  );
  for (const alias of ["format", "format:check", "lint:fix", "lint:check"])
    assert.equal(scripts[alias], undefined);
  const commands = [...workflow.matchAll(/command: (pnpm [^\n]+)/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(commands, [
    "pnpm check:runtime-versions",
    "pnpm check",
    "pnpm typecheck",
    "pnpm build",
    "pnpm test",
  ]);
  assert(workflow.includes("fail-fast: false"));
  assert(workflow.includes("if: matrix.codegen == true"));
  assert(workflow.includes("if: matrix.build == true"));
  for (const name of [
    "indexer",
    "snapshot-gateway",
    "snapshot-publisher",
    "snapshot-monitor",
  ])
    assert(readJson(`apps/${name}/package.json`).scripts.test);
  for (const name of ["snapshot-artifacts", "contract-abis"])
    assert(readJson(`packages/${name}/package.json`).scripts.test);
  for (const task of ["test:config", "abis:check"])
    assert(scripts.test.includes(task));
  assert(
    scripts.test.includes(
      "env SNAPSHOT_OUTPUT_DIR=/tmp/protocol-visualizer-snapshots SNAPSHOT_SOURCE=sample pnpm --filter snapshot-publisher start"
    )
  );
  assert(!scripts.test.includes("snapshots:generate:local"));
  const gateway = readJson("apps/snapshot-gateway/package.json").scripts;
  assert.equal(
    gateway.build,
    "tsc && node dist/scripts/generate-openapi.js --check"
  );
  assert.equal(
    gateway["openapi:generate"],
    "pnpm --filter @protocol-visualizer/snapshot-artifacts build && tsc && node dist/scripts/generate-openapi.js"
  );
  for (const file of [
    "apps/indexer/package.json",
    "packages/contract-abis/package.json",
  ])
    assert.equal(readJson(file).scripts.build, undefined);
  for (const name of [
    "snapshot-gateway",
    "snapshot-publisher",
    "snapshot-monitor",
  ])
    assert(
      !readJson(`apps/${name}/package.json`).scripts.build.includes("--test")
    );
  assert(
    !readJson(
      "packages/snapshot-artifacts/package.json"
    ).scripts.build.includes("--test")
  );
});
