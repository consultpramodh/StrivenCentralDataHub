/**
 * ============================================================
 * STRIVEN PLUS - PRIVATE MASTER CONTROL PLANE
 * COMPLETE REPLACEMENT
 * ============================================================
 *
 * CLIENT GOOGLE SHEETS: NONE
 * CLIENT SHEET SHARING: NONE
 * CLIENT APPS SCRIPT: NONE
 *
 * ONE-TIME:
 *   setupMaster()
 *
 * NORMAL:
 *   runMaster()
 *
 * Script Property required:
 *   BACKEND_URL
 *
 * Example:
 *   https://your-backend.example.com
 *
 * Optional:
 *   BACKEND_ADMIN_KEY
 *
 * ============================================================
 */

const SP = Object.freeze({
  VERSION: 'MASTER-2.0',

  SHEETS: {
    TENANTS: 'Tenants',
    ACTIVITY: 'Activity Log',
    SYSTEM: 'System'
  },

  PROPS: {
    BACKEND_URL: 'BACKEND_URL',
    ADMIN_KEY: 'BACKEND_ADMIN_KEY'
  },

  ENDPOINTS: {
    HEALTH: '/health',
    TENANTS: '/admin/tenants',
    ACTIVITY: '/admin/activity'
  },

  POLL_MINUTES: 5,
  REQUEST_TIMEOUT_MS: 30000
});


/* ============================================================
 * ONE-TIME SETUP
 * ============================================================
 */

function setupMaster() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = getMaster_();

    const tenants = getOrCreateSheet_(ss, SP.SHEETS.TENANTS);
    const activity = getOrCreateSheet_(ss, SP.SHEETS.ACTIVITY);
    const system = getOrCreateSheet_(ss, SP.SHEETS.SYSTEM);

    buildTenantsSheet_(tenants);
    buildActivitySheet_(activity);
    buildSystemSheet_(system);

    const backendUrl = getBackendUrl_(false);

    setSystemValue_(system, 'Master Status', 'READY');
    setSystemValue_(system, 'Scheduler', 'MANUAL FOR NOW');
    setSystemValue_(system, 'Version', SP.VERSION);
    setSystemValue_(system, 'Last Error', '');

    setSystemValue_(
      system,
      'Backend',
      backendUrl || 'BACKEND_URL NOT CONFIGURED'
    );

    log_(
      ss,
      'SYSTEM',
      '',
      'MASTER SETUP',
      'SUCCESS',
      'Master control plane initialized.'
    );

    SpreadsheetApp.flush();

    console.log('STRIVEN PLUS MASTER READY');
    console.log('Backend: ' + (backendUrl || 'NOT CONFIGURED'));

  } finally {
    lock.releaseLock();
  }
}


/* ============================================================
 * MAIN MASTER RUN
 * ============================================================
 */

function runMaster() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    return;
  }

  const started = new Date();

  try {
    const ss = getMaster_();
    const system = requireSheet_(ss, SP.SHEETS.SYSTEM);

    setSystemValue_(system, 'Master Status', 'RUNNING');
    setSystemValue_(system, 'Last Run', started);
    setSystemValue_(system, 'Last Error', '');

    const health = backendRequest_(
      SP.ENDPOINTS.HEALTH,
      'get',
      null
    );

    if (!health.ok) {
      throw new Error(
        'Backend health check failed. HTTP ' +
        health.status +
        ': ' +
        safeJson_(health.data)
      );
    }

    setSystemValue_(system, 'Backend Status', 'ONLINE');

    syncTenants_();
    syncActivity_();

    setSystemValue_(system, 'Master Status', 'READY');
    setSystemValue_(system, 'Last Successful Run', new Date());

    SpreadsheetApp.flush();

  } catch (error) {
    const ss = getMaster_();
    const system = ss.getSheetByName(SP.SHEETS.SYSTEM);

    if (system) {
      setSystemValue_(system, 'Master Status', 'ERROR');
      setSystemValue_(system, 'Backend Status', 'ERROR');
      setSystemValue_(system, 'Last Error', error.message);
    }

    log_(
      ss,
      'SYSTEM',
      '',
      'MASTER RUN',
      'ERROR',
      error.message
    );

    throw error;

  } finally {
    lock.releaseLock();
  }
}


