import { createEffect, S, type EffectContext } from "envio";
import {
  createPublicClient,
  createTransport,
  type Hex,
  type EIP1193RequestFn,
  type PublicClient,
  type Transport,
} from "viem";
import { getPublicClient } from "./rpc";

// Key the wire request, not an ABI/field name: tuple consumers decode separately.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return typeof value === "string" && /^0x[0-9a-f]*$/i.test(value)
    ? value.toLowerCase()
    : value;
}

export const readPinnedCallEffect = createEffect(
  {
    name: "readPinnedRawCall",
    input: { chainId: S.number, params: S.string },
    output: S.string,
    rateLimit: { calls: 35, per: "second" },
    cache: true,
  },
  async ({ input }) => {
    const result = await getPublicClient(input.chainId).request({
      method: "eth_call",
      params: JSON.parse(input.params),
    });
    if (typeof result !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(result))
      throw new Error("Invalid RPC call response");
    return result;
  }
);

export function getEffectClient(
  context: Pick<EffectContext, "effect">,
  chainId: number
): PublicClient<Transport> {
  return createPublicClient({
    transport: () =>
      createTransport({
        key: "effect-proxy",
        name: "Hash-bound RPC effects",
        type: "custom",
        retryCount: 0,
        request: (async (args: { method: string; params?: unknown }) => {
          const params = args.params as readonly unknown[] | undefined;
          const pin = params?.[1] as
            | { blockHash?: Hex; requireCanonical?: boolean }
            | undefined;
          if (
            args.method === "eth_call" &&
            pin?.requireCanonical === true &&
            /^0x[0-9a-f]{64}$/i.test(pin.blockHash ?? "")
          )
            return context.effect(readPinnedCallEffect, {
              chainId,
              params: JSON.stringify(canonical(params)),
            });
          return getPublicClient(chainId).transport.request(args);
        }) as EIP1193RequestFn,
      }),
  });
}
