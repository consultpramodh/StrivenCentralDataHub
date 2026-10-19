

// /***********************
//  * ENTERNEWPART (Unified) — STABLE VERSION
//  *
//  * - Uses fixed ENTERNEWPART_EXPECTED_HEADERS
//  * - Always writes headers (even if 0 rows)
//  * - Preserves action columns
//  * - No CustomFields or CustomColumns on SO update
//  * - InventoryLocation ALWAYS enforced
//  ***********************/

// const ENTERNEWPART_SHEET_NAME = 'Enternewpart';

// /** Hard-defined schema (DO NOT auto-detect) */
// const ENTERNEWPART_EXPECTED_HEADERS = [
//   'SalesOrderSalesOrderId',
//   'SalesOrderCreatedOn',
//   'ItemItemId',
//   'ItemNumber',
//   'ItemDescription',
//   'Quantity',
//   'Price',
//   'SalesOrderNumber',
//   'SalesOrderStatus',
//   'SalesOrderCustomerName',
//   'SalesOrderSalesRepFullName'
// ];

// const ENTERNEWPART_NEW_COLS = [
//   'NewItemId',
//   'NewItemNumber',
//   'NewItemName',
//   'NewItemPrice',
//   'NewItemCost',
//   'LastAction',
//   'LastError',
//   'LastUpdated'
// ];

// /* ======================================================
//  * REPORT FETCH
//  * ====================================================== */

// function fetchEnternewpartReportRaw_() {
//   const props = PropertiesService.getScriptProperties();
//   const apiUrl = props.getProperty('STRIVEN_ENTERNEWPART_REPORT_API');
//   if (!apiUrl) throw new Error('Missing STRIVEN_ENTERNEWPART_REPORT_API');

//   const res = UrlFetchApp.fetch(apiUrl, { method: 'get', muteHttpExceptions: true });

//   if (res.getResponseCode() !== 200) {
//     throw new Error('Enternewpart report HTTP error: ' + res.getResponseCode());
//   }

//   return JSON.parse(res.getContentText() || '{}');
// }

// /* ======================================================
//  * SYNC (Deterministic Schema)
//  * ====================================================== */

// function syncEnternewpartReportToSheet() {
//   const ss = SpreadsheetApp.getActive();
//   let sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) sh = ss.insertSheet(ENTERNEWPART_SHEET_NAME);

//   const existingLastRow = sh.getLastRow();
//   const existingLastCol = sh.getLastColumn();

//   let existingHeaders = [];
//   let existingValues = [];

//   if (existingLastCol > 0) {
//     existingHeaders = sh.getRange(1, 1, 1, existingLastCol)
//       .getValues()[0]
//       .map(h => String(h || '').trim());

//     if (existingLastRow > 1) {
//       existingValues = sh.getRange(2, 1, existingLastRow - 1, existingLastCol).getValues();
//     }
//   }

//   const existingCol = indexByHeader_(existingHeaders);

//   // Preserve action columns by composite key
//   const preserved = new Map();
//   existingValues.forEach(row => {
//     const key = buildCompositeKey_(row, existingCol);
//     if (key) preserved.set(key, row);
//   });

//   const body = fetchEnternewpartReportRaw_();
//   const rows = body?.data ?? body?.Data ?? [];

//   const finalHeaders = [
//     ...ENTERNEWPART_EXPECTED_HEADERS,
//     ...ENTERNEWPART_NEW_COLS.filter(h => !ENTERNEWPART_EXPECTED_HEADERS.includes(h))
//   ];

//   const finalCol = indexByHeader_(finalHeaders);

//   const out = [];

//   if (Array.isArray(rows)) {
//     rows.forEach(r => {
//       const newRow = new Array(finalHeaders.length).fill('');

//       ENTERNEWPART_EXPECTED_HEADERS.forEach((h, i) => {
//         newRow[i] = r?.[h] ?? '';
//       });

//       const key = buildCompositeKeyFromObject_(r);
//       const oldRow = preserved.get(key);

//       if (oldRow) {
//         ENTERNEWPART_NEW_COLS.forEach(h => {
//           const oldIdx = existingCol[h];
//           const newIdx = finalCol[h];
//           if (oldIdx != null && newIdx != null) {
//             newRow[newIdx] = oldRow[oldIdx];
//           }
//         });
//       }

//       out.push(newRow);
//     });
//   }

//   sh.clearContents();
//   sh.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);

//   if (out.length) {
//     sh.getRange(2, 1, out.length, finalHeaders.length).setValues(out);
//   }

//   sh.setFrozenRows(1);
//   sh.autoResizeColumns(1, finalHeaders.length);

//   ss.toast(`Report synced. Rows=${out.length}`, 'Enternewpart', 5);
// }

// /* ======================================================
//  * COMPOSITE KEY
//  * ====================================================== */

// function buildCompositeKey_(row, col) {
//   const soId = row[col['SalesOrderSalesOrderId']] ?? '';
//   const desc = normalizeDesc_(row[col['ItemDescription']]);
//   const qty  = normalizeNum_(row[col['Quantity']]);
//   const price = normalizeNum_(row[col['Price']]);
//   if (!soId || !desc) return '';
//   return [soId, desc, qty, price].join('|');
// }

