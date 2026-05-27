import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../db/index.js';
import { createApiKey, deleteApiKey, validateApiKey } from './api-keys.js';
import { env } from '../config/env.js';
import { getApiKeyRecord } from '../db/repositories/api-keys-repository.js';
import { deleteRefreshTokensForUserId } from '../db/repositories/refresh-tokens-repository.js';
import {
  listAgentGroupRecordsOrdered,
  listAgentIdsWithGroupId,
  listAgentRecordsByApiKeyId,
  listAgentRecordsOrdered,
  listAllAgentRecordIds,
  maxAgentGroupOrder,
} from '../db/repositories/agents-query-repository.js';
import { listSkillRecords } from '../db/repositories/skills-repository.js';
import { deleteAgentEnvVarsByAgentId } from './agent-env-vars.js';
import { stopAllAgentCronJobs } from './agent-cron.js';
import type { CronJob } from './agent-cron.js';
import { hashPassword } from './auth.js';
import {
  normalizeRepositoryRoot,
  normalizeRepositoryRootOrigin,
} from './agent-workspaces.js';
import type { RunnerAgentWorkspaceImportFile } from 'shared';

// ---------------------------------------------------------------------------
// Preset definitions (loaded from packages/backend/src/presets/)
// ---------------------------------------------------------------------------

interface PresetTextFileDef {
  type: 'file';
  name: string;
  template: string;
  models?: string[];
}

interface PresetSymlinkFileDef {
  type: 'symlink';
  name: string;
  target: string;
  models?: string[];
}

type PresetFileDef = PresetTextFileDef | PresetSymlinkFileDef;

interface PresetParameterDef {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
  type: 'text' | 'directory';
  contentTemplate?: string;
  emptyContentTemplate?: string;
}

interface PresetDef {
  id: string;
  name: string;
  description: string;
  files: PresetFileDef[];
  parameters: PresetParameterDef[];
  defaultSkills: string[];
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
    const parameters: PresetParameterDef[] = Array.isArray(manifest.parameters)
      ? manifest.parameters.map(
          (parameter: {
            key: string;
            label: string;
            description?: string;
            placeholder?: string;
            required?: boolean;
            type?: string;
            contentTemplate?: string;
            emptyContentTemplate?: string;
          }) => {
            if (!/^\w+$/.test(parameter.key)) {
              throw new Error(
                `Invalid preset parameter key "${parameter.key}" in preset "${manifest.id}"`,
              );
            }
            return {
              key: parameter.key,
              label: parameter.label,
              description: parameter.description,
              placeholder: parameter.placeholder,
              required: Boolean(parameter.required),
              type: parameter.type === 'directory' ? 'directory' : 'text',
              contentTemplate:
                typeof parameter.contentTemplate === 'string'
                  ? parameter.contentTemplate
                  : undefined,
              emptyContentTemplate:
                typeof parameter.emptyContentTemplate === 'string'
                  ? parameter.emptyContentTemplate
                  : undefined,
            };
          },
        )
      : [];
    const files: PresetFileDef[] = manifest.files.map(
      (f: {
        type: string;
        name: string;
        template?: string;
        target?: string;
        models?: string[];
      }) => {
        if (f.type === 'symlink') {
          return {
            type: 'symlink',
            name: f.name,
            target: f.target!,
            models: f.models,
          } as PresetSymlinkFileDef;
        }
        const templateContent = fs.readFileSync(path.join(presetDir, f.template!), 'utf-8');
        return {
          type: 'file',
          name: f.name,
          template: templateContent,
          models: f.models,
        } as PresetTextFileDef;
      },
    );

    presets[manifest.id] = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      files,
      parameters,
      defaultSkills: Array.isArray(manifest.defaultSkills) ? manifest.defaultSkills : [],
    };
  }

  return presets;
}

const AGENT_PRESETS = loadPresets();

// ---------------------------------------------------------------------------
// CLI availability check
// ---------------------------------------------------------------------------

export interface CliInfo {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  downloadUrl: string;
  resolvedCommand: string | null;
}

const CLI_DEFS: { id: string; name: string; command: string; downloadUrl: string }[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'claude',
    downloadUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    downloadUrl: 'https://developers.openai.com/codex/quickstart/',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor-agent',
    downloadUrl: 'https://docs.cursor.com/cli/using',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    downloadUrl: 'https://opencode.ai/docs/cli/',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    command: 'qwen',
    downloadUrl: 'https://qwenlm.github.io/qwen-code-docs/',
  },
];

export function listCliDefinitions(): Array<Omit<CliInfo, 'installed' | 'resolvedCommand'>> {
  return CLI_DEFS.map((def) => ({ ...def }));
}

const MODEL_ID_BY_ALIAS = new Map<string, string>(
  CLI_DEFS.flatMap((def) => [
    [def.id, def.id],
    [def.name.toLowerCase(), def.id],
    [def.command.toLowerCase(), def.id],
  ]),
);

