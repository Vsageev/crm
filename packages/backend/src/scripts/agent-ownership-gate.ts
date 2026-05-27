import postgres from 'postgres';
import { env } from '../config/env.js';
import { normalizeRepositoryRootOrigin } from '../services/agent-workspaces.js';
import { loadManualRepairEvidenceByAgent } from './agent-ownership-evidence.js';

type AgentOwnershipRow = {
  id: string;
  name: string;
  status: string;
  archivedAt: string | null;
  repositoryRoot: string | null;
  repositoryRootOrigin: string | null;
  repositoryRootRunnerId: string | null;
  repositoryRootVerifiedAt: string | null;
  repositoryRootRepairRequired: boolean | null;
  runnerInventoryRunnerId: string | null;
  runnerInventoryWorkspaceId: string | null;
  runnerInventoryWorkspaceRootOrigin: string | null;
  runnerInventoryVerifiedAt: string | null;
  legacyAgentFileState: string | null;
  legacyAgentFileRepairState: string | null;
  workspacePath: string | null;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return asString(value);
}

function isActive(agent: AgentOwnershipRow): boolean {
  return agent.status === 'active' && !normalizeDate(agent.archivedAt);
}

function hasRepositoryRoot(agent: AgentOwnershipRow): boolean {
  return Boolean(asString(agent.repositoryRoot));
}

function isRepositoryRootRunnerVerified(agent: AgentOwnershipRow): boolean {
  return (
    hasRepositoryRoot(agent) &&
    normalizeRepositoryRootOrigin(agent.repositoryRootOrigin) === 'runner_local' &&
    Boolean(asString(agent.repositoryRootRunnerId)) &&
    Boolean(normalizeDate(agent.repositoryRootVerifiedAt)) &&
    agent.repositoryRootRepairRequired !== true
  );
}

function needsRepositoryRootRepair(agent: AgentOwnershipRow): boolean {
  if (!hasRepositoryRoot(agent)) return false;
  return !isRepositoryRootRunnerVerified(agent);
}

function noRepositoryRunnerInventoryVerified(agent: AgentOwnershipRow): boolean {
  return (
    !hasRepositoryRoot(agent) &&
    Boolean(asString(agent.runnerInventoryRunnerId)) &&
    Boolean(asString(agent.runnerInventoryWorkspaceId)) &&
    Boolean(normalizeDate(agent.runnerInventoryVerifiedAt)) &&
    ['runner_validated', 'runner_imported', 'not_required'].includes(
      String(agent.legacyAgentFileRepairState ?? ''),
    )
  );
}

function needsRunnerValidation(agent: AgentOwnershipRow): boolean {
  if (hasRepositoryRoot(agent)) return needsRepositoryRootRepair(agent);
  if (noRepositoryRunnerInventoryVerified(agent)) return false;
  return true;
}

function hasRepairRequiredStatus(agent: AgentOwnershipRow): boolean {
  if (hasRepositoryRoot(agent)) {
    return agent.repositoryRootRepairRequired === true;
  }
  return ['needs_runner_validation', 'needs_runner_import'].includes(
    String(agent.legacyAgentFileRepairState ?? ''),
  );
}

function retainsLegacyOrUnknownExecutableOwnership(agent: AgentOwnershipRow): boolean {
  if (hasRepositoryRoot(agent)) {
    const origin = normalizeRepositoryRootOrigin(agent.repositoryRootOrigin);
    return origin === 'backend_local_legacy' || origin === 'unknown';
  }
  if (noRepositoryRunnerInventoryVerified(agent)) return false;
  return ['backend_local_legacy', 'unknown', null].includes(
    agent.runnerInventoryWorkspaceRootOrigin,
  );
}

