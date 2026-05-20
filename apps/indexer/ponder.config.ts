import { createConfig } from "ponder";
import { fallback, http, Transport, webSocket } from "viem";
import { rateLimit } from "ponder";

import { KernelAbi } from "./abis/Kernel";
import { OlympusRolesAbi } from "./abis/OlympusRoles";
import { RolesAdminAbi } from "./abis/RolesAdmin";
import {
  ChainId,
  getKernelConstants,
  getRolesAdminConstants,
  getRolesConstants,
} from "./src/constants";

const mainnetKernel = getKernelConstants(ChainId.Mainnet);
const mainnetRoles = getRolesConstants(ChainId.Mainnet);
const mainnetRolesAdmin = getRolesAdminConstants(ChainId.Mainnet);

const arbitrumKernel = getKernelConstants(ChainId.Arbitrum);
const arbitrumRoles = getRolesConstants(ChainId.Arbitrum);
const arbitrumRolesAdmin = getRolesAdminConstants(ChainId.Arbitrum);

const baseKernel = getKernelConstants(ChainId.Base);
const baseRoles = getRolesConstants(ChainId.Base);
const baseRolesAdmin = getRolesAdminConstants(ChainId.Base);

const berachainKernel = getKernelConstants(ChainId.Berachain);
const berachainRoles = getRolesConstants(ChainId.Berachain);
const berachainRolesAdmin = getRolesAdminConstants(ChainId.Berachain);

const optimismKernel = getKernelConstants(ChainId.Optimism);
const optimismRoles = getRolesConstants(ChainId.Optimism);
const optimismRolesAdmin = getRolesAdminConstants(ChainId.Optimism);

const sepoliaKernel = getKernelConstants(ChainId.Sepolia);
const sepoliaRoles = getRolesConstants(ChainId.Sepolia);
const sepoliaRolesAdmin = getRolesAdminConstants(ChainId.Sepolia);

function getPositiveInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function getRateLimit(rpcUrlRateLimit?: string): number | undefined {
  return getPositiveInteger(rpcUrlRateLimit);
}

function getEthGetLogsBlockRange(chainId: number): number | undefined {
  return getPositiveInteger(process.env[`PONDER_RPC_BLOCK_RANGE_${chainId}`]);
}

function getRpcTransport(
  chainId: number,
  rpcUrl: string,
  rpcUrlRateLimit?: string
): Transport {
  // Check if URL uses websocket protocol (case-insensitive)
  const isWebSocket =
    rpcUrl.toLowerCase().startsWith("wss://") ||
    rpcUrl.toLowerCase().startsWith("ws://");

  // Check for rate-limiting
  const rps = getRateLimit(rpcUrlRateLimit);

  let transport: Transport;

  if (isWebSocket) {
    console.log(`Using websocket transport for chain ${chainId}`);
    transport = webSocket(rpcUrl);
  } else {
    console.log(`Using HTTP transport for chain ${chainId}`);
    transport = http(rpcUrl);
  }

  if (rps) {
    console.log(
      `Rate limiting transport for chain ${chainId} to ${rps} requests per second`
    );
    transport = rateLimit(transport, { requestsPerSecond: rps });
  }

  return transport;
}

/**
 * Gets the appropriate viem transport for a given chain ID
 * - Uses websocket transport if the RPC URL starts with "wss"
 * - Otherwise uses HTTP transport
 * - Applies rate limiting to HTTP transport if PONDER_RPC_URL_RATE_LIMIT_<chainId> is set
 * - If PONDER_RPC_URL_FALLBACK_<chainId> is set, provides a fallback transport
 */
function getTransport(chainId: number): Transport {
  const envVarName = `PONDER_RPC_URL_${chainId}`;
  const rpcUrl = process.env[envVarName];
  const rpcUrlFallback = process.env[`PONDER_RPC_URL_FALLBACK_${chainId}`];
  const rpcUrlRateLimit = process.env[`PONDER_RPC_URL_RATE_LIMIT_${chainId}`];

  if (!rpcUrl) {
    throw new Error(
      `RPC URL not found for chain ${chainId}. Set ${envVarName} environment variable.`
    );
  }

  const rpcTransport = getRpcTransport(chainId, rpcUrl, rpcUrlRateLimit);

  // If no fallback URL is set, return the transport
  if (!rpcUrlFallback) {
    return rpcTransport;
  }

  console.log(`Setting up fallback transport for chain ${chainId}`);
  const rpcTransportFallback = getRpcTransport(
    chainId,
    rpcUrlFallback,
    rpcUrlRateLimit
  );

  return fallback([rpcTransport, rpcTransportFallback]);
}

