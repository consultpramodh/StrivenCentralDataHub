# Shared item resolution repair
Google Apps Script. Based on live source backup workflow 39444948073, not stale PATCH_SOURCE.

- Hub owns an ITEM_LOOKUP_REQUESTS shared queue. Up to five requests per five-minute worker execution, at most three filtered pages per number. HTTP 429 pauses the worker. No complete catalog search exists in the consumer.
- ItemNumber is a LIKE search in the current official API reference (https://api.striven.com/Help#post-/v1/items/search). Exact client comparison and complete filtered-result pagination are mandatory. A malformed, capped or ambiguous response blocks creation.
- ENTERNEWPART consumes DATA_ITEMS, verifies positive IDs against live Striven, and queues misses. It no longer downloads an item report per run. NOT_FOUND proof expires after 15 minutes.
- New items use Item Name (Item Number); already suffixed names stay unchanged. Existing Striven items are not renamed. Payload-specific 400/409/422 validation and uncertain POST outcomes park until reviewed; there is no automatic repeat POST.
- Operational project retains all Striven creation and Sales Order writes and existing eligibility. Hub review metadata is not promoted into creation authority.
- Activation: run hub_activateSharedItemResolver in the existing Hub editor. It backs up the Hub ENTERNEWPART review tab before standardizing names, installs the lookup worker and daily approximately 07:10 Toronto Items refresh, and resolves the two known thermostat part numbers read-only.
- Deployment backs up both live projects, checks expected pre-source hashes, preserves every unrelated live file/manifest, checks freshness, pushes the same IDs, compares every POST file and rolls back on deployment failure. No operational pipeline is invoked by deployment.
- Tests: node repairs/item-resolution-20261020/test.cjs (12 behavior groups).

A successful deployment is not proof of successful item creation or Sales Order replacement. Verify live lookup output and the subsequent eligible operational run separately. The Hub snapshot may remain old until its scheduled/manual refresh succeeds; live verification and filtered lookup cover item identity in the meantime.
