# Changelog

All notable changes to this repository are documented here. This monorepo contains two independently versioned npm packages; every entry identifies the affected package.

| Package | Release-tag prefix | Publication status |
| --- | --- | --- |
| `@continuous-agentics/delegation-core` | `delegation-core-v` | Published to npm |
| `@continuous-agentics/openclaw-fleetmind-delegation` | `openclaw-fleetmind-delegation-v` | Published to npm as beta; use the `beta` dist-tag or pin an exact version until `latest` is promoted |

This project follows [Semantic Versioning](https://semver.org/). Release notes complement this changelog when a release is published.

## [Unreleased]

### Added

- Contributor, security, support, release, architecture, protocol, and compatibility documentation for the monorepo.
- Release/changelog conventions for both npm packages.

## `@continuous-agentics/openclaw-fleetmind-delegation`

### Unreleased

## [openclaw-fleetmind-delegation-v0.1.0-beta.6] - Unreleased

### Fixed

- Declare the exact OpenClaw-managed AWS SDK peer set so the plugin install root resolves a compatible DynamoDB runtime.
- Persist terminal `ship`/`block` notifications in a durable DynamoDB outbox and reconcile them through NATS, preventing a worker-side crash from silently losing the PM wake.
- Use a per-transition UUID for outbox identity, so repeated terminal events in the same clock second cannot collide.

## [openclaw-fleetmind-delegation-v0.1.0-beta.4] - Unreleased

### Fixed

- Use the OpenClaw-compatible AWS SDK dependency set through `@continuous-agentics/delegation-core@0.1.3`.

## [openclaw-fleetmind-delegation-v0.1.0-beta.3] - Unreleased

### Fixed

- Pin the compatible Smithy runtime dependency so the plugin loads under the supported OpenClaw runtime.
- Include package repository metadata required for npm provenance verification.

## [openclaw-fleetmind-delegation-v0.1.0-beta.1] - Unreleased

### Added

- Initial package source and OpenClaw manifest, including native task lifecycle tools, NATS terminal-event handling, and Slack delegation delivery.
- Package-specific draft-release and npm Trusted Publishing workflows for the first sandbox beta.
- Sandbox acceptance and rollback runbook, including the required recovery procedure for a task claimed before a failed worker wake.

## `@continuous-agentics/delegation-core`

## [delegation-core-v0.1.4] - Unreleased

### Fixed

- Add durable terminal-event outbox records and lifecycle transition support required by the delegation plugin's terminal delivery path.

## [delegation-core-v0.1.3] - Unreleased

### Fixed

- Pin a compatible AWS SDK, DynamoDB codec, and Smithy dependency set for OpenClaw-managed plugin installs.

## [delegation-core-v0.1.2] - 2026-08-11

### Added

- Published `@continuous-agentics/delegation-core@0.1.2` as the versioned task-ledger, DynamoDB reader, and NATS event compatibility runtime.
- Repository metadata required for consumers and npm release provenance.

## [delegation-core-v0.1.1] - 2026-08-11

### Fixed

- Corrected npm Trusted Publishing configuration for the Continuous-Agentics GitHub organization.

## [delegation-core-v0.1.0] - 2026-08-11

### Added

- Initial published `@continuous-agentics/delegation-core` package.
- FleetMind-compatible task contracts, lifecycle transitions, DynamoDB access adapters, and NATS v1.0 task events.
- Channel-neutral delivery context with support for legacy Slack correlation fields.

[Unreleased]: https://github.com/Continuous-Agentics/fleetmind-delegation/compare/delegation-core-v0.1.2...HEAD
[delegation-core-v0.1.3]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/delegation-core-v0.1.3
[delegation-core-v0.1.2]: https://github.com/Continuous-Agentics/fleetmind-delegation/compare/delegation-core-v0.1.1...delegation-core-v0.1.2
[delegation-core-v0.1.1]: https://github.com/Continuous-Agentics/fleetmind-delegation/compare/delegation-core-v0.1.0...delegation-core-v0.1.1
[delegation-core-v0.1.0]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/delegation-core-v0.1.0
[openclaw-fleetmind-delegation-v0.1.0-beta.5]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/openclaw-fleetmind-delegation-v0.1.0-beta.5
[openclaw-fleetmind-delegation-v0.1.0-beta.4]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/openclaw-fleetmind-delegation-v0.1.0-beta.4
[openclaw-fleetmind-delegation-v0.1.0-beta.3]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/openclaw-fleetmind-delegation-v0.1.0-beta.3
[openclaw-fleetmind-delegation-v0.1.0-beta.1]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/openclaw-fleetmind-delegation-v0.1.0-beta.1
