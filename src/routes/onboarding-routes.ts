import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { OnboardingService } from '../services/onboarding-service.js';
import { EntitlementService } from '../services/entitlement-service.js';
import { NotificationService } from '../services/notification-service.js';
import {
  CreateOrganizationSchema,
  CreateInvitationSchema,
  AcceptInvitationSchema
} from '../domain/types.js';

export const onboardingRouter = Router();

/**
 * POST /api/onboarding/organizations
 * Create a new tenant organization with plan selection
 */
onboardingRouter.post('/organizations', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = CreateOrganizationSchema.parse(req.body);
    const planTier = (req.body.plan_tier as 'pilot' | 'professional' | 'enterprise') || 'pilot';

    const onboardingService = new OnboardingService();
    const actor = {
      user_id: req.user!.id,
      email: req.user!.email,
      role: (req.user!.system_role === 'system_admin' ? 'system_admin' : 'org_owner') as any,
      ip_address: req.ip
    };

    const org = onboardingService.createOrganizationWithPlan(input, planTier, req.user!.id, actor);

    res.status(201).json({
      success: true,
      data: org
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/onboarding/checklist
 * Retrieve 7-step onboarding readiness checklist for the active organization
 */
onboardingRouter.get(
  '/checklist',
  authMiddleware,
  tenantMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onboardingService = new OnboardingService();
      const checklist = onboardingService.getOnboardingChecklist(req.tenant!.organization_id);
      const totalSteps = Object.keys(checklist.checklist).length || 7;
      const completedSteps = Object.values(checklist.checklist).filter(Boolean).length;
      const completion_percentage = Math.round((completedSteps / totalSteps) * 100);
      const ready_for_cases = checklist.isComplete;

      res.json({
        success: true,
        data: {
          ...checklist,
          completion_percentage,
          ready_for_cases
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/onboarding/settings
 * Update pilot settings to acknowledge playbooks or accept escalation terms
 */
onboardingRouter.patch(
  '/settings',
  authMiddleware,
  tenantMiddleware,
  requireRoles('system_admin', 'org_owner', 'org_admin', 'case_manager', 'legal_reviewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onboardingService = new OnboardingService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const { terms_accepted, playbook_acknowledged } = req.body || {};
      onboardingService.updatePilotSettings(
        req.tenant!.organization_id,
        { terms_accepted, playbook_acknowledged },
        actor
      );

      const checklist = onboardingService.getOnboardingChecklist(req.tenant!.organization_id);
      const totalSteps = Object.keys(checklist.checklist).length || 7;
      const completedSteps = Object.values(checklist.checklist).filter(Boolean).length;
      const completion_percentage = Math.round((completedSteps / totalSteps) * 100);
      const ready_for_cases = checklist.isComplete;

      res.json({
        success: true,
        message: 'Onboarding settings updated successfully',
        data: {
          ...checklist,
          completion_percentage,
          ready_for_cases
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/onboarding/invitations
 * Issue an organization invitation (checked against entitlement limit)
 */
onboardingRouter.post(
  '/invitations',
  authMiddleware,
  tenantMiddleware,
  requireRoles('system_admin', 'org_owner', 'org_admin', 'legal_reviewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateInvitationSchema.parse(req.body);
      const entitlementService = new EntitlementService();
      const onboardingService = new OnboardingService();
      const notificationService = new NotificationService();

      // Assert user invitation limit
      entitlementService.assertCanInviteUser(req.tenant!.organization_id);

      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const result = onboardingService.createInvitation(req.tenant!.organization_id, input, actor);

      // Queue outbox notification for recipient
      try {
        notificationService.queueNotification({
          organization_id: req.tenant!.organization_id,
          recipient: input.email,
          title: 'Invitation to Digital Impersonation Response Desk',
          body: `You have been invited to join the response desk as a ${input.role}. Click or visit the portal to complete your activation.`,
          notification_type: 'invitation',
          idempotency_key: `inv_${result.invitation.id}`,
          delivery_channel: 'in_app'
        });
      } catch (err) {
        // Outbox duplicate guard
      }

      res.status(201).json({
        success: true,
        data: {
          invitation: result.invitation,
          invitationToken: result.rawToken
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/onboarding/invitations
 * List invitations for the organization
 */
onboardingRouter.get(
  '/invitations',
  authMiddleware,
  tenantMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const onboardingService = new OnboardingService();
      const invitations = onboardingService.listInvitations(req.tenant!.organization_id);

      res.json({
        success: true,
        data: invitations
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/onboarding/invitations/:id/revoke
 * Revoke an active invitation
 */
onboardingRouter.post(
  '/invitations/:id/revoke',
  authMiddleware,
  tenantMiddleware,
  requireRoles('system_admin', 'org_owner', 'org_admin', 'legal_reviewer'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitationId = req.params.id as string;
      const onboardingService = new OnboardingService();
      const actor = {
        user_id: req.user!.id,
        email: req.user!.email,
        role: req.tenant!.role,
        ip_address: req.ip
      };

      const result = onboardingService.revokeInvitation(req.tenant!.organization_id, invitationId, actor);

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
 * POST /api/onboarding/invitations/accept
 * Accept invitation using raw token (public endpoint)
 */
onboardingRouter.post('/invitations/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = AcceptInvitationSchema.parse(req.body);
    const onboardingService = new OnboardingService();

    const result = onboardingService.acceptInvitation(input);

    res.json({
      success: true,
      message: 'Invitation accepted successfully. You can now log in with your credentials.',
      data: {
        userId: result.user.id,
        email: result.user.email,
        fullName: result.user.full_name
      }
    });
  } catch (err: any) {
    if (err.name === 'ZodError' || (err.message && (err.message.includes('invitation') || err.message.includes('token') || err.message.includes('organization')))) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INVITATION', message: err.message }
      });
      return;
    }
    next(err);
  }
});
