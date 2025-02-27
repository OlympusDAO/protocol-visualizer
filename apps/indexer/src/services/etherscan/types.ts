export interface EtherscanApiConfig {
  apiKey: string;
  baseUrl?: string;
  chainId?: number;
  maxRetries?: number;
  retryDelay?: number;
  rateLimitDelay?: number;
}

export interface EtherscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

export interface EtherscanSourceCodeResponse {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  License: string;
  Proxy: boolean;
  Implementation: string;
  SwarmSource: string;
  SimilarMatch: string;
}

export class EtherscanApiError extends Error {
  constructor(
    message: string,
    public status?: string,
    public response?: string
  ) {
    super(message);
    this.name = "EtherscanApiError";
  }
}
