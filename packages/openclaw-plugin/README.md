# `@continuous-agentics/openclaw-delegation-plugin`

An OpenClaw plugin for the FleetMind delegation task ledger.

For full setup, required AWS access, and verification steps, see the repository [consumer and onboarding guide](../../docs/consumer-onboarding.md).

## Current capabilities

- `fleetmind_task_get`: read a task by ID.
- `fleetmind_task_list_active`: list tasks in the delegated, accepted, shipped, signed-off, or blocked states.
- Uses the shared `delegation-core` DynamoDB and NATS adapters, preserving FleetMind record, GSI, and event conventions.

The plugin deliberately does **not** yet register lifecycle-writing tools, automatic terminal handling, or Slack/Discord adapters.

## Configuration

```json5
{
  plugins: {
    entries: {
      "fleetmind-delegation": {
        enabled: true,
        config: {
          tableName: "fleetmind-delegation-tasks",
          awsRegion: "us-west-2" // optional when AWS_REGION is set
        }
      }
    }
  }
}
```

The gateway host needs AWS credentials with read-only access to the configured task table and its `ProjectStatusIndex` and `StatusIndex` GSIs.

## Install from this repository

The plugin's release lifecycle is separate from `delegation-core`. Until it is published, install it from a checkout:

```bash
npm ci
npm run build
openclaw plugins install ./packages/openclaw-plugin
```

Restart the gateway after adding or changing the configuration.

## Limits

This version is deliberately read-only. It does not create or update tasks, handle terminal task events automatically, or implement Slack or Discord delivery.
