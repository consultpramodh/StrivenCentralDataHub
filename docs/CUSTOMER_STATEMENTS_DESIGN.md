# Customer Statements: Map & Design

Status: **DESIGN — IN PROGRESS**. Home: `StrivenCentralDataHub`, branch `customer-statements`. Platform: Apps Script on the Hub, reusing `hub_strivenAccessToken_()` and Hub sheets. The full PDF / UI choice is confirmed after the probe.

## 1. Why

Striven's built-in customer statement:

- shows missing or wrong information: no job or PO reference, unclear deposits, confusing unapplied payments and credits;
- is not branded;
- cannot be generated in bulk or on a schedule;
- offers no control over scope: closed items show up, and there is no job or date filter.

The goal is a tool staff run on demand. It produces three statement types from live Striven data, with balances that reconcile to Striven.

## 2. Statement types and content

### Common header (all types)

| Element | Source |
|---|---|
| Logo, "Classic Fireplace & BBQ Store", address, phone, HST # | Static config (**address, phone, HST # and logo still needed**) |
| Customer name, customer # | `Customer.Name`, `Customer.Number` |
| Bill-to address | `Customer.BillToLocation` (fallback `PrimaryAddress`) |
| Attention / contact | `Customer.PrimaryContact` |
| Statement date / period | User input |
| Payment terms | `Customer.PaymentTerm` |
| Credit limit, credit hold | `Customer.CreditLimit`, `OnCreditHold` (**internal copy only**) |
| How to pay, AR contact | Static config |

Brand: dark `#202020`, accent red `#b42b2f`, background `#f4f3f1`. These match the existing CF email templates.

### A. Open-item statement: "What you owe today"

```
INVOICE #  DATE        DUE         JOB / PO               ORIGINAL   PAID      OPEN      DAYS OVER
INV-1042   2026-09-02  2026-10-02  Smith – Gas insert     4,520.00   2,000.00  2,520.00  48
INV-1077   2026-10-20  2026-11-19  Smith – Chimney cap      310.00       0.00    310.00   0
-----------------------------------------------------------------------------------------------
CREDITS & DEPOSITS NOT YET APPLIED
CM-0031    2026-10-05  Credit on account                                         (150.00)
PMT-8812   2026-11-01  Deposit received – not yet applied (SO-2210)              (500.00)
-----------------------------------------------------------------------------------------------
AGING      Current 310.00 | 1–30 0.00 | 31–60 2,520.00 | 61–90 0.00 | 90+ 0.00
TOTAL DUE                                                                       2,180.00
```

Rules:

- **Open invoices:** `OpenBalance > 0`, not voided.
- **Paid to date:** `InvoiceTotal − OpenBalance`.
- **Aging:** days past `DueDate` as of the statement date. "Current" means not yet due.
- **Credits and unapplied payments:** always listed in their own section with a plain-English label. They are never netted silently into invoice lines.

### B. Activity statement: "Everything in a period"

```
Opening balance at 2026-09-01                                       1,200.00
DATE        TYPE        REF        JOB / PO           CHARGES   CREDITS     BALANCE
2026-09-02  Invoice     INV-1042   Smith – Gas insert 4,520.00              5,720.00
2026-09-15  Payment     CHQ 554                                 2,000.00    3,720.00
2026-10-05  Credit memo CM-0031                                   150.00    3,570.00
...
Closing balance at 2026-11-19                                       2,180.00
```

Rules:

- **Opening balance:** rebuilt as of the start date (see §4, gap 2).
- **Transactions:** rows are sorted by `TxnDate`. Charges are invoices; credits are payments and credit memos. Voids are shown only on the internal copy.
- **Reconciliation:** the closing balance **must equal** the open-item total as of the end date. If it doesn't, the statement is flagged internally (§5).

### C. Job / project statement: "Where this job stands"

```
JOB  SO-2210  "Smith – Gas insert & venting"   Customer PO: 7781   Site: 12 Elm St
Contract (original)                       5,800.00
Change orders (2)                           420.00
Contract total                            6,220.00
Invoiced to date                          4,520.00
Paid / credited to date                   2,500.00   (incl. deposit 500.00)
Open on issued invoices                   2,520.00
Remaining to invoice                      1,700.00
--- detail: invoices, payments, credits linked to SO-2210 (and its change orders) ---
```

Rules:

- **Contract total:** the sales order `OrderTotal` plus the totals of child change orders (`IsChangeOrder`, `ParentId`).
- **Invoices linked to the job:** invoices whose `Order.Id` is the SO or one of its change orders.
- **Payments and credits linked to the job:** those applied to the job's invoices (`AppliedToInvoices`), plus deposits linked to the SO (see §4, gap 4).

