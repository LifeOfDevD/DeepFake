import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  MonitoringPolicy,
  CreateMonitoringPolicyInput,
  UpdateMonitoringPolicyInput
} from '../../domain/types.js';

export class MonitoringPolicyService {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
  }

  public createPolicy(
    organizationId: string,
    input: CreateMonitoringPolicyInput
  ): MonitoringPolicy {
    const id = `pol_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const policy: MonitoringPolicy = {
      id,
      organization_id: organizationId,
      subject_id: input.subject_id,
      name: input.name.trim(),
      enabled_signal_types: input.enabled_signal_types || ['profile', 'post', 'video'],
      enabled_adapters: input.enabled_adapters || ['manual_intake', 'file_replay', 'inbound_webhook', 'local_fixture'],
      scan_schedule: input.scan_schedule || 'hourly',
      max_monthly_candidate_volume: input.max_monthly_candidate_volume ?? 100,
      alert_threshold: input.alert_threshold ?? 0.7,
      auto_link_threshold: input.auto_link_threshold ?? 0.85,
      human_review_threshold: input.human_review_threshold ?? 0.3,
      retention_days: input.retention_days ?? 90,
      is_active: input.is_active ?? 1,
      created_at: now,
      updated_at: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO monitoring_policies (
        id, organization_id, subject_id, name,
        enabled_signal_types, enabled_adapters, scan_schedule,
        max_monthly_candidate_volume, alert_threshold, auto_link_threshold,
        human_review_threshold, retention_days, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      policy.id,
      policy.organization_id,
      policy.subject_id,
      policy.name,
      JSON.stringify(policy.enabled_signal_types),
      JSON.stringify(policy.enabled_adapters),
      policy.scan_schedule,
      policy.max_monthly_candidate_volume,
      policy.alert_threshold,
      policy.auto_link_threshold,
      policy.human_review_threshold,
      policy.retention_days,
      policy.is_active,
      policy.created_at,
      policy.updated_at
    );

    return policy;
  }

  public updatePolicy(
    organizationId: string,
    policyId: string,
    input: UpdateMonitoringPolicyInput
  ): MonitoringPolicy {
    const existing = this.getPolicy(organizationId, policyId);
    if (!existing) {
      throw new Error(`NOT_FOUND: Monitoring policy ${policyId} not found`);
    }

    const updated: MonitoringPolicy = {
      ...existing,
      ...input,
      enabled_signal_types: input.enabled_signal_types ?? existing.enabled_signal_types,
      enabled_adapters: input.enabled_adapters ?? existing.enabled_adapters,
      updated_at: new Date().toISOString()
    };

    const stmt = this.db.prepare(`
      UPDATE monitoring_policies SET
        name = ?,
        enabled_signal_types = ?,
        enabled_adapters = ?,
        scan_schedule = ?,
        max_monthly_candidate_volume = ?,
        alert_threshold = ?,
        auto_link_threshold = ?,
        human_review_threshold = ?,
        retention_days = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ? AND organization_id = ?
    `);

    stmt.run(
      updated.name,
      JSON.stringify(updated.enabled_signal_types),
      JSON.stringify(updated.enabled_adapters),
      updated.scan_schedule,
      updated.max_monthly_candidate_volume,
      updated.alert_threshold,
      updated.auto_link_threshold,
      updated.human_review_threshold,
      updated.retention_days,
      updated.is_active,
      updated.updated_at,
      policyId,
      organizationId
    );

    return updated;
  }

  public getPolicy(organizationId: string, policyId: string): MonitoringPolicy | null {
    const row = this.db.prepare(`
      SELECT * FROM monitoring_policies WHERE id = ? AND organization_id = ?
    `).get(policyId, organizationId) as any;

    if (!row) return null;
    return this.mapRowToPolicy(row);
  }

  public getPolicyBySubjectId(organizationId: string, subjectId: string): MonitoringPolicy | null {
    const row = this.db.prepare(`
      SELECT * FROM monitoring_policies
      WHERE subject_id = ? AND organization_id = ? AND is_active = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(subjectId, organizationId) as any;

    if (!row) return null;
    return this.mapRowToPolicy(row);
  }

  public listPolicies(organizationId: string, subjectId?: string): MonitoringPolicy[] {
    let sql = `SELECT * FROM monitoring_policies WHERE organization_id = ?`;
    const params: any[] = [organizationId];

    if (subjectId) {
      sql += ` AND subject_id = ?`;
      params.push(subjectId);
    }
    sql += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToPolicy(r));
  }

  private mapRowToPolicy(row: any): MonitoringPolicy {
    return {
      id: row.id,
      organization_id: row.organization_id,
      subject_id: row.subject_id,
      name: row.name,
      enabled_signal_types: JSON.parse(row.enabled_signal_types || '[]'),
      enabled_adapters: JSON.parse(row.enabled_adapters || '[]'),
      scan_schedule: row.scan_schedule,
      max_monthly_candidate_volume: row.max_monthly_candidate_volume,
      alert_threshold: row.alert_threshold,
      auto_link_threshold: row.auto_link_threshold,
      human_review_threshold: row.human_review_threshold,
      retention_days: row.retention_days,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
