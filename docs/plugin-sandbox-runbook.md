# OpenClaw delegation-plugin sandbox runbook

Use this runbook for the Wren → Vesper acceptance sandbox only. It is a
precondition for publishing or promoting the plugin beta; it does not authorize
a production deployment.

## Preconditions

- The plugin package has passed `npm ci`, `npm run build`, `npm test`,
  `npm audit --omit=dev`, `npm pack --workspace
  @continuous-agentics/openclaw-fleetmind-delegation --dry-run`, and `git diff
  --check` at the candidate commit.
- Wren and Vesper have separate OpenClaw agent IDs, Slack identities, and least
  privilege access to the same sandbox task table and NATS service.
- The plugin configuration maps Vesper's OpenClaw agent ID to its FleetMind
  worker ID, maps only the designated human reviewer IDs for sign-off/merge,
  and enables `delegationEvents` for Vesper and `terminalEvents` for Wren.
- FleetMind's existing CLI path remains installed and available as rollback.

## Install and four focused smoke checks

1. Install the packed candidate locally in the sandbox; configure the manifest
   ID `fleetmind-delegation`; restart only the sandbox gateway.
2. Confirm the plugin loads and registers the read and lifecycle tools. Verify
   Wren cannot use worker-only transitions and Vesper cannot use sign-off or
   merge.
3. Create one sandbox task through the existing FleetMind path. Confirm Vesper
   receives exactly one Slack receipt/thread and exactly one worker wake, and
   that the authoritative ledger state becomes `accepted`.
4. Ship and then complete human sign-off/merge through the configured authority.
   Confirm Wren receives the terminal Slack receipt/thread and matching wake.
5. Repeat with a deliberately unavailable Slack receipt path. The worker wake
   must still occur using the authoritative delivery context; no Discord call
   may be made.

Record the task IDs, the relevant Slack thread URLs, plugin version/commit,
gateway restart time, and tool/ledger observations in the acceptance record.

## Claim-before-wake recovery test

The worker intentionally claims `delegated → accepted` before creating a
receipt or wake, preventing duplicate NATS deliveries from starting duplicate
work. NATS delivery is not durable, so a wake failure or restart can leave an
accepted task without an active worker session.

Before sign-off, deliberately make one worker wake fail after the claim and
verify this recovery procedure:

1. Inspect the authoritative task record and the gateway error log; do not
   trust the NATS event payload for routing or worker identity.
2. Confirm that no matching Vesper session actually started. If it did, do not
   retry or requeue the task.
3. Record the failure in the task narrative, then use the existing FleetMind
   lifecycle path to block the stranded accepted task with the recovery reason.
4. Create a new replacement task that references the blocked task ID and send
   it through the normal delegation path. Do not mutate the accepted task
   directly and do not replay a stale NATS event.
5. Confirm Wren receives the block terminal wake and the replacement task is
   delivered exactly once.

This is the required manual reconciler until an auditable retry/requeue feature
exists. A failed recovery test blocks beta publication and migration.

## Rollback

If any smoke or end-to-end check fails:

1. Disable and uninstall the plugin from the sandbox only, then restart the
   sandbox gateway.
2. Restore the existing FleetMind CLI delegation path; do not remove its
   task-table or NATS configuration.
3. Reconcile every `accepted` task created during the test using the
   claim-before-wake procedure above. Do not abandon in-flight tasks.
4. Record the plugin version, commit, task IDs, failure symptom, rollback time,
   and final task states. Do not retry the same beta until the failure is fixed
   and the lower-level tests are extended.

## Acceptance decision

The beta is ready for its human-gated release only when all focused checks, the
full create → receipt/thread → ship/block → PM receipt/thread → sign-off/merge
flow, and the claim-before-wake recovery test have documented passing evidence.
