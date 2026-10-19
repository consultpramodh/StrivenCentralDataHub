/************************************************************
 * ENTERNEWPART — OPERATIONAL LOGGING + FAILURE ESCALATION R4
 * Marker: ENP_OPERATIONAL_LOGGING_R4_20260908
 *
 * PURPOSE
 * - Persist trigger/pipeline outcomes in Enternewpart_Operational_Log.
 * - Keep newest entries first.
 * - Preserve row-level processing, then fail the outer execution when
 *   current-run business failures were recorded in source sheets/ActionHub.
 * - Mirror every persisted event to console + Logger.
 * - Never silently claim success when persistent logging itself fails.
 ************************************************************/

var ENP_OPERATIONAL_LOGGING_R4_MARKER = 'ENP_OPERATIONAL_LOGGING_R4_20260908';
var ENP_OP_RUN_CONTEXT_ = null;

var ENP_OP_CFG_ = {
  SHEET: 'Enternewpart_Logbook',
  LEGACY_SHEET: 'Enternewpart_Operational_Log',
  OPERATIONAL_HEADERS: [
    'RunId',
    'Severity',
    'EntryPoint',
    'Stage',
    'Attempts',
    'DurationMs',
    'Details'
  ]
};

function enp_operationalRunId_() {
  var now = new Date();
  var tz = Session.getScriptTimeZone() || 'America/Toronto';
  var stamp = Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss-SSS');
  return 'ENP-' + stamp + '-' + Utilities.getUuid().slice(0, 8);
}

function enp_operationalNormalize_(value) {
  return String(value == null ? '' : value).trim();
}

function enp_operationalHeaderMap_(headers) {
  var map = {};
  (headers || []).forEach(function(h, i) {
    var key = enp_operationalNormalize_(h);
    if (key) map[key] = i;
  });
  return map;
}

function enp_operationalDateMs_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    var dms = value.getTime();
    return isNaN(dms) ? null : dms;
  }
  var d = new Date(value);
  var ms = d.getTime();
  return isNaN(ms) ? null : ms;
}

function enp_operationalIsCurrent_(value, startedMs, endedMs) {
  var ms = enp_operationalDateMs_(value);
  if (ms == null) return false;
  return ms >= (startedMs - 5000) && ms <= (endedMs + 60000);
}

function enp_operationalJson_(value) {
  try {
    var text = JSON.stringify(value == null ? {} : value);
    return text.length > 45000 ? text.slice(0, 45000) + '...[TRUNCATED]' : text;
  } catch (e) {
    return enp_operationalNormalize_(value).slice(0, 45000);
  }
}


var ENP_OPERATIONAL_LOGGING_R4_1_MARKER = 'ENP_OPERATIONAL_LOGGING_R4_1_20260908';

function enp_operationalLogbookHeaders_(sh) {
  if (!sh || sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function(v) { return enp_operationalNormalize_(v); });
}

function enp_operationalAppendMissingHeaders_(sh, headers) {
  var current = enp_operationalLogbookHeaders_(sh);
  var map = enp_operationalHeaderMap_(current);
  var writeCol = current.length;
  (headers || []).forEach(function(h) {
    if (map[h] != null) return;
    writeCol += 1;
    sh.getRange(1, writeCol).setValue(h).setFontWeight('bold');
    map[h] = writeCol - 1;
  });
  return enp_operationalLogbookHeaders_(sh);
}

function enp_operationalRunBy_() {
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (ignoreActiveUser) {}
  try {
    var effective = Session.getEffectiveUser().getEmail();
    if (effective) return effective;
  } catch (ignoreEffectiveUser) {}
  return '';
}

