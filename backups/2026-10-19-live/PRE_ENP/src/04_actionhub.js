/************************************************************
 * APPS SCRIPT — 04_actionhub.gs
 * ENTERNEWPART — ACTION HUB QUEUE + RUNNER
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Central queue system for Enternewpart processing.
 *
 * FLOW
 * ----------------------------------------------------------
 * 1) Queue eligible rows from source sheets
 * 2) Store them in ActionHub
 * 3) Run pending jobs in small batches
 * 4) Create missing items if needed
 * 5) Replace matching placeholder SO lines
 * 6) Write status back to source sheet rows
 *
 * DEPENDS ON
 * ----------------------------------------------------------
 * 01_config_menu.gs
 * 02_striven_core.gs
 * 03_enternewpart_sync_and_actions.gs
 ************************************************************/


/* =========================================================
 * APPS SCRIPT — PUBLIC ENTRY POINTS
 * ========================================================= */

function enp_queueAllPending() {
  const ss = SpreadsheetApp.getActive();
  let added = 0;

  const approved = ss.getSheetByName(ENP.SHEETS.APPROVED);
  if (approved) added += enp_actionHubQueueFromSheet_(approved);

  const quoted = ss.getSheetByName(ENP.SHEETS.QUOTED);
  if (quoted) added += enp_actionHubQueueFromSheet_(quoted);

  ss.toast('Queued rows: ' + added, 'Enternewpart', 5);
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


/* =========================================================
 * APPS SCRIPT — QUEUE BUILD
 * ========================================================= */

function enp_actionHubQueueFromSheet_(sourceSheet) {
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

  if (sourceSheet.getName() === ENP.SHEETS.QUOTED) {
    enp_requireCols_(sourceCol, ['SendToActions']);
  }

  const hubSheet = enp_getOrCreateActionHubSheet_();
  const hubGrid = hubSheet.getDataRange().getValues();
  const hubHeaders = hubGrid.length ? hubGrid[0].map(enp_norm_) : ENP.HUB.HEADERS.slice();
  const hubCol = enp_indexByHeader_(hubHeaders);

  const existingJobKeys = {};
  for (let i = 1; i < hubGrid.length; i++) {
    const key = enp_norm_(hubGrid[i][hubCol['JobKey']]);
    if (key) existingJobKeys[key] = true;
  }

  const itemIndex = enp_buildItemIndex_();
  const appendRows = [];
  let added = 0;

  for (let r = 1; r < sourceGrid.length; r++) {
    const row = sourceGrid[r];
    const sourceRowNum = r + 1;

    if (!enp_sourceRowShouldQueue_(sourceSheet, row, sourceCol)) continue;

    const parsed = enp_parseDescription_(row[sourceCol['ItemDescription']]);
    const soId = enp_num_(row[sourceCol['SalesOrderSalesOrderId']]);
    const soNumber = enp_norm_(row[sourceCol['SalesOrderNumber']]);
    const qty = enp_num_(row[sourceCol['Quantity']]);
    const rawDescription = enp_norm_(row[sourceCol['ItemDescription']]);

    if (!soId) continue;
    if (!parsed.itemNumber) continue;

    const existingNewItemId =
      sourceCol['NewItemId'] != null ? enp_num_(row[sourceCol['NewItemId']]) : null;
    // R3: a report hit may be reused during resolution, but queue state is sourced only from the row.
    // A report miss is UNKNOWN; centralized resolver runs before any create.
    const candidateItemId = existingNewItemId || '';

    const jobKey = enp_makeJobKey_(soId, '', [
      sourceSheet.getName(),
      sourceRowNum,
      parsed.itemNumber,
      qty,
      rawDescription
    ].join('|'));

    if (existingJobKeys[jobKey]) continue;

    appendRows.push(enp_actionHubBuildRow_({
      soId: soId,
      soNumber: soNumber,
      lineId: '',
      rawDescription: rawDescription,
      parsedItemNumber: parsed.itemNumber,
      parsedItemName: parsed.name,
      parsedPrice: parsed.price,
      qty: qty,
      newItemId: candidateItemId,
      state: ENP.HUB.STATE_PENDING,
      jobKey: jobKey,
      attempts: 0,
      nextRunAt: '',
      lastRunAt: '',
      lastError: '',
      sourceSheet: sourceSheet.getName(),
      sourceRow: sourceRowNum
    }));

    existingJobKeys[jobKey] = true;
    added++;
  }

  if (appendRows.length) {
    hubSheet
      .getRange(hubSheet.getLastRow() + 1, 1, appendRows.length, ENP.HUB.HEADERS.length)
      .setValues(appendRows);
  }

  return added;
}

function enp_sourceRowShouldQueue_(sourceSheet, row, col) {
  const placeholder = enp_normUpper_(row[col['ItemNumber']]);
  const action = enp_normUpper_(row[col['LastAction']]);
  const newItemId = col['NewItemId'] != null ? enp_num_(row[col['NewItemId']]) : null;

  if (sourceSheet.getName() === ENP.SHEETS.QUOTED) {
    // Strict checkbox rule: only the actual boolean TRUE queues automatically.
    if (row[col['SendToActions']] !== true) return false;
  }

  if (placeholder !== enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) return false;
  if (action === 'DONE' || action.indexOf('REPLACED') >= 0) return false;
  if (newItemId && action.indexOf('REPLACED') >= 0) return false;
  return true;
}

function enp_actionHubBuildRow_(obj) {
  return ENP.HUB.HEADERS.map(h => obj[h.charAt(0).toLowerCase() + h.slice(1)] != null
    ? obj[h.charAt(0).toLowerCase() + h.slice(1)]
    : (obj[h] != null ? obj[h] : '')
  );
}


/* =========================================================
 * APPS SCRIPT — JOB RUNNER
 * ========================================================= */

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

function enp_actionHubReplaceSalesOrderLine_(job, sourceBundle, newItemId) {
  const sourceRow = sourceBundle.row;
  const sourceCol = sourceBundle.col;

  const soId = enp_num_(
    job.SOId ||
    sourceRow[sourceCol['SalesOrderSalesOrderId']]
  );

  const qty =
    sourceCol['Quantity'] != null
      ? enp_num_(sourceRow[sourceCol['Quantity']])
      : null;

  const rawDescription = enp_norm_(
    job.RawDescription ||
    sourceRow[sourceCol['ItemDescription']]
  );

  if (!soId) {
    throw new Error('Missing Sales Order ID.');
  }

  if (!newItemId) {
    throw new Error('Missing NewItemId.');
  }

  if (!enp_isStandardDescriptionFormat_(rawDescription)) {
    const salesRepName =
      sourceCol['SalesOrderSalesRepFullName'] != null
        ? enp_norm_(
            sourceRow[sourceCol['SalesOrderSalesRepFullName']]
          )
        : '';

    const salesRepEmail =
      enp_getSalesRepEmailByName_(salesRepName);

    enp_sendInvalidDescriptionEmailToSalesRep_({
      recipientEmail: salesRepEmail,
      salesRepName: salesRepName,
      soId: soId,
      soNumber:
        sourceCol['SalesOrderNumber'] != null
          ? sourceRow[sourceCol['SalesOrderNumber']]
          : '',
      description: rawDescription
    });

    throw new Error(
      'ItemDescription is not in standard format.'
    );
  }

  const parsed = enp_parseDescription_(rawDescription);

  if (!parsed.itemNumber || !parsed.name) {
    throw new Error(
      'Could not parse labeled Item Number and Item Name from ItemDescription.'
    );
  }

  /*
   * ActionHub now uses the same production replacement engine
   * as the direct sheet action.
   */
  const result = enp_replaceSalesOrderItems_(
    soId,
    [
      {
        key: 'ACTIONHUB',
        lineId: enp_num_(job.LineId),
        desiredItemNumber: parsed.itemNumber,
        desiredItemName: parsed.name,
        desiredPrice: parsed.price,
        desiredQty: qty,
        newItemId: newItemId
      }
    ]
  );

  if (result && result.blocked) {
    return result;
  }

  if (sourceCol['LastAction'] != null) {
    sourceRow[sourceCol['LastAction']] = 'DONE';
  }

  if (sourceCol['LastError'] != null) {
    sourceRow[sourceCol['LastError']] = '';
  }

  if (sourceCol['LastUpdated'] != null) {
    sourceRow[sourceCol['LastUpdated']] = new Date();
  }

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

function enp_actionHubMarkBlocked_(hubSheet, col, hubSheetRow, hubRow, now, message) {
  if (col['Attempts'] != null) {
    hubRow[col['Attempts']] = ENP.HUB.RUNNER_MAX_ATTEMPTS;
  }
  if (col['State'] != null) hubRow[col['State']] = ENP.HUB.STATE_FAILED;
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


/* =========================================================
 * APPS SCRIPT — SOURCE SHEET WRITEBACK
 * ========================================================= */

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

function enp_actionHubWritebackBlocked_(sourceSheet, rowNumber, row, col, now, result) {
  const replacements = result && Array.isArray(result.replacements)
    ? result.replacements
    : [];
  const first = replacements.length ? replacements[0] : null;

  if (col['LastAction'] != null) {
    row[col['LastAction']] =
      'ITEM READY - SO REPLACE BLOCKED' +
      (first && first.lineId ? ' LINE=' + first.lineId : '');
  }
  if (col['LastError'] != null) {
    row[col['LastError']] = result && result.blockMessage
      ? result.blockMessage
      : 'CUSTOM_ITEM_GROUP_API_BLOCK';
  }
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