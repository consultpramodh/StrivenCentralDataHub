# ENTERNEWPART source-report coverage audit — 2026-11-09

## Evidence checked
- Striven custom report **ENTERNEWPART - Approved Orders**, report viewer `33051`, visibly returned **11 placeholder item lines** across SO IDs `28500`, `28476`, `28407`, `28337`. Despite the report title, it includes both **Quoted** and **Approved** orders.
- The legacy workbook's `Enternewpart` tab retained **12 lines** across five SO IDs, including `28419` (`#586684`).
- The open live Striven Sales Order **Dave Burtch — #586684 (internal ID 28419)** displayed status **Approved** and placeholder item **ENTERNEWPART** (Item ID `36935`), description `GLA-5DV`, unit price **$835.80**. This line was absent from the 11-row report.
- The legacy `Enternewpart_Quoted` sheet contains **59 historical lines** across 26 SO IDs. All 59 matched the Hub's existing historical queue on SO ID, normalized description, quantity and price. Historical matching is *not* proof those items remain live placeholders.
- The legacy Apps Script function `enp_syncAllReports()` calls `enp_syncApprovedReport_()` and `enp_syncQuotedReport_()` separately, using `STRIVEN_ENTERNEWPART_REPORT_API` and `STRIVEN_ENTERNEWPART_QUOTED_REPORT_API`. It preserves action-state columns across refreshes using composite row keys.
- The consolidated Hub `hub_refreshEnternewpartReport()` fetches only `HUB_ENP_REPORT_URL`. The Hub and legacy Apps Script projects have **independent Script Properties**; a URL/key configured in one project is not automatically visible to the other.

## Verified implication
At least one currently displayed Approved Sales Order with an ENTERNEWPART placeholder is absent from the live custom report. The cause could be the report definition/filtering, report synchronization, or another report-side exclusion. It is **not explained by the Hub already having older rows**. Do not claim the exact report-filter predicate without inspecting the report builder configuration.

## Legacy components worth reusing
1. Keep two explicit *source* report channels (Approved and Quoted), with deduplicated fetches if URLs coincide.
2. Preserve existing row/action state when refreshing; do not re-create items or reset completed records just because an older snapshot contains them.
3. Use a compound line identity, and require a stable line ID or targeted SO readback for genuinely identical duplicate lines.
4. Reuse the current guarded Striven item resolution and exact SO-line replacement engine; it is already derived from the legacy implementation. Do not revive unsafe direct report-sheet actions or overwrite transaction values.

## New read-only source audit
The consolidated `ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs` now contains:
- `hub_auditEnternewpartSourceReports()` — **manual audit only**, GETs at most 3 distinct configured report URLs, de-duplicates identical URLs, counts live placeholder rows and SOs, distinguishes source status, compares candidate lines against Hub without changes, and flags omission of SO `28419`. No Striven writes or Sheets writes.
- `hub_enternewpartEndToEnd()` — remains the **only automation trigger handler**. No extra report calls are added to the scheduled run by this audit.

When the diagnostic reports `ONE_ENDPOINT_ONLY_LEGACY_DUAL_REPORT_COVERAGE_NOT_CONFIGURED`, inspect the **original** legacy Apps Script project for the legacy `STRIVEN_ENTERNEWPART_QUOTED_REPORT_API` setting. Do not paste API keys publicly. URLs are validated as Striven report endpoints and their contents are not logged verbatim.

## How to resolve coverage
1. Review report `33051` in Striven Report Builder, including any saved filters, default scope, order status, completion, owner, date and item criteria. The exact faulty criterion has **not** been verified.
2. Verify that the report returns actual placeholder Item ID `36935` without inadvertently excluding SO `28419`. A line/transaction identifier should be included if Striven offers one.
3. Validate the legacy Approved and Quoted report URLs in the **Hub** Apps Script properties (without overwriting working credentials), then run `hub_auditEnternewpartSourceReports()`.
4. Compare the union with independent targeted live SO checks. Only after the audit demonstrates correct coverage should `hub_refreshEnternewpartReport()` be modified to consume the verified union.
5. Keep workflow execution authorization (Approved/Quoted and exact SO line checks) separate from the reporting requirement to list every placeholder, including those in other statuses.

