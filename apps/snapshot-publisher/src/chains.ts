import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { ChainConfig, InventoryContract } from "./types.js";

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
      return chains.filter((chain) => chain.availability !== "historical");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${configPath}: ${message}`);
    }
  }

  throw new Error(
    `Unable to load protocol chain config. Tried: ${errors.join("; ")}`
  );
}

const isInventoryContract = (value: unknown): value is InventoryContract => {
  if (!value || typeof value !== "object") return false;
  const contract = value as Record<string, unknown>;
  return (
    Number.isInteger(contract.chainId) &&
    Number(contract.chainId) > 0 &&
    typeof contract.address === "string" &&
    /^0x[0-9a-f]{40}$/i.test(contract.address) &&
    !/^0x0{40}$/i.test(contract.address) &&
    typeof contract.name === "string" &&
    contract.name.trim().length > 0 &&
    (contract.labelOnly === undefined ||
      typeof contract.labelOnly === "boolean") &&
    (contract.startBlock === undefined ||
      (Number.isInteger(contract.startBlock) &&
        Number(contract.startBlock) >= 0))
  );
};

export async function loadOtherContracts(): Promise<InventoryContract[]> {
  const candidates = process.env.OTHER_CONTRACTS_CONFIG_PATH
    ? [process.env.OTHER_CONTRACTS_CONFIG_PATH]
    : DEFAULT_CHAIN_CONFIG_CANDIDATES.map((candidate) =>
        candidate.replace("protocol-chains.json", "other-contracts.json")
      );
  for (const candidate of candidates) {
    try {
      const contracts: unknown = JSON.parse(
        await readFile(path.resolve(process.cwd(), candidate), "utf8")
      );
      if (!Array.isArray(contracts) || !contracts.every(isInventoryContract)) {
        throw new Error(
          "other-contract inventory must contain valid chain, address, name, and optional startBlock entries"
        );
      }
      return contracts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    "Unable to load other-contracts.json; set OTHER_CONTRACTS_CONFIG_PATH"
  );
}