// function buildCompositeKeyFromObject_(r) {
//   const soId = r?.SalesOrderSalesOrderId ?? '';
//   const desc = normalizeDesc_(r?.ItemDescription);
//   const qty  = normalizeNum_(r?.Quantity);
//   const price = normalizeNum_(r?.Price);
//   if (!soId || !desc) return '';
//   return [soId, desc, qty, price].join('|');
// }

// /* ======================================================
//  * HELPERS
//  * ====================================================== */

// function indexByHeader_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     if (h) map[String(h).trim()] = i;
//   });
//   return map;
// }

// function normalizeDesc_(v) {
//   return String(v || '')
//     .replace(/\r/g, '')
//     .replace(/\s+/g, ' ')
//     .trim()
//     .toUpperCase();
// }

// function normalizeNum_(v) {
//   if (v === '' || v == null) return '';
//   const n = Number(String(v).replace(/[^0-9.-]/g, ''));
//   return isNaN(n) ? '' : String(n);
// }



// function enternewpart_runReplaceSelected_STRICT() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_SHEET_NAME}`);

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_(headers);

//   requireCols_(col, [
//     'SalesOrderSalesOrderId',
//     'ItemNumber',
//     'ItemDescription',
//     'Quantity',
//     'NewItemId',
//     'LastAction',
//     'LastError',
//     'LastUpdated'
//   ]);

//   const rows = getSelectedRowIndices_(sh);
//   const now = new Date();

//   let ok = 0, fail = 0, skipped = 0;

//   for (const rowIdx of rows) {
//     const row = sh.getRange(rowIdx, 1, 1, lastCol).getValues()[0];

//     const soId = Number(row[col['SalesOrderSalesOrderId']]) || null;
//     const oldItemNumber = String(row[col['ItemNumber']] || '').trim();
//     const rawDesc = row[col['ItemDescription']];
//     const newItemId = Number(row[col['NewItemId']]) || null;

//     const parsed = parseItemFromDescription_(rawDesc);
//     const realItemNumberFromDesc = String(parsed?.itemNumber || '').trim();
//     const wantQty = num_(row[col['Quantity']]);

//     try {
//       if (!newItemId) { skipped++; continue; } // must have created/mapped the new item first
//       if (!soId) throw new Error('Missing SalesOrderSalesOrderId (internal id).');
//       if (!oldItemNumber) throw new Error('Missing ItemNumber (old).');

//       const isPlaceholder = oldItemNumber.toUpperCase() === 'ENTERNEWPART';
//       if (!isPlaceholder) throw new Error('STRICT replacer supports ENTERNEWPART placeholder rows only.');
//       if (!realItemNumberFromDesc) throw new Error('ItemDescription must contain "Item Number:" for ENTERNEWPART rows.');

//       const so = getSalesOrderById_(soId);
//       const lineItems = getSoLineItems_(so);
//       if (!Array.isArray(lineItems) || !lineItems.length) throw new Error(`SO ${soId} has no lineItems.`);

//       const realTok = normToken_(realItemNumberFromDesc);

//       const matches = lineItems.filter(li => {
//         const placeholderId = 36935;
//         const liItemId = Number(li?.item?.id ?? li?.Item?.Id) || null;

//         // match either placeholder OR already-swapped line
//         if (liItemId !== placeholderId && liItemId !== Number(newItemId)) return false;

//         const liQty = num_(li?.qty ?? li?.Qty ?? li?.quantity ?? li?.Quantity);
//         if (wantQty != null && liQty != null && wantQty !== liQty) return false;

//         const desc = String(li?.description ?? li?.Description ?? '');
//         const descTok = normToken_(desc);
//         return realTok && descTok.includes(realTok);
//       });

//       Logger.log(`SO ${soId} lineItems=${lineItems.length} matches=${matches.length} real="${realItemNumberFromDesc}" qty=${wantQty} newItemId=${newItemId}`);

//       if (matches.length === 0) throw new Error(`No match on SO ${soId} for "${realItemNumberFromDesc}" qty=${wantQty ?? ''}.`);
//       if (matches.length > 1) {
//         const ids = matches.map(li => li?.id ?? li?.Id).filter(Boolean).join(', ');
//         throw new Error(`AMBIGUOUS: ${matches.length} matches on SO ${soId} for "${realItemNumberFromDesc}". LineIds: ${ids}.`);
//       }

//       const target = matches[0];

//       // swap item id
//       setLineItemItemId_(target, newItemId);

//       // placeholder blob? then clean description + set price
//       const tOldDesc = String(target?.description ?? target?.Description ?? '');
//       if (isEnternewpartPlaceholderDesc_(tOldDesc)) {
//         const cleanDesc = buildCleanLineDescription_(parsed, realItemNumberFromDesc);
//         if ('description' in target) target.description = cleanDesc;
//         if ('Description' in target) target.Description = cleanDesc;

//         const parsedPrice = Number(parsed?.price);
//         if (Number.isFinite(parsedPrice) && parsedPrice > 0) setLineItemPrice_(target, parsedPrice);
//       }

//       const payload = buildSalesOrderUpsertPayloadFromGet_(so, lineItems);
//       strivenRequest_('POST', '/v1/sales-orders', payload);

