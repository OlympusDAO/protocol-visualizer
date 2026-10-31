import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { arch, cpus, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "docs/performance/indexer-benchmark.json";
const networks = [1, 10, 42161, 8453, 80094, 4663, 11155111, 421614, 84532];
const cacheEntities = new Set([
  "VerifiedDeployment",
  "KernelReadCache",
  "KernelReadEpoch",
]);
const protocol = "protocol-visualizer-indexer-benchmark-v1";
const image = "protocol-visualizer/rpc-cache:local";
const pgImage = "postgres:17-alpine";
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class BenchmarkFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
}

export const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const bytesDigest = (value) => createHash("sha256").update(value).digest("hex");
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const pause = (ms) => new Promise((accept) => setTimeout(accept, ms));

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(
        [
          "ref",
          "runs",
          "output",
          "compare",
          "compare-ref",
          "env-file",
          "start",
          "end",
          "provider-profile",
        ].map((name) => [name, { type: "string" }])
      ),
      "install-deps": { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const result = {
    ref: values.ref ?? "HEAD",
    runs: Number(values.runs ?? 3),
    output: values.output ?? defaultOutput,
    compare: values.compare,
    compareRef: values["compare-ref"],
    envFile: values["env-file"],
    installDeps: values["install-deps"],
    start: Number(values.start ?? 26_240_000),
    end: Number(values.end ?? 26_290_000),
    providerProfile: values["provider-profile"] ?? "unspecified",
  };
  if (
    !Number.isSafeInteger(result.runs) ||
    result.runs < 1 ||
    result.runs > 10 ||
    !Number.isSafeInteger(result.start) ||
    !Number.isSafeInteger(result.end) ||
    result.start < 1 ||
    result.end < result.start ||
    (result.compare && result.compareRef) ||
    !/^[A-Za-z0-9][A-Za-z0-9_./~^{}@-]{0,127}$/.test(result.ref) ||
    !/^[A-Za-z0-9_.-]{1,64}$/.test(result.providerProfile)
  )
    throw new BenchmarkFailure("invalid_arguments");
  return result;
}

export function fixtureConfig(text, start, end) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start
  )
    throw new BenchmarkFailure("invalid_range");
  const parts = text.split("\nchains:\n");
  if (parts.length !== 2)
    throw new BenchmarkFailure("unsupported_chain_config");
  const sections = parts[1].split(/(?=^ {2}- id: )/m);
  const matches = sections.filter((section) => /^ {2}- id: 1\s/.test(section));
  if (matches.length !== 1)
    throw new BenchmarkFailure("missing_ethereum_chain");
  let chain = matches[0];
  if (
    (chain.match(/^ {4}start_block: \d+$/gm) ?? []).length !== 1 ||
    !chain.includes(`\${ENVIO_RPC_URL_1}`) ||
    (chain.match(/^ {8}for: /gm) ?? []).length !== 1
  )
    throw new BenchmarkFailure("unsupported_ethereum_config");
  chain = chain
    .replace(/^ {4}end_block: .*\n/gm, "")
    .replace(
      /^ {4}start_block: \d+$/m,
      `    start_block: ${start}\n    end_block: ${end}`
    )
    .replace(
      /^ {8}start_block: (\d+)$/gm,
      (_, number) => `        start_block: ${Math.max(start, Number(number))}`
    )
    .replace(/^ {8}for: .*$/m, "        for: fallback");
  return `${parts[0]}\nchains:\n${chain}`;
}

export function entityDigests(name, rows) {
  const ordered = rows.toSorted((a, b) =>
    compareText(String(a.id), String(b.id))
  );
  const normalized = ordered.map((row) => {
    if (
      !["Contract", "ContractEvent"].includes(name) ||
      !Array.isArray(row.policyFunctions)
    )
      return row;
    if (row.policyFunctions.some((item) => typeof item?.selector !== "string"))
      throw new BenchmarkFailure("unrecognized_policy_functions");
    return {
      ...row,
      policyFunctions: row.policyFunctions.toSorted((a, b) =>
        compareText(a.selector, b.selector)
      ),
    };
  });
  return {
    count: rows.length,
    exact: digest(ordered),
    semantic: digest(normalized),
  };
}

export const workloadConfigHash = (config) =>
  bytesDigest(config.replace(/^full_batch_size:[^\n]*(?:\n|$)/gm, ""));

export function installedLockMatches(dependencyRoot, lock) {
  const installedLock = join(dependencyRoot, "node_modules/.pnpm/lock.yaml");
  return (
    existsSync(installedLock) &&
    readFileSync(installedLock, "utf8").trim() === lock.trim()
  );
}

