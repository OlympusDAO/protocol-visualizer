#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  processAbiMetadata,
  processVerifiedContractMetadata,
} from "../apps/indexer/src/services/contracts/abi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const indexerRoot = path.join(repoRoot, "apps", "indexer");
const contractNamesPath = path.join(indexerRoot, "src", "ContractNames.ts");
const constantsPath = path.join(indexerRoot, "src", "constants.ts");
const cachePath = path.join(indexerRoot, "data", "contract-cache.json");
const outputPath = path.join(
  indexerRoot,
  "src",
  "generated",
  "contract-metadata.json"
);
const etherscanBaseUrl = "https://api.etherscan.io/v2/api";
const roleRolesAdmin = "RolesAdmin";
loadDotEnv(path.join(repoRoot, ".env"));
loadDotEnv(path.join(indexerRoot, ".env"));
const etherscanMaxRetries = readPositiveIntegerEnv("ETHERSCAN_MAX_RETRIES", 5);
const etherscanRetryBaseDelayMs = readPositiveIntegerEnv(
  "ETHERSCAN_RETRY_BASE_DELAY_MS",
  1_000
);
const etherscanRateLimitDelayMs = readPositiveIntegerEnv(
  "ETHERSCAN_RATE_LIMIT_DELAY_MS",
  10_000
);
const etherscanMinRequestIntervalMs = readPositiveIntegerEnv(
  "ETHERSCAN_MIN_REQUEST_INTERVAL_MS",
  250
);
let lastEtherscanRequestAt = 0;

const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));
// TypeScript 7's native compiler does not expose this JavaScript AST API.
const ts = requireFromRepo("@typescript/typescript6");

const cliOptions = parseArgs(process.argv.slice(2));