const COMMON_CLI_SEARCH_DIRS = [
  path.join(os.homedir(), '.opencode', 'bin'),
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
];

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(
      filePath,
      process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function getWindowsExecutableNames(command: string): string[] {
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  if (pathext.some((ext) => lowerCommand.endsWith(ext.toLowerCase()))) {
    return [command];
  }
  return [command, ...pathext.map((ext) => `${command}${ext}`)];
}

function candidateExecutableNames(command: string): string[] {
  return process.platform === 'win32' ? getWindowsExecutableNames(command) : [command];
}

export function resolveCommandExecutable(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const hasPathSeparator =
    trimmed.includes(path.sep) || (path.posix.sep !== path.sep && trimmed.includes(path.posix.sep));

  if (hasPathSeparator) {
    return isExecutableFile(trimmed) ? trimmed : null;
  }

  const searchDirs = Array.from(
    new Set([...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), ...COMMON_CLI_SEARCH_DIRS]),
  );

  for (const dir of searchDirs) {
    for (const candidateName of candidateExecutableNames(trimmed)) {
      const candidatePath = path.join(dir, candidateName);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function getCliDef(idOrAlias: string) {
  const normalized = normalizeModelValue(idOrAlias);
  return CLI_DEFS.find((def) => def.id === normalized) ?? null;
}

export function getCliInfo(idOrAlias: string) {
  return getCliDef(idOrAlias);
}

export function resolveCliExecutable(idOrAlias: string): string | null {
  const cliDef = getCliDef(idOrAlias);
  if (cliDef) {
    return resolveCommandExecutable(cliDef.command);
  }
  return resolveCommandExecutable(idOrAlias);
}

export function getMissingCliMessage(idOrAlias: string): string | null {
  const cliDef = getCliDef(idOrAlias);
  if (!cliDef) return null;
  if (resolveCommandExecutable(cliDef.command)) return null;
  return `${cliDef.name} CLI is not installed or is not executable on PATH. Install ${cliDef.command} from ${cliDef.downloadUrl}, restart the runner, and try again.`;
}

export function assertCliAvailableForModel(model: string): void {
  const message = getMissingCliMessage(model);
  if (message) {
    throw new Error(message);
  }
}

export function checkCliStatus(): CliInfo[] {
  return CLI_DEFS.map((def) => {
    const resolvedCommand = resolveCommandExecutable(def.command);
    return {
      ...def,
      resolvedCommand,
      installed: Boolean(resolvedCommand),
    };
  });
}

export function listPresets() {
  return Object.values(AGENT_PRESETS).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    parameters: p.parameters.map((parameter) => {
      const { contentTemplate, emptyContentTemplate, ...publicParameter } = parameter;
      void contentTemplate;
      void emptyContentTemplate;
      return publicParameter;
    }),
  }));
}

// ---------------------------------------------------------------------------
// Agent group record
// ---------------------------------------------------------------------------

export interface AgentGroupRecord {
  id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAvatarPresetRecord {
  id: string;
  name: string;
  avatarIcon: string;
  createdAt: string;
  updatedAt: string;
}

function asAgentGroup(rec: Record<string, unknown>): AgentGroupRecord {
  return {
    ...rec,
    order: typeof rec.order === 'number' ? rec.order : 0,
  } as unknown as AgentGroupRecord;
}

export async function listAgentGroups(): Promise<AgentGroupRecord[]> {
  const rows = await listAgentGroupRecordsOrdered();
  return rows.map(asAgentGroup);
}

export async function createAgentGroup(name: string): Promise<AgentGroupRecord> {
  const maxOrder = await maxAgentGroupOrder();
  const record = store.insert('agentGroups', {
    id: randomUUID(),
    name,
    order: maxOrder + 1,
  });
  return asAgentGroup(record);
}

export function updateAgentGroup(
  id: string,
  data: Partial<Pick<AgentGroupRecord, 'name' | 'order'>>,
): AgentGroupRecord | null {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.order !== undefined) patch.order = data.order;
  const updated = store.update('agentGroups', id, patch);
  return updated ? asAgentGroup(updated) : null;
}

export async function deleteAgentGroup(id: string): Promise<boolean> {
  const group = store.getById('agentGroups', id);
  if (!group) return false;

  let replacementGroupId: string | null = null;
  const existingGroupIds = new Set(
    store
      .getAll('agentGroups')
      .map((entry) => (typeof entry.id === 'string' ? entry.id : ''))
      .filter((entryId) => entryId && entryId !== id),
  );

  for (const workspace of store.getAll('workspaces')) {
    if (!Array.isArray(workspace.agentGroupIds) || !workspace.agentGroupIds.includes(id)) {
      continue;
    }

    let nextGroupIds = workspace.agentGroupIds.filter(
      (groupId): groupId is string => typeof groupId === 'string' && groupId !== id,
    );
    replacementGroupId = nextGroupIds.find((groupId) => existingGroupIds.has(groupId)) ?? null;

    if (!replacementGroupId) {
      const replacementGroup = await createAgentGroup('Agents');
      replacementGroupId = replacementGroup.id;
      existingGroupIds.add(replacementGroupId);
      nextGroupIds = [...nextGroupIds, replacementGroupId];
    }

    store.update('workspaces', String(workspace.id), {
      agentGroupIds: nextGroupIds,
      updatedAt: new Date().toISOString(),
    });
  }

  const agentIds = await listAgentIdsWithGroupId(id);
  if (!replacementGroupId && agentIds.length > 0) {
    const fallbackGroup = await createAgentGroup('Agents');
    replacementGroupId = fallbackGroup.id;
  }
  for (const agentId of agentIds) {
    store.update('agents', agentId, { groupId: replacementGroupId });
  }
  store.delete('agentGroups', id);
  return true;
}

export async function reorderAgentGroups(ids: string[]): Promise<AgentGroupRecord[]> {
  for (let i = 0; i < ids.length; i++) {
    store.update('agentGroups', ids[i], { order: i });
  }
  return listAgentGroups();
}

function asAgentAvatarPreset(rec: Record<string, unknown>): AgentAvatarPresetRecord {
  return {
    ...rec,
    name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Untitled preset',
    avatarIcon: typeof rec.avatarIcon === 'string' ? rec.avatarIcon : 'spark',
  } as AgentAvatarPresetRecord;
}

export function listAgentAvatarPresets(): AgentAvatarPresetRecord[] {
  return store
    .getAll('agentAvatarPresets')
    .map(asAgentAvatarPreset)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createAgentAvatarPreset(params: {
  name: string;
  avatarIcon: string;
}): AgentAvatarPresetRecord {
  const record = store.insert('agentAvatarPresets', {
    name: params.name.trim(),
    avatarIcon: params.avatarIcon,
  });
  return asAgentAvatarPreset(record);
}

export function updateAgentAvatarPreset(
  id: string,
  data: Partial<Pick<AgentAvatarPresetRecord, 'name' | 'avatarIcon'>>,
): AgentAvatarPresetRecord | null {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.avatarIcon !== undefined) patch.avatarIcon = data.avatarIcon;
  const updated = store.update('agentAvatarPresets', id, patch);
  return updated ? asAgentAvatarPreset(updated) : null;
}

export function deleteAgentAvatarPreset(id: string): boolean {
  return Boolean(store.delete('agentAvatarPresets', id));
}

