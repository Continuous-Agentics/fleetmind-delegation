# Releasing

Only maintainers release packages from this repository. Package versions are immutable on npm: validate the tag, package version, and Trusted Publisher identity before publishing.

## Current release surface

`@continuous-agentics/delegation-core` is the only package with a release workflow today. The OpenClaw plugin package is built and tested here but does **not** yet have a publishing workflow; do not tag or publish it as part of this process.

## Prepare a delegation-core release

1. Start from current `main` with a clean checkout.
2. Update `packages/delegation-core/package.json` using the intended SemVer version.
3. Add a package-scoped entry to `CHANGELOG.md`.
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

Verify the npm `latest` tag and the GitHub Release, then announce the version with its compatibility impact. If publication fails after a tag exists, investigate and retry the workflow for that immutable tag only when the cause is safe to retry; otherwise cut a new version.
