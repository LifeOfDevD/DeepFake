import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { CaseService } from '../services/case-service.js';
import {
  ApprovalStateEnum,
  ClockStatusEnum,
  CreateCaseNoteSchema,
  CreateCaseSchema,
  IncidentIntakeSchema,
  TransitionCaseStatusSchema
} from '../domain/types.js';

export const caseRouter = Router();

// Apply auth and tenant resolution to all case routes
caseRouter.use(authMiddleware);
caseRouter.use(tenantMiddleware);

/**
 * GET /api/cases
 * Lists all cases for the current organization
 */
caseRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseService = new CaseService();
    const cases = caseService.getCases(req.tenant!.organization_id, {
      status: req.query.status as any,
      approval_status: req.query.approval_status as any,
      category: req.query.category as string,
      priority: req.query.priority as string,
      assigned_to_user_id: req.query.assigned_to_user_id as string,
      search: req.query.search as string
    });

    res.json({
      success: true,
      data: cases
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cases
 * Creates a new case (supporting both simple legacy intake and full Phase 3 structured intake)
 */
caseRouter.post(
  '/',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate: if Phase 3 fields present or category requires detailed validation, evaluate IncidentIntakeSchema
      let validatedInput: any;
      const intakeParse = IncidentIntakeSchema.safeParse(req.body);
      if (intakeParse.success) {
        validatedInput = intakeParse.data;
      } else {
        // If it was explicitly a defamation or court order category that failed IncidentIntakeSchema, fail with that error
        if (req.body.category === 'defamation_legal_escalation' || req.body.has_court_or_government_order) {
          validatedInput = IncidentIntakeSchema.parse(req.body); // Will throw ZodError
        } else {
          // Fall back to legacy CreateCaseSchema
          validatedInput = CreateCaseSchema.parse(req.body);
        }
      }

      const caseService = new CaseService();
      const newCase = caseService.createCase(
        req.tenant!.organization_id,
        validatedInput,
        {
          user_id: req.user!.id,
          email: req.user!.email,
          role: req.tenant!.role,
          ip_address: req.ip
        }
      );

      res.status(201).json({
        success: true,
        data: newCase
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/cases/:id
 * Retrieves full details, history, and notes for a specific case
 */
caseRouter.get('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

    if (!caseItem) {
      res.status(404).json({
        success: false,
        error: {
          code: 'CASE_NOT_FOUND',
          message: `Case '${caseId}' not found in current organization.`
        }
      });
      return;
    }

    const history = caseService.getStatusHistory(req.tenant!.organization_id, caseId);
    const notes = caseService.getNotes(req.tenant!.organization_id, caseId);

    res.json({
      success: true,
      data: {
        case: caseItem,
        status_history: history,
        notes: notes
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/cases/:id/status
 * Transitions a case to a new operational status
 */
caseRouter.patch(
  '/:id/status',
  requireRoles('org_owner', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const validatedInput = TransitionCaseStatusSchema.parse(req.body);
      const caseService = new CaseService();

      const updatedCase = caseService.transitionStatus(
        req.tenant!.organization_id,
        caseId,
        validatedInput,
        {
          user_id: req.user!.id,
          email: req.user!.email,
          role: req.tenant!.role,
          ip_address: req.ip
        }
      );

      res.json({
        success: true,
        data: updatedCase
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/cases/:id/notes
 * Adds an internal comment / operator note
 */
caseRouter.post(
  '/:id/notes',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const validatedInput = CreateCaseNoteSchema.parse(req.body);
      const caseService = new CaseService();

      const note = caseService.addNote(
        req.tenant!.organization_id,
        caseId,
        validatedInput,
        {
          user_id: req.user!.id,
          email: req.user!.email,
          role: req.tenant!.role,
          ip_address: req.ip
        },
        req.user!.full_name
      );

      res.status(201).json({
        success: true,
        data: note
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// PHASE 3: TRIAGE, CLOCKS, READINESS, APPROVAL & PACKET ROUTES
// ============================================================================

/**
 * GET /api/cases/:id/triage
 * Retrieves latest rule-based triage record for the case
 */
caseRouter.get('/:id/triage', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

    if (!caseItem) {
      res.status(404).json({
        success: false,
        error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
      });
      return;
    }

    let triage = caseService.triageService.getLatestTriage(caseId, req.tenant!.organization_id);
    if (!triage) {
      triage = caseService.triageService.recordTriage(
        caseId,
        req.tenant!.organization_id,
        req.user!.id,
        caseItem
      );
    }

    res.json({
      success: true,
      data: triage
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cases/:id/triage
 * Re-runs deterministic triage on current case fields
 */
caseRouter.post(
  '/:id/triage',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const caseService = new CaseService();
      const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

      if (!caseItem) {
        res.status(404).json({
          success: false,
          error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
        });
        return;
      }

      const triage = caseService.triageService.recordTriage(
        caseId,
        req.tenant!.organization_id,
        req.user!.id,
        caseItem,
        req.body.notes
      );

      res.json({
        success: true,
        data: triage
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/cases/:id/clocks
 * Retrieves and evaluates statutory clocks for a case
 */
caseRouter.get('/:id/clocks', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

    if (!caseItem) {
      res.status(404).json({
        success: false,
        error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
      });
      return;
    }

    let clock = caseService.statutoryClockService.getClockForCase(caseId, req.tenant!.organization_id);
    if (!clock) {
      clock = caseService.statutoryClockService.initializeClock(caseId, req.tenant!.organization_id, caseItem);
    }

    const evaluation = caseService.statutoryClockService.evaluateClock(clock);

    res.json({
      success: true,
      data: evaluation
    });
  } catch (err) {
    next(err);
  }
});

const UpdateClockStatusSchema = z.object({
  status: ClockStatusEnum,
  paused_reason: z.string().optional()
});

/**
 * POST /api/cases/:id/clocks/status
 * Updates statutory clock status
 */
caseRouter.post(
  '/:id/clocks/status',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const body = UpdateClockStatusSchema.parse(req.body);
      const caseService = new CaseService();

      const clock = caseService.statutoryClockService.updateClockStatus(
        caseId,
        req.tenant!.organization_id,
        body.status,
        body.paused_reason
      );

      const evaluation = caseService.statutoryClockService.evaluateClock(clock);

      res.json({
        success: true,
        data: evaluation
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/cases/:id/readiness
 * Evaluates the 14-point readiness checklist
 */
caseRouter.get('/:id/readiness', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

    if (!caseItem) {
      res.status(404).json({
        success: false,
        error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
      });
      return;
    }

    const readiness = caseService.readinessService.evaluate(caseItem, req.user!.id);

    res.json({
      success: true,
      data: readiness
    });
  } catch (err) {
    next(err);
  }
});

const TransitionApprovalSchema = z.object({
  to_state: ApprovalStateEnum,
  reason: z.string().min(3, 'A reason is required (min 3 characters)'),
  approval_type: z.string().default('workflow_gate'),
  requester_user_id: z.string().optional()
});

/**
 * POST /api/cases/:id/approval
 * Transitions case approval state with separation of duties
 */
caseRouter.post(
  '/:id/approval',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const body = TransitionApprovalSchema.parse(req.body);
      const caseService = new CaseService();

      const updatedCase = caseService.transitionApprovalState(
        req.tenant!.organization_id,
        caseId,
        body.to_state,
        body.reason,
        {
          user_id: req.user!.id,
          email: req.user!.email,
          role: req.tenant!.role,
          ip_address: req.ip
        },
        body.approval_type,
        body.requester_user_id
      );

      res.json({
        success: true,
        data: updatedCase
      });
    } catch (err: any) {
      if (err.name === 'ApprovalStateMachineError') {
        res.status(400).json({
          success: false,
          error: {
            code: err.code || 'ILLEGAL_APPROVAL_TRANSITION',
            message: err.message
          }
        });
        return;
      }
      next(err);
    }
  }
);

/**
 * GET /api/cases/:id/approval-records
 * Retrieves historical approval decisions for a case
 */
caseRouter.get('/:id/approval-records', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const records = caseService.getApprovalRecords(req.tenant!.organization_id, caseId);

    res.json({
      success: true,
      data: records
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cases/:id/submission-packet
 * Generates and returns a dry-run submission packet preview
 */
caseRouter.get('/:id/submission-packet', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

    if (!caseItem) {
      res.status(404).json({
        success: false,
        error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
      });
      return;
    }

    const packet = caseService.submissionPacketService.generatePacket(caseItem, req.user!.id);

    res.json({
      success: true,
      data: packet
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cases/:id/simulate-submission
 * Simulates dispatching the submission packet (dry-run record only)
 */
caseRouter.post(
  '/:id/simulate-submission',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.id as string;
      const caseService = new CaseService();
      const caseItem = caseService.getCaseById(req.tenant!.organization_id, caseId);

      if (!caseItem) {
        res.status(404).json({
          success: false,
          error: { code: 'CASE_NOT_FOUND', message: 'Case not found' }
        });
        return;
      }

      // Must be ready_for_submission
      if (caseItem.approval_status !== 'ready_for_submission') {
        res.status(400).json({
          success: false,
          error: {
            code: 'CASE_NOT_READY_FOR_SUBMISSION',
            message: `Case must be in 'ready_for_submission' state before simulation. Current state: '${caseItem.approval_status}'.`
          }
        });
        return;
      }

      // Ensure packet is generated
      caseService.submissionPacketService.generatePacket(caseItem, req.user!.id);

      const result = caseService.submissionPacketService.simulateSubmission(
        caseId,
        req.tenant!.organization_id,
        req.user!.id,
        req.user!.email
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
 * GET /api/cases/:id/duplicates
 * Retrieves duplicate links for a case
 */
caseRouter.get('/:id/duplicates', (req: Request, res: Response, next: NextFunction) => {
  try {
    const caseId = req.params.id as string;
    const caseService = new CaseService();
    const duplicates = caseService.duplicateDetectionService.getDuplicateLinks(
      caseId,
      req.tenant!.organization_id
    );

    res.json({
      success: true,
      data: duplicates
    });
  } catch (err) {
    next(err);
  }
});

const ResolveDuplicateSchema = z.object({
  status: z.enum(['confirmed_duplicate', 'dismissed'])
});

/**
 * POST /api/cases/:id/duplicates/:linkId/resolve
 * Resolves a duplicate link
 */
caseRouter.post(
  '/:id/duplicates/:linkId/resolve',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = ResolveDuplicateSchema.parse(req.body);
      const caseService = new CaseService();
      const resolved = caseService.duplicateDetectionService.resolveDuplicateLink(
        req.params.linkId as string,
        req.tenant!.organization_id,
        req.user!.id,
        body.status
      );

      res.json({
        success: true,
        data: resolved
      });
    } catch (err) {
      next(err);
    }
  }
);
