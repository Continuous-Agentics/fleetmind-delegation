import type { DeliveryContext, TaskEvent, TaskRecord } from "@continuous-agentics/delegation-core";

/** NATS terminal envelopes narrowed from the frozen v1.0 transport contract. */
export type TerminalTaskEvent = TaskEvent & { event: "ship" | "block" };

export interface TerminalEventLedger {
  getTask(taskId: string): Promise<TaskRecord | undefined>;
}

export interface TerminalEventDependencies {
  ledger: TerminalEventLedger;
  pmAgentId: string;
  wakePm(agentId: string, message: string, delivery?: DeliveryContext, legacyThreadUrl?: string): Promise<void> | void;
  onError?: (message: string, error: unknown) => void;
  onInfo?: (message: string) => void;
}

/**
 * Handle a terminal worker event without owning the human review decision.
 * The DDB task record is authoritative for delivery routing and worker identity.
 * A missing or unreadable record may wake the PM only through its neutral session.
 */
export async function handleTerminalTaskEvent(
  event: TerminalTaskEvent,
  deps: TerminalEventDependencies,
): Promise<void> {
  let task: TaskRecord | undefined;
  try {
    task = await deps.ledger.getTask(event.task_id);
  } catch (error) {
    deps.onError?.(`Could not read task ${event.task_id}; waking the PM without ledger routing.`, error);
  }
  if (task && task.worker !== event.worker) {
    deps.onError?.(`Ignoring terminal event for task ${event.task_id}: worker does not match the ledger record.`, new Error("Worker mismatch."));
    return;
  }

  const message = event.event === "ship"
    ? `NATS: Task ${event.task_id} shipped by ${event.worker}.${event.message ? ` ${event.message}` : ""}`
    : `NATS: Task ${event.task_id} blocked by ${event.worker}.${event.reason ? ` ${event.reason}` : ""}`;

  try {
    await deps.wakePm(
      deps.pmAgentId,
      message,
      task?.delivery_context,
      task?.delegation_thread || undefined,
    );
  } catch (error) {
    deps.onError?.(`Could not wake PM for task ${event.task_id}.`, error);
    return;
  }

  // Workers have already performed the conditional DDB transition. A shipped
  // task requiring sign-off must remain there for an authorized human action.
  if (event.event === "block") {
    deps.onInfo?.(`Task ${event.task_id} is blocked by ${event.worker}${event.reason ? `: ${event.reason}` : ""}`);
  } else {
    deps.onInfo?.(`Task ${event.task_id} shipped by ${event.worker}; awaiting review.`);
  }
}
