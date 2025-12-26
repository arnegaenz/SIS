#!/usr/bin/env bash
# Quick script to update Lightsail deployment
# Run this from your local machine to update the remote Lightsail server

set -euo pipefail

LIGHTSAIL_IP="${LIGHTSAIL_IP:-34.220.57.7}"
LIGHTSAIL_USER="${LIGHTSAIL_USER:-ubuntu}"
APP_DIR="${APP_DIR:-\$HOME/strivve-metrics}"

echo "==> Updating Lightsail server at ${LIGHTSAIL_USER}@${LIGHTSAIL_IP}"

ssh "${LIGHTSAIL_USER}@${LIGHTSAIL_IP}" << 'ENDSSH'
set -e

cd ~/strivve-metrics

echo "==> Pulling latest code from GitHub"
git pull origin main

echo "==> Restarting SIS API server"
pm2 restart sis-api

echo "==> Verifying server is running"
pm2 list | grep sis-api

echo ""
echo "✓ Update complete!"
echo ""
echo "Verify the update:"
echo "  curl http://localhost:8787/data-freshness | jq ."
echo ""
echo "View logs:"
echo "  pm2 logs sis-api"
ENDSSH

echo ""
echo "==> Testing updated API from external"
sleep 2
curl -s "https://${LIGHTSAIL_IP}.sslip.io/data-freshness" | jq . || echo "API test failed - check server logs"

echo ""
echo "✓ Lightsail update complete!"
