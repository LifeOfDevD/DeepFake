import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { PlatformPlaybook, IncidentCategory } from '../domain/types.js';

export class PlatformPlaybookService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  listPlaybooks(activeOnly = true): PlatformPlaybook[] {
    const query = activeOnly
      ? 'SELECT * FROM platform_playbooks WHERE is_active = 1 ORDER BY title ASC'
      : 'SELECT * FROM platform_playbooks ORDER BY title ASC';
    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.mapPlaybookRow);
  }

  getPlaybookById(id: string): PlatformPlaybook | null {
    const row = this.db.prepare('SELECT * FROM platform_playbooks WHERE id = ?').get(id) as any;
    return row ? this.mapPlaybookRow(row) : null;
  }

  getPlaybookBySlug(slug: string): PlatformPlaybook | null {
    const row = this.db.prepare('SELECT * FROM platform_playbooks WHERE slug = ?').get(slug) as any;
    return row ? this.mapPlaybookRow(row) : null;
  }

  getPlaybooksForCategory(category: IncidentCategory): PlatformPlaybook[] {
    const rows = this.db
      .prepare('SELECT * FROM platform_playbooks WHERE incident_category = ? AND is_active = 1')
      .all(category) as any[];
    return rows.map(this.mapPlaybookRow);
  }

  private mapPlaybookRow(row: any): PlatformPlaybook {
    return {
      ...row,
      applicable_platforms: JSON.parse(row.applicable_platforms || '["all"]'),
      required_intake_fields: JSON.parse(row.required_intake_fields || '[]'),
      required_evidence_types: JSON.parse(row.required_evidence_types || '[]'),
      prohibited_unsupported_assertions: JSON.parse(row.prohibited_unsupported_assertions || '[]'),
      declaration_requirements: JSON.parse(row.declaration_requirements || '[]'),
      escalation_rules: JSON.parse(row.escalation_rules || '[]'),
      human_approval_requirements: JSON.parse(row.human_approval_requirements || '[]')
    };
  }
}
