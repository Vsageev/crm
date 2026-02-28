export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  createdAt: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatFileDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getFileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.xml', '.yaml', '.yml',
  '.log', '.ini', '.cfg', '.conf', '.env', '.sh', '.bash',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.html', '.htm', '.svg',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h',
  '.sql', '.graphql', '.toml', '.hbs',
]);

export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);

export function isTextPreviewable(name: string): boolean {
  return TEXT_EXTS.has(getFileExt(name));
}

export function isImagePreviewable(name: string): boolean {
  return IMAGE_EXTS.has(getFileExt(name));
}

export function isPreviewable(name: string): boolean {
  return isTextPreviewable(name) || isImagePreviewable(name);
}
