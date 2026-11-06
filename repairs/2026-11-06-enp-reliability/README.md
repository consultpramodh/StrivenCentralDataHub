# ENTERNEWPART reliability audit — 2026-11-06

The live ENTERNEWPART.gs snapshot is backed up at `backups/2026-11-06-enternewpart-audit/ENTERNEWPART.gs`. The description preservation patch and focused test are staged, not deployed. The test was run with Node.js against the snapshot plus patch and three description cases passed. This is not a Striven integration test.

To reproduce from the repository root, copy the backup to `live_enternewpart_audit.js`, apply `repairs/2026-11-06-enp-reliability/description-preservation.patch` using `git apply`, then copy `repairs/2026-11-06-enp-reliability/description-preservation.test.cjs` to `test_description_repair.cjs` and run `node test_description_repair.cjs`. Do this only in an isolated working directory. The patch uses the local candidate filename and is not a deployment workflow.

The live trigger inspected on 2026-11-06 was a specific-date one-shot scheduled for 2026-11-02 14:00 Toronto. The executions page showed no later scheduled ENTERNEWPART execution. The item-group watchdog trigger was also expired. Verify trigger ownership and bridge recovery before enabling the worker. No changes were made to deployed code or triggers by this audit.

Outstanding: validate original text preservation with live Striven serialization and sales-order readback; validate CF820 behavior when other placeholders remain; repair queue reconciliation and stale records; verify item-level serial behavior; design recurring trigger recovery; and test execution end to end before enabling automatic production writes.
