/* === HUB_STD_LOCATIONS_R1_6_BEGIN ===
 * STD - Customer Locations - Central Hub
 * Production full refresh.
 *
 * SAFETY:
 * - READS Striven custom report only.
 * - WRITES only this Hub's DATA_LOCATIONS plus Hub logs/control.
 * - Does not modify registered source projects.
 * - Does not POST/PATCH/PUT/DELETE to Striven.
 *
 * BUSINESS RULES CONFIRMED:
 * - Customer Status = Active in the Striven report filter.
 * - Location Active = Yes in the Striven report filter.
 * - Address State = Ontario in the Striven report filter.
 * - Location Full Address is set in the Striven report filter.
 * - Customer ID = Customer Number in this tenant.
 */

function hub_refreshStdLocations() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('STD Locations refresh is already running.');
  }

  const startedMs = Date.now();
  const runId = 'STD_LOCATIONS_' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'America/Toronto',
    'yyyyMMdd_HHmmss'
  );

  let pageCalls = 0;
  let rowsFetched = 0;

  try {
    hub_initializeOrRepair();

    const props = PropertiesService.getScriptProperties();
    const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
    const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
    const reportUrl = String(props.getProperty('STRIVEN_STD_LOCATIONS_REPORT_URL') || '').trim();

    const missingProperties = [];
    if (!clientId) missingProperties.push('CLIENT_ID');
    if (!clientSecret) missingProperties.push('CLIENT_SECRET');
    if (!reportUrl) missingProperties.push('STRIVEN_STD_LOCATIONS_REPORT_URL');

    if (missingProperties.length) {
      throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
    }

    if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
      throw new Error('STRIVEN_STD_LOCATIONS_REPORT_URL must use https://api.striven.com/.');
    }

    const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
    const fetched = hub_fetchStdLocationsAllPages_(
      reportUrl,
      tokenInfo.accessToken,
      500
    );

    pageCalls = fetched.pageCalls;
    rowsFetched = fetched.rows.length;

    if (!fetched.rows.length) {
      throw new Error(
        'STD Locations report returned zero rows. DATA_LOCATIONS was not replaced.'
      );
    }

    const schema = hub_stdLocationsSchema_();
    const audit = hub_auditStdLocationsSchema_(fetched.actualFields, schema);

    if (
      audit.missingCanonicalFields.length ||
      audit.ambiguousCanonicalFields.length ||
      audit.unexpectedSourceFields.length ||
      fetched.actualFields.length !== schema.length
    ) {
      throw new Error(
        'STD Locations schema validation failed. ' +
        JSON.stringify({
          expectedCanonicalFieldCount: schema.length,
          actualFieldCount: fetched.actualFields.length,
          actualFields: fetched.actualFields,
          missingCanonicalFields: audit.missingCanonicalFields,
          ambiguousCanonicalFields: audit.ambiguousCanonicalFields,
          unexpectedSourceFields: audit.unexpectedSourceFields
        })
      );
    }

    const preferredHeaders = hub_stdLocationsSourceHeaders_();
    const nonPreferredDisplayNames = fetched.actualFields.filter(function(field) {
      return preferredHeaders.indexOf(field) < 0;
    });

    if (nonPreferredDisplayNames.length) {
      throw new Error(
        'STD Locations report is not using standardized Display Names: ' +
        nonPreferredDisplayNames.join(', ')
      );
    }

    const seenLocationIds = {};
    const seenCustomerLocationKeys = {};

    let missingCustomerIds = 0;
    let missingLocationIds = 0;
    let missingLocationAddressIds = 0;
    let duplicateLocationIds = 0;
    let duplicateCustomerLocationKeys = 0;

    const records = fetched.rows.map(function(source) {
      const record = hub_buildStdLocationRecord_(
        source,
        audit.canonicalToSource
      );

      if (!record.CustomerId) missingCustomerIds++;
      if (!record.LocationId) missingLocationIds++;
      if (!record.LocationAddressId) missingLocationAddressIds++;

      if (record.LocationId) {
        if (seenLocationIds[record.LocationId]) duplicateLocationIds++;
        else seenLocationIds[record.LocationId] = true;
      }

      if (record.CustomerLocationKey) {
        if (seenCustomerLocationKeys[record.CustomerLocationKey]) {
          duplicateCustomerLocationKeys++;
        } else {
          seenCustomerLocationKeys[record.CustomerLocationKey] = true;
        }
      }

      return record;
    });

    if (
      missingCustomerIds ||
      missingLocationIds ||
      missingLocationAddressIds
    ) {
      throw new Error(
        'STD Locations contains required-ID gaps. ' +
        JSON.stringify({
          missingCustomerIds: missingCustomerIds,
          missingLocationIds: missingLocationIds,
          missingLocationAddressIds: missingLocationAddressIds
        })
      );
    }

    if (duplicateLocationIds || duplicateCustomerLocationKeys) {
      throw new Error(
        'STD Locations contains duplicate identity keys. ' +
        JSON.stringify({
          duplicateLocationIds: duplicateLocationIds,
          duplicateCustomerLocationKeys: duplicateCustomerLocationKeys
        })
      );
    }

    const headers = hub_stdLocationsHeaders_();
    const values = records.map(function(record) {
      return headers.map(function(header) {
        return record[header] == null ? '' : record[header];
      });
    });

    const sh = SpreadsheetApp.getActive().getSheetByName('DATA_LOCATIONS');
    if (!sh) throw new Error('DATA_LOCATIONS sheet is missing.');

    // Full remote fetch + schema + identity validation has completed.
    // Only now is the existing Hub dataset replaced.
    hub_writeCanonicalDataset_(sh, headers, values);
    SpreadsheetApp.flush();

    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;
    const apiCalls = pageCalls + (tokenInfo.requestedNewToken ? 1 : 0);

    hub_updateRefreshControl_(
      'LOCATIONS',
      true,
      records.length,
      apiCalls,
      durationSec,
      'SUCCESS',
      ''
    );

    hub_apiUsage_(
      runId,
      'LOCATIONS',
      'STRIVEN_STD_LOCATIONS_REPORT_URL',
      'GET',
      apiCalls,
      records.length,
      durationSec,
      'SUCCESS',
      '',
      'hub_refreshStdLocations'
    );

    const result = {
      status: 'PASS',
      dataset: 'LOCATIONS',
      targetSheet: 'DATA_LOCATIONS',
      rows: records.length,
      sourceCanonicalFieldCount: schema.length,
      outputColumnCount: headers.length,
      reportPageCalls: pageCalls,
      pageSize: fetched.pageSize,
      tokenRequestMade: tokenInfo.requestedNewToken,
      totalApiCallsThisRun: apiCalls,
      sourceToCanonical: audit.sourceToCanonical,
      canonicalToSource: audit.canonicalToSource,
      duplicateLocationIds: duplicateLocationIds,
      duplicateCustomerLocationKeys: duplicateCustomerLocationKeys,
      missingCustomerIds: missingCustomerIds,
      missingLocationIds: missingLocationIds,
      missingLocationAddressIds: missingLocationAddressIds,
      derivedFields: [
        'CustomerNumber',
        'CustomerStatus',
        'LocationIsActive',
        'LocationProvince',
        'NormalizedLocationPhone',
        'NormalizedLocationAddress',
        'NormalizedLocationPostalCode',
        'LocationKey',
        'CustomerLocationKey'
      ],
      filterExpectation: [
        'Customer Status = Active',
        'Location Full Address is set',
        'Address State = Ontario',
        'Location Active = Yes'
      ],
      strivenWritesPerformed: false,
      sourceProjectsModified: false,
      durationSec: durationSec
    };

    hub_log_(
      'INFO',
      'STD_LOCATIONS_REFRESH',
      'LOCATIONS',
      'Standard Locations refresh completed.',
      JSON.stringify(result)
    );

    Logger.log(JSON.stringify(result, null, 2));
    return result;

  } catch (err) {
    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;
    const safeError = hub_limit_(String(err && err.message || err), 1000);

    try {
      hub_updateRefreshControl_(
        'LOCATIONS',
        false,
        rowsFetched,
        pageCalls,
        durationSec,
        'FAILED',
        safeError
      );

      hub_apiUsage_(
        runId,
        'LOCATIONS',
        'STRIVEN_STD_LOCATIONS_REPORT_URL',
        'GET',
        pageCalls,
        rowsFetched,
        durationSec,
        'FAILED',
        safeError,
        'hub_refreshStdLocations'
      );

      hub_log_(
        'ERROR',
        'STD_LOCATIONS_REFRESH',
        'LOCATIONS',
        'Standard Locations refresh failed; previous DATA_LOCATIONS retained.',
        safeError
      );
    } catch (loggingErr) {
      // Preserve original exception.
    }

    throw err;

  } finally {
    lock.releaseLock();
  }
}