This is an audit/diagnostic change only: no live Apps Script deployment, no report-definition edit, no Striven write.

## End-to-end execution patch (2026-11-09)

Updated `ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs` now restores source collection in the **same single trigger handler** `hub_enternewpartEndToEnd`:

1. Fetch `HUB_ENP_REPORT_URL` once, plus any *distinct*, optional legacy Approved/Quoted report endpoints configured in the Hub's Script Properties. Same endpoint URLs are fetched only once.
2. Retain the largest observed multiplicity for equal lines across sources. Do not collapse two identical physical placeholder lines from one report into one; such lines still require a stable SO line identifier before updating the SO.
3. Consult only the recent legacy `Enternewpart` sheet as a **candidate index** for orders omitted or underrepresented by the live report sources. On up to five candidate Sales Orders per execution, perform a fresh authenticated Striven GET and include only currently present placeholder item ID `36935` line items in Approved/Quoted SOs, using *current* SO line description/qty/price. It never treats stale legacy sheet values as live item data, and never writes to the legacy workbook.
4. Separate `reportRows` (actual live report rows) from `unionRows` (additional live-verified fallback and optional report rows). `sourceCoverage.coverageGuaranteed=false` intentionally remains in the output: the cached legacy sheet cannot prove discovery of every future missing order.
5. For rows with a prior Striven required-field error for CF775/CF831, check the original SO's current field values **before** item lookup or SO POST. Do not default or invent answers. If a failed SO is corrected later, bounded readback checks (max four distinct SOs per execution; four-hour per-order cooldown) can reset its retry limit automatically. When fields are still missing, preserve the existing `ITEM READY — REPLACEMENT BLOCKED` state.
6. Preserve all existing guardrails for exact SKU lookup, full SO line verification, prices/quantities, item groups, CF820, and research-only evidence.

**Verification:** Full script syntax parsed; 13 mocked source/field assertions and 13 existing source-audit assertions executed in isolation with zero external writes; GitHub Actions also runs the regression suite. **Not live-deployed by this change.**

**Remaining blocker:** Report Builder `33051` still excludes at least one actual placeholder SO. The fallback improves coverage for *known legacy candidates* only. To obtain exhaustive discovery, correct the report definition or configure a broader verified source report; do not claim the end-to-end automation is 100% comprehensive yet.

## Private user-supplied report URL handoff (2026-11-09)

The user supplied another Striven `/v2/reports/` API-key URI for ENTERNEWPART. **Do not commit this sensitive URL to public GitHub.** Striven's API Settings documentation warns that custom-report URIs can expose report data.

The Hub spreadsheet (owner-only at staging time) contains a **hidden, temporary** `ENP_PRIVATE_REPORT_STAGING` tab with `B2` holding the supplied report URL. The latest `ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs` reads and validates that value. The normal end-to-end run promotes it to the private Apps Script Script Property `HUB_ENP_USER_REPORT_URL`, verifies the property, then clears `B2` and marks the handoff as complete. No report URI is logged or committed.

The current configured `HUB_ENP_REPORT_URL` is retained. Both are fetched only when their URLs differ, and the resulting placeholder lines are unioned without collapsing repeated physical lines. `hub_auditEnternewpartSourceReports()` can inspect both sources **without writing or consuming the staging URL**. An incorrectly configured or unavailable supplemental report fails before new item or SO writes, rather than silently claiming comprehensive coverage.

**Deployment remains outstanding** until the updated file is pushed to the live Apps Script project. The sensitive URL stays in the owner-only spreadsheet while undeployed, so do not share the Hub spreadsheet before handoff and cleanup. A successful mocked regression suite does not prove that the newly supplied endpoint returns the expected App Integration JSON; this still requires the first authenticated live read.
