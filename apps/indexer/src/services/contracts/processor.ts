import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { getFunctionSelector, AbiFunction, AbiParameter, Abi } from "viem";
import { ContractCache, ProcessedContractData, FunctionDetails } from "./types";
import { EtherscanApi } from "../etherscan/api";
import path from "path";
// import { RoleExtractor } from './role-extractor';

const CACHE_FILE = "./data/contract-cache.json";
const ABI_DIR = "./data/abis";
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week

export class ContractProcessor {
  // private roleExtractor: RoleExtractor;
  private cache: ContractCache;

  constructor(private etherscanApi: EtherscanApi) {
    // this.roleExtractor = new RoleExtractor();
    this.cache = this.loadCache();
    // Ensure ABI directory exists
    if (!existsSync(ABI_DIR)) {
      mkdirSync(ABI_DIR, { recursive: true });
    }
  }

  async processContract(address: string): Promise<ProcessedContractData> {
    // Check cache first
    if (
      this.cache[address] &&
      Date.now() - this.cache[address].lastFetched < CACHE_DURATION &&
      existsSync(this.getAbiPath(address))
    ) {
      console.log(`CACHE HIT for ${address}`);
      return this.cache[address].processedData;
    }

    let abi: Abi;
    const abiPath = this.getAbiPath(address);

    // Check if ABI exists on disk
    if (existsSync(abiPath)) {
      const abiJson = readFileSync(abiPath, "utf-8");
      abi = JSON.parse(abiJson) as Abi;
    } else {
      // Fetch and save ABI if it doesn't exist
      abi = await this.etherscanApi.getContractAbi(address);
      writeFileSync(abiPath, JSON.stringify(abi, null, 2));
    }

    console.log(`Processing ABI for ${address}`);
    const processedData = this.processAbi(abi);

    // Update cache
    this.cache[address] = {
      processedData,
      lastFetched: Date.now(),
    };
    this.saveCache();

    return processedData;
  }

  private getAbiPath(address: string): string {
    return path.join(ABI_DIR, `${address}.json`);
  }

  private processAbi(abi: Abi): ProcessedContractData {
    // const roles = this.roleExtractor.extractRoles(abi);
    // const parsedAbi = parseAbi(abi);

    const roleToFunctions: Record<string, string[]> = {};
    const functionSelectors: Record<string, FunctionDetails> = {};

    // Process each function
    for (const item of abi) {
      console.log("item", JSON.stringify(item, null, 2));
      if (item.type !== "function") continue;

      try {
        // Get function signature and selector
        const signature = this.getFunctionSignature(item);
        const selector = getFunctionSelector(signature);
        // const functionRoles = this.matchFunctionRoles(item, roles);
        console.log("signature", signature);
        console.log("selector", selector);

        functionSelectors[selector] = {
          name: item.name,
          selector,
          signature,
          roles: [],
        };

        // Build role to functions mapping
        // functionRoles.forEach(role => {
        //   if (!roleToFunctions[role]) {
        //     roleToFunctions[role] = [];
        //   }
        //   roleToFunctions[role].push(selector);
        // });
      } catch (error) {
        console.warn(`Failed to process function ${item.name}:`, error);
        continue;
      }
    }

    return { roleToFunctions, functionSelectors };
  }

  private getFunctionSignature(func: AbiFunction): string {
    const inputs = func.inputs
      .map((input: AbiParameter) => input.type)
      .join(",");
    return `${func.name}(${inputs})`;
  }

  // private matchFunctionRoles(
  //   fragment: AbiFunction,
  //   roles: RoleDefinition[]
  // ): string[] {
  //   const requiredRoles = new Set<string>();

  //   // Check modifiers
  //   if (fragment.modifiers) {
  //     for (const modifier of fragment.modifiers) {
  //       if (modifier.name === 'onlyRole') {
  //         const roleHash = modifier.arguments?.[0];
  //         const role = roles.find(r => r.hash === roleHash);
  //         if (role) {
  //           requiredRoles.add(role.name);
  //         }
  //       }
  //     }
  //   }

  //   // Check NatSpec
  //   const natspec = fragment.notice || fragment.details;
  //   if (natspec) {
  //     roles.forEach(role => {
  //       if (natspec.includes(role.name)) {
  //         requiredRoles.add(role.name);
  //       }
  //     });
  //   }

  //   return Array.from(requiredRoles);
  // }

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
