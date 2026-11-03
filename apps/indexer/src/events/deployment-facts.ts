import { createEffect, type EffectContext, S } from "envio";
import { type Address, type Hex, keccak256 } from "viem";
import metadata from "../generated/contract-metadata.json";
import type {
  ImmutableDeployment,
  OrdinaryDeployment,
  ProcessedContractData,
} from "../services/contracts/types";
import {
  fetchVerifiedContract,
  processVerifiedContractMetadata,
} from "../services/contracts/abi";
import { ordinaryRuntime } from "../services/contracts/immutables";
import { emptyCodeHash, readExactBytecodeHash } from "./code-cache";
import { getPublicClient, rethrowTransientRpc } from "./rpc";

export type DeploymentFactInput = {
  chainId: number;
  address: string;
  blockNumber: bigint;
  blockHash: string;
  // Only a complete, allowlisted zero-argument call with no caller/options is eligible.
  data?: string;
};

export type CanonicalBlockReader = (
  chainId: number,
  blockNumber: bigint
) => Promise<{
  hash?: string | null;
  parentHash?: string;
  timestamp?: bigint;
}>;

export type DeploymentFact = {
  codeHash: Hex;
  data?: Hex;
  verifiedAt: { number: string; hash: string; timestamp: string };
};

const discoverDeploymentEffect = createEffect(
  {
    crossChain: true,
    name: "discoverVerifiedOrdinaryDeploymentV2",
    input: { chainId: S.number, address: S.address, codeHash: S.string },
    output: S.optional(S.string),
    rateLimit: { calls: 5, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    try {
      const verified = await fetchVerifiedContract(
        input.chainId,
        input.address
      );
      const processed = processVerifiedContractMetadata(
        verified,
        input.chainId,
        input.address
      );
      if (
        !verified.runtimeBytecode?.onchainBytecode ||
        keccak256(verified.runtimeBytecode.onchainBytecode) !== input.codeHash
      ) {
        context.cache = false;
        return undefined;
      }
      const provenIneligible =
        (verified.runtimeBytecode.immutableReferences &&
          processed.ordinaryDeployment &&
          Object.keys(verified.runtimeBytecode.immutableReferences).length ===
            0) ||
        !ordinaryRuntime(verified.runtimeBytecode.onchainBytecode) ||
        verified.proxyResolution?.isProxy === true;
      if (!processed.immutableDeployment && !provenIneligible)
        context.cache = false;
      if (
        !processed.ordinaryDeployment &&
        !processed.immutableDeployment &&
        !provenIneligible
      )
        return undefined;
      return JSON.stringify({
        ordinaryDeployment: processed.ordinaryDeployment,
        immutableDeployment: processed.immutableDeployment,
      });
    } catch {
      context.cache = false;
      return undefined;
    }
  }
);

export async function getImmutableDeployment(
  context: Pick<EffectContext, "effect">,
  input: DeploymentFactInput,
  observedCodeHash?: Hex
): Promise<ImmutableDeployment | undefined> {
  const precomputed = (
    metadata as Record<string, Record<string, ProcessedContractData>>
  )[input.chainId]?.[input.address.toLowerCase()]?.immutableDeployment;
  if (precomputed) return precomputed;
  return (await discoverDeployment(context, input, observedCodeHash))
    ?.immutableDeployment;
}

export async function getOrdinaryDeployment(
  context: Pick<EffectContext, "effect">,
  input: DeploymentFactInput,
  observedCodeHash?: Hex
): Promise<OrdinaryDeployment | undefined> {
  const precomputed = (
    metadata as Record<string, Record<string, ProcessedContractData>>
  )[input.chainId]?.[input.address.toLowerCase()];
  if (precomputed?.ordinaryDeployment) return precomputed.ordinaryDeployment;
  if (precomputed?.immutableDeployment) return precomputed.immutableDeployment;
  return (await discoverDeployment(context, input, observedCodeHash))
    ?.ordinaryDeployment;
}

async function discoverDeployment(
  context: Pick<EffectContext, "effect">,
  input: DeploymentFactInput,
  observedCodeHash?: Hex
): Promise<
  | {
      ordinaryDeployment?: OrdinaryDeployment;
      immutableDeployment?: ImmutableDeployment;
    }
  | undefined
> {
  if (!/^0x[0-9a-f]{64}$/i.test(input.blockHash)) return undefined;
  try {
    // This exact observation must never recurse through lifetime discovery.
    const codeHash =
      observedCodeHash ??
      (await readExactBytecodeHash(context, input.chainId, {
        address: input.address.toLowerCase() as Address,
        blockHash: input.blockHash as Hex,
        requireCanonical: true,
      }));
    if (!codeHash || codeHash === emptyCodeHash) return undefined;
    const encoded = await context.effect(discoverDeploymentEffect, {
      chainId: input.chainId,
      address: input.address.toLowerCase() as Address,
      codeHash,
    });
    return encoded ? (JSON.parse(encoded) ?? undefined) : undefined;
  } catch (error) {
    rethrowTransientRpc(error);
    return undefined;
  }
}

const deploymentIdentity = {
  chainId: S.number,
  address: S.address,
  creationHash: S.string,
  codeHash: S.string,
  version: S.string,
};

const verifyDeploymentEffect = createEffect(
  {
    crossChain: true,
    name: "verifyStaticDeployment",
    input: { ...deploymentIdentity, priorHash: S.string },
    output: S.boolean,
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    const client = getPublicClient(input.chainId);
    const [previousCode, runtime] = await Promise.all(
      [input.priorHash, input.creationHash].map((blockHash) =>
        client.getCode({
          address: input.address,
          blockHash: blockHash as Hex,
          requireCanonical: true,
        })
      )
    );
    // viem represents an actual successful "0x" getCode response as undefined.
    const verified =
      (previousCode === undefined || previousCode === "0x") &&
      typeof runtime === "string" &&
      /^0x(?:[0-9a-f]{2})+$/i.test(runtime) &&
      keccak256(runtime) === input.codeHash &&
      ordinaryRuntime(runtime);
    if (!verified) context.cache = false;
    return verified;
  }
);

const readImmutableDeploymentCallEffect = createEffect(
  {
    crossChain: true,
    name: "readImmutableDeploymentCall",
    input: { ...deploymentIdentity, data: S.string },
    output: S.optional(S.string),
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    const result = await getPublicClient(input.chainId).call({
      to: input.address,
      data: input.data as Hex,
      blockHash: input.creationHash as Hex,
      requireCanonical: true,
    });
    // The source allowlist currently contains only public immutable addresses.
    if (!result.data || !/^0x0{24}[0-9a-f]{40}$/i.test(result.data)) {
      context.cache = false;
      return undefined;
    }
    return result.data.toLowerCase();
  }
);

/**
 * Prove an automatically discovered ordinary deployment on the current branch, then reuse its
 * runtime/immutable bytes for its lifetime. No empty-code, unknown-runtime,
 * storage-getter, caller-specific or predeployment facts enter this cache.
 * A nonempty ordinary contract cannot become an EIP-7702 delegation designator;
 * the compiler-bound runtime has no code deletion or delegated execution instruction.
 */
export async function getDeploymentFact(
  context: Pick<EffectContext, "effect">,
  input: DeploymentFactInput,
  resolved?: OrdinaryDeployment,
  readCanonicalBlock: CanonicalBlockReader = (chainId, blockNumber) =>
    getPublicClient(chainId).getBlock({ blockNumber })
): Promise<DeploymentFact | undefined> {
  const deployment = resolved ?? (await getImmutableDeployment(context, input));
  if (
    !deployment ||
    deployment.chainId !== input.chainId ||
    deployment.address.toLowerCase() !== input.address.toLowerCase() ||
    input.blockNumber < BigInt(deployment.creationBlock) ||
    !/^0x[0-9a-f]{64}$/i.test(input.blockHash) ||
    (input.data !== undefined &&
      (!("immutableGetters" in deployment) ||
        !Object.hasOwn(
          deployment.immutableGetters as Record<string, string>,
          input.data.toLowerCase()
        )))
  )
    return undefined;

  try {
    const before = await readCanonicalBlock(input.chainId, input.blockNumber);
    if (before.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return undefined;
    const creation = await readCanonicalBlock(
      input.chainId,
      BigInt(deployment.creationBlock)
    );
    if (
      !creation.hash ||
      !creation.parentHash ||
      creation.timestamp === undefined
    )
      return undefined;
    const identity = {
      chainId: input.chainId,
      address: deployment.address as Address,
      creationHash: creation.hash.toLowerCase(),
      codeHash: deployment.codeHash,
      version: deployment.version,
    };
    if (
      !(await context.effect(verifyDeploymentEffect, {
        ...identity,
        priorHash: creation.parentHash.toLowerCase(),
      }))
    )
      return undefined;

    const data =
      input.data === undefined
        ? undefined
        : await context.effect(readImmutableDeploymentCallEffect, {
            ...identity,
            data: input.data.toLowerCase(),
          });
    if (input.data !== undefined && !data) return undefined;
    // Both anchors must remain canonical after effects, including persisted hits.
    const [creationAfter, requested] = await Promise.all([
      readCanonicalBlock(input.chainId, BigInt(deployment.creationBlock)),
      readCanonicalBlock(input.chainId, input.blockNumber),
    ]);
    if (
      creationAfter.hash?.toLowerCase() !== identity.creationHash ||
      requested.hash?.toLowerCase() !== input.blockHash.toLowerCase()
    )
      return undefined;

    return {
      codeHash: deployment.codeHash as Hex,
      ...(data ? { data: data as Hex } : {}),
      verifiedAt: {
        number: deployment.creationBlock,
        hash: identity.creationHash,
        timestamp: creation.timestamp.toString(),
      },
    };
  } catch (error) {
    rethrowTransientRpc(error);
    return undefined;
  }
}
