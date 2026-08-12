# Delegation Protocol

This document describes the runtime contract implemented by `@continuous-agentics/delegation-core`. It does not describe FleetMind infrastructure provisioning or task-narrative storage.

## Task lifecycle

Tasks use these statuses:

```text
delegated → accepted → shipped → signed_off → merged
                     ↘ blocked
```

The runtime exposes lifecycle actions `ack`, `ship`, `block`, `signoff`, and `merge`. `ack`, `ship`, and `block` are worker-owned; the supplied worker must match the task's assigned worker. `signoff` and `merge` are human-authority transitions and must be protected by the calling integration.

Use `TaskLedger` for transitions. Its DynamoDB condition expressions ensure state/index changes are atomic and reject conflicting writes. Never reproduce a transition with unguarded `UpdateItem` calls.

## DynamoDB access

`DynamoDbTaskReader` reads a task by its canonical `TASK#{taskId}` primary key and queries active tasks through the preserved project/status and global status indexes. The index keys are part of the compatibility contract. Readers validate records at the storage boundary instead of returning malformed records to callers.

The required existing FleetMind table indexes are:

- `ProjectStatusIndex` for a project's tasks in a status;
- `StatusIndex` for global status queries.

## NATS task events

`NatsTaskEvents` preserves FleetMind v1.0 event envelopes and subjects. Event types are `delegation`, `ack`, `progress`, `ship`, and `block`. Validate envelopes at the transport boundary; consumers must retain extension fields required by legacy integrations.

Notifications complement, rather than replace, durable state. A subscriber should treat NATS delivery as a wake signal and read the task record before performing a transition or delivery action.

## Delivery context

`DeliveryContext` represents provider-neutral routing metadata. Legacy Slack fields remain supported for compatibility. Do not make a channel-specific field canonical when adding a delivery adapter.

## OpenClaw plugin authorization

The plugin's configuration maps OpenClaw worker agent IDs to FleetMind worker IDs via `workerAgentIds`. A caller may acknowledge, ship, or block only for its mapped worker. `reviewerAgentIds` explicitly allowlists callers for sign-off and merge. Both are authorization boundaries, not presentation controls.

Configuration and installation examples are in [consumer-onboarding.md](consumer-onboarding.md).
