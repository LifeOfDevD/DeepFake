import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../services/tenant-service.js';
import { AuditService } from '../services/audit-service.js';

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required before tenant resolution.' }
    });
    return;
  }

  const tenantService = new TenantService();
  
  // Extract targeted organization ID
  const orgId = (req.headers['x-organization-id'] as string) ||
    req.params.organizationId ||
    (req.query.organization_id as string) ||
    (req.body && req.body.organization_id);

  if (!orgId) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_ORGANIZATION_CONTEXT',
        message: 'Request must include x-organization-id header or organization_id parameter.'
      }
    });
    return;
  }

  // System admin bypasses membership check, granted 'system_admin' pseudo-role
  if (req.user.system_role === 'system_admin') {
    const membership = tenantService.getMembership(req.user.id, orgId);
    if (!membership) {
      const auditService = new AuditService();
      auditService.record({
        organization_id: orgId,
        actor_user_id: req.user.id,
        actor_email: req.user.email,
        action: 'system_admin_cross_tenant_access',
        resource_type: 'organization',
        resource_id: orgId,
        details: { message: 'System admin accessed organization without direct membership' },
        ip_address: req.ip || '127.0.0.1'
      });
    }

    req.tenant = {
      organization_id: orgId,
      role: 'system_admin'
    };
    next();
    return;
  }

  // Check tenant membership
  const membership = tenantService.getMembership(req.user.id, orgId);
  if (!membership) {
    res.status(403).json({
      success: false,
      error: {
        code: 'TENANT_ACCESS_DENIED',
        message: `Forbidden: User does not belong to organization '${orgId}'.`
      }
    });
    return;
  }

  req.tenant = {
    organization_id: orgId,
    role: membership.role
  };

  next();
}
