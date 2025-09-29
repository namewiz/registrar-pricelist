# registrar-pricelist

Small Node.js utilities that generate structured JSON price lists for TLDs from different sources:

- Openprovider: parses a public Google Sheet into JSON.
- Namecheap: calls the official API and normalizes prices.
- NIRA: converts fixed NGN list prices to USD using a live FX rate.

## Prerequisites

- Node.js 18+ (for built‑in `fetch`).
- npm (to install dependencies).

Install dependencies once:

```bash
npm install
```

## Generate Price Lists

All commands write results into the `data/` folder by default.

### Openprovider

Parses the Openprovider price sheet (Google Sheets) and emits a compact JSON file with year=1 prices and `maxYears` for each TLD.

- Script: `node gen-openprovider-prices.js [sheetUrl] [outPath]`
- NPM script: `npm run gen-openprovider`
- Defaults:
  - `sheetUrl`: built into the script (public sheet)
  - `outPath`: `data/openprovider-prices.json`

Example:

```bash
npm run gen-openprovider
# or
node gen-openprovider-prices.js \
  "https://docs.google.com/spreadsheets/d/1fHBHaxICLF7yhyEI5ir4jvY4H5h4nSa-aIgSMaP0500/edit?gid=1726709886#gid=1726709886" \
  data/openprovider-prices.json
```

### Namecheap

Fetches year=1 prices from Namecheap’s API for create/renew/transfer/restore and organizes them per TLD.

- Script: `node gen-namecheap-prices.js [-v] [outPath]`
- NPM script: `npm run gen-namecheap`
- Default `outPath`: `data/namecheap-prices.json`
- Caches TLD metadata: `.cache/namecheap-tlds.json` (24h TTL)

Required environment variables:

- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME` (typically same as API user)
- `NAMECHEAP_CLIENT_IP` (your whitelisted IP)

Optional environment variables:

- `NAMECHEAP_SANDBOX=1` (use sandbox endpoint)
- `NAMECHEAP_BASE_URL` (override API base URL)
- `NAMECHEAP_TLD_CACHE` (cache path, default `.cache/namecheap-tlds.json`)
- `NAMECHEAP_TLD_CACHE_TTL_MINUTES` (default `1440`)

Example:

```bash
export NAMECHEAP_API_USER=...
export NAMECHEAP_API_KEY=...
export NAMECHEAP_USERNAME=...
export NAMECHEAP_CLIENT_IP=...
# optional: export NAMECHEAP_SANDBOX=1
npm run gen-namecheap
```

### NIRA

Derives simple USD prices for selected NIRA namespaces from fixed NGN list prices using a live FX rate.

- Script: `node gen-nira-prices.js [outPath]`
- NPM script: `npm run gen-nira`
- Default `outPath`: `data/nira-prices.json`
- Optional env: `FX_URL` (default `https://www.floatrates.com/daily/usd.json`)

Example:

```bash
npm run gen-nira
```

## Output Formats (brief)

Each output includes a `meta` object and a `data` map. Year=1 prices are captured for operations where applicable.

Openprovider (`data/openprovider-prices.json`):

```json
{
  "meta": { /* source info, headers, counts */ },
  "data": {
    "tld": {
      "maxYears": 10,
      "non-member-price": { "create": 8.27, "renew": 11.82, "transfer": 8.27, "restore": 17.75 },
      "member-price":     { "create": 4.73, "renew": 4.73,  "transfer": 4.73,  "restore": 17.75 }
    }
  }
}
```

Namecheap (`data/namecheap-prices.json`):

```json
{
  "meta": { /* source, endpoint, currency, counts */ },
  "data": {
    "tld": {
      "maxYears": 10,
      "regular-price": { "create": 12.98, "renew": 14.98, "transfer": 13.98 },
      "sale-price":    { "create": 1.98,  "renew": 12.98, "transfer": 11.98 }
    }
  }
}
```

NIRA (`data/nira-prices.json`):

```json
{
  "meta": { /* fx source and rate */ },
  "data": {
    "ng":     { "create": 10.08, "renew": 10.08 },
    "com.ng": { "create":  4.70, "renew":  4.70 }
  }
}
```

## Notes

- Only 1‑year prices are included in the operation maps; `maxYears` captures the maximum supported years per TLD when available.
- The Openprovider script expects the sheet to be publicly accessible (no auth) and to include the required headers.
- `.gitignore` excludes `node_modules/` and the `.cache/` folder.

## Quick Commands

```bash
# Install dependencies
npm install

# Generate all defaults (writes to data/)
npm run gen-openprovider
npm run gen-nira
# Requires env vars set first
npm run gen-namecheap
```
