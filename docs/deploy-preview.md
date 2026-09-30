# Deploying a complete preview

`scripts/deploy-preview.sh` now stages and builds the complete Vite project **including both waitlist API routes**, instead of copying only static `dist/` files. It finds the project from its own location, so this downloaded workspace does not need Git metadata.

The target is always explicit. Use a dedicated preview project: this script applies `noindex` and publishes to that project's **Production environment**, matching the original dedicated-preview workflow. It is not a command for deploying the main public website.

## Prepare without contacting a hosting account

```sh
sh scripts/deploy-preview.sh --prepare-only my-preview-project review
```

This creates `.preview/my-preview-project/` from an explicit source allowlist: frontend, public assets, API handlers, server implementation, the complete `sql/` migration directory, package files and build configuration. Both `001_waitlist.sql` and `002_email_waitlist.sql` are required source files. It excludes `.data`, all local environment files, credentials, research and Git history. It adds the preview title/noindex settings and returns without running Vercel, reading target configuration or deploying anything.

The project argument accepts only a project name or ID, never a filesystem path. Symlinked source/staging paths are rejected. Stale build output is removed before each preparation; only an existing Vercel project-link metadata file is preserved.

## Deploy after database setup

Prerequisites: Node/npm, Python 3, Vercel CLI installed and authenticated, an intended Vercel project, its server-only `DATABASE_URL` configured in **Production**, and both SQL migrations deliberately applied to that database in order: `sql/001_waitlist.sql`, then `sql/002_email_waitlist.sql`. If the initial migration is already installed, apply `002` before deploying the email signup API. The deployment does not create a database or run migrations.

Current signups submit an `email` address. The form and API trim outer spaces and lowercase the address while preserving dots and plus tags. Existing phone records and their referral codes remain valid; the migration does not merge phone and email identities. See [hosted waitlist setup](production-waitlist.md) for the schema and migration commands.

```sh
sh scripts/deploy-preview.sh my-preview-project review
```

For an explicit Vercel team/scope:

```sh
sh scripts/deploy-preview.sh my-preview-project review my-team
```

The script:

1. Prepares the complete source tree and links its staging directory to the named project/scope.
2. Lists the target's Production environment-variable **metadata** and requires a `DATABASE_URL` entry. It does not display the value. Missing/unreadable configuration stops before a build or deployment.
3. Pulls Vercel's Production build configuration, installs the locked dependencies, and runs `vercel build --prod`.
4. Checks the resulting static index and **both** Node function bundles: `api/waitlist.func` and `api/waitlist/referral.func`, including their runtime configuration and handler files.
5. Only then runs `vercel deploy --prebuilt --prod --yes`, uploading the verified build artifact.

The metadata check uses the documented [`vercel env ls production`](https://vercel.com/docs/cli/env) command. The build/deploy sequence follows Vercel's [prebuilt deployment workflow](https://vercel.com/docs/cli/deploying-from-cli); function checks use the documented [Build Output API primitives](https://vercel.com/docs/build-output-api/primitives).

Vercel's normal pull step can cache build configuration/environment files inside the staging directory. That directory is Git-ignored and created with private permissions; never copy it into `public/` or share it as a source archive. Only the verified `.vercel/output` build is deployed.

## What these checks do and do not prove

The script refuses to publish a frontend-only package or deploy without a target `DATABASE_URL` setting. Merely having that setting does not prove the database is reachable, migrated or permitted to read/write the private table. Confirm those prerequisites and smoke-test the hosted endpoint after deployment, including email signup, case-insensitive duplicate handling, and referral progress. It also does not connect email delivery or verify email ownership; those remain separate services.

No target was linked and no deployment/configuration was accessed during the email update. `sh -n` passes. Prepare-only output was verified at `.preview/email-package-check-20260930/`: both API routes, the email normalizer, PostgreSQL implementation, and both SQL migrations match their source files, with private directory permissions and no `.data`, environment files, or hosting link.

The earlier deployment audit also passed an isolated fixture test with mocked Vercel/npm commands for complete offline staging, exclusion of private files, operation without Git, noindex/title escaping, missing database metadata, missing API source, missing function output, stale-artifact cleanup, explicit target validation and scope forwarding. The final prebuilt command was verified only against that mock; actual provider build behavior must be checked when a target is selected.
