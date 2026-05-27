import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnerJobIntent } from 'shared';

function pathInsideRoot(targetPath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function downloadStagedAttachment(
  item: NonNullable<RunnerJobIntent['stagingManifest']>['attachments'][number],
  targetPath: string,
  options: { serverUrl: string; credential: string },
) {
  const url = new URL(item.download.path, options.serverUrl);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${options.credential}` } });
  if (!res.ok) {
    throw new Error(`Attachment ${item.id} download failed with HTTP ${res.status}: ${await res.text()}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength !== item.sizeBytes) {
    throw new Error(`Attachment ${item.id} size mismatch after download`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes, { mode: 0o600 });
  if (item.sha256 && sha256File(targetPath) !== item.sha256) {
    fs.rmSync(targetPath, { force: true });
    throw new Error(`Attachment ${item.id} hash mismatch after download`);
  }
}

export async function materializeStagedAttachments(
  intent: RunnerJobIntent,
  options: { stagingRoot?: string; serverUrl: string; credential: string },
): Promise<RunnerJobIntent> {
  const manifest = intent.stagingManifest;
  if (!manifest || manifest.attachments.length === 0) return intent;

  const workspaceRoot = path.resolve(intent.workspace.path);
  const root = path.resolve(options.stagingRoot ?? path.join(workspaceRoot, manifest.root));
  if (!pathInsideRoot(root, workspaceRoot)) {
    throw new Error(`Attachment staging root escapes the runner job workspace: ${manifest.root}`);
  }
  const stagedAttachments = [...(intent.attachments ?? [])];
  for (const item of manifest.attachments) {
    const targetPath = path.resolve(root, item.destination);
    if (!pathInsideRoot(targetPath, root)) {
      throw new Error(`Attachment ${item.id} destination escapes the runner staging root`);
    }
    await downloadStagedAttachment(item, targetPath, options);
    const attachment = stagedAttachments[item.attachmentIndex];
    if (!attachment) throw new Error(`Attachment ${item.id} references a missing attachment index`);
    stagedAttachments[item.attachmentIndex] = {
      ...attachment,
      path: targetPath,
      textExtraction: {
        ...attachment.textExtraction,
        ...(attachment.textExtraction.status === 'available' ? { textPath: targetPath } : {}),
      },
    };
  }

  return { ...intent, attachments: stagedAttachments };
}
