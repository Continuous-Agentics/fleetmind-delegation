import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { TaskConditionError, TaskLedger } from "../src/index.js";

const record = {
  PK: "TASK#deadbeef", task_id: "deadbeef", v: "0.2", project: "fleetmind",
  status: "accepted", GSI1PK: "PROJECT#fleetmind#STATUS#accepted", GSI2PK: "STATUS#accepted",
  delegated_by: "wren", worker: "forge", delegated_at: "2026-08-10T20:00:00Z",
  lifecycle: "requires-human-signoff", definition_of_done: "Preserve contracts.",
  delegation_thread: "", delegation_envelope_ts: "", task_s3_key: "v0/tasks/deadbeef.md", expires_at: 0,
};

test("TaskLedger preserves FleetMind's conditional worker acknowledgement", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => { requests.push(command.input); },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  await ledger.ackTask("deadbeef", "forge", "fleetmind");
  const request = requests[0];
  assert.deepEqual({
    ...request,
    ExpressionAttributeValues: {
      ...(request?.ExpressionAttributeValues as Record<string, unknown>),
      ":now": "<timestamp>",
    },
  }, {
    TableName: "tasks",
    Key: { PK: "TASK#deadbeef" },
    UpdateExpression: "SET #st = :accepted, accepted_at = :now, GSI1PK = :gsi1pk, GSI2PK = :gsi2pk",
    ConditionExpression: "#st = :delegated AND #worker = :worker",
    ExpressionAttributeNames: { "#st": "status", "#worker": "worker" },
    ExpressionAttributeValues: {
      ":accepted": "accepted", ":delegated": "delegated", ":worker": "forge",
      ":gsi1pk": "PROJECT#fleetmind#STATUS#accepted", ":gsi2pk": "STATUS#accepted",
      ":now": "<timestamp>",
    },
  }, "ledger must write the established conditional DDB ack transition");
  assert.match(
    (request?.ExpressionAttributeValues as Record<string, unknown>)[":now"] as string,
    /^\d{4}-\d{2}-\d{2}T/,
  );
});

test("terminal transitions atomically persist a pending outbox record", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => { requests.push(command.input); },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  await ledger.shipTask("deadbeef", "forge", "fleetmind");
  const request = requests[0]!;
  const items = request.TransactItems as Array<Record<string, Record<string, unknown>>>;
  assert.equal(items.length, 2);
  assert.match(String(items[0]?.Update?.UpdateExpression), /#st = :shipped/);
  assert.deepEqual(items[1]?.Put?.Item, {
    PK: `OUTBOX#TASK#deadbeef#ship#${(items[0]?.Update?.ExpressionAttributeValues as Record<string, unknown>)[":now"]}`, GSI2PK: "OUTBOX#PENDING",
    delegated_at: (items[0]?.Update?.ExpressionAttributeValues as Record<string, unknown>)[":now"], task_id: "deadbeef",
    project: "fleetmind", delegated_by: "", event: "ship", worker: "forge", delivery_status: "pending",
    delivery_attempts: 0, at: (items[0]?.Update?.ExpressionAttributeValues as Record<string, unknown>)[":now"],
    expires_at: (items[1]?.Put?.Item as Record<string, unknown>)["expires_at"],
  });
});

test("terminal outbox completion is idempotent", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => { requests.push(command.input); },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  assert.equal(await ledger.completeTerminalEventDelivery("deadbeef", "ship", "2026-08-10T20:00:00Z", "lease"), true);
  const request = requests[0]!;
  assert.deepEqual(request.Key, { PK: "OUTBOX#TASK#deadbeef#ship#2026-08-10T20:00:00Z" });
  assert.match(String(request.UpdateExpression), /GSI2PK = :gsi/);
  assert.equal((request.ExpressionAttributeValues as Record<string, unknown>)[":gsi"], "OUTBOX#DELIVERED");
});

test("terminal outbox discovery paginates its dedicated states, independent of task status", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const outbox = (id: string, state: "PENDING" | "DELIVERING", lease?: string) => ({
    PK: `OUTBOX#TASK#${id}#ship#2026-08-10T00:00:0${id[0]}Z`, GSI2PK: `OUTBOX#${state}`,
    delegated_at: `2026-08-10T00:00:0${id[0]}Z`, task_id: id, project: "fleetmind",
    delegated_by: "wren", event: "ship", at: `2026-08-10T00:00:0${id[0]}Z`, worker: "forge",
    delivery_status: state.toLowerCase(), delivery_attempts: 0, expires_at: 1, ...(lease && { lease_expires_at: lease }),
  });
  const documentClient = { send: async (command: { input: Record<string, unknown> }) => {
    requests.push(command.input);
    const state = (command.input.ExpressionAttributeValues as Record<string, string>)[":pk"];
    if (state === "OUTBOX#PENDING" && !command.input.ExclusiveStartKey) return { Items: [outbox("1eadbeef", "PENDING")], LastEvaluatedKey: { PK: "cursor" } };
    if (state === "OUTBOX#PENDING") return { Items: [outbox("2eadbeef", "PENDING")] };
    return { Items: [outbox("3eadbeef", "DELIVERING", "2000-01-01T00:00:00Z")] };
  }};
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  const events = await ledger.listPendingTerminalEvents(3);
  assert.equal(events.length, 3);
  assert.ok(requests.some((request) => request.ExclusiveStartKey));
  assert.ok(requests.every((request) => request.IndexName === "StatusIndex"));
});

