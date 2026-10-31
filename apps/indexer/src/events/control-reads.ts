import { rethrowTransientRpc } from "./rpc";
import { keccak256, type Abi, type Address, type Hex } from "viem";
import metadata from "../generated/contract-metadata.json";
import type { ProcessedContractData } from "../services/contracts/types";
import type { FunctionContext } from "../../../../packages/snapshot-artifacts/src/index";
import { emptyCodeHash, type BytecodePin } from "./code-cache";
import type { ControlBlock } from "./control-state";

export type ControlGetterInput = {
  chainId: number;
  address: Address;
  blockNumber: bigint;
  blockHash: string;
  getter: string;
};
export type ControlGetterResult =
  | {
      status: "success";
      value: string;
      functionContext?: FunctionContext;
      targetCode?: "present" | "absent";
      verifiedAt?: ControlBlock;
    }
  | { status: "unavailable"; reason: string };
const addressGetters = new Set([
  "DEPOSIT_MANAGER",
  "migrator",
  "sFrom",
  "sTo",
  "from",
  "to",
  "getSReserve",
  "getReserve",
  "auctioneer",
  "callback",
  "ohm",
  "sReserve",
  "reserve",
  "cdAuctioneer",
  "bondAuctioneer",
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
  getCode?: (input: {
    address: Address;
    blockHash: Hex;
    requireCanonical: true;
  }) => Promise<Hex | undefined>;
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
async function readControlGetter(
  client: ControlReadClient,
  input: ControlGetterInput,
  contract: ProcessedContractData | undefined = (
    metadata as Record<string, Record<string, ProcessedContractData>>
  )[String(input.chainId)]?.[input.address.toLowerCase()],
  readCodeHash: (pin: BytecodePin) => Promise<Hex | undefined> = async (pin) =>
    client.getCode ? keccak256((await client.getCode(pin)) ?? "0x") : undefined,
  mode: "observation" | "fact" = "observation"
): Promise<ControlGetterResult> {
  const canonical =
    mode === "observation"
      ? async () =>
          (
            await client.getBlock({ blockNumber: input.blockNumber })
          ).hash?.toLowerCase() === input.blockHash.toLowerCase()
      : undefined;
  try {
    const [getter = "", token] = input.getter.split(":");
    const metadataGetter =
      token && ["administrator", "newAdministrator"].includes(getter)
        ? "getTokenConfig"
        : getter;
    const functionContext = Object.values(
      contract?.functionSelectors ?? {}
    ).find(
      (fn) =>
        fn.canonicalSignature === `${metadataGetter}(${token ? "address" : ""})`
    )?.documentation;

    const generic = Boolean(
      functionContext?.source &&
        contract?.addressGetters?.includes(input.getter)
    );

    const registryGetter =
      token &&
      /^0x[0-9a-fA-F]{40}$/.test(token) &&
      ["administrator", "newAdministrator", "getPool"].includes(getter);
    const periodicTasks = getter === "getPeriodicTasks";
    const booleanGetter = [
      "isEnabled",
      "locallyActive",
      "active",
      "isShutdown",
    ].includes(getter);
    if (getter === "newOwner" && !generic)
      return {
        status: "unavailable",
        reason:
          "Pending owner has no public getter; only replayed transfer requests establish the nominee.",
      };
    if (
      !booleanGetter &&
      !periodicTasks &&
      !addressGetters.has(input.getter) &&
      !generic &&
      !registryGetter
    )
      return { status: "unavailable", reason: "getter is not configured" };
    if (canonical && !(await canonical()))
      return {
        status: "unavailable",
        reason: "canonical block hash changed before getter read",
      };
    if (functionContext?.source) {
      const codeHash = await readCodeHash({
        address: input.address,
        blockHash: input.blockHash as Hex,
        requireCanonical: true,
      });
      if (!codeHash || codeHash !== functionContext.source.codeHash)
        return {
          status: "unavailable",
          reason:
            "Verified compiler documentation does not match bytecode at the canonical block",
        };
    }
    let value = await client.readContract({
      address: input.address,
      abi: [
        {
          type: "function",
          name:
            registryGetter && getter !== "getPool" ? "getTokenConfig" : getter,
          inputs: registryGetter ? [{ name: "token", type: "address" }] : [],
          outputs: periodicTasks
            ? [{ type: "address[]" }, { type: "bytes4[]" }]
            : [
                registryGetter && getter !== "getPool"
                  ? {
                      type: "tuple",
                      components: [
                        { name: "administrator", type: "address" },
                        { name: "pendingAdministrator", type: "address" },
                        { name: "tokenPool", type: "address" },
                      ],
                    }
                  : { type: booleanGetter ? "bool" : "address" },
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
    if (canonical && !(await canonical()))
      return {
        status: "unavailable",
        reason: "canonical block hash changed during getter read",
      };
    if (periodicTasks) {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Array.isArray(value[0]) ||
        !Array.isArray(value[1]) ||
        value[0].length !== value[1].length ||
        value[0].some(
          (address) =>
            typeof address !== "string" ||
            !/^0x[0-9a-fA-F]{40}$/.test(address) ||
            /^0x0{40}$/i.test(address)
        ) ||
        value[1].some(
          (selector) =>
            typeof selector !== "string" || !/^0x[0-9a-fA-F]{8}$/.test(selector)
        )
      )
        return {
          status: "unavailable",
          reason: "periodic task getter returned an unexpected value",
        };
      const selectors = value[1];
      return {
        status: "success",
        value: JSON.stringify(
          value[0].map((address: string, index: number) => ({
            address: address.toLowerCase(),
            selector: selectors[index].toLowerCase(),
          }))
        ),
      };
    }
    if (
      booleanGetter
        ? typeof value !== "boolean"
        : typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)
    )
      return {
        status: "unavailable",
        reason: "getter returned an unexpected value",
      };
    let targetCode: "present" | "absent" | undefined;
    if (mode === "observation" && generic && typeof value === "string") {
      const codeHash = await readCodeHash({
        address: value as Address,
        blockHash: input.blockHash as Hex,
        requireCanonical: true,
      });
      if (!codeHash)
        return {
          status: "unavailable",
          reason: "historical code read unavailable",
        };
      targetCode = codeHash === emptyCodeHash ? "absent" : "present";
      if (canonical && !(await canonical()))
        return {
          status: "unavailable",
          reason: "canonical block hash changed during code read",
        };
    }
    return {
      status: "success",
      value: String(value).toLowerCase(),
      ...(functionContext ? { functionContext } : {}),
      ...(targetCode ? { targetCode } : {}),
    };
  } catch (error) {
    rethrowTransientRpc(error);
    return {
      status: "unavailable",
      reason: "historical getter read unavailable",
    };
  }
}

/** Standalone observations check canonicality around every read and target lookup. */
export function readPinnedControlGetter(
  client: ControlReadClient,
  input: ControlGetterInput,
  contract?: ProcessedContractData,
  readCodeHash?: (pin: BytecodePin) => Promise<Hex | undefined>
): Promise<ControlGetterResult> {
  return readControlGetter(client, input, contract, readCodeHash);
}

/** Persisted hash-bound facts require canonical acceptance by their outer reader. */
export function readHashBoundControlGetter(
  client: ControlReadClient,
  input: ControlGetterInput,
  contract?: ProcessedContractData,
  readCodeHash?: (pin: BytecodePin) => Promise<Hex | undefined>
): Promise<ControlGetterResult> {
  return readControlGetter(client, input, contract, readCodeHash, "fact");
}
