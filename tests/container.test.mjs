import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

test("container commands select an installed engine and preserve arguments and failures", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "pv-container-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = (name, status = 0) =>
    writeFileSync(
      path.join(directory, name),
      `#!/bin/sh\nprintf '%s\\n' '${name}' "$@"\nexit ${status}\n`,
      { mode: 0o755 }
    );
  const run = (engine = "") =>
    spawnSync(
      process.execPath,
      ["scripts/container.mjs", "build", "--build-arg", "LABEL=two words", "."],
      {
        env: { ...process.env, PATH: directory, CONTAINER_ENGINE: engine },
        encoding: "utf8",
      }
    );

  assert.equal(run().status, 1, "no installed engine must fail");
  executable("podman");
  let result = run();
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    "podman\nbuild\n--build-arg\nLABEL=two words\n.\n"
  );
  assert.equal(run("docker").status, 1, "explicit Docker cannot fall back");
  executable("docker");
  assert.match(run().stdout, /^docker\n/);
  assert.match(run("podman").stdout, /^podman\n/);
  executable("docker", 23);
  result = run();
  assert.equal(result.status, 23);
  assert.doesNotMatch(result.stdout, /podman/);
  assert.match(run("invalid").stderr, /CONTAINER_ENGINE must be/);
});
