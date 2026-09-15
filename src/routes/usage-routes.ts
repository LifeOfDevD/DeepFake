import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { UsageMeteringService } from '../services/usage-metering-service.js';
import { RecordUsageAdjustmentSchema } from '../domain/types.js';

export const usageRouter = Router();

usageRouter.use(authMiddleware);
usageRouter.use(tenantMiddleware);

/**
 * GET /api/usage/summary
 * Summarizes metered events for current organization
 */
usageRouter.get('/summary', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new UsageMeteringService();
    const startDate = (req.query.start_date as string) || undefined;
    const endDate = (req.query.end_date as string) || undefined;

    const summary = service.getUsageSummary(req.tenant!.organization_id, startDate, endDate);

    res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/usage/export
 * Export usage events in CSV or JSON format
 */
usageRouter.get('/export', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new UsageMeteringService();
    const format = (req.query.format as string) === 'csv' ? 'csv' : 'json';
    const startDate = (req.query.start_date as string) || undefined;
    const endDate = (req.query.end_date as string) || undefined;

    const result = service.exportUsage(req.tenant!.organization_id, format, startDate, endDate);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="usage-export-${req.tenant!.organization_id}.csv"`);
      res.send(result);
      return;
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/usage/adjustments
 * Apply an administrative usage correction / credit
 */
usageRouter.post(
  '/adjustments',
  requireRoles('system_admin', 'org_owner', 'org_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = RecordUsageAdjustmentSchema.parse(req.body);
      const service = new UsageMeteringService();

      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const record = service.recordAdjustment(req.tenant!.organization_id, input, actor);

      res.status(201).json({
        success: true,
        data: record
      });
    } catch (err) {
      next(err);
    }
  }
);
