import { keccak256, type Abi, type Address, type Hex } from "viem";
import type {
  BridgeConfiguration,
  BridgeRateLimit,
  BridgeRoute,
} from "../../../../packages/snapshot-artifacts/src/index";
import type { BridgeReadResult } from "./bridge-config";
import externalChains from "../../../../packages/protocol-config/ccip-external-chains.json";

type Client = {
  getBlock: (input: { blockNumber: bigint }) => Promise<{ hash: Hex | null }>;
  getCode: (input: {
    address: Address;
    blockHash: Hex;
    requireCanonical: true;
  }) => Promise<Hex | undefined>;
  readContract: (input: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
    blockHash: Hex;
    requireCanonical: true;
  }) => Promise<unknown>;
};
const address = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value))
    throw new Error("Invalid address");
  return value.toLowerCase();
};
const bytes = (value: unknown) => {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(value))
    throw new Error("Invalid bytes");
  return value.toLowerCase();
};
const tuple = (value: unknown, keys: string[]): unknown[] =>
  Array.isArray(value)
    ? value
    : keys.map((key) => (value as Record<string, unknown>)[key]);
const rateLimit = (value: unknown): BridgeRateLimit => {
  const [, , enabled, capacity, rate] = tuple(value, [
    "tokens",
    "lastUpdated",
    "isEnabled",
    "capacity",
    "rate",
  ]);
  if (
    typeof enabled !== "boolean" ||
    typeof capacity !== "bigint" ||
    typeof rate !== "bigint"
  )
    throw new Error("Invalid rate limit");
  return { isEnabled: enabled, capacity: String(capacity), rate: String(rate) };
};
const bucket = [
  { name: "tokens", type: "uint128" },
  { name: "lastUpdated", type: "uint32" },
  { name: "isEnabled", type: "bool" },
  { name: "capacity", type: "uint128" },
  { name: "rate", type: "uint128" },
];

/** All calls, including router support, read one canonical block. No latest-state fallback. */
export async function readPinnedBridgeConfiguration(
  client: Client,
  input: {
    address: string;
    kind: "pool" | "bridge";
    blockNumber: bigint;
    blockHash: string;
    selectors: string[];
  }
): Promise<BridgeReadResult> {
  try {
    const pin = {
      blockHash: input.blockHash as Hex,
      requireCanonical: true as const,
    };
    if (
      (await client.getBlock({ blockNumber: input.blockNumber })).hash !==
      input.blockHash
    )
      throw new Error("Canonical block changed");
    const code = await client.getCode({
      address: input.address as Address,
      ...pin,
    });
    if (!code || code === "0x") throw new Error("Contract is not deployed");
    const read = (
      target: string,
      name: string,
      output: string,
      selector?: string,
      components?: { name: string; type: string }[]
    ) =>
      client.readContract({
        address: target as Address,
        ...pin,
        functionName: name,
        abi: [
          {
            type: "function",
            name,
            stateMutability: "view",
            inputs: selector ? [{ type: "uint64" }] : [],
            outputs: [{ type: output, ...(components ? { components } : {}) }],
          },
        ],
        ...(selector ? { args: [BigInt(selector)] } : {}),
      });
    const router = address(await read(input.address, "getRouter", "address"));
    const token = address(
      await read(
        input.address,
        input.kind === "pool" ? "getToken" : "OHM",
        "address"
      )
    );
    let allowList: string[] | null = null;
    let selectors = input.selectors;
    if (input.kind === "pool") {
      selectors = (
        (await read(
          input.address,
          "getSupportedChains",
          "uint64[]"
        )) as bigint[]
      ).map(String);
      const enabled = await read(input.address, "getAllowListEnabled", "bool");
      if (typeof enabled !== "boolean")
        throw new Error("Invalid allowlist state");
      if (enabled)
        allowList = (
          (await read(input.address, "getAllowList", "address[]")) as unknown[]
        )
          .map(address)
          .sort();
    }
    const routes: BridgeRoute[] = [];
    for (const selector of [...new Set(selectors)].sort()) {
      let routerSupported: boolean | null = null;
      try {
        const supported = await read(
          router,
          "isChainSupported",
          "bool",
          selector
        );
        if (typeof supported === "boolean") routerSupported = supported;
      } catch {
        /* Router coverage stays unknown. */
      }
      if (input.kind === "pool") {
        routes.push({
          selector,
          routerSupported,
          remoteToken: bytes(
            await read(input.address, "getRemoteToken", "bytes", selector)
          ),
          remotePools: (
            (await read(
              input.address,
              "getRemotePools",
              "bytes[]",
              selector
            )) as unknown[]
          )
            .map(bytes)
            .sort(),
          outbound: rateLimit(
            await read(
              input.address,
              "getCurrentOutboundRateLimiterState",
              "tuple",
              selector,
              bucket
            )
          ),
          inbound: rateLimit(
            await read(
              input.address,
              "getCurrentInboundRateLimiterState",
              "tuple",
              selector,
              bucket
            )
          ),
        });
      } else {
        const svm = externalChains.some(
          (chain) => chain.selector === selector && chain.family === "svm"
        );
        const [remote, isSet] = tuple(
          await read(
            input.address,
            svm ? "getTrustedRemoteSVM" : "getTrustedRemoteEVM",
            "tuple",
            selector,
            [
              { name: "remoteAddress", type: svm ? "bytes32" : "address" },
              { name: "isSet", type: "bool" },
            ]
          ),
          ["remoteAddress", "isSet"]
        );
        if (typeof isSet !== "boolean")
          throw new Error("Invalid trusted remote");
        routes.push({
          selector,
          routerSupported,
          trustedRemote: isSet ? (svm ? bytes(remote) : address(remote)) : null,
        });
      }
    }
    if (
      (await client.getBlock({ blockNumber: input.blockNumber })).hash !==
      input.blockHash
    )
      throw new Error("Canonical block changed");
    const configuration: NonNullable<BridgeConfiguration["configuration"]> = {
      token,
      router,
      codeHash: keccak256(code),
      routes,
      allowList,
    };
    return { status: "success", value: JSON.stringify(configuration) };
  } catch {
    return {
      status: "unavailable",
      reason: "Bridge configuration could not be read at the canonical block.",
    };
  }
}
