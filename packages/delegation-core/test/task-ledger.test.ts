import assert from "node:assert/strict";
import { test } from "node:test";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { TaskConditionError, TaskLedger } from "../src/index.js";

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
