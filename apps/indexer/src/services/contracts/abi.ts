import {
  toFunctionSelector,
  toFunctionSignature,
  keccak256,
  type Hex,
  type Abi,
} from "viem";
import type { ProcessedContractData } from "./types";
import type { FunctionContext } from "../../../../../packages/snapshot-artifacts/src/index";

type CompilerDocs = {
  userdoc?: { methods?: Record<string, { notice?: string }> };
  devdoc?: {
    methods?: Record<
      string,
      {
        details?: string;
        params?: Record<string, string>;
        returns?: Record<string, string>;
      }
    >;
  };
};

/** Compiler method keys resolve overloads, public getters and inherited NatSpec. */
export function processAbiMetadata(
  abi: Abi,
  docs?: CompilerDocs,
  source?: FunctionContext["source"]
): ProcessedContractData {
  const exactDocs = source?.match === "exact" ? docs : undefined;
  const result: ProcessedContractData = {
    roleToFunctions: {},
    functionSelectors: {},
    addressGetters: [],
  };
  for (const item of abi) {
    if (item.type !== "function") continue;
    const canonicalSignature = toFunctionSignature(item);
    const selector = toFunctionSelector(item);
    const notice = exactDocs?.userdoc?.methods?.[canonicalSignature]?.notice;
    const devdoc = exactDocs?.devdoc?.methods?.[canonicalSignature];
    result.functionSelectors[selector] = {
      name: item.name,
      selector,
      canonicalSignature,
      signature: `${item.name}(${item.inputs.map((input) => input.type).join(",")})(${item.outputs.map((output) => output.type).join(",")})`,
      roles: [],
      ...(source
        ? {
            documentation: {
              signature: canonicalSignature,
              ...(notice ? { notice } : {}),
              ...devdoc,
              source,
            },
          }
        : {}),
    };
    if (
      ["view", "pure"].includes(item.stateMutability) &&
      !item.inputs.length &&
      item.outputs.length === 1 &&
      item.outputs[0]?.type === "address"
    )
      result.addressGetters?.push(item.name);
  }
  return result;
}

export function processVerifiedContractMetadata(
  verified: {
    chainId?: string | number;
    address?: string;
    runtimeMatch?: string;
    runtimeBytecode?: { onchainBytecode?: Hex };
    metadata?: { output?: CompilerDocs & { abi?: Abi } };
  },
  chainId: string | number,
  address: string,
  previous?: ProcessedContractData
): ProcessedContractData {
  if (
    String(verified.chainId) !== String(chainId) ||
    verified.address?.toLowerCase() !== address.toLowerCase() ||
    !["match", "exact_match"].includes(verified.runtimeMatch ?? "") ||
    !verified.runtimeBytecode?.onchainBytecode ||
    !Array.isArray(verified.metadata?.output?.abi)
  )
    throw new Error(
      "Verified source does not match the requested deployed contract"
    );
  const processed = processAbiMetadata(
    verified.metadata.output.abi,
    verified.metadata.output,
    {
      url: `https://sourcify.dev/server/v2/contract/${chainId}/${address.toLowerCase()}?fields=metadata`,
      codeHash: keccak256(verified.runtimeBytecode.onchainBytecode),
      match: verified.runtimeMatch === "exact_match" ? "exact" : "code",
    }
  );
  for (const [selector, details] of Object.entries(processed.functionSelectors))
    details.roles = previous?.functionSelectors?.[selector]?.roles ?? [];
  processed.roleToFunctions = previous?.roleToFunctions ?? {};
  return processed;
}
