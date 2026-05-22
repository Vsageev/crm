# Discalimer

This is an experimenal preview. If anything broke - ask your cli agent to fix or contact me. Any feedback is alos welcomed

# OpenWork

OpenWork is a workspace platform with boards, cards, folders, unified inbox, Telegram integration, AI agents, and webhook automation.

**Tech stack:** Fastify 5, PostgreSQL (Drizzle ORM), React 19, Vite, TypeScript, Zod v4, pnpm workspaces.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### 1. Clone and install

```bash
git clone <repo-url> && cd openwork
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
cp packages/backend/.env.example packages/backend/.env
```

### 3. Bootstrap backend data (optional)

Requires a running Postgres instance and `DATABASE_URL` in `packages/backend/.env`.

```bash
pnpm db:bootstrap
```

Applies migrations and seeds default workspace records for a fresh environment: admin and starter users, project settings, the general collection, and the default workspace. See [Bootstrap Data](#bootstrap-data) for details.

### 4. Generate HTTPS certs (optional)

```bash
pnpm certs:generate
```

### 5. Start dev servers

```bash
pnpm dev
```

- **Frontend:** https://localhost:5173
- **Landing:** http://localhost:5319
- **Backend API:** http://localhost:3847
- **Swagger docs:** http://localhost:3847/docs

## Project Structure

```
packages/
  backend/     Fastify API server, PostgreSQL data store
  frontend/    React 19 SPA, Vite, React Router
  landing/     Public OpenWork landing page
  shared/      Shared TypeScript types
scripts/       Dev utility scripts (certs, stale process check — see docs/RUNBOOK.md)
docs/          Design system and developer guides
```

### `packages/backend`

REST API server handling all workspace logic. Built with Fastify 5 and fastify-type-provider-zod, uses PostgreSQL with Drizzle ORM for relational data.

Key areas:

- **19 route files** — auth, cards, boards, folders, tags, conversations, messages, agents, agent chat, Telegram, webhooks, media, storage, API keys, permissions, audit logs, backups, message drafts, and health
- **22 services** — agents & agent chat, Telegram bot/webhook/outbound, webhook delivery, event bus, backup, storage, audit logging, and core CRUD for cards, boards, folders, conversations, messages, tags
- **19 data collections** — users, cards, boards, folders, tags, conversations, messages, Telegram bots, webhooks, API keys, audit logs, message drafts, and more
- **Security** — JWT auth with refresh tokens, API key scoped permissions, rate limiting, audit logging

### `packages/frontend`

React 19 single-page application. All pages are lazy-loaded via React Router for code splitting.

Key areas:

- **Pages** — Dashboard, Boards (list/detail), Cards (detail), Folders (list/detail), Inbox, Agents, Storage, Settings (API keys, backups), Auth (login/register)
- **State** — React Context for auth, custom hooks for data fetching
- **API client** (`src/lib/api.ts`) — centralized fetch wrapper with JWT auto-refresh on 401

### `packages/shared`

TypeScript type definitions shared between backend and frontend: permission types and auth interfaces.

### `scripts/`

- **`generate-certs.sh`** — generates local HTTPS certificates via [mkcert](https://github.com/FiloSottile/mkcert) into `certs/`. Run with `pnpm certs:generate`.

## Key Commands

| Command                 | Description                                        |
| ----------------------- | -------------------------------------------------- |
| `pnpm dev`              | Start all dev servers in parallel                  |
| `pnpm dev:backend`      | Start backend only                                 |
| `pnpm dev:frontend`     | Start frontend only                                |
| `pnpm dev:landing`      | Start landing page only                            |
| `pnpm build`            | Build all packages                                 |
| `pnpm lint`             | Lint all packages                                  |
| `pnpm typecheck`        | Type-check all packages                            |
| `pnpm docker:full`      | Start everything in Docker                         |
| `pnpm docker:full:stop` | Stop Docker containers                             |
| `pnpm docker:down`      | Stop and remove Docker containers                  |
| `pnpm db:bootstrap`     | Bootstrap backend SQL data for a fresh environment |
| `pnpm certs:generate`   | Generate local HTTPS certs via mkcert              |

## Features

- **Cards & Folders** — organize work items with tags and links
- **Boards** — Kanban-style boards with customizable columns
- **Unified Inbox** — all conversations in one place
- **Telegram** — workspace-managed bot setup, media support, webhook handling
- **AI Agents** — configurable agents with preset system, file workspaces, and chat interface
- **Webhooks** — webhook subscriptions with delivery tracking
- **Storage** — file upload and media management
- **Security** — JWT auth, API key scoped permissions, rate limiting, audit logging, backups

## Bootstrap Data

Run `pnpm db:bootstrap` from the repo root, or `cd packages/backend && pnpm db:bootstrap`, to initialize a fresh backend database.

**Test accounts:**

| Email                    | Password     |
| ------------------------ | ------------ |
| `admin@workspace.local`   | `admin123`   |
| `manager@workspace.local` | `manager123` |
| `agent1@workspace.local`  | `agent123`   |

## Docker (full stack)

```bash
cp .env.example .env
pnpm docker:full
```

## Environment Variables

See `packages/backend/.env.example` for all backend config.

### Telegram setup

OpenWork can register a Telegram bot created in BotFather and route its webhook traffic into the unified inbox.

1. Set `TELEGRAM_WEBHOOK_BASE_URL` in `packages/backend/.env`.
2. Use `POST /api/telegram/bots` with a BotFather token to connect a bot.

## Guidelines

All project guidelines live in [`docs/`](./docs/):

- [`docs/backend-development.md`](./docs/backend-development.md) — backend code authoring (routes, services, error handling)
- [`docs/design-system.md`](./docs/design-system.md) — colors, typography, components, layout, animations

## License

Private.
