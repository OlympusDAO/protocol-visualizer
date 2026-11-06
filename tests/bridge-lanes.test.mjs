import assert from "node:assert/strict";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
const {
  getBridgeLanes,
  evmAddress,
  getBridgeCirclePositions,
  getBridgeLaneCurve,
} = await import("../apps/frontend/src/components/bridge-lanes/model.ts");
const { createProtocolSnapshot, validateProtocolSnapshot } = await import(
  "../apps/snapshot-publisher/dist/src/snapshot.js"
);
const { readSnapshotData } = await import(
  "../packages/snapshot-artifacts/src/index.ts"
);
const address = (digit) => `0x${digit.repeat(40)}`;
const block = {
  number: "10",
  timestamp: "1700000000",
  hash: `0x${"a".repeat(64)}`,
};
const selectors = ["5009297550715157269", "4949039107694359620"];
const unlimited = { isEnabled: false, capacity: "0", rate: "0" };
function fixture() {
  const pair = [1, 42161].map((chainId, index) => {
    const pool = address(String(index + 1)),
      bridge = address(String(index + 3)),
      token = address(String(index + 5)),
      router = address(String(index + 7));
    const remotePool = address(String(2 - index)),
      remoteBridge = address(String(4 - index)),
      remoteToken = address(String(6 - index));
    const config = (kind) => ({
      id: `${chainId}:${kind === "pool" ? pool : bridge}`,
      chainId,
      address: kind === "pool" ? pool : bridge,
      kind,
      configuration: {
        token,
        router,
        codeHash: block.hash,
        allowList: null,
        routes: [
          {
            selector: selectors[1 - index],
            routerSupported: true,
            ...(kind === "pool"
              ? {
                  remoteToken: `0x${remoteToken.slice(2).padStart(64, "0")}`,
                  remotePools: [remotePool],
                  outbound: { ...unlimited },
                  inbound: { ...unlimited },
                }
              : { trustedRemote: remoteBridge }),
          },
        ],
      },
      selectors: [],
      observedAt: block,
      lastChange: null,
      verification: { outcome: "match", block },
    });
    return [
      chainId,
      {
        contracts: [],
        additionalContracts: [],
        roleAssignments: [],
        roles: [],
        periodicTasks: [],
        observation: { chainId, indexedThrough: block },
        relationships: [
          {
            kind: "registered-pool",
            value: pool,
            scope: { token },
            verification: { outcome: "match" },
            indexedThrough: block,
          },
        ],
        contractStates: [pool, bridge].map((address) => ({
          address,
          enabled: true,
          enablerCapability: "supported",
          kernelMembership: "active",
        })),
        bridgeConfigurations: [config("pool"), config("bridge")],
      },
    ];
  });
  return new Map(pair);
}
test("mesh nodes share a circle without overlapping and opposite lanes have separate curves", () => {
  for (const count of [3, 6, 7, 9]) {
    const positions = getBridgeCirclePositions(count);
    const radius = Math.max(240, count * 42);
    for (const point of positions)
      assert.ok(
        Math.abs(
          Math.hypot(point.x + 115 - radius - 140, point.y + 55 - radius - 70) -
            radius
        ) < 0.001
      );
    for (let i = 0; i < positions.length; i++)
      for (let j = i + 1; j < positions.length; j++)
        assert.ok(
          Math.abs(positions[i].x - positions[j].x) >= 230 ||
            Math.abs(positions[i].y - positions[j].y) >= 110
        );
  }
  const forward = getBridgeLaneCurve(0, 0, 300, 0, 44);
  const reverse = getBridgeLaneCurve(300, 0, 0, 0, 44);
  assert.ok(Math.abs(forward.labelY - reverse.labelY) >= 40);
});
test("lane checks are directional, accept packed/ABI pool identifiers, and distinguish unlimited from blocked", () => {
  const snapshots = fixture();
  assert.deepEqual(
    getBridgeLanes(snapshots).map((lane) => lane.status),
    ["configured", "configured"]
  );
  assert.equal(
    evmAddress(`0x${address("1").slice(2).padStart(64, "0")}`),
    address("1")
  );
  assert.equal(evmAddress("0x1234"), null);
  snapshots.get(1).bridgeConfigurations[0].configuration.routes[0].outbound = {
    isEnabled: true,
    capacity: "0",
    rate: "0",
  };
  const lanes = getBridgeLanes(snapshots);
  assert.equal(
    lanes.find((lane) => lane.source.chainId === 1).status,
    "blocked"
  );
  assert.equal(
    lanes.find((lane) => lane.source.chainId === 42161).status,
    "configured"
  );
  snapshots.get(1).bridgeConfigurations[0].configuration.routes[0].outbound =
    unlimited;
  snapshots.get(
    42161
  ).bridgeConfigurations[0].configuration.routes[0].remotePools = [];
  assert.equal(
    getBridgeLanes(snapshots).find((lane) => lane.source.chainId === 1).status,
    "blocked"
  );
  assert.equal(
    getBridgeLanes(snapshots).find((lane) => lane.source.chainId === 42161)
      .status,
    "configured"
  );
});
test("missing snapshots, stale configuration, disabled endpoints and mismatched trusted remotes remain explicit", () => {
  const snapshots = fixture();
  const missing = new Map([[1, snapshots.get(1)]]);
  assert.equal(getBridgeLanes(missing)[0].status, "unknown");
  const peer = snapshots.get(1).bridgeConfigurations[1].configuration.routes[0];
  const savedPeer = peer.trustedRemote;
  peer.trustedRemote = null;
  assert.equal(getBridgeLanes(missing)[0].status, "blocked");
  peer.trustedRemote = savedPeer;
  snapshots.get(1).bridgeConfigurations[0].lastChange = {
    ...block,
    number: "11",
  };
  assert.equal(getBridgeLanes(snapshots)[0].status, "unknown");
  snapshots.get(1).bridgeConfigurations[0].lastChange = null;
  snapshots.get(
    42161
  ).bridgeConfigurations[1].configuration.routes[0].trustedRemote =
    address("9");
  assert.ok(
    getBridgeLanes(snapshots)[0].blockers.some((reason) =>
      reason.includes("trusted remote")
    )
  );
  snapshots.get(1).contractStates[1].enabled = false;
  assert.ok(
    getBridgeLanes(snapshots)[0].blockers.includes("Source bridge is disabled.")
  );
});
test("Solana is named without inventing an indexed EVM destination", () => {
  const data = fixture().get(1);
  for (const config of data.bridgeConfigurations)
    config.configuration.routes[0].selector = "124615329519749607";
  const lanes = getBridgeLanes(new Map([[1, data]]));
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].destinationName, "Solana");
  assert.equal(lanes[0].destination, null);
  assert.equal(lanes[0].status, "unknown");
});
test("a registration disagreement cannot become a configured or definitely blocked lane", () => {
  const snapshots = fixture();
  snapshots.get(42161).relationships[0].verification.outcome = "mismatch";
  snapshots.get(1).contractStates[0].enabled = false;
  const lane = getBridgeLanes(snapshots).find(
    (lane) => lane.source.chainId === 1
  );
  assert.equal(lane.status, "unknown");
  assert.ok(lane.unknowns.some((reason) => reason.includes("disagrees")));
});
test("bridge observations round-trip through snapshots and legacy snapshots default to unknown coverage", () => {
  const row = fixture().get(1).bridgeConfigurations[0];
  const snapshot = createProtocolSnapshot({
    chainId: 1,
    generatedAt: new Date().toISOString(),
    graphqlData: { BridgeConfiguration: [row] },
  });
  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
  assert.deepEqual(readSnapshotData(snapshot).bridgeConfigurations, [row]);
  delete snapshot.data.bridgeConfigurations;
  assert.deepEqual(readSnapshotData(snapshot).bridgeConfigurations, []);
  assert.deepEqual(validateProtocolSnapshot(snapshot), []);
});
