import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".turbo",
  "node_modules",
  "dist",
  "build",
]);

function discoverDockerfiles(directory = ROOT) {
  const dockerfiles = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        dockerfiles.push(...discoverDockerfiles(entryPath));
      }
      continue;
    }

    if (entry.isFile() && entry.name.startsWith("Dockerfile")) {
      dockerfiles.push(path.relative(ROOT, entryPath));
    }
  }

  return dockerfiles.sort();
}

const DOCKERFILES = discoverDockerfiles();

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
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

if (!packageManager?.startsWith("pnpm@")) {
  fail("package.json packageManager must be set to pnpm@<version>.");
}

for (const packageManagerName of expectedPackageManagerGuards) {
  if (packageJson.engines?.[packageManagerName] !== "use-pnpm") {
    fail(`package.json engines.${packageManagerName} must be set to use-pnpm.`);
  }
}

const nvmrc = readText(".nvmrc").trim();
const nodeVersionFile = readText(".node-version").trim();
const expectedNode = semver.minVersion(nodeEngine)?.version;
if (
  expectedNode !== nvmrc ||
  nvmrc !== nodeVersionFile ||
  process.versions.node !== nvmrc
)
  fail(
    `Node must exactly match ${nvmrc} across runtime, engines minimum, .nvmrc and .node-version.`
  );

const packageManagerVersion = packageManager.slice("pnpm@".length).trim();
const pnpmEngineVersion = semver.minVersion(pnpmEngine)?.version;
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

for (const workflowPath of WORKFLOW_FILES)
  if (!/uses:\s*\.\/\.github\/actions\/bootstrap/.test(readText(workflowPath)))
    fail(`${workflowPath} must use the locked Mise bootstrap.`);

for (const dockerfilePath of DOCKERFILES) {
  const content = readText(dockerfilePath);

  const nodeImageMatch = content.match(/FROM\s+node:([^\s]+)/i);
  if (!nodeImageMatch) {
    console.warn(
      `${dockerfilePath} does not define a Node.js base image; skipping Node.js and pnpm runtime version checks.`
    );
    continue;
  }

  const dockerNodeVersion = nodeImageMatch[1].match(
    /^([0-9]+\.[0-9]+\.[0-9]+)/
  )?.[1];

  if (dockerNodeVersion !== nvmrc) {
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

const mise = readText("mise.toml");
for (const [tool, expected, args] of [
  ["node", nvmrc, ["--version"]],
  ["pnpm", packageManagerVersion, ["--version"]],
  ["railway", "5.75.0", ["--version"]],
  ["trivy", "0.76.2", ["--version"]],
  ["jactionlint", "2.4.0", ["--version"]],
  ["zizmor", "1.32.0", ["--version"]],
]) {
  if (!mise.includes(`${tool} = "${expected}"`))
    fail(`mise.toml must pin ${tool} ${expected}.`);
  const actual = execSync(`${tool} ${args.join(" ")}`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).match(/(\d+\.\d+\.\d+)/)?.[1];
  if (actual !== expected)
    fail(`${tool} runtime ${actual} must match ${expected}.`);
}
const bootstrap = readText(BOOTSTRAP_ACTION);
if (
  !bootstrap.includes(
    "install_args: node pnpm railway trivy jactionlint zizmor --locked"
  ) ||
  !bootstrap.includes('version: "2026.11.9"') ||
  !bootstrap.includes("cache: true")
)
  fail(
    "CI bootstrap must install all six locked tools with pinned Mise and caching."
  );
for (const workflow of [".github/workflows/ci.yml"])
  if (
    !readText(workflow).includes("uses: ./.github/actions/bootstrap") ||
    /npm install --global @railway/.test(readText(workflow))
  )
    fail(
      `${workflow} must use bootstrap and the native repository-pinned Railway CLI.`
    );
const declarations = [
  packageJson,
  ...["apps", "packages"].flatMap((directory) =>
    readdirSync(path.join(ROOT, directory), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(path.join(ROOT, directory, entry.name, "package.json"))
      )
      .map((entry) =>
        JSON.parse(readText(`${directory}/${entry.name}/package.json`))
      )
  ),
];
for (const manifest of declarations)
  for (const section of ["dependencies", "devDependencies"])
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      const expected = {
        envio: "3.14.1",
        viem: "2.57.14",
        "@aws-sdk/client-s3": "3.1152.0",
        "@biomejs/biome": "2.6.3",
        "@types/node": "24.19.2",
        typescript: "7.0.2",
        "@typescript/typescript6": "6.0.2",
      }[name];
      if (expected && version !== expected)
        fail(`${manifest.name}: ${name} must equal ${expected}.`);
    }

console.log("Runtime version check passed.");