function hub_stdLocationsSchema_() {
  return [
    {
      canonical: 'LocationDateCreated',
      aliases: [
        'LocationDateCreated', 'Location Date Created',
        'CreatedOn', 'Created On', 'DateCreated', 'Date Created'
      ]
    },
    {
      canonical: 'CustomerId',
      aliases: [
        'CustomerId', 'CustomerID', 'Customer Id', 'Customer ID',
        'CustomerNumber', 'Customer Number'
      ]
    },
    {
      canonical: 'CustomerName',
      aliases: [
        'CustomerName', 'Customer Name'
      ]
    },
    {
      canonical: 'LocationId',
      aliases: [
        'LocationId', 'LocationID', 'Location Id', 'Location ID'
      ]
    },
    {
      canonical: 'LocationName',
      aliases: [
        'LocationName', 'Location Name', 'Name'
      ]
    },
    {
      canonical: 'LocationPrimaryPhone',
      aliases: [
        'LocationPrimaryPhone', 'Location Primary Phone',
        'PrimaryPhone', 'Primary Phone'
      ]
    },
    {
      canonical: 'LocationFullAddress',
      aliases: [
        'LocationFullAddress', 'Location Full Address',
        'AddressFullAddress', 'Address Full Address',
        'FullAddress', 'Full Address'
      ]
    },
    {
      canonical: 'LocationPostalCode',
      aliases: [
        'LocationPostalCode', 'Location Postal Code',
        'AddressZip', 'Address Zip', 'Zip',
        'PostalCode', 'Postal Code'
      ]
    },
    {
      canonical: 'LocationAddressId',
      aliases: [
        'LocationAddressId', 'Location Address Id', 'Location Address ID',
        'AddressId', 'AddressID', 'Address Id', 'Address ID'
      ]
    },
    {
      canonical: 'LocationIsPrimary',
      aliases: [
        'LocationIsPrimary', 'Location Is Primary',
        'IsPrimaryLocation', 'Is Primary Location', 'Primary'
      ]
    },
    {
      canonical: 'LocationIsDefaultShipTo',
      aliases: [
        'LocationIsDefaultShipTo', 'Location Is Default Ship To',
        'IsDefaultShipTo', 'Is Default Ship To',
        'DefaultShipTo', 'Default Ship To'
      ]
    },
    {
      canonical: 'LocationIsDefaultBillTo',
      aliases: [
        'LocationIsDefaultBillTo', 'Location Is Default Bill To',
        'IsDefaultBillTo', 'Is Default Bill To',
        'DefaultBillTo', 'Default Bill To'
      ]
    },
    {
      canonical: 'LocationDateLastModified',
      aliases: [
        'LocationDateLastModified', 'Location Date Last Modified',
        'DateLastModified', 'Date Last Modified',
        'LastModified', 'Last Modified'
      ]
    }
  ];
}

