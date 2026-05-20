#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const indexerDir = path.join(repoRoot, "apps", "indexer");

const chainLabels = {
  1: "mainnet",
  10: "optimism",
  8453: "base",
  80094: "berachain",
  11155111: "sepolia",
};

const enabledChainIds = Object.keys(chainLabels)
  .map(Number)
  .sort((a, b) => a - b);

const maxSeconds = Number(process.env.BENCHMARK_SECONDS ?? "600");
const port = process.env.BENCHMARK_PORT ?? "43123";
const cleanLocalCache = process.env.BENCHMARK_CLEAN_CACHE === "1";
const cleanContractData = process.env.BENCHMARK_CLEAN_CONTRACT_DATA === "1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const schema = `bench${Date.now().toString(36)}`.slice(0, 45);
const outputDir = path.join(repoRoot, "benchmarks", "indexer");
const outputPath = path.join(
  outputDir,
  `${timestamp}-enabled-chains-baseline.md`,
);

function parseEnv(contents) {
  const env = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function parseBlockRange(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^\[(\d+),(\d+)\]$/);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
  };
}

function elapsedSeconds(startMs) {
  return (Date.now() - startMs) / 1000;
}

function formatSeconds(value) {
  if (value === undefined || value === null) return "";
  return value.toFixed(3);
}

function formatNumber(value) {
  if (value === undefined || value === null) return "";
  return value.toLocaleString("en-US");
}

function makeInitialChainState(chainId) {
  return {
    chainId,
    label: chainLabels[chainId],
    targetStartBlock: undefined,
    targetEndBlock: undefined,
    cachedBlock: undefined,
    cacheRate: undefined,
    highestIndexedBlock: undefined,
    firstIndexedAtSeconds: undefined,
    targetReachedAtSeconds: undefined,
    indexedRanges: 0,
    indexedEvents: 0,
    indexedHandlerDurationMs: 0,
    fetchBackfillDurationMs: undefined,
    ethCallErrors: 0,
    otherRpcErrors: 0,
  };
}

const chainState = Object.fromEntries(
  enabledChainIds.map((chainId) => [chainId, makeInitialChainState(chainId)]),
);

const counters = {
  cacheHits: 0,
  moduleKeycodeReads: 0,
  keycodeLookups: 0,
  moduleAddressLookups: 0,
  policyPermissionPasses: 0,
};

const failureSamples = [];
let jsonBuffer = "";

function recordFailureSample(sample) {
  if (failureSamples.length >= 12) return;
  failureSamples.push({
    ...sample,
    details: sanitizeFailureText(sample.details),
    shortMessage: sanitizeFailureText(sample.shortMessage),
    msg: sanitizeFailureText(sample.msg),
  });
}

