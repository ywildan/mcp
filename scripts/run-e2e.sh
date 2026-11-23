#!/usr/bin/env bash
# Starts the production server on :3100 and runs the Playwright dashboard E2E tests (scenarios 7, 8, 9 + XSS).
set -uo pipefail
cd "$(dirname "$0")/.."
export PORT=${PORT:-3100} RELAY_URL="http://127.0.0.1:${PORT:-3100}"
export LOGIN_RATE_LIMIT_PER_MIN=1000 ADMIN_EMAIL=${ADMIN_EMAIL:-admin@test.local} ADMIN_PASSWORD=${ADMIN_PASSWORD:-test-password-123}
[ -d .next ] || npm run build
node node_modules/next/dist/bin/next start -p "$PORT" >/tmp/relay-e2e-server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -sf "$RELAY_URL/healthz" >/dev/null && break; sleep 1; done
npx playwright test "$@"
