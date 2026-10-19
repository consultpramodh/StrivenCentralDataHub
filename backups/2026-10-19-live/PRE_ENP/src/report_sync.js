// /******************************************************
//  * ENTERNEWPART — MASTER SYNC
//  * Syncs:
//  *  1) Main Enternewpart report
//  *  2) Quoted Enternewpart report
//  *  3) Striven_Items report
//  *
//  * This is the ONLY function the pipeline will call.
//  ******************************************************/

// function enternewpart_syncAllReports() {
//   const start = Date.now();
//   const ss = SpreadsheetApp.getActive();

//   const results = [];

//   // 1️⃣ MAIN ENTERNEWPART REPORT
//   try {
//     syncEnternewpartReportToSheet();
//     const sh1 = ss.getSheetByName(ENTERNEWPART_SHEET_NAME);
//     results.push({
//       sheet: ENTERNEWPART_SHEET_NAME,
//       rows: sh1 ? Math.max(sh1.getLastRow() - 1, 0) : 0
//     });
//   } catch (e) {
//     Logger.log('❌ Main report sync failed: ' + e);
//     throw e;
//   }

//   // 2️⃣ QUOTED REPORT
//   try {
//     syncEnternewpartQuotedReportToSheet();
//     const sh2 = ss.getSheetByName(ENTERNEWPART_QUOTED_SHEET_NAME);
//     results.push({
//       sheet: ENTERNEWPART_QUOTED_SHEET_NAME,
//       rows: sh2 ? Math.max(sh2.getLastRow() - 1, 0) : 0
//     });
//   } catch (e) {
//     Logger.log('❌ Quoted report sync failed: ' + e);
//     throw e;
//   }

//   // 3️⃣ STRIVEN ITEMS REPORT (CRITICAL FOR CREATE DEDUPE)
//   try {
//     fetchStrivenItemsReportToSheet();
//     const sh3 = ss.getSheetByName('Striven_Items');
//     results.push({
//       sheet: 'Striven_Items',
//       rows: sh3 ? Math.max(sh3.getLastRow() - 1, 0) : 0
//     });
//   } catch (e) {
//     Logger.log('❌ Striven_Items sync failed: ' + e);
//     throw e;
//   }

//   const seconds = ((Date.now() - start) / 1000).toFixed(2);

//   Logger.log(`✅ ALL SYNC COMPLETE in ${seconds}s`);
//   results.forEach(r => {
//     Logger.log(`   ${r.sheet}: ${r.rows} rows`);
//   });

//   ss.toast(
//     `Synced: ${results.map(r => `${r.sheet} (${r.rows})`).join(' | ')}`,
//     'Enternewpart',
//     6
//   );

//   return {
//     reports: results,
//     seconds
//   };
// }


// /************************************************************
//  * enternewpart_common.gs
//  * Shared helpers for Enternewpart (Approved + Quoted)
//  ************************************************************/

// function extractReportHeaders_(body) {
//   const cols =
//     body?.columns ||
//     body?.Columns ||
//     body?.meta?.columns ||
//     body?.Meta?.Columns ||
//     body?.schema?.columns;

//   if (Array.isArray(cols) && cols.length) {
//     const h = cols
//       .map(c => c?.name ?? c?.Name ?? c?.field ?? c?.Field ?? c?.key ?? c?.Key ?? c?.label ?? c?.Label)
//       .filter(Boolean)
//       .map(x => String(x).trim());
//     if (h.length) return h;
//   }

//   const headerList =
//     body?.headers ||
//     body?.Headers ||
//     body?.columnHeaders ||
//     body?.ColumnHeaders;

//   if (Array.isArray(headerList) && headerList.length) {
//     return headerList.map(x => String(x).trim()).filter(Boolean);
//   }

//   const data = body?.data || body?.Data;
//   if (!Array.isArray(data) || !data.length) return [];

//   // Derive from object-rows
//   const maxScan = Math.min(50, data.length);
//   const seen = new Set();
//   const out = [];

//   for (let i = 0; i < maxScan; i++) {
//     const r = data[i];
//     if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
//     Object.keys(r).forEach(k => {
//       const key = String(k).trim();
//       if (!key || seen.has(key)) return;
//       seen.add(key);
//       out.push(key);
//     });
//   }
//   return out;
// }

// function indexByHeader_LASTWINS_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const key = String(h || '').trim();
//     if (!key) return;
//     map[key] = i; // last wins
//   });
//   return map;
// }


// function ensureHeaders_(sh, wantedHeaders) {
//   const lastCol = Math.max(1, sh.getLastColumn());
//   const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());

//   // If sheet is empty/no headers, write full header row.
//   const existingNonBlank = existing.filter(Boolean);
//   if (!existingNonBlank.length) {
//     sh.getRange(1, 1, 1, wantedHeaders.length).setValues([wantedHeaders]).setFontWeight('bold');
//     return;
//   }

