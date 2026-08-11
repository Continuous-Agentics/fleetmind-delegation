# Consumer and onboarding guide

This guide separates the FleetMind product, the published delegation runtime, and the OpenClaw plugin package. They work together, but they are installed and operated differently.

## Choose the right component

### `@continuous-agentics/fleetmind`

[`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) is the fleet operator package. Use it to deploy and manage an OpenClaw multi-agent fleet, including the DynamoDB task-ledger infrastructure and the delegation lifecycle. Its [delegation setup guide](https://github.com/Continuous-Agentics/fleetmind/blob/main/docs/integration/delegation.md) is the canonical starting point when you need a new fleet or task table.

### `@continuous-agentics/delegation-core`

`@continuous-agentics/delegation-core` is the published, independently versioned Node.js package in this repository. Use it when a Node.js service needs FleetMind-compatible task ledger, task-reader, or NATS task-event contracts. It does not provision infrastructure or implement a human-facing channel.

### `@continuous-agentics/openclaw-delegation-plugin`

`@continuous-agentics/openclaw-delegation-plugin` is the OpenClaw plugin package in this repository. Its manifest ID is `fleetmind-delegation`, which is why OpenClaw configuration uses that name. It is currently a read-only integration package and is installed from a repository checkout; it is not the root `@continuous-agentics/fleetmind-delegation` monorepo package.

## Before you start

You need Node.js 20 or newer. Both `delegation-core` consumers and the OpenClaw plugin require an existing FleetMind DynamoDB task table with `ProjectStatusIndex` and `StatusIndex` GSIs. This repository preserves that protocol; it does not create a table, provision AWS, or migrate records.

Keep AWS credentials outside source control. The runtime identity needs only the access required for the capability it uses. A read-only plugin installation needs `dynamodb:GetItem` and `dynamodb:Query` on the table and its indexes.

## Use `delegation-core` from a Node.js service

Install the published package:

```bash
npm install @continuous-agentics/delegation-core
```

Set `AWS_REGION` or supply `region` directly, then use the read adapter:

```ts
import { DynamoDbTaskReader } from "@continuous-agentics/delegation-core";

const reader = new DynamoDbTaskReader({
  tableName: "your-fleet-tasks",
  region: process.env.AWS_REGION,
});

const task = await reader.get("deadbeef");
const active = await reader.listByStatus({
  project: "my-project",
  status: "accepted",
  limit: 20,
});
```

`TaskLedger` provides conditional lifecycle writes compatible with FleetMind. Use it only when your service owns the relevant lifecycle transition. Do not bypass it with unguarded DynamoDB writes: its condition expressions protect task state and worker ownership.

`NatsTaskEvents` preserves FleetMind's v1.0 subjects and envelope. Supply a NATS connection configuration plus a `subjectPrefix`; the adapter validates outbound events and reports malformed inbound messages through `onError`.

## Install the OpenClaw plugin package

The OpenClaw plugin package is not published yet. Install it from this repository checkout:

```bash
npm ci
npm run build
openclaw plugins install ./packages/openclaw-plugin
```

The install command registers the package's manifest ID, `fleetmind-delegation`. Configure that plugin ID in OpenClaw's configuration, replacing `your-fleet-tasks` and the region with the values from the FleetMind deployment:

```json5
{
  plugins: {
    entries: {
      "fleetmind-delegation": {
        enabled: true,
        config: {
          tableName: "your-fleet-tasks",
          awsRegion: "us-west-2"
        }
      }
    }
  }
}
```

`awsRegion` is optional when `AWS_REGION` or `AWS_DEFAULT_REGION` is set. Restart the gateway after changing plugin configuration.

The plugin currently exposes only:

- `fleetmind_task_get` — retrieve one eight-character task ID;
- `fleetmind_task_list_active` — list delegated, accepted, shipped, signed-off, and blocked tasks, optionally scoped to a project.

It does not create or mutate tasks, subscribe to terminal events, or send Slack or Discord messages. Those capabilities are planned follow-on work.

## Minimal read-only IAM policy

Use a least-privilege policy for the OpenClaw plugin's runtime identity. Replace the region, account ID, and table name with your own values:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:Query"],
      "Resource": [
        "arn:aws:dynamodb:us-west-2:123456789012:table/your-fleet-tasks",
        "arn:aws:dynamodb:us-west-2:123456789012:table/your-fleet-tasks/index/*"
      ]
    }
  ]
}
```

This is sufficient for the plugin's current read-only tools. Do not grant write actions until a future plugin version explicitly supports lifecycle mutations.

## Verify an installation

1. Confirm the plugin loads with its configured table name and AWS region.
2. Call `fleetmind_task_list_active` with a small limit.
3. Call `fleetmind_task_get` for a known task ID.
4. Verify a least-privilege runtime identity cannot mutate the table.

## Troubleshooting

### `DynamoDB region is not configured`

Set `awsRegion` in the plugin configuration or export `AWS_REGION` / `AWS_DEFAULT_REGION`.

### `AccessDeniedException`

Confirm the runtime identity has `dynamodb:GetItem` on the table and `dynamodb:Query` on both the table and index ARNs.

### List calls fail because an index is missing

The existing delegation table must expose `ProjectStatusIndex` and `StatusIndex`; provision it through FleetMind rather than creating an incompatible table.

### `No FleetMind task found for ...`

Verify the eight-character task ID and that the configured table and region point to the correct fleet. A missing task is a normal read result, not an invitation to create one from the plugin.

### Plugin does not appear after installation

Run `npm run build` before local installation, confirm the package path, then restart the gateway after configuring the plugin.

## Release and upgrade expectations

`delegation-core` uses semantic versions. Keep the dependency pinned to the version your FleetMind-compatible runtime was tested against, then test updates in a non-production environment before widening it. The package retains the current FleetMind task-record, index-key, and NATS v1.0 compatibility contract.

For maintainers, package tags of the form `delegation-core-v<version>` create a draft GitHub Release. Publishing that release triggers npm Trusted Publishing through GitHub Actions and produces npm provenance. The first `0.1.0` publish was the one-time bootstrap required before npm could be configured as a trusted publisher.
