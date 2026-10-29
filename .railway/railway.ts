import {
  bucket,
  defineRailway,
  github,
  group,
  database,
  project,
  service,
  volume,
} from "railway/iac";

// Service variables remain in Railway. Do not import or commit secret values.
export default defineRailway((ctx) => {
  const production = ctx.isEnvironment("production");
  const branch = production
    ? "master"
    : process.env.RAILWAY_SOURCE_BRANCH?.trim();
  if (!branch)
    throw new Error("Set RAILWAY_SOURCE_BRANCH to the target PR branch");
  const source = github("OlympusDAO/protocol-visualizer", {
    branch,
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

  const snapshotPublisher = service("snapshot-publisher", {
    source,
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
    variables: { managed: false },
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
