/************************************************************
 * APPS SCRIPT — FULL REWRITE — 01_config_menu.gs
 * ENTERNEWPART — CONFIG, MENU, TRIGGERS, APPROVED PIPELINE
 *
 * PURPOSE
 * ----------------------------------------------------------
 * This file is the single control layer for:
 * 1) Global config
 * 2) Menu
 * 3) Trigger install / removal
 * 4) Approved-only automation pipeline
 * 5) Full approved pipeline runner
 * 6) CF 820 helpers used by approved replace flow
 *
 * DESIGN RULES
 * ----------------------------------------------------------
 * - Automation is APPROVED-ONLY for Enternewpart
 * - Quoted remains available for MANUAL tools only
 * - Heavy sync is throttled separately from queue/process work
 * - No duplicate wrappers
 * - No duplicate pipeline entry points
 * - No extra sheet scans when they are not needed
 *
 * DEPENDENCIES
 * ----------------------------------------------------------
 * This file assumes these already exist elsewhere in project:
 * - enp_syncItemsReport()
 * - enp_syncApprovedReport_()
 * - enp_createItemsForActiveSheetSelection_(sh)
 * - enp_replaceLinesForActiveSheetSelection_(sh)
 * - manualCreateItems_selectedRows()
 * - enp_getSheetContext_(sh)
 * - enp_ensureActionColumns_(sh, ctx)
 * - enp_parseDescription_(text)
 * - enp_buildItemPayloadFromSheetRow_(row, col)
 * - enp_buildItemIndex_()
 * - enp_lookupItemId_(itemNumber, index)
 * - enp_createItemInStriven_(payload)
 * - enp_extractItemId_(res)
 * - enp_getSalesOrder_(id)
 * - enp_getSalesOrderLineItems_(so)
 * - enp_findTargetPlaceholderLine_(lineItems, opts)
 * - enp_setLineItemItemId_(li, newItemId)
 * - enp_setLineItemPrice_(li, price)
 * - enp_isPlaceholderDescription_(desc)
 * - enp_buildCleanLineDescription_(parsed)
 * - enp_buildSalesOrderUpsertPayload_(so, lineItems)
 * - enp_strivenFetch_(path, options)
 * - enp_getSalesRepEmailByName_(name)
 * - enp_isStandardDescriptionFormat_(text)
 * - enp_sendInvalidDescriptionEmailToSalesRep_(info)
 ************************************************************/


/* =========================================================
 * APPS SCRIPT — GLOBAL CONFIG
 * ========================================================= */

const ENP = Object.freeze({
  SHEETS: Object.freeze({
  APPROVED: 'Enternewpart',
  QUOTED: 'Enternewpart_Quoted',
  HUB: 'ActionHub',
  ITEMS: 'Striven_Items',
  MANUAL: 'Manual ItemCreation',
  LOGBOOK: 'Enternewpart_Logbook'
}),

  PROPS: Object.freeze({
    BASE_URL: 'STRIVEN_BASE_URL',
    CLIENT_ID: 'CLIENT_ID',
    CLIENT_SECRET: 'CLIENT_SECRET',
    TOKEN: 'striven_token',
    TOKEN_EXPIRES: 'striven_token_expires',

    APPROVED_REPORT_URL: 'STRIVEN_ENTERNEWPART_REPORT_API',
    QUOTED_REPORT_URL: 'STRIVEN_ENTERNEWPART_QUOTED_REPORT_API',
    ITEMS_REPORT_URL: 'ItemsReport_API_KEY',

    DEFAULT_ITEMTYPE_ID: 'ENTERNEWPART_DEFAULT_ITEMTYPE_ID',
    DEFAULT_INCOME_GL_ID: 'ENTERNEWPART_DEFAULT_INCOME_GLACCOUNT_ID',
    DEFAULT_INVENTORY_GL_ID: 'ENTERNEWPART_DEFAULT_INVENTORY_GLACCOUNT_ID',
    DEFAULT_COGS_GL_ID: 'ENTERNEWPART_DEFAULT_COGS_GLACCOUNT_ID',
    DEFAULT_LOCATION_ID: 'ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID',

    LAST_HEAVY_SYNC_TS: 'ENP_LAST_SYNC_TS'
  }),

  VALUES: Object.freeze({
    PLACEHOLDER_ITEMNUMBER: 'ENTERNEWPART',
    PLACEHOLDER_ITEM_ID: 36935,
    QUOTED_GATE_HEADER: 'SendToActions'
  }),

  EMAIL: Object.freeze({
    INVALID_DESC_ALERT_TEST_MODE: true,
    INVALID_DESC_ALERT_TEST_EMAIL: 'pramodh@classicfireplace.ca'
  }),

  PIPELINE: Object.freeze({
    TRIGGER_FUNCTION: 'enp_pipelineTick',
    TRIGGER_HOURS: 1,
    HEAVY_SYNC_INTERVAL_HOURS: 6,
    LOCK_WAIT_MS: 30000
  }),

  HUB: Object.freeze({
    HEADERS: [
      'SOId',
      'SONumber',
      'LineId',
      'RawDescription',
      'ParsedItemNumber',
      'ParsedItemName',
      'ParsedPrice',
      'Qty',
      'NewItemId',
      'State',
      'JobKey',
      'Attempts',
      'NextRunAt',
      'LastRunAt',
      'LastError',
      'SourceSheet',
      'SourceRow'
    ],
    STATE_PENDING: 'PENDING',
    STATE_RUNNING: 'RUNNING',
    STATE_DONE: 'DONE',
    STATE_FAILED: 'FAILED',
    RUNNER_BATCH_SIZE: 25,
    RUNNER_MAX_ATTEMPTS: 6
  }),

  APPROVED_HEADERS: Object.freeze([
    'SalesOrderSalesOrderId',
    'SalesOrderCreatedOn',
    'ItemItemId',
    'ItemNumber',
    'ItemDescription',
    'Quantity',
    'Price',
    'SalesOrderNumber',
    'SalesOrderStatus',
    'SalesOrderCustomerName',
    'SalesOrderSalesRepFullName'
  ]),

  ACTION_HEADERS: Object.freeze([
    'NewItemId',
    'NewItemNumber',
    'NewItemName',
    'NewItemPrice',
    'NewItemCost',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]),

  QUOTED_ACTION_HEADERS: Object.freeze([
    'SendToActions',
    'NewItemId',
    'NewItemNumber',
    'NewItemName',
    'NewItemPrice',
    'NewItemCost',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]),

  CF820: Object.freeze({
    ID: 820,
    BOTH_VALUE: '556',
    BOTH_TEXT: 'New Items created + SO Updated'
  })
});


/* =========================================================
 * APPS SCRIPT — MENU
 * ========================================================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Enternewpart')
    .addItem('Sync All Reports', 'enp_syncAllReports')
    .addItem('Run Full Approved Pipeline Now', 'enp_executeApprovedFullPipelineNow')
    .addSeparator()
    .addItem('Create Items from Selected Rows', 'enp_createItemsFromSelectedRows')
    .addItem('Replace SO Lines from Selected Rows', 'enp_replaceSalesOrderLinesFromSelectedRows')
    .addSeparator()
    .addItem('Manual Item Creation: Selected Rows', 'manualCreateItems_selectedRows')
    .addSeparator()
    .addItem('Install Approved Pipeline Trigger', 'enp_installPipelineTrigger')
    .addItem('Remove Approved Pipeline Trigger', 'enp_removePipelineTrigger')
    .addToUi();
}


/* =========================================================
 * APPS SCRIPT — TRIGGERS
 * ========================================================= */

function enp_installPipelineTrigger() {
  enp_removePipelineTrigger();

  ScriptApp.newTrigger(ENP.PIPELINE.TRIGGER_FUNCTION)
    .timeBased()
    .everyHours(ENP.PIPELINE.TRIGGER_HOURS)
    .create();

  enp_toast_('Approved-only pipeline trigger installed (every 1 hour).', 5);
}

