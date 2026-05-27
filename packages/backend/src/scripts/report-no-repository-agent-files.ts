import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { env } from '../config/env.js';

type AgentRow = {
  id: string;
  name: string;
  repositoryRoot: string | null;
};

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

function collectLegacyAgentFilesSummary(agentId: string): LegacySummary {
  const rootPath = path.resolve(env.DATA_DIR, 'agents', agentId);
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
      for (const entry of entries) visit(path.join(fullPath, entry));
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

async function main() {
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  try {
    const agents = await sql<AgentRow[]>`
      select id, name, repository_root as "repositoryRoot"
      from agents
      order by name asc, id asc
    `;
    const noRepositoryAgents = agents.filter(
      (agent) => !(typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim()),
    );
    const entries = noRepositoryAgents.map((agent) => {
      const summary = collectLegacyAgentFilesSummary(agent.id);
      const status = summary.importableFileCount > 0 ? 'legacy_importable' : 'no_legacy_files';
      return {
        agentId: agent.id,
        name: agent.name,
        status,
        legacyRootPath: summary.rootPath,
        fileCount: summary.fileCount,
        directoryCount: summary.directoryCount,
        symlinkCount: summary.symlinkCount,
        importableFileCount: summary.importableFileCount,
        skippedCount: summary.skippedCount,
        totalBytes: summary.totalBytes,
      };
    });
    const totals = entries.reduce(
      (acc, entry) => ({
        agents: acc.agents + 1,
        legacyImportableAgents:
          acc.legacyImportableAgents + (entry.status === 'legacy_importable' ? 1 : 0),
        files: acc.files + entry.fileCount,
        importableFiles: acc.importableFiles + entry.importableFileCount,
        skipped: acc.skipped + entry.skippedCount,
        totalBytes: acc.totalBytes + entry.totalBytes,
      }),
      {
        agents: 0,
        legacyImportableAgents: 0,
        files: 0,
        importableFiles: 0,
        skipped: 0,
        totalBytes: 0,
      },
    );

    console.log(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          source: 'backend_legacy_agent_files',
          executableSourceOfTruth: 'runner_owned_no_repository_workspace',
          totals,
          agents: entries,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
