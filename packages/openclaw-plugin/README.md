# `@continuous-agentics/openclaw-fleetmind-delegation`

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

Terminal and worker-event NATS services are opt-in. When configured, they require an authoritative task-ledger record before routing or waking an agent, post best-effort Slack receipts, and wake the matching OpenClaw thread session. Discord delivery remains out of scope. The plugin does not create tasks or publish/release packages.

## Installation

The plugin is published on npm. Install the current sandbox beta with the explicit `beta` dist-tag:

```bash
openclaw plugins install npm:@continuous-agentics/openclaw-fleetmind-delegation@beta
```

For a reproducible deployment, pin the tested version instead:

```bash
openclaw plugins install npm:@continuous-agentics/openclaw-fleetmind-delegation@0.1.0-beta.5
```

Do not install without a tag or version yet: npm `latest` remains `0.1.0-beta.1`, which predates the OpenClaw-managed AWS dependency compatibility fixes.

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

### Populate configuration before use

Installation only registers the plugin; it does **not** create a task table, discover FleetMind settings, or populate this configuration. Before using any task or event tool, edit the OpenClaw config file that your gateway loads and populate the `plugins.entries.fleetmind-delegation.config` block shown above with your own table, region, worker bindings, and reviewer IDs. Restart the gateway, then confirm it is loaded with:

```bash
openclaw plugins inspect fleetmind-delegation --runtime --json
```

For terminal or worker delivery, also populate the matching `terminalEvents` or `delegationEvents` block below. Leave those blocks absent when only the read/lifecycle tools are required.

#### FleetMind-managed fleets (planned)

FleetMind support for rendering this configuration from `fleet.yaml` is tracked in [Continuous-Agentics/fleetmind#307](https://github.com/Continuous-Agentics/fleetmind/issues/307). Until that work ships, FleetMind users must populate the standard OpenClaw configuration manually, exactly as standalone users do. The plugin deliberately has no runtime dependency on FleetMind files, so it remains usable outside a FleetMind deployment.

### Optional NATS and Slack delivery

`terminalEvents` enables the PM subscriber for `ship` and `block`. `delegationEvents` enables a worker subscriber for one configured OpenClaw agent. Set `workerHomeSlack` to open each delegated task in a fresh worker-home-channel thread; without it, a Slack task falls back to the authoritative planning thread. The worker service atomically acknowledges (claims) the delegated task before posting a receipt or waking the agent, so duplicate NATS deliveries do not start duplicate worker runs. Slack receipt failure never prevents the claimed task's worker wake; a wake failure leaves the claimed task for operational reconciliation.

```json5
{
  terminalEvents: {
    natsServers: ["nats://nats.example:4222"],
    subjectPrefix: "fleetmind",
    pmAgentId: "conductor"
  },
  delegationEvents: {
    natsServers: ["nats://nats.example:4222"],
    subjectPrefix: "fleetmind",
    agentId: "forge-agent",
    workerHomeSlack: { accountId: "default", conversationId: "C0123456789" }
  }
}
```

## Limits

This version does not create tasks, implement Discord delivery, or publish/release packages.