function sanitizeFailureText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/https?:\/\/[^\s")]+/g, "[redacted-url]")
    .replace(/wss?:\/\/[^\s")]+/g, "[redacted-url]");
}

function handleJsonLog(log, startMs) {
  const state = chainState[log.chain_id];

  if (log.level >= 50) {
    recordFailureSample({
      chain: log.chain,
      chainId: log.chain_id,
      msg: log.msg,
      method: log.method,
      code: log.error?.code,
      shortMessage: log.error?.shortMessage,
      details: log.error?.details,
    });
  }

  if (state && log.msg === "Started backfill indexing") {
    const range = parseBlockRange(log.block_range);
    if (range) {
      state.targetStartBlock = range.start;
      state.targetEndBlock = range.end;
    }
    return;
  }

  if (state && log.msg === "Started fetching backfill JSON-RPC data") {
    if (typeof log.cached_block === "number") {
      state.cachedBlock = log.cached_block;
    }
    if (typeof log.cache_rate === "string") {
      state.cacheRate = log.cache_rate;
    }
    return;
  }

  if (state && log.msg === "Finished fetching backfill JSON-RPC data") {
    if (typeof log.duration === "number") {
      state.fetchBackfillDurationMs = log.duration;
    }
    return;
  }

  if (state && log.msg === "Indexed block range") {
    const now = elapsedSeconds(startMs);
    const range = parseBlockRange(log.block_range);
    if (range) {
      state.highestIndexedBlock = Math.max(
        state.highestIndexedBlock ?? 0,
        range.end,
      );
    }
    state.indexedRanges += 1;
    if (typeof log.event_count === "number") {
      state.indexedEvents += log.event_count;
    }
    if (typeof log.duration === "number") {
      state.indexedHandlerDurationMs += log.duration;
    }
    if (state.firstIndexedAtSeconds === undefined) {
      state.firstIndexedAtSeconds = now;
    }
    if (
      state.targetReachedAtSeconds === undefined &&
      state.targetEndBlock !== undefined &&
      state.highestIndexedBlock !== undefined &&
      state.highestIndexedBlock >= state.targetEndBlock
    ) {
      state.targetReachedAtSeconds = now;
    }
    return;
  }

  if (state && log.msg === "Received JSON-RPC error") {
    if (log.method === "eth_call") {
      state.ethCallErrors += 1;
    } else {
      state.otherRpcErrors += 1;
    }
    recordFailureSample({
      chain: log.chain,
      chainId: log.chain_id,
      msg: log.msg,
      method: log.method,
      code: log.error?.code,
      shortMessage: log.error?.shortMessage,
      details: log.error?.details,
    });
  }
}

function handleTextLine(line) {
  if (line.includes("CACHE HIT")) counters.cacheHits += 1;
  if (line.startsWith("Keycode for ")) counters.moduleKeycodeReads += 1;
  if (line.startsWith("Looking up keycode ")) counters.keycodeLookups += 1;
  if (line.startsWith("Found contract at ")) counters.moduleAddressLookups += 1;
  if (line.startsWith("Parsing policy permissions for ")) {
    counters.policyPermissionPasses += 1;
  }
  if (/error|failed|fatal/i.test(line)) {
    recordFailureSample({ msg: line.slice(0, 240) });
  }
}

function handleChunk(chunk, startMs) {
  jsonBuffer += chunk.toString();

  let newlineIndex = jsonBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = jsonBuffer.slice(0, newlineIndex).trim();
    jsonBuffer = jsonBuffer.slice(newlineIndex + 1);
    if (!line) continue;

    if (line.startsWith("{")) {
      try {
        handleJsonLog(JSON.parse(line), startMs);
      } catch {
        handleTextLine(line);
      }
    } else {
      handleTextLine(line);
    }

    newlineIndex = jsonBuffer.indexOf("\n");
  }
}

function allTargetsReached() {
  return enabledChainIds.every((chainId) => {
    const state = chainState[chainId];
    return (
      state.targetEndBlock !== undefined &&
      state.highestIndexedBlock !== undefined &&
      state.highestIndexedBlock >= state.targetEndBlock
    );
  });
}

function renderMarkdown({
  startIso,
  endIso,
  exitReason,
  elapsed,
  ponderRoot,
  cleanCacheBackup,
  freshCachePath,
  contractDataBackup,
  freshContractDataPath,
}) {
  const lines = [];
  lines.push("# Indexer Benchmark: Enabled Chains Baseline");
  lines.push("");
  lines.push(`- Started: ${startIso}`);
  lines.push(`- Ended: ${endIso}`);
  lines.push(`- Elapsed seconds: ${formatSeconds(elapsed)}`);
  lines.push(`- Exit reason: ${exitReason}`);
  lines.push(`- Schema: ${schema}`);
  lines.push(`- Port: ${port}`);
  lines.push(`- Ponder root: ${ponderRoot}`);
  lines.push(`- Clean local Ponder cache: ${cleanLocalCache ? "yes" : "no"}`);
  lines.push(
    `- Clean contract metadata data: ${cleanContractData ? "yes" : "no"}`,
  );
  if (cleanCacheBackup) {
    lines.push(`- Restored original cache from: ${cleanCacheBackup}`);
  }
  if (freshCachePath) {
    lines.push(`- Fresh benchmark cache moved to: ${freshCachePath}`);
  }
  if (contractDataBackup) {
    lines.push(`- Restored original contract data from: ${contractDataBackup}`);
  }
  if (freshContractDataPath) {
    lines.push(
      `- Fresh benchmark contract data moved to: ${freshContractDataPath}`,
    );
  }
  lines.push(
    `- Command: pnpm --dir apps/indexer exec ponder --root ${ponderRoot} --log-format json start --schema ${schema} -p ${port}`,
  );
  lines.push(`- Benchmark seconds limit: ${maxSeconds}`);
  lines.push("");
  lines.push("## Chain Progress");
  lines.push("");
  lines.push(
    "| Chain | Chain ID | Target range | Cached block | Cache rate | Highest indexed block | Time to first range (s) | Time to target (s) | Indexed ranges | Events | Handler duration (ms) | Backfill fetch duration (ms) | eth_call errors | Other RPC errors |",
  );
  lines.push(
    "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const chainId of enabledChainIds) {
    const state = chainState[chainId];
    const targetRange =
      state.targetStartBlock !== undefined && state.targetEndBlock !== undefined
        ? `[${formatNumber(state.targetStartBlock)}, ${formatNumber(state.targetEndBlock)}]`
        : "";
    lines.push(
      `| ${state.label} | ${chainId} | ${targetRange} | ${formatNumber(state.cachedBlock)} | ${state.cacheRate ?? ""} | ${formatNumber(state.highestIndexedBlock)} | ${formatSeconds(state.firstIndexedAtSeconds)} | ${formatSeconds(state.targetReachedAtSeconds)} | ${state.indexedRanges} | ${state.indexedEvents} | ${formatSeconds(state.indexedHandlerDurationMs)} | ${formatSeconds(state.fetchBackfillDurationMs)} | ${state.ethCallErrors} | ${state.otherRpcErrors} |`,
    );
  }
  lines.push("");
  lines.push("## Handler Counters");
  lines.push("");
  lines.push(`- Contract metadata cache hits: ${counters.cacheHits}`);
  lines.push(`- Module KEYCODE fallback reads: ${counters.moduleKeycodeReads}`);
  lines.push(`- Policy permission passes: ${counters.policyPermissionPasses}`);
  lines.push(`- Keycode permission lookups: ${counters.keycodeLookups}`);
  lines.push(`- Module address lookup logs: ${counters.moduleAddressLookups}`);
  lines.push("");
  if (failureSamples.length > 0) {
    lines.push("## Sanitized Failure Samples");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(failureSamples, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Notes");
  lines.push("");
  lines.push(
    cleanLocalCache
      ? "- This benchmark temporarily moves `apps/indexer/.ponder` aside, so Ponder's RPC/database cache starts clean."
      : "- This benchmark uses the local Ponder database/cache under `apps/indexer/.ponder`.",
  );
  if (cleanContractData) {
    lines.push(
      "- This benchmark temporarily moves `apps/indexer/data` aside, so ABI/source/contract metadata data starts clean.",
    );
  }
  lines.push(
    "- The output intentionally excludes raw RPC request bodies and URLs.",
  );
  lines.push(
    "- Compare later runs against `Time to target`, `Highest indexed block`, handler counters, and `eth_call errors`.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const envFile = await readFile(path.join(indexerDir, ".env.local"), "utf8");
  const env = {
    ...process.env,
    ...parseEnv(envFile),
  };
  const ponderRoot = indexerDir;
  const localPonderDir = path.join(indexerDir, ".ponder");
  const contractDataDir = path.join(indexerDir, "data");
  const cleanCacheBackup = cleanLocalCache
    ? path.join(
        "/private/tmp",
        `protocol-visualizer-ponder-original-${timestamp}`,
      )
    : undefined;
  const freshCachePath = cleanLocalCache
    ? path.join("/private/tmp", `protocol-visualizer-ponder-fresh-${timestamp}`)
    : undefined;
  const contractDataBackup = cleanContractData
    ? path.join(
        "/private/tmp",
        `protocol-visualizer-contract-data-original-${timestamp}`,
      )
    : undefined;
  const freshContractDataPath = cleanContractData
    ? path.join(
        "/private/tmp",
        `protocol-visualizer-contract-data-fresh-${timestamp}`,
      )
    : undefined;
  let movedOriginalCache = false;
  let movedOriginalContractData = false;

  if (cleanLocalCache && cleanCacheBackup) {
    try {
      await rename(localPonderDir, cleanCacheBackup);
      movedOriginalCache = true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code !== "ENOENT") {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  if (cleanContractData && contractDataBackup) {
    try {
      await rename(contractDataDir, contractDataBackup);
      movedOriginalContractData = true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code !== "ENOENT") {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  const child = spawn(
    "pnpm",
    [
      "--dir",
      "apps/indexer",
      "exec",
      "ponder",
      "--root",
      ponderRoot,
      "--log-format",
      "json",
      "start",
      "--schema",
      schema,
      "-p",
      port,
    ],
    {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const startMs = Date.now();
  const startIso = new Date(startMs).toISOString();
  let exitReason = "process exited";
  let killed = false;

  const timeout = setTimeout(() => {
    exitReason = "time limit reached";
    killed = true;
    child.kill("SIGINT");
  }, maxSeconds * 1000);

  const completionCheck = setInterval(() => {
    if (allTargetsReached()) {
      exitReason = "all enabled chains reached startup target block";
      killed = true;
      child.kill("SIGINT");
    }
  }, 1000);

  child.stdout.on("data", (chunk) => handleChunk(chunk, startMs));
  child.stderr.on("data", (chunk) => handleChunk(chunk, startMs));

  const exitCode = await new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(completionCheck);
      if (!killed && signal) exitReason = `process exited via ${signal}`;
      if (!killed && code !== 0)
        exitReason = `process exited with code ${code}`;
      resolve(code);
    });
  });

  const endMs = Date.now();

  if (cleanLocalCache && freshCachePath) {
    try {
      await rename(localPonderDir, freshCachePath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code !== "ENOENT") {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  if (cleanContractData && freshContractDataPath) {
    try {
      await rename(contractDataDir, freshContractDataPath);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) {
        const code = error.code;
        if (code !== "ENOENT") {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  if (movedOriginalCache && cleanCacheBackup) {
    await rename(cleanCacheBackup, localPonderDir);
  }

  if (movedOriginalContractData && contractDataBackup) {
    await rename(contractDataBackup, contractDataDir);
  }

  const markdown = renderMarkdown({
    startIso,
    endIso: new Date(endMs).toISOString(),
    exitReason,
    elapsed: (endMs - startMs) / 1000,
    ponderRoot,
    cleanCacheBackup,
    freshCachePath,
    contractDataBackup,
    freshContractDataPath,
  });

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, markdown);

  console.log(`Benchmark written: ${outputPath}`);
  console.log(`Exit reason: ${exitReason}`);
  process.exit(exitCode === null || exitCode === 0 || killed ? 0 : exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
