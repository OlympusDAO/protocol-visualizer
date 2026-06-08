import { spawnSync } from "node:child_process";

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
};

const environmentsResult = run("railway", ["environment", "list", "--json"]);

if (environmentsResult.status !== 0) {
  process.stderr.write(environmentsResult.stderr);
  process.exit(environmentsResult.status ?? 1);
}

const environments = JSON.parse(environmentsResult.stdout).environments ?? [];
const linkedEnvironment = environments.find(
  (environment) => environment.isLinked
);
const branch = linkedEnvironment?.meta?.branch?.trim();

if (!branch) {
  const environmentName = linkedEnvironment?.name ?? "unknown";
  throw new Error(
    `Linked Railway environment ${environmentName} does not expose meta.branch. RAILWAY_GIT_BRANCH cannot be derived for IaC planning.`
  );
}

const planResult = run(
  "railway",
  [
    "config",
    "plan",
    "--file",
    ".railway/railway.ts",
    "--runner",
    "./node_modules/.bin/railway-iac-ts",
    "--verbose",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RAILWAY_GIT_BRANCH: branch,
    },
  }
);

process.exit(planResult.status ?? 1);
