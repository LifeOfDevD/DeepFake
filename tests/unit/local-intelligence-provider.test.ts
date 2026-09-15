import { describe, it, expect } from 'vitest';
import { LocalDeterministicIntelligenceProvider } from '../../src/services/evaluation/intelligence-provider.js';
import { MonitoringSignal } from '../../src/domain/types.js';

describe('Unit: LocalDeterministicIntelligenceProvider', () => {
  const provider = new LocalDeterministicIntelligenceProvider();

  it('verifies provider identity and metadata', () => {
    expect(provider.providerId).toBe('local_deterministic_v1');
    expect(provider.version).toBe('1.0.0');
  });

  it('detects urgency scam keywords and elevates risk without network or external LLMs', async () => {
    const signal = {
      id: 'sig_scam_01',
      organization_id: 'org_test',
      observed_url: 'https://social.example/post/100',
      normalized_url: 'https://social.example/post/100',
      platform: 'x',
      content_type: 'social_post',
      raw_payload: {
        text: 'Join the secret cure giveaway! Urgent wire required for 500% returns guaranteed.'
      }
    } as any as MonitoringSignal;

    const analysis = await provider.analyze(signal);

    expect(analysis.provider_id).toBe('local_deterministic_v1');
    expect(analysis.confidence_bounds.lower).toBe(0.65);
    expect(analysis.confidence_bounds.upper).toBe(0.95);
    expect(analysis.feature_breakdown.matched_urgency_keywords).toContain('urgent wire');
    expect(analysis.feature_breakdown.matched_urgency_keywords).toContain('500%');
    expect(analysis.feature_breakdown.matched_urgency_keywords).toContain('secret cure');
    expect(analysis.feature_breakdown.external_model_calls).toBe(false);
    expect(analysis.feature_breakdown.biometric_processing).toBe(false);
    expect(analysis.statutory_disclaimer).toContain('exclusively via local deterministic heuristics');
  });

  it('flags Cyrillic and Unicode homoglyphs in observed URLs', async () => {
    // Cyrillic small letter 'a' (\u0430) instead of ASCII 'a'
    const homoglyphUrl = 'https://\u0430lphabank.example/portal';

    const signal = {
      id: 'sig_homoglyph_01',
      organization_id: 'org_test',
      observed_url: homoglyphUrl,
      normalized_url: homoglyphUrl,
      platform: 'domain',
      content_type: 'domain',
      raw_payload: {}
    } as any as MonitoringSignal;

    const analysis = await provider.analyze(signal);

    expect(analysis.feature_breakdown.has_unicode_homoglyphs).toBe(true);
    expect(analysis.confidence_bounds.lower).toBe(0.65);
    expect(analysis.confidence_bounds.upper).toBe(0.95);
  });

  it('detects deceptive credential phishing subdomains (-login., -verify., -kyc.)', async () => {
    const signal = {
      id: 'sig_subdomain_01',
      organization_id: 'org_test',
      observed_url: 'https://corporate-brand-login.auth-fake.example/auth',
      normalized_url: 'https://corporate-brand-login.auth-fake.example/auth',
      platform: 'domain',
      content_type: 'domain',
      raw_payload: {}
    } as any as MonitoringSignal;

    const analysis = await provider.analyze(signal);

    expect(analysis.feature_breakdown.is_deceptive_subdomain).toBe(true);
    expect(analysis.confidence_bounds.lower).toBe(0.65);
  });

  it('identifies parody and satire disclosures and discounts risk level', async () => {
    const signal = {
      id: 'sig_parody_01',
      organization_id: 'org_test',
      observed_url: 'https://social.example/satire_page',
      normalized_url: 'https://social.example/satire_page',
      platform: 'x',
      content_type: 'social_profile',
      raw_payload: {
        bio: 'This is a satirical parody fan club page. Not affiliated with the official company.'
      }
    } as any as MonitoringSignal;

    const analysis = await provider.analyze(signal);

    expect(analysis.confidence_bounds.lower).toBe(0.0);
    expect(analysis.confidence_bounds.upper).toBe(0.20);
    expect(analysis.feature_breakdown.matched_parody_keywords).toContain('parody');
    expect(analysis.feature_breakdown.matched_parody_keywords).toContain('satire');
    expect(analysis.feature_breakdown.matched_parody_keywords).toContain('fan club');
    expect(analysis.feature_breakdown.matched_parody_keywords).toContain('not affiliated');
  });
});
