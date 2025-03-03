import { createConfig } from "ponder";
import { http } from "viem";

import { KernelAbi } from "./abis/Kernel";
import { OlympusRolesAbi } from "./abis/OlympusRoles";
import { RolesAdminAbi } from "./abis/RolesAdmin";

export default createConfig({
  networks: {
    mainnet: { chainId: 1, transport: http(process.env.PONDER_RPC_URL_1) },
  },
  contracts: {
    Kernel: {
      abi: KernelAbi,
      address: "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b",
      network: "mainnet",
      startBlock: 15998125,
    },
    ROLES: {
      abi: OlympusRolesAbi,
      address: "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59",
      network: "mainnet",
      startBlock: 15998132,
    },
    RolesAdmin: {
      abi: RolesAdminAbi,
      address: "0xb216d714d91eeC4F7120a732c11428857C659eC8",
      network: "mainnet",
      startBlock: 15998137,
    },
  },
});
