import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { PlatformPlaybookService } from '../../src/services/platform-playbook-service.js';

describe('Unit: Platform Playbooks', () => {
  let testDb: any;
  let service: PlatformPlaybookService;

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    service = new PlatformPlaybookService(testDb);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('contains all 9 required operational playbooks', () => {
    const playbooks = service.listPlaybooks();
    expect(playbooks.length).toBe(9);

    const slugs = playbooks.map((p) => p.slug);
    expect(slugs).toContain('fake_profile');
    expect(slugs).toContain('brand_or_founder_impersonation');
    expect(slugs).toContain('fake_endorsement');
    expect(slugs).toContain('synthetic_media_impersonation');
    expect(slugs).toContain('ncii_or_intimate_image');
    expect(slugs).toContain('copyright_trademark_misuse');
    expect(slugs).toContain('fake_support_account');
    expect(slugs).toContain('look_alike_domain');
    expect(slugs).toContain('defamation_or_legal_escalation');
  });

  it('verifies NCII playbook has 24h statutory clock and mandates legal review', () => {
    const ncii = service.getPlaybookBySlug('ncii_or_intimate_image');
    expect(ncii).not.toBeNull();
    expect(ncii?.expected_response_window_hours).toBe(24);
    expect(ncii?.requires_legal_review).toBe(1);
    expect(ncii?.expected_response_clock_type).toBe('it_rules_2021_24h_intimate');
    expect(ncii?.human_approval_requirements).toContain('legal_sufficiency');
    expect(ncii?.human_approval_requirements).toContain('simulated_submission');
  });

  it('verifies prohibited assertions warnings are present to prevent defamatory claims', () => {
    const fakeProfile = service.getPlaybookBySlug('fake_profile');
    expect(fakeProfile?.prohibited_unsupported_assertions.length).toBeGreaterThan(0);
    expect(fakeProfile?.prohibited_unsupported_assertions[0]).toContain('Do not assert criminal guilt');

    const defamation = service.getPlaybookBySlug('defamation_or_legal_escalation');
    expect(defamation?.requires_legal_review).toBe(1);
    expect(defamation?.required_intake_fields).toContain('factual_basis');
  });

  it('retrieves playbooks filtered by incident category', () => {
    const playbooks = service.getPlaybooksForCategory('synthetic_media_endorsement');
    expect(playbooks.length).toBeGreaterThanOrEqual(2);
    const slugs = playbooks.map((p) => p.slug);
    expect(slugs).toContain('synthetic_media_impersonation');
    expect(slugs).toContain('fake_endorsement');
  });
});
