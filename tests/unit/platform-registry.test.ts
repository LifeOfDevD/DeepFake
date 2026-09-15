import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';
import { PlatformRegistryService } from '../../src/services/platform-registry-service.js';

describe('Unit: Platform Registry & Policy Versioning', () => {
  let testDb: any;
  let service: PlatformRegistryService;

  beforeAll(() => {
    testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    service = new PlatformRegistryService(testDb);
  });

  afterAll(() => {
    closeDatabase();
  });

  it('lists seeded key platforms in alphabetical order', () => {
    const platforms = service.listPlatforms();
    expect(platforms.length).toBeGreaterThanOrEqual(7);

    const slugs = platforms.map((p) => p.slug);
    expect(slugs).toContain('instagram');
    expect(slugs).toContain('meta');
    expect(slugs).toContain('youtube');
    expect(slugs).toContain('x');
    expect(slugs).toContain('telegram');
    expect(slugs).toContain('linkedin');
    expect(slugs).toContain('generic_web');
  });

  it('retrieves platform details by ID and by slug', () => {
    const byId = service.getPlatformById('plt_instagram');
    expect(byId).not.toBeNull();
    expect(byId?.name).toBe('Instagram');
    expect(byId?.expected_acknowledgement_window_hours).toBe(24);
    expect(byId?.expected_response_window_hours).toBe(72);
    expect(byId?.supported_languages).toContain('hi');

    const bySlug = service.getPlatformBySlug('youtube');
    expect(bySlug).not.toBeNull();
    expect(bySlug?.id).toBe('plt_youtube');
    expect(bySlug?.max_attachment_size_mb).toBe(100);
  });

  it('adds a new versioned policy and increments version number', () => {
    const platform = service.getPlatformBySlug('meta');
    expect(platform).not.toBeNull();
    const initialVersion = platform!.current_version;

    const newVersion = service.addPolicyVersion(
      platform!.id,
      {
        policy_type: 'deepfake_misinformation',
        policy_url: 'https://facebook.example/help/synthetic-media-2026',
        effective_date: '2026-09-01',
        summary_of_terms: 'Updated intermediary terms requiring 24h removal of non-consensual synthetic impersonation.'
      },
      'usr_sysadmin_00',
      'sysadmin@desk.example'
    );

    expect(newVersion.version_number).toBe(initialVersion + 1);
    expect(newVersion.policy_type).toBe('deepfake_misinformation');

    const updatedPlatform = service.getPlatformById(platform!.id);
    expect(updatedPlatform?.current_version).toBe(initialVersion + 1);

    const versions = service.getPolicyVersions(platform!.id);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].summary_of_terms).toContain('Updated intermediary terms');
  });
});
