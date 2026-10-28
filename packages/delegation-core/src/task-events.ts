import type { TaskEvent } from "./contracts.js";
import { NatsTaskEvents, type NatsTaskEventsConfig } from "./nats-task-events.js";
import { SqsTaskEvents, type SqsTaskEventsConfig } from "./sqs-task-events.js";

/** A handler resolves only after its durable handoff (or durable duplicate check).
 * Reject to retain a notification for retry. Publishing is never a consumer ACK.
 */
export type TaskEventHandler = (event: TaskEvent) => Promise<void> | void;

export interface TaskEvents {
  publish(event: TaskEvent): Promise<void>;
  subscribeForPm(handler: TaskEventHandler): Promise<() => Promise<void>>;
  subscribeForWorker(workerId: string, handler: TaskEventHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export type TaskEventsConfig =
  | ({ provider: "nats" } & NatsTaskEventsConfig)
  | ({ provider: "sqs" } & SqsTaskEventsConfig);

export function createTaskEvents(config: TaskEventsConfig): TaskEvents {
  const { provider, ...options } = config;
  return provider === "sqs"
    ? new SqsTaskEvents(options as SqsTaskEventsConfig)
    : new NatsTaskEvents(options as NatsTaskEventsConfig);
}
