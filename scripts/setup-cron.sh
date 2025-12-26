#!/usr/bin/env bash
# Manual cron job setup script for daily data refresh
# This is automatically run by lightsail-bootstrap.sh, but can be run manually if needed

set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/strivve-metrics}"

echo "==> Setting up daily refresh cron job"

# Create log directory if it doesn't exist
sudo mkdir -p /var/log/strivve-metrics
sudo chown $(whoami):$(whoami) /var/log/strivve-metrics

# Add cron job to run daily at 12:05 AM UTC
CRON_CMD="5 0 * * * cd ${APP_DIR} && /usr/bin/node scripts/refresh-yesterday.mjs >> /var/log/strivve-metrics/daily-refresh.log 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -F "refresh-yesterday.mjs" > /dev/null; then
  echo "✓ Cron job already exists"
  echo ""
  echo "Current cron entry:"
  crontab -l | grep refresh-yesterday.mjs
else
  # Add new cron job
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
  echo "✓ Daily refresh cron job installed"
  echo ""
  echo "Cron entry added:"
  crontab -l | grep refresh-yesterday.mjs
fi

echo ""
echo "Cron job details:"
echo "  - Schedule: Daily at 12:05 AM UTC"
echo "  - Script: ${APP_DIR}/scripts/refresh-yesterday.mjs"
echo "  - Logs: /var/log/strivve-metrics/daily-refresh.log"
echo ""
echo "Useful commands:"
echo "  - View cron jobs: crontab -l"
echo "  - View logs: tail -f /var/log/strivve-metrics/daily-refresh.log"
echo "  - Test refresh: node ${APP_DIR}/scripts/refresh-yesterday.mjs"
echo "  - Remove cron: crontab -l | grep -v refresh-yesterday.mjs | crontab -"
