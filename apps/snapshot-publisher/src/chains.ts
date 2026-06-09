import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { ChainConfig } from "./types.js";

const DEFAULT_CHAIN_CONFIG_CANDIDATES = [
  "packages/protocol-config/protocol-chains.json",
  "../../packages/protocol-config/protocol-chains.json",
  "/app/config/protocol-chains.json",
];

const isChainConfig = (value: unknown): value is ChainConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const chain = value as Record<string, unknown>;
  return (
    typeof chain.key === "string" &&
    Number.isInteger(chain.chainId) &&
    Number(chain.chainId) > 0 &&
    typeof chain.name === "string" &&
    typeof chain.explorerBaseUrl === "string"
  );
};

const validateUniqueChainIds = (chains: ChainConfig[]) => {
  const seen = new Set<number>();
  for (const chain of chains) {
    if (seen.has(chain.chainId)) {
      throw new Error(`duplicate chain id in chain config: ${chain.chainId}`);
    }
    seen.add(chain.chainId);
  }
};

export async function loadSupportedChains(): Promise<ChainConfig[]> {
  const candidates = process.env.PROTOCOL_CHAINS_CONFIG_PATH
    ? [process.env.PROTOCOL_CHAINS_CONFIG_PATH]
    : DEFAULT_CHAIN_CONFIG_CANDIDATES;

  const errors: string[] = [];
  for (const candidate of candidates) {
    const configPath = path.resolve(process.cwd(), candidate);
    try {
      const chains = JSON.parse(await readFile(configPath, "utf8")) as unknown;
      if (!Array.isArray(chains) || !chains.every(isChainConfig)) {
        throw new Error("chain config must be an array of chain definitions");
      }
      validateUniqueChainIds(chains);
      return chains;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${configPath}: ${message}`);
    }
  }

  throw new Error(
    `Unable to load protocol chain config. Tried: ${errors.join("; ")}`
  );
}
