# CHOG Eligibility Verifier

A web app where users link wallets to a Telegram handle via SIWE signatures. A Cloudflare cron job calculates total CHOG exposure (held + LP) and posts eligible users (≥1M CHOG) to a Telegram group.

## Project Structure

```
chogwatch/
├── apps/
│   ├── web/              # Next.js frontend (Cloudflare Pages)
│   └── worker/           # Cloudflare Worker (API + Cron)
│       └── migrations/   # D1 database migrations
└── package.json          # Root monorepo config
```

## Tech Stack

- **Frontend**: Next.js 14, shadcn/ui, Tailwind CSS, viem, siwe
- **Backend**: Cloudflare Worker, Hono, D1 database
- **Chain**: Monad Mainnet (Chain ID 143)
- **Token**: CHOG (`0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`)

---

## Deployment Guide (Step-by-Step for Beginners)

This guide walks you through deploying CHOG Eligibility Verifier to Cloudflare from scratch.

### Prerequisites

1. **Node.js 18+** - Download from [nodejs.org](https://nodejs.org/)
2. **Cloudflare Account** - Sign up at [cloudflare.com](https://cloudflare.com) (free tier works)
3. **Telegram Bot** - You'll create one using @BotFather

### Step 1: Install Wrangler CLI

Wrangler is Cloudflare's CLI tool for managing Workers and Pages.

```bash
npm install -g wrangler
```

Then authenticate with your Cloudflare account:

```bash
wrangler login
```

This opens a browser window to authorize Wrangler.

### Step 2: Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd chogwatch
npm install
```

### Step 3: Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. **Save the bot token** - you'll need it later (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. Add your bot to your Telegram group as an admin

### Step 4: Get Your Telegram Group Chat ID

1. Add your bot to the target group
2. Send a message in the group
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for `"chat":{"id":-1001234567890}` - that negative number is your chat ID
5. **Save this chat ID**

### Step 5: Create the D1 Database

```bash
cd apps/worker
wrangler d1 create chogwatch
```

This outputs something like:

```
✅ Successfully created DB 'chogwatch'

[[d1_databases]]
binding = "DB"
database_name = "chogwatch"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id`** and update `apps/worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "chogwatch"
database_id = "YOUR_DATABASE_ID_HERE"  # <-- paste here
```

### Step 6: Run Database Migrations

Apply all migrations to your production database:

```bash
cd apps/worker
wrangler d1 migrations apply chogwatch --remote
```

Type `y` when prompted to confirm.

### Step 7: Set Worker Secrets

These are sensitive values that shouldn't be in your code:

```bash
cd apps/worker

# Paste your bot token when prompted
wrangler secret put TELEGRAM_BOT_TOKEN

# Paste your group chat ID when prompted (e.g., -1001234567890)
wrangler secret put TELEGRAM_CHAT_ID

# Create a strong random string for admin authentication
wrangler secret put ADMIN_TOKEN
```

**Tip**: Generate a secure ADMIN_TOKEN with: `openssl rand -hex 32`

### Step 8: Deploy the Worker

```bash
cd apps/worker
wrangler deploy
```

Note the worker URL in the output (e.g., `https://chogwatch-worker.your-subdomain.workers.dev`).

### Step 9: Configure and Deploy the Frontend

1. Create `apps/web/.env.production`:

```bash
NEXT_PUBLIC_API_URL=https://chogwatch-worker.your-subdomain.workers.dev
```

2. Build and deploy:

```bash
cd apps/web
npm run build
wrangler pages deploy out --project-name=chogwatch
```

On first deploy, Wrangler may ask if you want to create a new Pages project - select **Yes**.

Your frontend will be available at `https://chogwatch.pages.dev` (or your custom domain).

### Step 10: Set Up the Telegram Webhook

Tell Telegram to send bot updates to your worker:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://chogwatch-worker.your-subdomain.workers.dev/api/telegram/webhook"
```

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

### Step 11: Register as Admin

1. Open a DM with your bot on Telegram
2. Send `/admin` to register your Telegram user ID for receiving OTP codes
3. You can now log into the admin panel at `https://your-frontend-url/7ac3/admin`

---

## Updating / Redeploying

### Redeploy Worker (after code changes)

```bash
cd apps/worker
wrangler deploy
```

### Redeploy Frontend (after code changes)

```bash
cd apps/web
npm run build
wrangler pages deploy out --project-name=chogwatch
```

### Run New Migrations

```bash
cd apps/worker
wrangler d1 migrations apply chogwatch --remote
```

---

## Local Development

### Run Worker Locally

```bash
cd apps/worker
npm run dev
# Runs on http://localhost:8787
```

### Run Frontend Locally

```bash
cd apps/web
npm run dev
# Runs on http://localhost:3000
```

For local development, create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8787
```

### Run Migrations Locally

```bash
cd apps/worker
wrangler d1 migrations apply chogwatch --local
```

---

## Configuration Reference

### Worker Environment Variables (`wrangler.toml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MONAD_RPC_URL` | `https://rpc.monad.xyz` | Monad RPC endpoint |
| `MONAD_CHAIN_ID` | `143` | Monad Mainnet chain ID |
| `CHOG_CONTRACT` | `0x350...777` | CHOG token address |
| `ELIGIBILITY_THRESHOLD` | `1000000` | Minimum CHOG for eligibility |

### Worker Secrets (set via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Target group chat ID |
| `ADMIN_TOKEN` | Password for admin API endpoints |

### Frontend Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Worker API URL |

---

## Cron Job

The screening cron runs hourly (configured in `wrangler.toml`). The worker internally tracks when the last screening occurred and runs the full process based on the configured interval in the database.

The screening process:
1. Loads all profiles with linked wallets
2. Calculates CHOG exposure per wallet (direct + LP positions)
3. Aggregates totals per profile
4. Determines eligibility (≥1M CHOG)
5. Sends a Telegram summary with newly eligible, dropped, and top holders

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/profile/upsert` | Create/load profile |
| GET | `/api/profile/:id` | Get profile details |
| POST | `/api/profile/recover` | Recover via wallet |
| POST | `/api/siwe/nonce` | Get SIWE signing nonce |
| POST | `/api/wallets/link` | Link wallet (SIWE) |
| POST | `/api/wallets/unlink` | Remove wallet |
| GET | `/api/wallets/lookup/:address` | Check if address is linked |
| POST | `/api/admin/screening/run-now` | Trigger manual screening |
| GET | `/api/admin/stats` | Get admin statistics |
| POST | `/api/telegram/webhook` | Telegram bot webhook |

---

## Adding LP Pairs

LP pairs are stored in the `lp_pairs` table. Add via D1:

```bash
cd apps/worker
wrangler d1 execute chogwatch --remote --command "INSERT INTO lp_pairs (pair_address, name, token0, token1, chog_side, enabled, created_at) VALUES ('0x...', 'CHOG/MON Pool', '0x350035555E10d9AfAF1566AaebfCeD5BA6C27777', '0x...', 0, 1, strftime('%s','now') * 1000)"
```

Parameters:
- `pair_address`: LP pair contract address
- `token0`/`token1`: Token addresses in the pair
- `chog_side`: 0 if CHOG is token0, 1 if token1
- `enabled`: 1 to include in calculations

---

## Troubleshooting

### "Webhook was not set" error
- Ensure your worker is deployed and accessible
- Check the worker URL is correct in the curl command

### Bot not responding in group
- Verify the bot is added to the group as an admin
- Check TELEGRAM_CHAT_ID matches your group's ID
- Ensure the webhook is set correctly

### Admin login not working
- Register your Telegram user ID by DMing `/admin` to the bot
- Check that ADMIN_TOKEN secret is set

### Database errors
- Run `wrangler d1 migrations apply chogwatch --remote` to ensure all migrations are applied

---

## License

MIT