//       row[col['LastAction']] = `REPLACED SO=${soId} LineId=${target?.id ?? target?.Id} -> NewItemId=${newItemId}`;
//       row[col['LastError']] = '';
//       row[col['LastUpdated']] = now;

//       ok++;
//     } catch (e) {
//       row[col['LastAction']] = 'REPLACE FAILED';
//       row[col['LastError']] = String(e && e.message ? e.message : e);
//       row[col['LastUpdated']] = now;
//       fail++;
//     }

//     sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//   }

//   ss.toast(`Replace (selected) done. OK=${ok} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 6);
// }

// /* =========================
//  * COMPOSITE KEY (for merge only)
//  * ========================= */

// function buildEnternewpartCompositeKeyFromRow_(row, col) {
//   const soId = safeKeyPart_(row, col, 'SalesOrderSalesOrderId');
//   const desc = normalizeDesc_(safeKeyPart_(row, col, 'ItemDescription'));
//   const qty  = normalizeNum_(safeKeyPart_(row, col, 'Quantity'));
//   const price = normalizeNum_(safeKeyPart_(row, col, 'Price'));
//   if (!soId || !desc) return '';
//   return [soId, desc, qty, price].join('|');
// }

// function buildEnternewpartCompositeKeyFromReportObjectRow_(r) {
//   const soId = String(r?.SalesOrderSalesOrderId ?? '').trim();
//   const desc = normalizeDesc_(r?.ItemDescription);
//   const qty  = normalizeNum_(r?.Quantity);
//   const price = normalizeNum_(r?.Price);
//   if (!soId || !desc) return '';
//   return [soId, desc, qty, price].join('|');
// }

// function buildEnternewpartCompositeKeyFromReportArrayRow_(arrRow, reportHeaders) {
//   const idx = indexByHeader_(reportHeaders);
//   const soId = String((idx['SalesOrderSalesOrderId'] != null ? arrRow[idx['SalesOrderSalesOrderId']] : '') ?? '').trim();
//   const desc = normalizeDesc_(idx['ItemDescription'] != null ? arrRow[idx['ItemDescription']] : '');
//   const qty  = normalizeNum_(idx['Quantity'] != null ? arrRow[idx['Quantity']] : '');
//   const price = normalizeNum_(idx['Price'] != null ? arrRow[idx['Price']] : '');
//   if (!soId || !desc) return '';
//   return [soId, desc, qty, price].join('|');
// }

// function safeKeyPart_(row, col, header) {
//   const i = col[header];
//   return i == null ? '' : row[i];
// }

// function normalizeDesc_(v) {
//   return String(v || '')
//     .replace(/\r/g, '')
//     .replace(/\s+/g, ' ')
//     .trim()
//     .toUpperCase();
// }

// function normalizeNum_(v) {
//   if (v === '' || v == null) return '';
//   const n = Number(String(v).replace(/[^0-9.-]/g, ''));
//   if (isNaN(n)) return String(v).trim();
//   return String(Math.round(n * 1000000) / 1000000);
// }

// /* =========================
//  * SHEET UTILITIES
//  * ========================= */

// function indexByHeader_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const key = String(h || '').trim();
//     if (!key) return;
//     map[key] = i;
//   });
//   return map;
// }

// function truthy_(v) {
//   return v === true || v === 'TRUE' || v === 'Yes' || v === 'YES' || v === 1;
// }

// function requireCols_(colMap, names) {
//   const missing = names.filter(n => colMap[n] == null);
//   if (missing.length) throw new Error('Missing required columns: ' + missing.join(', '));
// }

// function enternewpart_setupActionColumns() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_SHEET_NAME}`);

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, Math.max(1, lastCol)).getValues()[0].map(h => String(h || '').trim());
//   const colMap = indexByHeader_(headers);

//   let updated = false;
//   ENTERNEWPART_NEW_COLS.forEach(h => {
//     if (colMap[h] == null) {
//       sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
//       updated = true;
//     }
//   });

//   const lastCol2 = sh.getLastColumn();
//   const headers2 = sh.getRange(1, 1, 1, lastCol2).getValues()[0].map(h => String(h || '').trim());
//   const col2 = indexByHeader_(headers2);


//   sh.setFrozenRows(1);
//   sh.autoResizeColumns(1, sh.getLastColumn());
//   ss.toast(updated ? '✅ Action columns added.' : '✅ Action columns already exist.', 'Enternewpart', 4);
// }


// function getSelectedRowIndices_(sh) {
//   const rng = sh.getActiveRange();
//   if (!rng) throw new Error('Select the rows you want to run, then run the menu action again.');

//   const r1 = rng.getRow();
//   const r2 = r1 + rng.getNumRows() - 1;

//   // Only data rows
//   const start = Math.max(2, r1);
//   const end   = Math.max(2, r2);

//   if (end < 2) throw new Error('Select at least one data row (row 2+).');

//   const rows = [];
//   for (let r = start; r <= end; r++) rows.push(r);
//   return rows;
// }



// function enternewpart_runCreateSelected() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_SHEET_NAME}`);

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_(headers);

//   requireCols_(col, ['LastAction', 'LastError', 'LastUpdated', 'NewItemId']);

