import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import {
  getFunctionSelector,
  AbiFunction,
  AbiParameter,
  Abi,
  toFunctionSelector,
} from "viem";
import { ContractCache, ProcessedContractData, FunctionDetails } from "./types";
import { EtherscanApi } from "../etherscan/api";
import path from "path";
// import { RoleExtractor } from './role-extractor';

const CACHE_FILE = "./data/contract-cache.json";
const ABI_DIR = "./data/abis";
const SOURCE_CODE_DIR = "./data/source-code";
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
    // Ensure source code directory exists
    if (!existsSync(SOURCE_CODE_DIR)) {
      mkdirSync(SOURCE_CODE_DIR, { recursive: true });
    }
  }

  async processContract(
    address: string,
    name: string
  ): Promise<ProcessedContractData> {
    // Check cache first
    if (
      this.cache[address] &&
      Date.now() - this.cache[address].lastFetched < CACHE_DURATION &&
      existsSync(this.getAbiPath(address))
    ) {
      console.log(`CACHE HIT for ${name}`);
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

    console.log(`Processing ABI for ${name}`);
    const processedData = this.processAbi(abi);

    // Check if the source code exists on disk
    let sourceCode;
    const sourceCodePath = this.getSourceCodePath(address);
    if (existsSync(sourceCodePath)) {
      sourceCode = readFileSync(sourceCodePath, "utf-8");
    } else {
      // Fetch and save source code if it doesn't exist
      sourceCode = await this.etherscanApi.getContractSourceCode(address);
      writeFileSync(sourceCodePath, sourceCode);
    }

    console.log(`Processing source code for ${name}`);
    const processedContractData = this.processSourceCode(
      sourceCode,
      processedData
    );

    // Update cache
    this.cache[address] = {
      processedData: processedContractData,
      lastFetched: Date.now(),
    };
    this.saveCache();

    return processedData;
  }

  private getAbiPath(address: string): string {
    return path.join(ABI_DIR, `${address}.json`);
  }

  private getSourceCodePath(address: string): string {
    return path.join(SOURCE_CODE_DIR, `${address}.sol`);
  }

  private processAbi(abi: Abi): ProcessedContractData {
    // const roles = this.roleExtractor.extractRoles(abi);
    // const parsedAbi = parseAbi(abi);

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

  private processSourceCode(
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
      // Check if the function uses the onlyRole modifier
      // TODO handle constants
      // TODO onlyAdmin, onlyEmergency, onlyAdminOrEmergency
      const onlyRoleMatch = functionDefinition[0].match(
        /onlyRole\(\\?"([^"]*)\\"?\)/
      );
      if (!onlyRoleMatch) {
        continue;
      }

      const role = onlyRoleMatch[1];
      if (!role) {
        throw new Error(
          `Expected to find a role in the onlyRole modifier for function ${functionName}`
        );
      }

      console.log(`Function ${functionName} has role ${role}`);

      // Add the role to the function details
      functionDetails.roles.push(role);
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
