# ENTERNEWPART safety and scheduler repair — 2026-11-09

## Status
**Staged and code-reviewed; NOT DEPLOYED.** This folder contains a full replacement for the extracted `ENTERNEWPART.js` Apps Script. Do not paste it alongside another copy of the same functions or constants. Preserve the live shared Hub utilities and existing script project. Use controlled clasp deployment with a pre-deployment source snapshot and post-deployment readback.

## Findings
- Live sheet sample: 100 requests, 24 COMPLETED, 51 NEEDS REVIEW, 5 EXECUTION BLOCKED, 20 ITEM READY — REPLACEMENT BLOCKED (read 2026-11-09).
- Old one-shot schedule could expire (documented on 2026-11-06), leaving no automatic run.
- Report import required already-blank rows and failed wholesale for one invalid/duplicate row.
- Worker fetched the full report after every completed row.
- SO replacement overwrote the source line description.
- Temporary *shared Item Group master* mutation was globally unsafe and not transaction-safe.
- SO updates can be blocked by required custom fields, notably CF775 and CF831, without a verified value.
- CF820 was marked complete for a partial order.

## Change scope
- Dedicated recurring Toronto daily 10/14/16 triggers; no extra report-polling schedule. Google clock triggers are approximate (nearMinute ±15 min).
- Sheet rows grow when necessary; duplicate or unsupported report rows are isolated to warnings.
- Preserve user filters and source descriptions; no new line breaks; full report pulled only once per normal scheduled run.
- Revalidate current SO status and required fields; verify untouched line quantities/prices/descriptions.
- Stop SO writes on divergent Item Group transactions rather than mutate shared master records.
- CF820 is set only after the last placeholder is replaced.
- Existing created Striven Item IDs remain associated with their queue rows.

## What is NOT implemented or verified
- No live Striven creation, SO POST, trigger installation, Apps Script deployment, or rollback was performed as part of this commit.
- For already-blocked orders with missing CF775/831: correct the fields on the SO using authoritative business decisions; do not guess required values.
- Dynamic manufacturer research using AI/NVIDIA or other vendor keys is not implemented in this repair.
- SO transactions with customized Item Group children still require a verified transaction-safe write API. Those remain intentionally blocked.
- Queue rows with indistinguishable SO descriptions/quantities/prices require source LineId for safe automatic reconciliation.
- If one clock event never fires, this code cannot detect the missed slot without an external health monitor. Review executions daily until stable.

## Controlled release
1. Back up the live Apps Script project. Confirm its current file inventory and that there is no duplicate copy of these global functions.
2. Diff the live extracted `ENTERNEWPART.js` against this file, merge any intervening fixes, and syntax-check all files.
3. In an isolated Apps Script test project, run `hub_previewEnternewpartAutomation()` and `hub_refreshEnternewpartReport()` with mocked/readonly source as appropriate. Verify row identity and avoid accidental production writes.
4. Test with an existing unblocked SO, then a specifically approved low-risk SO; verify actual new Item ID, exact SO LineId, Qty, unit price, original description, unchanged other lines, and CF820 rules by readback.
5. Run `hub_enableEnternewpartAutomation()` only when all checks pass and confirm exactly three owned recurring triggers. Review actual 10/14/16 logs (Toronto) for skipped/missing runs.
6. Capture post-run audit and deploy receipt. Keep only five active Apps Script deployments if the deployment method creates versions. Do not prune source code history.

## Local verification
A companion offline Node.js harness performed 29 assertions against the separately generated local patch, including simulated report-row growth, duplicate handling, trigger idempotency, required field preflight, description retention, and Item Group safety. The GitHub copy must still pass its own CI and production integration checks before deployment.
