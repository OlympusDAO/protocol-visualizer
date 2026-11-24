// Required integration: fixtures own their containers and never touch project volumes.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runRecorded } from "./validation-evidence.mjs";

// The outer invocation owns logs/receipt; its child owns disposable fixtures.
if (process.env.PV_VALIDATION_CHILD !== "integration") {
  process.exitCode = await runRecorded("integration", process.execPath, [
    fileURLToPath(import.meta.url),
  ]);
} else {
  main();
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pgImage =
    "postgres:18.6-alpine3.24@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b";
  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
      ...options,
    });
    if (result.error || result.status !== 0) {
      const error = new Error(
        `Required integration command failed: ${command} (${result.error?.code ?? result.signal ?? result.status})`
      );
      error.status = result.status || 1;
      throw error;
    }
    return result.stdout?.trim();
  }
  try {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: required integration runs outside Turbo.
    if (process.env.RPC_CACHE_TEST_SKIP_RESET === "1")
      throw new Error(
        "test:integration requires reset isolation; unset RPC_CACHE_TEST_SKIP_RESET."
      );
    console.log("[1/2] Check required Docker and prebuilt application images");
    run("docker", ["info", "--format", "{{.ServerVersion}}"]);
    for (const image of ["indexer", "rpc-cache"])
      run("docker", [
        "image",
        "inspect",
        `protocol-visualizer/${image}:local`,
        "--format",
        "{{.RepoTags}}",
      ]);
    // Integration owns preparation of its exact local fixture, independently of
    // production image security scans. Never pull/build missing application images.
    const fixtureImage = spawnSync("docker", ["image", "inspect", pgImage], {
      cwd: root,
      stdio: "ignore",
    });
    if (fixtureImage.error || fixtureImage.signal)
      throw new Error("Cannot inspect the required PostgreSQL fixture image.");
    if (fixtureImage.status !== 0) run("docker", ["pull", pgImage]);
    console.log(
      `Prepared PostgreSQL fixture ${pgImage}: ${run("docker", ["image", "inspect", pgImage, "--format", "{{.Id}}"], { stdio: ["ignore", "pipe", "inherit"] })}`
    );
    console.log(
      "[2/2] Actual eRPC/indexer persistence, restart, docs isolation and reset"
    );
    run("pnpm", ["run", "test:rpc-cache"]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.status || 1;
  }
}
