import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { createDatabaseConnection, closeDatabase, setDatabaseInstance } from '../../src/db/connection.js';
import { seedDemoData } from '../../src/db/seed.js';

describe('Security: Re-Upload & Related Content Metadata Monitoring', () => {
  let app: any;
  const orgId = 'org_apex_health_01';
  const analystId = 'usr_apex_analyst_03';

  beforeAll(() => {
    const testDb = createDatabaseConnection({ inMemory: true });
    setDatabaseInstance(testDb);
    seedDemoData(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('normalizes observed URL by stripping tracking parameters and normalizing host', async () => {
    const res = await request(app)
      .post('/api/re-uploads')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        case_id: 'case_apex_2026_001',
        observed_url: 'https://WWW.Instagram.COM/reel/12345/?utm_source=telegram&fbclid=abcdef&si=999',
        platform_id: 'plt_instagram',
        target_entity: 'Dr. Anand K. Verma',
        relationship: 'modified_reupload',
        similarity_score: 0.95,
        operator_notes: 'Mirrored video with altered caption'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.normalized_url).toBe('https://instagram.com/reel/12345');
    expect(res.body.data.relationship).toBe('modified_reupload');
  });

  it('automatically spawns internal workflow task when suspected mirror or re-upload is added', async () => {
    const res = await request(app)
      .get('/api/workflow/tasks')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .query({ case_id: 'case_apex_2026_001', task_type: 'duplicate_incident_review' });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].creation_reason).toContain('Re-upload observation recorded');
  });

  it('updates observation status with audit record', async () => {
    const addRes = await request(app)
      .post('/api/re-uploads')
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        case_id: 'case_apex_2026_001',
        observed_url: 'https://youtube.com/shorts/dup_vid_99',
        platform_id: 'plt_youtube',
        target_entity: 'Dr. Anand K. Verma',
        relationship: 'mirror',
        similarity_score: 1.0
      });

    const obsId = addRes.body.data.id;

    const patchRes = await request(app)
      .patch(`/api/re-uploads/${obsId}/status`)
      .set('x-user-id', analystId)
      .set('x-organization-id', orgId)
      .send({
        status: 'confirmed',
        operator_notes: 'Forensic analyst verified identical audio track'
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.status).toBe('confirmed');
    expect(patchRes.body.data.operator_notes).toContain('Forensic analyst verified');
  });
});
