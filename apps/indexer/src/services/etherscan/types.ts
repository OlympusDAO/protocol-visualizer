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
