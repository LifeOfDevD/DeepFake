import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { StateMachineError } from '../domain/state-machine.js';
import { SubmissionStateMachineError } from '../domain/submission-state-machine.js';
import { EvidenceError } from '../services/evidence-service.js';
import { EvidenceValidationError } from '../services/evidence-hasher.js';
import { StorageError } from '../storage/evidence-storage.js';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 0. Body parser malformed JSON error
  if (err instanceof SyntaxError && (('status' in err && (err as any).status === 400) || 'body' in err || (err as any).type === 'entity.parse.failed')) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Malformed JSON payload in request body.',
        details: {}
      }
    });
    return;
  }

  // 1. Zod schema validation failures
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload failed schema validation.',
        details: err.issues
      }
    });
    return;
  }

  // 2. State machine transition violations (Case, Evidence, Submission)
  if (
    err instanceof StateMachineError ||
    err instanceof SubmissionStateMachineError ||
    err.name === 'SubmissionStateMachineError' ||
    err.name === 'InvalidEvidenceStateTransitionError'
  ) {
    res.status(422).json({
      success: false,
      error: {
        code: err.code || 'INVALID_STATE_TRANSITION',
        message: err.message,
        details: {}
      }
    });
    return;
  }


  // 3. Evidence validation errors (MIME, executable, size limits)
  if (err instanceof EvidenceValidationError) {
    res.status(400).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 4. Evidence domain errors (access denied, not found, legal hold active)
  if (err instanceof EvidenceError) {
    let statusCode = 400;
    if (err.code === 'TOKEN_REQUIRED') statusCode = 401;
    else if (err.code === 'EVIDENCE_ACCESS_DENIED') statusCode = 403;
    else if (err.code === 'EVIDENCE_NOT_FOUND' || err.code === 'CASE_NOT_FOUND') statusCode = 404;
    else if (err.code === 'LEGAL_HOLD_ACTIVE') statusCode = 409;
    else if (err.code === 'EVIDENCE_DELETED') statusCode = 410;
    else if (err.code === 'STORAGE_DELETION_FAILED') statusCode = 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 5. Storage errors (path traversal, missing objects)
  if (err instanceof StorageError) {
    let statusCode = 500;
    if (err.code === 'STORAGE_NOT_FOUND') statusCode = 404;
    else if (err.code === 'PATH_TRAVERSAL_DETECTED') statusCode = 400;

    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 6. Quota and rate limit errors
  if (err.message && (err.message.includes('QUOTA_EXCEEDED') || err.message.includes('MONITORING_QUOTA_EXCEEDED'))) {
    res.status(403).json({
      success: false,
      error: {
        code: 'QUOTA_EXCEEDED',
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 7. Domain authorization and validation errors
  if (
    err.message &&
    (err.message.includes('SUBJECT_NOT_ACTIVE') ||
      err.message.includes('SUBJECT_UNAUTHORIZED') ||
      err.message.includes('AUTHORIZATION_REQUIRED') ||
      err.message.includes('INVALID_ARGUMENT') ||
      err.message.includes('INVALID_PATH') ||
      err.message.includes('SECURITY_VIOLATION'))
  ) {
    res.status(400).json({
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 8. Generic domain permission / not found errors
  if (err.message && (err.message.includes('not found') || err.message.includes('Forbidden') || err.message.includes('permission'))) {
    const isNotFound = err.message.includes('not found');
    res.status(isNotFound ? 404 : 403).json({
      success: false,
      error: {
        code: isNotFound ? 'NOT_FOUND' : 'FORBIDDEN',
        message: err.message,
        details: {}
      }
    });
    return;
  }

  // 7. Unhandled internal server errors
  console.error('[UNHANDLED_ERROR]', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred.',
      details: {}
    }
  });
}
