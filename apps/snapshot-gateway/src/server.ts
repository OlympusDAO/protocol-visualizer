import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  ACTIVE_MANIFEST_KEY,
  createOpenApiDocument,
  deploymentArtifactKey,
  restProtocolPath,
  sanitizeManifestForPublic,
  SCHEMA_VERSION,
  type BoundsResponse,
  type SnapshotManifest,
} from "@protocol-visualizer/snapshot-artifacts";

type ChainConfig = {
  key: string;
  chainId: number;
  name: string;
  explorerBaseUrl: string;
};

export type ObjectReader = {
  getObject: (key: string) => Promise<{ body: string; contentLength?: number }>;
  headObject: (key: string) => Promise<void>;
};

export type GatewayConfig = {
  reader: ObjectReader;
  chains: ChainConfig[];
  openapiPath: string;
};

const defaultChainsPath = "config/protocol-chains.json";

const requiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};

const objectBodyToString = async (body: unknown): Promise<string> => {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (
    body &&
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return body.transformToString();
  }
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
};

export function createS3Reader(): ObjectReader {
  const bucket = requiredEnv("BUCKET");
  const client = new S3Client({
    region: requiredEnv("REGION"),
    endpoint: requiredEnv("ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv("ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("SECRET_ACCESS_KEY"),
    },
  });

  return {
    getObject: async (key) => {
      const output = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      return {
        body: await objectBodyToString(output.Body),
        contentLength:
          typeof output.ContentLength === "number"
            ? output.ContentLength
            : undefined,
      };
    },
    headObject: async (key) => {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export async function loadChains(
  configPath = process.env.PROTOCOL_CHAINS_CONFIG_PATH || defaultChainsPath
) {
  const chains = JSON.parse(
    await readFile(configPath, "utf8")
  ) as ChainConfig[];
  if (!Array.isArray(chains) || chains.length === 0) {
    throw new Error("protocol chain config is empty");
  }
  return chains;
}

export async function loadGatewayConfig(): Promise<GatewayConfig> {
  return {
    reader: createS3Reader(),
    chains: await loadChains(),
    openapiPath: join(process.cwd(), "openapi.json"),
  };
}

const hasRequestBody = (request: IncomingMessage): boolean => {
  const contentLength = request.headers["content-length"];
  if (Array.isArray(contentLength)) {
    return contentLength.some((value) => Number(value) > 0);
  }
  if (contentLength !== undefined && Number(contentLength) > 0) return true;
  return request.headers["transfer-encoding"] !== undefined;
};

const send = (
  response: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  cacheControl = "no-store"
) => {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
  });
  response.end(body);
};

const sendJson = (
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  value: unknown,
  cacheControl = "no-store"
) => {
  const body = request.method === "HEAD" ? "" : `${JSON.stringify(value)}\n`;
  send(response, status, body, "application/json", cacheControl);
};

const isAllowedMethod = (method: string | undefined) =>
  method === "GET" || method === "HEAD" || method === "OPTIONS";

const assertNoQuery = (url: URL) => {
  for (const key of url.searchParams.keys()) {
    throw new Error(`unsupported query parameter: ${key}`);
  }
};

const parseUrl = (request: IncomingMessage): URL => {
  try {
    return new URL(request.url || "/", "http://snapshot-gateway.local");
  } catch {
    throw new Error("invalid_request_url");
  }
};

const readManifest = async (reader: ObjectReader): Promise<SnapshotManifest> =>
  JSON.parse(
    (await reader.getObject(ACTIVE_MANIFEST_KEY)).body
  ) as SnapshotManifest;

class ActiveManifestNotReadyError extends Error {
  constructor(readonly issues: string[]) {
    super("active manifest is not ready");
  }
}

const activeManifestIssues = (manifest: SnapshotManifest): string[] => {
  const issues: string[] = [];

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    issues.push("manifest schemaVersion is unsupported");
  }
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    issues.push("manifest generatedAt is invalid");
  }
  if (!manifest.indexerDeploymentId) {
    issues.push("manifest is missing indexerDeploymentId");
  }
  if (!manifest.indexingProgress) {
    issues.push("manifest is missing indexingProgress");
  }
  if (manifest.schemas?.openapi !== "/v1/openapi.json") {
    issues.push("manifest is missing REST OpenAPI schema URL");
  }
  if (manifest.schemas?.manifest !== "/v1/manifest") {
    issues.push("manifest is missing REST manifest schema URL");
  }
  if (manifest.schemas?.protocolSnapshot !== "/v1/chains/{chainId}/protocol") {
    issues.push("manifest is missing REST protocol snapshot schema URL");
  }
  if (!manifest.artifacts || Object.keys(manifest.artifacts).length === 0) {
    issues.push("manifest is missing deployment artifact references");
  }
  if (!Array.isArray(manifest.chains) || manifest.chains.length === 0) {
    issues.push("manifest chains are missing");
    return issues;
  }

  for (const chain of manifest.chains) {
    if (chain.path !== restProtocolPath(chain.chainId)) {
      issues.push(`chain ${chain.chainId} path is not a REST route`);
    }
    if (!activeArtifactKeyForChain(manifest, chain.chainId)) {
      issues.push(`chain ${chain.chainId} artifact is missing`);
    }
  }

  return issues;
};

const assertActiveManifest = (manifest: SnapshotManifest) => {
  const issues = activeManifestIssues(manifest);
  if (issues.length > 0) {
    throw new ActiveManifestNotReadyError(issues);
  }
};