export function summarize(runs) {
  const first = runs[0];
  const state = (run) =>
    Object.fromEntries(
      Object.entries(run.entities).map(([name, row]) => [
        name,
        { count: row.count, semantic: row.semantic },
      ])
    );
  return {
    runCount: runs.length,
    medianCommittedSeconds: median(runs.map((run) => run.committedSeconds)),
    medianBlocksPerSecond: median(runs.map((run) => run.blocksPerSecond)),
    medianProxyRequests: median(
      runs.map((run) =>
        Object.values(run.rpc.proxyRequests).reduce((a, b) => a + b, 0)
      )
    ),
    medianUpstreamRequests: median(
      runs.map((run) =>
        Object.values(run.rpc.upstreamRequests).reduce((a, b) => a + b, 0)
      )
    ),
    stateConsistent: runs.every(
      (run) =>
        digest(state(run)) === digest(state(first)) &&
        run.meta?.eventsProcessed === first.meta?.eventsProcessed
    ),
  };
}

function resultProblems(result) {
  const reasons = [];
  if (result.protocol !== protocol || result.schemaVersion !== 1)
    reasons.push("protocol mismatch");
  if (result.status !== "success") reasons.push("incomplete or failed result");
  if (result.cleanupComplete !== true)
    reasons.push("resource cleanup incomplete");
  if (!result.inputs || result.inputFingerprint !== digest(result.inputs))
    reasons.push("stale input fingerprint");
  const workload = result.inputs?.workload;
  if (
    !workload ||
    !Number.isSafeInteger(workload.start) ||
    !Number.isSafeInteger(workload.end) ||
    workload.start < 1 ||
    workload.end < workload.start ||
    workload.chainId !== 1 ||
    workload.checkpointInterval !== 10_000 ||
    workload.eventSource !== "HyperSync" ||
    workload.rpcMode !== "fallback"
  )
    reasons.push("invalid workload descriptor");
  const fixture = result.inputs?.fixture;
  if (
    fixture?.aggregateCreditsPerSecond !== 50 ||
    !Array.isArray(fixture.proxyNetworks) ||
    digest(fixture.proxyNetworks) !== digest(networks) ||
    ![fixture.erpcImageId, fixture.postgresImageId].every((value) =>
      /^sha256:[a-f0-9]{64}$/.test(value ?? "")
    )
  )
    reasons.push("invalid proxy fixture descriptor");
  if (!/^[a-f0-9]{40}$/.test(result.source?.commit ?? ""))
    reasons.push("invalid source identity");
  if (!/^[a-f0-9]{64}$/.test(result.source?.indexerInputHash ?? ""))
    reasons.push("invalid runtime input identity");
  if (
    !/^[a-f0-9]{64}$/.test(result.source?.lockfileHash ?? "") ||
    !Number.isSafeInteger(result.source?.nativeBatchSize) ||
    result.source.nativeBatchSize < 1
  )
    reasons.push("invalid source dependency or batch identity");
  if (
    !Array.isArray(result.runs) ||
    !result.runs.length ||
    result.runs.length !== result.requestedRuns
  )
    reasons.push("no complete runs");
  else {
    for (const run of result.runs) {
      if (
        !Number.isFinite(run.committedSeconds) ||
        run.committedSeconds <= 0 ||
        !Number.isFinite(run.blocksPerSecond) ||
        run.blocksPerSecond <= 0 ||
        Math.abs(
          run.blocksPerSecond -
            (result.inputs?.workload?.end -
              result.inputs?.workload?.start +
              1) /
              run.committedSeconds
        ) > 1e-8 ||
        run.exitCode !== 0 ||
        run.meta?.progressBlock !== result.inputs?.workload?.end ||
        run.meta?.startBlock !== result.inputs?.workload?.start ||
        run.meta?.endBlock !== result.inputs?.workload?.end ||
        run.meta?.isReady !== true ||
        !Number.isSafeInteger(run.meta?.eventsProcessed) ||
        run.meta.eventsProcessed < 0 ||
        !(run.source?.hyperSyncGetLogs > 0) ||
        run.source.rpcGetLogs !== 0 ||
        (run.rpc?.proxyRequests?.eth_getLogs ?? 0) !== 0 ||
        ["proxyRequests", "upstreamRequests"].some(
          (key) =>
            !Object.keys(run.rpc?.[key] ?? {}).length ||
            Object.values(run.rpc[key]).some(
              (value) => !Number.isFinite(value) || value < 0
            )
        ) ||
        !Object.keys(run.entities ?? {}).length
      )
        reasons.push("missing durable completion or source evidence");
      for (const [name, row] of Object.entries(run.entities ?? {})) {
        if (
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
          !Number.isSafeInteger(row.count) ||
          row.count < 0 ||
          !/^[a-f0-9]{64}$/.test(row.exact ?? "") ||
          !/^[a-f0-9]{64}$/.test(row.semantic ?? "")
        )
          reasons.push("invalid entity digest");
      }
    }
    try {
      const summary = summarize(result.runs);
      if (digest(summary) !== digest(result.summary))
        reasons.push("stale summary");
      if (!summary.stateConsistent) reasons.push("state differs between runs");
    } catch {
      reasons.push("malformed measurements");
    }
  }
  return reasons;
}

