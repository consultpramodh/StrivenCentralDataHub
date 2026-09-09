/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY.
 *
 * Rule: when a newer test is introduced, replace this test file's old
 * test function instead of accumulating historical tests.
 */

/**
 * Current smoke test:
 * 1) Initialize/repair the Hub structure.
 * 2) Validate the registry.
 * 3) Verify Apps Script API read access to the first enabled source project.
 *
 * No Striven API calls are made.
 * No source project is modified.
 */
function test_HubReadyForInventory() {
  const structure = hub_initializeOrRepair();
  const registry = hub_validateProjectRegistry();
  const scriptApi = hub_assertAppsScriptApiAccess_();

  const result = {
    status: 'PASS',
    version: HUB_VERSION,
    marker: HUB_MARKER,
    structure: structure,
    registry: registry,
    appsScriptApi: scriptApi,
    nextFunction: 'hub_inventoryAllProjects'
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
