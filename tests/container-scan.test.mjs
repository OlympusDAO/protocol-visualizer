import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createRailwayContext,
  database,
  image,
  redis,
  service,
} from "railway/iac";
import defineInfrastructure from "../.railway/railway.ts";
import { ownedImages } from "../scripts/container.mjs";
import {
  imageInventory,
  runtimeImageInventory,
} from "../scripts/runtime-image-inventory.mjs";

const requireFromFrontend = createRequire(
  new URL("../apps/frontend/package.json", import.meta.url)
);
const { parse } = createRequire(
  requireFromFrontend.resolve("vite/package.json")
)("yaml");

function fixture(t) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "pv-scan-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, "node_modules"));
  symlinkSync(
    realpathSync(new URL("../node_modules/railway", import.meta.url)),
    path.join(directory, "node_modules/railway"),
    "dir"
  );
  mkdirSync(path.join(directory, "apps/frontend/node_modules"), {
    recursive: true,
  });
  symlinkSync(
    realpathSync(
      new URL("../apps/frontend/node_modules/vite", import.meta.url)
    ),
    path.join(directory, "apps/frontend/node_modules/vite"),
    "dir"
  );
  for (const file of [
    "scripts/scan-container.mjs",
    "scripts/container.mjs",
    "scripts/scan-runtime-images.mjs",
    "scripts/runtime-image-inventory.mjs",
    "scripts/validation-evidence.mjs",
    "scripts/validate-images.sh",
    ".railway/railway.ts",
    ".railway/postgres-policy.ts",
    "docker-compose.yml",
    ".trivyignore",
  ]) {
    const target = path.join(directory, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(new URL("../" + file, import.meta.url), target);
  }
  function tool() {
    const fs = require("node:fs"),
      path = require("node:path");
    const name = path.basename(process.argv[1]),
      args = process.argv.slice(2);
    fs.appendFileSync(
      process.env.PV_TEST_LOG,
      JSON.stringify([name, ...args]) + "\n"
    );
    if (name === "railway") process.exit(99);
    if (name === "git") {
      if (args[0] === "rev-parse") console.log("fixture-head");
      process.exit(0);
    }
    if (name === "pnpm") {
      process.exit(
        args[1] === "docker:scan"
          ? Number(process.env.PV_TEST_SCAN_EXIT || 0)
          : 0
      );
    }
    if (process.env.PV_TEST_CONTEXT_PRECEDENCE) {
      if (
        name === "docker" ||
        (name === "trivy" && process.env.CONTAINER_ENGINE === "docker")
      ) {
        const contextEndpoint =
          process.env.DOCKER_CONTEXT === "fixture-context"
            ? "unix:///fixture-context-daemon"
            : "unix:///default-daemon";
        const endpoint =
          name === "docker" && process.env.DOCKER_CONTEXT
            ? contextEndpoint
            : process.env.DOCKER_HOST || contextEndpoint;
        if (endpoint !== "unix:///fixture-context-daemon") process.exit(23);
      } else if (name === "podman" || name === "trivy") {
        if (
          process.env.DOCKER_CONTEXT !== "fixture-context" ||
          process.env.DOCKER_HOST !== "unix:///fixture-other-daemon"
        )
          process.exit(24);
      }
    }
    if (name === "docker" || name === "podman") {
      if (args[0] === "image") {
        if (process.env.PV_TEST_IMAGE_MISSING) process.exit(17);
        console.log(`${name} local tag`);
      }
      process.exit(0);
    }
    fs.mkdirSync(args[args.indexOf("--cache-dir") + 1], { recursive: true });
    if (
      process.env.PV_TEST_SECRET &&
      args[args.indexOf("--scanners") + 1].includes("secret")
    ) {
      console.log("mock secret finding [REDACTED]");
      process.exit(1);
    }
    process.exit(Number(process.env.PV_TEST_SCAN_EXIT || 0));
  }
  for (const name of ["docker", "podman", "trivy", "pnpm", "git", "railway"])
    writeFileSync(
      path.join(directory, name),
      "#!" + process.execPath + "\n(" + tool.toString() + ")();",
      { mode: 0o755 }
    );
  const log = path.join(directory, "calls");
  const env = {
    ...process.env,
    PATH: directory,
    CONTAINER_ENGINE: "podman",
    PV_TEST_LOG: log,
  };
  return {
    run: (file, args = [], extra = {}) =>
      spawnSync(process.execPath, [file, ...args], {
        cwd: directory,
        env: { ...env, ...extra },
        encoding: "utf8",
      }),
    pipeline: (extra = {}) =>
      spawnSync("/bin/bash", ["scripts/validate-images.sh"], {
        cwd: directory,
        env: { ...env, PV_VALIDATION_CHILD: "images", ...extra },
        encoding: "utf8",
      }),
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
        : [],
    directory,
  };
}