// ---------------------------------------------------------------------------
// Agent color presets (saved bg+logo color combos)
// ---------------------------------------------------------------------------

export interface AgentColorPresetRecord {
  id: string;
  name: string;
  bgColor: string;
  logoColor: string;
  createdAt: string;
  updatedAt: string;
}

function asAgentColorPreset(rec: Record<string, unknown>): AgentColorPresetRecord {
  return {
    ...rec,
    name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : 'Untitled',
    bgColor: typeof rec.bgColor === 'string' ? rec.bgColor : '#1a1a2e',
    logoColor: typeof rec.logoColor === 'string' ? rec.logoColor : '#e94560',
  } as AgentColorPresetRecord;
}

export function listAgentColorPresets(): AgentColorPresetRecord[] {
  return store
    .getAll('agentColorPresets')
    .map(asAgentColorPreset)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createAgentColorPreset(params: {
  name: string;
  bgColor: string;
  logoColor: string;
}): AgentColorPresetRecord {
  const record = store.insert('agentColorPresets', {
    name: params.name.trim(),
    bgColor: params.bgColor,
    logoColor: params.logoColor,
  });
  return asAgentColorPreset(record);
}

export function updateAgentColorPreset(
  id: string,
  data: Partial<Pick<AgentColorPresetRecord, 'name' | 'bgColor' | 'logoColor'>>,
): AgentColorPresetRecord | null {
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name.trim();
  if (data.bgColor !== undefined) patch.bgColor = data.bgColor;
  if (data.logoColor !== undefined) patch.logoColor = data.logoColor;
  const updated = store.update('agentColorPresets', id, patch);
  return updated ? asAgentColorPreset(updated) : null;
}

export function deleteAgentColorPreset(id: string): boolean {
  return Boolean(store.delete('agentColorPresets', id));
}

// ---------------------------------------------------------------------------
// Agent record interface
// ---------------------------------------------------------------------------

export interface AgentRecord {
  id: string;
  name: string;
  description: string;
  model: string;
  modelId: string | null;
  runtime: 'openwork';
  provider: string | null;
  thinkingLevel: 'low' | 'medium' | 'high' | null;
  preset: string;
  presetParameters: Record<string, string>;
  repositoryRoot: string | null;
  repositoryRootOrigin: 'runner_local' | 'backend_local_legacy' | 'unknown' | null;
  repositoryRootRunnerId: string | null;
  repositoryRootVerifiedAt: string | null;
  repositoryRootRepairRequired: boolean;
  runnerInventoryRunnerId: string | null;
  runnerInventoryWorkspaceId: string | null;
  runnerInventoryVersion: number | null;
  runnerInventoryCapabilityRefs: Record<string, unknown> | null;
  runnerInventoryWorkspaceRootOrigin:
    | 'runner_advertised'
    | 'repository_root'
    | 'backend_local_legacy'
    | 'unknown'
    | null;
  runnerInventoryWorkspaceRootVerifiedAt: string | null;
  runnerInventoryVerifiedAt: string | null;
  legacyAgentFileState:
    | 'not_applicable'
    | 'unknown_backend_legacy'
    | 'legacy_importable'
    | 'no_legacy_files'
    | null;
  legacyAgentFileRepairState:
    | 'not_required'
    | 'needs_runner_validation'
    | 'needs_runner_import'
    | 'runner_validated'
    | 'runner_imported'
    | null;
  legacyAgentFileCheckedAt: string | null;
  workspacePath: string | null;
  status: 'active' | 'inactive' | 'error';
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  capabilities: string[];
  skipPermissions: boolean;
  /** When true, new chat conversations use a dedicated workspace subfolder (per toggle change). */
  separateFolderPerChat: boolean;
  cronJobs: CronJob[];
  skillIds: string[];
  groupId: string | null;
  workspaceApiKey: string | null;
  workspaceApiKeyId: string | null;
  serviceUserId: string | null;
  lastActivity: string | null;
  archivedAt: string | null;
  avatarIcon: string;
  avatarBgColor: string;
  avatarLogoColor: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicAgentRecord = Omit<AgentRecord, 'workspaceApiKey' | 'workspaceApiKeyId'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePresetModelKey(model: string): string {
  return model.trim().toLowerCase();
}

function normalizeModelValue(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return '';
  return MODEL_ID_BY_ALIAS.get(normalized) ?? normalized;
}

function getPresetApplicableFiles(preset: PresetDef, model: string): PresetFileDef[] {
  const normalizedModel = normalizePresetModelKey(model);
  return preset.files.filter(
    (file) =>
      !file.models ||
      file.models.some((candidate) => normalizePresetModelKey(candidate) === normalizedModel),
  );
}

function asAgent(rec: Record<string, unknown>): AgentRecord {
  const presetParameters =
    rec.presetParameters && typeof rec.presetParameters === 'object' && !Array.isArray(rec.presetParameters)
      ? Object.fromEntries(
          Object.entries(rec.presetParameters as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'),
        )
      : {};

  return {
    ...rec,
    model: typeof rec.model === 'string' ? normalizeModelValue(rec.model) : '',
    modelId: typeof rec.modelId === 'string' ? rec.modelId : null,
    runtime: 'openwork',
    provider:
      typeof rec.provider === 'string' && rec.provider.trim()
        ? rec.provider.trim()
        : typeof rec.model === 'string'
          ? normalizeModelValue(rec.model)
          : null,
    thinkingLevel: ['low', 'medium', 'high'].includes(rec.thinkingLevel as string)
      ? (rec.thinkingLevel as AgentRecord['thinkingLevel'])
      : null,
    presetParameters,
    repositoryRoot: normalizeRepositoryRoot(
      typeof rec.repositoryRoot === 'string' ? rec.repositoryRoot : null,
    ),
    repositoryRootOrigin: normalizeRepositoryRootOrigin(rec.repositoryRootOrigin),
    repositoryRootRunnerId:
      typeof rec.repositoryRootRunnerId === 'string' && rec.repositoryRootRunnerId.trim()
        ? rec.repositoryRootRunnerId.trim()
        : null,
    repositoryRootVerifiedAt:
      typeof rec.repositoryRootVerifiedAt === 'string'
        ? rec.repositoryRootVerifiedAt
        : rec.repositoryRootVerifiedAt instanceof Date
          ? rec.repositoryRootVerifiedAt.toISOString()
          : null,
    repositoryRootRepairRequired: rec.repositoryRootRepairRequired === true,
    runnerInventoryRunnerId:
      typeof rec.runnerInventoryRunnerId === 'string' && rec.runnerInventoryRunnerId.trim()
        ? rec.runnerInventoryRunnerId.trim()
        : null,
    runnerInventoryWorkspaceId:
      typeof rec.runnerInventoryWorkspaceId === 'string' && rec.runnerInventoryWorkspaceId.trim()
        ? rec.runnerInventoryWorkspaceId.trim()
        : null,
    runnerInventoryVersion:
      typeof rec.runnerInventoryVersion === 'number' && Number.isFinite(rec.runnerInventoryVersion)
        ? rec.runnerInventoryVersion
        : null,
    runnerInventoryCapabilityRefs:
      rec.runnerInventoryCapabilityRefs &&
      typeof rec.runnerInventoryCapabilityRefs === 'object' &&
      !Array.isArray(rec.runnerInventoryCapabilityRefs)
        ? (rec.runnerInventoryCapabilityRefs as Record<string, unknown>)
        : null,
    runnerInventoryWorkspaceRootOrigin: [
      'runner_advertised',
      'repository_root',
      'backend_local_legacy',
      'unknown',
    ].includes(rec.runnerInventoryWorkspaceRootOrigin as string)
      ? (rec.runnerInventoryWorkspaceRootOrigin as AgentRecord['runnerInventoryWorkspaceRootOrigin'])
      : null,
    runnerInventoryWorkspaceRootVerifiedAt:
      typeof rec.runnerInventoryWorkspaceRootVerifiedAt === 'string'
        ? rec.runnerInventoryWorkspaceRootVerifiedAt
        : rec.runnerInventoryWorkspaceRootVerifiedAt instanceof Date
          ? rec.runnerInventoryWorkspaceRootVerifiedAt.toISOString()
          : null,
    runnerInventoryVerifiedAt:
      typeof rec.runnerInventoryVerifiedAt === 'string'
        ? rec.runnerInventoryVerifiedAt
        : rec.runnerInventoryVerifiedAt instanceof Date
          ? rec.runnerInventoryVerifiedAt.toISOString()
          : null,
    legacyAgentFileState: [
      'not_applicable',
      'unknown_backend_legacy',
      'legacy_importable',
      'no_legacy_files',
    ].includes(rec.legacyAgentFileState as string)
      ? (rec.legacyAgentFileState as AgentRecord['legacyAgentFileState'])
      : null,
    legacyAgentFileRepairState: [
      'not_required',
      'needs_runner_validation',
      'needs_runner_import',
      'runner_validated',
      'runner_imported',
    ].includes(rec.legacyAgentFileRepairState as string)
      ? (rec.legacyAgentFileRepairState as AgentRecord['legacyAgentFileRepairState'])
      : null,
    legacyAgentFileCheckedAt:
      typeof rec.legacyAgentFileCheckedAt === 'string'
        ? rec.legacyAgentFileCheckedAt
        : rec.legacyAgentFileCheckedAt instanceof Date
          ? rec.legacyAgentFileCheckedAt.toISOString()
          : null,
    workspacePath:
      typeof rec.workspacePath === 'string' && rec.workspacePath.trim()
        ? path.resolve(rec.workspacePath.trim())
        : null,
    skipPermissions: Boolean(rec.skipPermissions),
    separateFolderPerChat: rec.separateFolderPerChat === true,
    cronJobs: Array.isArray(rec.cronJobs) ? rec.cronJobs : [],
    skillIds: Array.isArray(rec.skillIds) ? rec.skillIds : [],
    avatarIcon: typeof rec.avatarIcon === 'string' ? rec.avatarIcon : 'spark',
    avatarBgColor: typeof rec.avatarBgColor === 'string' ? rec.avatarBgColor : '#1a1a2e',
    avatarLogoColor: typeof rec.avatarLogoColor === 'string' ? rec.avatarLogoColor : '#e94560',
    archivedAt:
      typeof rec.archivedAt === 'string'
        ? rec.archivedAt
        : rec.archivedAt instanceof Date
          ? rec.archivedAt.toISOString()
          : null,
  } as unknown as AgentRecord;
}

export function asPublicAgent(agent: AgentRecord): PublicAgentRecord {
  const publicAgent = { ...agent };
  delete (publicAgent as Partial<AgentRecord>).workspaceApiKey;
  delete (publicAgent as Partial<AgentRecord>).workspaceApiKeyId;
  return publicAgent;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateAgentParams {
  name: string;
  description: string;
  model: string;
  modelId?: string | null;
  thinkingLevel?: 'low' | 'medium' | 'high' | null;
  preset: string;
  presetParameters?: Record<string, string>;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  capabilities: string[];
  skipPermissions?: boolean;
  groupId?: string | null;
  avatarIcon?: string;
  avatarBgColor?: string;
  avatarLogoColor?: string;
  repositoryRootValidation?: {
    path: string;
    runnerId: string;
    workspaceId?: string | null;
    verifiedAt: string;
  };
}

const WORKSPACE_API_PERMISSIONS = [
  'cards:write',
  'messages:write',
  'storage:write',
  'collections:write',
  'boards:write',
  'tags:write',
  'settings:read',
  'settings:write',
  'conversations:write',
];

const WORKSPACE_API_PERMISSION_SET = new Set(WORKSPACE_API_PERMISSIONS);

function normalizePermissionList(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];

  return [
    ...new Set(
      permissions.filter((permission): permission is string => typeof permission === 'string'),
    ),
  ];
}

function arraysEqualAsSets(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((permission) => rightSet.has(permission));
}

function resolvePresetParameters(
  preset: PresetDef,
  input: Record<string, string> | undefined,
): Record<string, string> {
  const parameterDefs = new Map(preset.parameters.map((parameter) => [parameter.key, parameter]));
  const provided = input ?? {};

  for (const key of Object.keys(provided)) {
    if (!parameterDefs.has(key)) {
      throw new Error(`Unknown preset parameter "${key}" for preset "${preset.name}"`);
    }
  }

  const resolved: Record<string, string> = {};
  for (const parameter of preset.parameters) {
    const value = provided[parameter.key]?.trim() ?? '';
    if (value) {
      resolved[parameter.key] = value;
      continue;
    }
    if (parameter.required) {
      throw new Error(`Preset parameter "${parameter.label}" is required`);
    }
  }

  return resolved;
}

function buildPresetTemplateVars(
  preset: PresetDef,
  input: {
    agentName: string;
    description: string;
    presetParameters: Record<string, string>;
  },
): Record<string, string> {
  const vars: Record<string, string> = {
    agentName: input.agentName,
    description: input.description || 'Agent workspace.',
  };

  for (const parameter of preset.parameters) {
    const value = input.presetParameters[parameter.key] ?? '';
    vars[parameter.key] = value;
    const parameterTemplate = value
      ? parameter.contentTemplate
      : parameter.emptyContentTemplate;
    vars[`${parameter.key}Instructions`] = parameterTemplate
      ? renderTemplate(parameterTemplate, { ...vars, value })
      : '';
  }

  return vars;
}

function scopeWorkspaceApiPermissions(requestedPermissions: unknown): string[] {
  const normalized = normalizePermissionList(requestedPermissions);
  return normalized.filter((permission) => WORKSPACE_API_PERMISSION_SET.has(permission));
}

function deriveWorkspaceApiPermissions(requestedPermissions: unknown, context: string): string[] {
  const scoped = scopeWorkspaceApiPermissions(requestedPermissions);

  if (scoped.length === 0) {
    throw new Error(`${context} does not grant any agent-usable workspace permissions`);
  }

  return scoped;
}

interface SyncAgentWorkspaceAccessOptions {
  strictSourceKey?: boolean;
}

const AGENT_USER_EMAIL_DOMAIN = 'agents.local';

function agentServiceEmail(agentId: string): string {
  return `agent-${agentId}@${AGENT_USER_EMAIL_DOMAIN}`;
}

async function createAgentServiceUser(
  agentId: string,
  agentName: string,
): Promise<Record<string, unknown>> {
  return store.insert('users', {
    email: agentServiceEmail(agentId),
    // Agent users never log in interactively; keep a real hash for safety.
    passwordHash: await hashPassword(randomUUID()),
    firstName: agentName,
    lastName: '',
    isActive: true,
    type: 'agent',
    agentId,
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: null,
  });
}

async function normalizeAgentServiceUser(
  userId: string,
  agentId: string,
  agentName: string,
): Promise<Record<string, unknown>> {
  const updated = await store.update('users', userId, {
    email: agentServiceEmail(agentId),
    firstName: agentName,
    lastName: '',
    isActive: true,
    type: 'agent',
    agentId,
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: null,
  });

  if (!updated) {
    throw new Error(`Agent service user not found: ${userId}`);
  }

  return updated;
}

export async function createAgent(params: CreateAgentParams): Promise<AgentRecord> {
  const preset = AGENT_PRESETS[params.preset];
  if (!preset) throw new Error(`Unknown preset: ${params.preset}`);
  if (!params.groupId) {
    throw new Error('Agent group is required');
  }
  const presetParameters = resolvePresetParameters(preset, params.presetParameters);
  const workspaceApiPermissions = deriveWorkspaceApiPermissions(
    params.capabilities,
    `API key "${params.apiKeyName}"`,
  );

  const agentId = randomUUID();
  const validatedRepositoryRoot = params.repositoryRootValidation
    ? normalizeRepositoryRoot(params.repositoryRootValidation.path)
    : null;
  const repositoryRoot =
    validatedRepositoryRoot ?? normalizeRepositoryRoot(presetParameters.workingDirectory);
  if (validatedRepositoryRoot) {
    presetParameters.workingDirectory = validatedRepositoryRoot;
  }
  let serviceUserId: string | null = null;
  let wsKeyId: string | null = null;
  const normalizedModel = normalizeModelValue(params.model);

  try {
    // Step 1: Create service user
    const serviceUser = await createAgentServiceUser(agentId, params.name);
    serviceUserId = serviceUser.id as string;

    // Step 2: Create workspace API key
    const wsKey = await createApiKey({
      name: `Agent: ${params.name}`,
      permissions: workspaceApiPermissions,
      createdById: serviceUserId,
      description: `Auto-created workspace API key for agent "${params.name}"`,
    });
    wsKeyId = (wsKey as Record<string, unknown>).id as string;

    // Step 3: Insert agent record
    const record = await store.insert('agents', {
      id: agentId,
      name: params.name,
      description: params.description,
      model: normalizedModel,
      modelId: params.modelId ?? null,
      runtime: 'openwork',
      provider: normalizedModel,
      thinkingLevel: params.thinkingLevel ?? null,
      preset: params.preset,
      presetParameters,
      repositoryRoot,
      repositoryRootOrigin: repositoryRoot
        ? params.repositoryRootValidation
          ? 'runner_local'
          : 'unknown'
        : null,
      repositoryRootRunnerId: repositoryRoot
        ? (params.repositoryRootValidation?.runnerId ?? null)
        : null,
      repositoryRootVerifiedAt: repositoryRoot
        ? (params.repositoryRootValidation?.verifiedAt ?? null)
        : null,
      repositoryRootRepairRequired: Boolean(repositoryRoot && !params.repositoryRootValidation),
      runnerInventoryRunnerId: params.repositoryRootValidation?.runnerId ?? null,
      runnerInventoryWorkspaceId: params.repositoryRootValidation?.workspaceId ?? null,
      runnerInventoryVersion: 1,
      runnerInventoryCapabilityRefs: params.repositoryRootValidation
        ? {
            runnerId: params.repositoryRootValidation.runnerId,
            workspaceId: params.repositoryRootValidation.workspaceId ?? null,
            capabilitySource: 'agent_runners.capabilities',
          }
        : null,
      runnerInventoryWorkspaceRootOrigin: repositoryRoot ? 'repository_root' : 'unknown',
      runnerInventoryWorkspaceRootVerifiedAt: params.repositoryRootValidation?.verifiedAt ?? null,
      runnerInventoryVerifiedAt: params.repositoryRootValidation?.verifiedAt ?? null,
      legacyAgentFileState: repositoryRoot ? 'not_applicable' : 'unknown_backend_legacy',
      legacyAgentFileRepairState: repositoryRoot
        ? params.repositoryRootValidation
          ? 'not_required'
          : 'needs_runner_validation'
        : 'needs_runner_validation',
      legacyAgentFileCheckedAt: null,
      workspacePath: null,
      status: 'active',
      apiKeyId: params.apiKeyId,
      apiKeyName: params.apiKeyName,
      apiKeyPrefix: params.apiKeyPrefix,
      capabilities: params.capabilities,
      skipPermissions: params.skipPermissions ?? false,
      separateFolderPerChat: false,
      groupId: params.groupId ?? null,
      workspaceApiKey: wsKey.rawKey,
      workspaceApiKeyId: wsKeyId,
      serviceUserId,
      lastActivity: null,
      archivedAt: null,
      avatarIcon: params.avatarIcon ?? 'spark',
      avatarBgColor: params.avatarBgColor ?? '#1a1a2e',
      avatarLogoColor: params.avatarLogoColor ?? '#e94560',
    });

    return asAgent(record);
  } catch (error) {
    // Rollback: delete created resources on failure
    if (wsKeyId) {
      await deleteApiKey(wsKeyId).catch(() => {});
    }
    if (serviceUserId) {
      await store.delete('users', serviceUserId);
    }
    if (agentId) {
      await store.delete('agents', agentId);
    }
    throw error;
  }
}

export async function rollbackCreatedAgentMetadata(agent: AgentRecord): Promise<void> {
  const workspaceApiKeyId =
    typeof agent.workspaceApiKeyId === 'string' ? agent.workspaceApiKeyId : null;
  if (workspaceApiKeyId) {
    await deleteApiKey(workspaceApiKeyId).catch(() => {});
  }
  if (typeof agent.serviceUserId === 'string' && agent.serviceUserId) {
    await store.delete('users', agent.serviceUserId);
  }
  await store.delete('agents', agent.id);
}

export function buildInitialAgentWorkspaceImportFiles(
  agent: Pick<
    AgentRecord,
    'name' | 'description' | 'model' | 'preset' | 'presetParameters'
  >,
): RunnerAgentWorkspaceImportFile[] {
  const preset = AGENT_PRESETS[agent.preset];
  if (!preset) return [];

  const vars = buildPresetTemplateVars(preset, {
    agentName: agent.name,
    description: agent.description,
    presetParameters: agent.presetParameters,
  });

  const defaultSkillImports = buildDefaultSkillImportFiles(preset.defaultSkills);
  const skillSection =
    defaultSkillImports.references.length > 0
      ? buildDefaultSkillsSection(defaultSkillImports.references)
      : '';

  return [
    ...getPresetApplicableFiles(preset, agent.model)
    .filter((file): file is PresetTextFileDef => file.type === 'file')
    .map((file) => {
      const content = renderTemplate(file.template, vars) + skillSection;
      return {
        path: normalizePath(file.name),
        contentBase64: Buffer.from(content, 'utf-8').toString('base64'),
        sizeBytes: Buffer.byteLength(content, 'utf-8'),
      };
    }),
    ...defaultSkillImports.files,
  ];
}

interface DefaultSkillImportReference {
  name: string;
  description: string;
  path: string;
}

const SKILLS_START = '<!-- skills:start -->';
const SKILLS_END = '<!-- skills:end -->';
const SKILLS_DIR = path.resolve(env.DATA_DIR, 'skills');

function slugifySkillName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'skill'
  );
}

function buildDefaultSkillsSection(skills: DefaultSkillImportReference[]): string {
  const lines = skills.map((skill) =>
    skill.description
      ? `- \`${skill.name}\` — ${skill.description} Path: \`${skill.path}\`.`
      : `- \`${skill.name}\` Path: \`${skill.path}\`.`,
  );

  return `\n\n${[SKILLS_START, '## Skills', ...lines, SKILLS_END].join('\n')}\n`;
}

function readDefaultSkillDisplay(srcDir: string, fallbackName: string): {
  name: string;
  description: string;
} {
  const indexPath = path.join(srcDir, 'index.md');
  if (!fs.existsSync(indexPath)) return { name: fallbackName, description: '' };

  const lines = fs.readFileSync(indexPath, 'utf-8').split(/\r?\n/);
  let name = fallbackName;
  let description = '';

  if (lines[0]?.trim() === '---') {
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (trimmed === '---') break;
      if (trimmed.startsWith('name:')) {
        name = trimmed.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '') || name;
      } else if (trimmed.startsWith('description:')) {
        description =
          trimmed.slice('description:'.length).trim().replace(/^['"]|['"]$/g, '') || description;
      }
    }
  }

  return { name, description };
}

function collectSkillFiles(
  srcDir: string,
  destDir: string,
  files: RunnerAgentWorkspaceImportFile[],
): void {
  if (!fs.existsSync(srcDir)) return;

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'skill.json') continue;

    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.posix.join(destDir, entry.name);
    if (entry.isDirectory()) {
      collectSkillFiles(srcPath, destPath, files);
      continue;
    }

    const content = fs.readFileSync(srcPath);
    files.push({
      path: normalizePath(destPath),
      contentBase64: content.toString('base64'),
      sizeBytes: content.byteLength,
    });
  }
}

