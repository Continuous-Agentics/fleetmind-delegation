# Changelog

All notable changes to this repository are documented here. This monorepo contains two independently versioned npm packages; every entry identifies the affected package.

| Package | Release-tag prefix | Publication status |
| --- | --- | --- |
| `@continuous-agentics/delegation-core` | `delegation-core-v` | Published to npm |
| `@continuous-agentics/openclaw-delegation-plugin` | `openclaw-delegation-plugin-v` | Package source exists; npm publishing workflow is not enabled yet |

This project follows [Semantic Versioning](https://semver.org/). Release notes complement this changelog when a release is published.

## [Unreleased]

### Added

- Contributor, security, support, release, architecture, protocol, and compatibility documentation for the monorepo.
- Release/changelog conventions for both npm packages.

## `@continuous-agentics/openclaw-delegation-plugin`

### Unreleased

- Initial package source and OpenClaw manifest. The package is built and tested in this monorepo, but has not been published to npm.

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
