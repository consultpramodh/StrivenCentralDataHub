// /************************************************************
//  * Manual ItemCreation — Create items from selected rows
//  *
//  * Sheet: "Manual ItemCreation"
//  * Required columns:
//  *  - Item Number
//  *  - ItemName
//  *  - Price
//  *
//  * Optional columns (if present):
//  *  - Cost
//  *  - Description
//  *
//  * Output columns (auto-created if missing):
//  *  - Striven Item Id
//  *  - Status
//  *  - Error
//  *  - Created At
//  *
//  * Depends on your existing:
//  *  - getStrivenAuthHeaders_()
//  *  - refreshStrivenToken_()
//  *  - strivenRequest_()   (if you don’t have it, see bottom)
//  ************************************************************/

// const MANUAL_CREATE_SHEET = 'Manual ItemCreation';


// /** Create from active row */
// function manualCreateItem_activeRow() {
//   const sh = SpreadsheetApp.getActive().getSheetByName(MANUAL_CREATE_SHEET);
//   if (!sh) throw new Error(`Sheet not found: ${MANUAL_CREATE_SHEET}`);

//   const r = sh.getActiveRange();
//   if (!r) throw new Error('No active range.');
//   const row = r.getRow();
//   if (row === 1) throw new Error('Header row selected.');

//   return manualCreateItems_(sh, [row]);
// }

// /** Create from selection (single or multiple rows) */
// function manualCreateItems_selectedRows_legacy_disabled_R3() {
//   const sh = SpreadsheetApp.getActive().getSheetByName(MANUAL_CREATE_SHEET);
//   if (!sh) throw new Error(`Sheet not found: ${MANUAL_CREATE_SHEET}`);

//   const r = sh.getActiveRange();
//   if (!r) throw new Error('Select one or more rows.');

//   const start = r.getRow();
//   const end = start + r.getNumRows() - 1;

//   const rows = [];
//   for (let i = start; i <= end; i++) {
//     if (i === 1) continue; // skip header
//     rows.push(i);
//   }
//   if (!rows.length) throw new Error('No data rows selected.');

//   return manualCreateItems_(sh, rows);
// }

// /** Core runner */
// function manualCreateItems_(sh, rowNumbers) {
//   const lock = LockService.getDocumentLock();
//   lock.waitLock(30000);

//   try {
//     const props = PropertiesService.getScriptProperties();

//     const typeId = _num_(props.getProperty('ENTERNEWPART_DEFAULT_ITEMTYPE_ID'));
//     if (!typeId) throw new Error('Missing Script Property: ENTERNEWPART_DEFAULT_ITEMTYPE_ID');

//     const lastCol = sh.getLastColumn();
//     const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
//     const col = _indexByHeaderLoose_(headers);

//     // Ensure output columns exist
//     const outCols = _ensureOutputColumns_(sh, headers, col);

//     const readRange = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
//     const grid = readRange.getValues();

//     // Process each row
//     for (const rowIdx of rowNumbers) {
//       const row = grid[rowIdx - 1];

//       const existingId = row[outCols.itemId];
//       const existingStatus = String(row[outCols.status] || '').toUpperCase().trim();

//       if (existingId || existingStatus === 'CREATED') {
//         _writeRowStatus_(sh, rowIdx, outCols, 'SKIPPED', '', 'Already has Item Id / CREATED');
//         continue;
//       }

//       let payload;
//       try {
//         payload = _buildManualItemPayload_(row, col);
//       } catch (e) {
//         _writeRowStatus_(sh, rowIdx, outCols, 'ERROR', '', String(e && e.message ? e.message : e));
//         continue;
//       }

//       try {
//         const res = strivenRequest_('POST', '/v1/items', payload);
//         const newId = _extractItemIdFromResponse_(res);
//         if (!newId) throw new Error('No usable Id returned from Striven response.');

//         _writeRowStatus_(sh, rowIdx, outCols, 'CREATED', newId, '');
//       } catch (e) {
//         _writeRowStatus_(sh, rowIdx, outCols, 'ERROR', '', String(e && e.message ? e.message : e));
//       }

//       Utilities.sleep(150); // mild rate-limit cushion
//     }

//     return true;
//   } finally {
//     lock.releaseLock();
//   }
// }

// /** Build payload from Manual ItemCreation row */
// function _buildManualItemPayload_(row, col) {
//   const props = PropertiesService.getScriptProperties();

