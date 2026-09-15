import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
import { requireRoles } from '../middleware/rbac.js';
import { WorkflowTaskService } from '../services/workflow-task-service.js';
import { TaskPriorityEnum, TaskTypeEnum, RoleEnum } from '../domain/types.js';

export const workflowRouter = Router();

workflowRouter.use(authMiddleware);
workflowRouter.use(tenantMiddleware);

const CreateTaskBodySchema = z.object({
  case_id: z.string().min(1),
  task_type: TaskTypeEnum,
  priority: TaskPriorityEnum.default('p2'),
  due_at: z.string().optional().nullable(),
  assigned_role: RoleEnum.default('analyst'),
  assigned_user_id: z.string().optional().nullable(),
  creation_reason: z.string().min(3)
});

const CompleteTaskBodySchema = z.object({
  completion_reason: z.string().min(3, 'Completion reason is required (min 3 chars)')
});

const CancelTaskBodySchema = z.object({
  reason: z.string().min(3, 'Cancellation reason is required (min 3 chars)')
});

/**
 * GET /api/v1/workflow/tasks
 * Lists workflow tasks with optional filtering
 */
workflowRouter.get(
  '/tasks',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskService = new WorkflowTaskService();
      const tasks = taskService.listTasks(req.tenant!.organization_id, {
        caseId: req.query.case_id as string,
        status: req.query.status as any,
        taskType: req.query.task_type as any,
        assignedUserId: req.query.assigned_user_id as string
      });

      res.json({
        success: true,
        data: tasks
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workflow/tasks
 * Creates a workflow task
 */
workflowRouter.post(
  '/tasks',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CreateTaskBodySchema.parse(req.body);
      const taskService = new WorkflowTaskService();

      const task = taskService.createTask({
        caseId: body.case_id,
        organizationId: req.tenant!.organization_id,
        taskType: body.task_type,
        priority: body.priority,
        dueAt: body.due_at,
        assignedRole: body.assigned_role,
        assignedUserId: body.assigned_user_id,
        creationReason: body.creation_reason
      });

      res.status(201).json({
        success: true,
        data: task
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/workflow/tasks/:taskId
 * Retrieves a single task
 */
workflowRouter.get(
  '/tasks/:taskId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskService = new WorkflowTaskService();
      const task = taskService.getTask(req.params.taskId as string, req.tenant!.organization_id);

      if (!task) {
        res.status(404).json({
          success: false,
          error: { code: 'TASK_NOT_FOUND', message: 'Workflow task not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: task
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workflow/tasks/:taskId/acknowledge
 * Acknowledges a task (sets to in_progress)
 */
workflowRouter.post(
  '/tasks/:taskId/acknowledge',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const taskService = new WorkflowTaskService();
      const task = taskService.acknowledgeTask(
        req.params.taskId as string,
        req.tenant!.organization_id,
        req.user!.id
      );

      res.json({
        success: true,
        data: task
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workflow/tasks/:taskId/complete
 * Marks a task as completed
 */
workflowRouter.post(
  '/tasks/:taskId/complete',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'analyst', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CompleteTaskBodySchema.parse(req.body);
      const taskService = new WorkflowTaskService();

      const task = taskService.completeTask(
        req.params.taskId as string,
        req.tenant!.organization_id,
        req.user!.id,
        body.completion_reason
      );

      res.json({
        success: true,
        data: task
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workflow/tasks/:taskId/cancel
 * Cancels a task
 */
workflowRouter.post(
  '/tasks/:taskId/cancel',
  requireRoles('org_owner', 'org_admin', 'case_manager', 'legal_reviewer', 'system_admin'),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = CancelTaskBodySchema.parse(req.body);
      const taskService = new WorkflowTaskService();

      const task = taskService.cancelTask(
        req.params.taskId as string,
        req.tenant!.organization_id,
        req.user!.id,
        body.reason
      );

      res.json({
        success: true,
        data: task
      });
    } catch (err) {
      next(err);
    }
  }
);
