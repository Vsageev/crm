import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { skillRoutes } from './skills.js';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getSkill: vi.fn(),
  listSkills: vi.fn(() => []),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  listSkillFiles: vi.fn(() => []),
  readSkillFileContent: vi.fn(),
  uploadSkillFile: vi.fn(),
  createSkillFolder: vi.fn(),
  deleteSkillFile: vi.fn(),
  getSkillFilePath: vi.fn(),
  getSkillEntryPath: vi.fn(),
  writeSkillFile: vi.fn(),
  dispatchAgentFileRequest: vi.fn(),
  requireBackendLocalFilesystemGate: vi.fn(() => true),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('../middleware/rbac.js', () => ({
  requirePermission: vi.fn(() => async () => undefined),
}));
vi.mock('../services/agents.js', () => ({ getAgent: mocks.getAgent }));
vi.mock('../services/runner-agent-files.js', () => ({
  dispatchAgentFileRequest: mocks.dispatchAgentFileRequest,
}));
vi.mock('./backend-local-filesystem-gate.js', () => ({
  requireBackendLocalFilesystemGate: mocks.requireBackendLocalFilesystemGate,
}));
vi.mock('../services/skills.js', () => ({
  AGENT_INSTRUCTION_FILE_CANDIDATES: ['CLAUDE.MD', 'CLAUDE.md', 'AGENTS.md'],
  buildAgentSkillReference: vi.fn((params) => params),
  buildPresetSkillImportFiles: vi.fn(() => [
    {
      path: '/skills/runner-skill/index.md',
      contentBase64: Buffer.from('# Runner Skill\n').toString('base64'),
      sizeBytes: 15,
    },
  ]),
  createSkill: mocks.createSkill,
  createSkillFolder: mocks.createSkillFolder,
  decodeAgentSkillId: vi.fn((value: string) =>
    value === 'c2tpbGxzL3J1bm5lci1za2lsbA' ? 'skills/runner-skill' : null,
  ),
  deleteSkill: mocks.deleteSkill,
  deleteSkillFile: mocks.deleteSkillFile,
  encodeAgentSkillId: vi.fn((value: string) => Buffer.from(value, 'utf-8').toString('base64url')),
  getAgentSkillDestination: vi.fn(() => ({
    id: 'skills/runner-skill',
    path: 'skills/runner-skill/index.md',
  })),
  getSkill: mocks.getSkill,
  getSkillEntryPath: mocks.getSkillEntryPath,
  getSkillFilePath: mocks.getSkillFilePath,
  listSkillFiles: mocks.listSkillFiles,
  listSkills: mocks.listSkills,
  parseAgentSkillReferencesFromInstructionContent: vi.fn((content: string) =>
    content.includes('skills/runner-skill/index.md')
      ? [
          {
            id: 'skills/runner-skill',
            name: 'Runner Skill',
            path: 'skills/runner-skill/index.md',
            description: 'Uses runner files',
          },
        ]
      : [],
  ),
  readAgentSkillDisplayFromContent: vi.fn((_path: string, content: string | null) =>
    content === null
      ? { name: 'Runner Skill', description: '' }
      : { name: 'Runner Skill', description: 'Hydrated from runner' },
  ),
  readPresetSkillDisplay: vi.fn(() => ({
    name: 'Runner Skill',
    description: 'Preset description',
  })),
  readSkillFileContent: mocks.readSkillFileContent,
  renderAgentInstructionWithSkillsSection: vi.fn(
    (content: string) => `${content}\n<!-- rendered by test -->`,
  ),
  updateSkill: mocks.updateSkill,
  uploadSkillFile: mocks.uploadSkillFile,
  writeSkillFile: mocks.writeSkillFile,
}));

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-1' };
  });
  registerErrorHandler(app);
  await app.register(skillRoutes);
  return app;
}