function enp_operationalEventMap_(event) {
  event = event || {};
  var detailsText = typeof event.details === 'string'
    ? event.details.slice(0, 45000)
    : enp_operationalJson_(event.details || {});
  var actionType = event.eventType || event.action || 'OPERATIONAL';
  var result = event.result || (event.severity === 'ERROR' ? 'FAILED' : 'OK');
  var itemNumber = event.itemNumber || '';
  return {
    'Timestamp': event.timestamp || new Date(),
    'ActionType': actionType,
    'Result': result,
    'SourceSheet': event.sourceSheet || '',
    'SourceRow': event.sourceRow || '',
    'SalesOrderId': event.salesOrderId || '',
    'SalesOrderNumber': event.salesOrderNumber || '',
    'ParsedItemNumber': itemNumber,
    'NewItemId': event.newItemId || '',
    'NewItemNumber': itemNumber,
    'Message': event.action || actionType,
    'Error': event.error || '',
    'RunBy': enp_operationalRunBy_(),
    'RunId': event.runId || '',
    'Severity': event.severity || 'INFO',
    'EntryPoint': event.entryPoint || '',
    'Stage': event.stage || '',
    'Attempts': event.attempts == null ? '' : event.attempts,
    'DurationMs': event.durationMs == null ? '' : event.durationMs,
    'Details': detailsText
  };
}

function enp_operationalEventRowForHeaders_(event, headers) {
  var mapped = enp_operationalEventMap_(event);
  return (headers || []).map(function(h) {
    return Object.prototype.hasOwnProperty.call(mapped, h) ? mapped[h] : '';
  });
}

function enp_operationalSortLogbookNewestFirst_(sh) {
  if (!sh || sh.getLastRow() < 3) return;
  var headers = enp_operationalLogbookHeaders_(sh);
  var col = enp_operationalHeaderMap_(headers);
  if (col['Timestamp'] == null) return;
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
    .sort({ column: col['Timestamp'] + 1, ascending: false });
}

