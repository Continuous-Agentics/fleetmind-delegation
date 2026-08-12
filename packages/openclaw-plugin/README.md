# `@continuous-agentics/openclaw-delegation-plugin`

This is the OpenClaw plugin package in the FleetMind Delegation monorepo. It is distinct from both the root monorepo package and [`@continuous-agentics/delegation-core`](../delegation-core): the core package is the published Node.js delegation runtime, while this package provides the OpenClaw integration layer.

Its OpenClaw manifest ID is `fleetmind-delegation`. That ID is used for installation and configuration; it is not the npm package name.

For component selection, required AWS access, and verification steps, see the repository [consumer and onboarding guide](../../docs/consumer-onboarding.md).

## Current capabilities

- `fleetmind_task_get`: read a task by ID.
- `fleetmind_task_list_active`: list tasks in the delegated, accepted, shipped, signed-off, or blocked states.
- `fleetmind_task_ack`: acknowledge a delegated task as its assigned worker.
- `fleetmind_task_ship`: mark an accepted task as shipped as its assigned worker.
- `fleetmind_task_block`: mark a delegated or accepted task as blocked as its assigned worker.
- `fleetmind_task_signoff`: sign off a shipped task that requires human sign-off.
- `fleetmind_task_merge`: mark an eligible shipped or signed-off task as merged.
- Uses the shared `delegation-core` DynamoDB and NATS adapters, preserving FleetMind record, GSI, and event conventions.

Lifecycle transitions use `TaskLedger` conditional writes, so the task state machine and assigned-worker restrictions are enforced in DynamoDB. Worker transitions require `taskId` and `worker`, and a `before_tool_call` gate permits them only when the calling OpenClaw agent maps to that worker in `workerAgentIds`; human transitions require `taskId`. Tool calls intentionally do not accept a caller-supplied `project` for lifecycle transitions; the ledger resolves the stored project before rewriting status indexes.

`fleetmind_task_signoff` and `fleetmind_task_merge` are human-authority transitions. They are optional tools in the manifest and fail closed in a `before_tool_call` hook unless the calling OpenClaw agent ID appears in configured `reviewerAgentIds`.

The plugin deliberately does not handle terminal NATS events automatically, provide Slack/Discord adapters, create tasks, or publish/release packages.

## Install from this repository

This package is not published yet. Install it from a checkout:

```bash
npm ci
npm run build
openclaw plugins install ./packages/openclaw-plugin
```

The command registers the plugin manifest ID, `fleetmind-delegation`.

## Configuration

Configure that manifest ID in OpenClaw, replacing the placeholders with the task table and region from the FleetMind deployment:

```json5
{
  plugins: {
    entries: {
      "fleetmind-delegation": {
        enabled: true,
        config: {
          tableName: "your-fleet-tasks",
          awsRegion: "us-west-2"
        }
      }
    }
  }
}
```

`awsRegion` is optional when `AWS_REGION` or `AWS_DEFAULT_REGION` is set. Configure `workerAgentIds` to bind each worker agent to its FleetMind worker ID. Configure `reviewerAgentIds` with only the designated human-reviewer agent IDs before allowlisting sign-off or merge. The gateway host needs DynamoDB read/write access to the configured task table and its `ProjectStatusIndex` and `StatusIndex` GSIs. Restart the gateway after adding or changing the configuration.

## Limits

This version does not create tasks, handle terminal task events automatically, or implement Slack or Discord delivery.
