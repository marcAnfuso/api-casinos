# ⚡ Integration API

Webhook integration service for KOMMO CRM + bet30 platform

## Description

Microservice that handles:
- Automatic player creation in bet30 from KOMMO leads
- Payment proof detection via WhatsApp messages
- Lead status updates in KOMMO
- Credentials delivery via WhatsApp

## Endpoints

### `POST /api/create-player-from-kommo`
KOMMO webhook → Creates player in bet30 → Sends credentials

**Flow:**
1. Receives webhook from KOMMO with lead data
2. Generates username/password automatically
3. Creates player in bet30 (via proxy if configured)
4. Saves credentials in KOMMO custom fields
5. Sends credentials to user via WhatsApp

### `POST /api/kommo-message-received`
KOMMO webhook → Detects payment proof → Updates status

**Flow:**
1. Receives webhook when new message arrives
2. Checks for attachments (image/PDF)
3. Changes lead status to "Comprobante Recibido"
4. Adds internal note with file info

### `GET /api/kommo-message-received`
Health check endpoint

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env.local

# 3. Configure variables (see Environment Variables section)

# 4. Run in development
npm run dev

# Server will run on http://localhost:4000
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# KOMMO API
KOMMO_ACCESS_TOKEN=your_token_here
KOMMO_SUBDOMAIN=your_subdomain
KOMMO_WHATSAPP_SCOPE_ID=your_scope_id
KOMMO_USERNAME_FIELD_ID=1492038
KOMMO_PASSWORD_FIELD_ID=1492040
KOMMO_COMPROBANTE_STATUS_ID=your_status_id

# bet30 API
PLAYER_API_TOKEN=your_bearer_token

# Proxy (optional - only if bet30 blocks Vercel IPs)
BET30_PROXY_URL=https://your-ngrok-url.ngrok-free.app
```

### How to get the values:

**KOMMO_COMPROBANTE_STATUS_ID:**
```bash
# Run the helper script:
bash scripts/get-kommo-statuses.sh
# Copy the ID of "Comprobante Recibido" status
```

**KOMMO_USERNAME_FIELD_ID and KOMMO_PASSWORD_FIELD_ID:**
```bash
# Already configured (1492038 and 1492040)
# To verify:
bash scripts/get-kommo-custom-fields.sh
```

**See [scripts/README.md](scripts/README.md) for detailed documentation on all helper scripts.**

## Deployment Options

### Which platform should I use?

**If bet30 blocks Vercel IPs** → Use **DigitalOcean VPS** (see [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md))
- Dedicated IP (not shared)
- Direct connection to bet30 (no proxy needed)
- $6/month

**If bet30 allows Vercel IPs** → Use **Vercel** (easier)
- Free tier (100k requests/month)
- Auto-deploy from GitHub
- May require proxy

---

## Deploy to DigitalOcean VPS (Recommended for bet30)

### Option A: Docker (Recommended if you use Docker)

**Full guide:** [DEPLOY_DOCKER.md](DEPLOY_DOCKER.md)

**Quick start:**
```bash
# On your VPS:
git clone https://github.com/YOUR_USERNAME/integration-api.git
cd integration-api
cp .env.example .env
nano .env  # Configure your variables
docker-compose up -d
```

**Best for:**
- ✅ You already have Docker containers running
- ✅ Consistent with your existing setup
- ✅ Isolated environment

### Option B: PM2 (Alternative)

**Full guide:** [DEPLOY_DIGITALOCEAN.md](DEPLOY_DIGITALOCEAN.md)

**Quick start:**
```bash
# On your VPS:
git clone https://github.com/YOUR_USERNAME/integration-api.git
cd integration-api
npm install
npm run build
pm2 start ecosystem.config.js
```

**Best for:**
- ✅ Simpler setup (no Docker knowledge needed)
- ✅ Direct Node.js process

### Advantages of VPS deployment:
- ✅ No IP blocking from bet30
- ✅ No proxy needed
- ✅ Dedicated resources
- ✅ Full control

---

## Deploy to Vercel (Alternative)

### Option 1: Deploy from GitHub (automated)

1. **Create GitHub repo:**
```bash
git init
git add .
git commit -m "Initial commit: Integration API"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/integration-api.git
git push -u origin main
```

2. **Connect to Vercel:**
   - Go to https://vercel.com/new
   - Import Git Repository
   - Select `integration-api`
   - Vercel auto-detects Next.js
   - Click "Deploy"

3. **Configure environment variables:**
   - Vercel dashboard → Settings → Environment Variables
   - Add all variables from `.env.example`
   - Redeploy to apply changes

4. **Get API URL:**
   - Vercel gives you: `https://integration-api.vercel.app`
   - Use this URL to configure webhooks in KOMMO

