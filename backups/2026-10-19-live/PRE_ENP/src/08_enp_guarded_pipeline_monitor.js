/************************************************************
 * APPS SCRIPT - 08_enp_guarded_pipeline_monitor.gs
 * ENTERNEWPART - GUARDED PIPELINE + FAILURE ALERTS R2
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Adds protection WITHOUT modifying existing Enternewpart files.
 *
 * 1) Replaces the scheduled pipeline trigger with a guarded trigger.
 * 2) Checks the production Striven auth path BEFORE the pipeline runs.
 * 3) If production auth fails, independently checks Striven's official
 *    token endpoint to distinguish an auth-code regression from an
 *    actual credential/service problem.
 * 4) Blocks that pipeline run when auth is unhealthy so rows are not
 *    converted into avoidable CREATE FAILED errors.
 * 5) Sends deduplicated failure-alert emails.
 * 6) Scans Enternewpart, Enternewpart_Quoted and ActionHub for recent
 *    failures after successful pipeline runs.
 *
 * IMPORTANT
 * ----------------------------------------------------------
 * After this file is pushed, run ONCE:
 *   enp_installGuardedPipelineTrigger
 ************************************************************/

const ENP_GUARD_R2 = Object.freeze({
  VERSION: 'R2',
  OFFICIAL_TOKEN_URL: 'https://api.striven.com/accesstoken',
  ALERT_EMAIL_PROPERTY: 'ENTERNEWPART_FAILURE_ALERT_EMAIL',
  DEFAULT_ALERT_EMAIL: 'pramodh@classicfireplace.ca',
  SYSTEM_ALERT_COOLDOWN_SECONDS: 1800,
  ROW_ALERT_COOLDOWN_SECONDS: 21600,
  RECENT_FAILURE_WINDOW_HOURS: 48,
  MAX_FAILURES_PER_EMAIL: 25,
  GUARDED_HANDLER: 'enp_guardedPipelineTick',
  LEGACY_PIPELINE_HANDLERS: [
    'enp_pipelineTick',
    'enternewpart_pipeline_tick',
    'enternewpart_actionHub_tick'
  ]
});

/**
 * Install the ONLY scheduled Enternewpart pipeline trigger that should run.
 * Removes known older pipeline/action-hub triggers first.
 */
function enp_installGuardedPipelineTrigger() {
  const removed = [];
  const handlersToRemove = new Set(
    [ENP_GUARD_R2.GUARDED_HANDLER].concat(ENP_GUARD_R2.LEGACY_PIPELINE_HANDLERS)
  );

  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    if (handlersToRemove.has(fn)) {
      ScriptApp.deleteTrigger(t);
      removed.push(fn);
    }
  });

  ScriptApp.newTrigger(ENP_GUARD_R2.GUARDED_HANDLER)
    .timeBased()
    .everyMinutes(10)
    .create();

  SpreadsheetApp.getActive().toast(
    'Guarded Enternewpart pipeline installed. Removed old triggers: ' + removed.length,
    'Enternewpart',
    7
  );

  Logger.log(JSON.stringify({
    status: 'INSTALLED',
    handler: ENP_GUARD_R2.GUARDED_HANDLER,
    removedHandlers: removed
  }, null, 2));
}

function enp_removeGuardedPipelineTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    const fn = t.getHandlerFunction && t.getHandlerFunction();
    if (fn === ENP_GUARD_R2.GUARDED_HANDLER) {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });

  SpreadsheetApp.getActive().toast(
    'Removed guarded Enternewpart trigger(s): ' + removed,
    'Enternewpart',
    5
  );
}

/**
 * Scheduled guarded entry point.
 * Production auth is tested BEFORE invoking the existing pipeline.
 */
