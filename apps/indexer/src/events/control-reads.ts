import type { Address, Hex } from "viem";

export type ControlGetterInput = {
  chainId: number;
  address: Address;
  blockNumber: bigint;
  blockHash: string;
  getter: string;
};
export type ControlGetterResult =
  | { status: "success"; value: string }
  | { status: "unavailable"; reason: string };
const enabledAbi = [
  {
    type: "function",
    name: "isEnabled",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
] as const;
type ControlReadClient = {
  getBlock: (input: { blockNumber: bigint }) => Promise<{ hash: Hex | null }>;
  readContract: (input: {
    address: Address;
    abi: typeof enabledAbi;
    functionName: "isEnabled";
    blockHash: Hex;
    requireCanonical: true;
  }) => Promise<unknown>;
};

/** Hash-bound reads stay on the same state even when the transport falls back to another provider. */
export async function readPinnedControlGetter(
  client: ControlReadClient,
  input: ControlGetterInput
): Promise<ControlGetterResult> {
  try {
    if (input.getter !== "isEnabled")
      return { status: "unavailable", reason: "getter is not configured" };
    const before = await client.getBlock({ blockNumber: input.blockNumber });
    if (before.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return {
        status: "unavailable",
        reason: "canonical block hash changed before getter read",
      };
    const value = await client.readContract({
      address: input.address,
      abi: enabledAbi,
      functionName: "isEnabled",
      blockHash: input.blockHash as Hex,
      requireCanonical: true,
    });
    const after = await client.getBlock({ blockNumber: input.blockNumber });
    if (after.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return {
        status: "unavailable",
        reason: "canonical block hash changed during getter read",
      };
    if (typeof value !== "boolean")
      return {
        status: "unavailable",
        reason: "isEnabled did not return a boolean",
      };
    return { status: "success", value: String(value) };
  } catch {
    return {
      status: "unavailable",
      reason: "historical getter read unavailable",
    };
  }
}
