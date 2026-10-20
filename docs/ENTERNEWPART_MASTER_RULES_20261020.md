# ENTERNEWPART mastersheet enrichment and constants — 2026-10-20

Applied to existing Hub ENTERNEWPART sheet. Pre-enrichment copy: hidden ENP_PRICE_BACKUP_20261020.

## Fixed defaults confirmed by user
Every populated item/source record has:
- Location Name: 60 - WAREHOUSE (Ajax)
- Taxable: Yes
- Item Type: Inventory

Live columns L:N use three open-ended ARRAYFORMULA expressions, driven by the presence of Item Number, Source or Original Description, so these defaults do not depend on an item lookup. Unused rows remain blank. These are native Sheet defaults; the operational Apps Script payload integration remains a separate pending task.

## Authoritative source inspected
CF Price Update - Mastersheet - Feb 2026:
https://docs.google.com/spreadsheets/d/12yGJYyTYW9DRPA53MG7vQJWAK6moFjlQZXu17pfxgCs/edit

Inspected Info, Inventory, Worksheet, Item LookUp, Existing, New, Item Lookup AI, AI Item Classification, AI Item Review, Existing Items and New Items. There were 42 exact target SKU matches in Inventory, including the two malformed source records; no matches in the current pricing batch or AI classification data. Current batch vendor/discount controls are not applicable to all Hub items.

Filled 12 previously blank cells from unique exact Inventory ItemNumber matches with matching Item IDs: 7 Price fields and 5 Manufacturer Part# fields. Existing nonblank prices/costs, order fields, source descriptions, source IDs and authorization controls were preserved. Each fill records its exact source cell in a note. Source Inventory Price is an existing item price, not independently verified supplier list price.

For the separately researched G190-0004-SER thermostat:
- Preferred Vendor: Wolf Steel Ltd., following the mastersheet's Item LookUp!I5 mapping from Info!B.
- Discount: 40%, exact internal rule Wolf Steel Ltd. - Hearth Parts, Info!A44:D44.
- Supplier company and product-family reference labels are now distinguished in ENP_VENDOR_RULES.
- Cost remains blank: neither an exact pricing-row match nor verified supplier list price/currency was found. Source SO price 3.00 was not used to calculate cost.
- Create Authorized remains FALSE. No Striven write or operational run was performed.

## Native verification
All 65 item rows show the three exact defaults. All 12 source fills match the inspected Inventory fields. No formula errors in A1:AK67. No existing nonblank source/price/cost/order/authorization value was changed. Creation and shared lookup activation remain paused; this is not proof of end-to-end payload mapping or live Striven ID validation.
