import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareResults,
  digest,
  entityDigests,
  fixtureConfig,
  installedLockMatches,
  nativeWorkerRanges,
  parseOptions,
  proxyMetrics,
  summarize,
  workloadConfigHash,
  writeResult,
} from "../scripts/benchmark-indexer.mjs";

const originalConfig = `name: fixture
chains:
  - id: 10
    start_block: 2
  - id: 1
    start_block: 5
    end_block: 100
    rpc:
      - url: \${ENVIO_RPC_URL_1}
        for: \${ENVIO_RPC_MODE:-sync}
    contracts:
      - name: Kernel
        start_block: 6
      - name: Future
        start_block: 90
  - id: 42161
    start_block: 3
`;

test("native worker experiment selects fixed four-chain ranges and rejects confounded options", () => {
  const options = parseOptions(["--native-workers", "4"]);
  assert.equal(options.nativeWorkers, 4);
  assert.equal(options.queuedAdmission, false);
  assert.equal(
    parseOptions(["--native-workers", "1", "--rpc-credits", "100"]).rpcCredits,
    100
  );
  for (const cap of [100, 150, 200])
    assert.equal(
      parseOptions([
        "--capacity-sweep",
        "--native-workers",
        "4",
        "--rpc-credits",
        String(cap),
      ]).rpcCredits,
      cap
    );
  for (const args of [
    ["--native-workers", "3"],
    ["--native-workers", "2", "--queued-admission"],
    ["--native-workers", "1", "--rpc-credits", "101"],
    ["--native-workers", "4", "--rpc-credits", "150"],
    ["--capacity-sweep", "--native-workers", "4", "--rpc-credits", "201"],
    ["--capacity-sweep", "--native-workers", "1", "--rpc-credits", "150"],
    ["--rpc-credits", "100"],
    ["--native-workers", "2", "--start", "1"],
    ["--native-workers", "2", "--oracle-ref", "HEAD"],
  ])
    assert.throws(() => parseOptions(args), /invalid_arguments/);
  const config = readFileSync(
    new URL("../apps/indexer/config.yaml", import.meta.url),
    "utf8"
  );
  const ranges = [
    { chainId: 1, start: 26_240_000, end: 26_260_000 },
    { chainId: 42161, start: 516_540_000, end: 516_560_000 },
    { chainId: 8453, start: 52_850_000, end: 52_870_000 },
    { chainId: 10, start: 158_450_000, end: 158_470_000 },
  ];
  const fixture = fixtureConfig(config, 1, 2, ranges);
  assert.deepEqual(
    fixture.match(/^ {2}- id: \d+/gm),
    ranges.map(({ chainId }) => `  - id: ${chainId}`)
  );
  for (const { chainId, start, end } of ranges) {
    assert.ok(fixture.includes(`\${ENVIO_RPC_URL_${chainId}}`));
    assert.ok(
      fixture.includes(`    start_block: ${start}\n    end_block: ${end}`)
    );
  }
});

