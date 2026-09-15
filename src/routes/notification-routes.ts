import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { NotificationService } from '../services/notification-service.js';

export const notificationRouter = Router();

notificationRouter.use(authMiddleware);
notificationRouter.use(tenantMiddleware);

/**
 * GET /api/notifications
 * Get in-app notifications for current user
 */
notificationRouter.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new NotificationService();
    const unreadOnly = req.query.unread_only === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const notifications = service.getUserNotifications(
      req.tenant!.organization_id,
      req.user!.id,
      unreadOnly,
      limit
    );

    res.json({
      success: true,
      data: notifications
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark single notification as read
 */
notificationRouter.post('/:id/read', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new NotificationService();
    const notificationId = req.params.id as string;

    const updated = service.markAsRead(req.tenant!.organization_id, req.user!.id, notificationId);

    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read for current user
 */
notificationRouter.post('/read-all', (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = new NotificationService();
    const count = service.markAllAsRead(req.tenant!.organization_id, req.user!.id);

    res.json({
      success: true,
      data: { markedReadCount: count }
    });
  } catch (err) {
    next(err);
  }
});
