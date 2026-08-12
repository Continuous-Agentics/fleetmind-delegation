import { randomUUID } from "node:crypto";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import type { DeliveryContext, TaskRecord, TaskStatus } from "@continuous-agentics/delegation-core";
import { handleTerminalTaskEvent } from "./terminal-events.js";
export { handleTerminalTaskEvent } from "./terminal-events.js";
export type { TerminalEventDependencies, TerminalEventLedger, TerminalTaskEvent } from "./terminal-events.js";
import {
  DynamoDbTaskReader,
  NatsTaskEvents,
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
  workerAgentIds: Record<string, string>;
  terminalEvents?: { natsServers: string[]; subjectPrefix: string; pmAgentId: string };
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

export function assertWorkerAuthorityCaller(
  agentId: string | undefined,
  worker: unknown,
  workerAgentIds: Readonly<Record<string, string>>,
): void {
  if (!agentId || typeof worker !== "string" || workerAgentIds[agentId] !== worker) {
    throw new Error("Only the configured OpenClaw agent for this worker may acknowledge, ship, or block a task.");
  }
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
  const workerAgentIds = config["workerAgentIds"] ?? {};
  if (typeof workerAgentIds !== "object" || workerAgentIds === null || Array.isArray(workerAgentIds)
    || Object.entries(workerAgentIds).some(([agentId, worker]) => agentId.length === 0 || typeof worker !== "string" || worker.length === 0)) {
    throw new Error("fleetmind-delegation config.workerAgentIds must map non-empty agent IDs to non-empty worker IDs when set.");
  }
  const terminalEvents = config["terminalEvents"];
  if (terminalEvents !== undefined && (typeof terminalEvents !== "object" || terminalEvents === null || Array.isArray(terminalEvents))) {
    throw new Error("fleetmind-delegation config.terminalEvents must be an object when set.");
  }
  const terminal = terminalEvents as Record<string, unknown> | undefined;
  const natsServers = terminal?.["natsServers"];
  const subjectPrefix = terminal?.["subjectPrefix"];
  const pmAgentId = terminal?.["pmAgentId"];
  if (terminal && (!Array.isArray(natsServers) || natsServers.length === 0 || natsServers.some((server) => typeof server !== "string" || server.length === 0)
    || typeof subjectPrefix !== "string" || subjectPrefix.length === 0 || typeof pmAgentId !== "string" || pmAgentId.length === 0)) {
    throw new Error("fleetmind-delegation config.terminalEvents requires non-empty natsServers, subjectPrefix, and pmAgentId.");
  }
  return {
    tableName, awsRegion, reviewerAgentIds, workerAgentIds: workerAgentIds as Record<string, string>,
    terminalEvents: terminal ? { natsServers: natsServers as string[], subjectPrefix: subjectPrefix as string, pmAgentId: pmAgentId as string } : undefined,
  };
}

export function sessionKeyForDelivery(agentId: string, delivery?: DeliveryContext, legacyThreadUrl?: string): string | undefined {
  if (delivery) {
    if (delivery.provider !== "slack" || !delivery.threadId) return undefined;
    return `agent:${agentId}:slack:channel:${delivery.conversationId.toLowerCase()}:thread:${delivery.threadId}`;
  }
  const match = legacyThreadUrl?.match(/\/archives\/([A-Z0-9]+)\/p(\d{7,})/);
  if (!match) return undefined;
  const timestamp = match[2]!;
  return `agent:${agentId}:slack:channel:${match[1]!.toLowerCase()}:thread:${timestamp.slice(0, -6)}.${timestamp.slice(-6)}`;
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

    let stopTerminalEvents: (() => Promise<void>) | undefined;
    api.registerService({
      id: "fleetmind-delegation-terminal-events",
      async start(ctx) {
        const config = getConfig().terminalEvents;
        if (!config) return;
        const transport = new NatsTaskEvents({ servers: config.natsServers, subjectPrefix: config.subjectPrefix, onError: (error) => ctx.logger.error(`FleetMind terminal NATS error: ${String(error)}`) });
        stopTerminalEvents = await transport.subscribeForPm(async (event) => {
          if (event.event !== "ship" && event.event !== "block") return;
          await handleTerminalTaskEvent(event as typeof event & { event: "ship" | "block" }, {
            ledger: getLedger(),
            pmAgentId: config.pmAgentId,
            wakePm: (agentId, prompt, delivery, legacyThreadUrl) => {
              const sessionKey = sessionKeyForDelivery(agentId, delivery, legacyThreadUrl);
              void api.runtime.agent.runEmbeddedAgent({
                sessionId: sessionKey ?? `fleetmind-delegation:${randomUUID()}`,
                sessionKey,
                runId: randomUUID(),
                agentId,
                workspaceDir: api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId),
                config: ctx.config,
                prompt,
                timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg: ctx.config }),
                trigger: "manual",
              }).catch((error) => ctx.logger.error(`FleetMind terminal PM wake failed: ${String(error)}`));
            },
            onError: (message, error) => ctx.logger.error(`${message} ${String(error)}`),
            onInfo: (message) => ctx.logger.info(message),
          });
        });
      },
      async stop() { await stopTerminalEvents?.(); stopTerminalEvents = undefined; },
    });

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
    (api.registerHook as unknown as (event: "before_tool_call", handler: BeforeToolCall, options: { name: string }) => void)(
      "before_tool_call",
      (event, context) => {
        const action = event.toolName === "fleetmind_task_signoff" ? "signoff"
          : event.toolName === "fleetmind_task_merge" ? "merge"
          : undefined;
        try {
          const config = getConfig();
          if (action) {
            assertHumanAuthorityCaller(action, context.agentId, config.reviewerAgentIds);
          } else if (event.toolName === "fleetmind_task_ack" || event.toolName === "fleetmind_task_ship" || event.toolName === "fleetmind_task_block") {
            assertWorkerAuthorityCaller(context.agentId, event.params.worker, config.workerAgentIds);
          } else {
            return undefined;
          }
          return undefined;
        } catch (error) {
          return { block: true, blockReason: error instanceof Error ? error.message : "Human authority required." };
        }
      },
      { name: "fleetmind-delegation-authorize-lifecycle-tools" },
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