test("offline SDK production/preview inventory covers actual refs without Railway calls", async (t) => {
  const f = fixture(t);
  const result = f.run("scripts/scan-runtime-images.mjs");
  assert.equal(result.status, 0, result.stderr);
  assert(!f.calls().some((c) => c[0] === "railway" || c[0] === "trivy"));
  assert(result.stdout.includes("advisory-provider/not-run:"));
  assert.equal(result.stdout.match(/excluded-local:/g).length, 3);
  const production = await runtimeImageInventory("production");
  const preview = await runtimeImageInventory("preview");
  assert.deepEqual(preview, production);
  assert.equal(production.length, 4);
  const { resources } = await defineInfrastructure(
    createRailwayContext({ environment: "production" })
  );
  const monitor = resources.find(
    (resource) => resource.name === "indexer-monitor"
  );
  assert.equal(monitor.build.dockerfilePath, "Dockerfile-indexer-monitor");
  assert.deepEqual(imageInventory([monitor], ""), []);
  for (const [name, dockerfilePath] of [
    ["indexer-monitor", "Dockerfile-indexer"],
    ["unknown-service", "Dockerfile-unknown-service"],
  ]) {
    const invalid = {
      ...monitor,
      name,
      build: { ...monitor.build, dockerfilePath },
    };
    assert.throws(() => imageInventory([invalid], ""), /owned image build/);
  }
  assert.deepEqual(
    production.find((row) => row.kind === "provider").resources.sort(),
    ["Postgres", "rpc-cache-postgres"]
  );
  const { services } = parse(readFileSync("docker-compose.yml", "utf8"), {
    merge: true,
  });
  const expected = new Set(
    Object.values(services)
      .map((service) => service.image)
      .filter(Boolean)
  );
  expected.add(production.find((row) => row.kind === "provider").reference);
  assert.deepEqual(new Set(production.map((row) => row.reference)), expected);
  const reference = production.find((row) => row.kind === "provider").reference;
  assert.equal(imageInventory([redis("cache")], "")[0].kind, "owned");
  const providerRepo = "ghcr.io/railwayapp-templates/postgres-ssl";
  for (const ref of [
    reference,
    `${providerRepo}:18`,
    `${providerRepo}@sha256:${"ab".repeat(32)}`,
  ]) {
    assert.equal(
      imageInventory([database("db", "postgres", { image: ref })], "")[0].kind,
      "provider"
    );
    assert.equal(
      imageInventory(
        [
          database("db", "postgres", { image: ref }),
          service("mirror", { source: image(ref) }),
        ],
        ""
      )[0].kind,
      "owned"
    );
  }
  assert.equal(
    imageInventory([database("db", "postgres", { image: providerRepo })], "")[0]
      .kind,
    "owned"
  );
  assert.throws(
    () => imageInventory([service("unsupported")], ""),
    /Unsupported/
  );
  assert.throws(
    () =>
      imageInventory(
        [service("unbuilt", { source: { type: "github", repo: "elsewhere" } })],
        ""
      ),
    /owned image build/
  );
});

test("Compose image inventory reads equivalent plain and quoted YAML scalars", () => {
  const reference = "postgres:18.6-alpine3.24";
  for (const quote of ["", "'", '"']) {
    const compose = `services:\n  postgres:\n    image: ${quote}${reference}${quote}\n`;
    assert.deepEqual(
      imageInventory([], compose).map((row) => row.reference),
      [reference]
    );
  }
});

