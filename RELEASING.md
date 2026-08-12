# Releasing

Only maintainers release packages from this repository. It contains two independently versioned npm packages, so every release must name exactly one target package. Package versions are immutable on npm: validate the package, package version, tag, and Trusted Publisher identity before publishing.

## Package release matrix

| Package | Workspace | Tag format | npm status | Automation |
| --- | --- | --- | --- | --- |
| `@continuous-agentics/delegation-core` | `packages/delegation-core` | `delegation-core-vVERSION` | Published | Draft-release and Trusted Publishing workflows enabled |
| `@continuous-agentics/openclaw-delegation-plugin` | `packages/openclaw-plugin` | Reserved: `openclaw-delegation-plugin-vVERSION` | Not published | No release or npm publishing workflow yet |

A package release changes only that package's version and its package-scoped `CHANGELOG.md` section. If one change requires both packages to release, prepare and verify them independently, with separate version bumps, tags, releases, and npm publication checks.

## Current release surface

`@continuous-agentics/delegation-core` is the only package with a release workflow today. The OpenClaw plugin is a second npm package with its own version and package metadata; it is built and tested here but does **not** yet have a publishing workflow. Do not tag or publish the plugin until its release workflow, package smoke test, Trusted Publisher configuration, and documentation are explicitly added.

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

## Enabling plugin releases later

Before publishing `@continuous-agentics/openclaw-delegation-plugin`, add package-specific draft-release and npm Trusted Publishing workflows; validate a packed plugin against the declared compatible OpenClaw runtime; configure npm Trusted Publisher identity for that workflow; and replace its `Unreleased` changelog note with tagged package release entries. Until then, consumers install the plugin from a repository checkout as documented in the plugin README.
