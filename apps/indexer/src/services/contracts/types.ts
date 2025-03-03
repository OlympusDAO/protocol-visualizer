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
  /**
   * The function name, without any arguments
   */
  name: string;
  /**
   * The full function signature, e.g. "functionName(uint256,uint256)(address)"
   */
  selector: string;
  /**
   * The hashed function signature, e.g. "0x9459b875"
   */
  signature: string;
  /**
   * The roles that are associated with this function
   */
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

/**
 * Special role name for the admin of the RolesAdmin contract
 */
export const ROLE_ROLES_ADMIN = "RolesAdmin";
