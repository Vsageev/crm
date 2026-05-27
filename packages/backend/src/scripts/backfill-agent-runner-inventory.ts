import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { loadManualRepairEvidenceByAgent } from './agent-ownership-evidence.js';

type AgentInventoryRow = {
  id: string;
  name: string;
  status: string;
  repositoryRoot: string | null;
  repositoryRootOrigin: string | null;
  repositoryRootRunnerId: string | null;
  repositoryRootVerifiedAt: string | null;
  repositoryRootRepairRequired: boolean | null;
  runnerInventoryRunnerId: string | null;
  runnerInventoryWorkspaceId: string | null;
  runnerInventoryVersion: number | null;
  runnerInventoryCapabilityRefs: Record<string, unknown> | null;
  runnerInventoryWorkspaceRootOrigin: string | null;
  runnerInventoryWorkspaceRootVerifiedAt: string | null;
  runnerInventoryVerifiedAt: string | null;
  legacyAgentFileState: string | null;
  legacyAgentFileRepairState: string | null;
  legacyAgentFileCheckedAt: string | null;
  workspacePath: string | null;
  legacyData: Record<string, unknown>;
};

type Patch = Partial<Record<keyof AgentInventoryRow, unknown>>;

type LegacySummary = {
  rootPath: string;
  fileCount: number;
  directoryCount: number;
  symlinkCount: number;
  importableFileCount: number;
  skippedCount: number;
  totalBytes: number;
};

const LEGACY_AGENT_IMPORT_MAX_FILE_BYTES = 256 * 1024;
const LEGACY_AGENT_IMPORT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const FIELD_TO_COLUMN: Partial<Record<keyof AgentInventoryRow, string>> = {
  runnerInventoryVersion: 'runner_inventory_version',
  runnerInventoryWorkspaceRootOrigin: 'runner_inventory_workspace_root_origin',
  legacyAgentFileState: 'legacy_agent_file_state',
  legacyAgentFileRepairState: 'legacy_agent_file_repair_state',
  legacyAgentFileCheckedAt: 'legacy_agent_file_checked_at',
  workspacePath: 'workspace_path',
  legacyData: 'legacy_data',
};

function hasRepositoryRoot(agent: AgentInventoryRow): boolean {
  return typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim().length > 0;
}

function needsRepositoryRootRepair(agent: AgentInventoryRow): boolean {
  if (!hasRepositoryRoot(agent)) return false;
  if (agent.repositoryRootRepairRequired === true) return true;
  if (agent.repositoryRootOrigin !== 'runner_local') return true;
  if (!agent.repositoryRootRunnerId) return true;
  if (!agent.repositoryRootVerifiedAt) return true;
  return false;
}

function legacyAgentRoot(agentId: string): string {
  return path.resolve(env.DATA_DIR, 'agents', agentId);
}

function collectLegacyAgentFilesSummary(agentId: string): LegacySummary {
  const rootPath = legacyAgentRoot(agentId);
  const summary: LegacySummary = {
    rootPath,
    fileCount: 0,
    directoryCount: 0,
    symlinkCount: 0,
    importableFileCount: 0,
    skippedCount: 0,
    totalBytes: 0,
  };
  if (!fs.existsSync(rootPath)) return summary;

  const visitedRealPaths = new Set<string>();

  function visit(fullPath: string): void {
    let lstats: fs.Stats;
    try {
      lstats = fs.lstatSync(fullPath);
    } catch {
      summary.skippedCount++;
      return;
    }
    if (lstats.isSymbolicLink()) summary.symlinkCount++;

    let stats: fs.Stats;
    try {
      stats = fs.statSync(fullPath);
    } catch {
      summary.skippedCount++;
      return;
    }

    if (stats.isDirectory()) {
      summary.directoryCount++;
      let realPath: string;
      try {
        realPath = fs.realpathSync(fullPath);
      } catch {
        summary.skippedCount++;
        return;
      }
      if (visitedRealPaths.has(realPath)) {
        summary.skippedCount++;
        return;
      }
      visitedRealPaths.add(realPath);
      let entries: string[];
      try {
        entries = fs.readdirSync(fullPath);
      } catch {
        summary.skippedCount++;
        return;
      }
      for (const entry of entries) {
        visit(path.join(fullPath, entry));
      }
      return;
    }

    if (!stats.isFile()) {
      summary.skippedCount++;
      return;
    }
    summary.fileCount++;
    summary.totalBytes += stats.size;
    if (
      stats.size > LEGACY_AGENT_IMPORT_MAX_FILE_BYTES ||
      summary.totalBytes > LEGACY_AGENT_IMPORT_MAX_TOTAL_BYTES
    ) {
      summary.skippedCount++;
      return;
    }
    summary.importableFileCount++;
  }

  visit(rootPath);
  return summary;
}

function setIfDifferent(
  patch: Patch,
  agent: AgentInventoryRow,
  key: keyof AgentInventoryRow,
  value: unknown,
) {
  if (agent[key] !== value) {
    patch[key] = value;
  }
}

