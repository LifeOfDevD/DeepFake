import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  SuppressionRule,
  CreateSuppressionRuleInput,
  EvaluationFixture,
  MonitoringSignal
} from '../../domain/types.js';

export interface SuppressionCheckResult {
  isSuppressed: boolean;
  matchedRule?: SuppressionRule | null;
  reason?: string;
  canOverride: boolean;
  suppressionCategory?: string;
}

export class SuppressionService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  /**
   * Creates a tenant-scoped suppression rule with mandatory expiry
   */
  public createSuppressionRule(
    organizationId: string,
    ownerUserId: string,
    input: CreateSuppressionRuleInput
  ): SuppressionRule {
    const id = `sup_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const expiryDate = new Date(now.getTime() + input.expires_in_days * 86400 * 1000).toISOString();
    const nowIso = now.toISOString();

    this.db.prepare(`
      INSERT INTO suppression_rules (
        id, organization_id, name, rule_type, pattern, pattern_type,
        owner_user_id, justification, is_active, override_count,
        evaluation_tested, ruleset_version, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?)
    `).run(
      id,
      organizationId,
      input.name,
      input.rule_type,
      input.pattern.trim(),
      input.pattern_type,
      ownerUserId,
      input.justification,
      input.ruleset_version,
      expiryDate,
      nowIso,
      nowIso
    );

    return this.getSuppressionRuleById(id, organizationId)!;
  }

  public getSuppressionRuleById(id: string, organizationId: string): SuppressionRule | null {
    const row = this.db.prepare(`
      SELECT * FROM suppression_rules WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as SuppressionRule | undefined;
    return row || null;
  }

  public listSuppressionRules(organizationId: string, activeOnly = true): SuppressionRule[] {
    let sql = 'SELECT * FROM suppression_rules WHERE organization_id = ?';
    const params: any[] = [organizationId];

    if (activeOnly) {
      sql += " AND is_active = 1 AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    }
    sql += ' ORDER BY created_at DESC';

    return this.db.prepare(sql).all(...params) as SuppressionRule[];
  }

  /**
   * Deactivates an active suppression rule
   */
  public deactivateRule(id: string, organizationId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE suppression_rules
      SET is_active = 0, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(now, id, organizationId);
  }

  /**
   * Evaluates an incoming candidate signal against active tenant suppression rules.
   * Enforces fail-closed safeguards for critical sensitivity and emergency scam keywords.
   */
  public evaluateSignalSuppression(
    organizationId: string,
    signal: MonitoringSignal,
    subjectSensitivity: string = 'medium'
  ): SuppressionCheckResult {
    // 1. Fail-closed safeguard: Critical sensitivity subjects CANNOT be suppressed automatically
    if (subjectSensitivity === 'critical') {
      return {
        isSuppressed: false,
        reason: 'CRITICAL_SENSITIVITY_FAIL_CLOSED: Signals for critical subjects cannot be suppressed.',
        canOverride: false
      };
    }

    // 2. Fail-closed safeguard: High-risk scam indicators bypass suppression
    const rawText = (typeof signal.raw_payload === 'string' ? signal.raw_payload : JSON.stringify(signal.raw_payload || {})).toLowerCase();
    const severeScamTerms = ['urgent wire', 'crypto giveaway', '500%', 'secret cure', 'upi payment required'];
    if (severeScamTerms.some((t) => rawText.includes(t))) {
      return {
        isSuppressed: false,
        reason: 'SEVERE_SCAM_FAIL_CLOSED: Severe fraud or medical cure claims cannot be suppressed.',
        canOverride: false
      };
    }

    // 3. Fetch active non-expired rules for this tenant
    const activeRules = this.listSuppressionRules(organizationId, true);

    const urlLower = signal.normalized_url.toLowerCase();
    for (const rule of activeRules) {
      const patternLower = rule.pattern.toLowerCase();
      let matched = false;

      switch (rule.pattern_type) {
        case 'exact_url': {
          const cleanUrl = urlLower.replace(/\/$/, '');
          const cleanPattern = patternLower.replace(/\/$/, '');
          matched = cleanUrl === cleanPattern;
          break;
        }
        case 'domain_glob':
          try {
            const parsed = new URL(signal.normalized_url);
            matched = parsed.hostname.toLowerCase().endsWith(patternLower.replace(/^\*\./, ''));
          } catch {
            matched = false;
          }
          break;
        case 'handle':
          matched = urlLower.includes(`/${patternLower.replace(/^@/, '')}`);
          break;
        case 'keyword':
          matched = rawText.includes(patternLower) || urlLower.includes(patternLower);
          break;
      }

      if (matched) {
        return {
          isSuppressed: true,
          matchedRule: rule,
          reason: `Suppressed under rule '${rule.name}' (${rule.rule_type}): ${rule.justification}`,
          canOverride: true,
          suppressionCategory: rule.rule_type
        };
      }
    }

    return {
      isSuppressed: false,
      canOverride: false
    };
  }

  /**
   * Increments the human override count for a suppression rule
   */
  public recordHumanOverride(ruleId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE suppression_rules
      SET override_count = override_count + 1, updated_at = ?
      WHERE id = ?
    `).run(now, ruleId);
  }

  /**
   * Tests a proposed or active suppression rule against synthetic evaluation fixtures
   */
  public testRuleAgainstFixtures(rule: SuppressionRule, fixtures: EvaluationFixture[]): {
    totalFixtures: number;
    suppressedFixtures: number;
    falseSuppressionRisk: number; // count of genuine impersonation matches that would be erroneously suppressed
  } {
    let suppressedCount = 0;
    let falseSuppressionCount = 0;

    const patternLower = rule.pattern.toLowerCase();

    for (const fix of fixtures) {
      const urlLower = fix.normalized_url.toLowerCase();
      const metaText = JSON.stringify(fix.signal_metadata).toLowerCase();
      let matched = false;

      if (rule.pattern_type === 'exact_url') {
        matched = urlLower === patternLower;
      } else if (rule.pattern_type === 'domain_glob') {
        matched = urlLower.includes(patternLower.replace(/^\*\./, ''));
      } else if (rule.pattern_type === 'handle') {
        matched = urlLower.includes(patternLower.replace(/^@/, ''));
      } else if (rule.pattern_type === 'keyword') {
        matched = metaText.includes(patternLower) || urlLower.includes(patternLower);
      }

      if (matched) {
        suppressedCount++;
        // If the fixture was an expected genuine threat, this suppression is a dangerous false negative
        if (fix.expected_correlation_outcome === 'match' && !fix.expected_false_positive_label) {
          falseSuppressionCount++;
        }
      }
    }

    return {
      totalFixtures: fixtures.length,
      suppressedFixtures: suppressedCount,
      falseSuppressionRisk: falseSuppressionCount
    };
  }
}
