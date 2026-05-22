import { describe, expect, it } from 'vitest';
import { validatePasswordStrength } from './password-policy.js';

describe('password-policy (backend re-export)', () => {
  it('accepts passwords that meet the shared policy without special characters', () => {
    expect(validatePasswordStrength('CorrectHorse1')).toEqual({ valid: true, errors: [] });
  });

  it('rejects common breached passwords', () => {
    const result = validatePasswordStrength('password123');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Password is too common. Please choose a stronger password');
  });
});
