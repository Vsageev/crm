import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../db/index.js';
import { env } from '../config/env.js';
import { createApiKey, deleteApiKey } from './api-keys.js';

const AGENTS_DIR = path.resolve(env.DATA_DIR, 'agents');

// ---------------------------------------------------------------------------
// Preset definitions (loaded from packages/backend/src/presets/)
// ---------------------------------------------------------------------------

interface PresetTextFileDef {
  type: 'file';
  name: string;
  template: string;
}

interface PresetSymlinkFileDef {
  type: 'symlink';
  name: string;
  target: string;
}

type PresetFileDef = PresetTextFileDef | PresetSymlinkFileDef;

interface PresetDef {
  id: string;
  name: string;
  description: string;
  files: PresetFileDef[];
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.resolve(__dirname, '../presets');

function loadPresets(): Record<string, PresetDef> {
  const presets: Record<string, PresetDef> = {};
  if (!fs.existsSync(PRESETS_DIR)) return presets;

  for (const entry of fs.readdirSync(PRESETS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const presetDir = path.join(PRESETS_DIR, entry.name);
    const manifestPath = path.join(presetDir, 'preset.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const files: PresetFileDef[] = manifest.files.map(
      (f: { type: string; name: string; template?: string; target?: string }) => {
        if (f.type === 'symlink') {
          return { type: 'symlink', name: f.name, target: f.target! } as PresetSymlinkFileDef;
        }
        const templateContent = fs.readFileSync(path.join(presetDir, f.template!), 'utf-8');
        return { type: 'file', name: f.name, template: templateContent } as PresetTextFileDef;
      },
    );

    presets[manifest.id] = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      files,
    };
  }

  return presets;
}

const AGENT_PRESETS = loadPresets();

// ---------------------------------------------------------------------------
// CLI availability check
// ---------------------------------------------------------------------------

interface CliInfo {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  downloadUrl: string;
}

const CLI_DEFS: { id: string; name: string; command: string; downloadUrl: string }[] = [
  { id: 'claude', name: 'Claude', command: 'claude', downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code' },
  { id: 'codex', name: 'Codex', command: 'codex', downloadUrl: 'https://developers.openai.com/codex/quickstart/' },
  { id: 'qwen', name: 'Qwen', command: 'qwen', downloadUrl: 'https://qwenlm.github.io/qwen-code-docs/' },
];

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkCliStatus(): CliInfo[] {
  return CLI_DEFS.map((def) => ({
    ...def,
    installed: isCommandAvailable(def.command),
  }));
}

export function listPresets() {
  return Object.values(AGENT_PRESETS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
}

// ---------------------------------------------------------------------------
// Agent record interface
// ---------------------------------------------------------------------------

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  preset: string;
  status: 'active' | 'inactive' | 'error';
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  capabilities: string[];
  skipPermissions: boolean;
  workspaceApiKey: string | null;
  workspaceApiKeyId: string | null;
  lastActivity: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureAgentsDir() {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

function agentDir(agentId: string): string {
  return path.join(AGENTS_DIR, agentId);
}

function asAgent(rec: Record<string, unknown>): AgentRecord {
  return {
    ...rec,
    skipPermissions: Boolean(rec.skipPermissions),
  } as unknown as AgentRecord;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateAgentParams {
  name: string;
  description: string;
  model: string;
  preset: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  capabilities: string[];
  skipPermissions?: boolean;
  avatarIcon?: string;
  avatarBgColor?: string;
  avatarLogoColor?: string;
}

const WORKSPACE_API_PERMISSIONS = [
  'cards:write',
  'messages:write',
  'storage:write',
  'folders:write',
  'boards:write',
  'tags:write',
  'settings:read',
  'conversations:write',
];

export async function createAgent(params: CreateAgentParams): Promise<AgentRecord> {
  const preset = AGENT_PRESETS[params.preset];
  if (!preset) throw new Error(`Unknown preset: ${params.preset}`);

  // Create a dedicated workspace API key for this agent
  const owner = store.findOne('users', (r: Record<string, unknown>) => r.isActive === true);
  const ownerId = owner ? (owner.id as string) : 'system';

  const wsKey = await createApiKey({
    name: `Agent: ${params.name}`,
    permissions: WORKSPACE_API_PERMISSIONS,
    createdById: ownerId,
    description: `Auto-created workspace API key for agent "${params.name}"`,
  });

  const record = store.insert('agents', {
    name: params.name,
    description: params.description,
    model: params.model,
    preset: params.preset,
    status: 'active',
    apiKeyId: params.apiKeyId,
    apiKeyName: params.apiKeyName,
    apiKeyPrefix: params.apiKeyPrefix,
    capabilities: params.capabilities,
    skipPermissions: params.skipPermissions ?? false,
    workspaceApiKey: wsKey.rawKey,
    workspaceApiKeyId: (wsKey as Record<string, unknown>).id as string,
    lastActivity: null,
    avatarIcon: params.avatarIcon ?? 'spark',
    avatarBgColor: params.avatarBgColor ?? '#1a1a2e',
    avatarLogoColor: params.avatarLogoColor ?? '#e94560',
  });

  // Scaffold workspace folder
  ensureAgentsDir();
  const dir = agentDir(record.id as string);
  fs.mkdirSync(dir, { recursive: true });

  for (const fileDef of preset.files) {
    const filePath = path.join(dir, fileDef.name);
    if (fileDef.type === 'file') {
      const content = renderTemplate(fileDef.template, {
        agentName: params.name,
        description: params.description || 'Agent workspace.',
      });
      fs.writeFileSync(filePath, content, 'utf-8');
      continue;
    }

    fs.symlinkSync(fileDef.target, filePath);
  }

  return asAgent(record);
}

export function listAgents(): AgentRecord[] {
  return store.getAll('agents').map(asAgent);
}

export function getAgent(id: string): AgentRecord | null {
  const rec = store.getById('agents', id);
  return rec ? asAgent(rec) : null;
}

export function updateAgent(
  id: string,
  data: Partial<Pick<AgentRecord, 'name' | 'description' | 'model' | 'status' | 'skipPermissions'>>,
): AgentRecord | null {
  const updated = store.update('agents', id, data as Record<string, unknown>);
  return updated ? asAgent(updated) : null;
}

export async function deleteAgent(id: string): Promise<boolean> {
  const agent = store.getById('agents', id);
  if (!agent) return false;

  // Delete the auto-created workspace API key
  if (agent.workspaceApiKeyId) {
    await deleteApiKey(agent.workspaceApiKeyId as string).catch(() => {});
  }

  // Close related conversations and preserve agent name in metadata
  const agentConversations = store.find('conversations', (r: Record<string, unknown>) => {
    if (r.channelType !== 'agent') return false;
    try {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      return meta?.agentId === id;
    } catch {
      return false;
    }
  });

  for (const conv of agentConversations) {
    let meta: Record<string, unknown> = {};
    try {
      meta = typeof conv.metadata === 'string' ? JSON.parse(conv.metadata) : (conv.metadata as Record<string, unknown>) ?? {};
    } catch { /* ignore */ }

    meta.agentDeleted = true;
    meta.agentName = agent.name;

    store.update('conversations', conv.id as string, {
      status: 'closed',
      closedAt: new Date().toISOString(),
      metadata: JSON.stringify(meta),
    });
  }

  store.delete('agents', id);

  // Remove workspace folder
  const dir = agentDir(id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Workspace file operations (scoped to data/agents/{agentId}/)
// ---------------------------------------------------------------------------

export interface AgentFileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  createdAt: string;
}

function normalizePath(p: string): string {
  let normalized = p.trim().replace(/\\/g, '/');
  if (!normalized) normalized = '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function resolveAgentDiskPath(agentId: string, filePath: string): string {
  const dir = agentDir(agentId);
  return path.resolve(dir, '.' + filePath);
}

function validateAgentPath(agentId: string, p: string): string {
  const normalized = normalizePath(p);
  const resolved = resolveAgentDiskPath(agentId, normalized);
  const root = agentDir(agentId);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new Error('Path traversal detected');
  }
  return normalized;
}

export function listAgentFiles(agentId: string, dirPath: string): AgentFileEntry[] {
  const normalized = validateAgentPath(agentId, dirPath);
  const diskDir = resolveAgentDiskPath(agentId, normalized);

  if (!fs.existsSync(diskDir)) return [];
  const stats = fs.statSync(diskDir);
  if (!stats.isDirectory()) throw new Error('Path is not a directory');

  return fs
    .readdirSync(diskDir, { withFileTypes: true })
    .map((entry) => {
      const fullPath = path.join(diskDir, entry.name);
      if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) return null;

      // Resolve symlinks to expose their target kind in the file explorer.
      let st: fs.Stats;
      try {
        st = fs.statSync(fullPath);
      } catch {
        return null;
      }

      const resolvedType = st.isFile() ? 'file' : st.isDirectory() ? 'folder' : null;
      if (!resolvedType) return null;

      const relative = path.relative(agentDir(agentId), fullPath).split(path.sep).join('/');
      const createdAtSource =
        Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtime : st.mtime;
      return {
        name: entry.name,
        path: normalizePath('/' + relative),
        type: resolvedType,
        size: resolvedType === 'file' ? st.size : 0,
        createdAt: createdAtSource.toISOString(),
      };
    })
    .filter((e): e is AgentFileEntry => e !== null);
}

export function getAgentFilePath(agentId: string, filePath: string): string | null {
  const normalized = validateAgentPath(agentId, filePath);
  const diskPath = resolveAgentDiskPath(agentId, normalized);
  if (!fs.existsSync(diskPath)) return null;
  const stats = fs.statSync(diskPath);
  if (!stats.isFile()) return null;
  return diskPath;
}

export function readAgentFileContent(agentId: string, filePath: string): string | null {
  const diskPath = getAgentFilePath(agentId, filePath);
  if (!diskPath) return null;
  return fs.readFileSync(diskPath, 'utf-8');
}

export async function uploadAgentFile(
  agentId: string,
  dirPath: string,
  fileName: string,
  _mimeType: string,
  buffer: Buffer,
): Promise<AgentFileEntry> {
  const parentPath = validateAgentPath(agentId, dirPath);
  const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!safeName) throw new Error('Invalid file name');

  const fullPath = parentPath === '/' ? '/' + safeName : parentPath + '/' + safeName;
  validateAgentPath(agentId, fullPath);

  const diskPath = resolveAgentDiskPath(agentId, fullPath);
  const diskDir = path.dirname(diskPath);
  if (!fs.existsSync(diskDir)) {
    fs.mkdirSync(diskDir, { recursive: true });
  }

  fs.writeFileSync(diskPath, buffer);

  const st = fs.statSync(diskPath);
  const createdAtSource =
    Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtime : st.mtime;

  return {
    name: safeName,
    path: fullPath,
    type: 'file',
    size: buffer.length,
    createdAt: createdAtSource.toISOString(),
  };
}

export function createAgentFolder(agentId: string, dirPath: string, name: string): AgentFileEntry {
  const parentPath = validateAgentPath(agentId, dirPath);
  const safeName = name.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!safeName) throw new Error('Invalid folder name');

  const fullPath = parentPath === '/' ? '/' + safeName : parentPath + '/' + safeName;
  validateAgentPath(agentId, fullPath);

  const diskPath = resolveAgentDiskPath(agentId, fullPath);
  if (fs.existsSync(diskPath)) {
    throw new Error('A file or folder with this name already exists');
  }
  fs.mkdirSync(diskPath, { recursive: true });

  const st = fs.statSync(diskPath);
  const createdAtSource =
    Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtime : st.mtime;

  return {
    name: safeName,
    path: fullPath,
    type: 'folder',
    size: 0,
    createdAt: createdAtSource.toISOString(),
  };
}

export function deleteAgentFile(agentId: string, filePath: string): boolean {
  const normalized = validateAgentPath(agentId, filePath);
  if (normalized === '/') return false;

  const diskPath = resolveAgentDiskPath(agentId, normalized);
  if (!fs.existsSync(diskPath)) return false;
  fs.rmSync(diskPath, { recursive: true, force: true });
  return true;
}
