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