describe('agent skill runner-owned file routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'Agent One',
      groupId: 'group-1',
      repositoryRoot: null,
    });
    mocks.getSkill.mockReturnValue({
      id: 'skill-1',
      name: 'Runner Skill',
      description: 'Preset description',
    });
  });

  it('lists agent skills through runner file reads without using the backend-local gate', async () => {
    mocks.dispatchAgentFileRequest
      .mockRejectedValueOnce(new Error('not_found: File does not exist: CLAUDE.MD'))
      .mockRejectedValueOnce(new Error('not_found: File does not exist: CLAUDE.md'))
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'AGENTS.md',
          content:
            '<!-- skills:start -->\n## Skills\n- `Runner Skill` Uses runner files Path: `skills/runner-skill/index.md`.\n<!-- skills:end -->',
          encoding: 'utf8',
          sizeBytes: 128,
        },
      })
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'skills/runner-skill/index.md',
          content: '# Runner Skill\nHydrated from runner\n',
          encoding: 'utf8',
          sizeBytes: 35,
        },
      });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/agents/agent-1/skills?workspaceId=22222222-2222-4222-8222-222222222222',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entries: [
        {
          id: 'c2tpbGxzL3J1bm5lci1za2lsbA',
          name: 'Runner Skill',
          path: 'skills/runner-skill/index.md',
          missing: false,
        },
      ],
    });
    expect(mocks.requireBackendLocalFilesystemGate).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({ id: 'agent-1' }),
        requestUserId: 'user-1',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        request: { action: 'read_agent_file', path: 'AGENTS.md', encoding: 'utf8' },
      }),
    );
  });

  it('attaches a preset skill by importing files and writing instructions through the runner', async () => {
    mocks.dispatchAgentFileRequest
      .mockRejectedValueOnce(new Error('not_found: File does not exist: CLAUDE.MD'))
      .mockRejectedValueOnce(new Error('not_found: File does not exist: CLAUDE.md'))
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'AGENTS.md',
          content: '# Agent\n',
          encoding: 'utf8',
          sizeBytes: 8,
        },
      })
      .mockRejectedValueOnce(new Error('not_found: Path does not exist: skills/runner-skill'))
      .mockResolvedValueOnce({
        result: {
          action: 'import_agent_files',
          importedCount: 1,
          skippedCount: 0,
          totalBytes: 15,
          importedAt: '2026-05-27T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        result: {
          action: 'write_agent_file',
          path: 'AGENTS.md',
          sizeBytes: 64,
          updatedAt: '2026-05-27T00:00:01.000Z',
        },
      })
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'CLAUDE.MD',
          content:
            '<!-- skills:start -->\n## Skills\n- `Runner Skill` Uses runner files Path: `skills/runner-skill/index.md`.\n<!-- skills:end -->',
          encoding: 'utf8',
          sizeBytes: 128,
        },
      })
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'skills/runner-skill/index.md',
          content: '# Runner Skill\nHydrated from runner\n',
          encoding: 'utf8',
          sizeBytes: 35,
        },
      });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents/agent-1/skills',
      payload: { skillId: 'skill-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.requireBackendLocalFilesystemGate).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: {
          action: 'import_agent_files',
          files: [
            {
              path: '/skills/runner-skill/index.md',
              contentBase64: Buffer.from('# Runner Skill\n').toString('base64'),
              sizeBytes: 15,
            },
          ],
        },
      }),
    );
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          action: 'write_agent_file',
          path: 'AGENTS.md',
          encoding: 'utf8',
        }),
      }),
    );
  });

  it('detaches a skill by deleting runner files and rewriting the runner instruction file', async () => {
    mocks.dispatchAgentFileRequest
      .mockResolvedValueOnce({
        result: {
          action: 'read_agent_file',
          path: 'CLAUDE.MD',
          content:
            '<!-- skills:start -->\n## Skills\n- `Runner Skill` Uses runner files Path: `skills/runner-skill/index.md`.\n<!-- skills:end -->',
          encoding: 'utf8',
          sizeBytes: 128,
        },
      })
      .mockResolvedValueOnce({ result: { action: 'delete_agent_path', deleted: true } })
      .mockResolvedValueOnce({
        result: {
          action: 'write_agent_file',
          path: 'CLAUDE.MD',
          sizeBytes: 8,
          updatedAt: '2026-05-27T00:00:01.000Z',
        },
      })
      .mockResolvedValueOnce({
        result: { action: 'list_agent_files', workspacePath: '/runner/workspace', path: 'skills', entries: [] },
      })
      .mockResolvedValueOnce({ result: { action: 'delete_agent_path', deleted: true } });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/agents/agent-1/skills/c2tpbGxzL3J1bm5lci1za2lsbA',
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.requireBackendLocalFilesystemGate).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { action: 'delete_agent_path', path: 'skills/runner-skill' },
      }),
    );
  });
});
