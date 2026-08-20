import { randomUUID } from "node:crypto";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import type { DeliveryContext, TaskRecord, TaskStatus } from "@continuous-agentics/delegation-core";
import { handleTerminalTaskEvent } from "./terminal-events.js";
import { handleDelegationTaskEvent } from "./delegation-events.js";
import {
  pmTerminalReceipt,
  sendBestEffortSlackThreadReceipt,
  sessionKeyForSlackThread,
  slackThreadTarget,
  workerDelegationReceipt,
} from "./slack-delivery.js";
export { handleTerminalTaskEvent } from "./terminal-events.js";
export type { TerminalEventDependencies, TerminalEventLedger, TerminalTaskEvent } from "./terminal-events.js";
export { handleDelegationTaskEvent } from "./delegation-events.js";
export type { DelegationEventDependencies, DelegationEventLedger, DelegationTaskEvent } from "./delegation-events.js";
export {
  pmTerminalReceipt,
  sendBestEffortSlackThreadReceipt,
  sessionKeyForSlackThread,
  slackThreadTarget,
  workerDelegationReceipt,
} from "./slack-delivery.js";
import {
  DynamoDbTaskReader,
  NatsTaskEvents,
  TaskLedger,
  type TaskReader,
  type TaskSummary,
} from "@continuous-agentics/delegation-core";

export const pluginPackageName = "@continuous-agentics/openclaw-fleetmind-delegation";
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
  delegationEvents?: {
    natsServers: string[];
    subjectPrefix: string;
    agentId: string;
    workerHomeSlack?: { accountId: string; conversationId: string };
  };
}

export interface LifecycleTaskLedger {
  ackTask(taskId: string, worker: string): Promise<void>;
  shipTask(taskId: string, worker: string): Promise<{ at: string; terminalEventId: string } | void>;
  blockTask(taskId: string, worker: string): Promise<{ at: string; terminalEventId: string } | void>;
  signoffTask(taskId: string): Promise<void>;
  mergeTask(taskId: string): Promise<void>;
}

export interface LifecycleActionCallbacks {
  /** Best-effort low-latency notification after a durable terminal transition. */
  publishTerminalEvent?: (taskId: string, event: "ship" | "block", terminalEventId: string) => Promise<void>;
  onTerminalPublishError?: (taskId: string, event: "ship" | "block", terminalEventId: string, error: unknown) => void;
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
  const delegationEvents = config["delegationEvents"];
  if (delegationEvents !== undefined && (typeof delegationEvents !== "object" || delegationEvents === null || Array.isArray(delegationEvents))) {
    throw new Error("fleetmind-delegation config.delegationEvents must be an object when set.");
  }
  const delegation = delegationEvents as Record<string, unknown> | undefined;
  const delegationNatsServers = delegation?.["natsServers"];
  const delegationSubjectPrefix = delegation?.["subjectPrefix"];
  const delegationAgentId = delegation?.["agentId"];
  const workerHomeSlack = delegation?.["workerHomeSlack"];
  if (delegation && (!Array.isArray(delegationNatsServers) || delegationNatsServers.length === 0 || delegationNatsServers.some((server) => typeof server !== "string" || server.length === 0)
    || typeof delegationSubjectPrefix !== "string" || delegationSubjectPrefix.length === 0 || typeof delegationAgentId !== "string" || delegationAgentId.length === 0
    || (workerHomeSlack !== undefined && (typeof workerHomeSlack !== "object" || workerHomeSlack === null || Array.isArray(workerHomeSlack)
      || typeof (workerHomeSlack as Record<string, unknown>)["accountId"] !== "string" || !(workerHomeSlack as Record<string, unknown>)["accountId"]
      || typeof (workerHomeSlack as Record<string, unknown>)["conversationId"] !== "string" || !(workerHomeSlack as Record<string, unknown>)["conversationId"])))) {
    throw new Error("fleetmind-delegation config.delegationEvents requires non-empty natsServers, subjectPrefix, agentId, and (when set) workerHomeSlack accountId/conversationId.");
  }
  return {
    tableName, awsRegion, reviewerAgentIds, workerAgentIds: workerAgentIds as Record<string, string>,
    terminalEvents: terminal ? { natsServers: natsServers as string[], subjectPrefix: subjectPrefix as string, pmAgentId: pmAgentId as string } : undefined,
    delegationEvents: delegation ? {
      natsServers: delegationNatsServers as string[], subjectPrefix: delegationSubjectPrefix as string, agentId: delegationAgentId as string,
      workerHomeSlack: workerHomeSlack as { accountId: string; conversationId: string } | undefined,
    } : undefined,
  };
}

