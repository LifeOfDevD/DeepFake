import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { PlatformRegistryService } from '../services/platform-registry-service.js';
import { PlatformPlaybookService } from '../services/platform-playbook-service.js';
import { AddPlatformPolicySchema } from '../domain/types.js';

export const platformRouter = Router();
export const playbookRouter = Router();

platformRouter.use(authMiddleware);
platformRouter.use(tenantMiddleware);
playbookRouter.use(authMiddleware);
playbookRouter.use(tenantMiddleware);

// --- Platforms Endpoints ---

/**
 * GET /api/platforms
 * Lists supported social platforms and intermediaries
 */
platformRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new PlatformRegistryService();
    const activeOnly = req.query.active_only !== 'false';
    const platforms = service.listPlatforms(activeOnly);
    res.json({
      success: true,
      data: platforms
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/platforms/:id
 * Retrieve platform details by ID or slug
 */
platformRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new PlatformRegistryService();
    const id = req.params.id as string;
    let platform = service.getPlatformById(id);
    if (!platform) {
      platform = service.getPlatformBySlug(id);
    }
    if (!platform) {
      res.status(404).json({
        success: false,
        error: { code: 'PLATFORM_NOT_FOUND', message: `Platform ${id} not found.` }
      });
      return;
    }
    res.json({
      success: true,
      data: platform
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/platforms/:id/policies
 * Add a new audited policy version (System Admin / Org Owner only)
 */
platformRouter.post(
  '/:id/policies',
  requireRoles('system_admin', 'org_owner'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = AddPlatformPolicySchema.parse(req.body);
      const service = new PlatformRegistryService();
      const version = service.addPolicyVersion(
        req.params.id as string,
        input,
        req.user!.id,
        req.user!.email
      );
      res.status(201).json({
        success: true,
        data: version
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/platforms/:id/policies
 * Get version history of platform policies
 */
platformRouter.get('/:id/policies', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new PlatformRegistryService();
    const versions = service.getPolicyVersions(req.params.id as string);
    res.json({
      success: true,
      data: versions
    });
  } catch (err) {
    next(err);
  }
});

// --- Playbooks Endpoints ---

/**
 * GET /api/playbooks
 * List all available platform grievance playbooks
 */
playbookRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new PlatformPlaybookService();
    const activeOnly = req.query.active_only !== 'false';
    const playbooks = service.listPlaybooks(activeOnly);
    res.json({
      success: true,
      data: playbooks
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/playbooks/:id
 * Retrieve playbook details by ID or slug
 */
playbookRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new PlatformPlaybookService();
    const id = req.params.id as string;
    let playbook = service.getPlaybookById(id);
    if (!playbook) {
      playbook = service.getPlaybookBySlug(id);
    }
    if (!playbook) {
      res.status(404).json({
        success: false,
        error: { code: 'PLAYBOOK_NOT_FOUND', message: `Playbook ${id} not found.` }
      });
      return;
    }
    res.json({
      success: true,
      data: playbook
    });
  } catch (err) {
    next(err);
  }
});