function buildDefaultSkillImportFiles(skillNames: string[]): {
  files: RunnerAgentWorkspaceImportFile[];
  references: DefaultSkillImportReference[];
} {
  if (skillNames.length === 0) return { files: [], references: [] };

  const skillRecords = listSkillRecords();
  const files: RunnerAgentWorkspaceImportFile[] = [];
  const references: DefaultSkillImportReference[] = [];

  for (const skillName of skillNames) {
    const skill = skillRecords.find(
      (record) =>
        typeof record.name === 'string' &&
        record.name.toLowerCase() === skillName.toLowerCase(),
    );
    if (!skill || typeof skill.id !== 'string' || typeof skill.name !== 'string') continue;

    const slug = slugifySkillName(skill.name);
    const srcDir = path.join(SKILLS_DIR, skill.id);
    const destDir = path.posix.join('/skills', slug);
    const beforeCount = files.length;
    collectSkillFiles(srcDir, destDir, files);
    if (files.length === beforeCount) continue;

    const display = readDefaultSkillDisplay(srcDir, skill.name);
    references.push({
      name: display.name,
      description:
        display.description || (typeof skill.description === 'string' ? skill.description : ''),
      path: path.posix.join('skills', slug, 'index.md'),
    });
  }

  return { files, references };
}

