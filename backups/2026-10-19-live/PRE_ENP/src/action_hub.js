// /******************************************************
//  * enternewpart_actionhub.gs — RUNNER
//  * Processes ActionHub PENDING jobs in batches.
//  ******************************************************/

// function enternewpart_actionHub_installTrigger() {
//   enternewpart_actionHub_removeTrigger();
//   ScriptApp.newTrigger('enternewpart_actionHub_tick').timeBased().everyMinutes(10).create();
//   SpreadsheetApp.getActive().toast('✅ ActionHub runner trigger installed (every 10 min).', 'Enternewpart', 5);
// }

// function enternewpart_actionHub_removeTrigger() {
//   ScriptApp.getProjectTriggers().forEach(t => {
//     if (t.getHandlerFunction && t.getHandlerFunction() === 'enternewpart_actionHub_tick') ScriptApp.deleteTrigger(t);
//   });
//   SpreadsheetApp.getActive().toast('✅ ActionHub runner trigger removed.', 'Enternewpart', 4);
// }

// function enternewpart_actionHub_tick() {
//   const lock = LockService.getScriptLock();
//   lock.waitLock(30000);
//   try {
//     enternewpart_actionHub_runPendingBatch_(ENP_CFG.RUNNER_BATCH_SIZE);
//   } finally {
//     lock.releaseLock();
//   }
// }

// function enternewpart_actionHub_runPendingBatch_(batchSize) {
//   const ss = SpreadsheetApp.getActive();
//   const hub = ss.getSheetByName(ENP_CFG.SHEETS.HUB);
//   if (!hub) throw new Error('ActionHub sheet not found.');

//   enp_ensureHeaders_(hub, ENP_CFG.HEADERS.HUB);

//   const lastRow = hub.getLastRow();
//   const lastCol = hub.getLastColumn();
//   if (lastRow < 2) return;

//   const headers = hub.getRange(1, 1, 1, lastCol).getValues()[0].map(enp_norm_);
//   const col = enp_indexByHeader_LASTWINS_(headers);

//   const need = ['State','Attempts','NextRunAt','LastRunAt','LastError','NewItemId','SOId','LineId','RawDescription','ParsedItemNumber','ParsedItemName','ParsedPrice','Qty','SourceSheet','SourceRow','JobKey'];
//   const missing = need.filter(h => col[h] == null);
//   if (missing.length) throw new Error('ActionHub missing required columns: ' + missing.join(', '));

//   const grid = hub.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const now = new Date();

//   const itemsByNumber = getStrivenItemsIndex_();

//   let ran = 0, ok = 0, fail = 0, skipped = 0;

//   for (let i = 0; i < grid.length; i++) {
//     if (ran >= batchSize) break;

//     const rowIdx = i + 2;
//     const r = grid[i];

//     const state = enp_norm_(r[col['State']]).toUpperCase();
//     if (state !== 'PENDING') continue;

//     const attempts = Number(r[col['Attempts']]) || 0;
//     if (attempts >= ENP_CFG.RUNNER_MAX_ATTEMPTS) { skipped++; continue; }

//     const nextRun = r[col['NextRunAt']];
//     if (nextRun instanceof Date && nextRun.getTime() > now.getTime()) { skipped++; continue; }

//     // mark RUNNING immediately
//     r[col['State']] = 'RUNNING';
//     r[col['LastRunAt']] = now;
//     r[col['Attempts']] = attempts + 1;
//     r[col['LastError']] = '';
//     hub.getRange(rowIdx, 1, 1, lastCol).setValues([r]);

//     ran++;

//     try {
//       const soId = Number(r[col['SOId']]) || null;
//       if (!soId) throw new Error('Missing SOId.');

//       const rawDesc = enp_norm_(r[col['RawDescription']]);
//       const parsed = (typeof parseItemFromDescription_ === 'function') ? parseItemFromDescription_(rawDesc) : { itemNumber:'', name:'', price:null };

//       const itemNumber = enp_norm_(r[col['ParsedItemNumber']] || parsed?.itemNumber);
//       const itemName   = enp_norm_(r[col['ParsedItemName']] || parsed?.name);
//       const qty        = enp_num_(r[col['Qty']]);
//       const priceCell  = r[col['ParsedPrice']];
//       const priceParsed = Number(priceCell || parsed?.price);
//       const price = Number.isFinite(priceParsed) ? priceParsed : null;

//       if (!itemNumber) throw new Error('ParsedItemNumber missing. Description must contain "Item Number:".');

//       // 1) Ensure NewItemId (map or create)
//       let newItemId = Number(r[col['NewItemId']]) || null;
//       if (!newItemId) {
//         const existing = itemsByNumber.get(itemNumber.toUpperCase());
//         if (existing) {
//           newItemId = existing;
//         } else {
//           const payload = enp_buildItemPayloadFromParsed_(itemNumber, itemName, price);
//           const res = strivenRequest_('POST', '/v1/items', payload);
//           newItemId = extractItemIdFromResponse_(res);
//           if (!newItemId) throw new Error('Create succeeded but no Item Id returned.');
//           itemsByNumber.set(itemNumber.toUpperCase(), newItemId);
//         }
//         r[col['NewItemId']] = newItemId;
//         hub.getRange(rowIdx, 1, 1, lastCol).setValues([r]);
//       }

//       // 2) Replace placeholder line STRICT
//       const lineId = Number(r[col['LineId']]) || null;
//       const so = getSalesOrderById_(soId);
//       const lineItems = getSoLineItems_(so);
//       if (!Array.isArray(lineItems) || !lineItems.length) throw new Error(`SO ${soId} has no lineItems.`);

//       const placeholderId = 36935;
//       const tok = normToken_(itemNumber);

//       let matches = [];