function enp_operationalAppendEventsCore_(events, sortAfter) {
  if (!events || !events.length) return;
  var sh = enp_operationalEnsureLogbook_();
  var headers = enp_operationalLogbookHeaders_(sh);
  var rows = events.slice().reverse().map(function(e) {
    return enp_operationalEventRowForHeaders_(e, headers);
  });
  sh.insertRowsBefore(2, rows.length);
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  var col = enp_operationalHeaderMap_(headers);
  if (col['Timestamp'] != null) {
    sh.getRange(2, col['Timestamp'] + 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss.000');
  }
  if (sortAfter) enp_operationalSortLogbookNewestFirst_(sh);
}

function enp_operationalMigrateLegacySheetOnce_() {
  var props = PropertiesService.getDocumentProperties();
  var key = 'ENP_OPERATIONAL_LOG_R41_MIGRATED';
  if (props.getProperty(key) === '1') return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var legacyName = ENP_OP_CFG_.LEGACY_SHEET;
  if (!legacyName || legacyName === ENP_OP_CFG_.SHEET) {
    props.setProperty(key, '1');
    return;
  }
  var legacy = ss.getSheetByName(legacyName);
  if (!legacy || legacy.getLastRow() < 2 || legacy.getLastColumn() < 1) {
    props.setProperty(key, '1');
    return;
  }

  var grid = legacy.getDataRange().getValues();
  var headers = grid[0].map(enp_operationalNormalize_);
  var col = enp_operationalHeaderMap_(headers);
  var events = [];
  for (var r = 1; r < grid.length; r++) {
    var row = grid[r];
    events.push({
      timestamp: col['Timestamp'] != null ? row[col['Timestamp']] : new Date(),
      runId: col['RunId'] != null ? row[col['RunId']] : '',
      severity: col['Severity'] != null ? row[col['Severity']] : 'INFO',
      eventType: col['EventType'] != null ? row[col['EventType']] : 'R4_LEGACY_MIGRATION',
      entryPoint: col['EntryPoint'] != null ? row[col['EntryPoint']] : '',
      stage: col['Stage'] != null ? row[col['Stage']] : 'MIGRATION',
      result: col['Result'] != null ? row[col['Result']] : '',
      sourceSheet: col['SourceSheet'] != null ? row[col['SourceSheet']] : '',
      sourceRow: col['SourceRow'] != null ? row[col['SourceRow']] : '',
      salesOrderId: col['SalesOrderId'] != null ? row[col['SalesOrderId']] : '',
      salesOrderNumber: col['SalesOrderNumber'] != null ? row[col['SalesOrderNumber']] : '',
      itemNumber: col['ItemNumber'] != null ? row[col['ItemNumber']] : '',
      newItemId: col['NewItemId'] != null ? row[col['NewItemId']] : '',
      action: col['Action'] != null ? row[col['Action']] : 'Migrated from ' + legacyName,
      error: col['Error'] != null ? row[col['Error']] : '',
      attempts: col['Attempts'] != null ? row[col['Attempts']] : '',
      durationMs: col['DurationMs'] != null ? row[col['DurationMs']] : '',
      details: col['Details'] != null ? row[col['Details']] : { migratedFrom: legacyName, legacyRow: r + 1 }
    });
  }

  // Legacy R4 sheet is newest-first. Reverse to chronological before core insertion.
  events.reverse();
  enp_operationalAppendEventsCore_(events, true);
  props.setProperty(key, '1');
}

function enp_operationalEnsureLogbook_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Cannot open active spreadsheet for operational logging.');

  var sh = ss.getSheetByName(ENP_OP_CFG_.SHEET);
  if (!sh) sh = ss.insertSheet(ENP_OP_CFG_.SHEET);

  var current = enp_operationalLogbookHeaders_(sh);
  var nonBlank = current.filter(function(v) { return !!v; });
  if (!nonBlank.length) {
    var baseHeaders = [
      'Timestamp','ActionType','Result','SourceSheet','SourceRow',
      'SalesOrderId','SalesOrderNumber','SalesOrderStatus','CustomerName','SalesRep',
      'BeforeItemId','BeforeItemNumber','BeforeItemDescription','BeforeQty','BeforePrice',
      'ParsedItemNumber','ParsedItemName','ParsedPrice',
      'NewItemId','NewItemNumber','NewItemName','NewItemPrice','NewItemCost',
      'AfterSOItemId','AfterSODescription','AfterSOPrice','Message','Error','RunBy'
    ];
    sh.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders]).setFontWeight('bold');
    current = baseHeaders.slice();
  } else {
    var existing = enp_operationalHeaderMap_(current);
    if (existing['Timestamp'] == null || existing['ActionType'] == null || existing['Result'] == null) {
      throw new Error(
        'Existing "' + ENP_OP_CFG_.SHEET + '" is missing Timestamp / ActionType / Result. ' +
        'Refusing to rewrite or reinterpret the established Logbook schema.'
      );
    }
  }

  enp_operationalAppendMissingHeaders_(sh, ENP_OP_CFG_.OPERATIONAL_HEADERS);
  sh.setFrozenRows(1);
  return sh;
}

function enp_operationalEventRow_(event) {
  var sh = enp_operationalEnsureLogbook_();
  return enp_operationalEventRowForHeaders_(event || {}, enp_operationalLogbookHeaders_(sh));
}

function enp_operationalConsole_(event) {
  var payload = {
    marker: ENP_OPERATIONAL_LOGGING_R4_MARKER,
    runId: event.runId || '',
    severity: event.severity || 'INFO',
    eventType: event.eventType || '',
    entryPoint: event.entryPoint || '',
    stage: event.stage || '',
    result: event.result || '',
    sourceSheet: event.sourceSheet || '',
    sourceRow: event.sourceRow || '',
    salesOrderId: event.salesOrderId || '',
    salesOrderNumber: event.salesOrderNumber || '',
    itemNumber: event.itemNumber || '',
    newItemId: event.newItemId || '',
    action: event.action || '',
    error: event.error || '',
    attempts: event.attempts == null ? '' : event.attempts,
    durationMs: event.durationMs == null ? '' : event.durationMs,
    details: event.details || {}
  };

  var text = enp_operationalJson_(payload);
  try {
    if (payload.severity === 'ERROR') console.error(text);
    else if (payload.severity === 'WARN') console.warn(text);
    else console.log(text);
  } catch (ignoreConsole) {}

  try { Logger.log(text); } catch (ignoreLogger) {}
}

