import type { DeliveryContext, TaskEvent, TaskRecord } from "@continuous-agentics/delegation-core";
import {
  type SlackHomeChannel,
  type SlackMessageSender,
  type SlackThreadTarget,
  sendBestEffortSlackThreadReceipt,
  sessionKeyForSlackThread,
  slackThreadTarget,
  workerDelegationReceipt,
} from "./slack-delivery.js";

export type DelegationTaskEvent = TaskEvent & { event: "delegation" };

export interface DelegationEventLedger {
  getTask(taskId: string): Promise<TaskRecord | undefined>;
  ackTask(taskId: string, worker: string, project?: string): Promise<void>;
}

export interface DelegationWakeTarget {
  delivery?: DeliveryContext;
  sessionKey?: string;
}

export interface DelegationEventDependencies {
  ledger: DelegationEventLedger;
  workerAgentId: string;
  workerId: string;
  workerHomeSlack?: SlackHomeChannel;
  slackSender?: SlackMessageSender;
  wakeWorker(agentId: string, message: string, target?: DelegationWakeTarget): Promise<void> | void;
  onError?: (message: string, error: unknown) => void;
  onInfo?: (message: string) => void;
}

function slackDelivery(target: SlackThreadTarget): DeliveryContext {
  return {
    provider: "slack",
    accountId: target.accountId,
    conversationId: target.conversationId,
    threadId: target.threadId,
  };
}

function deliveryWakeTarget(agentId: string, delivery?: DeliveryContext): DelegationWakeTarget | undefined {
  if (!delivery) return undefined;
  const sessionKey = delivery.provider === "slack" && delivery.threadId
    ? sessionKeyForSlackThread(agentId, {
      provider: "slack",
      accountId: delivery.accountId,
      conversationId: delivery.conversationId,
      threadId: delivery.threadId,
    })
    : `agent:${agentId}:${delivery.provider}:channel:${delivery.conversationId}`;
  return { delivery, sessionKey };
}

/**
 * Deliver an authoritative delegation event to its configured worker. NATS
 * fields are identifiers only: task routing, worker identity, and prompt
 * context are derived from the DDB record.
 */
export async function handleDelegationTaskEvent(
  event: DelegationTaskEvent,
  deps: DelegationEventDependencies,
): Promise<void> {
  if (event.worker !== deps.workerId) return;

  let task: TaskRecord | undefined;
  try {
    task = await deps.ledger.getTask(event.task_id);
  } catch (error) {
    deps.onError?.(`Could not read task ${event.task_id}; refusing unverified delegation event.`, error);
    return;
  }
  if (!task) {
    deps.onError?.(`Ignoring delegation event for missing task ${event.task_id}.`, new Error("Missing task."));
    return;
  }
  if (task.worker !== deps.workerId || task.status !== "delegated") {
    deps.onError?.(`Ignoring delegation event for task ${event.task_id}: ledger worker or status does not permit delivery.`, new Error("Task mismatch or not delegated."));
    return;
  }

  const originalThread = slackThreadTarget(task.delivery_context, task.delegation_thread);
  const receipt = workerDelegationReceipt(task.task_id, task.delegated_by, task.delegation_thread || undefined);
  let wakeTarget: DelegationWakeTarget | undefined;

  if (deps.workerHomeSlack && task.delivery_context?.provider === "slack" && deps.slackSender) {
    try {
      const result = await deps.slackSender.sendText({
        conversationId: deps.workerHomeSlack.conversationId,
        accountId: deps.workerHomeSlack.accountId,
        text: receipt,
      });
      if (result.messageId) {
        const target: SlackThreadTarget = {
          provider: "slack",
          accountId: deps.workerHomeSlack.accountId,
          conversationId: deps.workerHomeSlack.conversationId,
          threadId: result.messageId,
        };
        wakeTarget = { delivery: slackDelivery(target), sessionKey: sessionKeyForSlackThread(deps.workerAgentId, target) };
      }
    } catch (error) {
      deps.onError?.(`Could not post worker receipt for task ${task.task_id}; falling back to the delegation thread.`, error);
    }
  }

  if (!wakeTarget && originalThread) {
    if (deps.slackSender) {
      await sendBestEffortSlackThreadReceipt(deps.slackSender, originalThread, receipt,
        (error) => deps.onError?.(`Could not post delegation-thread receipt for task ${task.task_id}.`, error));
    }
    wakeTarget = { delivery: slackDelivery(originalThread), sessionKey: sessionKeyForSlackThread(deps.workerAgentId, originalThread) };
  }
  wakeTarget ??= deliveryWakeTarget(deps.workerAgentId, task.delivery_context);

  try {
    await deps.wakeWorker(
      deps.workerAgentId,
      `FleetMind delegation received for task ${task.task_id}. Inspect the authoritative task ledger before taking action.`,
      wakeTarget,
    );
  } catch (error) {
    deps.onError?.(`Could not wake worker for task ${task.task_id}.`, error);
    return;
  }

  try {
    await deps.ledger.ackTask(task.task_id, deps.workerId, task.project);
    deps.onInfo?.(`Delegation delivered and acknowledged for task ${task.task_id}.`);
  } catch (error) {
    deps.onError?.(`Worker wake succeeded but acknowledgement failed for task ${task.task_id}.`, error);
  }
}
