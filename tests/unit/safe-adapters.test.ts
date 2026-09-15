import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import { ManualSignalAdapter } from '../../src/services/monitoring/adapters/manual-signal-adapter.js';
import { FileReplaySignalAdapter } from '../../src/services/monitoring/adapters/file-replay-adapter.js';
import { WebhookSignalAdapter } from '../../src/services/monitoring/adapters/webhook-signal-adapter.js';
import { LocalFixtureAdapter } from '../../src/services/monitoring/adapters/local-fixture-adapter.js';

describe('Unit: Safe Monitoring Adapters', () => {
  it('ManualSignalAdapter processes and normalizes analyst submissions with provenance', async () => {
    const adapter = new ManualSignalAdapter();
    expect(adapter.isSafeReadOnly).toBe(true);

    const results = await adapter.processInput(
      [{ observed_url: 'https://instagram.com/fake_profile/?utm_source=ad' }],
      { actorUserId: 'usr_analyst_01', notes: 'Reported by internal counsel' }
    );

    expect(results).toHaveLength(1);
    expect(results[0].observed_url).toBe('https://instagram.com/fake_profile/?utm_source=ad');
    expect(results[0].platform).toBe('instagram');
    expect(results[0].source_type).toBe('manual_input');
    expect(results[0].provenance.submitted_by_user_id).toBe('usr_analyst_01');
  });

  it('FileReplaySignalAdapter replays JSON fixtures and prevents path traversal', async () => {
    const adapter = new FileReplaySignalAdapter();
    expect(adapter.isSafeReadOnly).toBe(true);

    const fixturePath = path.resolve(process.cwd(), 'seeds/monitoring-fixtures.json');
    const signals = await adapter.replayFile(fixturePath, {
      allowedDir: process.cwd()
    });

    expect(signals.length).toBeGreaterThanOrEqual(5);
    expect(signals[0].source_type).toBe('file_replay');

    // Attempt path traversal outside allowed directory
    await expect(
      adapter.replayFile('C:\\Windows\\System32\\drivers\\etc\\hosts', {
        allowedDir: path.resolve(process.cwd(), 'seeds')
      })
    ).rejects.toThrow(/SECURITY_VIOLATION/);
  });

  it('WebhookSignalAdapter validates HMAC SHA-256 signatures and rejects spoofed requests', async () => {
    const adapter = new WebhookSignalAdapter();
    expect(adapter.isSafeReadOnly).toBe(true);

    const secret = 'super-secret-pilot-key-123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ event: 'candidate_observed', url: 'https://x.com/fake_exec' });

    // Generate valid HMAC
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${timestamp}.${rawBody}`);
    const validSig = `sha256=${hmac.digest('hex')}`;

    const isValid = adapter.verifySignature({
      secret,
      signatureHeader: validSig,
      timestampHeader: timestamp,
      rawBody
    });
    expect(isValid).toBe(true);

    // Reject forged signature
    const isForged = adapter.verifySignature({
      secret,
      signatureHeader: 'sha256=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad',
      timestampHeader: timestamp,
      rawBody
    });
    expect(isForged).toBe(false);

    // Reject expired timestamp (> 300s drift)
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const hmacOld = crypto.createHmac('sha256', secret);
    hmacOld.update(`${oldTimestamp}.${rawBody}`);
    const oldSig = `sha256=${hmacOld.digest('hex')}`;

    const isExpired = adapter.verifySignature({
      secret,
      signatureHeader: oldSig,
      timestampHeader: oldTimestamp,
      rawBody,
      maxClockDriftSeconds: 300
    });
    expect(isExpired).toBe(false);
  });

  it('LocalFixtureAdapter loads deterministic fixtures with simulation flags', async () => {
    const adapter = new LocalFixtureAdapter();
    expect(adapter.isSafeReadOnly).toBe(true);

    const fixtures = adapter.loadFixtures();
    expect(fixtures.length).toBeGreaterThanOrEqual(5);

    const ingested = await adapter.processInput(fixtures);
    expect(ingested.length).toBe(fixtures.length);
    expect(ingested.every((i) => i.source_type === 'local_fixture')).toBe(true);
    expect(ingested.every((i) => i.provenance.is_simulation === true)).toBe(true);
  });
});
