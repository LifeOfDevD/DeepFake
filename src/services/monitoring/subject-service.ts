import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  MonitoredSubject,
  CreateSubjectInput,
  UpdateSubjectInput
} from '../../domain/types.js';
import { AuditService } from '../audit-service.js';

export class SubjectService {
  private db: Database.Database;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.auditService = new AuditService(this.db);
  }

  /**
   * Creates a new monitored subject with strict mandate and quota enforcement
   */
  public createSubject(
    organizationId: string,
    actorUserId: string,
    input: CreateSubjectInput
  ): MonitoredSubject {
    // 1. Quota check: max_monitored_subjects
    const ent = this.db.prepare(`
      SELECT max_monitored_subjects FROM pilot_entitlements WHERE organization_id = ?
    `).get(organizationId) as { max_monitored_subjects?: number } | undefined;

    const maxAllowed = ent?.max_monitored_subjects ?? 5;
    const currentCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM monitored_subjects
      WHERE organization_id = ? AND monitoring_status != 'archived'
    `).get(organizationId) as { count: number }).count;

    if (currentCount >= maxAllowed) {
      throw new Error(`QUOTA_EXCEEDED: Maximum monitored subjects limit of ${maxAllowed} reached for organization`);
    }

    // 2. Mandate validation: authorization_basis and reference are mandatory
    if (!input.authorization_basis || !input.authorization_reference?.trim()) {
      throw new Error('AUTHORIZATION_REQUIRED: Subject cannot be registered without lawful authorization basis and reference');
    }

    const id = `sbj_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const subject: MonitoredSubject = {
      id,
      organization_id: organizationId,
      subject_type: input.subject_type,
      canonical_name: input.canonical_name.trim(),
      aliases: input.aliases || [],
      handles: input.handles || [],
      official_domains: input.official_domains || [],
      official_social_urls: input.official_social_urls || [],
      reference_images_metadata: input.reference_images_metadata || [],
      reference_audio_metadata: input.reference_audio_metadata || [],
      voice_enrollment_status: input.voice_enrollment_status || 'not_enrolled',
      face_enrollment_status: input.face_enrollment_status || 'not_enrolled',
      monitoring_status: input.monitoring_status || 'draft',
      authorization_basis: input.authorization_basis,
      authorization_reference: input.authorization_reference.trim(),
      jurisdiction: input.jurisdiction || 'IN',
      sensitivity: input.sensitivity || 'medium',
      retention_policy_days: input.retention_policy_days ?? 90,
      created_by_user_id: actorUserId,
      created_at: now,
      updated_at: now
    };

    const stmt = this.db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, aliases, handles,
        official_domains, official_social_urls, reference_images_metadata,
        reference_audio_metadata, voice_enrollment_status, face_enrollment_status,
        monitoring_status, authorization_basis, authorization_reference,
        jurisdiction, sensitivity, retention_policy_days, created_by_user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      subject.id,
      subject.organization_id,
      subject.subject_type,
      subject.canonical_name,
      JSON.stringify(subject.aliases),
      JSON.stringify(subject.handles),
      JSON.stringify(subject.official_domains),
      JSON.stringify(subject.official_social_urls),
      JSON.stringify(subject.reference_images_metadata),
      JSON.stringify(subject.reference_audio_metadata),
      subject.voice_enrollment_status,
      subject.face_enrollment_status,
      subject.monitoring_status,
      subject.authorization_basis,
      subject.authorization_reference,
      subject.jurisdiction,
      subject.sensitivity,
      subject.retention_policy_days,
      subject.created_by_user_id,
      subject.created_at,
      subject.updated_at
    );

    this.auditService.record({
      action: 'subject_created',
      resource_type: 'monitored_subject',
      resource_id: subject.id,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'analyst@desk.internal',
      details: {
        canonical_name: subject.canonical_name,
        subject_type: subject.subject_type,
        authorization_basis: subject.authorization_basis
      }
    });

    return subject;
  }

  public updateSubject(
    organizationId: string,
    subjectId: string,
    actorUserId: string,
    input: UpdateSubjectInput
  ): MonitoredSubject {
    const existing = this.getSubject(organizationId, subjectId);
    if (!existing) {
      throw new Error(`NOT_FOUND: Monitored subject ${subjectId} not found`);
    }

    // If activating, verify authorization basis exists
    const targetStatus = input.monitoring_status ?? existing.monitoring_status;
    const targetBasis = input.authorization_basis ?? existing.authorization_basis;
    const targetRef = input.authorization_reference ?? existing.authorization_reference;

    if (targetStatus === 'active' && (!targetBasis || !targetRef?.trim())) {
      throw new Error('AUTHORIZATION_REQUIRED: Cannot activate monitoring without valid authorization basis and reference');
    }

    const updated: MonitoredSubject = {
      ...existing,
      ...input,
      aliases: input.aliases ?? existing.aliases,
      handles: input.handles ?? existing.handles,
      official_domains: input.official_domains ?? existing.official_domains,
      official_social_urls: input.official_social_urls ?? existing.official_social_urls,
      reference_images_metadata: input.reference_images_metadata ?? existing.reference_images_metadata,
      reference_audio_metadata: input.reference_audio_metadata ?? existing.reference_audio_metadata,
      updated_at: new Date().toISOString()
    };

    const stmt = this.db.prepare(`
      UPDATE monitored_subjects SET
        subject_type = ?,
        canonical_name = ?,
        aliases = ?,
        handles = ?,
        official_domains = ?,
        official_social_urls = ?,
        reference_images_metadata = ?,
        reference_audio_metadata = ?,
        voice_enrollment_status = ?,
        face_enrollment_status = ?,
        monitoring_status = ?,
        authorization_basis = ?,
        authorization_reference = ?,
        jurisdiction = ?,
        sensitivity = ?,
        retention_policy_days = ?,
        updated_at = ?
      WHERE id = ? AND organization_id = ?
    `);

    stmt.run(
      updated.subject_type,
      updated.canonical_name,
      JSON.stringify(updated.aliases),
      JSON.stringify(updated.handles),
      JSON.stringify(updated.official_domains),
      JSON.stringify(updated.official_social_urls),
      JSON.stringify(updated.reference_images_metadata),
      JSON.stringify(updated.reference_audio_metadata),
      updated.voice_enrollment_status,
      updated.face_enrollment_status,
      updated.monitoring_status,
      updated.authorization_basis,
      updated.authorization_reference,
      updated.jurisdiction,
      updated.sensitivity,
      updated.retention_policy_days,
      updated.updated_at,
      subjectId,
      organizationId
    );

    this.auditService.record({
      action: 'subject_updated',
      resource_type: 'monitored_subject',
      resource_id: subjectId,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'analyst@desk.internal',
      details: {
        previous_status: existing.monitoring_status,
        new_status: updated.monitoring_status,
        updated_fields: Object.keys(input)
      }
    });

    return updated;
  }

  public getSubject(organizationId: string, subjectId: string): MonitoredSubject | null {
    const row = this.db.prepare(`
      SELECT * FROM monitored_subjects WHERE id = ? AND organization_id = ?
    `).get(subjectId, organizationId) as any;

    if (!row) return null;
    return this.mapRowToSubject(row);
  }

  public getSubjectById(subjectId: string): MonitoredSubject | null {
    const row = this.db.prepare(`
      SELECT * FROM monitored_subjects WHERE id = ?
    `).get(subjectId) as any;

    if (!row) return null;
    return this.mapRowToSubject(row);
  }

  public listSubjects(
    organizationId: string,
    filters?: { status?: string; sensitivity?: string }
  ): MonitoredSubject[] {
    let sql = `SELECT * FROM monitored_subjects WHERE organization_id = ?`;
    const params: any[] = [organizationId];

    if (filters?.status) {
      sql += ` AND monitoring_status = ?`;
      params.push(filters.status);
    }
    if (filters?.sensitivity) {
      sql += ` AND sensitivity = ?`;
      params.push(filters.sensitivity);
    }

    sql += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToSubject(r));
  }

  public archiveSubject(
    organizationId: string,
    subjectId: string,
    actorUserId: string
  ): MonitoredSubject {
    return this.updateSubject(organizationId, subjectId, actorUserId, {
      monitoring_status: 'archived'
    });
  }

  /**
   * Verifies lawful authorization mandate before permitting detection intake or scanning
   */
  public verifySubjectAuthorization(
    organizationId: string,
    subjectId: string
  ): { authorized: boolean; reason?: string; subject?: MonitoredSubject } {
    const subject = this.getSubject(organizationId, subjectId);
    if (!subject) {
      return { authorized: false, reason: 'Subject not found' };
    }

    if (subject.monitoring_status !== 'active') {
      return {
        authorized: false,
        reason: `Subject is in '${subject.monitoring_status}' state (must be 'active')`,
        subject
      };
    }

    if (!subject.authorization_basis || !subject.authorization_reference) {
      return {
        authorized: false,
        reason: 'Subject lacks required legal authorization basis or reference',
        subject
      };
    }

    return { authorized: true, subject };
  }

  private mapRowToSubject(row: any): MonitoredSubject {
    return {
      id: row.id,
      organization_id: row.organization_id,
      subject_type: row.subject_type,
      canonical_name: row.canonical_name,
      aliases: JSON.parse(row.aliases || '[]'),
      handles: JSON.parse(row.handles || '[]'),
      official_domains: JSON.parse(row.official_domains || '[]'),
      official_social_urls: JSON.parse(row.official_social_urls || '[]'),
      reference_images_metadata: JSON.parse(row.reference_images_metadata || '[]'),
      reference_audio_metadata: JSON.parse(row.reference_audio_metadata || '[]'),
      voice_enrollment_status: row.voice_enrollment_status,
      face_enrollment_status: row.face_enrollment_status,
      monitoring_status: row.monitoring_status,
      authorization_basis: row.authorization_basis,
      authorization_reference: row.authorization_reference,
      jurisdiction: row.jurisdiction,
      sensitivity: row.sensitivity,
      retention_policy_days: row.retention_policy_days,
      created_by_user_id: row.created_by_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