function enp_operationalWriteEvents_(events) {
  if (!events || !events.length) return;
  enp_operationalMigrateLegacySheetOnce_();
  enp_operationalAppendEventsCore_(events, false);
  events.forEach(enp_operationalConsole_);
}

function enp_log_(eventType, details) {
  details = details || {};
  var ctx = ENP_OP_RUN_CONTEXT_;
  var event = {
    timestamp: new Date(),
    runId: details.runId || (ctx && ctx.runId) || '',
    severity: details.severity || 'INFO',
    eventType: eventType || details.eventType || 'EVENT',
    entryPoint: details.entryPoint || (ctx && ctx.entryPoint) || '',
    stage: details.stage || '',
    result: details.result || '',
    sourceSheet: details.sourceSheet || '',
    sourceRow: details.sourceRow || '',
    salesOrderId: details.salesOrderId || '',
    salesOrderNumber: details.salesOrderNumber || '',
    itemNumber: details.itemNumber || '',
    newItemId: details.newItemId || '',
    action: details.action || '',
    error: details.error || '',
    attempts: details.attempts,
    durationMs: details.durationMs,
    details: details.details || details
  };
  enp_operationalWriteEvents_([event]);
  return event;
}

function enp_operationalParseItemNumber_(rawDescription) {
  var raw = String(rawDescription == null ? '' : rawDescription).replace(/\r/g, '');
  var m = raw.match(/Item\s*Number\s*:\s*([^\n]+)/i);
  return m && m[1] ? m[1].trim() : '';
}

function enp_operationalSourceSheets_() {
  var names = [];
  try {
    if (typeof ENP !== 'undefined' && ENP && ENP.SHEETS) {
      if (ENP.SHEETS.APPROVED) names.push(String(ENP.SHEETS.APPROVED));
      if (ENP.SHEETS.QUOTED) names.push(String(ENP.SHEETS.QUOTED));
    }
  } catch (ignoreEnp) {}

  ['Enternewpart', 'Enternewpart_Quoted'].forEach(function(name) {
    if (names.indexOf(name) < 0) names.push(name);
  });
  return names;
}

function enp_operationalCollectSourceOutcomes_(ctx, endedMs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];

  enp_operationalSourceSheets_().forEach(function(sheetName) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return;

    var grid = sh.getDataRange().getValues();
    var headers = grid[0].map(enp_operationalNormalize_);
    var col = enp_operationalHeaderMap_(headers);
    if (col['LastUpdated'] == null || col['LastAction'] == null) return;

    for (var r = 1; r < grid.length; r++) {
      var row = grid[r];
      if (!enp_operationalIsCurrent_(row[col['LastUpdated']], ctx.startedMs, endedMs)) continue;

      var action = enp_operationalNormalize_(row[col['LastAction']]);
      var error = col['LastError'] != null ? enp_operationalNormalize_(row[col['LastError']]) : '';
      if (!action && !error) continue;

      var upperAction = action.toUpperCase();
      var isFailure = !!error || /FAILED|FAIL|ERROR|BLOCKED|ID REQUIRED|UNRESOLVED/.test(upperAction);
      var itemNumber = '';
      if (col['NewItemNumber'] != null) itemNumber = enp_operationalNormalize_(row[col['NewItemNumber']]);
      if (!itemNumber && col['ItemDescription'] != null) {
        itemNumber = enp_operationalParseItemNumber_(row[col['ItemDescription']]);
      }

      out.push({
        timestamp: new Date(),
        runId: ctx.runId,
        severity: isFailure ? 'ERROR' : 'INFO',
        eventType: 'SOURCE_ROW_OUTCOME',
        entryPoint: ctx.entryPoint,
        stage: 'SOURCE_WRITEBACK',
        result: isFailure ? 'FAILED' : 'OK',
        sourceSheet: sheetName,
        sourceRow: r + 1,
        salesOrderId: col['SalesOrderSalesOrderId'] != null ? row[col['SalesOrderSalesOrderId']] : '',
        salesOrderNumber: col['SalesOrderNumber'] != null ? row[col['SalesOrderNumber']] : '',
        itemNumber: itemNumber,
        newItemId: col['NewItemId'] != null ? row[col['NewItemId']] : '',
        action: action,
        error: error,
        attempts: '',
        durationMs: '',
        details: {
          lastUpdated: row[col['LastUpdated']],
          sourceSheet: sheetName,
          sourceRow: r + 1
        }
      });
    }
  });

  return out;
}

