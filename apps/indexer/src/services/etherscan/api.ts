import { Abi } from "viem";
import {
  EtherscanApiConfig,
  EtherscanResponse,
  EtherscanApiError,
  EtherscanSourceCodeResponse,
} from "./types";
import { ChainId } from "../../constants";

const etherscanApis: Record<number, EtherscanApi> = {};

const BASE_URLS: Record<number, string> = {
  [ChainId.Mainnet]: "https://api.etherscan.io/v2/api",
  [ChainId.Arbitrum]: "https://api.arbiscan.io/api",
  [ChainId.Base]: "https://api.basescan.org/api",
  [ChainId.Berachain]: "https://api.berascan.com/api",
};

export const getEtherscanApi = (chainId: number) => {
  if (!etherscanApis[chainId]) {
    // Check that the API key is set
    const apiKey = process.env[`ETHERSCAN_API_KEY_${chainId}`];
    if (!apiKey) {
      throw new Error(
        `Etherscan API key for chain ${chainId} is not set. Set the ETHERSCAN_API_KEY_${chainId} environment variable.`
      );
    }

    const baseUrl = BASE_URLS[chainId];
    if (!baseUrl) {
      throw new Error(
        `Etherscan API base URL for chain ${chainId} is not defined.`
      );
    }

    etherscanApis[chainId] = new EtherscanApi({
      apiKey,
      baseUrl,
      chainId,
    });
  }
  return etherscanApis[chainId];
};

export class EtherscanApi {
  private baseUrl: string;
  private apiKey: string;
  private chainId: number;
  private maxRetries: number;
  private retryDelay: number;
  private rateLimitDelay: number;
  private lastRequestTime: number = 0;

  constructor(config: EtherscanApiConfig) {
    // Ensure there is an API key
    if (!config.apiKey) {
      throw new Error("Etherscan API key is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.etherscan.io/v2/api";
    this.chainId = config.chainId || 1;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.rateLimitDelay = config.rateLimitDelay || 200; // 5 requests per second
  }

  async getContractAbi(address: string): Promise<Abi> {
    const params = new URLSearchParams({
      chainid: this.chainId.toString(),
      module: "contract",
      action: "getabi",
      address,
      apikey: this.apiKey,
    });

    const response = await this.fetchWithRetry<string>(params);

    try {
      return JSON.parse(response) as Abi;
    } catch (error) {
      throw new EtherscanApiError(
        `Failed to parse ABI for contract ${address}`,
        "PARSE_ERROR",
        JSON.stringify(error)
      );
    }
  }

  async getContractSourceCode(address: string): Promise<string> {
    const params = new URLSearchParams({
      chainid: this.chainId.toString(),
      module: "contract",
      action: "getsourcecode",
      address,
      apikey: this.apiKey,
    });

    const response =
      await this.fetchWithRetry<EtherscanSourceCodeResponse[]>(params);

    if (response.length === 0) {
      throw new EtherscanApiError(
        `No source code found for contract ${address}`,
        "NO_SOURCE_CODE"
      );
    }

    try {
      const sourceCode = response[0]!.SourceCode;
      // Strip duplicated first and last brackets if they exist
      const trimmedSourceCode = sourceCode.trim();
      if (
        trimmedSourceCode.startsWith("{{") &&
        trimmedSourceCode.endsWith("}}")
      ) {
        return trimmedSourceCode.slice(1, -1);
      }
      return sourceCode;
    } catch (error) {
      throw new EtherscanApiError(
        `Failed to parse source code for contract ${address}`,
        "PARSE_ERROR",
        JSON.stringify(error)
      );
    }
  }

  private async fetchWithRetry<T>(params: URLSearchParams): Promise<T> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Rate limiting
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
          await this.sleep(this.rateLimitDelay - timeSinceLastRequest);
        }

        const url = `${this.baseUrl}?${params.toString()}`;
        const response = await fetch(url);
        this.lastRequestTime = Date.now();

        if (!response.ok) {
          throw new EtherscanApiError(
            `HTTP error ${response.status}`,
            response.status.toString()
          );
        }

        const data = (await response.json()) as EtherscanResponse<T>;

        if (data.status !== "1") {
          throw new EtherscanApiError(
            `API error: ${data.message}`,
            data.status,
            JSON.stringify(data)
          );
        }

        return data.result;
      } catch (error: unknown) {
        if (attempt === this.maxRetries) {
          throw error instanceof EtherscanApiError
            ? error
            : new EtherscanApiError(
                `Failed to fetch from Etherscan: ${error instanceof Error ? error.message : "Unknown error"}`,
                "NETWORK_ERROR",
                JSON.stringify(error)
              );
        }

        console.warn(
          `Attempt ${attempt} failed, retrying in ${this.retryDelay}ms...`
        );
        await this.sleep(this.retryDelay * attempt);
      }
    }

    throw new EtherscanApiError("Max retries reached");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
