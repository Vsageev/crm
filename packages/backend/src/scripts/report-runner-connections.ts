import postgres from 'postgres';
import { env } from '../config/env.js';

type RunnerConnectionRow = {
  id: string;
  connection_scope: string | null;
  owner_account_id: string | null;
  bound_workspace_id: string | null;
  legacy_connection_scope: boolean | null;
  user_id: string;
  workspace_id: string;
};

async function main() {
  const sql = postgres(env.DATABASE_URL);
  try {
    const rows = await sql<RunnerConnectionRow[]>`
      SELECT
        id,
        connection_scope,
        owner_account_id,
        bound_workspace_id,
        legacy_connection_scope,
        user_id,
        workspace_id
      FROM agent_runners
      WHERE revoked_at IS NULL
    `;
    const workspaceIds = new Set(
      (
        await sql<{ id: string }[]>`SELECT id FROM workspaces`
      ).map((row) => row.id),
    );

    const byScope = { account: 0, project: 0, unknown: 0 };
    let legacy = 0;
    let missingBoundWorkspace = 0;
    let orphanedWorkspace = 0;
    let invalidBinding = 0;

    for (const row of rows) {
      const scope = row.connection_scope ?? 'account';
      if (scope === 'account') byScope.account += 1;
      else if (scope === 'project') byScope.project += 1;
      else byScope.unknown += 1;

      if (row.legacy_connection_scope !== false) legacy += 1;

      const boundWorkspaceId = row.bound_workspace_id ?? row.workspace_id;
      if (!boundWorkspaceId) missingBoundWorkspace += 1;
      else if (!workspaceIds.has(boundWorkspaceId)) orphanedWorkspace += 1;

      const ownerAccountId = row.owner_account_id ?? row.user_id;
      if (
        !ownerAccountId ||
        (row.owner_account_id && row.user_id && row.owner_account_id !== row.user_id) ||
        (row.bound_workspace_id && row.workspace_id && row.bound_workspace_id !== row.workspace_id)
      ) {
        invalidBinding += 1;
      }
    }

    const report = {
      checkedAt: new Date().toISOString(),
      total: rows.length,
      byScope,
      legacy,
      missingBoundWorkspace,
      orphanedWorkspace,
      invalidBinding,
    };

    console.log(JSON.stringify(report, null, 2));
    if (byScope.unknown > 0 || missingBoundWorkspace > 0 || invalidBinding > 0) {
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
