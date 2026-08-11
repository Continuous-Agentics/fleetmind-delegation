# FleetMind Delegation

This repository is the source monorepo for the FleetMind delegation protocol and its OpenClaw integration. It is not itself an installable OpenClaw plugin or a published runtime package.

Start with the [consumer and onboarding guide](docs/consumer-onboarding.md) to choose the right component and configure it safely.

## Components

- [`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) is the fleet operator package. It deploys and manages OpenClaw multi-agent fleets, including delegation infrastructure.
- [`@continuous-agentics/delegation-core`](packages/delegation-core) is the published Node.js runtime package. It contains the versioned task, lifecycle, delivery-context, DynamoDB ledger/read, and NATS adapters that preserve the FleetMind delegation protocol.
- [`@continuous-agentics/openclaw-delegation-plugin`](packages/openclaw-plugin) is the OpenClaw plugin package in this repository. Its manifest ID is `fleetmind-delegation`; it currently provides read-only task tools and is installed from a repository checkout until its own package publishing lifecycle is enabled.

## Scope of the initial scaffold

This repository preserves the FleetMind delegation contract without changing behavior:

- DynamoDB task record and lifecycle compatibility;
- NATS v1.0 event envelopes and subjects;
- provider-neutral delivery context;
- legacy task records with Slack correlation fields.

FleetMind remains responsible for provisioning, templates, health, upgrades, recovery, and its optional operator CLI. The plugin will own live OpenClaw tools, terminal handling, and channel delivery.

## Install the published runtime

```bash
npm install @continuous-agentics/delegation-core
```

The runtime is compatible with an existing FleetMind delegation table and NATS v1.0 task-event protocol. It does not provision infrastructure or migrate records. See the [onboarding guide](docs/consumer-onboarding.md) for Node.js and OpenClaw setup, least-privilege access, and current plugin limits.

## Development

```bash
npm install
npm run build
npm test
```

The next migration milestone is to make FleetMind consume `delegation-core` without changing its Slack behavior. Slack plugin parity precedes a Discord adapter.
