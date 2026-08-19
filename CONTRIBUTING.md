# Contributing to FleetMind Delegation

Thank you for contributing to the versioned delegation contracts and OpenClaw integration shared with FleetMind.

## Development setup

**Prerequisites:** Node.js 20 or newer and npm. The CI and release workflows use Node.js 22.

External contributors should fork first:

```bash
gh repo fork Continuous-Agentics/fleetmind-delegation --clone
cd fleetmind-delegation
npm ci
npm run build
npm test
```

Maintainers may clone the upstream repository directly.

This is an npm-workspace monorepo with two independently versioned packages:

- `packages/delegation-core` → `@continuous-agentics/delegation-core`, the published compatibility runtime.
- `packages/openclaw-plugin` → `@continuous-agentics/openclaw-fleetmind-delegation`, the OpenClaw integration boundary. Its package source is versioned and tested here; npm publishing is not enabled yet.

## Tests and compatibility

Run these checks before opening a pull request:

```bash
npm run build
npm test
git diff --check
```

Use deterministic unit tests. Mock DynamoDB, NATS, and OpenClaw boundaries; never call live AWS, NATS, npm, or GitHub services from tests.

`delegation-core` is a compatibility boundary with existing FleetMind task tables and NATS task-event consumers. Changes to task records, status/index keys, lifecycle transitions, event envelopes, subjects, delivery context, or S3 key rendering require regression coverage and a compatibility note in the PR. Do not bypass `TaskLedger` with direct DynamoDB lifecycle writes.

For OpenClaw plugin changes, test registration and authorization as well as tool behavior. Human-only transitions must remain guarded by trusted caller identity, never model-supplied tool arguments.

## Branches, commits, and pull requests

Branch from current `main` and use a focused Conventional Commit-style title:

```text
feat | fix | docs | test | refactor | chore
```

A pull request should:

- explain the behavioral and compatibility impact;
- link its issue when applicable (`Closes #123` or `Refs #123`);
- include the commands and results used for verification;
- update documentation and the package-scoped section of `CHANGELOG.md` for public behavior, packaging, protocol, configuration, or release-process changes;
- have green CI and maintainer approval before merge.

Keep unrelated refactors out of protocol or security fixes. Never commit credentials, AWS account details, NATS URLs containing credentials, task contents containing sensitive information, or package tokens.

## Issues and security reports

| Topic | Where to file it |
| --- | --- |
| Defect | GitHub bug report |
| Feature or protocol change | GitHub feature request |
| Documentation gap | GitHub documentation issue or PR |
| Vulnerability or secret exposure | Private report; see [SECURITY.md](SECURITY.md) |
| Fleet provisioning/operator behavior | The [FleetMind repository](https://github.com/Continuous-Agentics/fleetmind) |

## Releases

Releases are maintainer-only. Each package has an independent version and package-scoped changelog section. `delegation-core` uses tags such as `delegation-core-v0.1.3`; the plugin uses `openclaw-fleetmind-delegation-v0.1.0-beta.1`. A package-specific tag creates a draft GitHub Release, and publication of that release is the deliberate npm Trusted Publishing gate. Read [RELEASING.md](RELEASING.md) before preparing either package for release.
