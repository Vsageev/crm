/**
 * File upload validation (OWASP Unrestricted File Upload).
 *
 * Allowlist of safe MIME types for CRM media uploads.
 * Blocks executable content that could be used for attacks.
 */

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',

  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',

  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',

  // Audio / voice
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/mp4',

  // Archives (common for document sharing)
  'application/zip',
  'application/x-rar-compressed',
  'application/gzip',
]);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
  '.sh', '.bash', '.csh', '.ksh',
  '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh',
  '.dll', '.so', '.dylib',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.asp', '.aspx', '.jsp', '.cgi',
  '.py', '.pyc', '.pyo',
  '.rb', '.pl',
  '.htaccess', '.htpasswd',
]);

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateUploadedFile(
  mimeType: string,
  filename: string,
): FileValidationResult {
  // Check MIME type against allowlist
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `File type "${mimeType}" is not allowed`,
    };
  }

  // Check file extension against blocklist
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File extension "${ext}" is not allowed`,
    };
  }

  // Block double extensions (e.g., "file.php.jpg")
  const parts = filename.toLowerCase().split('.');
  if (parts.length > 2) {
    for (let i = 1; i < parts.length - 1; i++) {
      if (BLOCKED_EXTENSIONS.has(`.${parts[i]}`)) {
        return {
          valid: false,
          error: 'File contains a suspicious double extension',
        };
      }
    }
  }

  return { valid: true };
}