test("TaskLedger translates conditional-write failures to non-retryable lifecycle errors", async () => {
  const documentClient = {
    send: async () => { throw new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" }); },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  await assert.rejects(
    () => ledger.shipTask("deadbeef", "forge", "fleetmind"),
    (error: unknown) => error instanceof TaskConditionError && error.message.includes("accepted→shipped"),
  );
});

test("TaskLedger translates only conditional transaction cancellations to lifecycle errors", async () => {
  const conditionFailure = new TransactionCanceledException({
    $metadata: {}, message: "condition failed", CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
  });
  const conditionLedger = new TaskLedger({ tableName: "tasks", documentClient: { send: async () => { throw conditionFailure; } } as never });
  await assert.rejects(
    () => conditionLedger.shipTask("deadbeef", "forge", "fleetmind"),
    (error: unknown) => error instanceof TaskConditionError,
  );

  const transientFailure = new TransactionCanceledException({
    $metadata: {}, message: "transaction conflict", CancellationReasons: [{ Code: "TransactionConflict" }],
  });
  const transientLedger = new TaskLedger({ tableName: "tasks", documentClient: { send: async () => { throw transientFailure; } } as never });
  await assert.rejects(
    () => transientLedger.shipTask("deadbeef", "forge", "fleetmind"),
    (error: unknown) => error === transientFailure,
  );
});

test("metadata writes reject a lifecycle transition that races their GSI calculation", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => {
      requests.push(command.input);
      if (requests.length === 1 || requests.length === 3) return { Item: record };
      return {};
    },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  await ledger.updateTaskMetadata("deadbeef", { project: "new-project" }, { by: "wren" });
  const write = requests[1];
  assert.equal(write?.ConditionExpression, "attribute_exists(PK) AND #st = :expected_status");
  assert.equal((write?.ExpressionAttributeValues as Record<string, unknown>)[":expected_status"], "accepted");
  assert.equal((write?.ExpressionAttributeValues as Record<string, unknown>)[":gsi1pk"], "PROJECT#new-project#STATUS#accepted");
});

test("queryByStatus paginates and validates every returned task record", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => {
      requests.push(command.input);
      return requests.length === 1
        ? { Items: [record], LastEvaluatedKey: { PK: "TASK#cursor" } }
        : { Items: [{ ...record, PK: "TASK#feedface", task_id: "feedface" }] };
    },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  const tasks = await ledger.queryByStatus({ status: "accepted", limit: 2 });
  assert.equal(tasks.length, 2);
  assert.equal(requests[0]?.Limit, 2);
  assert.equal(requests[1]?.Limit, 1);
  assert.deepEqual(requests[1]?.ExclusiveStartKey, { PK: "TASK#cursor" });
});

test("history trimming never overwrites a concurrent append", async () => {
  const history = Array.from({ length: 21 }, (_, index) => ({
    at: `2026-08-10T00:00:${String(index).padStart(2, "0")}Z`, by: "wren", fields_changed: ["title"],
  }));
  const requests: Array<Record<string, unknown>> = [];
  let getCount = 0;
  const documentClient = {
    send: async (command: { input: Record<string, unknown> }) => {
      requests.push(command.input);
      if ("Key" in command.input && !("UpdateExpression" in command.input)) {
        getCount += 1;
        return { Item: { ...record, update_history: history } };
      }
      if (String(command.input.UpdateExpression).includes("SET update_history = :trimmed") && getCount === 2) {
        throw new ConditionalCheckFailedException({ $metadata: {}, message: "concurrent append" });
      }
      return {};
    },
  };
  const ledger = new TaskLedger({ tableName: "tasks", documentClient: documentClient as never });
  await ledger.updateTaskMetadata("deadbeef", { title: "new" }, { by: "wren", reason: "test" });
  const trims = requests.filter((request) => request.UpdateExpression === "SET update_history = :trimmed");
  assert.equal(trims.length, 2);
  assert.ok(trims.every((request) => request.ConditionExpression === "update_history = :expected_history"));
});
