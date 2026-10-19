// /******************************************************
//  * config.gs — GLOBAL CONFIG + SINGLE onOpen()
//  * This file is the ONLY place for:
//  *  - constants
//  *  - menus
//  *  - (optional) trigger install helpers
//  *
//  * RULES:
//  *  - Do NOT redeclare any of these constants elsewhere.
//  *  - If you rename a sheet/tab, change it here ONLY.
//  ******************************************************/

// /* ======================================================
//  * Project / Sheet Names
//  * ====================================================== */
// const ENP = {
//   // Feeder report sheet(s) (you may have more than one; keep list)
//   REPORT_SHEETS: [
//     'Enternewpart_Report', // TODO: rename to your real report tab if different
//   ],

//   // Queue / workflow hub
//   ACTION_HUB_SHEET: 'ActionHub',

//   // Local index of Striven Items (fast lookup; your script already uses this concept)
//   STRIVEN_ITEMS_SHEET: 'Striven_Items',

//   // Status/log sheets (optional)
//   STATUS_SHEET: 'STATUS',
// };



// /******************************************************
//  * config.gs — Enternewpart Pipeline + ActionHub config
//  ******************************************************/

// const ENP_CFG = {
//   SHEETS: {
//     APPROVED: 'Enternewpart',
//     QUOTED: 'Enternewpart_Quoted',
//     HUB: 'ActionHub',
//   },

//   // Canonical schemas (order is the output order; scripts write by header name)
//   HEADERS: {
//     HUB: [
//       'SOId',
//       'SONumber',
//       'LineId',
//       'RawDescription',
//       'ParsedItemNumber',
//       'ParsedItemName',
//       'ParsedPrice',
//       'Qty',
//       'NewItemId',
//       'State',        // PENDING | RUNNING | DONE | FAILED
//       'JobKey',
//       'Attempts',
//       'NextRunAt',
//       'LastRunAt',
//       'LastError',
//       'SourceSheet',
//       'SourceRow'
//     ],
//   },

//   // Gates / constants
//   QUOTED_GATE_HEADER: 'SendToActions',
//   PLACEHOLDER_ITEMNUMBER: 'ENTERNEWPART',
//   STATE_PENDING: 'PENDING',

//   // Runner defaults
//   RUNNER_MAX_ATTEMPTS: 5,
//   RUNNER_BATCH_SIZE: 10,
// };

// /* ======================================================
//  * Pipeline Runtime Settings
//  * ====================================================== */
// const ENP_PIPE = {
//   // How many hub rows to process per tick (avoid Apps Script timeouts)
//   BATCH_SIZE: 25,

//   // Time-driven trigger cadence (minutes)
//   TICK_MINUTES: 10,

//   // Lock timeout in ms
//   LOCK_WAIT_MS: 20 * 1000,

//   // Backoff (for retries) — base minutes
//   RETRY_BASE_MINUTES: 5,

//   // Max attempts before DEAD/ERROR
//   MAX_ATTEMPTS: 6,
// };

// /* ======================================================
//  * Menu (single onOpen)
//  * ====================================================== */
// function onOpen() {
//   const ui = SpreadsheetApp.getUi();

//   // =========================
//   // 🔄 ENTERNEWPART — DATA SYNC
//   // =========================
//   ui.createMenu('🔄 Sync Reports)')
//     .addItem('Sync: All Reports', 'enternewpart_syncAllReports')
//     .addSeparator()
//     .addItem('ENTERNEWPART: Approved Only', 'syncEnternewpartReportToSheet')
//     .addItem('ENTERNEWPART: Quoted Only', 'syncEnternewpartQuotedReportToSheet')
//     .addItem('Striven Items', 'fetchStrivenItemsReportToSheet')
//     .addToUi();


//   // =========================
//   // 📦 ENTERNEWPART — ACTION HUB
//   // =========================
//   ui.createMenu('📦 Action Hub')
//     .addItem('Setup: Action Hub + Routing Columns', 'enternewpart_actionHub_setup')
//     .addSeparator()
//     .addItem('Push: Checked Rows to Action Hub', 'enternewpart_actionHub_pushChecked')
//     .addSeparator()
//     .addItem('Run: Create Items (selected rows)', 'enternewpart_actionHub_runCreateSelected')
//     .addItem('Run: Replace in SO (selected rows)', 'enternewpart_actionHub_runReplaceSelected_STRICT')
//     .addToUi();


//   // =========================
//   // 🤖 ENTERNEWPART — PIPELINE
//   // =========================
//   ui.createMenu('🤖 Enternewpart Pipeline')
//     .addItem('Run: Tick Now (safe batch)', 'enternewpart_pipeline_tick')
//     .addSeparator()
//     .addItem('Setup: Install Trigger (every 10 min)', 'enternewpart_pipeline_installTrigger')
//     .addItem('Setup: Remove Trigger', 'enternewpart_pipeline_removeTrigger')
//     .addToUi();


