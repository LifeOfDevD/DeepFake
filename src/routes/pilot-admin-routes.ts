import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { PilotAdminService } from '../services/pilot-admin-service.js';
import { BackupService } from '../services/backup-service.js';
import { WorkerManager } from '../workers/worker-manager.js';
import { UpdateEntitlementsSchema } from '../domain/types.js';

export const pilotAdminRouter = Router();

// Restrict all admin endpoints to system_admin role
pilotAdminRouter.use(authMiddleware);
pilotAdminRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user?.system_role !== 'system_admin') {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'System administrator privileges required.' }
    });
    return;
  }
  next();
});

/**
 * GET /api/admin/organizations
 */
pilotAdminRouter.get('/organizations', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const orgs = adminService.listOrganizations();
    res.json({ success: true, data: orgs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/organizations/:id
 */
pilotAdminRouter.get('/organizations/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const details = adminService.getOrganizationDetails(req.params.id as string);
    res.json({ success: true, data: details });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/organizations/:id/entitlements
 */
pilotAdminRouter.post('/organizations/:id/entitlements', (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = UpdateEntitlementsSchema.parse(req.body);
    const adminService = new PilotAdminService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'admin' as any,
      ip_address: req.ip
    };

    const updated = adminService.adjustEntitlements(req.params.id as string, input, actor);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/organizations/:id/suspend
 */
pilotAdminRouter.post('/organizations/:id/suspend', (req: Request, res: Response, next: NextFunction) => {
  try {
    const reason = req.body.reason || 'Administrative suspension';
    const adminService = new PilotAdminService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'admin' as any,
      ip_address: req.ip
    };

    const result = adminService.suspendOrganization(req.params.id as string, reason, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/organizations/:id/reactivate
 */
pilotAdminRouter.post('/organizations/:id/reactivate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'admin' as any,
      ip_address: req.ip
    };

    const result = adminService.reactivateOrganization(req.params.id as string, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/organizations/:id/offboard
 * Archival offboarding: soft deactivates organization preserving evidence and logs
 */
pilotAdminRouter.post('/organizations/:id/offboard', (req: Request, res: Response, next: NextFunction) => {
  try {
    const reason = req.body.reason || 'Customer subscription terminated - soft archival preservation';
    const adminService = new PilotAdminService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'admin' as any,
      ip_address: req.ip
    };

    const result = adminService.offboardOrganization(req.params.id as string, reason, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/workers
 */
pilotAdminRouter.get('/workers', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const heartbeats = adminService.getWorkerHeartbeats();
    res.json({ success: true, data: heartbeats });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/workers/:workerName/run
 */
pilotAdminRouter.post('/workers/:workerName/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workerManager = new WorkerManager();
    const result = await workerManager.runWorkerOnce(req.params.workerName as string);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/notifications/failed
 */
pilotAdminRouter.get('/notifications/failed', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const failed = adminService.listFailedNotifications();
    res.json({ success: true, data: failed });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/notifications/:id/retry
 */
pilotAdminRouter.post('/notifications/:id/retry', (req: Request, res: Response, next: NextFunction) => {
  try {
    const adminService = new PilotAdminService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'admin' as any,
      ip_address: req.ip
    };

    const result = adminService.retryFailedNotification(req.params.id as string, actor);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/backups
 */
pilotAdminRouter.get('/backups', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const backupService = new BackupService();
    const backups = backupService.listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/backups/create
 */
pilotAdminRouter.post('/backups/create', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const backupService = new BackupService();
    const result = await backupService.createBackup();
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/backups/:id/verify
 */
pilotAdminRouter.post('/backups/:id/verify', (req: Request, res: Response, next: NextFunction) => {
  try {
    const backupService = new BackupService();
    const result = backupService.verifyBackup(req.params.id as string);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
