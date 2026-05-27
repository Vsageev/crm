import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  AGENT_INSTRUCTION_FILE_CANDIDATES,
  buildAgentSkillReference,
  buildPresetSkillImportFiles,
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  decodeAgentSkillId,
  encodeAgentSkillId,
  getAgentSkillDestination,
  parseAgentSkillReferencesFromInstructionContent,
  readAgentSkillDisplayFromContent,
  readPresetSkillDisplay,
  renderAgentInstructionWithSkillsSection,
  listSkillFiles,
  readSkillFileContent,
  uploadSkillFile,
  createSkillFolder,
  deleteSkillFile,
  getSkillFilePath,
  getSkillEntryPath,
  writeSkillFile,
  type AgentSkillRecord,
} from '../services/skills.js';
import { getAgent } from '../services/agents.js';
import type { AgentRecord } from '../services/agents.js';
import { dispatchAgentFileRequest } from '../services/runner-agent-files.js';
import { requireBackendLocalFilesystemGate } from './backend-local-filesystem-gate.js';

const optionalWorkspaceIdQuerySchema = z.object({ workspaceId: z.uuid().optional() });

function sendRunnerAgentSkillError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Runner agent skill action failed';
  if (message.startsWith('runner_unavailable:')) return reply.status(409).send({ code: 'runner_unavailable', message });
  if (message.startsWith('runner_filesystem_unsupported:')) {
    return reply.status(409).send({ code: 'runner_filesystem_unsupported', message });
  }
  if (message.startsWith('agent_runner_workspace_missing:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_missing', message });
  }
  if (message.startsWith('agent_runner_workspace_ambiguous:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_ambiguous', message });
  }
  if (message.startsWith('agent_repository_root_repair_required:')) {
    return reply.status(409).send({ code: 'agent_repository_root_repair_required', message });
  }
  if (message.startsWith('agent_repository_root_runner_mismatch:')) {
    return reply.status(409).send({ code: 'agent_repository_root_runner_mismatch', message });
  }
  if (
    message.startsWith('agent_runner_workspace_root_missing:') ||
    message.startsWith('workspace_root_missing:')
  ) {
    return reply.status(409).send({ code: 'agent_runner_workspace_root_missing', message });
  }
  if (
    message.startsWith('agent_runner_workspace_root_invalid:') ||
    message.startsWith('path_outside_workspace_root:')
  ) {
    return reply.status(409).send({ code: 'agent_runner_workspace_outside_root', message });
  }
  if (message.startsWith('path_inaccessible:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_inaccessible', message });
  }
  if (message.startsWith('not_found:')) return reply.status(404).send({ code: 'not_found', message });
  if (message.startsWith('invalid_path:')) return reply.status(400).send({ code: 'invalid_path', message });
  return reply.badRequest(message);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('not_found:');
}

async function readRunnerAgentFile(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  path: string;
}): Promise<string> {
  const { result } = await dispatchAgentFileRequest({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
    request: { action: 'read_agent_file', path: params.path, encoding: 'utf8' },
  });
  if (result.action !== 'read_agent_file') throw new Error('Unexpected runner response');
  return result.content;
}

async function findRunnerInstructionFile(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
}): Promise<{ path: string; content: string }> {
  for (const name of AGENT_INSTRUCTION_FILE_CANDIDATES) {
    try {
      return {
        path: name,
        content: await readRunnerAgentFile({ ...params, path: name }),
      };
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }
  }
  throw new Error('not_found: Agent instruction file not found');
}

