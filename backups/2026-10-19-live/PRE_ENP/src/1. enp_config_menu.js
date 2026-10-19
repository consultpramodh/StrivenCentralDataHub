// /******************************************************
//  * ENP Minimal v1
//  * - Menu
//  * - Auto Sync (Approved + Quoted)
//  * - Intake -> ActionHub with correct gating
//  *
//  * Assumes these already exist in your project:
//  *   syncEnternewpartReportToSheet()
//  *   syncEnternewpartQuotedReportToSheet()
//  ******************************************************/

// /* =========================
//  * CONFIG
//  * ========================= */

// const ENP_CFG = {
//   SHEET_APPROVED: 'Enternewpart',
//   SHEET_QUOTED: 'Enternewpart_Quoted',
//   SHEET_HUB: 'ActionHub',

//   // Quoted gate checkbox header (STRICT boolean TRUE)
//   QUOTED_GATE_HEADER: 'SendToActions',

//   // Placeholder item number that indicates a row needs work
//   PLACEHOLDER_ITEMNUMBER: 'ENTERNEWPART',

//   HUB_HEADERS: [
//     'SOId',
//     'SONumber',
//     'LineId',
//     'RawDescription',
//     'ParsedItemNumber',
//     'ParsedItemName',
//     'NewItemId',
//     'State',
//     'JobKey',
//     'Attempts',
//     'NextRunAt',
//     'LastRunAt',
//     'LastError',
//     'ParsedPrice',
//     'Qty',
//     'SourceSheet',
//     'SourceRow'
//   ],

//   HUB_STATE_PENDING: 'PENDING'
// };

// /* =========================
//  * MENU
//  * ========================= */

// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Enternewpart (Lean)')
//     .addItem('Run: Auto Sync + Intake -> ActionHub', 'enp_intake_tick')
//     .addSeparator()
//     .addItem('Setup: Create/Repair ActionHub headers', 'enp_hub_setup')
//     .addToUi();
// }

// /* =========================
//  * MAIN: Auto Sync + Intake
//  * ========================= */

// function enp_intake_tick() {
//   const lock = LockService.getDocumentLock();
//   lock.waitLock(30000);

//   try {
//     const ss = SpreadsheetApp.getActive();

//     // 1) Auto-sync both reports (best effort but visible logging)
//     enp_tryCall_('syncEnternewpartReportToSheet', 'Approved sync');
//     enp_tryCall_('syncEnternewpartQuotedReportToSheet', 'Quoted sync');

//     // 2) Ensure hub exists + headers
//     const hub = enp_hub_getOrCreate_(ss);
//     const hubCol = enp_indexByHeader_(hub.getRange(1,1,1,hub.getLastColumn()).getValues()[0]);
//     const existingKeys = enp_hub_loadJobKeys_(hub, hubCol);

//     // 3) Intake
//     const pushedApproved = enp_pushFromSheet_(ss, hub, hubCol, existingKeys, {
//       sheetName: ENP_CFG.SHEET_APPROVED,
//       mode: 'APPROVED_AUTO'
//     });

//     const pushedQuoted = enp_pushFromSheet_(ss, hub, hubCol, existingKeys, {
//       sheetName: ENP_CFG.SHEET_QUOTED,
//       mode: 'QUOTED_CHECKBOX',
//       gateHeader: ENP_CFG.QUOTED_GATE_HEADER
//     });

//     ss.toast(`✅ Intake complete. Approved=${pushedApproved} Quoted=${pushedQuoted}`, 'ENP', 6);
//   } finally {
//     lock.releaseLock();
//   }
// }

// /* =========================
//  * HUB SETUP
//  * ========================= */

// function enp_hub_setup() {
//   const ss = SpreadsheetApp.getActive();
//   enp_hub_getOrCreate_(ss);
//   ss.toast('✅ ActionHub headers OK', 'ENP', 4);
// }

// function enp_hub_getOrCreate_(ss) {
//   let hub = ss.getSheetByName(ENP_CFG.SHEET_HUB);
//   if (!hub) hub = ss.insertSheet(ENP_CFG.SHEET_HUB);

//   const lastRow = hub.getLastRow();
//   const lastCol = hub.getLastColumn();

//   // If empty sheet, write full header row
//   const firstCell = lastRow >= 1 && lastCol >= 1 ? String(hub.getRange(1,1).getValue() || '').trim() : '';
//   if (!firstCell) {
//     hub.clear();
//     hub.getRange(1, 1, 1, ENP_CFG.HUB_HEADERS.length).setValues([ENP_CFG.HUB_HEADERS]).setFontWeight('bold');
//     hub.setFrozenRows(1);
//     hub.autoResizeColumns(1, ENP_CFG.HUB_HEADERS.length);
//     return hub;
//   }

//   // Otherwise, only add missing headers (do NOT wipe)
//   const headers = hub.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h||'').trim());
//   const col = enp_indexByHeader_(headers);

//   let changed = false;
//   ENP_CFG.HUB_HEADERS.forEach(h => {
//     if (col[h] == null) {
//       hub.getRange(1, hub.getLastColumn() + 1).setValue(h).setFontWeight('bold');
//       changed = true;
//     }
//   });

//   if (changed) {
//     hub.setFrozenRows(1);
//     hub.autoResizeColumns(1, hub.getLastColumn());
//   }
//   return hub;
// }

// function enp_hub_loadJobKeys_(hub, hubCol) {
//   const jobIdx = hubCol['JobKey'];
//   const lastRow = hub.getLastRow();
//   const lastCol = hub.getLastColumn();
//   const set = new Set();