function parseArgs(args) {
  const options = {
    chainId: undefined,
    address: undefined,
    name: undefined,
    force: false,
    includeUnknownType: false,
    cacheOnly: false,
    verifiedSource: undefined,
    refreshGetters: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--refresh-getters") {
      options.refreshGetters = true;
      continue;
    }
    if (arg === "--verified-source") {
      index += 1;
      options.verifiedSource = readRequiredArg(args, index, arg);
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--include-unknown-type") {
      options.includeUnknownType = true;
      continue;
    }
    if (arg === "--cache-only") {
      options.cacheOnly = true;
      continue;
    }
    if (arg === "--chain-id") {
      index += 1;
      options.chainId = readRequiredArg(args, index, arg);
      continue;
    }
    if (arg === "--address") {
      index += 1;
      options.address = readRequiredArg(args, index, arg).toLowerCase();
      continue;
    }
    if (arg === "--name") {
      index += 1;
      options.name = readRequiredArg(args, index, arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.chainId !== undefined && !/^\d+$/.test(options.chainId)) {
    throw new Error(`--chain-id must be numeric; received ${options.chainId}`);
  }

  return options;
}

function readRequiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readPositiveIntegerEnv(key, defaultValue) {
  const rawValue = process.env[key];
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer; received ${rawValue}`);
  }

  return value;
}

function loadDotEnv(envPath) {
  if (!existsSync(envPath)) return;

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForEtherscanRequestSlot() {
  const elapsedMs = Date.now() - lastEtherscanRequestAt;
  if (elapsedMs < etherscanMinRequestIntervalMs) {
    await sleep(etherscanMinRequestIntervalMs - elapsedMs);
  }
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, childValue]) => [key, sortObject(childValue)])
  );
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function formatOutputFile() {
  const result = spawnSync(
    "pnpm",
    ["exec", "biome", "format", "--write", path.relative(repoRoot, outputPath)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["inherit", "pipe", "pipe"],
    }
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    console.warn("Generated metadata, but Biome formatting failed.");
  }
}

function getPropertyName(node, chainIdByName) {
  if (ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) {
    return node.name.text;
  }
  if (ts.isComputedPropertyName(node.name)) {
    const expression = node.name.expression;
    if (ts.isPropertyAccessExpression(expression)) {
      const left = expression.expression;
      if (ts.isIdentifier(left) && left.text === "ChainId") {
        return String(chainIdByName.get(expression.name.text));
      }
    }
    if (ts.isNumericLiteral(expression) || ts.isStringLiteral(expression)) {
      return expression.text;
    }
  }
  return undefined;
}

function getLiteralValue(expression) {
  if (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  return undefined;
}

function parseChainIds() {
  const source = ts.createSourceFile(
    constantsPath,
    readFileSync(constantsPath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const chainIdByName = new Map();

  for (const statement of source.statements) {
    if (!ts.isEnumDeclaration(statement) || statement.name.text !== "ChainId") {
      continue;
    }

    for (const member of statement.members) {
      if (!ts.isIdentifier(member.name) || !member.initializer) {
        continue;
      }

      const value = getLiteralValue(member.initializer);
      if (value !== undefined) {
        chainIdByName.set(member.name.text, Number(value));
      }
    }
  }

  return chainIdByName;
}

function parseContractNames() {
  const chainIdByName = parseChainIds();
  const source = ts.createSourceFile(
    contractNamesPath,
    readFileSync(contractNamesPath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const contracts = [];

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "contractNames" ||
        !declaration.initializer ||
        !ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        continue;
      }

      for (const chainProperty of declaration.initializer.properties) {
        if (
          !ts.isPropertyAssignment(chainProperty) ||
          !ts.isObjectLiteralExpression(chainProperty.initializer)
        ) {
          continue;
        }

        const chainId = getPropertyName(chainProperty, chainIdByName);
        if (!chainId) continue;

        for (const contractProperty of chainProperty.initializer.properties) {
          if (
            !ts.isPropertyAssignment(contractProperty) ||
            !ts.isObjectLiteralExpression(contractProperty.initializer)
          ) {
            continue;
          }

          const address = getPropertyName(contractProperty, chainIdByName);
          if (!address?.startsWith("0x")) continue;

          const details = {};
          for (const detailProperty of contractProperty.initializer
            .properties) {
            if (!ts.isPropertyAssignment(detailProperty)) continue;
            const key = getPropertyName(detailProperty, chainIdByName);
            const value = getLiteralValue(detailProperty.initializer);
            if (key && value !== undefined) {
              details[key] = value;
            }
          }

          if (!details.name) continue;
          contracts.push({
            chainId,
            address,
            normalizedAddress: address.toLowerCase(),
            name: details.name,
            type: details.type,
          });
        }
      }
    }
  }

  return contracts;
}

function isLikelyModuleName(name) {
  return /^[A-Z]{5}$/.test(name);
}

function shouldFetchContract(contract) {
  if (cliOptions.chainId && contract.chainId !== cliOptions.chainId) {
    return false;
  }
  if (
    cliOptions.address &&
    contract.normalizedAddress !== cliOptions.address.toLowerCase()
  ) {
    return false;
  }
  if (cliOptions.name && contract.name !== cliOptions.name) {
    return false;
  }
  return Boolean(
    cliOptions.includeUnknownType ||
      contract.type ||
      isLikelyModuleName(contract.name)
  );
}

function isEmptyMetadataEntry(entry) {
  return (
    !entry ||
    (Object.keys(entry.functionSelectors ?? {}).length === 0 &&
      Object.keys(entry.roleToFunctions ?? {}).length === 0)
  );
}

async function fetchEtherscanResult(params) {
  const url = `${etherscanBaseUrl}?${params.toString()}`;
  let lastError;

  for (let attempt = 1; attempt <= etherscanMaxRetries; attempt += 1) {
    try {
      await waitForEtherscanRequestSlot();
      const response = await fetch(url);
      lastEtherscanRequestAt = Date.now();

      if (!response.ok) {
        const retryDelayMs = getHttpRetryDelayMs(response, attempt);
        if (retryDelayMs !== undefined && attempt < etherscanMaxRetries) {
          console.warn(
            `Etherscan HTTP ${response.status}; retrying in ${retryDelayMs}ms (${attempt}/${etherscanMaxRetries})`
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw new Error(`Etherscan HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.status !== "1") {
        const message = formatEtherscanApiError(data);
        if (isRateLimitResponse(data) && attempt < etherscanMaxRetries) {
          const retryDelayMs = getBackoffDelayMs(attempt, {
            minimumDelayMs: etherscanRateLimitDelayMs,
          });
          console.warn(
            `${message}; retrying in ${retryDelayMs}ms (${attempt}/${etherscanMaxRetries})`
          );
          await sleep(retryDelayMs);
          continue;
        }
        throw new Error(message);
      }

      return data.result;
    } catch (error) {
      lastError = error;
      if (attempt >= etherscanMaxRetries || !isRetryableNetworkError(error)) {
        throw error;
      }

      const retryDelayMs = getBackoffDelayMs(attempt);
      console.warn(
        `Etherscan request failed: ${error.message}; retrying in ${retryDelayMs}ms (${attempt}/${etherscanMaxRetries})`
      );
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new Error("Etherscan request failed");
}

function formatEtherscanApiError(data) {
  return `Etherscan API error: ${data.message}${data.result ? ` (${data.result})` : ""}`;
}

function isRateLimitResponse(data) {
  const text = `${data.message ?? ""} ${data.result ?? ""}`.toLowerCase();
  return (
    text.includes("rate limit") ||
    text.includes("max rate") ||
    text.includes("too many") ||
    text.includes("temporarily unavailable")
  );
}

