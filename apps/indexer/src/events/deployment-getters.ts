import { type Address, type Hex, toFunctionSelector } from "viem";
import metadata from "../generated/contract-metadata.json";
import deployments from "../generated/deployment-facts.json";
import type { ProcessedContractData } from "../services/contracts/types";
import { emptyCodeHash, getBytecodeHash } from "./code-cache";
import type { ControlGetterInput, ControlGetterResult } from "./control-reads";
import { getDeploymentFact } from "./deployment-facts";
import { getPublicClient } from "./rpc";
import type { EnvioContext } from "./types";

export async function readDeploymentGetter(
  context: EnvioContext,
  input: ControlGetterInput
): Promise<ControlGetterResult | undefined> {
  const deployment = deployments.find(
    (d) =>
      d.chainId === input.chainId && d.address === input.address.toLowerCase()
  );
  if (!deployment || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input.getter))
    return undefined;
  const data = toFunctionSelector(`${input.getter}()`);
  if (!Object.hasOwn(deployment.immutableGetters, data)) return undefined;
  const contract = (
    metadata as Record<string, Record<string, ProcessedContractData>>
  )[input.chainId]?.[deployment.address];
  const functionContext = Object.values(contract?.functionSelectors ?? {}).find(
    (fn) => fn.canonicalSignature === `${input.getter}()`
  )?.documentation;
  if (functionContext?.source?.codeHash !== deployment.codeHash)
    return undefined;
  const fact = await getDeploymentFact(context, { ...input, data });
  if (!fact?.data) return undefined;
  const value = `0x${fact.data.slice(-40)}` as Address;
  // Immutable reference value does not prove the referenced contract's lifetime.
  const targetHash = await getBytecodeHash(context, input.chainId, {
    address: value,
    blockHash: input.blockHash as Hex,
    requireCanonical: true,
  });
  if (!targetHash)
    return {
      status: "unavailable",
      reason: "historical target code unavailable",
    };
  const after = await getPublicClient(input.chainId).getBlock({
    blockNumber: input.blockNumber,
  });
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
