import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message } from "@aws-sdk/client-sqs";
import type { TaskEvent } from "../src/contracts.js";

export const config = {
  region: "us-east-1", pmQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/pm",
  workerQueueUrls: { forge: "https://sqs.us-east-1.amazonaws.com/123456789012/forge" },
};
export const event: TaskEvent = { v: "1.0", event: "delegation", task_id: "deadbeef", worker: "forge", at: "2026-10-28T00:00:00Z" };
export const terminal: TaskEvent = { ...event, event: "ship", terminal_event_id: "00000000-0000-4000-8000-000000000001" };
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
export async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.ok(predicate(), "condition did not settle before test deadline");
}

/** Mock only the actual AWS SDK send boundary; no transport or handler implementation. */
export class SqsBoundary {
  readonly calls: Array<SendMessageCommand | ReceiveMessageCommand | DeleteMessageCommand | ChangeMessageVisibilityCommand> = [];
  readonly errors: unknown[] = [];
  readonly queues = new Map<string, Message[]>();
  readonly waiters = new Map<string, () => void>();
  destroyed = false;
  failDelete = false;
  failVisibility = false;
  receiveFailures = 0;
  private serial = 0;

  enqueue(queue: string, body: TaskEvent | string, receipt?: string): void {
    const messages = this.queues.get(queue) ?? [];
    messages.push({ Body: typeof body === "string" ? body : JSON.stringify(body), ReceiptHandle: receipt ?? `receipt-${++this.serial}` });
    this.queues.set(queue, messages);
    this.waiters.get(queue)?.();
  }

  readonly send = async (command: SqsBoundary["calls"][number], options?: { abortSignal?: AbortSignal }): Promise<any> => {
    this.calls.push(command);
    if (command instanceof SendMessageCommand) {
      this.enqueue(command.input.QueueUrl!, command.input.MessageBody!);
      return { MessageId: "sent" };
    }
    if (command instanceof ReceiveMessageCommand) {
      if (this.receiveFailures > 0) { this.receiveFailures--; throw new Error("receive unavailable"); }
      const queue = command.input.QueueUrl!;
      if (!this.queues.get(queue)?.length && !options?.abortSignal?.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => { this.waiters.delete(queue); options?.abortSignal?.removeEventListener("abort", done); resolve(); };
          this.waiters.set(queue, done);
          options?.abortSignal?.addEventListener("abort", done, { once: true });
        });
      }
      return { Messages: this.queues.get(queue)?.splice(0, command.input.MaxNumberOfMessages) ?? [] };
    }
    if (command instanceof DeleteMessageCommand && this.failDelete) throw new Error("delete unavailable");
    if (command instanceof ChangeMessageVisibilityCommand && this.failVisibility) throw new Error("visibility unavailable");
    return {};
  };
  readonly destroy = (): void => { this.destroyed = true; };
  get client(): SQSClient { return this as unknown as SQSClient; }
  get deleted(): string[] { return this.calls.filter((x) => x instanceof DeleteMessageCommand).map((x) => x.input.ReceiptHandle!); }
}
