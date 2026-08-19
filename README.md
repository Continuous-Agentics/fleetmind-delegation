# FleetMind Delegation

This repository is the source monorepo for the FleetMind delegation protocol and its OpenClaw integration. The root workspace is not itself published; it contains two independently versioned npm packages: the published runtime and the OpenClaw plugin package.

Start with the [consumer and onboarding guide](docs/consumer-onboarding.md) to choose the right component and configure it safely. Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md), and maintainers should use [RELEASING.md](RELEASING.md).

## Components

- [`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) is the fleet operator package. It deploys and manages OpenClaw multi-agent fleets, including delegation infrastructure.
- [`@continuous-agentics/delegation-core`](packages/delegation-core) is the published Node.js runtime package. It contains the versioned task, lifecycle, delivery-context, DynamoDB ledger/read, and NATS adapters that preserve the FleetMind delegation protocol.
- [`@continuous-agentics/openclaw-fleetmind-delegation`](packages/openclaw-plugin) is the separately versioned OpenClaw plugin package in this repository. Its manifest ID is `fleetmind-delegation`; it provides task lifecycle tools and is published as a beta. Until `latest` is promoted from the incompatible `0.1.0-beta.1`, install with the `beta` dist-tag or an exact beta version.

## Scope of the initial scaffold

This repository preserves the FleetMind delegation contract without changing behavior:

- DynamoDB task record and lifecycle compatibility;
- NATS v1.0 event envelopes and subjects;
- provider-neutral delivery context;
- legacy task records with Slack correlation fields.

FleetMind remains responsible for provisioning, templates, health, upgrades, recovery, and its optional operator CLI. The plugin will own live OpenClaw tools, terminal handling, and channel delivery.

## Install published packages

```bash
npm install @continuous-agentics/delegation-core
openclaw plugins install npm:@continuous-agentics/openclaw-fleetmind-delegation@beta
```

The runtime is compatible with an existing FleetMind delegation table and NATS v1.0 task-event protocol. It does not provision infrastructure or migrate records. See the [onboarding guide](docs/consumer-onboarding.md) for Node.js and OpenClaw setup, least-privilege access, and current plugin limits.

## Development

```bash
npm ci
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for test, compatibility, and pull-request expectations.

## Documentation

- [Consumer onboarding](docs/consumer-onboarding.md)
- [Architecture and ownership](docs/architecture.md)
- [Delegation protocol](docs/protocol.md)
- [Compatibility policy](docs/compatibility.md)
- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)

The next migration milestone is to make FleetMind consume `delegation-core` without changing its Slack behavior. Slack plugin parity precedes a Discord adapter.