function enp_guardedPipelineTick__ENP_R4_INNER() {
  const auth = enp_guardCheckProductionAuth_();

  if (!auth.ok) {
    enp_guardSendSystemAlert_({
      category: auth.category || 'AUTH',
      subject: 'ENTERNEWPART BLOCKED - Striven authentication failed',
      message:
        'The guarded Enternewpart pipeline did NOT run because Striven authentication is unhealthy.\n\n' +
        'Production auth error:\n' + (auth.productionError || '[none]') + '\n\n' +
        'Independent official-endpoint check:\n' + (auth.directCheck || '[not available]') + '\n\n' +
        'No Enternewpart pipeline work was attempted during this guarded run.'
    });

    Logger.log('ENTERNEWPART GUARDED PIPELINE BLOCKED: ' + JSON.stringify(auth));
    return;
  }

  try {
    if (typeof enp_pipelineTick !== 'function') {
      throw new Error('Expected existing function enp_pipelineTick() was not found.');
    }

    enp_pipelineTick();
  } catch (err) {
    try { enp_operationalRecordCaughtError_('enp_guardedPipelineTick', err); } catch (enpR4LogErr) { try { console.error(enpR4LogErr); } catch (ignoreR4LogErr) {} }

    enp_guardSendSystemAlert_({
      category: 'PIPELINE',
      subject: 'ENTERNEWPART pipeline failed',
      message: String(err && err.stack ? err.stack : (err && err.message ? err.message : err))
    });
    throw err;
  }

  try {
    enp_guardScanAndEmailRecentFailures_();
  } catch (scanErr) {
    try { enp_operationalRecordCaughtError_('enp_guardedPipelineTick', scanErr); } catch (enpR4LogErr) { try { console.error(enpR4LogErr); } catch (ignoreR4LogErr) {} }

    Logger.log('ENTERNEWPART failure scan error: ' + scanErr);
  }
}

/**
 * Test only. Does not modify Striven or Sheets.
 */
function enp_testGuardedAuthOnly() {
  const result = enp_guardCheckProductionAuth_();
  Logger.log(JSON.stringify(result, null, 2));
  SpreadsheetApp.getActive().toast(
    result.ok ? 'Guarded auth check PASS' : 'Guarded auth check FAILED - see logs',
    'Enternewpart',
    6
  );
  return result;
}

/**
 * Sends one real test email to the configured alert recipient.
 */
function enp_testFailureAlertEmail() {
  const recipient = enp_guardGetAlertEmail_();
  MailApp.sendEmail({
    to: recipient,
    subject: '[TEST] ENTERNEWPART failure alerts R2',
    body:
      'This is a test of the Enternewpart guarded pipeline failure-alert system.\n\n' +
      'If you received this message, the email path is working.\n' +
      'Version: ' + ENP_GUARD_R2.VERSION
  });

  SpreadsheetApp.getActive().toast(
    'Test failure-alert email sent to ' + recipient,
    'Enternewpart',
    6
  );
}

/**
 * Read-only scan. Logs recent failures but sends no email.
 */
function enp_previewRecentFailureAlerts() {
  const failures = enp_guardCollectRecentFailures_();
  Logger.log(JSON.stringify({ count: failures.length, failures: failures }, null, 2));
  SpreadsheetApp.getActive().toast(
    'Recent failure candidates: ' + failures.length + ' (see logs)',
    'Enternewpart',
    6
  );
  return failures;
}

function enp_guardCheckProductionAuth_() {
  try {
    if (typeof enp_getStrivenHeaders_ !== 'function') {
      throw new Error('Production auth function enp_getStrivenHeaders_() was not found.');
    }

    const headers = enp_getStrivenHeaders_();
    if (!headers || !headers.Authorization || String(headers.Authorization).indexOf('Bearer ') !== 0) {
      throw new Error('Production auth returned no usable Bearer authorization header.');
    }

    return {
      ok: true,
      category: 'AUTH_OK',
      production: 'enp_getStrivenHeaders_ returned a Bearer header.'
    };
  } catch (productionErr) {
    const productionError = String(
      productionErr && productionErr.message ? productionErr.message : productionErr
    );

    const direct = enp_guardDirectOfficialTokenCheck_();

    return {
      ok: false,
      category: direct.ok ? 'AUTH_CODE_REGRESSION' : 'AUTH_OR_CREDENTIAL_FAILURE',
      productionError: productionError,
      directCheck: direct.ok
        ? 'PASS - the official /accesstoken endpoint accepted the configured credentials. The production auth function is the likely fault.'
        : 'FAILED - ' + direct.error,
      directOfficialEndpointOk: direct.ok
    };
  }
}

/**
 * Independent auth check that intentionally does NOT call any existing
 * Enternewpart auth helper. This remains useful even if the production
 * auth helper is accidentally edited later.
 */
