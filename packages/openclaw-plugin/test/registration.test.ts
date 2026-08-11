import assert from "node:assert/strict";
import { test } from "node:test";
import plugin, { DynamoDbTaskReader, NatsTaskEvents, TaskLedger } from "../src/index.js";

type RegisteredTool = {
  name: string;
  parameters: { required?: string[]; properties?: Record<string, unknown> };
};

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  plugin.register({
    pluginConfig: {},
    registerTool: (tool: RegisteredTool) => { tools.push(tool); },
  } as never);
  return tools;
}

test("plugin registers read tools and the declared lifecycle task tools without configured infrastructure", () => {
  const tools = registerTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    "fleetmind_task_get",
    "fleetmind_task_list_active",
    "fleetmind_task_ack",
    "fleetmind_task_ship",
    "fleetmind_task_block",
    "fleetmind_task_signoff",
    "fleetmind_task_merge",
  ]);
});

test("worker lifecycle tools require task ID and worker while human transitions require only task ID", () => {
  const tools = new Map(registerTools().map((tool) => [tool.name, tool]));
  for (const name of ["fleetmind_task_ack", "fleetmind_task_ship", "fleetmind_task_block"]) {
    const parameters = tools.get(name)?.parameters;
    assert.deepEqual(parameters?.required, ["taskId", "worker"]);
    assert.ok(parameters?.properties?.["project"]);
  }
  for (const name of ["fleetmind_task_signoff", "fleetmind_task_merge"]) {
    const parameters = tools.get(name)?.parameters;
    assert.deepEqual(parameters?.required, ["taskId"]);
    assert.ok(parameters?.properties?.["project"]);
  }
});

test("published plugin entry re-exports the documented ledger and transport adapters", () => {
  assert.equal(typeof DynamoDbTaskReader, "function");
  assert.equal(typeof NatsTaskEvents, "function");
  assert.equal(typeof TaskLedger, "function");
});
