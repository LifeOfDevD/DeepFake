import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { LocalDryRunBillingProvider } from '../services/billing/dry-run-billing-provider.js';

export const billingRouter = Router();

billingRouter.use(authMiddleware);
billingRouter.use(tenantMiddleware);

/**
 * GET /api/billing/plans
 * View plan catalog with limits, base pricing, and overage schedules
 */
billingRouter.get('/plans', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = new LocalDryRunBillingProvider();
    const plans = provider.listPlans();

    res.json({
      success: true,
      data: plans,
      disclaimer: 'DRY-RUN SIMULATION ONLY. Live billing is permanently disabled during pilot operations.'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/preview
 * Generate a simulated dry-run invoice preview for the current billing cycle
 */
billingRouter.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = new LocalDryRunBillingProvider();
    const invoice = await provider.previewUpcomingInvoice(req.tenant!.organization_id);

    res.json({
      success: true,
      data: invoice
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/customer
 * Retrieve simulated customer and subscription profile
 */
billingRouter.get('/customer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = new LocalDryRunBillingProvider();
    const customer = await provider.getOrCreateCustomer(req.tenant!.organization_id);
    const subscription = await provider.getSubscription(req.tenant!.organization_id);

    res.json({
      success: true,
      data: {
        customer,
        subscription
      }
    });
  } catch (err) {
    next(err);
  }
});
