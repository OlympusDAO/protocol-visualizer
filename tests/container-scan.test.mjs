import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const imageId = `sha256:${"ab".repeat(32)}`;
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "pv-scan-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = path.join(directory, "calls.jsonl");
  const executable = (name) =>
    writeFileSync(
      path.join(directory, name),
      `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2), command = ${JSON.stringify(name)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({command,args,tmp:process.env.TMPDIR}) + "\\n");
if (command === "trivy") {
  const cache = args[args.indexOf("--cache-dir") + 1];
  fs.mkdirSync(cache, {recursive:true});
  process.exit(Number(process.env.PV_TEST_SCAN_STATUS || 0));
}
if (args[0] === "image") {
  if (process.env.PV_TEST_INSPECT_FAILURE) process.exit(17);
  console.log(${JSON.stringify(imageId)});
} else {
  if (process.env.PV_TEST_EXPORT_FAILURE) process.exit(19);
  fs.writeFileSync(args[args.indexOf("--output") + 1], "fixture archive");
}
`,
      { mode: 0o755 }
    );
  executable("podman");
  executable("trivy");
  return {
    run: (args, extra = {}) =>
      spawnSync(process.execPath, ["scripts/scan-container.mjs", ...args], {
        env: {
          ...process.env,
          PATH: directory,
          CONTAINER_ENGINE: "podman",
          ...extra,
        },
        encoding: "utf8",
      }),
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
        : [],
  };
}

test("image scans pin exports, use CI policy, and clean working files without deleting the cache", (t) => {
  const f = fixture(t);
  const result = f.run(["--", "hasura", "custom:local"]);
  assert.equal(result.status, 0, result.stderr);
  const [inspect, save, scan] = f.calls();
  assert.deepEqual(inspect.args, [
    "image",
    "inspect",
    "custom:local",
    "--format",
    "{{.Id}}",
  ]);
  assert.equal(save.args.at(-1), imageId);
  assert.equal(save.args[2], path.join(scan.tmp, "image.tar"));
  assert.ok(
    scan.tmp.includes(
      path.join("node_modules", ".cache", "container-scan", "run-")
    )
  );
  assert.ok(scan.args.includes("--ignore-unfixed"));
  for (const [option, value] of [
    ["--severity", "MEDIUM,HIGH,CRITICAL"],
    ["--scanners", "vuln"],
    ["--exit-code", "1"],
  ])
    assert.equal(scan.args[scan.args.indexOf(option) + 1], value);
  assert.equal(
    scan.args[scan.args.indexOf("--ignorefile") + 1],
    path.resolve(".trivyignore")
  );
  assert.equal(existsSync(scan.tmp), false);
  assert.equal(
    existsSync(scan.args[scan.args.indexOf("--cache-dir") + 1]),
    true
  );
});

test("scanner failure propagates, cleans the export, and keeps unfixed findings for other services", (t) => {
  const f = fixture(t);
  const result = f.run(["frontend"], { PV_TEST_SCAN_STATUS: "42" });
  assert.equal(result.status, 42);
  const calls = f.calls();
  assert.equal(calls.at(-1).command, "trivy");
  assert.equal(calls.at(-1).args.includes("--ignore-unfixed"), false);
  assert.equal(existsSync(calls[0].tmp), false);
});

test("missing images and failed exports never reach the scanner", (t) => {
  for (const [flag, status] of [
    ["PV_TEST_INSPECT_FAILURE", 17],
    ["PV_TEST_EXPORT_FAILURE", 19],
  ]) {
    const f = fixture(t);
    const result = f.run(["hasura"], { [flag]: "1" });
    assert.equal(result.status, status);
    assert.ok(f.calls().every((call) => call.command !== "trivy"));
    assert.equal(existsSync(f.calls()[0].tmp), false);
  }
});

test("unknown service names fail before invoking tools", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["unknown"]).status, 1);
  assert.deepEqual(f.calls(), []);
});
