import crypto from 'crypto';
import { getConfig } from '../../config/env.js';

/**
 * TokenEncryption
 * Provides AES-256-GCM authenticated encryption for provider OAuth access & refresh tokens at rest.
 * Ensures zero plaintext tokens reside in SQLite or memory dumps.
 */
export class TokenEncryption {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // 96-bit recommended for GCM
  private static readonly TAG_LENGTH = 16; // 128-bit auth tag

  /**
   * Derives a deterministic 32-byte key from configuration or environment
   */
  private static getEncryptionKey(): Buffer {
    const rawKey = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || getConfig().auth.sessionSecret;
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * Encrypts plaintext token to a serialized `iv:authTag:ciphertext` hex string
   */
  public static encrypt(plainText: string): string {
    if (!plainText) {
      throw new Error('TOKEN_ENCRYPTION_ERROR: Plaintext cannot be empty');
    }

    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv, { authTagLength: this.TAG_LENGTH });

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts a serialized `iv:authTag:ciphertext` hex string back to plaintext
   */
  public static decrypt(encryptedBundle: string): string {
    if (!encryptedBundle || !encryptedBundle.includes(':')) {
      throw new Error('TOKEN_DECRYPTION_ERROR: Malformed encrypted token bundle');
    }

    const parts = encryptedBundle.split(':');
    if (parts.length !== 3) {
      throw new Error('TOKEN_DECRYPTION_ERROR: Invalid bundle format, expected iv:tag:ciphertext');
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const key = this.getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv, { authTagLength: this.TAG_LENGTH });
    decipher.setAuthTag(authTag);

    try {
      let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err: any) {
      throw new Error(`TOKEN_DECRYPTION_ERROR: Authentication tag verification failed: ${err.message}`);
    }
  }

  /**
   * Redacts sensitive token strings from objects/logs
   */
  public static sanitize<T extends Record<string, any>>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;
    const copy: any = Array.isArray(obj) ? [...obj] : { ...obj };

    const sensitiveFields = [
      'access_token',
      'refresh_token',
      'encrypted_access_token',
      'encrypted_refresh_token',
      'token',
      'secret',
      'client_secret'
    ];

    for (const key of Object.keys(copy)) {
      if (sensitiveFields.includes(key.toLowerCase())) {
        copy[key] = '[REDACTED]';
      } else if (typeof copy[key] === 'object' && copy[key] !== null) {
        copy[key] = this.sanitize(copy[key]);
      }
    }

    return copy;
  }
}
