# PostgreSQL Schema Notes

The applied SQL migrations are the database source of truth. `src/db/schema.ts`
must mirror every hard foreign key that exists in those migrations so Drizzle
queries, type inference, and future generated migrations do not drift from the
live schema.

All current hard foreign keys use PostgreSQL `ON DELETE NO ACTION ON UPDATE NO
ACTION`. The database intentionally rejects deletes or primary-key updates until
the service layer has performed the entity-specific lifecycle below. Do not add
database cascades without first changing this policy and the delete tests.

## Delete Lifecycle Policy

| Entity | Policy |
| --- | --- |
| `users` | Reject physical deletion while referenced. Agent service users are deactivated (`is_active=false`) and refresh tokens are removed when their agent is deleted. |
| `api_keys` | Physical delete is allowed only when no `agents`, `settings`, or other rows reference the key; callers must unlink or reject first. |
| `agent_groups` | Manual cleanup: clear `agents.group_id`, then delete the group. |
| `agents` | Soft lifecycle: stop cron work, delete env vars/external keys, close agent conversations with `agentDeleted` metadata, deactivate the service user, detach/revoke workspace API keys, cancel active queue/batch work, then mark the agent `inactive` with `archived_at`. Run history remains linked for auditability. |
| `agent_env_vars`, `refresh_tokens`, runner pairing codes/tokens, webhooks, webhook deliveries | Operational rows are physically deleted by their owning service or retention flow. Parent deletion must clean children first or reject on the FK. |
| `collections` | Reject while referenced by cards, boards, workspaces, or batch items unless a service performs an explicit migration/reassignment first. |
| `boards` | Manual cleanup: delete board columns and board-card placements, then delete the board. |
| `board_columns` | Manual cleanup: remove board-card placements in the column before deleting the column. |
| `cards` | Manual cleanup: delete comments, tags, board placements, links, and batch items; clear `agent_runs.card_id`; then delete the card. |
| `tags` | Manual cleanup: delete `card_tags` rows before deleting the tag. |
| `conversations` | Manual cleanup: delete queue rows, clear `agent_runs.conversation_id` and `agent_runs.turn_id`, delete chat turns, messages, and drafts, then delete the conversation. Non-agent conversation deletion uses the same message/draft cleanup and must reject if remaining FKs exist. |
| `messages` | Delete only through conversation/chat lifecycle or after clearing dependent chat-turn message links. |
| `agent_chat_turns` | Manual cleanup for conversation deletion: clear self-references (`parent_turn_id`, `supersedes_turn_id`) before deleting turns; clear `agent_runs.turn_id` and delete queue rows first. |
| `agent_runs` | Preserve run history by default. Parents such as cards/conversations clear nullable run references before deletion. Explicit run deletion must first clear/delete dependent queue rows, chat-turn `run_id`, and batch items. |
| `agent_batch_runs` | Manual cleanup: delete `agent_batch_run_items` before deleting the batch run. |
| `workspaces`, `settings`, `contacts`, `telegram_bots`, `board_cron_templates` | Reject deletion while referenced unless a service implements explicit unlink, reassignment, or child cleanup. |

## Intentional Non-FK Legacy Columns

These columns remain indexed/plain text compatibility fields because legacy JSON
data can contain historical ids that are missing, deleted, or not represented by
the target table. Keep the original payload in `legacy_data` and remediate live
rows before promoting any of these to hard FKs:

- `cards.assignee_id`
- `card_comments.author_id`
- `card_comments.agent_run_id`
- `messages.parent_id`

## Agent Chat Turn FK Alignment

Migration `0009_agent_chat_turns.sql` adds hard FKs for the canonical turn model.
The Drizzle schema must include the same constraints:

- `agent_chat_turns.parent_turn_id` -> `agent_chat_turns.id`
- `agent_chat_turns.supersedes_turn_id` -> `agent_chat_turns.id`
- `agent_runs.turn_id` -> `agent_chat_turns.id`

`agent_chat_queue.turn_id` is also FK-constrained and already represented in
`schema.ts`. These constraints are all `NO ACTION`; the chat deletion path owns
the required queue/run/self-reference cleanup order.
