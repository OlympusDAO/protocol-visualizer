import { type Address, type Hex, toFunctionSelector } from "viem";
import metadata from "../generated/contract-metadata.json";
import type { ProcessedContractData } from "../services/contracts/types";
import { emptyCodeHash, getBytecodeHash } from "./code-cache";
import type { ControlGetterInput, ControlGetterResult } from "./control-reads";
import {
  getDeploymentFact,
  getImmutableDeployment,
  type CanonicalBlockReader,
} from "./deployment-facts";
import { getPublicClient } from "./rpc";
import type { EnvioContext } from "./types";

export async function readDeploymentGetter(
  context: EnvioContext,
  input: ControlGetterInput,
  readCanonicalBlock: CanonicalBlockReader = (chainId, blockNumber) =>
    getPublicClient(chainId).getBlock({ blockNumber })
): Promise<ControlGetterResult | undefined> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.getter)) return undefined;
  const codeHash = context.VerifiedDeployment
    ? await getBytecodeHash(
        context,
        input.chainId,
        {
          address: input.address.toLowerCase() as Address,
          blockHash: input.blockHash as Hex,
          blockNumber: input.blockNumber,
          requireCanonical: true,
        },
        readCanonicalBlock
      )
    : undefined;
  const deployment = await getImmutableDeployment(context, input, codeHash);
  if (!deployment) return undefined;
  const data = toFunctionSelector(`${input.getter}()`);
  if (!Object.hasOwn(deployment.immutableGetters, data)) return undefined;
  const contract = (
    metadata as Record<string, Record<string, ProcessedContractData>>
  )[input.chainId]?.[deployment.address];
  const knownContext = Object.values(contract?.functionSelectors ?? {}).find(
    (fn) => fn.canonicalSignature === `${input.getter}()`
  )?.documentation;
  const functionContext =
    knownContext?.source?.codeHash === deployment.codeHash
      ? knownContext
      : {
          signature: `${input.getter}()`,
          source: {
            url: deployment.sourceUrl,
            codeHash: deployment.codeHash,
            match: "code" as const,
          },
        };
  const fact = await getDeploymentFact(
    context,
    { ...input, data },
    deployment,
    readCanonicalBlock
  );
  if (!fact?.data) return undefined;
  const value = `0x${fact.data.slice(-40)}` as Address;
  // Immutable reference value does not prove the referenced contract's lifetime.
  const targetHash = await getBytecodeHash(
    context,
    input.chainId,
    {
      address: value,
      blockHash: input.blockHash as Hex,
      blockNumber: input.blockNumber,
      requireCanonical: true,
    },
    readCanonicalBlock
  );
  if (!targetHash)
    return {
      status: "unavailable",
      reason: "historical target code unavailable",
    };
  const after = await readCanonicalBlock(input.chainId, input.blockNumber);
  if (after.hash?.toLowerCase() !== input.blockHash.toLowerCase())
    return {
      status: "unavailable",
      reason: "Canonical block changed during target code read",
    };
  return {
    status: "success",
    value,
    functionContext,
    targetCode: targetHash === emptyCodeHash ? "absent" : "present",
    verifiedAt: fact.verifiedAt,
  };
}