function enp_removePipelineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (fn === ENP.PIPELINE.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  enp_toast_('Approved-only pipeline trigger removed.', 4);
}

function enp_pipelineTick__ENP_R4_INNER() {
  enp_executeApprovedFullPipelineNow();
}


/* =========================================================
 * APPS SCRIPT — PUBLIC PIPELINE ENTRY POINTS
 * ========================================================= */

function enp_executePipelineNow() {
  return enp_executeApprovedFullPipelineNow();
}

function enp_executeApprovedFullPipelineNow__ENP_R4_INNER() {
  return enp_withDocumentLock_(function () {
    const ss = SpreadsheetApp.getActive();
    const startedAt = Date.now();

    ss.toast('Executing full approved pipeline...', 'Enternewpart', 4);
    Logger.log('FULL APPROVED PIPELINE START');

    Logger.log('STEP 1: Refresh Striven_Items');
    enp_syncItemsReport();

    Logger.log('STEP 2: Refresh Enternewpart');
    enp_syncApprovedReport_();

    PropertiesService.getScriptProperties().setProperty(
      ENP.PROPS.LAST_HEAVY_SYNC_TS,
      String(Date.now())
    );

    Logger.log('STEP 3: Create items for all eligible approved rows');
    const createStats = enp_createItemsForApprovedPendingRows_();

    Logger.log('STEP 4: Replace SO lines for all eligible approved rows');
    const replaceStats = enp_replaceLinesForApprovedReadyRows_();

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);

    Logger.log(
      'FULL APPROVED PIPELINE END | ' +
      'CREATED=' + createStats.created +
      ' EXISTS=' + createStats.exists +
      ' CREATE_FAIL=' + createStats.failed +
      ' CREATE_SKIP=' + createStats.skipped +
      ' | REPLACED=' + replaceStats.done +
      ' REPLACE_FAIL=' + replaceStats.failed +
      ' REPLACE_SKIP=' + replaceStats.skipped
    );

    ss.toast(
      'Approved pipeline complete — ' +
      'CREATED=' + createStats.created +
      ', EXISTS=' + createStats.exists +
      ', REPLACED=' + replaceStats.done +
      ' (' + seconds + 's)',
      'Enternewpart',
      8
    );

    return {
      created: createStats,
      replaced: replaceStats,
      seconds: seconds
    };
  });
}

function enp_runHeavySyncNow() {
  enp_syncItemsReport();
  enp_syncApprovedReport_();

  PropertiesService.getScriptProperties().setProperty(
    ENP.PROPS.LAST_HEAVY_SYNC_TS,
    String(Date.now())
  );

  enp_toast_('Approved report + items sync completed.', 5);
}

function enp_queueApprovedPending() {
  const sh = enp_getRequiredSheet_(ENP.SHEETS.APPROVED);
  const queued = enp_actionHubQueueApprovedOnly_(sh);
  enp_toast_('Approved rows queued: ' + queued, 5);
  return queued;
}

function enp_runActionHubBatch() {
  return enp_actionHubRunPendingBatch_(ENP.HUB.RUNNER_BATCH_SIZE);
}

function enp_runApprovedOnlyAutomation_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ENP.SHEETS.APPROVED);
  const queued = sh ? enp_actionHubQueueApprovedOnly_(sh) : 0;
  const processed = enp_actionHubRunPendingBatch_(ENP.HUB.RUNNER_BATCH_SIZE);

  enp_toast_(
    'Approved automation complete — QUEUED=' + queued + ' PROCESSED=' + processed,
    6
  );

  return {
    queued: queued,
    processed: processed
  };
}

function enp_runHeavySyncIfDue_() {
  const props = PropertiesService.getScriptProperties();
  const lastSync = Number(props.getProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS) || 0);
  const now = Date.now();
  const intervalMs = ENP.PIPELINE.HEAVY_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;

  if (lastSync && (now - lastSync) < intervalMs) {
    Logger.log('Heavy sync skipped. Last sync still within interval.');
    return false;
  }

  enp_syncItemsReport();
  enp_syncApprovedReport_();
  props.setProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS, String(now));

  Logger.log('Heavy sync complete.');
  return true;
}


/* =========================================================
 * APPS SCRIPT — APPROVED SHEET BULK CREATE
 * ========================================================= */

function enp_createItemsForApprovedPendingRows_() {
  const ss = SpreadsheetApp.getActive();
  const sheetName = (typeof ENP !== 'undefined' && ENP.SHEETS && ENP.SHEETS.APPROVED) ? ENP.SHEETS.APPROVED : 'Enternewpart';
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return { created: 0, exists: 0, failed: 0, skipped: 0, CREATE_FAIL: 0, CREATE_SKIP: 0 };

  if (typeof enp_ensureActionColumns_ === 'function' && typeof enp_getSheetContext_ === 'function') {
    try { enp_ensureActionColumns_(sh, enp_getSheetContext_(sh)); } catch (e) {}
  } else if (typeof enternewpart_setupActionColumns === 'function') {
    try { enternewpart_setupActionColumns(); } catch (e) {}
  }

  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || '').trim(); });
  const col = {};
  headers.forEach(function(h, i) { if (h) col[h] = i; });
  const need = ['ItemNumber','ItemDescription','NewItemId','LastAction','LastError','LastUpdated'];
  const missing = need.filter(function(h) { return col[h] == null; });
  if (missing.length) throw new Error('Approved create missing required columns: ' + missing.join(', '));

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
  let created = 0, exists = 0, failed = 0, skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const oldNumber = String(row[col['ItemNumber']] || '').trim().toUpperCase();
    if (oldNumber !== 'ENTERNEWPART') { skipped++; continue; }
    if (Number(row[col['NewItemId']]) > 0) { skipped++; continue; }

    const now = new Date();
    try {
      const rawDescription = row[col['ItemDescription']];
      if (!enp_guardIsStandardDescription_(rawDescription)) {
        throw new Error('ItemDescription is not in standard format. Required: Item Number:, Item Name:, Price:.');
      }

      let payload;
      if (typeof enp_buildItemPayloadFromSheetRow_ === 'function') payload = enp_buildItemPayloadFromSheetRow_(row, col);
      else if (typeof buildItemPayloadFromRow_ === 'function') payload = buildItemPayloadFromRow_(row, col);
      else throw new Error('No supported item payload builder found.');

      const resolution = enp_guardCreateOrResolveItem_(payload);
      enp_guardWriteResolutionToRow_(row, col, resolution, {
        itemNumber: payload.ItemNumber,
        itemName: payload.Name,
        price: payload.Price,
        cost: payload.Cost
      }, now);

      if (resolution.status === 'EXISTS') exists++; else created++;
    } catch (err) {
      row[col['LastAction']] = 'CREATE FAILED';
      row[col['LastError']] = String(err && err.message ? err.message : err);
      row[col['LastUpdated']] = now;
      failed++;
    }

    sh.getRange(rowNum, 1, 1, lastCol).setValues([row]);
  }

  return {
    created: created, exists: exists, failed: failed, skipped: skipped,
    CREATED: created, EXISTS: exists, CREATE_FAIL: failed, CREATE_SKIP: skipped
  };
}

function enp_isApprovedCreateEligibleRow_(row, col) {
  const placeholder = enp_normUpper_(row[col['ItemNumber']]);
  const currentNewId = enp_num_(row[col['NewItemId']]);

  if (placeholder !== enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) return false;
  if (currentNewId) return false;
  return true;
}

