import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type AbiFunction,
  type AbiParameter,
  type Abi,
  toFunctionSelector,
} from "viem";
import {
  type ContractCache,
  type ProcessedContractData,
  type FunctionDetails,
  ROLE_ROLES_ADMIN,
} from "./types";
import { type EtherscanApi, getEtherscanApi } from "../etherscan/api";
import type { ChainId } from "../../constants";
import precomputedContractMetadata from "../../generated/contract-metadata.json";

const CACHE_FILE = "./data/contract-cache.json";
const ABI_DIR = "./data/abis";
const SOURCE_CODE_DIR = "./data/source-code";
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week
const PRECOMPUTED_CONTRACT_METADATA = precomputedContractMetadata as Record<
  string,
  Record<string, ProcessedContractData>
>;
// The ABI registry of packages/contract-abis. The Docker image copies it to
// the same path relative to apps/indexer.
const ABI_REGISTRY_DIR =
  process.env.CONTRACT_ABIS_PATH || "../../packages/contract-abis/abis";

type AbiRegistryManifest = {
  deployments: { chainId: number; address: string; abi: string }[];
};

let abiRegistryFiles: Map<string, string> | undefined;

function loadAbiRegistryFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const manifestPath = path.join(ABI_REGISTRY_DIR, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.warn(
      `ABI registry not found at ${manifestPath}; ABIs come from Etherscan.`
    );
    return files;
  }
  try {
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf-8")
    ) as AbiRegistryManifest;
    for (const deployment of manifest.deployments) {
      files.set(
        `${deployment.chainId}:${deployment.address.toLowerCase()}`,
        deployment.abi
      );
    }
  } catch (error) {
    console.warn(
      `ABI registry at ${manifestPath} is not valid; ABIs come from Etherscan.`,
      error
    );
    files.clear();
  }
  return files;
}

// The ABI of an address from the registry, or undefined if the registry does
// not have the address or its ABI file cannot be read.
function readRegistryAbi(chainId: ChainId, address: string): Abi | undefined {
  abiRegistryFiles ??= loadAbiRegistryFiles();
  const file = abiRegistryFiles.get(`${chainId}:${address}`);
  if (!file) return undefined;
  try {
    return JSON.parse(
      readFileSync(path.join(ABI_REGISTRY_DIR, file), "utf-8")
    ) as Abi;
  } catch (error) {
    console.warn(`Cannot read ABI registry file ${file}.`, error);
    return undefined;
  }
}

export class ContractProcessor {
  // private roleExtractor: RoleExtractor;
  private cache: ContractCache;

  constructor(
    private etherscanApi: EtherscanApi | undefined,
    private chainId: ChainId
  ) {
    // this.roleExtractor = new RoleExtractor();
    this.cache = this.loadCache();
    // Ensure chain-specific directories exist
    const chainAbiDir = this.getChainAbiDir();
    const chainSourceCodeDir = this.getChainSourceCodeDir();
    if (!existsSync(chainAbiDir)) {
      mkdirSync(chainAbiDir, { recursive: true });
    }
    if (!existsSync(chainSourceCodeDir)) {
      mkdirSync(chainSourceCodeDir, { recursive: true });
    }
  }

  async processContract(
    address: string,
    name: string
  ): Promise<ProcessedContractData> {
    const normalizedAddress = address.toLowerCase();
    const precomputedData =
      PRECOMPUTED_CONTRACT_METADATA[this.chainId.toString()]?.[
        normalizedAddress
      ];
    if (precomputedData) {
      console.log(`PRECOMPUTED CACHE HIT for ${name} on chain ${this.chainId}`);
      return precomputedData;
    }

    // Check cache first
    const chainCache = this.cache[this.chainId];
    const contractCache = chainCache?.[normalizedAddress];
    if (
      chainCache &&
      contractCache &&
      Date.now() - contractCache.lastFetched < CACHE_DURATION &&
      existsSync(this.getAbiPath(normalizedAddress))
    ) {
      console.log(`CACHE HIT for ${name} on chain ${this.chainId}`);
      return contractCache.processedData;
    }

    let abi: Abi;
    const abiPath = this.getAbiPath(normalizedAddress);
    const registryAbi = readRegistryAbi(this.chainId, normalizedAddress);

    if (registryAbi) {
      abi = registryAbi;
      writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    } else if (existsSync(abiPath)) {
      // Check if ABI exists on disk
      const abiJson = readFileSync(abiPath, "utf-8");
      abi = JSON.parse(abiJson) as Abi;
    } else {
      // Fetch and save ABI if it doesn't exist
      abi = await this.getEtherscanApi().getContractAbi(address);
      writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    }

    console.log(`Processing ABI for ${name} on chain ${this.chainId}`);
    const processedData = this.processAbi(abi);

    // Check if the source code exists on disk
    let sourceCode: string;
    const sourceCodePath = this.getSourceCodePath(normalizedAddress);
    if (existsSync(sourceCodePath)) {
      sourceCode = readFileSync(sourceCodePath, "utf-8");
    } else {
      // Fetch and save source code if it doesn't exist
      sourceCode = await this.getEtherscanApi().getContractSourceCode(address);
      writeFileSync(sourceCodePath, sourceCode);
    }

    console.log(`Processing source code for ${name} on chain ${this.chainId}`);
    const processedContractData = this.processSourceCode(
      name,
      sourceCode,
      processedData
    );

    let currentChainCache = this.cache[this.chainId];
    if (!currentChainCache) {
      currentChainCache = {};
    }

    // Update cache
    currentChainCache[normalizedAddress] = {
      processedData: processedContractData,
      lastFetched: Date.now(),
    };
    this.cache[this.chainId] = currentChainCache;
    this.saveCache();

    return processedContractData;
  }