export function compareResults(baseline, candidate) {
  const reasons = [...resultProblems(baseline), ...resultProblems(candidate)];
  if (baseline.inputFingerprint !== candidate.inputFingerprint)
    reasons.push("workload, runtime or fixture mismatch");
  const a = baseline.runs?.[0]?.entities ?? {};
  const b = candidate.runs?.[0]?.entities ?? {};
  const addedOrRemovedCaches = [];
  const orderingOnly = [];
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (!a[name] || !b[name]) {
      if (cacheEntities.has(name)) addedOrRemovedCaches.push(name);
      else reasons.push(`entity coverage differs: ${name}`);
    } else if (
      a[name].count !== b[name].count ||
      a[name].semantic !== b[name].semantic
    ) {
      reasons.push(`entity state differs: ${name}`);
    } else if (a[name].exact !== b[name].exact) orderingOnly.push(name);
  }
  if (
    baseline.runs?.[0]?.meta?.eventsProcessed !==
    candidate.runs?.[0]?.meta?.eventsProcessed
  )
    reasons.push("processed event counts differ");
  return {
    compatible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    addedOrRemovedCaches,
    orderingOnly,
    throughputGainPercent: reasons.length
      ? null
      : 100 *
        (candidate.summary.medianBlocksPerSecond /
          baseline.summary.medianBlocksPerSecond -
          1),
  };
}

export function writeResult(path, result) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`
  );
  let formatted = `${JSON.stringify(result, null, 2)}\n`;
  try {
    formatted = execFileSync(
      process.execPath,
      [
        join(root, "node_modules/@biomejs/biome/bin/biome"),
        "format",
        "--stdin-file-path=indexer-benchmark.json",
      ],
      {
        input: JSON.stringify(result),
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 10_000,
      }
    );
  } catch {
    // Result invalidation must work before dependencies or formatting are ready.
  }
  writeFileSync(temporary, formatted);
  renameSync(temporary, path);
}

function command(name, args, cwd = root, log, env) {
  try {
    return execFileSync(name, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (log) appendFileSync(log, `${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw new BenchmarkFailure(
      `${basename(name).replaceAll(/[^a-z0-9]/gi, "_")}_command_failed`
    );
  }
}

const git = (...args) => command("git", args).trim();
const resolveRef = (ref) =>
  git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);

function runtimeHash(commit) {
  const tree = git(
    "ls-tree",
    "-r",
    commit,
    "--",
    "apps/indexer",
    "packages",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml"
  );
  return bytesDigest(
    tree
      .split("\n")
      .filter((line) => {
        const path = line.split("\t")[1];
        return (
          path &&
          (!path.startsWith("apps/indexer/") ||
            /^apps\/indexer\/(src\/|abis\/|config\.yaml$|schema\.graphql$|package\.json$|tsconfig\.json$)/.test(
              path
            ))
        );
      })
      .join("\n")
  );
}

