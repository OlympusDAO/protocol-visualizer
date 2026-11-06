import process from "node:process";
import {
  type ChainObservation,
  type EnvioMetricsReadiness,
  FULL_VERIFICATION_VERSION,
} from "./index.js";

/** Envio owns readiness; this check validates the completed observation's integrity. */
export async function verifyCompletedObservation(
  chainId: number,
  observation: ChainObservation | null | undefined,
  environment: Record<string, string | undefined> = process.env
): Promise<boolean> {
  if (
    observation?.chainId !== chainId ||
    observation.verificationVersion !== FULL_VERIFICATION_VERSION ||
    !/^\d+$/.test(observation.indexedThrough?.number ?? "") ||
    !/^\d+$/.test(observation.indexedThrough?.timestamp ?? "") ||
    !/^0x[0-9a-f]{64}$/i.test(observation.indexedThrough?.hash ?? "")
  )
    return false;
  const url = environment[`RPC_URL_${chainId}`];
  if (!url) return false;
  const read = async (tag: string) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(5_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBlockByNumber",
        params: [tag, false],
      }),
    });
    if (!response.ok) return;
    const { result, error } = (await response.json()) as {
      error?: unknown;
      result?: { number?: string; hash?: string; timestamp?: string };
    };
    if (
      error ||
      !result ||
      !/^0x[0-9a-f]+$/i.test(result.number ?? "") ||
      !/^0x[0-9a-f]+$/i.test(result.timestamp ?? "") ||
      !/^0x[0-9a-f]{64}$/i.test(result.hash ?? "")
    )
      return;
    return {
      number: BigInt(result.number as string),
      hash: (result.hash as string).toLowerCase(),
      timestamp: BigInt(result.timestamp as string),
    };
  };
  try {
    const number = BigInt(observation.indexedThrough.number);
    const observed = await read(`0x${number.toString(16)}`);
    return Boolean(
      observed &&
        observed.number === number &&
        observed.hash === observation.indexedThrough.hash.toLowerCase() &&
        observed.timestamp === BigInt(observation.indexedThrough.timestamp)
    );
  } catch {
    return false;
  }
}

export function assertRpcConfiguration(
  chains: Array<{ chainId: number }>,
  environment: Record<string, string | undefined> = process.env
): void {
  const missing = chains
    .map(({ chainId }) => `RPC_URL_${chainId}`)
    .filter((name) => !environment[name]?.trim());
  if (missing.length)
    throw new Error(`Missing required RPC variables: ${missing.join(", ")}`);
}

/** Optional block time enriches progress reports; it never changes readiness. */
export async function resolveEnvioProgressTimestamps(
  readiness: EnvioMetricsReadiness,
  environment: Record<string, string | undefined> = process.env
): Promise<EnvioMetricsReadiness> {
  await Promise.all(
    Object.values(readiness.indexingProgress.chains).map(async (progress) => {
      if (progress.timestamp !== null || progress.block <= 0) return;
      const url = environment[`RPC_URL_${progress.chainId}`];
      if (!url) return;
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
        if (!response.ok) return;
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
          return;
        const timestamp = Number(result.timestamp);
        if (
          !Number.isSafeInteger(timestamp) ||
          timestamp <= 0 ||
          timestamp > 8.64e12
        )
          return;
        progress.timestamp = timestamp;
        progress.date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      } catch {}
    })
  );
  return readiness;
}
