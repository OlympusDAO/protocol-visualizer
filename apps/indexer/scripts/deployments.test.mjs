import assert from "node:assert/strict";
import { test } from "node:test";
import { getContractName, getContractType } from "../src/ContractNames.ts";
import {
  getKernelConstants,
  getRolesConstants,
  getRolesAdminConstants,
} from "../src/constants.ts";

test("deployment labels are chain-scoped and preserve existing history", () => {
  const sharedAddress = "0x02331a4c97a4841084df54d7c0ec04dd3f1a9f1c";
  assert.equal(getContractName(sharedAddress, 4663), "Kernel");
  assert.equal(getContractType(sharedAddress, 4663), "kernel");
  assert.equal(getContractName(sharedAddress, 1), "DEPOS");
  assert.equal(getContractName(sharedAddress, 12345), "UNKNOWN");
  assert.equal(
    getContractName("0x4b0BBa51cE44175a9766f7e55e3d122a9F4BE78E", 11155111),
    "Kernel"
  );
  assert.equal(
    getContractName("0xca6cd4f0a0033f8c20cf68d6df277e7001a386f9", 4663),
    "OlympusAuthority"
  );
  assert.equal(
    getContractName("0x2cea7b722dbd6b03f0e857d11e53ecb698cc2b4e", 1),
    "CCIPTokenPoolConfig"
  );
});

test("Robinhood event anchors retain receipt blocks and actual block times", () => {
  assert.equal(getKernelConstants(4663).creationBlockNumber, 94168504);
  assert.equal(getKernelConstants(4663).creationTimestamp, 1792573917);
  assert.equal(getRolesConstants(4663).creationBlockNumber, 94168602);
  assert.equal(getRolesConstants(4663).creationTimestamp, 1792573927);
  assert.equal(getRolesAdminConstants(4663).creationBlockNumber, 94168691);
  assert.equal(getRolesAdminConstants(4663).creationTimestamp, 1792573936);
});