function enp_fillKnownNewItemFields_(row, col, payload) {
  if (!payload) return;
  if (col['NewItemNumber'] != null) row[col['NewItemNumber']] = payload.ItemNumber || '';
  if (col['NewItemName'] != null) row[col['NewItemName']] = payload.Name || '';
  if (col['NewItemPrice'] != null) row[col['NewItemPrice']] = payload.Price != null ? payload.Price : '';
  if (col['NewItemCost'] != null) row[col['NewItemCost']] = payload.Cost != null ? payload.Cost : '';
}

/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * CREATE OR REUSE STRIVEN ITEM
 *
 * Fixes:
 * - Existing item found in Striven_Items writes NewItemId
 * - Duplicate error from Striven triggers fresh Items sync
 * - Pipeline no longer gets stuck at EXISTS - ID REQUIRED
 ************************************************************/
/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * CREATE OR REUSE STRIVEN ITEM
 *
 * Purpose:
 * - Create item only when missing
 * - If ItemNumber already exists, bring existing ItemID
 * - If formatted item name already exists, bring existing ItemID
 ************************************************************/
function enp_createOrReuseItemInStriven_(payload, itemIndex) {
  const itemNumber = enp_norm_(payload && payload.ItemNumber);
  const itemName = enp_norm_(payload && payload.Name);
  const itemKey = enp_normUpper_(itemNumber);
  const nameKey = enp_normUpper_(itemName);

  if (!itemNumber) {
    throw new Error('Cannot create or reuse item: missing ItemNumber.');
  }

  if (!itemName) {
    throw new Error('Cannot create or reuse item: missing ItemName.');
  }

  if (!itemIndex) {
    itemIndex = enp_buildItemIndex_();
  }

  // 1) Lookup by ItemNumber first.
  const existingByNumber = enp_lookupItemId_(itemNumber, itemIndex);
  if (existingByNumber) {
    return {
      itemId: existingByNumber,
      mode: 'EXISTS',
      matchBy: 'ItemNumber'
    };
  }

  // 2) Lookup by formatted Striven item name.
  const existingByName =
    typeof enp_lookupItemIdByName_ === 'function'
      ? enp_lookupItemIdByName_(itemName, itemIndex)
      : null;

  if (existingByName) {
    return {
      itemId: existingByName,
      mode: 'EXISTS BY NAME',
      matchBy: 'ItemName'
    };
  }

  // 3) Try create.
  try {
    const res = enp_createItemInStriven_(payload);
    const newItemId = enp_extractItemId_(res);

    if (!newItemId) {
      throw new Error('Create succeeded but no item id was returned.');
    }

    itemIndex[itemKey] = newItemId;

    if (!itemIndex.__byName) {
      itemIndex.__byName = {};
    }

    itemIndex.__byName[nameKey] = newItemId;

    return {
      itemId: newItemId,
      mode: 'CREATED',
      matchBy: 'Created'
    };

  } catch (err) {
    const message = enp_errorMessage_(err);

    if (!enp_errorLooksLikeDuplicateItem_(message)) {
      throw err;
    }

    Logger.log(
      'Duplicate item detected. Refreshing Striven_Items and resolving existing ID. ' +
      'ItemNumber=' + itemNumber +
      ' | ItemName=' + itemName +
      ' | Error=' + message
    );

    const freshResult = enp_lookupExistingItemAfterItemsRefresh_(itemNumber, itemName);

    if (freshResult && freshResult.itemId) {
      itemIndex[itemKey] = freshResult.itemId;

      if (!itemIndex.__byName) {
        itemIndex.__byName = {};
      }

      itemIndex.__byName[nameKey] = freshResult.itemId;

      return {
        itemId: freshResult.itemId,
        mode: freshResult.matchBy === 'ItemName' ? 'EXISTS BY NAME' : 'EXISTS',
        matchBy: freshResult.matchBy
      };
    }

    return {
      itemId: null,
      mode: 'DUPLICATE_UNRESOLVED',
      matchBy: '',
      error:
        'Item already exists in Striven, but existing ItemID could not be resolved after refreshing Striven_Items. ' +
        'ItemNumber="' + itemNumber + '", ItemName="' + itemName + '". ' +
        'Check that the Items report includes Id, ItemNumber, and ItemName/Name.'
    };
  }
}



/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * LOOKUP EXISTING ITEM AFTER FRESH ITEMS SYNC
 ************************************************************/
function enp_lookupExistingItemAfterItemsRefresh_(itemNumber, itemName) {
  const cleanItemNumber = enp_norm_(itemNumber);
  const cleanItemName = enp_norm_(itemName);

  try {
    enp_syncItemsReport();
  } catch (syncErr) {
    Logger.log(
      'Striven_Items refresh failed while resolving existing item. ' +
      'ItemNumber="' + cleanItemNumber + '", ItemName="' + cleanItemName + '". Error: ' +
      enp_errorMessage_(syncErr)
    );
  }

  const freshIndex = enp_buildItemIndex_();

  const idByNumber = enp_lookupItemId_(cleanItemNumber, freshIndex);
  if (idByNumber) {
    return {
      itemId: idByNumber,
      matchBy: 'ItemNumber'
    };
  }

  const idByName =
    typeof enp_lookupItemIdByName_ === 'function'
      ? enp_lookupItemIdByName_(cleanItemName, freshIndex)
      : null;

  if (idByName) {
    return {
      itemId: idByName,
      matchBy: 'ItemName'
    };
  }

  return {
    itemId: null,
    matchBy: ''
  };
}


/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * COMPATIBILITY HELPER
 ************************************************************/
function enp_lookupExistingItemIdAfterItemsRefresh_(itemNumber) {
  const result = enp_lookupExistingItemAfterItemsRefresh_(itemNumber, '');
  return result && result.itemId ? result.itemId : null;
}


/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * DUPLICATE ITEM ERROR DETECTOR
 ************************************************************/
function enp_errorLooksLikeDuplicateItem_(message) {
  const msg = String(message || '').toLowerCase();

  return (
    msg.indexOf('already exists') >= 0 ||
    msg.indexOf('must be unique') >= 0 ||
    msg.indexOf('itemnumber_mustbeunique') >= 0 ||
    msg.indexOf('itemname_mustbeunique') >= 0 ||
    msg.indexOf('duplicate') >= 0
  );
}

/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * LOOKUP EXISTING ITEM AFTER FRESH ITEMS SYNC
 ************************************************************/
function enp_lookupExistingItemIdAfterItemsRefresh_(itemNumber) {
  const cleanItemNumber = enp_norm_(itemNumber);
  if (!cleanItemNumber) return null;

  try {
    enp_syncItemsReport();
  } catch (syncErr) {
    Logger.log(
      'Striven_Items refresh failed while resolving existing item "' +
      cleanItemNumber +
      '": ' +
      enp_errorMessage_(syncErr)
    );
  }

  const freshIndex = enp_buildItemIndex_();
  return enp_lookupItemId_(cleanItemNumber, freshIndex);
}


/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * DUPLICATE ITEM ERROR DETECTOR
 ************************************************************/
function enp_errorLooksLikeDuplicateItem_(message) {
  const msg = String(message || '').toLowerCase();

  return (
    msg.indexOf('already exists') >= 0 ||
    msg.indexOf('must be unique') >= 0 ||
    msg.indexOf('itemnumber_mustbeunique') >= 0 ||
    msg.indexOf('itemname_mustbeunique') >= 0 ||
    msg.indexOf('duplicate') >= 0
  );
}




/* =========================================================
 * APPS SCRIPT — APPROVED SHEET BULK REPLACE
 * ========================================================= */

