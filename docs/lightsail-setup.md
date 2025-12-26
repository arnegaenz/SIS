Lightsail Setup (SIS)

This guide keeps all services in the cloud:
- Backend API + data runs on Lightsail (Node + PM2).
- Frontend runs on GitHub Pages.

Prereqs
- A Lightsail Ubuntu 22.04 instance.
- SSH access to the instance.

Step 1: Bootstrap the instance

Copy `scripts/lightsail-bootstrap.sh` to the server and run:

```bash
chmod +x ./lightsail-bootstrap.sh
./lightsail-bootstrap.sh
```

This installs Node, clones the repo, installs deps, starts the server via PM2, and sets up a daily cron job to refresh yesterday's data at 12:05 AM UTC.

Step 2: Upload secrets and registry

Upload these to the Lightsail instance (same repo folder):
- `secrets/instances.json`
- `secrets/ga-service-account.json` (optional)
- `secrets/ga-test.json` (optional)
- `fi_registry.json`

Step 3: Fetch data and build rollups (on the server)

```bash
cd ~/strivve-metrics
node scripts/fetch-raw.mjs 2020-01-01 2025-12-12
node scripts/build-daily-from-raw.mjs 2020-01-01 2025-12-12
```

Step 4: Open the firewall

In the Lightsail console, open inbound TCP port `8787`.

Step 5: Point GitHub Pages to Lightsail

Set your API base in `public/assets/js/config.js`:

```js
global.SIS_API_BASE = "http://YOUR_LIGHTSAIL_IP:8787";
```

---

## Daily Data Refresh

The bootstrap script automatically sets up a daily cron job that:
- Runs at **12:05 AM UTC** each day
- Fetches yesterday's raw data (GA, placements, sessions)
- Builds daily rollups from the raw data
- Logs output to `/var/log/strivve-metrics/daily-refresh.log`

### Managing the cron job

**View the cron job:**
```bash
crontab -l
```

**View refresh logs:**
```bash
tail -f /var/log/strivve-metrics/daily-refresh.log
```

**Manually trigger a refresh:**
```bash
cd ~/strivve-metrics
node scripts/refresh-yesterday.mjs
```

**Manually set up cron (if needed):**
```bash
cd ~/strivve-metrics
./scripts/setup-cron.sh
```

**Remove the cron job:**
```bash
crontab -l | grep -v refresh-yesterday.mjs | crontab -
```
