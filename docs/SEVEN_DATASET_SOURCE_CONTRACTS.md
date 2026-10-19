# Seven required Central Hub datasets — source contract audit

Date: 2026-10-19. Status: source discovery and schema inspection complete; population/cutover NOT complete.

## Requirement

The ENTERNEWPART redesign must consume shared central datasets and route reusable bulk reads through the Central Data Hub. Required scope: DATA_ITEMS, DATA_CUSTOMER_ASSETS, DATA_TASKS, DATA_SALES_ORDERS, DATA_SO_DETAILS, DATA_TRANSACTIONS, DATA_CUSTOMERS.

These are shared datasets, not seven copies of the 65 ENTERNEWPART request rows. Loading a partial project-specific cache is not a full canonical backfill. Existing data, triggers, source functions and aliases must be preserved until validated cutover.

## Live findings

Checked the actual Hub workbook, its seven target tab headers, REFRESH_CONTROL, DATASET_REGISTRY, and REPORT_REGISTRY. DATA_ITEMS has a recorded successful refresh on October 7, 2026 with 19,286 rows and 39 calls. Its Enabled flag is false. The other six requested DATA_ tabs contain only four-row SCHEMA_PENDING_SOURCE_AUDIT placeholders; their REFRESH_CONTROL entries are disabled pending source audit. Grid dimensions are not populated record counts.

Source registry classifications are guesses: e.g. discovered web-page URLs and token requests are mixed into dataset guesses. Do not treat a Dataset Key or URL alone as an approved source contract.

## Candidate sources and validation gates

| Dataset | Inspected candidate source | Actual inspected fields / grain | Remaining gate |
|---|---|---|---|
| ITEMS | Hub DATA_ITEMS and existing hub_refreshStdItems implementation | ItemNumber, Id, ItemName, ItemCategory, Cost, Price, MAPPricing, Taxable, ItemType, PreferredVendor, Description, Manufacturer, LocationName, ItemsSKU, ItemsUPC | Existing schema is established; verify live source property, completeness/active-inactive scope, duplicate SKUs, freshness and scheduled call budget before refresh/cutover. |
| CUSTOMERS | CF Tasks Source Customers; Assets Striven_Customers | Tasks has Customer ID, Customer Number, Name, Primary Phone, Primary Email, Fingerprint. Assets additionally carries ContactId and address fields. A repeated Customer ID=1 has different names/contact records in both inspected sources. | These caches mix customer identity with contact-level data. Obtain a customer-master feed; do not deduplicate by taking the first/last name or flatten different contacts into invented primary fields. |
| CUSTOMER_ASSETS | Assets workbook, Striven Customer Assets | AssetId, AssetType, AssetName, CustomerCustomerId, CustomerName, CustomerPrimaryPhone, DatePurchased, BBQManufacturerName, BBQModelNumber, BBQSerialNumber, FireplaceManufacturerName, FireplaceModelNumber, FireplaceSerialNumber | Verify unique asset ID, customer relationships, full feed scope, types/serial semantics, source refresh timestamp and pagination. Do not synthesize installed assets from catalog creation. |
| TASKS | CF Tasks active workbook, Source Tasks | Task ID, Task Number, Task Type ID, Task Type, Status, Name, Customer ID, Location ID, Contact ID, Order ID, Start, Due, Assignees, Pools, URL, Fingerprint | Verify full task scope (not only selected verticals), unique ID, complete pages, status/date/zone semantics, source refresh time. Preserve multi-assignee/pool relationships. |
| SALES_ORDERS | CF Tasks active workbook, Source Orders | Order ID, Order Number, Customer ID, Location ID, Contact ID, Status, Name, Order Type, URL, Fingerprint | Inspected rows include SALES_ORDER and WORK_ORDER. Filter using verified type semantics and preserve internal record ID versus display order number. Missing cached statuses must remain unknown; verify source coverage and completeness. |
| SO_DETAILS | Shopify/Striven SYNC, Striven Sales Order Details | SalesOrderID, SONumber, SOName, ItemNumber, ItemName, Description, Quantity, Price, InventoryLocation, CustomerId, CustomerName, BillToAddressId, BillToAddress, SalesRep | Inspected rows are online orders. Full all-channel coverage is unproven. Required internal line ID and item ID are absent from the inspected schema. Obtain full line-level source; keep quantity, per-line price, tax/discount treatment and grouping. Do not fabricate line identity from a moving row index. |
| TRANSACTIONS | Commissions workbook, Transactions Raw | TransactionNumber, TransactionType, CustomerNumber, CustomerName, TotalAmount, CreatedDate, TransactionDate, CreatedBy, InvoiceSalesRepFullName, PaymentMethod | Verify date range, inclusion of returns/credits/payments/invoices, internal transaction ID and grain, completeness and currency. Do not deduplicate by TransactionNumber alone or replace signed credits/payments with positive values. |

