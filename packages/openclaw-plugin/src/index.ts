import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import type { TaskRecord, TaskStatus } from "@continuous-agentics/delegation-core";
import { DynamoDbTaskReader, type TaskReader } from "./task-reader.js";

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
  return { tableName, awsRegion };
}

export async function listActiveTasks(
  reader: TaskReader,
  options: { project?: string; limit?: number },
) {
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

const pluginEntry: ReturnType<typeof definePluginEntry> = definePluginEntry({
  id: "fleetmind-delegation",
  name: "FleetMind Delegation",
  description: "Read active FleetMind delegation tasks from the task ledger.",
  register(api) {
    let reader: TaskReader | undefined;
    const getReader = (): TaskReader => {
      reader ??= (() => {
        const config = readConfig(api.pluginConfig ?? {});
        return new DynamoDbTaskReader({ tableName: config.tableName, region: config.awsRegion });
      })();
      return reader;
    };

    api.registerTool({
      name: "fleetmind_task_get",
      label: "Get FleetMind task",
      description: "Read one FleetMind delegation task by its eight-character task ID.",
      parameters: Type.Object({ taskId: Type.String({ pattern: "^[0-9a-f]{8}$" }) }),
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
  },
});

export default pluginEntry;

export { DynamoDbTaskReader } from "./task-reader.js";
export type {
  DynamoDbTaskReaderConfig,
  ListTasksOptions,
  TaskReader,
  TaskSummary,
} from "./task-reader.js";
export { NatsTaskEvents } from "./task-events.js";
export type { NatsTaskEventsConfig, TaskEventHandler } from "./task-events.js";
