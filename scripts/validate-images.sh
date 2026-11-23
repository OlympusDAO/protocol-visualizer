#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${PV_VALIDATION_CHILD:-}" != images ]]; then
  exec node scripts/validation-evidence.mjs images bash scripts/validate-images.sh "$@"
fi
[[ $# == 0 ]] || { echo "Usage: validate-images.sh" >&2; exit 1; }
command -v trivy >/dev/null || { echo "Install Trivy (see mise.toml) before validating images." >&2; exit 1; }
printf '\n[1/10] Build all seven application images\n'
images=(rpc-cache indexer frontend hasura snapshot-gateway snapshot-publisher snapshot-monitor)
for image in "${images[@]}"; do
  pnpm run "docker:build:$image"
done
step=1
for image in "${images[@]}"; do
  step=$((step + 1))
  printf '\n[%s/10] Scan %s local image\n' "$step" "$image"
  pnpm run docker:scan -- "$image"
done
printf '\n[9/10] Scan Dockerfiles\n'
pnpm run docker:scan:dockerfiles
printf '\n[10/10] Check owned external images; provider inventory NOT SCANNED (optional: pnpm docker:scan:provider); local fixtures excluded\n'
pnpm run docker:scan:runtime
