# ENTERNEWPART description repair — 2026-10-20

Google Apps Script and native Sheet repair. Original source descriptions are retained, and every row remains at its existing order/source grain. Item names use Item Name (Item Number) only when the number is known.

## Outcome

65 actual rows audited; 60 now have all three fields populated. 26 rows changed in Item Number/Name/Price: 19 number cells, 22 name cells and 14 price cells. 10 Source Item Price cells were repaired from complete original money strings. Original descriptions, SO line prices and creation authorization are unchanged. No Striven item/order writes were performed.

Categories: IDENTITY_REVIEW 8; CONFLICTING_INFORMATION 11; FORMAT_RECOVERED 3; INCORRECT_INFORMATION 2; PARTIAL_INFORMATION 2; MULTI_ITEM 1; STRUCTURED 36; MANUAL_SOURCE 2. These categories describe extraction quality, not permission to create. A complete description is not proof of current product metadata or pricing. Eleven rows have price/catalog conflicts; retained values and sources are explicit in the review table.

## Rules

- Anchored labels with horizontal whitespace only: an empty field cannot swallow the next label.
- Full-string money parsing supports comma, regular-space, NBSP and narrow-NBSP thousands; malformed or partially numeric values are rejected. Explicit zero is distinct from missing price.
- Multiline item names remain complete. HTML br and common entities are normalized for parsing; raw Original Description is not edited.
- Unlabelled leading SKU/name and three-line SKU/name/price formats can be recovered for review. Generic descriptions, conflicting labels and descriptive prose in a SKU remain flagged.
- Exact catalog identities are joined by normalized SKU and unique Item ID. Invalid catalog names/identities are not trusted merely because they match exactly.
- Preserve explicit description price. If missing, use this source row's nonzero SO line price with provenance, then a valid exact-catalog selling price. A zero catalog price is not evidence that an incomplete item is free. SO/catalog differences are flagged; no supplier list price or cost is inferred.
- Manufacturer-documented aliases 77L70 = SV4.5L6 and 77L75 = SV4.5LA map to existing model identities. DUR vendor prefix is separated from manufacturer part 4BVK. Other name-only or near-SKU candidates are not auto-selected.
- Multiple bullet components are not treated as one inventory item or allocated an aggregate price.

## Remaining incomplete rows

- Hub row 7: IFM-SPAN-IFM24 has no name or price. Exact catalog entry is itself corrupt (name Price:); near code IFM-SPAM-IFM24 is not silently substituted.
- Row 8: Ortal description has no reliable SKU. The existing catalog contains a polluted label-as-SKU entry; it was not reused as a valid identity.
- Row 9: bundled BDM venting plus shipping requires distinct component SKUs, quantities and prices. Five source components are staged separately without invented allocation.
- Row 17: Paloform prose/material options were entered in the SKU field; exact SKU/variant still required. Product text was preserved in the name.
- Row 50: generic brick-liner name has a catalog candidate, but applicability/model context is missing; no SKU was guessed.

## Native deliverables and backup

Existing ENTERNEWPART B:D corrected, derived source price AE repaired, and AR Description Quality added. ENP_DESCRIPTION_REVIEW contains all 65 rows with per-field status, issue codes, evidence, original text and audit time. ENP_COMPONENT_REVIEW stages the five unallocated components. Hidden ENP_DESC_BACKUP_20261020 preserves the full pre-repair sheet, including cost formulas.

Expected dependencies: newly recovered exact SKUs recalculate existing catalog formulas (IDs, names, vendor/category/cost). For example, item 12002138 now finds the existing item and its catalog cost. Clearing an invalid Paloform SKU removes its invalid lookup result. These formulas were not replaced; no dependency formula errors were observed.

## Reusable implementation

Hub menu/editor: hub_previewEnternewpartDescriptions is read-only; hub_applyEnternewpartDescriptionRepairs backs up the review tab, rechecks freshness, updates review columns, preserves original descriptions/authorization and performs readback. No trigger is installed or resolver activation performed. The component table is a separate review staging table, not an item-creation queue.

ENP's actual parser is patched in existing 02_striven_core.js, and the 98 guard uses the same parsing contract. Complete multiline names and correctly grouped prices are accepted; absent fields, malformed money, labels as identity and prose as SKU remain blocked. Unlabelled recovery is for Hub review and does not bypass the operational labeled-description gate.

Twenty-one parser/classification test groups, 25 existing parity groups, and five assembled-project checks (including equality across all 65 actual rows) passed locally without external calls. Deployment CI omits the private live-data fixture and runs the remaining four assembled-project checks.

## Sources inspected

User-provided descriptions and exact native Hub rows; full existing master Inventory and Hub DATA_ITEMS snapshots. Snapshot content is not proof of a fresh Striven API read. Vendor identity references:
- https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf — PDF page 57, manufacturer catalog/model pairs.
- https://duravent.com/literature/DV_BVGV_CT-001E_04-24_web.pdf — roof top termination kit 4BVK.

No internet price was used to overwrite a quote or infer CAD pricing/cost. No existing Striven catalog record was renamed or repriced; corrupted catalog records remain a separate cleanup task.
