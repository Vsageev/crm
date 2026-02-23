# Kommo (amoCRM) Export

Script to pull raw data from the Kommo API v4 into a local JSON dump.

## Prerequisites

1. Go to your Kommo account → Settings → Integrations
2. Create a **private integration**
3. Open **Keys and scopes** tab
4. Click **Generate long-lived token** (up to 5 years validity)
5. Copy the token — it won't be shown again

## Usage

```bash
KOMMO_SUBDOMAIN=yourcompany KOMMO_TOKEN=your_token pnpm exec tsx scripts/kommo-export.ts
```

`KOMMO_SUBDOMAIN` is the part before `.kommo.com` (e.g. for `acme.kommo.com` use `acme`).

## Output

Creates `scripts/kommo-export-<timestamp>.json` containing raw API responses:

- `pipelines` — sales pipelines with embedded stages
- `companies` — company records with custom fields
- `contacts` — contacts with linked companies
- `leads` — leads/deals with linked contacts and companies
- `tasks` — tasks linked to entities
- `users` — account users

## Notes

- Kommo API returns max 250 items per page; the script paginates automatically
- Rate limits: 7 requests/second on most plans — the script makes sequential calls so this shouldn't be an issue
