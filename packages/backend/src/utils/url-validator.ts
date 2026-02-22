/**
 * URL validation for SSRF prevention (OWASP A10:2021).
 *
 * Blocks internal/private network URLs from being used as webhook targets
 * to prevent Server-Side Request Forgery attacks.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
]);

const PRIVATE_IP_PREFIXES = [
  '10.',       // 10.0.0.0/8
  '172.16.',   // 172.16.0.0/12
  '172.17.',
  '172.18.',
  '172.19.',
  '172.20.',
  '172.21.',
  '172.22.',
  '172.23.',
  '172.24.',
  '172.25.',
  '172.26.',
  '172.27.',
  '172.28.',
  '172.29.',
  '172.30.',
  '172.31.',
  '192.168.', // 192.168.0.0/16
  '169.254.', // Link-local
  'fc',       // IPv6 ULA
  'fd',
  'fe80:',    // IPv6 link-local
];

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
}

export function validateWebhookUrl(urlString: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Must be HTTPS in production
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: 'URL must not point to a local or internal address' };
  }

  // Block private IP ranges
  for (const prefix of PRIVATE_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return { valid: false, error: 'URL must not point to a private network address' };
    }
  }

  // Block URLs with credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URL must not contain embedded credentials' };
  }

  // Block non-standard ports for common internal services
  if (parsed.port && ['6379', '5432', '3306', '27017', '9200', '11211'].includes(parsed.port)) {
    return { valid: false, error: 'URL points to a known internal service port' };
  }

  return { valid: true };
}
