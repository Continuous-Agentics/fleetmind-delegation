# Releasing

Only maintainers release packages from this repository. It contains two independently versioned npm packages, so every release must name exactly one target package. Package versions are immutable on npm: validate the package, package version, tag, and Trusted Publisher identity before publishing.

## Package release matrix

| Package | Workspace | Tag format | npm status | Automation |
| --- | --- | --- | --- | --- |
| `@continuous-agentics/delegation-core` | `packages/delegation-core` | `delegation-core-vVERSION` | Published | Draft-release and Trusted Publishing workflows enabled |
| `@continuous-agentics/openclaw-delegation-plugin` | `packages/openclaw-plugin` | `openclaw-delegation-plugin-vVERSION` | Not published | Draft-release and Trusted Publishing workflows enabled |

A package release changes only that package's version and its package-scoped `CHANGELOG.md` section. If one change requires both packages to release, prepare and verify them independently, with separate version bumps, tags, releases, and npm publication checks.

## Current release surface

Both packages have isolated, package-specific release workflows. The OpenClaw plugin is not yet published; do not tag or publish it until npm Trusted Publishing is configured for the plugin workflow and its sandbox acceptance evidence is recorded.

## Prepare a delegation-core release

1. Start from current `main` with a clean checkout.
2. Update only `packages/delegation-core/package.json` using the intended SemVer version. Do not change `packages/openclaw-plugin/package.json` unless preparing a separate plugin release.
3. Add the entry beneath the `@continuous-agentics/delegation-core` heading in `CHANGELOG.md`.
4. Run the full repository verification:

   ```bash
   npm ci
   npm run build
   npm test
   git diff --check
   npm pack --workspace @continuous-agentics/delegation-core --dry-run
   ```

5. Open and merge the version/changelog pull request.
6. Confirm the selected commit is on `main` and the version has not already been published:

   ```bash
   npm view @continuous-agentics/delegation-core@VERSION version
   ```

   An existing result means that version is unavailable; choose a new version and repeat the release PR.

## Create the release gate

Tag the merged release commit with the package-specific format and push the tag:

```bash
git checkout main
git pull --ff-only
git tag delegation-core-vVERSION
git push origin delegation-core-vVERSION
```

The `Release delegation-core` workflow creates a **draft** GitHub Release. Confirm the draft points to the intended tag and that its generated notes match `CHANGELOG.md`.

Publishing that GitHub Release is the deliberate human gate for npm publication. The `Publish delegation-core to npm` workflow then:

- checks out the release tag;
- verifies that the tag version and package version match;
- builds and tests all workspaces;
- smoke-tests the packed tarball;
- publishes through npm Trusted Publishing.

Use the workflow's manual dispatch only to retry an existing `delegation-core-v*` tag. Never retag a different commit or reuse a published version.

## Verify and announce

After the workflow succeeds:

```bash
npm view @continuous-agentics/delegation-core dist-tags version
npm install @continuous-agentics/delegation-core@VERSION
```

Verify the npm `latest` tag and the GitHub Release, then announce the package name, version, and compatibility impact. If publication fails after a tag exists, investigate and retry the workflow for that immutable tag only when the cause is safe to retry; otherwise cut a new version.

## Prepare an OpenClaw plugin release

1. Complete the sandbox acceptance and rollback record in [the plugin sandbox runbook](docs/plugin-sandbox-runbook.md). Do not use a production fleet for the beta.
2. Update only `packages/openclaw-plugin/package.json` and its package-scoped `CHANGELOG.md` entry. Use a prerelease version for the first sandbox release.
3. Run the full repository verification plus the plugin package check:

   ```bash
   npm ci
   npm run build
   npm test
   git diff --check
   npm pack --workspace @continuous-agentics/openclaw-delegation-plugin --dry-run
   ```

4. Configure npm Trusted Publishing for `@continuous-agentics/openclaw-delegation-plugin`, this repository, and the `Publish OpenClaw delegation plugin to npm` workflow. Verify the configuration before a tag is pushed.
5. Merge the release PR. Confirm the target version is still unpublished:

   ```bash
   npm view @continuous-agentics/openclaw-delegation-plugin@VERSION version
   ```

6. Tag the merged commit as `openclaw-delegation-plugin-vVERSION` and push it. The package-specific release workflow creates a draft GitHub Release. Grace publishes that draft as the human gate; the publish workflow verifies tag/version parity, builds, tests, smoke-tests the tarball, and publishes a prerelease under npm's `beta` tag.

Never reuse a published npm version or retag a different commit. If a publish workflow fails after the tag exists, correct the safe-to-retry cause and dispatch it for that same immutable tag; otherwise prepare a new version.
