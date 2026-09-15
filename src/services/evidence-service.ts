import crypto from 'crypto';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { Readable } from 'stream';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/env.js';
import {
  EvidenceAccessEvent,
  EvidenceDeletionRequest,
  EvidenceItem,
  EvidenceRetentionHold,
  EvidenceSensitivity,
  EvidenceStatus,
  EvidenceType,
  Role
} from '../domain/types.js';
import { validateEvidenceStateTransition } from '../domain/evidence-state-machine.js';
import { EvidenceStorage, LocalEvidenceStorage, StorageNotFoundError } from '../storage/evidence-storage.js';
import { processEvidenceStream, processEvidenceFile } from './evidence-hasher.js';
import { ManualSourceCaptureProvider } from './source-capture.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';

export class EvidenceError extends Error {
  constructor(message: string, public readonly code: string = 'EVIDENCE_ERROR') {
    super(message);
    this.name = 'EvidenceError';
  }
}

export class EvidenceNotFoundError extends EvidenceError {
  constructor(evidenceId: string) {
    super(`Evidence item '${evidenceId}' not found.`, 'EVIDENCE_NOT_FOUND');
    this.name = 'EvidenceNotFoundError';
  }
}

export class EvidenceAccessDeniedError extends EvidenceError {
  constructor(message: string) {
    super(message, 'EVIDENCE_ACCESS_DENIED');
    this.name = 'EvidenceAccessDeniedError';
  }
}

export class LegalHoldActiveError extends EvidenceError {
  constructor(evidenceId: string) {
    super(`Cannot delete or expire evidence '${evidenceId}' while an active legal hold is in place.`, 'LEGAL_HOLD_ACTIVE');
    this.name = 'LegalHoldActiveError';
  }
}

export interface CreateFileUploadInput {
  originalFilename: string;
  declaredMimeType: string;
  fileBuffer?: Buffer;
  tempFilePath?: string;
  safeDisplayName?: string;
  sensitivity?: EvidenceSensitivity;
  capturedAt?: string;
}

export interface CreateSourceUrlInput {
  sourceUrl: string;
  safeDisplayName: string;
  operatorNotes?: string;
  sensitivity?: EvidenceSensitivity;
}

export interface DownloadTokenPayload {
  evidenceId: string;
  organizationId: string;
  actorUserId: string;
  expiresAt: number;
}

export class EvidenceService {
  private auditService: AuditService;
  private sourceCaptureProvider: ManualSourceCaptureProvider;
  private tokenSecret: string;

  constructor(
    private db: Database.Database = getDatabase(),
    private storage: EvidenceStorage = new LocalEvidenceStorage()
  ) {
    this.auditService = new AuditService(this.db);
    this.sourceCaptureProvider = new ManualSourceCaptureProvider();
    this.tokenSecret = getConfig().auth.downloadTokenSecret;
  }


  public setStorage(storage: EvidenceStorage): void {
    this.storage = storage;
  }

  /**
   * Records an access/audit event in evidence_access_events table
   */
  private recordAccessEvent(
    organizationId: string,
    evidenceId: string,
    actor: ActorContext,
    action: string,
    success: boolean = true,
    metadata: Record<string, unknown> = {}
  ): EvidenceAccessEvent {
    const id = `eacc_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const metaStr = JSON.stringify(metadata);
    const ip = actor.ip_address || '127.0.0.1';

    this.db
      .prepare(`
        INSERT INTO evidence_access_events (
          id, organization_id, evidence_id, actor_user_id,
          action, success, ip_address, user_agent, created_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, organizationId, evidenceId, actor.user_id, action, success ? 1 : 0, ip, 'Digital-Response-Desk/1.0', now, metaStr);

    return {
      id,
      organization_id: organizationId,
      evidence_id: evidenceId,
      actor_user_id: actor.user_id,
      action,
      success: success ? 1 : 0,
      ip_address: ip,
      user_agent: 'Digital-Response-Desk/1.0',
      created_at: now,
      metadata_json: metaStr
    };
  }

