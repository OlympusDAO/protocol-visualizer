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