function enp_replaceLinesForApprovedReadyRows_() {
  const sh = enp_getRequiredSheet_(ENP.SHEETS.APPROVED);
  const ctx = enp_getSheetContext_(sh);
  enp_ensureActionColumns_(sh, ctx);

  const grid = sh.getDataRange().getValues();
  if (grid.length < 2) return { done: 0, failed: 0, skipped: 0 };

  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);

  enp_requireCols_(col, [
    'SalesOrderSalesOrderId',
    'SalesOrderNumber',
    'SalesOrderSalesRepFullName',
    'ItemNumber',
    'ItemDescription',
    'Quantity',
    'NewItemId',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]);

  const stats = { done: 0, failed: 0, skipped: 0 };
  const jobsBySo = {};

  function writeRow_(rowNumber, row) {
    sh.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
  }

  for (let rowNumber = 2; rowNumber <= grid.length; rowNumber++) {
    const row = grid[rowNumber - 1];
    const placeholder = enp_normUpper_(row[col['ItemNumber']]);
    const newItemId = enp_num_(row[col['NewItemId']]);
    const lastAction = enp_normUpper_(row[col['LastAction']]);

    if (placeholder !== enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) {
      stats.skipped++;
      continue;
    }

    if (!newItemId) {
      stats.skipped++;
      continue;
    }

    if (lastAction === 'DONE' || lastAction.indexOf('REPLACED') >= 0) {
      stats.skipped++;
      continue;
    }

    try {
      const soId = enp_num_(row[col['SalesOrderSalesOrderId']]);
      const soNumber = col['SalesOrderNumber'] != null ? row[col['SalesOrderNumber']] : '';
      const salesRepName = col['SalesOrderSalesRepFullName'] != null
        ? enp_norm_(row[col['SalesOrderSalesRepFullName']])
        : '';
      const salesRepEmail = enp_getSalesRepEmailByName_(salesRepName);
      const rawDescription = enp_norm_(row[col['ItemDescription']]);
      const qty = enp_num_(row[col['Quantity']]);

      if (!soId) throw new Error('Missing SalesOrderSalesOrderId.');

      if (!enp_isStandardDescriptionFormat_(rawDescription)) {
        enp_sendInvalidDescriptionEmailToSalesRep_({
          recipientEmail: salesRepEmail,
          salesRepName: salesRepName,
          soId: soId,
          soNumber: soNumber,
          description: rawDescription
        });
        throw new Error('ItemDescription is not in standard format.');
      }

      const parsed = enp_parseDescription_(rawDescription);
      if (!parsed.itemNumber || !parsed.name) {
        throw new Error('Could not parse labeled Item Number and Item Name from ItemDescription.');
      }

      if (!jobsBySo[soId]) jobsBySo[soId] = [];
      jobsBySo[soId].push({
        key: String(rowNumber),
        rowNumber: rowNumber,
        row: row,
        parsed: parsed,
        rawDescription: rawDescription,
        replacement: {
          key: String(rowNumber),
          lineId: null,
          desiredItemNumber: parsed.itemNumber,
          desiredItemName: parsed.name,
          desiredPrice: parsed.price,
          desiredQty: qty,
          newItemId: newItemId
        }
      });
    } catch (err) {
      row[col['LastAction']] = 'REPLACE FAILED';
      row[col['LastError']] = enp_errorMessage_(err);
      row[col['LastUpdated']] = new Date();
      writeRow_(rowNumber, row);

      if (typeof enp_logFailure_ === 'function') {
        enp_logFailure_(
          sh,
          rowNumber,
          row,
          col,
          'APPROVED_PIPELINE_SO_REPLACE_FAILED',
          enp_errorMessage_(err)
        );
      }
      stats.failed++;
    }
  }

  Object.keys(jobsBySo).forEach(function(soKey) {
    const soId = Number(soKey);
    const jobs = jobsBySo[soId] || [];
    if (!jobs.length) return;

    try {
      Logger.log(
        'APPROVED PIPELINE SHARED SO REPLACEMENT ENGINE SO=' + soId +
        ' ROWS=' + jobs.map(function(j) { return j.rowNumber; }).join(',')
      );

      const result = enp_replaceSalesOrderItems_(
        soId,
        jobs.map(function(j) { return j.replacement; })
      );

      const resultByKey = {};
      (result && result.replacements ? result.replacements : []).forEach(function(r) {
        resultByKey[String(r.key)] = r;
      });

      jobs.forEach(function(job) {
        const r = resultByKey[String(job.key)] || {};
        const row = job.row;
        row[col['LastAction']] =
          'REPLACED SO=' + soId + (r.lineId ? ' LINE=' + r.lineId : '');
        row[col['LastError']] = '';
        row[col['LastUpdated']] = new Date();
        writeRow_(job.rowNumber, row);

        if (typeof enp_logSalesOrderReplace_ === 'function') {
          enp_logSalesOrderReplace_(
            sh,
            job.rowNumber,
            row,
            col,
            job.parsed,
            null,
            job.replacement.newItemId,
            'SUCCESS',
            ''
          );
        }
        stats.done++;
      });
    } catch (err) {
      const message = enp_errorMessage_(err);
      Logger.log(
        'APPROVED PIPELINE SO REPLACE FAILED so=' + soId +
        ' rows=' + jobs.map(function(j) { return j.rowNumber; }).join(',') +
        ' error=' + message
      );

      jobs.forEach(function(job) {
        const row = job.row;
        row[col['LastAction']] = 'REPLACE FAILED';
        row[col['LastError']] = message;
        row[col['LastUpdated']] = new Date();
        writeRow_(job.rowNumber, row);

        if (typeof enp_logFailure_ === 'function') {
          enp_logFailure_(
            sh,
            job.rowNumber,
            row,
            col,
            'APPROVED_PIPELINE_SO_REPLACE_FAILED',
            message
          );
        }
        stats.failed++;
      });
    }
  });

  return stats;
}



/* =========================================================
 * APPS SCRIPT — ACTION HUB (APPROVED QUEUE + RUNNER)
 * ========================================================= */

function enp_actionHubQueueApprovedOnly_(sourceSheet) {
  if (!sourceSheet || sourceSheet.getName() !== ENP.SHEETS.APPROVED) {
    throw new Error('Approved-only queue must run from "' + ENP.SHEETS.APPROVED + '".');
  }

  const ctx = enp_getSheetContext_(sourceSheet);
  enp_ensureActionColumns_(sourceSheet, ctx);

  const sourceGrid = sourceSheet.getDataRange().getValues();
  if (sourceGrid.length < 2) return 0;

  const sourceHeaders = sourceGrid[0].map(enp_norm_);
  const sourceCol = enp_indexByHeader_(sourceHeaders);

  enp_requireCols_(sourceCol, [
    'SalesOrderSalesOrderId',
    'SalesOrderNumber',
    'ItemDescription',
    'ItemNumber',
    'Quantity',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]);

  const hubSheet = enp_getOrCreateActionHubSheet_();
  const existingKeys = enp_getExistingActionHubKeys_(hubSheet);
  const itemIndex = enp_buildItemIndex_();

  const rowsToAppend = [];
  let added = 0;

  for (let i = 1; i < sourceGrid.length; i++) {
    const row = sourceGrid[i];
    const sourceRowNumber = i + 1;

    if (!enp_sourceRowShouldQueueApprovedOnly_(row, sourceCol)) continue;

    const rawDescription = enp_norm_(row[sourceCol['ItemDescription']]);
    const parsed = enp_parseDescription_(rawDescription);
    const soId = enp_num_(row[sourceCol['SalesOrderSalesOrderId']]);
    const soNumber = enp_norm_(row[sourceCol['SalesOrderNumber']]);
    const qty = enp_num_(row[sourceCol['Quantity']]);
    const existingNewItemId = sourceCol['NewItemId'] != null ? enp_num_(row[sourceCol['NewItemId']]) : null;

    if (!soId) continue;
    if (!parsed.itemNumber) continue;
    // R3: a report hit may be reused during resolution, but queue state is sourced only from the row.
    // A report miss is UNKNOWN; centralized resolver runs before any create.
    const candidateItemId = existingNewItemId || '';

    const jobKey = enp_makeJobKey_(soId, '', [
      sourceSheet.getName(),
      sourceRowNumber,
      parsed.itemNumber,
      qty,
      rawDescription
    ].join('|'));

    if (existingKeys[jobKey]) continue;

    rowsToAppend.push([
      soId,
      soNumber,
      '',
      rawDescription,
      parsed.itemNumber,
      parsed.name,
      parsed.price != null ? parsed.price : '',
      qty != null ? qty : '',
      candidateItemId,
      ENP.HUB.STATE_PENDING,
      jobKey,
      0,
      '',
      '',
      '',
      sourceSheet.getName(),
      sourceRowNumber
    ]);

    existingKeys[jobKey] = true;
    added++;
  }

  if (rowsToAppend.length) {
    hubSheet.getRange(
      hubSheet.getLastRow() + 1,
      1,
      rowsToAppend.length,
      ENP.HUB.HEADERS.length
    ).setValues(rowsToAppend);
  }

  return added;
}

