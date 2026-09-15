import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../services/tenant-service.js';
import { User, Role } from '../domain/types.js';
import { getConfig } from '../config/env.js';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenant?: {
        organization_id: string;
        role: Role;
      };
    }
  }
}

export interface SessionTokenPayload {
  userId: string;
  email: string;
  systemRole?: string;
  iat: number;
  exp: number;
}

export function createSessionToken(
  user: { id: string; email: string; system_role?: string },
  ttlSeconds: number = 86400,
  secretOverride?: string
): string {
  const secret = secretOverride || getConfig().auth.sessionSecret;
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    userId: user.id,
    email: user.email,
    systemRole: user.system_role,
    iat: now,
    exp: now + ttlSeconds
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `desk_tok_${payloadB64}.${sig}`;
}

export function verifySessionToken(
  token: string,
  secretOverride?: string
): SessionTokenPayload {
  if (!token || !token.startsWith('desk_tok_')) {
    throw new Error('Invalid token prefix');
  }

  const tokenBody = token.slice('desk_tok_'.length);
  const parts = tokenBody.split('.');
  if (parts.length !== 2) {
    throw new Error('Malformed session token');
  }

  const [payloadB64, sig] = parts;
  const secret = secretOverride || getConfig().auth.sessionSecret;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('Invalid session token signature');
  }

  const payload: SessionTokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    throw new Error('Session token expired');
  }

  return payload;
}

const revokedTokens = new Set<string>();

export function revokeSessionToken(token: string): void {
  revokedTokens.add(token);
}

export function isTokenRevoked(token: string): boolean {
  return revokedTokens.has(token);
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const tenantService = new TenantService();
  const config = getConfig();
  const isProduction = config.nodeEnv === 'production';

  // 1. Check Authorization Bearer header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim();
    if (isTokenRevoked(bearerToken)) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Bearer token has been revoked / logged out.'
        }
      });
      return;
    }
    try {
      const payload = verifySessionToken(bearerToken);
      const user = tenantService.getUserById(payload.userId);
      if (!user || !user.is_active) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Active user account not found.'
          }
        });
        return;
      }
      req.user = user;
      next();
      return;
    } catch (err: any) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: `Bearer authentication failed: ${err.message}`
        }
      });
      return;
    }
  }

  // 2. Reject header authentication in production unconditionally
  const userIdHeader = req.headers['x-user-id'] as string;
  const userEmailHeader = req.headers['x-user-email'] as string;

  if (isProduction) {
    if (userIdHeader || userEmailHeader) {
      res.status(401).json({
        success: false,
        error: {
          code: 'HEADER_AUTH_DISALLOWED',
          message: 'Header-based authentication is strictly prohibited in production mode. Supply a signed Bearer token.'
        }
      });
      return;
    }

    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Supply a signed Bearer token.'
      }
    });
    return;
  }

  // 3. Fallback to header authentication only in development / test environments
  if (!userIdHeader && !userEmailHeader) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Pass valid credentials, Bearer token, or x-user-id header.'
      }
    });
    return;
  }

  let user: User | null = null;
  if (userIdHeader) {
    user = tenantService.getUserById(userIdHeader);
  } else if (userEmailHeader) {
    user = tenantService.getUserByEmail(userEmailHeader);
  }

  if (!user || !user.is_active) {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Active user account not found.'
      }
    });
    return;
  }

  req.user = user;
  next();
}
