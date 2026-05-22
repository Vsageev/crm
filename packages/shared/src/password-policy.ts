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

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Short hint for API consumers and settings copy. */
export const PASSWORD_POLICY_SUMMARY =
  'Password must be at least 8 characters with uppercase, lowercase, and a number';

export type PasswordRequirementId = 'length' | 'uppercase' | 'lowercase' | 'digit';

export interface PasswordRequirement {
  id: PasswordRequirementId;
  label: string;
}

export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  { id: 'length', label: 'At least 8 characters' },
  { id: 'uppercase', label: 'One uppercase letter' },
  { id: 'lowercase', label: 'One lowercase letter' },
  { id: 'digit', label: 'One number' },
] as const;

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

export function isPasswordRequirementMet(id: PasswordRequirementId, password: string): boolean {
  switch (id) {
    case 'length':
      return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
    case 'uppercase':
      return /[A-Z]/.test(password);
    case 'lowercase':
      return /[a-z]/.test(password);
    case 'digit':
      return /\d/.test(password);
  }
}

export function getPasswordRequirementChecks(password: string) {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    ...requirement,
    met: isPasswordRequirementMet(requirement.id, password),
  }));
}

export function validatePasswordStrength(password: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push('Password must be at least 8 characters long');
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
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