function enp_operationalActionHubSheetName_() {
  try {
    if (typeof ENP !== 'undefined' && ENP && ENP.SHEETS && ENP.SHEETS.HUB) {
      return String(ENP.SHEETS.HUB);
    }
  } catch (ignoreEnp) {}
  return 'ActionHub';
}

function enp_operationalCollectHubOutcomes_(ctx, endedMs) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = enp_operationalActionHubSheetName_();
  var sh = ss.getSheetByName(sheetName);
  var out = [];
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return out;

  var grid = sh.getDataRange().getValues();
  var headers = grid[0].map(enp_operationalNormalize_);
  var col = enp_operationalHeaderMap_(headers);
  if (col['LastRunAt'] == null) return out;

  for (var r = 1; r < grid.length; r++) {
    var row = grid[r];
    if (!enp_operationalIsCurrent_(row[col['LastRunAt']], ctx.startedMs, endedMs)) continue;

    var state = col['State'] != null ? enp_operationalNormalize_(row[col['State']]) : '';
    var error = col['LastError'] != null ? enp_operationalNormalize_(row[col['LastError']]) : '';
    var isFailure = !!error || /FAILED|ERROR|BLOCKED/.test(state.toUpperCase());

    out.push({
      timestamp: new Date(),
      runId: ctx.runId,
      severity: isFailure ? 'ERROR' : 'INFO',
      eventType: 'ACTIONHUB_OUTCOME',
      entryPoint: ctx.entryPoint,
      stage: 'ACTIONHUB',
      result: isFailure ? 'FAILED' : (state || 'OK'),
      sourceSheet: col['SourceSheet'] != null ? row[col['SourceSheet']] : sheetName,
      sourceRow: col['SourceRow'] != null ? row[col['SourceRow']] : '',
      salesOrderId: col['SOId'] != null ? row[col['SOId']] : '',
      salesOrderNumber: col['SONumber'] != null ? row[col['SONumber']] : '',
      itemNumber: col['ParsedItemNumber'] != null ? row[col['ParsedItemNumber']] : '',
      newItemId: col['NewItemId'] != null ? row[col['NewItemId']] : '',
      action: state,
      error: error,
      attempts: col['Attempts'] != null ? row[col['Attempts']] : '',
      durationMs: '',
      details: {
        jobKey: col['JobKey'] != null ? row[col['JobKey']] : '',
        lastRunAt: row[col['LastRunAt']],
        nextRunAt: col['NextRunAt'] != null ? row[col['NextRunAt']] : ''
      }
    });
  }
  return out;
}

function enp_operationalDeduplicateEvents_(events) {
  var seen = {};
  var out = [];
  (events || []).forEach(function(e) {
    var key = [
      e.eventType || '', e.sourceSheet || '', e.sourceRow || '',
      e.salesOrderId || '', e.itemNumber || '', e.action || '', e.error || ''
    ].join('|');
    if (seen[key]) return;
    seen[key] = true;
    out.push(e);
  });
  return out;
}

function enp_operationalRecordCaughtError_(entryPoint, err) {
  var ctx = ENP_OP_RUN_CONTEXT_;
  if (!ctx) return;
  if (!ctx.directEvents) ctx.directEvents = [];
  ctx.directEvents.push({
    timestamp: new Date(),
    runId: ctx.runId,
    severity: 'ERROR',
    eventType: 'CAUGHT_EXCEPTION',
    entryPoint: entryPoint || ctx.entryPoint,
    stage: 'GUARD_CATCH',
    result: 'FAILED',
    action: 'Guard caught an exception',
    error: String(err && err.message ? err.message : err || 'Caught exception'),
    details: { stack: err && err.stack ? String(err.stack).slice(0, 45000) : '' }
  });
}

