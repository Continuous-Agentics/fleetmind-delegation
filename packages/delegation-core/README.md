# `@continuous-agentics/delegation-core`

Versioned, channel-neutral task and lifecycle runtime shared by FleetMind and
the OpenClaw delegation plugin.

It owns the FleetMind-compatible DynamoDB ledger, read adapter, NATS v1.0
adapter, and their contracts. It intentionally contains no channel API or
OpenClaw runtime implementation.

The package preserves the existing task keys, secondary-index keys, task-record
schema, conditional lifecycle writes, and NATS event envelope/subjects so a
FleetMind migration can consume it without changing the persisted protocol.
