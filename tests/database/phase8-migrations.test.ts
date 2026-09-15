import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrate.js';

describe('Database: Phase 8 Migrations (Controlled Read-Only Integrations)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON;');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('verifies that all Phase 8 integration tables exist', () => {
    const tables = [
      'provider_connections',
      'provider_connection_subjects',
      'provider_sync_cursors',
      'provider_circuit_states',
      'provider_webhook_subscriptions',
      'oauth_state_nonces'
    ];

    for (const table of tables) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(table) as { name: string } | undefined;
      expect(row, `Table ${table} should exist`).toBeDefined();
      expect(row?.name).toBe(table);
    }
  });

  it('verifies pilot_entitlements has Phase 8 columns', () => {
    const columns = db.prepare("PRAGMA table_info(pilot_entitlements)").all() as { name: string }[];
    const columnNames = columns.map(c => c.name);

    expect(columnNames).toContain('is_integration_canary_enabled');
    expect(columnNames).toContain('max_provider_connections');
  });

  it('verifies provider connection creation and cascading deletion on organization delete', () => {
    // 1. Prerequisites: organization, user, monitored subject
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_integ_01', 'Integrations Corp', 'integ-corp', 'healthcare', 'IN-DL', 'integ@example.in')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ('usr_integ_01', 'admin@example.in', 'Admin User', 'hash_pw')
    `).run();

    db.prepare(`
      INSERT INTO monitored_subjects (
        id, organization_id, subject_type, canonical_name, authorization_basis,
        authorization_reference, created_by_user_id
      ) VALUES (
        'sub_integ_01', 'org_integ_01', 'doctor', 'Dr. Rajesh Verma',
        'representation_agreement', 'REF-2026-001', 'usr_integ_01'
      )
    `).run();

    // 2. Create provider connection
    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, account_id, account_name,
        scopes, created_by_user_id
      ) VALUES (
        'conn_01', 'org_integ_01', 'youtube', 'connected', 'UC1234567890',
        'Dr. Rajesh Verma Official', '["https://www.googleapis.com/auth/youtube.readonly"]',
        'usr_integ_01'
      )
    `).run();

    // 3. Link subject to connection
    db.prepare(`
      INSERT INTO provider_connection_subjects (id, connection_id, subject_id)
      VALUES ('link_01', 'conn_01', 'sub_integ_01')
    `).run();

    // 4. Create cursor and circuit state
    db.prepare(`
      INSERT INTO provider_sync_cursors (id, connection_id, feed_type, last_cursor)
      VALUES ('cur_01', 'conn_01', 'channel_uploads', 'cursor_token_123')
    `).run();

    db.prepare(`
      INSERT INTO provider_circuit_states (connection_id, circuit_state)
      VALUES ('conn_01', 'closed')
    `).run();

    db.prepare(`
      INSERT INTO provider_webhook_subscriptions (id, connection_id, topic_url, hub_url, secret_hash)
      VALUES ('sub_01', 'conn_01', 'https://topic.example', 'https://hub.example', 'hash123')
    `).run();

    // 5. Verify data is present
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_connections').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_connection_subjects').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_sync_cursors').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_circuit_states').get()).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_webhook_subscriptions').get()).toEqual({ c: 1 });

    // 6. Delete monitored subject and verify provider_connection_subjects cascade
    db.prepare("DELETE FROM monitored_subjects WHERE id = 'sub_integ_01'").run();
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_connection_subjects').get()).toEqual({ c: 0 });

    // 7. Delete organization and verify remaining tables cascade
    db.prepare("DELETE FROM organizations WHERE id = 'org_integ_01'").run();

    expect(db.prepare('SELECT COUNT(*) as c FROM provider_connections').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_sync_cursors').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_circuit_states').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM provider_webhook_subscriptions').get()).toEqual({ c: 0 });
  });

  it('enforces UNIQUE constraints on cursor feed_type and oauth state_token', () => {
    db.prepare(`
      INSERT INTO organizations (id, name, slug, industry, jurisdiction, primary_contact_email)
      VALUES ('org_integ_02', 'Org 2', 'org-2', 'technology', 'IN-KA', 'org2@example.in')
    `).run();

    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash)
      VALUES ('usr_integ_02', 'user2@example.in', 'User Two', 'hash_pw')
    `).run();

    db.prepare(`
      INSERT INTO provider_connections (
        id, organization_id, provider_type, status, scopes, created_by_user_id
      ) VALUES (
        'conn_02', 'org_integ_02', 'youtube', 'pending_auth', '[]', 'usr_integ_02'
      )
    `).run();

    db.prepare(`
      INSERT INTO provider_sync_cursors (id, connection_id, feed_type)
      VALUES ('cur_a', 'conn_02', 'channel_uploads')
    `).run();

    // Duplicate feed_type for same connection should throw SQLite constraint error
    expect(() => {
      db.prepare(`
        INSERT INTO provider_sync_cursors (id, connection_id, feed_type)
        VALUES ('cur_b', 'conn_02', 'channel_uploads')
      `).run();
    }).toThrow();

    // OAuth state nonce uniqueness
    db.prepare(`
      INSERT INTO oauth_state_nonces (id, organization_id, user_id, provider_type, state_token, expires_at)
      VALUES ('nonce_1', 'org_integ_02', 'usr_integ_02', 'youtube', 'unique_token_xyz', '2026-12-31T23:59:59Z')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO oauth_state_nonces (id, organization_id, user_id, provider_type, state_token, expires_at)
        VALUES ('nonce_2', 'org_integ_02', 'usr_integ_02', 'youtube', 'unique_token_xyz', '2026-12-31T23:59:59Z')
      `).run();
    }).toThrow();
  });
});
