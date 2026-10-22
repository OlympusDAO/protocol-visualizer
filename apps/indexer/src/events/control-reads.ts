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
  "config",
  "pool",
  "COOLER",
  "COOLERV2",
  "OHM",
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
    args?: readonly Address[];
  }) => Promise<unknown>;
};

/** Hash-bound reads stay on the same state even when the transport falls back to another provider. */
export async function readPinnedControlGetter(
  client: ControlReadClient,
  input: ControlGetterInput
): Promise<ControlGetterResult> {
  try {
    const [getter = "", token] = input.getter.split(":");
    const registryGetter =
      token &&
      /^0x[0-9a-fA-F]{40}$/.test(token) &&
      ["administrator", "newAdministrator", "getPool"].includes(getter);
    if (getter === "newOwner")
      return {
        status: "unavailable",
        reason:
          "Pending owner has no public getter; only replayed transfer requests establish the nominee.",
      };
    if (
      input.getter !== "isEnabled" &&
      !addressGetters.has(input.getter) &&
      !registryGetter
    )
      return { status: "unavailable", reason: "getter is not configured" };
    const before = await client.getBlock({ blockNumber: input.blockNumber });
    if (before.hash?.toLowerCase() !== input.blockHash.toLowerCase())
      return {
        status: "unavailable",
        reason: "canonical block hash changed before getter read",
      };
    let value = await client.readContract({
      address: input.address,
      abi: [
        {
          type: "function",
          name:
            registryGetter && getter !== "getPool" ? "getTokenConfig" : getter,
          inputs: registryGetter ? [{ name: "token", type: "address" }] : [],
          outputs: [
            registryGetter && getter !== "getPool"
              ? {
                  type: "tuple",
                  components: [
                    { name: "administrator", type: "address" },
                    { name: "pendingAdministrator", type: "address" },
                    { name: "tokenPool", type: "address" },
                  ],
                }
              : { type: input.getter === "isEnabled" ? "bool" : "address" },
          ],
          stateMutability: "view",
        },
      ],
      functionName:
        registryGetter && getter !== "getPool" ? "getTokenConfig" : getter,
      ...(registryGetter ? { args: [token as Address] } : {}),
      blockHash: input.blockHash as Hex,
      requireCanonical: true,
    });
    if (registryGetter && getter !== "getPool") {
      const index = getter === "administrator" ? 0 : 1;
      value = Array.isArray(value)
        ? value[index]
        : (value as Record<string, unknown>)?.[
            index === 0 ? "administrator" : "pendingAdministrator"
          ];
    }
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
