import postgres from 'postgres';
import { env } from '../config/env.js';
import { normalizeRepositoryRootOrigin } from '../services/agent-workspaces.js';
import { loadManualRepairEvidenceByAgent } from './agent-ownership-evidence.js';

type AgentRepairRow = {
  id: string;
  name: string;
  status: string;
  repositoryRoot: string | null;
  repositoryRootOrigin: string | null;
  repositoryRootRunnerId: string | null;
  repositoryRootVerifiedAt: string | null;
  repositoryRootRepairRequired: boolean | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return asString(value);
}

function needsRepositoryRootRepair(agent: AgentRepairRow): boolean {
  const repositoryRoot = asString(agent.repositoryRoot);
  if (!repositoryRoot) return false;
  if (agent.repositoryRootRepairRequired === true) return true;
  if (normalizeRepositoryRootOrigin(agent.repositoryRootOrigin) !== 'runner_local') return true;
  if (!asString(agent.repositoryRootRunnerId)) return true;
  if (!normalizeDate(agent.repositoryRootVerifiedAt)) return true;
  return false;
}

async function main() {
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const agents = await sql<AgentRepairRow[]>`
      select
        id,
        name,
        status,
        repository_root as "repositoryRoot",
        repository_root_origin as "repositoryRootOrigin",
        repository_root_runner_id as "repositoryRootRunnerId",
        repository_root_verified_at as "repositoryRootVerifiedAt",
        repository_root_repair_required as "repositoryRootRepairRequired"
      from agents
      order by name asc, id asc
    `;
    const rows = agents
      .filter(needsRepositoryRootRepair)
      .map((agent) => ({
        id: String(agent.id),
        name: asString(agent.name) ?? String(agent.id),
        status: asString(agent.status) ?? 'unknown',
        repositoryRoot: asString(agent.repositoryRoot) ?? '',
        repositoryRootOrigin: normalizeRepositoryRootOrigin(agent.repositoryRootOrigin),
        repositoryRootRunnerId: asString(agent.repositoryRootRunnerId),
        repositoryRootVerifiedAt: normalizeDate(agent.repositoryRootVerifiedAt),
        repositoryRootRepairRequired: agent.repositoryRootRepairRequired === true,
      }));
    const evidenceByAgent = await loadManualRepairEvidenceByAgent(
      sql,
      rows.map((agent) => ({ agentId: agent.id, name: agent.name })),
    );
    const rowsWithEvidence = rows.map((agent) => {
      const manualRepairEvidence = evidenceByAgent.get(agent.id) ?? [];
      const unaccountedActiveRepair =
        agent.status === 'active' && manualRepairEvidence.length === 0;
      return {
        ...agent,
        manualRepairEvidence,
        unaccountedActiveRepair,
      };
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          agentsNeedingRepositoryRootRepair: rowsWithEvidence.length,
          activeAgentsNeedingRepositoryRootRepair: rowsWithEvidence.filter(
            (agent) => agent.status === 'active',
          ).length,
          unaccountedActiveAgentsNeedingRepositoryRootRepair: rowsWithEvidence.filter(
            (agent) => agent.unaccountedActiveRepair,
          ).length,
          agents: rowsWithEvidence,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
