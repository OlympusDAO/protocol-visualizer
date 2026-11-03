/* biome-ignore-all lint/suspicious/noUndeclaredEnvVars: standalone benchmark instrumentation runs outside Turbo. */
import { writeFileSync } from "node:fs";

const started = performance.now();
const cpu = process.cpuUsage();
const originalFetch = globalThis.fetch;
const stats = {
  rpcEnvelopes: 0,
  rpcItems: 0,
  rpcMethods: {},
  batchSizes: {},
  rpcPeakEnvelopes: 0,
  rpcFetchMilliseconds: 0,
  sourceRequests: 0,
  sourceStatuses: {},
  sourceFetchMilliseconds: 0,
};
let active = 0;

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  const rpc = url.origin === process.env.PV_BENCHMARK_RPC_ORIGIN;
  const source = url.origin === "https://sourcify.dev";
  if (!rpc && !source) return originalFetch(input, options);
  if (rpc) {
    let items = [];
    try {
      const payload = JSON.parse(options?.body ?? "{}");
      items = Array.isArray(payload) ? payload : [payload];
    } catch {
      // Instrumentation never changes request handling.
    }
    stats.rpcEnvelopes++;
    stats.rpcItems += items.length;
    stats.batchSizes[items.length] = (stats.batchSizes[items.length] ?? 0) + 1;
    for (const item of items) {
      const method = /^eth_[A-Za-z0-9_]{1,64}$/.test(item.method ?? "")
        ? item.method
        : "unknown";
      stats.rpcMethods[method] = (stats.rpcMethods[method] ?? 0) + 1;
    }
    active++;
    stats.rpcPeakEnvelopes = Math.max(stats.rpcPeakEnvelopes, active);
  } else stats.sourceRequests++;
  const before = performance.now();
  try {
    const response = await originalFetch(input, options);
    if (source)
      stats.sourceStatuses[response.status] =
        (stats.sourceStatuses[response.status] ?? 0) + 1;
    return response;
  } catch (error) {
    if (source)
      stats.sourceStatuses.transport =
        (stats.sourceStatuses.transport ?? 0) + 1;
    throw error;
  } finally {
    if (rpc) {
      stats.rpcFetchMilliseconds += performance.now() - before;
      active--;
    } else stats.sourceFetchMilliseconds += performance.now() - before;
  }
};

process.on("exit", () => {
  stats.elapsedMilliseconds = performance.now() - started;
  stats.cpuMicroseconds = process.cpuUsage(cpu);
  stats.maxRssKilobytes = process.resourceUsage().maxRSS;
  const native = process.env.PV_BENCHMARK_NATIVE_WORKERS === "true";
  stats.nativeWorker = Boolean(
    process.channel && process.env.ENVIO_INTERNAL_WORKER
  );
  const destination =
    process.env.PV_BENCHMARK_PROBE_OUTPUT + (native ? `.${process.pid}` : "");
  writeFileSync(destination, JSON.stringify(stats), {
    mode: 0o600,
  });
});
