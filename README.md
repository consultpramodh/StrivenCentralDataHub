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

## Mandatory schema alias standard

Every external field consumed by the Hub must be defined through a **canonical Hub field name plus an alias set**. This applies even when the current Striven/API/report field name already matches the canonical name.

Examples:

```text
Canonical: Id
Accepted aliases: Id, ItemId

Canonical: Taxable
Accepted aliases: Taxable, ItemTaxable
```

Rules:

1. Consumer projects read canonical Hub field names only.
2. The Hub is responsible for translating provider/report aliases to canonical names.
3. Every schema definition must include at least the canonical name itself as an accepted alias.
4. Known historical, API-generated, spacing, punctuation, casing, and report-builder variants should be listed as aliases when they are semantically identical.
5. Alias matching must normalize case, spaces, punctuation, underscores, and common prefix differences where safe.
6. If more than one source field matches the same canonical field in a single payload, validation must fail as ambiguous rather than silently choose one.
7. If a required canonical field has no accepted alias in the payload, validation must fail clearly.
8. An unexpected field must be surfaced during schema validation rather than silently ignored unless the schema explicitly marks extras as allowed.
9. Aliases are for naming differences only; fields with different business meanings must not be merged merely because their values currently look similar.
10. Report changes should be avoided when an API/report-builder naming difference can be safely normalized centrally.

This alias layer is a mandatory design practice for all future canonical datasets, not just Items.

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

## Current test

Current live/GitHub test:

```javascript
test_StdItemsRefreshAndVerify()
```

This test executes the full manual standard Items refresh into `DATA_ITEMS`, validates the canonical 15-field schema and alias layer, verifies the sheet row count, and asserts that no Striven writes or source-project modifications occur.

Verified PASS on September 9, 2026:

- dataset: `ITEMS`
- target: `DATA_ITEMS`
- rows: 19,031
- report page calls: 39
- token request made: true
- total API calls in the verified run: 40
- canonical fields: 15
- alias standard: PASS for all 15 fields
- `ItemId` normalized to canonical `Id`
- `ItemTaxable` normalized to canonical `Taxable`
- DATA_ITEMS row count verified: true
- Striven writes performed: false
- source projects modified: false

`hub_refreshStdItems()` remains **manual only** until migration and refresh-frequency validation are complete.

## Security

- Do not commit Striven API keys, OAuth secrets, OpenAI keys, passwords, or Script Properties.
- The source scanner redacts common token/key patterns from snippets written to the audit sheet.
- `.clasp.json` and `.clasprc.json` are ignored.
- Existing Apps Script Script Properties are not removed by source pushes.

## Release

Current verified release: `R1.2 STD Items Refresh`
Base Hub marker: `STRIVEN_CENTRAL_DATA_HUB_R1_20260909`
