# Customer Statements (AR) — Project Board

Branch: `customer-statements` (StrivenCentralDataHub). Not merged to `main`, so it is not deployed.
Design: [`CUSTOMER_STATEMENTS_DESIGN.md`](CUSTOMER_STATEMENTS_DESIGN.md)

| # | Work item | Status | Notes |
|---|---|---|---|
| 1 | Statement content & Striven field map | IN PROGRESS | Design doc |
| 2 | Read-only data probe | TESTING / VERIFY | `hub_probeCustomerStatements()`; mock-tested, needs a real run on 3–5 customers |
| 3 | Review probe results + layout mock-ups | PLANNED | Resolve gaps 2–5 (refunds, deposits, statuses) |
| 4 | Ledger + statement builders (open-item, activity, job) | BACKLOG | Pure JS inside the Hub |
| 5 | Branded HTML template + PDF via Drive | BACKLOG | Needs logo, address, phone, HST # |
| 6 | Staff on-demand UI (Apps Script web app) | BACKLOG | Search customer → type/options → preview → PDF |
| 7 | Attach PDF to customer in Striven | GOOD TO HAVE | `POST /v1/customers/{id}/hub/documents` (only write) |
| 8 | Monthly batch email with review step | IDEA | Not in current scope |

## Open inputs
- Company address, phone, HST number; logo file; payment instructions.
- How deposits are recorded in Striven today.
- 3–5 sample customer IDs (one with a deposit, one with credits, one with an overdue job).
