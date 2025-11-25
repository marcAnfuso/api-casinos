# Development Scripts

Helper scripts for setting up and debugging the Integration API.

## KOMMO Configuration Scripts

### `get-kommo-custom-fields.sh`
Retrieves custom field IDs from KOMMO for storing player credentials.

**Usage:**
```bash
bash scripts/get-kommo-custom-fields.sh
```

**What it does:**
- Fetches all custom fields for Leads in KOMMO
- Filters for "Username" and "Password" fields
- Shows their IDs (needed for `KOMMO_USERNAME_FIELD_ID` and `KOMMO_PASSWORD_FIELD_ID`)

**Configuration:**
Edit the script to set your KOMMO token and subdomain:
```bash
KOMMO_TOKEN="your_token_here"
KOMMO_SUBDOMAIN="your_subdomain"
```

---

### `get-kommo-scopes.sh`
Retrieves WhatsApp scope IDs from KOMMO.

**Usage:**
```bash
bash scripts/get-kommo-scopes.sh
```

**What it does:**
- Fetches all conversation channels (scopes) in KOMMO
- Shows scope IDs for WhatsApp integration
- Needed for `KOMMO_WHATSAPP_SCOPE_ID` env var

**Configuration:**
Edit the script to set your KOMMO token and subdomain.

---

### `get-kommo-statuses.sh`
Retrieves pipeline status IDs from KOMMO.

**Usage:**
```bash
bash scripts/get-kommo-statuses.sh
```

**What it does:**
- Fetches all pipelines and their statuses
- Shows status IDs and names
- Needed for `KOMMO_COMPROBANTE_STATUS_ID` env var (the status for "Comprobante Recibido")

**Configuration:**
Edit the script to set your KOMMO token and subdomain.

**Example output:**
```json
{
  "pipeline_id": 123456,
  "pipeline_name": "Main Pipeline",
  "statuses": [
    {
      "status_id": 142,
      "status_name": "Comprobante Recibido",
      "color": "#99ccff"
    }
  ]
}
```

---

## bet30 Proxy

### `proxy-bet30.js`
Local proxy server for bet30 API calls (workaround for IP blocking).

**Usage:**
```bash
# Terminal 1: Run proxy
node scripts/proxy-bet30.js

# Terminal 2: Expose with ngrok
ngrok http 3002
```

**What it does:**
- Runs an Express server on port 3002
- Proxies requests from Vercel to bet30 API
- Bypasses IP blocking by using your local IP

**When to use:**
- Only needed if bet30 blocks Vercel's IP addresses
- Test first without proxy - if it works, you don't need this

**Configuration:**
Set `BET30_PROXY_URL` in Vercel environment variables to your ngrok URL:
```
BET30_PROXY_URL=https://abc123.ngrok-free.app
```

**Note:** Free ngrok URLs change on restart. For production:
- Use ngrok Pro (fixed URL)
- Or deploy proxy to Railway/Render

---

## Quick Setup Workflow

1. **Get KOMMO field IDs:**
   ```bash
   bash scripts/get-kommo-custom-fields.sh
   # Copy Username and Password field IDs
   ```

2. **Get KOMMO WhatsApp scope:**
   ```bash
   bash scripts/get-kommo-scopes.sh
   # Copy the WhatsApp scope ID
   ```

3. **Get KOMMO status IDs:**
   ```bash
   bash scripts/get-kommo-statuses.sh
   # Copy the "Comprobante Recibido" status ID
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with the IDs from above
   ```

5. **Test locally:**
   ```bash
   npm run dev
   # API runs on http://localhost:4000
   ```

6. **(Optional) Run proxy if needed:**
   ```bash
   node scripts/proxy-bet30.js
   # In another terminal:
   ngrok http 3002
   ```

---

## Security Notes

- ⚠️ **Never commit these scripts with real tokens**
- All scripts have placeholder tokens by default
- Replace with your actual tokens before running
- Tokens are displayed in output - be careful when sharing screenshots/logs