  /**
   * Computes a safe display name that strips malicious extensions and directory hints
   */
  private sanitizeDisplayName(name: string): string {
    const cleaned = path.basename(name).replace(/[^a-zA-Z0-9._\- ]/g, '_').trim();
    return cleaned.slice(0, 120) || 'unnamed_evidence';
  }

  /**
   * Uploads and attaches a file evidence item to a case with SHA-256 verification and atomic storage
   */
  public async uploadEvidence(
    organizationId: string,
    caseId: string,
    input: CreateFileUploadInput,
    actor: ActorContext
  ): Promise<EvidenceItem> {
    if (actor.role === 'read_only_stakeholder') {
      throw new EvidenceAccessDeniedError('Read-only stakeholders are not permitted to upload evidence.');
    }

    // Verify case ownership within tenant
    const caseRow = this.db
      .prepare('SELECT id FROM cases WHERE id = ? AND organization_id = ?')
      .get(caseId, organizationId) as { id: string } | undefined;

    if (!caseRow) {
      throw new EvidenceError(`Case '${caseId}' not found in organization.`, 'CASE_NOT_FOUND');
    }

    const evidenceId = `ev_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const ext = path.extname(input.originalFilename).toLowerCase();
    const storageKey = `evidence/${organizationId}/${caseId}/${evidenceId}/payload${ext}`;
    const now = new Date().toISOString();

    let sha256: string;
    let byteSize: number;
    let detectedMimeType: string;

    // 1. Process stream / buffer: Streaming SHA-256, magic-byte sniffing, size & type checks
    if (input.tempFilePath) {
      const fileResult = await processEvidenceFile(
        input.tempFilePath,
        input.declaredMimeType,
        input.originalFilename
      );
      sha256 = fileResult.sha256;
      byteSize = fileResult.byteSize;
      detectedMimeType = fileResult.detectedMimeType;

      await this.storage.putFile(input.tempFilePath, storageKey, detectedMimeType);
    } else if (input.fileBuffer) {
      const hashResult = await processEvidenceStream(
        input.fileBuffer,
        input.declaredMimeType,
        input.originalFilename
      );
      sha256 = hashResult.sha256;
      byteSize = hashResult.byteSize;
      detectedMimeType = hashResult.detectedMimeType;

      await this.storage.put({
        storageKey,
        streamOrBuffer: hashResult.buffer,
        byteSize: hashResult.byteSize,
        mimeType: hashResult.detectedMimeType
      });
    } else {
      throw new EvidenceError('Must provide either fileBuffer or tempFilePath for upload.', 'INVALID_FILE_INPUT');
    }

    // 2. Map detected MIME type to high-level EvidenceType
    let evidenceType: EvidenceType = 'image';
    if (detectedMimeType.startsWith('video/')) evidenceType = 'video';
    else if (detectedMimeType.startsWith('audio/')) evidenceType = 'audio';
    else if (detectedMimeType === 'application/pdf') evidenceType = 'pdf';
    else if (detectedMimeType === 'text/plain') evidenceType = 'text';

    // 3. Calculate default retention
    const retentionDays = getConfig().retention.defaultDays;
    const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const safeDisplayName = this.sanitizeDisplayName(input.safeDisplayName || input.originalFilename);
    const sensitivity = input.sensitivity || 'normal';
    const status: EvidenceStatus = sensitivity === 'prohibited' ? 'quarantined' : 'available';

    // 4. Insert record into database
    this.db
      .prepare(`
        INSERT INTO evidence_items (
          id, organization_id, case_id, evidence_type, original_filename,
          safe_display_name, mime_type, detected_mime_type, byte_size,
          sha256, storage_key, status, sensitivity, source_url,
          captured_at, uploaded_at, uploaded_by, retention_until,
          legal_hold, deleted_at, deletion_reason, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          0, NULL, NULL, ?, ?
        )
      `)
      .run(
        evidenceId,
        organizationId,
        caseId,
        evidenceType,
        this.sanitizeDisplayName(input.originalFilename),
        safeDisplayName,
        input.declaredMimeType,
        detectedMimeType,
        byteSize,
        sha256,
        storageKey,
        status,
        sensitivity,
        null,
        input.capturedAt || now,
        now,
        actor.user_id,
        retentionUntil,
        now,
        now
      );


    // 5. Record chain of custody and general audit events
    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_upload_completed', true, {
      sha256,
      byteSize,
      detectedMimeType
    });


    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.uploaded',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: {
        case_id: caseId,
        safe_display_name: safeDisplayName,
        sha256,
        byte_size: byteSize,
        status
      },

      ip_address: actor.ip_address
    });


    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Attaches a manual source URL evidence record without performing external network fetches
   */
  public async createSourceUrlEvidence(
    organizationId: string,
    caseId: string,
    input: CreateSourceUrlInput,
    actor: ActorContext
  ): Promise<EvidenceItem> {
    if (actor.role === 'read_only_stakeholder') {
      throw new EvidenceAccessDeniedError('Read-only stakeholders are not permitted to add source URLs.');
    }

    const caseRow = this.db
      .prepare('SELECT id FROM cases WHERE id = ? AND organization_id = ?')
      .get(caseId, organizationId);

    if (!caseRow) {
      throw new EvidenceError(`Case '${caseId}' not found in organization.`, 'CASE_NOT_FOUND');
    }

    const capture = await this.sourceCaptureProvider.capture(input.sourceUrl, input.operatorNotes || '');
    const evidenceId = `ev_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    // Check for duplicate URL in this case
    const duplicate = this.db
      .prepare('SELECT id FROM evidence_items WHERE case_id = ? AND source_url = ? AND status != ?')
      .get(caseId, capture.sourceUrl, 'deleted') as { id: string } | undefined;

    // Hash normalized URL and operator notes to provide tamper-evidence (persisted as valid JSON)
    const payloadObject = {
      source_url: capture.sourceUrl,
      captured_at: capture.capturedAt,
      operator_notes: capture.operatorNotes
    };
    const payloadToHash = Buffer.from(JSON.stringify(payloadObject, null, 2), 'utf8');
    const sha256 = crypto.createHash('sha256').update(payloadToHash).digest('hex');
    const storageKey = `evidence/${organizationId}/${caseId}/${evidenceId}/source_url.json`;

    // Persist metadata payload
    await this.storage.put({
      storageKey,
      streamOrBuffer: payloadToHash,
      byteSize: payloadToHash.length,
      mimeType: 'application/json'
    });

    const retentionDays = getConfig().retention.defaultDays;
    const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const safeDisplayName = this.sanitizeDisplayName(input.safeDisplayName);
    const sensitivity = input.sensitivity || 'normal';
    const status: EvidenceStatus = sensitivity === 'prohibited' ? 'quarantined' : 'available';

    this.db
      .prepare(`
        INSERT INTO evidence_items (
          id, organization_id, case_id, evidence_type, original_filename,
          safe_display_name, mime_type, detected_mime_type, byte_size,
          sha256, storage_key, status, sensitivity, source_url,
          captured_at, uploaded_at, uploaded_by, retention_until,
          legal_hold, deleted_at, deletion_reason, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'source_url', ?,
          ?, 'text/uri-list', 'application/json', ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          0, NULL, NULL, ?, ?
        )
      `)
      .run(
        evidenceId,
        organizationId,
        caseId,
        safeDisplayName,
        safeDisplayName,
        payloadToHash.length,
        sha256,
        storageKey,
        status,
        sensitivity,
        capture.sourceUrl,
        capture.capturedAt,
        now,
        actor.user_id,
        retentionUntil,
        now,
        now
      );

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_upload_completed', true, {
      evidence_type: 'source_url',
      source_url: capture.sourceUrl,
      is_duplicate: !!duplicate
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.source_url_added',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: {
        case_id: caseId,
        source_url: capture.sourceUrl,
        is_duplicate: !!duplicate
      },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Retrieves an evidence item strictly scoped to tenant organization
   */
  public getEvidenceById(organizationId: string, evidenceId: string): EvidenceItem {
    const stmt = this.db.prepare('SELECT * FROM evidence_items WHERE id = ? AND organization_id = ?');
    const item = stmt.get(evidenceId, organizationId) as EvidenceItem | undefined;

    if (!item) {
      throw new EvidenceNotFoundError(evidenceId);
    }

    return item;
  }

