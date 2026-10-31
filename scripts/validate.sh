#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

validation_node_bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$(< .node-version)/bin"
if [[ -x "$validation_node_bin/node" ]]; then
  export PATH="$validation_node_bin:$PATH"
fi

step=0
run() {
  step=$((step + 1))
  printf '\n[%s/9] %s\n' "$step" "$*"
  if "$@"; then
    return 0
  else
    status=$?
    printf '\nValidation stopped at step %s/9: %s (exit %s). Fix this failure before continuing.\n' "$step" "$*" "$status" >&2
    exit "$status"
  fi
}

run pnpm run check:runtime-versions
run pnpm install --frozen-lockfile
run pnpm run lint:check
run pnpm run build
run pnpm run snapshots:generate:local
run pnpm run docker:build:indexer
run pnpm run docker:build:frontend
run pnpm run docker:build:snapshot-gateway
run pnpm run docker:build:snapshot-publisher

printf '\nAll 9 validation steps passed.\n'
