import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/connection.js';
import {
  RecordUsageAdjustmentInput,
  UsageDailyAggregateRecord,
  UsageEventRecord,
  UsageEventType
} from '../domain/types.js';
import { AuditService } from './audit-service.js';
import { ActorContext } from './case-service.js';

export interface RecordUsageEventInput {
  organization_id: string;
  event_type: UsageEventType;
  quantity?: number;
  idempotency_key: string;
  resource_id?: string | null;
  actor_user_id?: string | null;
  metadata?: Record<string, any> | null;
}

export class UsageMeteringService {
  private auditService: AuditService;

  constructor(private db: Database.Database = getDatabase()) {
    this.auditService = new AuditService(this.db);
  }

  /**
   * Records a raw usage event with idempotency guarantees (no double-counting)
   */
  public recordEvent(input: RecordUsageEventInput): UsageEventRecord {
    const existing = this.db
      .prepare('SELECT * FROM usage_events WHERE idempotency_key = ?')
      .get(input.idempotency_key) as UsageEventRecord | undefined;

    if (existing) {
      return existing; // Idempotent no-op
    }

    const id = `use_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const dateKey = nowIso.slice(0, 10);
    const quantity = input.quantity ?? 1;

    const stmt = this.db.prepare(`
      INSERT INTO usage_events (
        id, organization_id, event_type, quantity, idempotency_key,
        resource_id, actor_user_id, metadata, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.organization_id,
      input.event_type,
      quantity,
      input.idempotency_key,
      input.resource_id || null,
      input.actor_user_id || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      nowIso
    );

    // Update daily aggregate rollup
    this.incrementDailyAggregate(input.organization_id, dateKey, input.event_type, quantity);

    return this.getEventById(id)!;
  }

  public getEventById(id: string): UsageEventRecord | null {
    const row = this.db.prepare('SELECT * FROM usage_events WHERE id = ?').get(id) as UsageEventRecord | undefined;
    return row || null;
  }

  private incrementDailyAggregate(
    organizationId: string,
    date: string,
    eventType: UsageEventType,
    quantity: number
  ): void {
    const aggId = `agg_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO usage_daily_aggregates (id, organization_id, date, event_type, total_quantity, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, date, event_type) DO UPDATE SET
        total_quantity = total_quantity + excluded.total_quantity,
        updated_at = excluded.updated_at
    `);

    stmt.run(aggId, organizationId, date, eventType, quantity, nowIso);
  }

  /**
   * Retrieves daily aggregates for an organization
   */
  public getDailyAggregates(
    organizationId: string,
    startDate?: string,
    endDate?: string
  ): UsageDailyAggregateRecord[] {
    let query = 'SELECT * FROM usage_daily_aggregates WHERE organization_id = ?';
    const params: any[] = [organizationId];

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY date DESC, event_type ASC';
    return this.db.prepare(query).all(...params) as UsageDailyAggregateRecord[];
  }

  /**
   * Computes an itemized usage summary across all metric categories
   */
  public getUsageSummary(
    organizationId: string,
    startDate?: string,
    endDate?: string
  ): Record<UsageEventType, number> {
    const aggregates = this.getDailyAggregates(organizationId, startDate, endDate);

    const summary: Record<string, number> = {
      case_created: 0,
      evidence_uploaded: 0,
      evidence_bytes_stored: 0,
      evidence_downloaded: 0,
      packet_generated: 0,
      submission_simulated: 0,
      response_recorded: 0,
      task_created: 0,
      task_completed: 0,
      user_active: 0
    };

    for (const agg of aggregates) {
      summary[agg.event_type] = (summary[agg.event_type] || 0) + agg.total_quantity;
    }

    return summary as Record<UsageEventType, number>;
  }

  /**
   * Exports usage data formatted as JSON or CSV
   */
  public exportUsage(
    organizationId: string,
    format: 'json' | 'csv',
    startDate?: string,
    endDate?: string
  ): string {
    const aggregates = this.getDailyAggregates(organizationId, startDate, endDate);

    if (format === 'json') {
      return JSON.stringify(aggregates, null, 2);
    }

    // CSV format
    const header = 'date,organization_id,event_type,total_quantity\n';
    const rows = aggregates
      .map((a) => `${a.date},${a.organization_id},${a.event_type},${a.total_quantity}`)
      .join('\n');

    return header + rows;
  }

  /**
   * Administrator manual usage adjustment
   */
  public recordAdjustment(
    organizationId: string,
    input: RecordUsageAdjustmentInput,
    actor: ActorContext
  ): void {
    if (actor.role !== 'system_admin' && actor.role !== 'org_owner') {
      throw new Error('Only System Administrators or Owners can make manual usage adjustments.');
    }

    const id = `adj_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const nowIso = new Date().toISOString();
    const dateKey = nowIso.slice(0, 10);

    const stmt = this.db.prepare(`
      INSERT INTO usage_adjustments (id, organization_id, event_type, quantity_delta, reason, adjusted_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, organizationId, input.event_type, input.quantity_delta, input.reason.trim(), actor.user_id, nowIso);

    // Apply adjustment to daily aggregates
    this.incrementDailyAggregate(organizationId, dateKey, input.event_type, input.quantity_delta);

    this.auditService.record({
      organization_id: organizationId,
      actor_user_id: actor.user_id,
      actor_email: actor.email,
      action: 'usage.adjusted',
      resource_type: 'usage_adjustment',
      resource_id: id,
      details: {
        event_type: input.event_type,
        quantity_delta: input.quantity_delta,
        reason: input.reason
      },
      ip_address: actor.ip_address
    });
  }
}
