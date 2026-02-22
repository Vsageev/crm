import { describe, it, expect } from 'vitest';
import type { UserRole } from './index.js';

describe('Shared types', () => {
  it('should allow valid user roles', () => {
    const roles: UserRole[] = ['admin', 'manager', 'agent'];
    expect(roles).toHaveLength(3);
  });
});
