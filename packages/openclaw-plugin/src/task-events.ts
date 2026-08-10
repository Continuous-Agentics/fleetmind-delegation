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
  private activeSubscriptions = 0;

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
    this.activeSubscriptions = 0;
    if (connection) await connection.drain();
  }

  private async getConnection(): Promise<NatsConnection> {
    if (this.connection) return this.connection;
    this.connectionPromise ??= this.connectFn(this.config)
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
    this.activeSubscriptions += 1;
    void (async () => {
      for await (const message of subscription) {
        try {
          const parsed = TaskEventSchema.safeParse(JSON.parse(this.codec.decode(message.data)));
          if (parsed.success) await handler(parsed.data);
        } catch {
          // Ignore malformed transport input; a peer must not terminate this subscriber.
        }
      }
    })();
    let closed = false;
    return async () => {
      if (closed) return;
      closed = true;
      subscription.unsubscribe();
      this.activeSubscriptions = Math.max(0, this.activeSubscriptions - 1);
      if (this.activeSubscriptions === 0) await this.close();
    };
  }
}
