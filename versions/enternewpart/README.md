# ENTERNEWPART — script versions

**The latest version is always `LATEST.gs`** (identical copy of the newest dated file below).
To confirm what is live: compare the first lines of the Apps Script file (`Version …`) and its SHA-256 with the row marked **LIVE**.

| File | Version header | Date | Collected from | SHA-256 (12) | Status |
|---|---|---|---|---|---|
| `2026-11-17_R6.1.gs` / `LATEST.gs` | 2026-11-17-R6.1 (current-report-only, live-item-first) | 2026-11-17 | R6 + best of R5.1 | 84f9e515b4d0 | **LIVE** in the Central Hub project (since 2026-11-17 13:03) |
| `2026-11-17_R6_LIVE.gs` | 2026-11-16-R6 (current-report-only) | 2026-11-17 | `backup/live-hub-enternewpart-20261019` (89ba24a) | 71b6570735cd | Superseded by R6.1 |
| `2026-11-11_R5_current-report-only.gs` | 2026-11-11-R5.1 (current-report-only, live-item-first) | 2026-11-11 | `fix/enp-current-report-only-20261111` (6efc2c4) | 315638e436f2 | Superseded (best parts merged into R6.1) |
| `2026-11-11_R5_research-extraction.gs` | 2026-11-11-R5 (current-report-only) | 2026-11-11 | `fix/enp-r5-research-extraction-20261111` (96634e3) | d05748c3a5aa | Superseded (base of R6) |
| `2026-11-09_end-to-end-distribution.gs` | 2026-11-09-R4 | 2026-11-09 | `fix/enp-end-to-end-distribution-20261109` (8e108a3) | ef3715d00f6a | Superseded |
| `2026-11-06_audit.gs` | (no header) | 2026-11-06 | `work/enternewpart-consolidation-20261028` (8dfe4e5) | c7e42bd383e5 | Superseded |

Earlier, multi-file era (not copied here, already in this branch / their branches):
- 2026-10-19 legacy ENP project (ActionHub, R2.3 Item Group bridge): `backups/2026-10-19-live/PRE_ENP/src/`
- 2026-10-19 Hub design: `docs/ENTERNEWPART_HUB_DESIGN.md` on `design/enternewpart-hub-20261019`
- 2026-10-19 staged autonomy prototype: `staged/enternewpart/` on `work/enternewpart-automation-20261019`
- 2026-10-20 repairs (cost, description, parity, legacy execution): `repairs/` on `work/enternewpart-consolidation-20261028`

## R6.1 = R6 + the best of R5.1
- **From R5.1:** live-item-first (an SO line whose SKU already exists in Striven is replaced with that item without new-item metadata; the line shows the item's own description) and category-only transfer from exact catalog product-name matches.
- **Kept from R6 (instead of R5.1's hold):** a price followed by a note such as "to be confirmed" is accepted only when it equals the live SO line price; the note stays visible on the SO line.
- Everything else in R6 is unchanged (official-source research, discount → cost formulas, archive/compaction, Item Group bridge, Manual parts, description rewrite).

## Rules for the next version
1. Add a dated file `YYYY-MM-DD_<version>.gs`, replace `LATEST.gs`, add a row here, mark the old LIVE row Superseded.
2. Do not push `PATCH_SOURCE/**` to `main` unless you intend to deploy: `deploy-apps-script.yml` deploys the Central Hub to Apps Script on every such push.
