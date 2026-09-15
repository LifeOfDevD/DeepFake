import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import {
  CreateEvaluationDatasetSchema,
  CreateEvaluationFixtureSchema,
  SubmitGroundTruthLabelSchema,
  SubmitAdjudicationSchema,
  CreateSuppressionRuleSchema
} from '../domain/types.js';
import { AdjudicationService } from '../services/evaluation/adjudication-service.js';
import { RulesetVersionService } from '../services/evaluation/ruleset-version-service.js';
import { MetricsService } from '../services/evaluation/metrics-service.js';
import { SuppressionService } from '../services/evaluation/suppression-service.js';
import { ReviewerQualityService } from '../services/evaluation/reviewer-quality-service.js';
import { FeedbackPipelineService } from '../services/evaluation/feedback-service.js';
import { PrivacyReviewService } from '../services/evaluation/privacy-review-service.js';

export const evaluationRouter = Router();

// Apply auth and tenant context to all evaluation routes
evaluationRouter.use(authMiddleware);
evaluationRouter.use(tenantMiddleware);

// ============================================================================
// 1. DATASETS & SYNTHETIC FIXTURES
// ============================================================================
evaluationRouter.post(
  '/datasets/seed',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new AdjudicationService();
      const result = service.loadSeedCatalog(req.user!.id);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
evaluationRouter.get(
  '/datasets',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new AdjudicationService();
      const datasets = service.listDatasets();
      res.json({ success: true, data: datasets });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/datasets',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateEvaluationDatasetSchema.parse(req.body);
      const service = new AdjudicationService();
      const dataset = service.createDataset(input, req.user!.id);
      res.status(201).json({ success: true, data: dataset });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/datasets/:id',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new AdjudicationService();
      const dataset = service.getDatasetById(req.params.id as string);
      if (!dataset) {
        res.status(404).json({ success: false, error: 'Dataset not found' });
        return;
      }
      res.json({ success: true, data: dataset });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/datasets/:id/fixtures',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const service = new AdjudicationService();
      const fixtures = service.listFixtures(req.params.id as string, limit, offset);
      res.json({ success: true, data: fixtures });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/datasets/:id/conflicts',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new AdjudicationService();
      const conflicts = service.listConflictedFixtures(req.params.id as string);
      res.json({ success: true, data: conflicts });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/datasets/:id/fixtures',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateEvaluationFixtureSchema.parse({
        ...req.body,
        dataset_id: req.params.id
      });
      const service = new AdjudicationService();
      const fixture = service.addFixture(input);
      res.status(201).json({ success: true, data: fixture });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 2. GROUND-TRUTH LABELS & ADJUDICATION