function getChainConfig(chainId: ChainId) {
  const ethGetLogsBlockRange = getEthGetLogsBlockRange(chainId);

  return {
    id: chainId,
    rpc: getTransport(chainId),
    ...(ethGetLogsBlockRange ? { ethGetLogsBlockRange } : {}),
  };
}

export default createConfig({
  ordering: "experimental_isolated",
  chains: {
    // Production chains
    mainnet: getChainConfig(ChainId.Mainnet),
    // arbitrum: {
    //   id: ChainId.Arbitrum,
    //   rpc: getTransport(ChainId.Arbitrum),
    // },
    base: getChainConfig(ChainId.Base),
    berachain: getChainConfig(ChainId.Berachain),
    optimism: getChainConfig(ChainId.Optimism),
    // Testnets
    sepolia: getChainConfig(ChainId.Sepolia),
  },
  contracts: {
    KernelNonPolicyActions: {
      abi: KernelAbi,
      chain: {
        mainnet: {
          address: mainnetKernel.address,
          startBlock: mainnetKernel.creationBlockNumber,
        },
        // arbitrum: {
        //   address: arbitrumKernel.address,
        //   startBlock: arbitrumKernel.creationBlockNumber,
        // },
        base: {
          address: baseKernel.address,
          startBlock: baseKernel.creationBlockNumber,
        },
        berachain: {
          address: berachainKernel.address,
          startBlock: berachainKernel.creationBlockNumber,
        },
        optimism: {
          address: optimismKernel.address,
          startBlock: optimismKernel.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaKernel.address,
          startBlock: sepoliaKernel.creationBlockNumber,
        },
      },
    },
    KernelPolicyActions: {
      abi: KernelAbi,
      chain: {
        mainnet: {
          address: mainnetKernel.address,
          startBlock: mainnetKernel.creationBlockNumber,
        },
        // arbitrum: {
        //   address: arbitrumKernel.address,
        //   startBlock: arbitrumKernel.creationBlockNumber,
        // },
        base: {
          address: baseKernel.address,
          startBlock: baseKernel.creationBlockNumber,
        },
        berachain: {
          address: berachainKernel.address,
          startBlock: berachainKernel.creationBlockNumber,
        },
        optimism: {
          address: optimismKernel.address,
          startBlock: optimismKernel.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaKernel.address,
          startBlock: sepoliaKernel.creationBlockNumber,
        },
      },
      filter: [{ event: "ActionExecuted", args: { action_: [2, 3] } }],
    },
    ROLES: {
      abi: OlympusRolesAbi,
      chain: {
        mainnet: {
          address: mainnetRoles.address,
          startBlock: mainnetRoles.creationBlockNumber,
        },
        // arbitrum: {
        //   address: arbitrumRoles.address,
        //   startBlock: arbitrumRoles.creationBlockNumber,
        // },
        base: {
          address: baseRoles.address,
          startBlock: baseRoles.creationBlockNumber,
        },
        berachain: {
          address: berachainRoles.address,
          startBlock: berachainRoles.creationBlockNumber,
        },
        optimism: {
          address: optimismRoles.address,
          startBlock: optimismRoles.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaRoles.address,
          startBlock: sepoliaRoles.creationBlockNumber,
        },
      },
    },
    RolesAdmin: {
      abi: RolesAdminAbi,
      chain: {
        mainnet: {
          address: mainnetRolesAdmin.address,
          startBlock: mainnetRolesAdmin.creationBlockNumber,
        },
        // arbitrum: {
        //   address: arbitrumRolesAdmin.address,
        //   startBlock: arbitrumRolesAdmin.creationBlockNumber,
        // },
        base: {
          address: baseRolesAdmin.address,
          startBlock: baseRolesAdmin.creationBlockNumber,
        },
        berachain: {
          address: berachainRolesAdmin.address,
          startBlock: berachainRolesAdmin.creationBlockNumber,
        },
        optimism: {
          address: optimismRolesAdmin.address,
          startBlock: optimismRolesAdmin.creationBlockNumber,
        },
        sepolia: {
          address: sepoliaRolesAdmin.address,
          startBlock: sepoliaRolesAdmin.creationBlockNumber,
        },
      },
    },
  },
});
