import { createEffect, S, type EffectContext } from "envio";
import { keccak256, type Address, type Hex } from "viem";
import { getPublicClient, rethrowTransientRpc } from "./rpc";
import { readVerifiedDeploymentCode } from "./deployment-state";
import type { CanonicalBlockReader } from "./deployment-facts";
import type { EntityStore } from "./types";

export type BytecodePin = {
  address: Address;
  blockHash: Hex;
  requireCanonical: true;
  blockNumber?: bigint;
};

export type BytecodeContext = Pick<EffectContext, "effect"> & {
  VerifiedDeployment?: Pick<EntityStore, "get" | "set">;
};

export const emptyCodeHash = keccak256("0x");

export const readBytecodeHashEffect = createEffect(
  {
    name: "readPinnedBytecodeHash",
    input: { chainId: S.number, address: S.address, blockHash: S.string },
    output: S.optional(S.string),
    rateLimit: { calls: 25, per: "second" },
    cache: true,
  },
  async ({ input, context }) => {
    try {
      const code = await getPublicClient(input.chainId).getCode({
        address: input.address,
        blockHash: input.blockHash as Hex,
        requireCanonical: true,
      });
      if (
        code !== undefined &&
        (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(code))
      )
        throw new Error("Invalid bytecode response");
      // viem represents a successful eth_getCode "0x" response as undefined.
      return keccak256(code ?? "0x");
    } catch (error) {
      rethrowTransientRpc(error);
      context.cache = false;
      return undefined;
    }
  }
);

export function getBytecodeHash(
  context: BytecodeContext,
  chainId: number,
  pin: BytecodePin,
  readCanonicalBlock?: CanonicalBlockReader
): Promise<Hex | undefined> {
  if (context.VerifiedDeployment && pin.blockNumber !== undefined)
    return readVerifiedDeploymentCode(
      context,
      chainId,
      { ...pin, blockNumber: pin.blockNumber },
      readCanonicalBlock
    );
  return readExactBytecodeHash(context, chainId, pin);
}

/** Native EffectContext and discovery retain exact block-hash effect semantics. */
export function readExactBytecodeHash(
  context: Pick<EffectContext, "effect">,
  chainId: number,
  pin: BytecodePin
): Promise<Hex | undefined> {
  return context.effect(readBytecodeHashEffect, {
    chainId,
    address: pin.address.toLowerCase() as Address,
    blockHash: pin.blockHash.toLowerCase(),
  }) as Promise<Hex | undefined>;
}
