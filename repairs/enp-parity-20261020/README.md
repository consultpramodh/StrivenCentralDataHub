# ENTERNEWPART parity repair — Google Apps Script

This patch retains the existing operational writer and changes only files 03, 05 and 98 in the same bound ENTERNEWPART project. It does not install triggers, activate the shared resolver, run a pipeline or send messages.

## Changes

- Verify target quantity equals the original order quantity and price equals the requested order-line price after the same order POST. Missing, boolean and nonfinite numeric values fail verification.
- Allow the intended CF820 transition to 556 even when required; continue verifying that exact expected value. Reject duplicate CF820 fields before posting and on readback. Preserve and verify every other existing custom field, including false, zero and selected-option properties.
- Preserve absent creation cost as null in both builders. Repair manual creation's call to a helper absent from the live project by using the existing idempotent canonical-name helper.
- Verified existing-item reuse remains before the new-creation gate. For a NEW item, require one exact Hub SKU row, boolean Create Authorized, READY review state and boolean Quoted Authorization for Quoted rows. Duplicate SKU rows block because the item-only interface cannot safely borrow another order's authorization.
- Map supported metadata by unique header names: Name, Description, Price, Cost, Category, PreferredVendor, Manufacturer, ManufacturePartNumber, BarcodeValue, ItemType and DefaultInventoryLocation. Keep explicit zero and UPC leading zeros. The Sales Order price remains the original requested line price; Hub item price does not override it.
- Keep location `60 - WAREHOUSE (Ajax)`, Taxable Yes, Item Type Inventory. Require exact verified reference IDs instead of turning labels into guessed IDs. No reference-search API calls are added.
- Add `enp_previewHubItemCreation`, a read-only editor entry point returning candidates/blockers with zero Striven calls and zero writes.

## Deliberate unresolved block

**This is not full activation of new-item creation.** The official POST /v1/items schema inspected on 2026-10-20 does not expose serial tracking or MAP price. Every candidate retains the serial-tracking requirement as an unsupported-field blocker, even when blank or NO; populated MAP price (including zero) is also a blocker. The production guard refuses a POST while these requirements lack a verified write path. Candidate payload mapping can be inspected without representing it as ready to create.

Next implementation step: establish the actual supported serial-tracking/MAP write mechanism in Striven, populate verified reference IDs and company currency, and bind source/order identity for repeated SKUs before an eligible end-to-end write test. Do not remove the blocker merely to get a green result.

Reference registry Script Property `ENTERNEWPART_HUB_REFERENCE_IDS` is JSON with `BaseCurrency` and arrays keyed by `ItemType`, `DefaultInventoryLocation`, `Category`, `PreferredVendor`, `Manufacturer`. Each reference requires exact `Name`, positive integer `Id`, boolean `Verified: true` and a nonblank `Evidence` source. No production IDs or currency were populated in this repair.

## Verification and deployment

26 local behaviour groups passed using the complete live snapshot with these three files overlaid. Tests use synthetic IDs and forbid external network access. A read-only connector fetch of the current Hub was exercised locally: 65 actual records, 0 authorized, 0 ready, 0 writes and 0 Striven calls. No customer data is stored in this folder.

Run: `node repairs/enp-parity-20261020/test.cjs <complete-ENP-src-directory>`; optionally provide a private Hub grid JSON path as the second argument for preview testing. Without that private grid, 25 behaviour groups run.

PRE files and PRE_SHA256.json preserve the three exact source files audited. The dedicated deployment workflow pulls a full live PRE, checks these expected hashes and permanent backups, overlays only these files, tests the complete project, checks freshness, pushes the same project and pulls POST for a full source comparison. Failure attempts rollback. Full PRE/POST source is retained as a workflow artifact. Installed schedules and Striven data are not changed by deployment commands.

Existing Item Group bridge, queue/retry logic, logging, notification test mode and other files are preserved. Source verification is distinct from a live order-write test; no such write test was performed for this repair.

Official schema inspected: https://api.striven.com/Help#post-/v1/items