function getHttpRetryDelayMs(response, attempt) {
  if (response.status !== 429 && response.status < 500) {
    return undefined;
  }

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1_000);
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
      return Math.max(retryAt - Date.now(), etherscanRetryBaseDelayMs);
    }
  }

  return getBackoffDelayMs(attempt, {
    minimumDelayMs:
      response.status === 429 ? etherscanRateLimitDelayMs : undefined,
  });
}

function getBackoffDelayMs(attempt, { minimumDelayMs = 0 } = {}) {
  const exponentialDelayMs = etherscanRetryBaseDelayMs * 2 ** (attempt - 1);
  return Math.max(exponentialDelayMs, minimumDelayMs);
}

function isRetryableNetworkError(error) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("socket")
  );
}

async function fetchContractAbi(chainId, address) {
  const result = await fetchEtherscanResult(
    new URLSearchParams({
      chainid: chainId,
      module: "contract",
      action: "getabi",
      address,
      apikey: process.env.ETHERSCAN_API_KEY,
    })
  );

  return JSON.parse(result);
}

async function fetchContractSourceCode(chainId, address) {
  const result = await fetchEtherscanResult(
    new URLSearchParams({
      chainid: chainId,
      module: "contract",
      action: "getsourcecode",
      address,
      apikey: process.env.ETHERSCAN_API_KEY,
    })
  );
  const [sourceCodeResponse] = result;
  if (!sourceCodeResponse?.SourceCode) {
    throw new Error("Etherscan returned no source code");
  }

  const sourceCode = sourceCodeResponse.SourceCode;
  const trimmedSourceCode = sourceCode.trim();
  if (trimmedSourceCode.startsWith("{{") && trimmedSourceCode.endsWith("}}")) {
    return trimmedSourceCode.slice(1, -1);
  }
  return sourceCode;
}

function findRoleFromModifier(name, functionDefinition, sourceCode) {
  const constantMatch = functionDefinition.match(
    /onlyRole\(([A-Z_][A-Z0-9_]*)\)/
  );
  if (constantMatch) {
    const constantName = constantMatch[1];
    const constantDefinitionRegex = new RegExp(
      `bytes32\\s+(?:public|private|internal)?\\s+constant\\s+${constantName}\\s*=\\s*\\\\?"([^"]*)\\\\"?`
    );
    const constantDefinition = sourceCode.match(constantDefinitionRegex);

    if (constantDefinition?.[1]) {
      return [constantDefinition[1]];
    }
  }

  if (/onlyAdmin(?:Role)?\b(?:\(\))?/.test(functionDefinition)) {
    return name.includes("RolesAdmin") ? [roleRolesAdmin] : ["admin"];
  }
  if (/onlyEmergency(?:\(\))?/.test(functionDefinition)) {
    return ["emergency"];
  }
  if (/onlyAdminOrEmergency(?:\(\))?/.test(functionDefinition)) {
    return ["admin", "emergency"];
  }

  const directStringMatch = functionDefinition.match(
    /onlyRole\(\\?"([^"]*)\\"?\)/
  );
  if (directStringMatch?.[1]) {
    return [directStringMatch[1]];
  }

  return null;
}

function processSourceCode(name, sourceCode, processedData) {
  for (const functionDetails of Object.values(
    processedData.functionSelectors
  )) {
    const functionDefinition = sourceCode.match(
      new RegExp(`function ${functionDetails.name}\\s*\\([^;{]*\\)\\s*[^;{]*{`)
    );
    if (!functionDefinition) continue;

    const roles = findRoleFromModifier(name, functionDefinition[0], sourceCode);
    if (roles) {
      functionDetails.roles.push(...roles);
    }
  }

  return processedData;
}

async function fetchProcessedContract(contract) {
  const abi = await fetchContractAbi(contract.chainId, contract.address);
  const sourceCode = await fetchContractSourceCode(
    contract.chainId,
    contract.address
  );
  return processSourceCode(contract.name, sourceCode, processAbiMetadata(abi));
}

const existingMetadata = await readJsonIfExists(outputPath, {});
const cache = await readJsonIfExists(cachePath, {});
const metadata = structuredClone(existingMetadata);

for (const [chainId, contracts] of Object.entries(cache)) {
  metadata[chainId] ??= {};

  for (const [address, cacheEntry] of Object.entries(contracts)) {
    if (!cacheEntry?.processedData) {
      continue;
    }

    metadata[chainId][address.toLowerCase()] ??= cacheEntry.processedData;
  }
}

