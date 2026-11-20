#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

validation_node_bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$(< .node-version)/bin"
if [[ -x "$validation_node_bin/node" ]]; then
  export PATH="$validation_node_bin:$PATH"
fi
if [[ "${PV_VALIDATION_CHILD:-}" != source ]]; then
  exec node scripts/validation-evidence.mjs source bash scripts/validate.sh
fi

step=0
run() {
  step=$((step + 1))
  printf '\n[%s/12] %s\n' "$step" "$*"
  if "$@"; then
    return 0
  else
    status=$?
    printf '\nValidation stopped at step %s/12: %s (exit %s). Fix this failure before continuing.\n' "$step" "$*" "$status" >&2
    exit "$status"
  fi
}

run pnpm install --frozen-lockfile
run pnpm run check:runtime-versions
run pnpm run codegen
run pnpm check
run pnpm --filter @protocol-visualizer/snapshot-artifacts run build
run pnpm run openapi:check
run pnpm run build
run pnpm run snapshots:generate:local
run pnpm --filter indexer run typecheck
run pnpm --filter snapshot-monitor run test
run pnpm run abis:check
run pnpm audit --audit-level moderate

printf '\nAll 12 validation steps passed.\n'