function enp_guardDirectOfficialTokenCheck_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const clientId = props.getProperty('CLIENT_ID');
    const clientSecret = props.getProperty('CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      return { ok: false, error: 'Missing CLIENT_ID and/or CLIENT_SECRET Script Property.' };
    }

    // First use the same form-body credential style that has already
    // worked in this Enternewpart project. If Striven rejects that style,
    // try Basic Auth as a compatibility fallback.
    let response = UrlFetchApp.fetch(ENP_GUARD_R2.OFFICIAL_TOKEN_URL, {
      method: 'post',
      payload: {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'api'
      },
      headers: { Accept: 'application/json' },
      muteHttpExceptions: true
    });

    let code = response.getResponseCode();
    let text = response.getContentText() || '';

    if (code < 200 || code >= 300) {
      const basic = Utilities.base64Encode(clientId + ':' + clientSecret);
      response = UrlFetchApp.fetch(ENP_GUARD_R2.OFFICIAL_TOKEN_URL, {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: { grant_type: 'client_credentials' },
        headers: {
          Authorization: 'Basic ' + basic,
          Accept: 'application/json'
        },
        muteHttpExceptions: true
      });
      code = response.getResponseCode();
      text = response.getContentText() || '';
    }

    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: 'Official token endpoint returned HTTP ' + code + ': ' + text.slice(0, 500)
      };
    }

    let body = {};
    try {
      body = JSON.parse(text || '{}');
    } catch (parseErr) {
      return { ok: false, error: 'Official token endpoint returned invalid JSON.' };
    }

    if (!body.access_token) {
      return { ok: false, error: 'Official token endpoint returned no access_token.' };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err)
    };
  }
}

function enp_guardGetAlertEmail_() {
  const configured = PropertiesService.getScriptProperties()
    .getProperty(ENP_GUARD_R2.ALERT_EMAIL_PROPERTY);
  return String(configured || ENP_GUARD_R2.DEFAULT_ALERT_EMAIL).trim();
}

function enp_guardSendSystemAlert_(info) {
  const category = String(info && info.category ? info.category : 'SYSTEM');
  const subject = String(info && info.subject ? info.subject : 'ENTERNEWPART failure');
  const message = String(info && info.message ? info.message : 'Unknown Enternewpart failure.');

  const fingerprint = enp_guardHash_('SYSTEM|' + category + '|' + subject + '|' + message);
  if (!enp_guardClaimAlertFingerprint_(fingerprint, ENP_GUARD_R2.SYSTEM_ALERT_COOLDOWN_SECONDS)) {
    Logger.log('Suppressed duplicate Enternewpart system alert: ' + category);
    return false;
  }

  try {
    MailApp.sendEmail({
      to: enp_guardGetAlertEmail_(),
      subject: subject,
      body:
        message + '\n\n' +
        'Time: ' + new Date().toISOString() + '\n' +
        'Guard version: ' + ENP_GUARD_R2.VERSION
    });
    return true;
  } catch (mailErr) {
    Logger.log('ENTERNEWPART ALERT EMAIL FAILED: ' + mailErr);
    return false;
  }
}

function enp_guardScanAndEmailRecentFailures_() {
  const failures = enp_guardCollectRecentFailures_();
  const unsent = [];

  failures.forEach(function(f) {
    const fingerprint = enp_guardHash_(JSON.stringify(f));
    if (enp_guardClaimAlertFingerprint_(fingerprint, ENP_GUARD_R2.ROW_ALERT_COOLDOWN_SECONDS)) {
      unsent.push(f);
    }
  });

  if (!unsent.length) return 0;

  const selected = unsent.slice(0, ENP_GUARD_R2.MAX_FAILURES_PER_EMAIL);
  const lines = [];

  selected.forEach(function(f, i) {
    lines.push(
      (i + 1) + '. ' + f.sheet + ' row ' + f.row +
      (f.so ? ' | SO ' + f.so : '') +
      (f.item ? ' | Item ' + f.item : '') +
      '\n   ' + f.action +
      '\n   ' + f.error
    );
  });

  if (unsent.length > selected.length) {
    lines.push('\nAdditional new failures not listed: ' + (unsent.length - selected.length));
  }

  try {
    MailApp.sendEmail({
      to: enp_guardGetAlertEmail_(),
      subject: 'ENTERNEWPART failures detected (' + unsent.length + ')',
      body:
        'Recent Enternewpart failures were detected after the pipeline run.\n\n' +
        lines.join('\n\n') + '\n\n' +
        'Time: ' + new Date().toISOString() + '\n' +
        'Guard version: ' + ENP_GUARD_R2.VERSION
    });
  } catch (mailErr) {
    Logger.log('ENTERNEWPART ROW FAILURE EMAIL FAILED: ' + mailErr);
  }

  return unsent.length;
}

