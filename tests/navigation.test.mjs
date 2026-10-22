import assert from "node:assert/strict";
import { test } from "node:test";
import "../apps/indexer/scripts/register-typescript.mjs";
const { parseGraphUrl, writeGraphUrl } = await import(
  "../apps/frontend/src/components/contract-visualizer/navigation.ts"
);

test("graph URLs restore a chain and normalize address identities", () => {
  assert.deepEqual(parseGraphUrl(new URL("https://example.test/")), {
    chainId: 1,
    node: null,
    notice: null,
  });
  assert.deepEqual(
    parseGraphUrl(
      new URL("https://example.test/?chain=4663&node=role-bridge_admin")
    ),
    {
      chainId: 4663,
      node: "role-bridge_admin",
      notice: null,
    }
  );
  assert.equal(
    parseGraphUrl(
      new URL(
        "https://example.test/?chain=1&node=0x0CF30DC0D48604A301DF8010CDC028C055336B2E"
      )
    ).node,
    "0x0cf30dc0d48604a301df8010cdc028c055336b2e"
  );
});

test("invalid URL parameters retain a usable chain overview", () => {
  const unsupported = parseGraphUrl(
    new URL("https://example.test/?chain=999&node=role-admin")
  );
  assert.equal(unsupported.chainId, 1);
  assert.equal(unsupported.node, null);
  assert.match(unsupported.notice, /chain/i);
  for (const node of ["0x123", "admin", "role-"]) {
    const parsed = parseGraphUrl(
      new URL(`https://example.test/?chain=4663&node=${node}`)
    );
    assert.equal(parsed.chainId, 4663);
    assert.equal(parsed.node, null);
    assert.match(parsed.notice, /selection/i);
  }
  assert.equal(
    parseGraphUrl(new URL("https://example.test/?chain=5")).chainId,
    5
  );
});

test("graph navigation preserves unrelated parameters, hashes and encoded role names", () => {
  const original = new URL(
    "https://example.test/view?preview=yes&chain=1&node=role-old#section"
  );
  const selected = writeGraphUrl(original, {
    chainId: 4663,
    node: "role-admin / special",
  });
  assert.equal(selected.searchParams.get("preview"), "yes");
  assert.equal(selected.hash, "#section");
  assert.equal(selected.pathname, "/view");
  assert.equal(parseGraphUrl(selected).node, "role-admin / special");
  assert.equal(original.searchParams.get("node"), "role-old");
  const cleared = writeGraphUrl(selected, { chainId: 1, node: null });
  assert.equal(cleared.searchParams.has("node"), false);
  assert.equal(cleared.searchParams.get("chain"), "1");
  assert.equal(cleared.searchParams.get("preview"), "yes");
});
