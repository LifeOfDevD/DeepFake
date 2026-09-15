import { describe, it, expect } from 'vitest';
import { TokenEncryption } from '../../src/services/integrations/token-encryption.js';

describe('Unit: Token Encryption & Secrecy (AES-256-GCM)', () => {
  it('successfully encrypts and decrypts OAuth tokens', () => {
    const rawToken = 'ya29.a0AfH6SMD_secret_oauth_access_token_1234567890';
    const encrypted = TokenEncryption.encrypt(rawToken);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toContain(rawToken);
    expect(encrypted.split(':')).toHaveLength(3); // iv:tag:ciphertext

    const decrypted = TokenEncryption.decrypt(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('rejects tampered ciphertext with authentication tag failure', () => {
    const rawToken = 'secret_refresh_token_xyz';
    const encrypted = TokenEncryption.encrypt(rawToken);
    const [iv, tag, cipher] = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCipher = cipher.slice(0, -2) + (cipher.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedBundle = `${iv}:${tag}:${tamperedCipher}`;

    expect(() => TokenEncryption.decrypt(tamperedBundle)).toThrow(
      /Authentication tag verification failed/
    );
  });

  it('rejects tampered auth tag with authentication tag failure', () => {
    const rawToken = 'secret_refresh_token_xyz';
    const encrypted = TokenEncryption.encrypt(rawToken);
    const [iv, _tag, cipher] = encrypted.split(':');

    // Tamper with tag
    const tamperedTag = '00'.repeat(16);
    const tamperedBundle = `${iv}:${tamperedTag}:${cipher}`;

    expect(() => TokenEncryption.decrypt(tamperedBundle)).toThrow(
      /Authentication tag verification failed/
    );
  });

  it('rejects malformed bundles without colons or missing parts', () => {
    expect(() => TokenEncryption.decrypt('invalid_string')).toThrow(/Malformed encrypted token bundle/);
    expect(() => TokenEncryption.decrypt('part1:part2')).toThrow(/Invalid bundle format/);
    expect(() => TokenEncryption.encrypt('')).toThrow(/Plaintext cannot be empty/);
  });

  it('sanitizes objects and arrays to prevent accidental token leakage in logs or responses', () => {
    const payload = {
      id: 'conn_123',
      account_name: 'Dr. Rao Official',
      access_token: 'secret_live_access_token',
      refresh_token: 'secret_live_refresh_token',
      encrypted_access_token: 'iv:tag:cipher1',
      encrypted_refresh_token: 'iv:tag:cipher2',
      nested: {
        token: 'secret_jwt',
        secret: 'api_secret_key',
        safe_field: 'public_value'
      },
      list: [
        { client_secret: 'top_secret', public_id: 'pub_001' }
      ]
    };

    const sanitized = TokenEncryption.sanitize(payload);

    expect(sanitized.id).toBe('conn_123');
    expect(sanitized.account_name).toBe('Dr. Rao Official');
    expect(sanitized.access_token).toBe('[REDACTED]');
    expect(sanitized.refresh_token).toBe('[REDACTED]');
    expect(sanitized.encrypted_access_token).toBe('[REDACTED]');
    expect(sanitized.encrypted_refresh_token).toBe('[REDACTED]');
    expect(sanitized.nested.token).toBe('[REDACTED]');
    expect(sanitized.nested.secret).toBe('[REDACTED]');
    expect(sanitized.nested.safe_field).toBe('public_value');
    expect(sanitized.list[0].client_secret).toBe('[REDACTED]');
    expect(sanitized.list[0].public_id).toBe('pub_001');
  });
});