function enp_guardCollectRecentFailures_() {
  const ss = SpreadsheetApp.getActive();
  const nowMs = Date.now();
  const cutoffMs = nowMs - ENP_GUARD_R2.RECENT_FAILURE_WINDOW_HOURS * 60 * 60 * 1000;
  const out = [];

  ['Enternewpart', 'Enternewpart_Quoted'].forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return;

    const data = sh.getDataRange().getValues();
    const col = enp_guardHeaderMap_(data[0]);
    if (col.LastAction == null || col.LastError == null) return;

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const action = String(row[col.LastAction] || '').trim();
      const error = String(row[col.LastError] || '').trim();
      if (!error) continue;
      if (!/FAIL|ERROR|BLOCK/i.test(action) && !/FAIL|ERROR|TOKEN|AUTH|HTTP\s*[45]/i.test(error)) continue;

      if (col.LastUpdated != null && row[col.LastUpdated]) {
        const d = new Date(row[col.LastUpdated]);
        if (!isNaN(d.getTime()) && d.getTime() < cutoffMs) continue;
      }

      out.push({
        sheet: sheetName,
        row: r + 1,
        so: enp_guardCell_(row, col, ['SalesOrderNumber', 'SalesOrderSalesOrderId']),
        item: enp_guardCell_(row, col, ['NewItemNumber', 'ItemNumber']),
        action: action || 'FAILED',
        error: error.slice(0, 1200)
      });
    }
  });

  const hub = ss.getSheetByName('ActionHub');
  if (hub && hub.getLastRow() >= 2 && hub.getLastColumn() >= 1) {
    const data = hub.getDataRange().getValues();
    const col = enp_guardHeaderMap_(data[0]);

    if (col.LastError != null) {
      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        const state = col.State != null ? String(row[col.State] || '').trim() : '';
        const error = String(row[col.LastError] || '').trim();
        if (!error) continue;
        if (!/FAILED|ERROR/i.test(state) && !/FAIL|ERROR|TOKEN|AUTH|HTTP\s*[45]/i.test(error)) continue;

        if (col.LastRunAt != null && row[col.LastRunAt]) {
          const d = new Date(row[col.LastRunAt]);
          if (!isNaN(d.getTime()) && d.getTime() < cutoffMs) continue;
        }

        out.push({
          sheet: 'ActionHub',
          row: r + 1,
          so: enp_guardCell_(row, col, ['SONumber', 'SOId']),
          item: enp_guardCell_(row, col, ['ParsedItemNumber']),
          action: state || 'FAILED',
          error: error.slice(0, 1200)
        });
      }
    }
  }

  return out;
}

function enp_guardHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach(function(h, i) {
    const key = String(h == null ? '' : h).trim();
    if (key) map[key] = i;
  });
  return map;
}

function enp_guardCell_(row, col, names) {
  for (let i = 0; i < names.length; i++) {
    const idx = col[names[i]];
    if (idx != null) {
      const value = String(row[idx] == null ? '' : row[idx]).trim();
      if (value) return value;
    }
  }
  return '';
}

function enp_guardHash_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '').slice(0, 40);
}

function enp_guardClaimAlertFingerprint_(fingerprint, cooldownSeconds) {
  const props = PropertiesService.getScriptProperties();
  const key = 'ENP_GUARD_ALERT_' + String(fingerprint).slice(0, 40);
  const now = Date.now();
  const prior = Number(props.getProperty(key) || 0);
  const cooldownMs = Math.max(1, Number(cooldownSeconds || 1)) * 1000;

  if (prior && (now - prior) < cooldownMs) {
    return false;
  }

  props.setProperty(key, String(now));
  return true;
}