function enp_operationalReturnedFailure_(result) {
  if (!result || typeof result !== 'object') return null;
  var fail = false;
  var reasons = [];

  if (result.ok === false) { fail = true; reasons.push('ok=false'); }
  if (result.success === false) { fail = true; reasons.push('success=false'); }

  var status = enp_operationalNormalize_(result.status || result.Status).toUpperCase();
  if (status && /FAIL|ERROR|BLOCKED/.test(status)) { fail = true; reasons.push('status=' + status); }

  function scan(obj, depth, prefix) {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    Object.keys(obj).forEach(function(k) {
      var v = obj[k];
      var key = String(k).toUpperCase();
      var label = prefix ? prefix + '.' + k : k;
      if (/FAIL|FAILED|FAILURE|ERROR/.test(key) && typeof v === 'number' && v > 0) {
        fail = true;
        reasons.push(label + '=' + v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        scan(v, depth + 1, label);
      }
    });
  }
  scan(result, 0, '');

  var errorText = enp_operationalNormalize_(result.error || result.Error || result.message || result.Message);
  if (errorText) { fail = true; reasons.push(errorText); }

  if (!fail) return null;
  return {
    severity: 'ERROR',
    eventType: 'RETURNED_FAILURE',
    stage: 'EXECUTION_RETURN',
    result: 'FAILED',
    action: 'Entrypoint returned a failure-shaped result',
    error: reasons.join(' | '),
    details: result
  };
}

function enp_operationalCollectCurrentRun_(ctx, endedMs) {
  var scanned = enp_operationalCollectSourceOutcomes_(ctx, endedMs)
    .concat(enp_operationalCollectHubOutcomes_(ctx, endedMs));
  var direct = (ctx && ctx.directEvents) ? ctx.directEvents.slice() : [];
  return enp_operationalDeduplicateEvents_(direct.concat(scanned));
}

function enp_operationalFailureEvents_(events) {
  return (events || []).filter(function(e) {
    return e.severity === 'ERROR' || e.result === 'FAILED' || !!e.error;
  });
}

function enp_operationalExecute_(entryPoint, fn) {
  if (ENP_OP_RUN_CONTEXT_) {
    return fn();
  }

  var ctx = {
    runId: enp_operationalRunId_(),
    entryPoint: entryPoint || 'UNKNOWN',
    startedAt: new Date(),
    startedMs: Date.now(),
    directEvents: []
  };

  ENP_OP_RUN_CONTEXT_ = ctx;

  // Strict: if persistent logging cannot initialize, do not perform an unlogged production run.
  enp_operationalWriteEvents_([{
    timestamp: ctx.startedAt,
    runId: ctx.runId,
    severity: 'INFO',
    eventType: 'RUN_START',
    entryPoint: ctx.entryPoint,
    stage: 'START',
    result: 'STARTED',
    action: 'RUN START',
    details: { marker: ENP_OPERATIONAL_LOGGING_R4_MARKER }
  }]);

  var result;
  var caught = null;

  try {
    result = fn();
    var returnedFailure = enp_operationalReturnedFailure_(result);
    if (returnedFailure) {
      var duplicateCaught = ctx.directEvents.some(function(e) {
        return e && e.eventType === 'CAUGHT_EXCEPTION' && e.error &&
          returnedFailure.error && returnedFailure.error.indexOf(e.error) >= 0;
      });
      if (!duplicateCaught) {
        returnedFailure.timestamp = new Date();
        returnedFailure.runId = ctx.runId;
        returnedFailure.entryPoint = ctx.entryPoint;
        ctx.directEvents.push(returnedFailure);
      }
    }
  } catch (err) {
    caught = err;
  }

  var endedAt = new Date();
  var endedMs = endedAt.getTime();
  var durationMs = Math.max(0, endedMs - ctx.startedMs);
  var events = [];

  try {
    events = enp_operationalCollectCurrentRun_(ctx, endedMs);
  } catch (scanErr) {
    events.push({
      timestamp: endedAt,
      runId: ctx.runId,
      severity: 'ERROR',
      eventType: 'LOG_SCAN_FAILURE',
      entryPoint: ctx.entryPoint,
      stage: 'POST_RUN_SCAN',
      result: 'FAILED',
      action: 'Could not scan current-run sheet outcomes',
      error: String(scanErr && scanErr.message ? scanErr.message : scanErr),
      details: {}
    });
  }

  if (caught) {
    events.push({
      timestamp: endedAt,
      runId: ctx.runId,
      severity: 'ERROR',
      eventType: 'UNCAUGHT_EXCEPTION',
      entryPoint: ctx.entryPoint,
      stage: 'EXECUTION',
      result: 'FAILED',
      action: 'Execution threw',
      error: String(caught && caught.message ? caught.message : caught),
      durationMs: durationMs,
      details: { stack: caught && caught.stack ? String(caught.stack).slice(0, 45000) : '' }
    });
  }

  var failures = enp_operationalFailureEvents_(events);
  var successCount = events.length - failures.length;

  events.push({
    timestamp: endedAt,
    runId: ctx.runId,
    severity: failures.length || caught ? 'ERROR' : 'INFO',
    eventType: 'RUN_SUMMARY',
    entryPoint: ctx.entryPoint,
    stage: 'END',
    result: failures.length || caught ? 'FAILED' : 'SUCCESS',
    action: failures.length || caught ? 'RUN COMPLETED WITH FAILURES' : 'RUN COMPLETED',
    error: failures.length ? (failures.length + ' business/logging failure event(s) detected.') : '',
    durationMs: durationMs,
    details: {
      outcomeEvents: events.length,
      successEvents: successCount,
      failureEvents: failures.length,
      uncaughtException: !!caught
    }
  });

  try {
    enp_operationalWriteEvents_(events);
  } catch (logErr) {
    ENP_OP_RUN_CONTEXT_ = null;
    var logMessage = 'ENTERNEWPART operational log persistence failed after run: ' +
      String(logErr && logErr.message ? logErr.message : logErr);
    try { console.error(logMessage); } catch (ignoreConsole) {}
    try { Logger.log(logMessage); } catch (ignoreLogger) {}
    if (caught) {
      throw new Error(logMessage + ' | Original execution error: ' +
        String(caught && caught.message ? caught.message : caught));
    }
    throw new Error(logMessage);
  }

  ENP_OP_RUN_CONTEXT_ = null;

  if (caught) throw caught;

  if (failures.length) {
    throw new Error(
      'ENTERNEWPART run ' + ctx.runId + ' completed with ' + failures.length +
      ' business failure event(s). See "' + ENP_OP_CFG_.SHEET + '" for the persistent log.'
    );
  }

  return result;
}

function enp_testOperationalLogger() {
  var runId = enp_operationalRunId_();
  enp_operationalWriteEvents_([{
    timestamp: new Date(),
    runId: runId,
    severity: 'INFO',
    eventType: 'LOGGER_TEST',
    entryPoint: 'enp_testOperationalLogger',
    stage: 'TEST',
    result: 'PASS',
    action: 'Persistent operational logger test row',
    details: { marker: ENP_OPERATIONAL_LOGGING_R4_MARKER }
  }]);
  return { ok: true, runId: runId, sheet: ENP_OP_CFG_.SHEET };
}


function enp_guardedPipelineTick() {
  return enp_operationalExecute_('enp_guardedPipelineTick', function() {
    return enp_guardedPipelineTick__ENP_R4_INNER();
  });
}


function enp_pipelineTick() {
  return enp_operationalExecute_('enp_pipelineTick', function() {
    return enp_pipelineTick__ENP_R4_INNER();
  });
}


function enp_executeApprovedFullPipelineNow() {
  return enp_operationalExecute_('enp_executeApprovedFullPipelineNow', function() {
    return enp_executeApprovedFullPipelineNow__ENP_R4_INNER();
  });
}
