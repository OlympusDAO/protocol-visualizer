import {
  createPublicClient,
  fallback,
  http,
  type PublicClient,
  type Transport,
} from "viem";

import { ChainId } from "../constants";

const publicClients = new Map<number, PublicClient<Transport>>();

const DEFAULT_RPC_URLS: Record<number, string> = {
  [ChainId.Mainnet]: "https://eth.llamarpc.com",
  [ChainId.Base]: "https://base.llamarpc.com",
  [ChainId.Berachain]: "https://rpc.berachain.com",
  [ChainId.Optimism]: "https://optimism.llamarpc.com",
  [ChainId.Sepolia]: "https://ethereum-sepolia-rpc.publicnode.com",
};

function getRpcUrls(chainId: number): string[] {
  const urls = [
    process.env[`ENVIO_RPC_URL_${chainId}`],
    process.env[`ENVIO_RPC_URL_FALLBACK_${chainId}`],
    DEFAULT_RPC_URLS[chainId],
  ].filter((url): url is string => !!url);

  if (urls.length === 0) {
    throw new Error(`RPC URL not found for chain ${chainId}`);
  }

  return urls;
}

export function getPublicClient(chainId: number): PublicClient<Transport> {
  const cached = publicClients.get(chainId);
  if (cached) {
    return cached;
  }

  const transports = getRpcUrls(chainId).map((url) =>
    http(url, { batch: true })
  );
  let transport: Transport;
  if (transports.length === 1) {
    const [singleTransport] = transports;
    if (!singleTransport) {
      throw new Error(`RPC URL not found for chain ${chainId}`);
    }
    transport = singleTransport;
  } else {
    transport = fallback(transports);
  }
  const client = createPublicClient({ transport });
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