export async function listAgents(): Promise<AgentRecord[]> {
  const rows = await listAgentRecordsOrdered();
  return rows.map(asAgent);
}

export function isAgentArchived(agent: Pick<AgentRecord, 'archivedAt'> | null | undefined): boolean {
  return Boolean(agent?.archivedAt);
}

export function getAgent(id: string): AgentRecord | null {
  const rec = store.getById('agents', id);
  return rec ? asAgent(rec) : null;
}

export async function updateAgent(
  id: string,
  data: Partial<
    Pick<
      AgentRecord,
      | 'name'
      | 'description'
      | 'model'
      | 'modelId'
      | 'thinkingLevel'
      | 'status'
      | 'skipPermissions'
      | 'separateFolderPerChat'
      | 'cronJobs'
      | 'groupId'
      | 'avatarIcon'
      | 'avatarBgColor'
      | 'avatarLogoColor'
      | 'apiKeyId'
    >
  >,
): Promise<AgentRecord | null> {
  const current = store.getById('agents', id);
  if (!current) return null;
  const currentAgent = asAgent(current);
  if (isAgentArchived(currentAgent)) {
    throw new Error('Archived agents cannot be updated');
  }

  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.model !== undefined) {
    const normalizedModel = normalizeModelValue(data.model);
    patch.model = normalizedModel;
  }
  if (data.modelId !== undefined) patch.modelId = data.modelId;
  if (data.thinkingLevel !== undefined) patch.thinkingLevel = data.thinkingLevel;
  if (data.status !== undefined) patch.status = data.status;
  if (data.skipPermissions !== undefined) patch.skipPermissions = data.skipPermissions;
  if (data.separateFolderPerChat !== undefined)
    patch.separateFolderPerChat = data.separateFolderPerChat;
  if (data.cronJobs !== undefined) patch.cronJobs = data.cronJobs;
  if (data.groupId !== undefined) patch.groupId = data.groupId;
  if (data.avatarIcon !== undefined) patch.avatarIcon = data.avatarIcon;
  if (data.avatarBgColor !== undefined) patch.avatarBgColor = data.avatarBgColor;
  if (data.avatarLogoColor !== undefined) patch.avatarLogoColor = data.avatarLogoColor;
  if (data.apiKeyId !== undefined) {
    const apiKey = await getApiKeyRecord(data.apiKeyId);
    if (!apiKey || apiKey.isActive === false) {
      throw new Error('API key not found');
    }

    patch.apiKeyId = data.apiKeyId;
    patch.apiKeyName = apiKey.name as string;
    patch.apiKeyPrefix = apiKey.keyPrefix as string;
    patch.capabilities = normalizePermissionList(apiKey.permissions);
  }

  const updated = await store.update('agents', id, patch);
  if (!updated) return null;

  if (data.name !== undefined) {
    const serviceUserId = updated.serviceUserId as string | null | undefined;
    if (serviceUserId) {
      await normalizeAgentServiceUser(serviceUserId, id, data.name);
    }
  }

  if (data.apiKeyId !== undefined) {
    return syncAgentWorkspaceAccess(id, { strictSourceKey: true });
  }

  return asAgent(updated);
}

