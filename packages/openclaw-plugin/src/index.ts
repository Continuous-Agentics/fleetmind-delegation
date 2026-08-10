import type { TaskEvent } from "@continuous-agentics/delegation-core";

/**
 * Marker export for the OpenClaw integration package.
 *
 * Runtime tool registration, DDB/NATS adapters, and Slack parity land in later
 * slices. This package pins the core contract explicitly from day one.
 */
export const pluginPackageName = "@continuous-agentics/openclaw-delegation-plugin";

export type DelegationPluginEvent = TaskEvent;
