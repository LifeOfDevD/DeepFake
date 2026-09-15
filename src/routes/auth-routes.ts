import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { TenantService } from '../services/tenant-service.js';
import { authMiddleware, createSessionToken, revokeSessionToken } from '../middleware/auth.js';
import { AccountLockoutService } from '../security/account-lockout.js';

export const authRouter = Router();

/**
 * Returns current authenticated user and all accessible memberships
 */
authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  const tenantService = new TenantService();
  const memberships = tenantService.getUserMemberships(req.user!.id);

  res.json({
    success: true,
    data: {
      user: {
        id: req.user!.id,
        email: req.user!.email,
        full_name: req.user!.full_name,
        system_role: req.user!.system_role
      },
      memberships: memberships.map((m) => ({
        organization_id: m.organization_id,
        organization_name: m.organization_name,
        organization_slug: m.organization_slug,
        role: m.role
      }))
    }
  });
});

/**
 * Demo helper endpoint: returns available seeded users for fast switcher in UI & tests
 */
authRouter.get('/demo-users', (_req: Request, res: Response) => {
  const tenantService = new TenantService();
  const users = (tenantService as any).db
    .prepare(`
      SELECT u.id, u.email, u.full_name, u.system_role, m.organization_id, m.role, o.name as organization_name
      FROM users u
      LEFT JOIN memberships m ON m.user_id = u.id
      LEFT JOIN organizations o ON o.id = m.organization_id
      ORDER BY u.id ASC
    `)
    .all();

  res.json({
    success: true,
    data: users
  });
});

/**
 * Production-hardened login endpoint with Account Lockout protection
 */
authRouter.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ success: false, error: 'INVALID_REQUEST: Email and password are required' });
    return;
  }

  // 1. Check account lockout state
  const lockoutStatus = AccountLockoutService.checkLockout(email);
  if (lockoutStatus.isLocked) {
    res.status(429).json({
      success: false,
      error: `ACCOUNT_TEMPORARILY_LOCKED: Too many failed login attempts. Please try again in ${lockoutStatus.remainingSeconds} seconds.`,
      retryAfterSeconds: lockoutStatus.remainingSeconds
    });
    return;
  }

  // 2. Validate user credentials
  const tenantService = new TenantService();
  const db = (tenantService as any).db;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as any;

  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  const passwordValid = user && (user.password_hash === inputHash || user.password_hash === password);

  if (!user || !passwordValid) {
    const postFailStatus = AccountLockoutService.recordFailedAttempt(email);
    if (postFailStatus.isLocked) {
      res.status(429).json({
        success: false,
        error: `ACCOUNT_TEMPORARILY_LOCKED: Too many failed login attempts. Account locked for ${postFailStatus.remainingSeconds} seconds.`,
        retryAfterSeconds: postFailStatus.remainingSeconds
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: 'INVALID_CREDENTIALS: Email or password is incorrect',
      attemptsRemaining: postFailStatus.attemptsRemaining
    });
    return;
  }

  // 3. Reset failed attempts upon success
  AccountLockoutService.recordSuccessfulLogin(email);

  // 4. Fetch primary membership and generate Bearer session token
  const memberships = tenantService.getUserMemberships(user.id);
  const primaryMembership = memberships[0] || null;

  const token = createSessionToken({
    id: user.id,
    email: user.email,
    system_role: user.system_role
  });

  res.json({
    success: true,
    message: 'Authentication successful',
    token,
    data: {
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        system_role: user.system_role
      },
      token,
      activeOrganizationId: primaryMembership?.organization_id || null,
      role: primaryMembership?.role || null,
      memberships
    }
  });
});

/**
 * Logout / Session invalidation endpoint
 */
authRouter.post('/logout', authMiddleware, (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    revokeSessionToken(authHeader.slice(7).trim());
  }
  res.json({
    success: true,
    message: 'Session terminated successfully'
  });
});

/**
 * Validated organization switching
 */
authRouter.post('/switch-organization', authMiddleware, (req: Request, res: Response) => {
  const { organization_id } = req.body || {};
  if (!organization_id) {
    res.status(400).json({ success: false, error: 'ORGANIZATION_ID_REQUIRED' });
    return;
  }

  const tenantService = new TenantService();
  const memberships = tenantService.getUserMemberships(req.user!.id);
  const targetMembership = memberships.find((m) => m.organization_id === organization_id);

  if (!targetMembership) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN_ORGANIZATION: User does not hold active membership in target organization'
    });
    return;
  }

  res.json({
    success: true,
    message: 'Active organization switched',
    data: {
      activeOrganizationId: targetMembership.organization_id,
      role: targetMembership.role,
      organization_name: targetMembership.organization_name
    }
  });
});
