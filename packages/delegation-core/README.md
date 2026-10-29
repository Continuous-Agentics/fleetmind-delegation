# `@continuous-agentics/delegation-core`

Versioned, channel-neutral task and lifecycle runtime shared by FleetMind and the OpenClaw delegation plugin.

## How this relates to FleetMind

[`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) deploys and manages OpenClaw multi-agent fleets. This package extracts its stable delegation contracts into a small, independently versioned runtime, so FleetMind and OpenClaw integrations can share the same DynamoDB task, lifecycle, and NATS event protocol without depending on FleetMind's provisioning CLI.

Use `@continuous-agentics/fleetmind` to operate a fleet. Use `@continuous-agentics/delegation-core` when building a compatible integration that needs the delegation protocol itself.

It owns the FleetMind-compatible DynamoDB ledger, read adapter, NATS v1.0 adapter, and their contracts. It intentionally contains no channel API or OpenClaw runtime implementation.

The package preserves the existing task keys, secondary-index keys, task-record schema, conditional lifecycle writes, and NATS event envelope/subjects so a FleetMind migration can consume it without changing the persisted protocol.

## Install

```bash
npm install @continuous-agentics/delegation-core
```

Node.js 20 or newer is required. The consuming runtime must provide AWS credentials and a region through `AWS_REGION`/`AWS_DEFAULT_REGION` or adapter configuration.

## What it exports

- `DynamoDbTaskReader` for read-only task lookup and status queries against a FleetMind-compatible DynamoDB task table.
- `TaskLedger` for conditional task lifecycle writes. Use it rather than raw unguarded DynamoDB writes when the service owns a lifecycle transition.
- `NatsTaskEvents` for the FleetMind v1.0 task-event envelope and subjects.
- Versioned task, lifecycle, delivery-context, and event contracts.

The core package does not provision DynamoDB, AWS permissions, NATS, or any human-facing channel integration. See the repository [consumer and onboarding guide](../../docs/consumer-onboarding.md) for a working reader example and operational prerequisites.

### Thin task-event transport

`TaskEvents` preserves the existing `publish`, `subscribeForPm`,
`subscribeForWorker`, and `close` methods. `createTaskEvents` selects a concrete
adapter with `provider: "nats" | "sqs"`; NATS is migration compatibility.
`SqsTaskEvents` uses the real `@aws-sdk/client-sqs` 3.709.0 client. AWS commands,
queue URLs, receipts, polling and visibility are confined to the adapter.

```ts
const events = createTaskEvents({
  provider: "sqs",
  region: "us-east-1",
  pmQueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/fleetmind-pm",
  workerQueueUrls: {
    forge: "https://sqs.us-east-1.amazonaws.com/123456789012/fleetmind-forge",
  },
});
```

Routing uses this trusted deployment map, with an own-property lookup for worker
IDs. Message fields cannot supply queue URLs. Each queue has one logical owner;
multiple instances for that owner compete for notifications. This is a work
queue, not a broadcast bus. Use a separate configuration/domain for another PM.

A handler must reject if durable handoff fails. SQS deletes only after handler
resolution, and does not delete malformed, misrouted, failed, timed-out or
visibility-uncertain messages. Defaults: 20-second long polling, batch size 5
(maximum 10), 60-second visibility, renewal every one-third visibility interval,
120-second handler deadline (configurable up to 900 seconds), three SDK attempts
per request, and one-second receive-error backoff. Failed notifications retry
through queue visibility and the configured redrive policy. Each message has its
own bounded handler; peers in a batch proceed independently. A timed-out handler
can still finish its underlying work: the transport cannot cancel business work,
and will never delete its receipt on late completion. Stop aborts long polling,
interrupts the transport's handler wait, stops renewals and returns active
receipts with visibility zero; close also destroys the client. Hosts must retain
the existing durable ledger guards across restart and shutdown.

See the plugin README for the queue/DLQ/IAM requirements and the existing
execution/recovery limits. This adapter does not provide exactly-once execution.
