# ENTERNEWPART automatic/manual coordinator — staged only

Not deployed. Not end-to-end autonomous item creation.

Implemented: pure source parsing, source fingerprint deduplication, automatic Approved/manual Quoted routing, bounded intake refresh cadence, fresh canonical Items gating, unique SKU routing, column-A request consumption and note, source-price conflict handling, CAD supplier-list discount cost helper, and trigger installer. Module belongs inside the existing ENTERNEWPART 98_enp_item_resolution_guard source file, not a new Hub script file.

Verified offline: 10 routing/parser assertions; 65 captured-row integration with no unintended field writes; repeat-run no duplicates; manual request consumption; 4 supplier cost assertions; synthetic fixture run. Tests make no network calls. Run `node staged/enternewpart/test-coordinator.cjs` from the repository root. Optional private captured fixture via ENP_TEST_FIXTURE is not committed.

Not implemented: automatic online research integration, verified new-item payload mapping for all requested columns, remote item/SO verification or writes, global API admission, removal/cutover of old writer triggers. The coordinator does NOT replace legacy production writers. Do not install it as a claim that the old item-creation failures have been fixed. New items remain blocked rather than guessed.

User-confirmed costing: verified supplier list price × (1 − exact supplier/product-family discount), CAD. Missing price evidence or discount remains unresolved; no implicit currency conversion.

Deployment blockers: browser access to script.google.com is restricted in this session. Google documents that scripts.run cannot create Apps Script triggers. An authorized editor execution surface is required for installation after full code and release verification; no production push or trigger activation has been performed.

Exact PRE source backup: branch backup/live-hub-enternewpart-20261019. All 30 original source files were reconstructed from the redacted audit only where original hashes matched, then verified against GitHub blob hashes. The sole changed redaction was the nonsecret literal property name CLIENT_SECRET. No credential values were published.

Current source audit workflow is read-only and scoped to its work branch. It does not deploy Apps Script or call Striven mutation endpoints.
