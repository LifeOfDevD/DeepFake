import { Request, Response, NextFunction } from 'express';
import { Role } from '../domain/types.js';

export function requireRoles(...allowedRoles: (Role | 'system_admin')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenant) {
      res.status(403).json({
        success: false,
        error: { code: 'TENANT_CONTEXT_MISSING', message: 'Tenant context required for RBAC evaluation.' }
      });
      return;
    }

    // System admins have universal operational access
    if (req.tenant.role === 'system_admin') {
      next();
      return;
    }

    if (!allowedRoles.includes(req.tenant.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Action requires one of [${allowedRoles.join(', ')}]. Current role: '${req.tenant.role}'.`
        }
      });
      return;
    }

    next();
  };
}
