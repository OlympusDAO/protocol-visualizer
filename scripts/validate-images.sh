#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${PV_VALIDATION_CHILD:-}" != images ]]; then
  exec node scripts/validation-evidence.mjs images bash scripts/validate-images.sh "$@"
fi
[[ $# == 0 ]] || { echo "Usage: validate-images.sh" >&2; exit 1; }
command -v trivy >/dev/null || { echo "Install Trivy (see mise.toml) before validating images." >&2; exit 1; }
printf '\n[1/11] Build all eight application images\n'
images=(rpc-cache indexer indexer-monitor frontend hasura snapshot-gateway snapshot-publisher snapshot-monitor)
for image in "${images[@]}"; do
  pnpm run "build:docker:$image"
done
step=1
for image in "${images[@]}"; do
  step=$((step + 1))
  printf '\n[%s/11] Scan %s local image\n' "$step" "$image"
  pnpm run scan:docker -- "$image"
done
printf '\n[10/11] Scan Dockerfiles\n'
pnpm run scan:docker:dockerfiles
printf '\n[11/11] Check owned external images; provider inventory NOT SCANNED (optional: pnpm scan:docker:provider); local fixtures excluded\n'
pnpm run scan:docker:runtime
