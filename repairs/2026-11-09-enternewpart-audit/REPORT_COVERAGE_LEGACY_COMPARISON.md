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