export async function deleteAgent(id: string): Promise<boolean> {
  const agent = store.getById('agents', id);
  if (!agent) return false;
  if (agent.archivedAt) return true;

  stopAllAgentCronJobs(id);
  const archivedAt = new Date().toISOString();
  const workspaceApiKeyId =
    typeof agent.workspaceApiKeyId === 'string' ? agent.workspaceApiKeyId : null;

  await store.transaction(async () => {
    const serviceUserId = agent.serviceUserId as string | null | undefined;
    if (serviceUserId) {
      await store.update('users', serviceUserId, { isActive: false, type: 'agent', agentId: id });
      await deleteRefreshTokensForUserId(serviceUserId);
    }

    // Close related conversations and preserve agent name in metadata
    const agentConversations = store
      .getAll('conversations')
      .filter((r: Record<string, unknown>) => {
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
        meta =
          typeof conv.metadata === 'string'
            ? JSON.parse(conv.metadata)
            : ((conv.metadata as Record<string, unknown>) ?? {});
      } catch {
        /* ignore */
      }

      meta.agentDeleted = true;
      meta.agentName = agent.name;

      await store.update('conversations', conv.id as string, {
        status: 'closed',
        closedAt: new Date().toISOString(),
        metadata: JSON.stringify(meta),
      });
    }

    for (const column of store.getAll('boardColumns')) {
      if (column.assignAgentId !== id) continue;
      await store.update('boardColumns', column.id as string, {
        assignAgentId: null,
        assignAgentPrompt: null,
      });
    }

    for (const template of store.getAll('boardCronTemplates')) {
      if (template.agentId !== id && template.assigneeId !== id) continue;
      await store.update('boardCronTemplates', template.id as string, {
        agentId: template.agentId === id ? null : template.agentId,
        assigneeId: template.assigneeId === id ? null : template.assigneeId,
        enabled: false,
      });
    }

    for (const queueItem of store.getAll('agentChatQueue')) {
      if (queueItem.agentId !== id) continue;
      if (queueItem.status !== 'queued' && queueItem.status !== 'processing') continue;
      await store.update('agentChatQueue', queueItem.id as string, {
        status: 'cancelled',
        completedAt: archivedAt,
        nextAttemptAt: null,
        runId: null,
        errorMessage: 'Agent archived',
      });
    }

    for (const batchRun of store.getAll('agentBatchRuns')) {
      if (batchRun.agentId !== id) continue;
      if (batchRun.status !== 'queued' && batchRun.status !== 'running') continue;
      await store.update('agentBatchRuns', batchRun.id as string, {
        status: 'cancelled',
        finishedAt: archivedAt,
        errorMessage: 'Agent archived',
      });
    }

    for (const batchItem of store.getAll('agentBatchRunItems')) {
      if (batchItem.agentId !== id) continue;
      if (batchItem.status !== 'queued' && batchItem.status !== 'processing') continue;
      await store.update('agentBatchRunItems', batchItem.id as string, {
        status: 'cancelled',
        completedAt: archivedAt,
        errorMessage: 'Agent archived',
      });
    }

    await deleteAgentEnvVarsByAgentId(id);
    for (const externalKey of store.getAll('agentExternalApiKeys')) {
      if (externalKey.agentId === id && typeof externalKey.id === 'string') {
        await store.delete('agentExternalApiKeys', externalKey.id);
      }
    }

    await store.update('agents', id, {
      status: 'inactive',
      archivedAt,
      cronJobs: [],
      workspaceApiKeyId: null,
      workspaceApiKey: null,
    });

    if (workspaceApiKeyId) {
      await deleteApiKey(workspaceApiKeyId).catch(() => {});
    }
  });

  return true;
}

