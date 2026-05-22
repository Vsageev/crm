import { describe, expect, it } from 'vitest';
import { validatePasswordStrength } from 'shared';
import {
  getPasswordRequirementChecks,
  getRegisterPasswordFieldError,
} from './register-password-validation';

describe('register password validation', () => {
  it('lists policy requirements without a special character rule', () => {
    expect(getPasswordRequirementChecks('').map((req) => req.label)).toEqual([
      'At least 8 characters',
      'One uppercase letter',
      'One lowercase letter',
      'One number',
    ]);
  });

  it('blocks weak passwords before submit', () => {
    expect(getRegisterPasswordFieldError('short1A')).toMatch(/at least 8 characters/i);
    expect(getRegisterPasswordFieldError('CorrectHorse1')).toBeUndefined();
  });

  it('rejects common breached passwords', () => {
    const result = validatePasswordStrength('password123');
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });
});
