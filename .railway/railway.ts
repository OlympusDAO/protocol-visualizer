import {
  bucket,
  defineRailway,
  github,
  group,
  postgres,
  project,
  ref,
  service,
} from "railway/iac";
import type { RailwayContext, VariableConfig } from "railway/iac";

const REPOSITORY = "OlympusDAO/protocol-visualizer";

const environmentSlug = (environmentName: string) => {
  const slug = environmentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "local";
};

const environmentNameFor = (ctx: RailwayContext) => {
  const environmentName = ctx.environmentName ?? ctx.environment;
  if (!environmentName) {
    throw new Error(
      "Railway environment name is required to derive the GitHub source branch and snapshot bucket name."
    );
  }
  return environmentName;
};

const bucketNameForEnvironment = (ctx: RailwayContext) => {
  const slug = environmentSlug(environmentNameFor(ctx)).slice(0, 36);
  return `snapshots-${slug}-${ctx.randomString("snapshot-bucket", 4)}`;
};

const githubBranchForEnvironment = () => {
  const branch = process.env.RAILWAY_GIT_BRANCH?.trim();
  if (branch) {
    return branch;
  }
  throw new Error(
    "RAILWAY_GIT_BRANCH is required to derive the GitHub source branch for Railway IaC."
  );
};

const dockerBuild = (dockerfilePath: string, watchPatterns: string[]) => ({
  builder: "DOCKERFILE" as const,
  dockerfilePath,
  watchPatterns,
});

const onFailure = {
  restartPolicyType: "ON_FAILURE" as const,
  restartPolicyMaxRetries: 1,
};

const resourceLimit = (cpu: number, memoryBytes: number) => ({
  limitOverride: {
    containers: {
      cpu,
      memoryBytes,
    },
  },
});

// Use raw required variable configs instead of the SDK's preserve() shorthand
// for secrets and externally supplied values. This keeps existing Railway
// values intact, but still documents that the variable is required.
const requiredExisting = (description: string): VariableConfig => ({
  description,
  isOptional: false,
  preserveExisting: true,
});

