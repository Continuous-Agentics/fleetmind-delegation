import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE_TASK_STATUSES, listActiveTasks } from "../src/index.js";

test("listActiveTasks queries every non-terminal task status and orders newest first", async () => {
  const seen: string[] = [];
  const reader = {
    get: async () => undefined,
    listByStatus: async ({ status }: { status: string }) => {
      seen.push(status);
      return [{ task_id: status, project: "fleetmind", status, worker: "forge", task_s3_key: "key", delegated_at: status === "delegated" ? "2026-08-10T20:00:00Z" : "2026-08-10T21:00:00Z" }];
    },
  } as never;
  const tasks = await listActiveTasks(reader, { project: "fleetmind", limit: 2 });
  assert.deepEqual(seen.sort(), [...ACTIVE_TASK_STATUSES].sort());
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.status !== "delegated"));
});

test("listActiveTasks requests the newest candidates from every status before merging", async () => {
  const requests: Array<{ status: string; limit?: number; ascending?: boolean }> = [];
  const reader = {
    get: async () => undefined,
    listByStatus: async (request: { status: string; limit?: number; ascending?: boolean }) => {
      requests.push(request);
      return [];
    },
  } as never;
  await listActiveTasks(reader, { limit: 2 });
  assert.equal(requests.length, ACTIVE_TASK_STATUSES.length);
  assert.ok(requests.every((request) => request.limit === 2 && request.ascending === false));
});
