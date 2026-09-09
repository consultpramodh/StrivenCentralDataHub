# Striven Central Data Hub

Centralized Google Apps Script data hub for reducing duplicate Striven API/report reads across Classic Fireplace operational projects.

## Live Apps Script structure

The deployed Hub is intentionally minimal:

```text
00_Config
10_Central_Hub
90_Tests
appsscript.json
```

`90_Tests` contains only the **current** test. Superseded tests are replaced instead of accumulated.

## Current goals

- Inventory Striven custom reports and direct API dependencies across registered projects.
- Identify duplicate and near-duplicate bulk reads.
- Move reusable read datasets into one central Google Sheet.
- Keep operational writes (`POST`, `PUT`, `PATCH`, `DELETE`) in the owning project.
- Allow targeted direct reads for cache misses or immediate write verification.
- Keep central refreshes disabled until report columns, filters, and freshness requirements are validated.
- Add future projects through `PROJECT_REGISTRY` without creating new Apps Script files.

## Initial registered projects

R1 seeds these eight projects when `PROJECT_REGISTRY` is empty:

1. Assets
2. CF Price Update - Mastersheet - Feb 2026
3. CF Installs
4. ENTERNEWPART
5. Shopify/Striven SYNC
6. Employee Commission Report
7. CF Service - July 2026
8. Traeger Inventory

Additional projects can be added through **Central Hub → Add Project Source** or directly in `PROJECT_REGISTRY`.

## Repository layout

```text
PATCH_SOURCE/
  00_Config.js
  10_Central_Hub.js
  90_Tests.js
  appsscript.json

AUTO_UPDATE_HUB_R1.js
SELF_TEST_HUB_R1.js
RUN_AUTO_UPDATE.cmd
SCRIPT_ID.txt
.gitignore
README.md
```

## Mandatory execution / release gate

Every future code execution or release for this Hub must follow this sequence. The work is **not complete** until every applicable gate passes:

1. Pull the exact live Apps Script source before making changes.
2. Create and retain a PRE backup before any push.
3. Patch the smallest possible existing source set; do not create a new script file for a routine fix.
4. Keep all diagnostics in `90_Tests` only.
5. Before introducing a newer test, remove the superseded test from `90_Tests`; keep only the current test required for the release.
6. Run syntax/static validation before push.
7. Re-pull live source immediately before push and stop if it changed during preparation.
8. Push the verified WORK source.
9. Pull POST source and require full read-back/source verification against WORK.
10. Run the current Apps Script test and require a clear `PASS` before continuing to the next production function or migration step.
11. If the test fails, fix the existing production/test files and repeat the same gate; do not accumulate replacement test files/functions.
12. After the Apps Script test passes, synchronize the verified source to the project GitHub repository.
13. Verify the GitHub repository contains the intended source and no temporary PRE/WORK/POST, mock, credential, or obsolete test artifacts.
14. Only after both the live Apps Script verification and GitHub synchronization are confirmed may the execution be marked complete.

This verification + GitHub synchronization step is mandatory for future releases, not optional housekeeping.

## Safe auto-patch workflow

`RUN_AUTO_UPDATE.cmd` uses the existing clasp login and runs the guarded updater:

1. Run the package self-test and clasp authentication check.
2. Pull live Apps Script source read-only.
3. Fingerprint the target as the Central Hub.
4. Create an immutable PRE backup.
5. Build a minimal WORK source tree.
6. Run JavaScript syntax/static checks.
7. Pull live source again immediately before push and compare the full-source SHA.
8. Push only if the live project has not changed.
9. Pull POST source and require a full SHA match with WORK.
10. Restore PRE and verify rollback if anything becomes uncertain after mutation.

## Run the patch

On Windows with Node.js and an existing clasp login:

```text
RUN_AUTO_UPDATE.cmd
```

Target Apps Script ID is stored in `SCRIPT_ID.txt`.

## Current test

After the updater reports `VERIFIED COMPLETE`, run the one current test from Apps Script:

```javascript
test_HubReadyForInventory()
```

It verifies:

- Hub sheet initialization/repair,
- the project registry,
- read-only Apps Script API access to the first enabled source project.

It **does not call Striven** and **does not modify registered source projects**.

R1 readiness was confirmed on September 9, 2026 with:

- structure: PASS,
- 8 registered projects,
- registry validation: PASS,
- Apps Script API access: PASS,
- first checked project: `Assets`,
- 20 source files visible.

If the current test passes, run:

```javascript
hub_inventoryAllProjects()
hub_inventoryRegisteredSheetTabs()
```

## Security

- Do not commit Striven API keys, OAuth secrets, OpenAI keys, passwords, or Script Properties.
- The source scanner redacts common token/key patterns from snippets written to the audit sheet.
- `.clasp.json` and `.clasprc.json` are ignored.
- Existing Apps Script Script Properties are not removed by source pushes.

## Release

Current release marker: `STRIVEN_CENTRAL_DATA_HUB_R1_20260909`
