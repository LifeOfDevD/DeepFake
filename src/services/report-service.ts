import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { ReportType, GenerateReportInput } from '../domain/types.js';

export interface ReportResult {
  reportType: ReportType;
  organizationId: string;
  generatedAt: string;
  rowCount: number;
  data: Record<string, any>[];
  csvContent?: string;
}

export class ReportService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Helper to format rows as CSV
   */
  public toCsv(rows: Record<string, any>[]): string {
    if (!rows || rows.length === 0) {
      return '';
    }

    const headers = Object.keys(rows[0]);
    const escapeCsvField = (val: any): string => {
      if (val === null || val === undefined) return '';
      let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        str = `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = headers.map(escapeCsvField).join(',');
    const dataLines = rows.map((row) =>
      headers.map((h) => escapeCsvField(row[h])).join(',')
    );

    return [headerLine, ...dataLines].join('\r\n');
  }

  /**
   * Generates a tenant-scoped operational report
   */
  public async generateReport(
    organizationId: string,
    input: GenerateReportInput
  ): Promise<ReportResult> {
    const { report_type: reportType, format = 'json', start_date: startDate, end_date: endDate } = input;
    const now = new Date().toISOString();
    let rows: Record<string, any>[] = [];

    switch (reportType) {
      case 'open_cases': {
        let sql = `
          SELECT 
            c.id AS case_id,
            c.case_number,
            c.title,
            c.category,
            c.priority,
            c.status,
            c.target_entity,
            c.hosting_platform,
            c.created_at,
            c.updated_at,
            u.full_name AS assigned_to_name,
            u.email AS assigned_to_email
          FROM cases c
          LEFT JOIN users u ON c.assigned_to_user_id = u.id
          WHERE c.organization_id = ?
            AND c.status NOT IN ('closed', 'resolved')
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND c.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND c.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY c.created_at DESC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'statutory_clocks_overdue': {
        let sql = `
          SELECT 
            sc.id AS clock_id,
            c.id AS case_id,
            c.case_number,
            c.title,
            sc.current_status,
            sc.operational_rule,
            sc.incident_discovered_at,
            sc.complaint_created_at,
            sc.acknowledgement_deadline,
            sc.submission_deadline,
            sc.escalation_deadline,
            sc.timezone,
            sc.source_citation
          FROM statutory_clocks sc
          JOIN cases c ON sc.case_id = c.id
          WHERE sc.organization_id = ?
            AND (sc.current_status = 'overdue' OR sc.submission_deadline < datetime('now'))
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND sc.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND sc.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY sc.submission_deadline ASC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'active_escalations': {
        let sql = `
          SELECT 
            ce.id AS escalation_id,
            c.id AS case_id,
            c.case_number,
            c.title,
            ce.trigger_type,
            ce.severity,
            ce.recommended_next_action,
            ce.resolution_status,
            ce.due_at,
            ce.created_at,
            u.full_name AS assigned_owner_name
          FROM case_escalations ce
          JOIN cases c ON ce.case_id = c.id
          LEFT JOIN users u ON ce.assigned_owner_id = u.id
          WHERE ce.organization_id = ?
            AND ce.resolution_status IN ('open', 'investigating', 'action_recommended')
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND ce.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND ce.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY ce.created_at DESC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'evidence_inventory': {
        let sql = `
          SELECT 
            ei.id AS evidence_id,
            c.case_number,
            ei.safe_display_name,
            ei.original_filename,
            ei.mime_type,
            ei.byte_size,
            ei.sha256,
            ei.status,
            ei.legal_hold,
            ei.retention_until,
            ei.created_at
          FROM evidence_items ei
          LEFT JOIN cases c ON ei.case_id = c.id
          WHERE ei.organization_id = ?
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND ei.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND ei.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY ei.created_at DESC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'retention_schedule': {
        let sql = `
          SELECT 
            ei.id AS evidence_id,
            c.case_number,
            ei.safe_display_name,
            ei.status,
            ei.legal_hold,
            (SELECT reason FROM evidence_retention_holds WHERE evidence_id = ei.id AND released_at IS NULL LIMIT 1) AS legal_hold_reason,
            ei.retention_until,
            ei.deleted_at,
            ei.deletion_reason,
            ei.created_at
          FROM evidence_items ei
          LEFT JOIN cases c ON ei.case_id = c.id
          WHERE ei.organization_id = ?
            AND (ei.retention_until IS NOT NULL OR ei.status = 'retention_expired' OR ei.legal_hold = 1)
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND ei.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND ei.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY ei.retention_until ASC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'submission_simulation_history': {
        let sql = `
          SELECT 
            s.id AS submission_id,
            c.case_number,
            c.title AS case_title,
            pr.name AS platform_name,
            s.status,
            s.simulated_reference_id,
            s.simulated_at,
            s.packet_version,
            s.packet_hash,
            s.created_at
          FROM submissions s
          JOIN cases c ON s.case_id = c.id
          LEFT JOIN platform_registry pr ON s.platform_id = pr.id
          WHERE s.organization_id = ?
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND s.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND s.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY s.created_at DESC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'response_outcomes': {
        let sql = `
          SELECT 
            sr.id AS response_id,
            s.id AS submission_id,
            c.case_number,
            pr.name AS platform_name,
            sr.platform_reference_number,
            sr.response_category,
            sr.takedown_result,
            sr.rejection_reason,
            sr.response_received_at,
            sr.created_at
          FROM submission_responses sr
          JOIN submissions s ON sr.submission_id = s.id
          JOIN cases c ON s.case_id = c.id
          LEFT JOIN platform_registry pr ON sr.platform_id = pr.id
          WHERE sr.organization_id = ?
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND sr.created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND sr.created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY sr.created_at DESC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      case 'usage_summary': {
        let sql = `
          SELECT 
            event_type AS metric_name,
            SUM(total_quantity) AS aggregate_quantity,
            MIN(date) AS earliest_date,
            MAX(date) AS latest_date
          FROM usage_daily_aggregates
          WHERE organization_id = ?
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND date >= ?`;
          params.push(startDate.split('T')[0]);
        }
        if (endDate) {
          sql += ` AND date <= ?`;
          params.push(endDate.split('T')[0]);
        }
        sql += ` GROUP BY event_type ORDER BY event_type ASC`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];

        // Also fetch active user count and total cases currently stored
        const orgInfo = this.db
          .prepare(`
            SELECT 
              (SELECT COUNT(*) FROM memberships WHERE organization_id = ?) AS active_members,
              (SELECT COUNT(*) FROM cases WHERE organization_id = ?) AS total_cases,
              (SELECT COALESCE(SUM(byte_size), 0) FROM evidence_items WHERE organization_id = ? AND status = 'available') AS evidence_bytes_stored
          `)
          .get(organizationId, organizationId, organizationId) as any;

        rows.push({
          metric_name: 'active_members_current',
          aggregate_quantity: orgInfo?.active_members || 0,
          earliest_date: null,
          latest_date: null
        });
        rows.push({
          metric_name: 'cases_total_active',
          aggregate_quantity: orgInfo?.total_cases || 0,
          earliest_date: null,
          latest_date: null
        });
        rows.push({
          metric_name: 'evidence_mb_stored_current',
          aggregate_quantity: Math.round(((orgInfo?.evidence_bytes_stored || 0) / (1024 * 1024)) * 100) / 100,
          earliest_date: null,
          latest_date: null
        });
        break;
      }

      case 'audit_timeline': {
        let sql = `
          SELECT 
            id AS audit_id,
            actor_email,
            action,
            resource_type,
            resource_id,
            details,
            created_at AS timestamp
          FROM audit_events
          WHERE organization_id = ?
        `;
        const params: any[] = [organizationId];
        if (startDate) {
          sql += ` AND created_at >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND created_at <= ?`;
          params.push(endDate);
        }
        sql += ` ORDER BY created_at DESC LIMIT 500`;
        rows = this.db.prepare(sql).all(...params) as Record<string, any>[];
        break;
      }

      default:
        throw new Error(`Unsupported report type: ${reportType}`);
    }

    const result: ReportResult = {
      reportType,
      organizationId,
      generatedAt: now,
      rowCount: rows.length,
      data: rows
    };

    if (format === 'csv') {
      result.csvContent = this.toCsv(rows);
    }

    return result;
  }
}
