# `@continuous-agentics/openclaw-delegation-plugin`

An OpenClaw plugin for the FleetMind delegation task ledger.

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
