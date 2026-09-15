import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import {
  EvidenceService,
  getEvidenceService,
  setEvidenceService
} from '../services/evidence-service.js';
import { RetentionService } from '../services/retention-service.js';
import {
  ApproveDeletionSchema,
  CreateSourceUrlEvidenceSchema,
  DeletionRequestSchema,
  EvidenceSensitivityEnum,
  MarkSensitivitySchema,
  PlaceLegalHoldSchema,
  QuarantineEvidenceSchema,
  RejectDeletionRequestSchema,
  ReleaseLegalHoldSchema
} from '../domain/types.js';

export { getEvidenceService, setEvidenceService, EvidenceService };

export const evidenceRouter = Router();

// Configure disk-backed temporary multer storage to eliminate RAM exhaustion
const tempDir = path.resolve(process.cwd(), getConfig().storage.tempDir);
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, tempDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `tmp_${Date.now()}_${uuidv4().replace(/-/g, '')}${ext}`);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max ceiling
    files: 1
  }
});

// All evidence routes require authenticated user and tenant resolution
evidenceRouter.use(authMiddleware);
evidenceRouter.use(tenantMiddleware);

/**
 * POST /api/cases/:caseId/evidence
 * Uploads a binary file (multipart) OR registers a manual source URL (json)
 */
evidenceRouter.post(
  ['/cases/:caseId/evidence', '/cases/:caseId/evidence/url', '/cases/:caseId/evidence/upload'],
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.caseId as string;
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] as string
      };

      // 1. File Upload (multipart with disk-backed temp stream)
      if (req.file) {
        let sensitivity = 'normal' as any;
        if (req.body.sensitivity) {
          sensitivity = EvidenceSensitivityEnum.parse(req.body.sensitivity);
        }

        const safeDisplayName = req.body.safe_display_name || req.file.originalname;

        try {
          const item = await evidenceService.uploadEvidence(
            req.tenant!.organization_id,
            caseId,
            {
              originalFilename: req.file.originalname,
              declaredMimeType: req.file.mimetype || 'application/octet-stream',
              tempFilePath: req.file.path,
              safeDisplayName,
              sensitivity,
              capturedAt: req.body.captured_at
            },
            actor
          );

          res.status(201).json({
            success: true,
            data: item
          });
          return;
        } finally {
          if (req.file.path && fs.existsSync(req.file.path)) {
            await fs.promises.unlink(req.file.path).catch(() => {});
          }
        }
      }


      // 2. Source URL / Manual Evidence (JSON)
      if (req.body.source_url) {
        const validated = CreateSourceUrlEvidenceSchema.parse(req.body);
        const item = await evidenceService.createSourceUrlEvidence(
          req.tenant!.organization_id,
          caseId,
          {
            sourceUrl: validated.source_url,
            safeDisplayName: validated.safe_display_name,
            operatorNotes: validated.operator_notes,
            sensitivity: validated.sensitivity
          },
          actor
        );

        res.status(201).json({
          success: true,
          data: item
        });
        return;
      }

      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_EVIDENCE_INPUT',
          message: 'Must provide either a multipart file upload or a source_url JSON body.'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/cases/:caseId/evidence
 * Lists all active evidence items for a case
 */
