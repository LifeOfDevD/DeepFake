export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogMeta {
  requestId?: string;
  organizationId?: string;
  userId?: string;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'download_token',
  'secret',
  'session_secret',
  'token_signing_key',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'session'
]);

/**
 * Deeply redacts sensitive keys and values from logging metadata
 */
export function redactSensitiveData(obj: any, depth = 0): any {
  if (depth > 8) return '[MAX_DEPTH_EXCEEDED]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact bearer tokens or secret strings in URLs/headers
    if (/bearer\s+[a-zA-Z0-9_\-\.]+/i.test(obj)) {
      return obj.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const redacted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password') || lowerKey.includes('token')) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return redacted;
  }

  return obj;
}

export class Logger {
  private baseMeta: LogMeta;

  constructor(baseMeta: LogMeta = {}) {
    this.baseMeta = baseMeta;
  }

  public child(meta: LogMeta): Logger {
    return new Logger({ ...this.baseMeta, ...meta });
  }

  private log(level: LogLevel, message: string, meta?: LogMeta) {
    const timestamp = new Date().toISOString();
    const mergedMeta = { ...this.baseMeta, ...meta };
    const cleanMeta = redactSensitiveData(mergedMeta);

    const logPayload = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...cleanMeta
    };

    const serialized = JSON.stringify(logPayload);
    if (level === 'error') {
      console.error(serialized);
    } else if (level === 'warn') {
      console.warn(serialized);
    } else if (level === 'debug') {
      if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
        console.debug(serialized);
      }
    } else {
      console.log(serialized);
    }
  }

  public debug(message: string, meta?: LogMeta) {
    this.log('debug', message, meta);
  }

  public info(message: string, meta?: LogMeta) {
    this.log('info', message, meta);
  }

  public warn(message: string, meta?: LogMeta) {
    this.log('warn', message, meta);
  }

  public error(message: string, errorOrMeta?: Error | LogMeta, extraMeta?: LogMeta) {
    let meta: LogMeta = {};
    if (errorOrMeta instanceof Error) {
      meta = {
        error_name: errorOrMeta.name,
        error_message: errorOrMeta.message,
        error_stack: errorOrMeta.stack,
        ...extraMeta
      };
    } else if (errorOrMeta) {
      meta = { ...errorOrMeta, ...extraMeta };
    }
    this.log('error', message, meta);
  }
}

export const rootLogger = new Logger({ service: 'digital-impersonation-response-desk' });