Only the listed source schemas and representative rows were inspected. No full-source uniqueness, counts, scope reconciliation or freshness check has yet passed for the six unpopulated datasets. Candidate sources are discovery leads, not approved canonical feeds.

## Refresh architecture

1. Register one approved source contract per dataset: canonical field aliases, mandatory/optional columns, source scope/filter version, stable key/grain, pagination and completeness test, empty-result policy, time zone/currency rules and refresh owner.
2. Fetch once centrally with shared call admission, page checkpoints and 429 cooldown. Do not repeat the same full report in each consumer or each ENTERNEWPART job.
3. Validate all pages and required columns before publishing. Fail on duplicate/ambiguous canonical aliases and key conflicts. Keep partial/failed refreshes from overwriting the last good dataset.
4. Publish snapshot metadata: DatasetKey, SnapshotId, SchemaVersion, ScopeVersion, LastAttempt, SourceAsOf (if actually supplied), LastSuccess, RowCount, Completeness, Result and Error. Import time must not masquerade as source freshness.
5. Canonical consumers pin a complete validated snapshot and enforce workflow-specific freshness. Unknown/stale central data is never proof that an ERP record does not exist.
6. Logs and REFRESH_CONTROL must reflect actual execution; setting Enabled or changing a status cell is not installing a scheduler or populating a dataset.
7. Shared bulk refresh schedules are staggered and chosen from measured business needs and call budgets. Nothing is scheduled by this document.

## Operational ownership and write receipts

The Hub ingests verified read data. ENTERNEWPART retains business-write ownership under the checked architecture. After verified item creation or SO replacement, send a durable change receipt/refresh request so the relevant shared dataset can refresh. Do not append a narrow guessed row into a canonical table or claim a full snapshot is current after one record update.

- New catalog item -> ITEMS receipt after remote item verification.
- SO line replacement -> SALES_ORDERS/SO_DETAILS refresh request after remote order verification.
- Customer creation/change -> CUSTOMERS receipt only for an actual verified customer mutation.
- Customer asset or task changes -> their own owning workflow's verified receipts.
- TRANSACTIONS reflect actual Striven transactions; creating an item or updating an SO is not an invoice/payment transaction.
- No automatic customer-asset creation merely because a new part/catalog SKU was created.

## Completion criteria

A dataset is ready only after a real refresh publishes actual rows (or an explicitly validated empty result), key/grain/field/scope checks pass, source freshness is recorded honestly, consumers reconcile on stable IDs, and a verified schedule/manual refresh exists. All seven are required; partial completion must be reported per dataset.

## Implementation order

Verify and refresh the existing Items path first; establish true Customer master and all-channel SO/line feeds next; validate Tasks and Customer Assets from their actual full sources; verify Transaction coverage/grain. Release one proven dataset at a time while keeping the remaining rows explicitly blocked. Do not enable autonomous ERP writes on the strength of placeholder tabs or a source registry scan.

No Hub target dataset or source cache was overwritten during this audit.
