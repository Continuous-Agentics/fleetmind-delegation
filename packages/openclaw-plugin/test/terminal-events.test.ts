import assert from "node:assert/strict";
import { test } from "node:test";
import { handleTerminalTaskEvent, type TerminalEventLedger } from "../src/index.js";
import type { TaskRecord } from "@continuous-agentics/delegation-core";

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  PK: "TASK#deadbeef", task_id: "deadbeef", v: "0.2", project: "fleetmind-delegation",
  status: "shipped", GSI1PK: "PROJECT#fleetmind-delegation#STATUS#shipped", GSI2PK: "STATUS#shipped",
  delegated_by: "conductor", worker: "forge", delegated_at: "2026-08-11T00:00:00Z",
  lifecycle: "requires-human-signoff", definition_of_done: "done", delegation_thread: "",
  delegation_envelope_ts: "", task_s3_key: "tasks/deadbeef", expires_at: 1, ...overrides,
});

function ledger(getTask: TerminalEventLedger["getTask"]): TerminalEventLedger { return { getTask }; }

test("terminal ship wakes the PM with DDB-authoritative delivery and preserves human sign-off", async () => {
  const wakes: unknown[][] = [];
  await handleTerminalTaskEvent({ v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-11T00:00:00Z", message: "PR ready", delivery_context: { provider: "discord", accountId: "wrong", conversationId: "wrong" } }, {
    ledger: ledger(async () => task({ delivery_context: { provider: "slack", accountId: "main", conversationId: "C123", threadId: "123.456" } })),
    pmAgentId: "conductor",
    wakePm: (...args) => { wakes.push(args); },
  });
  assert.deepEqual(wakes, [["conductor", "NATS: Task deadbeef shipped by forge. PR ready", { provider: "slack", accountId: "main", conversationId: "C123", threadId: "123.456" }, undefined]]);
});

test("terminal block falls back to event routing when the ledger read fails", async () => {
  const wakes: unknown[][] = [];
  const errors: string[] = [];
  await handleTerminalTaskEvent({ v: "1.0", event: "block", task_id: "deadbeef", worker: "forge", at: "2026-08-11T00:00:00Z", reason: "waiting", delegation_thread: "https://x.slack.com/archives/C123/p123456789012" }, {
    ledger: ledger(async () => { throw new Error("DDB unavailable"); }),
    pmAgentId: "conductor",
    wakePm: (...args) => { wakes.push(args); },
    onError: (message) => { errors.push(message); },
  });
  assert.equal(errors.length, 1);
  assert.deepEqual(wakes, [["conductor", "NATS: Task deadbeef blocked by forge. waiting", undefined, "https://x.slack.com/archives/C123/p123456789012"]]);
});

test("terminal handling contains a PM wake failure", async () => {
  const errors: string[] = [];
  await assert.doesNotReject(handleTerminalTaskEvent({ v: "1.0", event: "ship", task_id: "deadbeef", worker: "forge", at: "2026-08-11T00:00:00Z" }, {
    ledger: ledger(async () => task()), pmAgentId: "conductor", wakePm: () => { throw new Error("wake failed"); },
    onError: (message) => { errors.push(message); },
  }));
  assert.deepEqual(errors, ["Could not wake PM for task deadbeef."]);
});
