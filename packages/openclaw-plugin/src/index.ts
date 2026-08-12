import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import type { TaskRecord, TaskStatus } from "@continuous-agentics/delegation-core";
import {
  DynamoDbTaskReader,
  TaskLedger,
  type TaskReader,
  type TaskSummary,
} from "@continuous-agentics/delegation-core";

export const pluginPackageName = "@continuous-agentics/openclaw-delegation-plugin";
export const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "delegated",
  "accepted",
  "shipped",
  "signed_off",
  "blocked",
];

interface PluginConfig {
  tableName: string;
  awsRegion?: string;
  reviewerAgentIds: string[];
}

export interface LifecycleTaskLedger {
  ackTask(taskId: string, worker: string): Promise<void>;
  shipTask(taskId: string, worker: string): Promise<void>;
  blockTask(taskId: string, worker: string): Promise<void>;
  signoffTask(taskId: string): Promise<void>;
  mergeTask(taskId: string): Promise<void>;
}

export type LifecycleAction = "ack" | "ship" | "block" | "signoff" | "merge";
export interface LifecycleToolParams {
  taskId: string;
  worker?: string;
}

export const HUMAN_AUTHORITY_ACTIONS = new Set<LifecycleAction>(["signoff", "merge"]);

export function isHumanAuthorityAction(action: LifecycleAction): boolean {
  return HUMAN_AUTHORITY_ACTIONS.has(action);
}

export function assertHumanAuthorityCaller(
  action: LifecycleAction,
  agentId: string | undefined,
  reviewerAgentIds: readonly string[],
): void {
  if (isHumanAuthorityAction(action) && (!agentId || !reviewerAgentIds.includes(agentId))) {
    throw new Error("Only a configured FleetMind reviewer agent may sign off or merge a task.");
  }
}

function readConfig(config: Record<string, unknown>): PluginConfig {
  const tableName = config["tableName"];
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new Error("fleetmind-delegation requires plugins.entries.fleetmind-delegation.config.tableName.");
  }
  const awsRegion = config["awsRegion"];
  if (awsRegion !== undefined && typeof awsRegion !== "string") {
    throw new Error("fleetmind-delegation config.awsRegion must be a string when set.");
  }
  const reviewerAgentIds = config["reviewerAgentIds"] ?? [];
  if (!Array.isArray(reviewerAgentIds) || reviewerAgentIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("fleetmind-delegation config.reviewerAgentIds must be an array of non-empty agent IDs when set.");
  }
  return { tableName, awsRegion, reviewerAgentIds };
}

export async function listActiveTasks(
  reader: TaskReader,
  options: { project?: string; limit?: number },
): Promise<TaskSummary[]> {
  // Querying up to the global limit from every status is sufficient to find
  // the global newest N tasks after merging, without starving a status bucket.
  const limit = options.limit ?? 20;
  const results = await Promise.all(
    ACTIVE_TASK_STATUSES.map((status) => reader.listByStatus({
      ...options,
      status,
      limit,
      ascending: false,
    })),
  );
  return results
    .flat()
    .sort((a, b) => b.delegated_at.localeCompare(a.delegated_at))
    .slice(0, limit);
}

export function formatTask(task: TaskRecord): string {
  return JSON.stringify(task, null, 2);
}

export async function runLifecycleAction(
  ledger: LifecycleTaskLedger,
  action: LifecycleAction,
  params: LifecycleToolParams,
): Promise<string> {
  switch (action) {
    case "ack":
      await ledger.ackTask(params.taskId, params.worker!);
      return `Acknowledged FleetMind task ${params.taskId}.`;
    case "ship":
      await ledger.shipTask(params.taskId, params.worker!);
      return `Shipped FleetMind task ${params.taskId}.`;
    case "block":
      await ledger.blockTask(params.taskId, params.worker!);
      return `Blocked FleetMind task ${params.taskId}.`;
    case "signoff":
      await ledger.signoffTask(params.taskId);
      return `Signed off FleetMind task ${params.taskId}.`;
    case "merge":
      await ledger.mergeTask(params.taskId);
      return `Merged FleetMind task ${params.taskId}.`;
  }
}

const taskIdParameter = Type.String({ pattern: "^[0-9a-f]{8}$" });
const workerParameters = Type.Object({
  taskId: taskIdParameter,
  worker: Type.String({ minLength: 1 }),
});
const humanParameters = Type.Object({ taskId: taskIdParameter });

