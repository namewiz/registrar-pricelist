# registrar-pricelist

Utilities for generating structured JSON price lists for domain registrars. The project currently supports:

- **Openprovider** – parses a public Google Sheet into a compact structure.
- **Namecheap** – calls the official API and normalises create/renew/transfer/restore prices.
- **NIRA** – converts fixed NGN list prices to USD using a live FX rate.

## Prerequisites

- Node.js 18+ (for built-in `fetch`).
- npm (to install dependencies).

Install dependencies once:

```bash
npm install
```

### Environment via .env

The CLI auto-loads environment variables from a local `.env` file using `dotenv`. You can either export variables in your shell or place them in `.env` at the project root. See `.env.example` for a starting template. CLI flags still take precedence.

## CLI Usage

The CLI generates price lists for the supported registrars. By default all generators run and write into the `data/` directory.

```bash
npx registrar-pricelist
```

Select specific registrars and customise the output directory:

```bash
npx registrar-pricelist --registrars=namecheap,openprovider --outDir=./data
```

Useful flags:

- `--list` – print all available registrar ids.
- `--verbose` – emit detailed progress logs.
- `--help` – display usage information.

### Registrar specific configuration

Each generator accepts configuration through environment variables. The CLI loads these automatically.

**Openprovider**

- `OPENPROVIDER_SHEET_URL` – override the public spreadsheet URL.

**Namecheap**

- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME` (typically same as API user)
- `NAMECHEAP_CLIENT_IP` (your whitelisted IP)
- `NAMECHEAP_SANDBOX=1` (optional – use sandbox endpoint)
- `NAMECHEAP_BASE_URL` (optional – override API base URL)

**NIRA**

- `NIRA_FX_URL` – override the FX feed URL (defaults to the FloatRates USD feed).

## Programmatic Usage

The core library runs in Node or the browser. Generators follow a common interface that returns the structured price object instead of writing to disk.

```js
import { getRegistrarGenerator } from 'registrar-pricelist';

const openprovider = getRegistrarGenerator('openprovider');
const result = await openprovider.generate();
console.log(result.meta.source);
```

Data snapshots ship with the package and can be imported directly:

```js
import { namecheapPrices, dataFiles } from 'registrar-pricelist';

console.log(namecheapPrices.meta.currency);
console.log(Object.keys(dataFiles));
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
      "regular-price": { "create": 8.27, "renew": 11.82, "transfer": 8.27, "restore": 17.75 },
      "member-price":  { "create": 4.73, "renew": 4.73,  "transfer": 4.73,  "restore": 17.75 }
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
    "ng":     { "regular-price": { "create": 10.08, "renew": 10.08 } },
    "com.ng": { "regular-price": { "create":  4.70, "renew":  4.70 } }
  }
}
```

## Notes

- Only 1‑year prices are included in the operation maps; `maxYears` captures the maximum supported years per TLD when available.
- The Openprovider generator expects the sheet to be publicly accessible (no auth) and to include the required headers.
- `.gitignore` excludes `node_modules/`.