### Options on the generate screen

| Option | Values |
|---|---|
| Customer | Search by name or # (`/v1/customers/search`) |
| Type | Open-item / Activity / Job |
| Date | As-of date (open-item), From–To (activity) |
| Job filter | All jobs, or one sales order |
| Include zero / fully paid items | Yes / No (activity and job only) |
| Show invoice line items | Yes / No |
| Copy | Customer-facing / Internal (adds credit limit, hold, voids, reconciliation result) |

## 3. Striven data map

Checked against `https://api.striven.com/swagger/v1/swagger.json`.

| Need | Endpoint | Search filters | Key fields |
|---|---|---|---|
| Customer | `GET /v1/customers/{id}`, `/locations`, `/contacts` | — | Name, Number, BillToLocation, PrimaryContact, PaymentTerm, CreditLimit, OnCreditHold, CustomFields |
| Find customer | `POST /v1/customers/search` | name / number | Id, Name, Number |
| Invoices | `POST /v1/invoices/search` → `GET /v1/invoices/{id}` | `CustomerId`, `WithOpenBalanceOnly`, `DueDateFrom/To`, `DateCreatedFrom/To` | TxnNumber, TxnDate, DueDate, InvoiceTotal, OpenBalance, Status, Order, LineItems |
| Payments | `POST /v1/payments/search` → `GET /v1/payments/{id}` | `CustomerId`, `WithOpenBalanceOnly`, `DateCreatedRange` | TxnDate, ReferenceNumber, PaymentMethod, PaymentAmount, UnappliedAmount, Status, `AppliedToInvoices[] {TxnId, Amount, DateApplied}` |
| Credit memos | `POST /v1/credit-memos/search` → `GET /v1/credit-memos/{id}` | `CustomerId` | TxnNumber, TxnDate, total, OpenBalance, Status, Order, `AppliedToInvoices[]` |
| Jobs | `POST /v1/sales-orders/search` → `GET /v1/sales-orders/{id}` | `CustomerId` | OrderNumber, OrderName, CustomerPONumber, Project, OrderTotal, IsChangeOrder, ParentId, ShipToLocation, InvoiceStatus |
| Fallback / bulk | `GET /v2/reports/{accessKey}` | custom report | report-defined (e.g. existing "Transactions Raw") |

Auth uses client credentials: `POST https://api.striven.com/accesstoken` with Basic `clientId:clientSecret`. This is the same flow as `StrivenCentralDataHub` `hub_strivenAccessToken_()`.

## 4. Known data gaps and how they are handled

| # | Gap | Handling | Probe confirms |
|---|---|---|---|
| 1 | Search cannot filter on `TxnDate`, only on created or updated date | Pull every transaction for the customer by `CustomerId`, then filter locally | Volume per customer stays fast enough |
| 2 | No "balance as of date" API | Opening balance = invoices with `TxnDate < start` − applications with `DateApplied < start` − unapplied payments and credits dated `< start`. Cross-check: rebuilt balance today = Σ `OpenBalance` | Rebuilt balance matches to the cent |
| 3 | Invoices don't list what was applied to them; no refunds endpoint | Reverse `AppliedToInvoices` from payments and credit memos. Refunds: TBD (journal entry? negative payment?) | How refunds appear |
| 4 | Deposits on sales orders | Expect unapplied payments. Link them to the SO by memo, reference or custom field; otherwise use a custom report | How a deposit is recorded and linked |
| 5 | Voids and status values | Exclude by `Status`; show on internal copy | Exact status names and ids |
| 6 | Historical / non-posting records (`IsHistoricalNonposting`) | Show as normal, but flag them in the internal copy | Whether any exist |

## 5. Architecture (platform-neutral)

```
Striven API ─► Fetch layer ─► Normalized ledger ─► Builders ─► Reconciliation ─► HTML template ─► PDF
```

1. **Fetch layer.** Gets the token, pages through searches (`PageIndex`, `PageSize`), fetches details, retries, and caches per customer. It is read-only.
2. **Ledger.** Converts records into two shapes:
   - Each transaction becomes `{type, id, number, txnDate, dueDate, jobId, amount, openBalance, status}`. Charges are positive; credits are negative.
   - Each application becomes `{fromId, toInvoiceId, amount, dateApplied}`.
3. **Builders.** Pure functions:
   - `buildOpenItem(ledger, asOf)`
   - `buildActivity(ledger, from, to)`
   - `buildJob(ledger, salesOrderId)`
