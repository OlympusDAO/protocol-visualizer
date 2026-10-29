import {
  bucket,
  defineRailway,
  github,
  group,
  database,
  project,
  preserve,
  ref,
  service,
  volume,
} from "railway/iac";

// Secret values remain in Railway; IaC owns connections, not provider credentials.
export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  const source = github("OlympusDAO/protocol-visualizer", {
    // Explicit undefined overrides the SDK's "main" default for PR environments.
    branch: production ? "master" : undefined,
    checkSuites: true,
  });

  // Names and capacities come from Railway's read-only production/PR import.
  const envioDatabase = database("Postgres", "postgres", {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:16",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region: "us-west2",
  });
  // Retain the existing Envio database alias and operator TCP proxy.
  envioDatabase.networking = {
    privateNetworkEndpoint: "postgres",
    tcpProxies: { "5432": {} },
  };
  const envioData = volume("destruction-volume", {
    region: "us-west2",
    sizeMB: production ? 5000 : 50000,
    allowOnlineResize: true,
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
  });
  const cacheDatabase = database("rpc-cache-postgres", "postgres", {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:18",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
    region: "us-west2",
  });
  const cacheData = volume("postgres-volume", {
    region: "us-west2",
    sizeMB: 50000,
    allowOnlineResize: true,
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
  });
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

  const snapshotPublisher = service("snapshot-publisher", {
    source,
    env: {
      ...bucketVariables,
      ...rpcUrls("RPC_URL_"),
      HASURA_GRAPHQL_ADMIN_SECRET: ctx.shared.HASURA_GRAPHQL_ADMIN_SECRET,
      HASURA_GRAPHQL_URL:
        "http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql",
      INDEXER_METRICS_URL:
        "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:${{indexer.PORT}}/metrics",
      DISCORD_WEBHOOK_URL: preserve(),
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
        "/.railway/**",
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
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-snapshot-gateway",
        "/.railway/**",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/ready",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
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
      watchPatterns: ["/Dockerfile-hasura", "/.railway/**"],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 300,
      restartPolicyType: "ON_FAILURE",
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
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-indexer",
        "/.railway/**",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 1,
      limitOverride: { containers: { cpu: 1, memoryBytes: 2000000000 } },
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
        "/packages/protocol-config/**",
        "/package.json",
        "/pnpm-lock.yaml",
        "/pnpm-workspace.yaml",
        "/Dockerfile-frontend",
        "/.railway/**",
      ],
      buildEnvironment: "V3",
    },
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 10,
      restartPolicyType: "ON_FAILURE",
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
      INDEXER_METRICS_URL:
        "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:${{indexer.PORT}}/metrics",
      DISCORD_WEBHOOK_URL: preserve(),
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
        "/.railway/**",
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
      watchPatterns: [
        "/services/rpc-cache/**",
        "/Dockerfile-rpc-cache",
        "/.railway/**",
      ],
    },
    healthcheck: "/healthcheck",
    healthcheckTimeout: 30,
    replicas: { "us-west2": 1 },
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 1 },
  });

  const privateIndexing = group("Private Indexing", [hasura, indexer]);
  const data = group("Data", [envioDatabase]);
  const publicServices = group("Public", [snapshotGateway, frontend]);
  const definition = {
    variables: {
      managed: true,
      // Optional operator settings remain outside IaC ownership.
      ignore: [
        "ENVIO_RPC_MODE",
        "INDEXER_DEPLOYMENT_ID",
        "MONITOR_*",
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
      publicServices,
    ],
  };
  return project("protocol-visualizer", definition);
});
