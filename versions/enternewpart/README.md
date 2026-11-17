# ENTERNEWPART — script versions

**The latest version is always `LATEST.gs`** (identical copy of the newest dated file below).
To confirm what is live: compare the first lines of the Apps Script file (`Version …`) and its SHA-256 with the row marked **LIVE**.

| File | Version header | Date | Collected from | SHA-256 (12) | Status |
|---|---|---|---|---|---|
| `2026-11-17_R6_LIVE.gs` / `LATEST.gs` | 2026-11-16-R6 (current-report-only) | 2026-11-17 | `backup/live-hub-enternewpart-20261019` (89ba24a) | 71b6570735cd | **LIVE** in the Central Hub project |
| `2026-11-11_R5_current-report-only.gs` | 2026-11-11-R5.1 (current-report-only, live-item-first) | 2026-11-11 | `fix/enp-current-report-only-20261111` (6efc2c4) | 315638e436f2 | Superseded — see gap below |
| `2026-11-11_R5_research-extraction.gs` | 2026-11-11-R5 (current-report-only) | 2026-11-11 | `fix/enp-r5-research-extraction-20261111` (96634e3) | d05748c3a5aa | Superseded (base of R6) |
| `2026-11-09_end-to-end-distribution.gs` | 2026-11-09-R4 | 2026-11-09 | `fix/enp-end-to-end-distribution-20261109` (8e108a3) | ef3715d00f6a | Superseded |
| `2026-11-06_audit.gs` | (no header) | 2026-11-06 | `work/enternewpart-consolidation-20261028` (8dfe4e5) | c7e42bd383e5 | Superseded |

Earlier, multi-file era (not copied here, already in this branch / their branches):
- 2026-10-19 legacy ENP project (ActionHub, R2.3 Item Group bridge): `backups/2026-10-19-live/PRE_ENP/src/`
- 2026-10-19 Hub design: `docs/ENTERNEWPART_HUB_DESIGN.md` on `design/enternewpart-hub-20261019`
- 2026-10-19 staged autonomy prototype: `staged/enternewpart/` on `work/enternewpart-automation-20261019`
- 2026-10-20 repairs (cost, description, parity, legacy execution): `repairs/` on `work/enternewpart-consolidation-20261028`

## Known gap: R5.1 fixes not in R6
R6 was built from R5, not R5.1. R5.1 has, and R6 lacks:
1. Live-item-first: an SO line whose SKU already exists in Striven is replaced with that item without requiring new-item metadata.
2. Category-only transfer from exact catalog product-name matches.
3. `SOURCE_PRICE_UNCONFIRMED` hold for descriptions containing "please confirm" / "to be confirmed" (R6 instead accepts a noted price only when it equals the SO line price).

## Rules for the next version
1. Add a dated file `YYYY-MM-DD_<version>.gs`, replace `LATEST.gs`, add a row here, mark the old LIVE row Superseded.
2. Do not push `PATCH_SOURCE/**` to `main` unless you intend to deploy: `deploy-apps-script.yml` deploys the Central Hub to Apps Script on every such push.
