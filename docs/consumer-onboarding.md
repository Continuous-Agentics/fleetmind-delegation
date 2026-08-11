# Consumer and onboarding guide

This guide covers two public packages in this repository.

### `@continuous-agentics/delegation-core`

Use it when a Node.js service needs FleetMind-compatible task ledger, task-reader, or NATS task-event contracts. It is published and ready for consumers.

### `@continuous-agentics/openclaw-delegation-plugin`

Use it when an OpenClaw gateway needs read-only visibility into an existing FleetMind task ledger. Its release lifecycle is separate, and it currently offers read-only tools only.

## Relationship to FleetMind

[`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) is the package for deploying and operating OpenClaw multi-agent fleets. `delegation-core` is the smaller, independently versioned extraction of its delegation protocol. It lets FleetMind and compatible integrations share the same task record, lifecycle, and NATS event contracts without requiring the FleetMind provisioning CLI at runtime.

## Before you start

You need Node.js 20 or newer. A consumer also needs the existing FleetMind DynamoDB task table, including its `ProjectStatusIndex` and `StatusIndex` GSIs. This repository preserves that data protocol; it does not provision AWS, create a table, or migrate existing records.

Keep AWS credentials outside source control. The runtime identity needs only the access required for the capability it uses. A read-only plugin installation needs `dynamodb:GetItem` and `dynamodb:Query` on the table and its indexes.

If you need to provision or operate the fleet rather than consume its delegation protocol, start with [`@continuous-agentics/fleetmind`](https://www.npmjs.com/package/@continuous-agentics/fleetmind) and its [delegation setup guide](https://github.com/Continuous-Agentics/fleetmind/blob/main/docs/integration/delegation.md). That guide covers the task-ledger infrastructure, FleetMind configuration, and lifecycle model this package preserves.

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
        "arn:aws:dynamodb:us-west-2:123456789012:table/fleetmind-delegation-tasks",
        "arn:aws:dynamodb:us-west-2:123456789012:table/fleetmind-delegation-tasks/index/*"
      ]
    }
  ]
}
```

This is sufficient for the plugin's current read-only tools. Do not grant write actions until a future plugin version explicitly supports lifecycle mutations.

## Use `delegation-core` from a Node.js service

Install the published package:

```bash
npm install @continuous-agentics/delegation-core
```

Set `AWS_REGION` (or supply `region` directly), then use the read adapter:

```ts
import { DynamoDbTaskReader } from "@continuous-agentics/delegation-core";

const reader = new DynamoDbTaskReader({
  tableName: "fleetmind-delegation-tasks",
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

## Install the OpenClaw plugin from this checkout

The plugin is intentionally read-only today. From a repository checkout:

```bash
npm ci
npm run build
openclaw plugins install ./packages/openclaw-plugin
```

Configure the installed plugin in OpenClaw's configuration:

```json5
{
  plugins: {
    entries: {
      "fleetmind-delegation": {
        enabled: true,
        config: {
          tableName: "fleetmind-delegation-tasks",
          awsRegion: "us-west-2"
        }
      }
    }
  }
}
```

`awsRegion` is optional when `AWS_REGION` or `AWS_DEFAULT_REGION` is set. Restart the gateway after changing plugin configuration.

The plugin exposes only:

- `fleetmind_task_get` — retrieve one eight-character task ID;
- `fleetmind_task_list_active` — list delegated, accepted, shipped, signed-off, and blocked tasks, optionally scoped to a project.

It does **not** create or mutate tasks, subscribe to terminal events, or send Slack or Discord messages. Those capabilities are planned follow-on work.

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
