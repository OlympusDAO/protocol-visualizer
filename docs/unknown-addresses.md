# Address identification audit

Checked on 22 October 2026 across all 11 catalog chains: 279 chain/address
pairs in the available protocol snapshots, control/role replay results and
recorded inventories. Mainnet, Robinhood, Arbitrum Sepolia and Base Sepolia
have local preview snapshots. Other chains were checked against the available
replay and inventory records; Goerli and Bartio have historical inventory only.
This does not claim discovery of every contract deployed outside those records.

Nineteen verified labels were added to `other-contracts.json` as `labelOnly`
entries. They name referenced nodes without creating standalone deployments
or starting new ownership/enablement indexing. Old snapshots containing
`UNKNOWN` contract or assignee names use these labels; existing names and
unresolved identities are preserved.

## Identified addresses

| Chain | Address | Label | Evidence |
| --- | --- | --- | --- |
| Mainnet | `0x0941233c964e7d7efeb05d253176e5e634ceffcd` | Governor | [Verified compiler metadata](https://sourcify.dev/server/v2/contract/1/0x0941233c964e7d7efeb05d253176e5e634ceffcd?fields=metadata): `GovernorBravoDelegator`; Olympus V3 environment `olympus.governance.GovernorBravoDelegator`. Added on 23 October 2026. |
| Mainnet | `0xde3f82d378c3b4e3f3f848b8df501914b3317e96` | GovernorDelegate | [Verified compiler metadata](https://sourcify.dev/server/v2/contract/1/0xde3f82d378c3b4e3f3f848b8df501914b3317e96?fields=metadata): `GovernorBravoDelegate`; Governor's observed `implementation()`. Added on 23 October 2026. |
| Mainnet | `0x44835bbba9d40deda9b64858095ecfb2693c9449` | CCIP RBACTimelock | [Sourcify compiler record](https://sourcify.dev/server/v2/contract/1/0x44835bbba9d40deda9b64858095ecfb2693c9449?fields=compilation); registry-owner relationship. |
| Optimism | `0x1e2faed390be7945acbf22fc25173c4bdda3ea45` | CCIP RBACTimelock | [Verified source](https://optimistic.etherscan.io/address/0x1e2faed390be7945acbf22fc25173c4bdda3ea45#code) and Sourcify. |
| Arbitrum | `0x8a89770722c84b60ce02989aedb22ac4791f8c7f` | CCIP RBACTimelock | [Sourcify compiler record](https://sourcify.dev/server/v2/contract/42161/0x8a89770722c84b60ce02989aedb22ac4791f8c7f?fields=compilation). |
| Base | `0x7b0328745a01634c32efaf041d91432a075b308d` | CCIP RBACTimelock | [Sourcify compiler record](https://sourcify.dev/server/v2/contract/8453/0x7b0328745a01634c32efaf041d91432a075b308d?fields=compilation). |
| Berachain | `0x13ac97663d19ff20fe467bfa580748505e664beb` | CCIP RBACTimelock | Byte-for-byte runtime equality with the verified Sepolia timelock below; both SHA-256 hashes `f817702cd03a62891f0fab2a7284bfa5fec45f1eac31ec2ca12a48ddbeb80452`. Hash-pinned mined-block reads on each chain. |
| Sepolia | `0x903ca654f4ef2d3ce8a63f4dc58e53d2a5468de6` | CCIP RBACTimelock | [Verified source](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0x903ca654f4ef2d3ce8a63f4dc58e53d2a5468de6). |
| Mainnet | `0x3225737a9bbb6473cb4a45b7244aca2befdb276a` | DaiUsdsMigrator | Olympus V3 `src/scripts/env.json`, `current.mainnet.external.maker.daiUsdsMigrator`. |
| Mainnet | `0x60744434d6339a6b27d73d9eda62b6f66a0a04fa` | Maker Flash | Olympus V3 environment, `current.mainnet.external.maker.flash`. |
| Mainnet | `0x6b175474e89094c44da98b954eedeac495271d0f` | DAI | Olympus V3 environment, `current.mainnet.external.tokens.DAI`. |
| Mainnet | `0xdc035d45d973e3ec169d2276ddab16f1e407384f` | USDS | Olympus V3 environment, `current.mainnet.external.tokens.USDS`. |
| Robinhood | `0x317e0f5ef883db95f8ffb5b995b8457903873608` | DAO MS | Olympus V3 environment, `current.robinhood.olympus.multisig.dao`; already named in indexer mappings. |
| Arbitrum Sepolia | `0x1a5309f208f161a393e8b5a253de8ab894a67188` | Deployer | Olympus V3 executor/role-admin configuration; existing Deployer identity on the other indexed chains. |
| Sepolia | `0x95af80e35603791955d97f27e977c6f2215b1e36` | LockReleaseTokenPool (1.5.1) | Hash-pinned `typeAndVersion()` returns `LockReleaseTokenPool 1.5.1`; historical registered-pool relationship. |
| Sepolia | `0xb1e82b8a517e9c11d6c46c385a706c3194c0aef7` | LockReleaseTokenPool (1.5.1) | Same version getter; historical registered-pool relationship. |
| Sepolia | `0x018b747ca7a2b9346f80aed5a9b7a417fb57f313` | LZBridgeAndDelegateConfig | [Verified source](https://sepolia.etherscan.io/address/0x018b747ca7a2b9346f80aed5a9b7a417fb57f313#code). |
| Sepolia | `0x1079968070b12f3a82f3ffd43ba21fa6805272e2` | RewardDistributorUSDS | [Sourcify compiler record](https://sourcify.dev/server/v2/contract/11155111/0x1079968070b12f3a82f3ffd43ba21fa6805272e2?fields=compilation). |
| Sepolia | `0x28c3798314cec6e921b5c70f61dffbdbefe65aff` | LZBridgeGateway | [Verified source](https://sepolia.etherscan.io/address/0x28c3798314cec6e921b5c70f61dffbdbefe65aff#code). |
| Sepolia | `0xc275f923d02b1148b399dda35b6cb54717bec7da` | LZEndpointDelegate | [Verified source](https://sepolia.etherscan.io/address/0xc275f923d02b1148b399dda35b6cb54717bec7da#code). |
| Sepolia | `0x3edd66de21fa6a4b141ad6971cb24f656e66ad4a` | LZCrossChainBridge | [Verified source](https://sepolia.etherscan.io/address/0x3edd66de21fa6a4b141ad6971cb24f656e66ad4a#code); creation receipt `0xdd7171824ed5f985e38940c5040207db9bc0971865938e2965aaf3df8a226314`, block 10981424. |

The Olympus V3 environment used is revision
`934e3b88ad414c1e6238b0a88b53c7f362d249ee`. Runtime/source identity supports
these labels, not unverified original NatSpec or a claim about who controls
each timelock. Mainnet's timelock owns the registry globally; it is distinct
from the DAO MS administering OHM within that registry.

## Unresolved identities

| Chain(s) | Address | Established context | Still unknown |
| --- | --- | --- | --- |
| Mainnet | `0x0000000000000000000000000000000000000020` | Older Operator `0x5f15b91b59ad65d490921016d4134c2301197485` returns this from `wrappedReserve()`. The constructor argument is also `0x20`. No code at block 26252800; Operator `isActive()` is false. | Why this value was supplied. No token identity established. |
| Optimism, Arbitrum, Base, Berachain | `0x3dc70606c76125282084dc37f6f7b1e3a1ce6a5e` | Indexed CCIP pool owner; refreshed code reads return `0x` on all four chains. | Operator or organisation. No DAO label inferred from ownership. |
| Robinhood | `0xf09afe78d3c7d359b334d7cb88995751f7ec5e13` | Registry owner; deployed code; `getMinDelay()` returns 10800 seconds. | Verified contract name and operator. Its same-address contracts on other chains do not establish its identity here. |
| Sepolia | `0x1505f3ad833e9c82facd8b4d3ff4319b1ef6eb99` | `minter_admin` assignee in replay; refreshed code is `0x`. | Operator or organisation. |
| Sepolia | `0xe02ccb6938fdb2fef07348ac0ae098fea883055b` | Rewards Merkle updater assignee; Safe proxy with a SafeL2 implementation, threshold 1 of 3. [Explorer record](https://eth-sepolia.blockscout.com/api/v2/smart-contracts/0xe02ccb6938fdb2fef07348ac0ae098fea883055b). | Safe purpose/operator. No DAO or automation-service identity inferred. |

The Heart task extension also exposes Sepolia auctioneer reference
`0x007f7a1cb838a872515c8ebd16be4b14ef43a222`. It has no code at canonical block
11974025 and no verified identity. Its Mainnet deployment is verified as
BondFixedTermSDA; that identity is not applied to Sepolia.

Unknowns remain visible in the application. Getter discovery can expose
additional addresses beyond the original audit.

## Mainnet follow-up: 23 October 2026

Reads were pinned to block 26252800
(`0xd345d195433dfbafbb1e17b42133a85327237d1c84bbbbc5086887000990eb80`).
The Governor and its implementation matched their verified runtime bytecode.
The Governor's `admin()` returns the OCG Timelock
(`0x953ea3223d2dd3c1a91e9d6cca1bf7af162c9c39`). The Timelock's `admin()`
also returns the Governor, so the graph correctly contains both references.
Both Governor labels use `labelOnly` entries.

The old Operator's `wrappedReserve()` returns one 32-byte address word ending
in `0020`. This is not an ABI offset mistakenly decoded as an address.
Its [creation transaction](https://etherscan.io/tx/0xba513c50dba98dcba845d7086917c41e653ea6aee75b07485223c76fbd66cd77)
at block 18279003 matches Sourcify's creation bytecode and constructor arguments.
The verified constructor assigns `tokens_[2]`, whose value is `0x20`, directly
to immutable `wrappedReserve`. The deployment receipt and block hash were
checked. This appears to be an invalid reserve configuration; the deployment
does not establish a name or purpose for that address.

## Expanded getter audit: 23 October 2026

The six available snapshots contained 65 additional unnamed relationship
addresses. Of these, 59 now have labels. Ten more labels cover CCIP endpoints
on configured chains without local snapshots: 69 new label-only entries in total.
The two previously unresolved Sepolia role holders remain unnamed.

Names were cross-checked against Olympus V3's `src/scripts/env.json` at
revision `934e3b88ad414c1e6238b0a88b53c7f362d249ee`.
Verified compiler targets supplied contract identities; pinned `name()`,
`symbol()`, `description()`, and `typeAndVersion()` reads added context where available.
No-code addresses were not assigned another chain's deployed contract name.

| Available snapshot | Canonical block |
| --- | --- |
| Ethereum Mainnet | 26252800 (`0xd345d195433dfbafbb1e17b42133a85327237d1c84bbbbc5086887000990eb80`) |
| Optimism | 158564645 (`0x112453598a17ef48b9c34d1f140220baa946a1bc3a7915b24dfb92f6caa6cbd5`) |
| Base | 52969360 (`0xa56f2e2ec9ac1e69ea349f082150bd69f684fe676adad3f98a17e2e82fe394b3`) |
| Arbitrum | 517427138 (`0x97b95dc4133a8e4084c0eb7da0f86efd1ed32529aad02e6790947dad74b2c551`) |
| Berachain | 27856675 (`0x0af52aea9529b19830b93bf7e28397590dc1a2f1a32012d38ba66a2c022443f7`) |
| Sepolia | 11974150 (`0x0b2ba7c73fd1b45663d2ad111a96ea8e8284dd08e531d8d055af77c700fd6edd`) |

All 54 Sourcify-verified candidates in these snapshots matched the deployed
runtime bytecode at their canonical observation block. Four further Sepolia
contracts have Etherscan-verified source and code present at that block.
Block hashes were checked before and after each chain's reads.

### CCIP endpoints

These labels use the existing Chainlink & CCIP section. Entries without an
available local snapshot name configured endpoints; they do not imply current
indexing or lane availability. Goerli has no CCIP endpoint entries in the source.
Bartio entries are historical.

| Chain | CCIP Router | CCIP RMN Proxy | Evidence |
| --- | --- | --- | --- |
| Ethereum Mainnet | `0x80226fc0ee2b096224eeac085bb9a8cba1146f7d` | `0x411de17f12d1a34ecc7f45f49844626267c75e81` | Olympus V3 environment; verified source/runtime and version getters. |
| Optimism | `0x3206695cae29952f4b0c22a169725a865bc8ce0f` | `0x55b3fca23eddd28b1f5b4a3c7975f63efd2d06ce` | Olympus V3 environment; verified source/runtime and version getters. |
| Arbitrum | `0x141fa059441e0ca23ce184b6a78bafd2a517dde8` | `0xc311a21e6fef769344eb1515588b9d535662a145` | Olympus V3 environment; verified source/runtime and version getters. |
| Base | `0x881e3a65b4d4a04dd529061dd0071cf975f58bcd` | `0xc842c69d54f83170c42c4d556b4f6b2ca53dd3e8` | Olympus V3 environment; verified source/runtime and version getters. |
| Berachain | `0x71a275704c283486fba26dad3dd0db78804426ef` | `0x25943b8c30c47f4ef09ccf2bae315ebaf591881d` | Olympus V3 environment; [Chainlink directory](https://docs.chain.link/ccip/directory/mainnet/chain/berachain-mainnet); pinned version getters. |
| Robinhood Chain | `0x06fc836cf9839b1cd891c440a0a45242da6ae1c9` | `0xe8464c353210cc398a45db2454fbc5bcd25fff20` | Olympus V3 environment; [Chainlink directory](https://docs.chain.link/ccip/directory/mainnet/chain/robinhood-mainnet); verified Router source. |
| Sepolia | `0x0bf3de8c5d3e8a2b34d2beeb17abfcebaf363a59` | `0xba3f6251de62ded61ff98590cb2fdf6871fbb991` | Olympus V3 environment; verified source/runtime and version getters. |
| Arbitrum Sepolia | `0x2a9c5afb0d0e4bab2bcdae109ec4b0c4be15a165` | `0x9527e2d01a3064ef6b50c1da1c0cc523803bcff2` | Olympus V3 environment; [Chainlink directory](https://docs.chain.link/ccip/directory/testnet/chain/ethereum-testnet-sepolia-arbitrum-1). |
| Base Sepolia | `0xd3b06cebf099ce7da4accf578aaebfdbd6e88a93` | `0x99360767a4705f68cccb9533195b761648d6d807` | Olympus V3 environment; Sourcify-verified Router and ARMProxy sources. |
| Berachain Bartio | `0xb1653462481e1bf30b5cca3082e2454e41668c65` | `0xf3e86536f95ec830983a51716c3577887cd2c47b` | Olympus V3 environment; historical configuration only. |

### Other identified references

Source links identify the deployed compiler target. Generic proxy names were
supplemented with observed token names and symbols. In particular, Arbitrum's
Silo OHM deposit token is distinct from Olympus sOHM. Sepolia's configured
Maker flash lender is verified as `MockFlashloanLender`.

| Chain | Address | Label | Evidence |
| --- | --- | --- | --- |
| Ethereum Mainnet | `0x9a315bdf513367c0377fb36545857d12e85813ef` | TreasuryV3 (legacy) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x9a315bdf513367c0377fb36545857d12e85813ef?fields=metadata): OlympusTreasury. Environment: `current.mainnet.olympus.legacy.TreasuryV3`. |
| Ethereum Mainnet | `0x30ce56e80aa96ebba1e1a74bc5c0feb5b0db4216` | CoolerFactory | [Verified source](https://sourcify.dev/server/v2/contract/1/0x30ce56e80aa96ebba1e1a74bc5c0feb5b0db4216?fields=metadata): CoolerFactory. Environment: `current.mainnet.external.cooler.CoolerFactory`. |
| Ethereum Mainnet | `0x007f7735baf391e207e3aa380bb53c4bd9a5fed6` | BondFixedTermTeller | [Verified source](https://sourcify.dev/server/v2/contract/1/0x007f7735baf391e207e3aa380bb53c4bd9a5fed6?fields=metadata): BondFixedTermTeller. Environment: `current.mainnet.external.bond-protocol.BondFixedTermTeller`. |
| Ethereum Mainnet | `0xe504ca8a954a757f79a3728e7985f144860af41e` | Cooler | [Verified source](https://sourcify.dev/server/v2/contract/1/0xe504ca8a954a757f79a3728e7985f144860af41e?fields=metadata): Cooler. |
| Ethereum Mainnet | `0xba42be149e5260eba4b82418a6306f55d532ea47` | OlympusProInverseBondCreator | [Verified source](https://sourcify.dev/server/v2/contract/1/0xba42be149e5260eba4b82418a6306f55d532ea47?fields=metadata): OlympusProInverseBondCreator. Environment: `current.mainnet.olympus.legacy.InverseBondDepository`. |
| Ethereum Mainnet | `0x44a7a09ccddb4338e062f1a3849f9a82bdbf2aaa` | ZeroDistributor | [Verified source](https://sourcify.dev/server/v2/contract/1/0x44a7a09ccddb4338e062f1a3849f9a82bdbf2aaa?fields=metadata): ZeroDistributor. Environment: `current.mainnet.olympus.policies.ZeroDistributor`. |
| Ethereum Mainnet | `0x66a71dcef29a0ffbdbe3c6a460a3b5bc225cd675` | LayerZero Endpoint V1 | [Verified source](https://sourcify.dev/server/v2/contract/1/0x66a71dcef29a0ffbdbe3c6a460a3b5bc225cd675?fields=metadata): Endpoint. Environment: `current.mainnet.external.layerzero.endpoint`. |
| Ethereum Mainnet | `0x0000000000000000000000000000000000000348` | USD unit of account | Verified PRICE source: reserved USD unit-of-account key, ISO 4217 code 840; intentionally has no bytecode. |
| Ethereum Mainnet | `0x007a66a2a13415db3613c1a4dd1c942a285902d1` | BondAggregator | [Verified source](https://sourcify.dev/server/v2/contract/1/0x007a66a2a13415db3613c1a4dd1c942a285902d1?fields=metadata): BondAggregator. Environment: `current.mainnet.external.bond-protocol.BondAggregator`. |
| Ethereum Mainnet | `0x383518188c0c6d7730d91b2c03a03c837814a899` | OHM (legacy v1) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x383518188c0c6d7730d91b2c03a03c837814a899?fields=metadata): OlympusERC20Token. Environment: `current.mainnet.olympus.legacy.OHMv1`. Symbol: OHM. |
| Ethereum Mainnet | `0x184f3fad8618a6f458c16bae63f70c426fe784b3` | TokenMigrator (legacy) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x184f3fad8618a6f458c16bae63f70c426fe784b3?fields=metadata): OlympusTokenMigrator. Environment: `current.mainnet.olympus.legacy.TokenMigrator`. |
| Ethereum Mainnet | `0x6d94b3745b0ecf908b3b467907b947b43fba5f15` | TempOHM | [Verified source](https://sourcify.dev/server/v2/contract/1/0x6d94b3745b0ecf908b3b467907b947b43fba5f15?fields=metadata): OwnedERC20. Environment: `current.mainnet.external.tokens.TempOHM`. Symbol: tempOHM. |
| Ethereum Mainnet | `0x31f8cc382c9898b273eff4e0b7626a6987c846e8` | TreasuryV2 (legacy) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x31f8cc382c9898b273eff4e0b7626a6987c846e8?fields=metadata): OlympusTreasury. Environment: `current.mainnet.olympus.legacy.TreasuryV2`. |
| Ethereum Mainnet | `0x9a72298ae3886221820b1c878d12d872087d3a23` | Chainlink OHM / ETH price feed | [Verified source](https://sourcify.dev/server/v2/contract/1/0x9a72298ae3886221820b1c878d12d872087d3a23?fields=metadata): EACAggregatorProxy. Environment: `current.mainnet.external.chainlink.ohmEthPriceFeed`. |
| Ethereum Mainnet | `0x773616e4d11a78f511299002da57a0a94577f1f4` | Chainlink DAI / ETH price feed | [Verified source](https://sourcify.dev/server/v2/contract/1/0x773616e4d11a78f511299002da57a0a94577f1f4?fields=metadata): EACAggregatorProxy. Environment: `current.mainnet.external.chainlink.daiEthPriceFeed`. |
| Ethereum Mainnet | `0xc0c293ce456ff0ed870add98a0828dd4d2903dbf` | AURA | [Verified source](https://sourcify.dev/server/v2/contract/1/0xc0c293ce456ff0ed870add98a0828dd4d2903dbf?fields=metadata): AuraToken. Environment: `current.mainnet.external.tokens.AURA`. Symbol: AURA. |
| Ethereum Mainnet | `0x744be650cea753de1e69bf6bad3c98490a855f52` | AuraMining | [Verified source](https://sourcify.dev/server/v2/contract/1/0x744be650cea753de1e69bf6bad3c98490a855f52?fields=metadata): AuraMining. Environment: `current.mainnet.external.aura.AuraMiningLib`. |
| Ethereum Mainnet | `0xba100000625a3754423978a60c9317c58a424e3d` | BAL | [Verified source](https://sourcify.dev/server/v2/contract/1/0xba100000625a3754423978a60c9317c58a424e3d?fields=metadata): BalancerGovernanceToken. Environment: `current.mainnet.external.tokens.BAL`. Symbol: BAL. |
| Ethereum Mainnet | `0x7fdd4e808ee9608f1b2f05157a2a8098e3d432cd` | BLVaultLido | [Verified source](https://sourcify.dev/server/v2/contract/1/0x7fdd4e808ee9608f1b2f05157a2a8098e3d432cd?fields=metadata): BLVaultLido. Environment: `current.mainnet.olympus.policies.BLVaultLido`. |
| Ethereum Mainnet | `0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0` | wstETH | [Verified source](https://sourcify.dev/server/v2/contract/1/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0?fields=metadata): WstETH. Environment: `current.mainnet.external.tokens.WSTETH`. Symbol: wstETH. |
| Ethereum Mainnet | `0x5af4a636cb097409bb524458ef24e7353a2f75df` | pOLY (legacy) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x5af4a636cb097409bb524458ef24e7353a2f75df?fields=metadata): InvestorClaimV2. Environment: `current.mainnet.olympus.legacy.OldPOLY`. |
| Ethereum Mainnet | `0x2d769de6905ff98a0aea7dd5ccb1c0cd449aa189` | GenesisClaim (legacy) | [Verified source](https://sourcify.dev/server/v2/contract/1/0x2d769de6905ff98a0aea7dd5ccb1c0cd449aa189?fields=metadata): GenesisClaim. |
| Ethereum Mainnet | `0xc84157c2306238c9330fea14774a82a53a127a59` | DelegateEscrowFactory | [Verified source](https://sourcify.dev/server/v2/contract/1/0xc84157c2306238c9330fea14774a82a53a127a59?fields=metadata): DelegateEscrowFactory. Environment: `current.mainnet.olympus.periphery.DelegateEscrowFactory`. |
| Ethereum Mainnet | `0xb4f84a6af50f02b66a5fb43f2e8852174340c6cf` | DelegateEscrow | [Verified source](https://sourcify.dev/server/v2/contract/1/0xb4f84a6af50f02b66a5fb43f2e8852174340c6cf?fields=metadata): DelegateEscrow. |
| Ethereum Mainnet | `0xd98b5b2e4d5d6cd554115de19efb7a9084beddd1` | ReceiptTokenManager | [Verified source](https://sourcify.dev/server/v2/contract/1/0xd98b5b2e4d5d6cd554115de19efb7a9084beddd1?fields=metadata): ReceiptTokenManager. Environment: `current.mainnet.olympus.periphery.ReceiptTokenManager`. |
| Ethereum Mainnet | `0xde3e735d37a8498ad2f141f603a6d0f976a6f772` | CoolerFactory | [Verified source](https://sourcify.dev/server/v2/contract/1/0xde3e735d37a8498ad2f141f603a6d0f976a6f772?fields=metadata): CoolerFactory. |
| Ethereum Mainnet | `0xfbb3742628e8d19e0e2d7d8dde208821c09de960` | BLVault LUSD | [Verified source](https://sourcify.dev/server/v2/contract/1/0xfbb3742628e8d19e0e2d7d8dde208821c09de960?fields=metadata): BLVaultLusd. Environment: `current.mainnet.olympus.policies.BLVaultLusd`. |
| Ethereum Mainnet | `0x5f98805a4e8be255a32880fdec7f6728c6568ba0` | LUSD | [Verified source](https://sourcify.dev/server/v2/contract/1/0x5f98805a4e8be255a32880fdec7f6728c6568ba0?fields=metadata): LUSDToken. Environment: `current.mainnet.external.tokens.LUSD`. Symbol: LUSD. |
| Ethereum Mainnet | `0x007fea32545a39ff558a1367bbbc1a22bc7abefd` | BondFixedExpirySDA | [Verified source](https://sourcify.dev/server/v2/contract/1/0x007fea32545a39ff558a1367bbbc1a22bc7abefd?fields=metadata): BondFixedExpirySDA. Environment: `current.mainnet.external.bond-protocol.BondFixedExpiryAuctioneer`. |
| Ethereum Mainnet | `0x007fe70dc9797c4198528ae43d8195fff82bdc95` | BondFixedExpiryTeller | [Verified source](https://sourcify.dev/server/v2/contract/1/0x007fe70dc9797c4198528ae43d8195fff82bdc95?fields=metadata): BondFixedExpiryTeller. Environment: `current.mainnet.external.bond-protocol.BondFixedExpiryTeller`. |
| Ethereum Mainnet | `0x0b7ffc1f4ad541a4ed16b40d8c37f0929158d101` | EasyAuction | [Verified source](https://sourcify.dev/server/v2/contract/1/0x0b7ffc1f4ad541a4ed16b40d8c37f0929158d101?fields=metadata): EasyAuction. Environment: `current.mainnet.external.gnosis.EasyAuction`. |
| Optimism | `0x3c2269811836af69497e5f486a85d7316753cf62` | LayerZero Endpoint V1 | [Verified source](https://sourcify.dev/server/v2/contract/10/0x3c2269811836af69497e5f486a85d7316753cf62?fields=metadata): Endpoint. Environment: `current.optimism.external.layerzero.endpoint`. |
| Base | `0x1a44076050125825900e736c501f859c50fe728c` | LayerZero Endpoint V2 | [Verified source](https://sourcify.dev/server/v2/contract/8453/0x1a44076050125825900e736c501f859c50fe728c?fields=metadata): EndpointV2. Environment: `current.base.external.layerzero-v2.endpoint`. |
| Base | `0xb6319cc6c8c27a8f5daf0dd3df91ea35c4720dd7` | LayerZero Endpoint V1 | [Verified source](https://sourcify.dev/server/v2/contract/8453/0xb6319cc6c8c27a8f5daf0dd3df91ea35c4720dd7?fields=metadata): Endpoint. Environment: `current.base.external.layerzero.endpoint`. |
| Arbitrum | `0x3c2269811836af69497e5f486a85d7316753cf62` | LayerZero Endpoint V1 | [Verified source](https://sourcify.dev/server/v2/contract/42161/0x3c2269811836af69497e5f486a85d7316753cf62?fields=metadata): Endpoint. Environment: `current.arbitrum.external.layerzero.endpoint`. |
| Arbitrum | `0x4999873bf8741bfffb0ec242aaaa7ef1fe74fce8` | SiloIncentivesController | [Verified source](https://sourcify.dev/server/v2/contract/42161/0x4999873bf8741bfffb0ec242aaaa7ef1fe74fce8?fields=metadata): SiloIncentivesController. |
| Arbitrum | `0x862da0a25e3dfe46df2cd4c14d79e1e4684dea4a` | Silo | [Verified source](https://sourcify.dev/server/v2/contract/42161/0x862da0a25e3dfe46df2cd4c14d79e1e4684dea4a?fields=metadata): Silo. |
| Arbitrum | `0x374d79ef2a75d5d25a4ce163d85ab0b579171d6c` | InterestRateModelV2 | [Verified source](https://sourcify.dev/server/v2/contract/42161/0x374d79ef2a75d5d25a4ce163d85ab0b579171d6c?fields=metadata): InterestRateModelV2. |
| Arbitrum | `0xbdb843c7a7e48dc543424474d7aa63b61b5d9536` | SiloLens | [Verified source](https://sourcify.dev/server/v2/contract/42161/0xbdb843c7a7e48dc543424474d7aa63b61b5d9536?fields=metadata): SiloLens. |
| Arbitrum | `0xd8102963c400fedbbc23fe92f1b09c0c561e77ae` | Silo OHM deposit token (sOHM) | [Verified source](https://sourcify.dev/server/v2/contract/42161/0xd8102963c400fedbbc23fe92f1b09c0c561e77ae?fields=metadata): ShareCollateralToken. Symbol: sOHM. |
| Arbitrum | `0x0341c0c0ec423328621788d4854119b97f44e391` | SILO | [Verified source](https://sourcify.dev/server/v2/contract/42161/0x0341c0c0ec423328621788d4854119b97f44e391?fields=metadata): ClonableBeaconProxy. Symbol: Silo. |
| Sepolia | `0xca59a85a9b87cba6c706d12e60c1cb4ea61e97c9` | DLGTE | [Verified source](https://sepolia.etherscan.io/address/0xca59a85a9b87cba6c706d12e60c1cb4ea61e97c9#code): OlympusGovDelegation. |
| Sepolia | `0xba05d48fb94dc76820eb7ea1b360fd6dfdeabdc5` | gOHM | [Verified source](https://sourcify.dev/server/v2/contract/11155111/0xba05d48fb94dc76820eb7ea1b360fd6dfdeabdc5?fields=metadata): gOHM. Symbol: gOHM. |
| Sepolia | `0x40a5f12ad1114608037ce80f028ddcf7c922ef07` | Staking | [Verified source](https://sepolia.etherscan.io/address/0x40a5f12ad1114608037ce80f028ddcf7c922ef07#code): OlympusStaking. |
| Sepolia | `0xcb22361599c259dfe92eb858232f94e41a0685cf` | MockFlashloanLender | [Verified source](https://sepolia.etherscan.io/address/0xcb22361599c259dfe92eb858232f94e41a0685cf#code): MockFlashloanLender. Environment: `current.sepolia.external.maker.flash`. |
| Sepolia | `0x89631595649cc6deba249a8012a5b2d88c8dde48` | sOHM | [Verified source](https://sourcify.dev/server/v2/contract/11155111/0x89631595649cc6deba249a8012a5b2d88c8dde48?fields=metadata): sOlympus. Symbol: sOHM. |
| Sepolia | `0x256a184f14ffd25d7aeecb768db473c16517e66b` | DelegateEscrowFactory | [Verified source](https://sourcify.dev/server/v2/contract/11155111/0x256a184f14ffd25d7aeecb768db473c16517e66b?fields=metadata): DelegateEscrowFactory. Environment: `current.sepolia.olympus.periphery.DelegateEscrowFactory`. |
| Sepolia | `0x6f448ea89cd897ad1aedb5cd8bf221d50b9a7c6c` | CoolerFactory | [Verified source](https://sourcify.dev/server/v2/contract/11155111/0x6f448ea89cd897ad1aedb5cd8bf221d50b9a7c6c?fields=metadata): CoolerFactory. Environment: `current.sepolia.external.cooler.CoolerFactory`. |
| Sepolia | `0x2c2a10ac552fd896725397e9811a2a1104cef457` | PositionTokenRenderer | [Verified source](https://sepolia.etherscan.io/address/0x2c2a10ac552fd896725397e9811a2a1104cef457#code): PositionTokenRenderer. Environment: `current.sepolia.olympus.periphery.PositionTokenRenderer`. |

### Remaining unknowns in available snapshots

- Mainnet `0x0000000000000000000000000000000000000020`: the invalid-looking
  immutable wrapped reserve documented above; no bytecode.
- Sepolia `0x007f7a1cb838a872515c8ebd16be4b14ef43a222`: configured as a
  BondFixedTermAuctioneer but has no code at block 11974150. Its Mainnet
  identity is not applied to Sepolia.
- Sepolia `0x1505f3ad833e9c82facd8b4d3ff4319b1ef6eb99` and
  `0xe02ccb6938fdb2fef07348ac0ae098fea883055b`: the role holders documented
  above; their operators remain unidentified.
- `0x3dc70606c76125282084dc37f6f7b1e3a1ce6a5e` on Optimism, Arbitrum, Base
  and Berachain stays unlabelled as requested.

This leaves eight unnamed chain/address pairs in the six snapshots. Other
chains were checked for configured CCIP endpoints, not refreshed snapshot
relationships. Robinhood's unresolved registry owner from the earlier audit
therefore remains a separate, previously reported unknown.
