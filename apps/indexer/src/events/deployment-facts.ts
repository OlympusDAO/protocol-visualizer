import { createEffect, type EffectContext, S } from "envio";
import { type Address, type Hex, keccak256 } from "viem";
import deployments from "../generated/deployment-facts.json";
import { getPublicClient, rethrowTransientRpc } from "./rpc";

type DeploymentFactInput = {
  chainId: number;
  address: string;
  blockNumber: bigint;
  blockHash: string;
  // Only a complete, allowlisted zero-argument call with no caller/options is eligible.
  data?: string;
};

export type DeploymentFact = {
  codeHash: Hex;
  data?: Hex;
  verifiedAt: { number: string; hash: string; timestamp: string };
};

// This is a second check on a manually source-reviewed, exact runtime hash, not
// a general proxy detector. PUSH operands and the compiler's CBOR trailer are data.
function canChangeOwnCode(code: Hex): boolean {
  const bytes = Buffer.from(code.slice(2), "hex");
  const end = bytes.length - bytes.readUInt16BE(bytes.length - 2) - 2;
  if (end <= 0) return true;
  for (let offset = 0; offset < end; offset++) {
    const opcode = bytes.readUInt8(offset);
    if ([0xf2, 0xf4, 0xff].includes(opcode)) return true;
    if (opcode >= 0x60 && opcode <= 0x7f) offset += opcode - 0x5f;
  }
  return false;
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
      !canChangeOwnCode(runtime);
    if (!verified) context.cache = false;
    return verified;
  }
);

const readImmutableDeploymentCallEffect = createEffect(
  {
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
 * Prove one known ordinary deployment on the current branch, then reuse its
 * runtime/immutable bytes for its lifetime. No empty-code, unknown-runtime,
 * storage-getter, caller-specific or predeployment facts enter this cache.
 * A nonempty ordinary contract cannot become an EIP-7702 delegation designator;
 * the reviewed runtime has no code deletion or delegated execution instruction.
 */
export async function getDeploymentFact(
  context: Pick<EffectContext, "effect">,
  input: DeploymentFactInput
): Promise<DeploymentFact | undefined> {
  const deployment = deployments.find(
    (entry) =>
      entry.chainId === input.chainId &&
      entry.address === input.address.toLowerCase()
  );
  if (
    !deployment ||
    input.blockNumber < BigInt(deployment.creationBlock) ||
    !/^0x[0-9a-f]{64}$/i.test(input.blockHash) ||
    (input.data !== undefined &&
      !Object.hasOwn(deployment.immutableGetters, input.data.toLowerCase()))
  )
    return undefined;

  try {
    const client = getPublicClient(input.chainId);
    const creation = await client.getBlock({
      blockNumber: BigInt(deployment.creationBlock),
    });
    if (!creation.hash || !creation.parentHash) return undefined;
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
    // The deployment header was freshly read above. Recheck the requested
    // descendant after effects, including when persisted reads were cache hits.
    const requested = await client.getBlock({ blockNumber: input.blockNumber });
    if (requested.hash?.toLowerCase() !== input.blockHash.toLowerCase())
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
