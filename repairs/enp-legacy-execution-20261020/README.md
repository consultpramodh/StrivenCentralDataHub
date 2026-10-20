# Scoped legacy execution bridge

Manual Apps Script entry point: `enp_runHubRow2CreateAndReplace` in the existing ENTERNEWPART project. Preview: `enp_previewHubRow2CreateAndReplace` (sheet reads only).

This action is pinned to Hub row 2, G190-0004-SER, SO 27771 / 586037, quantity 2, CAD price 3 and cost 1.8. It checks current authorization and live SO status/line quantity/price, performs bounded exact item search, resolves metadata IDs from live item witnesses, creates or reuses the item with existing retry guards, captures its ID, and invokes the existing replacement engine (including CF820 and full order readback checks). Other rows and triggers are untouched.

Serial tracking NO uses a SKU-scoped legacy request policy: serial controls are omitted as in the legacy request. No unsupported serial field is invented; independent serial tracking verification is unavailable. Serial YES and MAP remain blocked.

The workflow backs up the entire live project, checks the two baseline files and concurrent changes, runs prior parity and new boundary tests, updates only two files, verifies the full project after push, and restores the backup on deployment failure. Tests mock all external calls; deploying does not execute an item create or order update. Remote execution currently requires Apps Script execution authorization unavailable to clasp.
