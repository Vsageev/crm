/**
 * Password policy enforcement (OWASP recommendation).
 *
 * Rules:
 * - Minimum 8 characters
 * - Maximum 128 characters (bcrypt limit safety)
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - Not a commonly-breached password
 */

const COMMON_PASSWORDS = new Set([
  'password',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'password1',
  'iloveyou',
  'admin123',
  'welcome1',
  'monkey123',
  'dragon123',
  'master123',
  'letmein12',
  'abc12345',
  'password123',
  'admin1234',
  'changeme',
  'trustno1',
  'baseball1',
  'shadow123',
]);

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a stronger password');
  }

  return { valid: errors.length === 0, errors };
}
