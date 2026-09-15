import fs from 'fs';
import path from 'path';
import {
  SignalAdapter,
  RawSignalInput,
  IngestedSignalRaw
} from './adapter-interface.js';
import { UrlNormalizationService } from '../url-normalization-service.js';

export class LocalFixtureAdapter implements SignalAdapter {
  public readonly name = 'local_fixture';
  public readonly adapterType = 'local_fixture';
  public readonly isSafeReadOnly = true;

  private normalizer = new UrlNormalizationService();

  /**
   * Loads signals from seeds/monitoring-fixtures.json or fallback synthetic fixture list
   */
  public loadFixtures(customFixturePath?: string): RawSignalInput[] {
    const defaultPath = path.resolve(process.cwd(), 'seeds/monitoring-fixtures.json');
    const targetPath = customFixturePath ? path.resolve(customFixturePath) : defaultPath;

    if (fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (parsed.signals || []);
      } catch {
        // Fallback to built-in simulation fixtures
      }
    }

    return this.getBuiltInFixtures();
  }

  public getBuiltInFixtures(): RawSignalInput[] {
    return [
      {
        observed_url: 'https://www.instagram.com/fake_dr_sharma_official/?utm_source=ad',
        platform: 'instagram',
        content_type: 'profile',
        raw_payload: {
          bio: 'Official consultations and herbal remedies by Dr. Ramesh Sharma. DM for cures.',
          display_name: 'Dr. Ramesh Sharma Official',
          handle: 'fake_dr_sharma_official',
          follower_count: 1420
        },
        provenance: { fixture_type: 'synthetic_doctor_impersonation' }
      },
      {
        observed_url: 'https://twitter.com/ceo_apex_real/status/192837465?ref=feed',
        platform: 'twitter',
        content_type: 'post',
        raw_payload: {
          tweet_text: 'Exciting news! We are giving away 500% crypto returns to our loyal investors. Visit bit.ly/apex-scam',
          handle: 'ceo_apex_real',
          display_name: 'Vikram Malhotra [CEO Apex]'
        },
        provenance: { fixture_type: 'synthetic_crypto_scam_tweet' }
      },
      {
        observed_url: 'https://youtube.com/watch?v=mockDeepfakeVideo123&feature=share',
        platform: 'youtube',
        content_type: 'video',
        raw_payload: {
          title: 'Deepfake AI Endorsement - Mira Kapoor reveals secret diet pill',
          channel_name: 'QuickMiracleHealth',
          description: 'Watch Mira Kapoor endorse this miraculous weight loss pill!'
        },
        provenance: { fixture_type: 'synthetic_deepfake_video' }
      },
      {
        observed_url: 'https://www.apex-investments-portal.net/login?token=phish',
        platform: 'domain',
        content_type: 'domain',
        raw_payload: {
          title: 'Apex Financial Portal Login',
          registrar: 'Mock Registrar LLC',
          domain_created: '2026-09-01'
        },
        provenance: { fixture_type: 'synthetic_lookalike_domain' }
      },
      {
        observed_url: 'https://instagram.com/dr_sharma_parody_memes/',
        platform: 'instagram',
        content_type: 'profile',
        raw_payload: {
          bio: 'Fan and parody account making medical humor memes. Not affiliated with Dr. Ramesh Sharma.',
          display_name: 'Dr Sharma Parody & Satire',
          handle: 'dr_sharma_parody_memes'
        },
        provenance: { fixture_type: 'synthetic_parody_satire' }
      }
    ];
  }

  async processInput(
    rawInputs: RawSignalInput[],
    context?: Record<string, any>
  ): Promise<IngestedSignalRaw[]> {
    const results: IngestedSignalRaw[] = [];

    for (const input of rawInputs) {
      if (!input.observed_url || !input.observed_url.trim()) {
        continue;
      }
      const norm = this.normalizer.normalize(input.observed_url);

      results.push({
        observed_url: input.observed_url.trim(),
        platform: input.platform || norm.platform,
        content_type: input.content_type || 'profile',
        observed_at: input.observed_at || new Date().toISOString(),
        raw_payload: input.raw_payload || {},
        provenance: {
          intake_method: 'local_fixture',
          is_simulation: true,
          ...context,
          ...input.provenance
        },
        source_type: 'local_fixture',
        adapter_name: this.name
      });
    }

    return results;
  }
}
