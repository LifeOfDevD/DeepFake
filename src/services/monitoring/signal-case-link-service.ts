import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../db/connection.js';
import {
  SignalCaseLink,
  SignalCaseLinkType
} from '../../domain/types.js';
import { AuditService } from '../audit-service.js';

export interface LinkSignalOptions {
  signalId: string;
  caseId: string;
  linkType?: SignalCaseLinkType;
  actorUserId: string;
  organizationId: string;
}

export interface DuplicateUrlWarning {
  hasDuplicate: boolean;
  duplicateCaseId?: string;
  duplicateCaseNumber?: string;
  status?: string;
}

export class SignalCaseLinkService {
  private db: Database.Database;
  private auditService: AuditService;

  constructor(db?: Database.Database) {
    this.db = db || getDatabase();
    this.auditService = new AuditService(this.db);
  }

  /**
   * Links a monitoring signal to a case and records audit trail
   */
  public linkSignalToCase(options: LinkSignalOptions): SignalCaseLink {
    const {
      signalId,
      caseId,
      linkType = 'evidence',
      actorUserId,
      organizationId
    } = options;

    // Verify case exists and belongs to tenant
    const caseRow = this.db.prepare(`
      SELECT id, case_number, contested_url FROM cases WHERE id = ? AND organization_id = ?
    `).get(caseId, organizationId) as { id: string; case_number: string; contested_url: string } | undefined;

    if (!caseRow) {
      throw new Error(`NOT_FOUND: Case ${caseId} not found in organization`);
    }

    // Verify signal exists and belongs to tenant
    const signalRow = this.db.prepare(`
      SELECT id, normalized_url FROM monitoring_signals WHERE id = ? AND organization_id = ?
    `).get(signalId, organizationId) as { id: string; normalized_url: string } | undefined;

    if (!signalRow) {
      throw new Error(`NOT_FOUND: Signal ${signalId} not found in organization`);
    }

    // Check if link already exists
    const existing = this.db.prepare(`
      SELECT * FROM signal_case_links WHERE signal_id = ? AND case_id = ?
    `).get(signalId, caseId) as any;

    if (existing) {
      return {
        id: existing.id,
        signal_id: existing.signal_id,
        case_id: existing.case_id,
        link_type: existing.link_type,
        linked_by_user_id: existing.linked_by_user_id,
        linked_at: existing.linked_at
      };
    }

    const id = `lnk_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();

    const link: SignalCaseLink = {
      id,
      signal_id: signalId,
      case_id: caseId,
      link_type: linkType,
      linked_by_user_id: actorUserId,
      linked_at: now
    };

    this.db.prepare(`
      INSERT INTO signal_case_links (id, signal_id, case_id, link_type, linked_by_user_id, linked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(link.id, link.signal_id, link.case_id, link.link_type, link.linked_by_user_id, link.linked_at);

    this.auditService.record({
      action: 'signal_linked_to_case',
      resource_type: 'signal_case_link',
      resource_id: link.id,
      organization_id: organizationId,
      actor_user_id: actorUserId,
      actor_email: 'analyst@desk.internal',
      details: {
        signal_id: signalId,
        case_id: caseId,
        link_type: linkType
      }
    });

    return link;
  }

  /**
   * Checks if signal normalized URL already exists as contested URL in any active case
   */
  public checkForDuplicateUrl(
    organizationId: string,
    normalizedUrl: string
  ): DuplicateUrlWarning {
    const match = this.db.prepare(`
      SELECT id, case_number, status FROM cases
      WHERE organization_id = ? AND (
        contested_url = ? OR
        normalized_contested_url = ?
      )
      LIMIT 1
    `).get(organizationId, normalizedUrl, normalizedUrl) as { id: string; case_number: string; status: string } | undefined;

    if (match) {
      return {
        hasDuplicate: true,
        duplicateCaseId: match.id,
        duplicateCaseNumber: match.case_number,
        status: match.status
      };
    }

    return { hasDuplicate: false };
  }

  public getLinksForSignal(signalId: string): SignalCaseLink[] {
    const rows = this.db.prepare(`
      SELECT * FROM signal_case_links WHERE signal_id = ? ORDER BY linked_at DESC
    `).all(signalId) as any[];

    return rows.map((r) => ({
      id: r.id,
      signal_id: r.signal_id,
      case_id: r.case_id,
      link_type: r.link_type,
      linked_by_user_id: r.linked_by_user_id,
      linked_at: r.linked_at
    }));
  }

  public getLinksForCase(caseId: string): SignalCaseLink[] {
    const rows = this.db.prepare(`
      SELECT * FROM signal_case_links WHERE case_id = ? ORDER BY linked_at DESC
    `).all(caseId) as any[];

    return rows.map((r) => ({
      id: r.id,
      signal_id: r.signal_id,
      case_id: r.case_id,
      link_type: r.link_type,
      linked_by_user_id: r.linked_by_user_id,
      linked_at: r.linked_at
    }));
  }
}
