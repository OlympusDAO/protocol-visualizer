import http from "node:http";

const DEFAULT_PORT = 8080;
const DEFAULT_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";
const DEFAULT_MAX_URL_LENGTH = 32_768;
const DEFAULT_MAX_QUERY_LENGTH = 12_000;
const DEFAULT_MAX_VARIABLES_LENGTH = 4_000;
const HASURA_REQUEST_TIMEOUT_MS = 10_000;

const getRequiredEnv = (key) => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const getPositiveIntegerEnv = (key, defaultValue) => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer; received ${value}`);
  }

  return parsed;
};

const port = getPositiveIntegerEnv("PORT", DEFAULT_PORT);
const hasuraGraphqlUrl = getRequiredEnv("HASURA_GRAPHQL_URL");
const cacheControl =
  process.env.GRAPHQL_PROXY_CACHE_CONTROL || DEFAULT_CACHE_CONTROL;
const corsOrigin = process.env.GRAPHQL_PROXY_CORS_ORIGIN || "*";
const maxUrlLength = getPositiveIntegerEnv(
  "GRAPHQL_PROXY_MAX_URL_LENGTH",
  DEFAULT_MAX_URL_LENGTH
);
const maxQueryLength = getPositiveIntegerEnv(
  "GRAPHQL_PROXY_MAX_QUERY_LENGTH",
  DEFAULT_MAX_QUERY_LENGTH
);
const maxVariablesLength = getPositiveIntegerEnv(
  "GRAPHQL_PROXY_MAX_VARIABLES_LENGTH",
  DEFAULT_MAX_VARIABLES_LENGTH
);

const sendJson = (response, statusCode, body, extraHeaders = {}) => {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "access-control-allow-origin": corsOrigin,
    vary: "origin",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
};

const sendOptions = (response) => {
  response.writeHead(204, {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  });
  response.end();
};

const isGraphqlPath = (path) => path === "/graphql";

const forwardGraphqlGet = async (request, response, requestUrl) => {
  if (request.url.length > maxUrlLength) {
    sendJson(response, 414, { error: "URL is too long" });
    return;
  }

  const query = requestUrl.searchParams.get("query");
  if (!query) {
    sendJson(response, 400, { error: "Missing GraphQL query parameter" });
    return;
  }

  if (query.length > maxQueryLength) {
    sendJson(response, 413, { error: "GraphQL query is too long" });
    return;
  }

  const variables = requestUrl.searchParams.get("variables") || "";
  if (variables.length > maxVariablesLength) {
    sendJson(response, 413, { error: "GraphQL variables are too long" });
    return;
  }

  let parsedVariables;
  if (variables) {
    try {
      parsedVariables = JSON.parse(variables);
    } catch {
      sendJson(response, 400, {
        error: "GraphQL variables must be valid JSON",
      });
      return;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, HASURA_REQUEST_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(hasuraGraphqlUrl, {
      method: "POST",
      headers: {
        accept: request.headers.accept || "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: parsedVariables,
        operationName: requestUrl.searchParams.get("operationName"),
      }),
      signal: controller.signal,
    });

    const responseBody = await upstreamResponse.text();
    const contentType = upstreamResponse.headers.get("content-type");
    let hasGraphqlErrors = false;

    if (contentType?.includes("application/json")) {
      try {
        const payload = JSON.parse(responseBody);
        hasGraphqlErrors =
          Array.isArray(payload?.errors) && payload.errors.length > 0;
      } catch {
        hasGraphqlErrors = true;
      }
    }

    const headers = {
      "access-control-allow-origin": corsOrigin,
      vary: "origin",
      "cache-control":
        upstreamResponse.ok && !hasGraphqlErrors ? cacheControl : "no-store",
    };
    if (contentType) {
      headers["content-type"] = contentType;
    }

    response.writeHead(upstreamResponse.status, headers);
    response.end(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 502, { error: `Hasura request failed: ${message}` });
  } finally {
    clearTimeout(timeout);
  }
};

const server = http.createServer((request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
  } catch {
    sendJson(response, 400, { error: "Invalid request URL" });
    return;
  }

  if (requestUrl.pathname === "/ready") {
    sendJson(response, 200, { ok: true }, { "cache-control": "no-store" });
    return;
  }

  if (!isGraphqlPath(requestUrl.pathname)) {
    sendJson(
      response,
      404,
      { error: "Not found" },
      { "cache-control": "no-store" }
    );
    return;
  }

  if (request.method === "OPTIONS") {
    sendOptions(response);
    return;
  }

  if (request.method !== "GET") {
    sendJson(
      response,
      405,
      { error: "GraphQL proxy only accepts GET requests" },
      { allow: "GET, OPTIONS", "cache-control": "no-store" }
    );
    return;
  }

  void forwardGraphqlGet(request, response, requestUrl);
});

server.listen(port, "::", () => {
  console.log(`GraphQL proxy listening on port ${port}`);
});

server.on("error", (error) => {
  console.error(`GraphQL proxy failed: ${error.message}`);
  process.exit(1);
});
