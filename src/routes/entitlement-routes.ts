import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { EntitlementService } from '../services/entitlement-service.js';

export const entitlementRouter = Router();

entitlementRouter.use(authMiddleware);
entitlementRouter.use(tenantMiddleware);

/**
 * GET /api/entitlements
 * View plan tier, limits, and feature flags for active organization
 */
entitlementRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new EntitlementService();
    const entitlements = service.getEntitlements(req.tenant!.organization_id);

    res.json({
      success: true,
      data: entitlements
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entitlements/features
 * Quick check on feature flags for current organization
 */
entitlementRouter.get('/features', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new EntitlementService();
    const flags = service.getFeatureFlags(req.tenant!.organization_id);

    res.json({
      success: true,
      data: flags
    });
  } catch (err) {
    next(err);
  }
});