function hub_stdLocationsSourceHeaders_() {
  return [
    'LocationDateCreated',
    'CustomerId',
    'CustomerName',
    'LocationId',
    'LocationName',
    'LocationPrimaryPhone',
    'LocationFullAddress',
    'LocationPostalCode',
    'LocationAddressId',
    'LocationIsPrimary',
    'LocationIsDefaultShipTo',
    'LocationIsDefaultBillTo',
    'LocationDateLastModified'
  ];
}

function hub_stdLocationsHeaders_() {
  return [
    'LocationDateCreated',
    'LocationDateLastModified',

    'CustomerId',
    'CustomerNumber',
    'CustomerName',
    'CustomerStatus',

    'LocationId',
    'LocationKey',
    'CustomerLocationKey',
    'LocationName',

    'LocationAddressId',
    'LocationFullAddress',
    'LocationProvince',
    'LocationPostalCode',
    'NormalizedLocationPostalCode',
    'NormalizedLocationAddress',

    'LocationPrimaryPhone',
    'NormalizedLocationPhone',

    'LocationIsPrimary',
    'LocationIsDefaultShipTo',
    'LocationIsDefaultBillTo',
    'LocationIsActive'
  ];
}

function hub_fetchStdLocationsAllPages_(reportUrl, accessToken, pageSize) {
  const rows = [];
  const fieldSet = {};
  const maxPages = 500;
  let pageCalls = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const pageUrl = hub_reportPagedUrl_(reportUrl, pageIndex, pageSize);

    const response = UrlFetchApp.fetch(pageUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    });

    pageCalls++;

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code === 401) {
      PropertiesService.getScriptProperties()
        .deleteProperty('HUB_STRIVEN_ACCESS_TOKEN');
      PropertiesService.getScriptProperties()
        .deleteProperty('HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
    }

    if (code < 200 || code >= 300) {
      throw new Error(
        'STD Locations report page ' + pageIndex +
        ' failed HTTP ' + code + ': ' +
        hub_safeExternalText_(text, 500)
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(
        'STD Locations page ' + pageIndex + ' returned non-JSON content.'
      );
    }

    const pageRows = hub_stdLocationsExtractRows_(payload);

    pageRows.forEach(function(row) {
      Object.keys(row || {}).forEach(function(key) {
        fieldSet[key] = true;
      });
      rows.push(row);
    });

    if (pageRows.length < pageSize) {
      return {
        rows: rows,
        actualFields: Object.keys(fieldSet),
        pageCalls: pageCalls,
        pageSize: pageSize,
        stopReason: 'SHORT_PAGE'
      };
    }
  }

  throw new Error(
    'STD Locations reached maxPages=' + maxPages +
    ' without a short final page. Refusing to replace DATA_LOCATIONS.'
  );
}

