import { MonitoringSignal, IntelligenceProvider, ProviderAnalysis } from '../../domain/types.js';

export class LocalDeterministicIntelligenceProvider implements IntelligenceProvider {
  public readonly providerId = 'local_deterministic_v1';
  public readonly version = '1.0.0';

  /**
   * Deterministically analyzes a monitoring signal using strictly local heuristics.
   * STRICT SAFETY GUARANTEE:
   * 1. 100% local in-process computation (ZERO network requests).
   * 2. Zero external LLM, cloud vision, voice recognition, or embedding model calls.
   * 3. Zero biometric identification or facial/vocal template processing.
   * 4. Media is NEVER labeled as definitively fake or unlawful.
   */
  public async analyze(signal: MonitoringSignal): Promise<ProviderAnalysis> {
    const urlLower = signal.normalized_url.toLowerCase();
    const payloadText = typeof signal.raw_payload === 'string'
      ? signal.raw_payload.toLowerCase()
      : JSON.stringify(signal.raw_payload || {}).toLowerCase();

    // 1. Homoglyph / Confusable detection
    const homoglyphRegex = /[\u0400-\u04FF]/; // Cyrillic range common in lookalike attacks
    const hasHomoglyphs = homoglyphRegex.test(signal.observed_url);

    // 2. High-urgency financial or medical scam keywords
    const urgencyKeywords = ['urgent wire', 'crypto giveaway', '500%', 'secret cure', 'dm for pills', 'guaranteed returns'];
    const matchedUrgency = urgencyKeywords.filter((k) => payloadText.includes(k) || urlLower.includes(k));

    // 3. Parody / satire disclosure detection
    const parodyKeywords = ['parody', 'satire', 'fan page', 'fan club', 'not affiliated'];
    const matchedParody = parodyKeywords.filter((k) => payloadText.includes(k) || urlLower.includes(k));

    // 4. Domain deception indicators
    const isDeceptiveSubdomain = urlLower.includes('-login.') || urlLower.includes('-verify.') || urlLower.includes('-kyc.');

    let riskLevel = 'low';
    let lowerBound = 0.05;
    let upperBound = 0.35;

    if (hasHomoglyphs || isDeceptiveSubdomain || matchedUrgency.length > 0) {
      riskLevel = 'elevated';
      lowerBound = 0.65;
      upperBound = 0.95;
    } else if (matchedParody.length > 0) {
      riskLevel = 'benign_expressive';
      lowerBound = 0.0;
      upperBound = 0.20;
    }

    const featureBreakdown = {
      has_unicode_homoglyphs: hasHomoglyphs,
      is_deceptive_subdomain: isDeceptiveSubdomain,
      matched_urgency_keywords: matchedUrgency,
      matched_parody_keywords: matchedParody,
      content_type: signal.content_type,
      platform: signal.platform,
      external_model_calls: false,
      biometric_processing: false
    };

    return {
      provider_id: this.providerId,
      provider_version: this.version,
      analysis_summary: `Deterministic local heuristic classification: risk assessment '${riskLevel}'. Found ${matchedUrgency.length} urgency cues, ${matchedParody.length} parody cues. Unicode homoglyphs: ${hasHomoglyphs}.`,
      feature_breakdown: featureBreakdown,
      confidence_bounds: {
        lower: lowerBound,
        upper: upperBound
      },
      statutory_disclaimer:
        'This intelligence enrichment is generated exclusively via local deterministic heuristics and does NOT represent an automated legal determination, fact-finding conclusion, or biometric confirmation of identity.',
      analyzed_at: new Date().toISOString()
    };
  }
}
