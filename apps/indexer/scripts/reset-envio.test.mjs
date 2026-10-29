import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
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
    child.once("exit", (code) => accept({ code, output }));
  });
  return { child, done, output: () => output };
}

for (const migrationCode of [0, 17]) {
  test(`reset stops ingestion before migration and resumes only after success (exit ${migrationCode})`, {
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
    const migrationBlocked = join(root, "migration-blocked");
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
    await new Promise((accept) => reserve.listen(0, "::", accept));
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
    };
    for (const id of [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532])
      env[`ENVIO_RPC_URL_${id}`] = "http://fixture.invalid";
    const wrapper = command(
      spawn(process.execPath, [join(scripts, "start-envio.mjs")], {
        cwd: "/",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    );
    try {
      await until(() => {
        assert.equal(wrapper.child.exitCode, null, wrapper.output());
        return existsSync(running) && existsSync(workerRunning);
      });
      const oldPid = readFileSync(running, "utf8");
      const resetting = command(
        spawn(process.execPath, [join(scripts, "reset-envio.mjs")], {
          cwd: "/",
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        })
      );
      await until(() => existsSync(migrated));
      for (const route of ["ready", "metrics"])
        assert.equal(
          (await fetch(`http://127.0.0.1:${port}/${route}`)).status,
          503
        );
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
      rmSync(migrationBlocked, { force: true });
      if (existsSync(running)) {
        try {
          process.kill(-Number(readFileSync(running, "utf8")), "SIGKILL");
        } catch {}
      }
      wrapper.child.kill("SIGKILL");
      await wrapper.done;
      await new Promise((accept) => hasura.close(accept));
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("Railway package command requires an explicit environment and forwards it before remote arguments", async () => {
  const script = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url))
  ).scripts["indexer:reset:railway"];
  const root = mkdtempSync(join(tmpdir(), "railway reset 'quoted' $path;-"));
  writeFileSync(join(root, "railway"), '#!/bin/sh\nprintf "%s\\n" "$@"\n', {
    mode: 0o700,
  });
  const env = { ...process.env, PATH: `${root}:${process.env.PATH}` };
  delete env.RAILWAY_ENVIRONMENT;
  try {
    const missing = await command(
      spawn("/bin/sh", ["-c", script], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    ).done;
    assert.notEqual(missing.code, 0);
    assert.match(missing.output, /Set RAILWAY_ENVIRONMENT/);
    const valid = await command(
      spawn("/bin/sh", ["-c", script], {
        env: { ...env, RAILWAY_ENVIRONMENT: "staging 'quoted'; $branch" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      })
    ).done;
    assert.equal(valid.code, 0, valid.output);
    assert.deepEqual(valid.output.trim().split("\n"), [
      "ssh",
      "--service",
      "indexer",
      "--environment",
      "staging 'quoted'; $branch",
      "--",
      "/nodejs/bin/node",
      "/app/apps/indexer/scripts/reset-envio.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
