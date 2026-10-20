# ENTERNEWPART column mapping repair — 2026-10-20

Applied to the existing Striven Central Data Hub workbook, ENTERNEWPART tab. Original 44-column sheet retained as hidden ENP_MAPPING_BACKUP_20261020.

## Independent reference lists
The former AL:AO vendor rules and AQ:AR category/serial list were independent lookup tables, not item-row metadata. Moved to ENP_VENDOR_RULES (47 reference rows) and ENP_CATEGORY_RULES (32 reference rows). Original labels/values retained, with notes warning that product-family labels are not supplier IDs. The main table now has 37 unique headers; old reference columns are empty and hidden. Category validation and serial formulas point to the separate category table.

## Field contract
All item lookups use trimmed, case-normalized exact ItemNumber, a unique matching source row, and MATCH of the canonical source header. Field positions and adjacent reference-list row numbers are never keys. Manually entered source values/IDs are preserved. Missing fields stay blank; source zero values stay zero.

| Hub target | DATA_ITEMS source / rule |
| --- | --- |
| Cost | Cost — snapshot only; not proof of supplier-list basis |
| Item Category | ItemCategory |
| Description | Description |
| Preferred Vendor | PreferredVendor |
| Manufacturer | Manufacturer |
| Location Name | LocationName |
| Taxable | Taxable |
| Item Type | ItemType |
| UPC | ItemsUPC |
| MAP Price | MAPPricing |
| Striven Item ID | Id, when source did not already record an ID |
| Item Name | Base name (Item Number), only with usable input labels |
| Manufacturer Part# | Exact primary product evidence; unavailable in current Hub schema |
| Serial Number Tracking | Exact Item Category lookup in ENP_CATEGORY_RULES |
| Discount | Verified applicable supplier/product-family rule; never adjacent reference row |
| Currency | Verified source only; no default or currency inference |
| Price / SO Line Price / Source Item Price | Original source values preserved; never substituted for supplier list price |

Hub Match Status uses the current REFRESH_CONTROL Items Last Success date and explicitly requires live verification. Source ID disagreement and malformed number/name labels require review.

## Checked example
G190-0004-SER is Thermostat in Napoleon's official Alluravision installation manual, printed pages 29–30. Cover identifies Wolf Steel Ltd.
Source: https://www.napoleon.com/sites/default/files/fireplaces_products/Alluravision--Installation---Operation-Manual---1-.pdf

- Name/description: THERMOSTAT (G190-0004-SER)
- Manufacturer: Wolf Steel Ltd. (matches existing internal manufacturer label; vendor-ID verification still required)
- Manufacturer part: G190-0004-SER
- Internal classification: Hearth - Parts; Serial Number Tracking NO from local category policy
- Source price 3.00 preserved. Preferred supplier, applicable discount, supplier list price/cost, currency, location, tax/type and live item identity remain unverified.
- Create Authorized FALSE remains unchanged. No Striven write was executed.

## Verification and remaining work
65 item/source rows checked: 47 matched snapshot rows, 4 no Hub match, 12 missing SKU, 1 malformed Item Name containing Price label, 1 malformed Item Number containing Item Name label. These are row counts, not unique-item counts. All remain review-only.
Native Google Sheets recalculation: no formula errors in A1:AK66. Source prices, order fields, original descriptions/actions/errors and authorization controls preserved. The old snapshot date remains 2026-10-07; current identity must be checked before writes.

The legacy operational payload builder still defaults cost/tax/item type/location and does not consume all the Hub metadata fields. The source deployment is not an end-to-end mapping deployment. Shared lookup activation remains paused; do not activate item creation until the Hub-to-payload mapping, required IDs and eligibility have been verified. This sheet repair installs no triggers and invokes no operational pipeline.
