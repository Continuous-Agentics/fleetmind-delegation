import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextTerminalReconcileDelay,
  pluginPackageName,
  runLifecycleAction,
  TERMINAL_RECONCILE_INITIAL_MS,
  TERMINAL_RECONCILE_MAX_MS,
} from "../src/index.js";

test("plugin package is wired to the workspace", () => {
  assert.equal(pluginPackageName, "@continuous-agentics/openclaw-fleetmind-delegation");
});

test("terminal reconciliation backs off when idle or failing and resets after work", () => {
  assert.equal(nextTerminalReconcileDelay(TERMINAL_RECONCILE_INITIAL_MS, "empty", () => 0.5), 60_000);
  assert.equal(nextTerminalReconcileDelay(60_000, "error", () => 0.5), 120_000);
  assert.equal(nextTerminalReconcileDelay(TERMINAL_RECONCILE_MAX_MS, "empty", () => 0.5), TERMINAL_RECONCILE_MAX_MS);
  assert.equal(nextTerminalReconcileDelay(TERMINAL_RECONCILE_MAX_MS, "work", () => 0.5), TERMINAL_RECONCILE_INITIAL_MS);
});

test("terminal lifecycle action publishes a best-effort fast-path event after its durable transition", async () => {
  const calls: string[] = [];
  const ledger = {
    ackTask: async () => {},
    shipTask: async (taskId: string) => { calls.push(`ship:${taskId}`); return { at: "2026-08-20T16:00:00Z", terminalEventId: "00000000-0000-4000-8000-000000000001" }; },
    blockTask: async () => {},
    signoffTask: async () => {},
    mergeTask: async () => {},
  };
  const result = await runLifecycleAction(ledger, "ship", { taskId: "deadbeef", worker: "vesper" }, {
    publishTerminalEvent: async (taskId, event, id) => { calls.push(`publish:${taskId}:${event}:${id}`); },
  });
  assert.equal(result, "Shipped FleetMind task deadbeef.");
  assert.deepEqual(calls, ["ship:deadbeef", "publish:deadbeef:ship:00000000-0000-4000-8000-000000000001"]);
});

test("terminal lifecycle action preserves the durable transition when the fast path fails", async () => {
  const failures: string[] = [];
  const ledger = {
    ackTask: async () => {},
    shipTask: async () => {},
    blockTask: async () => ({ at: "2026-08-20T16:00:00Z", terminalEventId: "00000000-0000-4000-8000-000000000002" }),
    signoffTask: async () => {},
    mergeTask: async () => {},
  };
  const result = await runLifecycleAction(ledger, "block", { taskId: "deadbeef", worker: "vesper" }, {
    publishTerminalEvent: async () => { throw new Error("NATS unavailable"); },
    onTerminalPublishError: (_taskId, _event, _at, error) => failures.push((error as Error).message),
  });
  assert.equal(result, "Blocked FleetMind task deadbeef.");
  assert.deepEqual(failures, ["NATS unavailable"]);
});
