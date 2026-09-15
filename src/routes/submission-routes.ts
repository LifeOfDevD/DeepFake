import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { SubmissionService } from '../services/submission-service.js';
import { ResponseTrackingService } from '../services/response-tracking-service.js';
import {
  CreateSubmissionSchema,
  ApproveSubmissionFacetSchema,
  RecordAcknowledgementSchema,
  RecordPlatformDecisionSchema
} from '../domain/types.js';

export const submissionRouter = Router();

submissionRouter.use(authMiddleware);
submissionRouter.use(tenantMiddleware);

/**
 * POST /api/submissions
 * Create a new submission draft for a case and platform playbook
 */
submissionRouter.post(
  '/',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateSubmissionSchema.parse(req.body);
      const service = new SubmissionService();
      const submission = await service.createSubmission(
        input,
        req.user!.id,
        req.tenant!.organization_id
      );
      res.status(201).json({
        success: true,
        data: submission
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/submissions/cases/:caseId
 * List all submissions for a given case
 */
submissionRouter.get(
  '/cases/:caseId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new SubmissionService();
      const submissions = service.getSubmissionsForCase(
        req.params.caseId as string,
        req.tenant!.organization_id
      );
      res.json({
        success: true,
        data: submissions
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/submissions/:id
 * Retrieve submission details
 */
submissionRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubmissionService();
    const submission = service.getSubmissionById(req.params.id as string, req.tenant!.organization_id);
    if (!submission) {
      res.status(404).json({
        success: false,
        error: { code: 'SUBMISSION_NOT_FOUND', message: `Submission ${req.params.id} not found.` }
      });
      return;
    }
    res.json({
      success: true,
      data: submission
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/submissions/:id/validate
 * Validate packet payload against playbook criteria
 */
submissionRouter.post('/:id/validate', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubmissionService();
    const result = service.validateSubmission(req.params.id as string, req.tenant!.organization_id);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/submissions/:id/preview
 * Generate dry-run preview of submission notice and evidence manifest
 */
submissionRouter.get('/:id/preview', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubmissionService();
    const preview = service.previewSubmission(req.params.id as string, req.tenant!.organization_id);
    res.json({
      success: true,
      data: preview
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/submissions/:id/approve
 * Record human approval for a specific facet (legal, evidence, route, simulation)
 */
submissionRouter.post(
  '/:id/approve',
  requireRoles('case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = ApproveSubmissionFacetSchema.parse(req.body);
      const service = new SubmissionService();
      const approval = await service.approveFacet(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        req.tenant!.role,
        input
      );
      res.json({
        success: true,
        data: approval
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/submissions/:id/approvals
 * Retrieve approval records for submission
 */
submissionRouter.get('/:id/approvals', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubmissionService();
    const approvals = service.getApprovals(req.params.id as string, req.tenant!.organization_id);
    res.json({
      success: true,
      data: approvals
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/submissions/:id/simulate
 * Dispatch dry-run platform submission simulation (Zero network calls)
 */
submissionRouter.post(
  '/:id/simulate',
  requireRoles('case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new SubmissionService();
      const result = await service.simulateSubmission(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        req.tenant!.role
      );
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/submissions/:id/transitions
 * Retrieve transition audit ledger for submission
 */
submissionRouter.get('/:id/transitions', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubmissionService();
    const transitions = service.getTransitions(req.params.id as string, req.tenant!.organization_id);
    res.json({
      success: true,
      data: transitions
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/submissions/:id/responses/acknowledgement
 * Manually record platform acknowledgement ticket
 */
submissionRouter.post(
  '/:id/responses/acknowledgement',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = RecordAcknowledgementSchema.parse(req.body);
      const trackingService = new ResponseTrackingService();
      const response = await trackingService.recordAcknowledgement(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.status(201).json({
        success: true,
        data: response
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/submissions/:id/responses/decision
 * Manually record platform takedown decision or rejection
 */
submissionRouter.post(
  '/:id/responses/decision',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = RecordPlatformDecisionSchema.parse(req.body);
      const trackingService = new ResponseTrackingService();
      const response = await trackingService.recordDecision(
        req.params.id as string,
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.status(201).json({
        success: true,
        data: response
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/submissions/:id/responses
 * List all responses for a submission
 */
submissionRouter.get('/:id/responses', (req: Request, res: Response, next: NextFunction) => {
  try {
    const trackingService = new ResponseTrackingService();
    const responses = trackingService.getResponsesForSubmission(
      req.params.id as string,
      req.tenant!.organization_id
    );
    res.json({
      success: true,
      data: responses
    });
  } catch (err) {
    next(err);
  }
});
