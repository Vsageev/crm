# TOFIX

## Critical

- **Plaintext workspace API keys** (`services/agents.ts:219`) — `wsKey.rawKey` stored in database without hashing, unlike regular API keys which use `keyHash`. A compromised DB dump exposes all agent workspace credentials.
- **Workspace API key exposed via agent endpoints** (`services/agents.ts:156-160`, `routes/agents.ts:72-76`, `routes/agents.ts:154-158`) — `asAgent()` returns all fields including `workspaceApiKey`, and list/get routes return this directly. This leaks a write-capable internal key to any user with `settings:read` permission.
- **HTML sanitization via regex** (`frontend/src/pages/inbox/InboxPage.tsx:254`, `renderFormattedContent()`) — regex-based HTML filtering with user-controlled `<a href>` is an XSS vector. Use DOMPurify or a proper HTML sanitization library.

## High

- **No rollback on agent creation** (`services/agents.ts:193-246`) — if preset rendering or workspace file creation fails mid-way, partial agent record and API key persist. Validate everything and prepare all data before inserting into store.
- **Backend build can ship stale presets after first build** (`packages/backend/package.json:8`, `services/agents.ts:41-51`) — `cp -r src/presets dist/presets` nests into existing dir on repeated builds (`dist/presets/presets/*`), while loader reads only `dist/presets/*`. Changed presets may not be picked up unless `dist` is cleaned. Use `rm -rf dist/presets && cp -r src/presets dist/presets`.
- **FilePreviewModal race condition** (`frontend/src/components/FilePreviewModal.tsx`) — rapidly opening/closing spawns concurrent fetches without aborting previous ones. Add `AbortController` and cancel pending requests on unmount or when source changes.
- **Memory leak in agent-chat-runtime** (`frontend/src/stores/agent-chat-runtime.ts`) — `streamsById` Map has no max size limit; 2-minute retention may accumulate entries under heavy use. Add a max cap (e.g., 100 streams) and evict oldest when exceeded.
- **Agent deletion misses legacy conversations** (`services/agents.ts:276-283`) — cleanup only targets `channelType === 'agent'`; legacy rows with `channelType: 'other'` + `metadata.agentId` remain orphaned. Update query to also match legacy pattern.
- **Agent conversation draft cleanup uses wrong collection key** (`services/agent-chat.ts:174`) — deletes from `message_drafts`, but draft services use `messageDrafts` (camelCase). Related drafts may not be deleted on conversation deletion.

## Medium

- **Overly permissive channelType schema** (`schemas/collections.ts:149`) — `channelType: z.string()` accepts any value. Should be a union: `z.enum(['telegram', 'internal', 'other', 'agent', 'email', 'web_chat'])` or similar constrained type.
- **Unimplemented channel types in routes** (`routes/conversations.ts:19`) — `'email'` and `'web_chat'` added to enum but no corresponding handlers/services exist. Remove until implemented or add stub handling.
- **SSE error handling incomplete** (`services/agent-chat.ts:368-372`) — `child.on('error')` callback writes to SSE stream after `reply.raw.end()` may have been called. Error events during startup may not reach client.
- **No rate limiting on prompt execution** (`routes/agent-chat.ts:215-221`) — 50KB prompts can spawn processes without concurrency controls per agent or per user. Add rate limiting middleware.
- **Missing system contact validation** (`services/agent-chat.ts:141`) — `contactId: 'system'` assumed to exist without validation. Add check or create system contact on first use.
- **Duplicated utilities** — `formatFileSize()` / `formatBytes()` implemented in 3 places (`frontend/src/lib/file-utils.ts`, `InboxPage.tsx`, `BackupsTab.tsx`). Consolidate into shared utility module.
- **Inconsistent API response shapes** — list endpoints return varying shapes: `{entries, total, limit, offset}` vs `{entries}` vs `{clis}`. Standardize on `{entries, total, limit?, offset?}` pattern.
- **Missing tests for agent services** — no unit or integration tests for `services/agents.ts`, `services/agent-chat.ts`, or agent routes. Add test coverage for CRUD, chat streaming, and file operations.

## Low

- **Inconsistent error UX** — `CardDetailPage.tsx` uses `alert()` while other pages use inline/toast patterns. Standardize on toast/notification system.
- **Extract shared Modal component** — each page (`AgentsPage`, `ApiKeysTab`, `BackupsTab`, `CardDetailPage`) reimplements overlay/modal patterns independently. Create reusable `Modal` component.
- **Missing memoization in CardDetailPage** — `Object.entries()` and `new Set()` created on every render. Wrap in `useMemo()`.
- **StoragePage drag counter** — `dragCounter` ref can get stuck if drag events are missed (e.g., user switches tabs mid-drag). Add global `dragleave` on window or use `useEffect` cleanup.
- **No scroll-to-bottom in agent chat** — when new messages stream in, view doesn't auto-scroll. Add `useEffect` to scroll message panel on `text` update.
- **AgentsPage.tsx is ~1800+ lines** — split into sub-components: `AgentListSidebar`, `ChatPanel`, `FileExplorer`, `CreateAgentModal`.
- **Broken path in api-agent.md** (`.claude/agents/api-agent.md:4`) — references `/BACKEND_GUIDELINES.md` but actual file is `docs/backend-api-design-guidelines.md`.
- **Agent avatar picker color presets overflow** — on small screens, the presets grid in `AgentAvatar.tsx` extends beyond modal bounds. Add `max-height` with scroll.

## Fixed

- ~~**Path traversal in agent file operations**~~ — FIXED: `validateAgentPath()` (line 338-347) now properly resolves and verifies paths stay within workspace root.
- ~~**SSE busy-check ordering**~~ — FIXED: busy check (line 215-221) now occurs before SSE headers are written (line 228-231).
