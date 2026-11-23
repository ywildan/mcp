#!/usr/bin/env bash
# Builds (if needed), starts the production server on :3100, runs integration tests, stops the server.
set -uo pipefail
cd "$(dirname "$0")/.."
export PORT=${PORT:-3100} RELAY_URL="http://127.0.0.1:${PORT:-3100}"
export LOGIN_RATE_LIMIT_PER_MIN=1000 ADMIN_EMAIL=${ADMIN_EMAIL:-admin@test.local} ADMIN_PASSWORD=${ADMIN_PASSWORD:-test-password-123}
[ -d .next ] || npm run build
node node_modules/next/dist/bin/next start -p "$PORT" >/tmp/relay-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -sf "$RELAY_URL/healthz" >/dev/null && break; sleep 1; done
npx vitest run tests/integration.test.ts "$@"
