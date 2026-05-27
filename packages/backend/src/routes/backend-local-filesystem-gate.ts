import type { FastifyReply } from 'fastify';
import { env } from '../config/env.js';

type BackendLocalFilesystemOperation =
  | 'host_browse'
  | 'host_picker'
  | 'host_reference'
  | 'backend_storage_reveal'
  | 'absolute_host_reveal'
  | 'agent_file_reveal'
  | 'agent_reference'
  | 'agent_skill_files'
  | 'conversation_folder_reveal'
  | 'skill_file_reveal';

const messages: Record<BackendLocalFilesystemOperation, string> = {
  host_browse:
    'Backend host filesystem browsing is unavailable in hosted mode. This route browses server-local paths, not the runner workspace. Use /api/runner-filesystem/browse for runner-local paths or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  host_picker:
    'The backend host folder picker is unavailable in hosted mode. This route opens a picker on the server machine, not the runner workspace. Use /api/runner-filesystem/pick-folder for runner-local folders or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  host_reference:
    'Backend storage references to host paths are unavailable in hosted mode. This would link backend storage to server-local paths, not runner workspace paths. Use backend storage upload/download operations or enable OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  backend_storage_reveal:
    'Backend storage file-manager reveal is unavailable in hosted mode. The file is still backend storage and can be previewed or downloaded, but opening it would reveal the backend host filesystem. Set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true only for same-host local development.',
  absolute_host_reveal:
    'Absolute backend host path reveal is unavailable in hosted mode. This route reveals server-local paths, not runner workspace paths. Use /api/runner-filesystem/reveal for runner-local paths or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  agent_file_reveal:
    'Agent file reveal through this legacy route is unavailable in hosted mode. It opens backend-local agent storage, not the runner workspace. Use /api/runner-filesystem/reveal for runner-local repository paths or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  agent_reference:
    'Agent file references to host paths are unavailable in hosted mode. This would link backend-local agent storage to server paths, not runner workspace paths. Use runner-local setup actions or enable OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  agent_skill_files:
    'Agent skill attachment through this legacy route is unavailable in hosted mode. It reads and writes agent instruction files on the backend host, not the runner workspace. Use runner-owned agent file operations or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true only for same-host local development.',
  conversation_folder_reveal:
    'Conversation folder reveal through this legacy route is unavailable in hosted mode. It opens a backend-local conversation path, not the runner workspace. Use /api/runner-filesystem/reveal for runner-local conversation folders or set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true for same-host local development.',
  skill_file_reveal:
    'Skill file reveal through this route is unavailable in hosted mode. The skill files are backend-managed storage and can be previewed or downloaded, but opening them would reveal the backend host filesystem. Set OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM=true only for same-host local development.',
};

export function requireBackendLocalFilesystemGate(
  reply: FastifyReply,
  operation: BackendLocalFilesystemOperation,
): boolean {
  if (env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM === true) return true;
  reply.status(409).send({
    code: 'backend_local_filesystem_unavailable',
    message: messages[operation],
  });
  return false;
}
