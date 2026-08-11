import { connect, StringCodec, type ConnectionOptions, type NatsConnection } from "nats";
import {
  allTaskEventsSubject,
  delegationSubject,
  taskSubject,
  TaskEventSchema,
  type TaskEvent,
} from "@continuous-agentics/delegation-core";

export interface NatsTaskEventsConfig extends ConnectionOptions {
  subjectPrefix: string;
  /** Receives malformed transport data and consumer failures without stopping subscriptions. */
  onError?: (error: unknown, event?: TaskEvent) => void;
}

export type TaskEventHandler = (event: TaskEvent) => Promise<void> | void;

type Connect = (options: ConnectionOptions) => Promise<NatsConnection>;

/**
 * NATS transport adapter for the frozen FleetMind v1.0 task-event protocol.
 * It owns no lifecycle policy; callers choose when to publish or subscribe.
 */
export class NatsTaskEvents {
  private readonly codec = StringCodec();
  private connection?: NatsConnection;
  private connectionPromise?: Promise<NatsConnection>;
  private readonly subscriptions = new Set<symbol>();
  private generation = 0;

  constructor(
    private readonly config: NatsTaskEventsConfig,
    private readonly connectFn: Connect = connect,
  ) {}

  async publish(event: TaskEvent): Promise<void> {
    const connection = await this.getConnection();
    connection.publish(this.subjectFor(event), this.codec.encode(JSON.stringify(TaskEventSchema.parse(event))));
    await connection.flush();
  }

  async subscribeForPm(handler: TaskEventHandler): Promise<() => Promise<void>> {
    return this.subscribe(allTaskEventsSubject(this.config.subjectPrefix), handler);
  }

  async subscribeForWorker(workerId: string, handler: TaskEventHandler): Promise<() => Promise<void>> {
    return this.subscribe(delegationSubject(this.config.subjectPrefix, workerId), handler);
  }

  async close(): Promise<void> {
    const connection = this.connection ?? await this.connectionPromise;
    this.connection = undefined;
    this.connectionPromise = undefined;
    this.subscriptions.clear();
    this.generation += 1;
    if (connection) await connection.drain();
  }

  private async getConnection(): Promise<NatsConnection> {
    if (this.connection) return this.connection;
    const { subjectPrefix: _subjectPrefix, onError: _onError, ...connectionOptions } = this.config;
    this.connectionPromise ??= this.connectFn(connectionOptions)
      .then((connection) => {
        this.connection = connection;
        return connection;
      })
      .catch((error: unknown) => {
        this.connectionPromise = undefined;
        throw error;
      });
    return this.connectionPromise;
  }

  private subjectFor(event: TaskEvent): string {
    if (event.event === "delegation") {
      return delegationSubject(this.config.subjectPrefix, event.worker);
    }
    return taskSubject(this.config.subjectPrefix, event.task_id, event.event);
  }

  private async subscribe(subject: string, handler: TaskEventHandler): Promise<() => Promise<void>> {
    const connection = await this.getConnection();
    const subscription = connection.subscribe(subject);
    const token = Symbol("subscription");
    const generation = this.generation;
    this.subscriptions.add(token);
    void this.consume(subscription, handler);
    let closed = false;
    return async () => {
      if (closed) return;
      closed = true;
      subscription.unsubscribe();
      if (generation !== this.generation || !this.subscriptions.delete(token)) return;
      if (this.subscriptions.size === 0) await this.close();
    };
  }

  private async consume(
    subscription: AsyncIterable<{ data: Uint8Array }>,
    handler: TaskEventHandler,
  ): Promise<void> {
    try {
      for await (const message of subscription) {
        try {
          const parsed = TaskEventSchema.safeParse(JSON.parse(this.codec.decode(message.data)));
          if (!parsed.success) {
            this.reportError(parsed.error);
            continue;
          }
          try {
            await handler(parsed.data);
          } catch (error) {
            this.reportError(error, parsed.data);
          }
        } catch (error) {
          // A malformed peer message must not terminate this subscriber.
          this.reportError(error);
        }
      }
    } catch (error) {
      // NATS can terminate the iterator independently of individual messages.
      this.reportError(error);
    }
  }

  private reportError(error: unknown, event?: TaskEvent): void {
    if (this.config.onError) {
      try {
        this.config.onError(error, event);
      } catch (onErrorFailure) {
        console.error("[fleetmind-delegation] NATS error handler failed", onErrorFailure);
      }
      return;
    }
    console.error("[fleetmind-delegation] NATS task-event handling failed", error);
  }
}
