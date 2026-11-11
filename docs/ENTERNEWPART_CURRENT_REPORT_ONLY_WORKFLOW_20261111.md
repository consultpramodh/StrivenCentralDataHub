# ENTERNEWPART — current-report-only execution contract

Status: **PROPOSED / NOT DEPLOYED**. This document defines the requested replacement workflow; it does not claim a production run or authorize guessing missing Striven data. This repository is public: no credentials, customer names, product pricing records, or private report data belong here.

## Scope / single authority

1. Use the existing configured `HUB_ENP_REPORT_URL` report, whose Striven viewer is titled **ENTERNEWPART - Approved Orders**. Do not merge separate legacy reports or sweep historical `ENTERNEWPART` sheet rows.
2. Fetch the current report once at the beginning of each run, authenticate through existing Striven token support, validate envelope, column schema, count and any pagination. On failed/incomplete/ambiguous fetch: **stop with no Striven writes**, never fall back to cached queue rows.
3. Include a source line only if it is currently in the fetched report, its placeholder identity is `ItemItemId = 36935` and `ItemNumber = ENTERNEWPART`, Sales Order status is `APPROVED` or `QUOTED`, and order ID, item description, positive quantity and nonnegative line price are valid. Unexpected placeholder shape -> exception, not silent inclusion.
4. Build an immutable report-run manifest with source report timestamp, source row count, report signature and one entry **per Sales Order line**. Keep the full source description unchanged. Current manifest controls every subsequent read/write, research application and retry. Existing backlog is visible for history only; no processing, enrichment, approved-research application or modification for lines outside the manifest.
5. The report viewer and API must reconcile as comparable snapshots (taking source latency into account). Any unexplained missing recent line, truncated page or duplicate ambiguity blocks writes until resolved.

## Per-line identity (critical)

1. Report-row identity by SKU alone is forbidden: one SKU can appear on several distinct placeholder lines on the same order. The same SKU may be resolved to one item catalog identity, but each placeholder **line** must be replaced exactly once.
2. Use a stable `SalesOrderLineId` if the report exposes one. Otherwise GET the live Sales Order once per order and reconcile candidate line IDs by original *full normalized description*, quantity, line price and placeholder Item ID. Do not lose annotations such as "please confirm" or "to be confirmed".
3. If the SO has duplicate indistinguishable lines or a report row cannot be uniquely matched to one live line ID, set `NEEDS REVIEW: AMBIGUOUS_LINE_IDENTITY` and do not guess or mutate that line.
4. Persist the unique operation key `SO_ID + LINE_ID + REPORT_SOURCE_FINGERPRINT`, with a verified, immutable line identity readback. This keeps retries idempotent even while the report is eventually consistent.
5. The current report may contain multiple occurrences of the same item number; preserve their multiplicity. Do not deduplicate by item number, and never execute an extra historical queue row simply because its SKU matches.

## Process, in strict order

1. **REFRESH_REPORT**: one live GET. Validate placeholder-only membership; return exact source count, distinct order count and distinct SKU count.
2. **RECONCILE_INTAKE**: identify only present report lines, map them to current sheet rows using full source identity, insert only missing present lines, preserve existing valid enrichment, and mark older/non-present rows as excluded **in the run manifest**, without deleting their data or overwriting their workflow status. Ensure previous completed rows are verified against live SO rather than recreated.
3. **PREFLIGHT_SO**: GET each distinct SO; verify number/status, exact placeholder line IDs and original description/quantity/line price. Check all required SO custom fields, including 775 and 831 when required by Striven, before creating an item. Preserve existing field values on updates; do not fabricate answers.
4. **RESOLVE_CATALOG**: query Striven exact live item number once per distinct SKU, verify unique ID and catalog readback. `DATA_ITEMS` is a stale-cache hint, not a negative proof. If existing item is valid, reuse; if not found, proceed to validated creation metadata. Never create duplicate SKUs.
5. **ENRICH_METADATA**: use exact internal vendor/category mappings, supplier catalog and grounded public product evidence; distinguish a customer-facing SO price from a supplier list price. Honor the confirmed cost rule only when verified supplier list price, currency and applicable discount exist. A web result/AI inference cannot authorize a write; leave ambiguous values for review. Respect mandatory serial/MAP write limitations.
6. **CREATE_IF_NEEDED**: only after SO and item preflight passes, create each new item once, then live-read the returned item ID, SKU, name and relevant pricing/costs. If Striven item creation succeeds but SO replacement later fails, record `ITEM READY — REPLACEMENT BLOCKED` and reuse the item on retry, never recreate.
7. **REPLACE_EXACT_LINES**: update only the scoped, individually verified placeholder line IDs in each SO, preserving original line quantity, line price, unrelated items and order fields. Prefer one guarded batch per SO when safe; do not update unsupported custom fields or omit required custom-field values. CF820 is updated only under its existing verified all-placeholders-resolved rule.
8. **READBACK**: re-GET changed SO and confirm target line IDs now reference correct item IDs; verify preserved quantities, prices, status and custom fields, and no unrelated line changes. Set `COMPLETED` only after this passes. Research-only and item-created states are not completion.
9. **REPORT**: emit a manifest-scoped report: reportRows, eligiblePlaceholders, uniqueSO, uniqueSKUs, inserted, reusedItems, createdItems, replacedLines, completedLines, skippedOrHeld, reviewReasons, failureStage, StrivenReadCalls and StrivenWriteCalls. Separately log excluded historical rows without processing them.

