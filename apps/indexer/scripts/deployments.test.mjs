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
});

test("Robinhood event anchors retain receipt blocks and actual block times", () => {
  assert.equal(getKernelConstants(4663).creationBlockNumber, 94168504);
  assert.equal(getKernelConstants(4663).creationTimestamp, 1792573917);
  assert.equal(getRolesConstants(4663).creationBlockNumber, 94168602);
  assert.equal(getRolesConstants(4663).creationTimestamp, 1792573927);
  assert.equal(getRolesAdminConstants(4663).creationBlockNumber, 94168691);
  assert.equal(getRolesAdminConstants(4663).creationTimestamp, 1792573936);
});
