# Deployment and sheet verification receipt — 2026-10-20

Run: https://github.com/consultpramodh/StrivenCentralDataHub/actions/runs/39456858513

Code commit: 14376ee87855bde2ff2045839eeaa3585c207f8e
Workflow commit: e485284a30a82376511129a192fea5cb0e60b5f9

- Both existing Apps Script project IDs retained.
- Full live PRE pulled, expected hashes and permanent backups matched, and a full backup uploaded before push.
- Independent downloaded artifact verification: all 8 Hub files and all 22 ENP files retained. Only Hub 10_Central_Hub.js and ENP 02_striven_core.js / 98_enp_item_resolution_guard.js changed. POST bytes match the tested patch.
- Artifact 12279744454 SHA256 independently verified: d0f3e9b61206e46e24a538b4072fca3551979a802ee974fc580145a5c172ff70.
- CI: 21 parser/classification groups, 25 legacy parity groups and 4 assembled-project groups passed; pulled-back POST repeated the 25+4 groups. All tests blocked external network calls.
- Local assembled-source tests also compared all 65 actual records with the standalone classifier and matched exactly.
- Native sheet re-read: 26 corrected rows, 60/65 with all three fields populated, 10 repaired derived source-price cells, zero formula errors, original descriptions/SO prices/creation authorization unchanged.
- Native Google rendering inspected for both review tabs. Five bundled source components remain unallocated and uncreated.

The deployed preview/repair menu functions were source-tested; they were not invoked against live data during this receipt. Sheet corrections were applied and read back through the native connector. No pipeline, ERP write, email, new trigger, resolver activation or catalog rename/reprice was executed. Existing installed triggers were not changed; future executions use the updated parser.

Remaining: five rows still lack definitive required fields or a component split; eleven rows have price/catalog conflicts and eight require identity review. Complete parsed fields are not equivalent to validated metadata or approval to create. Serial/MAP/reference-ID activation blockers from the previous work remain.
