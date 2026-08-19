# Architecture

FleetMind Delegation separates a stable delegation protocol from the systems that provision a fleet or deliver human-facing messages.

## Ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| `@continuous-agentics/delegation-core` | Versioned task contracts, DynamoDB readers/lifecycle writer, NATS task-event transport | AWS provisioning, channel delivery, OpenClaw tool registration |
| `@continuous-agentics/openclaw-fleetmind-delegation` | OpenClaw-facing task tools and plugin configuration | Fleet provisioning and arbitrary direct DynamoDB writes |
| [FleetMind](https://github.com/Continuous-Agentics/fleetmind) | Fleet configuration, infrastructure, templates, operator workflows, and legacy channel behavior | Publishing this protocol package |

## Durable state and notifications

The DynamoDB task record is the source of truth. A lifecycle transition is a conditional update: it verifies the current task state and, for worker-owned transitions, the assigned worker before changing status and indexes. This prevents a stale actor from overwriting a later transition.

NATS task events are notifications and wake signals, not the authority for task state. Consumers must tolerate a notification that arrives after the durable record changed and should re-read the task before taking action.

## Delivery compatibility

Task records support channel-neutral delivery context while retaining legacy Slack correlation fields. This permits migration without breaking existing FleetMind consumers. A change to this shape is a protocol compatibility change and needs fixtures and release notes.

## Security boundaries

Tool input is untrusted. Worker lifecycle actions must bind the trusted OpenClaw caller identity to a configured worker identity; human sign-off and merge actions must be restricted to explicitly configured reviewer identities. The protocol writer provides state and worker conditions but cannot replace plugin-level caller authorization.

See [protocol.md](protocol.md) for the implemented contract and [compatibility.md](compatibility.md) for change rules.