export default defineRailway((ctx) => {
  const environmentName = environmentNameFor(ctx);
  const githubBranch = githubBranchForEnvironment();
  const source = github(REPOSITORY, {
    branch: githubBranch,
    checkSuites: true,
  });
  const database = postgres("Postgres");
  const snapshots = bucket(bucketNameForEnvironment(ctx), {
    region: "sjc",
  });

  const hasura = service("hasura", {
    source,
    build: dockerBuild("Dockerfile-hasura", [
      "/Dockerfile-hasura",
      "/.railway/railway.ts",
    ]),
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 300,
      ...resourceLimit(1, 2_000_000_000),
      ...onFailure,
    },
    env: {
      HASURA_GRAPHQL_DATABASE_URL: database.env.DATABASE_URL,
      HASURA_GRAPHQL_ADMIN_SECRET: requiredExisting(
        "Required Hasura admin secret. Set once in Railway; IaC preserves the existing value."
      ),
    },
  });

  const indexer = service("indexer", {
    source,
    build: dockerBuild("Dockerfile-indexer", [
      "/apps/indexer/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/Dockerfile-indexer",
      "/.railway/railway.ts",
    ]),
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 30,
      ...resourceLimit(1, 2_000_000_000),
      ...onFailure,
    },
    env: {
      DATABASE_URL: database.env.DATABASE_URL,
      HASURA_GRAPHQL_ENDPOINT:
        "http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/metadata",
      HASURA_GRAPHQL_ADMIN_SECRET: hasura.env.HASURA_GRAPHQL_ADMIN_SECRET,
      ENVIO_RPC_URL_1: requiredExisting("Required Ethereum RPC URL."),
      ENVIO_RPC_URL_10: requiredExisting("Required Optimism RPC URL."),
      ENVIO_RPC_URL_42161: requiredExisting("Required Arbitrum RPC URL."),
      ENVIO_RPC_URL_8453: requiredExisting("Required Base RPC URL."),
      ENVIO_RPC_URL_80094: requiredExisting("Required Berachain RPC URL."),
      ENVIO_RPC_URL_11155111: requiredExisting("Required Sepolia RPC URL."),
      ENVIO_API_TOKEN: requiredExisting(
        "Required Envio API token for production HyperSync indexing."
      ),
      ETHERSCAN_API_KEY: requiredExisting(
        "Required Etherscan API key for contract metadata generation."
      ),
      ENVIO_RPC_MODE: {
        isOptional: true,
        preserveExisting: true,
      },
    },
  });

  const snapshotPublisher = service("snapshot-publisher", {
    source,
    build: dockerBuild("Dockerfile-snapshot-publisher", [
      "/apps/indexer/**",
      "/apps/snapshot-publisher/**",
      "/packages/snapshot-artifacts/**",
      "/packages/protocol-config/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/Dockerfile-snapshot-publisher",
      "/.railway/railway.ts",
    ]),
    deploy: {
      cronSchedule: "0 * * * *",
      ...resourceLimit(1, 1_000_000_000),
      restartPolicyType: "NEVER",
    },
    env: {
      HASURA_GRAPHQL_URL:
        "http://${{hasura.RAILWAY_PRIVATE_DOMAIN}}:8080/v1/graphql",
      HASURA_GRAPHQL_ADMIN_SECRET: hasura.env.HASURA_GRAPHQL_ADMIN_SECRET,
      INDEXER_METRICS_URL:
        "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics",
      BUCKET: ref(snapshots, "BUCKET"),
      ACCESS_KEY_ID: ref(snapshots, "ACCESS_KEY_ID"),
      SECRET_ACCESS_KEY: ref(snapshots, "SECRET_ACCESS_KEY"),
      REGION: ref(snapshots, "REGION"),
      ENDPOINT: ref(snapshots, "ENDPOINT"),
      INDEXER_DEPLOYMENT_ID: indexer.env.RAILWAY_DEPLOYMENT_ID,
      DISCORD_WEBHOOK_URL: {
        isOptional: true,
        preserveExisting: true,
      },
      MONITOR_STALE_CHAIN_HOURS: {
        defaultValue: "24",
        isOptional: true,
        preserveExisting: true,
      },
      SNAPSHOT_PUBLIC_BASE_PATH: {
        isOptional: true,
        preserveExisting: true,
      },
    },
  });

  const snapshotMonitor = service("snapshot-monitor", {
    source,
    build: dockerBuild("Dockerfile-snapshot-monitor", [
      "/apps/snapshot-monitor/**",
      "/packages/snapshot-artifacts/**",
      "/packages/protocol-config/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/Dockerfile-snapshot-monitor",
      "/.railway/railway.ts",
    ]),
    deploy: {
      cronSchedule: "5 0 * * *",
      ...resourceLimit(0.25, 512_000_000),
      restartPolicyType: "NEVER",
    },
    env: {
      DISCORD_WEBHOOK_URL: requiredExisting(
        "Required Discord webhook URL for monitor notifications."
      ),
      INDEXER_METRICS_URL:
        "http://${{indexer.RAILWAY_PRIVATE_DOMAIN}}:9898/metrics",
      BUCKET: ref(snapshots, "BUCKET"),
      ACCESS_KEY_ID: ref(snapshots, "ACCESS_KEY_ID"),
      SECRET_ACCESS_KEY: ref(snapshots, "SECRET_ACCESS_KEY"),
      REGION: ref(snapshots, "REGION"),
      ENDPOINT: ref(snapshots, "ENDPOINT"),
      INDEXER_DEPLOYMENT_ID: indexer.env.RAILWAY_DEPLOYMENT_ID,
      MONITOR_STATE_KEY: {
        defaultValue: "v1/monitor-state.json",
        isOptional: true,
        preserveExisting: true,
      },
      MONITOR_STALE_CHAIN_HOURS: {
        defaultValue: "24",
        isOptional: true,
        preserveExisting: true,
      },
    },
  });

  const snapshotGateway = service("snapshot-gateway", {
    source,
    build: dockerBuild("Dockerfile-snapshot-gateway", [
      "/apps/snapshot-gateway/**",
      "/packages/snapshot-artifacts/**",
      "/packages/protocol-config/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/Dockerfile-snapshot-gateway",
      "/.railway/railway.ts",
    ]),
    deploy: {
      healthcheckPath: "/ready",
      healthcheckTimeout: 30,
      ...resourceLimit(1, 1_000_000_000),
      ...onFailure,
    },
    env: {
      BUCKET: ref(snapshots, "BUCKET"),
      ACCESS_KEY_ID: ref(snapshots, "ACCESS_KEY_ID"),
      SECRET_ACCESS_KEY: ref(snapshots, "SECRET_ACCESS_KEY"),
      REGION: ref(snapshots, "REGION"),
      ENDPOINT: ref(snapshots, "ENDPOINT"),
      HASURA_GRAPHQL_URL: {
        isOptional: true,
        preserveExisting: true,
      },
    },
  });

  const frontend = service("frontend", {
    source,
    build: dockerBuild("Dockerfile-frontend", [
      "/apps/frontend/**",
      "/packages/protocol-config/**",
      "/package.json",
      "/pnpm-lock.yaml",
      "/pnpm-workspace.yaml",
      "/.railway/railway.ts",
      "/Dockerfile-frontend",
    ]),
    deploy: {
      healthcheckPath: "/",
      healthcheckTimeout: 10,
      ...resourceLimit(0.5, 1_000_000_000),
      ...onFailure,
    },
    env: {
      VITE_PROTOCOL_SNAPSHOT_BASE_URL: requiredExisting(
        "Required public snapshot API base URL for the frontend."
      ),
    },
  });

  return project("protocol-visualizer", {
    resources: [
      group("Data", [database, snapshots], {
        color: "green",
        icon: "database",
      }),
      group("Private Indexing", [hasura, indexer], {
        color: "blue",
        icon: "server",
      }),
      group("Snapshot Jobs", [snapshotPublisher, snapshotMonitor], {
        color: "yellow",
        icon: "clock",
      }),
      group("Public", [snapshotGateway, frontend], {
        color: "purple",
        icon: "globe",
      }),
    ],
  });
});
