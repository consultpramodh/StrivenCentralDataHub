// /**************************************
//  * ENTERNEWPART — QUOTED ORDERS FLOW
//  * Separate sheet + separate report API
//  **************************************/

// const ENTERNEWPART_QUOTED_SHEET_NAME = 'Enternewpart_Quoted';
// const ENTERNEWPART_QUOTED_REPORT_PROPKEY = 'STRIVEN_ENTERNEWPART_QUOTED_REPORT_API';
// const ENTERNEWPART_QUOTED_SEND_COL = 'SendToActions';

// // keep same action columns set (no checkboxes)
// const ENTERNEWPART_QUOTED_NEW_COLS = [
//     'SendToActions',   // <-- add this
//   'NewItemId',
//   'NewItemNumber',
//   'NewItemName',
//   'NewItemPrice',
//   'NewItemCost',
//   'LastAction',
//   'LastError',
//   'LastUpdated'
// ];

// function fetchEnternewpartQuotedReportRaw_() {
//   const props = PropertiesService.getScriptProperties();
//   const apiUrl = props.getProperty(ENTERNEWPART_QUOTED_REPORT_PROPKEY);
//   if (!apiUrl) throw new Error(`Missing ${ENTERNEWPART_QUOTED_REPORT_PROPKEY} in Script Properties.`);

//   const res = UrlFetchApp.fetch(apiUrl, { method: 'get', muteHttpExceptions: true });
//   const code = res.getResponseCode();
//   const text = res.getContentText();

//   if (code !== 200) {
//     Logger.log('❌ Enternewpart QUOTED report HTTP ' + code);
//     Logger.log('Body (truncated): ' + text.slice(0, 2000));
//     throw new Error('Enternewpart QUOTED report error ' + code + '. See logs.');
//   }

//   try {
//     return JSON.parse(text || '{}');
//   } catch (e) {
//     Logger.log('❌ Enternewpart QUOTED JSON parse failed. Raw:\n' + text.slice(0, 2000));
//     throw new Error('Enternewpart QUOTED report returned invalid JSON.');
//   }
// }

// function syncEnternewpartQuotedReportToSheet() {
//   const ss = SpreadsheetApp.getActive();
//   let sh = ss.getSheetByName(ENTERNEWPART_QUOTED_SHEET_NAME);
//   if (!sh) sh = ss.insertSheet(ENTERNEWPART_QUOTED_SHEET_NAME);

//   const existingLastRow = sh.getLastRow();
//   const existingLastCol = sh.getLastColumn();

//   let existingHeaders = [];
//   let existingValues = [];

//   if (existingLastRow >= 1 && existingLastCol >= 1) {
//     existingHeaders = sh.getRange(1, 1, 1, existingLastCol)
//       .getValues()[0]
//       .map(h => String(h || '').trim());

//     if (existingLastRow >= 2) {
//       existingValues = sh.getRange(2, 1, existingLastRow - 1, existingLastCol)
//         .getValues();
//     }
//   }

//   const existingCol = indexByHeader_(existingHeaders);

//   const preservedByKey = new Map();
//   for (let i = 0; i < existingValues.length; i++) {
//     const row = existingValues[i];
//     const key = buildEnternewpartCompositeKeyFromRow_(row, existingCol);
//     if (key && !preservedByKey.has(key)) {
//       preservedByKey.set(key, row);
//     }
//   }

//   const body = fetchEnternewpartQuotedReportRaw_();
//   const reportRows = (body?.data || body?.Data);

//   // 🚫 DO NOT TOUCH SHEET IF NO DATA
//   if (!Array.isArray(reportRows) || !reportRows.length) {
//     ss.toast('No data returned from QUOTED report. Sheet preserved.', 'Enternewpart', 5);
//     return;
//   }

// const reportHeaders = extractReportHeaders_(body); // may be report-only
// const finalHeaders = reportHeaders.slice();

// // Always force required action cols into the header set
// ENTERNEWPART_QUOTED_NEW_COLS.forEach(h => {
//   if (!finalHeaders.includes(h)) finalHeaders.push(h);
// });
//   if (!reportHeaders.length && reportRows[0] && typeof reportRows[0] === 'object') {
//     reportHeaders.push(...Object.keys(reportRows[0]).map(String));
//   }

//   if (!reportHeaders.length) {
//     ss.toast('Quoted report returned data but no detectable headers.', 'Enternewpart', 5);
//     return;
//   }

//   const reportHeaderSet = new Set(reportHeaders.map(h => String(h || '').trim()));

//   // ✅ Only append missing action columns (never duplicate)
//   const extraHeaders = [];

//   ENTERNEWPART_QUOTED_NEW_COLS.forEach(h => {
//     if (!reportHeaderSet.has(h) && !existingHeaders.includes(h)) {
//       extraHeaders.push(h);
//     }
//   });


//   // Append only missing ones
//   extraHeaders.forEach(h => finalHeaders.push(h));

//   const finalCol = indexByHeader_(finalHeaders);

//   const out = [];

