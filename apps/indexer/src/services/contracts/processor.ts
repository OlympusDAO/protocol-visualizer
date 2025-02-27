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
      // It's not technically a JSON, due to some weird formatting that hasn't been cleaned up yet, but it's close enough
      // TODO clean up leading and trailing brackets
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
    return path.join(SOURCE_CODE_DIR, `${address}.json`);
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

  private findRoleFromModifier(
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

      if (constantDefinition && constantDefinition[1]) {
        console.log(
          `Found role with constant value ${constantDefinition[1]} for ${functionName}`
        );
        return [constantDefinition[1]];
      }
    }

    // Check for onlyAdmin, onlyEmergency, onlyAdminOrEmergency
    const onlyAdminMatch = functionDefinition.match(/onlyAdmin\(\)/);
    if (onlyAdminMatch) {
      console.log(`Found role with onlyAdmin for ${functionName}`);
      return ["admin"];
    }

    const onlyEmergencyMatch = functionDefinition.match(/onlyEmergency\(\)/);
    if (onlyEmergencyMatch) {
      console.log(`Found role with onlyEmergency for ${functionName}`);
      return ["emergency"];
    }

    const onlyAdminOrEmergencyMatch = functionDefinition.match(
      /onlyAdminOrEmergency\(\)/
    );
    if (onlyAdminOrEmergencyMatch) {
      console.log(`Found role with onlyAdminOrEmergency for ${functionName}`);
      return ["admin", "emergency"];
    }

    // If no constant found, try direct string values
    const directStringMatch = functionDefinition.match(
      /onlyRole\(\\?"([^"]*)\\"?\)/
    );
    if (directStringMatch && directStringMatch[1]) {
      console.log(
        `Found role with literal value ${directStringMatch[1]} for ${functionName}`
      );
      return [directStringMatch[1]];
    }

    return null;
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

      const role = this.findRoleFromModifier(
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
