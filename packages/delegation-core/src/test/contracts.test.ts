import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allTaskEventsSubject,
  delegationSubject,
  DeliveryContextSchema,
  gsi1pk,
  gsi2pk,
  taskPK,
  taskSubject,
  TaskEventSchema,
  TaskRecordSchema,
} from "../index.js";

describe("FleetMind compatibility contracts", () => {
  test("preserves task keys and status indexes", () => {
    assert.equal(taskPK("a1b2c3d4"), "TASK#a1b2c3d4");
    assert.equal(gsi1pk("fleetmind", "delegated"), "PROJECT#fleetmind#STATUS#delegated");
    assert.equal(gsi2pk("shipped"), "STATUS#shipped");
  });

  test("preserves existing NATS subjects and v1.0 envelope", () => {
    assert.equal(delegationSubject("fleetmind", "forge"), "fleetmind.delegation.forge");
    assert.equal(taskSubject("fleetmind", "a1b2c3d4", "ship"), "fleetmind.task.a1b2c3d4.ship");
    assert.equal(allTaskEventsSubject("fleetmind"), "fleetmind.task.>");

    const event = TaskEventSchema.parse({
      v: "1.0",
      event: "delegation",
      task_id: "a1b2c3d4",
      worker: "forge",
      at: "2026-08-10T20:00:00Z",
    });
    assert.equal(event.event, "delegation");
  });

  test("accepts channel-neutral contexts without making a channel canonical", () => {
    assert.equal(
      DeliveryContextSchema.parse({
        provider: "discord",
        accountId: "default",
        conversationId: "123456789012345678",
      }).provider,
      "discord",
    );
  });

  test("reads a legacy v0.2 record with no delivery context", () => {
    const legacy = {
      PK: "TASK#deadbeef",
      task_id: "deadbeef",
      v: "0.2",
      project: "fleetmind",
      status: "accepted",
      GSI1PK: "PROJECT#fleetmind#STATUS#accepted",
      GSI2PK: "STATUS#accepted",
      delegated_by: "wren",
      worker: "forge",
      delegated_at: "2026-08-10T20:00:00Z",
      accepted_at: "2026-08-10T20:01:00Z",
      lifecycle: "requires-human-signoff",
      definition_of_done: "Preserve existing contracts.",
      delegation_thread: "",
      delegation_envelope_ts: "",
      tracker_link: null,
      task_s3_key: "v0/projects/fleetmind/tasks/2026-08-10-deadbeef.md",
      expires_at: 1817920800,
    };
    assert.deepEqual(TaskRecordSchema.parse(legacy), legacy);
  });
});