//   if (jobIdx == null || lastRow < 2) return set;

//   const vals = hub.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   for (const r of vals) {
//     const k = String(r[jobIdx] || '').trim();
//     if (k) set.add(k);
//   }
//   return set;
// }

// /* =========================
//  * INTAKE (Approved + Quoted)
//  * ========================= */

// function enp_pushFromSheet_(ss, hub, hubCol, existingKeys, cfg) {
//   const sh = ss.getSheetByName(cfg.sheetName);
//   if (!sh) return 0;

//   const lastRow = sh.getLastRow();
//   const lastCol = sh.getLastColumn();
//   if (lastRow < 2 || lastCol < 1) return 0;

//   const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(h => String(h||'').trim());
//   const col = enp_indexByHeader_LASTWINS_(headers);

//   // Required source cols (minimum)
//   const need = ['SalesOrderSalesOrderId', 'SalesOrderNumber', 'ItemNumber', 'ItemDescription', 'Quantity'];
//   const missing = need.filter(h => col[h] == null);
//   if (missing.length) {
//     Logger.log(`⚠ ${cfg.sheetName} missing required columns: ${missing.join(', ')}`);
//     return 0;
//   }

//   // Quoted gate
//   let gateIdx = null;
//   if (cfg.mode === 'QUOTED_CHECKBOX') {
//     gateIdx = col[cfg.gateHeader];
//     if (gateIdx == null) {
//       Logger.log(`⚠ ${cfg.sheetName} missing gate checkbox "${cfg.gateHeader}".`);
//       return 0;
//     }
//   }

//   const grid = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const rowsToAppend = [];
//   let pushed = 0;

//   for (let i = 0; i < grid.length; i++) {
//     const r = grid[i];
//     const sourceRow = i + 2;

//     // Gate quoted strictly boolean TRUE
//     if (cfg.mode === 'QUOTED_CHECKBOX') {
//       if (r[gateIdx] !== true) continue;
//     }

//     const itemNum = String(r[col['ItemNumber']] || '').trim().toUpperCase();
//     if (itemNum !== ENP_CFG.PLACEHOLDER_ITEMNUMBER) continue;

//     const soId = Number(r[col['SalesOrderSalesOrderId']]) || null;
//     if (!soId) continue;

//     const soNumber = String(r[col['SalesOrderNumber']] || '').trim();
//     const rawDesc = String(r[col['ItemDescription']] || '').trim();
//     if (!rawDesc) continue;

//     const parsed = (typeof parseItemFromDescription_ === 'function')
//       ? parseItemFromDescription_(rawDesc)
//       : { itemNumber: '', name: '', price: null };

//     const parsedNum = String(parsed?.itemNumber || '').trim();
//     const parsedName = String(parsed?.name || '').trim();
//     const parsedPrice = Number(parsed?.price);
//     const priceOut = Number.isFinite(parsedPrice) ? parsedPrice : '';

//     const qty = enp_num_(r[col['Quantity']]);

//     const lineId = col['LineId'] != null ? String(r[col['LineId']] || '').trim() : '';
//     const jobKey = enp_buildJobKey_(soId, lineId, parsedNum || rawDesc);

//     if (existingKeys.has(jobKey)) continue;

//     rowsToAppend.push([
//       soId,
//       soNumber,
//       lineId,
//       rawDesc,
//       parsedNum,
//       parsedName,
//       '',                      // NewItemId
//       ENP_CFG.HUB_STATE_PENDING,
//       jobKey,
//       0,                       // Attempts
//       '',                      // NextRunAt
//       '',                      // LastRunAt
//       '',                      // LastError
//       priceOut,                // ParsedPrice
//       (qty != null ? qty : ''),// Qty
//       cfg.sheetName,           // SourceSheet
//       sourceRow                // SourceRow
//     ]);

//     existingKeys.add(jobKey);
//     pushed++;
//   }

//   if (rowsToAppend.length) {
//     const startRow = hub.getLastRow() + 1;
//     hub.getRange(startRow, 1, rowsToAppend.length, ENP_CFG.HUB_HEADERS.length).setValues(rowsToAppend);
//   }

//   return pushed;
// }

// /* =========================
//  * HELPERS
//  * ========================= */

// function enp_tryCall_(fnName, label) {
//   try {
//     const fn = globalThis[fnName];
//     if (typeof fn !== 'function') {
//       Logger.log(`⚠ ${label}: function not found: ${fnName}`);
//       return;
//     }
//     fn();
//     Logger.log(`✅ ${label}: ok`);
//   } catch (e) {
//     Logger.log(`⚠ ${label}: failed: ${e.message}`);
//   }
// }

// function enp_indexByHeader_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const key = String(h || '').trim();
//     if (!key) return;
//     map[key] = i;
//   });
//   return map;
// }

// function enp_indexByHeader_LASTWINS_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const key = String(h || '').trim();
//     if (!key) return;
//     map[key] = i; // last wins
//   });
//   return map;
// }

// function enp_buildJobKey_(soId, lineId, stableText) {
//   const tok = String(stableText || '').toUpperCase().replace(/\s+/g, ' ').trim();
//   const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok, Utilities.Charset.UTF_8);
//   const b64 = Utilities.base64EncodeWebSafe(bytes).slice(0, 12);
//   return `SO:${soId}|LINE:${lineId || ''}|H:${b64}`;
// }

// function enp_num_(v) {
//   if (v === '' || v == null) return null;
//   const n = Number(String(v).replace(/[^0-9.-]/g, ''));
//   return isNaN(n) ? null : n;
// }