function desiredPatch(agent: AgentInventoryRow, checkedAt: string): Patch {
  const patch: Patch = {};
  const repositoryBacked = hasRepositoryRoot(agent);
  setIfDifferent(patch, agent, 'runnerInventoryVersion', agent.runnerInventoryVersion ?? 1);
  if (typeof agent.workspacePath === 'string' && agent.workspacePath.trim()) {
    const legacyData = { ...agent.legacyData };
    if (!legacyData.workspacePathLegacy) {
      legacyData.workspacePathLegacy = {
        path: agent.workspacePath.trim(),
        source: 'agents.workspace_path',
        classification: 'metadata_only',
        executableAuthority: false,
        classifiedAt: checkedAt,
      };
      patch.legacyData = legacyData;
    }
    patch.workspacePath = null;
  }

  if (repositoryBacked) {
    setIfDifferent(
      patch,
      agent,
      'runnerInventoryWorkspaceRootOrigin',
      agent.runnerInventoryWorkspaceRootOrigin ?? 'repository_root',
    );
    setIfDifferent(
      patch,
      agent,
      'legacyAgentFileState',
      agent.legacyAgentFileState ?? 'not_applicable',
    );
    setIfDifferent(
      patch,
      agent,
      'legacyAgentFileRepairState',
      agent.legacyAgentFileRepairState ??
        (needsRepositoryRootRepair(agent) ? 'needs_runner_validation' : 'not_required'),
    );
    return patch;
  }

  const summary = collectLegacyAgentFilesSummary(agent.id);
  const legacyState = summary.importableFileCount > 0 ? 'legacy_importable' : 'no_legacy_files';
  const legacyRepairState =
    agent.legacyAgentFileRepairState === 'runner_imported' ||
    agent.legacyAgentFileRepairState === 'runner_validated'
      ? agent.legacyAgentFileRepairState
      : summary.importableFileCount > 0
        ? 'needs_runner_import'
        : 'needs_runner_validation';

  setIfDifferent(
    patch,
    agent,
    'runnerInventoryWorkspaceRootOrigin',
    agent.runnerInventoryWorkspaceRootOrigin ?? 'unknown',
  );
  setIfDifferent(patch, agent, 'legacyAgentFileState', legacyState);
  setIfDifferent(patch, agent, 'legacyAgentFileRepairState', legacyRepairState);
  if (!agent.legacyAgentFileCheckedAt) {
    patch.legacyAgentFileCheckedAt = checkedAt;
  }
  return patch;
}

function summarizeAgent(agent: AgentInventoryRow) {
  const repositoryBacked = hasRepositoryRoot(agent);
  const summary = repositoryBacked ? null : collectLegacyAgentFilesSummary(agent.id);
  const needsRunnerValidation = repositoryBacked
    ? needsRepositoryRootRepair(agent)
    : !agent.runnerInventoryRunnerId ||
      !agent.runnerInventoryWorkspaceId ||
      !agent.runnerInventoryVerifiedAt ||
      agent.legacyAgentFileRepairState === 'needs_runner_validation' ||
      agent.legacyAgentFileRepairState === 'needs_runner_import' ||
      agent.legacyAgentFileRepairState === null;
  const needsRunnerImport =
    !repositoryBacked &&
    Boolean(summary && summary.importableFileCount > 0) &&
    agent.legacyAgentFileRepairState !== 'runner_imported';

  return {
    agentId: agent.id,
    name: agent.name,
    status: agent.status,
    repositoryBacked,
    runnerBinding: {
      runnerId: agent.runnerInventoryRunnerId,
      workspaceId: agent.runnerInventoryWorkspaceId,
    },
    runnerInventoryVersion: agent.runnerInventoryVersion,
    runnerInventoryWorkspaceRootOrigin: agent.runnerInventoryWorkspaceRootOrigin,
    runnerInventoryWorkspaceRootVerifiedAt: agent.runnerInventoryWorkspaceRootVerifiedAt,
    runnerInventoryVerifiedAt: agent.runnerInventoryVerifiedAt,
    capabilityRefs: agent.runnerInventoryCapabilityRefs,
    legacyAgentFileState: agent.legacyAgentFileState,
    legacyAgentFileRepairState: agent.legacyAgentFileRepairState,
    workspacePathAuthority: !agent.workspacePath
      ? 'cleared'
      : 'pending_metadata_cutover',
    legacyWorkspacePathPreserved: Boolean(agent.legacyData.workspacePathLegacy),
    legacy: summary
      ? {
          rootPath: summary.rootPath,
          fileCount: summary.fileCount,
          importableFileCount: summary.importableFileCount,
          skippedCount: summary.skippedCount,
          totalBytes: summary.totalBytes,
        }
      : null,
    needsRunnerValidation,
    needsRunnerImport,
  };
}

