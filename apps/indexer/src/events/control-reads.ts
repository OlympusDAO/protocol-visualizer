import type { Abi, Address, Hex } from "viem";

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
const addressGetters = new Set([
  "owner",
  "authority",
  "governor",
  "newGovernor",
  "guardian",
  "newGuardian",
  "policy",
  "newPolicy",
  "vault",
  "newVault",
  "approved",
  "stakingContract",
]);
type ControlReadClient = {
  getBlock: (input: { blockNumber: bigint }) => Promise<{ hash: Hex | null }>;
  readContract: (input: {
    address: Address;
    abi: Abi;
    functionName: string;
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
    if (input.getter !== "isEnabled" && !addressGetters.has(input.getter))
      return { status: "unavailable", reason: "getter is not configured" };
    const before = await client.getBlock({ blockNumber: input.blockNumber });
    if (before.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return {
        status: "unavailable",
        reason: "canonical block hash changed before getter read",
      };
    const value = await client.readContract({
      address: input.address,
      abi: [
        {
          type: "function",
          name: input.getter,
          inputs: [],
          outputs: [
            { type: input.getter === "isEnabled" ? "bool" : "address" },
          ],
          stateMutability: "view",
        },
      ],
      functionName: input.getter,
      blockHash: input.blockHash as Hex,
      requireCanonical: true,
    });
    const after = await client.getBlock({ blockNumber: input.blockNumber });
    if (after.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return {
        status: "unavailable",
        reason: "canonical block hash changed during getter read",
      };
    if (
      input.getter === "isEnabled"
        ? typeof value !== "boolean"
        : typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    )
      return {
        status: "unavailable",
        reason: "getter returned an unexpected value",
      };
    return { status: "success", value: String(value).toLowerCase() };
  } catch {
    return {
      status: "unavailable",
      reason: "historical getter read unavailable",
    };
  }
}