// ============================================================================
evaluationRouter.post(
  '/fixtures/:id/labels',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = SubmitGroundTruthLabelSchema.parse(req.body);
      const service = new AdjudicationService();
      const label = service.submitLabel(req.params.id as string, req.user!.id, req.user!.email, input);
      res.status(201).json({ success: true, data: label });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/fixtures/:id/consensus',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new AdjudicationService();
      const consensus = service.getConsensusSummary(req.params.id as string);
      res.json({ success: true, data: consensus });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/fixtures/:id/adjudicate',
  requireRoles('legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = SubmitAdjudicationSchema.parse(req.body);
      const service = new AdjudicationService();
      const adjudication = service.adjudicateFixture(req.params.id as string, req.user!.id, req.user!.email, input);
      res.status(200).json({ success: true, data: adjudication });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 3. RULESETS, WHAT-IF SIMULATION, APPROVAL & ROLLBACK
// ============================================================================
evaluationRouter.get(
  '/rulesets',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (_req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new RulesetVersionService();
      const rulesets = service.listRulesets();
      res.json({ success: true, data: rulesets });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/rulesets',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new RulesetVersionService();
      const ruleset = service.createRuleset(req.body, req.user!.id);
      res.status(201).json({ success: true, data: ruleset });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/rulesets/:id/simulate',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new RulesetVersionService();
      const adjService = new AdjudicationService();
      const ruleset = service.getRulesetById(req.params.id as string);
      if (!ruleset) {
        res.status(404).json({ success: false, error: 'Ruleset not found' });
        return;
      }

      const datasetId = req.body.dataset_id;
      const fixtures = adjService.listFixtures(datasetId, 1000, 0);
      const result = service.simulateRuleset(ruleset, fixtures, req.body.threshold_overrides);

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/rulesets/:id/approve',
  requireRoles('legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new RulesetVersionService();
      const approved = service.approveRuleset(req.params.id as string, req.user!.id);
      res.json({ success: true, data: approved });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/rulesets/:id/activate',
  requireRoles('legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = req.body.reason || 'Approved evaluation ruleset activation';
      const service = new RulesetVersionService();
      const activated = service.activateRuleset(req.tenant!.organization_id, req.params.id as string, req.user!.id, reason);
      res.json({ success: true, data: activated });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/rulesets/rollback',
  requireRoles('org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = req.body.reason || 'Operator requested rollback to prior ruleset version';
      const service = new RulesetVersionService();
      const rolledBack = service.rollbackRuleset(req.tenant!.organization_id, req.user!.id, reason);
      res.json({ success: true, data: rolledBack });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/rulesets/active',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new RulesetVersionService();
      const active = service.getActiveRulesetForOrg(req.tenant!.organization_id);
      res.json({ success: true, data: active });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 4. EVALUATION RUNS & COMPREHENSIVE METRICS
// ============================================================================
evaluationRouter.post(
  '/runs',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new MetricsService();
      const result = service.executeEvaluationRun({
        organizationId: req.tenant!.organization_id,
        datasetId: req.body.dataset_id,
        rulesetId: req.body.ruleset_id,
        executedByUserId: req.user!.id,
        runType: req.body.run_type || 'offline_validation',
        notes: req.body.notes
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/runs',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const service = new MetricsService();
      const runs = service.listRuns(req.tenant!.organization_id, limit, offset);
      res.json({ success: true, data: runs });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/runs/:id',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new MetricsService();
      const run = service.getRunById(req.params.id as string, req.tenant!.organization_id);
      if (!run) {
        res.status(404).json({ success: false, error: 'Evaluation run not found' });
        return;
      }
      res.json({ success: true, data: run });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/runs/:id/metrics',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const slice = req.query.slice as string | undefined;
      const service = new MetricsService();
      const metrics = service.getMetricsForRun(req.params.id as string, slice);
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/runs/:id/compare/:candidateId',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new MetricsService();
      const comparison = service.compareRuns(req.params.id as string, req.params.candidateId as string);
      res.json({ success: true, data: comparison });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 5. FALSE-POSITIVE SUPPRESSION & EXCEPTION RULES
// ============================================================================
evaluationRouter.get(
  '/suppressions',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new SuppressionService();
      const rules = service.listSuppressionRules(req.tenant!.organization_id, req.query.active !== 'false');
      res.json({ success: true, data: rules });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/suppressions',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateSuppressionRuleSchema.parse(req.body);
      const service = new SuppressionService();
      const rule = service.createSuppressionRule(req.tenant!.organization_id, req.user!.id, input);
      res.status(201).json({ success: true, data: rule });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.delete(
  '/suppressions/:id',
  requireRoles('case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new SuppressionService();
      service.deactivateRule(req.params.id as string, req.tenant!.organization_id);
      res.json({ success: true, message: 'Suppression rule deactivated' });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/suppressions/:id/test',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new SuppressionService();
      const adjService = new AdjudicationService();
      const rule = service.getSuppressionRuleById(req.params.id as string, req.tenant!.organization_id);
      if (!rule) {
        res.status(404).json({ success: false, error: 'Suppression rule not found' });
        return;
      }

      const datasetId = req.body.dataset_id;
      const fixtures = adjService.listFixtures(datasetId, 1000, 0);
      const result = service.testRuleAgainstFixtures(rule, fixtures);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 6. REVIEWER QUALITY & SAMPLING
// ============================================================================
evaluationRouter.get(
  '/reviewers/quality',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new ReviewerQualityService();
      const metrics = service.computeReviewerMetrics(req.tenant!.organization_id, req.user!.id);
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/reviewers/:userId/metrics',
  requireRoles('case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new ReviewerQualityService();
      const metrics = service.computeReviewerMetrics(req.tenant!.organization_id, req.params.userId as string);
      res.json({ success: true, data: metrics });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.post(
  '/reviewers/sample',
  requireRoles('org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const pct = parseInt(req.body.sample_percentage as string) || 10;
      const service = new ReviewerQualityService();
      const result = service.performQualitySampling(req.tenant!.organization_id, pct);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 7. FEEDBACK PIPELINE & PRIVACY AUDIT
// ============================================================================
evaluationRouter.get(
  '/feedback/proposals',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new FeedbackPipelineService();
      const proposals = service.generateFeedbackProposals(req.tenant!.organization_id);
      res.json({ success: true, data: proposals });
    } catch (err) {
      next(err);
    }
  }
);

evaluationRouter.get(
  '/privacy/audit',
  requireRoles('legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const service = new PrivacyReviewService();
      const report = service.executePrivacyAudit(req.tenant!.organization_id);
      res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);