async function readAgents(sql: postgres.Sql): Promise<AgentInventoryRow[]> {
  const rows = await sql<AgentInventoryRow[]>`
    select
      id,
      name,
      status,
      repository_root as "repositoryRoot",
      repository_root_origin as "repositoryRootOrigin",
      repository_root_runner_id as "repositoryRootRunnerId",
      repository_root_verified_at as "repositoryRootVerifiedAt",
      repository_root_repair_required as "repositoryRootRepairRequired",
      runner_inventory_runner_id as "runnerInventoryRunnerId",
      runner_inventory_workspace_id as "runnerInventoryWorkspaceId",
      runner_inventory_version as "runnerInventoryVersion",
      runner_inventory_capability_refs as "runnerInventoryCapabilityRefs",
      runner_inventory_workspace_root_origin as "runnerInventoryWorkspaceRootOrigin",
      runner_inventory_workspace_root_verified_at as "runnerInventoryWorkspaceRootVerifiedAt",
      runner_inventory_verified_at as "runnerInventoryVerifiedAt",
      legacy_agent_file_state as "legacyAgentFileState",
      legacy_agent_file_repair_state as "legacyAgentFileRepairState",
      legacy_agent_file_checked_at as "legacyAgentFileCheckedAt",
      workspace_path as "workspacePath",
      legacy_data as "legacyData"
    from agents
    order by name asc, id asc
  `;
  return rows.map((row) => ({
    ...row,
    repositoryRootVerifiedAt: normalizeDate(row.repositoryRootVerifiedAt),
    runnerInventoryWorkspaceRootVerifiedAt: normalizeDate(
      row.runnerInventoryWorkspaceRootVerifiedAt,
    ),
    runnerInventoryVerifiedAt: normalizeDate(row.runnerInventoryVerifiedAt),
    legacyAgentFileCheckedAt: normalizeDate(row.legacyAgentFileCheckedAt),
    legacyData:
      row.legacyData && typeof row.legacyData === 'object' && !Array.isArray(row.legacyData)
        ? row.legacyData
        : {},
  }));
}

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

async function applyPatch(sql: postgres.Sql, agentId: string, patch: Patch) {
  const entries = Object.entries(patch).flatMap(([field, value]) => {
    const column = FIELD_TO_COLUMN[field as keyof AgentInventoryRow];
    return column ? [[column, value] as const] : [];
  });
  if (entries.length === 0) return;
  const assignments = entries
    .map(([column], index) =>
      column === 'legacy_data' ? `"${column}" = $${index + 2}::jsonb` : `"${column}" = $${index + 2}`,
    )
    .join(', ');
  await sql.unsafe(`update agents set ${assignments} where id = $1`, [
    agentId,
    ...entries.map(([column, value]) =>
      column === 'legacy_data' ? JSON.stringify(value ?? {}) : value,
    ),
  ] as Array<string | number | null>);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const checkedAt = new Date().toISOString();
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    const agents = await readAgents(sql);
    const updates = agents
      .map((agent) => ({ agentId: agent.id, patch: desiredPatch(agent, checkedAt) }))
      .filter((update) => Object.keys(update.patch).length > 0);

    if (apply) {
      for (const update of updates) {
        await applyPatch(sql, update.agentId, update.patch);
      }
    }

    const reportedAgents = apply ? await readAgents(sql) : agents;
    const summarized = reportedAgents.map(summarizeAgent);
    const evidenceByAgent = await loadManualRepairEvidenceByAgent(
      sql,
      summarized.map((agent) => ({ agentId: agent.agentId, name: agent.name })),
    );
    const entries = summarized.map((agent) => {
      const manualRepairEvidence = evidenceByAgent.get(agent.agentId) ?? [];
      const unaccountedActiveRunnerValidation =
        agent.status === 'active' && agent.needsRunnerValidation && manualRepairEvidence.length === 0;
      return {
        ...agent,
        manualRepairEvidence,
        unaccountedActiveRunnerValidation,
      };
    }).sort((a, b) => {
      if (a.needsRunnerImport !== b.needsRunnerImport) return a.needsRunnerImport ? -1 : 1;
      if (a.needsRunnerValidation !== b.needsRunnerValidation) {
        return a.needsRunnerValidation ? -1 : 1;
      }
      return a.name.localeCompare(b.name) || a.agentId.localeCompare(b.agentId);
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          checkedAt,
          mode: apply ? 'backfill' : 'report',
          executableSourceOfTruth: 'runner_owned_agent_inventory',
          workspacePathAuthority: 'agents.workspace_path is inert legacy metadata only',
          dryRun: !apply,
          updatedAgents: apply ? updates.length : 0,
          pendingUpdates: apply ? 0 : updates.length,
          agentsNeedingRunnerValidation: entries.filter((entry) => entry.needsRunnerValidation)
            .length,
          activeAgentsNeedingRunnerValidation: entries.filter(
            (entry) => entry.status === 'active' && entry.needsRunnerValidation,
          ).length,
          unaccountedActiveAgentsNeedingRunnerValidation: entries.filter(
            (entry) => entry.unaccountedActiveRunnerValidation,
          ).length,
          agentsNeedingRunnerImport: entries.filter((entry) => entry.needsRunnerImport).length,
          activeAgentsNeedingRunnerImport: entries.filter(
            (entry) => entry.status === 'active' && entry.needsRunnerImport,
          ).length,
          agents: entries,
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
