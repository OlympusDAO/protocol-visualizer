import {
  createPublicClient,
  http,
  type PublicClient,
  type Transport,
} from "viem";

const publicClients = new Map<number, PublicClient<Transport>>();

export function getPublicClient(chainId: number): PublicClient<Transport> {
  const cached = publicClients.get(chainId);
  if (cached) {
    return cached;
  }

  const url = process.env[`ENVIO_RPC_URL_${chainId}`];
  if (!url?.trim()) throw new Error(`Missing ENVIO_RPC_URL_${chainId}`);
  const client = createPublicClient({
    transport: http(url, { batch: true, retryCount: 0 }),
  });
  publicClients.set(chainId, client);

  return client;
}

export function isHistoricalStateUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("historical state") &&
    error.message.toLowerCase().includes("not available")
  );
}