export interface DeliveryTarget {
  channel: string;
  conversationId: string;
  threadId?: string;
  accountId?: string;
  sessionKey: string;
}

export function deliveryTargetForPm(agentId: string, delivery?: DeliveryContext, legacyThreadUrl?: string): DeliveryTarget | undefined {
  if (delivery) {
    const sessionKey = delivery.provider === "slack" && delivery.threadId
      ? `agent:${agentId}:slack:channel:${delivery.conversationId.toLowerCase()}:thread:${delivery.threadId}`
      : `agent:${agentId}:${delivery.provider}:channel:${delivery.conversationId}`;
    return { channel: delivery.provider, conversationId: delivery.conversationId, threadId: delivery.threadId, accountId: delivery.accountId, sessionKey };
  }
  const match = legacyThreadUrl?.match(/\/archives\/([A-Z0-9]+)\/p(\d{7,})/);
  if (!match) return undefined;
  const timestamp = match[2]!;
  const threadId = `${timestamp.slice(0, -6)}.${timestamp.slice(-6)}`;
  return { channel: "slack", conversationId: match[1]!, threadId, sessionKey: `agent:${agentId}:slack:channel:${match[1]!.toLowerCase()}:thread:${threadId}` };
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
  callbacks: LifecycleActionCallbacks = {},
): Promise<string> {
  switch (action) {
    case "ack":
      await ledger.ackTask(params.taskId, params.worker!);
      return `Acknowledged FleetMind task ${params.taskId}.`;
    case "ship":
      {
        const transition = await ledger.shipTask(params.taskId, params.worker!);
        if (transition?.terminalEventId) try {
          await callbacks.publishTerminalEvent?.(params.taskId, "ship", transition.terminalEventId);
        } catch (error) {
          callbacks.onTerminalPublishError?.(params.taskId, "ship", transition.terminalEventId, error);
        }
      }
      return `Shipped FleetMind task ${params.taskId}.`;
    case "block":
      {
        const transition = await ledger.blockTask(params.taskId, params.worker!);
        if (transition?.terminalEventId) try {
          await callbacks.publishTerminalEvent?.(params.taskId, "block", transition.terminalEventId);
        } catch (error) {
          callbacks.onTerminalPublishError?.(params.taskId, "block", transition.terminalEventId, error);
        }
      }
      return `Blocked FleetMind task ${params.taskId}.`;
    case "signoff":
      await ledger.signoffTask(params.taskId);
      return `Signed off FleetMind task ${params.taskId}.`;
    case "merge":
      await ledger.mergeTask(params.taskId);
      return `Merged FleetMind task ${params.taskId}.`;
  }
}

export const TERMINAL_RECONCILE_INITIAL_MS = 30_000;
export const TERMINAL_RECONCILE_MAX_MS = 300_000;

