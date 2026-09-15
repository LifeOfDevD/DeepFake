import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { DuplicateCaseLink } from '../domain/types.js';
import { WorkflowTaskService } from './workflow-task-service.js';

export class DuplicateDetectionService {
  private workflowTaskService: WorkflowTaskService;

  constructor(private db: Database.Database = getDatabase()) {
    this.workflowTaskService = new WorkflowTaskService(this.db);
  }

  /**
   * Normalizes URLs by removing tracking parameters, normalizing hostnames and sorting query params
   */
  public normalizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();

      // Remove www. prefix for consistent matching
      if (parsed.hostname.startsWith('www.')) {
        parsed.hostname = parsed.hostname.slice(4);
      }

      // Tracking parameters to strip
      const trackingParams = new Set([
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
        'igshid',
        'ref',
        'source',
        'feature',
        'si',
        'trk'
      ]);

      const keys = Array.from(parsed.searchParams.keys());
      for (const key of keys) {
        if (trackingParams.has(key.toLowerCase())) {
          parsed.searchParams.delete(key);
        }
      }

      // Sort search parameters for deterministic URL
      parsed.searchParams.sort();

      // Normalize pathname
      let pathname = parsed.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }
      parsed.pathname = pathname;

      // Remove fragment
      parsed.hash = '';

      return parsed.toString();
    } catch {
      return rawUrl.trim().toLowerCase();
    }
  }

  /**
   * Detects duplicate incidents across existing cases in the tenant organization
   */
  public detectDuplicates(
    sourceCaseId: string,
    organizationId: string,
    contestedUrl: string
  ): DuplicateCaseLink[] {
    const normalizedUrl = this.normalizeUrl(contestedUrl);

    // Find matches in the same tenant organization
    const matches = this.db.prepare(`
      SELECT id, case_number, title, contested_url, normalized_contested_url, status
      FROM cases
      WHERE organization_id = ?
        AND id != ?
        AND normalized_contested_url = ?
    `).all(organizationId, sourceCaseId, normalizedUrl) as Array<{
      id: string;
      case_number: string;
      title: string;
      contested_url: string;
      normalized_contested_url: string;
      status: string;
    }>;

    const detectedLinks: DuplicateCaseLink[] = [];

    for (const match of matches) {
      const linkId = uuidv4();
      const matchReason = `Identical normalized target URL with existing case ${match.case_number}: ${match.title}`;
      const nowIso = new Date().toISOString();

      this.db.prepare(`
        INSERT INTO duplicate_case_links (
          id, organization_id, source_case_id, matched_case_id,
          match_reason, similarity_score, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 1.0, 'pending_review', ?)
      `).run(
        linkId,
        organizationId,
        sourceCaseId,
        match.id,
        matchReason,
        nowIso
      );

      // Create workflow task for analyst/manager review
      this.workflowTaskService.createTask({
        caseId: sourceCaseId,
        organizationId,
        taskType: 'duplicate_incident_review',
        priority: 'p2',
        assignedRole: 'analyst',
        creationReason: `Potential duplicate detected with existing case ${match.case_number} (${match.title}). Review required before proceeding.`
      });

      detectedLinks.push({
        id: linkId,
        organization_id: organizationId,
        source_case_id: sourceCaseId,
        matched_case_id: match.id,
        match_reason: matchReason,
        similarity_score: 1.0,
        status: 'pending_review',
        created_at: nowIso
      });
    }

    return detectedLinks;
  }

  /**
   * Fetches duplicate links for a given case
   */
  public getDuplicateLinks(caseId: string, organizationId: string): DuplicateCaseLink[] {
    const rows = this.db.prepare(`
      SELECT * FROM duplicate_case_links
      WHERE (source_case_id = ? OR matched_case_id = ?)
        AND organization_id = ?
      ORDER BY created_at DESC
    `).all(caseId, caseId, organizationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      organization_id: r.organization_id,
      source_case_id: r.source_case_id,
      matched_case_id: r.matched_case_id,
      match_reason: r.match_reason,
      similarity_score: r.similarity_score,
      status: r.status,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at,
      created_at: r.created_at
    }));
  }

  /**
   * Resolves a duplicate link
   */
  public resolveDuplicateLink(
    linkId: string,
    organizationId: string,
    actorUserId: string,
    status: 'confirmed_duplicate' | 'dismissed'
  ): DuplicateCaseLink {
    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE duplicate_case_links
      SET status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(status, actorUserId, nowIso, linkId, organizationId);

    const updated = this.db.prepare(`
      SELECT * FROM duplicate_case_links
      WHERE id = ? AND organization_id = ?
    `).get(linkId, organizationId) as any;

    return {
      id: updated.id,
      organization_id: updated.organization_id,
      source_case_id: updated.source_case_id,
      matched_case_id: updated.matched_case_id,
      match_reason: updated.match_reason,
      similarity_score: updated.similarity_score,
      status: updated.status,
      reviewed_by: updated.reviewed_by,
      reviewed_at: updated.reviewed_at,
      created_at: updated.created_at
    };
  }
}
