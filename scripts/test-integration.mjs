// Required integration: fixtures own their containers and never touch project volumes.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runRecorded } from "./validation-evidence.mjs";

// The outer invocation owns logs/receipt; its child owns disposable fixtures.
if (process.env.PV_VALIDATION_CHILD !== "integration") {
  process.exitCode = await runRecorded("integration", process.execPath, [
    fileURLToPath(import.meta.url),
  ]);
} else {
  await main();
}

async function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pgImage =
    "postgres:18.6-alpine3.24@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b";
  const name = `pv-state-test-${randomUUID()}`;
  let createAttempted = false;
  const shutdown = new AbortController();
  const interrupt = (signal) =>
    shutdown.abort(
      Object.assign(
        new Error(`Required integration interrupted by ${signal}`),
        {
          status: signal === "SIGINT" ? 130 : 143,
        }
      )
    );
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
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: required integration runs outside Turbo.
    if (process.env.RPC_CACHE_TEST_SKIP_RESET === "1")
      throw new Error(
        "test:integration requires reset isolation; unset RPC_CACHE_TEST_SKIP_RESET."
      );
    console.log("[1/3] Check required Docker and prebuilt application images");
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
      "[2/3] Native PostgreSQL persistence and rollback across restarts"
    );
    // The daemon can create the fixture before the CLI reports an interruption.
    createAttempted = true;
    run("docker", [
      "create",
      "--name",
      name,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD=fixture",
      "--env",
      "PGDATA=/var/lib/postgresql/18/docker",
      pgImage,
    ]);
    run("docker", ["start", name]);
    console.log(
      `PostgreSQL fixture image: ${run("docker", ["inspect", name, "--format", "{{.Image}}"], { stdio: ["ignore", "pipe", "inherit"] })}`
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      ready = await new Promise((resolve) => {
        // The entrypoint's temporary initialization server accepts Unix sockets
        // before the final TCP listener starts. Wait for the listener tests use.
        const probe = spawn(
          "docker",
          ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
          { stdio: "ignore", signal: shutdown.signal }
        );
        probe.once("error", () => {});
        probe.once("close", (code) => resolve(code === 0));
      });
      shutdown.signal.throwIfAborted();
      if (ready) break;
      await setTimeout(200, undefined, { signal: shutdown.signal });
    }
    if (!ready) throw new Error("Disposable PostgreSQL did not become ready.");
    const port = run("docker", ["port", name, "5432/tcp"], {
      stdio: ["ignore", "pipe", "inherit"],
    })
      .split(":")
      .at(-1);
    run(
      process.execPath,
      [
        "--import",
        "./scripts/register-typescript.mjs",
        "--test",
        "scripts/state-postgres.test.mjs",
        "scripts/effect-cache-stash.test.mjs",
      ],
      {
        cwd: fileURLToPath(new URL("../apps/indexer/", import.meta.url)),
        env: {
          ...process.env,
          PV_REQUIRE_POSTGRES: "1",
          PV_CACHE_POSTGRES_URL: `postgres://postgres:fixture@127.0.0.1:${port}/postgres`,
        },
      }
    );
    console.log(
      "[3/3] Actual eRPC/indexer persistence, restart, docs isolation and reset"
    );
    run("pnpm", ["run", "test:rpc-cache"]);
  } catch (error) {
    const failure =
      error.name === "AbortError" && shutdown.signal.aborted
        ? shutdown.signal.reason
        : error;
    console.error(failure.message);
    process.exitCode = failure.status || 1;
  } finally {
    if (createAttempted) {
      const cleanup = spawnSync(
        "docker",
        ["rm", "--force", "--volumes", name],
        {
          stdio: "inherit",
        }
      );
      if (cleanup.status !== 0) process.exitCode ||= 1;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
