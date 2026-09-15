import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabaseConnection, setDatabaseInstance, closeDatabase } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { EntitlementService } from '../../src/services/entitlement-service.js';

describe('Unit: Entitlement & Feature Gating Service', () => {
  let db: any;
  let service: EntitlementService;

  beforeEach(() => {
    db = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(db);
    seedDemoData(db);
    service = new EntitlementService();
    service.initializeDefaultEntitlements('org_apex_health_01', 'pilot');
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Feature Flag Checks', () => {
    it('returns correct feature flags for default pilot plan', () => {
      // org_apex_health_01 has pilot plan
      expect(service.hasFeature('org_apex_health_01', 'statutory_clocks')).toBe(true);
      expect(service.hasFeature('org_apex_health_01', 'evidence_locker')).toBe(true);
      expect(service.hasFeature('org_apex_health_01', 'api_access')).toBe(true);
      expect(service.hasFeature('org_apex_health_01', 'export')).toBe(true);
    });

    it('returns all feature flags for organization', () => {
      const flags = service.getFeatureFlags('org_apex_health_01');
      expect(flags.statutory_clocks).toBe(true);
      expect(flags.evidence_locker).toBe(true);
      expect(flags.dry_run_submissions).toBe(true);
    });

    it('respects custom entitlement feature overrides', () => {
      // Update enabled_features in pilot_entitlements
      db.prepare(`
        UPDATE pilot_entitlements
        SET enabled_features = ?
        WHERE organization_id = ?
      `).run(JSON.stringify(['evidence_locker']), 'org_apex_health_01');

      expect(service.hasFeature('org_apex_health_01', 'evidence_locker')).toBe(true);
      expect(service.hasFeature('org_apex_health_01', 'statutory_clocks')).toBe(false);
    });
  });

  describe('Limit Checks & Assertions', () => {
    it('allows case creation when within limits', () => {
      expect(() => service.assertCanCreateCase('org_apex_health_01')).not.toThrow();
    });

    it('throws ENTITLEMENT_LIMIT_EXCEEDED when active case limit is reached', () => {
      // Override max_active_cases to 1
      db.prepare(`
        UPDATE pilot_entitlements
        SET max_active_cases = ?
        WHERE organization_id = ?
      `).run(1, 'org_apex_health_01');

      // Apex already has 2 cases in seed
      expect(() => service.assertCanCreateCase('org_apex_health_01')).toThrowError(/Cannot create new case/);
    });

    it('allows evidence upload when within storage limits', () => {
      expect(() => service.assertCanUploadEvidence('org_apex_health_01', 1024 * 1024)).not.toThrow();
    });

    it('throws ENTITLEMENT_LIMIT_EXCEEDED when evidence upload exceeds storage limit', () => {
      // 10 GB file will exceed pilot 5 GB limit
      const tenGB = 10 * 1024 * 1024 * 1024;
      expect(() => service.assertCanUploadEvidence('org_apex_health_01', tenGB)).toThrowError(/Storage capacity exceeded/);
    });

    it('allows submission simulation within monthly quota', () => {
      expect(() => service.assertCanSimulateSubmission('org_apex_health_01')).not.toThrow();
    });

    it('asserts seat limit when inviting team members', () => {
      // Override max_users to 2
      db.prepare(`
        UPDATE pilot_entitlements
        SET max_users = ?
        WHERE organization_id = ?
      `).run(2, 'org_apex_health_01');

      // Apex already has 3 users in seed
      expect(() => service.assertCanInviteUser('org_apex_health_01')).toThrowError(/Cannot invite user/);
    });
  });
});
