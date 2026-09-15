import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { SubjectService } from '../services/monitoring/subject-service.js';
import { MonitoringPolicyService } from '../services/monitoring/monitoring-policy-service.js';
import { SignalIngestionService } from '../services/monitoring/signal-ingestion-service.js';
import { CandidateReviewService } from '../services/monitoring/candidate-review-service.js';
import { FileReplaySignalAdapter } from '../services/monitoring/adapters/file-replay-adapter.js';
import { WebhookSignalAdapter } from '../services/monitoring/adapters/webhook-signal-adapter.js';
import { WorkerManager } from '../workers/worker-manager.js';
import { getDatabase } from '../db/connection.js';
import {
  CreateSubjectSchema,
  UpdateSubjectSchema,
  CreateMonitoringPolicySchema,
  UpdateMonitoringPolicySchema,
  CreateSignalSchema,
  BatchIngestSignalsSchema,
  ReviewCandidateSchema
} from '../domain/types.js';

export const monitoringRouter = Router();

// ============================================================================
// PUBLIC / PARTNER WEBHOOKS (Signed HMAC, No Cookie Auth)
// ============================================================================
monitoringRouter.post('/webhook/:partnerSecret', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const adapter = new WebhookSignalAdapter();
    const signatureHeader = (req.headers['x-hub-signature-256'] ||
      req.headers['x-webhook-signature']) as string | undefined;
    const timestampHeader = (req.headers['x-webhook-timestamp'] ||
      req.headers['x-signature-timestamp']) as string | undefined;

    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const secret = req.params.partnerSecret as string;

    const isValid = adapter.verifySignature({
      secret,
      signatureHeader,
      timestampHeader,
      rawBody
    });

    if (!isValid) {
      res.status(401).json({
        success: false,
        error: 'INVALID_SIGNATURE: HMAC verification failed or timestamp drift exceeded'
      });
      return;
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const signalsRaw = Array.isArray(payload) ? payload : (payload.signals || [payload]);

    const processed = await adapter.processInput(signalsRaw, {
      partnerId: req.query.partnerId as string || 'partner',
      signatureValid: true
    });

    res.status(200).json({
      success: true,
      data: {
        received_count: processed.length,
        status: 'queued_for_ingestion'
      }
    });
  } catch (err) {
    next(err);
  }
});

// All subsequent routes require authenticated tenant session
monitoringRouter.use(authMiddleware);
monitoringRouter.use(tenantMiddleware);

// ============================================================================
// 1. ADAPTERS & QUOTA METRICS
// ============================================================================
monitoringRouter.get('/adapters', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase();
    const adapters = db.prepare('SELECT * FROM monitoring_adapters ORDER BY name ASC').all();
    res.json({
      success: true,
      data: adapters
    });
  } catch (err) {
    next(err);
  }
});

monitoringRouter.get('/quota', (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase();
    const orgId = req.tenant!.organization_id;

    const ent = db.prepare(`
      SELECT max_monitored_subjects, max_monthly_monitoring_signals
      FROM pilot_entitlements WHERE organization_id = ?
    `).get(orgId) as any;

    const subjectsCount = (db.prepare(`
      SELECT COUNT(*) as count FROM monitored_subjects
      WHERE organization_id = ? AND monitoring_status != 'archived'
    `).get(orgId) as { count: number }).count;

    const monthPrefix = new Date().toISOString().slice(0, 7);
    const signalsCount = (db.prepare(`
      SELECT COUNT(*) as count FROM monitoring_signals
      WHERE organization_id = ? AND observed_at LIKE ?
    `).get(orgId, `${monthPrefix}%`) as { count: number }).count;

    res.json({
      success: true,
      data: {
        subjects: {
          current: subjectsCount,
          max: ent?.max_monitored_subjects ?? 5,
          available: Math.max(0, (ent?.max_monitored_subjects ?? 5) - subjectsCount)
        },
        signals: {
          current_month: signalsCount,
          max_monthly: ent?.max_monthly_monitoring_signals ?? 500,
          available: Math.max(0, (ent?.max_monthly_monitoring_signals ?? 500) - signalsCount)
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 2. MONITORED SUBJECTS (CRUD)
// ============================================================================
monitoringRouter.get('/subjects', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubjectService();
    const subjects = service.listSubjects(req.tenant!.organization_id, {
      status: req.query.status as string,
      sensitivity: req.query.sensitivity as string
    });
    res.json({
      success: true,
      data: subjects
    });
  } catch (err) {
    next(err);
  }
});

monitoringRouter.post(
  '/subjects',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateSubjectSchema.parse(req.body);
      const service = new SubjectService();
      const subject = service.createSubject(
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.status(201).json({
        success: true,
        data: subject
      });
    } catch (err) {
      next(err);
    }
  }
);

monitoringRouter.get('/subjects/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new SubjectService();
    const subject = service.getSubject(req.tenant!.organization_id, req.params.id as string);
    if (!subject) {
      res.status(404).json({ success: false, error: 'Subject not found' });
      return;
    }
    res.json({
      success: true,
      data: subject
    });
  } catch (err) {
    next(err);
  }
});

monitoringRouter.put(
  '/subjects/:id',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = UpdateSubjectSchema.parse(req.body);
      const service = new SubjectService();
      const subject = service.updateSubject(
        req.tenant!.organization_id,
        req.params.id as string,
        req.user!.id,
        input
      );
      res.json({
        success: true,
        data: subject
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 3. MONITORING POLICIES (CRUD)
// ============================================================================
monitoringRouter.get('/policies', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new MonitoringPolicyService();
    const policies = service.listPolicies(
      req.tenant!.organization_id,
      req.query.subjectId as string
    );
    res.json({
      success: true,
      data: policies
    });
  } catch (err) {
    next(err);
  }
});

monitoringRouter.post(
  '/policies',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateMonitoringPolicySchema.parse(req.body);
      const service = new MonitoringPolicyService();
      const policy = service.createPolicy(req.tenant!.organization_id, input);
      res.status(201).json({
        success: true,
        data: policy
      });
    } catch (err) {
      next(err);
    }
  }
);