function enp_sourceRowShouldQueueApprovedOnly_(row, col) {
  const placeholder = enp_normUpper_(row[col['ItemNumber']]);
  const action = enp_normUpper_(row[col['LastAction']]);
  const newItemId = col['NewItemId'] != null ? enp_num_(row[col['NewItemId']]) : null;

  if (placeholder !== enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) return false;
  if (action === 'DONE' || action.indexOf('REPLACED') >= 0) return false;
  if (newItemId && action.indexOf('REPLACED') >= 0) return false;
  return true;
}

function enp_actionHubRunPendingBatch_(batchSize) {
  const sh = enp_getOrCreateActionHubSheet_();
  const grid = sh.getDataRange().getValues();
  if (grid.length < 2) return 0;

  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);
  enp_requireCols_(col, ENP.HUB.HEADERS);

  const now = new Date();
  const limit = Math.max(1, Number(batchSize || ENP.HUB.RUNNER_BATCH_SIZE || 25));

  const candidates = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!enp_actionHubIsRunnableRow_(row, col, now)) continue;
    candidates.push({ sheetRow: r + 1, row: row });
    if (candidates.length >= limit) break;
  }

  let ran = 0;
  candidates.forEach(job => {
    enp_actionHubRunOneJob_(sh, headers, col, job.sheetRow, job.row);
    ran++;
  });

  SpreadsheetApp.getActive().toast(
    'ActionHub batch complete — processed: ' + ran,
    'Enternewpart',
    5
  );

  return ran;
}


function enp_actionHubRunOneJob_(hubSheet, hubHeaders, hubCol, hubSheetRow, hubRow) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const now = new Date();

    enp_actionHubMarkRunning_(hubSheet, hubCol, hubSheetRow, hubRow, now);

    const job = enp_actionHubRowToObject_(hubRow, hubCol);
    const sourceSheet = SpreadsheetApp.getActive().getSheetByName(job.SourceSheet);

    if (!sourceSheet) {
      throw new Error('Missing source sheet: ' + job.SourceSheet);
    }

    const sourceBundle = enp_getSourceRowBundle_(sourceSheet, job.SourceRow);
    const sourceRow = sourceBundle.row;
    const sourceCol = sourceBundle.col;

    let newItemId = enp_num_(job.NewItemId) ||
      (sourceCol['NewItemId'] != null ? enp_num_(sourceRow[sourceCol['NewItemId']]) : null);

    if (!newItemId) {
      const createResult = enp_actionHubEnsureItemCreated_(sourceSheet, sourceRow, sourceCol);
      newItemId = createResult.newItemId;
      job.NewItemId = newItemId;

      sourceBundle.row = createResult.sourceRow;
      enp_writeWholeSourceRow_(sourceSheet, sourceBundle.rowNumber, sourceBundle.row);
    }

    if (!newItemId) {
      throw new Error('Item creation did not return NewItemId.');
    }

    const replaceResult = enp_actionHubReplaceSalesOrderLine_(
      job,
      sourceBundle,
      newItemId
    );

    if (replaceResult && replaceResult.blocked) {
      enp_actionHubMarkBlocked_(
        hubSheet,
        hubCol,
        hubSheetRow,
        hubRow,
        now,
        replaceResult.blockMessage || replaceResult.blockCode || 'SO replacement blocked.'
      );
      enp_actionHubWritebackBlocked_(
        sourceSheet,
        sourceBundle.rowNumber,
        sourceBundle.row,
        sourceCol,
        now,
        replaceResult
      );
      return;
    }

    enp_actionHubMarkDone_(hubSheet, hubCol, hubSheetRow, hubRow, now, '');
    enp_actionHubWritebackDone_(sourceSheet, sourceBundle.rowNumber, sourceBundle.row, sourceCol, now);
  } catch (err) {
    enp_actionHubHandleFailure_(hubSheet, hubCol, hubSheetRow, hubRow, err);
    enp_actionHubWritebackFailureSafe_(hubRow, hubCol, err);
  } finally {
    lock.releaseLock();
  }
}


function enp_actionHubEnsureItemCreated_(sourceSheet, sourceRow, sourceCol) {
  const now = new Date();
  let currentId = sourceCol['NewItemId'] != null ? enp_num_(sourceRow[sourceCol['NewItemId']]) : null;
  if (currentId) return { newItemId: currentId, sourceRow: sourceRow, status: 'EXISTING_ID' };

  const payload = enp_buildItemPayloadFromSheetRow_(sourceRow, sourceCol);
  const resolution = enp_guardCreateOrResolveItem_(payload);

  enp_guardWriteResolutionToRow_(sourceRow, sourceCol, resolution, {
    itemNumber: payload.ItemNumber,
    itemName: payload.Name,
    price: payload.Price,
    cost: payload.Cost
  }, now);

  return { newItemId: resolution.id, sourceRow: sourceRow, status: resolution.status };
}


function enp_actionHubReplaceApprovedSalesOrderLine_(job, sourceBundle, newItemId) {
  const row = sourceBundle.row;
  const col = sourceBundle.col;

  const soId = enp_num_(job.SOId || row[col['SalesOrderSalesOrderId']]);
  const soNumber = col['SalesOrderNumber'] != null ? row[col['SalesOrderNumber']] : '';
  const qty = col['Quantity'] != null ? enp_num_(row[col['Quantity']]) : null;
  const rawDescription = enp_norm_(job.RawDescription || row[col['ItemDescription']]);

  if (!soId) throw new Error('Missing Sales Order ID.');
  if (!newItemId) throw new Error('Missing NewItemId.');

  const salesRepName = col['SalesOrderSalesRepFullName'] != null
    ? enp_norm_(row[col['SalesOrderSalesRepFullName']])
    : '';
  const salesRepEmail = enp_getSalesRepEmailByName_(salesRepName);

  if (!enp_isStandardDescriptionFormat_(rawDescription)) {
    enp_sendInvalidDescriptionEmailToSalesRep_({
      recipientEmail: salesRepEmail,
      salesRepName: salesRepName,
      soId: soId,
      soNumber: soNumber,
      description: rawDescription
    });
    throw new Error('ItemDescription is not in standard format.');
  }

  const parsed = enp_parseDescription_(rawDescription);
  if (!parsed.itemNumber || !parsed.name) {
    throw new Error('Could not parse labeled Item Number and Item Name from ItemDescription.');
  }

  const result = enp_replaceSalesOrderItems_(soId, [{
    key: 'ACTIONHUB_APPROVED',
    lineId: enp_num_(job.LineId),
    desiredItemNumber: parsed.itemNumber,
    desiredItemName: parsed.name,
    desiredPrice: parsed.price,
    desiredQty: qty,
    newItemId: newItemId
  }]);

  if (col['LastAction'] != null) row[col['LastAction']] = 'DONE';
  if (col['LastError'] != null) row[col['LastError']] = '';
  if (col['LastUpdated'] != null) row[col['LastUpdated']] = new Date();

  return result;
}


