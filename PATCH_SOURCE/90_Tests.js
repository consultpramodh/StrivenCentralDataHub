/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD CONTACTS FULL REFRESH
 * R1.4
 *
 * This test writes DATA_CONTACTS in the Central Hub only.
 * It does not write to Striven and does not modify source projects.
 */

function test_StdContactsRefreshAndVerify() {
  const result = hub_refreshStdContacts();

  if (!result || result.status !== 'PASS') {
    throw new Error('hub_refreshStdContacts did not return PASS.');
  }

  if (!result.rows || result.rows < 1) {
    throw new Error('STD Contacts refresh returned no rows.');
  }

  if (result.strivenWritesPerformed !== false) {
    throw new Error('Safety assertion failed: Striven writes must be false.');
  }

  if (result.sourceProjectsModified !== false) {
    throw new Error('Safety assertion failed: source-project modifications must be false.');
  }

  const schema = hub_stdContactsSchema_();
  if (schema.length !== 12) {
    throw new Error('STD Contacts source schema must contain exactly 12 canonical fields.');
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

  const expectedHeaders = hub_stdContactsHeaders_();
  const sh = SpreadsheetApp.getActive().getSheetByName('DATA_CONTACTS');

  if (!sh) throw new Error('DATA_CONTACTS is missing after refresh.');

  const actualHeaders = sh
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0];

  if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
    throw new Error(
      'DATA_CONTACTS header mismatch. Expected=' +
      JSON.stringify(expectedHeaders) +
      '; Actual=' +
      JSON.stringify(actualHeaders)
    );
  }

  const actualRows = Math.max(0, sh.getLastRow() - 1);

  if (actualRows !== result.rows) {
    throw new Error(
      'DATA_CONTACTS row-count mismatch. Refresh=' +
      result.rows +
      '; Sheet=' +
      actualRows
    );
  }

  const ix = {};
  expectedHeaders.forEach(function(header, index) {
    ix[header] = index + 1;
  });

  const customerIds = sh.getRange(2, ix.CustomerId, actualRows, 1).getDisplayValues();
  const customerNumbers = sh.getRange(2, ix.CustomerNumber, actualRows, 1).getDisplayValues();
  const contactIds = sh.getRange(2, ix.ContactId, actualRows, 1).getDisplayValues();
  const entityTypes = sh.getRange(2, ix.EntityType, actualRows, 1).getDisplayValues();
  const entityIds = sh.getRange(2, ix.EntityId, actualRows, 1).getDisplayValues();
  const keys = sh.getRange(2, ix.CustomerContactKey, actualRows, 1).getDisplayValues();

  const seen = {};
  let customerNumberMismatch = 0;
  let entityTypeMismatch = 0;
  let entityIdMismatch = 0;
  let relationshipKeyMismatch = 0;
  let duplicateRelationshipKeys = 0;

  for (let i = 0; i < actualRows; i++) {
    const customerId = String(customerIds[i][0] || '');
    const customerNumber = String(customerNumbers[i][0] || '');
    const contactId = String(contactIds[i][0] || '');
    const entityType = String(entityTypes[i][0] || '');
    const entityId = String(entityIds[i][0] || '');
    const key = String(keys[i][0] || '');
    const expectedKey = customerId + '|' + contactId;

    if (customerId !== customerNumber) customerNumberMismatch++;
    if (entityType !== 'CONTACT') entityTypeMismatch++;
    if (entityId !== contactId) entityIdMismatch++;
    if (key !== expectedKey) relationshipKeyMismatch++;

    if (seen[key]) duplicateRelationshipKeys++;
    else seen[key] = true;
  }

  if (
    customerNumberMismatch ||
    entityTypeMismatch ||
    entityIdMismatch ||
    relationshipKeyMismatch ||
    duplicateRelationshipKeys
  ) {
    throw new Error(
      'Derived-field verification failed. ' +
      JSON.stringify({
        customerNumberMismatch: customerNumberMismatch,
        entityTypeMismatch: entityTypeMismatch,
        entityIdMismatch: entityIdMismatch,
        relationshipKeyMismatch: relationshipKeyMismatch,
        duplicateRelationshipKeys: duplicateRelationshipKeys
      })
    );
  }

  const logResult = {
    status: 'PASS',
    test: 'test_StdContactsRefreshAndVerify',
    dataset: 'CONTACTS',
    targetSheet: 'DATA_CONTACTS',
    rows: result.rows,
    reportPageCalls: result.reportPageCalls,
    pageSize: result.pageSize,
    tokenRequestMade: result.tokenRequestMade,
    totalApiCallsThisRun: result.totalApiCallsThisRun,
    sourceCanonicalFieldCount: schema.length,
    outputColumnCount: expectedHeaders.length,
    canonicalHeaders: expectedHeaders,
    sourceToCanonical: result.sourceToCanonical,
    aliasStandard: 'PASS_FOR_ALL_12_EXTERNAL_FIELDS',
    customerNumberEqualsCustomerIdVerified: true,
    entityTypeVerified: true,
    entityIdVerified: true,
    customerContactKeyVerified: true,
    duplicateCustomerContactKeys: 0,
    sheetRowCountVerified: true,
    strivenWritesPerformed: false,
    sourceProjectsModified: false,
    nextStep: 'After PASS, sync verified R1.4 source to GitHub; keep Contacts refresh manual until consumer migration validation.'
  };

  Logger.log(JSON.stringify(logResult, null, 2));
  return logResult;
}