monitoringRouter.put(
  '/policies/:id',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = UpdateMonitoringPolicySchema.parse(req.body);
      const service = new MonitoringPolicyService();
      const policy = service.updatePolicy(
        req.tenant!.organization_id,
        req.params.id as string,
        input
      );
      res.json({
        success: true,
        data: policy
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 4. SIGNAL INTAKE & REPLAY
// ============================================================================
monitoringRouter.post(
  '/signals/ingest',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateSignalSchema.parse(req.body);
      const service = new SignalIngestionService();
      const result = service.ingestSignal(
        req.tenant!.organization_id,
        req.user!.id,
        input
      );
      res.status(result.isDuplicate ? 200 : 201).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

monitoringRouter.post(
  '/signals/batch',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = BatchIngestSignalsSchema.parse(req.body);
      const service = new SignalIngestionService();
      const results = input.signals.map((sig) =>
        service.ingestSignal(req.tenant!.organization_id, req.user!.id, sig)
      );
      res.status(201).json({
        success: true,
        data: {
          total: results.length,
          ingested: results.filter((r) => !r.isDuplicate).length,
          duplicates: results.filter((r) => r.isDuplicate).length,
          results
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

monitoringRouter.post(
  '/signals/replay',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subjectId = req.body.subject_id;
      if (!subjectId) {
        res.status(400).json({ success: false, error: 'subject_id is required' });
        return;
      }

      const filePath = req.body.file_path || 'seeds/monitoring-fixtures.json';
      const replayAdapter = new FileReplaySignalAdapter();
      const rawSignals = await replayAdapter.replayFile(filePath, {
        allowedDir: process.cwd(),
        actorUserId: req.user!.id
      });

      const ingestionService = new SignalIngestionService();
      const results = [];

      for (const sig of rawSignals) {
        try {
          const res = ingestionService.ingestSignal(req.tenant!.organization_id, req.user!.id, {
            subject_id: subjectId,
            adapter_name: 'file_replay',
            source_type: 'file_replay',
            observed_url: sig.observed_url,
            platform: sig.platform,
            content_type: sig.content_type,
            raw_payload: sig.raw_payload,
            provenance: sig.provenance
          });
          results.push(res);
        } catch {
          // Ignore duplicates or quota errors in replay
        }
      }

      res.status(200).json({
        success: true,
        data: {
          replayed_count: results.length,
          results
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 5. CANDIDATE HUMAN REVIEW QUEUE & DECISIONS
// ============================================================================
monitoringRouter.get('/reviews', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new CandidateReviewService();
    const items = service.listReviewQueue(req.tenant!.organization_id, {
      status: req.query.status as any,
      priority: req.query.priority as any,
      subjectId: req.query.subjectId as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0
    });

    res.json({
      success: true,
      data: items
    });
  } catch (err) {
    next(err);
  }
});

monitoringRouter.post(
  '/reviews/:id/decision',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = ReviewCandidateSchema.parse(req.body);
      const service = new CandidateReviewService();
      const review = service.reviewCandidate(
        req.tenant!.organization_id,
        req.params.id as string,
        req.user!.id,
        req.tenant!.role,
        input
      );

      res.json({
        success: true,
        data: review
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// 6. SIMULATE BACKGROUND INTAKE & EVALUATION CYCLE
// ============================================================================
monitoringRouter.post(
  '/simulate-cycle',
  requireRoles('analyst', 'case_manager', 'legal_reviewer', 'org_admin', 'org_owner', 'system_admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const workerManager = new WorkerManager();
      const ingestionResult = await workerManager.runWorkerOnce('monitoring_ingestion_worker');
      const evaluationResult = await workerManager.runWorkerOnce('candidate_evaluation_worker');

      res.json({
        success: true,
        data: {
          ingestion: ingestionResult,
          evaluation: evaluationResult
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
