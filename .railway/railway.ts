import {
  bucket,
  database,
  defineRailway,
  github,
  group,
  preserve,
  project,
  ref,
  service,
  volume,
} from "railway/iac";
import {
  existingResources,
  publicServices,
  tcpRemovals,
} from "./postgres-policy.ts";

// Secret values remain in Railway; IaC owns connections, not provider credentials.
// Long-running services inherit Railway's ON_FAILURE default. CLI 5.71 treats
// explicitly declaring that omitted platform default as perpetual deploy drift.
export default defineRailway((ctx) => {
  const production =
    ctx.isEnvironment("production") ||
    ctx.environmentId === "1b61e496-b565-42b4-9e5d-8096e28e13cd";
  const source = github("OlympusDAO/protocol-visualizer", {
    // Explicit undefined overrides the SDK's "main" default for PR environments.
    branch: production ? "master" : undefined,
    checkSuites: true,
  });

  // Generate URL-safe passwords only for new databases; preserve existing roles.
  const existing = existingResources(ctx);
  // Request 20 GB without shrinking volumes that are already larger.
  const databaseVolume = (name: string) =>
    volume(name, {
      region: "us-west2",
      sizeMB: Math.max(20000, existing?.volumeSizes.get(name) ?? 0),
      allowOnlineResize: true,
      alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    });
  // Prepare the approved main-DB rebuild on PG18.6; live reset remains separate.
  const envioDatabase = database("Postgres", "postgres", {
    image:
      "ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:4fc833b43d2aaf6ecc9b18615f5533602b723a32d0e2efe2dae8ca0f7217c863",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region: "us-west2",
  });
  // Retain the Envio database alias without exposing a public TCP proxy.
  envioDatabase.networking = {
    privateNetworkEndpoint: "postgres",
  };
  const envioData = databaseVolume("destruction-volume");
  const cacheDatabase = database("rpc-cache-postgres", "postgres", {
    image:
      "ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:4fc833b43d2aaf6ecc9b18615f5533602b723a32d0e2efe2dae8ca0f7217c863",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region: "us-west2",
  });
  for (const db of [envioDatabase, cacheDatabase]) {
    db.variables = {
      // Offline checks cannot establish a new database; preserve existing roles.
      POSTGRES_PASSWORD:
        existing === undefined || existing.tcpPorts.has(db.name)
          ? preserve()
          : {
              type: "raw",
              value: { defaultValue: '${{ secret(64, "0123456789abcdef") }}' },
            },
    };
  }
  const cacheData = databaseVolume("rpc-cache-postgres-volume");
  const storage = bucket("storage", { region: "sjc" });
  const chainIds = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
  const rpcUrls = (prefix: string) =>
    Object.fromEntries(
      chainIds.map((id) => [
        `${prefix}${id}`,
        `http://\${{rpc-cache.RAILWAY_PRIVATE_DOMAIN}}:4000/pv/evm/${id}`,
      ])
    );
  const bucketVariables = Object.fromEntries(
    ["BUCKET", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "REGION", "ENDPOINT"].map(
      (key) => [key, ref(storage, key)]
    )
  );
  const indexerMetricsUrl =
    "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:${{indexer.PORT}}/metrics";

  const snapshotPublisher = service("snapshot-publisher", {
    source,
    env: {
      ...bucketVariables,
      ...rpcUrls("RPC_URL_"),
      HASURA_GRAPHQL_ADMIN_SECRET: ctx.shared.HASURA_GRAPHQL_ADMIN_SECRET,
      HASURA_GRAPHQL_URL:
        "http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql",
      INDEXER_METRICS_URL: indexerMetricsUrl,
      DISCORD_WEBHOOK_URL: ctx.shared.DISCORD_WEBHOOK_URL,
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-snapshot-publisher",
      watchPatterns: [
        "/apps/indexer/**",
        "/apps/snapshot-publisher/**",
        "/packages/snapshot-artifacts/**",
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-snapshot-publisher",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      preDeployCommand: ["node dist/src/publish.js --check-config"],
      cronSchedule: "0 * * * *",
      restartPolicyType: "NEVER",
      limitOverride: { containers: { cpu: 1, memoryBytes: 1000000000 } },
    },
    replicas: { "us-west2": 1 },
  });

  const snapshotGateway = service("snapshot-gateway", {
    source,
    env: { ...bucketVariables, PORT: "8080" },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-snapshot-gateway",
      watchPatterns: [
        "/apps/snapshot-gateway/**",
        "/packages/snapshot-artifacts/**",
        "/packages/protocol-config/**",
        "/packages/contract-abis/abis/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-snapshot-gateway",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 1,
      limitOverride: { containers: { cpu: 1, memoryBytes: 1000000000 } },
    },
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "graphql-proxy" },
    domains: production
      ? [{ domain: "protocol-visualizer-api.olympusdao.finance", port: 8080 }]
      : [],
  });

  const hasura = service("hasura", {
    source,
    env: {
      PORT: "8080",
      HASURA_GRAPHQL_DATABASE_URL: ref(envioDatabase, "DATABASE_URL"),
      HASURA_GRAPHQL_ADMIN_SECRET: ctx.shared.HASURA_GRAPHQL_ADMIN_SECRET,
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-hasura",
      watchPatterns: ["/Dockerfile-hasura"],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 300,
      restartPolicyMaxRetries: 1,
      limitOverride: { containers: { cpu: 1, memoryBytes: 2000000000 } },
    },
    replicas: { "us-west2": 1 },
  });

  const indexer = service("indexer", {
    source,
    env: {
      ...rpcUrls("ENVIO_RPC_URL_"),
      PORT: "9898",
      DATABASE_URL: ref(envioDatabase, "DATABASE_URL"),
      HASURA_GRAPHQL_ADMIN_SECRET: ctx.shared.HASURA_GRAPHQL_ADMIN_SECRET,
      HASURA_GRAPHQL_ENDPOINT:
        "http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata",
      ENVIO_API_TOKEN: preserve(),
      ETHERSCAN_API_KEY: preserve(),
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-indexer",
      watchPatterns: [
        "/apps/indexer/**",
        "/packages/snapshot-artifacts/src/observation-constants.ts",
        "/packages/contract-abis/abis/**",
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-indexer",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 1,
      limitOverride: { containers: { cpu: 1, memoryBytes: 2000000000 } },
    },
    replicas: { "us-west2": 1 },
  });

  const indexerMonitor = service("indexer-monitor", {
    source,
    env: {
      ...bucketVariables,
      INDEXER_METRICS_URL: indexerMetricsUrl,
      DISCORD_WEBHOOK_URL: ctx.shared.DISCORD_WEBHOOK_URL,
      MONITOR_NAME: `Visualizer ${production ? "production" : (ctx.environmentName ?? "default")}`,
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-indexer-monitor",
      watchPatterns: [
        "/Dockerfile-indexer-monitor",
        "/apps/indexer-monitor/package.json",
        "/apps/indexer-monitor/src/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      cronSchedule: "*/15 * * * *",
      restartPolicyType: "NEVER",
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 1000000000 } },
    },
    replicas: { "us-west2": 1 },
  });

  const frontend = service("frontend", {
    source,
    env: {
      VITE_PROTOCOL_SNAPSHOT_BASE_URL:
        "https://${{snapshot-gateway.RAILWAY_PUBLIC_DOMAIN}}",
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-frontend",
      watchPatterns: [
        "/apps/frontend/**",
        "/packages/snapshot-artifacts/src/**",
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-frontend",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 10,
      restartPolicyMaxRetries: 1,
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 1000000000 } },
    },
    replicas: { "us-west2": 1 },
    domains: production
      ? [{ domain: "protocol-visualizer.olympusdao.finance", port: 8080 }]
      : [],
  });

  const snapshotMonitor = service("snapshot-monitor", {
    source,
    env: {
      ...bucketVariables,
      ...rpcUrls("RPC_URL_"),
      INDEXER_METRICS_URL: indexerMetricsUrl,
      DISCORD_WEBHOOK_URL: ctx.shared.DISCORD_WEBHOOK_URL,
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-snapshot-monitor",
      watchPatterns: [
        "/apps/snapshot-monitor/**",
        "/packages/snapshot-artifacts/**",
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-snapshot-monitor",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      preDeployCommand: ["node dist/src/index.js --check-config"],
      cronSchedule: "5 0 * * *",
      restartPolicyType: "NEVER",
      limitOverride: { containers: { cpu: 1, memoryBytes: 1000000000 } },
    },
    replicas: { "us-west2": 1 },
  });

  const cache = service("rpc-cache", {
    source,
    env: {
      PORT: "4000",
      RPC_CACHE_DATABASE_URL: ref(cacheDatabase, "DATABASE_URL"),
      ...Object.fromEntries(
        chainIds.map((id) => [`UPSTREAM_RPC_URL_${id}`, preserve()])
      ),
    },
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile-rpc-cache",
      watchPatterns: ["/services/rpc-cache/**", "/Dockerfile-rpc-cache"],
    },
    healthcheck: "/healthcheck",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyMaxRetries: 1 },
  });

  const privateIndexing = group("Private Indexing", [
    hasura,
    indexer,
    indexerMonitor,
  ]);
  const data = group("Data", [envioDatabase]);
  const publicGroup = group("Public", [snapshotGateway, frontend]);
  const definition = {
    variables: {
      managed: true,
      // Optional operator settings remain outside IaC ownership.
      ignore: [
        "ENVIO_RPC_MODE",
        "INDEXER_DEPLOYMENT_ID",
        "snapshot-monitor/MONITOR_*",
        "snapshot-publisher/MONITOR_*",
        "SNAPSHOT_*",
        "PUBLISHER_*",
        "PROTOCOL_CHAINS_CONFIG_PATH",
        "OTHER_CONTRACTS_CONFIG_PATH",
        "RPC_CACHE_MAX_RPS",
      ],
    },
    resources: [
      snapshotPublisher,
      snapshotMonitor,
      cache,
      cacheDatabase,
      envioData,
      cacheData,
      storage,
      privateIndexing,
      data,
      publicGroup,
    ],
  };
  // Apply native maps AFTER SDK normalization so its networking defaults cannot
  // replace the explicit CLI removals. TCP maps are sparse patches:
  // null deletes each known/imported port; an empty map cannot remove a proxy.
  for (const resource of definition.resources.flat()) {
    if (resource.type !== "service" && resource.type !== "database") continue;
    resource.networking = {
      ...resource.networking,
      tcpProxies: tcpRemovals(
        resource.name,
        existing?.tcpPorts.get(resource.name)
      ),
      ...(!publicServices.has(resource.name)
        ? { serviceDomains: {}, customDomains: {} }
        : {}),
    };
  }
  return project("protocol-visualizer", definition);
});