//       // =========================
//   // 🛠 MANUAL ITEM CREATION
//   // =========================
//   ui.createMenu('🛠 Manual ItemCreation')
//     .addItem('Create: Active Row', 'manualCreateItem_activeRow')
//     .addItem('Create: Selected Rows', 'manualCreateItems_selectedRows')
//     .addToUi();
// }

// /* ======================================================
//  * Trigger Helpers (optional but recommended)
//  * ====================================================== */

// /**
//  * Installs a time-driven trigger that runs enternewpart_pipeline_tick()
//  * every ENP_PIPE.TICK_MINUTES minutes.
//  */
// function enternewpart_pipeline_installTrigger() {
//   // Remove existing first (prevents duplicates)
//   enternewpart_pipeline_removeTrigger();

//   ScriptApp.newTrigger('enternewpart_pipeline_tick')
//     .timeBased()
//     .everyMinutes(ENP_PIPE.TICK_MINUTES)
//     .create();

//   SpreadsheetApp.getActive().toast(
//     `Installed pipeline trigger: every ${ENP_PIPE.TICK_MINUTES} minutes`,
//     'Enternewpart'
//   );
// }

// /** Removes ALL triggers pointing to enternewpart_pipeline_tick() */
// function enternewpart_pipeline_removeTrigger() {
//   const triggers = ScriptApp.getProjectTriggers();
//   let removed = 0;

//   triggers.forEach(t => {
//     if (t.getHandlerFunction && t.getHandlerFunction() === 'enternewpart_pipeline_tick') {
//       ScriptApp.deleteTrigger(t);
//       removed++;
//     }
//   });

//   SpreadsheetApp.getActive().toast(
//     removed ? `Removed ${removed} pipeline trigger(s)` : 'No pipeline triggers found',
//     'Enternewpart'
//   );
// }




// /******************************************************
//  * enp_utils.gs — utilities (header mapping, hashing)
//  ******************************************************/

// function enp_norm_(v) {
//   return String(v == null ? '' : v).trim();
// }

// function enp_isTrueCheckboxStrict_(v) {
//   // STRICT: must be actual boolean true (checkbox)
//   return v === true;
// }

// function enp_isTruthyLoose_(v) {
//   return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || String(v).toUpperCase() === 'YES';
// }

// function enp_num_(v) {
//   if (v === '' || v == null) return null;
//   const n = Number(String(v).replace(/[^0-9.-]/g, ''));
//   return isNaN(n) ? null : n;
// }

// function enp_indexByHeader_LASTWINS_(headers) {
//   const map = {};
//   headers.forEach((h, i) => {
//     const k = enp_norm_(h);
//     if (k) map[k] = i; // last wins
//   });
//   return map;
// }

// function enp_getHeaders_(sh) {
//   const lastCol = Math.max(1, sh.getLastColumn());
//   const row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
//   return row.map(h => enp_norm_(h));
// }

// function enp_ensureHeaders_(sh, expectedHeaders) {
//   const lastRow = sh.getLastRow();
//   const lastCol = Math.max(1, sh.getLastColumn());

//   const hasHeaderCell = lastRow >= 1 && enp_norm_(sh.getRange(1, 1).getValue()) !== '';
//   if (!hasHeaderCell) {
//     sh.clear();
//     sh.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]).setFontWeight('bold');
//     sh.setFrozenRows(1);
//     return;
//   }

//   const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => enp_norm_(h));
//   const col = enp_indexByHeader_LASTWINS_(existing);

//   let changed = false;
//   expectedHeaders.forEach(h => {
//     if (col[h] == null) {
//       sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
//       changed = true;
//     }
//   });

//   if (changed) sh.setFrozenRows(1);
// }

// function enp_rowFromObject_(headers, obj) {
//   const out = new Array(headers.length).fill('');
//   const idx = {};
//   headers.forEach((h, i) => (idx[h] = i));
//   Object.keys(obj).forEach(k => {
//     if (idx[k] != null) out[idx[k]] = obj[k];
//   });
//   return out;
// }

// function enp_loadExistingJobKeys_(hub) {
//   const lastRow = hub.getLastRow();
//   const lastCol = hub.getLastColumn();
//   if (lastRow < 2) return new Set();

//   const headers = hub.getRange(1, 1, 1, lastCol).getValues()[0].map(enp_norm_);
//   const col = enp_indexByHeader_LASTWINS_(headers);
//   const jobIdx = col['JobKey'];
//   if (jobIdx == null) return new Set();

//   const vals = hub.getRange(2, 1, lastRow - 1, lastCol).getValues();
//   const s = new Set();
//   for (const r of vals) {
//     const k = enp_norm_(r[jobIdx]);
//     if (k) s.add(k);
//   }
//   return s;
// }

// function enp_jobKey_(soId, lineId, rawDesc) {
//   const tok = enp_normToken_(rawDesc);
//   const hash = enp_shortHash_(tok);
//   return `SO:${soId}|LINE:${lineId || ''}|H:${hash}`;
// }

// function enp_normToken_(s) {
//   return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5000);
// }

// function enp_shortHash_(s) {
//   const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s || ''), Utilities.Charset.UTF_8);
//   return Utilities.base64EncodeWebSafe(bytes).slice(0, 12);
// }