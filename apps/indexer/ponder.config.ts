import { createConfig } from "ponder";
import { http, webSocket } from "viem";
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

/**
 * Gets the appropriate viem transport for a given chain ID
 * - Uses websocket transport if the RPC URL starts with "wss"
 * - Otherwise uses HTTP transport
 * - Applies rate limiting to HTTP transport if PONDER_RPC_RPS is set
 */
function getTransport(chainId: number) {
  const envVarName = `PONDER_RPC_URL_${chainId}`;
  const rpcUrl = process.env[envVarName];

  if (!rpcUrl) {
    throw new Error(
      `RPC URL not found for chain ${chainId}. Set ${envVarName} environment variable.`
    );
  }

  // Check if URL uses websocket protocol (case-insensitive)
  const isWebSocket = rpcUrl.toLowerCase().startsWith("wss://") ||
    rpcUrl.toLowerCase().startsWith("ws://");

  if (isWebSocket) {
    console.log(`Using websocket transport for chain ${chainId}`);
    return webSocket(rpcUrl);
  }

  // For HTTP transport, check if rate limiting is enabled
  const rpsEnv = process.env.PONDER_RPC_RPS;
  const rps = rpsEnv ? Number(rpsEnv) : undefined;

  if (rps !== undefined && !isNaN(rps) && rps > 0) {
    console.log(`Rate limiting HTTP transport for chain ${chainId} to ${rps} requests per second`);
    return rateLimit(http(rpcUrl), { requestsPerSecond: rps });
  }

  console.log(`Using HTTP transport for chain ${chainId}`);
  return http(rpcUrl);
}

export default createConfig({
  ordering: "multichain",
  networks: {
    // Production chains
    mainnet: {
      chainId: ChainId.Mainnet,
      transport: getTransport(ChainId.Mainnet),
    },
    arbitrum: {
      chainId: ChainId.Arbitrum,
      transport: getTransport(ChainId.Arbitrum),
    },
    base: {
      chainId: ChainId.Base,
      transport: getTransport(ChainId.Base),
    },
    berachain: {
      chainId: ChainId.Berachain,
      transport: getTransport(ChainId.Berachain),
    },
    optimism: {
      chainId: ChainId.Optimism,
      transport: getTransport(ChainId.Optimism),
    },
    // Testnets
    sepolia: {
      chainId: ChainId.Sepolia,
      transport: getTransport(ChainId.Sepolia),
    },
  },
  contracts: {
    Kernel: {
      abi: KernelAbi,
      network: {
        mainnet: {
          address: mainnetKernel.address,
          startBlock: mainnetKernel.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumKernel.address,
          startBlock: arbitrumKernel.creationBlockNumber,
        },
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
    ROLES: {
      abi: OlympusRolesAbi,
      network: {
        mainnet: {
          address: mainnetRoles.address,
          startBlock: mainnetRoles.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumRoles.address,
          startBlock: arbitrumRoles.creationBlockNumber,
        },
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
      network: {
        mainnet: {
          address: mainnetRolesAdmin.address,
          startBlock: mainnetRolesAdmin.creationBlockNumber,
        },
        arbitrum: {
          address: arbitrumRolesAdmin.address,
          startBlock: arbitrumRolesAdmin.creationBlockNumber,
        },
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
