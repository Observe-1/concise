import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/passwords.js';

describe('passwords', () => {
  it('verifies a correct password', () => {
    const hash = hashPassword('s3cret!');
    expect(verifyPassword('s3cret!', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('s3cret!');
    expect(verifyPassword('s3cret!x', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('produces unique salts', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'bcrypt:10:aaaa:bbbb:cccc:dddd')).toBe(false);
  });
});