function hub_stdLocationsExtractRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data, payload.Data,
    payload.results, payload.Results,
    payload.items, payload.Items,
    payload.rows, payload.Rows,
    payload.records, payload.Records
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }

  const keys = Object.keys(payload);

  for (let i = 0; i < keys.length; i++) {
    const value = payload[keys[i]];

    if (
      Array.isArray(value) &&
      value.length &&
      typeof value[0] === 'object' &&
      !Array.isArray(value[0])
    ) {
      return value;
    }
  }

  return [];
}

function hub_auditStdLocationsSchema_(actualFields, schema) {
  const normToRaw = {};

  actualFields.forEach(function(raw) {
    const norm = hub_stdLocationsNormalizeFieldName_(raw);
    if (!normToRaw[norm]) normToRaw[norm] = [];
    normToRaw[norm].push(raw);
  });

  const canonicalToSource = {};
  const sourceToCanonical = {};
  const missing = [];
  const ambiguous = [];
  const acceptedNorms = {};

  schema.forEach(function(def) {
    const canonicalNorm = hub_stdLocationsNormalizeFieldName_(def.canonical);
    const aliases = (def.aliases || []).slice();

    // Mandatory Central Hub alias standard.
    if (!aliases.some(function(alias) {
      return hub_stdLocationsNormalizeFieldName_(alias) === canonicalNorm;
    })) {
      throw new Error(
        'STD Locations alias contract invalid: canonical missing from alias set for ' +
        def.canonical
      );
    }

    const matches = [];

    aliases.forEach(function(alias) {
      const norm = hub_stdLocationsNormalizeFieldName_(alias);
      acceptedNorms[norm] = true;

      (normToRaw[norm] || []).forEach(function(raw) {
        if (matches.indexOf(raw) < 0) matches.push(raw);
      });
    });

    if (matches.length === 0) {
      missing.push(def.canonical);
      return;
    }

    if (matches.length > 1) {
      ambiguous.push({
        canonical: def.canonical,
        sourceFields: matches
      });
      return;
    }

    canonicalToSource[def.canonical] = matches[0];
    sourceToCanonical[matches[0]] = def.canonical;
  });

  const unexpected = actualFields.filter(function(raw) {
    return !acceptedNorms[hub_stdLocationsNormalizeFieldName_(raw)];
  });

  return {
    canonicalToSource: canonicalToSource,
    sourceToCanonical: sourceToCanonical,
    missingCanonicalFields: missing,
    ambiguousCanonicalFields: ambiguous,
    unexpectedSourceFields: unexpected
  };
}