if (cliOptions.verifiedSource) {
  if (!cliOptions.chainId || !cliOptions.address)
    throw new Error("--verified-source requires --chain-id and --address");
  const verified = JSON.parse(
    await readFile(cliOptions.verifiedSource, "utf8")
  );
  metadata[cliOptions.chainId] ??= {};
  metadata[cliOptions.chainId][cliOptions.address] =
    processVerifiedContractMetadata(
      verified,
      cliOptions.chainId,
      cliOptions.address,
      metadata[cliOptions.chainId][cliOptions.address]
    );
} else if (cliOptions.refreshGetters) {
  const inventory = await readJsonIfExists(
    path.join(repoRoot, "packages/protocol-config/other-contracts.json"),
    []
  );
  const targets = new Map(
    parseContractNames().map((contract) => [
      `${contract.chainId}:${contract.normalizedAddress}`,
      contract,
    ])
  );
  for (const contract of inventory.filter((entry) => !entry.labelOnly)) {
    const identity = `${contract.chainId}:${contract.address.toLowerCase()}`;
    if (!targets.has(identity))
      targets.set(identity, {
        ...contract,
        chainId: String(contract.chainId),
        normalizedAddress: contract.address.toLowerCase(),
        type: "external",
      });
  }
  const selected = [...targets.values()].filter(
    (contract) =>
      (!cliOptions.chainId || contract.chainId === cliOptions.chainId) &&
      (!cliOptions.address ||
        contract.normalizedAddress === cliOptions.address) &&
      (!cliOptions.name || contract.name === cliOptions.name)
  );
  if (cliOptions.address && !selected.length)
    throw new Error(
      "No registered contract matches the requested getter refresh"
    );
  let unavailable = 0;
  let updated = 0;
  for (const contract of selected) {
    const previous = metadata[contract.chainId]?.[contract.normalizedAddress];
    const functions = Object.values(previous?.functionSelectors ?? {});
    if (
      !cliOptions.force &&
      Array.isArray(previous?.addressGetters) &&
      functions.every((fn) => fn.canonicalSignature && fn.documentation?.source)
    )
      continue;
    try {
      await waitForEtherscanRequestSlot();
      lastEtherscanRequestAt = Date.now();
      const url = `https://sourcify.dev/server/v2/contract/${contract.chainId}/${contract.normalizedAddress}?fields=metadata,runtimeBytecode.onchainBytecode`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Sourcify HTTP ${response.status}`);
      const processed = processVerifiedContractMetadata(
        await response.json(),
        contract.chainId,
        contract.normalizedAddress,
        previous
      );
      metadata[contract.chainId] ??= {};
      metadata[contract.chainId][contract.normalizedAddress] = processed;
      updated++;
      console.log(
        `Verified getters: ${contract.chainId}:${contract.normalizedAddress} ${contract.name} (${processed.addressGetters.length})`
      );
    } catch (error) {
      unavailable++;
      console.warn(
        `Getter verification unavailable: ${contract.chainId}:${contract.normalizedAddress} ${contract.name}: ${error.message}; retained previous metadata.`
      );
    }
  }
  console.log(
    `Getter metadata: ${updated} refreshed, ${unavailable} unavailable, ${selected.length - updated - unavailable} already verified.`
  );
  if (unavailable && (cliOptions.address || cliOptions.name))
    throw new Error(
      "Requested getter verification unavailable; previous metadata retained"
    );
} else if (!cliOptions.cacheOnly) {
  if (!process.env.ETHERSCAN_API_KEY?.trim()) {
    throw new Error(
      "ETHERSCAN_API_KEY is required to fetch missing contract metadata"
    );
  }

  const contracts = parseContractNames().filter(shouldFetchContract);
  const candidates = contracts.filter((contract) => {
    const chainMetadata = metadata[contract.chainId] ?? {};
    return (
      cliOptions.force ||
      isEmptyMetadataEntry(chainMetadata[contract.normalizedAddress])
    );
  });

  console.log(
    `Fetching metadata for ${candidates.length} named contract(s); ${contracts.length - candidates.length} already present.`
  );

  const failures = [];
  for (const contract of candidates) {
    try {
      console.log(
        `Fetching ${contract.name} ${contract.address} on chain ${contract.chainId}`
      );
      metadata[contract.chainId] ??= {};
      metadata[contract.chainId][contract.normalizedAddress] =
        await fetchProcessedContract(contract);
    } catch (error) {
      failures.push({ contract, error });
      console.warn(
        `Failed to fetch ${contract.name} ${contract.address} on chain ${contract.chainId}: ${error.message}`
      );
    }
  }

  if (failures.length > 0 && (cliOptions.address || cliOptions.name)) {
    throw new Error(`Failed to fetch ${failures.length} requested contract(s)`);
  }
  if (failures.length > 0) {
    console.warn(
      `Skipped ${failures.length} named contract(s) after fetch errors.`
    );
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(sortObject(metadata), null, 2)}\n`
);
formatOutputFile();

console.log(`Generated ${outputPath}`);
