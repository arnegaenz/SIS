# SIS — Local Development Setup

Step-by-step guide to get SIS running locally. Estimated time: 15-30 minutes.

## 1. Clone & Install

```bash
git clone https://github.com/arnegaenz/SIS.git strivve-metrics
cd strivve-metrics
npm install
```

Requires **Node 18+**. If you use nvm: `nvm use` (reads `.nvmrc`).

## 2. Environment File

```bash
cp .env.example .env
```

The defaults work as-is. GA is optional — the server runs without it.

## 3. Secrets Directory

You need credentials in `secrets/`. Ask the team lead for these files:

| File | Required? | Purpose |
|------|-----------|---------|
| `instances.json` | **Yes** | CardSavr instance credentials (API keys, passwords) |
| `anthropic.json` | **Yes** | Anthropic API key for AI insights |
| `users.json` | **Yes** | User accounts and access levels |
| `ga-service-account.json` | No | Google Analytics 4 production credentials |
| `ga-test.json` | No | GA4 test property credentials |

### instances.json format

```json
{
  "entries": [
    {
      "name": "ss01",
      "CARDSAVR_INSTANCE": "https://api.ss01.cardsavr.io",
      "USERNAME": "...",
      "PASSWORD": "...",
      "API_KEY": "...",
      "APP_NAME": "..."
    }
  ]
}
```

### anthropic.json format

```json
{
  "api_key": "sk-ant-api03-..."
}
```

### users.json format

```json
{
  "your-email@example.com": {
    "name": "Your Name",
    "access_level": "admin",
    "pages": ["*"]
  }
}
```

### ga-service-account.json / ga-test.json (optional)

Standard Google Cloud service account key files. To generate one:
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → IAM & Admin → Service Accounts
2. Select the Strivve project → Create or select a service account
3. Keys tab → Add Key → Create new key → JSON
4. Save as `secrets/ga-service-account.json` (production) or `secrets/ga-test.json` (test)

The service account needs the **Google Analytics Data API** (analyticsdata.googleapis.com) enabled and read access to the GA4 property. If you skip these, everything works except GA traffic data on dashboards.

## 4. FI Registry

The `fi_registry.json` file is required but gitignored (it's large, ~136MB). Get a copy from production:

```bash
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/fi_registry.json ./fi_registry.json
```

Or ask the team lead for a copy.

## 5. Bootstrap Data

The server needs session/placement data in `raw/` and aggregated data in `data/daily/`.

**Option A: Fetch from scratch** (slow, fetches from all CardSavr instances + GA):
```bash
node scripts/fetch-raw.mjs 2026-01-01 2026-03-31
node scripts/build-daily-from-raw.mjs 2026-01-01 2026-03-31
```

**Option B: Copy from production** (faster):
```bash
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem -r \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/raw ./raw
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem -r \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/data ./data
```

**Option C: Start empty** (server runs but shows no data):
```bash
mkdir -p raw/sessions raw/placements raw/ga data/daily
```

## 6. Start the Server

```bash
npm run dev
```

Open http://localhost:8787. You should see the login page.

Log in with a magic link (check terminal output for the link) or use the credentials in `users.json`.

## Verify Your Setup

After starting the server, check these:

- [ ] http://localhost:8787 loads the login page
- [ ] Terminal shows `> SIS server on http://localhost:8787`
- [ ] No `ENOENT` errors for `fi_registry.json`
- [ ] After login, the portfolio dashboard loads with data (if you bootstrapped data)

## Directory Structure

```
strivve-metrics/
├── scripts/
│   └── serve-funnel.mjs      # Main server (~8800 lines, all API routes)
├── src/
│   ├── lib/scoping.mjs        # Role-based data scoping
│   └── utils/config.mjs       # Instance configuration loader
├── public/
│   ├── dashboards/             # Kiosk dashboard pages (operations, success, monitor, etc.)
│   ├── assets/js/              # Dashboard modules (ES6)
│   ├── funnel.html             # Internal FI funnel page
│   └── funnel-customer.html    # Customer-facing engagement dashboard
├── templates/                  # PDF report templates (Puppeteer-rendered)
├── secrets/                    # Credentials (gitignored, see step 3)
├── data/daily/                 # Aggregated daily metrics (gitignored)
├── raw/                        # Raw sessions, placements, GA data (gitignored)
├── fi_registry.json            # FI metadata (gitignored, see step 4)
├── docs/
│   ├── architecture.md         # Full architecture reference
│   ├── SETUP.md                # This file
│   └── access-control.md       # Role system documentation
└── CLAUDE.md                   # AI assistant context (conventions, gotchas, patterns)
```

## Common Tasks

### Deploy a frontend change
```bash
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem \
  public/assets/js/<file>.js \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/public/assets/js/<file>.js
```

### Deploy a backend change
```bash
scp -i ~/.ssh/LightsailDefaultKey-us-west-2.pem \
  scripts/serve-funnel.mjs \
  ubuntu@34.220.57.7:/home/ubuntu/strivve-metrics/scripts/serve-funnel.mjs

ssh -i ~/.ssh/LightsailDefaultKey-us-west-2.pem ubuntu@34.220.57.7 "pm2 restart sis-api"
```

### Add a new user
Edit `secrets/users.json` on the production server. See `docs/access-control.md` for the 9-role system.

### Run tests
```bash
npm test                    # Scoping smoke tests
npm run test:api            # API-level scoping tests
```

## Troubleshooting

**Server crashes on startup with ENOENT**
- Missing `fi_registry.json` — see step 4

**"Authentication required" on all API calls**
- Missing or empty `secrets/users.json` — see step 3

**No data on dashboards after login**
- Data directories are empty — see step 5

**GA-related errors in console**
- GA is optional. If you don't have GA credentials, ignore these warnings. Session and placement data still works.

**Port 8787 already in use**
- Another instance is running. Kill it: `lsof -ti:8787 | xargs kill`
