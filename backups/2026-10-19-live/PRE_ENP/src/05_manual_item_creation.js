/************************************************************
 * APPS SCRIPT — 05_manual_item_creation.gs
 * ENTERNEWPART — MANUAL ITEM CREATION
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Create Striven items directly from the sheet:
 *   Manual ItemCreation
 *
 * EXPECTED SHEET
 * ----------------------------------------------------------
 * Sheet Name:
 *   Manual ItemCreation
 *
 * REQUIRED HEADERS
 * ----------------------------------------------------------
 *   Item Number
 *   ItemName
 *   Price
 *
 * OPTIONAL HEADERS
 * ----------------------------------------------------------
 *   Cost
 *   NewItemId
 *   LastAction
 *   LastError
 *   LastUpdated
 *
 * DEPENDS ON
 * ----------------------------------------------------------
 * 01_config_menu.gs
 * 02_striven_core.gs
 ************************************************************/


/* =========================================================
 * APPS SCRIPT — PUBLIC ENTRY POINTS
 * ========================================================= */

function manualCreateItems_selectedRows() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!sh || sh.getName() !== ENP.SHEETS.MANUAL) {
    throw new Error('Run this only from the "' + ENP.SHEETS.MANUAL + '" sheet.');
  }

  manualEnsureManualSheetHeaders_();
  manualCreateItemsForSelection_();
}

function manualEnsureManualSheetHeaders_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(ENP.SHEETS.MANUAL) || ss.insertSheet(ENP.SHEETS.MANUAL);

  enp_ensureHeaders_(sh, [
    'Item Number',
    'ItemName',
    'Price',
    'Cost',
    'NewItemId',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]);

  return sh;
}


/* =========================================================
 * APPS SCRIPT — MAIN FLOW
 * ========================================================= */

function manualCreateItemsForSelection_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ENP.SHEETS.MANUAL);
  if (!sh) throw new Error('Missing sheet: ' + ENP.SHEETS.MANUAL);

  const rows = enp_getSelectedRowNumbers_(sh);
  const grid = sh.getDataRange().getValues();
  if (grid.length < 2) throw new Error('No data rows found.');

  const headers = grid[0].map(enp_norm_);
  const col = manualGetHeaderMap_(headers);
  let created = 0, exists = 0, failed = 0, skipped = 0;

  rows.forEach(function(rowNumber) {
    const row = grid[rowNumber - 1];
    const now = new Date();
    try {
      const currentNewItemId = enp_num_(row[col.newItemId]);
      if (currentNewItemId) {
        skipped++;
        manualWriteRowStatus_(row, col, { action: 'SKIPPED', error: 'Already has NewItemId.', updated: now });
        sh.getRange(rowNumber, 1, 1, row.length).setValues([row]);
        return;
      }

      const payload = manualBuildItemPayloadFromRow_(row, col);
      const resolution = enp_guardCreateOrResolveItem_(payload);
      row[col.newItemId] = resolution.id;
      manualWriteRowStatus_(row, col, { action: resolution.status, error: '', updated: now });
      if (resolution.status === 'EXISTS') exists++; else created++;
    } catch (err) {
      manualWriteRowStatus_(row, col, { action: 'FAILED', error: String(err && err.message ? err.message : err), updated: now });
      failed++;
    }
    sh.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  });

  SpreadsheetApp.getActive().toast('Manual create complete — CREATED=' + created + ' EXISTS=' + exists + ' FAIL=' + failed + ' SKIP=' + skipped, 'Enternewpart', 6);
  return { created: created, exists: exists, failed: failed, skipped: skipped };
}


/* =========================================================
 * APPS SCRIPT — HEADER + ROW HELPERS
 * ========================================================= */

function manualGetHeaderMap_(headers) {
  const map = enp_indexByHeader_(headers);

  const out = {
    itemNumber: map['Item Number'],
    itemName: map['ItemName'],
    price: map['Price'],
    cost: map['Cost'],
    newItemId: map['NewItemId'],
    lastAction: map['LastAction'],
    lastError: map['LastError'],
    lastUpdated: map['LastUpdated']
  };

  const missing = [];
  if (out.itemNumber == null) missing.push('Item Number');
  if (out.itemName == null) missing.push('ItemName');
  if (out.price == null) missing.push('Price');
  if (out.newItemId == null) missing.push('NewItemId');
  if (out.lastAction == null) missing.push('LastAction');
  if (out.lastError == null) missing.push('LastError');
  if (out.lastUpdated == null) missing.push('LastUpdated');

  if (missing.length) {
    throw new Error('Missing required columns: ' + missing.join(', '));
  }

  return out;
}

/************************************************************
 * APPS SCRIPT — 05_manual_item_creation.gs
 * BUILD MANUAL ITEM PAYLOAD
 *
 * Naming rule:
 * - ItemNumber = Item Number column
 * - Name = ItemName (Item Number)
 * - Description = ItemName (Item Number)
 ************************************************************/
function manualBuildItemPayloadFromRow_(row, col) {
  const props = PropertiesService.getScriptProperties();

  const itemNumber = enp_norm_(row[col.itemNumber]);
  const itemName = enp_norm_(row[col.itemName]);
  const price = enp_num_(row[col.price]);
  const cost = col.cost != null ? (enp_num_(row[col.cost]) || 0) : 0;

  if (!itemNumber) throw new Error('Missing Item Number.');
  if (!itemName) throw new Error('Missing ItemName.');
  if (price == null) throw new Error('Missing Price.');

  if (enp_normUpper_(itemNumber) === enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) {
    throw new Error('Item Number cannot be the placeholder ENTERNEWPART.');
  }

  const finalItemName = enp_formatStrivenItemName_(itemName, itemNumber);

  const typeId =
    enp_num_(props.getProperty(ENP.PROPS.DEFAULT_ITEMTYPE_ID)) ||
    enp_num_(props.getProperty('ENTERNEWPART_DEFAULT_ITEM_TYPE_ID'));

  if (!typeId) {
    throw new Error('Missing default item type id in Script Properties.');
  }

  const payload = {
    Id: 0,
    ItemNumber: itemNumber,
    Name: finalItemName,
    Description: finalItemName,
    Price: price,
    Cost: cost,
    Active: true,
    Taxable: true,
    ItemType: { Id: typeId }
  };

  const incomeId = enp_num_(props.getProperty(ENP.PROPS.DEFAULT_INCOME_GL_ID));
  const inventoryId = enp_num_(props.getProperty(ENP.PROPS.DEFAULT_INVENTORY_GL_ID));
  const cogsId = enp_num_(props.getProperty(ENP.PROPS.DEFAULT_COGS_GL_ID));
  const locationId = enp_num_(props.getProperty(ENP.PROPS.DEFAULT_LOCATION_ID));

  if (incomeId) payload.IncomeGLAccount = { Id: incomeId };
  if (inventoryId) payload.InventoryAssetGLAccount = { Id: inventoryId };
  if (cogsId) payload.COGSGLAccount = { Id: cogsId };
  if (locationId) payload.DefaultInventoryLocation = { Id: locationId };

  return payload;
}

function manualWriteRowStatus_(row, col, status) {
  if (col.lastAction != null) row[col.lastAction] = status.action || '';
  if (col.lastError != null) row[col.lastError] = status.error || '';
  if (col.lastUpdated != null) row[col.lastUpdated] = status.updated || '';
}