//   const rows = getSelectedRowIndices_(sh);
//   const itemsByNumber = getStrivenItemsIndex_();
//   const now = new Date();

//   let ok = 0, fail = 0, skipped = 0, exists = 0;

//   for (const rowIdx of rows) {
//     const row = sh.getRange(rowIdx, 1, 1, lastCol).getValues()[0];

//     // Skip if already has NewItemId
//     const existingNewId = Number(row[col['NewItemId']]) || null;
//     if (existingNewId) { skipped++; continue; }

//     try {
//       const desiredNum = deriveDesiredItemNumberForRow_(row, col);
//       if (desiredNum && desiredNum.toUpperCase() === 'ENTERNEWPART') {
//         throw new Error('Derived item number is still ENTERNEWPART. Fix ItemDescription or NewItemNumber.');
//       }

//       if (desiredNum) {
//         const existingId = itemsByNumber.get(desiredNum.toUpperCase());
//         if (existingId) {
//           row[col['NewItemId']] = existingId;
//           if (col['NewItemNumber'] != null) row[col['NewItemNumber']] = desiredNum;

//           row[col['LastAction']] = `EXISTS ItemId=${existingId}`;
//           row[col['LastError']] = '';
//           row[col['LastUpdated']] = now;

//           exists++;
//           sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//           continue;
//         }
//       }

//       const payload = buildItemPayloadFromRow_(row, col); // your existing helper
//       const res = strivenRequest_('POST', '/v1/items', payload);
//       const newId = extractItemIdFromResponse_(res);
//       if (!newId) throw new Error('Create succeeded but no Item Id returned.');

//       if (payload.ItemNumber) itemsByNumber.set(String(payload.ItemNumber).trim().toUpperCase(), newId);

//       row[col['NewItemId']] = newId;
//       if (col['NewItemNumber'] != null && payload.ItemNumber) row[col['NewItemNumber']] = payload.ItemNumber;
//       if (col['NewItemName'] != null && payload.Name) row[col['NewItemName']] = payload.Name;
//       if (col['NewItemPrice'] != null && payload.Price != null) row[col['NewItemPrice']] = payload.Price;
//       if (col['NewItemCost'] != null && payload.Cost != null) row[col['NewItemCost']] = payload.Cost;

//       row[col['LastAction']] = `CREATED ItemId=${newId}`;
//       row[col['LastError']] = '';
//       row[col['LastUpdated']] = now;

//       ok++;
//     } catch (e) {
//       row[col['LastAction']] = 'CREATE FAILED';
//       row[col['LastError']] = String(e && e.message ? e.message : e);
//       row[col['LastUpdated']] = now;
//       fail++;
//     }

//     sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//   }

//   ss.toast(`Create (selected) done. CREATED=${ok} EXISTS=${exists} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 7);
// }

// /* =========================
//  * PARSER (ItemDescription)
//  * ========================= */

// function parseItemFromDescription_(raw) {
//   if (!raw) return { itemNumber: '', name: '', price: null };

//   let text = String(raw).replace(/\r/g, '').trim();

//   let itemNumber = '';
//   let name = '';
//   let price = null;

//   const numMatch = text.match(/Item\s*Number\s*:\s*(.+)/i);
//   if (numMatch && numMatch[1]) itemNumber = numMatch[1].split('\n')[0].trim();

//   const nameMatch = text.match(/Item\s*Name\s*:\s*(.+)/i);
//   if (nameMatch && nameMatch[1]) name = nameMatch[1].split('\n')[0].trim();

//   const priceMatch = text.match(/Price\s*:\s*(.+)/i);
//   if (priceMatch && priceMatch[1]) {
//     const rawPrice = priceMatch[1].split('\n')[0].trim();
//     const numeric = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));
//     if (!isNaN(numeric)) price = numeric;
//   }

//   return { itemNumber, name, price };
// }

// /* =========================
//  * ITEM CREATION (unchanged behavior)
//  * ========================= */

// function extractItemIdFromResponse_(res) {
//   if (!res) return null;
//   if (typeof res === 'number') return res;
//   if (res.Id) return res.Id;
//   if (res.id) return res.id;
//   if (res.Data) {
//     const d = res.Data;
//     if (typeof d === 'number') return d;
//     if (d.Id) return d.Id;
//     if (Array.isArray(d) && d.length && d[0] && d[0].Id) return d[0].Id;
//   }
//   return null;
// }

// function enternewpart_runCreateChecked() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_SHEET_NAME}`);

//   const lastRow = sh.getLastRow();
//   if (lastRow < 2) return;

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_(headers);

//   requireCols_(col, ['DoCreateItem', 'LastAction', 'LastError', 'LastUpdated', 'NewItemId']);

//   const itemsByNumber = getStrivenItemsIndex_();

//   const grid = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const now = new Date();
//   let ok = 0, fail = 0, skipped = 0, exists = 0;

//   for (let i = 0; i < grid.length; i++) {
//     const rowIdx = i + 2;
//     const row = grid[i];

//     if (!truthy_(row[col['DoCreateItem']])) { skipped++; continue; }

