import { Abi } from "viem";

export interface ContractSource {
  address: string;
  name: string;
  abi: Abi;
  processedData: ProcessedContractData;
  lastFetched: number;
}

export interface ProcessedContractData {
  roleToFunctions: Record<string, string[]>;
  functionSelectors: Record<string, FunctionDetails>;
}

export interface FunctionDetails {
  name: string;
  selector: string;
  signature: string;
  roles: string[];
}

export interface ContractCache {
  [address: string]: {
    processedData: ProcessedContractData;
    lastFetched: number;
  };
}

export interface RoleDefinition {
  name: string;
  hash: string;
  description?: string;
}
