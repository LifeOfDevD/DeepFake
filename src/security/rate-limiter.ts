import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/env.js';

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * Sliding window in-memory rate limiter middleware
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RateLimitRecord>();

  const defaultKeyGen = (req: Request): string => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const orgId = (req as any).tenant?.organization_id || '';
    return `${ip}:${orgId}`;
  };

  const keyGen = options.keyGenerator || defaultKeyGen;

  return (req: Request, res: Response, next: NextFunction) => {
    // Check if rate limiting is enabled
    try {
      const config = getConfig();
      if (!config.security.rateLimitEnabled) {
        return next();
      }
    } catch {
      // Continue if config lookup fails
    }

    const key = keyGen(req);
    const now = Date.now();
    const record = store.get(key);

    if (!record || now > record.resetTime) {
      store.set(key, {
        count: 1,
        resetTime: now + options.windowMs
      });
      res.setHeader('X-RateLimit-Limit', options.maxRequests);
      res.setHeader('X-RateLimit-Remaining', options.maxRequests - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + options.windowMs) / 1000));
      return next();
    }

    record.count++;

    const remaining = Math.max(0, options.maxRequests - record.count);
    res.setHeader('X-RateLimit-Limit', options.maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > options.maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        success: false,
        error: options.message || 'RATE_LIMIT_EXCEEDED: Too many requests, please try again later.',
        retryAfterSeconds
      });
      return;
    }

    next();
  };
}

/**
 * Pre-configured rate limiters for distinct application surfaces
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  message: 'RATE_LIMIT_EXCEEDED: Too many authentication attempts. Please wait 60 seconds.'
});

export const webhookRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'RATE_LIMIT_EXCEEDED: Provider webhook push rate limit reached.',
  keyGenerator: (req) => `webhook:${req.params.connectionId || req.ip}`
});

export const downloadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'RATE_LIMIT_EXCEEDED: Evidence download rate limit reached.'
});

export const generalApiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 300,
  message: 'RATE_LIMIT_EXCEEDED: API request rate limit reached.'
});