//     try {
//       const desiredNum = deriveDesiredItemNumberForRow_(row, col);
//       if (desiredNum && desiredNum.toUpperCase() === 'ENTERNEWPART') {
//         throw new Error('Derived item number is still ENTERNEWPART. Fix ItemDescription or NewItemNumber.');
//       }

//       if (desiredNum) {
//         const existingId = itemsByNumber.get(desiredNum.toUpperCase());
//         if (existingId) {
//           row[col['NewItemId']] = existingId;
//           if (col['NewItemNumber'] != null) row[col['NewItemNumber']] = desiredNum;

//           row[col['LastAction']] = `EXISTS ItemId=${existingId}`;
//           row[col['LastError']] = '';
//           row[col['LastUpdated']] = now;
//           row[col['DoCreateItem']] = false;

//           exists++;
//           sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//           continue;
//         }
//       }

//       const payload = buildItemPayloadFromRow_(row, col); // your existing helper
//       const res = strivenRequest_('POST', '/v1/items', payload);
//       const newId = extractItemIdFromResponse_(res);
//       if (!newId) throw new Error('Create succeeded but no Item Id returned.');

//       if (payload.ItemNumber) itemsByNumber.set(String(payload.ItemNumber).trim().toUpperCase(), newId);

//       if (col['NewItemId'] != null) row[col['NewItemId']] = newId;
//       if (col['NewItemNumber'] != null && payload.ItemNumber) row[col['NewItemNumber']] = payload.ItemNumber;
//       if (col['NewItemName'] != null && payload.Name) row[col['NewItemName']] = payload.Name;
//       if (col['NewItemPrice'] != null && payload.Price != null) row[col['NewItemPrice']] = payload.Price;
//       if (col['NewItemCost'] != null && payload.Cost != null) row[col['NewItemCost']] = payload.Cost;

//       row[col['LastAction']] = `CREATED ItemId=${newId}`;
//       row[col['LastError']] = '';
//       row[col['LastUpdated']] = now;
//       row[col['DoCreateItem']] = false;

//       ok++;
//     } catch (e) {
//       row[col['LastAction']] = 'CREATE FAILED';
//       row[col['LastError']] = String(e && e.message ? e.message : e);
//       row[col['LastUpdated']] = now;
//       fail++;
//     }

//     sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//   }

//   ss.toast(`Create done. CREATED=${ok} EXISTS=${exists} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 7);
// }

// /* =========================
//  * SO REPLACER (STRICT, NO PRICE MATCH)
//  * ========================= */



// function getSalesOrderById_(soId) {
//   if (!soId) throw new Error('SalesOrderId is required.');
//   return strivenRequest_('GET', '/v1/sales-orders/' + soId, null);
// }

// function getSoLineItems_(so) {
//   const c = so?.lineItems || so?.LineItems || so?.Data?.lineItems || so?.Data?.LineItems;
//   return Array.isArray(c) ? c : null;
// }

// function enternewpart_runReplaceChecked_STRICT() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_SHEET_NAME}`);

//   const lastRow = sh.getLastRow();
//   if (lastRow < 2) return;

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_(headers);

//   requireCols_(col, [
//     'DoReplaceInSO',
//     'SalesOrderSalesOrderId',
//     'ItemNumber',
//     'ItemDescription',
//     'Quantity',
//     'NewItemId',
//     'LastAction',
//     'LastError',
//     'LastUpdated'
//   ]);

//   const grid = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const now = new Date();
//   let ok = 0, fail = 0, skipped = 0;

//   for (let i = 0; i < grid.length; i++) {
//     const rowIdx = i + 2;
//     const row = grid[i];

//     if (!truthy_(row[col['DoReplaceInSO']])) { skipped++; continue; }

//     const soId = Number(row[col['SalesOrderSalesOrderId']]) || null;
//     const oldItemNumber = String(row[col['ItemNumber']] || '').trim();
//     const rawDesc = row[col['ItemDescription']];
//     const newItemId = Number(row[col['NewItemId']]) || null;

//     const parsed = parseItemFromDescription_(rawDesc);
//     const realItemNumberFromDesc = String(parsed?.itemNumber || '').trim();
//     const wantQty = num_(row[col['Quantity']]);

//     try {
//       if (!soId) throw new Error('Missing SalesOrderSalesOrderId (internal id).');
//       if (!oldItemNumber) throw new Error('Missing ItemNumber (old).');
//       if (!newItemId) throw new Error('Missing NewItemId (create the item first).');

//       const isPlaceholder = oldItemNumber.toUpperCase() === 'ENTERNEWPART';
//       if (!isPlaceholder) {
//         throw new Error('STRICT replacer supports ENTERNEWPART placeholder rows only.');
//       }
//       if (!realItemNumberFromDesc) {
//         throw new Error('ItemDescription must contain "Item Number:" for ENTERNEWPART rows.');
//       }

//       const so = getSalesOrderById_(soId);
//       const lineItems = getSoLineItems_(so);
//       if (!Array.isArray(lineItems) || !lineItems.length) throw new Error(`SO ${soId} has no lineItems.`);

//       const realTok = normToken_(realItemNumberFromDesc);

//       // STRICT match: item.id === 36935, qty match, description contains item number token
//       const matches = lineItems.filter(li => {
//         const placeholderId = 36935;
// const liItemId = Number(li?.item?.id ?? li?.Item?.Id) || null;