function hub_buildStdLocationRecord_(source, canonicalToSource) {
  function src(canonical) {
    const key = canonicalToSource[canonical];
    return key ? source[key] : '';
  }

  const customerId = hub_stdLocationsClean_(src('CustomerId'));
  const locationId = hub_stdLocationsClean_(src('LocationId'));
  const addressId = hub_stdLocationsClean_(src('LocationAddressId'));
  const phone = hub_stdLocationsClean_(src('LocationPrimaryPhone'));
  const fullAddress = hub_stdLocationsClean_(src('LocationFullAddress'));
  const postal = hub_stdLocationsClean_(src('LocationPostalCode'));

  return {
    LocationDateCreated: src('LocationDateCreated'),
    LocationDateLastModified: src('LocationDateLastModified'),

    CustomerId: customerId,
    CustomerNumber: customerId,
    CustomerName: hub_stdLocationsClean_(src('CustomerName')),
    CustomerStatus: 'Active',

    LocationId: locationId,
    LocationKey: locationId,
    CustomerLocationKey:
      customerId && locationId ? customerId + '|' + locationId : '',
    LocationName: hub_stdLocationsClean_(src('LocationName')),

    LocationAddressId: addressId,
    LocationFullAddress: fullAddress,
    LocationProvince: 'Ontario',
    LocationPostalCode: postal,
    NormalizedLocationPostalCode: hub_stdLocationsNormalizePostal_(postal),
    NormalizedLocationAddress: hub_stdLocationsNormalizeAddress_(fullAddress),

    LocationPrimaryPhone: phone,
    NormalizedLocationPhone: hub_stdLocationsNormalizePhone_(phone),

    LocationIsPrimary: hub_stdLocationsBoolean_(src('LocationIsPrimary')),
    LocationIsDefaultShipTo:
      hub_stdLocationsBoolean_(src('LocationIsDefaultShipTo')),
    LocationIsDefaultBillTo:
      hub_stdLocationsBoolean_(src('LocationIsDefaultBillTo')),
    LocationIsActive: true
  };
}

function hub_stdLocationsNormalizeFieldName_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function hub_stdLocationsClean_(value) {
  return String(value == null ? '' : value).trim();
}

function hub_stdLocationsNormalizePhone_(value) {
  const raw = hub_stdLocationsClean_(value);
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.substring(1);
  }

  return digits;
}

function hub_stdLocationsNormalizePostal_(value) {
  return hub_stdLocationsClean_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function hub_stdLocationsNormalizeAddress_(value) {
  return hub_stdLocationsClean_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hub_stdLocationsBoolean_(value) {
  if (value === true || value === false) return value;

  const s = hub_stdLocationsClean_(value).toLowerCase();

  if (['true', 'yes', 'y', '1'].indexOf(s) >= 0) return true;
  if (['false', 'no', 'n', '0', ''].indexOf(s) >= 0) return false;

  throw new Error('Unrecognized Location boolean value: ' + String(value));
}

/* === HUB_STD_LOCATIONS_R1_6_END === */
