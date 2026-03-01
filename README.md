# Workspace

A workspace platform with boards, cards, folders, unified inbox, Telegram integration, AI agents, and webhook automation.

**Tech stack:** Fastify 5, JSON file store, React 19, Vite, TypeScript, Zod v4, pnpm workspaces.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### 1. Clone and install

```bash
git clone <repo-url> && cd replace_prototype
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
```

### 3. Seed the database (optional)

```bash
cd packages/backend
pnpm db:seed
cd ../..
```

Populates the JSON store with sample data: users, tags, folders, cards, boards, conversations, and more. See [Seed Data](#seed-data) for details.

### 4. Generate HTTPS certs (optional)

```bash
pnpm certs:generate
```

### 5. Start dev servers

```bash
pnpm dev
```

- **Frontend:** https://localhost:5173
- **Backend API:** http://localhost:3000
- **Swagger docs:** http://localhost:3000/docs

## Project Structure

```
packages/
  backend/     Fastify API server, JSON file store
  frontend/    React 19 SPA, Vite, React Router
  shared/      Shared TypeScript types
  widget/      Embeddable lead capture form & chat widgets
  ngrok/       ngrok tunnel utility for local webhook testing
scripts/       Dev utility scripts (cert generation)
docs/          Design system, API guidelines
```

### `packages/backend`

REST API server handling all workspace logic. Built with Fastify 5 and fastify-type-provider-zod, uses a JSON file-based data store.

Key areas:

- **21 route files** — auth, cards, boards, folders, tags, conversations, messages, agents, agent chat, connectors, Telegram, webhooks, media, storage, API keys, permissions, audit logs, backups, message drafts, health, and widget
- **23 services** — agents & agent chat, Telegram bot/webhook/outbound, webhook delivery, event bus, backup, storage, connectors, audit logging, TOTP 2FA, and core CRUD for cards, boards, folders, conversations, messages, tags
- **20 data collections** — users, cards, boards, folders, tags, conversations, messages, connectors, Telegram bots, webhooks, API keys, audit logs, message drafts, and more
- **Security** — JWT auth with refresh tokens, API key scoped permissions, 2FA (TOTP), rate limiting, audit logging

### `packages/frontend`

React 19 single-page application. All pages are lazy-loaded via React Router for code splitting.

Key areas:

- **Pages** — Dashboard, Boards (list/detail), Cards (detail), Folders (list/detail), Inbox, Agents, Connectors, Storage, Settings (API keys, backups), Auth (login/register/2FA)
- **State** — React Context for auth, custom hooks for data fetching
- **API client** (`src/lib/api.ts`) — centralized fetch wrapper with JWT auto-refresh on 401

### `packages/shared`

TypeScript type definitions shared between backend and frontend: permission types and auth interfaces.

### `packages/widget`

Standalone JavaScript widgets embedded on external websites via a `<script>` tag. Built as IIFE bundles with no dependencies, rendered inside Shadow DOM for style isolation.

Two widgets:

- **`crm-form.js`** — lead capture form. Fetches form config from the backend by ID, renders fields dynamically, submits data back. Auto-initializes from `data-crm-form` / `data-crm-api-url` HTML attributes, or via `CrmForm.init()`.
- **`crm-chat.js`** — embedded chat widget for real-time conversations with visitors.

Usage example:

```html
<div data-crm-form="FORM_ID" data-crm-api-url="https://your-api.example.com"></div>
<script src="https://your-cdn.example.com/crm-form.js"></script>
```

### `packages/ngrok`

Utility package that runs an ngrok tunnel to expose the local backend (port 3000) for webhook testing during development.

### `scripts/`

- **`generate-certs.sh`** — generates local HTTPS certificates via [mkcert](https://github.com/FiloSottile/mkcert) into `certs/`. Run with `pnpm certs:generate`.

## Key Commands

| Command                  | Description                                |
| ------------------------ | ------------------------------------------ |
| `pnpm dev`               | Start all dev servers in parallel           |
| `pnpm dev:backend`       | Start backend only                          |
| `pnpm dev:frontend`      | Start frontend only                         |
| `pnpm dev:backend:ngrok` | Start backend + ngrok tunnel                |
| `pnpm dev:ngrok`         | Start ngrok tunnel to local backend (3000)  |
| `pnpm build`             | Build all packages                          |
| `pnpm lint`              | Lint all packages                           |
| `pnpm typecheck`         | Type-check all packages                     |
| `pnpm docker:full`       | Start everything in Docker                  |
| `pnpm docker:full:stop`  | Stop Docker containers                      |
| `pnpm docker:down`       | Stop and remove Docker containers           |
| `pnpm db:seed`           | Seed JSON store with sample data (backend/) |
| `pnpm certs:generate`    | Generate local HTTPS certs via mkcert       |

## Features

- **Cards & Folders** — organize work items with tags and links
- **Boards** — Kanban-style boards with customizable columns
- **Unified Inbox** — all conversations in one place
- **Telegram** — bot integration, media support, webhook handling
- **AI Agents** — configurable agents with preset system, file workspaces, and chat interface
- **Connectors** — external service integrations
- **Lead Capture** — embeddable web forms and chat widgets
- **Webhooks** — webhook subscriptions with delivery tracking
- **Storage** — file upload and media management
- **Security** — JWT auth, API key scoped permissions, 2FA (TOTP), rate limiting, audit logging, backups

## Seed Data

Run `pnpm db:seed` from `packages/backend/` to populate the JSON store with sample data.

**Test accounts:**

| Email                     | Password     |
| ------------------------- | ------------ |
| `admin@workspace.local`   | `admin123`   |
| `manager@workspace.local` | `manager123` |
| `agent1@workspace.local`  | `agent123`   |
| `agent2@workspace.local`  | `agent123`   |

## Docker (full stack)

```bash
cp .env.example .env
pnpm docker:full
```

## Environment Variables

See `packages/backend/.env.example` for all backend config.

## Guidelines

All project guidelines live in [`docs/`](./docs/):

- [`docs/backend-api-design-guidelines.md`](./docs/backend-api-design-guidelines.md) — API patterns for AI agents (idempotency, batching, countOnly, conditional actions, error format)
- [`docs/design-system.md`](./docs/design-system.md) — colors, typography, components, layout, animations

## License

Private.