// // allow match either before replace (placeholder) OR after replace (already swapped)
// if (liItemId !== placeholderId && liItemId !== Number(newItemId)) return false;
//         const liQty = num_(li?.qty ?? li?.Qty ?? li?.quantity ?? li?.Quantity);
//         if (wantQty != null && liQty != null && wantQty !== liQty) return false;

//         const desc = String(li?.description ?? li?.Description ?? '');
//         const descTok = normToken_(desc);
//         if (!realTok) return false;
//         if (!descTok.includes(realTok)) return false;

//         return true;
//       });

//       Logger.log(`SO ${soId} lineItems=${lineItems.length} matches=${matches.length} real="${realItemNumberFromDesc}" qty=${wantQty} newItemId=${newItemId}`);

//       if (matches.length === 0) throw new Error(`No match on SO ${soId} for "${realItemNumberFromDesc}" qty=${wantQty ?? ''}.`);
//       if (matches.length > 1) {
//         const ids = matches.map(li => li?.id ?? li?.Id).filter(Boolean).join(', ');
//         throw new Error(`AMBIGUOUS: ${matches.length} matches on SO ${soId} for "${realItemNumberFromDesc}". LineIds: ${ids}.`);
//       }

// const target = matches[0];

// // swap item id
// setLineItemItemId_(target, newItemId);

// // Only treat as placeholder if the old line description is the blob
// const tOldDesc = String(target?.description ?? target?.Description ?? '');
// if (isEnternewpartPlaceholderDesc_(tOldDesc)) {
//   // 1) clean description: "Item Name (Item Number)"
//   const cleanDesc = buildCleanLineDescription_(parsed, realItemNumberFromDesc);
//   if ('description' in target) target.description = cleanDesc;
//   if ('Description' in target) target.Description = cleanDesc;

//   // 2) set price from parsed "Price:"
//   const parsedPrice = Number(parsed?.price);
//   if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
//     setLineItemPrice_(target, parsedPrice);
//   }
// }

//       // Build FULL safe payload (NO custom fields, NO custom columns) and POST it back
//       const payload = buildSalesOrderUpsertPayloadFromGet_(so, lineItems);
//       strivenRequest_('POST', '/v1/sales-orders', payload);

//       row[col['LastAction']] = `REPLACED SO=${soId} LineId=${target?.id ?? target?.Id} -> NewItemId=${newItemId}`;
//       row[col['LastError']] = '';
//       row[col['LastUpdated']] = now;
//       row[col['DoReplaceInSO']] = false;
//       ok++;
//     } catch (e) {
//       row[col['LastAction']] = 'REPLACE FAILED';
//       row[col['LastError']] = String(e && e.message ? e.message : e);
//       row[col['LastUpdated']] = now;
//       fail++;
//     }

//     sh.getRange(rowIdx, 1, 1, lastCol).setValues([row]);
//   }


//   ss.toast(`Replace done. OK=${ok} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 6);
// }

// function isEnternewpartPlaceholderDesc_(desc) {
//   const t = String(desc || '').toUpperCase();
//   return t.includes('ITEM NUMBER') && t.includes('ITEM NAME');
// }

// function buildCleanLineDescription_(parsed, fallbackItemNumber) {
//   const itemNumber = String(parsed?.itemNumber || fallbackItemNumber || '').trim();
//   const itemName   = String(parsed?.name || '').trim();

//   if (itemName && itemNumber) return `${itemName} (${itemNumber})`;
//   if (itemName) return itemName;
//   if (itemNumber) return `(${itemNumber})`;
//   return '';
// }

// /* =========================
//  * SALES ORDER UPSERT PAYLOAD BUILDER
//  * - NO CustomFields
//  * - NO CustomColumns
//  * - InventoryLocation ALWAYS set (fallback to Id=21)
//  * ========================= */

// function buildSalesOrderUpsertPayloadFromGet_(so, lineItems) {
//   const p = {};

//   p.Id = so?.id ?? so?.Id;
//   if (!p.Id) throw new Error('Cannot build upsert payload: missing so.id');

//   // Typically required
//   p.Type = mapIdName_(so?.type ?? so?.Type);
//   p.Customer = mapCustomer_(so?.customer ?? so?.Customer);

//   // Keep status if tenant enforces it
//   p.Status = mapIdName_(so?.status ?? so?.Status);

//   // Safe basics
//   p.BillToLocation = mapIdName_(so?.billToLocation ?? so?.BillToLocation);
//   p.ShipToLocation = mapIdName_(so?.shipToLocation ?? so?.ShipToLocation);
//   p.ShipVia = mapIdName_(so?.shipVia ?? so?.ShipVia);
//   p.Contact = mapIdName_(so?.contact ?? so?.Contact);
//   p.Project = mapIdName_(so?.project ?? so?.Project);
//   p.SalesRep = mapIdName_(so?.salesRep ?? so?.SalesRep);

//   p.OrderDate = so?.orderDate ?? so?.OrderDate ?? null;
//   p.OrderNumber = so?.orderNumber ?? so?.OrderNumber ?? null;
//   p.OrderName = so?.orderName ?? so?.OrderName ?? null;
//   p.CustomerPONumber = so?.customerPONumber ?? so?.CustomerPONumber ?? null;

