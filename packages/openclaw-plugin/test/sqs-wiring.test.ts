import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand, type Message } from "@aws-sdk/client-sqs";
import { setTimeout as delay } from "node:timers/promises";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TaskLedger, type TaskRecord, type TerminalEventOutboxRecord } from "@continuous-agentics/delegation-core";
import plugin from "../src/index.js";
// Service fixture mocks the real SDK send boundary, not transport or ledger logic.
const config = {
  region: "us-east-1", pmQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/pm",
  workerQueueUrls: { forge: "https://sqs.us-east-1.amazonaws.com/123456789012/forge" },
};
const event = { v: "1.0" as const, event: "delegation" as const, task_id: "deadbeef", worker: "forge", at: "2026-10-28T00:00:00Z" };
const terminal = { ...event, event: "ship" as const, terminal_event_id: "00000000-0000-4000-8000-000000000001" };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await delay(5);
  assert.ok(predicate(), "fixture did not settle");
}
class SqsBoundary {
  readonly calls: any[] = [];
  readonly errors: unknown[] = [];
  readonly queues = new Map<string, Message[]>();
  readonly waiters = new Map<string, () => void>();
  private serial = 0;
  enqueue(queue: string, body: unknown, receipt?: string): void {
    const messages = this.queues.get(queue) ?? [];
    messages.push({ Body: typeof body === "string" ? body : JSON.stringify(body), ReceiptHandle: receipt ?? `receipt-${++this.serial}` });
    this.queues.set(queue, messages); this.waiters.get(queue)?.();
  }
  readonly send = async (command: any, options?: { abortSignal?: AbortSignal }): Promise<any> => {
    this.calls.push(command);
    if (command instanceof SendMessageCommand) {
      this.enqueue(command.input.QueueUrl!, command.input.MessageBody!); return {};
    }
    if (command instanceof ReceiveMessageCommand) {
      const queue = command.input.QueueUrl!;
      if (!this.queues.get(queue)?.length && !options?.abortSignal?.aborted) {
        await new Promise<void>((resolve) => {
          const done = () => { this.waiters.delete(queue); options?.abortSignal?.removeEventListener("abort", done); resolve(); };
          this.waiters.set(queue, done); options?.abortSignal?.addEventListener("abort", done, { once: true });
        });
      }
      return { Messages: this.queues.get(queue)?.splice(0, command.input.MaxNumberOfMessages) ?? [] };
    }
    assert.ok(command instanceof DeleteMessageCommand || command instanceof ChangeMessageVisibilityCommand);
    return {};
  };
  readonly destroy = (): void => {};
  get deleted(): string[] { return this.calls.filter((x) => x instanceof DeleteMessageCommand).map((x) => x.input.ReceiptHandle!); }
}

const initialTask = (): TaskRecord => ({
  PK: "TASK#deadbeef", task_id: "deadbeef", v: "1.0", project: "demo", status: "delegated",
  GSI1PK: "PROJECT#demo#STATUS#delegated", GSI2PK: "STATUS#delegated", delegated_by: "pm",
  worker: "forge", delegated_at: event.at, lifecycle: "requires-human-signoff", definition_of_done: "done",
  delegation_thread: "", delegation_envelope_ts: "", task_s3_key: "tasks/deadbeef", expires_at: 1,
  delivery_context: { provider: "discord", accountId: "main", conversationId: "trusted" },
});

type Service = { id: string; start(ctx: unknown): Promise<void>; stop(): Promise<void> };
const ctx = { config: {}, logger: { error() {}, warn() {}, info() {} } };