  /**
   * Lists all evidence items for a case with optional status filter
   */
  public listCaseEvidence(
    organizationId: string,
    caseId: string,
    actor: ActorContext,
    includeDeleted: boolean = false
  ): EvidenceItem[] {
    // Verify case belongs to tenant
    const caseRow = this.db
      .prepare('SELECT id FROM cases WHERE id = ? AND organization_id = ?')
      .get(caseId, organizationId);

    if (!caseRow) {
      throw new EvidenceError(`Case '${caseId}' not found in organization.`, 'CASE_NOT_FOUND');
    }

    let sql = 'SELECT * FROM evidence_items WHERE organization_id = ? AND case_id = ?';
    if (!includeDeleted) {
      sql += " AND status != 'deleted'";
    }
    sql += ' ORDER BY created_at DESC';

    const items = this.db.prepare(sql).all(organizationId, caseId) as EvidenceItem[];

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.listed',
      resource_type: 'case',
      resource_id: caseId,
      details: { count: items.length },
      ip_address: actor.ip_address
    });

    return items;
  }

  /**
   * Changes sensitivity level of an evidence item
   */
  public markSensitivity(
    organizationId: string,
    evidenceId: string,
    sensitivity: EvidenceSensitivity,
    reason: string,
    actor: ActorContext
  ): EvidenceItem {
    const item = this.getEvidenceById(organizationId, evidenceId);

    if (actor.role === 'read_only_stakeholder') {
      throw new EvidenceAccessDeniedError('Read-only stakeholders cannot alter evidence sensitivity.');
    }

    const now = new Date().toISOString();
    let newStatus = item.status;
    if (sensitivity === 'prohibited') {
      newStatus = 'quarantined';
    }

    validateEvidenceStateTransition(item.status, newStatus);

    this.db
      .prepare(`
        UPDATE evidence_items
        SET sensitivity = ?, status = ?, updated_at = ?
        WHERE id = ? AND organization_id = ?
      `)
      .run(sensitivity, newStatus, now, evidenceId, organizationId);

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_marked_sensitive', true, {
      previous_sensitivity: item.sensitivity,
      new_sensitivity: sensitivity,
      new_status: newStatus,
      reason
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.marked_sensitive',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: {
        previous_sensitivity: item.sensitivity,
        new_sensitivity: sensitivity,
        reason
      },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Quarantines an evidence item immediately
   */
  public quarantineEvidence(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): EvidenceItem {
    const item = this.getEvidenceById(organizationId, evidenceId);

    if (actor.role === 'read_only_stakeholder') {
      throw new EvidenceAccessDeniedError('Read-only stakeholders cannot quarantine evidence.');
    }

    validateEvidenceStateTransition(item.status, 'quarantined');

    const now = new Date().toISOString();


    this.db
      .prepare(`
        UPDATE evidence_items
        SET status = 'quarantined', updated_at = ?
        WHERE id = ? AND organization_id = ?
      `)
      .run(now, evidenceId, organizationId);

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_quarantined', true, {
      previous_status: item.status,
      reason
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.quarantined',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: { reason },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Places an immutable legal hold on an evidence item
   */
  public placeLegalHold(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): EvidenceRetentionHold {
    this.getEvidenceById(organizationId, evidenceId);

    const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
    if (!allowedRoles.includes(actor.role)) {
      throw new EvidenceAccessDeniedError(`Role '${actor.role}' cannot place legal holds.`);
    }

    const holdId = `hold_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO evidence_retention_holds (
            id, organization_id, evidence_id, created_by, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(holdId, organizationId, evidenceId, actor.user_id, reason, now);

      this.db
        .prepare('UPDATE evidence_items SET legal_hold = 1, updated_at = ? WHERE id = ? AND organization_id = ?')
        .run(now, evidenceId, organizationId);
    });

    tx();

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_legal_hold_created', true, {
      hold_id: holdId,
      reason
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.legal_hold_placed',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: { hold_id: holdId, reason },
      ip_address: actor.ip_address
    });

    return {
      id: holdId,
      organization_id: organizationId,
      evidence_id: evidenceId,
      created_by: actor.user_id,
      reason,
      created_at: now,
      released_by: null,
      released_at: null
    };
  }

  /**
   * Releases an active legal hold
   */
  public releaseLegalHold(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): void {
    this.getEvidenceById(organizationId, evidenceId);

    const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
    if (!allowedRoles.includes(actor.role)) {
      throw new EvidenceAccessDeniedError(`Role '${actor.role}' cannot release legal holds.`);
    }

    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE evidence_retention_holds
          SET released_by = ?, released_at = ?
          WHERE evidence_id = ? AND organization_id = ? AND released_at IS NULL
        `)
        .run(actor.user_id, now, evidenceId, organizationId);

      // Check if other active holds remain
      const remaining = this.db
        .prepare('SELECT COUNT(*) as count FROM evidence_retention_holds WHERE evidence_id = ? AND released_at IS NULL')
        .get(evidenceId) as { count: number };

      if (remaining.count === 0) {
        this.db
          .prepare('UPDATE evidence_items SET legal_hold = 0, updated_at = ? WHERE id = ? AND organization_id = ?')
          .run(now, evidenceId, organizationId);
      }
    });

    tx();

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_legal_hold_released', true, { reason });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.legal_hold_released',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: { reason },
      ip_address: actor.ip_address
    });
  }

  /**
   * Requests deletion of an evidence item
   */
  public requestDeletion(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): EvidenceItem {
    const item = this.getEvidenceById(organizationId, evidenceId);

    if (actor.role === 'read_only_stakeholder') {
      throw new EvidenceAccessDeniedError('Read-only stakeholders cannot request evidence deletion.');
    }

    if (item.legal_hold === 1) {
      throw new LegalHoldActiveError(evidenceId);
    }

    validateEvidenceStateTransition(item.status, 'deletion_requested');

    const requestId = `del_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO evidence_deletion_requests (
            id, organization_id, evidence_id, case_id, requested_by,
            request_reason, requested_at, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `)
        .run(requestId, organizationId, evidenceId, item.case_id, actor.user_id, reason, now, now, now);

      this.db
        .prepare(`
          UPDATE evidence_items
          SET status = 'deletion_requested', deletion_reason = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(reason, now, evidenceId, organizationId);
    });

    tx();

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_deletion_requested', true, {
      requestId,
      reason
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.deletion_requested',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: { requestId, reason },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Approves deletion, purges binary payload, and leaves a verifiable tombstone.
   * Strictly enforces two-person rule: Approver must be distinct from Requester.
   */
  public async approveDeletion(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): Promise<EvidenceItem> {
    const item = this.getEvidenceById(organizationId, evidenceId);

    const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
    if (!allowedRoles.includes(actor.role)) {
      throw new EvidenceAccessDeniedError(`Role '${actor.role}' cannot approve evidence deletion.`);
    }

    if (item.legal_hold === 1) {
      throw new LegalHoldActiveError(evidenceId);
    }

    const pendingRequest = this.db
      .prepare(`
        SELECT * FROM evidence_deletion_requests
        WHERE evidence_id = ? AND organization_id = ? AND status = 'pending'
        ORDER BY requested_at DESC LIMIT 1
      `)
      .get(evidenceId, organizationId) as EvidenceDeletionRequest | undefined;

    if (!pendingRequest) {
      throw new EvidenceError(
        'Two-person authorization required: A deletion request must first be submitted by a separate operator.',
        'NO_PENDING_DELETION_REQUEST'
      );
    }

    // Two-person rule enforcement: Approver CANNOT be the same user as Requester
    if (pendingRequest.requested_by === actor.user_id) {
      throw new EvidenceAccessDeniedError(
        'Two-person authorization violation: Approver cannot be the same user who submitted the deletion request.'
      );
    }

    validateEvidenceStateTransition(item.status, 'deleted');

    // 1. Delete physical payload from storage provider failure-safely
    try {
      await this.storage.delete(item.storage_key);
    } catch (err: any) {
      if (err instanceof StorageNotFoundError || err.code === 'STORAGE_NOT_FOUND' || err.code === 'ENOENT') {
        // Physical payload already absent; proceed with database tombstoning
      } else {
        // Real unexpected storage error! Preserve retryable deletion_requested status and abort
        throw new EvidenceError(
          `Physical storage deletion failed: ${err.message}. Deletion aborted to preserve consistency.`,
          'STORAGE_DELETION_FAILED'
        );
      }
    }

    const now = new Date().toISOString();

    // 2. Mark record deleted and preserve tombstone in a transaction
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE evidence_deletion_requests
          SET status = 'approved', reviewed_by = ?, review_reason = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(actor.user_id, reason, now, now, pendingRequest.id, organizationId);

      this.db
        .prepare(`
          UPDATE evidence_items
          SET status = 'deleted', deleted_at = ?, deletion_reason = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(now, reason, now, evidenceId, organizationId);
    });

    tx();

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_deleted', true, {
      requestId: pendingRequest.id,
      reason,
      approvedBy: actor.user_id
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.deleted',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: {
        safe_display_name: item.safe_display_name,
        sha256: item.sha256,
        requestId: pendingRequest.id,
        reason
      },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  /**
   * Rejects a pending deletion request and restores evidence status.
   */
  public rejectDeletion(
    organizationId: string,
    evidenceId: string,
    reason: string,
    actor: ActorContext
  ): EvidenceItem {
    const item = this.getEvidenceById(organizationId, evidenceId);

    const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
    if (!allowedRoles.includes(actor.role)) {
      throw new EvidenceAccessDeniedError(`Role '${actor.role}' cannot reject evidence deletion.`);
    }

    const pendingRequest = this.db
      .prepare(`
        SELECT * FROM evidence_deletion_requests
        WHERE evidence_id = ? AND organization_id = ? AND status = 'pending'
        ORDER BY requested_at DESC LIMIT 1
      `)
      .get(evidenceId, organizationId) as EvidenceDeletionRequest | undefined;

    if (!pendingRequest) {
      throw new EvidenceError('No pending deletion request found for this evidence item.', 'NO_PENDING_DELETION_REQUEST');
    }

    const targetStatus: EvidenceStatus = item.sensitivity === 'prohibited' ? 'quarantined' : 'available';
    validateEvidenceStateTransition(item.status, targetStatus);

    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE evidence_deletion_requests
          SET status = 'rejected', reviewed_by = ?, review_reason = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(actor.user_id, reason, now, now, pendingRequest.id, organizationId);

      this.db
        .prepare(`
          UPDATE evidence_items
          SET status = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `)
        .run(targetStatus, now, evidenceId, organizationId);
    });

    tx();

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_deletion_rejected', true, {
      requestId: pendingRequest.id,
      reason
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.deletion_rejected',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: { requestId: pendingRequest.id, reason },
      ip_address: actor.ip_address
    });

    return this.getEvidenceById(organizationId, evidenceId);
  }

  public getPendingDeletionRequest(organizationId: string, evidenceId: string): EvidenceDeletionRequest | null {
    const req = this.db
      .prepare(`
        SELECT * FROM evidence_deletion_requests
        WHERE evidence_id = ? AND organization_id = ? AND status = 'pending'
        ORDER BY requested_at DESC LIMIT 1
      `)
      .get(evidenceId, organizationId) as EvidenceDeletionRequest | undefined;

    return req || null;
  }

  /**

   * Generates a time-limited HMAC-signed download token (300 seconds validity)
   */
  public generateSignedDownloadToken(
    organizationId: string,
    evidenceId: string,
    actor: ActorContext,
    expiresInSeconds: number = 300
  ): string {
    const item = this.getEvidenceById(organizationId, evidenceId);

    if (item.status === 'deleted') {
      throw new EvidenceError('Deleted evidence cannot be downloaded.', 'EVIDENCE_DELETED');
    }

    // Prohibited/restricted check: ordinary analysts cannot download
    if (item.sensitivity === 'prohibited' || item.status === 'quarantined') {
      const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
      if (!allowedRoles.includes(actor.role)) {
        throw new EvidenceAccessDeniedError(
          'Quarantined or prohibited evidence can only be downloaded by Case Managers or Legal Counsel.'
        );
      }
    }

    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload: DownloadTokenPayload = {
      evidenceId,
      organizationId,
      actorUserId: actor.user_id,
      expiresAt
    };

    const payloadJson = JSON.stringify(payload);
    const payloadB64 = Buffer.from(payloadJson).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.tokenSecret)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies an HMAC-signed download token
   */
  public verifyDownloadToken(token: string): DownloadTokenPayload {
    if (!token || typeof token !== 'string') {
      throw new EvidenceError('Download token required.', 'TOKEN_REQUIRED');
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new EvidenceError('Malformed download token.', 'INVALID_TOKEN');
    }

    const [payloadB64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', this.tokenSecret)
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSig);

    // Constant-time check with strict byte length equality to avoid RangeError
    if (sigBuf.length !== expectedSigBuf.length || !crypto.timingSafeEqual(sigBuf, expectedSigBuf)) {
      throw new EvidenceError('Invalid download token signature.', 'INVALID_TOKEN');
    }

    let payload: DownloadTokenPayload;
    try {
      const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(payloadJson) as DownloadTokenPayload;
    } catch {
      throw new EvidenceError('Malformed download token payload.', 'INVALID_TOKEN');
    }

    const currentUnix = Math.floor(Date.now() / 1000);
    if (!payload.expiresAt || currentUnix > payload.expiresAt) {
      throw new EvidenceError('Download token has expired.', 'TOKEN_EXPIRED');
    }

    // Reject deleted and retention-expired evidence
    if (payload.organizationId && payload.evidenceId) {
      const item = this.getEvidenceById(payload.organizationId, payload.evidenceId);
      if (item.status === 'deleted' || item.status === 'retention_expired') {
        throw new EvidenceError('Deleted or expired evidence cannot be downloaded.', 'EVIDENCE_DELETED');
      }
    }

    return payload;
  }

  /**
   * Streams an authorized evidence file payload
   */
  public async streamEvidencePayload(
    organizationId: string,
    evidenceId: string,
    actor: ActorContext
  ): Promise<{ stream: Readable; mimeType: string; byteSize: number; safeDisplayName: string; sha256: string }> {
    const item = this.getEvidenceById(organizationId, evidenceId);

    if (item.status === 'deleted' || item.status === 'retention_expired') {
      throw new EvidenceError('Deleted or expired evidence is no longer stored.', 'EVIDENCE_DELETED');
    }


    // Role verification for prohibited/quarantined items
    if (item.sensitivity === 'prohibited' || item.status === 'quarantined') {
      const allowedRoles: Role[] = ['case_manager', 'legal_reviewer', 'org_owner', 'system_admin'];
      if (!allowedRoles.includes(actor.role)) {
        throw new EvidenceAccessDeniedError('Access to quarantined evidence is restricted to authorized counsel.');
      }
    }

    const stream = await this.storage.get(item.storage_key);

    this.recordAccessEvent(organizationId, evidenceId, actor, 'evidence_download_completed', true, {
      sha256: item.sha256,
      byteSize: item.byte_size
    });

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'evidence.downloaded',
      resource_type: 'evidence',
      resource_id: evidenceId,
      details: {
        safe_display_name: item.safe_display_name,
        sha256: item.sha256
      },
      ip_address: actor.ip_address
    });

    return {
      stream,
      mimeType: item.detected_mime_type,
      byteSize: item.byte_size,
      safeDisplayName: item.safe_display_name,
      sha256: item.sha256
    };
  }

  /**
   * Retrieves active retention holds for an evidence item
   */
  public getHolds(organizationId: string, evidenceId: string): EvidenceRetentionHold[] {
    const stmt = this.db.prepare(`
      SELECT * FROM evidence_retention_holds
      WHERE organization_id = ? AND evidence_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(organizationId, evidenceId) as EvidenceRetentionHold[];
  }
}

let defaultEvidenceService: EvidenceService | null = null;

export function getEvidenceService(): EvidenceService {
  if (!defaultEvidenceService) {
    defaultEvidenceService = new EvidenceService();
  }
  return defaultEvidenceService;
}

export function setEvidenceService(service: EvidenceService | null): void {
  defaultEvidenceService = service;
}
