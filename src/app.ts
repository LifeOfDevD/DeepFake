import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { requestContextMiddleware } from './middleware/request-context.js';
import { healthRouter, metricsRouter } from './routes/health-routes.js';
import { authRouter } from './routes/auth-routes.js';
import { caseRouter } from './routes/case-routes.js';
import { tenantRouter } from './routes/tenant-routes.js';
import { auditRouter } from './routes/audit-routes.js';
import { evidenceRouter } from './routes/evidence-routes.js';
import { workflowRouter } from './routes/workflow-routes.js';
import { platformRouter, playbookRouter } from './routes/platform-routes.js';
import { submissionRouter } from './routes/submission-routes.js';
import { escalationRouter } from './routes/escalation-routes.js';
import { reuploadRouter } from './routes/reupload-routes.js';
import { onboardingRouter } from './routes/onboarding-routes.js';
import { entitlementRouter } from './routes/entitlement-routes.js';
import { usageRouter } from './routes/usage-routes.js';
import { billingRouter } from './routes/billing-routes.js';
import { notificationRouter } from './routes/notification-routes.js';
import { reportRouter } from './routes/report-routes.js';
import { pilotAdminRouter } from './routes/pilot-admin-routes.js';
import { monitoringRouter } from './routes/monitoring-routes.js';
import { evaluationRouter } from './routes/evaluation-routes.js';
import { integrationRouter } from './routes/integration-routes.js';
import { createSecurityHeadersMiddleware, createCorsMiddleware } from './security/security-headers.js';
import { generalApiRateLimiter, authRateLimiter } from './security/rate-limiter.js';
import { errorHandler } from './middleware/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): express.Application {
  const app = express();

  // Production security headers and CORS
  app.use(createSecurityHeadersMiddleware());
  app.use(createCorsMiddleware());
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContextMiddleware);

  // Healthcheck endpoints
  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);
  app.use('/healthz', healthRouter);
  app.use('/metrics', metricsRouter);

  // Rate Limiting
  app.use('/api/auth/login', authRateLimiter);
  app.use('/api', generalApiRateLimiter);

  // REST API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/cases', caseRouter);
  app.use('/api/organizations', tenantRouter);
  app.use('/api/audit-events', auditRouter);
  app.use('/api/workflow', workflowRouter);
  app.use('/api/platforms', platformRouter);
  app.use('/api/playbooks', playbookRouter);
  app.use('/api/submissions', submissionRouter);
  app.use('/api/escalations', escalationRouter);
  app.use('/api/re-uploads', reuploadRouter);
  app.use('/api/onboarding', onboardingRouter);
  app.use('/api/entitlements', entitlementRouter);
  app.use('/api/usage', usageRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/admin', pilotAdminRouter);
  app.use('/api/monitoring', monitoringRouter);
  app.use('/api/evaluation', evaluationRouter);
  app.use('/api/integrations', integrationRouter);
  app.use('/api', evidenceRouter);

  // Serve static operational web dashboard
  let clientPath = path.resolve(__dirname, 'client');
  if (!fs.existsSync(clientPath)) {
    clientPath = path.resolve(process.cwd(), 'src/client');
  }
  app.use(express.static(clientPath));

  // Client SPA fallback
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      const indexPath = path.join(clientPath, 'index.html');
      return res.sendFile(indexPath);
    }
    next();
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
