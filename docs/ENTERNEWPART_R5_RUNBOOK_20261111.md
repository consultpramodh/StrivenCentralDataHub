# ENTERNEWPART R5 — installation and controlled run

**Status:** Code prepared, syntax-compiled, and tested using offline mocks; **not deployed to Apps Script and not executed against production Striven**.

Source: [ENTERNEWPART.gs](../ENTERNEWPART.gs) in this branch. This is the **complete replacement for the existing `ENTERNEWPART.gs`**, not code to append. It retains the existing item/create/replace functions from the 2026-11-09 R4 source and existing `00_Config.gs` / `hub_strivenAccessToken_()` dependencies.

## What the new handler does

1. Reads only `HUB_ENP_REPORT_URL`; does not union other endpoint settings and does not read legacy workbook rows to widen scope.
2. Validates report response shape, item identity `ItemItemId=36935` and `ItemNumber=ENTERNEWPART`, SO status (Quoted/Approved), quantities, prices, and any reported total count.
3. Reconciles only live report lines to the `ENTERNEWPART` sheet. Historical rows are never selected for research application or Striven execution. Missing current-report rows are inserted; existing rows remain in place.
4. Uses full original source description, quantity, line price and SO line ID to disambiguate repeated SKUs. Ambiguity is blocked; no guessed line IDs.
5. Reuses existing item IDs where live exact SKU matches. Creates only after validated metadata and SO preflight. Replaces the specific line and reads back. Required fields must be present; 775 and 831 are not guessed.
6. Logs current report count, active count, excluded historical count, reviewed/held lines, completed lines and blocker samples.
7. Scheduled handler remains `hub_enternewpartEndToEnd`; installer `hub_enableEnternewpartAutomation` schedules America/Toronto 10:00, 14:00 and 16:00 slots.

## Installation

1. Back up the *live Apps Script* project and existing `ENTERNEWPART.gs`, including revision hash and triggers. Ensure the source being replaced matches this R4 parent; reconcile any newer local edits instead of overwriting them.
2. **Replace** the entire existing `ENTERNEWPART.gs` file with this R5 file. Do not add it as a second file with duplicate function names. Keep `00_Config.gs` and the Striven token helper.
3. Confirm `HUB_ENP_REPORT_URL` is the intended *current* **ENTERNEWPART - Approved Orders** report API endpoint. Do not configure legacy endpoints as part of this workflow.
4. Run `hub_previewEnternewpartAutomation()` manually and read its execution log. It refreshes/imports rows into Google Sheets and may read Striven; **it does not create Striven items or replace Sales Order lines**.
5. Reconcile the preview `reportRows` with the Striven report viewer. The observed Nov 11 viewer snapshot contained 12 lines / 5 SOs, but this is **not a hardcoded count**; source can change. Confirm older rows are excluded and source duplicates are not collapsed.
6. For one authorized, uniquely matched row with complete verified metadata and required SO fields, run `hub_enternewpartEndToEnd()` manually. **This CAN create live Striven items and alter Sales Orders**. Verify SO/item readbacks and completed status in the logs and actual Striven UI. Stop if discrepancies.
7. Only after controlled production verification, run `hub_enableEnternewpartAutomation()` **once** to install the three daily triggers. Do not manually install any old handler simultaneously.

## Known limits and fail-closed behavior

- If source API returns less than the viewer or the wrong endpoint, stop. Do not fall back to historical sheet rows.
- If duplicate source rows are identical on all available identifying fields without a stable line ID, stop; manual evidence is required.
- If current SO line quantity, price, status or original description changed, stop that line before item creation.
- If Item Category, valid supplier mapping, SKU, cost/discount evidence or supported serial-tracking metadata is missing, retain review.
- If Striven rejects required SO custom fields 775/831, preserve the blocker and require the actual SO field value from the operator, never fabricate it.
- An OpenRouter HTTP 402 can interrupt research; the worker may still resolve already-verifiable rows but cannot invent missing metadata.
- Offline tests do not prove Apps Script deployment, live Striven API compatibility, trigger ownership or end-to-end completion.

## Offline verification completed

- Full-source JavaScript syntax compilation.
- Single-source report fetch and total-count mismatch rejection.
- Current-only queue selection; historical rows excluded; explicit hold respected; missing scope rejected.
- Three same-SKU report lines mapped to three different simulated Striven LineIds; ambiguous unscoped match rejected.
- Source refresh correctly inserted a missing current-report row without touching a historical row.
- Duplicate identical source row rejected before mutation.

**No production Striven writes occurred during these offline tests.**