function metric(text, name, label, allowed = /^[A-Za-z0-9_.-]{1,64}$/) {
  const values = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}{`)) continue;
    const labels = Object.fromEntries(
      [...line.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [
        match[1],
        match[2],
      ])
    );
    const key = allowed.test(labels[label] ?? "") ? labels[label] : "other";
    const value = Number(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value) && value >= 0)
      values[key] = (values[key] ?? 0) + value;
  }
  return values;
}

export function proxyMetrics(status, text) {
  if (status < 200 || status >= 300)
    throw new BenchmarkFailure("proxy_metrics_http_failure");
  const rpc = Object.fromEntries(
    Object.entries({
      proxyRequests: "erpc_network_request_received_total",
      upstreamRequests: "erpc_upstream_request_total",
      capacityRejections: "erpc_rate_limits_total",
      failedProxyRequests: "erpc_network_failed_request_total",
      cacheHits: "erpc_cache_get_success_hit_total",
    }).map(([key, name]) => [
      key,
      metric(text, name, "category", /^eth_[A-Za-z0-9_]{1,64}$/),
    ])
  );
  if (
    !Object.keys(rpc.proxyRequests).length ||
    !Object.keys(rpc.upstreamRequests).length
  )
    throw new BenchmarkFailure("proxy_metrics_missing_required_counters");
  rpc.attemptOutcomes = metric(
    text,
    "erpc_upstream_attempt_outcome_total",
    "outcome",
    /^[a-z_]{1,64}$/
  );
  rpc.unreportedOptionalCounters = [
    "capacityRejections",
    "failedProxyRequests",
    "cacheHits",
    "attemptOutcomes",
  ].filter((key) => !Object.keys(rpc[key]).length);
  return rpc;
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", accept)
  );
  const port = server.address().port;
  await new Promise((accept) => server.close(accept));
  return port;
}

function cleanEnv() {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "LANG",
      "LC_ALL",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  );
}

async function stopChild(child, exit) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([exit, pause(15_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await exit;
  }
}

async function installDependencies(snapshot, log, cancelled) {
  console.log(
    "Installing frozen dependencies in an isolated snapshot, outside timing."
  );
  const fd = openSync(log, "w", 0o600);
  const child = spawn(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--store-dir",
      join(snapshot, ".pnpm-store"),
    ],
    {
      cwd: snapshot,
      env: { ...cleanEnv(), CI: "true" },
      stdio: ["ignore", fd, fd],
      detached: true,
    }
  );
  let completed;
  const exit = new Promise((accept) => {
    const finish = (code, signal) => {
      completed = { code, signal };
      accept(completed);
    };
    child.once("exit", finish);
    child.once("error", () => finish(null, "spawn_error"));
  });
  const started = performance.now();
  try {
    while (!completed) {
      if (cancelled()) throw new BenchmarkFailure("interrupted");
      if (performance.now() - started > 600_000)
        throw new BenchmarkFailure("isolated_install_timeout");
      await pause(250);
    }
    if (completed.code !== 0)
      throw new BenchmarkFailure(
        "isolated_frozen_install_failed_see_private_logs"
      );
  } finally {
    await stopChild(child, exit);
    closeSync(fd);
  }
}

async function collectRun(options, setup, runNumber, cancelled) {
  const id = `pv-indexer-benchmark-${randomUUID()}`;
  const temp = mkdtempSync(join(tmpdir(), "pv-indexer-benchmark-"));
  const logs = join(setup.logs, String(runNumber));
  mkdirSync(logs, { mode: 0o700 });
  const commandLog = join(logs, "commands.private.log");
  writeFileSync(commandLog, "", { mode: 0o600 });
  const docker = (...args) => command("docker", args, root, commandLog).trim();
  const created = [];
  let networkCreated = false;
  let database;
  let child;
  let exit;
  let spawnFailed = false;
  let logFd;
  try {
    if (cancelled()) throw new BenchmarkFailure("interrupted");
    const source = join(temp, "source");
    mkdirSync(source);
    command("tar", ["-xf", setup.archive, "-C", source], root, commandLog);
    for (const path of ["node_modules", "apps/indexer/node_modules"])
      symlinkSync(join(setup.dependencyRoot, path), join(source, path), "dir");
    writeFileSync(join(source, "apps/indexer/config.yaml"), setup.config);
    const password = randomUUID();
    networkCreated = true;
    docker("network", "create", id);
    const pg = `${id}-pg`;
    created.push(pg);
    docker(
      "run",
      "-d",
      "--name",
      pg,
      "--network",
      id,
      "--tmpfs",
      "/var/lib/postgresql/data",
      "-p",
      "127.0.0.1::5432",
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      "POSTGRES_DB=indexer",
      setup.pgImageId
    );
    const pgPort = Number(docker("port", pg, "5432/tcp").split(":").at(-1));
    database = setup.Postgres({
      host: "127.0.0.1",
      port: pgPort,
      username: "postgres",
      password,
      database: "indexer",
      max: 2,
      connect_timeout: 2,
      onnotice: () => {},
    });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        await database.unsafe("SELECT 1");
        ready = true;
        break;
      } catch {
        await pause(1000);
      }
    }
    if (!ready) throw new BenchmarkFailure("postgres_not_ready");
    await database.unsafe("CREATE DATABASE rpc_cache");
    const envPath = join(temp, "erpc.env");
    const proxyEnv = Object.fromEntries(
      networks.map((chain) => [
        `UPSTREAM_RPC_URL_${chain}`,
        process.env[`UPSTREAM_RPC_URL_${chain}`],
      ])
    );
    Object.assign(proxyEnv, {
      RPC_CACHE_DATABASE_URL: `postgresql://postgres:${password}@${pg}:5432/rpc_cache`,
      RPC_CACHE_MAX_RPS: "50",
    });
    writeFileSync(
      envPath,
      `${Object.entries(proxyEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
      { mode: 0o600 }
    );
    const proxy = `${id}-erpc`;
    created.push(proxy);
    docker(
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      id,
      "--env-file",
      envPath,
      "-p",
      "127.0.0.1::4000",
      "-p",
      "127.0.0.1::4001",
      setup.erpcImageId
    );
    const origin = `http://127.0.0.1:${docker("port", proxy, "4000/tcp").split(":").at(-1)}`;
    const metricsUrl = `http://127.0.0.1:${docker("port", proxy, "4001/tcp").split(":").at(-1)}/metrics`;
    ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        if (
          (
            await fetch(`${origin}/healthcheck`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await pause(1000);
    }
    if (!ready) throw new BenchmarkFailure("proxy_not_ready");
    const probe = join(temp, "probe.mjs");
    const profilePath = join(temp, "profile.json");
    writeFileSync(probe, setup.probe);
    const metricsPort = await freePort();
    const env = {
      ...cleanEnv(),
      ...Object.fromEntries(
        ["ENVIO_API_TOKEN", "ETHERSCAN_API_KEY"].map((key) => [
          key,
          process.env[key],
        ])
      ),
      ENVIO_RPC_MODE: "fallback",
      ENVIO_TUI: "false",
      ENVIO_HASURA: "false",
      ENVIO_PG_HOST: "127.0.0.1",
      ENVIO_PG_PORT: String(pgPort),
      ENVIO_PG_USER: "postgres",
      ENVIO_PG_PASSWORD: password,
      ENVIO_PG_DATABASE: "indexer",
      ENVIO_PG_SSL_MODE: "false",
      ENVIO_INDEXER_PORT: String(metricsPort),
      ENVIO_THROTTLE_CHAIN_METADATA_INTERVAL_MILLIS: "500",
      LOG_STRATEGY: "ecs-console",
      LOG_LEVEL: "warn",
      PV_BENCHMARK_RPC_ORIGIN: origin,
      PV_BENCHMARK_PROBE_OUTPUT: profilePath,
      ...Object.fromEntries(
        networks.map((chain) => [
          `ENVIO_RPC_URL_${chain}`,
          `${origin}/pv/evm/${chain}`,
        ])
      ),
    };
    const metadataCode = `const C=await import(${JSON.stringify(pathToFileURL(join(source, "apps/indexer/node_modules/envio/src/Config.res.mjs")).href)});const c=C.load();console.log(JSON.stringify({batchSize:c.batchSize,entities:c.userEntities.map(e=>e.name)}));`;
    const metadata = JSON.parse(
      command(
        process.execPath,
        ["--input-type=module", "-e", metadataCode],
        join(source, "apps/indexer"),
        commandLog,
        env
      )
    );
    if (
      setup.source.nativeBatchSize !== null &&
      metadata.batchSize !== setup.source.nativeBatchSize
    )
      throw new BenchmarkFailure("batch_size_changed");
    setup.source.nativeBatchSize = metadata.batchSize;
    const indexerLog = join(logs, "indexer.private.log");
    logFd = openSync(indexerLog, "w", 0o600);
    const started = performance.now();
    child = spawn(
      process.execPath,
      [
        "--import",
        probe,
        join(source, "apps/indexer/node_modules/envio/bin.mjs"),
        "start",
      ],
      {
        cwd: join(source, "apps/indexer"),
        env,
        stdio: ["ignore", logFd, logFd],
        detached: true,
      }
    );
    exit = new Promise((accept) => {
      child.once("exit", (code, signal) => accept({ code, signal }));
      child.once("error", () => {
        spawnFailed = true;
        accept({ code: null, signal: "spawn_error" });
      });
    });
    let meta;
    let committedSeconds;
    let envioMetrics = "";
    let lastUpdate = 0;
    while (performance.now() - started < 1_200_000) {
      if (cancelled()) throw new BenchmarkFailure("interrupted");
      if (spawnFailed) throw new BenchmarkFailure("indexer_spawn_failed");
      try {
        const response = await fetch(
          `http://127.0.0.1:${metricsPort}/metrics`,
          { signal: AbortSignal.timeout(500) }
        );
        if (response.ok) envioMetrics = await response.text();
      } catch {}
      try {
        const rows = await database.unsafe(
          'SELECT "startBlock", "endBlock", "progressBlock", "eventsProcessed", "isReady" FROM _meta WHERE "chainId"=1'
        );
        if (rows.length) meta = rows[0];
      } catch {}
      if (meta?.progressBlock === options.end && committedSeconds === undefined)
        committedSeconds = (performance.now() - started) / 1000;
      if (child.exitCode !== null || child.signalCode !== null) break;
      if (
        committedSeconds !== undefined &&
        (performance.now() - started) / 1000 - committedSeconds > 15
      )
        throw new BenchmarkFailure("indexer_did_not_exit_after_commit");
      if (performance.now() - started - lastUpdate > 30_000) {
        console.log(
          `Run ${runNumber}/${options.runs}: committed ${meta?.progressBlock ?? "pending"}`
        );
        lastUpdate = performance.now() - started;
      }
      await pause(250);
    }
    if (child.exitCode === null && child.signalCode === null)
      throw new BenchmarkFailure("indexer_timeout");
    const finished = await exit;
    const finalMeta = await database.unsafe(
      'SELECT "startBlock", "endBlock", "progressBlock", "eventsProcessed", "isReady" FROM _meta WHERE "chainId"=1'
    );
    meta = finalMeta[0];
    if (meta?.progressBlock === options.end && committedSeconds === undefined)
      committedSeconds = (performance.now() - started) / 1000;
    if (
      finished.code !== 0 ||
      meta?.progressBlock !== options.end ||
      meta.isReady !== true ||
      committedSeconds === undefined
    )
      throw new BenchmarkFailure("indexer_did_not_complete");
    const metricsResponse = await fetch(metricsUrl, {
      signal: AbortSignal.timeout(3000),
    });
    const rpc = proxyMetrics(
      metricsResponse.status,
      await metricsResponse.text()
    );
    const sourceRequests = envioMetrics
      .split("\n")
      .filter((line) => line.startsWith("envio_source_request_total{"));
    const sourceEvidence = { hyperSyncGetLogs: 0, rpcGetLogs: 0 };
    for (const line of sourceRequests) {
      if (!line.includes('method="getLogs"')) continue;
      const count = Number(line.slice(line.lastIndexOf(" ") + 1));
      if (line.includes('source="HyperSync"'))
        sourceEvidence.hyperSyncGetLogs += count;
      else sourceEvidence.rpcGetLogs += count;
    }
    if (
      !sourceEvidence.hyperSyncGetLogs ||
      sourceEvidence.rpcGetLogs ||
      rpc.proxyRequests.eth_getLogs
    )
      throw new BenchmarkFailure("event_source_not_hypersync");
    const entities = {};
    for (const name of metadata.entities) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new BenchmarkFailure("invalid_entity_name");
      entities[name] = entityDigests(
        name,
        await database.unsafe(`SELECT * FROM "${name}"`)
      );
    }
    const record = {
      committedSeconds,
      blocksPerSecond: (options.end - options.start + 1) / committedSeconds,
      exitCode: finished.code,
      meta,
      source: sourceEvidence,
      rpc,
      effectWindowWaitSeconds: metric(
        envioMetrics,
        "envio_effect_queue_wait_seconds",
        "effect"
      ),
      entities,
      profile: JSON.parse(readFileSync(profilePath, "utf8")),
    };
    console.log(
      `Run ${runNumber}/${options.runs}: ${record.blocksPerSecond.toFixed(1)} committed blocks/s`
    );
    return record;
  } finally {
    let cleanupFailed = false;
    try {
      await stopChild(child, exit);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (logFd !== undefined) closeSync(logFd);
    } catch {
      cleanupFailed = true;
    }
    try {
      if (database) await database.end({ timeout: 5 });
    } catch {
      cleanupFailed = true;
    }
    for (const container of created.toReversed()) {
      if (container.endsWith("-erpc")) {
        try {
          writeFileSync(
            join(logs, "erpc.private.log"),
            docker("logs", container),
            { mode: 0o600 }
          );
        } catch {}
      }
      try {
        docker("rm", "-f", container);
      } catch {
        cleanupFailed = true;
      }
    }
    if (networkCreated) {
      try {
        docker("network", "rm", id);
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    setup.cleanup.failed ||= cleanupFailed;
  }
}

async function runBenchmark(options) {
  const output = resolve(root, options.output);
  const result = {
    protocol,
    schemaVersion: 1,
    status: "running",
    generatedAt: new Date().toISOString(),
    requestedRuns: options.runs,
    source: null,
    inputs: null,
    runs: [],
  };
  writeResult(output, result);
  let temporary;
  const cleanup = { failed: false };
  let cancelled = false;
  const interrupt = () => {
    cancelled = true;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    if (options.envFile) process.loadEnvFile(resolve(options.envFile));
    const required = [
      "ENVIO_API_TOKEN",
      "ETHERSCAN_API_KEY",
      ...networks.map((chain) => `UPSTREAM_RPC_URL_${chain}`),
    ];
    const missing = required.filter((key) => !process.env[key]?.trim());
    if (missing.length) {
      result.missingInputs = missing;
      throw new BenchmarkFailure("missing_credentials");
    }
    for (const chain of networks) {
      const value = process.env[`UPSTREAM_RPC_URL_${chain}`];
      if (!/^https?:\/\/[^\s]+$/.test(value) || /[\r\n]/.test(value))
        throw new BenchmarkFailure("invalid_upstream_url");
    }
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8")
    );
    const pinnedNode = readFileSync(join(root, ".node-version"), "utf8").trim();
    const pnpm = command("pnpm", ["--version"]).trim();
    if (
      process.versions.node !== pinnedNode ||
      manifest.packageManager !== `pnpm@${pnpm}`
    )
      throw new BenchmarkFailure("activate_pinned_runtime");
    const commit = resolveRef(options.ref);
    result.source = {
      ref: options.ref,
      commit,
      indexerInputHash: runtimeHash(commit),
    };
    const lock = git("show", `${commit}:pnpm-lock.yaml`);
    result.source.lockfileHash = bytesDigest(lock);
    result.source.nativeBatchSize = null;
    if (
      !options.installDeps &&
      lock !== readFileSync(join(root, "pnpm-lock.yaml"), "utf8").trim()
    )
      throw new BenchmarkFailure(
        "ref_lockfile_differs_use_--install-deps_for_isolated_frozen_install"
      );
    if (!existsSync(join(root, "apps/indexer/node_modules/envio/bin.mjs")))
      throw new BenchmarkFailure("install_dependencies_first");
    const config = fixtureConfig(
      `${git("show", `${commit}:apps/indexer/config.yaml`)}\n`,
      options.start,
      options.end
    );
    const handler = git("show", `${commit}:apps/indexer/src/EventHandlers.ts`);
    result.source.configHash = bytesDigest(config);
    if (
      !/name: `control-checkpoint-\$\{chainId\}`[\s\S]{0,400}_every: 10_000/.test(
        handler
      )
    )
      throw new BenchmarkFailure("checkpoint_protocol_changed");
    temporary = mkdtempSync(join(tmpdir(), "pv-indexer-benchmark-source-"));
    const archive = join(temporary, "source.tar");
    command("git", ["archive", "--format=tar", `--output=${archive}`, commit]);
    const diagnosticId = `indexer-${randomUUID()}`;
    const logs = join(root, "benchmarks", diagnosticId);
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    result.diagnosticId = diagnosticId;
    let dependencyRoot = root;
    if (options.installDeps) {
      dependencyRoot = join(temporary, "dependencies");
      mkdirSync(dependencyRoot);
      command("tar", ["-xf", archive, "-C", dependencyRoot]);
      const targetManifest = JSON.parse(
        readFileSync(join(dependencyRoot, "package.json"), "utf8")
      );
      if (targetManifest.packageManager !== `pnpm@${pnpm}`)
        throw new BenchmarkFailure("target_requires_different_pnpm_runtime");
      await installDependencies(
        dependencyRoot,
        join(logs, "install.private.log"),
        () => cancelled
      );
      if (
        readFileSync(join(dependencyRoot, "pnpm-lock.yaml"), "utf8").trim() !==
        lock
      )
        throw new BenchmarkFailure("isolated_install_changed_lockfile");
      if (
        !existsSync(
          join(dependencyRoot, "apps/indexer/node_modules/envio/bin.mjs")
        )
      )
        throw new BenchmarkFailure("isolated_dependencies_missing_envio");
    }
    result.source.dependencies = options.installDeps
      ? "isolated-frozen-install"
      : "reused-matching-lockfile";
    if (!installedLockMatches(dependencyRoot, lock))
      throw new BenchmarkFailure(
        "installed_lockfile_differs_run_frozen_install_or_use_--install-deps"
      );
    const erpcImageId = command("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      image,
    ]).trim();
    const pgImageId = command("docker", [
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      pgImage,
    ]).trim();
    if (
      ![erpcImageId, pgImageId].every((value) =>
        /^sha256:[a-f0-9]{64}$/.test(value)
      )
    )
      throw new BenchmarkFailure("invalid_image_identity");
    const require = createRequire(join(root, "apps/indexer/package.json"));
    const Postgres = require(
      require.resolve("postgres", { paths: [require.resolve("envio")] })
    );
    const probe = readFileSync(
      join(root, "scripts/benchmark-indexer-probe.mjs"),
      "utf8"
    );
    const inputs = {
      driverHash: bytesDigest(readFileSync(fileURLToPath(import.meta.url))),
      probeHash: bytesDigest(probe),
      runtime: {
        node: process.versions.node,
        pnpm,
        platform: platform(),
        arch: arch(),
        logicalCpus: cpus().length,
      },
      workload: {
        chainId: 1,
        start: options.start,
        end: options.end,
        checkpointInterval: 10_000,
        configHash: workloadConfigHash(config),
        eventSource: "HyperSync",
        rpcMode: "fallback",
      },
      fixture: {
        erpcImageId,
        postgresImageId: pgImageId,
        aggregateCreditsPerSecond: 50,
        proxyNetworks: networks,
      },
      providerProfile: options.providerProfile,
    };
    result.inputs = inputs;
    result.inputFingerprint = digest(inputs);
    for (let run = 1; run <= options.runs; run++) {
      result.runs.push(
        await collectRun(
          options,
          {
            archive,
            config,
            probe,
            erpcImageId,
            pgImageId,
            Postgres,
            logs,
            cleanup,
            dependencyRoot,
            source: result.source,
          },
          run,
          () => cancelled
        )
      );
      if (cleanup.failed)
        throw new BenchmarkFailure(
          "owned_resource_cleanup_failed_see_private_logs"
        );
      writeResult(output, result);
    }
    result.summary = summarize(result.runs);
    if (!result.summary.stateConsistent)
      throw new BenchmarkFailure("state_varied_between_runs");
    result.status = "success";
    console.log(
      `Median: ${result.summary.medianBlocksPerSecond.toFixed(1)} committed blocks/s; ${result.summary.medianCommittedSeconds.toFixed(3)} seconds.`
    );
  } catch (error) {
    result.status = "failed";
    result.failure =
      error instanceof BenchmarkFailure
        ? error.code
        : "unexpected_failure_see_private_logs";
    process.exitCode = 1;
    console.error(`Indexer benchmark failed: ${result.failure}`);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (temporary) rmSync(temporary, { recursive: true, force: true });
    result.cleanupComplete = !cleanup.failed;
    writeResult(output, result);
  }
}

