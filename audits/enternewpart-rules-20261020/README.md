# ENTERNEWPART parity audit — 2026-10-20

## Conclusion

Retain ENTERNEWPART as the operational writer and connect validated Hub metadata to it. The Hub is not yet a replacement for the complete workflow. In particular, the Sales Order custom-field layer already exists in the replacement engine and must remain part of its single order update.

Evidence: fresh read-only live Apps Script snapshot from workflow run 39450436475, captured 2026-10-20 15:39 UTC. Compared with the earlier snapshot, only the previously deployed 98_enp_item_resolution_guard.js changed. Installed triggers, live custom-field definitions and actual order writes were not exercised.

## Feature inventory

| Rule / feature | Live ENTERNEWPART behaviour | Hub integration requirement |
|---|---|---|
| Sales Order custom field 820 | Set to option/value 556, “New Items created + SO Updated”, in the same POST as the item replacement; subsequent GET verifies it | Preserve this existing writer; do not add a second CF-only POST |
| Other custom fields | Payload mapper carries field metadata, false, zero and option values; readback verifies required fields | Preserve mapper; strengthen readback for other fields where appropriate |
| Approved / Quoted gates | Quoted queue requires actual boolean TRUE in SendToActions | Carry the gate; Hub Create Authorized must also be explicitly checked before creation |
| Item identity and name | Strict labelled description validation; canonical Item Name (Item Number); shared lookup guard and existing-item reuse | Retain exact identity matching, ambiguity rejection and no duplicate creation on uncertain POST |
| Target order line | Prefer Line ID, validate placeholder/new item identity, labelled SKU and quantity; reject ambiguous fallback matches | Retain exact targeting and idempotent handling of already replaced lines |
| Replacement values | Sets requested price and retains quantity; selects inventory location with existing-line preference | Add explicit target quantity and price readback checks |
| Item Groups | Rejects replacement with a group; verifies existing order group children; temporary group-master bridge has journal/watchdog and restore logic | Requires dedicated failure/restore regression tests before changes; bridge temporarily mutates shared master data |
| Item creation metadata | Existing builder uses basic identity, price, cost and property-configured type/accounts/location | Connect explicit Hub columns for category, vendor, manufacturer, part number, serial tracking, tax/type/location and verified cost; no positional column mapping |
| Cost | Blank cost currently falls back to zero | Block unverified/missing cost rather than silently inventing zero; zero remains valid when explicitly sourced |
| Queue / retries | ActionHub dedupe, fresh source-row reads, batch 25, maximum 6 attempts and bounded retry delay | Preserve state, created Item ID and retry classification |
| Logging / alerts | Operational Logbook, run IDs, business-failure propagation, authentication preflight and alert cooldowns | Retain; invalid-description rep alerts currently configured in TEST MODE |
| Manual creation | Separate selected-row creation path, canonical naming, lookup guard | Apply the same validated Hub metadata and authorization policy |

## Custom-field implementation

In `03_enternewpart_sync_and_actions.js`, `enp_replaceSalesOrderItemsLocked_` builds the complete order payload, calls `enp_applyCf820ToReplacementPayload_`, posts `/v1/sales-orders`, then calls `enp_verifySalesOrderReplacement_` after a fresh GET. `enp_mapCustomFieldForPost_` preserves the outgoing field properties. Configuration is in `01_config_menu.js`.

Standalone `enp_updateCF820_selectedRows` / `enp_updateCF820_bySOId_` also exist. They perform a separate full-order update and should not be migrated as the default path: they lack the integrated replacement/readback safeguards. Source comments also warn against a second CF-only update with Item Groups.

Conditional issue: if field 820 is marked required on an order, the generic “required fields unchanged” comparison conflicts with its intentional value change. Local fixtures reproduce this; the live required flag is unknown. Exempt only the intended 820 transition and verify its exact expected value separately.

## Verification

Run `node test_rules.cjs <live-snapshot-ENP-src-directory>` using a read-only source snapshot. Fourteen local behaviour groups passed with **zero external network attempts**. The suite verifies description parsing, canonical naming, Quoted authorization, exact line selection, replacement values, custom-field mapping/update/idempotence, required-field and CF820 readback, incorrect item/line rejection, retry/test-mode configuration, and reproduces the missing-cost, quantity/price verification and conditional required-820 gaps.

Thirteen duplicate active function definitions have identical bodies in the snapshot. Commented-out legacy blocks were excluded from the function inventory. Consolidation is useful later but is not required to preserve current behaviour.

## Implementation order

1. Patch replacement readback to verify expected quantity and price; handle the intentional required-820 change explicitly, with preservation assertions for unrelated fields.
2. Add a header-based Hub-to-item payload adapter. Use fixed location `60 - WAREHOUSE (Ajax)`, Taxable `Yes`, Item Type `Inventory`; resolve required API IDs. Preserve verified master-sheet metadata, exact SKU identity and explicit authorization. Block missing required cost/identity instead of defaulting silently.
3. Exercise Approved, Quoted, manual, already-existing item, retry-after-create, malformed source and Item Group failure/restore cases without production writes.
4. Validate one explicitly authorized eligible end-to-end case, including order line and custom-field readback, before broad activation.

The shared resolver activation remains pending; this audit did not create/install triggers, run the pipeline, send email, create items or modify Sales Orders. Source presence is not evidence that a trigger is installed or that live writes have passed.