  private getChainAbiDir(): string {
    return path.join(ABI_DIR, this.chainId.toString());
  }

  private getEtherscanApi(): EtherscanApi {
    this.etherscanApi ??= getEtherscanApi(this.chainId);
    return this.etherscanApi;
  }

  private getChainSourceCodeDir(): string {
    return path.join(SOURCE_CODE_DIR, this.chainId.toString());
  }

  private getAbiPath(address: string): string {
    return path.join(this.getChainAbiDir(), `${address}.json`);
  }

  private getSourceCodePath(address: string): string {
    return path.join(this.getChainSourceCodeDir(), `${address}.json`);
  }

  private processAbi(abi: Abi): ProcessedContractData {
    const roleToFunctions: Record<string, string[]> = {};
    const functionSelectors: Record<string, FunctionDetails> = {};

    // Process each function
    for (const item of abi) {
      // console.log("item", JSON.stringify(item, null, 2));
      if (item.type !== "function") continue;

      try {
        // Get function signature and selector
        const signature = this.getFunctionSignature(item);
        const selector = toFunctionSelector(item);
        // const functionRoles = this.matchFunctionRoles(item, roles);

        functionSelectors[selector] = {
          name: item.name,
          selector,
          signature,
          roles: [],
        };
      } catch (error) {
        console.warn(`Failed to process function ${item.name}:`, error);
      }
    }

    return { roleToFunctions, functionSelectors };
  }

  private findRoleFromModifier(
    name: string,
    functionDefinition: string,
    sourceCode: string,
    functionName: string
  ): string[] | null {
    // First try to match constant references
    const constantMatch = functionDefinition.match(
      /onlyRole\(([A-Z_][A-Z0-9_]*)\)/
    );
    if (constantMatch) {
      const constantName = constantMatch[1];
      // Look for constant definition in the form: bytes32 [visibility] constant CONSTANT_NAME = "value"
      const constantDefinitionRegex = new RegExp(
        `bytes32\\s+(?:public|private|internal)?\\s+constant\\s+${constantName}\\s*=\\s*\\\\?"([^"]*)\\\\"?`
      );
      const constantDefinition = sourceCode.match(constantDefinitionRegex);

      if (constantDefinition?.[1]) {
        console.log(
          `Found role with constant value ${constantDefinition[1]} for ${functionName}`
        );
        return [constantDefinition[1]];
      }
    }

    // Check for onlyAdmin, onlyEmergency, onlyAdminOrEmergency
    const onlyAdminMatch = functionDefinition.match(/onlyAdmin(?:\(\))?/);
    if (onlyAdminMatch) {
      // If the contract name is RolesAdmin, use the special role name
      if (name.includes("RolesAdmin")) {
        console.log(
          `Found role with onlyAdmin for ${functionName} on RolesAdmin`
        );
        return [ROLE_ROLES_ADMIN];
      }

      console.log(`Found role with onlyAdmin for ${functionName}`);
      return ["admin"];
    }

    const onlyEmergencyMatch = functionDefinition.match(
      /onlyEmergency(?:\(\))?/
    );
    if (onlyEmergencyMatch) {
      console.log(`Found role with onlyEmergency for ${functionName}`);
      return ["emergency"];
    }

    const onlyAdminOrEmergencyMatch = functionDefinition.match(
      /onlyAdminOrEmergency(?:\(\))?/
    );
    if (onlyAdminOrEmergencyMatch) {
      console.log(`Found role with onlyAdminOrEmergency for ${functionName}`);
      return ["admin", "emergency"];
    }

    // If no constant found, try direct string values
    const directStringMatch = functionDefinition.match(
      /onlyRole\(\\?"([^"]*)\\"?\)/
    );
    if (directStringMatch?.[1]) {
      console.log(
        `Found role with literal value ${directStringMatch[1]} for ${functionName}`
      );
      return [directStringMatch[1]];
    }

    return null;
  }

  private processSourceCode(
    name: string,
    sourceCode: string,
    processedData: ProcessedContractData
  ): ProcessedContractData {
    // Iterate over the defined functions
    for (const functionSignature in processedData.functionSelectors) {
      const functionDetails =
        processedData.functionSelectors[functionSignature];
      if (!functionDetails) {
        console.warn(
          `Function ${functionSignature} not found in processed data`
        );
        continue;
      }

      const functionName = functionDetails.name;
      console.log(`Processing function ${functionName}`);

      // Find the function in the source code, including any modifiers and newlines up to the opening bracket
      const functionDefinition = sourceCode.match(
        new RegExp(`function ${functionName}\\s*\\([^{]*\\)\\s*[^{]*{`)
      );
      if (!functionDefinition) {
        console.warn(`Function ${functionName} not found in source code`);
        continue;
      }

      const role = this.findRoleFromModifier(
        name,
        functionDefinition[0],
        sourceCode,
        functionName
      );
      if (!role) {
        continue;
      }

      console.log(`Function ${functionName} has roles ${JSON.stringify(role)}`);

      // Add the role to the function details
      functionDetails.roles.push(...role);
    }

    return processedData;
  }

  private getFunctionSignature(func: AbiFunction): string {
    const inputs = func.inputs
      .map((input: AbiParameter) => input.type)
      .join(",");
    const outputs = func.outputs
      .map((output: AbiParameter) => output.type)
      .join(",");
    return `${func.name}(${inputs})(${outputs})`;
  }

  private loadCache(): ContractCache {
    try {
      return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as ContractCache;
    } catch {
      return {} as ContractCache;
    }
  }

  private saveCache(): void {
    // Create the data directory if it doesn't exist
    const dataDir = path.dirname(CACHE_FILE);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2));
  }
}