function fixture(t: TestContext, options: {
  run?: () => Promise<unknown>; sendReceipt?: () => Promise<unknown>;
  sqsOptions?: Record<string, unknown>; legacy?: boolean;
} = {}) {
  const aws = new SqsBoundary(); const order: string[] = [];
  let task = initialTask(); let outbox: TerminalEventOutboxRecord | undefined;
  let failRead = false; let failAck = false; let failComplete = false;
  let leaseLost = false;
  let completionGate: ReturnType<typeof deferred<void>> | undefined;
  const conditional = () => new ConditionalCheckFailedException({ $metadata: {}, message: "fixture condition failed" });
  t.mock.method(SQSClient.prototype, "send", aws.send);
  t.mock.method(SQSClient.prototype, "destroy", aws.destroy);
  const commands: unknown[] = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command: unknown) => {
    commands.push(command);
    if (command instanceof QueryCommand) return { Items: [] };
    if (command instanceof GetCommand) {
      if (failRead) throw new Error("DDB read unavailable");
      return { Item: command.input.Key?.PK === task.PK ? { ...task } : outbox && { ...outbox } };
    }
    if (command instanceof TransactWriteCommand) {
      const items = command.input.TransactItems!;
      const update = items.find((item) => item.Update)!.Update!;
      assert.match(update.ConditionExpression!, /#st = :accepted AND #worker = :worker/);
      task = { ...task, status: "shipped" };
      outbox = { ...items.find((item) => item.Put)!.Put!.Item } as TerminalEventOutboxRecord;
      order.push("transaction"); return {};
    }
    if (command instanceof UpdateCommand) {
      const values = command.input.ExpressionAttributeValues!;
      if (values[":accepted"] === "accepted" && !values[":delivering"]) {
        assert.equal(command.input.ConditionExpression, "#st = :delegated AND #worker = :worker");
        if (failAck) throw new Error("DDB update unavailable");
        if (task.status !== "delegated") throw conditional();
        task = { ...task, status: "accepted" }; order.push("accepted"); return {};
      }
      if (values[":gsi"] === "OUTBOX#DELIVERING") {
        if (!outbox || outbox.delivery_status !== "pending") throw conditional();
        outbox = { ...outbox, delivery_status: "delivering", lease_id: values[":lease_id"] as string };
        order.push("claimed"); return {};
      }
      if (values[":delivered"] === "delivered") {
        order.push("complete-start"); await completionGate?.promise;
        if (failComplete) throw new Error("DDB completion unavailable");
        if (leaseLost) throw conditional();
        outbox = { ...outbox!, delivery_status: "delivered" }; order.push("delivered"); return {};
      }
      if (values[":pending"] === "pending") {
        outbox = { ...outbox!, delivery_status: "pending" }; order.push("released"); return {};
      }
    }
    throw new Error("Unexpected DDB command at fixture boundary");
  });
  const services: Service[] = []; const tools = new Map<string, any>();
  const runtime = {
    agent: {
      resolveAgentTimeoutMs: () => 1000, resolveAgentWorkspaceDir: () => "/tmp",
      runEmbeddedAgent: async () => { order.push("run"); return options.run?.(); },
    },
    channel: { outbound: { loadAdapter: async () => ({ sendText: async (input: { to: string }) => {
      assert.equal(input.to, "trusted"); order.push("receipt"); return options.sendReceipt?.() ?? {};
    } }) } },
  };
  plugin.register({
    pluginConfig: {
      tableName: "tasks", awsRegion: "us-east-1", workerAgentIds: { "forge-agent": "forge" },
      ...(options.legacy ? {} : { taskEventTransport: { provider: "sqs", ...config, ...options.sqsOptions } }),
      delegationEvents: { agentId: "forge-agent" }, terminalEvents: { pmAgentId: "pm" },
    },
    runtime,
    registerService: (service: Service) => { services.push(service); },
    registerTool: (tool: any) => { tools.set(tool.name, tool); }, registerHook() {},
  } as never);
  t.after(async () => { for (const service of services) await service.stop(); });
  return {
    aws, order, commands, tools, runtime,
    worker: services.find((s) => s.id === "fleetmind-delegation-worker-events")!,
    pm: services.find((s) => s.id === "fleetmind-delegation-terminal-events")!,
    get task() { return task; }, get outbox() { return outbox; },
    set failRead(value: boolean) { failRead = value; }, set failAck(value: boolean) { failAck = value; },
    set failComplete(value: boolean) { failComplete = value; }, set leaseLost(value: boolean) { leaseLost = value; },
    set completionGate(value: ReturnType<typeof deferred<void>>) { completionGate = value; },
    seedOutbox(status: "pending" | "delivering" | "delivered" = "pending") {
      task = { ...task, status: "shipped" };
      outbox = {
        PK: `OUTBOX#deadbeef#ship#${terminal.terminal_event_id}`, GSI2PK: `OUTBOX#${status.toUpperCase()}`,
        ...terminal, event: "ship", task_id: "deadbeef", project: "demo", delegated_by: "pm",
        delegated_at: event.at, terminal_event_id: terminal.terminal_event_id!, delivery_status: status,
        delivery_attempts: 0, expires_at: 1,
      };
    },
  };
}

test("configured SQS worker service uses the real TaskLedger claim, executes once and ACKs duplicates", async (t) => {
  const run = deferred(); const f = fixture(t, { run: () => run.promise });
  f.aws.enqueue(config.workerQueueUrls.forge, event, "first");
  await f.worker.start(ctx); await until(() => f.order.includes("run"));
  assert.equal(f.task.status, "accepted"); assert.deepEqual(f.aws.deleted, []);
  f.aws.enqueue(config.workerQueueUrls.forge, event, "duplicate");
  run.resolve(); await until(() => f.aws.deleted.length === 2);
  assert.deepEqual(f.order, ["accepted", "run"]);
});

test("worker read and claim failures retain notifications, and uncertain execution is not resubmitted", async (t) => {
  const f = fixture(t, { run: async () => { throw new Error("execution outcome uncertain"); } });
  f.failRead = true; f.aws.enqueue(config.workerQueueUrls.forge, event, "read-failed");
  await f.worker.start(ctx); await until(() => f.aws.errors.length > 0 || f.aws.calls.length > 1);
  // Wait for the SDK receive loop to request its next batch after handler failure.
  await until(() => f.aws.calls.filter((c) => c.constructor.name === "ReceiveMessageCommand").length >= 2);
  assert.deepEqual(f.aws.deleted, []); assert.equal(f.task.status, "delegated");
  f.failRead = false; f.failAck = true; f.aws.enqueue(config.workerQueueUrls.forge, event, "claim-failed");
  await until(() => f.aws.calls.filter((c) => c.constructor.name === "ReceiveMessageCommand").length >= 3);
  assert.deepEqual(f.aws.deleted, []); assert.equal(f.task.status, "delegated");
  f.failAck = false; f.aws.enqueue(config.workerQueueUrls.forge, event, "uncertain");
  await until(() => f.order.includes("run"));
  await until(() => f.aws.calls.filter((c) => c.constructor.name === "ReceiveMessageCommand").length >= 4);
  assert.deepEqual(f.aws.deleted, []); assert.equal(f.task.status, "accepted");
  f.aws.enqueue(config.workerQueueUrls.forge, event, "uncertain-redelivery");
  await until(() => f.aws.deleted.includes("uncertain-redelivery"));
  assert.equal(f.order.filter((x) => x === "run").length, 1);
});

