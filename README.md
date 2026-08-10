# FleetMind Delegation

Channel-neutral delegation runtime packages for FleetMind and OpenClaw.

## Packages

- [`@continuous-agentics/delegation-core`](packages/delegation-core): versioned task, lifecycle, delivery-context, and NATS contracts.
- [`@continuous-agentics/openclaw-delegation-plugin`](packages/openclaw-plugin): OpenClaw integration boundary; runtime tools and adapters will follow in later slices.

## Scope of the initial scaffold

This repository begins by preserving the FleetMind delegation contract without changing behavior:

- DynamoDB task record and lifecycle compatibility;
- NATS v1.0 event envelopes and subjects;
- provider-neutral delivery context;
- legacy task records with Slack correlation fields.

FleetMind remains responsible for provisioning, templates, health, upgrades, recovery, and its optional operator CLI. The future plugin will own live delegation tools, DDB/NATS adapters, terminal handling, and channel delivery.

## Development

```bash
npm install
npm run build
npm test
```

The first implementation milestone is to publish `delegation-core`, then make FleetMind consume it without changing its Slack behavior. Slack plugin parity precedes a Discord adapter.
