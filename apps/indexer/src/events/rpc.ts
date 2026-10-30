import {
  createPublicClient,
  createTransport,
  http,
  type EIP1193RequestFn,
  type PublicClient,
  type Transport,
} from "viem";

const publicClients = new Map<number, PublicClient<Transport>>();

// One process-wide queue, including retries across chains. eRPC owns provider
// selection and provider budgets; these permits only bound proxy pressure.
let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < 8) active++;
  else {
    if (waiting.length >= 256) throw new RpcTransientFailure();
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  return () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
}

export class RpcTransientFailure extends Error {
  constructor() {
    super(
      "Indexer RPC temporarily unavailable: private proxy retry budget exhausted"
    );
    this.name = "RpcTransientFailure";
  }
}

function causes(error: unknown): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (
    let current = error;
    current && typeof current === "object" && values.length < 16;
  ) {
    const value = current as Record<string, unknown>;
    if (values.includes(value)) break;
    values.push(value);
    current = value.cause;
  }
  return values;
}

/** viem wraps transport exceptions; readers must not turn exhaustion into observations. */
export function rethrowTransientRpc(error: unknown): void {
  if (causes(error).some((cause) => cause.name === "RpcTransientFailure"))
    throw new RpcTransientFailure();
}

function classify(error: unknown) {
  const chain = causes(error);
  const rpc = [...chain]
    .reverse()
    .find((cause) => typeof cause.code === "number");
  const message = String(rpc?.message ?? "").toLowerCase();
  const data =
    typeof rpc?.data === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(rpc.data)
      ? rpc.data
      : undefined;
  const reverted =
    rpc?.code === 3 ||
    message.startsWith("execution reverted") ||
    Boolean(data && data !== "0x");
  const historical = chain.some((cause) => isHistoricalStateUnavailable(cause));
  const transient =
    !reverted &&
    !historical &&
    chain.some(
      (cause) =>
        [408, 429, 500, 502, 503, 504].includes(Number(cause.status)) ||
        [-32005, -32016, -32603].includes(Number(cause.code)) ||
        ["TimeoutError", "SocketClosedError"].includes(String(cause.name)) ||
        (cause.name === "HttpRequestError" && !cause.status)
    );
  const safeMessage = historical
    ? "historical state not available"
    : reverted
      ? message === "execution reverted"
        ? "execution reverted"
        : "execution reverted with details"
      : "RPC request failed";
  // Never retain the original cause, HTTP URL, request body or provider prose.
  const safe = Object.assign(new Error(safeMessage), {
    code: reverted ? 3 : Number(rpc?.code ?? -32000),
    ...(reverted ? { data } : {}),
  });
  return { transient, safe };
}

export function getPublicClient(chainId: number): PublicClient<Transport> {
  const cached = publicClients.get(chainId);
  if (cached) {
    return cached;
  }

  const url = process.env[`ENVIO_RPC_URL_${chainId}`];
  if (!url?.trim()) throw new Error(`Missing ENVIO_RPC_URL_${chainId}`);
  const client = createPublicClient({
    transport: (options) => {
      const proxy = http(url, { batch: true, retryCount: 0 })(options);
      return createTransport({
        key: "private-proxy",
        name: "Private RPC proxy",
        type: "http",
        retryCount: 0,
        request: (async (args: { method: string; params?: unknown }) => {
          for (let attempt = 0; ; attempt++) {
            const release = await acquire();
            try {
              return await proxy.request(args, { retryCount: 0 });
            } catch (error) {
              const { transient, safe } = classify(error);
              if (!transient) throw safe;
              if (attempt === 5) throw new RpcTransientFailure();
            } finally {
              release();
            }
            const delay = Math.min(250 * 2 ** attempt, 4000);
            await new Promise((resolve) =>
              setTimeout(resolve, delay * (0.75 + Math.random() * 0.5))
            );
          }
        }) as EIP1193RequestFn,
      });
    },
  });
  publicClients.set(chainId, client);

  return client;
}

export function isHistoricalStateUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("historical state") &&
    error.message.toLowerCase().includes("not available")
  );
}
