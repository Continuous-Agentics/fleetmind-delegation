import { z } from "zod";

export const TaskStatusSchema = z.enum([
  "delegated",
  "accepted",
  "shipped",
  "signed_off",
  "merged",
  "blocked",
  "abandoned",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const LifecycleSchema = z.enum([
  "requires-human-signoff",
  "shipped-is-done",
]);
export type Lifecycle = z.infer<typeof LifecycleSchema>;

/** Channel-neutral location and participants for a human-facing task conversation. */
export const DeliveryContextSchema = z.object({
  provider: z.string().min(1),
  accountId: z.string().min(1),
  conversationId: z.string().min(1),
  threadId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  actorIds: z.record(z.string(), z.string()).optional(),
});
export type DeliveryContext = z.infer<typeof DeliveryContextSchema>;

/**
 * A durable terminal-notification outbox record, stored separately from its
 * task record. Both are written in one DynamoDB transaction, so a worker
 * crash cannot leave a shipped/blocked task with no event to relay.
 */
export const TerminalEventOutboxSchema = z.object({
  event: z.enum(["ship", "block"]),
  at: z.string(),
  worker: z.string(),
  delivery_status: z.enum(["pending", "delivering", "delivered"]),
  delivery_attempts: z.number().int().nonnegative().default(0),
  lease_id: z.string().optional(),
  lease_expires_at: z.string().optional(),
  delivered_at: z.string().optional(),
});
export type TerminalEventOutbox = z.infer<typeof TerminalEventOutboxSchema>;

/** Separate durable relay record. It deliberately duplicates only the safe
 * terminal envelope fields, so discovery never depends on task status. */
export const TerminalEventOutboxRecordSchema = TerminalEventOutboxSchema.extend({
  PK: z.string(),
  GSI2PK: z.string(),
  delegated_at: z.string(),
  task_id: z.string().regex(/^[0-9a-f]{8}$/),
  project: z.string(),
  delegated_by: z.string(),
  delivery_context: DeliveryContextSchema.optional(),
  delegation_thread: z.string().optional(),
  expires_at: z.number(),
});
export type TerminalEventOutboxRecord = z.infer<typeof TerminalEventOutboxRecordSchema>;

/** Current compatible DynamoDB task-record shape. */
export const TaskRecordSchema = z.object({
  PK: z.string(),
  task_id: z.string().regex(/^[0-9a-f]{8}$/),
  v: z.string().default("0.2"),
  project: z.string(),
  status: TaskStatusSchema,
  GSI1PK: z.string(),
  GSI2PK: z.string(),
  delegated_by: z.string(),
  worker: z.string(),
  delegated_at: z.string(),
  accepted_at: z.string().optional(),
  shipped_at: z.string().optional(),
  signed_off_at: z.string().optional(),
  merged_at: z.string().optional(),
  blocked_at: z.string().optional(),
  unblocked_at: z.string().optional(),
  unblocked_reason: z.string().optional(),
  abandoned_at: z.string().optional(),
  last_nag_at: z.string().optional(),
  lifecycle: LifecycleSchema,
  definition_of_done: z.string(),
  delegation_thread: z.string().default(""),
  delegation_envelope_ts: z.string().default(""),
  delivery_context: DeliveryContextSchema.optional(),
  tracker_link: z.string().nullable().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  requestor: z.string().optional(),
  task_s3_key: z.string(),
  expires_at: z.number(),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
  update_history: z.array(z.object({
    at: z.string(),
    by: z.string(),
    reason: z.string().optional(),
    fields_changed: z.array(z.string()),
  })).optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export function taskPK(taskId: string): string {
  return `TASK#${taskId}`;
}

export interface S3KeyContext {
  project: string;
  date: string;
  task_id: string;
}

export function renderS3Key(template: string, ctx: S3KeyContext): string {
  return template
    .replace("{project}", ctx.project)
    .replace("{date}", ctx.date)
    .replace("{task_id}", ctx.task_id);
}

export const DEFAULT_S3_KEY_TEMPLATE = "v0/projects/{project}/tasks/{date}-{task_id}.md";

export interface CreateTaskInput {
  task_id: string;
  project: string;
  delegated_by: string;
  worker: string;
  definition_of_done: string;
  delegation_thread?: string;
  delegation_envelope_ts?: string;
  delivery_context?: DeliveryContext;
  tracker_link?: string | null;
  lifecycle?: Lifecycle;
  description?: string;
  requestor?: string;
  delegated_at?: string;
  s3_key_template?: string;
}

export interface TaskSummary {
  task_id: string;
  project: string;
  status: TaskStatus;
  delegated_at: string;
  worker: string;
  task_s3_key: string;
}

export function gsi1pk(project: string, status: TaskStatus): string {
  return `PROJECT#${project}#STATUS#${status}`;
}

export function gsi2pk(status: TaskStatus): string {
  return `STATUS#${status}`;
}

export const TaskEventTypeSchema = z.enum(["delegation", "ack", "progress", "ship", "block"]);
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;

/** Versioned NATS envelope preserved from FleetMind's existing transport. */
export const TaskEventSchema = z.object({
  v: z.literal("1.0"),
  event: TaskEventTypeSchema,
  task_id: z.string(),
  project: z.string().optional(),
  worker: z.string(),
  delegated_by: z.string().optional(),
  at: z.string(),
  definition_of_done: z.string().optional(),
  description: z.string().optional(),
  requestor: z.string().optional(),
  tracker_link: z.string().optional(),
  delegation_thread: z.string().optional(),
  delegation_envelope_ts: z.string().optional(),
  delivery_context: DeliveryContextSchema.optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;

export function delegationSubject(prefix: string, workerId: string): string {
  return `${prefix}.delegation.${workerId}`;
}

export function taskSubject(
  prefix: string,
  taskId: string,
  event: Exclude<TaskEventType, "delegation">,
): string {
  return `${prefix}.task.${taskId}.${event}`;
}

export function allTaskEventsSubject(prefix: string): string {
  return `${prefix}.task.>`;
}
