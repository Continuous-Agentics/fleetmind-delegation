# Changelog

All notable changes to this repository are documented here. This monorepo contains two independently versioned npm packages; every entry identifies the affected package.

| Package | Release-tag prefix | Publication status |
| --- | --- | --- |
| `@continuous-agentics/delegation-core` | `delegation-core-v` | Published to npm |
| `@continuous-agentics/openclaw-fleetmind-delegation` | `openclaw-fleetmind-delegation-v` | Release automation ready; not yet published |

This project follows [Semantic Versioning](https://semver.org/). Release notes complement this changelog when a release is published.

## [Unreleased]

### Added

- Contributor, security, support, release, architecture, protocol, and compatibility documentation for the monorepo.
- Release/changelog conventions for both npm packages.

## `@continuous-agentics/openclaw-fleetmind-delegation`

### Unreleased

## [openclaw-fleetmind-delegation-v0.1.0-beta.1] - Unreleased

### Added

- Initial package source and OpenClaw manifest, including native task lifecycle tools, NATS terminal-event handling, and Slack delegation delivery.
- Package-specific draft-release and npm Trusted Publishing workflows for the first sandbox beta.
- Sandbox acceptance and rollback runbook, including the required recovery procedure for a task claimed before a failed worker wake.

## `@continuous-agentics/delegation-core`

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
[delegation-core-v0.1.2]: https://github.com/Continuous-Agentics/fleetmind-delegation/compare/delegation-core-v0.1.1...delegation-core-v0.1.2
[delegation-core-v0.1.1]: https://github.com/Continuous-Agentics/fleetmind-delegation/compare/delegation-core-v0.1.0...delegation-core-v0.1.1
[delegation-core-v0.1.0]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/delegation-core-v0.1.0
[openclaw-fleetmind-delegation-v0.1.0-beta.1]: https://github.com/Continuous-Agentics/fleetmind-delegation/releases/tag/openclaw-fleetmind-delegation-v0.1.0-beta.1
