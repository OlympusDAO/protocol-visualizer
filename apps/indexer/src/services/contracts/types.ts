import type { Abi } from "viem";
import type { FunctionContext } from "../../../../../packages/snapshot-artifacts/src/index";

export interface ContractSource {
  address: string;
  name: string;
  abi: Abi;
  processedData: ProcessedContractData;
  lastFetched: number;
}

export interface OrdinaryDeployment {
  chainId: number;
  address: string;
  creationBlock: string;
  codeHash: string;
  version: string;
  sourceUrl: string;
}

export interface ImmutableDeployment extends OrdinaryDeployment {
  immutableGetters: Record<string, string>;
}

export interface ProcessedContractData {
  // Conclusive discovery for this runtime, including proven ineligible code.
  deploymentDiscovery?: {
    chainId: number;
    address: string;
    codeHash: string;
    version: string;
  };
  ordinaryDeployment?: OrdinaryDeployment;
  immutableDeployment?: ImmutableDeployment;
  roleToFunctions: Record<string, string[]>;
  functionSelectors: Record<string, FunctionDetails>;
  addressGetters?: string[];
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
  canonicalSignature?: string;
  documentation?: FunctionContext;
}

export interface ContractCache {
  [chainId: number]: {
    [address: string]: {
      processedData: ProcessedContractData;
      lastFetched: number;
    };
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
