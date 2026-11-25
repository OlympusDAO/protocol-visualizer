import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const pause = (ms) => new Promise((accept) => setTimeout(accept, ms));
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error("Fixture did not become ready");
}
async function untilGone(pid) {
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return true;
    }
  });
}
async function stopWorker(marker) {
  let pid;
  try {
    pid = Number(readFileSync(marker, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assert(
    Number.isInteger(pid) && pid > 0,
    "owned worker PID must be a positive integer"
  );
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await untilGone(pid);
}
function command(child) {
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });
  const done = new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code) => accept({ code, output }));
  });
  return { child, done, output: () => output };
}

for (const {
  migrationCode,
  startCode,
  startSignal,
  cleanStart = false,
  commandArgs = [],
  shutdownSignal,
  migrationSignal,
  resetTimeout = false,
} of [
  { migrationCode: 0 },
  { migrationCode: 17 },
  { migrationCode: 0, startCode: 1 },
  { migrationCode: 0, startCode: 78 },
  { migrationCode: 0, startCode: 23 },
  { migrationCode: 0, startSignal: "SIGTERM" },
  { migrationCode: 0, cleanStart: true },
  { migrationCode: 0, commandArgs: ["local", "db-migrate", "setup"] },
  { migrationCode: 17, commandArgs: ["local", "db-migrate", "setup"] },
  { migrationCode: 0, shutdownSignal: "SIGTERM" },
  { migrationCode: 0, shutdownSignal: "SIGINT" },
  { migrationCode: 0, migrationSignal: "SIGTERM" },
  { migrationCode: 0, migrationSignal: "SIGINT" },
  { migrationCode: 0, resetTimeout: true },
]) {
  test(`explicit reset lifecycle (migration ${migrationSignal ?? migrationCode}, start ${startSignal ?? startCode ?? 0}, shutdown ${shutdownSignal ?? "none"}${resetTimeout ? ", stop timeout true" : ""}${cleanStart ? ", clean completion" : ""}${commandArgs.length ? ", one-off" : ""})`, {
    timeout: 20_000,
  }, async () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "envio reset 'quoted' $path;-"))
    );
    const app = join(root, "apps/indexer");
    const scripts = join(app, "scripts");
    const running = join(root, "running");
    const workerRunning = join(root, "worker-running");
    const migrated = join(root, "migrated");
    const migrationRunning = join(root, "migration-running");
    const migrationStopped = join(root, "migration-stopped");
    const migrationBlocked = join(root, "migration-blocked");
    const socketPath = join(
      "/tmp",
      `pv-envio-${createHash("sha256").update(app).digest("hex").slice(0, 12)}.sock`
    );
    mkdirSync(scripts, { recursive: true });
    mkdirSync(join(app, "node_modules/envio"), { recursive: true });
    writeFileSync(migrationBlocked, "");
    for (const file of ["start-envio.mjs", "reset-envio.mjs"])
      copyFileSync(new URL(file, import.meta.url), join(scripts, file));
    copyFileSync(
      new URL("fixtures/reset-envio.mjs", import.meta.url),
      join(app, "node_modules/envio/bin.mjs")
    );
    const hasura = http.createServer((_req, res) => res.end("{}"));
    await new Promise((accept) => hasura.listen(0, "127.0.0.1", accept));
    const reserve = http.createServer();
    await new Promise((accept) => reserve.listen(0, "127.0.0.1", accept));
    const port = reserve.address().port;
    await new Promise((accept) => reserve.close(accept));
    const env = {
      ...process.env,
      DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture",
      HASURA_GRAPHQL_ENDPOINT: `http://127.0.0.1:${hasura.address().port}/v1/metadata`,
      HASURA_GRAPHQL_ADMIN_SECRET: "fixture",
      ETHERSCAN_API_KEY: "fixture",
      ENVIO_RPC_MODE: "sync",
      PORT: String(port),
      ENVIO_INDEXER_PORT: String(port),
      RESET_FIXTURE_ROOT: root,
      RESET_FIXTURE_MIGRATION_CODE: String(migrationCode),
      RESET_FIXTURE_START_CODE: String(startCode ?? 0),
      RESET_FIXTURE_START_SIGNAL: startSignal ?? "",
      RESET_FIXTURE_START_COMPLETE: cleanStart ? "1" : "0",
    };
    for (const id of [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532])
      env[`ENVIO_RPC_URL_${id}`] = "http://fixture.invalid";
    const args = [join(scripts, "start-envio.mjs"), ...commandArgs];
    if (commandArgs.length) rmSync(migrationBlocked);
    if (resetTimeout) {
      // Keep the ingestion group alive and advance only its stop deadline.
      const preload = `const kill = process.kill.bind(process), now = Date.now;
let clockReads;
process.kill = (pid, signal) => {
  if (pid < 0 && signal === "SIGTERM") { clockReads = 0; return true; }
  if (pid < 0 && signal === 0 && clockReads !== undefined) return true;
  return kill(pid, signal);
};
Date.now = () => now() + (clockReads !== undefined && clockReads++ > 0 ? 30001 : 0);`;
      args.unshift(
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`
      );
    }
    const wrapper = command(
      spawn(process.execPath, args, {
        cwd: "/",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    );
    try {
      if (cleanStart || commandArgs.length) {
        const result = await wrapper.done;
        assert.equal(
          result.code,
          commandArgs.length ? migrationCode : 0,
          result.output
        );
        assert(!existsSync(running) && !existsSync(workerRunning));
        if (cleanStart) assert(!existsSync(migrated));
        return;
      }
      await until(() => existsSync(socketPath));
      if (startCode || startSignal) {
        await until(() => /Envio stopped/.test(wrapper.output()));
        assert.equal(wrapper.child.exitCode, null, wrapper.output());
        assert(!existsSync(running));
        assert(
          !existsSync(migrated),
          "failed startup must never reset storage"
        );
        assert.equal(
          (await fetch(`http://127.0.0.1:${port}/healthz`)).status,
          200
        );
        for (const route of ["ready", "metrics"])
          assert.equal(
            (await fetch(`http://127.0.0.1:${port}/${route}`)).status,
            503
          );
        if (startSignal)
          assert(
            existsSync(workerRunning),
            "native exit left a descendant for reset to drain"
          );
      } else {
        await until(() => {
          assert.equal(wrapper.child.exitCode, null, wrapper.output());
          return existsSync(running) && existsSync(workerRunning);
        });
      }
      if (shutdownSignal) {
        wrapper.child.kill(shutdownSignal);
        assert.equal(
          (await wrapper.done).code,
          shutdownSignal === "SIGINT" ? 130 : 143
        );
        assert(
          !existsSync(running) && !existsSync(workerRunning),
          "wrapper must wait for ingestion shutdown"
        );
        assert(!existsSync(migrated), "shutdown must not reset storage");
        return;
      }
      const oldPid = existsSync(running)
        ? readFileSync(running, "utf8")
        : undefined;
      const orphanPid = startSignal
        ? Number(readFileSync(workerRunning, "utf8"))
        : undefined;
      const requestReset = () =>
        command(
          spawn(process.execPath, [join(scripts, "reset-envio.mjs")], {
            cwd: "/",
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
          })
        );
      let resetting = requestReset();
      if (resetTimeout) {
        const reset = await resetting.done;
        assert.equal(reset.code, 1, reset.output);
        assert.match(
          reset.output,
          /Ingestion did not stop within 30 seconds; migration was not started/
        );
        assert(!existsSync(migrated));
        assert(existsSync(running) && existsSync(workerRunning));
        assert.equal(
          (await fetch(`http://127.0.0.1:${port}/ready`)).status,
          503
        );
        return;
      }
      if (startSignal) {
        await until(
          () => resetting.child.exitCode !== null || existsSync(migrated)
        );
        if (resetting.child.exitCode !== null) {
          const refused = await resetting.done;
          assert.equal(refused.code, 1, refused.output);
          assert.match(refused.output, /Reset failed: kill EPERM\./);
          assert(!existsSync(migrated), "refused reset must not migrate");
          assert.equal(wrapper.child.exitCode, null, wrapper.output());
          for (const route of ["ready", "metrics"])
            assert.equal(
              (await fetch(`http://127.0.0.1:${port}/${route}`)).status,
              503
            );
          assert(
            !existsSync(workerRunning),
            "EPERM with a live worker must fail"
          );
          assert(Number.isInteger(orphanPid) && orphanPid > 0);
          await untilGone(orphanPid);
          resetting = requestReset();
        }
      }
      await until(() => {
        assert.equal(wrapper.child.exitCode, null, wrapper.output());
        assert.equal(resetting.child.exitCode, null, resetting.output());
        return existsSync(migrated);
      });
      if (migrationSignal) {
        wrapper.child.kill(migrationSignal);
        const result = await wrapper.done;
        assert.equal(
          result.code,
          migrationSignal === "SIGINT" ? 130 : 143,
          result.output
        );
        assert(
          !existsSync(migrationRunning),
          "wrapper must wait for migration shutdown"
        );
        assert.equal(readFileSync(migrationStopped, "utf8"), migrationSignal);
        assert(!existsSync(running) && !existsSync(workerRunning));
        assert(!existsSync(socketPath), "wrapper must close its reset socket");
        const reset = await resetting.done;
        assert.equal(reset.code, 1, reset.output);
        return;
      }
      for (const route of ["ready", "metrics"]) {
        assert.equal(wrapper.child.exitCode, null, wrapper.output());
        assert.equal(
          (await fetch(`http://127.0.0.1:${port}/${route}`)).status,
          503,
          wrapper.output()
        );
      }
      const duplicate = await command(
        spawn(process.execPath, [join(scripts, "reset-envio.mjs")], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5_000,
          shell: false,
        })
      ).done;
      assert.equal(duplicate.code, 1);
      assert.match(duplicate.output, /already in progress/);
      rmSync(migrationBlocked);
      const reset = await resetting.done;
      assert.equal(reset.code, migrationCode, reset.output);
      assert.equal(readFileSync(migrated, "utf8"), "local db-migrate setup\n");
      if (migrationCode === 0) {
        await until(() => existsSync(running) && existsSync(workerRunning));
        assert.notEqual(readFileSync(running, "utf8"), oldPid);
      } else {
        assert(!existsSync(running) && !existsSync(workerRunning));
      }
      assert.equal(
        wrapper.child.exitCode,
        null,
        "container supervisor must stay alive"
      );
      assert.match(
        reset.output,
        migrationCode === 0
          ? /Envio restarted inside the existing container/
          : /migration failed/
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${port}/healthz`)).status,
        200
      );
      if (migrationCode !== 0)
        for (const route of ["ready", "metrics"])
          assert.equal(
            (await fetch(`http://127.0.0.1:${port}/${route}`)).status,
            503
          );
    } finally {
      if (existsSync(migrationRunning)) {
        try {
          process.kill(
            Number(readFileSync(migrationRunning, "utf8")),
            "SIGKILL"
          );
        } catch {}
      }
      rmSync(migrationBlocked, { force: true });
      if (existsSync(running)) {
        try {
          process.kill(-Number(readFileSync(running, "utf8")), "SIGKILL");
        } catch {}
      }
      wrapper.child.kill("SIGKILL");
      await wrapper.done;
      try {
        await stopWorker(workerRunning);
      } finally {
        await new Promise((accept) => hasura.close(accept));
        rmSync(socketPath, { force: true });
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
}

test("Railway package command requires an explicit environment and forwards it before remote arguments", async () => {
  const script = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url))
  ).scripts["reset:indexer:railway"];
  const root = mkdtempSync(join(tmpdir(), "railway reset 'quoted' $path;-"));
  writeFileSync(
    join(root, "railway"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "status") console.log(JSON.stringify({id:"project-id",name:"fixture"}));
else if (args[0] === "environment") console.log(JSON.stringify({environments:[{id:"staging-id",name:process.env.RAILWAY_ENVIRONMENT,isLinked:false}]}));
else console.log(JSON.stringify(args));
`,
    { mode: 0o700 }
  );
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}` };
  delete env.RAILWAY_ENVIRONMENT;
  try {
    const missing = await command(
      spawn("/bin/sh", ["-c", script], {
        cwd: new URL("../../../", import.meta.url),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    ).done;
    assert.notEqual(missing.code, 0);
    assert.match(missing.output, /Set RAILWAY_ENVIRONMENT/);
    const valid = await command(
      spawn("/bin/sh", ["-c", script], {
        cwd: new URL("../../../", import.meta.url),
        env: { ...env, RAILWAY_ENVIRONMENT: "staging 'quoted'; $branch" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    ).done;
    assert.equal(valid.code, 0, valid.output);
    assert.match(
      valid.output,
      /Environment: staging 'quoted'; \$branch \(staging-id\)/
    );
    assert.deepEqual(
      JSON.parse(valid.output.split("\n").find((line) => line.startsWith("["))),
      [
        "ssh",
        "--service",
        "indexer",
        "--environment",
        "staging-id",
        "--",
        "/nodejs/bin/node",
        "/app/apps/indexer/scripts/reset-envio.mjs",
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