function comparisonReport(options) {
  const candidate = JSON.parse(
    readFileSync(resolve(root, options.output), "utf8")
  );
  let baseline;
  const stale = [];
  if (options.compareRef) {
    const commit = resolveRef(options.compareRef);
    baseline = JSON.parse(git("show", `${commit}:${defaultOutput}`));
    if (baseline.source?.indexerInputHash !== runtimeHash(commit))
      stale.push("baseline result predates runtime changes");
  } else baseline = JSON.parse(readFileSync(resolve(options.compare), "utf8"));
  if (
    baseline.source?.indexerInputHash !==
    runtimeHash(resolveRef(baseline.source?.commit ?? "invalid"))
  )
    stale.push("baseline runtime fingerprint does not match its commit");
  if (
    candidate.source?.indexerInputHash !== runtimeHash(resolveRef(options.ref))
  )
    stale.push("candidate result predates runtime changes");
  const comparison = compareResults(baseline, candidate);
  if (stale.length || !comparison.compatible) {
    console.log(
      `Comparison withheld: ${[...stale, ...comparison.reasons].join("; ")}.`
    );
    process.exitCode = 1;
    return;
  }
  console.log("| Metric | Baseline | Candidate |\n| --- | ---: | ---: |");
  for (const [label, a, b] of [
    [
      "Commit",
      baseline.source.commit.slice(0, 12),
      candidate.source.commit.slice(0, 12),
    ],
    ["Runs", baseline.runs.length, candidate.runs.length],
    [
      "Native batch size",
      baseline.source.nativeBatchSize,
      candidate.source.nativeBatchSize,
    ],
    [
      "Median committed seconds",
      baseline.summary.medianCommittedSeconds.toFixed(3),
      candidate.summary.medianCommittedSeconds.toFixed(3),
    ],
    [
      "Median blocks/second",
      baseline.summary.medianBlocksPerSecond.toFixed(1),
      candidate.summary.medianBlocksPerSecond.toFixed(1),
    ],
    [
      "Median proxy RPC items",
      baseline.summary.medianProxyRequests,
      candidate.summary.medianProxyRequests,
    ],
    [
      "Median upstream requests",
      baseline.summary.medianUpstreamRequests,
      candidate.summary.medianUpstreamRequests,
    ],
  ])
    console.log(`| ${label} | ${a} | ${b} |`);
  console.log(
    `\nThroughput change: ${comparison.throughputGainPercent >= 0 ? "+" : ""}${comparison.throughputGainPercent.toFixed(1)}%. Shared entity values and provenance match.`
  );
  if (comparison.addedOrRemovedCaches.length)
    console.log(
      `Cache entity coverage differs: ${comparison.addedOrRemovedCaches.join(", ")}.`
    );
  if (comparison.orderingOnly.length)
    console.log(
      `Exact ordering differs only in normalized policyFunctions: ${comparison.orderingOnly.join(", ")}.`
    );
  if (baseline.runs.length < 3 || candidate.runs.length < 3)
    console.log(
      "Scout comparison: fewer than three runs; repeat before acceptance."
    );
}

