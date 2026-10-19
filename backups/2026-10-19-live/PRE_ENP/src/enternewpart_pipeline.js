// /************************************************************
//  * enternewpart_pipeline.gs — CLEAN VERSION
//  * - Ensures action columns exist (best-effort)
//  * - Syncs reports (best-effort)
//  * - Pushes into ActionHub with correct gating
//  ************************************************************/

// function enternewpart_pipeline_installTrigger() {
//   enternewpart_pipeline_removeTrigger();
//   ScriptApp.newTrigger('enternewpart_pipeline_tick').timeBased().everyMinutes(10).create();
//   SpreadsheetApp.getActive().toast('✅ Pipeline trigger installed (every 10 min).', 'Enternewpart', 5);
// }

// function enternewpart_pipeline_removeTrigger() {
//   ScriptApp.getProjectTriggers().forEach(t => {
//     if (t.getHandlerFunction && t.getHandlerFunction() === 'enternewpart_pipeline_tick') ScriptApp.deleteTrigger(t);
//   });
//   SpreadsheetApp.getActive().toast('✅ Pipeline trigger removed.', 'Enternewpart', 4);
// }

// function enternewpart_pipeline_tick() {
//   const lock = LockService.getDocumentLock();
//   lock.waitLock(30000);
//   try {
//     enternewpart_pipeline_process_();
//   } finally {
//     lock.releaseLock();
//   }
// }

// function enternewpart_pipeline_process_() {
//   const ss = SpreadsheetApp.getActive();

//   // 0) Ensure action columns exist (best-effort)
//   try { if (typeof enternewpart_setupActionColumns === 'function') enternewpart_setupActionColumns(); } catch (e) {}
//   try { if (typeof enternewpartQuoted_setupActionColumns === 'function') enternewpartQuoted_setupActionColumns(); } catch (e) {}

//   // 1) Sync reports (best-effort)
//   try { if (typeof syncEnternewpartReportToSheet === 'function') syncEnternewpartReportToSheet(); } catch (e) { Logger.log('⚠ Approved sync failed: ' + e.message); }
//   try { if (typeof syncEnternewpartQuotedReportToSheet === 'function') syncEnternewpartQuotedReportToSheet(); } catch (e) { Logger.log('⚠ Quoted sync failed: ' + e.message); }

//   // 2) Ensure ActionHub exists
//   const hub = enp_getOrCreateActionHub_(ss);
//   const existingKeys = enp_loadExistingJobKeys_(hub);

//   // 3) Push approved (auto)
//   const pushedApproved = enp_pushFromSourceSheet_(ss, hub, existingKeys, {
//     sheetName: ENP_CFG.SHEETS.APPROVED,
//     mode: 'APPROVED_AUTO'
//   });

//   // 4) Push quoted (strict checkbox)
//   const pushedQuoted = enp_pushFromSourceSheet_(ss, hub, existingKeys, {
//     sheetName: ENP_CFG.SHEETS.QUOTED,
//     mode: 'QUOTED_STRICT',
//     checkboxHeader: ENP_CFG.QUOTED_GATE_HEADER
//   });

//   ss.toast(`✅ Pipeline queued. Approved=${pushedApproved} Quoted=${pushedQuoted}`, 'Enternewpart', 6);
// }

// /* =========================
//  * ActionHub setup
//  * ========================= */

// function enp_getOrCreateActionHub_(ss) {
//   let hub = ss.getSheetByName(ENP_CFG.SHEETS.HUB);
//   if (!hub) hub = ss.insertSheet(ENP_CFG.SHEETS.HUB);

//   enp_ensureHeaders_(hub, ENP_CFG.HEADERS.HUB);
//   hub.setFrozenRows(1);
//   return hub;
// }

// /* =========================
//  * Push logic
//  * ========================= */

// function enp_pushFromSourceSheet_(ss, hub, existingKeys, cfg) {
//   const sh = ss.getSheetByName(cfg.sheetName);
//   if (!sh) return 0;