async function readRunnerAgentFileIfExists(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  path: string;
}): Promise<string | null> {
  try {
    return await readRunnerAgentFile(params);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function listRunnerAgentSkills(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
}): Promise<AgentSkillRecord[]> {
  let instruction: { path: string; content: string };
  try {
    instruction = await findRunnerInstructionFile(params);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
  void instruction.path;

  const references = parseAgentSkillReferencesFromInstructionContent(instruction.content);
  return Promise.all(
    references.map(async (ref) => {
      const content = await readRunnerAgentFileIfExists({ ...params, path: ref.path });
      const display = readAgentSkillDisplayFromContent(ref.path, content);
      return {
        id: encodeAgentSkillId(ref.id),
        name: ref.name || display.name,
        description: ref.description || display.description,
        path: ref.path,
        missing: content === null,
      };
    }),
  );
}

async function assertRunnerAgentPathMissing(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  path: string;
}): Promise<void> {
  try {
    await dispatchAgentFileRequest({
      agent: params.agent,
      requestUserId: params.requestUserId,
      workspaceId: params.workspaceId,
      request: { action: 'list_agent_files', path: params.path },
    });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  throw new Error(`Local skill path already exists: ${params.path}`);
}

async function attachRunnerSkillToAgent(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  skillId: string;
}): Promise<AgentSkillRecord[]> {
  const skill = getSkill(params.skillId);
  if (!skill) throw new Error('Skill not found');

  const instruction = await findRunnerInstructionFile(params);
  const currentSkills = parseAgentSkillReferencesFromInstructionContent(instruction.content);
  const destination = getAgentSkillDestination(skill.name);
  const existing = currentSkills.find((entry) => entry.id === destination.id);
  if (existing) return listRunnerAgentSkills(params);

  await assertRunnerAgentPathMissing({ ...params, path: destination.id });
  const files = buildPresetSkillImportFiles(skill.id, destination.id);
  if (files.length === 0) throw new Error('Skill has no importable files');

  const imported = await dispatchAgentFileRequest({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
    request: { action: 'import_agent_files', files },
  });
  if (imported.result.action !== 'import_agent_files') throw new Error('Unexpected runner response');

  const display = readPresetSkillDisplay(skill.id, skill.name);
  const nextContent = renderAgentInstructionWithSkillsSection(instruction.content, [
    ...currentSkills,
    buildAgentSkillReference({
      id: destination.id,
      name: display.name,
      path: destination.path,
      description: display.description || skill.description,
    }),
  ]);
  const written = await dispatchAgentFileRequest({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
    request: {
      action: 'write_agent_file',
      path: instruction.path,
      content: nextContent,
      encoding: 'utf8',
    },
  });
  if (written.result.action !== 'write_agent_file') throw new Error('Unexpected runner response');
  return listRunnerAgentSkills(params);
}

async function deleteRunnerAgentPathIfExists(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  path: string;
}): Promise<void> {
  try {
    await dispatchAgentFileRequest({
      agent: params.agent,
      requestUserId: params.requestUserId,
      workspaceId: params.workspaceId,
      request: { action: 'delete_agent_path', path: params.path },
    });
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function removeRunnerSkillsFolderIfEmpty(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
}): Promise<void> {
  try {
    const { result } = await dispatchAgentFileRequest({
      agent: params.agent,
      requestUserId: params.requestUserId,
      workspaceId: params.workspaceId,
      request: { action: 'list_agent_files', path: 'skills' },
    });
    if (result.action === 'list_agent_files' && result.entries.length === 0) {
      await deleteRunnerAgentPathIfExists({ ...params, path: 'skills' });
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function detachRunnerSkillFromAgent(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  skillId: string;
}): Promise<void> {
  let instruction: { path: string; content: string };
  try {
    instruction = await findRunnerInstructionFile(params);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  const currentSkills = parseAgentSkillReferencesFromInstructionContent(instruction.content);
  const targetId = decodeAgentSkillId(params.skillId) ?? params.skillId.replace(/\\/g, '/').replace(/^\/+/, '');
  const match = currentSkills.find((entry) => entry.id === targetId);
  if (!match) return;

  await deleteRunnerAgentPathIfExists({ ...params, path: match.id });
  const nextContent = renderAgentInstructionWithSkillsSection(
    instruction.content,
    currentSkills.filter((entry) => entry.id !== match.id),
  );
  const written = await dispatchAgentFileRequest({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
    request: {
      action: 'write_agent_file',
      path: instruction.path,
      content: nextContent,
      encoding: 'utf8',
    },
  });
  if (written.result.action !== 'write_agent_file') throw new Error('Unexpected runner response');
  await removeRunnerSkillsFolderIfEmpty(params);
}

export async function skillRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ── Skill CRUD ──

  typedApp.get(
    '/api/skills',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'List all skills',
      },
    },
    async (_request, reply) => {
      return reply.send({ entries: listSkills() });
    },
  );

  typedApp.post(
    '/api/skills',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Create a skill',
        body: z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).default(''),
        }),
      },
    },
    async (request, reply) => {
      const skill = createSkill(request.body);
      return reply.status(201).send(skill);
    },
  );

  typedApp.get(
    '/api/skills/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'Get a skill',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      return reply.send(skill);
    },
  );

  typedApp.patch(
    '/api/skills/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Update a skill',
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
        }),
      },
    },
    async (request, reply) => {
      const updated = updateSkill(request.params.id, request.body);
      if (!updated) return reply.notFound('Skill not found');
      return reply.send(updated);
    },
  );

  typedApp.delete(
    '/api/skills/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Delete a skill from the preset library',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const deleted = deleteSkill(request.params.id);
      if (!deleted) return reply.notFound('Skill not found');
      return reply.status(204).send();
    },
  );

  // ── Skill file operations ──

  typedApp.get(
    '/api/skills/:id/files',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'List files in a skill folder',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string().default('/'),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        const entries = listSkillFiles(request.params.id, request.query.path);
        return reply.send({ entries });
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.get(
    '/api/skills/:id/files/content',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'Read a file from a skill folder',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        const content = readSkillFileContent(request.params.id, request.query.path);
        if (content === null) return reply.notFound('File not found');
        return reply.send({ path: request.query.path, content });
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.put(
    '/api/skills/:id/files/content',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      config: {
        sanitization: {
          preserve: {
            body: ['content'],
          },
        },
      },
      schema: {
        tags: ['Skills'],
        summary: 'Write/update a text file in a skill folder',
        params: z.object({ id: z.string() }),
        body: z.object({
          path: z.string().min(1),
          content: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        writeSkillFile(request.params.id, request.body.path, request.body.content);
        return reply.status(204).send();
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.get(
    '/api/skills/:id/files/download',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'Download a file from a skill folder',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        const diskPath = getSkillFilePath(request.params.id, request.query.path);
        if (!diskPath) return reply.notFound('File not found');

        const fileName = path.basename(diskPath);
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${fileName}"`)
          .send(fs.createReadStream(diskPath));
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.post(
    '/api/skills/:id/files/reveal',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'Development-only: open a backend-managed skill file location in the OS file manager',
        params: z.object({ id: z.string() }),
        body: z.object({
          path: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      if (!requireBackendLocalFilesystemGate(reply, 'skill_file_reveal')) return;
      try {
        const diskPath = getSkillEntryPath(request.params.id, request.body.path);
        if (!diskPath) return reply.notFound('Path not found');

        const platform = process.platform;
        if (platform === 'darwin') {
          const stat = fs.statSync(diskPath);
          if (stat.isDirectory()) {
            spawn('open', [diskPath], { detached: true, stdio: 'ignore' }).unref();
          } else {
            spawn('open', ['-R', diskPath], { detached: true, stdio: 'ignore' }).unref();
          }
        } else if (platform === 'win32') {
          spawn('explorer', [`/select,${diskPath}`], { detached: true, stdio: 'ignore' }).unref();
        } else {
          const stat = fs.statSync(diskPath);
          const dir = stat.isDirectory() ? diskPath : path.dirname(diskPath);
          spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).unref();
        }

        return reply.status(204).send();
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.post(
    '/api/skills/:id/files/upload',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Upload a file to a skill folder',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');

      const data = await request.file();
      if (!data) return reply.badRequest('No file uploaded');

      const dirPath = (data.fields.path as { value: string } | undefined)?.value || '/';
      const fileName = data.filename || 'unnamed';

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      try {
        const entry = await uploadSkillFile(request.params.id, dirPath, fileName, buffer);
        return reply.status(201).send(entry);
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.post(
    '/api/skills/:id/files/folders',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Create a subfolder in a skill',
        params: z.object({ id: z.string() }),
        body: z.object({
          path: z.string().default('/'),
          name: z.string().min(1).max(255),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        const entry = createSkillFolder(request.params.id, request.body.path, request.body.name);
        return reply.status(201).send(entry);
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  typedApp.delete(
    '/api/skills/:id/files',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Delete a file or folder from a skill',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const skill = getSkill(request.params.id);
      if (!skill) return reply.notFound('Skill not found');
      try {
        const deleted = deleteSkillFile(request.params.id, request.query.path);
        if (!deleted) return reply.notFound('Item not found');
        return reply.status(204).send();
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
    },
  );

  // ── Agent skill attachment ──

  typedApp.get(
    '/api/agents/:id/skills',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Skills'],
        summary: 'List skills referenced by an agent instruction file',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        return reply.send({
          entries: await listRunnerAgentSkills({
            agent,
            requestUserId: request.user.sub,
            workspaceId: request.query.workspaceId,
          }),
        });
      } catch (err) {
        return sendRunnerAgentSkillError(reply, err);
      }
    },
  );

  typedApp.post(
    '/api/agents/:id/skills',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Copy a preset-library skill into an agent workspace',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
        body: z.object({
          skillId: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const entries = await attachRunnerSkillToAgent({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          skillId: request.body.skillId,
        });
        return reply.send({ entries });
      } catch (err) {
        return sendRunnerAgentSkillError(reply, err);
      }
    },
  );

  typedApp.delete(
    '/api/agents/:id/skills/:skillId',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Skills'],
        summary: 'Remove a local skill from an agent workspace',
        params: z.object({
          id: z.string(),
          skillId: z.string(),
        }),
        querystring: optionalWorkspaceIdQuerySchema,
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        await detachRunnerSkillFromAgent({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          skillId: request.params.skillId,
        });
        return reply.status(204).send();
      } catch (err) {
        return sendRunnerAgentSkillError(reply, err);
      }
    },
  );
}