//   const itemNumber = String(_valByAny_(row, col, ['Item Number', 'ItemNumber', 'NewItemNumber']) || '').trim();
//   const name       = String(_valByAny_(row, col, ['ItemName', 'Item Name', 'Name', 'NewItemName']) || '').trim();
//   const priceRaw   = _valByAny_(row, col, ['Price', 'NewItemPrice']);
//   const costRaw    = _valByAny_(row, col, ['Cost', 'NewItemCost']);
//   const descRaw    = _valByAny_(row, col, ['Description', 'NewItemDescription']);

//   if (!name) throw new Error('Missing ItemName.');

//   if (itemNumber && itemNumber.toUpperCase() === 'ENTERNEWPART') {
//     throw new Error('Item Number is placeholder (ENTERNEWPART).');
//   }

//   const price = _num_(priceRaw);
//   if (price == null) throw new Error('Price is missing or not numeric.');

//   const cost = _num_(costRaw) ?? 0;

//   // Description
//   let desc = String(descRaw || '').trim();
//   if (!desc) desc = itemNumber ? `${name} (${itemNumber})` : name;

//   const payload = {
//     Id: 0,
//     Name: name,
//     Description: desc,
//     Price: price,
//     Cost: cost,
//     Active: true,
//     Taxable: true
//   };

//   if (itemNumber) payload.ItemNumber = itemNumber;

//   // Defaults from Script Properties
//   const incomeId = _num_(props.getProperty('ENTERNEWPART_DEFAULT_INCOME_GLACCOUNT_ID'));
//   const invId    = _num_(props.getProperty('ENTERNEWPART_DEFAULT_INVENTORY_GLACCOUNT_ID'));
//   const cogsId   = _num_(props.getProperty('ENTERNEWPART_DEFAULT_COGS_GLACCOUNT_ID'));
//   const locId    = _num_(props.getProperty('ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID'));
//   const typeId   = _num_(props.getProperty('ENTERNEWPART_DEFAULT_ITEMTYPE_ID'));

//   if (incomeId) payload.IncomeGLAccount = { Id: incomeId };
//   if (invId)    payload.InventoryAssetGLAccount = { Id: invId };
//   if (cogsId)   payload.COGSGLAccount = { Id: cogsId };
//   if (locId)    payload.DefaultInventoryLocation = { Id: locId };

//   if (!typeId) throw new Error('Missing ENTERNEWPART_DEFAULT_ITEMTYPE_ID');
//   payload.ItemType = { Id: typeId };

//   return payload;
// }

// /** Ensure output columns exist; return their 0-based indexes */
// function _ensureOutputColumns_(sh, headers, col) {
//   const needed = ['Striven Item Id', 'Status', 'Error', 'Created At'];
//   let lastCol = headers.length;

//   for (const h of needed) {
//     if (col[h] == null) {
//       lastCol += 1;
//       sh.getRange(1, lastCol).setValue(h).setFontWeight('bold');
//       col[h] = lastCol - 1; // 0-based
//     }
//   }

//   return {
//     itemId: col['Striven Item Id'],
//     status: col['Status'],
//     error:  col['Error'],
//     createdAt: col['Created At']
//   };
// }

// function _writeRowStatus_(sh, rowIdx, outCols, status, itemId, errMsg) {
//   const now = new Date();
//   const values = [
//     itemId || '',
//     status || '',
//     errMsg || '',
//     (status === 'CREATED' || status === 'ERROR' || status === 'SKIPPED') ? now : ''
//   ];
//   sh.getRange(rowIdx, outCols.itemId + 1, 1, 4).setValues([values]);
// }

// function _indexByHeaderLoose_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const k = String(h || '').trim();
//     if (!k) return;
//     map[k] = i;
//   });
//   return map;
// }

// function _valByAny_(row, col, names) {
//   for (const n of names) {
//     if (col[n] != null) return row[col[n]];
//   }
//   return '';
// }

// function _num_(v) {
//   if (v === '' || v == null) return null;
//   const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
//   return isNaN(n) ? null : n;
// }

// function _extractItemIdFromResponse_(res) {
//   if (!res) return null;
//   if (typeof res === 'number') return res;
//   if (res.Id) return res.Id;
//   if (res.id) return res.id;
//   if (res.Data) {
//     const d = res.Data;
//     if (typeof d === 'number') return d;
//     if (d.Id) return d.Id;
//     if (Array.isArray(d) && d[0] && d[0].Id) return d[0].Id;
//   }
//   return null;
// }