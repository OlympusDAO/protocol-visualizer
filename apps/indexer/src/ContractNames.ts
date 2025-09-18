import { ChainId } from "./constants";

type ContractDetails = {
  name: string;
  /**
   * e.g. "1.1"
   *
   * Stored as a string to avoid precision loss
   */
  version?: string;
};

type ChainContracts = Record<`0x${string}`, ContractDetails>;

type MultiChainContracts = {
  [chainId: number]: ChainContracts;
};

const contractNames: MultiChainContracts = {
  [ChainId.Mainnet]: {
    "0x0374c001204eF5e7E4F5362A5A2430CB6c219326": {
      name: "Operator",
      version: "1.3",
    },
    "0x04906695D6D12CF5459975d7C3C03356E4Ccd460": {
      name: "Legacy sOHM",
    },
    "0x0941233c964e7d7Efeb05D253176E5E634cEFfcD": {
      name: "Governor",
    },
    "0x0ab87046fBb341D058F17CBC4c1133F25a20a52f": {
      name: "Legacy gOHM",
    },
    "0x0AE561226896dA978EaDA0Bec4a7d3CfAE04f506": {
      name: "Operator",
      version: "1.4",
    },
    "0x0cf30dc0d48604a301df8010cdc028c055336b2e": {
      name: "Policy MS",
    },
    "0x1652b503e0f1cf38b6246ed3b91cb3786bb11656": {
      name: "Heart",
      version: "1.1",
    },
    "0x1Ce568DbB34B2631aCDB5B453c3195EA0070EC65": {
      name: "Operator",
      version: "1.1",
    },
    "0x1e094fE00E13Fd06D64EeA4FB3cD912893606fE0": {
      name: "Clearinghouse",
      version: "1.2",
    },
    "0x2286d7f9639e8158FaD1169e76d1FbC38247f54b": {
      name: "Kernel",
    },
    "0x245cc372C84B3645Bf0Ffe6538620B04a217988B": {
      name: "DAO MS",
    },
    "0x271e35a8555a62F6bA76508E85dfD76D580B0692": {
      name: "YieldRepurchaseFacility",
      version: "1.2",
    },
    "0x27e606fdb5C922F8213dC588A434BF7583697866": {
      name: "Distributor",
    },
    "0x30A967eB957E5B1eE053B75F1A57ea6bfb2e907E": {
      name: "YieldRepurchaseFacility",
      version: "1.0",
    },
    "0x30Ce56e80aA96EbbA1E1a74bC5c0FEB5B0dB4216": {
      name: "CoolerFactory",
    },
    "0x367149cf2d04D3114fFD1Cc6b273222664908D0B": {
      name: "LegacyBurner",
    },
    "0x375E06C694B5E50aF8be8FB03495A612eA3e2275": {
      name: "BLREG",
      version: "1.0",
    },
    "0x399cD3685912bb56aAeD0949119dB6cE5Df60FB5": {
      name: "RANGE",
      version: "2.0",
    },
    "0x39F6AA3d445e6Dd8eC232c6Bd589889A88E3034d": {
      name: "Heart",
      version: "1.5",
    },
    "0x44a7a09ccddb4338e062f1a3849f9a82bdbf2aaa": {
      name: "ZeroDistributor",
    },
    "0x45e563c39cDdbA8699A90078F42353A57509543a": {
      name: "CrossChainBridge",
    },
    "0x50f441a3387625bDA8B8081cE3fd6C04CC48C0A2": {
      name: "EmissionManager",
    },
    "0x6417F206a0a6628Da136C0Faa39026d0134D2b52": {
      name: "Operator",
      version: "1.5",
    },
    "0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5": {
      name: "LegacyOHM",
    },
    "0x24b96f2150bf1ed10d3e8b28ed33e392fbb4cad5": {
      name: "CHREG",
      version: "1.0",
    },
    "0x69a3E97027d21a5984B6a543b36603fFbC6543a4": {
      name: "CHREG",
      version: "1.1",
    },
    "0x6CAfd730Dc199Df73C16420C4fCAb18E3afbfA59": {
      name: "ROLES",
      version: "1.0",
    },
    "0x73df08CE9dcC8d74d22F23282c4d49F13b4c795E": {
      name: "BondCallback",
      version: "1.1",
    },
    "0x784cA0C006b8651BAB183829A99fA46BeCe50dBc": {
      name: "LoanConsolidator",
    },
    "0x7fdD4e808ee9608f1b2f05157A2A8098e3D432cD": {
      name: "BLVaultLido",
    },
    "0x89631595649Cc6dEBa249A8012a5b2d88C8ddE48": {
      name: "RGSTY",
      version: "1.0",
    },
    "0x9229b0b6FA4A58D67Eb465567DaA2c6A34714A75": {
      name: "Emergency",
    },
    "0x953EA3223d2dd3c1A91E9D6cca1bf7Af162C9c39": {
      name: "Governance Timelock",
    },
    "0x986b99579BEc7B990331474b66CcDB94Fa2419F5": {
      name: "ReserveMigrator",
    },
    "0x9C6220fE829d6FC889cde9b4966D2033C4EfFD48": {
      name: "Heart",
      version: "1.2",
    },
    "0xa8687A15D4BE32CC8F0a8a7B9704a4C3993D9613": {
      name: "TRSRY",
      version: "1.0",
    },
    "0xa8A6ff2606b24F61AFA986381D8991DFcCCd2D55": {
      name: "Emergency MS",
    },
    "0xa90bFe53217da78D900749eb6Ef513ee5b6a491e": {
      name: "MINTR",
      version: "1.0",
    },
    "0xafe729d57d2CC58978C2e01b4EC39C47FB7C4b23": {
      name: "BLVaultManagerLido",
    },
    "0xb212D9584cfc56EFf1117F412Fe0bBdc53673954": {
      name: "RANGE",
      version: "1.0",
    },
    "0xb216d714d91eeC4F7120a732c11428857C659eC8": {
      name: "RolesAdmin",
    },
    "0xb37796941cA55b7E4243841930C104Ee325Da5a1": {
      name: "pOLY",
    },
    "0xB63cac384247597756545b500253ff8E607a8020": {
      name: "LegacyStaking",
    },
    "0xBA05d48Fb94dC76820EB7ea1B360fd6DfDEabdc5": {
      name: "ContractRegistryAdmin",
    },
    "0xbb47C3FFf4eF85703907d3ffca30de278b85df3f": {
      name: "Operator",
      version: "1.0",
    },
    "0xbf2b6e99b0e8d4c96b946c182132f5752eaa55c6": {
      name: "BondCallback",
      version: "1.0",
    },
    "0xC9518AC915e46D707585116451Dc19c164513Ccf": {
      name: "TreasuryCustodian",
    },
    "0xcaA3d3E653A626e2656d2E799564fE952D39d855": {
      name: "YieldRepurchaseFacility",
      version: "1.1",
    },
    "0xD5a0Ae3Bf7309416e70cB14399bDd508fE82C658": {
      name: "Heart",
      version: "1.4",
    },
    "0xd6a6e8d9e82534bd65821142fccd91ec9cf31880": {
      name: "Clearinghouse",
      version: "1.0",
    },
    "0xd6C4D723fdadCf0D171eF9A2a3Bfa870675b282f": {
      name: "PRICE",
      version: "1.0",
    },
    "0xda9fedbcaf319ecf8ab11fe874fb1abfc2181766": {
      name: "pOLY MS",
    },
    "0xdE3F82D378c3b4E3F3f848b8DF501914b3317E96": {
      name: "GovernorDelegate",
      version: "2.0",
    },
    "0xE05646971Ec444f8449d1CA6Fc8D9793986017d5": {
      name: "Heart",
      version: "1.3",
    },
    "0xE6343ad0675C9b8D3f32679ae6aDbA0766A2ab4c": {
      name: "Clearinghouse",
      version: "1.1",
    },
    "0xeaf46BD21dd9b263F28EEd7260a269fFba9ace6E": {
      name: "Heart",
      version: "1.0",
    },
    "0xF451c45C7a26e2248a0EA02382579Eb4858cAdA1": {
      name: "BLVaultManager LUSD",
    },
    "0xf577c77ee3578c7F216327F41B5D7221EaD2B2A3": {
      name: "BondManager",
    },
    "0xf6D5d06A4e8e6904E4360108749C177692F59E90": {
      name: "PriceConfig",
    },
    "0xf7602C0421c283A2fc113172EBDf64C30F21654D": {
      name: "Heart",
      version: "1.6",
    },
    "0xfbB3742628e8D19E0E2d7D8dde208821C09dE960": {
      name: "BLVault LUSD",
    },
    "0x473f86ebfa7ab57c4c82c3592d6147104996c19b": {
      name: "BondCallback",
    },
    "0x5f15b91b59ad65d490921016d4134c2301197485": {
      name: "Operator",
    },
    "0xdb591Ea2e5Db886dA872654D58f6cc584b68e7cC": {
      name: "CoolerV2",
    },
    "0x9ee9f0c2e91E4f6B195B988a9e6e19efcf91e8dc": {
      name: "CoolerV2LtvOracle",
    },
    "0xD58d7406E9CE34c90cf849Fc3eed3764EB3779B0": {
      name: "CoolerV2TreasuryBorrower",
    },
    "0x6593768feBF9C95aC857Fb7Ef244D5738D1C57Fd": {
      name: "CoolerV2Composites",
    },
    "0xE045BD0A0d85E980AA152064C06EAe6B6aE358D2": {
      name: "CoolerV2Migrator",
    },
    "0xC84157C2306238C9330fEa14774a82A53a127A59": {
      name: "DelegateEscrowFactory",
    },
    "0xD3204Ae00d6599Ba6e182c6D640A79d76CdAad74": {
      name: "DLGTE",
      version: "1.0",
    },
    "0xFbf6383dC3F6010d403Ecdf12DDC1311701D143D": {
      name: "CCIPCrossChainBridge",
    },
    "0xa5588e518CE5ee0e4628C005E4edAbD5e87de3aD": {
      name: "CCIPLockReleaseTokenPool",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Arbitrum]: {
    "0xeac3eC0CC130f4826715187805d1B50e861F2DaC": {
      name: "Kernel",
    },
    "0xFF5F09D5efE13A9a424F30EC2e1af89D867834d6": {
      name: "ROLES",
      version: "1.0",
    },
    "0x69168c08AcF66f002fd02E1B169f38C022c93b70": {
      name: "RolesAdmin",
    },
    "0x56db53e9801a6EA080569261b63925E0f1f3C81A": {
      name: "TRSRY",
      version: "1.0",
    },
    "0x8f6406eDbFA393e327822D4A08BcF15503570D87": {
      name: "MINTR",
      version: "1.0",
    },
    "0x868C3ae18Fdea85bBb7a303e379c5B7e23b30F03": {
      name: "LENDR",
      version: "1.0",
    },
    "0x012BBf0481b97170577745D2167ee14f63E2aD4C": {
      name: "DAO MS",
    },
    "0x20B3834091f038Ce04D8686FAC99CA44A0FB285c": {
      name: "CrossChainBridge",
    },
    "0xA8578c9A73C2b4F75968EC76d6689045ff68B97C": {
      name: "SiloAMO",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Base]: {
    "0x18878Df23e2a36f81e820e4b47b4A40576D3159C": {
      name: "Kernel",
    },
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "ROLES",
      version: "1.0",
    },
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "RolesAdmin",
    },
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "MINTR",
      version: "1.0",
    },
    "0x18a390bD45bCc92652b9A91AD51Aed7f1c1358f5": {
      name: "DAO MS",
    },
    "0x22ae99d07584a2ae1af748de573c83f1b9cdb4c0": {
      name: "CrossChainBridge",
      version: "1.0",
    },
    "0x6CA1a916e883c7ce2BFBcF59dc70F2c1EF9dac6e": {
      name: "CrossChainBridge",
      version: "1.1",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Berachain]: {
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "Kernel",
    },
    "0x22AE99D07584A2AE1af748De573c83f1B9Cdb4c0": {
      name: "ROLES",
      version: "1.0",
    },
    "0xe37D9a2791707BBB858012d219960D5FBD190794": {
      name: "RolesAdmin",
    },
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "MINTR",
      version: "1.0",
    },
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "TRSRY",
      version: "1.0",
    },
    "0x91494D1BC2286343D51c55E46AE80C9356D099b5": {
      name: "DAO MS",
    },
    "0xa5ea62894027D981D34BB99A04BD36B818b2Aaf0": {
      name: "Emergency MS",
    },
    "0xBA42BE149e5260EbA4B82418A6306f55D532eA47": {
      name: "CrossChainBridge",
      version: "1.0",
    },
    "0xCA7240A7B439c9D458B47831d38c3d69C1287469": {
      name: "Emergency",
    },
    "0x0D33c811D0fcC711BcB388DFB3a152DE445bE66F": {
      name: "TreasuryCustodian",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
  [ChainId.Optimism]: {
    "0x18878Df23e2a36f81e820e4b47b4A40576D3159C": {
      name: "Kernel",
    },
    "0xbC9eE0D911739cBc72cd094ADA26F56E0C49EeAE": {
      name: "ROLES",
      version: "1.0",
    },
    "0xb1fA0Ac44d399b778B14af0AAF4bCF8af3437ad1": {
      name: "RolesAdmin",
    },
    "0x623164A9Ee2556D524b08f34F1d2389d7B4e1A1C": {
      name: "MINTR",
      version: "1.0",
    },
    "0x559a14a2219Ae81f9a9f857CF31407de2b07F36c": {
      name: "DAO MS",
    },
    "0x22AE99D07584A2AE1af748De573c83f1B9Cdb4c0": {
      name: "CrossChainBridge",
    },
    "0x1a5309f208f161a393e8b5a253de8ab894a67188": {
      name: "Deployer",
    },
  },
};

export const getContractName = (
  address: `0x${string}`,
  chainId: number
): string => {
  // Convert input address to lowercase for case-insensitive comparison
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const chainContracts = contractNames[chainId];

  if (!chainContracts) {
    return "UNKNOWN";
  }

  // Find matching contract name by comparing normalized addresses
  const match = Object.entries(chainContracts).find(
    ([addr]) => addr.toLowerCase() === normalizedAddress
  );

  return match ? match[1].name : "UNKNOWN";
};

export const getContractVersion = (
  address: `0x${string}`,
  chainId: number
): string | null => {
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const chainContracts = contractNames[chainId];

  if (!chainContracts) {
    return null;
  }

  const match = Object.entries(chainContracts).find(
    ([addr]) => addr.toLowerCase() === normalizedAddress
  );

  if (!match) {
    return null;
  }

  return match[1].version || null;
};
