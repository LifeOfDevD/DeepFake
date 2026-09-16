import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import { getConfig } from '../config/env.js';

/**
 * Production-hardened HTTP Security Headers Middleware
 */
export function createSecurityHeadersMiddleware() {
  const config = getConfig();
  const isProd = config.nodeEnv === 'production' || config.nodeEnv === 'staging';

  return helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://cdn.tailwindcss.com'], // UI uses vanilla inline event bindings and Tailwind CDN
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.tailwindcss.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: null
          }
        }
      : false, // Permissive in dev/test for rapid local debugging
    frameguard: {
      action: 'deny'
    },
    hsts: isProd && config.appUrl.startsWith('https://')
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      : false,
    noSniff: true,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    },
    xssFilter: true
  });
}

/**
 * Production-hardened CORS Middleware with Origin Whitelisting
 */
export function createCorsMiddleware() {
  const config = getConfig();
  const isProd = config.nodeEnv === 'production' || config.nodeEnv === 'staging';

  const allowedOrigins = config.security.corsAllowedOrigins
    ? config.security.corsAllowedOrigins.split(',').map((o) => o.trim().toLowerCase())
    : [config.appUrl.toLowerCase()];

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      if (!isProd) {
        // Allow all local origins in development/test
        return callback(null, true);
      }

      const lowerOrigin = origin.toLowerCase();
      if (allowedOrigins.includes(lowerOrigin) || allowedOrigins.includes('*')) {
        return callback(null, true);
      }

      callback(new Error(`CORS_BLOCKED: Origin '${origin}' is not authorized`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-organization-id',
      'x-user-id',
      'X-Hub-Signature',
      'X-Requested-With'
    ],
    credentials: true,
    maxAge: 86400 // 24 hours
  };

  return cors(corsOptions);
}
