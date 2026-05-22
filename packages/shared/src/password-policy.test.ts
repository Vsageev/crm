import { describe, expect, it } from 'vitest';
import {
  PASSWORD_POLICY_SUMMARY,
  PASSWORD_REQUIREMENTS,
  getPasswordRequirementChecks,
  validatePasswordStrength,
} from './password-policy.js';

describe('password policy', () => {
  it('documents requirements without a special character rule', () => {
    expect(PASSWORD_POLICY_SUMMARY.toLowerCase()).not.toContain('special');
    expect(PASSWORD_REQUIREMENTS.map((r) => r.label)).toEqual([
      'At least 8 characters',
      'One uppercase letter',
      'One lowercase letter',
      'One number',
    ]);
  });

  it.each([
    'CorrectHorse1',
    'MySecret99',
  ])('accepts a strong password: %s', (password) => {
    expect(validatePasswordStrength(password)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    { password: 'short1A', error: 'at least 8 characters' },
    { password: 'alllowercase1', error: 'uppercase' },
    { password: 'ALLUPPERCASE1', error: 'lowercase' },
    { password: 'NoDigitsHere', error: 'digit' },
    { password: 'password123', error: 'too common' },
  ])('rejects $password', ({ password, error }) => {
    const result = validatePasswordStrength(password);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ').toLowerCase()).toContain(error);
  });

  it('tracks requirement checklist state for register UI', () => {
    expect(getPasswordRequirementChecks('Ab1')).toEqual([
      { id: 'length', label: 'At least 8 characters', met: false },
      { id: 'uppercase', label: 'One uppercase letter', met: true },
      { id: 'lowercase', label: 'One lowercase letter', met: true },
      { id: 'digit', label: 'One number', met: true },
    ]);

    expect(getPasswordRequirementChecks('CorrectHorse1')).toEqual([
      { id: 'length', label: 'At least 8 characters', met: true },
      { id: 'uppercase', label: 'One uppercase letter', met: true },
      { id: 'lowercase', label: 'One lowercase letter', met: true },
      { id: 'digit', label: 'One number', met: true },
    ]);
  });
});