/* ============================================================
 * TENANT SYNC
 * ============================================================
 */

function syncTenants_() {
  const ss = getMaster_();
  const sheet = requireSheet_(ss, SP.SHEETS.TENANTS);

  const response = backendRequest_(
    SP.ENDPOINTS.TENANTS,
    'get',
    null
  );

  requireBackendOk_(response, 'Tenant sync');

  const tenants = extractArray_(response.data);

  const rows = tenants.map(function (tenant) {
    return [
      value_(tenant.installationId, tenant.installation_id, tenant.id, ''),
      value_(tenant.clientName, tenant.client_name, tenant.name, ''),
      value_(tenant.companyName, tenant.company_name, tenant.company, ''),
      value_(tenant.connectionStatus, tenant.connection_status, tenant.connection, ''),
      value_(tenant.discoveryStatus, tenant.discovery_status, tenant.discovery, ''),
      value_(tenant.reorderStatus, tenant.reorder_status, tenant.reorderEngine, ''),
      value_(tenant.lastActivity, tenant.last_activity, ''),
      value_(tenant.createdAt, tenant.created_at, ''),
      value_(tenant.updatedAt, tenant.updated_at, ''),
      value_(tenant.lastError, tenant.last_error, '')
    ];
  });

  clearBody_(sheet, 10);

  if (rows.length) {
    sheet
      .getRange(2, 1, rows.length, 10)
      .setValues(rows);
  }

  const system = requireSheet_(ss, SP.SHEETS.SYSTEM);

  setSystemValue_(system, 'Registered Tenants', tenants.length);

  const connected = tenants.filter(function (tenant) {
    return String(
      value_(
        tenant.connectionStatus,
        tenant.connection_status,
        tenant.connection,
        ''
      )
    ).toUpperCase() === 'CONNECTED';
  }).length;

  const ready = tenants.filter(function (tenant) {
    return String(
      value_(
        tenant.reorderStatus,
        tenant.reorder_status,
        tenant.reorderEngine,
        ''
      )
    ).toUpperCase() === 'READY';
  }).length;

  setSystemValue_(system, 'Connected Tenants', connected);
  setSystemValue_(system, 'Ready Tenants', ready);
}


/* ============================================================
 * ACTIVITY SYNC
 * ============================================================
 */

function syncActivity_() {
  const ss = getMaster_();
  const sheet = requireSheet_(ss, SP.SHEETS.ACTIVITY);

  const response = backendRequest_(
    SP.ENDPOINTS.ACTIVITY + '?limit=250',
    'get',
    null
  );

  requireBackendOk_(response, 'Activity sync');

  const activity = extractArray_(response.data);

  const rows = activity.map(function (event) {
    return [
      value_(event.timestamp, event.createdAt, event.created_at, ''),
      value_(event.installationId, event.installation_id, ''),
      value_(event.clientName, event.client_name, ''),
      value_(event.action, ''),
      value_(event.result, event.status, ''),
      value_(event.details, event.message, '')
    ];
  });

  clearBody_(sheet, 6);

  if (rows.length) {
    sheet
      .getRange(2, 1, rows.length, 6)
      .setValues(rows);
  }
}


/* ============================================================
 * BACKEND REQUEST
 * ============================================================
 */

function backendRequest_(path, method, body) {
  const baseUrl = getBackendUrl_(true);
  const adminKey = getAdminKey_();

  const headers = {
    Accept: 'application/json'
  };

  if (adminKey) {
    headers.Authorization = 'Bearer ' + adminKey;
  }

  const options = {
    method: String(method || 'get').toLowerCase(),
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true
  };

  if (body !== null && body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(
    normalizeUrl_(baseUrl) + path,
    options
  );

  const status = response.getResponseCode();
  const text = response.getContentText();

  let data = text;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      // Leave non-JSON response as text.
    }
  }

  return {
    ok: status >= 200 && status < 300,
    status: status,
    data: data
  };
}


/* ============================================================
 * BACKEND CONFIG
 * ============================================================
 */

function getBackendUrl_(required) {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty(SP.PROPS.BACKEND_URL);

  const url = String(value || '').trim();

  if (required && !url) {
    throw new Error(
      'BACKEND_URL is not configured in Script Properties.'
    );
  }

  return url;
}


