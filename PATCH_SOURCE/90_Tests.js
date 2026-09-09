/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD ITEMS FULL REFRESH
 * R1.2
 *
 * This test writes DATA_ITEMS in the Central Hub only.
 * It does not write to Striven and does not modify source projects.
 */

function test_StdItemsRefreshAndVerify() {
  const result = hub_refreshStdItems();

  if (!result || result.status !== 'PASS') {
    throw new Error('hub_refreshStdItems did not return PASS.');
  }

  if (!result.rows || result.rows < 1) {
    throw new Error('STD Items refresh returned no rows.');
  }

  if (result.strivenWritesPerformed !== false) {
    throw new Error('Safety assertion failed: Striven writes must be false.');
  }

  if (result.sourceProjectsModified !== false) {
    throw new Error('Safety assertion failed: source-project modifications must be false.');
  }

  const expectedHeaders = hub_stdItemsHeaders_();
  const sh = SpreadsheetApp.getActive().getSheetByName('DATA_ITEMS');

  if (!sh) {
    throw new Error('DATA_ITEMS is missing after refresh.');
  }

  const actualHeaders = sh
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0];

  if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
    throw new Error(
      'DATA_ITEMS header mismatch. Expected=' +
      JSON.stringify(expectedHeaders) +
      '; Actual=' +
      JSON.stringify(actualHeaders)
    );
  }

  const actualRows = Math.max(0, sh.getLastRow() - 1);
  if (actualRows !== result.rows) {
    throw new Error(
      'DATA_ITEMS row-count mismatch. Refresh=' +
      result.rows +
      '; Sheet=' +
      actualRows
    );
  }

  const schema = hub_stdItemsSchema_();
  if (schema.length !== 15) {
    throw new Error('STD Items canonical schema must contain exactly 15 fields.');
  }

  const aliasesMissingCanonical = schema
    .filter(function(def) {
      const canonicalNorm = hub_normalizeFieldName_(def.canonical);
      return !def.aliases.some(function(alias) {
        return hub_normalizeFieldName_(alias) === canonicalNorm;
      });
    })
    .map(function(def) { return def.canonical; });

  if (aliasesMissingCanonical.length) {
    throw new Error(
      'Alias standard failure. Canonical name missing from alias set for: ' +
      aliasesMissingCanonical.join(', ')
    );
  }

  const logResult = {
    status: 'PASS',
    test: 'test_StdItemsRefreshAndVerify',
    dataset: 'ITEMS',
    targetSheet: 'DATA_ITEMS',
    rows: result.rows,
    reportPageCalls: result.reportPageCalls,
    tokenRequestMade: result.tokenRequestMade,
    totalApiCallsThisRun: result.totalApiCallsThisRun,
    canonicalFieldCount: expectedHeaders.length,
    canonicalHeaders: expectedHeaders,
    sourceToCanonical: result.sourceToCanonical,
    aliasStandard: 'PASS_FOR_ALL_15_FIELDS',
    sheetRowCountVerified: true,
    strivenWritesPerformed: false,
    sourceProjectsModified: false,
    nextStep: 'After PASS, sync verified R1.2 source to GitHub; keep refresh manual until migration validation.'
  };

  Logger.log(JSON.stringify(logResult, null, 2));
  return logResult;
}
