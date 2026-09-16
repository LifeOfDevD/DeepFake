import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { ReuploadMonitoringService } from '../services/reupload-monitoring-service.js';
import {
  AddRelatedContentSchema,
  UpdateRelatedContentStatusSchema
} from '../domain/types.js';

export const reuploadRouter = Router();

reuploadRouter.use(authMiddleware);
reuploadRouter.use(tenantMiddleware);

/**
 * GET /api/re-uploads
 * List all related content and re-upload observations for the current organization
 */
reuploadRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new ReuploadMonitoringService();
    const observations = service.getObservationsForOrganization(req.tenant!.organization_id);
    res.json({
      success: true,
      data: observations
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/re-uploads/cases/:caseId
 * List all related content and re-upload observations for a case
 */
reuploadRouter.get('/cases/:caseId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new ReuploadMonitoringService();
    const observations = service.getObservationsForCase(
      req.params.caseId as string,
      req.tenant!.organization_id
    );
    res.json({
      success: true,
      data: observations
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/re-uploads
 * Record a new manually observed related URL or re-upload
 */
reuploadRouter.post(
  '/',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = AddRelatedContentSchema.parse(req.body);
      const service = new ReuploadMonitoringService();
      const observation = await service.addObservation(
        input,
        req.user!.id,
        req.tenant!.organization_id
      );
      res.status(201).json({
        success: true,
        data: observation
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/re-uploads/:id/status
 * Update observation verification status
 */
reuploadRouter.patch(
  '/:id/status',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = UpdateRelatedContentStatusSchema.parse(req.body);
      const service = new ReuploadMonitoringService();
      const observation = await service.updateStatus(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.json({
        success: true,
        data: observation
      });
    } catch (err) {
      next(err);
    }
  }
);
