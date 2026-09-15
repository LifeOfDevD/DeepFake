import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { ReportService } from '../services/report-service.js';
import { GenerateReportSchema } from '../domain/types.js';

export const reportRouter = Router();

reportRouter.use(authMiddleware);
reportRouter.use(tenantMiddleware);

const REPORT_METADATA = [
  {
    type: 'open_cases',
    title: 'Open Cases Inventory',
    description: 'All active and in-progress incident investigations across all stages.'
  },
  {
    type: 'statutory_clocks_overdue',
    title: 'Statutory Clocks Status & Overdue Alerts',
    description: 'Intermediary guideline clocks (IT Rules 2021) that are overdue or nearing deadline.'
  },
  {
    type: 'active_escalations',
    title: 'Active Platform Escalations',
    description: 'Appeals and escalations requiring Grievance Officer, GAC, or legal intervention.'
  },
  {
    type: 'evidence_inventory',
    title: 'Evidence Locker Inventory & Hashes',
    description: 'Complete catalog of cryptographic hashes, sizes, MIME types, and custody status.'
  },
  {
    type: 'retention_schedule',
    title: 'Retention & Legal Hold Schedule',
    description: 'Upcoming retention purges, active legal holds, and tombstone records.'
  },
  {
    type: 'submission_simulation_history',
    title: 'Submission Simulation Log',
    description: 'Audited log of local dry-run submissions and packet hashes.'
  },
  {
    type: 'response_outcomes',
    title: 'Platform Response Outcomes & Takedown Metrics',
    description: 'Takedowns confirmed, content actions, rejections, and appellate suggestions.'
  },
  {
    type: 'usage_summary',
    title: 'Metered Resource Usage & Plan Limits',
    description: 'Aggregated resource usage counts versus allotted plan quotas.'
  },
  {
    type: 'audit_timeline',
    title: 'Security & Custody Audit Timeline',
    description: 'Immutable actor-attributed chronological record of all actions.'
  }
];

/**
 * GET /api/reports/types
 * List all available customer operational reports
 */
reportRouter.get('/types', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: REPORT_METADATA
  });
});

/**
 * POST /api/reports/generate
 * Generate and download operational report
 */
reportRouter.post('/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = GenerateReportSchema.parse(req.body);
    const service = new ReportService();

    const result = await service.generateReport(req.tenant!.organization_id, input);

    if (input.format === 'csv' && result.csvContent !== undefined) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${input.report_type}-${req.tenant!.organization_id}.csv"`
      );
      res.send(result.csvContent);
      return;
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});
