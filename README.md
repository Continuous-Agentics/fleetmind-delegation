# FleetMind Delegation

Channel-neutral delegation runtime packages for FleetMind and OpenClaw.

## Packages

- [`@continuous-agentics/delegation-core`](packages/delegation-core): versioned task, lifecycle, delivery-context, DynamoDB ledger/read, and NATS adapters.
- [`@continuous-agentics/openclaw-delegation-plugin`](packages/openclaw-plugin): OpenClaw integration with read-only task tools built on `delegation-core`.

## Scope of the initial scaffold

This repository preserves the FleetMind delegation contract without changing behavior:

- DynamoDB task record and lifecycle compatibility;
- NATS v1.0 event envelopes and subjects;
- provider-neutral delivery context;
- legacy task records with Slack correlation fields.

FleetMind remains responsible for provisioning, templates, health, upgrades, recovery, and its optional operator CLI. The plugin will own live OpenClaw tools, terminal handling, and channel delivery.

## Development

```bash
npm install
npm run build
npm test
```

The next migration milestone is to publish `delegation-core`, then make FleetMind consume it without changing its Slack behavior. Slack plugin parity precedes a Discord adapter.
