import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHumanAuthorityCaller,
  assertWorkerAuthorityCaller,
  isHumanAuthorityAction,
  runLifecycleAction,
  type LifecycleTaskLedger,
} from "../src/index.js";

function makeLedger(): { ledger: LifecycleTaskLedger; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => async (...args: unknown[]) => { calls.push({ method, args }); };
  return { ledger: { ackTask: record("ackTask") as LifecycleTaskLedger["ackTask"], shipTask: record("shipTask") as LifecycleTaskLedger["shipTask"], blockTask: record("blockTask") as LifecycleTaskLedger["blockTask"], signoffTask: record("signoffTask") as LifecycleTaskLedger["signoffTask"], mergeTask: record("mergeTask") as LifecycleTaskLedger["mergeTask"] }, calls };
}

test("lifecycle actions call the TaskLedger transition matching their tool", async () => {
  const cases = [
    { action: "ack" as const, params: { taskId: "deadbeef", worker: "forge" }, method: "ackTask", args: ["deadbeef", "forge"] },
    { action: "ship" as const, params: { taskId: "deadbeef", worker: "forge" }, method: "shipTask", args: ["deadbeef", "forge"] },
    { action: "block" as const, params: { taskId: "deadbeef", worker: "forge" }, method: "blockTask", args: ["deadbeef", "forge"] },
    { action: "signoff" as const, params: { taskId: "deadbeef" }, method: "signoffTask", args: ["deadbeef"] },
    { action: "merge" as const, params: { taskId: "deadbeef" }, method: "mergeTask", args: ["deadbeef"] },
  ];
  for (const item of cases) { const { ledger, calls } = makeLedger(); await runLifecycleAction(ledger, item.action, item.params); assert.deepEqual(calls, [{ method: item.method, args: item.args }]); }
});

test("worker lifecycle actions permit only the mapped worker agent", () => {
  assert.doesNotThrow(() => assertWorkerAuthorityCaller("forge-agent", "forge", { "forge-agent": "forge" }));
  assert.throws(() => assertWorkerAuthorityCaller("other-agent", "forge", { "forge-agent": "forge" }), /Only the configured OpenClaw agent/);
  assert.throws(() => assertWorkerAuthorityCaller("forge-agent", "other", { "forge-agent": "forge" }), /Only the configured OpenClaw agent/);
  assert.throws(() => assertWorkerAuthorityCaller(undefined, "forge", { "forge-agent": "forge" }), /Only the configured OpenClaw agent/);
});

test("human-authority actions permit only configured reviewer agents", () => {
  assert.equal(isHumanAuthorityAction("merge"), true);
  assert.doesNotThrow(() => assertHumanAuthorityCaller("ship", undefined, []));
  assert.doesNotThrow(() => assertHumanAuthorityCaller("merge", "reviewer", ["reviewer"]));
  assert.throws(() => assertHumanAuthorityCaller("signoff", "worker", ["reviewer"]), /Only a configured FleetMind reviewer agent/);
  assert.throws(() => assertHumanAuthorityCaller("merge", undefined, ["reviewer"]), /Only a configured FleetMind reviewer agent/);
});
