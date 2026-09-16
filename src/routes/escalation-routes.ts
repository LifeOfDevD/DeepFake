import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { EscalationService } from '../services/escalation-service.js';
import { CreateEscalationSchema, ResolveEscalationSchema } from '../domain/types.js';

export const escalationRouter = Router();

escalationRouter.use(authMiddleware);
escalationRouter.use(tenantMiddleware);

/**
 * GET /api/escalations
 * List all escalations for the current organization
 */
escalationRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new EscalationService();
    const escalations = service.getEscalationsForOrganization(req.tenant!.organization_id);
    res.json({
      success: true,
      data: escalations
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/escalations/cases/:caseId
 * List all escalations for a given case
 */
escalationRouter.get('/cases/:caseId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new EscalationService();
    const escalations = service.getEscalationsForCase(
      req.params.caseId as string,
      req.tenant!.organization_id
    );
    res.json({
      success: true,
      data: escalations
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/escalations
 * Create a new escalation record with recommended next actions
 */
escalationRouter.post(
  '/',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateEscalationSchema.parse(req.body);
      const service = new EscalationService();
      const escalation = await service.createEscalation(
        input,
        req.user!.id,
        req.tenant!.organization_id
      );
      res.status(201).json({
        success: true,
        data: escalation
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/escalations/:id/resolve
 * Resolve an escalation
 */
escalationRouter.patch(
  '/:id/resolve',
  requireRoles('case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = ResolveEscalationSchema.parse(req.body);
      const service = new EscalationService();
      const escalation = await service.resolveEscalation(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.json({
        success: true,
        data: escalation
      });
    } catch (err) {
      next(err);
    }
  }
);
