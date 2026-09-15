import crypto from 'crypto';
import Database from 'better-sqlite3';
import { getConfig } from '../config/env.js';
import { getDatabase } from '../db/connection.js';

export interface SecretProvider {
  getSecret(name: string): Promise<string | null>;
  setSecret?(name: string, value: string): Promise<void>;
}

export class EnvSecretProvider implements SecretProvider {
  public async getSecret(name: string): Promise<string | null> {
    return process.env[name] || null;
  }
}

export interface KeyRotationReport {
  connectionsProcessed: number;
  tokensReencrypted: number;
  failures: number;
  durationMs: number;
  errors: string[];
}

/**
 * Enterprise Secrets & Key Management Service
 * Provides key derivation, multi-key rotation fallback, and zero-downtime token migration.
 */
export class SecretsManager {
  private static provider: SecretProvider = new EnvSecretProvider();
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12;
  private static readonly TAG_LENGTH = 16;

  public static setProvider(provider: SecretProvider): void {
    this.provider = provider;
  }

  public static getProvider(): SecretProvider {
    return this.provider;
  }

  /**
   * Derives a 32-byte cryptographic key from a passphrase or raw secret
   */
  public static deriveKey(rawKey: string): Buffer {
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  /**
   * Returns the primary active encryption key
   */
  public static getActiveKey(): Buffer {
    const config = getConfig();
    const raw =
      process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ||
      config.security.encryptionMasterKey ||
      config.auth.sessionSecret;
    return this.deriveKey(raw);
  }

  /**
   * Returns fallback keys for historical decryption during rotation
   */
  public static getFallbackKeys(): Buffer[] {
    const config = getConfig();
    const fallbackList = config.security.encryptionFallbackKeys || [];
    const keys: Buffer[] = [];

    for (const raw of fallbackList) {
      if (raw && raw.length > 0) {
        keys.push(this.deriveKey(raw));
      }
    }

    // Also include sessionSecret as fallback if different from active key
    const sessionSecretKey = this.deriveKey(config.auth.sessionSecret);
    const activeKey = this.getActiveKey();
    if (!activeKey.equals(sessionSecretKey)) {
      keys.push(sessionSecretKey);
    }

    return keys;
  }

  /**
   * Decrypts an encrypted bundle by attempting the primary key first,
   * then progressively falling back to secondary keys if verification fails.
   */
  public static decryptBundle(bundle: string, customCandidateKeys?: Buffer[]): string {
    if (!bundle || !bundle.includes(':')) {
      throw new Error('TOKEN_DECRYPTION_ERROR: Malformed encrypted bundle');
    }

    const parts = bundle.split(':');
    if (parts.length !== 3) {
      throw new Error('TOKEN_DECRYPTION_ERROR: Invalid bundle format, expected iv:tag:ciphertext');
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');

    const candidateKeys = customCandidateKeys || [this.getActiveKey(), ...this.getFallbackKeys()];
    let lastError: any = null;

    for (const key of candidateKeys) {
      try {
        const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv, { authTagLength: this.TAG_LENGTH });
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`TOKEN_DECRYPTION_ERROR: All candidate keys failed authentication: ${lastError?.message}`);
  }

  /**
   * Encrypts plaintext under a specific key, or defaults to the primary active key
   */
  public static encryptBundle(plainText: string, keyBuffer?: Buffer): string {
    if (!plainText) {
      throw new Error('TOKEN_ENCRYPTION_ERROR: Plaintext cannot be empty');
    }

    const key = keyBuffer || this.getActiveKey();
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv, { authTagLength: this.TAG_LENGTH });

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Executes an atomic database re-encryption migration:
   * Decrypts all stored OAuth tokens with fallback keys and re-encrypts them under the new primary key.
   */
  public static reencryptAllProviderTokens(
    newMasterKey: string,
    dbInstance?: Database.Database
  ): KeyRotationReport {
    const db = dbInstance || getDatabase();
    const start = Date.now();
    const newKeyBuffer = this.deriveKey(newMasterKey);

    const rows = db.prepare(`
      SELECT id, encrypted_access_token, encrypted_refresh_token
      FROM provider_connections
      WHERE encrypted_access_token IS NOT NULL
    `).all() as { id: string; encrypted_access_token: string; encrypted_refresh_token: string | null }[];

    let tokensReencrypted = 0;
    let failures = 0;
    const errors: string[] = [];

    const tx = db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE provider_connections
        SET encrypted_access_token = ?,
            encrypted_refresh_token = ?,
            updated_at = ?
        WHERE id = ?
      `);

      for (const row of rows) {
        try {
          // Decrypt access token using fallback
          const plainAccessToken = this.decryptBundle(row.encrypted_access_token);
          const newEncAccess = this.encryptBundle(plainAccessToken, newKeyBuffer);
          tokensReencrypted++;

          let newEncRefresh: string | null = null;
          if (row.encrypted_refresh_token) {
            const plainRefresh = this.decryptBundle(row.encrypted_refresh_token);
            newEncRefresh = this.encryptBundle(plainRefresh, newKeyBuffer);
            tokensReencrypted++;
          }

          updateStmt.run(newEncAccess, newEncRefresh, new Date().toISOString(), row.id);
        } catch (err: any) {
          failures++;
          errors.push(`Failed connection ${row.id}: ${err.message}`);
        }
      }
    });

    tx();

    return {
      connectionsProcessed: rows.length,
      tokensReencrypted,
      failures,
      durationMs: Date.now() - start,
      errors
    };
  }
}
