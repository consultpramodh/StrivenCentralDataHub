# Striven Central Data Hub

Centralized Google Apps Script data hub for reducing duplicate Striven API/report reads across Classic Fireplace operational projects.

## R1 structure

The live Apps Script project is intentionally minimal:

```text
00_Config
10_Central_Hub
90_Tests
appsscript.json
```

`90_Tests` contains only the **current** test. Superseded tests are replaced instead of accumulated.

## Current goals

- Inventory every Striven custom report and direct API dependency across registered projects.
- Identify duplicate and near-duplicate bulk reads.
- Move reusable read datasets into one central Google Sheet.
- Keep operational writes (`POST`, `PUT`, `PATCH`, `DELETE`) in the owning project.
- Allow targeted direct reads only for cache misses or immediate write verification.
- Keep central refreshes disabled until report columns, filters, and freshness requirements are validated.
- Add future source projects through `PROJECT_REGISTRY` without creating new Apps Script modules.

## Initial registered projects

R1 seeds eight source projects when `PROJECT_REGISTRY` is empty:

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
src/
  00_Config.js
  10_Central_Hub.js
  90_Tests.js
  appsscript.json

tools/
  AUTO_UPDATE_HUB_R1.js
  SELF_TEST_HUB_R1.js

RUN_AUTO_UPDATE.cmd
SCRIPT_ID.txt
SHA256_MANIFEST.txt
```

## Safe auto-patch workflow

`RUN_AUTO_UPDATE.cmd` uses the project's existing clasp authentication and runs the guarded updater:

1. Package self-test and clasp authentication check.
2. Pull live Apps Script source read-only.
3. Fingerprint the target as the Central Hub.
4. Create an immutable PRE backup.
5. Build a minimal WORK source tree.
6. Run JS syntax and static checks.
7. Pull live source again immediately before push and compare full-source SHA.
8. Push only when the live project is unchanged.
9. Pull POST source and require a full SHA match with WORK.
10. Automatically restore PRE and verify rollback if anything becomes uncertain after mutation.

## Run the patch

On Windows with Node.js and an existing clasp login:

```text
RUN_AUTO_UPDATE.cmd
```

The updater targets the Apps Script ID stored in `SCRIPT_ID.txt`.

## Current test

After the updater reports `VERIFIED COMPLETE`, run this one test from Apps Script:

```javascript
test_HubReadyForInventory()
```

It verifies:

- hub sheet initialization/repair,
- the project registry,
- read-only Apps Script API access to the first enabled source project.

It **does not call Striven** and **does not modify any registered source project**.

If it passes, run:

```javascript
hub_inventoryAllProjects()
hub_inventoryRegisteredSheetTabs()
```

## Security

- Do not commit Striven API keys, OAuth secrets, OpenAI keys, passwords, or Script Properties.
- The source scanner redacts common token/key patterns from snippets written to the audit sheet.
- `.clasp.json` and `.clasprc.json` are intentionally ignored.
- Existing Apps Script Script Properties are not removed by source pushes.

## Release

Current release marker: `STRIVEN_CENTRAL_DATA_HUB_R1_20260909`
