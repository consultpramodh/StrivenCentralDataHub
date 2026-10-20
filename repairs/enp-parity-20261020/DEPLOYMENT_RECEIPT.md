# Verified deployment receipt — 2026-10-20

Deployment: https://github.com/consultpramodh/StrivenCentralDataHub/actions/runs/39452620975

- Code commit: 1c824505cde464270b993e781f078d0f3f1e32d7
- Deployment workflow commit: 6f0945234b20506f802604c762f0cd8701670c6f
- Same ENTERNEWPART Apps Script project: 1VbXsIFdiO_2Uo2wW_K6Dc64EFkp0x4POzs8yOuL-GjaaeeSOJy-iprPj
- Live PRE matched all expected baseline hashes and permanent three-file backups.
- Full PRE backup uploaded before push; freshness comparison passed.
- Pulled-back POST retained all 22 project files. Exactly files 03, 05 and 98 changed; their bytes match the tested patch. All other files retained exactly.
- 25 behaviour groups passed against the pulled-back POST source; external network attempts in tests: 0.
- An additional local preview check used freshly read Hub values: 65 actual records, 0 authorized, 0 ready, no writes or Striven calls.
- Downloaded artifact SHA256 independently matched 9923232c937575fd010b734b6b22b8b35b369ab5514bd2a3005cf52def5e05f7.

Backups: permanent three-file PRE in this folder; full PRE/POST artifact 12279537661 and pre-push backup artifact 12278913235, retained until 2026-11-19.

No pipeline, resolver activation, trigger installation, email, item creation or Sales Order update was executed by the deployment/test commands. Existing installed triggers were not changed or inventoried; they can subsequently use the updated source. No live order write/readback acceptance test has been performed.

**Not full activation:** new item POSTs are gated by Hub authorization, review status, unique source identity, currency, verified reference IDs, cost and unsupported-field checks. Serial tracking remains an explicit blocker for every new candidate; populated MAP price remains a blocker too. Existing verified item reuse is retained. Resolve the supported serial/MAP path and reference data before any eligible production creation test.
