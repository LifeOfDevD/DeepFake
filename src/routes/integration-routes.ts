import express, { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { getDatabase } from '../db/connection.js';
import { getConfig } from '../config/env.js';
import { OAuthService } from '../services/integrations/oauth-service.js';
import { WebhookService } from '../services/integrations/webhook-service.js';
import { ProviderSyncService } from '../services/integrations/provider-sync-service.js';
import { YouTubeAdapter } from '../services/integrations/youtube-adapter.js';
import { AuditService } from '../services/audit-service.js';
import {
  InitiateOAuthSchema,
  CompleteOAuthSchema
} from '../domain/types.js';

export const integrationRouter = Router();

function getParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0];
  return val || '';
}

// ============================================================================
// 1. PUBLIC WEBSUB WEBHOOKS (Public WebSub Hub Handshake and Content Push)
// ============================================================================

// GET challenge verification from WebSub hub
integrationRouter.get('/youtube/webhook/:connectionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connectionId = getParam(req.params.connectionId);
    const webhookService = new WebhookService();
    const adapter = new YouTubeAdapter();

    const { statusCode, responseBody } = await webhookService.handleWebhook(
      connectionId,
      'GET',
      req.headers,
      '',
      adapter,
      req.query
    );

    if (typeof responseBody === 'string') {
      res.status(statusCode).type('text/plain').send(responseBody);
    } else {
      res.status(statusCode).json(responseBody);
    }
  } catch (err) {
    next(err);
  }
});

// POST content notification push from WebSub hub (supports raw XML/atom and JSON payloads)
integrationRouter.post(
  '/youtube/webhook/:connectionId',
  express.raw({ type: '*/*', limit: '2mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectionId = getParam(req.params.connectionId);
      const webhookService = new WebhookService();
      const adapter = new YouTubeAdapter();

      const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || ''));

      const { statusCode, responseBody } = await webhookService.handleWebhook(
        connectionId,
        'POST',
        req.headers,
        rawBody,
        adapter,
        req.query
      );

      if (typeof responseBody === 'string') {
        res.status(statusCode).type('text/plain').send(responseBody);
      } else {
        res.status(statusCode).json(responseBody);
      }
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// AUTHENTICATED SECTION (Requires Valid Session and Tenant Context)
// ============================================================================
integrationRouter.use(authMiddleware);
integrationRouter.use(tenantMiddleware);

// Middleware: Verify tenant has canary integration pilot entitlement
function requireCanaryOrg(req: Request, res: Response, next: NextFunction): void {
  const db = getDatabase();
  const orgId = req.tenant?.organization_id;
  if (!orgId) {
    res.status(403).json({ success: false, error: 'Tenant context missing' });
    return;
  }

  const ent = db.prepare(`
    SELECT is_integration_canary_enabled FROM pilot_entitlements WHERE organization_id = ?
  `).get(orgId) as { is_integration_canary_enabled?: number } | undefined;

  if (!ent || ent.is_integration_canary_enabled !== 1) {
    res.status(403).json({
      success: false,
      error: 'INTEGRATION_CANARY_DISABLED: Organization is not enrolled in the Controlled Read-Only Integrations pilot'
    });
    return;
  }

  next();
}

// ============================================================================
// 2. STATUS & EMERGENCY KILL SWITCH
// ============================================================================

// High-level integration status for the tenant
integrationRouter.get('/status', (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.tenant!.organization_id;
    const db = getDatabase();

    const ent = db.prepare(`
      SELECT is_integration_canary_enabled, max_provider_connections
      FROM pilot_entitlements WHERE organization_id = ?
    `).get(orgId) as { is_integration_canary_enabled?: number; max_provider_connections?: number } | undefined;

    const connCount = (db.prepare(`
      SELECT COUNT(*) as count FROM provider_connections
      WHERE organization_id = ? AND status != 'disconnected'
    `).get(orgId) as { count: number })?.count || 0;

    const totalExternalSignals = (db.prepare(`
      SELECT COUNT(*) as count FROM monitoring_signals
      WHERE organization_id = ? AND source_type = 'external_provider'
    `).get(orgId) as { count: number })?.count || 0;

    res.json({
      success: true,
      data: {
        canary_enabled: ent?.is_integration_canary_enabled === 1,
        active_connections: connCount,
        max_provider_connections: ent?.max_provider_connections || 2,
        kill_switch_active: ProviderSyncService.isGlobalKillSwitchActive(),
        total_external_signals: totalExternalSignals
      }
    });
  } catch (err) {
    next(err);
  }
});

