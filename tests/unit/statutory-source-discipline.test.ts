import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { StatutoryClockService } from '../../src/services/statutory-clock-service.js';

describe('Unit: Statutory Source Discipline & Clock Metadata', () => {
  let testDb: any;
  let service: StatutoryClockService;

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    service = new StatutoryClockService(testDb);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('records full statutory source citation and deadline type upon clock initialization', () => {
    const clock = service.initializeClock('case_apex_2026_001', 'org_apex_health_01', {
      involves_intimate_imagery: 1,
      harm_type: 'privacy_violation'
    });

    expect(clock.operational_rule).toBe('IT_RULES_2021_RULE_3_2_B');
    expect(clock.jurisdiction).toBe('IN-National');
    expect(clock.source_citation).toContain('Rule 3(2)(b)');
    expect(clock.source_url_or_identifier).toMatch(/^https?:\/\//);
    expect(clock.effective_date).toBe('2021-02-25');
    expect(clock.last_verified_date).toBe('2026-09-01');
    expect(clock.deadline_type).toBe('legally_mandatory');
  });

  it('attaches statutory metadata to dynamic clock evaluations', () => {
    const clock = service.getClockForCase('case_apex_2026_001', 'org_apex_health_01');
    expect(clock).not.toBeNull();

    const evaluation = service.evaluateClock(clock!);
    expect(evaluation.deadline_type).toBe('legally_mandatory');
    expect(evaluation.operational_rule).toBe('IT_RULES_2021_RULE_3_2_B');
    expect(evaluation.jurisdiction).toBe('IN-National');
    expect(evaluation.source_citation).toContain('Rule 3(2)(b)');
  });
});
