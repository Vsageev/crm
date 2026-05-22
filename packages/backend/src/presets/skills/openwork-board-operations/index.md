---
name: OpenWork Board Operations
description: Use this skill when work is tied to an OpenWork board card or when the agent needs to create, place, move, or comment on board tasks.
---

# OpenWork Board Operations

Use this skill when the task comes from an OpenWork board card or when you need
to update board state as part of the work.

## Use this skill for

- Creating a task card for work that should appear on a board.
- Placing an existing card onto a board column.
- Moving a card to another column as work progresses.
- Leaving progress, handoff, blocker, or completion notes on the card.
- Reading, creating, updating, or running a board execution plan.

## Ground rules

- Treat board state as user-facing workflow state. Keep it accurate.
- Do not assume a board has special built-in columns. `Done`, `Testing`,
  `Review`, `Blocked`, and similar states are ordinary columns.
- Do not create new columns just to satisfy a workflow unless the user asked for
  that explicitly.
- Do not assume a card belongs to only one board. Mutate only the board named in
  the task or the board that currently contains the card.
- Prefer exact IDs from the task context. If you only have names, resolve the
  board first and read its columns before mutating anything.

## Authentication and permissions

- Base API prefix: `/api`
- Auth header: `Authorization: Bearer <token>` or API key
- Typical permissions:
  - `boards:read` / `boards:update`
  - `cards:read` / `cards:create` / `cards:update`

## Core APIs

- Inspect board and columns:
  - `GET /api/boards/:id`
- Create a card:
  - `POST /api/cards`
- Update card fields:
  - `PATCH /api/cards/:id`
- Add a comment to a card:
  - `POST /api/cards/:id/comments`
- Place a card on a board:
  - `POST /api/boards/:id/cards`
- Move a card on a board:
  - `PATCH /api/boards/:id/cards/:cardId`
- Remove a card from a board:
  - `DELETE /api/boards/:id/cards/:cardId`
- Manage saved execution plans:
  - `GET /api/boards/:id/execution-plans`
  - `POST /api/boards/:id/execution-plans`
  - `GET /api/boards/:id/execution-plans/:planId`
  - `PATCH /api/boards/:id/execution-plans/:planId`
  - `DELETE /api/boards/:id/execution-plans/:planId`
- Run a board batch:
  - `POST /api/boards/:id/batch-run`
  - `GET /api/boards/:id/batch-runs/:runId`
  - `GET /api/boards/:id/batch-runs/:runId/items`

## Standard workflow

1. Read the current state first.
   - Fetch the board with `GET /api/boards/:id`.
   - If the task references a card ID, also fetch `GET /api/cards/:id`.
2. Resolve the target column from the live board response.
   - Match by exact column name first.
   - If the skill asks for a state like testing or done, use a case-insensitive
     match against the board's actual column names.
3. Apply the mutation.
4. Verify through the API.
   - Re-fetch the board and confirm the card is present in the expected column.
   - Re-fetch the card if you changed card fields or left a comment.

## Common operations

### Create a new board task

Use this when work should become a new card.

1. Create the card with `POST /api/cards`.
2. Place it on the board with `POST /api/boards/:id/cards`.
3. Verify by re-fetching the board and confirming the card placement.

Example payloads:

```json
POST /api/cards
{
  "collectionId": "<collection-id>",
  "name": "Investigate billing retry failure",
  "description": "Reproduce the issue, identify the cause, and document the fix."
}
```

```json
POST /api/boards/<board-id>/cards
{
  "cardId": "<card-id>",
  "columnId": "<column-id>"
}
```

### Move a card as work progresses

Use `PATCH /api/boards/:id/cards/:cardId` with the destination `columnId`.

```json
{
  "columnId": "<destination-column-id>"
}
```

### Use a board execution plan

Use this when the user asks about a board "plan" or ordered multi-card agent
work. A plan is a saved layer graph for a board; it is not itself a running
batch.

1. Fetch the board and its plans.
   - `GET /api/boards/:id`
   - `GET /api/boards/:id/execution-plans`
2. Create or update the plan with `layers`.
3. Check the returned `status` and `issues`.
4. To run it, call `POST /api/boards/:id/batch-run` with the plan's cards and
   compiled dependencies.
5. Verify through the batch-run and batch-run-items endpoints.

Plan layer payload:

```json
{
  "name": "Release sequence",
  "description": "Build, verify, then release",
  "layers": [
    {
      "cards": [
        { "id": "<card-a-id>" }
      ]
    },
    {
      "cards": [
        {
          "id": "<card-b-id>",
          "dependencyRule": {
            "mode": "previous_layer",
            "blockingMode": "all_success"
          }
        }
      ]
    }
  ]
}
```

Dependency rule modes:

- `none`: the card can run immediately.
- `previous_layer`: depend on every card in the previous non-empty layer.
- `all_previous_layers`: depend on every card in all earlier layers.
- `specific_cards`: depend only on listed `cardIds`; those cards must be in
  earlier layers.

When starting the batch run from a plan, flatten layer card IDs into `cardIds`
and send `cardDependencies` matching the dependency rules. There is no
dedicated "run execution plan" endpoint.

## Completion and handoff policy

- When the work is fully complete and no human validation is needed, move the
  card to a column named `Done` or the closest clear equivalent on that board.
- When the work is finished but should be verified by a person or another
  system, move the card to `Testing`, `Review`, `QA`, or the closest clear
  equivalent on that board.
- When blocked, prefer a `Blocked` column if one exists. Otherwise leave the
  card in its current column and add a comment that explains the blocker.
- After a meaningful transition, add a brief comment with the result:
  - what changed
  - anything the next person should verify
  - blockers or follow-up if relevant

## Column selection heuristics

Use the board's real column names. Good matches are:

- Complete work: `Done`, `Completed`, `Shipped`, `Closed`
- Needs verification: `Testing`, `Review`, `QA`, `Verify`
- Blocked work: `Blocked`, `Waiting`, `On Hold`

If no reasonable match exists:

- Do not invent a column.
- Leave the card where it is.
- Add a comment explaining the completed state or blocker.
- Report the mismatch to the user.

## Verification

After every create, move, or comment:

- Fetch the affected board again and confirm the live state.
- If you added a comment, fetch comments or the card again to confirm it exists.
- Do not treat a successful mutation response alone as enough proof.