function getAdminKey_() {
  return String(
    PropertiesService
      .getScriptProperties()
      .getProperty(SP.PROPS.ADMIN_KEY) || ''
  ).trim();
}


function normalizeUrl_(url) {
  return String(url || '').replace(/\/+$/, '');
}


/* ============================================================
 * BACKEND RESPONSE VALIDATION
 * ============================================================
 */

function requireBackendOk_(response, action) {
  if (response && response.ok) {
    return;
  }

  throw new Error(
    action +
    ' failed. HTTP ' +
    (response ? response.status : 'UNKNOWN') +
    ': ' +
    safeJson_(response ? response.data : null)
  );
}


/* ============================================================
 * MASTER WORKBOOK
 * ============================================================
 */

function getMaster_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'This Apps Script project must be attached to the private Master Sheet.'
    );
  }

  return ss;
}


function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  return sheet;
}


function requireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);

  if (!sheet) {
    throw new Error(
      'Missing "' + name + '" sheet. Run setupMaster().'
    );
  }

  return sheet;
}


/* ============================================================
 * BUILD MASTER SHEETS
 * ============================================================
 */

function buildTenantsSheet_(sheet) {
  sheet.clear();

  sheet
    .getRange(1, 1, 1, 10)
    .setValues([[
      'Installation ID',
      'Client',
      'Company',
      'Connection',
      'Discovery',
      'Reorder Engine',
      'Last Activity',
      'Created',
      'Updated',
      'Last Error'
    ]]);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 10);
}


function buildActivitySheet_(sheet) {
  sheet.clear();

  sheet
    .getRange(1, 1, 1, 6)
    .setValues([[
      'Timestamp',
      'Installation ID',
      'Client',
      'Action',
      'Result',
      'Details'
    ]]);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 6);
}


function buildSystemSheet_(sheet) {
  sheet.clear();

  const rows = [
    ['STRIVEN PLUS MASTER', SP.VERSION],
    ['Master Status', 'SETTING UP'],
    ['Backend', ''],
    ['Backend Status', 'NOT CHECKED'],
    ['Scheduler', ''],
    ['Last Run', ''],
    ['Last Successful Run', ''],
    ['Registered Tenants', 0],
    ['Connected Tenants', 0],
    ['Ready Tenants', 0],
    ['Last Error', ''],
    ['Version', SP.VERSION]
  ];

  sheet
    .getRange(1, 1, rows.length, 2)
    .setValues(rows);

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
}


/* ============================================================
 * SYSTEM VALUES
 * ============================================================
 */

function setSystemValue_(sheet, label, value) {
  const lastRow = Math.max(sheet.getLastRow(), 1);

  const labels = sheet
    .getRange(1, 1, lastRow, 1)
    .getDisplayValues();

  for (let i = 0; i < labels.length; i++) {
    if (String(labels[i][0]).trim() === label) {
      sheet
        .getRange(i + 1, 2)
        .setValue(value);

      return;
    }
  }

  sheet.appendRow([label, value]);
}


/* ============================================================
 * LOCAL MASTER LOG
 * ============================================================
 */

function log_(ss, installationId, client, action, result, details) {
  const sheet = ss.getSheetByName(SP.SHEETS.ACTIVITY);

  if (!sheet) {
    return;
  }

  sheet.appendRow([
    new Date(),
    installationId || '',
    client || '',
    action || '',
    result || '',
    details || ''
  ]);
}





/* ============================================================
 * SHEET BODY
 * ============================================================
 */

function clearBody_(sheet, columns) {
  const maxRows = sheet.getMaxRows();

  if (maxRows > 1) {
    sheet
      .getRange(2, 1, maxRows - 1, columns)
      .clearContent();
  }
}


/* ============================================================
 * RESPONSE HELPERS
 * ============================================================
 */

function extractArray_(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== 'object') {
    return [];
  }

  const candidates = [
    data.data,
    data.Data,
    data.items,
    data.Items,
    data.results,
    data.Results,
    data.tenants,
    data.activity
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) {
      return candidates[i];
    }
  }

  return [];
}


function value_() {
  for (let i = 0; i < arguments.length; i++) {
    const value = arguments[i];

    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      return value;
    }
  }

  return '';
}


function safeJson_(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}