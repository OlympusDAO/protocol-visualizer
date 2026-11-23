// Trusted post-checkout release steps; selection and external gates stay before checkout.
module.exports = {
  async plan({ core }) {
    if (!process.env.RAILWAY_API_TOKEN)
      throw new Error(
        "Set the production environment-only RAILWAY_DEPLOY_TOKEN secret."
      );
    // Authoring evaluation can use this token; run only trusted merged code.
    // Native saved plans and captured output may contain private values.
    process.umask(0o077);
    const planned = require("node:child_process").spawnSync(
      "railway",
      [
        "config",
        "plan",
        "--environment",
        process.env.RAILWAY_ENVIRONMENT_ID,
        "--out",
        `${process.env.RUNNER_TEMP}/railway-plan.json`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    if (planned.error || planned.status !== 0)
      throw new Error("Native Railway plan failed; raw output withheld.");
    core.info("Fresh native production plan saved privately for this release.");
  },
  async verify({ github, context }) {
    const plan = JSON.parse(
      require("node:fs").readFileSync(process.env.PLAN_PATH, "utf8")
    );
    // Native apply binds environment/sourceTree/ETag/hash to this saved plan.
    // CLI 5.75 source updates can redeploy a database despite severity=safe.
    // Main image transitions require the separately approved fresh-data release.
    if (
      plan.kind !== "railway.config.plan" ||
      plan.version !== 1 ||
      plan.changeSet?.version !== 1 ||
      !Array.isArray(plan.changeSet.changes)
    ) {
      throw new Error(
        "Unsupported saved plan change set; refusing automatic production apply."
      );
    }
    for (const change of plan.changeSet.changes) {
      if (
        !change ||
        typeof change.kind !== "string" ||
        typeof change.address !== "string"
      ) {
        throw new Error(
          "Incomplete saved plan change; refusing automatic production apply."
        );
      }
      if (
        change.address === "database.Postgres" &&
        change.kind === "resource.update" &&
        change.field === "source" &&
        (typeof change.before?.image !== "string" ||
          typeof change.after?.image !== "string" ||
          change.before.image !== change.after.image)
      ) {
        throw new Error(
          "Main database image transition requires a separately approved manual reset/reindex and native apply; automatic production apply is blocked."
        );
      }
    }
    const { data: branch } = await github.rest.repos.getBranch({
      ...context.repo,
      branch: "master",
    });
    if (branch.commit.sha !== context.sha) {
      throw new Error(
        "Production branch advanced; refusing an outdated queued apply."
      );
    }
  },
  async apply({ core }) {
    if (!process.env.RAILWAY_API_TOKEN)
      throw new Error(
        "Set the production environment-only RAILWAY_DEPLOY_TOKEN secret."
      );
    // Native 5.75 saved-plan apply can exit zero on failed/partial results.
    // Keep both streams private: outputs/diagnostics can contain secrets.
    const applied = require("node:child_process").spawnSync(
      "railway",
      [
        "config",
        "apply",
        "--environment",
        process.env.RAILWAY_ENVIRONMENT_ID,
        "--plan",
        `${process.env.RUNNER_TEMP}/railway-plan.json`,
        "--yes",
        "--json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    if (applied.error || applied.status !== 0)
      throw new Error(
        "Native Railway apply failed; raw output withheld. Verify the target before any retry."
      );
    let result;
    try {
      result = JSON.parse(applied.stdout);
    } catch {
      throw new Error(
        "Native Railway apply returned malformed JSON; raw output withheld."
      );
    }
    const accepted = new Set(["applied", "noop"]);
    if (
      !accepted.has(result?.status) ||
      !Array.isArray(result.changes) ||
      !result.changes.every((change) => accepted.has(change?.status))
    ) {
      throw new Error(
        "Native Railway apply did not report applied/noop for the result and every change; raw output withheld. Do not retry blindly."
      );
    }
    core.info(
      "Native apply result accepted. Deployment acceptance still requires a fresh read-only plan and complete HTTP/TCP inventory."
    );
  },
};
