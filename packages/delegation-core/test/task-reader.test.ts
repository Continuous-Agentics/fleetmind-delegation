import assert from "node:assert/strict";
import { test } from "node:test";
import { DynamoDbTaskReader } from "../src/task-reader.js";

const record = {
  PK: "TASK#deadbeef", task_id: "deadbeef", v: "0.2", project: "fleetmind",
  status: "accepted", GSI1PK: "PROJECT#fleetmind#STATUS#accepted", GSI2PK: "STATUS#accepted",
  delegated_by: "wren", worker: "forge", delegated_at: "2026-08-10T20:00:00Z",
  lifecycle: "requires-human-signoff", definition_of_done: "Preserve contracts.",
  delegation_thread: "", delegation_envelope_ts: "", task_s3_key: "v0/tasks/deadbeef.md", expires_at: 0,
};

test("DynamoDbTaskReader reads a validated task by canonical PK", async () => {
  const requests: unknown[] = [];
  const client = { send: async (command: { input: unknown }) => { requests.push(command.input); return { Item: record }; } };
  const reader = new DynamoDbTaskReader({ tableName: "tasks", region: "us-west-2" }, client as never);
  assert.deepEqual(await reader.get("deadbeef"), record);
  assert.deepEqual(requests, [{ TableName: "tasks", Key: { PK: "TASK#deadbeef" } }]);
});

test("DynamoDbTaskReader selects the stable index for project and global queries", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = { send: async (command: { input: Record<string, unknown> }) => { requests.push(command.input); return { Items: [record] }; } };
  const reader = new DynamoDbTaskReader({ tableName: "tasks", region: "us-west-2" }, client as never);
  await reader.listByStatus({ status: "accepted", project: "fleetmind", limit: 3 });
  await reader.listByStatus({ status: "accepted" });
  assert.equal(requests[0]?.IndexName, "ProjectStatusIndex");
  assert.equal(requests[0]?.ScanIndexForward, true);
  assert.deepEqual(requests[0]?.ExpressionAttributeValues, { ":pk": "PROJECT#fleetmind#STATUS#accepted" });
  assert.equal(requests[1]?.IndexName, "StatusIndex");
  assert.deepEqual(requests[1]?.ExpressionAttributeValues, { ":pk": "STATUS#accepted" });
});

test("DynamoDbTaskReader rejects malformed query records at the storage boundary", async () => {
  const client = { send: async () => ({ Items: [{ ...record, status: "unknown" }] }) };
  const reader = new DynamoDbTaskReader({ tableName: "tasks", region: "us-west-2" }, client as never);
  await assert.rejects(() => reader.listByStatus({ status: "accepted" }));
});

test("DynamoDbTaskReader continues after a DynamoDB one-megabyte page boundary", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    send: async (command: { input: Record<string, unknown> }) => {
      requests.push(command.input);
      return requests.length === 1
        ? { Items: [record], LastEvaluatedKey: { PK: "TASK#cursor" } }
        : { Items: [{ ...record, PK: "TASK#feedface", task_id: "feedface" }] };
    },
  };
  const reader = new DynamoDbTaskReader({ tableName: "tasks", region: "us-west-2" }, client as never);
  const tasks = await reader.listByStatus({ status: "accepted", limit: 2 });
  assert.equal(tasks.length, 2);
  assert.deepEqual(requests[1]?.ExclusiveStartKey, { PK: "TASK#cursor" });
  assert.equal(requests[1]?.Limit, 1);
});
