import crypto from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  CreateSignalInput,
  CreateSignalSchema,
  MonitoringSignal,
  Priority
} from '../../domain/types.js';
import { SubjectService } from './subject-service.js';
import { UrlNormalizationService } from './url-normalization-service.js';
import { UsageMeteringService } from '../usage-metering-service.js';
import { AuditService } from '../audit-service.js';

export class SignalIngestionService {
  private db: Database.Database;
  private subjectService: SubjectService;
  private urlNormalizer: UrlNormalizationService;
  private usageService: UsageMeteringService;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.subjectService = new SubjectService(this.db);
    this.urlNormalizer = new UrlNormalizationService();
    this.usageService = new UsageMeteringService(this.db);
    this.auditService = new AuditService(this.db);
  }

  /**
   * Ingests and normalizes a candidate signal with authorization verification,
   * quota enforcement, and idempotent deduplication.
   */
  public ingestSignal(
    organizationId: string,
    actorUserId: string,
    input: CreateSignalInput
  ): { signal: MonitoringSignal; isDuplicate: boolean } {
    const validated = CreateSignalSchema.parse(input);

    // 1. Authorization check: Subject must be active with valid authorization mandate
    const authCheck = this.subjectService.verifySubjectAuthorization(
      organizationId,
      validated.subject_id
    );
    if (!authCheck.authorized || !authCheck.subject) {
      throw new Error(
        `SUBJECT_UNAUTHORIZED: Cannot ingest signal for subject ${validated.subject_id}: ${authCheck.reason}`
      );
    }

    // 2. Organization Quota Check: max_monthly_monitoring_signals
    const ent = this.db.prepare(`
      SELECT max_monthly_monitoring_signals FROM pilot_entitlements WHERE organization_id = ?
    `).get(organizationId) as { max_monthly_monitoring_signals?: number } | undefined;

    const maxMonthlySignals = ent?.max_monthly_monitoring_signals ?? 500;
    const currentMonthPrefix = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    const monthlyCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM monitoring_signals
      WHERE organization_id = ? AND observed_at LIKE ?
    `).get(organizationId, `${currentMonthPrefix}%`) as { count: number }).count;

    if (monthlyCount >= maxMonthlySignals) {
      throw new Error(
        `MONITORING_QUOTA_EXCEEDED: Organization monthly signal limit of ${maxMonthlySignals} reached`
      );
    }

    // 3. Normalize observed URL
    const norm = this.urlNormalizer.normalize(validated.observed_url);
    const observedAt = validated.observed_at || new Date().toISOString();
    const platform = validated.platform || norm.platform;

    // 4. Content & Metadata Hashes
    const rawPayloadStr = validated.raw_payload ? JSON.stringify(validated.raw_payload) : '';
    const contentHash = crypto
      .createHash('sha256')
      .update(rawPayloadStr || norm.normalizedUrl)
      .digest('hex');

    const metadataHash = crypto
      .createHash('sha256')
      .update(`${validated.subject_id}:${platform}:${validated.content_type || 'profile'}`)
      .digest('hex');

    // 5. Deterministic Idempotency Key
    // Unique per organization, subject, and normalized URL within 24-hour window
    const dayBucket = observedAt.slice(0, 10);
    const idempotencyKey = crypto
      .createHash('sha256')
      .update(`${organizationId}:${validated.subject_id}:${norm.canonicalHash}:${dayBucket}`)
      .digest('hex');

    // 6. Check existing signal by idempotency_key
    const existing = this.db.prepare(`
      SELECT * FROM monitoring_signals WHERE idempotency_key = ?
    `).get(idempotencyKey) as any;

    if (existing) {
      return {
        signal: this.mapRowToSignal(existing),
        isDuplicate: true
      };
    }

    // 7. Insert new signal and create human review queue entry in transaction
    const signalId = `sig_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const reviewId = `rev_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const signal: MonitoringSignal = {
      id: signalId,
      organization_id: organizationId,
      subject_id: validated.subject_id,
      policy_id: validated.policy_id || null,
      adapter_name: validated.adapter_name,
      source_type: validated.source_type,
      observed_url: validated.observed_url.trim(),
      normalized_url: norm.normalizedUrl,
      platform,
      observed_at: observedAt,
      content_type: validated.content_type || 'profile',
      content_hash: contentHash,
      metadata_hash: metadataHash,
      provenance: validated.provenance || {},
      idempotency_key: idempotencyKey,
      processing_status: 'pending',
      raw_payload: rawPayloadStr || null,
      created_at: now,
      updated_at: now
    };

    // Determine initial review priority based on subject sensitivity
    let initialPriority: Priority = 'medium';
    if (authCheck.subject.sensitivity === 'critical') {
      initialPriority = 'critical';
    } else if (authCheck.subject.sensitivity === 'high') {
      initialPriority = 'high';
    }

    const tx = this.db.transaction(() => {
      // Insert signal
      this.db.prepare(`
        INSERT INTO monitoring_signals (
          id, organization_id, subject_id, policy_id, adapter_name,
          source_type, observed_url, normalized_url, platform, observed_at,
          content_type, content_hash, metadata_hash, provenance,
          idempotency_key, processing_status, raw_payload, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        signal.id,
        signal.organization_id,
        signal.subject_id,
        signal.policy_id,
        signal.adapter_name,
        signal.source_type,
        signal.observed_url,
        signal.normalized_url,
        signal.platform,
        signal.observed_at,
        signal.content_type,
        signal.content_hash,
        signal.metadata_hash,
        JSON.stringify(signal.provenance),
        signal.idempotency_key,
        signal.processing_status,
        signal.raw_payload,
        signal.created_at,
        signal.updated_at
      );

      // Create human review queue record
      this.db.prepare(`
        INSERT INTO candidate_reviews (
          id, signal_id, organization_id, status, priority, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        reviewId,
        signal.id,
        organizationId,
        initialPriority,
        now,
        now
      );
    });

    tx();

    // Meter usage
    this.usageService.recordEvent({
      organization_id: organizationId,
      event_type: 'monitoring_signal_ingested',
      idempotency_key: `use_sig_${signal.id}`,
      resource_id: signal.id,
      actor_user_id: actorUserId,
      metadata: {
        platform: signal.platform,
        adapter_name: signal.adapter_name,
        source_type: signal.source_type
      }
    });

    // Audit log
    this.auditService.record({
      action: 'signal_ingested',
      resource_type: 'monitoring_signal',
      resource_id: signal.id,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'analyst@desk.internal',
      details: {
        subject_id: signal.subject_id,
        normalized_url: signal.normalized_url,
        platform: signal.platform,
        adapter: signal.adapter_name
      }
    });

    return { signal, isDuplicate: false };
  }

  public getSignal(organizationId: string, signalId: string): MonitoringSignal | null {
    const row = this.db.prepare(`
      SELECT * FROM monitoring_signals WHERE id = ? AND organization_id = ?
    `).get(signalId, organizationId) as any;

    if (!row) return null;
    return this.mapRowToSignal(row);
  }

  public listSignals(
    organizationId: string,
    filters?: { subjectId?: string; status?: string; limit?: number; offset?: number }
  ): MonitoringSignal[] {
    let sql = `SELECT * FROM monitoring_signals WHERE organization_id = ?`;
    const params: any[] = [organizationId];

    if (filters?.subjectId) {
      sql += ` AND subject_id = ?`;
      params.push(filters.subjectId);
    }
    if (filters?.status) {
      sql += ` AND processing_status = ?`;
      params.push(filters.status);
    }

    sql += ` ORDER BY observed_at DESC LIMIT ? OFFSET ?`;
    params.push(filters?.limit ?? 50);
    params.push(filters?.offset ?? 0);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapRowToSignal(r));
  }

  private mapRowToSignal(row: any): MonitoringSignal {
    return {
      id: row.id,
      organization_id: row.organization_id,
      subject_id: row.subject_id,
      policy_id: row.policy_id,
      adapter_name: row.adapter_name,
      source_type: row.source_type,
      observed_url: row.observed_url,
      normalized_url: row.normalized_url,
      platform: row.platform,
      observed_at: row.observed_at,
      content_type: row.content_type,
      content_hash: row.content_hash,
      metadata_hash: row.metadata_hash,
      provenance: JSON.parse(row.provenance || '{}'),
      idempotency_key: row.idempotency_key,
      processing_status: row.processing_status,
      raw_payload: row.raw_payload,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