test("dependency reuse rejects missing or stale installed lockfiles", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-deps-"));
  try {
    assert.equal(installedLockMatches(directory, "wanted"), false);
    mkdirSync(join(directory, "node_modules/.pnpm"), { recursive: true });
    const installed = join(directory, "node_modules/.pnpm/lock.yaml");
    writeFileSync(installed, "old\n");
    assert.equal(installedLockMatches(directory, "wanted"), false);
    writeFileSync(installed, "wanted\n");
    assert.equal(installedLockMatches(directory, "wanted"), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unavailable proxy metrics cannot become passing zero-traffic evidence", () => {
  const text =
    'erpc_network_request_received_total{category="eth_call"} 12\nerpc_upstream_request_total{category="eth_call"} 9\n';
  assert.throws(() => proxyMetrics(503, text), /proxy_metrics_http_failure/);
  assert.throws(
    () => proxyMetrics(200, "not metrics"),
    /missing_required_counters/
  );
  assert.throws(
    () => proxyMetrics(200, text.split("\n")[0]),
    /missing_required_counters/
  );
  const metrics = proxyMetrics(200, text);
  assert.equal(metrics.proxyRequests.eth_call, 12);
  assert.equal(metrics.upstreamRequests.eth_call, 9);
  assert.ok(metrics.unreportedOptionalCounters.includes("capacityRejections"));
});

test("the bounded fixture retains contracts and HyperSync fallback while isolating Ethereum", () => {
  const config = fixtureConfig(originalConfig, 10, 50);
  assert.match(config, /start_block: 10\n {4}end_block: 50/);
  assert.equal((config.match(/end_block:/g) ?? []).length, 1);
  assert.match(config, /name: Kernel\n {8}start_block: 10/);
  assert.match(config, /name: Future\n {8}start_block: 90/);
  assert.match(config, /for: fallback/);
  assert.doesNotMatch(config, /id: (10|42161)\b/);
  assert.throws(() => fixtureConfig(originalConfig, 50, 10));
  assert.throws(() =>
    fixtureConfig(originalConfig.replace("  - id: 1\n", "  - id: 2\n"), 10, 50)
  );
  assert.throws(() =>
    fixtureConfig(
      originalConfig.replace(
        `\${ENVIO_RPC_URL_1}`,
        "https://private.invalid/token"
      ),
      10,
      50
    )
  );
  for (const args of [
    ["--runs", "0"],
    ["--start", "NaN"],
    ["--start", "20", "--end", "10"],
    ["--compare", "a", "--compare-ref", "b"],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(parseOptions([]).runs, 3);
  assert.equal(parseOptions(["--ref", "HEAD~1"]).ref, "HEAD~1");
  assert.equal(parseOptions([]).installDeps, false);
  assert.equal(parseOptions(["--install-deps"]).installDeps, true);
  assert.equal(
    workloadConfigHash(originalConfig),
    workloadConfigHash(`full_batch_size: 100\n${originalConfig}`)
  );
  assert.notEqual(
    workloadConfigHash(originalConfig),
    workloadConfigHash(
      originalConfig.replace("name: Kernel", "name: Different")
    )
  );
});

test("semantic digests normalize only policyFunctions order and retain every other array and provenance", () => {
  const row = {
    id: "one",
    policyFunctions: [
      { selector: "b", roles: ["z", "a"] },
      { selector: "a", roles: [] },
    ],
    verifiedAt: { number: "10", hash: "old" },
  };
  const reversed = {
    ...row,
    policyFunctions: row.policyFunctions.toReversed(),
  };
  const a = entityDigests("Contract", [row]);
  const b = entityDigests("Contract", [reversed]);
  assert.notEqual(a.exact, b.exact);
  assert.equal(a.semantic, b.semantic);
  assert.notEqual(
    entityDigests("KernelReadCache", [row]).semantic,
    entityDigests("KernelReadCache", [reversed]).semantic
  );
  assert.notEqual(
    a.semantic,
    entityDigests("Contract", [
      { ...row, verifiedAt: { ...row.verifiedAt, number: "11" } },
    ]).semantic
  );
  assert.notEqual(
    a.semantic,
    entityDigests("Contract", [
      {
        ...row,
        policyFunctions: [
          { ...row.policyFunctions[0], roles: ["a", "z"] },
          row.policyFunctions[1],
        ],
      },
    ]).semantic
  );
  assert.equal(
    entityDigests("ContractEvent", [row]).semantic,
    entityDigests("ContractEvent", [reversed]).semantic
  );
  assert.throws(() =>
    entityDigests("Contract", [{ id: "bad", policyFunctions: [{}] }])
  );
});

function result(seconds = 10) {
  const inputs = {
    workload: {
      start: 1,
      end: 100,
      chainId: 1,
      checkpointInterval: 10_000,
      eventSource: "HyperSync",
      rpcMode: "fallback",
    },
    runtime: { node: "24.22.1" },
    fixture: {
      erpcImageId: `sha256:${"1".repeat(64)}`,
      postgresImageId: `sha256:${"2".repeat(64)}`,
      aggregateCreditsPerSecond: 50,
      proxyNetworks: [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532],
    },
  };
  const run = {
    committedSeconds: seconds,
    blocksPerSecond: 100 / seconds,
    exitCode: 0,
    meta: {
      startBlock: 1,
      endBlock: 100,
      progressBlock: 100,
      eventsProcessed: 5,
      isReady: true,
    },
    source: { hyperSyncGetLogs: 1, rpcGetLogs: 0 },
    rpc: {
      proxyRequests: { eth_call: 20 },
      upstreamRequests: { eth_call: 10 },
    },
    entities: {
      Contract: entityDigests("Contract", [{ id: "a", value: "same" }]),
    },
  };
  return {
    protocol: "protocol-visualizer-indexer-benchmark-v1",
    schemaVersion: 1,
    status: "success",
    requestedRuns: 1,
    cleanupComplete: true,
    source: {
      commit: "a".repeat(40),
      indexerInputHash: "b".repeat(64),
      lockfileHash: "c".repeat(64),
      nativeBatchSize: 5000,
    },
    inputs,
    inputFingerprint: digest(inputs),
    runs: [run],
    summary: summarize([run]),
  };
}

test("native comparisons require every chain, matching event counts and valid process resource evidence", () => {
  const make = (workers, credits) => {
    const r = result();
    r.protocol = "protocol-visualizer-native-workers-v2";
    if (credits !== undefined) {
      r.protocol = "protocol-visualizer-native-capacity-v1";
      r.inputs.fixture.aggregateCreditsPerSecond = credits;
    }
    r.source.storageScope = workers === 1 ? "shared" : "per-chain";
    r.source.configHash = "e".repeat(64);
    r.treatment = { nativeWorkers: workers, pgMaxConnections: workers * 2 };
    r.inputs.workload = {
      ...r.inputs.workload,
      ...nativeWorkerRanges[0],
      chains: nativeWorkerRanges,
    };
    r.inputFingerprint = digest(r.inputs);
    const run = r.runs[0];
    run.chainMeta = nativeWorkerRanges.map(({ chainId, start, end }) => ({
      chainId,
      startBlock: start,
      endBlock: end,
      progressBlock: end,
      isReady: true,
      eventsProcessed: 5,
    }));
    run.meta = run.chainMeta[0];
    run.blocksPerSecond = 80004 / run.committedSeconds;
    run.admission = { requests: 20, capacityRetries: 0, exhausted: 0 };
    const count = workers === 1 ? 1 : workers + 1;
    run.profile = {
      processCount: count,
      workerCount: workers === 1 ? 0 : workers,
      cpuMicroseconds: count * 3,
      sumProcessPeakRssKilobytes: count * 100,
      processes: Array.from({ length: count }, (_, index) => ({
        nativeWorker: index > 0,
        cpuMicroseconds: { user: 1, system: 2 },
        maxRssKilobytes: 100,
      })),
    };
    r.summary = summarize(r.runs);
    return r;
  };
  assert.equal(compareResults(make(1), make(4)).compatible, true);
  assert.equal(compareResults(make(1, 50), make(1, 100)).compatible, false);
  assert.equal(
    compareResults(make(1, 50), make(1, 100), { capacity: true }).compatible,
    true
  );
  assert.equal(
    compareResults(make(1, 50), make(4, 100), { capacity: true }).compatible,
    false
  );
  const changedSource = make(1, 100);
  changedSource.source.indexerInputHash = "f".repeat(64);
  assert.equal(
    compareResults(make(1, 50), changedSource, { capacity: true }).compatible,
    false
  );
  const sweep = (cap) => {
    const r = make(4, 100);
    r.protocol = "protocol-visualizer-native-capacity-sweep-v2";
    r.inputs.fixture.aggregateCreditsPerSecond = cap;
    r.inputFingerprint = digest(r.inputs);
    return r;
  };
  for (const [a, b] of [
    [100, 150],
    [100, 200],
    [150, 200],
  ]) {
    assert.equal(compareResults(sweep(a), sweep(b)).compatible, false);
    assert.equal(
      compareResults(sweep(a), sweep(b), { capacity: true }).compatible,
      true
    );
  }
  for (const mutate of [
    (r) => (r.source.indexerInputHash = "f".repeat(64)),
    (r) => (r.treatment.nativeWorkers = 2),
    (r) => {
      r.runs[0].entities.Contract = entityDigests("Contract", [
        { id: "a", value: "changed" },
      ]);
      r.summary = summarize(r.runs);
    },
    (r) => {
      r.inputs.fixture.aggregateCreditsPerSecond = 201;
      r.inputFingerprint = digest(r.inputs);
    },
  ]) {
    const changed = sweep(200);
    mutate(changed);
    assert.equal(
      compareResults(sweep(100), changed, { capacity: true }).compatible,
      false
    );
  }
  assert.equal(
    compareResults(sweep(200), sweep(100), { capacity: true }).compatible,
    false
  );
  assert.equal(
    compareResults(make(4, 50), sweep(100), { capacity: true }).compatible,
    false
  );
  for (const mutate of [
    (r) => r.runs[0].chainMeta.pop(),
    (r) => r.runs[0].chainMeta[1].eventsProcessed++,
    (r) => r.runs[0].chainMeta[1].progressBlock--,
    (r) => r.runs[0].profile.workerCount--,
    (r) => (r.runs[0].profile.processes[0].nativeWorker = true),
    (r) => (r.runs[0].profile.processes[1].cpuMicroseconds.user = NaN),
    (r) => (r.runs[0].profile.processes[1].maxRssKilobytes = 0),
    (r) => r.runs[0].profile.cpuMicroseconds++,
    (r) => r.runs[0].profile.sumProcessPeakRssKilobytes++,
  ]) {
    const changed = make(4);
    mutate(changed);
    changed.summary = summarize(changed.runs);
    assert.equal(compareResults(make(1), changed).compatible, false);
  }
});

test("queued protocol rejects missing, malformed and exhausted recovery evidence", () => {
  const make = () => {
    const r = result();
    r.protocol = "protocol-visualizer-indexer-queued-benchmark-v2";
    r.inputs.fixture.queuedAdmission = {
      implementation: "d".repeat(64),
      active: 32,
      waiting: 256,
      maxInFlight: 1024,
      deadlineMilliseconds: 8000,
    };
    r.runs[0].admission = { requests: 20, capacityRetries: 3, exhausted: 0 };
    r.inputFingerprint = digest(r.inputs);
    return r;
  };
  assert.equal(compareResults(make(), make()).compatible, true);
  for (const mutate of [
    (r) => {
      delete r.runs[0].admission;
    },
    (r) => {
      r.runs[0].admission.exhausted = 1;
    },
    (r) => {
      r.runs[0].admission.capacityRetries = -1;
    },
    (r) => {
      r.inputs.fixture.queuedAdmission.deadlineMilliseconds = 9000;
      r.inputFingerprint = digest(r.inputs);
    },
  ]) {
    const changed = make();
    mutate(changed);
    assert.equal(compareResults(make(), changed).throughputGainPercent, null);
  }
  assert.equal(compareResults(result(), make()).compatible, false);
});

test("comparison requires completed equivalent work and fresh workload/runtime/summary fingerprints", () => {
  const baseline = result(10);
  const candidate = result(5);
  assert.equal(compareResults(baseline, candidate).throughputGainPercent, 100);
  const variants = [
    (r) => {
      r.status = "failed";
    },
    (r) => {
      r.protocol = "another-protocol";
    },
    (r) => {
      r.inputs.runtime.node = "different";
    },
    (r) => {
      r.inputs.fixture.erpcImageId = `sha256:${"3".repeat(64)}`;
      r.inputFingerprint = digest(r.inputs);
    },
    (r) => {
      r.runs[0].meta.isReady = false;
    },
    (r) => {
      r.runs[0].meta.eventsProcessed++;
    },
    (r) => {
      r.runs[0].exitCode = 1;
    },
    (r) => {
      r.runs[0].source.rpcGetLogs = 1;
    },
    (r) => {
      r.runs[0].rpc.proxyRequests.eth_getLogs = 1;
    },
    (r) => {
      r.runs[0].rpc.upstreamRequests = {};
      r.summary = summarize(r.runs);
    },
    (r) => {
      r.summary.medianBlocksPerSecond = 999;
    },
    (r) => {
      r.runs[0].entities.Contract = entityDigests("Contract", [
        { id: "a", value: "stale" },
      ]);
      r.summary = summarize(r.runs);
    },
  ];
  for (const mutate of variants) {
    const changed = structuredClone(candidate);
    mutate(changed);
    const comparison = compareResults(baseline, changed);
    assert.equal(comparison.compatible, false);
    assert.equal(comparison.throughputGainPercent, null);
  }
  const inconsistentEvents = structuredClone(candidate);
  inconsistentEvents.runs.push(structuredClone(inconsistentEvents.runs[0]));
  inconsistentEvents.runs[1].meta.eventsProcessed++;
  inconsistentEvents.requestedRuns = 2;
  inconsistentEvents.summary = summarize(inconsistentEvents.runs);
  assert.equal(compareResults(baseline, inconsistentEvents).compatible, false);
  const withCache = structuredClone(candidate);
  withCache.runs[0].entities.VerifiedDeployment = entityDigests(
    "VerifiedDeployment",
    []
  );
  withCache.summary = summarize(withCache.runs);
  assert.deepEqual(compareResults(baseline, withCache).addedOrRemovedCaches, [
    "VerifiedDeployment",
  ]);
  assert.equal(compareResults(baseline, withCache).compatible, true);
  const withFunctionalType = structuredClone(candidate);
  withFunctionalType.runs[0].entities.ContractRelationship = entityDigests(
    "ContractRelationship",
    []
  );
  withFunctionalType.summary = summarize(withFunctionalType.runs);
  assert.equal(compareResults(baseline, withFunctionalType).compatible, false);
});

test("intentional source dependency and native batch changes remain comparable under an unchanged fixture", () => {
  const baseline = result(10);
  const candidate = result(5);
  candidate.source.lockfileHash = "d".repeat(64);
  candidate.source.nativeBatchSize = 100;
  assert.equal(compareResults(baseline, candidate).throughputGainPercent, 100);
  for (const change of [
    (r) => {
      r.inputs.runtime.node = "different";
    },
    (r) => {
      r.inputs.workload.end++;
    },
    (r) => {
      r.inputs.fixture.aggregateCreditsPerSecond = 100;
    },
  ]) {
    const changed = structuredClone(candidate);
    change(changed);
    changed.inputFingerprint = digest(changed.inputs);
    assert.equal(compareResults(baseline, changed).compatible, false);
  }
});

test("all shared cache state and provenance must match; policy ordering alone is explicitly reported", () => {
  const baseline = result();
  const candidate = result();
  const a = {
    id: "one",
    policyFunctions: [{ selector: "b" }, { selector: "a" }],
  };
  baseline.runs[0].entities.Contract = entityDigests("Contract", [a]);
  candidate.runs[0].entities.Contract = entityDigests("Contract", [
    { ...a, policyFunctions: a.policyFunctions.toReversed() },
  ]);
  for (const r of [baseline, candidate]) {
    r.runs[0].entities.KernelReadCache = entityDigests("KernelReadCache", [
      { id: "cache", verifiedAt: { number: "10" } },
    ]);
    r.summary = summarize(r.runs);
  }
  assert.deepEqual(compareResults(baseline, candidate).orderingOnly, [
    "Contract",
  ]);
  candidate.runs[0].entities.KernelReadCache = entityDigests(
    "KernelReadCache",
    [{ id: "cache", verifiedAt: { number: "11" } }]
  );
  candidate.summary = summarize(candidate.runs);
  assert.equal(compareResults(baseline, candidate).compatible, false);
});

test("atomic failure output replaces an older passing result without leaking environment values", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-test-"));
  const output = join(directory, "result.json");
  const environmentKey = "UPSTREAM_RPC_URL_1";
  const saved = process.env[environmentKey];
  process.env[environmentKey] = "https://provider.invalid/private-key-value";
  try {
    writeResult(output, result());
    writeResult(output, {
      protocol: "protocol-visualizer-indexer-benchmark-v1",
      status: "failed",
      failure: "missing_credentials",
      runs: [],
    });
    const text = readFileSync(output, "utf8");
    assert.equal(JSON.parse(text).status, "failed");
    assert.doesNotMatch(text, /provider\.invalid|private-key-value/);
  } finally {
    if (saved === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = saved;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the CLI invalidates stale passing output when preflight fails and reveals only missing input names", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-cli-"));
  const output = join(directory, "result.json");
  try {
    writeResult(output, result());
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/benchmark-indexer.mjs", import.meta.url)
        ),
        "--runs",
        "1",
        "--output",
        output,
      ],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: "postgresql://private.invalid/private-password",
        },
        encoding: "utf8",
        timeout: 10_000,
      }
    );
    assert.equal(run.status, 1);
    const stored = readFileSync(output, "utf8");
    assert.equal(JSON.parse(stored).status, "failed");
    assert.equal(JSON.parse(stored).failure, "missing_credentials");
    assert.doesNotMatch(
      stored + run.stderr + run.stdout,
      /private\.invalid|private-password/
    );
    const invalid = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/benchmark-indexer.mjs", import.meta.url)
        ),
        "--runs",
        "0",
        "--output",
        output,
      ],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(invalid.status, 1);
    assert.equal(
      JSON.parse(readFileSync(output, "utf8")).failure,
      "invalid_arguments"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failure output invalidates old success even without installed formatter dependencies", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-no-formatter-"));
  const output = join(directory, "result.json");
  try {
    mkdirSync(join(directory, "scripts"));
    const driver = join(directory, "scripts/benchmark-indexer.mjs");
    copyFileSync(
      new URL("../scripts/benchmark-indexer.mjs", import.meta.url),
      driver
    );
    writeResult(output, result());
    const run = spawnSync(process.execPath, [driver, "--output", output], {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(run.status, 1);
    const stored = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(stored.status, "failed");
    assert.equal(stored.failure, "missing_credentials");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("passive instrumentation stores counts while omitting calldata, URLs and provider-authored errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-probe-"));
  const output = join(directory, "profile.json");
  try {
    const probe = new URL(
      "../scripts/benchmark-indexer-probe.mjs",
      import.meta.url
    ).href;
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `globalThis.fetch=async()=>{throw new Error("provider-authored-private-value")};await import(${JSON.stringify(probe)});for(const url of ["http://127.0.0.1:1234/private-token?key=private-value","https://sourcify.dev/private-token"])try{await fetch(url,{body:JSON.stringify({method:"eth_call",params:["secret-calldata"]})})}catch{}`,
      ],
      {
        env: {
          PATH: process.env.PATH,
          PV_BENCHMARK_RPC_ORIGIN: "http://127.0.0.1:1234",
          PV_BENCHMARK_PROBE_OUTPUT: output,
        },
        encoding: "utf8",
        timeout: 10_000,
      }
    );
    assert.equal(run.status, 0, run.stderr);
    const text = readFileSync(output, "utf8");
    const profile = JSON.parse(text);
    assert.equal(profile.rpcItems, 1);
    assert.equal(profile.rpcMethods.eth_call, 1);
    assert.equal(profile.sourceRequests, 1);
    assert.equal(profile.sourceStatuses.transport, 1);
    assert.doesNotMatch(text, /private|secret-calldata|https?:|127\.0\.0\.1/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit dependency installation uses a temporary snapshot, frozen lockfile and no provider credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "pv-benchmark-install-"));
  const output = join(directory, "result.json");
  const installLog = join(directory, "install.json");
  const pnpmVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  )
    .packageManager.split("@")
    .at(-1);
  writeFileSync(
    join(directory, "pnpm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
process.stderr.write("private-child-stderr-sentinel");
if(process.argv[2] === "--version") console.log(${JSON.stringify(pnpmVersion)});
else fs.writeFileSync(${JSON.stringify(installLog)}, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),hasLock:fs.existsSync("pnpm-lock.yaml"),providerCredentials:Object.keys(process.env).some(key=>/^(UPSTREAM_RPC_URL_|ENVIO_API_TOKEN|ETHERSCAN_API_KEY)/.test(key))}));
`,
    { mode: 0o755 }
  );
  let result;
  try {
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/benchmark-indexer.mjs", import.meta.url)
        ),
        "--install-deps",
        "--runs",
        "1",
        "--output",
        output,
      ],
      {
        env: {
          PATH: `${directory}:${dirname(process.execPath)}:${process.env.PATH}`,
          ENVIO_API_TOKEN: "private-token",
          ETHERSCAN_API_KEY: "private-key",
          ...Object.fromEntries(
            [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532].map(
              (id) => [
                `UPSTREAM_RPC_URL_${id}`,
                "https://provider.invalid/private-key",
              ]
            )
          ),
        },
        encoding: "utf8",
        timeout: 15_000,
      }
    );
    assert.equal(run.status, 1);
    result = JSON.parse(readFileSync(output, "utf8"));
    assert.doesNotMatch(
      readFileSync(output, "utf8") + run.stdout + run.stderr,
      /provider\.invalid|private-token|private-key|private-child-stderr-sentinel/
    );
    const pinnedNode = readFileSync(
      new URL("../.node-version", import.meta.url),
      "utf8"
    ).trim();
    if (process.versions.node !== pinnedNode) {
      assert.equal(result.failure, "activate_pinned_runtime", run.stderr);
      assert.equal(existsSync(installLog), false);
      return;
    }
    assert.equal(
      result.failure,
      "isolated_dependencies_missing_envio",
      run.stderr
    );
    const install = JSON.parse(readFileSync(installLog, "utf8"));
    assert.ok(
      install.cwd.startsWith(tmpdir()) ||
        install.cwd.startsWith("/private/tmp/")
    );
    assert.equal(install.cwd.endsWith("/dependencies"), true);
    assert.deepEqual(install.args.slice(0, 2), [
      "install",
      "--frozen-lockfile",
    ]);
    assert.equal(install.hasLock, true);
    assert.equal(install.providerCredentials, false);
  } finally {
    if (/^indexer-[a-f0-9-]+$/.test(result?.diagnosticId ?? ""))
      rmSync(new URL(`../benchmarks/${result.diagnosticId}`, import.meta.url), {
        recursive: true,
        force: true,
      });
    rmSync(directory, { recursive: true, force: true });
  }
});