export async function main(args) {
  if (args.includes("--help")) {
    console.log(
      "Usage: pnpm benchmark:indexer [--ref HEAD] [--runs 3] [--env-file FILE] [--output FILE] [--start BLOCK --end BLOCK] [--provider-profile LABEL] [--install-deps]\nCompare saved results without Docker or credentials: pnpm benchmark:indexer --compare-ref BRANCH | --compare FILE\nRequires pinned Node/pnpm, installed driver dependencies, prebuilt rpc-cache/Postgres images, ENVIO_API_TOKEN, ETHERSCAN_API_KEY and all nine UPSTREAM_RPC_URL_<chain> values. Matching lockfiles reuse installed dependencies; --install-deps explicitly installs frozen dependencies in an isolated snapshot before timing. Uses fresh local containers/databases and unchanged 50-credit eRPC protection. Private logs: benchmarks/<diagnosticId>/."
    );
    return;
  }
  let options;
  try {
    options = parseOptions(args);
  } catch {
    if (!args.some((argument) => /^--compare(?:-ref)?(?:=|$)/.test(argument))) {
      const index = args.indexOf("--output");
      const inline = args.find((argument) => argument.startsWith("--output="));
      const output =
        inline?.slice("--output=".length) ??
        (index >= 0 ? args[index + 1] : undefined) ??
        defaultOutput;
      writeResult(resolve(root, output), {
        protocol,
        schemaVersion: 1,
        status: "failed",
        failure: "invalid_arguments",
        runs: [],
      });
    }
    console.error("Invalid benchmark arguments; use --help.");
    process.exitCode = 1;
    return;
  }
  if (options.compare || options.compareRef) {
    try {
      comparisonReport(options);
    } catch {
      console.error(
        "Comparison unavailable: check result files, source refs and protocol compatibility."
      );
      process.exitCode = 1;
    }
  } else await runBenchmark(options);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  await main(process.argv.slice(2));
