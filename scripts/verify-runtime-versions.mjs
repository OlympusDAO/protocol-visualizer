import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const WORKFLOW_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/audit.yml",
  ".github/workflows/security-scan.yml",
];

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractMajor(value, label) {
  const cleaned = value.trim().replace(/^v/, "");
  const match = cleaned.match(/^(\d+)/);
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

if (!nodeEngine) {
  fail("package.json engines.node is missing.");
}

if (!pnpmEngine) {
  fail("package.json engines.pnpm is missing.");
}

if (!packageManager || !packageManager.startsWith("pnpm@")) {
  fail("package.json packageManager must be set to pnpm@<version>.");
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
if (packageManagerVersion !== pnpmEngine) {
  fail(
    `packageManager (${packageManagerVersion}) and engines.pnpm (${pnpmEngine}) do not match.`
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

console.log("Runtime version check passed.");