//   const lastRow = sh.getLastRow();
//   const lastCol = sh.getLastColumn();
//   if (lastRow < 2 || lastCol < 1) return 0;

//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(enp_norm_);
//   const col = enp_indexByHeader_LASTWINS_(headers);

//   // We tolerate missing SalesOrderNumber/LineId; we do NOT tolerate core ids/desc/qty/itemnumber
//   const need = ['SalesOrderSalesOrderId', 'ItemNumber', 'ItemDescription', 'Quantity'];
//   const missing = need.filter(h => col[h] == null);
//   if (missing.length) {
//     Logger.log(`⚠ ${cfg.sheetName} missing required columns: ${missing.join(', ')}`);
//     return 0;
//   }

//   // Gate for quoted
//   let gateIdx = null;
//   if (cfg.mode === 'QUOTED_STRICT') {
//     gateIdx = col[cfg.checkboxHeader];
//     if (gateIdx == null) {
//       Logger.log(`⚠ ${cfg.sheetName} missing quoted gate column "${cfg.checkboxHeader}".`);
//       return 0;
//     }
//   }

//   const grid = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const hubHeaders = ENP_CFG.HEADERS.HUB;

//   const rowsToAppend = [];
//   let pushed = 0;

//   for (let i = 0; i < grid.length; i++) {
//     const sourceRow = i + 2;
//     const r = grid[i];

//     // quoted strict checkbox
//     if (cfg.mode === 'QUOTED_STRICT') {
//       if (r[gateIdx] !== true) continue;
//     }

//     // placeholder only
//     const itemNum = enp_norm_(r[col['ItemNumber']]);
//     if (itemNum.toUpperCase() !== ENP_CFG.PLACEHOLDER_ITEMNUMBER) continue;

//     // must be unresolved (NewItemId blank)
//     const newItemId = col['NewItemId'] != null ? (Number(r[col['NewItemId']]) || null) : null;
//     if (newItemId) continue;

//     const soId = Number(r[col['SalesOrderSalesOrderId']]) || null;
//     if (!soId) continue;

//     const soNumber = col['SalesOrderNumber'] != null ? enp_norm_(r[col['SalesOrderNumber']]) : '';
//     const lineId = col['LineId'] != null ? enp_norm_(r[col['LineId']]) : '';

//     const rawDesc = enp_norm_(r[col['ItemDescription']]);
//     if (!rawDesc) continue;

//     const parsed = (typeof parseItemFromDescription_ === 'function')
//       ? parseItemFromDescription_(rawDesc)
//       : { itemNumber: '', name: '', price: null };

//     const parsedNum = enp_norm_(parsed?.itemNumber);
//     const parsedName = enp_norm_(parsed?.name);
//     const parsedPrice = Number(parsed?.price);
//     const price = Number.isFinite(parsedPrice) ? parsedPrice : '';

//     const qty = enp_num_(r[col['Quantity']]);
//     const jobKey = enp_jobKey_(soId, lineId, rawDesc);

//     if (existingKeys.has(jobKey)) continue;

//     rowsToAppend.push(enp_rowFromObject_(hubHeaders, {
//       SOId: soId,
//       SONumber: soNumber,
//       LineId: lineId,
//       RawDescription: rawDesc,
//       ParsedItemNumber: parsedNum,
//       ParsedItemName: parsedName,
//       ParsedPrice: price,
//       Qty: qty == null ? '' : qty,
//       NewItemId: '',
//       State: ENP_CFG.STATE_PENDING,
//       JobKey: jobKey,
//       Attempts: 0,
//       NextRunAt: '',
//       LastRunAt: '',
//       LastError: '',
//       SourceSheet: cfg.sheetName,
//       SourceRow: sourceRow
//     }));

//     existingKeys.add(jobKey);
//     pushed++;
//   }

//   if (rowsToAppend.length) {
//     const startRow = hub.getLastRow() + 1;
//     hub.getRange(startRow, 1, rowsToAppend.length, hubHeaders.length).setValues(rowsToAppend);
//   }

//   return pushed;
// }