function enp_getOrCreateActionHubSheet_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(ENP.SHEETS.HUB) || ss.insertSheet(ENP.SHEETS.HUB);

  enp_ensureHeaders_(sh, ENP.HUB.HEADERS);

  const currentLastCol = Math.max(sh.getLastColumn(), ENP.HUB.HEADERS.length);
  const headers = sh.getRange(1, 1, 1, currentLastCol).getValues()[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);
  enp_requireCols_(col, ENP.HUB.HEADERS);

  return sh;
}


function enp_getExistingActionHubKeys_(hubSheet) {
  const grid = hubSheet.getDataRange().getValues();
  if (grid.length < 2) return {};

  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);
  const map = {};

  for (let i = 1; i < grid.length; i++) {
    const key = enp_norm_(grid[i][col['JobKey']]);
    if (key) map[key] = true;
  }

  return map;
}

function enp_actionHubRowToObject_(row, col) {
  const out = {};
  Object.keys(col).forEach(h => out[h] = row[col[h]]);
  return out;
}


function enp_actionHubIsRunnableRow_(row, col, now) {
  const state = enp_normUpper_(row[col['State']]);
  const attempts = Number(row[col['Attempts']] || 0);
  const nextRunAtVal = row[col['NextRunAt']];

  if (state !== ENP.HUB.STATE_PENDING && state !== ENP.HUB.STATE_FAILED) {
    return false;
  }

  if (attempts >= ENP.HUB.RUNNER_MAX_ATTEMPTS) {
    return false;
  }

  if (nextRunAtVal) {
    const nextRunAt = new Date(nextRunAtVal);
    if (!isNaN(nextRunAt.getTime()) && nextRunAt.getTime() > now.getTime()) {
      return false;
    }
  }

  return true;
}


function enp_actionHubMarkRunning_(hubSheet, col, hubSheetRow, hubRow, now) {
  if (col['State'] != null) hubRow[col['State']] = ENP.HUB.STATE_RUNNING;
  if (col['LastRunAt'] != null) hubRow[col['LastRunAt']] = now;
  if (col['LastError'] != null) hubRow[col['LastError']] = '';
  hubSheet.getRange(hubSheetRow, 1, 1, hubRow.length).setValues([hubRow]);
}


function enp_actionHubMarkDone_(hubSheet, col, hubSheetRow, hubRow, now, message) {
  if (col['State'] != null) hubRow[col['State']] = ENP.HUB.STATE_DONE;
  if (col['LastRunAt'] != null) hubRow[col['LastRunAt']] = now;
  if (col['NextRunAt'] != null) hubRow[col['NextRunAt']] = '';
  if (col['LastError'] != null) hubRow[col['LastError']] = message || '';
  hubSheet.getRange(hubSheetRow, 1, 1, hubRow.length).setValues([hubRow]);
}


function enp_actionHubHandleFailure_(hubSheet, col, hubSheetRow, hubRow, err) {
  const attempts = Number((col['Attempts'] != null ? hubRow[col['Attempts']] : 0) || 0) + 1;
  const message = String(err && err.message ? err.message : err);
  const shouldStop = attempts >= ENP.HUB.RUNNER_MAX_ATTEMPTS;
  const retryMinutes = Math.min(60, Math.max(5, attempts * 5));
  const nextRun = new Date(Date.now() + retryMinutes * 60 * 1000);

  if (col['Attempts'] != null) hubRow[col['Attempts']] = attempts;
  if (col['State'] != null) hubRow[col['State']] = shouldStop ? ENP.HUB.STATE_FAILED : ENP.HUB.STATE_PENDING;
  if (col['LastRunAt'] != null) hubRow[col['LastRunAt']] = new Date();
  if (col['NextRunAt'] != null) hubRow[col['NextRunAt']] = shouldStop ? '' : nextRun;
  if (col['LastError'] != null) hubRow[col['LastError']] = message;

  hubSheet.getRange(hubSheetRow, 1, 1, hubRow.length).setValues([hubRow]);
}


function enp_getSourceRowBundle_(sourceSheet, rowNumber) {
  const grid = sourceSheet.getDataRange().getValues();
  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);

  if (rowNumber < 2 || rowNumber > grid.length) {
    throw new Error('Invalid source row: ' + rowNumber);
  }

  return {
    headers: headers,
    col: col,
    row: grid[rowNumber - 1],
    rowNumber: rowNumber
  };
}


function enp_writeWholeSourceRow_(sourceSheet, rowNumber, row) {
  sourceSheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}


function enp_actionHubWritebackDone_(sourceSheet, rowNumber, row, col, now) {
  if (col['LastAction'] != null) row[col['LastAction']] = 'DONE';
  if (col['LastError'] != null) row[col['LastError']] = '';
  if (col['LastUpdated'] != null) row[col['LastUpdated']] = now;
  enp_writeWholeSourceRow_(sourceSheet, rowNumber, row);
}


function enp_actionHubWritebackFailureSafe_(hubRow, hubCol, err) {
  try {
    const sourceSheetName = enp_norm_(hubRow[hubCol['SourceSheet']]);
    const sourceRowNumber = Number(hubRow[hubCol['SourceRow']] || 0);
    if (!sourceSheetName || !sourceRowNumber) return;

    const sourceSheet = SpreadsheetApp.getActive().getSheetByName(sourceSheetName);
    if (!sourceSheet) return;

    const bundle = enp_getSourceRowBundle_(sourceSheet, sourceRowNumber);
    const row = bundle.row;
    const col = bundle.col;

    if (col['LastAction'] != null) row[col['LastAction']] = 'FAILED';
    if (col['LastError'] != null) row[col['LastError']] = String(err && err.message ? err.message : err);
    if (col['LastUpdated'] != null) row[col['LastUpdated']] = new Date();

    enp_writeWholeSourceRow_(sourceSheet, sourceRowNumber, row);
  } catch (writeErr) {
    Logger.log('ActionHub writeback failed: ' + writeErr);
  }
}





function enp_upsertSalesOrderCustomField_(customFields, fieldId, rawValue, rawValueText) {
  const out = Array.isArray(customFields) ? customFields.slice() : [];
  const idNum = Number(fieldId);
  let found = false;

  for (let i = 0; i < out.length; i++) {
    const cf = out[i] || {};
    const cfId = Number(cf.id != null ? cf.id : cf.Id);

    if (cfId === idNum) {
      const next = Object.assign({}, cf);

      if (next.id != null) next.id = idNum;
      if (next.Id != null) next.Id = idNum;
      if (next.id == null && next.Id == null) next.Id = idNum;

      if (cf.value !== undefined || cf.Value === undefined) next.value = rawValue;
      if (cf.Value !== undefined) next.Value = rawValue;

      if (rawValueText != null) {
        if (cf.valueText !== undefined || cf.ValueText === undefined) next.valueText = rawValueText;
        if (cf.ValueText !== undefined) next.ValueText = rawValueText;
      }

      out[i] = next;
      found = true;
      break;
    }
  }

  if (!found) {
    out.push({
      Id: idNum,
      Value: rawValue,
      ValueText: rawValueText || ''
    });
  }

  return out;
}

/* =========================================================
 * APPS SCRIPT — MANUAL WRAPPERS
 * ========================================================= */

function enp_createItemsFromSelectedRows() {
  const sh = SpreadsheetApp.getActiveSheet();
  const name = sh ? sh.getName() : '';

  if (name !== ENP.SHEETS.APPROVED && name !== ENP.SHEETS.QUOTED) {
    throw new Error('Run this only from "' + ENP.SHEETS.APPROVED + '" or "' + ENP.SHEETS.QUOTED + '".');
  }

  enp_createItemsForActiveSheetSelection_(sh);
}

/************************************************************
 * APPS SCRIPT — 01_config_menu.gs
 * REPLACE SO LINES FROM SELECTED ROWS
 *
 * Important:
 * - Do NOT call enp_updateCF820_selectedRows() separately.
 * - CF820 is already updated inside the replace payload.
 * - A second CF820-only sales order POST can fail on Item Groups.
 ************************************************************/
