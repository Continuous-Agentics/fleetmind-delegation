# FleetMind Delegation

Channel-neutral delegation runtime packages for FleetMind and OpenClaw.

Start with the [consumer and onboarding guide](docs/consumer-onboarding.md)
to choose a package, configure access, and verify an installation.

## Packages

- [`@continuous-agentics/delegation-core`](packages/delegation-core): published,
  versioned task, lifecycle, delivery-context, DynamoDB ledger/read, and NATS
  adapters.
- [`@continuous-agentics/openclaw-delegation-plugin`](packages/openclaw-plugin):
  OpenClaw integration with read-only task tools built on `delegation-core`.

## Scope of the initial scaffold

This repository preserves the FleetMind delegation contract without changing behavior:

- DynamoDB task record and lifecycle compatibility;
- NATS v1.0 event envelopes and subjects;
- provider-neutral delivery context;
- legacy task records with Slack correlation fields.

FleetMind remains responsible for provisioning, templates, health, upgrades, recovery, and its optional operator CLI. The plugin will own live OpenClaw tools, terminal handling, and channel delivery.

## Consumer quick start

```bash
npm install @continuous-agentics/delegation-core
```

The package is compatible with the existing FleetMind DynamoDB task table and
NATS v1.0 task-event protocol. It does not provision infrastructure or migrate
records. See the [onboarding guide](docs/consumer-onboarding.md) for Node.js
and OpenClaw setup, least-privilege access, and current plugin limits.

## Development

```bash
npm install
npm run build
npm test
```

The next migration milestone is to publish `delegation-core`, then make FleetMind consume it without changing its Slack behavior. Slack plugin parity precedes a Discord adapter.
