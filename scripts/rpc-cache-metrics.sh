#!/usr/bin/env bash
set -euo pipefail

: "${RAILWAY_ENVIRONMENT:?Set RAILWAY_ENVIRONMENT to the target Railway environment}"

for command in railway ssh curl; do
  command -v "$command" >/dev/null || { echo "Install $command first" >&2; exit 1; }
done

umask 077
metrics_tmp=$(mktemp -d /tmp/pv-rpc-metrics.XXXXXX)
metrics_alias=pv-rpc-cache-metrics
metrics_url=http://127.0.0.1:14001/metrics

cleanup() {
  ssh -F "$metrics_tmp/config" -S "$metrics_tmp/socket" -O exit "$metrics_alias" >/dev/null 2>&1 || true
  rm -rf "$metrics_tmp"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

set -- ssh config --service rpc-cache --environment "$RAILWAY_ENVIRONMENT" --alias "$metrics_alias" --dry-run
if [[ -n "${RAILWAY_SSH_IDENTITY_FILE:-}" ]]; then
  set -- "$@" --identity-file "$RAILWAY_SSH_IDENTITY_FILE"
fi
railway "$@" > "$metrics_tmp/config"

# -f returns only after authentication and local forwarding setup succeed.
# -N avoids starting a shell in the distroless container.
ssh -F "$metrics_tmp/config" -M -S "$metrics_tmp/socket" -fN \
  -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
  -L 127.0.0.1:14001:127.0.0.1:4001 "$metrics_alias"

metrics_ready=false
for ((attempt = 0; attempt < 20; attempt++)); do
  if curl --fail --silent --max-time 1 "$metrics_url" >/dev/null; then
    metrics_ready=true
    break
  fi
  sleep 1
done
if [[ "$metrics_ready" != true ]]; then
  echo "eRPC metrics did not respond through SSH at $metrics_url" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin) open "$metrics_url" ;;
  Linux) xdg-open "$metrics_url" ;;
  *) echo "Open $metrics_url in your browser" ;;
esac
echo "Metrics for $RAILWAY_ENVIRONMENT: $metrics_url"
echo "Keep this terminal open. Press Ctrl+C to close the SSH tunnel."
while ssh -F "$metrics_tmp/config" -S "$metrics_tmp/socket" -O check "$metrics_alias" >/dev/null 2>&1; do
  sleep 2
done
echo "The SSH tunnel closed" >&2
exit 1
