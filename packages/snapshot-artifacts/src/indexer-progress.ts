import process from "node:process";
import type { EnvioMetricsReadiness } from "./index.js";

/** Optional block time enriches progress reports; it never changes readiness. */
export async function resolveEnvioProgressTimestamps(
  readiness: EnvioMetricsReadiness,
  environment: Record<string, string | undefined> = process.env
): Promise<EnvioMetricsReadiness> {
  await Promise.all(
    Object.values(readiness.indexingProgress.chains).map(async (progress) => {
      if (progress.timestamp !== null || progress.block <= 0) return;
      const urls = new Set(
        [
          environment[`ENVIO_RPC_URL_${progress.chainId}`],
          environment[`ENVIO_RPC_URL_FALLBACK_${progress.chainId}`],
        ].filter((url): url is string => Boolean(url))
      );
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(5_000),
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getBlockByNumber",
              params: [`0x${progress.block.toString(16)}`, false],
            }),
          });
          if (!response.ok) continue;
          const { result, error } = (await response.json()) as {
            result?: { number?: string; timestamp?: string };
            error?: unknown;
          };
          if (
            error ||
            !result ||
            !/^0x[0-9a-f]+$/i.test(result.number ?? "") ||
            Number(result.number) !== progress.block ||
            !/^0x[0-9a-f]+$/i.test(result.timestamp ?? "")
          )
            continue;
          const timestamp = Number(result.timestamp);
          if (
            !Number.isSafeInteger(timestamp) ||
            timestamp <= 0 ||
            timestamp > 8.64e12
          )
            continue;
          progress.timestamp = timestamp;
          progress.date = new Date(timestamp * 1000).toISOString().slice(0, 10);
          break;
        } catch {}
      }
    })
  );
  return readiness;
}