//   for (let i = 0; i < reportRows.length; i++) {
//     const r = reportRows[i];
//     const newRow = new Array(finalHeaders.length).fill('');

//     if (Array.isArray(r)) {
//       for (let c = 0; c < reportHeaders.length; c++) {
//         newRow[c] = r[c] ?? '';
//       }
//     } else {
//       for (let c = 0; c < reportHeaders.length; c++) {
//         const h = reportHeaders[c];
//         newRow[c] = r[h] ?? '';
//       }
//     }

//     const key = Array.isArray(r)
//       ? buildEnternewpartCompositeKeyFromReportArrayRow_(r, reportHeaders)
//       : buildEnternewpartCompositeKeyFromReportObjectRow_(r);

//     const oldRow = preservedByKey.get(key);
//     if (oldRow) {
//       ENTERNEWPART_QUOTED_NEW_COLS.forEach(h => {
//         const oldIdx = existingCol[h];
//         const newIdx = finalCol[h];
//         if (oldIdx != null && newIdx != null) {
//           newRow[newIdx] = oldRow[oldIdx];
//         }
//       });
//     }

//     out.push(newRow);
//   }

// // ✅ Never nuke headers — clear only data rows
// if (sh.getLastRow() > 1) {
//   sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
// }

// // ✅ Ensure headers exist (and keep existing extra headers)
// ensureHeaders_(sh, finalHeaders);

// // ✅ Write data (only if we have it)
// if (out.length) {
//   sh.getRange(2, 1, out.length, finalHeaders.length).setValues(out);
// }
  

//   // ✅ Apply checkbox only once
//   const sendColIdx = finalCol[ENTERNEWPART_QUOTED_SEND_COL];
//   if (sendColIdx != null && out.length > 0) {
//     const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
//     sh.getRange(2, sendColIdx + 1, out.length, 1).setDataValidation(rule);
//   }

//   sh.setFrozenRows(1);
//   sh.autoResizeColumns(1, finalHeaders.length);

//   ss.toast(`✅ QUOTED report refreshed. Rows=${out.length}`, 'Enternewpart', 6);
// }

// function enternewpartQuoted_setupActionColumns() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_QUOTED_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_QUOTED_SHEET_NAME}`);

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, Math.max(1, lastCol)).getValues()[0].map(h => String(h || '').trim());
//   const col = indexByHeader_LASTWINS_(headers);

//   const needed = ENTERNEWPART_QUOTED_NEW_COLS.slice(); // includes NewItemId/LastAction/LastError/LastUpdated
//   let wrote = false;

//   for (const h of needed) {
//     if (col[h] == null) {
//       sh.getRange(1, sh.getLastColumn() + 1).setValue(h).setFontWeight('bold');
//       wrote = true;
//     }
//   }

//   sh.setFrozenRows(1);
//   ss.toast(wrote ? '✅ QUOTED action columns added.' : '✅ QUOTED action columns already exist.', 'Enternewpart', 4);
// }

// function enternewpartQuoted_runCreateSelected() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_QUOTED_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_QUOTED_SHEET_NAME}`);

//   // reuse your existing enternewpart_runCreateSelected logic by temporarily using active sheet selection
//   // simplest: duplicate the call but with quoted sheet reference
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

//   ss.toast(`QUOTED Create (selected) done. CREATED=${ok} EXISTS=${exists} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 7);
// }

// function enternewpartQuoted_runReplaceSelected_STRICT() {
//   const ss = SpreadsheetApp.getActive();
//   const sh = ss.getSheetByName(ENTERNEWPART_QUOTED_SHEET_NAME);
//   if (!sh) throw new Error(`Sheet not found: ${ENTERNEWPART_QUOTED_SHEET_NAME}`);

//   // reuse your existing replacer logic exactly, but scoped to quoted sheet
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
//       if (!newItemId) { skipped++; continue; }
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
//         if (liItemId !== placeholderId && liItemId !== Number(newItemId)) return false;

//         const liQty = num_(li?.qty ?? li?.Qty ?? li?.quantity ?? li?.Quantity);
//         if (wantQty != null && liQty != null && wantQty !== liQty) return false;

//         const desc = String(li?.description ?? li?.Description ?? '');
//         const descTok = normToken_(desc);
//         return realTok && descTok.includes(realTok);
//       });

//       Logger.log(`QUOTED SO ${soId} lineItems=${lineItems.length} matches=${matches.length} real="${realItemNumberFromDesc}" qty=${wantQty} newItemId=${newItemId}`);

//       if (matches.length === 0) throw new Error(`No match on SO ${soId} for "${realItemNumberFromDesc}" qty=${wantQty ?? ''}.`);
//       if (matches.length > 1) {
//         const ids = matches.map(li => li?.id ?? li?.Id).filter(Boolean).join(', ');
//         throw new Error(`AMBIGUOUS: ${matches.length} matches on SO ${soId} for "${realItemNumberFromDesc}". LineIds: ${ids}.`);
//       }

//       const target = matches[0];

//       setLineItemItemId_(target, newItemId);

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

//   ss.toast(`QUOTED Replace (selected) done. OK=${ok} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 6);
// }