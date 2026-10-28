import {
  SQSClient, SendMessageCommand, ReceiveMessageCommand,
  DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message,
} from "@aws-sdk/client-sqs";
import { setTimeout as delay } from "node:timers/promises";
import { TaskEventSchema, type TaskEvent } from "./contracts.js";
import type { TaskEvents, TaskEventHandler } from "./task-events.js";

export interface SqsTaskEventsConfig {
  region?: string;
  /** Trusted deployment configuration, never taken from an event. Standard queues only. */
  pmQueueUrl: string;
  workerQueueUrls: Record<string, string>;
  batchSize?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
  handlerTimeoutMs?: number;
  onError?: (error: unknown, event?: TaskEvent) => void;
}

/** At-least-once notifications. The existing ledger owns deduplication and claims. */
export class SqsTaskEvents implements TaskEvents {
  private readonly client: SQSClient;
  private readonly consumers = new Set<{ controller: AbortController; done: Promise<void> }>();
  private readonly batchSize: number;
  private readonly waitTimeSeconds: number;
  private readonly visibility: number;
  private readonly handlerTimeout: number;
  private closed = false;

  constructor(private readonly config: SqsTaskEventsConfig, client?: SQSClient) {
    const integer = (value: number, min: number, max: number, name: string): number => {
      if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid SQS ${name}.`);
      return value;
    };
    this.batchSize = integer(config.batchSize ?? 5, 1, 10, "batchSize");
    this.waitTimeSeconds = integer(config.waitTimeSeconds ?? 20, 1, 20, "waitTimeSeconds");
    this.visibility = integer(config.visibilityTimeoutSeconds ?? 60, 3, 43200, "visibilityTimeoutSeconds");
    this.handlerTimeout = integer(config.handlerTimeoutMs ?? 120_000, 1, 900_000, "handlerTimeoutMs");
    for (const url of [config.pmQueueUrl, ...Object.values(config.workerQueueUrls)]) {
      if (typeof url !== "string" || !url.startsWith("https://") || url.endsWith(".fifo")) {
        throw new Error("SQS requires configured HTTPS Standard queue URLs.");
      }
    }
    this.client = client ?? new SQSClient({
      region: config.region, maxAttempts: 3,
      requestHandler: { connectionTimeout: 3_000, requestTimeout: 25_000 },
    });
  }

  async publish(event: TaskEvent): Promise<void> {
    this.assertOpen();
    const parsed = TaskEventSchema.parse(event);
    const queue = parsed.event === "delegation" ? this.workerQueue(parsed.worker) : this.config.pmQueueUrl;
    await this.client.send(new SendMessageCommand({ QueueUrl: queue, MessageBody: JSON.stringify(parsed) }));
  }

  async subscribeForPm(handler: TaskEventHandler): Promise<() => Promise<void>> {
    return this.subscribe(this.config.pmQueueUrl, handler, (event) => event.event !== "delegation");
  }

  async subscribeForWorker(workerId: string, handler: TaskEventHandler): Promise<() => Promise<void>> {
    return this.subscribe(this.workerQueue(workerId), handler,
      (event) => event.event === "delegation" && event.worker === workerId);
  }

  async close(): Promise<void> {
    this.closed = true;
    const consumers = [...this.consumers];
    for (const consumer of consumers) consumer.controller.abort();
    await Promise.all(consumers.map((consumer) => consumer.done));
    this.consumers.clear();
    this.client.destroy();
  }

  private workerQueue(workerId: string): string {
    if (!Object.hasOwn(this.config.workerQueueUrls, workerId)) throw new Error(`No configured SQS queue for worker ${workerId}.`);
    return this.config.workerQueueUrls[workerId]!;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SQS task transport is closed.");
  }

  private subscribe(queue: string, handler: TaskEventHandler, accepts: (event: TaskEvent) => boolean): () => Promise<void> {
    this.assertOpen();
    const controller = new AbortController();
    const consumer = { controller, done: Promise.resolve() };
    consumer.done = this.poll(queue, handler, accepts, controller.signal);
    this.consumers.add(consumer);
    return async () => {
      controller.abort();
      await consumer.done;
      this.consumers.delete(consumer);
    };
  }

  private async poll(queue: string, handler: TaskEventHandler, accepts: (event: TaskEvent) => boolean, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.client.send(new ReceiveMessageCommand({
          QueueUrl: queue, MaxNumberOfMessages: this.batchSize, WaitTimeSeconds: this.waitTimeSeconds,
          VisibilityTimeout: this.visibility,
        }), { abortSignal: signal });
        // Each message has its own failure/timeout boundary; poison or uncertain work cannot block its peers.
        await Promise.all((result.Messages ?? []).map((message) => this.deliver(queue, message, handler, accepts, signal)));
        // Also bound empty mock/proxy responses that do not honour long polling.
        if (!result.Messages?.length) await delay(100, undefined, { signal });
      } catch (error) {
        if (signal.aborted) break;
        this.report(error);
        try { await delay(1_000, undefined, { signal }); } catch { break; }
      }
    }
  }

  private async deliver(queue: string, message: Message, handler: TaskEventHandler, accepts: (event: TaskEvent) => boolean, signal: AbortSignal): Promise<void> {
    const receipt = message.ReceiptHandle;
    let event: TaskEvent | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let extension: Promise<void> | undefined;
    let visibilityLost = false;
    const deadline = new AbortController();
    const stop = (): void => deadline.abort();
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) deadline.abort();
    const timeout = setTimeout(stop, this.handlerTimeout);
    try {
      if (!receipt) throw new Error("SQS message has no receipt handle.");
      if (signal.aborted) throw new Error("SQS consumer stopped.");
      event = TaskEventSchema.parse(JSON.parse(message.Body ?? ""));
      if (!accepts(event)) throw new Error("SQS event does not belong to this configured consumer.");
      timer = setInterval(() => {
        if (extension || deadline.signal.aborted) return;
        extension = this.client.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queue, ReceiptHandle: receipt, VisibilityTimeout: this.visibility,
        })).then(() => {}, (error) => { visibilityLost = true; this.report(error, event); })
          .finally(() => { extension = undefined; });
      }, Math.floor(this.visibility * 1_000 / 3));
      await Promise.race([
        Promise.resolve().then(() => handler(event!)),
        delay(this.handlerTimeout + 1, undefined, { signal: deadline.signal }).then(() => { throw new Error("SQS handler timed out."); }),
      ]);
      clearInterval(timer);
      await extension;
      if (signal.aborted || deadline.signal.aborted || visibilityLost) throw new Error("SQS handoff interrupted; notification retained.");
      await this.client.send(new DeleteMessageCommand({ QueueUrl: queue, ReceiptHandle: receipt }));
    } catch (error) {
      this.report(deadline.signal.aborted && !signal.aborted
        ? new Error("SQS handoff deadline exceeded; execution may be uncertain. Inspect the durable task before any resubmission.")
        : error, event);
      // Failure stays invisible until its configured retry window; SQS redrive owns DLQ handling.
      // On shutdown return outstanding receipts promptly, without asserting the business work was cancelled.
      if (signal.aborted && receipt) {
        try {
          clearInterval(timer);
          await extension;
          await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: queue, ReceiptHandle: receipt, VisibilityTimeout: 0 }));
        } catch (releaseError) { this.report(releaseError, event); }
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(timer);
      deadline.abort();
      signal.removeEventListener("abort", stop);
    }
  }

  private report(error: unknown, event?: TaskEvent): void {
    try {
      if (this.config.onError) this.config.onError(error, event);
      else console.error("[fleetmind-delegation] SQS task-event handling failed", error);
    } catch { /* Error reporting must not stop other messages. */ }
  }
}