/** Jittered exponential retry avoids synchronized relay scans across a fleet. */
export function nextTerminalReconcileDelay(
  previousDelayMs: number,
  outcome: "empty" | "work" | "error",
  random: () => number = Math.random,
): number {
  const base = outcome === "work"
    ? TERMINAL_RECONCILE_INITIAL_MS
    : Math.min(Math.max(previousDelayMs, TERMINAL_RECONCILE_INITIAL_MS) * 2, TERMINAL_RECONCILE_MAX_MS);
  return Math.round(base * (0.8 + random() * 0.4));
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
    let lifecycleTerminalPublisher: NatsTaskEvents | undefined;
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
    const publishTerminalEvent = async (taskId: string, event: "ship" | "block", terminalEventId: string): Promise<void> => {
      // Worker plugin instances already have this transport configuration for
      // delegation receipt. A successful publish is only a fast path: the
      // transactional outbox remains responsible for eventual delivery.
      const config = getConfig().delegationEvents;
      if (!config) return;
      const outbox = await getLedger().getTerminalEventOutbox(taskId, event, terminalEventId);
      if (!outbox) throw new Error(`Terminal outbox event is missing for ${taskId}/${event}.`);
      lifecycleTerminalPublisher ??= new NatsTaskEvents({
        servers: config.natsServers,
        subjectPrefix: config.subjectPrefix,
      });
      await lifecycleTerminalPublisher.publish({
        v: "1.0",
        event: outbox.event,
        task_id: outbox.task_id,
        project: outbox.project,
        worker: outbox.worker,
        delegated_by: outbox.delegated_by || undefined,
        at: outbox.at,
        terminal_event_id: outbox.terminal_event_id,
        delegation_thread: outbox.delegation_thread,
        delivery_context: outbox.delivery_context,
      });
    };

    let stopTerminalEvents: (() => Promise<void>) | undefined;
    let terminalEventGeneration = 0;
    let terminalHandlers = new Set<Promise<void>>();
    let terminalReconcileTimer: ReturnType<typeof setTimeout> | undefined;
    api.registerService({
      id: "fleetmind-delegation-terminal-events",
      async start(ctx) {
        // Keep the opt-in service dormant even when the lifecycle-tool config
        // is intentionally absent.
        if ((api.pluginConfig ?? {})["terminalEvents"] === undefined) return;
        await stopTerminalEvents?.();
        stopTerminalEvents = undefined;
        if (terminalReconcileTimer) clearTimeout(terminalReconcileTimer);
        terminalReconcileTimer = undefined;
        await Promise.allSettled([...terminalHandlers]);
        const generation = ++terminalEventGeneration;
        const config = getConfig().terminalEvents!;
        const transport = new NatsTaskEvents({ servers: config.natsServers, subjectPrefix: config.subjectPrefix, onError: (error) => ctx.logger.error(`FleetMind terminal NATS error: ${String(error)}`) });
        const dispose = await transport.subscribeForPm((event) => {
          if (event.event !== "ship" && event.event !== "block" || generation !== terminalEventGeneration) return;
          const deliver = async (): Promise<void> => {
            const terminalEvent = event.event as "ship" | "block";
            const leaseId = randomUUID();
            const leaseMs = api.runtime.agent.resolveAgentTimeoutMs({ cfg: ctx.config }) + 30_000;
            const claimed = event.terminal_event_id
              ? await getLedger().claimTerminalEventDelivery(event.task_id, terminalEvent, event.terminal_event_id, leaseId, leaseMs)
              : false;
            if (!claimed) {
              // Compatibility for terminal events produced by older FleetMind
              // senders, which predate the standalone outbox record.
              const outbox = event.terminal_event_id
                ? await getLedger().getTerminalEventOutbox(event.task_id, terminalEvent, event.terminal_event_id)
                : undefined;
              if (outbox) return;
            }
            const delivered = await handleTerminalTaskEvent(event as typeof event & { event: "ship" | "block" }, {
            ledger: getLedger(),
            pmAgentId: config.pmAgentId,
            wakePm: async (agentId, prompt, delivery, legacyThreadUrl) => {
              const target = deliveryTargetForPm(agentId, delivery, legacyThreadUrl);
              if (target?.channel === "slack") {
                const receipt = pmTerminalReceipt(event.event as "ship" | "block", event.task_id, event.worker);
                try {
                  const adapter = await api.runtime.channel.outbound.loadAdapter(target.channel as never);
                  const sendText = adapter?.sendText;
                  if (sendText) await sendText({ cfg: ctx.config, to: target.conversationId, text: receipt, threadId: target.threadId, accountId: target.accountId });
                } catch (error) {
                  ctx.logger.warn(`FleetMind terminal receipt failed: ${String(error)}`);
                }
              }
              const result = await api.runtime.agent.runEmbeddedAgent({
                sessionId: target?.sessionKey ?? `agent:${agentId}:main`,
                sessionKey: target?.sessionKey ?? `agent:${agentId}:main`,
                runId: randomUUID(),
                agentId,
                workspaceDir: api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId),
                config: ctx.config,
                prompt,
                messageChannel: target?.channel,
                messageProvider: target?.channel,
                messageTo: target?.conversationId,
                messageThreadId: target?.threadId,
                currentChannelId: target?.conversationId,
                currentThreadTs: target?.threadId,
                agentAccountId: target?.accountId,
                timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg: ctx.config }),
                trigger: "manual",
              });
              if (!target || result.didDeliverSourceReplyViaMessageTool) return;
              const adapter = await api.runtime.channel.outbound.loadAdapter(target.channel as never);
              if (!adapter) throw new Error(`No outbound adapter for ${target.channel}.`);
              const sendText = adapter.sendText;
              if (!sendText) throw new Error(`Outbound adapter for ${target.channel} cannot send text.`);
              for (const payload of result.payloads ?? []) {
                if (!payload.isReasoning && !payload.isCommentary && payload.text?.trim()) {
                  await sendText({ cfg: ctx.config, to: target.conversationId, text: payload.text, threadId: target.threadId, accountId: target.accountId });
                }
              }
            },
            onError: (message, error) => ctx.logger.error(`${message} ${String(error)}`),
            onInfo: (message) => ctx.logger.info(message),
          });
            if (claimed) {
              if (delivered) await getLedger().completeTerminalEventDelivery(event.task_id, terminalEvent, event.terminal_event_id!, leaseId);
              else await getLedger().releaseTerminalEventDelivery(event.task_id, terminalEvent, event.terminal_event_id!, leaseId);
            }
          };
          const tracked = deliver().catch(async (error) => {
            ctx.logger.error(`FleetMind terminal delivery failed: ${String(error)}`);
          });
          terminalHandlers.add(tracked);
          void tracked.then(() => terminalHandlers.delete(tracked));
          return tracked;
        });
        if (generation !== terminalEventGeneration) {
          await dispose();
          return;
        }
        stopTerminalEvents = dispose;
        const reconcile = async (): Promise<"empty" | "work"> => {
          const pending = await getLedger().listPendingTerminalEvents();
          for (const task of pending) {
            if (generation !== terminalEventGeneration) continue;
            await transport.publish({
              v: "1.0",
              event: task.event,
              task_id: task.task_id,
              project: task.project,
              worker: task.worker,
              delegated_by: task.delegated_by || undefined,
              at: task.at,
              terminal_event_id: task.terminal_event_id,
              delegation_thread: task.delegation_thread,
              delivery_context: task.delivery_context,
            });
          }
          return pending.length === 0 ? "empty" : "work";
        };
        let nextDelayMs = TERMINAL_RECONCILE_INITIAL_MS;
        const scheduleReconcile = (delayMs: number): void => {
          if (generation !== terminalEventGeneration) return;
          terminalReconcileTimer = setTimeout(() => {
            terminalReconcileTimer = undefined;
            if (generation !== terminalEventGeneration) return;
            void reconcile()
              .then((outcome) => {
                if (generation !== terminalEventGeneration) return;
                nextDelayMs = nextTerminalReconcileDelay(nextDelayMs, outcome);
                scheduleReconcile(nextDelayMs);
              })
              .catch((error) => {
                if (generation !== terminalEventGeneration) return;
                ctx.logger.error(`FleetMind terminal reconciliation failed: ${String(error)}`);
                nextDelayMs = nextTerminalReconcileDelay(nextDelayMs, "error");
                scheduleReconcile(nextDelayMs);
              });
          }, delayMs);
          terminalReconcileTimer.unref?.();
        };
        try {
          await reconcile();
        } catch (error) {
          ctx.logger.error(`FleetMind terminal reconciliation failed: ${String(error)}`);
        }
        // Startup always gets one short recovery check. Subsequent empty or
        // failing checks back off from this initial interval.
        if (generation === terminalEventGeneration) scheduleReconcile(nextDelayMs);
      },
      async stop() {
        terminalEventGeneration += 1;
        if (terminalReconcileTimer) clearTimeout(terminalReconcileTimer);
        terminalReconcileTimer = undefined;
        await stopTerminalEvents?.();
        stopTerminalEvents = undefined;
        await Promise.allSettled([...terminalHandlers]);
      },
    });

    let stopDelegationEvents: (() => Promise<void>) | undefined;
    let delegationEventGeneration = 0;
    let delegationHandlers = new Set<Promise<void>>();
    api.registerService({
      id: "fleetmind-delegation-worker-events",
      async start(ctx) {
        if ((api.pluginConfig ?? {})["delegationEvents"] === undefined) return;
        await stopDelegationEvents?.();
        stopDelegationEvents = undefined;
        await Promise.allSettled([...delegationHandlers]);
        const generation = ++delegationEventGeneration;
        const pluginConfig = getConfig();
        const config = pluginConfig.delegationEvents!;
        const workerId = pluginConfig.workerAgentIds[config.agentId];
        if (!workerId) {
          throw new Error(`fleetmind-delegation config.workerAgentIds must map delegationEvents.agentId ${config.agentId} to its FleetMind worker ID.`);
        }
        const transport = new NatsTaskEvents({
          servers: config.natsServers,
          subjectPrefix: config.subjectPrefix,
          onError: (error) => ctx.logger.error(`FleetMind delegation NATS error: ${String(error)}`),
        });
        const dispose = await transport.subscribeForWorker(workerId, (event) => {
          if (event.event !== "delegation" || generation !== delegationEventGeneration) return;
          const handler = handleDelegationTaskEvent(event as typeof event & { event: "delegation" }, {
            ledger: getLedger(),
            workerAgentId: config.agentId,
            workerId,
            workerHomeSlack: config.workerHomeSlack,
            slackSender: {
              sendText: async ({ conversationId, text, threadId, accountId }) => {
                const adapter = await api.runtime.channel.outbound.loadAdapter("slack" as never);
                const sendText = adapter?.sendText;
                if (!sendText) throw new Error("No Slack outbound adapter is available.");
                const result = await sendText({ cfg: ctx.config, to: conversationId, text, threadId, accountId });
                return { messageId: result.messageId };
              },
            },
            wakeWorker: async (agentId, prompt, target) => {
              await api.runtime.agent.runEmbeddedAgent({
                sessionId: target?.sessionKey ?? `agent:${agentId}:main`,
                sessionKey: target?.sessionKey ?? `agent:${agentId}:main`,
                runId: randomUUID(),
                agentId,
                workspaceDir: api.runtime.agent.resolveAgentWorkspaceDir(ctx.config, agentId),
                config: ctx.config,
                prompt,
                messageChannel: target?.delivery?.provider,
                messageProvider: target?.delivery?.provider,
                messageTo: target?.delivery?.conversationId,
                messageThreadId: target?.delivery?.threadId,
                currentChannelId: target?.delivery?.conversationId,
                currentThreadTs: target?.delivery?.threadId,
                agentAccountId: target?.delivery?.accountId,
                timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg: ctx.config }),
                trigger: "manual",
              });
            },
            onError: (message, error) => ctx.logger.warn(`${message} ${String(error)}`),
            onInfo: (message) => ctx.logger.info(message),
          });
          delegationHandlers.add(handler);
          void handler.then(() => delegationHandlers.delete(handler), () => delegationHandlers.delete(handler));
          return handler;
        });
        if (generation !== delegationEventGeneration) {
          await dispose();
          return;
        }
        stopDelegationEvents = dispose;
      },
      async stop() {
        delegationEventGeneration += 1;
        await stopDelegationEvents?.();
        stopDelegationEvents = undefined;
        await Promise.allSettled([...delegationHandlers]);
      },
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
          const text = await runLifecycleAction(getLedger(), action, rawParams as LifecycleToolParams, {
            publishTerminalEvent: action === "ship" || action === "block" ? publishTerminalEvent : undefined,
            onTerminalPublishError: (taskId, event, _at, error) => {
              // The state change and outbox are already durable. Do not report
              // a completed lifecycle transition as failed just because the
              // optional low-latency delivery attempt was unavailable.
              api.logger.warn(`FleetMind terminal NATS fast path failed for ${taskId}/${event}: ${String(error)}`);
            },
          });
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
