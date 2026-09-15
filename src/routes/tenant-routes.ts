import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { TenantService } from '../services/tenant-service.js';
import { CreateOrganizationSchema, InviteUserSchema } from '../domain/types.js';

export const tenantRouter = Router();

tenantRouter.use(authMiddleware);

/**
 * GET /api/organizations
 * Lists all registered organizations
 */
tenantRouter.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantService = new TenantService();
    const orgs = tenantService.listOrganizations();
    res.json({ success: true, data: orgs });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/organizations
 * Creates a new organization workspace
 */
tenantRouter.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedInput = CreateOrganizationSchema.parse(req.body);
    const tenantService = new TenantService();

    const newOrg = tenantService.createOrganization(validatedInput, {
      user_id: req.user!.id,
      email: req.user!.email,
      role: 'org_owner',
      ip_address: req.ip
    });

    res.status(201).json({ success: true, data: newOrg });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/organizations/:id
 */
tenantRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.id as string;
    const tenantService = new TenantService();
    const org = tenantService.getOrganizationById(orgId);

    if (!org) {
      res.status(404).json({
        success: false,
        error: { code: 'ORGANIZATION_NOT_FOUND', message: `Organization '${orgId}' not found.` }
      });
      return;
    }

    res.json({ success: true, data: org });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/organizations/:id/invites
 * Invites a user to the organization with a specific role
 */
tenantRouter.post('/:id/invites', (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = req.params.id as string;
    const validatedInput = InviteUserSchema.parse(req.body);
    const tenantService = new TenantService();

    // Check inviter's role in this organization
    const membership = tenantService.getMembership(req.user!.id, orgId);
    if (!membership && req.user!.system_role !== 'system_admin') {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not belong to this organization.' }
      });
      return;
    }

    const inviterRole = req.user!.system_role === 'system_admin' ? 'system_admin' : membership!.role;

    const result = tenantService.inviteUser(orgId, validatedInput, {
      user_id: req.user!.id,
      email: req.user!.email,
      role: inviterRole,
      ip_address: req.ip
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});
