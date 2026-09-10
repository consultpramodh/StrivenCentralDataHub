/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD LOCATIONS FULL REFRESH
 * R1.6
 *
 * Writes DATA_LOCATIONS in the Central Hub only.
 * Does not write to Striven and does not modify source projects.
 */

function test_StdLocationsRefreshAndVerify() {
  const result = hub_refreshStdLocations();

  if (!result || result.status !== 'PASS') {
    throw new Error('hub_refreshStdLocations did not return PASS.');
  }

  if (!result.rows || result.rows < 1) {
    throw new Error('STD Locations refresh returned no rows.');
  }

  if (result.strivenWritesPerformed !== false) {
    throw new Error('Safety assertion failed: Striven writes must be false.');
  }

  if (result.sourceProjectsModified !== false) {
    throw new Error(
      'Safety assertion failed: source-project modifications must be false.'
    );
  }

  const schema = hub_stdLocationsSchema_();

  if (schema.length !== 13) {
    throw new Error(
      'STD Locations source schema must contain exactly 13 canonical fields.'
    );
  }

  const aliasFailures = schema.filter(function(def) {
    const canonicalNorm = String(def.canonical || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toLowerCase();

    return !(def.aliases || []).some(function(alias) {
      return String(alias || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .toLowerCase() === canonicalNorm;
    });
  }).map(function(def) {
    return def.canonical;
  });

  if (aliasFailures.length) {
    throw new Error(
      'Alias standard failure. Canonical missing from alias set for: ' +
      aliasFailures.join(', ')
    );
  }

  const expectedSourceHeaders = hub_stdLocationsSourceHeaders_();

  if (
    JSON.stringify(Object.keys(result.sourceToCanonical)) !==
    JSON.stringify(expectedSourceHeaders)
  ) {
    throw new Error(
      'Source Display Name verification failed. Expected=' +
      JSON.stringify(expectedSourceHeaders) +
      '; Actual=' +
      JSON.stringify(Object.keys(result.sourceToCanonical))
    );
  }

  const expectedHeaders = hub_stdLocationsHeaders_();
  const sh = SpreadsheetApp.getActive().getSheetByName('DATA_LOCATIONS');

  if (!sh) {
    throw new Error('DATA_LOCATIONS is missing after refresh.');
  }

  const actualHeaders = sh
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0];

  if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
    throw new Error(
      'DATA_LOCATIONS header mismatch. Expected=' +
      JSON.stringify(expectedHeaders) +
      '; Actual=' +
      JSON.stringify(actualHeaders)
    );
  }

  const actualRows = Math.max(0, sh.getLastRow() - 1);

  if (actualRows !== result.rows) {
    throw new Error(
      'DATA_LOCATIONS row-count mismatch. Refresh=' +
      result.rows +
      '; Sheet=' +
      actualRows
    );
  }

  const ix = {};
  expectedHeaders.forEach(function(header, index) {
    ix[header] = index + 1;
  });

  const customerIds = sh
    .getRange(2, ix.CustomerId, actualRows, 1)
    .getDisplayValues();
  const customerNumbers = sh
    .getRange(2, ix.CustomerNumber, actualRows, 1)
    .getDisplayValues();
  const customerStatuses = sh
    .getRange(2, ix.CustomerStatus, actualRows, 1)
    .getDisplayValues();
  const locationIds = sh
    .getRange(2, ix.LocationId, actualRows, 1)
    .getDisplayValues();
  const locationKeys = sh
    .getRange(2, ix.LocationKey, actualRows, 1)
    .getDisplayValues();
  const relationshipKeys = sh
    .getRange(2, ix.CustomerLocationKey, actualRows, 1)
    .getDisplayValues();
  const addressIds = sh
    .getRange(2, ix.LocationAddressId, actualRows, 1)
    .getDisplayValues();
  const provinces = sh
    .getRange(2, ix.LocationProvince, actualRows, 1)
    .getDisplayValues();
  const activeValues = sh
    .getRange(2, ix.LocationIsActive, actualRows, 1)
    .getValues();

  const seenLocations = {};
  const seenRelationships = {};

  let customerNumberMismatch = 0;
  let customerStatusMismatch = 0;
  let locationKeyMismatch = 0;
  let relationshipKeyMismatch = 0;
  let provinceMismatch = 0;
  let activeMismatch = 0;
  let missingAddressIds = 0;
  let duplicateLocationIds = 0;
  let duplicateCustomerLocationKeys = 0;

  for (let i = 0; i < actualRows; i++) {
    const customerId = String(customerIds[i][0] || '');
    const customerNumber = String(customerNumbers[i][0] || '');
    const customerStatus = String(customerStatuses[i][0] || '');
    const locationId = String(locationIds[i][0] || '');
    const locationKey = String(locationKeys[i][0] || '');
    const relationshipKey = String(relationshipKeys[i][0] || '');
    const addressId = String(addressIds[i][0] || '');
    const province = String(provinces[i][0] || '');
    const isActive = activeValues[i][0];

    if (customerId !== customerNumber) customerNumberMismatch++;
    if (customerStatus !== 'Active') customerStatusMismatch++;
    if (locationId !== locationKey) locationKeyMismatch++;

    if (relationshipKey !== customerId + '|' + locationId) {
      relationshipKeyMismatch++;
    }

    if (province !== 'Ontario') provinceMismatch++;
    if (isActive !== true) activeMismatch++;
    if (!addressId) missingAddressIds++;

    if (seenLocations[locationId]) duplicateLocationIds++;
    else seenLocations[locationId] = true;

    if (seenRelationships[relationshipKey]) {
      duplicateCustomerLocationKeys++;
    } else {
      seenRelationships[relationshipKey] = true;
    }
  }

  if (
    customerNumberMismatch ||
    customerStatusMismatch ||
    locationKeyMismatch ||
    relationshipKeyMismatch ||
    provinceMismatch ||
    activeMismatch ||
    missingAddressIds ||
    duplicateLocationIds ||
    duplicateCustomerLocationKeys
  ) {
    throw new Error(
      'Derived/identity verification failed. ' +
      JSON.stringify({
        customerNumberMismatch: customerNumberMismatch,
        customerStatusMismatch: customerStatusMismatch,
        locationKeyMismatch: locationKeyMismatch,
        relationshipKeyMismatch: relationshipKeyMismatch,
        provinceMismatch: provinceMismatch,
        activeMismatch: activeMismatch,
        missingAddressIds: missingAddressIds,
        duplicateLocationIds: duplicateLocationIds,
        duplicateCustomerLocationKeys: duplicateCustomerLocationKeys
      })
    );
  }

  const logResult = {
    status: 'PASS',
    test: 'test_StdLocationsRefreshAndVerify',
    dataset: 'LOCATIONS',
    targetSheet: 'DATA_LOCATIONS',
    rows: result.rows,
    reportPageCalls: result.reportPageCalls,
    pageSize: result.pageSize,
    tokenRequestMade: result.tokenRequestMade,
    totalApiCallsThisRun: result.totalApiCallsThisRun,
    sourceCanonicalFieldCount: schema.length,
    outputColumnCount: expectedHeaders.length,
    canonicalHeaders: expectedHeaders,
    sourceToCanonical: result.sourceToCanonical,
    aliasStandard: 'PASS_FOR_ALL_13_EXTERNAL_FIELDS',
    standardizedSourceHeadersVerified: true,
    customerNumberEqualsCustomerIdVerified: true,
    customerStatusActiveVerified: true,
    locationIsActiveVerified: true,
    locationProvinceOntarioVerified: true,
    locationKeyVerified: true,
    customerLocationKeyVerified: true,
    locationAddressIdPresentVerified: true,
    duplicateLocationIds: 0,
    duplicateCustomerLocationKeys: 0,
    sheetRowCountVerified: true,
    strivenWritesPerformed: false,
    sourceProjectsModified: false,
    nextStep:
      'After PASS, sync verified R1.6 source to both GitHub locations; keep Locations refresh manual until consumer migration validation.'
  };

  Logger.log(JSON.stringify(logResult, null, 2));
  return logResult;
}
