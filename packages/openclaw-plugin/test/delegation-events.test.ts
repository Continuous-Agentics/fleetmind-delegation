import assert from "node:assert/strict";
import { test } from "node:test";
import { handleDelegationTaskEvent } from "../src/delegation-events.js";
import type { TaskRecord } from "@continuous-agentics/delegation-core";

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    PK: "TASK#deadbeef", task_id: "deadbeef", v: "1.0", project: "delegation", status: "delegated",
    GSI1PK: "PROJECT#delegation#STATUS#delegated", GSI2PK: "STATUS#delegated", delegated_by: "conductor",
    worker: "forge", delegated_at: "2026-08-12T00:00:00Z", lifecycle: "requires-human-signoff",
    definition_of_done: "Done", delegation_thread: "", delegation_envelope_ts: "", task_s3_key: "task.md", expires_at: 1,
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return { v: "1.0" as const, event: "delegation" as const, task_id: "deadbeef", worker: "forge", at: "2026-08-12T00:00:00Z", ...overrides };
}

test("worker Slack receipt opens a home-channel thread and wakes that exact session", async () => {
  const sends: unknown[] = [];
  const wakes: unknown[][] = [];
  const acks: unknown[][] = [];
  await handleDelegationTaskEvent(event(), {
    ledger: { getTask: async () => task({ delivery_context: { provider: "slack", accountId: "A-plan", conversationId: "C-plan", threadId: "1.2" } }), ackTask: async (...args) => { acks.push(args); } },
    workerAgentId: "forge-agent", workerId: "forge", workerHomeSlack: { accountId: "A-worker", conversationId: "C-worker" },
    slackSender: { sendText: async (input) => { sends.push(input); return { messageId: "3.4" }; } },
    wakeWorker: async (...args) => { wakes.push(args); },
  });
  assert.deepEqual(sends, [{ conversationId: "C-worker", accountId: "A-worker", text: "👋 Received delegation `deadbeef` from conductor — picking up." }]);
  assert.deepEqual(wakes, [["forge-agent", "FleetMind delegation received for task deadbeef. Inspect the authoritative task ledger before taking action.", {
    delivery: { provider: "slack", accountId: "A-worker", conversationId: "C-worker", threadId: "3.4" },
    sessionKey: "agent:forge-agent:slack:channel:c-worker:thread:3.4",
  }]]);
  assert.deepEqual(acks, [["deadbeef", "forge", "delegation"]]);
});

test("home-channel Slack failure falls back to the authoritative planning thread and still wakes", async () => {
  const sends: unknown[] = [];
  const wakes: unknown[][] = [];
  await handleDelegationTaskEvent(event(), {
    ledger: { getTask: async () => task({ delivery_context: { provider: "slack", accountId: "A-plan", conversationId: "C-plan", threadId: "1.2" } }), ackTask: async () => {} },
    workerAgentId: "forge-agent", workerId: "forge", workerHomeSlack: { accountId: "A-worker", conversationId: "C-worker" },
    slackSender: { sendText: async (input) => { sends.push(input); if (sends.length === 1) throw new Error("offline"); return {}; } },
    wakeWorker: async (...args) => { wakes.push(args); },
  });
  assert.deepEqual(sends[1], { conversationId: "C-plan", threadId: "1.2", accountId: "A-plan", text: "👋 Received delegation `deadbeef` from conductor — picking up." });
  assert.equal((wakes[0]?.[2] as { sessionKey: string }).sessionKey, "agent:forge-agent:slack:channel:c-plan:thread:1.2");
});

test("non-Slack delegation does not invoke Slack and wakes its authoritative session", async () => {
  let slackCalls = 0;
  const wakes: unknown[][] = [];
  await handleDelegationTaskEvent(event(), {
    ledger: { getTask: async () => task({ delivery_context: { provider: "discord", accountId: "A", conversationId: "D" } }), ackTask: async () => {} },
    workerAgentId: "forge-agent", workerId: "forge", workerHomeSlack: { accountId: "A-worker", conversationId: "C-worker" },
    slackSender: { sendText: async () => { slackCalls += 1; return {}; } },
    wakeWorker: async (...args) => { wakes.push(args); },
  });
  assert.equal(slackCalls, 0);
  assert.deepEqual(wakes[0], ["forge-agent", "FleetMind delegation received for task deadbeef. Inspect the authoritative task ledger before taking action.", {
    delivery: { provider: "discord", accountId: "A", conversationId: "D" },
    sessionKey: "agent:forge-agent:discord:channel:D",
  }]);
});

test("unverified or mismatched delegation events are ignored", async () => {
  const errors: string[] = [];
  let wakeCalls = 0;
  await handleDelegationTaskEvent(event({ worker: "impostor" }), {
    ledger: { getTask: async () => task(), ackTask: async () => {} }, workerAgentId: "forge-agent", workerId: "forge",
    wakeWorker: async () => { wakeCalls += 1; }, onError: (message) => errors.push(message),
  });
  await handleDelegationTaskEvent(event(), {
    ledger: { getTask: async () => undefined, ackTask: async () => {} }, workerAgentId: "forge-agent", workerId: "forge",
    wakeWorker: async () => { wakeCalls += 1; }, onError: (message) => errors.push(message),
  });
  assert.equal(wakeCalls, 0);
  assert.match(errors[0]!, /missing task/);
});
