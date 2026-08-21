import type { DeliveryContext } from "@continuous-agentics/delegation-core";

export interface SlackThreadTarget {
  provider: "slack";
  accountId?: string;
  conversationId: string;
  threadId: string;
}

export interface SlackHomeChannel {
  accountId: string;
  conversationId: string;
}

export interface SlackMessageSender {
  sendText(input: {
    conversationId: string;
    text: string;
    threadId?: string;
    accountId?: string;
  }): Promise<{ messageId?: string }>;
}

/**
 * Resolve an authoritative Slack thread. A legacy permalink is accepted only
 * when a task does not have a structured delivery context.
 */
export function slackThreadTarget(
  delivery?: DeliveryContext,
  legacyThreadUrl?: string,
): SlackThreadTarget | undefined {
  if (delivery?.provider === "slack" && delivery.threadId) {
    return {
      provider: "slack",
      accountId: delivery.accountId,
      conversationId: delivery.conversationId,
      threadId: delivery.threadId,
    };
  }
  if (delivery) return undefined;
  const match = legacyThreadUrl?.match(/\/archives\/([A-Z0-9]+)\/p(\d{7,})/);
  if (!match) return undefined;
  const compact = match[2]!;
  return {
    provider: "slack",
    conversationId: match[1]!,
    threadId: `${compact.slice(0, -6)}.${compact.slice(-6)}`,
  };
}

export function sessionKeyForSlackThread(agentId: string, target: SlackThreadTarget): string {
  return `agent:${agentId}:slack:channel:${target.conversationId.toLowerCase()}:thread:${target.threadId}`;
}

export function workerDelegationReceipt(taskId: string, delegatedBy?: string, backlink?: string): string {
  const trigger = backlink ? ` Triggered by ${backlink}.` : "";
  return `👋 Received delegation \`${taskId}\` from ${delegatedBy ?? "PM"} — picking up.${trigger}`;
}

export function pmTerminalReceipt(event: "ship" | "block", taskId: string, worker: string): string {
  return event === "ship"
    ? `✓ ${worker} shipped \`${taskId}\` — awaiting PM review.`
    : `⚠️ ${worker} blocked \`${taskId}\` — awaiting PM review.`;
}

/**
 * Send a thread receipt without making Slack availability a prerequisite for
 * the caller's NATS handling or OpenClaw wake.
 */
export async function sendBestEffortSlackThreadReceipt(
  sender: SlackMessageSender,
  target: SlackThreadTarget,
  text: string,
  onError?: (error: unknown) => void,
): Promise<void> {
  try {
    await sender.sendText({
      conversationId: target.conversationId,
      threadId: target.threadId,
      accountId: target.accountId,
      text,
    });
  } catch (error) {
    onError?.(error);
  }
}