//   // Append any missing headers to the right (DO NOT overwrite existing)
//   const col = indexByHeader_LASTWINS_(existing);
//   let writeCol = existing.length;

//   for (const h of wantedHeaders) {
//     if (!h) continue;
//     if (col[h] == null) {
//       writeCol += 1;
//       sh.getRange(1, writeCol).setValue(h).setFontWeight('bold');
//       col[h] = writeCol - 1;
//     }
//   }
// }



// function enp_diag_all() {
//   const ss = SpreadsheetApp.getActive();

//   Logger.log('=== ENP DIAG START ===');
//   Logger.log('Approved sheet (cfg): ' + ENP_CFG.SHEETS.APPROVED);
//   Logger.log('Quoted sheet   (cfg): ' + ENP_CFG.SHEETS.QUOTED);
//   Logger.log('Hub sheet      (cfg): ' + ENP_CFG.SHEETS.HUB);

//   enp_diag_sheet_(ss, ENP_CFG.SHEETS.APPROVED, 'APPROVED');
//   enp_diag_sheet_(ss, ENP_CFG.SHEETS.QUOTED,   'QUOTED');
//   enp_diag_hub_(ss);

//   Logger.log('=== ENP DIAG END ===');
// }

// function enp_diag_sheet_(ss, sheetName, label) {
//   const sh = ss.getSheetByName(sheetName);
//   if (!sh) {
//     Logger.log(`❌ ${label}: sheet not found: ${sheetName}`);
//     return;
//   }

//   const lastRow = sh.getLastRow();
//   const lastCol = sh.getLastColumn();
//   Logger.log(`✅ ${label}: rows=${lastRow} cols=${lastCol}`);

//   if (lastRow < 2) {
//     Logger.log(`⚠ ${label}: no data rows`);
//     return;
//   }

//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
//   const col = enp_indexByHeader_LASTWINS_(headers);

//   const required = ['SalesOrderSalesOrderId','ItemNumber','ItemDescription','Quantity'];
//   const missing = required.filter(h => col[h] == null);
//   if (missing.length) {
//     Logger.log(`❌ ${label}: missing required headers: ${missing.join(', ')}`);
//     Logger.log(`   First 30 headers: ${headers.slice(0,30).join(' | ')}`);
//     return;
//   }

//   const gateHeader = ENP_CFG.QUOTED_GATE_HEADER;
//   if (label === 'QUOTED') {
//     if (col[gateHeader] == null) {
//       Logger.log(`❌ QUOTED: missing gate header "${gateHeader}"`);
//       Logger.log(`   Headers containing 'Send': ${headers.filter(h => /send/i.test(h)).join(' | ')}`);
//       return;
//     }
//   }

//   // scan + count what would queue
//   const grid = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   let placeholders = 0, unresolved = 0, gatedTrue = 0, eligible = 0;

//   const gateIdx = (label === 'QUOTED') ? col[gateHeader] : null;
//   const newItemIdx = col['NewItemId'] ?? null;

//   for (let i = 0; i < grid.length; i++) {
//     const r = grid[i];

//     const itemNum = String(r[col['ItemNumber']] || '').trim().toUpperCase();
//     const isPlaceholder = itemNum === ENP_CFG.PLACEHOLDER_ITEMNUMBER;
//     if (isPlaceholder) placeholders++;

//     const newItemId = (newItemIdx != null) ? (Number(r[newItemIdx]) || null) : null;
//     const isUnresolved = !newItemId;
//     if (isPlaceholder && isUnresolved) unresolved++;

//     const gateOk = (label !== 'QUOTED') ? true : (r[gateIdx] === true);
//     if (label === 'QUOTED' && r[gateIdx] === true) gatedTrue++;

//     if (isPlaceholder && isUnresolved && gateOk) eligible++;
//   }

//   Logger.log(`📌 ${label}: placeholders=${placeholders} placeholder+unresolved=${unresolved} gateTRUE=${gatedTrue} ELIGIBLE=${eligible}`);

//   if (label === 'QUOTED') {
//     Logger.log(`   Gate header="${gateHeader}" note: must be boolean TRUE (checkbox), not text "TRUE".`);
//   }
// }

// function enp_diag_hub_(ss) {
//   const hub = ss.getSheetByName(ENP_CFG.SHEETS.HUB);
//   if (!hub) {
//     Logger.log(`⚠ HUB: not found (${ENP_CFG.SHEETS.HUB}). Pipeline should create it.`);
//     return;
//   }
//   const r = hub.getLastRow();
//   const c = hub.getLastColumn();
//   Logger.log(`✅ HUB: rows=${r} cols=${c}`);
//   if (r >= 2) {
//     const headers = hub.getRange(1,1,1,c).getValues()[0].map(h => String(h||'').trim());
//     Logger.log(`   HUB headers first 20: ${headers.slice(0,20).join(' | ')}`);
//   }
// }