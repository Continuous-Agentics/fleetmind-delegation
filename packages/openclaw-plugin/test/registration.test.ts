import assert from "node:assert/strict";
import { test } from "node:test";
import plugin, { DynamoDbTaskReader, NatsTaskEvents, TaskLedger } from "../src/index.js";

type RegisteredTool = {
  name: string;
  parameters: { required?: string[]; properties?: Record<string, unknown> };
};
type RegisteredToolOption = { optional?: boolean };
type RegisteredToolWithOptions = RegisteredTool & { options?: RegisteredToolOption };
type RegisteredHook = { event: string; options?: { name?: string }; handler: (event: { toolName: string; params: Record<string, unknown> }, context: { agentId?: string }) => unknown };

function registerPlugin(config: Record<string, unknown> = {}): { tools: RegisteredToolWithOptions[]; hooks: RegisteredHook[]; services: Array<{ id: string }> } {
  const tools: RegisteredToolWithOptions[] = [];
  const hooks: RegisteredHook[] = [];
  const services: Array<{ id: string }> = [];
  plugin.register({
    pluginConfig: config,
    registerTool: (tool: RegisteredTool, options?: RegisteredToolOption) => { tools.push({ ...tool, options }); },
    registerHook: (event: string, handler: RegisteredHook["handler"], options?: { name?: string }) => { hooks.push({ event, handler, options }); },
    registerService: (service: { id: string }) => { services.push(service); },
  } as never);
  return { tools, hooks, services };
}

function registerTools(): RegisteredToolWithOptions[] {
  return registerPlugin().tools;
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
    assert.equal(parameters?.properties?.["project"], undefined);
  }
  for (const name of ["fleetmind_task_signoff", "fleetmind_task_merge"]) {
    const parameters = tools.get(name)?.parameters;
    assert.deepEqual(parameters?.required, ["taskId"]);
    assert.equal(parameters?.properties?.["project"], undefined);
  }
});

test("human-authority lifecycle tools are optional and hidden unless explicitly allowlisted", () => {
  const tools = new Map(registerTools().map((tool) => [tool.name, tool]));
  assert.equal(tools.get("fleetmind_task_ack")?.options?.optional, undefined);
  assert.equal(tools.get("fleetmind_task_ship")?.options?.optional, undefined);
  assert.equal(tools.get("fleetmind_task_block")?.options?.optional, undefined);
  assert.equal(tools.get("fleetmind_task_signoff")?.options?.optional, true);
  assert.equal(tools.get("fleetmind_task_merge")?.options?.optional, true);
});

test("human-authority tool calls are blocked unless the caller is a configured reviewer", () => {
  const { hooks } = registerPlugin({ tableName: "tasks", reviewerAgentIds: ["reviewer"], workerAgentIds: { worker: "forge" } });
  assert.equal(hooks.length, 1);
  const hook = hooks[0];
  assert.equal(hook?.event, "before_tool_call");
  assert.equal(hook?.options?.name, "fleetmind-delegation-authorize-lifecycle-tools");
  assert.equal(hook?.handler({ toolName: "fleetmind_task_ship", params: { worker: "forge" } }, { agentId: "worker" }), undefined);
  assert.deepEqual(hook?.handler({ toolName: "fleetmind_task_ship", params: { worker: "forge" } }, { agentId: "impostor" }), {
    block: true,
    blockReason: "Only the configured OpenClaw agent for this worker may acknowledge, ship, or block a task.",
  });
  assert.equal(hook?.handler({ toolName: "fleetmind_task_merge", params: {} }, { agentId: "reviewer" }), undefined);
  assert.deepEqual(hook?.handler({ toolName: "fleetmind_task_signoff", params: {} }, { agentId: "worker" }), {
    block: true,
    blockReason: "Only a configured FleetMind reviewer agent may sign off or merge a task.",
  });
});

test("published plugin entry re-exports the documented ledger and transport adapters", () => {
  assert.equal(typeof DynamoDbTaskReader, "function");
  assert.equal(typeof NatsTaskEvents, "function");
  assert.equal(typeof TaskLedger, "function");
});
