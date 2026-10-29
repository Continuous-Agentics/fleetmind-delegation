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

Terminal and worker-event NATS services are opt-in. Both require an authoritative task-ledger record before delivery. Worker events claim the task, post a best-effort receipt, and wake the configured worker session. Terminal events use the durable terminal outbox, route a fixed receipt to the task's persisted delivery context, and retry if that receipt cannot be sent. Terminal transport never invokes a PM agent or makes a review decision. Discord delivery remains out of scope. The plugin does not create tasks or publish/release packages.

## Installation

Install the current stable release with the `latest` dist-tag:

```bash
openclaw plugins install npm:@continuous-agentics/openclaw-fleetmind-delegation@latest
```

For a reproducible deployment, pin the tested version instead:

```bash
openclaw plugins install npm:@continuous-agentics/openclaw-fleetmind-delegation@0.1.0
```

Before `0.1.0` is published, install the locally packed candidate only in the sandbox described by the runbook.

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

`terminalEvents` delivers a fixed PM receipt for `ship` and `block`. It resolves the task's persisted delivery context first, then falls back to a valid legacy Slack permalink only for old records. A task with neither is refused rather than routed to a generic channel or synthesized `agent:<pm>:main` session. A failed terminal receipt leaves its durable outbox record pending for retry. `delegationEvents` enables a worker subscriber for one configured OpenClaw agent. Set `workerHomeSlack` to open each delegated task in a fresh worker-home-channel thread; without it, a Slack task falls back to the authoritative planning thread. The worker service atomically acknowledges (claims) the delegated task before posting a receipt or waking the agent, so duplicate NATS deliveries do not start duplicate worker runs. Slack receipt failure never prevents the claimed task's worker wake; a wake failure leaves the claimed task for operational reconciliation.

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

### Opt-in SQS transport (local candidate; cutover pending)

Omitting `taskEventTransport` retains the existing NATS configuration and default
behavior. One explicit selection switches the plugin's worker subscriber, PM
terminal subscriber, terminal fast-path publisher and existing outbox relay:

```json
{
  "tableName": "fleetmind-tasks",
  "awsRegion": "us-east-1",
  "workerAgentIds": { "forge-agent": "forge" },
  "taskEventTransport": {
    "provider": "sqs",
    "pmQueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/fleetmind-pm",
    "workerQueueUrls": {
      "forge": "https://sqs.us-east-1.amazonaws.com/123456789012/fleetmind-forge"
    }
  },
  "delegationEvents": { "agentId": "forge-agent" },
  "terminalEvents": { "pmAgentId": "pm" }
}
```

In deployment, enable `delegationEvents` on the owning worker and
`terminalEvents` on the owning PM. The combined example shows both identities;
services continue to use the existing receiving handlers. Queue routing comes
only from trusted configuration. No message-supplied URL is used. Queue URLs and
AWS receipt handles are never passed to the receiving handler. NATS transport
fields are required by runtime config validation when SQS is not selected.

The SQS adapter and plugin consumers/terminal producer are wired locally. The
initial delegation producer is outside this repository and still needs to select
`createTaskEvents({ provider: "sqs", ... })` after its existing durable task write.
There is no new dispatch outbox in this slice: a crash between that existing task
write and initial notification remains a producer/reconciliation limitation.
Infrastructure, producer cutover, live configuration, and runtime qualification
are pending. No resources or deployment changes are included here.

For later F configuration, provision and verify these exact requirements:

- One **Standard** source queue for the PM and one distinct **Standard** source
  queue per configured worker. Do not reuse a queue across logical owners.
  Set `ReceiveMessageWaitTimeSeconds=20`, `VisibilityTimeout=60`,
  `MessageRetentionPeriod=345600`, `MaximumMessageSize=262144`, and
  `SqsManagedSseEnabled=true`. Adapter per-request settings default to the same
  wait/visibility values. Tune handler deadline/visibility only with the existing
  handler and ledger lease duration in mind.
- Give each source queue its own Standard DLQ in the same account/region, with
  `MessageRetentionPeriod=1209600` and `SqsManagedSseEnabled=true`. Set the source
  `RedrivePolicy` to its DLQ ARN with `maxReceiveCount=5`. Set the DLQ
  `RedriveAllowPolicy` to `redrivePermission=byQueue` and `sourceQueueArns` to that
  source queue's ARN. Configure alarms/owner handling for DLQ depth and oldest
  source message. The adapter intentionally neither consumes nor auto-redrives
  the DLQ. Malformed and failed messages must remain eligible for redrive.
- Allow producer roles `sqs:SendMessage` on only their configured destination
  queue ARNs. A worker needs terminal-send permission on its PM queue; the PM
  outbox relay also needs send permission on its PM queue. The external dispatch
  producer needs send permission on the selected worker queues.
- Allow each consumer role `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and
  `sqs:ChangeMessageVisibility` on only its own source queue ARN. No app-role
  queue creation, queue listing, DLQ redrive, or arbitrary queue access is
  required. Preserve the existing DynamoDB task/outbox and GSI permissions;
  no new table/index is required. Queue policies must permit only the intended
  principals and require TLS (`aws:SecureTransport`). If F configuration chooses
  customer-managed KMS encryption instead of SSE-SQS, add the appropriate key
  policy and `kms:Decrypt` for consumers and `kms:Decrypt`/`kms:GenerateDataKey`
  for producers.
- The deployment/operator role verifies queue attributes and redrive settings
  before cutover; the app does not call `GetQueueAttributes` or create queues.
  Configure region, account credentials and these fixed URLs through the
  deployment's existing trusted configuration mechanism.

At-least-once delivery does not guarantee exactly-once business execution. Worker
handling uses the existing conditional `delegated -> accepted` transition before
any receipt or agent invocation. Read/claim failures now reject so SQS can retry;
a second invocation is suppressed by accepted/later state. A failed or uncertain
agent invocation leaves the task accepted, logs that it needs reconciliation,
and rejects the current notification. Redelivery checks that durable state and
never blindly invokes it again. A process crash after claim but before invocation
has the same accepted-task limitation. Use the existing task inspection and
explicit owner reconciliation; there is no automatic execution recovery here.
Only that task needs reconciliation; other messages continue. Stop/timeout does
not prove that an agent action was cancelled.

Terminal handling retains the transactional outbox, conditional claim/lease,
release on handler failure, and durable completion marker. SQS receipt deletion
requires that marker (or an already-delivered duplicate), rather than chat receipt
or publication alone. Busy claims, missing outbox IDs/records, failed handlers,
and lost/completion-write-failed leases remain retryable. The existing terminal
handler sends a channel receipt; it does **not** schedule a durable PM agent run.
Completion records that existing notification handoff, not PM execution or human
review completion. A crash after the channel send but before durable completion
can duplicate a receipt. Existing conditional ledger transitions remain the guard
for business actions and human sign-off. The outbox relay may publish duplicates;
a successful publish does not settle its outbox. Existing claim lease expiry and
relay reconciliation are retained without a new orchestration/custody subsystem.
Legacy terminal events without an outbox remain supported through NATS only.