function summarizeAgent(agent: AgentOwnershipRow) {
  return {
    agentId: agent.id,
    name: agent.name,
    status: agent.status,
    repositoryRoot: asString(agent.repositoryRoot),
    repositoryRootOrigin: normalizeRepositoryRootOrigin(agent.repositoryRootOrigin),
    repositoryRootRunnerId: asString(agent.repositoryRootRunnerId),
    repositoryRootVerifiedAt: normalizeDate(agent.repositoryRootVerifiedAt),
    repositoryRootRepairRequired: agent.repositoryRootRepairRequired === true,
    runnerInventoryRunnerId: asString(agent.runnerInventoryRunnerId),
    runnerInventoryWorkspaceId: asString(agent.runnerInventoryWorkspaceId),
    runnerInventoryWorkspaceRootOrigin: agent.runnerInventoryWorkspaceRootOrigin,
    runnerInventoryVerifiedAt: normalizeDate(agent.runnerInventoryVerifiedAt),
    legacyAgentFileState: agent.legacyAgentFileState,
    legacyAgentFileRepairState: agent.legacyAgentFileRepairState,
    workspacePath: asString(agent.workspacePath),
  };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const agents = await sql<AgentOwnershipRow[]>`
      select
        id,
        name,
        status,
        archived_at as "archivedAt",
        repository_root as "repositoryRoot",
        repository_root_origin as "repositoryRootOrigin",
        repository_root_runner_id as "repositoryRootRunnerId",
        repository_root_verified_at as "repositoryRootVerifiedAt",
        repository_root_repair_required as "repositoryRootRepairRequired",
        runner_inventory_runner_id as "runnerInventoryRunnerId",
        runner_inventory_workspace_id as "runnerInventoryWorkspaceId",
        runner_inventory_workspace_root_origin as "runnerInventoryWorkspaceRootOrigin",
        runner_inventory_verified_at as "runnerInventoryVerifiedAt",
        legacy_agent_file_state as "legacyAgentFileState",
        legacy_agent_file_repair_state as "legacyAgentFileRepairState",
        workspace_path as "workspacePath"
      from agents
      order by name asc, id asc
    `;

    const activeAgents = agents.filter(isActive);
    const evidenceByAgent = await loadManualRepairEvidenceByAgent(
      sql,
      activeAgents.map((agent) => ({ agentId: agent.id, name: agent.name })),
    );

    const repositoryRootRepairRows = activeAgents
      .filter(needsRepositoryRootRepair)
      .map((agent) => ({
        ...summarizeAgent(agent),
        manualRepairEvidence: evidenceByAgent.get(agent.id) ?? [],
      }));
    const runnerValidationRows = activeAgents
      .filter(needsRunnerValidation)
      .map((agent) => ({
        ...summarizeAgent(agent),
        manualRepairEvidence: evidenceByAgent.get(agent.id) ?? [],
      }));
    const repairRequiredStatusViolations = activeAgents
      .filter(retainsLegacyOrUnknownExecutableOwnership)
      .filter((agent) => !hasRepairRequiredStatus(agent))
      .map(summarizeAgent);
    const legacyImportStatusViolations = activeAgents
      .filter(
        (agent) =>
          agent.legacyAgentFileState === 'legacy_importable' &&
          !['needs_runner_import', 'runner_imported'].includes(
            String(agent.legacyAgentFileRepairState ?? ''),
          ),
      )
      .map(summarizeAgent);
    const workspacePathLiveColumnViolations = activeAgents
      .filter((agent) => Boolean(asString(agent.workspacePath)))
      .map(summarizeAgent);

    const unaccountedRepositoryRows = repositoryRootRepairRows.filter(
      (agent) => agent.manualRepairEvidence.length === 0,
    );
    const unaccountedRunnerValidationRows = runnerValidationRows.filter(
      (agent) => agent.manualRepairEvidence.length === 0,
    );
    const failures =
      unaccountedRepositoryRows.length +
      unaccountedRunnerValidationRows.length +
      repairRequiredStatusViolations.length +
      legacyImportStatusViolations.length +
      workspacePathLiveColumnViolations.length;

    const report = {
      checkedAt,
      status: failures === 0 ? 'PASS' : 'FAIL',
      evidenceRequirement:
        'Unrepaired active-agent rows must have a card or comment that mentions the agent id and an explicit blocked/manual-repair marker.',
      repositoryRootRepair: {
        activeAgentsNeedingRepair: repositoryRootRepairRows.length,
        unaccountedActiveAgentsNeedingRepair: unaccountedRepositoryRows.length,
        agents: repositoryRootRepairRows,
      },
      runnerValidation: {
        activeAgentsNeedingValidation: runnerValidationRows.length,
        unaccountedActiveAgentsNeedingValidation: unaccountedRunnerValidationRows.length,
        agents: runnerValidationRows,
      },
      repairRequiredStatusViolations,
      legacyImportStatusViolations,
      workspacePathLiveColumnViolations,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failures > 0) {
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
