# ENTERNEWPART cost calculation — 2026-10-20

Applied to the Hub's existing ENTERNEWPART tab (sheet ID 1804667503). Native pre-change backup: hidden ENP_COST_BACKUP_20261020 (2001000311). Native test fixtures: hidden ENP_COST_QA_20261020 (2001000310); fixture prices and SKUs are synthetic and are not operational records.

## Rule and source

Calculated Cost = ROUND(verified supplier list price × (1 − applicable product-family discount), 2).

Inspected the actual mastersheet Info!A1:D48 and Item LookUp!A1:Q6. Item LookUp!E5 preserves explicit Worksheet costs before falling back to list price less the selected discount. Wolf Steel's discounts differ by family: Hearth Parts 40%, Hearth 55%, AllureVision 50%. The selected current batch is not a universal rate.

## Live columns

- AL Supplier List Price
- AM Supplier Currency
- AN Supplier Price Source
- AO Cost Inputs Verified (native boolean checkbox)
- AP Calculated Cost (open-ended ARRAYFORMULA)
- AQ Cost Calculation Status (open-ended ARRAYFORMULA)

Existing Discount AD is used only when numeric and between 0 and 1 inclusive. Verification requires exact SKU/list-price evidence and the applicable family discount. Input currency AM must match item Currency Q, with nonblank values. No exchange rate is assumed. A checkbox records operator verification; it is not independent supplier verification or item-creation authorization.

Cost E retains its original exact-SKU DATA_ITEMS lookup formula and explicit source values, including zero. A blank lookup result falls back to Calculated Cost. Existing costs are not overwritten; a different verified calculation is flagged for review. Existing zero with no calculation is flagged for review, not described as a verified purchase cost. E is prepared through row 500; AP/AQ spill to the sheet's available rows. Copy the E row formula if the grid later grows beyond row 500.

Neither Price D, SO Line Price W nor Source Item Price AE is used as supplier list price. This is important because some source item-price parses are truncated, and an order selling price is not authoritative purchase-cost input.

## Verification

16 calculation cases executed in native Google Sheets: 40% discount, 0%, 100%, missing list, discount entered as 40, negative discount, negative price, currency mismatch, missing currency, unchecked verification, missing evidence, existing cost retained, existing zero retained, cent rounding, numeric text rejected and missing discount. All matched independent expected values.

Three additional native wrapper checks passed: blank source fallback 60, existing source 25 retained, existing source zero retained. Re-read main sheet: 65 actual records; 0 original A:AK effective values changed; 0 formula errors. All creation-authorization values remain unchanged. Header styles, new verification checkboxes and visible cost/status columns were inspected in the Google-rendered Sheet.

Current statuses: 17 blocked for missing supplier list price; 7 existing nonzero costs preserved; 41 existing zero costs flagged for review. G190-0004-SER retains verified discount 40% but Cost remains blank because verified supplier list price is missing. Its SO price 3.00 was not used to infer cost.

No supplier list price, currency or new verification approval was invented. No Striven API write, item creation, order update or Apps Script deployment occurred in this change. The existing operational Hub adapter reads Cost E once all independent creation requirements are met; serial/MAP/reference-ID blockers from the preceding deployment remain.

Source workbook inspected: https://docs.google.com/spreadsheets/d/12yGJYyTYW9DRPA53MG7vQJWAK6moFjlQZXu17pfxgCs/edit
Target workbook: https://docs.google.com/spreadsheets/d/13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU/edit