//   p.ToBePrinted = so?.toBePrinted ?? so?.ToBePrinted ?? false;
//   p.TargetDate = so?.targetDate ?? so?.TargetDate ?? null;

//   p.PaymentTerm = mapIdName_(so?.paymentTerm ?? so?.PaymentTerm);
//   p.ARGLAccount = mapIdName_(so?.arglAccount ?? so?.ARGLAccount);
//   p.InvoiceFormat = mapIdName_(so?.invoiceFormat ?? so?.InvoiceFormat);
//   p.SalesTax = mapIdName_(so?.salesTax ?? so?.SalesTax);
//   p.InvoiceStatus = mapIdName_(so?.invoiceStatus ?? so?.InvoiceStatus);

//   p.IsChangeOrder = so?.isChangeOrder ?? so?.IsChangeOrder ?? false;
//   p.ParentId = so?.parentId ?? so?.ParentId ?? 0;
//   p.IsRecurring = so?.isRecurring ?? so?.IsRecurring ?? false;

//   // Notes (fine)
//   if (so?.customerNotes || so?.CustomerNotes) p.CustomerNotes = mapNotes_(so?.customerNotes ?? so?.CustomerNotes);
//   if (so?.internalNotes || so?.InternalNotes) p.InternalNotes = mapNotes_(so?.internalNotes ?? so?.InternalNotes);

//   // IMPORTANT: DO NOT SEND CustomFields on update
//   // IMPORTANT: DO NOT SEND NotesLogCount / AttachmentCount / DateCreated / etc.

//   const fallbackId = enternewpart_defaultInvLocId_();

//   p.LineItems = (lineItems || []).map(li => {
//     const invLocObj = (li?.inventoryLocation ?? li?.InventoryLocation) || null;
//     const invLocId = Number(invLocObj?.id ?? invLocObj?.Id) || null;

//     const finalInvLoc = invLocId
//       ? { Id: invLocId, Name: (invLocObj?.name ?? invLocObj?.Name ?? '') }
//       : { Id: fallbackId, Name: '' };

//     return {
//       Id: li?.id ?? li?.Id ?? 0,
//       Item: mapIdName_(li?.item ?? li?.Item),
//       InventoryLocation: finalInvLoc,

//       Description: li?.description ?? li?.Description ?? '',
//       Qty: li?.qty ?? li?.Qty ?? li?.quantity ?? li?.Quantity ?? 0,

//       UnitOfMeasure: mapUom_(li?.unitOfMeasure ?? li?.UnitOfMeasure),
//       Price: li?.price ?? li?.Price ?? 0,
//       ShippingPrice: li?.shippingPrice ?? li?.ShippingPrice ?? 0,
//       Taxable: li?.taxable ?? li?.Taxable ?? false,
//       FulfillmentDate: li?.fulfillmentDate ?? li?.FulfillmentDate ?? null,
//       Class: mapIdName_(li?.class ?? li?.Class),

//       // IMPORTANT: DO NOT SEND CustomColumns
//       // IMPORTANT: DO NOT SEND ItemGroupLineItems unless you truly need them
//       ItemGroupLineItems: Array.isArray(li?.itemGroupLineItems ?? li?.ItemGroupLineItems)
//         ? (li?.itemGroupLineItems ?? li?.ItemGroupLineItems).map(g => {
//             const gLocObj = (g?.inventoryLocation ?? g?.InventoryLocation) || null;
//             const gLocId = Number(gLocObj?.id ?? gLocObj?.Id) || null;
//             const gFinalLoc = gLocId ? { Id: gLocId, Name: (gLocObj?.name ?? gLocObj?.Name ?? '') } : { Id: fallbackId, Name: '' };

//             return {
//               Id: g?.id ?? g?.Id ?? 0,
//               Item: mapIdName_(g?.item ?? g?.Item),
//               Qty: g?.qty ?? g?.Qty ?? 0,
//               UnitOfMeasure: mapUom_(g?.unitOfMeasure ?? g?.UnitOfMeasure),
//               Price: g?.price ?? g?.Price ?? 0,
//               Class: mapIdName_(g?.class ?? g?.Class),
//               InventoryLocation: gFinalLoc
//             };
//           })
//         : []
//     };
//   });

//   // Final safety: remove null top-level objects (Striven sometimes hates null)
//   Object.keys(p).forEach(k => {
//     if (p[k] === null) delete p[k];
//   });

//   return p;
// }

// /* =========================
//  * MAPPERS
//  * ========================= */

// function mapIdName_(o) {
//   if (!o) return null;
//   const id = o?.id ?? o?.Id;
//   const name = o?.name ?? o?.Name;
//   if (id == null && !name) return null;
//   return { Id: id ?? 0, Name: name ?? '' };
// }
// function mapCustomer_(o) {
//   if (!o) return null;
//   return {
//     Id: o?.id ?? o?.Id ?? 0,
//     Number: o?.number ?? o?.Number ?? '',
//     Name: o?.name ?? o?.Name ?? ''
//   };
// }
// function mapNotes_(o) {
//   if (!o) return null;
//   return {
//     Id: o?.id ?? o?.Id ?? 0,
//     NotesHtml: o?.notesHtml ?? o?.NotesHtml ?? '',
//     NotesText: o?.notesText ?? o?.NotesText ?? ''
//   };
// }
// function mapUom_(o) {
//   if (!o) return null;
//   return {
//     Id: o?.id ?? o?.Id ?? 0,
//     Name: o?.name ?? o?.Name ?? '',
//     ExtendedName: o?.extendedName ?? o?.ExtendedName ?? ''
//   };
// }

