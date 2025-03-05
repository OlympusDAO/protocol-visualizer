import { createConfig } from "ponder";
import { http } from "viem";

import { KernelAbi } from "./abis/Kernel";
import { OlympusRolesAbi } from "./abis/OlympusRoles";
import { RolesAdminAbi } from "./abis/RolesAdmin";
import {
  getKernelConstants,
  getRolesAdminConstants,
  getRolesConstants,
} from "./src/constants";

const mainnetKernel = getKernelConstants(1);
const mainnetRoles = getRolesConstants(1);
const mainnetRolesAdmin = getRolesAdminConstants(1);

export default createConfig({
  networks: {
    mainnet: { chainId: 1, transport: http(process.env.PONDER_RPC_URL_1) },
  },
  contracts: {
    Kernel: {
      abi: KernelAbi,
      network: {
        mainnet: {
          address: mainnetKernel.address,
          startBlock: mainnetKernel.creationBlockNumber,
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
      },
    },
    RolesAdmin: {
      abi: RolesAdminAbi,
      network: {
        mainnet: {
          address: mainnetRolesAdmin.address,
          startBlock: mainnetRolesAdmin.creationBlockNumber,
        },
      },
    },
  },
});