//       // Prefer LineId if present
//       if (lineId) {
//         const li = lineItems.find(x => Number(x?.id ?? x?.Id) === lineId);
//         if (li) matches = [li];
//       }

//       // Fallback: match by placeholder/new item id + qty + token in description
//       if (!matches.length) {
//         matches = lineItems.filter(li => {
//           const liItemId = Number(li?.item?.id ?? li?.Item?.Id) || null;
//           if (liItemId !== placeholderId && liItemId !== Number(newItemId)) return false;

//           const liQty = num_(li?.qty ?? li?.Qty ?? li?.quantity ?? li?.Quantity);
//           if (qty != null && liQty != null && qty !== liQty) return false;

//           const d = String(li?.description ?? li?.Description ?? '');
//           const dt = normToken_(d);
//           return tok && dt.includes(tok);
//         });
//       }

//       if (matches.length === 0) throw new Error(`No matching placeholder line found on SO ${soId} for ${itemNumber}.`);
//       if (matches.length > 1) throw new Error(`AMBIGUOUS: ${matches.length} matching lines on SO ${soId} for ${itemNumber}.`);

//       const target = matches[0];
//       setLineItemItemId_(target, newItemId);

//       const oldDesc = String(target?.description ?? target?.Description ?? '');
//       if (typeof isEnternewpartPlaceholderDesc_ === 'function' && isEnternewpartPlaceholderDesc_(oldDesc)) {
//         const cleanDesc = buildCleanLineDescription_(parsed, itemNumber);
//         if ('description' in target) target.description = cleanDesc;
//         if ('Description' in target) target.Description = cleanDesc;
//         if (price != null && price > 0) setLineItemPrice_(target, price);
//       }

//       const payloadSO = buildSalesOrderUpsertPayloadFromGet_(so, lineItems);
//       strivenRequest_('POST', '/v1/sales-orders', payloadSO);

//       // 3) Mark DONE + writeback to source
//       r[col['State']] = 'DONE';
//       r[col['LastError']] = '';
//       r[col['NextRunAt']] = '';
//       hub.getRange(rowIdx, 1, 1, lastCol).setValues([r]);

//       enp_writeBackToSource_(ss, r, col, newItemId, `DONE (SO ${soId})`);

//       ok++;

//     } catch (e) {
//       const msg = String(e && e.message ? e.message : e);

//       const attemptsNow = Number(r[col['Attempts']]) || 1;
//       const minutes = Math.min(240, 5 * Math.pow(2, Math.max(0, attemptsNow - 1))); // 5,10,20,... cap 4h
//       const next = new Date(Date.now() + minutes * 60 * 1000);

//       r[col['State']] = 'FAILED';
//       r[col['LastError']] = msg;
//       r[col['NextRunAt']] = next;
//       hub.getRange(rowIdx, 1, 1, lastCol).setValues([r]);

//       fail++;
//     }

//     Utilities.sleep(100);
//   }

//   SpreadsheetApp.getActive().toast(`ActionHub run: Ran=${ran} OK=${ok} FAIL=${fail} SKIP=${skipped}`, 'Enternewpart', 6);
// }

// /* =========================
//  * Item payload for runner
//  * ========================= */

// function enp_defaultItemTypeId_() {
//   if (typeof ENTERNEWPART_DEFAULT_ITEM_TYPE_ID !== 'undefined') {
//     const n = Number(ENTERNEWPART_DEFAULT_ITEM_TYPE_ID);
//     if (Number.isFinite(n) && n > 0) return n;
//   }
//   const props = PropertiesService.getScriptProperties();
//   const v = Number(props.getProperty('ENTERNEWPART_DEFAULT_ITEM_TYPE_ID'));
//   if (Number.isFinite(v) && v > 0) return v;
//   throw new Error('Missing ENTERNEWPART_DEFAULT_ITEM_TYPE_ID (const or Script Property).');
// }

// function enp_buildItemPayloadFromParsed_(itemNumber, itemName, priceOrNull) {
//   const itemTypeId = enp_defaultItemTypeId_();
//   return {
//     ItemNumber: String(itemNumber).trim(),
//     Name: String(itemName || itemNumber).trim(),
//     Price: (priceOrNull != null ? Number(priceOrNull) : 0),
//     Cost: 0,
//     ItemType: { Id: itemTypeId, Name: '' }
//   };
// }

// /* =========================
//  * Writeback to source sheet
//  * ========================= */

// function enp_writeBackToSource_(ss, hubRow, hubCol, newItemId, note) {
//   const sourceSheet = enp_norm_(hubRow[hubCol['SourceSheet']]);
//   const sourceRow = Number(hubRow[hubCol['SourceRow']]) || null;
//   if (!sourceSheet || !sourceRow) return;

//   const sh = ss.getSheetByName(sourceSheet);
//   if (!sh) return;

//   const lastCol = sh.getLastColumn();
//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(enp_norm_);
//   const col = enp_indexByHeader_LASTWINS_(headers);

//   if (col['NewItemId'] != null) sh.getRange(sourceRow, col['NewItemId'] + 1).setValue(newItemId);
//   if (col['LastAction'] != null) sh.getRange(sourceRow, col['LastAction'] + 1).setValue(note);
//   if (col['LastError'] != null) sh.getRange(sourceRow, col['LastError'] + 1).setValue('');
//   if (col['LastUpdated'] != null) sh.getRange(sourceRow, col['LastUpdated'] + 1).setValue(new Date());

//   // If quoted: turn off the gate checkbox once done
//   if (sourceSheet === ENP_CFG.SHEETS.QUOTED) {
//     const gateIdx = col[ENP_CFG.QUOTED_GATE_HEADER];
//     if (gateIdx != null) sh.getRange(sourceRow, gateIdx + 1).setValue(false);
//   }
// }