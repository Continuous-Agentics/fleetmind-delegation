import assert from "node:assert/strict";
import { test } from "node:test";
import { runLifecycleAction, type LifecycleTaskLedger } from "../src/index.js";

function makeLedger(): { ledger: LifecycleTaskLedger; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string) => async (...args: unknown[]) => { calls.push({ method, args }); };
  return {
    ledger: {
      ackTask: record("ackTask") as LifecycleTaskLedger["ackTask"],
      shipTask: record("shipTask") as LifecycleTaskLedger["shipTask"],
      blockTask: record("blockTask") as LifecycleTaskLedger["blockTask"],
      signoffTask: record("signoffTask") as LifecycleTaskLedger["signoffTask"],
      mergeTask: record("mergeTask") as LifecycleTaskLedger["mergeTask"],
    },
    calls,
  };
}

test("lifecycle actions call the TaskLedger transition matching their tool", async () => {
  const cases = [
    { action: "ack" as const, params: { taskId: "deadbeef", worker: "forge", project: "fleetmind" }, method: "ackTask", args: ["deadbeef", "forge", "fleetmind"], result: "Acknowledged FleetMind task deadbeef." },
    { action: "ship" as const, params: { taskId: "deadbeef", worker: "forge", project: "fleetmind" }, method: "shipTask", args: ["deadbeef", "forge", "fleetmind"], result: "Shipped FleetMind task deadbeef." },
    { action: "block" as const, params: { taskId: "deadbeef", worker: "forge", project: "fleetmind" }, method: "blockTask", args: ["deadbeef", "forge", "fleetmind"], result: "Blocked FleetMind task deadbeef." },
    { action: "signoff" as const, params: { taskId: "deadbeef", project: "fleetmind" }, method: "signoffTask", args: ["deadbeef", "fleetmind"], result: "Signed off FleetMind task deadbeef." },
    { action: "merge" as const, params: { taskId: "deadbeef", project: "fleetmind" }, method: "mergeTask", args: ["deadbeef", "fleetmind"], result: "Merged FleetMind task deadbeef." },
  ];

  for (const item of cases) {
    const { ledger, calls } = makeLedger();
    assert.equal(await runLifecycleAction(ledger, item.action, item.params), item.result);
    assert.deepEqual(calls, [{ method: item.method, args: item.args }]);
  }
});

test("lifecycle actions do not require project when the TaskLedger can resolve it", async () => {
  const { ledger, calls } = makeLedger();
  await runLifecycleAction(ledger, "merge", { taskId: "deadbeef" });
  assert.deepEqual(calls, [{ method: "mergeTask", args: ["deadbeef", undefined] }]);
});
