# Compatibility Policy

`@continuous-agentics/delegation-core` is extracted from FleetMind without changing the established delegation contract. Existing FleetMind tables and NATS consumers are supported within the package's semantic-versioning policy.

## Stable contracts

The following are compatibility-sensitive:

- task record fields, canonical task key, statuses, and lifecycle names;
- DynamoDB `ProjectStatusIndex` and `StatusIndex` key behavior;
- conditional worker and lifecycle protections in `TaskLedger`;
- NATS v1.0 event envelopes and subjects;
- legacy Slack correlation fields and channel-neutral delivery context;
- public TypeScript exports and package entrypoints.

## Change rules

- Additive optional fields may ship in a minor release when legacy readers remain valid.
- Removing or changing a field, index key, subject, envelope meaning, lifecycle behavior, or exported contract requires a major release and an explicit migration guide.
- Preserve legacy event extension fields when validating shared envelopes; rejecting an established extension is a breaking change.
- Add regression tests using compatibility fixtures whenever altering a stable contract.

## OpenClaw compatibility

The plugin declares its minimum compatible OpenClaw plugin API and gateway version in its package metadata. A change to tool names, configuration schema, or authorization policy requires documentation and registration coverage. Human-only actions must never become accessible merely because a tool is registered.

## Scope boundary

FleetMind's operator CLI, Terraform module, template, infrastructure, and channel implementations have their own release and compatibility policies. Coordinate cross-repository changes, but do not duplicate their release versioning here.