4. **Reconciliation guard.** Checks that the activity closing balance equals the open-item total, and that the computed open total equals Σ Striven `OpenBalance`. If either check fails, a customer-facing copy can't be produced until someone overrides it.
5. **Renderer.** One branded HTML template with sections per statement type. PDF output comes from Google Drive export (Apps Script) or headless Chromium (Node).
6. **Staff UI.** Search a customer, choose type and options, preview, then download the PDF.
   - Optional: attach the PDF to the customer in Striven (`POST /v1/customers/{id}/hub/documents`). This would be the only write.

**Platform:** an Apps Script web app on the Hub.

- Reuses the Hub's Striven token, its Script Properties credentials and Sheets.
- PDFs are produced through Google Drive export (HTML → PDF).
- The fetch layer, ledger and builders stay as plain JavaScript functions, so they could move to Node later if PDF quality needs it.
- Apps Script's 6-minute execution limit is fine for one customer on demand. Detail reads are batched with `UrlFetchApp.fetchAll`.

## 5a. Running the data probe

The probe is `hub_probeCustomerStatements()` in `PATCH_SOURCE/10_Central_Hub.js`, inside the `HUB_STATEMENT_PROBE_R1` block. It only reads from Striven.

1. Get the code into the live Hub: either deploy the `customer-statements` branch, or paste the block into `10_Central_Hub` in the Apps Script editor.
2. In Project Settings → Script Properties, set `STATEMENT_PROBE_CUSTOMER_IDS` to the customer IDs, comma-separated (e.g. `52933,1234,5678`).
3. Run `hub_probeCustomerStatements` and check these tabs:
   - **`STMT_PROBE_SUMMARY`:** one row per customer, with totals, statuses, deposit candidates and job links.
   - **`STMT_PROBE_MISMATCH`:** invoices where *total − applied payments and credits* does not equal Striven's `OpenBalance`. Each one points to a refund, journal entry or other adjustment we need to handle (gap 3).
   - **`STMT_PROBE_RAW`:** the full JSON of every record, for checking field names.

## 5b. Findings from the live Hub sheet (2026-11-19)

**An A/R module already exists to reuse.** Branch `feature/open-balance-rep-reports` (`OpenBalanceDistribution.gs`, `OPEN_BALANCE_WEEKLY/WeeklyOpenBalanceTuesday10.gs`) already does the following:

- Pulls a Striven **open-balance custom report** (Script Property `STRIVEN_OPEN_BALANCE_REPORT_URL`, `/v2/reports/...`) into `DATA_OPEN_BALANCES`. The 2026-10-06 refresh brought in 274 rows: 86 invoices and 188 payments.
- Ages invoices with `obBuildInvoiceAging_()` (Current / 1–30 / 31–60 / 61–90 / 90+). This is the same bucket logic statements need.
- Builds branded HTML for Gmail in `obBuildEmailHtml_()`, with a size guard and splitting so Gmail doesn't clip it.
- Uses `obStrivenApiRequest_()` / `obGetStrivenAccessToken_()` with retry and token refresh, and parses search pages with `obExtractInvoiceSearchPage_()`.

Statements should share these helpers rather than copy them. The open-balance report also gives a fast way to list every customer with a balance, which is useful for picking which customers to generate statements for.

**How deposits appear (gap 4, partly answered).** In `DATA_OPEN_BALANCES`, deposits are **payments with a negative open balance**, and the memo holds the sales-order number:

- `Deposit 581961`
- `Deposit custom Ortal Chatsworth`
- `584983` (memo is just the number)

Part-applied payments use the memo `Payment for: Invoice 595451`. So the job link for deposits can be parsed from the memo: a 6-digit number that matches a sales order for the same customer. When it can't be matched, the deposit falls back to "Deposit – job not identified" on the statement.

**JSON casing.** Live Striven responses are **camelCase** (`openBalance`, `appliedToInvoices`, `txnDate`), even though the swagger file shows PascalCase. The probe normalizes keys with `hub_stmtPascalKeys_()`.

**Sales rep is available.** Invoice detail includes `salesRep`. It isn't in the swagger file, but it was verified in `PO_DATA_CONTRACT_PROBE`. Statements can show "Your sales rep: …" from it.

## 6. Verification plan

- **Probe:** for each sample customer, the computed open total equals Σ `OpenBalance` (to the cent).
- **Activity:** for a past period, the closing balance equals the open-item total as of the period end.
- **Job:** one job statement is checked by hand against the SO and its invoices in Striven.
- **Accounting review:** accounting compares the PDF side by side with the current Striven statement for the same customer.

## 7. Open inputs

- Company address, phone and HST number; logo; payment instructions (e-transfer email, cheque payee, card link).
- How deposits are entered in Striven today.
- 3–5 sample customers: one with a deposit, one with credits, one with an overdue job.
