import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import { AuditEvent } from '../domain/types.js';

export interface RecordAuditInput {
  organization_id: string;
  actor_user_id: string;
  actor_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: Record<string, unknown> | string;
  ip_address?: string;
}

export class AuditService {
  constructor(private db: Database.Database = getDatabase()) {}

  public record(input: RecordAuditInput): AuditEvent {
    const id = `aud_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date().toISOString();
    const detailsStr = typeof input.details === 'string' ? input.details : JSON.stringify(input.details);
    const ip = input.ip_address || '127.0.0.1';

    const stmt = this.db.prepare(`
      INSERT INTO audit_events (
        id, organization_id, actor_user_id, actor_email, action,
        resource_type, resource_id, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.organization_id,
      input.actor_user_id,
      input.actor_email,
      input.action,
      input.resource_type,
      input.resource_id,
      detailsStr,
      ip,
      now
    );

    return {
      id,
      organization_id: input.organization_id,
      actor_user_id: input.actor_user_id,
      actor_email: input.actor_email,
      action: input.action,
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      details: detailsStr,
      ip_address: ip,
      created_at: now
    };
  }

  public listByOrganization(organization_id: string, limit: number = 50): AuditEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_events
      WHERE organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(organization_id, limit) as AuditEvent[];
  }

  public listByResource(organization_id: string, resource_id: string): AuditEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_events
      WHERE organization_id = ? AND resource_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(organization_id, resource_id) as AuditEvent[];
  }
}
