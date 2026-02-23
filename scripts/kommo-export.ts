/**
 * Kommo (amoCRM) data export POC
 *
 * Pulls leads, contacts, companies, pipelines, and tasks from the Kommo API v4
 * and saves raw API responses into a single JSON dump file.
 *
 * Usage:
 *   KOMMO_SUBDOMAIN=mycompany KOMMO_TOKEN=xxx pnpm exec tsx scripts/kommo-export.ts
 *
 * Output:
 *   scripts/kommo-export-<timestamp>.json
 */

import fs from "node:fs";
import path from "node:path";

// ─── Config ───────────────────────────────────────────────────────────────────

const SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
const TOKEN = process.env.KOMMO_TOKEN;
const BASE_URL = `https://${SUBDOMAIN}.kommo.com/api/v4`;
const OUT_DIR = path.resolve(import.meta.dirname);

if (!SUBDOMAIN || !TOKEN) {
  console.error("Missing KOMMO_SUBDOMAIN or KOMMO_TOKEN env vars");
  process.exit(1);
}

// ─── Kommo API helpers ────────────────────────────────────────────────────────

async function kommoGet<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${BASE_URL}${endpoint}`);
    url.searchParams.set("limit", "250");
    url.searchParams.set("page", String(page));
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    console.log(`  GET ${url.pathname}?page=${page}`);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (res.status === 204) break; // no more data

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kommo API ${res.status}: ${text}`);
    }

    const json = (await res.json()) as any;
    const embedded = json._embedded;
    if (!embedded) break;

    // _embedded has a key like "leads", "contacts", "companies", etc.
    const key = Object.keys(embedded)[0];
    const batch = embedded[key] as T[];
    if (!batch || batch.length === 0) break;

    items.push(...batch);

    // Stop if fewer than limit — last page
    if (batch.length < 250) break;
    page++;
  }

  return items;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Kommo Export POC`);
  console.log(`  Subdomain: ${SUBDOMAIN}\n`);

  // 1. Pipelines (includes stages in _embedded)
  console.log("Fetching pipelines...");
  const pipelines = await kommoGet("/leads/pipelines");
  console.log(`  Found ${pipelines.length} pipelines\n`);

  // 2. Companies
  console.log("Fetching companies...");
  const companies = await kommoGet("/companies", { with: "contacts" });
  console.log(`  Found ${companies.length} companies\n`);

  // 3. Contacts
  console.log("Fetching contacts...");
  const contacts = await kommoGet("/contacts", { with: "companies" });
  console.log(`  Found ${contacts.length} contacts\n`);

  // 4. Leads
  console.log("Fetching leads...");
  const leads = await kommoGet("/leads", { with: "contacts,companies" });
  console.log(`  Found ${leads.length} leads\n`);

  // 5. Tasks
  console.log("Fetching tasks...");
  const tasks = await kommoGet("/tasks");
  console.log(`  Found ${tasks.length} tasks\n`);

  // 6. Users
  console.log("Fetching users...");
  const users = await kommoGet("/users");
  console.log(`  Found ${users.length} users\n`);

  const dump = {
    exportedAt: new Date().toISOString(),
    subdomain: SUBDOMAIN,
    pipelines,
    companies,
    contacts,
    leads,
    tasks,
    users,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(OUT_DIR, `kommo-export-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2) + "\n");

  console.log(`Done! Saved to ${outPath}`);
  console.log(`  ${pipelines.length} pipelines`);
  console.log(`  ${companies.length} companies`);
  console.log(`  ${contacts.length} contacts`);
  console.log(`  ${leads.length} leads`);
  console.log(`  ${tasks.length} tasks`);
  console.log(`  ${users.length} users`);
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
