# Workspace Content

Use this section for customer data structures and operations on work items.

## Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces`
- `PATCH /api/workspaces/:id`
- `DELETE /api/workspaces/:id`

## Boards

- `GET /api/boards`, `POST /api/boards`, `PATCH /api/boards/:id`, `DELETE /api/boards/:id`
- Columns:
  - `POST /api/boards/:id/columns`
  - `PATCH /api/boards/:id/columns/:columnId`
  - `DELETE /api/boards/:id/columns/:columnId`
- Card placement:
  - `POST /api/boards/:id/cards`
  - `PATCH /api/boards/:id/cards/:cardId` (move/remap semantics)
  - `DELETE /api/boards/:id/cards/:cardId`
- Execution plans:
  - `GET /api/boards/:id/execution-plans`
  - `POST /api/boards/:id/execution-plans`
  - `GET /api/boards/:id/execution-plans/:planId`
  - `PATCH /api/boards/:id/execution-plans/:planId`
  - `DELETE /api/boards/:id/execution-plans/:planId`
- Board batch automation:
  - `GET /api/boards/:id/batch-run/preview`
  - `POST /api/boards/:id/batch-run`
  - `GET /api/boards/:id/batch-runs`
  - `GET /api/boards/:id/batch-runs/:runId`
  - `GET /api/boards/:id/batch-runs/:runId/items`
  - `POST /api/boards/:id/batch-runs/:runId/cancel`

### Board execution plans

A board execution plan is a saved, board-scoped ordering of cards for later
agent batch execution. It is not the batch run itself.

- Plans live under `/api/boards/:id/execution-plans` and require
  `boards:read` for reads and `boards:update` for create/update/delete.
- Plan payloads use `layers[].cards[].id` for board card IDs. Each card can
  optionally carry `dependencyRule`.
- Supported dependency rule modes are `none`, `previous_layer`,
  `all_previous_layers`, and `specific_cards`.
- `specific_cards` dependencies must point to cards already present in earlier
  plan layers.
- Optional `blockingMode` is `all_success` or `all_settled`.
- Hydrated plans return `status: draft | ready | invalid` and `issues`.
  `draft` means there are no cards; `invalid` usually means a card was deleted,
  removed from the board, depends on itself, depends on a card outside the plan,
  or depends on a card that is not in an earlier layer.

To run a saved plan, fetch it and call `POST /api/boards/:id/batch-run`.
There is no separate `run plan` endpoint. Use:

- `cardIds`: all plan card IDs in layer order.
- `stages`: optional layer labels, one stage per non-empty layer.
- `cardDependencies`: dependencies compiled from each card's `dependencyRule`.

Default UI semantics are: cards in layer 1 have no dependencies; later-layer
cards without an explicit rule depend on the previous layer. Batch runs are
execution snapshots, so later edits to the saved plan do not mutate an already
queued run.

## Collections

- `GET /api/collections`
- `POST /api/collections`
- `PATCH /api/collections/:id`
- `DELETE /api/collections/:id`
- `GET /api/collections/:id/cards` to list members
- Batch automation:
  - `POST /api/collections/:id/agent-batch`
  - `GET /api/collections/:id/agent-batch/runs`
  - `GET /api/collections/:id/agent-batch/runs/:runId`
  - `GET /api/collections/:id/agent-batch/runs/:runId/items`
  - `POST /api/collections/:id/agent-batch/runs/:runId/cancel`

## Cards and tags

- `GET /api/cards`, `GET /api/cards/:id`, `POST /api/cards`, `PATCH /api/cards/:id`,
  `DELETE /api/cards/:id`
- Card relationships:
  - `POST /api/cards/:id/tags`
  - `DELETE /api/cards/:id/tags/:tagId`
  - `POST /api/cards/:id/links`
  - `DELETE /api/cards/:id/links/:linkId`
  - `GET /api/cards/:id/comments`
  - `POST /api/cards/:id/comments`
  - `PATCH /api/cards/:id/comments/:commentId`
  - `DELETE /api/cards/:id/comments/:commentId`
- Helpers:
  - `POST /api/cards/:id/comments/upload`
  - `POST /api/cards/description/images/upload`
  - `POST /api/cards/:id/description/images/upload`

Tag endpoints:

- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/tags/:id`
- `DELETE /api/tags/:id`

## Quick flow: card-to-agent batch

1. Create board/collection/card scope.
2. For ordered board work, create or fetch a board execution plan.
3. Run the agent task on the board or collection batch endpoint. For a board
   plan, compile its layers into `cardIds` and `cardDependencies` first.
4. Poll run status using board/collection run endpoints.

## Where to verify exact schemas

- Route implementations:
  - `packages/backend/src/routes/workspaces.ts`
  - `packages/backend/src/routes/boards.ts`
  - `packages/backend/src/routes/collections.ts`
  - `packages/backend/src/routes/cards.ts`
  - `packages/backend/src/routes/tags.ts`
- Related services for shared behavior:
  - `packages/backend/src/services/boards.ts`
  - `packages/backend/src/services/collections.ts`
  - `packages/backend/src/services/cards.ts`
