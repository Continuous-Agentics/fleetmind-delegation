import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ReceiveMessageCommand, SendMessageCommand, ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import { SqsTaskEvents } from "../src/sqs-task-events.js";
import { createTaskEvents, type TaskEvents } from "../src/task-events.js";
import { NatsTaskEvents } from "../src/nats-task-events.js";
import { config, event, terminal, deferred, until, SqsBoundary } from "./sqs-fixture.js";

function setup(options: Partial<ConstructorParameters<typeof SqsTaskEvents>[0]> = {}) {
  const aws = new SqsBoundary();
  const transport = new SqsTaskEvents({ ...config, onError: (error) => { aws.errors.push(error); }, ...options }, aws.client);
  return { aws, transport };
}

// Both production adapters satisfy the same small publication/subscription contract.
for (const provider of ["nats", "sqs"] as const) {
  test(`${provider}: shared transport contract delivers worker and PM events and disposes`, async () => {
    const sqs = setup();
    const subscriptions = new Map<string, { push: (data: Uint8Array) => void; stop: () => void }>();
    let drained = false;
    const nats = new NatsTaskEvents({ subjectPrefix: "fm" }, async () => ({
      publish(subject: string, data: Uint8Array) {
        subscriptions.get(subject.startsWith("fm.task.") ? "fm.task.>" : subject)?.push(data);
      },
      flush: async () => {}, drain: async () => { drained = true; },
      subscribe(subject: string) {
        const messages: Uint8Array[] = [];
        let wake: (() => void) | undefined; let stopped = false;
        const stop = () => { stopped = true; wake?.(); };
        subscriptions.set(subject, { push: (data) => { messages.push(data); wake?.(); }, stop });
        return { unsubscribe: stop, async *[Symbol.asyncIterator]() {
          while (!stopped) {
            if (!messages.length) await new Promise<void>((resolve) => { wake = resolve; });
            while (messages.length) yield { data: messages.shift()! };
          }
        } };
      },
    }) as never);
    const transport: TaskEvents = provider === "sqs" ? sqs.transport : nats;
    const received: unknown[] = [];
    const workerStop = await transport.subscribeForWorker("forge", (value) => { received.push(value); });
    const pmStop = await transport.subscribeForPm((value) => { received.push(value); });
    await transport.publish(event); await transport.publish(terminal);
    await until(() => received.length === 2);
    assert.deepEqual(received, [event, terminal]);
    await workerStop(); await pmStop(); await transport.close();
    assert.ok(provider === "sqs" ? sqs.aws.destroyed : drained);
    await sqs.transport.close();
  });
}

test("factory selection is explicit; NATS remains available for compatibility", async () => {
  const sqs = createTaskEvents({ provider: "sqs", ...config });
  assert.ok(sqs instanceof SqsTaskEvents); await sqs.close();
  const nats = createTaskEvents({ provider: "nats", subjectPrefix: "fm" });
  assert.ok(nats instanceof NatsTaskEvents); await nats.close();
});

test("publish uses configured routing and strips untrusted queue URL fields", async () => {
  const { aws, transport } = setup();
  await transport.publish({ ...event, queueUrl: "https://attacker/queue" } as typeof event);
  const command = aws.calls[0] as SendMessageCommand;
  assert.equal(command.input.QueueUrl, config.workerQueueUrls.forge);
  assert.equal(JSON.parse(command.input.MessageBody!).queueUrl, undefined);
  await assert.rejects(transport.publish({ ...event, worker: "unknown" }), /No configured/);
  await assert.rejects(transport.publish({ ...event, worker: "toString" }), /No configured/);
  assert.throws(() => new SqsTaskEvents({ ...config, pmQueueUrl: config.pmQueueUrl + ".fifo" }), /Standard/);
  await transport.close();
});

test("delete happens only after the handler resolves its durable handoff", async () => {
  const { aws, transport } = setup(); const handoff = deferred(); let started = false;
  aws.enqueue(config.workerQueueUrls.forge, event, "durable");
  await transport.subscribeForWorker("forge", async () => { started = true; await handoff.promise; });
  await until(() => started); assert.deepEqual(aws.deleted, []);
  handoff.resolve(); await until(() => aws.deleted.length === 1);
  assert.deepEqual(aws.deleted, ["durable"]);
  const receive = aws.calls.find((x) => x instanceof ReceiveMessageCommand)! as ReceiveMessageCommand;
  assert.equal(receive.input.WaitTimeSeconds, 20); assert.equal(receive.input.MaxNumberOfMessages, 5);
  assert.equal(receive.input.VisibilityTimeout, 60);
  await transport.close();
});

