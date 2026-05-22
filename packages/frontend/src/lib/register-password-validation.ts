import { getPasswordRequirementChecks, validatePasswordStrength } from 'shared';

export { getPasswordRequirementChecks };

export function getRegisterPasswordFieldError(password: string): string | undefined {
  const result = validatePasswordStrength(password);
  return result.valid ? undefined : result.errors[0];
}
