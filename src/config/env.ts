import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

export class FatalConfigError extends Error {
  constructor(message: string) {
    super(`[FATAL CONFIGURATION ERROR] ${message}`);
    this.name = 'FatalConfigError';
  }
}

const parseBooleanEnv = (defaultValue: boolean) =>
  z.preprocess((val) => {
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
    }
    if (typeof val === 'boolean') return val;
    return defaultValue;
  }, z.boolean().default(defaultValue));

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'pilot', 'staging', 'production']).default('development'),
  APP_URL: z.string().default('http://localhost:4000'),
  DATABASE_PATH: z.string().default('./data/response_desk.sqlite'),
  EVIDENCE_STORAGE_DIR: z.string().default('./storage/evidence'),
  EVIDENCE_TEMP_DIR: z.string().default('./storage/temp'),
  BACKUP_STORAGE_DIR: z.string().default('./storage/backups'),
  DEFAULT_EVIDENCE_RETIDENTIAL_DAYS: z.coerce.number().int().positive().default(180).optional(),
  DEFAULT_EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(50),
  SESSION_SECRET: z.string().optional(),
  DOWNLOAD_TOKEN_SECRET: z.string().optional(),
  TOKEN_SIGNING_KEY: z.string().optional(),
  ENCRYPTION_MASTER_KEY: z.string().optional(),
  INTEGRATION_TOKEN_KEY: z.string().optional(),
  ENCRYPTION_FALLBACK_KEYS: z.string().optional(),
  STORAGE_BACKEND: z.enum(['local', 'managed_s3']).default('local'),
  S3_BUCKET_NAME: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_KMS_KEY_ID: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  RATE_LIMIT_ENABLED: parseBooleanEnv(true),
  WORKER_RETENTION_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WORKER_CLOCK_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WORKER_NOTIFICATION_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
  WORKER_USAGE_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WORKER_BACKUP_VERIFY_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  WORKER_MONITORING_INGESTION_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  WORKER_CANDIDATE_EVALUATION_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  NOTIFICATION_MODE: z.enum(['in_app', 'console', 'file', 'dry_run']).default('in_app'),
  BILLING_MODE: z.enum(['dry_run', 'disabled']).default('dry_run'),
  PILOT_MODE: parseBooleanEnv(true),
  ENABLE_LIVE_PLATFORM_ACTIONS: parseBooleanEnv(false),
  ENABLE_LIVE_BILLING: parseBooleanEnv(false),
  ENABLE_LIVE_NOTIFICATIONS: parseBooleanEnv(false)
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'test' | 'pilot' | 'staging' | 'production';
  appUrl: string;
  databasePath: string;
  storage: {
    backend: 'local' | 'managed_s3';
    evidenceDir: string;
    tempDir: string;
    backupDir: string;
    maxUploadSizeMb: number;
    s3?: {
      bucketName?: string;
      region: string;
      endpoint?: string;
      kmsKeyId?: string;
    };
  };
  retention: {
    defaultDays: number;
    auditDays: number;
  };
  auth: {
    sessionSecret: string;
    downloadTokenSecret: string;
  };
  security: {
    encryptionMasterKey: string;
    encryptionFallbackKeys: string[];
    corsAllowedOrigins?: string;
    rateLimitEnabled: boolean;
  };
  workers: {
    retentionIntervalMs: number;
    clockIntervalMs: number;
    notificationIntervalMs: number;
    usageIntervalMs: number;
    backupVerifyIntervalMs: number;
    monitoringIngestionIntervalMs: number;
    candidateEvaluationIntervalMs: number;
  };
  modes: {
    notificationMode: 'in_app' | 'console' | 'file' | 'dry_run';
    billingMode: 'dry_run' | 'disabled';
    pilotMode: boolean;
    enableLivePlatformActions: boolean;
    enableLiveBilling: boolean;
    enableLiveNotifications: boolean;
  };
}

