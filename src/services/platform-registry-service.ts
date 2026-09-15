import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  PlatformRegistryItem,
  PlatformPolicyVersion,
  AddPlatformPolicyInput
} from '../domain/types.js';
import { AuditService } from './audit-service.js';

export class PlatformRegistryService {
  private db: Database.Database;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.auditService = new AuditService(this.db);
  }

  listPlatforms(activeOnly = true): PlatformRegistryItem[] {
    const query = activeOnly
      ? 'SELECT * FROM platform_registry WHERE is_active = 1 ORDER BY name ASC'
      : 'SELECT * FROM platform_registry ORDER BY name ASC';
    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.mapPlatformRow);
  }

  getPlatformById(id: string): PlatformRegistryItem | null {
    const row = this.db.prepare('SELECT * FROM platform_registry WHERE id = ?').get(id) as any;
    return row ? this.mapPlatformRow(row) : null;
  }

  getPlatformBySlug(slug: string): PlatformRegistryItem | null {
    const row = this.db.prepare('SELECT * FROM platform_registry WHERE slug = ?').get(slug) as any;
    return row ? this.mapPlatformRow(row) : null;
  }

  addPolicyVersion(
    platformId: string,
    input: AddPlatformPolicyInput,
    actorUserId: string,
    actorEmail: string
  ): PlatformPolicyVersion {
    const platform = this.getPlatformById(platformId);
    if (!platform) {
      throw new Error(`Platform with ID ${platformId} not found.`);
    }

    const versionId = `pol_${uuidv4().replace(/-/g, '')}`;
    const nextVersionNumber = platform.current_version + 1;

    const insertVersion = this.db.prepare(`
      INSERT INTO platform_policy_versions (
        id, platform_id, version_number, policy_type, policy_url,
        effective_date, summary_of_terms, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updatePlatform = this.db.prepare(`
      UPDATE platform_registry
      SET current_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `);

    const tx = this.db.transaction(() => {
      insertVersion.run(
        versionId,
        platformId,
        nextVersionNumber,
        input.policy_type,
        input.policy_url,
        input.effective_date,
        input.summary_of_terms,
        actorUserId
      );
      updatePlatform.run(nextVersionNumber, platformId);

      this.auditService.record({
        organization_id: 'org_apex_health_01', // system-level audit
        actor_user_id: actorUserId,
        actor_email: actorEmail,
        action: 'platform_policy.version_added',
        resource_type: 'platform_registry',
        resource_id: platformId,
        details: {
          version_number: nextVersionNumber,
          policy_type: input.policy_type,
          policy_url: input.policy_url
        }
      });
    });

    tx();

    return {
      id: versionId,
      platform_id: platformId,
      version_number: nextVersionNumber,
      policy_type: input.policy_type,
      policy_url: input.policy_url,
      effective_date: input.effective_date,
      summary_of_terms: input.summary_of_terms,
      created_by: actorUserId,
      created_at: new Date().toISOString()
    };
  }

  getPolicyVersions(platformId: string): PlatformPolicyVersion[] {
    const rows = this.db
      .prepare('SELECT * FROM platform_policy_versions WHERE platform_id = ? ORDER BY version_number DESC')
      .all(platformId) as any[];
    return rows;
  }

  private mapPlatformRow(row: any): PlatformRegistryItem {
    return {
      ...row,
      supported_complaint_categories: JSON.parse(row.supported_complaint_categories || '[]'),
      required_fields: JSON.parse(row.required_fields || '[]'),
      accepted_evidence_types: JSON.parse(row.accepted_evidence_types || '[]'),
      supported_languages: JSON.parse(row.supported_languages || '["en"]')
    };
  }
}
