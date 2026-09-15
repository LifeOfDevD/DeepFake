import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { rootLogger, Logger } from '../utils/logger.js';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      logger?: Logger;
    }
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const requestLogger = rootLogger.child({
    requestId,
    method: req.method,
    path: req.originalUrl || req.url
  });
  req.logger = requestLogger;

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    requestLogger.info('HTTP request completed', {
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.headers['user-agent'],
      organizationId: req.tenant?.organization_id,
      userId: req.user?.id
    });
  });

  next();
}
