import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [operation, ...input] = process.argv.slice(2);

function readRailway(args, env = process.env) {
  const result = spawnSync("railway", args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Cannot read Railway context. Check railway login and railway link."
    );
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      "Railway returned invalid context JSON. Check the CLI version."
    );
  }
}

try {
  if (!["metrics", "plan", "apply", "reset"].includes(operation))
    throw new Error("Choose metrics, plan, apply, or reset.");
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Local Railway operations run outside Turbo.
  let requested = process.env.RAILWAY_ENVIRONMENT?.trim();
  const args = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "--environment" || input[i] === "-e") {
      requested = input[++i];
      if (!requested || requested.startsWith("-"))
        throw new Error("--environment requires a name or ID.");
    } else if (input[i].startsWith("--environment=")) {
      requested = input[i].slice("--environment=".length);
      if (!requested) throw new Error("--environment requires a name or ID.");
    } else args.push(input[i]);
  }
  if (operation === "reset" && !requested)
    throw new Error(
      "Set RAILWAY_ENVIRONMENT to the target Railway environment before resetting the indexer."
    );
  if (["metrics", "reset"].includes(operation) && args.length)
    throw new Error("Only --environment is supported for this operation.");
  if (args.some((arg) => /^(--plan|--out)(=|$)/.test(arg)))
    throw new Error(
      "Scripts use railway-plan.json. Use the direct Railway CLI for another artifact path."
    );

  const project = readRailway(["status", "--json"]);
  if (!project.id || !project.name)
    throw new Error("No linked Railway project.");
  const env = { ...process.env, RAILWAY_PROJECT_ID: project.id };
  const { environments } = readRailway(["environment", "list", "--json"], env);
  const matches = environments.filter((item) =>
    requested ? item.id === requested || item.name === requested : item.isLinked
  );
  if (matches.length !== 1)
    throw new Error(
      "Cannot select one Railway environment. Run railway link or pass --environment <name|id>."
    );
  const target = matches[0];
  if (!target.id || !target.name)
    throw new Error("Railway environment metadata is incomplete.");
  env.RAILWAY_ENVIRONMENT = target.id;
  env.RAILWAY_ENVIRONMENT_ID = target.id;
  env.RAILWAY_ENVIRONMENT_NAME = target.name;
  console.error(
    `Railway ${operation}: project ${project.name} (${project.id})`
  );
  console.error(`Environment: ${target.name} (${target.id})`);

  let command = "railway";
  let commandArgs;
  if (operation === "metrics") {
    command = "bash";
    commandArgs = [
      fileURLToPath(new URL("rpc-cache-metrics.sh", import.meta.url)),
    ];
  } else if (operation === "reset") {
    commandArgs = [
      "ssh",
      "--service",
      "indexer",
      "--environment",
      target.id,
      "--",
      "/nodejs/bin/node",
      "/app/apps/indexer/scripts/reset-envio.mjs",
    ];
  } else {
    if (operation === "apply") {
      let plan;
      try {
        plan = JSON.parse(readFileSync("railway-plan.json", "utf8"));
      } catch {
        throw new Error(
          "Cannot read railway-plan.json. Generate and review a plan first."
        );
      }
      if (
        plan.environmentId !== target.id ||
        (plan.projectId && plan.projectId !== project.id)
      )
        throw new Error(
          "Saved plan does not match the selected Railway target. Generate and review a new plan."
        );
    }
    commandArgs = [
      "config",
      operation,
      "--environment",
      target.id,
      operation === "plan" ? "--out" : "--plan",
      "railway-plan.json",
      ...args,
    ];
  }
  const result = spawnSync(command, commandArgs, { env, stdio: "inherit" });
  if (result.error)
    throw new Error(`Cannot start ${command}. Check that it is installed.`);
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