test("terminal service ACKs only after durable outbox completion and suppresses duplicate receipt", async (t) => {
  const receipt = deferred(); const completion = deferred();
  const f = fixture(t, { sendReceipt: () => receipt.promise }); f.seedOutbox(); f.completionGate = completion;
  await f.pm.start(ctx); f.aws.enqueue(config.pmQueueUrl, terminal, "terminal");
  await until(() => f.order.includes("receipt")); assert.deepEqual(f.aws.deleted, []);
  receipt.resolve(); await until(() => f.order.includes("complete-start"));
  assert.deepEqual(f.aws.deleted, []); assert.equal(f.outbox?.delivery_status, "delivering");
  completion.resolve(); await until(() => f.aws.deleted.includes("terminal"));
  assert.equal(f.outbox?.delivery_status, "delivered");
  f.aws.enqueue(config.pmQueueUrl, terminal, "duplicate"); await until(() => f.aws.deleted.includes("duplicate"));
  assert.equal(f.order.filter((x) => x === "receipt").length, 1);
});

test("terminal handler failure releases the existing outbox claim and leaves SQS retryable", async (t) => {
  const f = fixture(t, { sendReceipt: async () => { throw new Error("channel unavailable"); } }); f.seedOutbox();
  await f.pm.start(ctx); f.aws.enqueue(config.pmQueueUrl, terminal, "failed-terminal");
  await until(() => f.order.includes("released"));
  assert.equal(f.outbox?.delivery_status, "pending"); assert.deepEqual(f.aws.deleted, []);
});

for (const failure of ["write-error", "lease-lost"] as const) {
  test(`terminal ${failure} after receipt does not ACK`, async (t) => {
    const f = fixture(t); f.seedOutbox(); f.failComplete = failure === "write-error"; f.leaseLost = failure === "lease-lost";
    await f.pm.start(ctx); f.aws.enqueue(config.pmQueueUrl, terminal, failure);
    await until(() => f.order.includes("complete-start"));
    await until(() => f.aws.calls.filter((c) => c.constructor.name === "ReceiveMessageCommand").length >= 2);
    assert.deepEqual(f.aws.deleted, []); assert.equal(f.outbox?.delivery_status, "delivering");
  });
}

test("busy terminal claim and missing outbox remain retryable without another receipt", async (t) => {
  const f = fixture(t); f.seedOutbox("delivering");
  await f.pm.start(ctx); f.aws.enqueue(config.pmQueueUrl, terminal, "busy");
  f.aws.enqueue(config.pmQueueUrl, { ...terminal, terminal_event_id: undefined }, "missing-id");
  await until(() => f.aws.calls.filter((c) => c.constructor.name === "ReceiveMessageCommand").length >= 2);
  assert.deepEqual(f.aws.deleted, []); assert.ok(!f.order.includes("receipt"));
});

test("SQS service stop remains bounded while worker execution is unresolved", async (t) => {
  const run = deferred(); const f = fixture(t, { run: () => run.promise });
  f.aws.enqueue(config.workerQueueUrls.forge, event, "stop");
  await f.worker.start(ctx); await until(() => f.order.includes("run"));
  await f.worker.stop(); assert.deepEqual(f.aws.deleted, []);
  run.resolve();
});

test("terminal publication uses the existing transactional outbox through the selected adapter", async (t) => {
  const f = fixture(t);
  // Start from the durable accepted state using the production ledger path.
  const ledger = new TaskLedger({ tableName: "tasks", region: "us-east-1" });
  await ledger.ackTask("deadbeef", "forge", "demo");
  const tool = f.tools.get("fleetmind_task_ship");
  await tool.execute("tool-call", { taskId: "deadbeef", worker: "forge" });
  assert.equal(f.outbox?.delivery_status, "pending");
  assert.equal(f.task.status, "shipped");
  assert.ok(f.order.includes("transaction"));
  const published = f.aws.queues.get(config.pmQueueUrl)!;
  assert.equal(published.length, 1);
  assert.equal(JSON.parse(published[0]!.Body!).terminal_event_id, f.outbox!.terminal_event_id);
  assert.deepEqual(f.aws.deleted, []);
});

test("omitting SQS selection still requires the existing NATS configuration", async (t) => {
  const f = fixture(t, { legacy: true });
  await assert.rejects(f.worker.start(ctx), /natsServers/);
});