function enp_replaceSalesOrderLinesFromSelectedRows() {
  const sh = SpreadsheetApp.getActiveSheet();
  const name = sh ? sh.getName() : '';

  if (name !== ENP.SHEETS.APPROVED && name !== ENP.SHEETS.QUOTED) {
    throw new Error(
      'Run this only from "' + ENP.SHEETS.APPROVED + '" or "' + ENP.SHEETS.QUOTED + '".'
    );
  }

  enp_replaceLinesForActiveSheetSelection_(sh);
}


/* =========================================================
 * APPS SCRIPT — CF 820 HELPERS
 * ========================================================= */

function enp_getSalesOrderCustomField_(so, fieldId) {
  const idNum = Number(fieldId);
  const customFields =
    (so && (so.customFields || so.CustomFields)) ||
    (so && so.Data && (so.Data.customFields || so.Data.CustomFields)) ||
    [];

  if (!Array.isArray(customFields)) return null;

  for (let i = 0; i < customFields.length; i++) {
    const cf = customFields[i];
    const cfId = Number(cf.id != null ? cf.id : cf.Id);
    if (cfId === idNum) return cf;
  }

  return null;
}

function enp_upsertSalesOrderCustomField_(customFields, fieldId, rawValue, rawValueText) {
  const out = Array.isArray(customFields) ? customFields.slice() : [];
  const idNum = Number(fieldId);
  let found = false;

  for (let i = 0; i < out.length; i++) {
    const cf = out[i] || {};
    const cfId = Number(cf.id != null ? cf.id : cf.Id);
    if (cfId !== idNum) continue;

    const next = Object.assign({}, cf);

    if (next.id != null) next.id = idNum;
    if (next.Id != null) next.Id = idNum;
    if (next.id == null && next.Id == null) next.Id = idNum;

    if (cf.value !== undefined || cf.Value === undefined) next.value = rawValue;
    if (cf.Value !== undefined) next.Value = rawValue;

    if (rawValueText != null) {
      if (cf.valueText !== undefined || cf.ValueText === undefined) next.valueText = rawValueText;
      if (cf.ValueText !== undefined) next.ValueText = rawValueText;
    }

    out[i] = next;
    found = true;
    break;
  }

  if (!found) {
    out.push({
      Id: idNum,
      Value: rawValue,
      ValueText: rawValueText || ''
    });
  }

  return out;
}


/* =========================================================
 * APPS SCRIPT — SHARED LIGHT HELPERS
 * ========================================================= */

function enp_getScriptProp_(key, required) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (required && !value) {
    throw new Error('Missing Script Property: ' + key);
  }
  return value || '';
}

function enp_getRequiredSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function enp_num_(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function enp_norm_(value) {
  return String(value == null ? '' : value).trim();
}

function enp_normUpper_(value) {
  return enp_norm_(value).toUpperCase();
}

function enp_indexByHeader_(headers) {
  const map = {};
  (headers || []).forEach(function (h, i) {
    const key = String(h || '').trim();
    if (!key) return;
    map[key] = i;
  });
  return map;
}

function enp_requireCols_(colMap, requiredHeaders) {
  const missing = requiredHeaders.filter(function (h) {
    return colMap[h] == null;
  });
  if (missing.length) {
    throw new Error('Missing required columns: ' + missing.join(', '));
  }
}

function enp_getSelectedRowNumbers_(sh) {
  const rng = sh.getActiveRange();
  if (!rng) throw new Error('Select one or more data rows first.');

  const start = Math.max(2, rng.getRow());
  const end = Math.max(2, rng.getRow() + rng.getNumRows() - 1);
  const rows = [];

  for (let r = start; r <= end; r++) rows.push(r);
  if (!rows.length) throw new Error('No valid data rows selected.');
  return rows;
}

function enp_ensureHeaders_(sh, wantedHeaders) {
  const lastCol = Math.max(1, sh.getLastColumn());
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || '').trim();
  });

  if (!existing.filter(Boolean).length) {
    sh.getRange(1, 1, 1, wantedHeaders.length)
      .setValues([wantedHeaders])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    return;
  }

  const col = enp_indexByHeader_(existing);
  let writeCol = existing.length;

  wantedHeaders.forEach(function (h) {
    if (!h || col[h] != null) return;
    writeCol += 1;
    sh.getRange(1, writeCol).setValue(h).setFontWeight('bold');
    col[h] = writeCol - 1;
  });

  sh.setFrozenRows(1);
}

function enp_makeJobKey_(soId, lineId, stableText) {
  const token = String(stableText || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    token,
    Utilities.Charset.UTF_8
  );
  const shortHash = Utilities.base64EncodeWebSafe(digest).slice(0, 12);
  return 'SO:' + soId + '|LINE:' + (lineId || '') + '|H:' + shortHash;
}

function enp_errorMessage_(err) {
  return String(err && err.message ? err.message : err);
}

function enp_toast_(message, seconds) {
  SpreadsheetApp.getActive().toast(message, 'Enternewpart', seconds || 5);
}

function enp_withDocumentLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(ENP.PIPELINE.LOCK_WAIT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function enp_stats_(a, b, c, d, ka, kb, kc, kd) {
  const out = {};
  out[ka] = a;
  out[kb] = b;
  out[kc] = c;
  out[kd] = d;
  return out;
}






function enp_validateOutgoingLineItems_(lineItems) {
  const bad = [];

  (lineItems || []).forEach(function (li, idx) {
    const itemId =
      Number(li?.item?.id) ||
      Number(li?.Item?.Id) ||
      Number(li?.itemId) ||
      Number(li?.ItemId) ||
      null;

    if (!itemId) {
      bad.push('Line ' + (idx + 1) + ': missing item id');
      return;
    }
  });

  if (bad.length) {
    throw new Error('Outgoing sales-order payload has invalid line items: ' + bad.join(' | '));
  }
}











function enp_debugOutgoingItems_(lineItems) {
  const out = [];

  (lineItems || []).forEach(function (li, i) {
    const itemId =
      Number(li?.Item?.Id) ||
      Number(li?.item?.id) ||
      Number(li?.ItemId) ||
      Number(li?.itemId) ||
      null;

    out.push({
      line: i + 1,
      itemId: itemId,
      description: String(li?.Description || li?.description || '')
    });
  });

  Logger.log('FINAL LINE ITEMS SENT TO STRIVEN:\n' + JSON.stringify(out, null, 2));
}


function enp_updateCF820_selectedRows() {
  const sh = SpreadsheetApp.getActiveSheet();
  const rows = enp_getSelectedRowNumbers_(sh);

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);

  enp_requireCols_(col, [
    'SalesOrderSalesOrderId',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]);

  let done = 0;
  let failed = 0;

  rows.forEach(rowIdx => {
    const row = data[rowIdx - 1];
    const now = new Date();

    try {
      const soId = enp_num_(row[col['SalesOrderSalesOrderId']]);
      if (!soId) throw new Error('Missing SalesOrderSalesOrderId.');

      const so = enp_getSalesOrder_(soId);
      const lineItems = enp_getSalesOrderLineItems_(so);

      const payload = enp_buildSalesOrderUpsertPayload_(so, lineItems);

      payload.CustomFields = enp_upsertSalesOrderCustomField_(
        so.customFields || so.CustomFields || [],
        820,
        '556',
        'New Items created + SO Updated'
      );

      enp_strivenFetch_('/v1/sales-orders', {
        method: 'post',
        body: payload
      });

      row[col['LastAction']] = 'CF820 UPDATED';
      row[col['LastError']] = '';
      row[col['LastUpdated']] = now;
      done++;

    } catch (err) {
      row[col['LastAction']] = 'CF820 FAILED';
      row[col['LastError']] = String(err && err.message ? err.message : err);
      row[col['LastUpdated']] = now;
      failed++;
    }

    sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  });

  SpreadsheetApp.getActive().toast(
    'CF820 update — OK=' + done + ' FAIL=' + failed,
    'Enternewpart',
    5
  );
}




