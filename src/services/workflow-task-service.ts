import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/connection.js';
import {
  Role,
  TaskPriority,
  TaskStatus,
  TaskType,
  WorkflowTask
} from '../domain/types.js';

export interface CreateTaskParams {
  caseId: string;
  organizationId: string;
  taskType: TaskType;
  priority?: TaskPriority;
  dueAt?: string | null;
  assignedRole: Role;
  assignedUserId?: string | null;
  creationReason: string;
}

export interface TaskFilterOptions {
  caseId?: string;
  status?: TaskStatus;
  taskType?: TaskType;
  assignedUserId?: string;
}

export class WorkflowTaskService {
  constructor(private db: Database.Database = getDatabase()) {}

  /**
   * Creates a new internal workflow task
   */
  public createTask(params: CreateTaskParams): WorkflowTask {
    const id = uuidv4();
    const nowIso = new Date().toISOString();
    const priority = params.priority || 'p2';

    this.db.prepare(`
      INSERT INTO workflow_tasks (
        id, case_id, organization_id, task_type, priority,
        due_at, assigned_role, assigned_user_id, status,
        creation_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      id,
      params.caseId,
      params.organizationId,
      params.taskType,
      priority,
      params.dueAt || null,
      params.assignedRole,
      params.assignedUserId || null,
      params.creationReason,
      nowIso,
      nowIso
    );

    return {
      id,
      case_id: params.caseId,
      organization_id: params.organizationId,
      task_type: params.taskType,
      priority,
      due_at: params.dueAt || null,
      assigned_role: params.assignedRole,
      assigned_user_id: params.assignedUserId || null,
      status: 'pending',
      creation_reason: params.creationReason,
      created_at: nowIso,
      updated_at: nowIso
    };
  }

  /**
   * Lists tasks for an organization with optional filters
   */
  public listTasks(organizationId: string, filter?: TaskFilterOptions): WorkflowTask[] {
    let query = 'SELECT * FROM workflow_tasks WHERE organization_id = ?';
    const params: any[] = [organizationId];

    if (filter?.caseId) {
      query += ' AND case_id = ?';
      params.push(filter.caseId);
    }
    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.taskType) {
      query += ' AND task_type = ?';
      params.push(filter.taskType);
    }
    if (filter?.assignedUserId) {
      query += ' AND assigned_user_id = ?';
      params.push(filter.assignedUserId);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      case_id: r.case_id,
      organization_id: r.organization_id,
      task_type: r.task_type,
      priority: r.priority,
      due_at: r.due_at,
      assigned_role: r.assigned_role,
      assigned_user_id: r.assigned_user_id,
      status: r.status,
      creation_reason: r.creation_reason,
      completion_reason: r.completion_reason,
      completed_by: r.completed_by,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));
  }

  /**
   * Acknowledges a task (transitions from pending to in_progress)
   */
  public acknowledgeTask(taskId: string, organizationId: string, actorUserId: string): WorkflowTask {
    const task = this.getTask(taskId, organizationId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE workflow_tasks
      SET status = 'in_progress', assigned_user_id = COALESCE(assigned_user_id, ?), updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(actorUserId, nowIso, taskId, organizationId);

    return this.getTask(taskId, organizationId)!;
  }

  /**
   * Completes a task
   */
  public completeTask(
    taskId: string,
    organizationId: string,
    actorUserId: string,
    completionReason: string
  ): WorkflowTask {
    const task = this.getTask(taskId, organizationId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE workflow_tasks
      SET status = 'completed', completion_reason = ?, completed_by = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(completionReason, actorUserId, nowIso, taskId, organizationId);

    return this.getTask(taskId, organizationId)!;
  }

  /**
   * Cancels a task
   */
  public cancelTask(
    taskId: string,
    organizationId: string,
    actorUserId: string,
    reason: string
  ): WorkflowTask {
    const task = this.getTask(taskId, organizationId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE workflow_tasks
      SET status = 'cancelled', completion_reason = ?, completed_by = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(reason, actorUserId, nowIso, taskId, organizationId);

    return this.getTask(taskId, organizationId)!;
  }

  /**
   * Retrieves single task by id and org
   */
  public getTask(taskId: string, organizationId: string): WorkflowTask | null {
    const r = this.db.prepare(`
      SELECT * FROM workflow_tasks
      WHERE id = ? AND organization_id = ?
    `).get(taskId, organizationId) as any;

    if (!r) return null;

    return {
      id: r.id,
      case_id: r.case_id,
      organization_id: r.organization_id,
      task_type: r.task_type,
      priority: r.priority,
      due_at: r.due_at,
      assigned_role: r.assigned_role,
      assigned_user_id: r.assigned_user_id,
      status: r.status,
      creation_reason: r.creation_reason,
      completion_reason: r.completion_reason,
      completed_by: r.completed_by,
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  }
}
