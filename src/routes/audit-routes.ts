import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { AuditService } from '../services/audit-service.js';

export const auditRouter = Router();

auditRouter.use(authMiddleware);
auditRouter.use(tenantMiddleware);

/**
 * GET /api/audit-events
 * Lists audit records for the tenant organization
 */
auditRouter.get(
  '/',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditService = new AuditService();
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const events = auditService.listByOrganization(req.tenant!.organization_id, limit);

      res.json({
        success: true,
        data: events.map((evt) => ({
          ...evt,
          details: typeof evt.details === 'string' ? JSON.parse(evt.details) : evt.details
        }))
      });
    } catch (err) {
      next(err);
    }
  }
);
