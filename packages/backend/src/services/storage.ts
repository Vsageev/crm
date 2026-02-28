import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';

const STORAGE_DIR = path.resolve(env.DATA_DIR, 'storage');

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface StorageEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  mimeType: string | null;
  createdAt: string;
}

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function normalizePath(p: string): string {
  // Ensure path starts with / and has no trailing slash (except root)
  let normalized = p.trim().replace(/\\/g, '/');
  if (!normalized) normalized = '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function resolveDiskPath(storagePath: string): string {
  return path.resolve(STORAGE_DIR, '.' + storagePath);
}

function validatePath(p: string): string {
  const normalized = normalizePath(p);
  // Prevent path traversal
  const resolved = resolveDiskPath(normalized);
  const rootPrefix = STORAGE_DIR.endsWith(path.sep) ? STORAGE_DIR : STORAGE_DIR + path.sep;
  if (resolved !== STORAGE_DIR && !resolved.startsWith(rootPrefix)) {
    throw new Error('Path traversal detected');
  }
  return normalized;
}

function inferMimeType(fileName: string): string | null {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[ext] ?? null;
}

function buildEntryFromDisk(diskPath: string, name: string): StorageEntry | null {
  const stats = fs.statSync(diskPath);
  const isFile = stats.isFile();
  const isFolder = stats.isDirectory();

  if (!isFile && !isFolder) return null;

  const relative = path.relative(STORAGE_DIR, diskPath).split(path.sep).join('/');
  const entryPath = normalizePath('/' + relative);
  const createdAtSource =
    Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;

  return {
    name,
    path: entryPath,
    type: isFile ? 'file' : 'folder',
    size: isFile ? stats.size : 0,
    mimeType: isFile ? inferMimeType(name) : null,
    createdAt: createdAtSource.toISOString(),
  };
}

export function listDir(dirPath: string): StorageEntry[] {
  ensureStorageDir();
  const normalized = validatePath(dirPath);
  const diskDir = resolveDiskPath(normalized);

  if (!fs.existsSync(diskDir)) {
    return [];
  }

  const stats = fs.statSync(diskDir);
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  return fs
    .readdirSync(diskDir, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isFile() && !entry.isDirectory()) return null;
      return buildEntryFromDisk(path.join(diskDir, entry.name), entry.name);
    })
    .filter((entry): entry is StorageEntry => entry !== null);
}

export function createFolder(dirPath: string, name: string): StorageEntry {
  ensureStorageDir();
  const parentPath = validatePath(dirPath);

  // Sanitize folder name
  const safeName = name.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!safeName) throw new Error('Invalid folder name');

  const fullPath = parentPath === '/' ? '/' + safeName : parentPath + '/' + safeName;
  validatePath(fullPath);

  // Create on disk
  const diskPath = resolveDiskPath(fullPath);
  if (fs.existsSync(diskPath)) {
    throw new Error('A file or folder with this name already exists');
  }
  fs.mkdirSync(diskPath, { recursive: true });

  const entry = buildEntryFromDisk(diskPath, safeName);
  if (!entry || entry.type !== 'folder') {
    throw new Error('Failed to create folder');
  }

  return entry;
}

export async function uploadFile(
  dirPath: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): Promise<StorageEntry> {
  ensureStorageDir();
  const parentPath = validatePath(dirPath);

  const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!safeName) throw new Error('Invalid file name');

  const fullPath = parentPath === '/' ? '/' + safeName : parentPath + '/' + safeName;
  validatePath(fullPath);

  // Ensure parent dir on disk
  const diskPath = resolveDiskPath(fullPath);
  const diskDir = path.dirname(diskPath);
  if (!fs.existsSync(diskDir)) {
    fs.mkdirSync(diskDir, { recursive: true });
  }

  fs.writeFileSync(diskPath, buffer);

  const entry = buildEntryFromDisk(diskPath, safeName);
  if (!entry || entry.type !== 'file') {
    throw new Error('Failed to upload file');
  }
  entry.mimeType = mimeType || entry.mimeType;
  entry.size = buffer.length;

  return entry;
}

export function deleteItem(itemPath: string): boolean {
  const normalized = validatePath(itemPath);
  if (normalized === '/') return false;

  // Remove from disk
  const diskPath = resolveDiskPath(normalized);
  if (!fs.existsSync(diskPath)) return false;
  fs.rmSync(diskPath, { recursive: true, force: true });

  return true;
}

export function getFilePath(filePath: string): string | null {
  const normalized = validatePath(filePath);
  const diskPath = resolveDiskPath(normalized);
  if (!fs.existsSync(diskPath)) return null;
  const stats = fs.statSync(diskPath);
  if (!stats.isFile()) return null;

  return diskPath;
}

function collectStats(dirPath: string): { totalFiles: number; totalFolders: number; totalSize: number } {
  let totalFiles = 0;
  let totalFolders = 0;
  let totalSize = 0;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      totalFiles++;
      totalSize += fs.statSync(fullPath).size;
      continue;
    }
    if (entry.isDirectory()) {
      totalFolders++;
      const nested = collectStats(fullPath);
      totalFiles += nested.totalFiles;
      totalFolders += nested.totalFolders;
      totalSize += nested.totalSize;
    }
  }

  return { totalFiles, totalFolders, totalSize };
}

export function getStats(): { totalFiles: number; totalFolders: number; totalSize: number } {
  ensureStorageDir();
  return collectStats(STORAGE_DIR);
}