const verifyActiveManifestArtifacts = async (
  reader: ObjectReader,
  manifest: SnapshotManifest
): Promise<string[]> => {
  const issues = activeManifestIssues(manifest);
  if (issues.length > 0) return issues;

  for (const chain of manifest.chains) {
    const key = activeArtifactKeyForChain(manifest, chain.chainId);
    if (!key) {
      issues.push(`chain ${chain.chainId} artifact is missing`);
      continue;
    }
    try {
      await reader.headObject(key);
    } catch {
      issues.push(`chain ${chain.chainId} artifact is not accessible`);
    }
  }

  return issues;
};

const activeArtifactKeyForChain = (
  manifest: SnapshotManifest,
  chainId: number
) => {
  const artifactKey = manifest.artifacts?.[String(chainId)];
  if (artifactKey) return artifactKey;
  if (!manifest.indexerDeploymentId) return undefined;
  return deploymentArtifactKey(manifest.indexerDeploymentId, chainId);
};

const publicIndexHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Protocol Visualizer Snapshot API</title></head>
  <body>
    <main>
      <h1>Protocol Visualizer Snapshot API</h1>
      <ul>
        <li><a href="/v1/openapi.json">OpenAPI</a></li>
        <li><a href="/v1/bounds">Bounds</a></li>
        <li><a href="/v1/manifest">Manifest</a></li>
        <li><a href="/v1/chains">Chains</a></li>
      </ul>
    </main>
  </body>
</html>
`;

export function createSnapshotGateway(config: GatewayConfig) {
  const allowedChains = new Map(
    config.chains.map((chain) => [chain.chainId, chain])
  );

  return async (request: IncomingMessage, response: ServerResponse) => {
    if (!isAllowedMethod(request.method)) {
      response.setHeader("allow", "GET, HEAD, OPTIONS");
      sendJson(request, response, 405, { error: "method not allowed" });
      return;
    }
    if (hasRequestBody(request)) {
      sendJson(request, response, 400, { error: "request body not allowed" });
      return;
    }

    let url: URL;
    try {
      url = parseUrl(request);
      assertNoQuery(url);
    } catch (error) {
      sendJson(request, response, 400, {
        error: error instanceof Error ? error.message : "invalid_request_url",
      });
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        allow: "GET, HEAD, OPTIONS",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "Accept",
        "access-control-max-age": "86400",
      });
      response.end();
      return;
    }

    try {
      if (url.pathname === "/") {
        send(
          response,
          200,
          request.method === "HEAD" ? "" : publicIndexHtml,
          "text/html; charset=utf-8",
          "public, s-maxage=300, stale-while-revalidate=3600"
        );
        return;
      }

      if (url.pathname === "/ready") {
        const manifest = await readManifest(config.reader);
        const issues = await verifyActiveManifestArtifacts(
          config.reader,
          manifest
        );
        if (issues.length > 0) {
          sendJson(request, response, 503, {
            ok: false,
            error: "active manifest is not ready",
            issues,
          });
          return;
        }
        sendJson(request, response, 200, { ok: true });
        return;
      }

      if (url.pathname === "/v1/openapi.json") {
        try {
          const body = await readFile(config.openapiPath, "utf8");
          send(
            response,
            200,
            request.method === "HEAD" ? "" : body,
            "application/json",
            "public, max-age=300"
          );
          return;
        } catch {
          sendJson(
            request,
            response,
            200,
            createOpenApiDocument(),
            "public, max-age=300"
          );
          return;
        }
      }

      const manifest = await readManifest(config.reader);
      assertActiveManifest(manifest);
      if (url.pathname === "/v1/bounds") {
        const bounds: BoundsResponse = {
          generatedAt: manifest.generatedAt,
          ...(manifest.indexingProgress
            ? { indexingProgress: manifest.indexingProgress }
            : {}),
        };
        sendJson(
          request,
          response,
          200,
          { data: bounds },
          "public, s-maxage=300, stale-while-revalidate=3600"
        );
        return;
      }

      if (url.pathname === "/v1/manifest") {
        sendJson(
          request,
          response,
          200,
          sanitizeManifestForPublic(manifest),
          "public, s-maxage=300, stale-while-revalidate=3600"
        );
        return;
      }

      if (url.pathname === "/v1/chains") {
        sendJson(
          request,
          response,
          200,
          {
            data: manifest.chains.map((chain) => ({
              ...chain,
              path: restProtocolPath(chain.chainId),
            })),
          },
          "public, s-maxage=300, stale-while-revalidate=3600"
        );
        return;
      }

      const match = url.pathname.match(/^\/v1\/chains\/([0-9]+)\/protocol$/);
      if (match) {
        const chainId = Number(match[1]);
        if (!allowedChains.has(chainId)) {
          sendJson(request, response, 404, { error: "chain not found" });
          return;
        }
        const key = activeArtifactKeyForChain(manifest, chainId);
        if (!key) {
          sendJson(request, response, 404, { error: "snapshot not found" });
          return;
        }
        const object = await config.reader.getObject(key);
        send(
          response,
          200,
          request.method === "HEAD" ? "" : object.body,
          "application/json",
          "public, s-maxage=3600, stale-while-revalidate=86400"
        );
        return;
      }

      sendJson(request, response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof ActiveManifestNotReadyError) {
        sendJson(request, response, 503, {
          error: "active manifest is not ready",
          issues: error.issues,
        });
        return;
      }
      if (url.pathname === "/ready") {
        sendJson(request, response, 503, {
          ok: false,
          error: "manifest not accessible",
        });
        return;
      }
      sendJson(request, response, 502, {
        error: "snapshot backend unavailable",
      });
    }
  };
}
