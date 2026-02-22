import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './auth.js';

describe('auth service', () => {
  describe('hashPassword / verifyPassword', () => {
    it('should hash a password and verify it correctly', async () => {
      const password = 'MySecureP@ss123';
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect password', async () => {
      const hash = await hashPassword('correct-password');
      const isValid = await verifyPassword('wrong-password', hash);
      expect(isValid).toBe(false);
    });

    it('should produce different hashes for the same password', async () => {
      const password = 'SamePassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });
});