test("owned scans use the selected context without changing Podman selection", (t) => {
  for (const engine of ["docker", "podman"]) {
    const f = fixture(t);
    const result = f.run("scripts/scan-container.mjs", ["hasura"], {
      CONTAINER_ENGINE: engine,
      DOCKER_CONTEXT: "fixture-context",
      DOCKER_HOST: "unix:///fixture-other-daemon",
      PV_TEST_CONTEXT_PRECEDENCE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    const [inspect, scan] = f.calls();
    assert.equal(inspect[0], engine);
    assert.equal(scan[scan.indexOf("--image-src") + 1], engine);
  }
});

test("owned scans use local tags and leave unfixed filtering to Trivy config", (t) => {
  const f = fixture(t);
  const result = f.run("scripts/scan-container.mjs", ["hasura"], {
    TRIVY_FORMAT: "json",
  });
  assert.equal(result.status, 0, result.stderr);
  const [inspect, scan] = f.calls();
  assert.equal(
    inspect[0],
    "podman",
    "honor the selected engine when both have the local tag"
  );
  assert.equal(inspect[3], "protocol-visualizer/hasura:local");
  assert.equal(scan.at(-1), "protocol-visualizer/hasura:local");
  assert.equal(scan[scan.indexOf("--image-src") + 1], "podman");
  assert(!f.calls().some((call) => call[0] === "docker"));
  assert(!scan.some((arg) => arg.startsWith("--ignore-unfixed")));
  assert.equal(scan[scan.indexOf("--scanners") + 1], "vuln,secret");
  assert.equal(scan[scan.indexOf("--image-config-scanners") + 1], "secret");
  assert.equal(scan[scan.indexOf("--format") + 1], "table");
  assert(!f.calls().some((c) => c.includes("save") || c.includes("--input")));
  for (const name of ["frontend", "indexer", "indexer-monitor"]) {
    const negative = fixture(t);
    assert.equal(
      negative.run("scripts/scan-container.mjs", [name], {
        PV_TEST_SECRET: "1",
      }).status,
      1
    );
    const negativeScan = negative.calls().at(-1);
    assert.equal(negativeScan.at(-1), `protocol-visualizer/${name}:local`);
    assert(!negativeScan.some((arg) => arg.startsWith("--ignore-unfixed")));
    assert.equal(negativeScan[negativeScan.indexOf("--exit-code") + 1], "1");
  }
  const missing = fixture(t);
  assert.equal(
    missing.run("scripts/scan-container.mjs", ["indexer"], {
      PV_TEST_IMAGE_MISSING: "1",
    }).status,
    17
  );
  assert(!missing.calls().some((c) => c[0] === "trivy"));
  const external = fixture(t);
  writeFileSync(
    path.join(external.directory, ".railway/railway.ts"),
    'import { redis } from "railway/iac"; export default () => ({ resources: [redis("cache")] });'
  );
  assert.equal(
    external.run("scripts/scan-runtime-images.mjs", [], {
      PV_TEST_SECRET: "1",
    }).status,
    1
  );
  const externalScan = external.calls().find((c) => c[0] === "trivy");
  assert(!externalScan.some((arg) => arg.startsWith("--ignore-unfixed")));
  assert.equal(
    externalScan[externalScan.indexOf("--scanners") + 1],
    "vuln,secret"
  );
  assert.equal(externalScan[externalScan.indexOf("--exit-code") + 1], "1");
  assert.equal(
    externalScan[externalScan.indexOf("--image-config-scanners") + 1],
    "secret"
  );
});

test("provider native reporting is remote/advisory, but execution errors fail", (t) => {
  const f = fixture(t);
  const result = f.run("scripts/scan-runtime-images.mjs", ["--provider"], {
    PV_VALIDATION_CHILD: "",
    TRIVY_FORMAT: "json",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls().filter((c) => c[0] === "trivy").length, 1);
  assert(result.stdout.includes("Validation finished (exit 0); evidence:"));
  const scan = f.calls().find((c) => c[0] === "trivy");
  for (const [flag, value] of [
    ["--image-src", "remote"],
    ["--format", "table"],
    ["--scanners", "vuln"],
    ["--exit-code", "0"],
  ])
    assert.equal(scan[scan.indexOf(flag) + 1], value);
  assert(scan.includes("--ignore-unfixed=false"));
  assert(!scan.includes("--image-config-scanners"));
  assert(
    scan
      .at(-1)
      .startsWith("ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:")
  );
  const failure = fixture(t);
  assert.equal(
    failure.run("scripts/scan-runtime-images.mjs", ["--provider"], {
      PV_VALIDATION_CHILD: "",
      PV_TEST_SCAN_EXIT: "42",
    }).status,
    42
  );
});

test("image validation builds and scans all local tags and preserves fail-fast policy", (t) => {
  const f = fixture(t);
  const result = f.pipeline();
  assert.equal(result.status, 0, result.stderr);
  const images = [
    "rpc-cache",
    "indexer",
    "indexer-monitor",
    "frontend",
    "hasura",
    "snapshot-gateway",
    "snapshot-publisher",
    "snapshot-monitor",
  ];
  assert.deepEqual(ownedImages, images);
  const builds = images.map((image) => [
    "pnpm",
    "run",
    `docker:build:${image}`,
  ]);
  assert.deepEqual(f.calls(), [
    ...builds,
    ...images.map((image) => ["pnpm", "run", "docker:scan", "--", image]),
    ["pnpm", "run", "docker:scan:dockerfiles"],
    ["pnpm", "run", "docker:scan:runtime"],
  ]);
  const failure = fixture(t);
  assert.equal(failure.pipeline({ PV_TEST_SCAN_EXIT: "43" }).status, 43);
  assert.deepEqual(failure.calls(), [
    ...builds,
    ["pnpm", "run", "docker:scan", "--", "rpc-cache"],
  ]);
});
