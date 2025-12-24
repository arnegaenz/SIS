#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/strivve-metrics}"
REPO_URL="${REPO_URL:-https://github.com/arnegaenz/SIS.git}"
NODE_MAJOR="${NODE_MAJOR:-18}"

echo "==> Updating packages"
sudo apt-get update -y
sudo apt-get install -y git curl

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Cloning repo to ${APP_DIR}"
if [ ! -d "${APP_DIR}" ]; then
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

echo "==> Installing dependencies"
npm install

echo "==> Installing PM2"
sudo npm install -g pm2

echo "==> Starting SIS server"
pm2 start scripts/serve-funnel.mjs --name sis-api
pm2 save

echo "==> Enabling PM2 on boot"
pm2 startup | tail -n 1 | bash

echo ""
echo "Next steps:"
echo "1) Upload secrets and data:"
echo "   - secrets/instances.json"
echo "   - secrets/ga-service-account.json (optional)"
echo "   - secrets/ga-test.json (optional)"
echo "   - fi_registry.json"
echo "2) Fetch data + build rollups (run on the server):"
echo "   node scripts/fetch-raw.mjs 2020-01-01 2025-12-12"
echo "   node scripts/build-daily-from-raw.mjs 2020-01-01 2025-12-12"
echo "3) Open port 8787 in the Lightsail firewall."
