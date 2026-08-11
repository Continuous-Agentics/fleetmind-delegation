import assert from "node:assert/strict";
import { test } from "node:test";
import { StringCodec } from "nats";
import { NatsTaskEvents } from "../src/nats-task-events.js";

test("NatsTaskEvents publishes frozen v1.0 event envelopes to the compatible subject", async () => {
  const published: Array<{ subject: string; data: Uint8Array }> = [];
  let flushes = 0;
  const connection = {
    publish: (subject: string, data: Uint8Array) => published.push({ subject, data }),
    flush: async () => { flushes += 1; },
  };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind" },
    async () => connection as never,
  );
  await transport.publish({
    v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z",
  });
  assert.equal(published[0]?.subject, "fleetmind.task.deadbeef.ship");
  assert.deepEqual(JSON.parse(StringCodec().decode(published[0]!.data)), {
    v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z",
  });
  assert.equal(flushes, 1);
});

test("NatsTaskEvents routes delegation events to the worker subject", async () => {
  let subject = "";
  const connection = { publish: (value: string) => { subject = value; }, flush: async () => {} };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind" },
    async () => connection as never,
  );
  await transport.publish({
    v: "1.0", event: "delegation", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z",
  });
  assert.equal(subject, "fleetmind.delegation.forge");
});

test("one subscription cleanup does not drain a shared transport with another subscriber", async () => {
  let drains = 0;
  const subscription = () => ({
    unsubscribe: () => {},
    async *[Symbol.asyncIterator]() { /* no messages */ },
  });
  const connection = { subscribe: subscription, drain: async () => { drains += 1; } };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind" },
    async () => connection as never,
  );
  const stopPm = await transport.subscribeForPm(() => {});
  const stopWorker = await transport.subscribeForWorker("forge", () => {});
  await stopPm();
  assert.equal(drains, 0);
  await stopWorker();
  assert.equal(drains, 1);
});

test("concurrent first use shares one in-flight NATS connection", async () => {
  let connects = 0;
  const connection = { publish: () => {}, flush: async () => {} };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind" },
    async () => {
      connects += 1;
      await Promise.resolve();
      return connection as never;
    },
  );
  await Promise.all([
    transport.publish({ v: "1.0", event: "ack", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z" }),
    transport.publish({ v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z" }),
  ]);
  assert.equal(connects, 1);
});

test("stale cleanup cannot drain a connection opened after explicit close", async () => {
  const drains: string[] = [];
  const subscription = () => ({ unsubscribe: () => {}, async *[Symbol.asyncIterator]() { /* no messages */ } });
  const connections = [
    { subscribe: subscription, drain: async () => { drains.push("first"); } },
    { subscribe: subscription, drain: async () => { drains.push("second"); } },
  ];
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind" },
    async () => connections.shift() as never,
  );
  const oldCleanup = await transport.subscribeForPm(() => {});
  await transport.close();
  const newCleanup = await transport.subscribeForPm(() => {});
  await oldCleanup();
  assert.deepEqual(drains, ["first"]);
  await newCleanup();
  assert.deepEqual(drains, ["first", "second"]);
});

test("NatsTaskEvents reports consumer failures without terminating subscription processing", async () => {
  const codec = StringCodec();
  let report!: (value: { error: unknown; event?: unknown }) => void;
  const reported = new Promise<{ error: unknown; event?: unknown }>((resolve) => { report = resolve; });
  const subscription = {
    unsubscribe: () => {},
    async *[Symbol.asyncIterator]() {
      yield { data: codec.encode(JSON.stringify({ v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-10T20:00:00Z" })) };
    },
  };
  const connection = { subscribe: () => subscription, drain: async () => {} };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind", onError: (error, event) => report({ error, event }) },
    async () => connection as never,
  );
  await transport.subscribeForPm(() => { throw new Error("consumer failed"); });
  const result = await reported;
  assert.equal((result.error as Error).message, "consumer failed");
  assert.equal((result.event as { task_id: string }).task_id, "deadbeef");
});

test("NatsTaskEvents reports an unexpected NATS iterator failure", async () => {
  let report!: (error: unknown) => void;
  const reported = new Promise<unknown>((resolve) => { report = resolve; });
  const subscription = {
    unsubscribe: () => {},
    async *[Symbol.asyncIterator]() { throw new Error("connection lost"); },
  };
  const connection = { subscribe: () => subscription, drain: async () => {} };
  const transport = new NatsTaskEvents(
    { servers: "nats://nats.example", subjectPrefix: "fleetmind", onError: (error) => report(error) },
    async () => connection as never,
  );
  await transport.subscribeForPm(() => {});
  assert.equal((await reported as Error).message, "connection lost");
});