async function syncAgentWorkspaceAccess(
  agentId: string,
  options: SyncAgentWorkspaceAccessOptions = {},
): Promise<AgentRecord | null> {
  const rawAgent = store.getById('agents', agentId);
  if (!rawAgent) return null;
  if (rawAgent.archivedAt) return asAgent(rawAgent);

  const agentName = String(rawAgent.name ?? 'Agent');
  const directServiceUserId = rawAgent.serviceUserId as string | null | undefined;
  const directServiceUser = directServiceUserId
    ? store.getById('users', directServiceUserId)
    : null;

  const serviceUser = directServiceUser
    ? await normalizeAgentServiceUser(directServiceUser.id as string, agentId, agentName)
    : await createAgentServiceUser(agentId, agentName);
  const serviceUserId = serviceUser.id as string;

  const sourceKeyId = rawAgent.apiKeyId as string;
  const sourceKey = sourceKeyId ? await getApiKeyRecord(sourceKeyId) : null;
  const sourceKeyIsActive = Boolean(sourceKey && sourceKey.isActive !== false);
  const sourcePermissions = sourceKeyIsActive
    ? normalizePermissionList(sourceKey?.permissions)
    : [];
  const desiredWorkspacePermissions = scopeWorkspaceApiPermissions(sourcePermissions);

  if (options.strictSourceKey) {
    if (!sourceKeyIsActive) {
      throw new Error('API key not found');
    }

    if (desiredWorkspacePermissions.length === 0) {
      throw new Error(
        `API key "${String(sourceKey?.name ?? 'Unknown')}" does not grant any agent-usable workspace permissions`,
      );
    }
  }

  const currentKeyId = rawAgent.workspaceApiKeyId as string | null | undefined;
  const currentKey = currentKeyId ? await getApiKeyRecord(currentKeyId) : null;
  const keyOwnerMatches = currentKey?.createdById === serviceUserId;
  const keyPermissionsMatch = currentKey
    ? arraysEqualAsSets(
        normalizePermissionList(currentKey.permissions),
        desiredWorkspacePermissions,
      )
    : false;
  const currentKeyValue = (rawAgent.workspaceApiKey as string | null | undefined) ?? null;
  const currentKeyValueRecord = currentKeyValue ? await validateApiKey(currentKeyValue) : null;
  const keyValueMatchesRecord = currentKeyValue
    ? currentKeyValueRecord?.id === currentKeyId
    : false;

  let nextKeyId: string | null = null;
  let nextKeyValue: string | null = null;

  if (desiredWorkspacePermissions.length > 0) {
    nextKeyId = currentKeyId ?? null;
    nextKeyValue = currentKeyValue;

    if (
      !currentKey ||
      !keyOwnerMatches ||
      !currentKeyValue ||
      !keyPermissionsMatch ||
      !keyValueMatchesRecord
    ) {
      const wsKey = await createApiKey({
        name: `Agent: ${agentName}`,
        permissions: desiredWorkspacePermissions,
        createdById: serviceUserId,
        description: `Auto-created workspace API key for agent "${agentName}"`,
      });
      nextKeyId = (wsKey as Record<string, unknown>).id as string;
      nextKeyValue = wsKey.rawKey;
      if (currentKeyId) {
        await deleteApiKey(currentKeyId).catch(() => {});
      }
    }
  } else if (currentKeyId) {
    await deleteApiKey(currentKeyId).catch(() => {});
  }

  const updated = await store.update('agents', agentId, {
    serviceUserId,
    apiKeyName: sourceKeyIsActive ? (sourceKey?.name as string) : '',
    apiKeyPrefix: sourceKeyIsActive ? (sourceKey?.keyPrefix as string) : '',
    capabilities: sourcePermissions,
    workspaceApiKeyId: nextKeyId,
    workspaceApiKey: nextKeyValue,
  });

  return updated ? asAgent(updated) : null;
}

export async function syncAgentsForApiKey(apiKeyId: string): Promise<void> {
  const agents = await listAgentRecordsByApiKeyId(apiKeyId);
  for (const agent of agents) {
    await syncAgentWorkspaceAccess(agent.id as string);
  }
}

export async function prepareAgentWorkspaceAccess(agentId: string): Promise<AgentRecord | null> {
  return syncAgentWorkspaceAccess(agentId);
}

export async function ensureAgentServiceAccounts(): Promise<void> {
  const ids = await listAllAgentRecordIds();

  for (const agentId of ids) {
    await syncAgentWorkspaceAccess(agentId);
  }
}

function normalizePath(p: string): string {
  let normalized = p.trim().replace(/\\/g, '/');
  if (!normalized) normalized = '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}
