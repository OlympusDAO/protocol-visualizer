import { defineRailway, github, postgres, project, service } from "railway/iac";

// Incremental migration: only these two new resources belong to this partial.
// Omitting legacy services must never turn into a whole-project deletion plan.
export const partial = "rpc-cache";

export default defineRailway((ctx) => {
  const branch = process.env.RAILWAY_SOURCE_BRANCH?.trim();
  if (!branch) {
    throw new Error("Set RAILWAY_SOURCE_BRANCH to the target GitHub branch");
  }

  const database = postgres("rpc-cache-postgres", { region: "us-west2" });
  const chainIds = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
  const cache = service("rpc-cache", {
    source: github("OlympusDAO/protocol-visualizer", {
      branch,
      rootDirectory: "/",
    }),
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
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 1,
    },
    env: {
      PORT: "4000",
      RPC_CACHE_MAX_RPS: "50",
      RPC_CACHE_DATABASE_URL: database.env.DATABASE_URL,
      ...Object.fromEntries(
        chainIds.map((id) => {
          const key = `UPSTREAM_RPC_URL_${id}`;
          return [key, ctx.shared[key]];
        })
      ),
    },
  });

  return project("protocol-visualizer", { resources: [database, cache] });
});
