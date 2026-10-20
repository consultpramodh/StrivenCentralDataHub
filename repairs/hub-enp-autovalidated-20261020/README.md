# Automatic validated ENTERNEWPART processing

The user explicitly requested automatic operation without routine manual approvals. The all-row worker now treats a fully validated Approved, Quoted or Manual row as authorized under that standing instruction. It does not require or rewrite the legacy Create Authorized or Quoted Authorization checkbox cells. The manual legacy validator and row-2 action remain intact; only the automatic planner supplies scoped virtual authorization after all data checks pass.

Explicit row status HOLD, PAUSED or DO NOT CREATE prevents execution. Completed rows are skipped. Missing metadata, unknown cost, identity/duplicate conflicts, unsupported serial YES/MAP, and live order mismatches still block. Live SO status, quantity and line price are checked; existing items are reused; captured IDs and uncertain-write parking are retained; CF820/readback and existing recovery remain unchanged.

The worker defaults to automatic mode unless explicitly paused. A dedicated timer still needs a successful Google Apps Script trigger installation. Deployment attempts hub_enableEnternewpartAutomation using existing remote credentials and verifies the returned installation marker. Activation failure does not roll back tested source, and is reported separately. No timer is claimed active without successful activation evidence.

Full Hub backup, native helper baseline, unresolved-helper checks, tests, concurrent-drift check, same-project push, full source comparison and rollback remain mandatory. Separate legacy project edits are neither imported nor overwritten.
