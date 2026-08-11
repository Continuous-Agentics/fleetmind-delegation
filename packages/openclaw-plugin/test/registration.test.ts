import assert from "node:assert/strict";
import { test } from "node:test";
import plugin, { DynamoDbTaskReader, NatsTaskEvents } from "../src/index.js";

test("plugin registers exactly the declared read-only task tools without configured infrastructure", () => {
  const tools: Array<{ name: string }> = [];
  plugin.register({
    pluginConfig: {},
    registerTool: (tool: { name: string }) => { tools.push(tool); },
  } as never);
  assert.deepEqual(tools.map((tool) => tool.name), [
    "fleetmind_task_get",
    "fleetmind_task_list_active",
  ]);
});

test("published plugin entry re-exports the documented transport adapters", () => {
  assert.equal(typeof DynamoDbTaskReader, "function");
  assert.equal(typeof NatsTaskEvents, "function");
});