const pluginEntry: ReturnType<typeof definePluginEntry> = definePluginEntry({
  id: "fleetmind-delegation",
  name: "FleetMind Delegation",
  description: "Read and safely transition FleetMind delegation tasks from the task ledger.",
  register(api) {
    let reader: TaskReader | undefined;
    let ledger: TaskLedger | undefined;
    const getConfig = (): PluginConfig => readConfig(api.pluginConfig ?? {});
    const getReader = (): TaskReader => {
      reader ??= (() => {
        const config = getConfig();
        return new DynamoDbTaskReader({ tableName: config.tableName, region: config.awsRegion });
      })();
      return reader;
    };
    const getLedger = (): TaskLedger => {
      ledger ??= (() => {
        const config = getConfig();
        return new TaskLedger({ tableName: config.tableName, region: config.awsRegion });
      })();
      return ledger;
    };

    api.registerTool({
      name: "fleetmind_task_get",
      label: "Get FleetMind task",
      description: "Read one FleetMind delegation task by its eight-character task ID.",
      parameters: Type.Object({ taskId: taskIdParameter }),
      async execute(_id, rawParams) {
        const params = rawParams as { taskId: string };
        const task = await getReader().get(params.taskId);
        return {
          content: [{
            type: "text",
            text: task ? formatTask(task) : `No FleetMind task found for ${params.taskId}.`,
          }],
          details: {},
        };
      },
    });

    api.registerTool({
      name: "fleetmind_task_list_active",
      label: "List active FleetMind tasks",
      description: "List active FleetMind tasks across delegated, accepted, shipped, signed-off, and blocked states.",
      parameters: Type.Object({
        project: Type.Optional(Type.String({ minLength: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
      }),
      async execute(_id, rawParams) {
        const params = rawParams as { project?: string; limit?: number };
        const tasks = await listActiveTasks(getReader(), params);
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }], details: {} };
      },
    });

    type BeforeToolCall = (
      event: { toolName: string; params: Record<string, unknown> },
      context: { agentId?: string },
    ) => { block: true; blockReason: string } | undefined;
    (api.registerHook as unknown as (event: "before_tool_call", handler: BeforeToolCall) => void)(
      "before_tool_call",
      (event, context) => {
        const action = event.toolName === "fleetmind_task_signoff" ? "signoff"
          : event.toolName === "fleetmind_task_merge" ? "merge"
          : undefined;
        if (!action) return undefined;
        try {
          assertHumanAuthorityCaller(action, context.agentId, getConfig().reviewerAgentIds);
          return undefined;
        } catch (error) {
          return { block: true, blockReason: error instanceof Error ? error.message : "Human authority required." };
        }
      },
    );

    const registerLifecycleTool = (
      action: LifecycleAction,
      name: string,
      label: string,
      description: string,
      requiresWorker: boolean,
    ): void => {
      api.registerTool({
        name,
        label,
        description,
        parameters: requiresWorker ? workerParameters : humanParameters,
        async execute(_id, rawParams) {
          const text = await runLifecycleAction(getLedger(), action, rawParams as LifecycleToolParams);
          return { content: [{ type: "text", text }], details: {} };
        },
      }, isHumanAuthorityAction(action) ? { optional: true } : undefined);
    };

    registerLifecycleTool("ack", "fleetmind_task_ack", "Acknowledge FleetMind task", "Acknowledge a delegated task as its assigned worker.", true);
    registerLifecycleTool("ship", "fleetmind_task_ship", "Ship FleetMind task", "Mark an accepted task as shipped as its assigned worker.", true);
    registerLifecycleTool("block", "fleetmind_task_block", "Block FleetMind task", "Mark a delegated or accepted task as blocked as its assigned worker.", true);
    registerLifecycleTool("signoff", "fleetmind_task_signoff", "Sign off FleetMind task", "Sign off a shipped task that requires human sign-off.", false);
    registerLifecycleTool("merge", "fleetmind_task_merge", "Merge FleetMind task", "Mark an eligible shipped or signed-off task as merged.", false);
  },
});

export default pluginEntry;

export {
  DynamoDbTaskReader,
  NatsTaskEvents,
  TaskLedger,
} from "@continuous-agentics/delegation-core";
export type {
  DelegationDDBConfig,
  DynamoDbTaskReaderConfig,
  ListTasksOptions,
  NatsTaskEventsConfig,
  TaskEventHandler,
  TaskReader,
  TaskSummary,
} from "@continuous-agentics/delegation-core";
