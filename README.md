# CRM System

A full-featured CRM with contacts, deals pipeline, tasks, unified inbox, Telegram integration, automation engine, and reporting.

**Tech stack:** Fastify, Drizzle ORM, PostgreSQL, Redis, React 19, Vite, TypeScript, pnpm workspaces.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

### 1. Clone and install

```bash
git clone <repo-url> && cd replace
pnpm install
```

### 2. Start infrastructure

```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
pnpm docker:infra
```

This starts PostgreSQL and Redis in Docker.

### 3. Set up the database

```bash
cd packages/backend
pnpm db:push
cd ../..
```

### 4. Seed the database (optional)

```bash
cd packages/backend
pnpm db:seed
cd ../..
```

This populates the database with sample data: users, companies, contacts, deals, tasks, conversations, and more. See [Seed Data](#seed-data) for details.

### 5. Generate HTTPS certs (optional)

```bash
pnpm certs:generate
```

### 6. Start dev servers

```bash
pnpm dev
```

- **Frontend:** https://localhost:5173
- **Backend API:** http://localhost:3000
- **Swagger docs:** http://localhost:3000/docs

## Project Structure

```
packages/
  backend/     Fastify API server, Drizzle ORM, PostgreSQL
  frontend/    React 19 SPA, Vite, React Router
  shared/      Shared TypeScript types
  widget/      Embeddable lead capture form & chat widgets
scripts/       Dev utility scripts (cert generation)
```

### `packages/backend`

REST API server handling all CRM business logic. Built with Fastify 5, uses a JSON-based data store (Drizzle schema defined for reference/migrations but not used at runtime).

Key areas:

- **29 route files** — auth, contacts, companies, deals, tasks, conversations, messages, automation rules, webhooks, public API, reports, web forms, settings, and channel-specific routes (Telegram, WhatsApp, Instagram, email)
- **50+ services** — automation engine, channel webhooks, email sync (IMAP/SMTP), chatbot flows, CSV import/export, duplicate detection, round-robin assignment, GDPR export, webhook delivery with retry
- **34 DB tables** — users, contacts, companies, deals, pipelines, tasks, conversations, messages, automation rules, web forms, webhooks, API keys, and integration tables for each channel
- **Security** — JWT auth with refresh tokens, RBAC (79 permissions across admin/manager/agent), 2FA (TOTP), rate limiting, input sanitization, audit logging

### `packages/frontend`

React 19 single-page application. All pages are lazy-loaded via React Router for code splitting.

Key areas:

- **Pages** — Dashboard, Contacts (list/detail/form), Companies, Deals (Kanban), Tasks (list/detail/form), Inbox (unified conversations), Automation Rules, Reports, Settings, Auth (login/register/2FA)
- **State** — React Context for auth, custom `useQuery` hook for data fetching
- **API client** (`src/lib/api.ts`) — centralized fetch wrapper with JWT auto-refresh on 401

### `packages/shared`

TypeScript type definitions shared between backend and frontend: user roles, permissions matrix (RBAC), contact sources, deal stages, custom field types, and auth interfaces. Keeps both sides in sync without runtime dependencies.

### `packages/widget`

Standalone JavaScript widgets embedded on **external** (third-party) websites via a `<script>` tag. Built as IIFE bundles with no dependencies, rendered inside Shadow DOM for style isolation.

Two widgets:

- **`crm-form.js`** — lead capture form. Fetches form config from the backend by ID, renders fields dynamically, submits data back. Auto-initializes from `data-crm-form` / `data-crm-api-url` HTML attributes, or via `CrmForm.init()`.
- **`crm-chat.js`** — embedded chat widget for real-time conversations with visitors.

Usage example:

```html
<div data-crm-form="FORM_ID" data-crm-api-url="https://your-api.example.com"></div>
<script src="https://your-cdn.example.com/crm-form.js"></script>
```

### `scripts/`

- **`generate-certs.sh`** — generates local HTTPS certificates via [mkcert](https://github.com/FiloSottile/mkcert) into `certs/`. Run with `pnpm certs:generate`.

## Key Commands

| Command                  | Description                                  |
| ------------------------ | -------------------------------------------- |
| `pnpm dev`               | Start all dev servers in parallel (+ ngrok)  |
| `pnpm dev:backend:ngrok` | Start backend + reserved ngrok tunnel        |
| `pnpm dev:ngrok`         | Start ngrok tunnel to local backend (3000)   |
| `pnpm build`             | Build all packages                           |
| `pnpm test`              | Run all tests                                |
| `pnpm lint`              | Lint all packages                            |
| `pnpm typecheck`         | Type-check all packages                      |
| `pnpm docker:infra`      | Start Postgres + Redis                       |
| `pnpm docker:infra:stop` | Stop infrastructure                          |
| `pnpm docker:full`       | Start everything in Docker                   |
| `pnpm db:generate`       | Generate Drizzle migrations (in backend/)    |
| `pnpm db:push`           | Push schema to database (in backend/)        |
| `pnpm db:seed`           | Seed database with sample data (in backend/) |
| `pnpm db:studio`         | Open Drizzle Studio (in backend/)            |

## Features

- **Contacts & Companies** -- custom fields, tags, CSV import/export, duplicate detection
- **Deals Pipeline** -- Kanban board, customizable stages, ownership scoping
- **Tasks** -- linked to contacts/deals, due date reminders, calendar view
- **Unified Inbox** -- all conversations in one place, quick-reply templates
- **Telegram** -- bot integration, media support, chatbot flows, agent notifications
- **Lead Capture** -- embeddable web forms, UTM tracking, auto-create contacts + deals
- **Automation** -- trigger/condition/action rules, round-robin assignment, auto-stage moves
- **Reporting** -- pipeline summary, agent performance, lead source breakdown, CSV export
- **API & Webhooks** -- public REST API, API key auth, webhook subscriptions with retry
- **Security** -- RBAC, 2FA (TOTP), rate limiting, audit logging, daily backups, GDPR export

## Seed Data

Run `pnpm db:seed` from `packages/backend/` to populate the database with realistic sample data:

| Entity        | Count | Details                                         |
| ------------- | ----- | ----------------------------------------------- |
| Users         | 4     | 1 admin, 1 manager, 2 agents                    |
| Tags          | 5     | VIP, Partner, Lead, Hot, Cold                   |
| Companies     | 5     | Various industries and sizes                    |
| Contacts      | 8     | Linked to companies, with UTM tracking          |
| Pipelines     | 2     | Sales (6 stages), Partner Onboarding (5 stages) |
| Deals         | 6     | Across pipeline stages, $5K–$120K               |
| Tasks         | 5     | Calls, emails, meetings linked to deals         |
| Activity Logs | 4     | Calls, meetings, notes with timestamps          |
| Conversations | 2     | Email and web chat channels with 5 messages     |

**Test accounts:**

| Email               | Password     | Role    |
| ------------------- | ------------ | ------- |
| `admin@crm.local`   | `admin123`   | Admin   |
| `manager@crm.local` | `manager123` | Manager |
| `agent1@crm.local`  | `agent123`   | Agent   |
| `agent2@crm.local`  | `agent123`   | Agent   |

> **Note:** The seed script inserts data directly — run it on a fresh database after `pnpm db:push`. Running it twice will fail due to unique constraints.

## Docker (full stack)

```bash
cp .env.example .env
pnpm docker:full
```

## Environment Variables

See `packages/backend/.env.example` for all backend config including database, Redis, Telegram, and backup settings.

## License

Private.
