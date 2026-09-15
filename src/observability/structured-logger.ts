import { Logger, LogMeta } from '../utils/logger.js';

const EXTENDED_SENSITIVE_KEYS = new Set([
  'encrypted_access_token',
  'encrypted_refresh_token',
  'authtag',
  'auth_tag',
  'iv',
  'ciphertext',
  'secret_hash',
  'hub_secret',
  'private_key',
  'encryption_key',
  'key_id',
  'state_token'
]);

/**
 * Enhanced sensitive data redactor for production logging
 */
export function productionRedact(data: any, depth = 0): any {
  if (depth > 8) return '[MAX_DEPTH_EXCEEDED]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact JWT tokens
    if (/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g.test(data)) {
      return data.replace(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[JWT_REDACTED]');
    }
    // Redact Bearer tokens
    if (/bearer\s+[a-zA-Z0-9_\-\.]+/i.test(data)) {
      return data.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => productionRedact(item, depth + 1));
  }

  if (typeof data === 'object') {
    const cleanObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      const lowerKey = k.toLowerCase();
      if (
        EXTENDED_SENSITIVE_KEYS.has(lowerKey) ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('key')
      ) {
        cleanObj[k] = '[REDACTED]';
      } else {
        cleanObj[k] = productionRedact(v, depth + 1);
      }
    }
    return cleanObj;
  }

  return data;
}

export class StructuredLogger extends Logger {
  constructor(baseMeta: LogMeta = {}) {
    super(baseMeta);
  }

  public static create(context: string, meta: LogMeta = {}): StructuredLogger {
    return new StructuredLogger({ service: 'digital-impersonation-response-desk', component: context, ...meta });
  }
}

export const productionLogger = new StructuredLogger({
  service: 'digital-impersonation-response-desk',
  environment: process.env.NODE_ENV || 'development'
});
