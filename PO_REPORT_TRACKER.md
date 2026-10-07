# PO sales and current inventory — execution tracker

Updated 2026-10-07. Classic Fireplace / Striven Central Data Hub.

## End result
A working workbook for products on PO 2739, 2744 and 2745: quantities ordered by PO, H1 gross sales (Jan–Jun), H2 gross sales (Jul–latest complete day), accounting signed quantities, verified net where return evidence permits, current inventory and available/committed quantities, transaction audit and explicit exceptions.

POs define the product population, not purchase-lot attribution. Inventory comes from Striven, never ordered minus sold. No forecast; cutoff is capped at December 31, 2026. Item ID is the primary identity; proven aliases may combine IDs. Unknown inventory and unresolved physical-return quantities remain blank.

## Technical delivery
- Deployed source: `0623a0d26984a84e81c7aa1a9b33bd6eb2d7855e` on `feature/po-sales-scope`.
- Deployment run 37686528819 passed live PRE backup, freshness comparison, same-project push and exact POST source verification. All existing seven live files preserved.
- Complete report API import validates field contracts, stable totalRecords, pagination exhaustion and unique line IDs. Reads are paced; rate-limit retries are bounded.
- Refresh automatically reloads the three PO records and reconciles them against the Wolf PO report before analysis.
- Manual operation: workbook **Central Hub → Refresh Complete PO Analysis**.
- Live execution is verified separately from GitHub deployment. No scheduled trigger enabled; scheduling is deferred until business acceptance.
- Report access keys remain in private workbook configuration. No Striven operational transactions or item records were changed.

## Business acceptance still open
| Review | Concrete action |
|---|---|
| 17 candidate SKU relationships | Confirm same reportable product versus distinct model using PO_SKU_REVIEW. Unproven relationships remain separate. One TravelQ alias is already approved by identical SKU/name/UPC. |
| 15 credit/negative-quantity lines | Classify physical merchandise return versus financial-only adjustment in PO_RETURN_REVIEW. Twelve source transaction detail records reconciled to the report; two negative Sales Receipt detail records could not be obtained from a documented generic endpoint. Source memos do not establish physical return. Accounting signed quantity is available separately. |
| Five generic placeholder PO lines / seven ordered units | Source descriptions identify LF680WCKSS ×4, NFR565UGDSS ×2 and NFR565D2NK ×1. Supply actual Striven Item IDs or correct the PO item identities. Generic ENTERNEWPART cannot safely identify sales or stock. |
| One active placeholder sales line | Invoice 598727 line 60239 describes Powder Coat, qty1. Excluded from product sales and retained in identity review. |

These are business/source decisions, not unresolved API implementation. Physical-product net sales are not fully accepted until these decisions are resolved and applied.

## Workbook guide
- PO_REPORT_HOME: landing page, current metrics, refresh status and review links.
- PO_SALES_SUMMARY: per-item ordered/sales/inventory comparison.
- PO_TRANSACTION_AUDIT: included/excluded transaction-line decisions.
- PO_RETURN_REVIEW / PO_RETURN_EVIDENCE: return exceptions and source comparison.
- PO_SKU_REVIEW / PO_ALIAS_INVENTORY: identity evidence and alternate-ID stock.
- PO_PLACEHOLDER_SOURCE / PO_ITEM_IDENTITY_REVIEW: raw placeholder descriptions and excluded unidentified sales.
- PO_REPORT_STATUS: validation/freshness/business status.
- Hidden PO_API_SALES_LINES / PO_API_ORDER_LINES: complete source caches.

Earlier 213-line / 98-item / 2,812-unit scope and pending-import notes are historical and superseded by refreshed source data. A cached recomputation correctly refused a changed scope when PO 2744 gained six units of 69811; live refresh is required after source changes.

## Final live verification — 2026-10-07
`test_PoAnalysisRefreshAndVerify` completed PASS at 5:14:49 PM Toronto on the deployed source above. Workbook business status is PASS_WITH_EXCEPTIONS. One bounded rate-limit retry recovered successfully.

| Metric | Verified current result |
|---|---:|
| Full sales source / unique transaction lines | 13,357 |
| Full Wolf PO source / unique lines | 1,548 |
| Selected PO lines | 220 |
| Selected Item IDs | 103 |
| Ordered quantity | 2,356 |
| PO2739 lines / qty | 83 / 1,191 |
| PO2744 lines / qty | 50 / 217 |
| PO2745 lines / qty | 87 / 948 |
| H1 gross product quantity | 929 |
| H2 gross product quantity through Oct6 | 688 |
| H1 accounting signed quantity | 924.5 |
| H2 accounting signed quantity through Oct6 | 678 |
| Known current on hand | 927.5 |
| Unknown inventory Item IDs | 1 |

Inventory snapshot UTC: 2026-10-07T21:12:08.467Z. The one active Powder Coat placeholder line is excluded from product totals; the seven unidentified ordered units remain visible. The newly scoped 69811 contributes one H1 sale and zero known on-hand quantity; its item description says replaced by 69911, but those two Item IDs are not consolidated automatically.

Independent recomputation from the full final cached transaction and PO feeds exactly matches gross, accounting signed, return-review count, PO splits and stock totals. Synthetic checks cover period boundaries, cutoff, void/nonposting exclusions, credit handling, impossible dates, placeholder exclusion, numeric SKU/cache date normalization and stale-scope rejection before writes.

Technical implementation and manual operation are complete. Full business acceptance remains open only for the explicit review decisions above. Recurring scheduling remains deferred.