// View global kill-switch status
integrationRouter.get('/kill-switch', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      kill_switch_active: ProviderSyncService.isGlobalKillSwitchActive()
    }
  });
});

// Admin-only toggle of global emergency kill-switch
integrationRouter.post(
  '/kill-switch',
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { active } = req.body;
      if (typeof active !== 'boolean') {
        res.status(400).json({ success: false, error: 'Field "active" must be a boolean' });
        return;
      }

      ProviderSyncService.setGlobalKillSwitch(active);

      const auditService = new AuditService(getDatabase());
      auditService.record({
        organization_id: req.tenant?.organization_id || 'system',
        actor_user_id: req.user!.id,
        actor_email: req.user!.email,
        action: active ? 'provider_kill_switch_engaged' : 'provider_kill_switch_disengaged',
        resource_type: 'provider_system',
        resource_id: 'global',
        details: { active }
      });

      res.json({
        success: true,
        data: {
          kill_switch_active: active
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 3. CANARY-RESTRICTED OAUTH & CONNECTION MANAGEMENT
// ============================================================================

// List connections (zero credentials leaked)
integrationRouter.get('/connections', requireCanaryOrg, (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.tenant!.organization_id;
    const db = getDatabase();
    const oauthService = new OAuthService(db);

    const connections = oauthService.listConnections(orgId);

    const enriched = connections.map((conn) => {
      const circuit = db.prepare(`SELECT * FROM provider_circuit_states WHERE connection_id = ?`).get(conn.id) as any;
      const subjectCount = (db.prepare(`
        SELECT COUNT(*) as count FROM provider_connection_subjects WHERE connection_id = ?
      `).get(conn.id) as any)?.count || 0;

      return {
        ...conn,
        linked_subjects_count: subjectCount,
        circuit_state: circuit?.circuit_state || 'closed',
        consecutive_failures: circuit?.consecutive_failures || 0,
        rate_limit_tokens_remaining: circuit?.rate_limit_tokens_remaining ?? 100
      };
    });

    res.json({
      success: true,
      data: enriched
    });
  } catch (err) {
    next(err);
  }
});

// Initiate OAuth flow
integrationRouter.post(
  '/oauth/initiate',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = InitiateOAuthSchema.parse(req.body);
      const orgId = req.tenant!.organization_id;
      const oauthService = new OAuthService();
      const adapter = new YouTubeAdapter();

      const redirectUri = validated.redirect_uri || `${getConfig().appUrl}/api/integrations/oauth/callback`;
      const { stateToken, expiresAt } = oauthService.generateState(
        orgId,
        req.user!.id,
        validated.provider_type,
        validated.subject_id
      );

      const authorizationUrl = adapter.getAuthorizationUrl(stateToken, redirectUri);

      res.json({
        success: true,
        data: {
          authorization_url: authorizationUrl,
          state: stateToken,
          expires_at: expiresAt
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// Complete OAuth exchange
integrationRouter.post(
  '/oauth/callback',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = CompleteOAuthSchema.parse(req.body);
      const orgId = req.tenant!.organization_id;
      const oauthService = new OAuthService();
      const adapter = new YouTubeAdapter();

      const connection = await oauthService.completeOAuthFlow(
        orgId,
        validated,
        adapter,
        req.user!.id
      );

      res.status(201).json({
        success: true,
        data: connection
      });
    } catch (err: any) {
      if (err.message && err.message.includes('OAUTH_STATE')) {
        res.status(400).json({ success: false, error: err.message });
        return;
      }
      if (err.message && err.message.includes('PROVIDER_QUOTA_EXCEEDED')) {
        res.status(409).json({ success: false, error: err.message });
        return;
      }
      next(err);
    }
  }
);

// Get connection details
integrationRouter.get('/connections/:id', requireCanaryOrg, (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = getParam(req.params.id);
    const orgId = req.tenant!.organization_id;
    const db = getDatabase();
    const oauthService = new OAuthService(db);

    const conn = oauthService.getConnection(orgId, id);
    if (!conn) {
      res.status(404).json({ success: false, error: 'CONNECTION_NOT_FOUND: Provider connection does not exist' });
      return;
    }

    const circuit = db.prepare(`SELECT * FROM provider_circuit_states WHERE connection_id = ?`).get(id);
    const subjects = db.prepare(`
      SELECT pcs.id as link_id, pcs.subject_id, ms.canonical_name, ms.subject_type, ms.authorization_basis, pcs.created_at as linked_at
      FROM provider_connection_subjects pcs
      JOIN monitored_subjects ms ON ms.id = pcs.subject_id
      WHERE pcs.connection_id = ?
    `).all(id);
    const cursors = db.prepare(`SELECT * FROM provider_sync_cursors WHERE connection_id = ?`).all(id);
    const subscriptions = db.prepare(`SELECT * FROM provider_webhook_subscriptions WHERE connection_id = ?`).all(id);

    res.json({
      success: true,
      data: {
        connection: conn,
        circuit: circuit || null,
        linked_subjects: subjects,
        cursors,
        subscriptions
      }
    });
  } catch (err) {
    next(err);
  }
});

// Trigger incremental manual sync
integrationRouter.post(
  '/connections/:id/sync',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getParam(req.params.id);
      const orgId = req.tenant!.organization_id;
      const db = getDatabase();
      const oauthService = new OAuthService(db);

      const conn = oauthService.getConnection(orgId, id);
      if (!conn) {
        res.status(404).json({ success: false, error: 'CONNECTION_NOT_FOUND: Provider connection not found' });
        return;
      }

      if (conn.status === 'disconnected' || conn.is_paused === 1) {
        res.status(400).json({ success: false, error: 'CONNECTION_INACTIVE: Cannot sync a paused or disconnected connection' });
        return;
      }

      const syncService = new ProviderSyncService(db);
      const result = await syncService.syncConnection(orgId, id, req.user!.id);

      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

// Pause connection
integrationRouter.post(
  '/connections/:id/pause',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getParam(req.params.id);
      const orgId = req.tenant!.organization_id;
      const oauthService = new OAuthService();

      oauthService.pauseConnection(orgId, id, req.user!.id);

      res.json({
        success: true,
        message: 'Provider connection paused successfully'
      });
    } catch (err: any) {
      if (err.message && err.message.includes('CONNECTION_NOT_FOUND')) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      next(err);
    }
  }
);

// Resume connection
integrationRouter.post(
  '/connections/:id/resume',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getParam(req.params.id);
      const orgId = req.tenant!.organization_id;
      const oauthService = new OAuthService();

      oauthService.resumeConnection(orgId, id, req.user!.id);

      res.json({
        success: true,
        message: 'Provider connection resumed successfully'
      });
    } catch (err: any) {
      if (err.message && err.message.includes('CONNECTION_NOT_FOUND')) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      next(err);
    }
  }
);

// Disconnect connection (purges credentials and cursors)
integrationRouter.post(
  '/connections/:id/disconnect',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getParam(req.params.id);
      const orgId = req.tenant!.organization_id;
      const oauthService = new OAuthService();

      oauthService.disconnect(orgId, id, req.user!.id);

      res.json({
        success: true,
        message: 'Provider connection disconnected and credentials wiped successfully'
      });
    } catch (err: any) {
      if (err.message && err.message.includes('CONNECTION_NOT_FOUND')) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      next(err);
    }
  }
);

// Update connection linked subjects
integrationRouter.put(
  '/connections/:id/subjects',
  requireCanaryOrg,
  requireRoles('system_admin', 'org_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = getParam(req.params.id);
      const orgId = req.tenant!.organization_id;
      const { subject_ids } = req.body;

      if (!Array.isArray(subject_ids)) {
        res.status(400).json({ success: false, error: 'subject_ids must be an array of strings' });
        return;
      }

      const oauthService = new OAuthService();
      oauthService.updateConnectionSubjects(orgId, id, subject_ids);

      res.json({
        success: true,
        message: 'Connection linked subjects updated successfully'
      });
    } catch (err: any) {
      if (err.message && err.message.includes('CONNECTION_NOT_FOUND')) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      if (err.message && err.message.includes('SUBJECT_NOT_FOUND')) {
        res.status(404).json({ success: false, error: err.message });
        return;
      }
      next(err);
    }
  }
);
