import { setTimeout as sleep } from "node:timers/promises";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  decodeAbiParameters,
  ExecutionRevertedError,
  getAddress,
  http,
  toFunctionSelector,
} from "viem";
import { SourceUnavailableError } from "./registry.mjs";

const REQUEST_TIMEOUT_MS = 20_000;

// EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1).
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const VERSION_SELECTOR = toFunctionSelector("VERSION()");

// Olympus contracts return VERSION() as (uint8 major, uint8 minor). Some
// return one number or a string. The size of the return data tells them
// apart: a string starts with the offset 0x20 and has 3 or more words.
export function decodeVersion(data) {
  if (!data || data === "0x") return null;
  const size = (data.length - 2) / 2;
  const word = (index) =>
    BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
  if (size >= 96 && word(0) === 32n) {
    try {
      const [value] = decodeAbiParameters([{ type: "string" }], data);
      return value || null;
    } catch {
      return null;
    }
  }
  if (size === 64 && word(0) < 256n && word(1) < 256n) {
    return `${word(0)}.${word(1)}`;
  }
  if (size === 32) return `${word(0)}`;
  return null;
}

const isActiveAbi = [
  {
    type: "function",
    name: "isActive",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
];

const githubHeaders = (accept) => ({
  accept,
  ...(process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
});

export async function latestEnvRef({ repo, branch }) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits/${branch}`,
    {
      headers: githubHeaders("application/vnd.github.sha"),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub returned HTTP ${response.status} for ${repo}@${branch}`
    );
  }
  return (await response.text()).trim();
}

export async function fetchEnv({ repo, path, ref }) {
  const response = await fetch(
    `https://raw.githubusercontent.com/${repo}/${ref}/${path}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub returned HTTP ${response.status} for ${repo}/${path}@${ref}`
    );
  }
  return response.json();
}

// Enabled Kernel contracts from the public snapshot gateway.
export function createKernelSource(baseUrl) {
  let chainIds;
  const getJson = async (path) => {
    const response = await fetch(new URL(path, baseUrl), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Snapshot gateway returned HTTP ${response.status} for ${path}`
      );
    }
    return response.json();
  };
  return async (chainId) => {
    chainIds ??= new Set(
      (await getJson("/v1/chains")).data.map((chain) => chain.chainId)
    );
    if (!chainIds.has(chainId)) return null;
    const snapshot = await getJson(`/v1/chains/${chainId}/protocol`);
    return snapshot.data.contracts;
  };
}

export function createEtherscanSource(apiKey, delayMs = 400) {
  const cache = new Map();
  let last = 0;
  const request = async (chainId, address) => {
    for (let attempt = 1; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const url = new URL("https://api.etherscan.io/v2/api");
      url.search = new URLSearchParams({
        chainid: String(chainId),
        module: "contract",
        action: "getsourcecode",
        address,
        apikey: apiKey,
      }).toString();
      let data;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      } catch (error) {
        // Do not print the request URL. It contains the API key.
        if (attempt < 3) continue;
        throw new Error(
          `Etherscan request failed for ${chainId}:${address}: ${error.message}`
        );
      }
      const record = data.result?.[0];
      if (data.status === "1" && record) return record;
      if (/rate limit/i.test(String(data.result)) && attempt < 5) {
        await sleep(1000 * attempt);
        continue;
      }
      throw new Error(
        `Etherscan returned an error for ${chainId}:${address}: ${String(data.result ?? data.message).slice(0, 200)}`
      );
    }
  };
  return async (chainId, address) => {
    const key = `${chainId}:${address.toLowerCase()}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        request(chainId, address).catch((error) => {
          cache.delete(key);
          throw error;
        })
      );
    }
    const record = await cache.get(key);
    if (!record.SourceCode || !record.ContractName) {
      throw new SourceUnavailableError("Etherscan has no verified source.");
    }
    const abi = JSON.parse(record.ABI);
    return {
      contractName: record.ContractName,
      abi,
      implementation:
        record.Proxy === "1" && record.Implementation
          ? getAddress(record.Implementation)
          : null,
    };
  };
}

const isRevert = (error) =>
  error instanceof BaseError &&
  Boolean(
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError ||
        cause instanceof AbiDecodingZeroDataError ||
        cause instanceof AbiDecodingDataSizeTooSmallError ||
        // Not exported by viem. The return data is shorter than the ABI.
        cause.name === "PositionOutOfBoundsError" ||
        cause instanceof ExecutionRevertedError
    )
  );

// On-chain reads. The URL of each chain comes from ENVIO_RPC_URL_<chainId>, the
// variable that the indexer uses.
export function createRpcSource(chainIds) {
  const missing = chainIds
    .map((chainId) => `ENVIO_RPC_URL_${chainId}`)
    .filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Set ${missing.join(", ")} to sync the ABI registry.`);
  }
  const clients = new Map(
    chainIds.map((chainId) => [
      chainId,
      createPublicClient({
        transport: http(process.env[`ENVIO_RPC_URL_${chainId}`], {
          retryCount: 3,
        }),
      }),
    ])
  );
  const client = (chainId) => {
    const found = clients.get(chainId);
    if (!found) throw new Error(`No RPC URL for chain ${chainId}`);
    return found;
  };
  const read = async (chainId, address, abi, functionName) => {
    try {
      return await client(chainId).readContract({
        address,
        abi,
        functionName,
      });
    } catch (error) {
      if (isRevert(error)) return null;
      throw error;
    }
  };
  return {
    version: async (chainId, address) => {
      try {
        const { data } = await client(chainId).call({
          to: address,
          data: VERSION_SELECTOR,
        });
        return decodeVersion(data);
      } catch (error) {
        if (isRevert(error)) return null;
        throw error;
      }
    },
    isActive: (chainId, address) =>
      read(chainId, address, isActiveAbi, "isActive"),
    implementation: async (chainId, address) => {
      const value = await client(chainId).getStorageAt({
        address,
        slot: IMPLEMENTATION_SLOT,
      });
      if (!value || /^0x0*$/.test(value)) return null;
      return getAddress(`0x${value.slice(-40)}`);
    },
  };
}
