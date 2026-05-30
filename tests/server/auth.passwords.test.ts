import { describe, expect, it } from 'vitest';
import {
  generateTemporaryPassword,
  hashPassword,
  validateReplacementPassword,
  verifyPassword
} from '../../src/server/auth/passwords.js';

describe('auth password helpers', () => {
  it('generates high-entropy temporary passwords without whitespace', () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();

    expect(first).toHaveLength(24);
    expect(second).toHaveLength(24);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes and verifies passwords without storing plaintext', () => {
    const hash = hashPassword('Correct Horse Battery 42!');

    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain('Correct Horse Battery 42!');
    expect(verifyPassword('Correct Horse Battery 42!', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('rejects unsupported and malformed hash strings safely', () => {
    const fullLengthKey = Buffer.alloc(64, 1).toString('base64url');

    expect(verifyPassword('password', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('anything', 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$')).toBe(false);
    expect(verifyPassword('password', `scrypt$16384$8$1$$${fullLengthKey}`)).toBe(false);
    expect(verifyPassword('password', 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AA')).toBe(false);
    expect(verifyPassword('password', 'scrypt$NaN$8$1$salt$key')).toBe(false);
  });

  it('validates replacement password strength', () => {
    expect(validateReplacementPassword('short')).toEqual({
      valid: false,
      error: 'Password must be at least 12 characters.'
    });
    expect(validateReplacementPassword('abcdefghijkl')).toEqual({
      valid: false,
      error: 'Password must include at least one letter and one number.'
    });
    expect(validateReplacementPassword('123456789012')).toEqual({
      valid: false,
      error: 'Password must include at least one letter and one number.'
    });
    expect(validateReplacementPassword('abc123456789')).toEqual({ valid: true });
  });
});
