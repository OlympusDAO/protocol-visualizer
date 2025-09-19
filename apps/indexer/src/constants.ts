export enum ChainId {
  Mainnet = 1,
  Arbitrum = 42161,
  Base = 8453,
  Berachain = 80094,
  Optimism = 10,
  Sepolia = 11155111,
}

type ChainContractConstants = {
  creationTransactionHash: `0x${string}`;
  creationBlockNumber: number;
  creationTimestamp: number;
  address: `0x${string}`;
};

const KERNEL_CONSTANTS: Record<number, ChainContractConstants> = {
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xda3facf1f77124cdf4bddff8fa09221354ad663ec2f8b03dcc4657086ebf5e72",
    creationBlockNumber: 15998125,
    creationTimestamp: 1668790475,
    address: "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x3f55f2ce3af9f803343c6b3361ccde1cf4853c931c9410ad935586cc3c21519d",
    creationBlockNumber: 85886527,
    creationTimestamp: 1682868260,
    address: "0xeac3eC0CC130f4826715187805d1B50e861F2DaC",
  },
  [ChainId.Base]: {
    creationTransactionHash:
      "0x005ee16349882fa0b7a31470b2c8049d40bb387c2aeef045b6baa75566d8a39c",
    creationBlockNumber: 13204831,
    creationTimestamp: 1713199009,
    address: "0x18878Df23e2a36f81e820e4b47b4A40576D3159C",
  },
  [ChainId.Berachain]: {
    creationTransactionHash:
      "0x6b4e1a31a0b528ccb915aaf59e168b70d1952045b1136a510b4b7eb743fd316e",
    creationBlockNumber: 780016,
    creationTimestamp: 1738849414,
    address: "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C",
  },
  [ChainId.Optimism]: {
    creationTransactionHash:
      "0x5a22cf89858ce51ee163fe3491129499cf692695d71d8f31a5a5b3c7bc52942c",
    creationBlockNumber: 98531655,
    creationTimestamp: 1684171967,
    address: "0x18878Df23e2a36f81e820e4b47b4A40576D3159C",
  },
  [ChainId.Sepolia]: {
    creationTransactionHash:
      "0x18bbcccdbb5c459f853f79aaab76f53fd6491792b497ec44aede68b18c0da36b",
    creationBlockNumber: 8226369,
    creationTimestamp: 0,
    address: "0x4b0BBa51cE44175a9766f7e55e3d122a9F4BE78E",
  },
};

export const getKernelConstants = (chainId: number) => {
  const constants = KERNEL_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`Kernel constants for chain ${chainId} not found`);
  }

  return constants;
};

const ROLES_CONSTANTS: Record<number, ChainContractConstants> = {
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xbf00e197abe1961dc9992b29c5471949df1947be69d462ff48bb574aed2fab42",
    creationBlockNumber: 15998132,
    creationTimestamp: 1668789359,
    address: "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x87fd19b730e0fc2223b0ead36454ac21ac942abdc3162e0abb65983b6f634043",
    creationBlockNumber: 85886592,
    creationTimestamp: 1682868279,
    address: "0xFF5F09D5efE13A9a424F30EC2e1af89D867834d6",
  },
  [ChainId.Base]: {
    creationTransactionHash:
      "0x379915686d42077d6a0891f07113c9e4c8574fdb4aec08aa1ea43bd6d471589c",
    creationBlockNumber: 13204839,
    creationTimestamp: 1713199025,
    address: "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE",
  },
  [ChainId.Berachain]: {
    creationTransactionHash:
      "0xb779cc9956dae7860fe1029a1990e2ed708a00ba5e86a6cbf6da524f7593d1ac",
    creationBlockNumber: 780020,
    creationTimestamp: 1738849422,
    address: "0x22AE99D07584A2AE1af748De573c83f1B9Cdb4c0",
  },
  [ChainId.Optimism]: {
    creationTransactionHash:
      "0xe079fa214a3da0b608ced55979292dad2b9b8a26e698baf5dac833f6c6583c1b",
    creationBlockNumber: 98531689,
    creationTimestamp: 1684171982,
    address: "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE",
  },
  [ChainId.Sepolia]: {
    creationTransactionHash:
      "0xe7b168d42c2985545e28d45f0188a22be58146ec89cad28cb02efeeefe000ce8",
    creationBlockNumber: 8226371,
    creationTimestamp: 0,
    address: "0xEdd6ebFFeD7D29947957d096dd55e82F523ceb86",
  },
};

export const getRolesConstants = (chainId: number) => {
  const constants = ROLES_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`ROLES constants for chain ${chainId} not found`);
  }

  return constants;
};

const ROLES_ADMIN_CONSTANTS: Record<number, ChainContractConstants> = {
  [ChainId.Mainnet]: {
    creationTransactionHash:
      "0xcc820ca2f75e32ae5f98eb861c08d663501878f18b8888983bec07a007da6b78",
    creationBlockNumber: 15998137,
    creationTimestamp: 1668789419,
    address: "0xb216d714d91eeC4F7120a732c11428857C659eC8",
  },
  [ChainId.Arbitrum]: {
    creationTransactionHash:
      "0x266c2c373e058c9f3c9336709f3feade66d62702d7abfc211504da3327cc1e48",
    creationBlockNumber: 85886660,
    creationTimestamp: 1682868296,
    address: "0x69168c08AcF66f002fd02E1B169f38C022c93b70",
  },
  [ChainId.Base]: {
    creationTransactionHash:
      "0xcfd3d8df0c20432e819623d9c230e61d81b321e6f83c8312e3ad949143d9ad7f",
    creationBlockNumber: 13204846,
    creationTimestamp: 1713199039,
    address: "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1",
  },
  [ChainId.Berachain]: {
    creationTransactionHash:
      "0xc08d6a98f20fab7b1d5593a7e30b456d38ad9fc1dfea796945a91581ab86f8ab",
    creationBlockNumber: 780026,
    creationTimestamp: 1738849434,
    address: "0xe37D9a2791707BBB858012d219960D5FBD190794",
  },
  [ChainId.Optimism]: {
    creationTransactionHash:
      "0x673a89088e38332f8954eb446ccf8b3c384c7d2a6ef599c2fd2469f71fac4fa8",
    creationBlockNumber: 98531717,
    creationTimestamp: 1684171982,
    address: "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1",
  },
  [ChainId.Sepolia]: {
    creationTransactionHash:
      "0xa9c9f06211b1d471edcd4a0c3ccf621a2396ecc948b5577e854fa0d80cba3327",
    creationBlockNumber: 8226374,
    creationTimestamp: 0,
    address: "0xf33133E5356B9534e794468dAcD424D11007f1cF",
  },
};

export const getRolesAdminConstants = (chainId: number) => {
  const constants = ROLES_ADMIN_CONSTANTS[chainId];
  if (!constants) {
    throw new Error(`RolesAdmin constants for chain ${chainId} not found`);
  }

  return constants;
};
