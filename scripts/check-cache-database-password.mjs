import { execFileSync } from "node:child_process";

const project = process.env.RAILWAY_PROJECT_ID;
const environment = process.env.RAILWAY_ENVIRONMENT_ID;
if (!project || !environment) {
  console.error(
    "Set RAILWAY_PROJECT_ID and RAILWAY_ENVIRONMENT_ID before checking cache credentials."
  );
  process.exit(1);
}

let variables;
try {
  variables = JSON.parse(
    execFileSync(
      "railway",
      [
        "variable",
        "list",
        "--project",
        project,
        "--environment",
        environment,
        "--service",
        "rpc-cache-postgres",
        "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
    )
  );
} catch {
  console.error(
    "Cannot verify cache database credentials; infrastructure apply is blocked."
  );
  process.exit(1);
}

if (
  typeof variables.PGPASSWORD !== "string" ||
  !/^[A-Za-z0-9._~-]+$/.test(variables.PGPASSWORD)
) {
  console.error(
    "Cache database password must be URL-safe before applying its DATABASE_URL reference. Coordinate PostgreSQL role and Railway variable rotation first; no infrastructure changes were applied."
  );
  process.exit(1);
}
console.log("Cache database password is URL-safe.");
