import fs from 'node:fs';
import path from 'node:path';
import type { RunnerAgentWorkspaceImportFile } from 'shared';
import { getLegacyAgentWorkspacePath } from './agent-workspaces.js';

export interface LegacyAgentFilesSummary {
  exists: boolean;
  rootPath: string;
  fileCount: number;
  directoryCount: number;
  symlinkCount: number;
  importableFileCount: number;
  skippedCount: number;
  totalBytes: number;
}

export interface LegacyAgentFilesImportPayload {
  files: RunnerAgentWorkspaceImportFile[];
  summary: LegacyAgentFilesSummary;
}

const LEGACY_AGENT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const LEGACY_AGENT_IMPORT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function normalizePath(p: string): string {
  let normalized = p.trim().replace(/\\/g, '/');
  if (!normalized) normalized = '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function emptyLegacyAgentFilesSummary(agentId: string): LegacyAgentFilesSummary {
  const rootPath = getLegacyAgentWorkspacePath(agentId);
  return {
    exists: fs.existsSync(rootPath),
    rootPath,
    fileCount: 0,
    directoryCount: 0,
    symlinkCount: 0,
    importableFileCount: 0,
    skippedCount: 0,
    totalBytes: 0,
  };
}

export function collectLegacyAgentFilesForImport(agentId: string): LegacyAgentFilesImportPayload {
  const root = getLegacyAgentWorkspacePath(agentId);
  const summary = emptyLegacyAgentFilesSummary(agentId);
  const files: RunnerAgentWorkspaceImportFile[] = [];
  if (!fs.existsSync(root)) return { files, summary };

  const visitedRealPaths = new Set<string>();

  function visit(fullPath: string, relativePath: string): void {
    let lstats: fs.Stats;
    try {
      lstats = fs.lstatSync(fullPath);
    } catch {
      summary.skippedCount++;
      return;
    }
    if (lstats.isSymbolicLink()) {
      summary.symlinkCount++;
    }

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
        visit(path.join(fullPath, entry), `${relativePath}/${entry}`.replace(/\/+/g, '/'));
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

    try {
      files.push({
        path: normalizePath(relativePath),
        contentBase64: fs.readFileSync(fullPath).toString('base64'),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      });
      summary.importableFileCount++;
    } catch {
      summary.skippedCount++;
    }
  }

  visit(root, '/');
  return { files, summary };
}