### Option 2: Deploy with CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow interactive prompts
# You'll get the production URL
```

## Configure Webhooks in KOMMO

Once deployed, configure these webhooks in KOMMO:

### Webhook 1: Create player
- **URL:** `https://integration-api.vercel.app/api/create-player-from-kommo`
- **Event:** Triggered by Salesbot
- **Method:** POST

### Webhook 2: Detect payment proof
- **URL:** `https://integration-api.vercel.app/api/kommo-message-received`
- **Event:** "Incoming message" (Settings → Webhooks)
- **Method:** POST

## System Architecture

```
User clicks WhatsApp
    ↓
KOMMO Lead created
    ↓
Salesbot → Webhook → /api/create-player-from-kommo
    ↓
bet30 API (via proxy if needed)
    ↓
Account created → Custom fields updated
    ↓
WhatsApp: "Your username is betXXXXXXXX, password Pass1234"
    ↓
User sends payment proof
    ↓
KOMMO webhook → /api/kommo-message-received
    ↓
Detects image/PDF attachment
    ↓
Status → "Comprobante Recibido"
    ↓
Salesbot sends CVU/Alias
```

## bet30 Proxy (Optional)

If bet30 blocks Vercel IPs, you need the proxy:

1. **On your local machine:**
```bash
# Run proxy
node scripts/proxy-bet30.js

# In another terminal:
ngrok http 3002
```

2. **Copy ngrok URL:**
```
https://abc123.ngrok-free.app
```

3. **Add to Vercel:**
   - Settings → Environment Variables
   - `BET30_PROXY_URL` = ngrok URL

**Note:** Free ngrok changes URL on restart. For production consider:
- ngrok Pro (fixed URL)
- Railway/Render for permanent proxy hosting

## Logs and Debugging

### View logs in real-time:
```bash
# With Vercel CLI
vercel logs integration-api --follow

# Or in dashboard:
# https://vercel.com/dashboard → Project → Logs
```

### Health checks:
```bash
# Check if API responds
curl https://integration-api.vercel.app/api/kommo-message-received

# Should respond:
# {"status":"ok","message":"KOMMO message webhook endpoint","timestamp":"..."}
```

## Local Testing

```bash
# Test create player endpoint
curl -X POST http://localhost:4000/api/create-player-from-kommo \
  -H "Content-Type: application/json" \
  -d '{"leads":{"update":[{"id":123456}]}}'

# Test message endpoint
curl -X POST http://localhost:4000/api/kommo-message-received \
  -H "Content-Type: application/json" \
  -d '{"message":{"entity_id":123456,"message_type":"in","attachments":[{"type":"image"}]}}'
```

## Vercel Limits (Free Tier)

- ✅ 100 GB bandwidth/month
- ✅ 100,000 requests/month (~3,300/day)
- ✅ 100 hours serverless execution/month
- ✅ No cold starts with regular traffic

For your use case (hundreds of requests/day), free tier is more than enough.

## Maintenance

### Update code:
```bash
git add .
git commit -m "Update: description of change"
git push origin main

# Vercel auto-deploys
```

### Change environment variables:
1. Vercel dashboard → Settings → Environment Variables
2. Edit variable
3. Redeploy (Deployments → Latest → Redeploy)

### Renew KOMMO token:
If token expires (long-lived tokens last ~4 months):
1. Generate new token in KOMMO
2. Update `KOMMO_ACCESS_TOKEN` in Vercel
3. Redeploy

## Troubleshooting

### Error: "KOMMO_ACCESS_TOKEN not configured"
→ Verify variable is in Vercel Settings → Environment Variables

### Error: "bet30 API returned HTML"
→ bet30 is blocking Vercel IP, activate proxy:
   1. Start `scripts/proxy-bet30.js` on your machine
   2. Expose with ngrok
   3. Configure `BET30_PROXY_URL`

### Webhook not responding in KOMMO
→ Verify URL:
   - Must be HTTPS (Vercel provides automatically)
   - No typos in URL
   - Health check responds: `curl https://your-api.vercel.app/api/kommo-message-received`

### Cold starts (first requests slow)
→ Normal in serverless. Options:
   - Ignore (only affects first request)
   - Use cron job to ping every 5 min (keeps "warm")
   - Migrate to Railway ($5/month, no cold starts)

## Tech Stack

- **Runtime:** Node.js 18+
- **Framework:** Next.js 15.5.6 (API routes)
- **TypeScript:** Strict mode
- **Deploy:** Vercel (serverless functions)
- **Integrations:** KOMMO API, bet30 API, WhatsApp (via KOMMO)

## License

Private

---

**Version:** 1.0.0
**Last updated:** 2025-01-14