test("malformed, wrong-route, and failed messages stay retryable while valid peers complete", async () => {
  const { aws, transport } = setup({ onError: () => { aws.errors.push("reported"); throw new Error("logger broken"); } });
  aws.enqueue(config.workerQueueUrls.forge, "not-json", "poison");
  aws.enqueue(config.workerQueueUrls.forge, { ...event, v: "bad" } as never, "schema");
  aws.enqueue(config.workerQueueUrls.forge, terminal, "wrong-route");
  aws.enqueue(config.workerQueueUrls.forge, { ...event, task_id: "failure" }, "failure");
  aws.enqueue(config.workerQueueUrls.forge, event, "good");
  await transport.subscribeForWorker("forge", (value) => { if (value.task_id === "failure") throw new Error("durability failed"); });
  await until(() => aws.deleted.includes("good"));
  assert.deepEqual(aws.deleted, ["good"]); assert.equal(aws.errors.length, 4);
  await transport.close();
});

test("one uncertain handler times out, never ACKs late, and does not block peers or later polls", async () => {
  const { aws, transport } = setup({ handlerTimeoutMs: 30, batchSize: 2 }); const uncertain = deferred();
  aws.enqueue(config.workerQueueUrls.forge, { ...event, task_id: "uncertain" }, "uncertain");
  aws.enqueue(config.workerQueueUrls.forge, event, "peer");
  aws.enqueue(config.workerQueueUrls.forge, event, "next-batch");
  await transport.subscribeForWorker("forge", async (value) => { if (value.task_id === "uncertain") await uncertain.promise; });
  await until(() => aws.deleted.includes("next-batch"));
  uncertain.resolve(); await delay(10);
  assert.deepEqual(aws.deleted, ["peer", "next-batch"]); assert.ok(aws.errors.length);
  await transport.close();
});

test("visibility is extended while handling and heartbeat stops after ACK", async () => {
  const { aws, transport } = setup({ visibilityTimeoutSeconds: 3, handlerTimeoutMs: 3000 }); const handoff = deferred();
  aws.enqueue(config.workerQueueUrls.forge, event, "long");
  await transport.subscribeForWorker("forge", () => handoff.promise);
  await until(() => aws.calls.some((x) => x instanceof ChangeMessageVisibilityCommand), 1600);
  assert.deepEqual(aws.deleted, []);
  const change = aws.calls.find((x) => x instanceof ChangeMessageVisibilityCommand)! as ChangeMessageVisibilityCommand;
  assert.deepEqual(change.input, { QueueUrl: config.workerQueueUrls.forge, ReceiptHandle: "long", VisibilityTimeout: 3 });
  handoff.resolve(); await until(() => aws.deleted.includes("long"));
  await transport.close();
});

test("lost visibility and delete errors retain the message for redelivery", async () => {
  const { aws, transport } = setup({ visibilityTimeoutSeconds: 3, handlerTimeoutMs: 3000 }); const handoff = deferred();
  aws.failVisibility = true; aws.enqueue(config.workerQueueUrls.forge, event, "lease-lost");
  await transport.subscribeForWorker("forge", () => handoff.promise);
  await until(() => aws.errors.length > 0, 1600); handoff.resolve();
  await until(() => aws.errors.length > 1); assert.deepEqual(aws.deleted, []);
  await transport.close();
  const other = setup(); other.aws.failDelete = true; other.aws.enqueue(config.workerQueueUrls.forge, event, "delete-failed");
  await other.transport.subscribeForWorker("forge", () => {});
  await until(() => other.aws.errors.length > 0);
  assert.match(String(other.aws.errors[0]), /delete unavailable/);
  await other.transport.close();
});

test("shutdown aborts receive, releases an active receipt, and never ACKs late work", async () => {
  const { aws, transport } = setup(); const active = deferred(); let started = false;
  aws.enqueue(config.workerQueueUrls.forge, event, "shutdown");
  const stop = await transport.subscribeForWorker("forge", async () => { started = true; await active.promise; });
  await until(() => started); await stop(); await transport.close();
  assert.deepEqual(aws.deleted, []);
  assert.ok(aws.calls.some((x) => x instanceof ChangeMessageVisibilityCommand && x.input.VisibilityTimeout === 0));
  active.resolve(); await delay(5); assert.deepEqual(aws.deleted, []);
  await assert.rejects(transport.publish(event), /closed/);
});

test("receive failure retries with bounded backoff and can still stop", async () => {
  const { aws, transport } = setup(); aws.receiveFailures = 1;
  aws.enqueue(config.workerQueueUrls.forge, event, "retry");
  await transport.subscribeForWorker("forge", () => {});
  await until(() => aws.deleted.includes("retry"), 1600);
  assert.equal(aws.errors.length, 1); await transport.close();
});
