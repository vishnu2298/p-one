#!/usr/bin/env bash
# Deploys both web apps to Cloudflare Pages. The API runs elsewhere (see docs/CLOUDFLARE.md) and is reached at $API_URL.
#   export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...
#   API_URL=https://api.example.com ./deploy/cloudflare/deploy.sh
set -euo pipefail
: "${API_URL:?set API_URL to the public https address of your API}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" ; : "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; DIST="$ROOT/.cf-dist"
APP_PROJECT="${APP_PROJECT:-connectly-app}"; BIZ_PROJECT="${BIZ_PROJECT:-connectly-business}"
rm -rf "$DIST"; mkdir -p "$DIST"

echo "== Connectly app (buy, sell, connect) =="
( cd "$ROOT/mobile" && npm ci --no-audit --no-fund && OUT="$DIST/app" API_URL="$API_URL" bash scripts/build-web.sh )
echo "== Connectly Business =="
( cd "$ROOT/business-web" && npm ci --no-audit --no-fund && VITE_API_URL="$API_URL" BUILD_OUT="$DIST/business" npm run build )

for pair in "app:$APP_PROJECT" "business:$BIZ_PROJECT"; do
  dir="${pair%%:*}"; proj="${pair##*:}"
  npx --yes wrangler@latest pages project create "$proj" --production-branch main >/dev/null 2>&1 || true   # first run only
  npx --yes wrangler@latest pages deploy "$DIST/$dir" --project-name "$proj" --branch main
done
echo "Done. Remember to set CORS_ORIGINS on the API to your two Pages domains."
