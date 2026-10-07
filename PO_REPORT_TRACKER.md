# PO sales and inventory report — execution tracker

Updated: 2026-10-07. Owner: Classic Fireplace. Implementation: Striven Central Data Hub.

## Definition of done

For products referenced by PO 2739, 2744 and 2745: show quantities ordered by PO, gross sold, returned and net sold for Jan 1–Jun 30 and Jul 1–latest complete 2026 transaction date; YTD net sold; timestamped actual inventory by location; verified alternate SKU identities; transaction-level audit and exceptions. Future H2 months are not zero sales.

POs define the product population, not physical purchase-to-sale lineage. Item ID is the primary key. Verified equivalent product aliases may combine separate Item IDs; successor products are not automatically equivalent. Only actual merchandise returns reduce unit sales. Financial-only credits affect revenue separately. Ordered minus sold is a comparison, never a stock calculation. Billed quantity is not assumed to be received quantity.

## Stages

| Stage | Status | Evidence / completion gate |
|---|---|---|
| Scope and reporting rules | DEFINED | User supplied conversation and clarified business question |
| PO extraction | LIVE DATA CHECKED | 213 lines; record IDs 4168/4173/4174 map to PO numbers 2739/2744/2745; total ordered 2,812 |
| Unique item master | LIVE DATA CHECKED | PO_ITEM_SCOPE has 98 rows; total ordered independently reconciles to PO detail |
| On-hand inventory | CACHE RECONCILED | 98 summary rows, 301 location rows; both sum to 892.5. Raw endpoint mapping still requires source comparison |
| Commitments / on-order / available | BLOCKED | Missing fields default to zero in current code; all SO/PO values zero; do not certify available stock |
| Inventory exceptions | OPEN | ENTERNEWPART 36935 has no inventory location rows. Blank location IDs also require mapping review |
| Remote transaction probe | FIX COMMITTED; EXECUTION PENDING | Prior green workflow did not execute: unsupported --deploymentId. Runner now uses supported command and checks JSON execution result |
| 2026 transaction extraction | NOT COMPLETE | DATA_TRANSACTIONS still contains SCHEMA_PENDING_SOURCE_AUDIT |
| Credit classification / status / dates | NOT COMPLETE | Verify source fields and representative actual returns versus financial-only credits |
| SKU aliases | NOT COMPLETE | Confirm historical Item IDs and equivalent identities; retain evidence, unresolved aliases remain exceptions |
| Summary and audit | NOT COMPLETE | Build from reconciled transaction lines; include inventory freshness and unknown fields |
| Acceptance checks | NOT COMPLETE | Complete pagination, duplicate control, detail-to-summary reconciliation and representative source comparisons |
| Scheduled refresh | DEFERRED | Enable only after acceptance; manual functions remain callable |

## Current findings

- Latest implementation is on main; feature/po-sales-scope is older and lacks the inventory layer. Do not deploy the older branch over live code.
- A green GitHub workflow is not evidence of successful Apps Script execution; inspect response and workbook effects.
- Current inventory fallback conflates absent or invalid values with zero. Preserve unknown values until exact fields are proven.
- PO numbers and API record IDs differ. The older feature branch still incorrectly used PO numbers as API IDs.

## Execution order

1. Run corrected transaction probe and verify response plus workbook output.
2. Inspect actual inventory response fields; resolve missing location IDs and zero defaults.
3. Establish transaction search/detail endpoints, date/status fields and pagination.
4. Extract/cache 2026 invoice, sales receipt and credit memo lines once; classify returns.
5. Resolve SKU exceptions; generate summary and audit.
6. Reconcile and validate before enabling recurring refresh.

## Tracking standard

A stage is complete only when its output and acceptance gate pass. Track source commit, deployment verification, execution result, extracted row count, API calls, freshness, exception count and next action independently. No percentages based on code written.
