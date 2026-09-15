import { describe, it, expect } from 'vitest';
import { validateAndLoadConfig, FatalConfigError } from '../../src/config/env.js';

describe('Config: Environment Validation & Fail-Closed Behavior', () => {
  const strongSessionSecret = 'c7e5a1b38f9024d678e91024bcdaef1234567890abcdef1234567890abcdef';
  const strongDownloadSecret = '890abcdef1234567890abcdef1234567890c7e5a1b38f9024d678e91024bcdaef';

  it('loads valid development configuration with secure defaults', () => {
    const config = validateAndLoadConfig({
      NODE_ENV: 'development'
    });

    expect(config.nodeEnv).toBe('development');
    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.auth.sessionSecret).toBeDefined();
    expect(config.auth.sessionSecret.length).toBeGreaterThanOrEqual(32);
    expect(config.auth.downloadTokenSecret).toBeDefined();
  });

  it('fails closed in production if SESSION_SECRET is missing', () => {
    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        DOWNLOAD_TOKEN_SECRET: strongDownloadSecret
      })
    ).toThrow(FatalConfigError);

    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        DOWNLOAD_TOKEN_SECRET: strongDownloadSecret
      })
    ).toThrow('SESSION_SECRET must be explicitly set');
  });

  it('fails closed in production if SESSION_SECRET is shorter than 32 characters', () => {
    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'short_secret_only_24_chars!',
        DOWNLOAD_TOKEN_SECRET: strongDownloadSecret
      })
    ).toThrow('at least 32 characters in production');
  });

  it('fails closed in production if SESSION_SECRET uses development defaults', () => {
    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'dev_session_secret_min_32_characters_long_desk',
        DOWNLOAD_TOKEN_SECRET: strongDownloadSecret
      })
    ).toThrow('Default development SESSION_SECRET cannot be used in production');
  });

  it('fails closed in production if DOWNLOAD_TOKEN_SECRET is missing or weak', () => {
    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: strongSessionSecret
      })
    ).toThrow('DOWNLOAD_TOKEN_SECRET (or TOKEN_SIGNING_KEY) must be explicitly set');

    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: strongSessionSecret,
        DOWNLOAD_TOKEN_SECRET: 'too_short'
      })
    ).toThrow('at least 32 characters in production');

    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: strongSessionSecret,
        DOWNLOAD_TOKEN_SECRET: 'dev_download_token_secret_32_bytes_min'
      })
    ).toThrow('Default development DOWNLOAD_TOKEN_SECRET cannot be used in production');
  });

  it('succeeds in production when all secrets are strong and non-default', () => {
    const config = validateAndLoadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: strongSessionSecret,
      DOWNLOAD_TOKEN_SECRET: strongDownloadSecret
    });

    expect(config.nodeEnv).toBe('production');
    expect(config.auth.sessionSecret).toBe(strongSessionSecret);
    expect(config.auth.downloadTokenSecret).toBe(strongDownloadSecret);
  });

  it('rejects invalid PORT and invalid NODE_ENV via schema validation', () => {
    expect(() =>
      validateAndLoadConfig({
        PORT: '-5'
      })
    ).toThrow(FatalConfigError);

    expect(() =>
      validateAndLoadConfig({
        NODE_ENV: 'staging' as any
      })
    ).toThrow(FatalConfigError);
  });
});