## Fail-closed cases

- Report unavailable, incomplete, empty with contradictory viewer evidence, stale or lacking required source identity -> no writes.
- Line ID ambiguous, SO missing, SO status/price/qty changed -> no writes for affected line.
- Required SO field 775/831 missing -> no SO overwrite and no default guessed value.
- Missing/ambiguous category, supplier, supplier discount, cost basis, SKU or unsupported serial tracking -> review only.
- Repeated report row after successful prior run -> verify already-replaced live line; no new item and no duplicate replacement.
- Explicit `HOLD`, `PAUSED`, `DO NOT CREATE` and global pause remain authoritative.
- Manual or scheduled execution must not call an unscoped historical queue processor or unscoped research-approved writer.

## Code integration gates

- Correct `hub_enpPendingQueueRows_`: it currently concatenates report-active rows with historical backlog (`first.concat(rest)`); replace with report-active-only projection. Do not use the old backlog fallback.
- Correct `hub_runEnternewpartReportWorker_`: pass the same immutable scope into research, research approvals, validation and Striven worker. Current `hub_applyApprovedEnternewpartResearch()` has no scope argument and can edit unrelated rows; implement scoped control before enabling production.
- Correct report intake: require placeholder identity from source, and reconcile same-SKU multiple lines against stable line IDs. Existing report-row key based on description/qty/price is only a temporary mapping, not a substitute for live LineId.
- Correct `enp_hubPlanRow_`: do not make a current row fail merely because a historical out-of-report row with the same SKU has different catalog metadata. Validate against authoritative live item/vendor sources and same-run scope.
- Confirm current `ENTERNEWPART.gs` live source parity before replacing functions. Preserve existing Striven auth, item bridge guards, API brake, price preservation, workflow status schema and unrelated scripts.
- Keep exactly one public end-to-end handler, `hub_enternewpartEndToEnd`, at existing Toronto 10:00, 14:00 and 16:00 slots. No extra high-volume report polling.

## Acceptance tests

1. Current report has 12 lines across 5 SOs and 10 unique item numbers (observed viewer snapshot Nov 11, 2026; NOT an API refresh confirmation); implementation must re-fetch and reconcile at runtime, not hardcode these counts.
2. One newly reported line absent from the prior sheet must be inserted. No older row may be brought into scope.
3. Three report occurrences of one SKU on one SO must map to three separate live LineIds. A fourth historical row of that SKU must not run.
4. Negative item-cache exact lookups must trigger live exact search, never automatic creation.
5. Invalid SO required CF 775/831 must block rather than send an invalid order update.
6. If report returns zero valid placeholders, return success with zero Striven writes and zero backlog work.
7. Simulated repeated runs must create zero duplicate items and zero extra SO replacements.
8. End-to-end acceptance requires a controlled live run with readback of item IDs and changed SO lines, plus a report of untouched historical rows.

**Execution status:** report tab and Hub spreadsheet inspected read-only; no Apps Script report-refresh function, Striven item create, SO update, trigger change or production deployment executed by this change.
