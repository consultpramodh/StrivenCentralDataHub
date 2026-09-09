/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD ITEMS REPORT CONNECTION
 * R1.1b: accepts Striven API field names ItemId and ItemTaxable
 *
 * Replaces the completed R1 readiness test.
 * Read-only: does not write Striven data and does not populate DATA_ITEMS.
 */

function test_StdItemsReportConnection() {
  const started = new Date();
  const props = PropertiesService.getScriptProperties();

  const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
  const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
  const reportUrl = String(props.getProperty('STRIVEN_STD_ITEMS_REPORT_URL') || '').trim();

  const missingProperties = [];
  if (!clientId) missingProperties.push('CLIENT_ID');
  if (!clientSecret) missingProperties.push('CLIENT_SECRET');
  if (!reportUrl) missingProperties.push('STRIVEN_STD_ITEMS_REPORT_URL');

  if (missingProperties.length) {
    throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
  }

  if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
    throw new Error('STRIVEN_STD_ITEMS_REPORT_URL must be an https://api.striven.com URL.');
  }

  const ss = SpreadsheetApp.getActive();
  const dataItems = ss.getSheetByName('DATA_ITEMS');
  if (!dataItems) {
    throw new Error('Missing Hub sheet: DATA_ITEMS');
  }

  const token = hubTest_stdItemsAccessToken_(clientId, clientSecret);
  const sample = hubTest_stdItemsFetchPage_(reportUrl, token, 0, 2);
  const rows = hubTest_stdItemsExtractRows_(sample);

  if (!rows.length) {
    throw new Error('STD Items report returned zero sample rows; schema cannot be validated.');
  }

  if (typeof rows[0] !== 'object' || Array.isArray(rows[0])) {
    throw new Error('STD Items report did not return object rows.');
  }

  const expected = [
    'ItemNumber',
    'ItemId',
    'ItemName',
    'ItemCategory',
    'Cost',
    'Price',
    'MAPPricing',
    'ItemTaxable',
    'ItemType',
    'PreferredVendor',
    'Description',
    'Manufacturer',
    'LocationName',
    'ItemsSKU',
    'ItemsUPC'
  ];

  const actualKeys = Object.keys(rows[0]);
  const normalizedActual = {};
  actualKeys.forEach(k => normalizedActual[hubTest_stdItemsNormalizeField_(k)] = k);

  const missing = expected.filter(
    k => !Object.prototype.hasOwnProperty.call(
      normalizedActual,
      hubTest_stdItemsNormalizeField_(k)
    )
  );

  const expectedNorm = {};
  expected.forEach(k => expectedNorm[hubTest_stdItemsNormalizeField_(k)] = true);

  const unexpected = actualKeys.filter(
    k => !expectedNorm[hubTest_stdItemsNormalizeField_(k)]
  );

  const duplicateNormalized = actualKeys.filter((k, i, arr) => {
    const n = hubTest_stdItemsNormalizeField_(k);
    return arr.findIndex(x => hubTest_stdItemsNormalizeField_(x) === n) !== i;
  });

  if (missing.length || unexpected.length || duplicateNormalized.length || actualKeys.length !== 15) {
    const detail = {
      status: 'FAIL_SCHEMA',
      expectedFieldCount: 15,
      actualFieldCount: actualKeys.length,
      expectedFields: expected,
      actualFields: actualKeys,
      missingFields: missing,
      unexpectedFields: unexpected,
      duplicateNormalizedFields: duplicateNormalized
    };
    Logger.log(JSON.stringify(detail, null, 2));
    throw new Error(
      'STD Items report schema mismatch. See execution log. ' +
      'Missing=' + missing.join('|') +
      '; Unexpected=' + unexpected.join('|') +
      '; ActualCount=' + actualKeys.length
    );
  }

  const result = {
    status: 'PASS',
    test: 'test_StdItemsReportConnection',
    reportConfigured: true,
    reportHost: 'api.striven.com',
    oauth: 'PASS',
    sampleRows: rows.length,
    expectedFieldCount: 15,
    actualFieldCount: actualKeys.length,
    actualFields: actualKeys,
    canonicalFieldMap: { ItemId: 'Id', ItemTaxable: 'Taxable' },
    dataItemsSheet: 'PRESENT',
    writesPerformed: false,
    elapsedMs: new Date().getTime() - started.getTime(),
    nextStep: 'Add production hub_refreshStdItems only after this test passes.'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function hubTest_stdItemsAccessToken_(clientId, clientSecret) {
  const basic = Utilities.base64Encode(clientId + ':' + clientSecret);

  const response = UrlFetchApp.fetch('https://api.striven.com/accesstoken', {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + basic,
      Accept: 'application/json'
    },
    payload: {
      grant_type: 'client_credentials',
      ClientId: clientId
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Striven OAuth failed HTTP ' + code + ': ' +
      hubTest_stdItemsSafeText_(text, 500)
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Striven OAuth returned non-JSON content.');
  }

  if (!parsed || !parsed.access_token) {
    throw new Error('Striven OAuth response did not contain access_token.');
  }

  return String(parsed.access_token);
}

function hubTest_stdItemsFetchPage_(reportUrl, token, pageIndex, pageSize) {
  const url = hubTest_stdItemsPagedUrl_(reportUrl, pageIndex, pageSize);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      'STD Items report fetch failed HTTP ' + code + ': ' +
      hubTest_stdItemsSafeText_(text, 500)
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('STD Items report returned non-JSON content.');
  }
}

function hubTest_stdItemsPagedUrl_(reportUrl, pageIndex, pageSize) {
  let url = String(reportUrl || '').trim();

  url = url
    .replace(/([?&])pageIndex=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/([?&])pageSize=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/[?&]$/, '');

  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return url +
    separator + 'pageIndex=' + encodeURIComponent(pageIndex) +
    '&pageSize=' + encodeURIComponent(pageSize);
}

function hubTest_stdItemsExtractRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data,
    payload.Data,
    payload.results,
    payload.Results,
    payload.items,
    payload.Items,
    payload.rows,
    payload.Rows,
    payload.records,
    payload.Records
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }

  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i++) {
    const value = payload[keys[i]];
    if (Array.isArray(value) && value.length &&
        typeof value[0] === 'object' && !Array.isArray(value[0])) {
      return value;
    }
  }

  return [];
}

function hubTest_stdItemsNormalizeField_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function hubTest_stdItemsSafeText_(value, maxLen) {
  let s = String(value == null ? '' : value);

  s = s.replace(
    /(authorization\s*[:=]\s*['"]?\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+\/=-]+/ig,
    '$1[REDACTED]'
  );
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');
  s = s.replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig, '$1[REDACTED]');

  return s.length <= maxLen ? s : s.substring(0, maxLen) + '...';
}