// /* =========================
//  * STRIVEN ITEMS INDEX + ITEM NUMBER
//  * ========================= */

// function getStrivenItemsIndex_() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName('Striven_Items');
//   if (!sh) throw new Error('Striven_Items sheet not found. Run "Refresh Striven Items" first.');

//   const lastRow = sh.getLastRow();
//   const lastCol = sh.getLastColumn();
//   if (lastRow < 2) return new Map();

//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_(headers);

//   const idKeyCandidates = ['Id', 'id', 'ItemId', 'itemId'];
//   const numKeyCandidates = ['ItemNumber', 'itemNumber', 'Number', 'number', 'SKU', 'Sku', 'sku'];

//   const idKey = idKeyCandidates.find(k => col[k] != null);
//   const numKey = numKeyCandidates.find(k => col[k] != null);

//   if (!idKey || !numKey) {
//     throw new Error(`Striven_Items missing required columns. Need ItemNumber + Id. Found: ${headers.join(', ')}`);
//   }

//   const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const map = new Map();

//   for (const r of values) {
//     const num = String(r[col[numKey]] || '').trim();
//     const id = Number(r[col[idKey]]) || null;
//     if (!num || !id) continue;
//     const key = num.toUpperCase();
//     if (!map.has(key)) map.set(key, id);
//   }

//   return map;
// }

// function deriveDesiredItemNumberForRow_(row, col) {
//   const explicit = col['NewItemNumber'] != null ? String(row[col['NewItemNumber']] || '').trim() : '';
//   if (explicit) return explicit;

//   const desc = col['ItemDescription'] != null ? row[col['ItemDescription']] : '';
//   const parsed = parseItemFromDescription_(desc);
//   return String(parsed.itemNumber || '').trim();
// }

// /* =========================
//  * MATCH / HELPERS
//  * ========================= */

// function setLineItemItemId_(li, newItemId) {
//   const id = Number(newItemId);

//   if (li.item && typeof li.item === 'object') { li.item.id = id; li.itemId = id; return; }
//   if (li.Item && typeof li.Item === 'object') { li.Item.Id = id; li.ItemId = id; return; }

//   if ('itemId' in li) { li.itemId = id; return; }
//   if ('ItemId' in li) { li.ItemId = id; return; }

//   li.item = { id };
// }



// function isEnternewpartPlaceholderDesc_(desc) {
//   const t = String(desc || '').toUpperCase();
//   // conservative: only treat as placeholder if it contains these labels
//   return t.includes('ITEM NUMBER') && t.includes('ITEM NAME');
// }

// function buildCleanLineDescription_(parsed, fallbackItemNumber) {
//   const itemNumber = String(parsed?.itemNumber || fallbackItemNumber || '').trim();
//   const itemName   = String(parsed?.name || '').trim();

//   if (itemName && itemNumber) return `${itemName} (${itemNumber})`;
//   if (itemName) return itemName;
//   if (itemNumber) return `(${itemNumber})`;
//   return '';
// }


// function normToken_(s) {
//   return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// }
// function num_(v) {
//   if (v === '' || v == null) return null;
//   const n = Number(String(v).replace(/[^0-9.-]/g, ''));
//   return isNaN(n) ? null : n;
// }

// function enternewpart_verifyReplacement(soId, lineId, expectedItemId) {
//   const so = strivenRequest_('GET', '/v1/sales-orders/' + soId, null);
//   const li = (so?.lineItems || so?.LineItems || []).find(x => Number(x?.id ?? x?.Id) === Number(lineId));
//   if (!li) throw new Error(`VERIFY FAILED: line ${lineId} not found on SO ${soId}`);

//   const gotItemId = Number(li?.item?.id ?? li?.Item?.Id) || null;
//   if (gotItemId !== Number(expectedItemId)) {
//     throw new Error(`VERIFY FAILED: SO ${soId} line ${lineId} itemId=${gotItemId} (expected ${expectedItemId})`);
//   }

//   Logger.log(`✅ VERIFY OK: SO ${soId} line ${lineId} itemId=${gotItemId}`);
// }

// function verifyLastReplacement() {
//   const soId = 22530;
//   const lineId = 113962;
//   const expectedItemId = 42322;

//   enternewpart_verifyReplacement(soId, lineId, expectedItemId);
// }


// function setLineItemPrice_(li, price) {
//   const p = Number(price);
//   if (!Number.isFinite(p)) return;

//   // Most common shapes
//   if ('price' in li) li.price = p;
//   if ('Price' in li) li.Price = p;

//   // Some tenants use unitPrice naming (harmless to set if present)
//   if ('unitPrice' in li) li.unitPrice = p;
//   if ('UnitPrice' in li) li.UnitPrice = p;
// }