export function validateAndLoadConfig(rawEnv: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new FatalConfigError(`Environment configuration invalid: ${errorMsg}`);
  }

  const env = parsed.data;
  const isStrictEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';

  // Strict safety invariant assertions
  if (env.ENABLE_LIVE_PLATFORM_ACTIONS) {
    throw new FatalConfigError('ENABLE_LIVE_PLATFORM_ACTIONS cannot be true during safe production operations.');
  }
  if (env.ENABLE_LIVE_BILLING) {
    throw new FatalConfigError('ENABLE_LIVE_BILLING cannot be true during controlled pilot operations.');
  }
  if (env.ENABLE_LIVE_NOTIFICATIONS) {
    throw new FatalConfigError('ENABLE_LIVE_NOTIFICATIONS cannot be true during controlled pilot operations.');
  }

  const sessionSecret = env.SESSION_SECRET || (isStrictEnv ? '' : 'dev_session_secret_min_32_characters_long_desk');
  const downloadTokenSecret =
    env.DOWNLOAD_TOKEN_SECRET ||
    env.TOKEN_SIGNING_KEY ||
    (isStrictEnv ? '' : 'dev_download_token_secret_32_bytes_min');

  if (isStrictEnv) {
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      throw new FatalConfigError(
        'SESSION_SECRET must be explicitly set and be at least 32 characters in production/staging.'
      );
    }
    if (env.SESSION_SECRET.startsWith('dev_') || env.SESSION_SECRET.startsWith('test_') || env.SESSION_SECRET.includes('default')) {
      throw new FatalConfigError('Default development SESSION_SECRET cannot be used in production/staging.');
    }

    const effectiveDownloadSecret = env.DOWNLOAD_TOKEN_SECRET || env.TOKEN_SIGNING_KEY;
    if (!effectiveDownloadSecret || effectiveDownloadSecret.length < 32) {
      throw new FatalConfigError(
        'DOWNLOAD_TOKEN_SECRET (or TOKEN_SIGNING_KEY) must be explicitly set and be at least 32 characters in production/staging.'
      );
    }
    if (effectiveDownloadSecret.startsWith('dev_') || effectiveDownloadSecret.startsWith('test_') || effectiveDownloadSecret.includes('default')) {
      throw new FatalConfigError(
        'Default development DOWNLOAD_TOKEN_SECRET cannot be used in production/staging.'
      );
    }

    const masterKey = env.ENCRYPTION_MASTER_KEY || env.INTEGRATION_TOKEN_KEY;
    if (masterKey) {
      if (masterKey.length < 32) {
        throw new FatalConfigError(
          'ENCRYPTION_MASTER_KEY (or INTEGRATION_TOKEN_KEY) must be at least 32 characters in production/staging.'
        );
      }
      if (masterKey.startsWith('dev_') || masterKey.startsWith('test_') || masterKey.includes('default')) {
        throw new FatalConfigError(
          'Default development ENCRYPTION_MASTER_KEY cannot be used in production/staging.'
        );
      }
    }
  }

  const encryptionMasterKey =
    env.ENCRYPTION_MASTER_KEY ||
    env.INTEGRATION_TOKEN_KEY ||
    (isStrictEnv ? '' : 'dev_master_encryption_key_32_bytes_min_desk_key');

  const encryptionFallbackKeys = env.ENCRYPTION_FALLBACK_KEYS
    ? env.ENCRYPTION_FALLBACK_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  return {
    port: env.PORT,
    host: env.HOST,
    nodeEnv: env.NODE_ENV,
    appUrl: env.APP_URL,
    databasePath: env.DATABASE_PATH,
    storage: {
      backend: env.STORAGE_BACKEND,
      evidenceDir: env.EVIDENCE_STORAGE_DIR,
      tempDir: env.EVIDENCE_TEMP_DIR,
      backupDir: env.BACKUP_STORAGE_DIR,
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
      s3: {
        bucketName: env.S3_BUCKET_NAME,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        kmsKeyId: env.S3_KMS_KEY_ID
      }
    },
    retention: {
      defaultDays: env.DEFAULT_EVIDENCE_RETENTION_DAYS,
      auditDays: env.AUDIT_RETENTION_DAYS
    },
    auth: {
      sessionSecret,
      downloadTokenSecret
    },
    security: {
      encryptionMasterKey,
      encryptionFallbackKeys,
      corsAllowedOrigins: env.CORS_ALLOWED_ORIGINS,
      rateLimitEnabled: env.RATE_LIMIT_ENABLED
    },
    workers: {
      retentionIntervalMs: env.WORKER_RETENTION_INTERVAL_MS,
      clockIntervalMs: env.WORKER_CLOCK_INTERVAL_MS,
      notificationIntervalMs: env.WORKER_NOTIFICATION_INTERVAL_MS,
      usageIntervalMs: env.WORKER_USAGE_INTERVAL_MS,
      backupVerifyIntervalMs: env.WORKER_BACKUP_VERIFY_INTERVAL_MS,
      monitoringIngestionIntervalMs: env.WORKER_MONITORING_INGESTION_INTERVAL_MS,
      candidateEvaluationIntervalMs: env.WORKER_CANDIDATE_EVALUATION_INTERVAL_MS
    },
    modes: {
      notificationMode: env.NOTIFICATION_MODE,
      billingMode: env.BILLING_MODE,
      pilotMode: env.PILOT_MODE,
      enableLivePlatformActions: false,
      enableLiveBilling: false,
      enableLiveNotifications: false
    }
  };
}

let activeConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!activeConfig) {
    activeConfig = validateAndLoadConfig(process.env);
  }
  return activeConfig;
}

export function setConfig(config: AppConfig | null): void {
  activeConfig = config;
}
