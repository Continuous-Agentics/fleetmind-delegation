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
 * Missing or unreadable records are rejected: only a validated DDB task may
 * wake the PM. NATS free text is never included in the PM prompt.
 */
export async function handleTerminalTaskEvent(
  event: TerminalTaskEvent,
  deps: TerminalEventDependencies,
): Promise<void> {
  let task: TaskRecord | undefined;
  try {
    task = await deps.ledger.getTask(event.task_id);
  } catch (error) {
    deps.onError?.(`Could not read task ${event.task_id}; refusing unverified terminal event.`, error);
    return;
  }
  if (!task) {
    deps.onError?.(`Ignoring terminal event for missing task ${event.task_id}.`, new Error("Missing task."));
    return;
  }
  if (task.worker !== event.worker) {
    deps.onError?.(`Ignoring terminal event for task ${event.task_id}: worker does not match the ledger record.`, new Error("Worker mismatch."));
    return;
  }

  const message = `FleetMind terminal event received for task ${task.task_id}. Review the authoritative task ledger before taking any action.`;

  try {
    await deps.wakePm(
      deps.pmAgentId,
      message,
      task.delivery_context,
      task.delegation_thread || undefined,
    );
  } catch (error) {
    deps.onError?.(`Could not wake PM for task ${event.task_id}.`, error);
    return;
  }

  // Workers have already performed the conditional DDB transition. A shipped
  // task requiring sign-off must remain there for an authorized human action.
  deps.onInfo?.(`Terminal event received for authoritative task ${task.task_id}; awaiting PM review.`);
}
