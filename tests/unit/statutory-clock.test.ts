import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';
import { StatutoryClockService } from '../../src/services/statutory-clock-service.js';

describe('Phase 3 Unit Test: Statutory Clock Service', () => {
  let db: Database.Database;
  let clockService: StatutoryClockService;
  const orgId = 'org_clock_test';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES (?, 'Clock Org', 'clock-org', 'Healthcare', 'IN-DL', 'clock@example.com')
    `).run(orgId);

    clockService = new StatutoryClockService(db);
  });

  it('computes 24h acknowledgement and 72h submission deadlines for standard cases', () => {
    const caseId = 'case_clock_1';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-902', 'Standard Impersonation Case', 'fake_social_profile', 'medium', 'new',
        'Target Corp', 'https://example.com/fake2', 'Instagram', 'reporter@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);

    const now = new Date('2026-09-12T10:00:00.000Z');
    const clock = clockService.initializeClock(caseId, orgId, {
      category: 'fake_social_profile',
      harm_type: 'reputational'
    }, now);

    expect(clock.case_id).toBe(caseId);
    expect(clock.timezone).toBe('Asia/Kolkata');
    expect(clock.current_status).toBe('running');

    // Acknowledgement is +24h
    const ackDate = new Date(clock.acknowledgement_deadline);
    expect(ackDate.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);

    // Standard submission is +72h
    const subDate = new Date(clock.submission_deadline);
    expect(subDate.getTime() - now.getTime()).toBe(72 * 60 * 60 * 1000);

    // Escalation is +15 days
    const escDate = new Date(clock.escalation_deadline);
    expect(escDate.getTime() - now.getTime()).toBe(15 * 24 * 60 * 60 * 1000);
  });

  it('computes expedited 24h submission deadline for intimate / likeness impersonation under Rule 3(2)(b)', () => {
    const caseId = 'case_clock_2';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-903', 'Intimate Likeness Case', 'privacy_or_likeness_complaint', 'critical', 'new',
        'Dr. Sen', 'https://example.com/intimate', 'Telegram', 'reporter@example.com',
        NULL, 1, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);

    const now = new Date('2026-09-12T10:00:00.000Z');
    const clock = clockService.initializeClock(caseId, orgId, {
      category: 'privacy_or_likeness_complaint',
      involves_intimate_imagery: 1
    }, now);

    const subDate = new Date(clock.submission_deadline);
    expect(subDate.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(clock.operational_basis).toContain('Rule 3(2)(b)');
  });

  it('evaluates remaining hours and flags alert warnings', () => {
    const caseId = 'case_clock_3';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-904', 'Clock Evaluation Case', 'brand_impersonation', 'high', 'new',
        'Global Tech', 'https://example.com/gt', 'Meta', 'reporter@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);

    const baseTime = new Date('2026-09-12T10:00:00.000Z');
    const clock = clockService.initializeClock(caseId, orgId, {
      category: 'brand_impersonation'
    }, baseTime);

    // 1. Check at +60 hours (12 hours remaining on 72h clock -> due soon)
    const at60h = new Date(baseTime.getTime() + 60 * 60 * 60 * 1000);
    const evalDueSoon = clockService.evaluateClock(clock, at60h);
    expect(evalDueSoon.is_due_soon).toBe(true);
    expect(evalDueSoon.is_urgent).toBe(false);
    expect(evalDueSoon.is_overdue).toBe(false);
    expect(evalDueSoon.submission_remaining_hours).toBe(12);

    // 2. Check at +70 hours (2 hours remaining on 72h clock -> urgent)
    const at70h = new Date(baseTime.getTime() + 70 * 60 * 60 * 1000);
    const evalUrgent = clockService.evaluateClock(clock, at70h);
    expect(evalUrgent.is_urgent).toBe(true);
    expect(evalUrgent.is_overdue).toBe(false);
    expect(evalUrgent.submission_remaining_hours).toBe(2);

    // 3. Check at +75 hours (overdue)
    const at75h = new Date(baseTime.getTime() + 75 * 60 * 60 * 1000);
    const evalOverdue = clockService.evaluateClock(clock, at75h);
    expect(evalOverdue.is_overdue).toBe(true);
    expect(evalOverdue.submission_remaining_hours).toBeLessThan(0);
    expect(evalOverdue.warnings.length).toBeGreaterThan(0);
  });

  it('updates clock status and pauses with reason', () => {
    const caseId = 'case_clock_4';
    db.prepare(`
      INSERT INTO cases (
        id, organization_id, case_number, title, category, priority, status,
        target_entity, contested_url, hosting_platform, reported_by_email,
        assigned_to_user_id, requires_legal_review, statutory_basis, created_at, updated_at
      ) VALUES (
        ?, ?, 'CS-2026-905', 'Clock Status Case', 'brand_impersonation', 'medium', 'new',
        'Target Brand', 'https://example.com/gt2', 'Meta', 'reporter@example.com',
        NULL, 0, '[]', datetime('now'), datetime('now')
      )
    `).run(caseId, orgId);

    clockService.initializeClock(caseId, orgId, { category: 'brand_impersonation' });

    const paused = clockService.updateClockStatus(caseId, orgId, 'paused', 'Awaiting legal verification from outside counsel');
    expect(paused.current_status).toBe('paused');
    expect(paused.paused_reason).toBe('Awaiting legal verification from outside counsel');

    const retrieved = clockService.getClockForCase(caseId, orgId);
    expect(retrieved?.current_status).toBe('paused');
  });
});
