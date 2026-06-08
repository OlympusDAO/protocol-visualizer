import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOpenApiDocument,
  deploymentArtifactKey,
  parseDeploymentId,
  restProtocolPath,
  sanitizeManifestForPublic,
  SCHEMA_VERSION,
  type SnapshotManifest,
} from "../src/index.js";

test("builds deployment-scoped artifact keys and REST paths", () => {
  assert.equal(
    deploymentArtifactKey("abc123", 1),
    "v1/deployments/abc123/chain/1/protocol.json"
  );
  assert.equal(restProtocolPath(1), "/v1/chains/1/protocol");
});

test("validates deployment ids before they become object keys", () => {
  assert.equal(parseDeploymentId("abc-123_4.5"), "abc-123_4.5");
  assert.throws(() => parseDeploymentId(""), /required/);
  assert.throws(() => parseDeploymentId("../bad"), /may contain only/);
  assert.throws(() => parseDeploymentId("bad/slash"), /may contain only/);
});

test("removes internal handover details from public manifest", () => {
  const manifest: SnapshotManifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-06-05T00:00:00.000Z",
    schemas: {
      openapi: "/v1/openapi.json",
      manifest: "/v1/manifest",
      protocolSnapshot: "/v1/chains/{chainId}/protocol",
    },
    chains: [],
    indexerDeploymentId: "secret",
    artifacts: { "1": "v1/deployments/secret/chain/1/protocol.json" },
  };

  assert.deepEqual(sanitizeManifestForPublic(manifest), {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "2026-06-05T00:00:00.000Z",
    schemas: manifest.schemas,
    chains: [],
  });
});

test("generates the REST OpenAPI document", () => {
  const openapi = createOpenApiDocument();
  assert.equal(openapi.openapi, "3.1.0");
  assert.deepEqual(Object.keys(openapi.paths).sort(), [
    "/ready",
    "/v1/bounds",
    "/v1/chains",
    "/v1/chains/{chainId}/protocol",
    "/v1/manifest",
    "/v1/openapi.json",
  ]);
});
