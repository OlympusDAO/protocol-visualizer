import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import semver from "semver";

const ROOT = process.cwd();

const WORKFLOW_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/audit.yml",
  ".github/workflows/security-scan.yml",
];

const BOOTSTRAP_ACTION = ".github/actions/bootstrap/action.yml";

const DOCKERFILES = ["Dockerfile-indexer", "Dockerfile-frontend"];

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractMajor(value, label) {
  const cleaned = value.trim().replace(/^v/, "");
  const match = cleaned.match(/(\d+)/);
  if (!match) {
    throw new Error(`Could not extract major version from ${label}: ${value}`);
  }
  return Number(match[1]);
}

function fail(message) {
  console.error(`Runtime version check failed: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(readText("package.json"));
const nodeEngine = packageJson.engines?.node;
const pnpmEngine = packageJson.engines?.pnpm;
const packageManager = packageJson.packageManager;
const expectedPackageManagerGuards = ["npm", "yarn", "bun"];

if (!nodeEngine) {
  fail("package.json engines.node is missing.");
}

if (!pnpmEngine) {
  fail("package.json engines.pnpm is missing.");
}

if (!packageManager || !packageManager.startsWith("pnpm@")) {
  fail("package.json packageManager must be set to pnpm@<version>.");
}

for (const packageManagerName of expectedPackageManagerGuards) {
  if (packageJson.engines?.[packageManagerName] !== "use-pnpm") {
    fail(`package.json engines.${packageManagerName} must be set to use-pnpm.`);
  }
}

const nvmrc = readText(".nvmrc").trim();
const nodeVersionFile = readText(".node-version").trim();

const nodeEngineMajor = extractMajor(nodeEngine, "package.json engines.node");
const nvmrcMajor = extractMajor(nvmrc, ".nvmrc");
const nodeVersionFileMajor = extractMajor(nodeVersionFile, ".node-version");

if (nodeEngineMajor !== nvmrcMajor) {
  fail(
    `package.json engines.node (${nodeEngine}) and .nvmrc (${nvmrc}) do not match.`
  );
}

if (nodeEngineMajor !== nodeVersionFileMajor) {
  fail(
    `package.json engines.node (${nodeEngine}) and .node-version (${nodeVersionFile}) do not match.`
  );
}

const runtimeNodeMajor = extractMajor(
  process.versions.node,
  "current runtime node version"
);

if (runtimeNodeMajor !== nodeEngineMajor) {
  fail(
    `current Node.js version (${process.versions.node}) does not match engines.node (${nodeEngine}).`
  );
}

const packageManagerVersion = packageManager.slice("pnpm@".length).trim();
const pnpmEngineVersion = pnpmEngine.startsWith(">=")
  ? pnpmEngine.slice(2).trim()
  : pnpmEngine.trim();
if (!semver.valid(pnpmEngineVersion) || !semver.valid(packageManagerVersion)) {
  fail(
    `packageManager (${packageManagerVersion}) and engines.pnpm minimum (${pnpmEngineVersion}) must be valid semver versions.`
  );
}

if (!semver.satisfies(packageManagerVersion, pnpmEngine)) {
  fail(
    `packageManager (${packageManagerVersion}) must satisfy engines.pnpm (${pnpmEngine}).`
  );
}

const runtimePnpmVersion = execSync("pnpm --version", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
}).trim();

if (runtimePnpmVersion !== packageManagerVersion) {
  fail(
    `current pnpm version (${runtimePnpmVersion}) does not match packageManager (${packageManagerVersion}).`
  );
}

for (const workflowPath of WORKFLOW_FILES) {
  const content = readText(workflowPath);
  const usesBootstrap = /uses:\s*\.\/\.github\/actions\/bootstrap/.test(
    content
  );
  if (usesBootstrap) {
    const bootstrapContent = readText(BOOTSTRAP_ACTION);
    if (!/node-version-file:\s*\.nvmrc/.test(bootstrapContent)) {
      fail(
        `${BOOTSTRAP_ACTION} must configure actions/setup-node with node-version-file: .nvmrc.`
      );
    }

    if (/\bnode-version\s*:/.test(bootstrapContent)) {
      fail(
        `${BOOTSTRAP_ACTION} should not hardcode node-version; use node-version-file: .nvmrc.`
      );
    }

    continue;
  }

  if (!/node-version-file:\s*\.nvmrc/.test(content)) {
    fail(
      `${workflowPath} must use actions/setup-node with node-version-file: .nvmrc.`
    );
  }

  if (/\bnode-version\s*:/.test(content)) {
    fail(
      `${workflowPath} should not hardcode node-version; use node-version-file: .nvmrc.`
    );
  }
}

for (const dockerfilePath of DOCKERFILES) {
  const content = readText(dockerfilePath);

  const nodeImageMatch = content.match(/FROM\s+node:([^\s]+)/i);
  if (!nodeImageMatch) {
    fail(`${dockerfilePath} must define a Node.js base image (FROM node:...).`);
  }

  const dockerNodeMajor = extractMajor(
    nodeImageMatch[1],
    `${dockerfilePath} Node.js image tag`
  );

  if (dockerNodeMajor !== nodeEngineMajor) {
    fail(
      `${dockerfilePath} uses Node.js ${nodeImageMatch[1]} but engines.node is ${nodeEngine}.`
    );
  }

  const pnpmMatch = content.match(
    /corepack\s+prepare\s+pnpm@([^\s]+)\s+--activate/i
  );
  if (!pnpmMatch) {
    fail(
      `${dockerfilePath} must install pnpm using corepack prepare pnpm@<version> --activate.`
    );
  }

  const dockerPnpmVersion = pnpmMatch[1].trim();
  if (dockerPnpmVersion !== packageManagerVersion) {
    fail(
      `${dockerfilePath} uses pnpm ${dockerPnpmVersion} but packageManager is ${packageManagerVersion}.`
    );
  }
}

console.log("Runtime version check passed.");
