#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${PV_VALIDATION_CHILD:-}" != images ]]; then
  exec node scripts/validation-evidence.mjs images bash scripts/validate-images.sh "$@"
fi
[[ $# == 0 || ( $# == 1 && $1 == --integration ) ]] || { echo "Usage: validate-images.sh [--integration]" >&2; exit 1; }
command -v trivy >/dev/null || { echo "Install Trivy (see mise.toml) before validating images." >&2; exit 1; }
printf '\n[1/10] Build all seven application images\n'
image_directory="${PV_VALIDATION_DIRECTORY:?Recorded image directory is required}"
images=(rpc-cache indexer frontend hasura snapshot-gateway snapshot-publisher snapshot-monitor)
for image in "${images[@]}"; do
  iidfile="$image_directory/$image.iid"
  pnpm run "container:build:$image" --iidfile "$iidfile"
  if [[ ! -f "$iidfile" ]] || [[ ! "$(< "$iidfile")" =~ ^(sha256:)?[a-f0-9]{64}$ ]]; then
    printf 'Build did not produce an immutable image ID for %s\n' "$image" >&2
    exit 1
  fi
  printf 'Built image %s: %s\n' "$image" "$(< "$iidfile")"
done
step=1
for image in "${images[@]}"; do
  step=$((step + 1))
  printf '\n[%s/10] Scan %s immutable image\n' "$step" "$image"
  pnpm run container:scan -- "$image" "$(< "$image_directory/$image.iid")"
done
printf '\n[9/10] Scan Dockerfiles\n'
pnpm run container:scan:dockerfiles
printf '\n[10/10] Check owned external images; record provider advisories and local exclusions\n'
pnpm run container:scan:runtime
if [[ "${1:-}" == --integration ]]; then
  pnpm test:integration --images "$image_directory"
fi