function enp_updateCF820_bySOId_(soId) {
  if (!soId) throw new Error('Missing SalesOrderSalesOrderId.');

  const so = enp_getSalesOrder_(soId);
  const lineItems = enp_getSalesOrderLineItems_(so);

  const payload = enp_buildSalesOrderUpsertPayload_(so, lineItems);

  payload.CustomFields = enp_upsertSalesOrderCustomField_(
    so.customFields || so.CustomFields || [],
    820,
    '556',
    'New Items created + SO Updated'
  );

  return enp_strivenFetch_('/v1/sales-orders', {
    method: 'post',
    body: payload
  });
}











/************************************************************
 * APPS SCRIPT — LEAN REWRITE — DROP-IN LIGHT VERSION
 *
 * WHAT THIS CHANGES
 * ----------------------------------------------------------
 * - Same functionality as the full rewrite in this file
 * - Smaller surface area
 * - Fewer wrappers
 * - Fewer repeated sheet fetches
 * - Fewer tiny helper abstractions
 *
 * WHEN TO USE
 * ----------------------------------------------------------
 * Use this only if you want the same control behavior but with
 * less code overhead in the config/pipeline layer.
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * Do NOT keep both the FULL REWRITE and LEAN REWRITE active
 * at the same time. Pick one.
 ************************************************************/

/*
const ENP = {
  SHEETS: {
    APPROVED: 'Enternewpart',
    QUOTED: 'Enternewpart_Quoted',
    HUB: 'ActionHub',
    ITEMS: 'Striven_Items',
    MANUAL: 'Manual ItemCreation'
  },
  PROPS: {
    LAST_HEAVY_SYNC_TS: 'ENP_LAST_SYNC_TS'
  },
  VALUES: {
    PLACEHOLDER_ITEMNUMBER: 'ENTERNEWPART'
  },
  PIPELINE: {
    TRIGGER_FUNCTION: 'enp_pipelineTick',
    TRIGGER_HOURS: 1,
    HEAVY_SYNC_INTERVAL_HOURS: 6,
    LOCK_WAIT_MS: 30000
  },
  HUB: {
    HEADERS: ['SOId','SONumber','LineId','RawDescription','ParsedItemNumber','ParsedItemName','ParsedPrice','Qty','NewItemId','State','JobKey','Attempts','NextRunAt','LastRunAt','LastError','SourceSheet','SourceRow'],
    STATE_PENDING: 'PENDING',
    STATE_RUNNING: 'RUNNING',
    STATE_DONE: 'DONE',
    STATE_FAILED: 'FAILED',
    RUNNER_BATCH_SIZE: 25,
    RUNNER_MAX_ATTEMPTS: 6
  },
  CF820: {
    ID: 820,
    BOTH_VALUE: '556',
    BOTH_TEXT: 'New Items created + SO Updated'
  }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Enternewpart')
    .addItem('Run Full Approved Pipeline Now', 'enp_executeApprovedFullPipelineNow')
    .addItem('Run Approved Queue + Batch Now', 'enp_runApprovedOnlyAutomation_')
    .addItem('Sync Approved Report + Items Now', 'enp_runHeavySyncNow')
    .addItem('Queue Approved Pending Rows to ActionHub', 'enp_queueApprovedPending')
    .addItem('Run ActionHub Batch Now', 'enp_runActionHubBatch')
    .addSeparator()
    .addItem('Create Items from Selected Rows', 'enp_createItemsFromSelectedRows')
    .addItem('Replace SO Lines from Selected Rows', 'enp_replaceSalesOrderLinesFromSelectedRows')
    .addSeparator()
    .addItem('Manual Item Creation: Selected Rows', 'manualCreateItems_selectedRows')
    .addSeparator()
    .addItem('Install Pipeline Trigger', 'enp_installPipelineTrigger')
    .addItem('Remove Pipeline Trigger', 'enp_removePipelineTrigger')
    .addToUi();
}

function enp_installPipelineTrigger() {
  enp_removePipelineTrigger();
  ScriptApp.newTrigger(ENP.PIPELINE.TRIGGER_FUNCTION).timeBased().everyHours(ENP.PIPELINE.TRIGGER_HOURS).create();
  SpreadsheetApp.getActive().toast('Approved-only pipeline trigger installed (every 1 hour).', 'Enternewpart', 5);
}

function enp_removePipelineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction && t.getHandlerFunction() === ENP.PIPELINE.TRIGGER_FUNCTION) ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getActive().toast('Approved-only pipeline trigger removed.', 'Enternewpart', 4);
}

function enp_pipelineTick() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(ENP.PIPELINE.LOCK_WAIT_MS);
  try {
    const props = PropertiesService.getScriptProperties();
    const lastSync = Number(props.getProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS) || 0);
    const now = Date.now();
    const intervalMs = ENP.PIPELINE.HEAVY_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;

    if (!lastSync || (now - lastSync) >= intervalMs) {
      enp_syncItemsReport();
      enp_syncApprovedReport_();
      props.setProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS, String(now));
    }

    enp_queueApprovedPending();
    enp_runActionHubBatch();
  } finally {
    lock.releaseLock();
  }
}

function enp_runHeavySyncNow() {
  enp_syncItemsReport();
  enp_syncApprovedReport_();
  PropertiesService.getScriptProperties().setProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS, String(Date.now()));
  SpreadsheetApp.getActive().toast('Approved report + items sync completed.', 'Enternewpart', 5);
}

function enp_executeApprovedFullPipelineNow() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(ENP.PIPELINE.LOCK_WAIT_MS);
  try {
    const ss = SpreadsheetApp.getActive();
    const start = Date.now();
    Logger.log('FULL APPROVED PIPELINE START');

    Logger.log('STEP 1: Refresh Striven_Items');
    enp_syncItemsReport();

    Logger.log('STEP 2: Refresh Enternewpart');
    enp_syncApprovedReport_();

    PropertiesService.getScriptProperties().setProperty(ENP.PROPS.LAST_HEAVY_SYNC_TS, String(Date.now()));

    Logger.log('STEP 3: Create items for all eligible approved rows');
    const created = enp_createItemsForApprovedPendingRows_();

    Logger.log('STEP 4: Replace SO lines for all eligible approved rows');
    const replaced = enp_replaceLinesForApprovedReadyRows_();

    Logger.log('FULL APPROVED PIPELINE END | CREATED=' + created.created + ' EXISTS=' + created.exists + ' CREATE_FAIL=' + created.failed + ' CREATE_SKIP=' + created.skipped + ' | REPLACED=' + replaced.done + ' REPLACE_FAIL=' + replaced.failed + ' REPLACE_SKIP=' + replaced.skipped);

    ss.toast('Approved pipeline complete (' + (((Date.now() - start) / 1000).toFixed(2)) + 's)', 'Enternewpart', 8);
    return { created: created, replaced: replaced };
  } finally {
    lock.releaseLock();
  }
}

function enp_queueApprovedPending() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ENP.SHEETS.APPROVED);
  if (!sh) throw new Error('Approved sheet not found: ' + ENP.SHEETS.APPROVED);
  const added = enp_actionHubQueueApprovedOnly_(sh);
  SpreadsheetApp.getActive().toast('Approved rows queued: ' + added, 'Enternewpart', 5);
  return added;
}

function enp_runActionHubBatch() {
  return enp_actionHubRunPendingBatch_(ENP.HUB.RUNNER_BATCH_SIZE);
}

function enp_executePipelineNow() {
  return enp_executeApprovedFullPipelineNow();
}
*/
