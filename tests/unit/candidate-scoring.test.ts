import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { CandidateScoringService } from '../../src/services/monitoring/candidate-scoring-service.js';
import { MANDATORY_SCORING_DISCLAIMER } from '../../src/domain/types.js';

describe('Unit: CandidateScoringService', () => {
  let db: any;
  let scoringService: CandidateScoringService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    runMigrations(db);
    scoringService = new CandidateScoringService(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('assigns 0 score when candidate is official domain or URL', () => {
    const result = scoringService.calculateScore({
      signalId: 'sig_test_01',
      hasExactHandleMatch: true,
      hasNameAliasMatch: true,
      isLookalikeDomain: false,
      hasScamKeywords: false,
      hasBrandAssetAbuse: false,
      hasPriorViolationHistory: false,
      hasParodyOrSatireIndicator: false,
      isOfficialDomainOrUrl: true
    });

    expect(result.score).toBe(0);
    expect(result.disclaimer).toBe(MANDATORY_SCORING_DISCLAIMER);
    expect(result.factors.final_score).toBe(0);
  });

  it('computes weighted score for exact handle match and scam keywords', () => {
    const result = scoringService.calculateScore({
      signalId: 'sig_test_02',
      hasExactHandleMatch: true, // 25
      hasNameAliasMatch: true,   // 10
      isLookalikeDomain: false,
      hasScamKeywords: true,     // 25
      hasBrandAssetAbuse: true,  // 15
      hasPriorViolationHistory: false,
      hasParodyOrSatireIndicator: false,
      isOfficialDomainOrUrl: false
    });

    // 25 + 10 + 25 + 15 = 75
    expect(result.score).toBe(75);
    expect(result.factors.identity_match_score).toBe(35);
    expect(result.factors.content_impersonation_score).toBe(25);
    expect(result.factors.brand_asset_abuse_score).toBe(15);
    expect(result.disclaimer).toBe(MANDATORY_SCORING_DISCLAIMER);
  });

  it('applies 50% parody discount when parody indicator is present', () => {
    const result = scoringService.calculateScore({
      signalId: 'sig_test_03',
      hasExactHandleMatch: true, // 25
      hasNameAliasMatch: false,
      isLookalikeDomain: false,
      hasScamKeywords: false,
      hasBrandAssetAbuse: false,
      hasPriorViolationHistory: false,
      hasParodyOrSatireIndicator: true, // 0.5x
      isOfficialDomainOrUrl: false
    });

    // 25 * 0.5 = 12.5 -> 12.5
    expect(result.score).toBe(12.5);
    expect(result.factors.parody_fair_use_discount).toBe(0.5);
  });

  it('applies prior violation multiplier and clamps score to 100', () => {
    const result = scoringService.calculateScore({
      signalId: 'sig_test_04',
      hasExactHandleMatch: true, // 25
      hasNameAliasMatch: true,   // 10
      isLookalikeDomain: true,   // 25
      hasScamKeywords: true,     // 25
      hasBrandAssetAbuse: true,  // 15
      hasPriorViolationHistory: true, // 1.25x
      hasParodyOrSatireIndicator: false,
      isOfficialDomainOrUrl: false
    });

    // (25 + 10 + 25 + 25 + 15) * 1.25 = 100 * 1.25 = 125 -> clamped to 100
    expect(result.score).toBe(100);
    expect(result.factors.prior_violation_multiplier).toBe(1.25);
  });
});