evidenceRouter.get(
  '/cases/:caseId/evidence',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseId = req.params.caseId as string;
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const includeDeleted = req.query.include_deleted === 'true';
      const items = evidenceService.listCaseEvidence(
        req.tenant!.organization_id,
        caseId,
        actor,
        includeDeleted
      );

      res.json({
        success: true,
        data: items
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/evidence/:evidenceId
 * Retrieves metadata and chain-of-custody holds for an evidence item
 */
evidenceRouter.get(
  '/evidence/:evidenceId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const evidenceService = getEvidenceService();
      const item = evidenceService.getEvidenceById(req.tenant!.organization_id, evidenceId);
      const holds = evidenceService.getHolds(req.tenant!.organization_id, evidenceId);

      res.json({
        success: true,
        data: {
          evidence: item,
          holds
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

const handleGenerateDownloadToken = (req: Request, res: Response, next: NextFunction) => {
  try {
    const evidenceId = req.params.evidenceId as string;
    const evidenceService = getEvidenceService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: req.tenant!.role,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'] as string
    };

    const token = evidenceService.generateSignedDownloadToken(
      req.tenant!.organization_id,
      evidenceId,
      actor
    );

    res.json({
      success: true,
      data: {
        token,
        expires_in_seconds: 300,
        download_url: `/api/evidence/${evidenceId}/download?token=${token}`
      }
    });
  } catch (err) {
    next(err);
  }
};

// Canonical download token generation endpoints
evidenceRouter.get('/evidence/:evidenceId/download-token', handleGenerateDownloadToken);
evidenceRouter.post('/evidence/:evidenceId/download-token', handleGenerateDownloadToken);

// Deprecated alias for backward compatibility
const handleDeprecatedTokenRoute = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `</api/evidence/${req.params.evidenceId}/download-token>; rel="canonical"`);
  handleGenerateDownloadToken(req, res, next);
};
evidenceRouter.get('/evidence/:evidenceId/token', handleDeprecatedTokenRoute);
evidenceRouter.post('/evidence/:evidenceId/token', handleDeprecatedTokenRoute);


/**
 * GET /api/evidence/:evidenceId/download
 * Streams authorized evidence file payload. Requires valid, signed download token.
 */
evidenceRouter.get(
  '/evidence/:evidenceId/download',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      // Mandatory token verification
      const token = req.query.token as string | undefined;
      if (!token) {
        res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_REQUIRED',
            message: 'A signed download token is mandatory to download evidence.'
          }
        });
        return;
      }

      const payload = evidenceService.verifyDownloadToken(token);
      if (
        payload.evidenceId !== evidenceId ||
        payload.organizationId !== req.tenant!.organization_id ||
        payload.actorUserId !== actor.user_id
      ) {
        res.status(403).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Download token parameters do not match requested resource or authorized actor.'
          }
        });
        return;
      }

      const result = await evidenceService.streamEvidencePayload(
        req.tenant!.organization_id,
        evidenceId,
        actor
      );

      res.setHeader('Content-Type', result.mimeType);
      res.setHeader('Content-Length', result.byteSize);
      res.setHeader('Content-Disposition', `attachment; filename="${result.safeDisplayName}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('ETag', `"${result.sha256}"`);

      result.stream.pipe(res);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/evidence/:evidenceId/mark-sensitive
 */
evidenceRouter.post(
  '/evidence/:evidenceId/mark-sensitive',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = MarkSensitivitySchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const item = evidenceService.markSensitivity(
        req.tenant!.organization_id,
        evidenceId,
        validated.sensitivity,
        validated.reason,
        actor
      );

      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/evidence/:evidenceId/quarantine
 */
evidenceRouter.post(
  '/evidence/:evidenceId/quarantine',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = QuarantineEvidenceSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const item = evidenceService.quarantineEvidence(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/evidence/:evidenceId/legal-hold
 */
evidenceRouter.post(
  '/evidence/:evidenceId/legal-hold',
  requireRoles('org_owner', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = PlaceLegalHoldSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const hold = evidenceService.placeLegalHold(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.status(201).json({ success: true, data: hold });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/evidence/:evidenceId/legal-hold
 */
evidenceRouter.delete(
  '/evidence/:evidenceId/legal-hold',
  requireRoles('org_owner', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = ReleaseLegalHoldSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      evidenceService.releaseLegalHold(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.json({ success: true, message: 'Legal hold released successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/evidence/:evidenceId/deletion-request
 * Retrieves pending deletion request for evidence item if one exists
 */
evidenceRouter.get(
  '/evidence/:evidenceId/deletion-request',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const evidenceService = getEvidenceService();
      const request = evidenceService.getPendingDeletionRequest(req.tenant!.organization_id, evidenceId);
      res.json({ success: true, data: request });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/evidence/:evidenceId/deletion-request
 * Submits a deletion request (Requester step of Two-Person authorization)
 */
evidenceRouter.post(
  '/evidence/:evidenceId/deletion-request',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = DeletionRequestSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] as string
      };

      const item = evidenceService.requestDeletion(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

evidenceRouter.post(
  '/evidence/:evidenceId/delete-request',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = DeletionRequestSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] as string
      };

      const item = evidenceService.requestDeletion(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);


/**
 * Common handler for two-person deletion approval
 */
const handleApproveDeletion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const evidenceId = req.params.evidenceId as string;
    const validated = ApproveDeletionSchema.parse(req.body);
    const evidenceService = getEvidenceService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: req.tenant!.role,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'] as string
    };

    const item = await evidenceService.approveDeletion(
      req.tenant!.organization_id,
      evidenceId,
      validated.reason,
      actor
    );

    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/evidence/:evidenceId/approve-deletion
 * Approves a pending deletion request (Approver must != Requester)
 */
evidenceRouter.post(
  '/evidence/:evidenceId/approve-deletion',
  requireRoles('org_owner', 'case_manager', 'legal_reviewer', 'system_admin'),
  handleApproveDeletion
);

/**
 * POST /api/evidence/:evidenceId/delete
 * Deprecated alias to canonical approve-deletion for backward compatibility
 */
evidenceRouter.post(
  '/evidence/:evidenceId/delete',
  requireRoles('org_owner', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `</api/evidence/${req.params.evidenceId}/approve-deletion>; rel="canonical"`);
    handleApproveDeletion(req, res, next);
  }
);

/**
 * POST /api/evidence/:evidenceId/reject-deletion
 * Rejects a pending deletion request and restores evidence status
 */
evidenceRouter.post(
  '/evidence/:evidenceId/reject-deletion',
  requireRoles('org_owner', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const evidenceId = req.params.evidenceId as string;
      const validated = RejectDeletionRequestSchema.parse(req.body);
      const evidenceService = getEvidenceService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] as string
      };

      const item = evidenceService.rejectDeletion(
        req.tenant!.organization_id,
        evidenceId,
        validated.reason,
        actor
      );

      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/retention/enforce
 * Triggers retention policy sweep to purge expired evidence (preserving tombstones)
 */
evidenceRouter.post(
  '/admin/retention/enforce',
  requireRoles('org_owner', 'org_admin', 'system_admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const retentionService = new RetentionService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'] as string
      };

      const result = await retentionService.purgeExpiredEvidence({
        dryRun: req.body && req.body.dry_run === true,
        organizationId: req.tenant!.organization_id,
        actor
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

