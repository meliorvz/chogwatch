# CHOG Eligibility Verifier

A web app where users link wallets to a Telegram handle via SIWE signatures. A daily Cloudflare cron job calculates total CHOG exposure (held + LP) and posts eligible users (>1M CHOG) to a Telegram group.

## Project Structure

```
chogwatch/
├── apps/
│   ├── web/          # Next.js frontend (Cloudflare Pages)
│   └── worker/       # Cloudflare Worker (API + Cron)
├── migrations/       # D1 database migrations
└── package.json      # Root monorepo config
```

## Prerequisites

- Node.js 18+
- npm 8+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with D1 access

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create D1 Database

```bash
cd apps/worker
wrangler d1 create chogwatch
```

Update `apps/worker/wrangler.toml` with the returned `database_id`.

### 3. Run Migrations

```bash
cd apps/worker
wrangler d1 migrations apply chogwatch --local    # For local dev
wrangler d1 migrations apply chogwatch --remote   # For production
```

Note: Copy the migration file first:
```bash
cp migrations/0001_initial.sql apps/worker/migrations/
```

### 4. Set Secrets

```bash
cd apps/worker
wrangler secret put TELEGRAM_BOT_TOKEN    # From @BotFather
wrangler secret put TELEGRAM_CHAT_ID      # Target group/channel ID
wrangler secret put ADMIN_TOKEN           # Your admin API key
```

### 5. Run Locally

```bash
# Terminal 1: Worker (API)
cd apps/worker
npm run dev
# Runs on http://localhost:8787

# Terminal 2: Frontend
cd apps/web
npm run dev
# Runs on http://localhost:3000
```

## Deployment

### Deploy Worker

```bash
cd apps/worker
wrangler deploy
```

### Deploy Frontend

```bash
cd apps/web
npm run build
wrangler pages deploy out --project-name=chogwatch
```

Update `NEXT_PUBLIC_API_URL` in production to your worker URL.

## Configuration

### Environment Variables

| Variable | Location | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Frontend | Worker API URL |
| `MONAD_RPC_URL` | Worker | Monad RPC endpoint |
| `CHOG_CONTRACT` | Worker | CHOG token address |
| `TELEGRAM_BOT_TOKEN` | Worker secret | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Worker secret | Target chat ID |
| `ADMIN_TOKEN` | Worker secret | Admin API auth |

### Adding LP Pairs

LP pairs are stored in the `lp_pairs` table. Add via D1:

```bash
wrangler d1 execute chogwatch --command "INSERT INTO lp_pairs (pair_address, name, token0, token1, chog_side, enabled, created_at) VALUES ('0x...', 'CHOG/MON Pool', '0x350035555E10d9AfAF1566AaebfCeD5BA6C27777', '0x...', 0, 1, $(date +%s)000)"
```

Parameters:
- `pair_address`: LP pair contract address
- `token0`/`token1`: Token addresses in the pair
- `chog_side`: 0 if CHOG is token0, 1 if token1
- `enabled`: 1 to include in calculations

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/profile/upsert` | Create/load profile |
| GET | `/api/profile/:id` | Get profile details |
| POST | `/api/profile/recover` | Recover via wallet |
| POST | `/api/siwe/nonce` | Get signing nonce |
| POST | `/api/wallets/link` | Link wallet (SIWE) |
| POST | `/api/wallets/unlink` | Remove wallet |
| GET | `/api/wallets/lookup/:address` | Check if linked |
| POST | `/api/admin/screening/run-now` | Manual screening |
| GET | `/api/admin/stats` | Get stats |

## Cron Job

The screening cron runs at 08:00 UTC daily (configured in `wrangler.toml`). It:

1. Loads all profiles with wallets
2. Calculates CHOG exposure per wallet (direct + LP)
3. Aggregates totals per profile
4. Determines eligibility (≥1M CHOG)
5. Sends Telegram summary with newly eligible, dropped, and top holders

## Tech Stack

- **Frontend**: Next.js 14, shadcn/ui, Tailwind CSS, viem, siwe
- **Backend**: Cloudflare Worker, Hono, D1 database
- **Chain**: Monad mainnet (Chain ID 143)
- **Token**: CHOG (`0x350035555E10d9AfAF1566AaebfCeD5BA6C27777`)

## License

MIT
