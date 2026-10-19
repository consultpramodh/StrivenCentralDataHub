// Google Apps Script

function enp_inspectItem42791() {
  const itemId = 42791;

  const res = enp_guardRawRequest_(
    'GET',
    '/v1/items/' + itemId,
    null,
    false
  );

  if (!res.ok) {
    throw new Error(
      'Could not read Item ' + itemId +
      '. HTTP ' + res.code +
      ' — ' + res.text
    );
  }

  const raw =
    (res.body && (res.body.Data || res.body.data)) ||
    res.body ||
    {};

  const summary = {
    Id: raw.Id ?? raw.id ?? '',
    ItemNumber: raw.ItemNumber ?? raw.itemNumber ?? '',
    Name: raw.Name ?? raw.name ?? raw.ItemName ?? raw.itemName ?? '',
    Description: raw.Description ?? raw.description ?? '',
    Price: raw.Price ?? raw.price ?? '',
    Cost: raw.Cost ?? raw.cost ?? '',
    Active: raw.Active ?? raw.active ?? '',
    Taxable: raw.Taxable ?? raw.taxable ?? '',
    ItemType: raw.ItemType ?? raw.itemType ?? '',
    UnitOfMeasure: raw.UnitOfMeasure ?? raw.unitOfMeasure ?? '',
    DefaultInventoryLocation:
      raw.DefaultInventoryLocation ??
      raw.defaultInventoryLocation ??
      '',
    IncomeGLAccount:
      raw.IncomeGLAccount ??
      raw.incomeGLAccount ??
      '',
    InventoryAssetGLAccount:
      raw.InventoryAssetGLAccount ??
      raw.inventoryAssetGLAccount ??
      '',
    COGSGLAccount:
      raw.COGSGLAccount ??
      raw.cogsGLAccount ??
      ''
  };

  console.log(
    '=== ITEM 42791 SUMMARY ===\n' +
    JSON.stringify(summary, null, 2)
  );

  console.log(
    '=== ITEM 42791 FULL RAW RESPONSE ===\n' +
    JSON.stringify(raw, null, 2)
  );

  return summary;
}


function enp_testDynamicItemGroupPlanForSelectedRow() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getActiveSheet();

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART — DYNAMIC ITEM GROUP DRY RUN');
  Logger.log('MODE: READ ONLY');
  Logger.log('STRIVEN WRITES: NONE');
  Logger.log('SHEET WRITES: NONE');
  Logger.log('====================================================');

  /*
   * =========================================================
   * 1. VALIDATE ACTIVE SHEET + SELECTED ROW
   * =========================================================
   */

  if (!sh) {
    throw new Error('No active sheet.');
  }

  if (
    sh.getName() !== ENP.SHEETS.APPROVED &&
    sh.getName() !== ENP.SHEETS.QUOTED
  ) {
    throw new Error(
      'Run this from "' +
      ENP.SHEETS.APPROVED +
      '" or "' +
      ENP.SHEETS.QUOTED +
      '".'
    );
  }

  const range = sh.getActiveRange();

  if (!range) {
    throw new Error('Select one ENTERNEWPART row first.');
  }

  if (range.getNumRows() !== 1) {
    throw new Error(
      'For this test select exactly ONE data row.'
    );
  }

  const rowNumber = range.getRow();

  if (rowNumber < 2) {
    throw new Error('Select a data row, not the header.');
  }

  /*
   * =========================================================
   * 2. READ SELECTED SOURCE ROW
   * =========================================================
   */

  const grid = sh.getDataRange().getValues();
  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);

  enp_requireCols_(col, [
    'SalesOrderSalesOrderId',
    'ItemNumber',
    'ItemDescription',
    'Quantity',
    'NewItemId'
  ]);

  const row = grid[rowNumber - 1];

  const soId =
    enp_num_(
      row[col['SalesOrderSalesOrderId']]
    );

  const soNumber =
    col['SalesOrderNumber'] != null
      ? enp_norm_(row[col['SalesOrderNumber']])
      : '';

  const oldItemNumber =
    enp_norm_(row[col['ItemNumber']]);

  const rawDescription =
    enp_norm_(row[col['ItemDescription']]);

  const newItemId =
    enp_num_(row[col['NewItemId']]);

  const desiredQty =
    enp_num_(row[col['Quantity']]);

  if (!soId) {
    throw new Error(
      'Selected row is missing SalesOrderSalesOrderId.'
    );
  }

  if (!newItemId) {
    throw new Error(
      'Selected row is missing NewItemId.'
    );
  }

  if (
    enp_normUpper_(oldItemNumber) !==
    enp_normUpper_(
      ENP.VALUES.PLACEHOLDER_ITEMNUMBER
    )
  ) {
    throw new Error(
      'Selected row is not an ENTERNEWPART placeholder.'
    );
  }

  const parsed =
    enp_parseDescription_(rawDescription);

  if (!parsed.itemNumber) {
    throw new Error(
      'Selected ItemDescription does not contain Item Number.'
    );
  }

  Logger.log(
    'SOURCE ROW: ' +
    JSON.stringify({
      sheet: sh.getName(),
      rowNumber: rowNumber,
      soId: soId,
      soNumber: soNumber,
      newItemId: newItemId,
      desiredItemNumber: parsed.itemNumber,
      desiredItemName: parsed.name,
      desiredPrice: parsed.price,
      desiredQty: desiredQty
    })
  );

  /*
   * =========================================================
   * 3. LOAD SALES ORDER
   * =========================================================
   */

  const so =
    enp_getSalesOrder_(soId);

  if (!so) {
    throw new Error(
      'Could not load Sales Order ' + soId + '.'
    );
  }

  const lineItems =
    enp_getSalesOrderLineItems_(so);

  if (!lineItems.length) {
    throw new Error(
      'Sales Order has no line items.'
    );
  }

  Logger.log(
    'SALES ORDER: ' +
    JSON.stringify({
      id: so.id || so.Id || null,
      orderNumber:
        so.orderNumber ||
        so.OrderNumber ||
        '',
      lineCount: lineItems.length,
      lineItemsClass:
        so.lineItemsClass ||
        so.LineItemsClass ||
        null
    })
  );

  /*
   * =========================================================
   * 4. FIND EXACT TARGET ENTERNEWPART LINE
   * =========================================================
   */

  const targetLine =
    enp_findTargetPlaceholderLine_(
      lineItems,
      {
        desiredItemNumber:
          parsed.itemNumber,

        desiredQty:
          desiredQty,

        newItemId:
          newItemId
      }
    );

  if (!targetLine) {
    throw new Error(
      'Could not locate matching ENTERNEWPART line on SO.'
    );
  }

  const targetLineId =
    Number(
      targetLine.id ||
      targetLine.Id ||
      0
    );

  Logger.log(
    'TARGET LINE: ' +
    JSON.stringify({
      lineId: targetLineId,
      currentItem:
        targetLine.item ||
        targetLine.Item ||
        null,
      currentInventoryLocation:
        targetLine.inventoryLocation ||
        targetLine.InventoryLocation ||
        null,
      class:
        targetLine.class ||
        targetLine.Class ||
        null,
      qty:
        targetLine.qty ??
        targetLine.Qty ??
        targetLine.quantity ??
        targetLine.Quantity ??
        null,
      price:
        targetLine.price ??
        targetLine.Price ??
        null
    })
  );

  /*
   * =========================================================
   * 5. LOAD REPLACEMENT ITEM
   * =========================================================
   */

  const replacementResponse =
    enp_strivenFetch_(
      '/v1/items/' + newItemId,
      {
        method: 'get'
      }
    );

  const replacementItem =
    replacementResponse &&
    replacementResponse.Data
      ? replacementResponse.Data
      : replacementResponse;

  if (!replacementItem) {
    throw new Error(
      'Could not load NewItemId ' +
      newItemId +
      '.'
    );
  }

  Logger.log(
    'REPLACEMENT ITEM: ' +
    JSON.stringify({
      id:
        replacementItem.id ||
        replacementItem.Id ||
        null,

      itemNumber:
        replacementItem.itemNumber ||
        replacementItem.ItemNumber ||
        '',

      name:
        replacementItem.name ||
        replacementItem.Name ||
        '',

      itemType:
        replacementItem.itemType ||
        replacementItem.ItemType ||
        null,

      defaultInventoryLocation:
        replacementItem.defaultInventoryLocation ||
        replacementItem.DefaultInventoryLocation ||
        null
    })
  );

  /*
   * =========================================================
   * 6. DETERMINE TARGET INVENTORY LOCATION
   * =========================================================
   */

  const props =
    PropertiesService.getScriptProperties();

  const configuredDefaultLocationId =
    enp_num_(
      props.getProperty(
        ENP.PROPS.DEFAULT_LOCATION_ID
      )
    );

  const existingTargetLocation =
    targetLine.inventoryLocation ||
    targetLine.InventoryLocation ||
    null;

  const replacementDefaultLocation =
    replacementItem.defaultInventoryLocation ||
    replacementItem.DefaultInventoryLocation ||
    null;

  let plannedInventoryLocation = null;

  if (
    existingTargetLocation &&
    enp_num_(
      existingTargetLocation.id ||
      existingTargetLocation.Id
    )
  ) {
    plannedInventoryLocation = {
      Id:
        enp_num_(
          existingTargetLocation.id ||
          existingTargetLocation.Id
        ),

      Name:
        enp_norm_(
          existingTargetLocation.name ||
          existingTargetLocation.Name
        )
    };

  } else if (
    replacementDefaultLocation &&
    enp_num_(
      replacementDefaultLocation.id ||
      replacementDefaultLocation.Id
    )
  ) {
    plannedInventoryLocation = {
      Id:
        enp_num_(
          replacementDefaultLocation.id ||
          replacementDefaultLocation.Id
        ),

      Name:
        enp_norm_(
          replacementDefaultLocation.name ||
          replacementDefaultLocation.Name
        )
    };

  } else if (configuredDefaultLocationId) {
    plannedInventoryLocation = {
      Id: configuredDefaultLocationId,
      Name: ''
    };
  }

  Logger.log(
    'PLANNED TARGET INVENTORY LOCATION: ' +
    JSON.stringify(
      plannedInventoryLocation
    )
  );

  /*
   * =========================================================
   * 7. PRESERVED SALES ORDER CUSTOM FIELDS
   * =========================================================
   */

  const soCustomFields =
    Array.isArray(so.customFields)
      ? so.customFields
      : (
          Array.isArray(so.CustomFields)
            ? so.CustomFields
            : []
        );

  const requiredCustomFields =
    soCustomFields
      .filter(function(cf) {
        return (
          cf &&
          (
            cf.isRequired === true ||
            cf.IsRequired === true
          )
        );
      })
      .map(function(cf) {
        return {
          id:
            cf.id ??
            cf.Id ??
            null,

          name:
            cf.name ??
            cf.Name ??
            '',

          value:
            cf.value ??
            cf.Value ??
            null,

          valueText:
            cf.valueText ??
            cf.ValueText ??
            null,

          sourceId:
            cf.sourceId ??
            cf.SourceId ??
            null
        };
      });

  Logger.log(
    'REQUIRED CUSTOM FIELDS TO PRESERVE: ' +
    JSON.stringify(
      requiredCustomFields
    )
  );

  /*
   * =========================================================
   * 8. INSPECT EVERY EXISTING ITEM GROUP ON THE SALES ORDER
   * =========================================================
   */

  const itemGroupPlans = [];

  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];

    const soGroupChildren =
      line.itemGroupLineItems ||
      line.ItemGroupLineItems ||
      [];

    if (
      !Array.isArray(soGroupChildren) ||
      !soGroupChildren.length
    ) {
      continue;
    }

    const parentItem =
      line.item ||
      line.Item ||
      {};

    const parentItemId =
      enp_num_(
        parentItem.id ||
        parentItem.Id
      );

    const parentLineId =
      Number(
        line.id ||
        line.Id ||
        0
      );

    if (!parentItemId) {
      throw new Error(
        'Item Group parent line ' +
        parentLineId +
        ' has no Item Id.'
      );
    }

    /*
     * -------------------------------------------------------
     * Load CURRENT master group only for comparison.
     *
     * The SO children remain the source of truth.
     * -------------------------------------------------------
     */

    const masterResponse =
      enp_strivenFetch_(
        '/v1/items/' + parentItemId,
        {
          method: 'get'
        }
      );

    const master =
      masterResponse &&
      masterResponse.Data
        ? masterResponse.Data
        : masterResponse;

    const masterChildren =
      master &&
      Array.isArray(
        master.groupItems ||
        master.GroupItems
      )
        ? (
            master.groupItems ||
            master.GroupItems
          )
        : [];

    /*
     * -------------------------------------------------------
     * Normalize SALES ORDER group children.
     * -------------------------------------------------------
     */

    const soChildSpec =
      soGroupChildren
        .map(function(child) {
          const childItem =
            child.item ||
            child.Item ||
            {};

          return {
            itemId:
              enp_num_(
                childItem.id ||
                childItem.Id
              ),

            itemName:
              enp_norm_(
                childItem.name ||
                childItem.Name
              ),

            qty:
              enp_num_(
                child.qty ??
                child.Qty
              ),

            price:
              enp_num_(
                child.price ??
                child.Price
              ),

            inventoryLocation:
              child.inventoryLocation ||
              child.InventoryLocation ||
              null,

            class:
              child.class ||
              child.Class ||
              null,

            unitOfMeasure:
              child.unitOfMeasure ||
              child.UnitOfMeasure ||
              null
          };
        });

    /*
     * -------------------------------------------------------
     * Normalize CURRENT MASTER children.
     * -------------------------------------------------------
     */

    const masterChildSpec =
      masterChildren
        .map(function(child) {
          const childItem =
            child.item ||
            child.Item ||
            {};

          return {
            itemId:
              enp_num_(
                childItem.id ||
                childItem.Id
              ),

            qty:
              enp_num_(
                child.qty ??
                child.Qty
              )
          };
        });

    /*
     * -------------------------------------------------------
     * Compare ItemId + Qty only.
     *
     * Prices/classes can legitimately vary on Sales Orders.
     * -------------------------------------------------------
     */

    function makeComparable_(arr) {
      return arr
        .map(function(x) {
          return {
            itemId: Number(x.itemId || 0),
            qty: Number(x.qty || 0)
          };
        })
        .sort(function(a, b) {
          if (a.itemId !== b.itemId) {
            return a.itemId - b.itemId;
          }
          return a.qty - b.qty;
        });
    }

    const comparableSO =
      makeComparable_(soChildSpec);

    const comparableMaster =
      makeComparable_(masterChildSpec);

    const masterMatchesSO =
      JSON.stringify(comparableSO) ===
      JSON.stringify(comparableMaster);

    /*
     * -------------------------------------------------------
     * Build a stable fingerprint from the ACTUAL SO config.
     * -------------------------------------------------------
     */

    const fingerprintSource =
      comparableSO
        .map(function(x) {
          return (
            x.itemId +
            'x' +
            x.qty
          );
        })
        .join('|');

    const digest =
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        fingerprintSource,
        Utilities.Charset.UTF_8
      );

    const fingerprint =
      Utilities
        .base64EncodeWebSafe(digest)
        .replace(/=+$/, '')
        .slice(0, 12);

    /*
     * Candidate only.
     * Nothing will be created by this test.
     */
    const proposedDedicatedItemNumber =
      'ENP-GRP-' +
      (soNumber || soId) +
      '-' +
      parentLineId +
      '-' +
      fingerprint;

    const proposedGroupName =
      enp_norm_(
        master &&
        (
          master.name ||
          master.Name
        )
      ) ||
      enp_norm_(
        parentItem.name ||
        parentItem.Name
      ) ||
      'Dynamic Item Group';

    const plan = {
      parentLineId:
        parentLineId,

      currentParentItemId:
        parentItemId,

      currentParentName:
        enp_norm_(
          parentItem.name ||
          parentItem.Name
        ),

      currentMasterMatchesSO:
        masterMatchesSO,

      action:
        masterMatchesSO
          ? 'REUSE_CURRENT_GROUP'
          : 'DEDICATED_GROUP_REQUIRED',

      fingerprint:
        fingerprint,

      proposedDedicatedItemNumber:
        masterMatchesSO
          ? ''
          : proposedDedicatedItemNumber,

      proposedGroupName:
        proposedGroupName,

      salesOrderChildren:
        soChildSpec,

      currentMasterChildren:
        masterChildSpec
    };

    itemGroupPlans.push(plan);

    Logger.log('----------------------------------------------------');

    Logger.log(
      'ITEM GROUP PLAN: ' +
      JSON.stringify(
        plan,
        null,
        2
      )
    );
  }

  /*
   * =========================================================
   * 9. BUILD TARGET REPLACEMENT PREVIEW
   * =========================================================
   */

  const replacementName =
    enp_norm_(
      replacementItem.name ||
      replacementItem.Name
    );

  const plannedCleanDescription =
    enp_buildCleanLineDescription_(
      parsed
    );

  const replacementPreview = {
    lineId:
      targetLineId,

    fromItemId:
      enp_num_(
        targetLine.item &&
        targetLine.item.id
      ) ||
      enp_num_(
        targetLine.Item &&
        targetLine.Item.Id
      ),

    toItemId:
      newItemId,

    toItemName:
      replacementName,

    description:
      plannedCleanDescription,

    qty:
      desiredQty,

    price:
      parsed.price,

    inventoryLocation:
      plannedInventoryLocation,

    class:
      targetLine.class ||
      targetLine.Class ||
      null
  };

  Logger.log('----------------------------------------------------');

  Logger.log(
    'TARGET REPLACEMENT PREVIEW: ' +
    JSON.stringify(
      replacementPreview,
      null,
      2
    )
  );

  /*
   * =========================================================
   * 10. FINAL DRY-RUN DECISION
   * =========================================================
   */

  const groupsNeedingDedicatedItems =
    itemGroupPlans.filter(function(plan) {
      return (
        plan.action ===
        'DEDICATED_GROUP_REQUIRED'
      );
    });

  const result = {
    mode:
      'READ_ONLY_DYNAMIC_GROUP_PLAN',

    writesPerformed:
      false,

    sourceSheet:
      sh.getName(),

    sourceRow:
      rowNumber,

    salesOrderId:
      soId,

    salesOrderNumber:
      soNumber,

    target:
      replacementPreview,

    itemGroupsFound:
      itemGroupPlans.length,

    itemGroupsNeedingDedicatedItems:
      groupsNeedingDedicatedItems.length,

    itemGroupPlans:
      itemGroupPlans,

    requiredCustomFields:
      requiredCustomFields,

    readyForControlledWriteTest:
      !!plannedInventoryLocation
  };

  Logger.log('====================================================');

  Logger.log(
    'FINAL DRY RUN RESULT:\n' +
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log('====================================================');
  Logger.log('NO STRIVEN WRITES PERFORMED');
  Logger.log('NO SHEET WRITES PERFORMED');
  Logger.log('====================================================');

  return result;
}




function enp_testCreateDedicatedDynamicGroupForSelectedRow() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getActiveSheet();

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART — DEDICATED ITEM GROUP CREATE TEST');
  Logger.log('SALES ORDER WRITES: NONE');
  Logger.log('SHEET WRITES: NONE');
  Logger.log('ITEM WRITE: YES — ONE DEDICATED ITEM GROUP');
  Logger.log('====================================================');

  if (!sh) {
    throw new Error('No active sheet.');
  }

  if (
    sh.getName() !== ENP.SHEETS.APPROVED &&
    sh.getName() !== ENP.SHEETS.QUOTED
  ) {
    throw new Error(
      'Run this from "' +
      ENP.SHEETS.APPROVED +
      '" or "' +
      ENP.SHEETS.QUOTED +
      '".'
    );
  }

  const range = sh.getActiveRange();

  if (!range || range.getNumRows() !== 1) {
    throw new Error(
      'Select exactly ONE ENTERNEWPART row.'
    );
  }

  const rowNumber = range.getRow();

  if (rowNumber < 2) {
    throw new Error('Select a data row.');
  }

  /*
   * =========================================================
   * READ SELECTED ROW
   * =========================================================
   */

  const grid = sh.getDataRange().getValues();
  const headers = grid[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);
  const row = grid[rowNumber - 1];

  enp_requireCols_(col, [
    'SalesOrderSalesOrderId',
    'SalesOrderNumber',
    'ItemNumber',
    'ItemDescription',
    'NewItemId'
  ]);

  const soId =
    enp_num_(
      row[col['SalesOrderSalesOrderId']]
    );

  const soNumber =
    enp_norm_(
      row[col['SalesOrderNumber']]
    );

  const currentItemNumber =
    enp_normUpper_(
      row[col['ItemNumber']]
    );

  if (!soId) {
    throw new Error(
      'Missing SalesOrderSalesOrderId.'
    );
  }

  if (
    currentItemNumber !==
    enp_normUpper_(
      ENP.VALUES.PLACEHOLDER_ITEMNUMBER
    )
  ) {
    throw new Error(
      'Selected row is not an ENTERNEWPART row.'
    );
  }

  Logger.log(
    'SOURCE — SO=' +
    soId +
    ' Number=' +
    soNumber +
    ' Row=' +
    rowNumber
  );

  /*
   * =========================================================
   * GET SALES ORDER
   * =========================================================
   */

  const so =
    enp_getSalesOrder_(soId);

  if (!so) {
    throw new Error(
      'Could not load Sales Order ' +
      soId +
      '.'
    );
  }

  const lineItems =
    enp_getSalesOrderLineItems_(so);

  if (!lineItems.length) {
    throw new Error(
      'Sales Order has no line items.'
    );
  }

  /*
   * =========================================================
   * FIND ITEM GROUPS WHOSE CURRENT MASTER DOES NOT MATCH
   * THE CONFIGURED SALES ORDER CHILDREN.
   *
   * FOR THIS CONTROLLED TEST WE REQUIRE EXACTLY ONE.
   * =========================================================
   */

  const mismatchedGroups = [];

  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];

    const soChildren =
      line.itemGroupLineItems ||
      line.ItemGroupLineItems ||
      [];

    if (
      !Array.isArray(soChildren) ||
      !soChildren.length
    ) {
      continue;
    }

    const parentItem =
      line.item ||
      line.Item ||
      {};

    const parentItemId =
      enp_num_(
        parentItem.id ||
        parentItem.Id
      );

    const parentLineId =
      enp_num_(
        line.id ||
        line.Id
      );

    if (!parentItemId) {
      throw new Error(
        'Item Group line is missing parent Item Id.'
      );
    }

    /*
     * Load current generic/master group.
     */
    const masterResponse =
      enp_strivenFetch_(
        '/v1/items/' + parentItemId,
        {
          method: 'get'
        }
      );

    const master =
      masterResponse &&
      masterResponse.Data
        ? masterResponse.Data
        : masterResponse;

    const masterChildren =
      master &&
      Array.isArray(
        master.groupItems ||
        master.GroupItems
      )
        ? (
            master.groupItems ||
            master.GroupItems
          )
        : [];

    /*
     * Normalize configured SO children.
     */
    const soSpec =
      soChildren.map(function(child) {
        const item =
          child.item ||
          child.Item ||
          {};

        return {
          itemId:
            enp_num_(
              item.id ||
              item.Id
            ),

          itemName:
            enp_norm_(
              item.name ||
              item.Name
            ),

          qty:
            enp_num_(
              child.qty ??
              child.Qty
            ) || 0,

          price:
            enp_num_(
              child.price ??
              child.Price
            ) || 0,

          inventoryLocation:
            child.inventoryLocation ||
            child.InventoryLocation ||
            null,

          unitOfMeasure:
            child.unitOfMeasure ||
            child.UnitOfMeasure ||
            null
        };
      });

    /*
     * Normalize current master for comparison.
     */
    const masterSpec =
      masterChildren.map(function(child) {
        const item =
          child.item ||
          child.Item ||
          {};

        return {
          itemId:
            enp_num_(
              item.id ||
              item.Id
            ),

          qty:
            enp_num_(
              child.qty ??
              child.Qty
            ) || 0
        };
      });

    function comparable_(arr) {
      return arr
        .map(function(x) {
          return {
            itemId: Number(x.itemId || 0),
            qty: Number(x.qty || 0)
          };
        })
        .sort(function(a, b) {
          if (a.itemId !== b.itemId) {
            return a.itemId - b.itemId;
          }
          return a.qty - b.qty;
        });
    }

    const actualComparable =
      comparable_(soSpec);

    const masterComparable =
      comparable_(masterSpec);

    const matches =
      JSON.stringify(actualComparable) ===
      JSON.stringify(masterComparable);

    if (matches) {
      continue;
    }

    /*
     * Stable fingerprint from ACTUAL SO configuration.
     */
    const fingerprintSource =
      actualComparable
        .map(function(x) {
          return (
            x.itemId +
            'x' +
            x.qty
          );
        })
        .join('|');

    const digest =
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        fingerprintSource,
        Utilities.Charset.UTF_8
      );

    const fingerprint =
      Utilities
        .base64EncodeWebSafe(digest)
        .replace(/=+$/, '')
        .slice(0, 12);

    mismatchedGroups.push({
      parentLineId: parentLineId,
      parentItemId: parentItemId,

      parentName:
        enp_norm_(
          master &&
          (
            master.name ||
            master.Name
          )
        ) ||
        'Dynamic Item Group',

      fingerprint: fingerprint,

      children: soSpec
    });
  }

  if (!mismatchedGroups.length) {
    throw new Error(
      'No dynamic Item Group requiring a dedicated group was found.'
    );
  }

  /*
   * For this controlled test we intentionally stop if
   * multiple groups exist.
   *
   * Production code will handle any number dynamically.
   */
  if (mismatchedGroups.length !== 1) {
    throw new Error(
      'Controlled test expected exactly 1 mismatched Item Group but found ' +
      mismatchedGroups.length +
      '. No item created.'
    );
  }

  const plan =
    mismatchedGroups[0];

  /*
   * =========================================================
   * BUILD DETERMINISTIC DEDICATED GROUP IDENTITY
   * =========================================================
   */

  const dedicatedItemNumber =
    'ENP-GRP-' +
    soNumber +
    '-' +
    plan.parentLineId +
    '-' +
    plan.fingerprint;

  const dedicatedName =
    plan.parentName +
    ' - SO ' +
    soNumber;

  Logger.log(
    'DEDICATED ITEM NUMBER: ' +
    dedicatedItemNumber
  );

  Logger.log(
    'DEDICATED NAME: ' +
    dedicatedName
  );

  /*
   * =========================================================
   * BUILD GROUP ITEMS FROM THE SALES ORDER — SOURCE OF TRUTH
   * =========================================================
   */

  const groupItems =
    plan.children.map(function(child) {
      if (!child.itemId) {
        throw new Error(
          'Dynamic Item Group contains child without Item Id.'
        );
      }

      const out = {
        Id: 0,

        Item: {
          Id: child.itemId
        },

        Qty:
          child.qty,

        Price:
          child.price
      };

      const loc =
        child.inventoryLocation;

      if (
        loc &&
        enp_num_(
          loc.id ||
          loc.Id
        )
      ) {
        out.InventoryLocation = {
          Id:
            enp_num_(
              loc.id ||
              loc.Id
            )
        };
      }

      const uom =
        child.unitOfMeasure;

      if (
        uom &&
        enp_num_(
          uom.id ||
          uom.Id
        )
      ) {
        out.UnitOfMeasure = {
          Id:
            enp_num_(
              uom.id ||
              uom.Id
            )
        };
      }

      return out;
    });

  /*
   * =========================================================
   * SAFETY CHECK
   * =========================================================
   */

  const expectedIds =
    plan.children
      .map(function(x) {
        return x.itemId;
      })
      .filter(Boolean)
      .sort(function(a, b) {
        return a - b;
      });

  const payloadIds =
    groupItems
      .map(function(x) {
        return (
          x.Item &&
          x.Item.Id
        );
      })
      .filter(Boolean)
      .sort(function(a, b) {
        return a - b;
      });

  if (
    JSON.stringify(expectedIds) !==
    JSON.stringify(payloadIds)
  ) {
    throw new Error(
      'Safety failure: dedicated group child IDs do not match SO group.'
    );
  }

  /*
   * =========================================================
   * BUILD STRIVEN ITEM GROUP PAYLOAD
   *
   * This deliberately mirrors the known Item Group shape
   * returned by Striven:
   *
   * ItemType.Id = 5
   * GroupItems[]
   *   Item.Id
   *   Qty
   *   Price
   *   InventoryLocation.Id
   * =========================================================
   */

  const payload = {
    Id: 0,

    ItemNumber:
      dedicatedItemNumber,

    Name:
      dedicatedName,

    Description:
      dedicatedName,

    Price: 0,

    Cost: 0,

    Active: true,

    Taxable: true,

    ItemType: {
      Id: 5
    },

    GroupItems:
      groupItems
  };

  Logger.log(
    'CREATE PAYLOAD:\n' +
    JSON.stringify(
      payload,
      null,
      2
    )
  );

  /*
   * =========================================================
   * CREATE ITEM GROUP
   *
   * NO SALES ORDER WRITE.
   * =========================================================
   */

  Logger.log(
    'POSTING dedicated Item Group...'
  );

  const createResponse =
    enp_createItemInStriven_(
      payload
    );

  Logger.log(
    'CREATE RESPONSE: ' +
    JSON.stringify(createResponse)
  );

  const newGroupItemId =
    enp_extractItemId_(
      createResponse
    );

  if (!newGroupItemId) {
    throw new Error(
      'Dedicated Item Group create returned no Item Id.'
    );
  }

  Logger.log(
    'CREATED DEDICATED GROUP ITEM ID: ' +
    newGroupItemId
  );

  /*
   * =========================================================
   * READ BACK AND VERIFY
   * =========================================================
   */

  const verifyResponse =
    enp_strivenFetch_(
      '/v1/items/' +
      newGroupItemId,
      {
        method: 'get'
      }
    );

  const verify =
    verifyResponse &&
    verifyResponse.Data
      ? verifyResponse.Data
      : verifyResponse;

  if (!verify) {
    throw new Error(
      'Created Item Group could not be read back.'
    );
  }

  const verifyType =
    verify.itemType ||
    verify.ItemType ||
    {};

  const verifyTypeId =
    enp_num_(
      verifyType.id ||
      verifyType.Id
    );

  if (verifyTypeId !== 5) {
    throw new Error(
      'Verification failed: created item is not Item Type 5.'
    );
  }

  const verifyChildren =
    verify.groupItems ||
    verify.GroupItems ||
    [];

  const verifiedSpec =
    verifyChildren
      .map(function(g) {
        const item =
          g.item ||
          g.Item ||
          {};

        return {
          itemId:
            enp_num_(
              item.id ||
              item.Id
            ),

          qty:
            enp_num_(
              g.qty ??
              g.Qty
            ),

          price:
            enp_num_(
              g.price ??
              g.Price
            )
        };
      })
      .sort(function(a, b) {
        if (a.itemId !== b.itemId) {
          return a.itemId - b.itemId;
        }
        return a.qty - b.qty;
      });

  const expectedSpec =
    plan.children
      .map(function(g) {
        return {
          itemId:
            g.itemId,

          qty:
            g.qty,

          price:
            g.price
        };
      })
      .sort(function(a, b) {
        if (a.itemId !== b.itemId) {
          return a.itemId - b.itemId;
        }
        return a.qty - b.qty;
      });

  Logger.log(
    'EXPECTED GROUP CONFIG:\n' +
    JSON.stringify(
      expectedSpec,
      null,
      2
    )
  );

  Logger.log(
    'STRIVEN SAVED GROUP CONFIG:\n' +
    JSON.stringify(
      verifiedSpec,
      null,
      2
    )
  );

  if (
    JSON.stringify(expectedSpec) !==
    JSON.stringify(verifiedSpec)
  ) {
    throw new Error(
      'Dedicated Item Group was created, but its saved child configuration does not exactly match the Sales Order configuration.'
    );
  }

  /*
   * =========================================================
   * FINAL RESULT
   * =========================================================
   */

  const result = {
    mode:
      'CONTROLLED_ITEM_GROUP_CREATE_TEST',

    salesOrderWritesPerformed:
      false,

    sheetWritesPerformed:
      false,

    itemCreated:
      true,

    salesOrderId:
      soId,

    salesOrderNumber:
      soNumber,

    originalGroupItemId:
      plan.parentItemId,

    originalGroupLineId:
      plan.parentLineId,

    dedicatedItemId:
      newGroupItemId,

    dedicatedItemNumber:
      dedicatedItemNumber,

    dedicatedName:
      dedicatedName,

    fingerprint:
      plan.fingerprint,

    verified:
      true,

    children:
      verifiedSpec
  };

  Logger.log('====================================================');

  Logger.log(
    'FINAL CONTROLLED TEST RESULT:\n' +
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log('====================================================');
  Logger.log('SALES ORDER WAS NOT MODIFIED');
  Logger.log('SHEET WAS NOT MODIFIED');
  Logger.log('====================================================');

  return result;
}



function enp_testRelinkDedicatedGroupOnSO584714() {
  /*
   * CONTROLLED TEST ONLY
   *
   * Changes:
   *   SO 584714 / Id 26444
   *   Line 135389
   *   Item Group 42686 -> dedicated Item Group 43038
   *
   * Does NOT:
   *   - replace F0694
   *   - replace F0368
   *   - write to Google Sheets
   *   - create another Item Group
   */

  const SO_ID = 26444;
  const EXPECTED_SO_NUMBER = '584714';
  const OLD_GROUP_ID = 42686;
  const DEDICATED_GROUP_ID = 43038;
  const EXPECTED_GROUP_LINE_ID = 135389;

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART — CONTROLLED SO GROUP RELINK TEST');
  Logger.log('SO WRITE: YES — ONE');
  Logger.log('SHEET WRITES: NONE');
  Logger.log('F0694 REPLACEMENT: NO');
  Logger.log('F0368 REPLACEMENT: NO');
  Logger.log('====================================================');

  /*
   * =========================================================
   * HELPERS
   * =========================================================
   */

  function idName_(obj) {
    if (!obj) return null;

    const id = enp_num_(obj.id ?? obj.Id);
    const name = enp_norm_(obj.name ?? obj.Name);

    if (!id && !name) return null;

    return {
      Id: id || 0,
      Name: name || ''
    };
  }

  function customer_(obj) {
    if (!obj) return null;

    const id = enp_num_(obj.id ?? obj.Id);
    if (!id) return null;

    return {
      Id: id,
      Number: enp_norm_(obj.number ?? obj.Number),
      Name: enp_norm_(obj.name ?? obj.Name)
    };
  }

  function uom_(obj) {
    if (!obj) return null;

    const id = enp_num_(obj.id ?? obj.Id);
    if (!id) return null;

    return {
      Id: id,
      Name: enp_norm_(obj.name ?? obj.Name),
      ExtendedName: enp_norm_(
        obj.extendedName ??
        obj.ExtendedName
      )
    };
  }

  function customField_(cf) {
    if (!cf) return null;

    return {
      Id: enp_num_(cf.id ?? cf.Id) || 0,

      Name:
        enp_norm_(
          cf.name ??
          cf.Name
        ),

      FieldType:
        idName_(
          cf.fieldType ??
          cf.FieldType
        ),

      SourceId:
        enp_num_(
          cf.sourceId ??
          cf.SourceId
        ) || 0,

      Value:
        cf.value ??
        cf.Value ??
        null,

      ValueText:
        cf.valueText ??
        cf.ValueText ??
        null,

      IsRequired:
        cf.isRequired === true ||
        cf.IsRequired === true
    };
  }

  function normalizeGroupSpec_(children) {
    return (children || [])
      .map(function(child) {
        const item =
          child.item ||
          child.Item ||
          {};

        return {
          itemId:
            enp_num_(
              item.id ??
              item.Id
            ) || 0,

          qty:
            enp_num_(
              child.qty ??
              child.Qty
            ) || 0
        };
      })
      .sort(function(a, b) {
        if (a.itemId !== b.itemId) {
          return a.itemId - b.itemId;
        }

        return a.qty - b.qty;
      });
  }

  /*
   * =========================================================
   * 1. LOAD CURRENT SO
   * =========================================================
   */

  const before =
    enp_getSalesOrder_(SO_ID);

  if (!before) {
    throw new Error(
      'Could not load Sales Order ' +
      SO_ID +
      '.'
    );
  }

  const soNumber =
    String(
      before.orderNumber ??
      before.OrderNumber ??
      ''
    ).trim();

  if (soNumber !== EXPECTED_SO_NUMBER) {
    throw new Error(
      'SAFETY STOP: expected SO ' +
      EXPECTED_SO_NUMBER +
      ' but API returned ' +
      soNumber +
      '.'
    );
  }

  const lineItems =
    enp_getSalesOrderLineItems_(before);

  if (lineItems.length !== 4) {
    throw new Error(
      'SAFETY STOP: expected 4 SO lines but found ' +
      lineItems.length +
      '.'
    );
  }

  /*
   * =========================================================
   * 2. CONFIRM F0694 + F0368 ARE STILL UNTOUCHED
   * =========================================================
   */

  const f0694Before =
    lineItems.find(function(li) {
      const desc =
        String(
          li.description ??
          li.Description ??
          ''
        ).toUpperCase();

      return desc.indexOf('F0694') >= 0;
    });

  const f0368Before =
    lineItems.find(function(li) {
      const desc =
        String(
          li.description ??
          li.Description ??
          ''
        ).toUpperCase();

      return desc.indexOf('F0368') >= 0;
    });

  if (!f0694Before) {
    throw new Error(
      'SAFETY STOP: F0694 line was not found.'
    );
  }

  if (!f0368Before) {
    throw new Error(
      'SAFETY STOP: F0368 line was not found.'
    );
  }

  const f0694BeforeItemId =
    enp_num_(
      f0694Before.item &&
      f0694Before.item.id
    );

  const f0368BeforeItemId =
    enp_num_(
      f0368Before.item &&
      f0368Before.item.id
    );

  if (
    f0694BeforeItemId !==
    ENP.VALUES.PLACEHOLDER_ITEM_ID
  ) {
    throw new Error(
      'SAFETY STOP: F0694 is no longer ENTERNEWPART.'
    );
  }

  if (
    f0368BeforeItemId !==
    ENP.VALUES.PLACEHOLDER_ITEM_ID
  ) {
    throw new Error(
      'SAFETY STOP: F0368 is no longer ENTERNEWPART.'
    );
  }

  /*
   * =========================================================
   * 3. LOAD VERIFIED DEDICATED ITEM GROUP
   * =========================================================
   */

  const dedicatedResponse =
    enp_strivenFetch_(
      '/v1/items/' +
      DEDICATED_GROUP_ID,
      {
        method: 'get'
      }
    );

  const dedicated =
    dedicatedResponse &&
    dedicatedResponse.Data
      ? dedicatedResponse.Data
      : dedicatedResponse;

  if (!dedicated) {
    throw new Error(
      'Dedicated Item Group ' +
      DEDICATED_GROUP_ID +
      ' could not be loaded.'
    );
  }

  const dedicatedType =
    dedicated.itemType ||
    dedicated.ItemType ||
    {};

  if (
    enp_num_(
      dedicatedType.id ??
      dedicatedType.Id
    ) !== 5
  ) {
    throw new Error(
      'SAFETY STOP: Item ' +
      DEDICATED_GROUP_ID +
      ' is not an Item Group.'
    );
  }

  const dedicatedMasterChildren =
    dedicated.groupItems ||
    dedicated.GroupItems ||
    [];

  const dedicatedSpec =
    normalizeGroupSpec_(
      dedicatedMasterChildren
    );

  Logger.log(
    'DEDICATED MASTER SPEC: ' +
    JSON.stringify(dedicatedSpec)
  );

  /*
   * =========================================================
   * 4. FIND EXACT EXISTING DYNAMIC GROUP LINE
   * =========================================================
   */

  const groupMatches =
    lineItems.filter(function(li) {
      const lineId =
        enp_num_(
          li.id ??
          li.Id
        );

      const parent =
        li.item ||
        li.Item ||
        {};

      const parentId =
        enp_num_(
          parent.id ??
          parent.Id
        );

      const children =
        li.itemGroupLineItems ||
        li.ItemGroupLineItems ||
        [];

      if (
        lineId !== EXPECTED_GROUP_LINE_ID ||
        parentId !== OLD_GROUP_ID ||
        !Array.isArray(children) ||
        !children.length
      ) {
        return false;
      }

      const currentSpec =
        normalizeGroupSpec_(children);

      return (
        JSON.stringify(currentSpec) ===
        JSON.stringify(dedicatedSpec)
      );
    });

  if (groupMatches.length !== 1) {
    throw new Error(
      'SAFETY STOP: expected exactly one matching dynamic group line. Found ' +
      groupMatches.length +
      '.'
    );
  }

  const groupLine =
    groupMatches[0];

  const originalGroupChildren =
    JSON.stringify(
      normalizeGroupSpec_(
        groupLine.itemGroupLineItems ||
        groupLine.ItemGroupLineItems ||
        []
      )
    );

  Logger.log(
    'MATCHED GROUP LINE BEFORE: ' +
    JSON.stringify(groupLine)
  );

  /*
   * =========================================================
   * 5. CHANGE ONLY THE GROUP PARENT ITEM
   * =========================================================
   */

  groupLine.item = {
    id: DEDICATED_GROUP_ID,
    name:
      dedicated.name ||
      dedicated.Name ||
      'Venting Package - SO 584714'
  };

  /*
   * Child lines stay exactly as they exist on the SO.
   *
   * These children have already been verified as matching
   * dedicated master 43038.
   */

  /*
   * =========================================================
   * 6. DETERMINE DEFAULT INVENTORY LOCATION
   * =========================================================
   */

  const props =
    PropertiesService.getScriptProperties();

  const fallbackLocationId =
    enp_num_(
      props.getProperty(
        ENP.PROPS.DEFAULT_LOCATION_ID
      )
    );

  if (!fallbackLocationId) {
    throw new Error(
      'Missing default inventory location Script Property.'
    );
  }

  /*
   * =========================================================
   * 7. BUILD COMPLETE LINE PAYLOADS
   * =========================================================
   */

  const payloadLines =
    lineItems.map(function(li) {
      const itemObj =
        li.item ||
        li.Item ||
        {};

      const itemId =
        enp_num_(
          itemObj.id ??
          itemObj.Id
        );

      if (!itemId) {
        throw new Error(
          'SO line is missing Item Id.'
        );
      }

      const sourceLocation =
        li.inventoryLocation ||
        li.InventoryLocation ||
        null;

      const sourceLocationId =
        sourceLocation
          ? enp_num_(
              sourceLocation.id ??
              sourceLocation.Id
            )
          : null;

      const finalLocation = {
        Id:
          sourceLocationId ||
          fallbackLocationId,

        Name:
          sourceLocationId
            ? enp_norm_(
                sourceLocation.name ??
                sourceLocation.Name
              )
            : ''
      };

      const sourceChildren =
        li.itemGroupLineItems ||
        li.ItemGroupLineItems;

      const out = {
        Id:
          enp_num_(
            li.id ??
            li.Id
          ) || 0,

        Item: {
          Id: itemId,
          Name:
            enp_norm_(
              itemObj.name ??
              itemObj.Name
            )
        },

        InventoryLocation:
          finalLocation,

        Description:
          li.description ??
          li.Description ??
          '',

        Qty:
          enp_num_(
            li.qty ??
            li.Qty ??
            li.quantity ??
            li.Quantity
          ) || 0,

        UnitOfMeasure:
          uom_(
            li.unitOfMeasure ??
            li.UnitOfMeasure
          ),

        Price:
          enp_num_(
            li.price ??
            li.Price
          ) || 0,

        ShippingPrice:
          enp_num_(
            li.shippingPrice ??
            li.ShippingPrice
          ) || 0,

        Taxable:
          li.taxable !== undefined
            ? !!li.taxable
            : !!li.Taxable,

        FulfillmentDate:
          li.fulfillmentDate ??
          li.FulfillmentDate ??
          null,

        Class:
          idName_(
            li.class ??
            li.Class
          )
      };

      /*
       * Only include ItemGroupLineItems for actual
       * existing group lines.
       */
      if (
        Array.isArray(sourceChildren) &&
        sourceChildren.length
      ) {
        out.ItemGroupLineItems =
          sourceChildren.map(function(g) {
            const gItem =
              g.item ||
              g.Item ||
              {};

            const gLocation =
              g.inventoryLocation ||
              g.InventoryLocation ||
              null;

            const gLocationId =
              gLocation
                ? enp_num_(
                    gLocation.id ??
                    gLocation.Id
                  )
                : null;

            return {
              Id:
                enp_num_(
                  g.id ??
                  g.Id
                ) || 0,

              Item: {
                Id:
                  enp_num_(
                    gItem.id ??
                    gItem.Id
                  ),

                Name:
                  enp_norm_(
                    gItem.name ??
                    gItem.Name
                  )
              },

              Qty:
                enp_num_(
                  g.qty ??
                  g.Qty
                ) || 0,

              UnitOfMeasure:
                uom_(
                  g.unitOfMeasure ??
                  g.UnitOfMeasure
                ),

              Price:
                enp_num_(
                  g.price ??
                  g.Price
                ) || 0,

              Class:
                idName_(
                  g.class ??
                  g.Class
                ),

              InventoryLocation: {
                Id:
                  gLocationId ||
                  fallbackLocationId,

                Name:
                  gLocationId
                    ? enp_norm_(
                        gLocation.name ??
                        gLocation.Name
                      )
                    : ''
              }
            };
          });
      }

      /*
       * Do not send line CustomColumns.
       */
      return out;
    });

  /*
   * =========================================================
   * 8. PRESERVE ALL SALES ORDER CUSTOM FIELDS
   * =========================================================
   */

  const sourceCustomFields =
    before.customFields ||
    before.CustomFields ||
    [];

  if (!Array.isArray(sourceCustomFields)) {
    throw new Error(
      'Sales Order CustomFields were not returned as an array.'
    );
  }

  const payloadCustomFields =
    sourceCustomFields
      .map(customField_)
      .filter(Boolean);

  const cf775 =
    payloadCustomFields.find(function(cf) {
      return cf.Id === 775;
    });

  const cf831 =
    payloadCustomFields.find(function(cf) {
      return cf.Id === 831;
    });

  if (
    !cf775 ||
    String(cf775.Value) !== '478'
  ) {
    throw new Error(
      'SAFETY STOP: required Custom Field 775 is not value 478.'
    );
  }

  if (
    !cf831 ||
    String(cf831.Value) !== '559'
  ) {
    throw new Error(
      'SAFETY STOP: required Custom Field 831 is not value 559.'
    );
  }

  /*
   * =========================================================
   * 9. BUILD COMPLETE SO PAYLOAD
   * =========================================================
   */

  const payload = {
    Id:
      SO_ID,

    Type:
      idName_(
        before.type ??
        before.Type
      ),

    Customer:
      customer_(
        before.customer ??
        before.Customer
      ),

    Status:
      idName_(
        before.status ??
        before.Status
      ),

    BillToLocation:
      idName_(
        before.billToLocation ??
        before.BillToLocation
      ),

    ShipToLocation:
      idName_(
        before.shipToLocation ??
        before.ShipToLocation
      ),

    ShipVia:
      idName_(
        before.shipVia ??
        before.ShipVia
      ),

    Contact:
      idName_(
        before.contact ??
        before.Contact
      ),

    Project:
      idName_(
        before.project ??
        before.Project
      ),

    SalesRep:
      idName_(
        before.salesRep ??
        before.SalesRep
      ),

    OrderDate:
      before.orderDate ??
      before.OrderDate ??
      null,

    OrderNumber:
      before.orderNumber ??
      before.OrderNumber ??
      '',

    OrderName:
      before.orderName ??
      before.OrderName ??
      '',

    CustomerPONumber:
      before.customerPONumber ??
      before.CustomerPONumber ??
      null,

    ToBePrinted:
      before.toBePrinted !== undefined
        ? !!before.toBePrinted
        : !!before.ToBePrinted,

    TargetDate:
      before.targetDate ??
      before.TargetDate ??
      null,

    PaymentTerm:
      idName_(
        before.paymentTerm ??
        before.PaymentTerm
      ),

    ARGLAccount:
      idName_(
        before.arglAccount ??
        before.ARGLAccount
      ),

    InvoiceFormat:
      idName_(
        before.invoiceFormat ??
        before.InvoiceFormat
      ),

    LineItemsClass:
      idName_(
        before.lineItemsClass ??
        before.LineItemsClass
      ),

    SalesTax:
      idName_(
        before.salesTax ??
        before.SalesTax
      ),

    InvoiceStatus:
      idName_(
        before.invoiceStatus ??
        before.InvoiceStatus
      ),

    IsChangeOrder:
      before.isChangeOrder !== undefined
        ? !!before.isChangeOrder
        : !!before.IsChangeOrder,

    ParentId:
      enp_num_(
        before.parentId ??
        before.ParentId
      ) || 0,

    IsRecurring:
      before.isRecurring !== undefined
        ? !!before.isRecurring
        : !!before.IsRecurring,

    CustomFields:
      payloadCustomFields,

    LineItems:
      payloadLines
  };

  /*
   * Remove only null top-level object values.
   */
  Object.keys(payload).forEach(function(key) {
    if (payload[key] === null) {
      delete payload[key];
    }
  });

  Logger.log(
    'PAYLOAD SAFETY SUMMARY: ' +
    JSON.stringify({
      soId: payload.Id,
      lineCount: payload.LineItems.length,
      groupLineId: EXPECTED_GROUP_LINE_ID,
      oldGroupId: OLD_GROUP_ID,
      newGroupId: DEDICATED_GROUP_ID,
      customField775:
        cf775.Value,
      customField831:
        cf831.Value,
      lineItemsClass:
        payload.LineItemsClass
    })
  );

  /*
   * =========================================================
   * 10. POST SALES ORDER
   * =========================================================
   */

  Logger.log(
    'POSTING CONTROLLED SO UPDATE...'
  );

  enp_strivenFetch_(
    '/v1/sales-orders',
    {
      method: 'post',
      body: payload
    }
  );

  /*
   * =========================================================
   * 11. READ BACK AND VERIFY
   * =========================================================
   */

  const after =
    enp_getSalesOrder_(SO_ID);

  const afterLines =
    enp_getSalesOrderLineItems_(after);

  if (afterLines.length !== 4) {
    throw new Error(
      'VERIFY FAILED: SO line count changed from 4 to ' +
      afterLines.length +
      '.'
    );
  }

  const groupAfter =
    afterLines.find(function(li) {
      return (
        enp_num_(
          li.id ??
          li.Id
        ) === EXPECTED_GROUP_LINE_ID
      );
    });

  if (!groupAfter) {
    throw new Error(
      'VERIFY FAILED: Item Group line 135389 missing.'
    );
  }

  const groupAfterItem =
    groupAfter.item ||
    groupAfter.Item ||
    {};

  const groupAfterItemId =
    enp_num_(
      groupAfterItem.id ??
      groupAfterItem.Id
    );

  if (
    groupAfterItemId !==
    DEDICATED_GROUP_ID
  ) {
    throw new Error(
      'VERIFY FAILED: expected group parent ' +
      DEDICATED_GROUP_ID +
      ' but Striven saved ' +
      groupAfterItemId +
      '.'
    );
  }

  const afterGroupChildren =
    groupAfter.itemGroupLineItems ||
    groupAfter.ItemGroupLineItems ||
    [];

  const afterGroupSpec =
    normalizeGroupSpec_(
      afterGroupChildren
    );

  if (
    JSON.stringify(afterGroupSpec) !==
    JSON.stringify(dedicatedSpec)
  ) {
    throw new Error(
      'VERIFY FAILED: saved SO group children do not match dedicated group master.'
    );
  }

  /*
   * =========================================================
   * 12. VERIFY F0694 + F0368 WERE NOT CHANGED
   * =========================================================
   */

  const f0694After =
    afterLines.find(function(li) {
      return String(
        li.description ??
        li.Description ??
        ''
      )
        .toUpperCase()
        .indexOf('F0694') >= 0;
    });

  const f0368After =
    afterLines.find(function(li) {
      return String(
        li.description ??
        li.Description ??
        ''
      )
        .toUpperCase()
        .indexOf('F0368') >= 0;
    });

  if (
    !f0694After ||
    enp_num_(
      f0694After.item &&
      f0694After.item.id
    ) !== ENP.VALUES.PLACEHOLDER_ITEM_ID
  ) {
    throw new Error(
      'VERIFY FAILED: F0694 was unexpectedly changed.'
    );
  }

  if (
    !f0368After ||
    enp_num_(
      f0368After.item &&
      f0368After.item.id
    ) !== ENP.VALUES.PLACEHOLDER_ITEM_ID
  ) {
    throw new Error(
      'VERIFY FAILED: F0368 was unexpectedly changed.'
    );
  }

  /*
   * =========================================================
   * 13. VERIFY REQUIRED CUSTOM FIELDS
   * =========================================================
   */

  const afterCF =
    after.customFields ||
    after.CustomFields ||
    [];

  const after775 =
    afterCF.find(function(cf) {
      return Number(
        cf.id ??
        cf.Id
      ) === 775;
    });

  const after831 =
    afterCF.find(function(cf) {
      return Number(
        cf.id ??
        cf.Id
      ) === 831;
    });

  if (
    !after775 ||
    String(
      after775.value ??
      after775.Value
    ) !== '478'
  ) {
    throw new Error(
      'VERIFY FAILED: Custom Field 775 changed.'
    );
  }

  if (
    !after831 ||
    String(
      after831.value ??
      after831.Value
    ) !== '559'
  ) {
    throw new Error(
      'VERIFY FAILED: Custom Field 831 changed.'
    );
  }

  /*
   * =========================================================
   * 14. VERIFY LINE ITEMS CLASS
   * =========================================================
   */

  const afterClass =
    after.lineItemsClass ||
    after.LineItemsClass ||
    null;

  if (
    !afterClass ||
    enp_num_(
      afterClass.id ??
      afterClass.Id
    ) !== 17
  ) {
    throw new Error(
      'VERIFY FAILED: LineItemsClass Newmarket/17 was not preserved.'
    );
  }

  /*
   * =========================================================
   * SUCCESS
   * =========================================================
   */

  const result = {
    mode:
      'CONTROLLED_SO_GROUP_RELINK_TEST',

    writesPerformed:
      true,

    sheetWritesPerformed:
      false,

    salesOrderId:
      SO_ID,

    salesOrderNumber:
      EXPECTED_SO_NUMBER,

    groupLineId:
      EXPECTED_GROUP_LINE_ID,

    oldGroupItemId:
      OLD_GROUP_ID,

    dedicatedGroupItemId:
      DEDICATED_GROUP_ID,

    groupChildrenVerified:
      afterGroupSpec,

    f0694StillPlaceholder:
      true,

    f0368StillPlaceholder:
      true,

    customField775Preserved:
      true,

    customField831Preserved:
      true,

    lineItemsClassPreserved:
      true,

    verified:
      true
  };

  Logger.log('====================================================');

  Logger.log(
    'FINAL CONTROLLED SO TEST RESULT:\n' +
    JSON.stringify(
      result,
      null,
      2
    )
  );

  Logger.log('====================================================');
  Logger.log('DEDICATED GROUP RELINK VERIFIED');
  Logger.log('F0694 WAS NOT REPLACED');
  Logger.log('F0368 WAS NOT REPLACED');
  Logger.log('NO SHEET WRITE PERFORMED');
  Logger.log('====================================================');

  return result;
}


















function enp_diagSalesOrder26444PayloadRequirements() {
  const soId = 26444;

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART — SO PAYLOAD DIAGNOSTIC');
  Logger.log('SO ID: ' + soId);
  Logger.log('READ ONLY — NO WRITES');
  Logger.log('====================================================');

  const so = enp_getSalesOrder_(soId);

  if (!so) {
    throw new Error('Sales Order ' + soId + ' could not be loaded.');
  }

  /*
   * ---------------------------------------------------------
   * TOP-LEVEL CUSTOM FIELDS
   * ---------------------------------------------------------
   */
  const customFields =
    so.customFields ||
    so.CustomFields ||
    [];

  Logger.log('CUSTOM FIELD COUNT: ' + customFields.length);

  customFields.forEach(function(cf) {
    Logger.log(
      'CUSTOM FIELD: ' +
      JSON.stringify({
        id: cf.id ?? cf.Id ?? null,
        name: cf.name ?? cf.Name ?? '',
        value: cf.value ?? cf.Value ?? null,
        valueText: cf.valueText ?? cf.ValueText ?? null,
        sourceId: cf.sourceId ?? cf.SourceId ?? null,
        isRequired: cf.isRequired ?? cf.IsRequired ?? null
      })
    );
  });

  const cf775 = customFields.find(function(cf) {
    return Number(cf.id ?? cf.Id) === 775;
  });

  const cf831 = customFields.find(function(cf) {
    return Number(cf.id ?? cf.Id) === 831;
  });

  Logger.log('----------------------------------------------------');
  Logger.log('REQUIRED CUSTOM FIELD 775: ' + JSON.stringify(cf775 || null));
  Logger.log('REQUIRED CUSTOM FIELD 831: ' + JSON.stringify(cf831 || null));

  /*
   * ---------------------------------------------------------
   * LINE ITEMS
   * ---------------------------------------------------------
   */
  const lineItems = enp_getSalesOrderLineItems_(so);

  Logger.log('----------------------------------------------------');
  Logger.log('LINE ITEM COUNT: ' + lineItems.length);

  lineItems.forEach(function(li) {
    const item = li.item || li.Item || {};

    const itemId = Number(
      item.id ??
      item.Id ??
      0
    );

    const lineId = Number(
      li.id ??
      li.Id ??
      0
    );

    const invLoc =
      li.inventoryLocation ||
      li.InventoryLocation ||
      null;

    const groupLines =
      li.itemGroupLineItems ||
      li.ItemGroupLineItems ||
      [];

    Logger.log(
      'LINE SUMMARY: ' +
      JSON.stringify({
        lineId: lineId,
        itemId: itemId,
        itemName: item.name ?? item.Name ?? '',
        inventoryLocation: invLoc,
        qty: li.qty ?? li.Qty ?? li.quantity ?? li.Quantity ?? null,
        price: li.price ?? li.Price ?? null,
        class: li.class ?? li.Class ?? null,
        itemGroupLineItemCount:
          Array.isArray(groupLines)
            ? groupLines.length
            : 0
      })
    );

    /*
     * Venting Package
     */
    if (itemId === 42686) {
      Logger.log('----------------------------------------------------');
      Logger.log('VENTING PACKAGE SALES ORDER LINE');
      Logger.log('PARENT: ' + JSON.stringify(li));

      if (Array.isArray(groupLines)) {
        groupLines.forEach(function(g, index) {
          Logger.log(
            'VENTING GROUP CHILD #' +
            (index + 1) +
            ': ' +
            JSON.stringify({
              groupLineId:
                g.id ??
                g.Id ??
                null,

              item:
                g.item ??
                g.Item ??
                null,

              qty:
                g.qty ??
                g.Qty ??
                null,

              price:
                g.price ??
                g.Price ??
                null,

              inventoryLocation:
                g.inventoryLocation ??
                g.InventoryLocation ??
                null,

              class:
                g.class ??
                g.Class ??
                null,

              unitOfMeasure:
                g.unitOfMeasure ??
                g.UnitOfMeasure ??
                null
            })
          );
        });
      }
    }

    /*
     * F0694 placeholder / replacement line
     */
    const description = String(
      li.description ??
      li.Description ??
      ''
    );

    if (
      description.toUpperCase().indexOf('F0694') >= 0 ||
      itemId === 43032
    ) {
      Logger.log('----------------------------------------------------');
      Logger.log('F0694 TARGET LINE');
      Logger.log(JSON.stringify(li));
    }
  });

  /*
   * ---------------------------------------------------------
   * CURRENT ITEM GROUP MASTER
   * ---------------------------------------------------------
   */
  Logger.log('----------------------------------------------------');
  Logger.log('FETCHING CURRENT MASTER FOR ITEM GROUP 42686');

  const groupItemResponse =
    enp_strivenFetch_(
      '/v1/items/42686',
      {
        method: 'get'
      }
    );

  const groupItem =
    groupItemResponse &&
    groupItemResponse.Data
      ? groupItemResponse.Data
      : groupItemResponse;

  const masterChildren =
    groupItem &&
    (
      groupItem.groupItems ||
      groupItem.GroupItems
    )
      ? (
          groupItem.groupItems ||
          groupItem.GroupItems
        )
      : [];

  Logger.log(
    'MASTER GROUP CHILDREN: ' +
    JSON.stringify(
      masterChildren.map(function(g) {
        const item =
          g.item ||
          g.Item ||
          {};

        return {
          membershipId:
            g.id ??
            g.Id ??
            null,

          itemId:
            item.id ??
            item.Id ??
            null,

          itemName:
            item.name ??
            item.Name ??
            '',

          qty:
            g.qty ??
            g.Qty ??
            null,

          price:
            g.price ??
            g.Price ??
            null,

          inventoryLocation:
            g.inventoryLocation ??
            g.InventoryLocation ??
            null
        };
      })
    )
  );

  Logger.log('====================================================');
  Logger.log('DIAGNOSTIC COMPLETE — NO WRITES PERFORMED');
  Logger.log('====================================================');
}













function enp_smokeTest() {
  Logger.log('smoke test ok');
}

function enp_testAddItemGroup_CLEAN() {
  const soId = 24012;
  const itemId = 42454;
  const qty = 1;

  // --------------------------------------------------
  // 1) GET SALES ORDER
  // --------------------------------------------------
  const so = enp_strivenFetch_('/v1/sales-orders/' + soId, {
    method: 'get'
  });

  if (!so || !so.id) {
    throw new Error('Sales order not found: ' + soId);
  }

  // --------------------------------------------------
  // 2) GET ITEM GROUP ITEM
  // --------------------------------------------------
  const itemRes = enp_strivenFetch_('/v1/items/' + itemId, {
    method: 'get'
  });

  const item = itemRes && itemRes.Data ? itemRes.Data : itemRes;
  if (!item || !item.id) {
    throw new Error('Item not found: ' + itemId);
  }

  const itemTypeName = String(
    (item.itemType && item.itemType.name) ||
    (item.ItemType && item.ItemType.Name) ||
    ''
  ).toLowerCase();

  if (itemTypeName !== 'item group') {
    throw new Error('Item ' + itemId + ' is not an Item Group.');
  }

  if (!Array.isArray(item.groupItems) || !item.groupItems.length) {
    throw new Error('Item Group ' + itemId + ' has no groupItems.');
  }

  // --------------------------------------------------
  // 3) BASE CLASS FOR NEW PARENT + CHILD LINES
  // --------------------------------------------------
  const baseClass =
    so.lineItemsClass ||
    (Array.isArray(so.lineItems) && so.lineItems.length ? so.lineItems[0].class : null);

  if (!baseClass || !baseClass.id) {
    throw new Error('Could not derive required line-item Class from sales order.');
  }

  const mappedBaseClass = {
    Id: Number(baseClass.id),
    Name: baseClass.name || ''
  };

  // --------------------------------------------------
  // 4) MAP EXISTING TOP-LEVEL CUSTOM FIELDS
  //     Preserve them exactly so required fields 775/831 stay present
  // --------------------------------------------------
  const soCustomFields = Array.isArray(so.customFields) ? so.customFields : [];

  const mappedCustomFields = soCustomFields.map(function (cf) {
    const out = {
      Id: Number(cf.id || 0),
      Name: cf.name || ''
    };

    if (cf.value !== undefined) out.Value = cf.value;
    if (cf.valueText !== undefined) out.ValueText = cf.valueText;

    if (cf.valueNumber !== undefined) out.ValueNumber = cf.valueNumber;
    if (cf.valueDate !== undefined) out.ValueDate = cf.valueDate;
    if (cf.booleanValue !== undefined) out.BooleanValue = cf.booleanValue;
    if (cf.optionId !== undefined) out.OptionId = cf.optionId;
    if (cf.optionIds !== undefined) out.OptionIds = cf.optionIds;
    if (cf.selectedOption !== undefined) out.SelectedOption = cf.selectedOption;
    if (cf.selectedOptions !== undefined) out.SelectedOptions = cf.selectedOptions;

    return out;
  });

  // sanity check for required fields
  const cfIds = mappedCustomFields.map(function (x) { return x.Id; });
  if (cfIds.indexOf(775) === -1) {
    throw new Error('SO is missing required Custom Field 775 in GET response.');
  }
  if (cfIds.indexOf(831) === -1) {
    throw new Error('SO is missing required Custom Field 831 in GET response.');
  }

  // --------------------------------------------------
  // 5) MAP EXISTING LINE ITEMS
  //     - remove invalid deposit line 42453 for this test
  //     - preserve current structure as much as possible
  // --------------------------------------------------
  const existingLines = Array.isArray(so.lineItems) ? so.lineItems : [];

  const mappedExistingLines = existingLines
    .filter(function (li) {
      return !(li.item && Number(li.item.id) === 42453);
    })
    .map(function (li) {
      const out = {
        Id: Number(li.id || 0),
        Item: li.item ? {
          Id: Number(li.item.id || 0),
          Name: li.item.name || ''
        } : null,
        Description: li.description != null ? li.description : '',
        Qty: Number(li.qty || 0),
        Price: Number(li.price || 0),
        ShippingPrice: Number(li.shippingPrice || 0),
        Taxable: !!li.taxable,
        FulfillmentDate: li.fulfillmentDate || null,
        UnitOfMeasure: li.unitOfMeasure ? {
          Id: Number(li.unitOfMeasure.id || 0),
          Name: li.unitOfMeasure.name || '',
          ExtendedName: li.unitOfMeasure.extendedName || ''
        } : null,
        Class: li.class ? {
          Id: Number(li.class.id || 0),
          Name: li.class.name || ''
        } : mappedBaseClass,
        InventoryLocation: li.inventoryLocation ? {
          Id: Number(li.inventoryLocation.id || 0),
          Name: li.inventoryLocation.name || ''
        } : null
      };

      if (Array.isArray(li.customColumns) && li.customColumns.length) {
        out.CustomColumns = li.customColumns.map(function (cc) {
          return {
            Id: Number(cc.id || 0),
            Name: cc.name || '',
            Value: cc.value !== undefined ? cc.value : null,
            ValueText: cc.valueText !== undefined ? cc.valueText : null
          };
        });
      }

      // preserve existing group children if any
      if (Array.isArray(li.itemGroupLineItems) && li.itemGroupLineItems.length) {
        out.ItemGroupLineItems = li.itemGroupLineItems.map(function (gi) {
          return {
            Id: Number(gi.id || 0),
            Item: gi.item ? {
              Id: Number(gi.item.id || 0),
              Name: gi.item.name || ''
            } : null,
            Qty: Number(gi.qty || 0),
            Price: Number(gi.price || 0),
            InventoryLocation: gi.inventoryLocation ? {
              Id: Number(gi.inventoryLocation.id || 0),
              Name: gi.inventoryLocation.name || ''
            } : null,
            UnitOfMeasure: gi.unitOfMeasure ? {
              Id: Number(gi.unitOfMeasure.id || 0),
              Name: gi.unitOfMeasure.name || '',
              ExtendedName: gi.unitOfMeasure.extendedName || ''
            } : null,
            Class: gi.class ? {
              Id: Number(gi.class.id || 0),
              Name: gi.class.name || ''
            } : mappedBaseClass
          };
        });
      }

      return out;
    });

  // --------------------------------------------------
  // 6) BUILD NEW ITEM GROUP CHILD LINES
  //     Each child must also have Class
  // --------------------------------------------------
  const groupLines = item.groupItems.map(function (gi) {
    return {
      Id: 0,
      Item: {
        Id: Number(gi.item.id),
        Name: gi.item.name || ''
      },
      Qty: Number(gi.qty || 0) * Number(qty || 1),
      Price: Number(gi.price || 0),
      InventoryLocation: gi.inventoryLocation ? {
        Id: Number(gi.inventoryLocation.id || 0),
        Name: gi.inventoryLocation.name || ''
      } : null,
      UnitOfMeasure: gi.unitOfMeasure ? {
        Id: Number(gi.unitOfMeasure.id || 0),
        Name: gi.unitOfMeasure.name || '',
        ExtendedName: gi.unitOfMeasure.extendedName || ''
      } : null,
      Class: mappedBaseClass
    };
  });

  // --------------------------------------------------
  // 7) BUILD NEW PARENT ITEM GROUP LINE
  //     Parent also needs Class
  // --------------------------------------------------
  const newParentLine = {
    Id: 0,
    Item: {
      Id: Number(item.id),
      Name: item.name || ''
    },
    Description: item.name || '',
    Qty: Number(qty || 1),
    Price: Number(item.price || 0),
    ShippingPrice: Number(item.shippingPrice || 0),
    Taxable: item.taxable !== undefined ? !!item.taxable : true,
    FulfillmentDate: null,
    InventoryLocation: {
      Id: 21,
      Name: ''
    },
    Class: mappedBaseClass,
    ItemGroupLineItems: groupLines
  };

  // --------------------------------------------------
  // 8) FINAL PAYLOAD
  //     Preserve required SO-level custom fields
  // --------------------------------------------------
  const payload = {
    Id: Number(so.id),
    Type: so.type ? {
      Id: Number(so.type.id || 0),
      Name: so.type.name || ''
    } : null,
    Customer: so.customer ? {
      Id: Number(so.customer.id || 0),
      Number: so.customer.number || '',
      Name: so.customer.name || ''
    } : null,
    Status: so.status ? {
      Id: Number(so.status.id || 0),
      Name: so.status.name || ''
    } : null,
    PaymentTerm: so.paymentTerm ? {
      Id: Number(so.paymentTerm.id || 0),
      Name: so.paymentTerm.name || ''
    } : null,
    BillToLocation: so.billToLocation ? {
      Id: Number(so.billToLocation.id || 0),
      Name: so.billToLocation.name || ''
    } : null,
    ShipToLocation: so.shipToLocation ? {
      Id: Number(so.shipToLocation.id || 0),
      Name: so.shipToLocation.name || ''
    } : null,
    Contact: so.contact ? {
      Id: Number(so.contact.id || 0),
      Name: so.contact.name || ''
    } : null,
    SalesRep: so.salesRep ? {
      Id: Number(so.salesRep.id || 0),
      Name: so.salesRep.name || ''
    } : null,
    OrderDate: so.orderDate || null,
    OrderNumber: so.orderNumber || '',
    OrderName: so.orderName || '',
    ToBePrinted: !!so.toBePrinted,
    ARGLAccount: so.arglAccount ? {
      Id: Number(so.arglAccount.id || 0),
      Name: so.arglAccount.name || ''
    } : null,
    InvoiceFormat: so.invoiceFormat ? {
      Id: Number(so.invoiceFormat.id || 0),
      Name: so.invoiceFormat.name || ''
    } : null,
    SalesTax: so.salesTax ? {
      Id: Number(so.salesTax.id || 0),
      Name: so.salesTax.name || ''
    } : null,
    InvoiceStatus: so.invoiceStatus ? {
      Id: Number(so.invoiceStatus.id || 0),
      Name: so.invoiceStatus.name || ''
    } : null,
    IsChangeOrder: !!so.isChangeOrder,
    ParentId: Number(so.parentId || 0),
    IsRecurring: !!so.isRecurring,
    CustomFields: mappedCustomFields,
    LineItems: mappedExistingLines.concat([newParentLine])
  };

  Logger.log('FINAL CLEAN PAYLOAD: ' + JSON.stringify(payload, null, 2));

  const res = enp_strivenFetch_('/v1/sales-orders', {
    method: 'post',
    body: payload
  });

  Logger.log('SUCCESS: ' + JSON.stringify(res, null, 2));
  return res;
}








function enp_testCreateItemGroupFromSO() {
  const soId = 24012;

  // New item group you want to create
  const newGroupName = 'TEST SO BUILT GROUP';
  const newGroupItemNumber = 'TEST-SO-GROUP-001';

  // Striven Item Type Id for "Item Group"
  const itemGroupTypeId = 5;

  // Item ids to exclude from becoming child items
  const excludeItemIds = {
    42453: true, // Deposit
    36078: true  // Note Item
  };

  const so = enp_strivenFetch_('/v1/sales-orders/' + soId, {
    method: 'get'
  });

  if (!so || !so.id) {
    throw new Error('Sales order not found: ' + soId);
  }

  const lineItems = Array.isArray(so.lineItems) ? so.lineItems : [];
  if (!lineItems.length) {
    throw new Error('Sales order has no line items.');
  }

  const groupItems = lineItems
    .filter(function (li) {
      const itemId = li && li.item && Number(li.item.id || 0);
      if (!itemId) return false;
      if (excludeItemIds[itemId]) return false;
      if (li.itemGroupLineItems && li.itemGroupLineItems.length) return false; // skip parent group lines
      return true;
    })
    .map(function (li) {
      return {
        Id: 0,
        Item: {
          Id: Number(li.item.id),
          Name: li.item.name || ''
        },
        Qty: Number(li.qty || 0),
        Price: Number(li.price || 0),
        InventoryLocation: li.inventoryLocation
          ? {
              Id: Number(li.inventoryLocation.id || 0),
              Name: li.inventoryLocation.name || ''
            }
          : null,
        UnitOfMeasure: li.unitOfMeasure
          ? {
              Id: Number(li.unitOfMeasure.id || 0),
              Name: li.unitOfMeasure.name || '',
              ExtendedName: li.unitOfMeasure.extendedName || ''
            }
          : null
      };
    });

  if (!groupItems.length) {
    throw new Error('No valid SO lines found to build the item group.');
  }

  const payload = {
    Id: 0,
    ItemNumber: newGroupItemNumber,
    Name: newGroupName,
    Description: newGroupName,
    Active: true,
    Taxable: true,
    ItemType: {
      Id: itemGroupTypeId
    },
    groupItems: groupItems
  };

  Logger.log('CREATE ITEM GROUP PAYLOAD: ' + JSON.stringify(payload, null, 2));

  const res = enp_guardResolutionAsItemResponse_(enp_guardCreateOrResolveItem_(payload));

  Logger.log('CREATE ITEM GROUP RESPONSE: ' + JSON.stringify(res, null, 2));
  return res;
}



function enp_testReplaceItemsWithCreatedGroup() {
  const soId = 24012;
  const newGroupItemId = 42465;

  // These are the individual item ids to REMOVE from the SO
  // based on the item group you created.
  const itemIdsToReplace = {
    36051: true, // ASSEMBLY + DELIVERY
    26839: true, // Grill Head
    23490: true  // Cover
  };

  // --------------------------------------------------
  // 1) GET SALES ORDER
  // --------------------------------------------------
  const so = enp_strivenFetch_('/v1/sales-orders/' + soId, {
    method: 'get'
  });

  if (!so || !so.id) {
    throw new Error('Sales order not found: ' + soId);
  }

  // --------------------------------------------------
  // 2) GET NEW ITEM GROUP
  // --------------------------------------------------
  const itemRes = enp_strivenFetch_('/v1/items/' + newGroupItemId, {
    method: 'get'
  });

  const item = itemRes && itemRes.Data ? itemRes.Data : itemRes;

  if (!item || !item.id) {
    throw new Error('New item group not found: ' + newGroupItemId);
  }

  const itemTypeName = String(
    (item.itemType && item.itemType.name) ||
    (item.ItemType && item.ItemType.Name) ||
    ''
  ).toLowerCase();

  if (itemTypeName !== 'item group') {
    throw new Error('Item ' + newGroupItemId + ' is not an Item Group.');
  }

  if (!Array.isArray(item.groupItems) || !item.groupItems.length) {
    throw new Error('Item group ' + newGroupItemId + ' has no groupItems.');
  }

  // --------------------------------------------------
  // 3) BASE CLASS
  // --------------------------------------------------
  const firstLineWithClass = (so.lineItems || []).find(function (li) {
    return li && li.class && li.class.id;
  });

  if (!firstLineWithClass) {
    throw new Error('Could not derive required line-item Class from SO.');
  }

  const baseClass = {
    Id: Number(firstLineWithClass.class.id),
    Name: firstLineWithClass.class.name || ''
  };

  // --------------------------------------------------
  // 4) MAP SO CUSTOM FIELDS (preserve required ones)
  // --------------------------------------------------
  const soCustomFields = Array.isArray(so.customFields) ? so.customFields : [];

  const mappedCustomFields = soCustomFields.map(function (cf) {
    const out = {
      Id: Number(cf.id || 0),
      Name: cf.name || ''
    };

    if (cf.value !== undefined) out.Value = cf.value;
    if (cf.valueText !== undefined) out.ValueText = cf.valueText;
    if (cf.valueNumber !== undefined) out.ValueNumber = cf.valueNumber;
    if (cf.valueDate !== undefined) out.ValueDate = cf.valueDate;
    if (cf.booleanValue !== undefined) out.BooleanValue = cf.booleanValue;
    if (cf.optionId !== undefined) out.OptionId = cf.optionId;
    if (cf.optionIds !== undefined) out.OptionIds = cf.optionIds;
    if (cf.selectedOption !== undefined) out.SelectedOption = cf.selectedOption;
    if (cf.selectedOptions !== undefined) out.SelectedOptions = cf.selectedOptions;

    return out;
  });

  // --------------------------------------------------
  // 5) FILTER EXISTING SO LINES
  //    - remove deposit test line 42453
  //    - remove target individual child items
  //    - optionally remove older test group 42454
  // --------------------------------------------------
  const existingLines = Array.isArray(so.lineItems) ? so.lineItems : [];

  const keptLines = existingLines.filter(function (li) {
    const itemId = li && li.item ? Number(li.item.id || 0) : 0;

    if (!itemId) return true;

    if (itemId === 42453) return false; // old invalid deposit line
    if (itemId === 42454) return false; // old test item group line
    if (itemIdsToReplace[itemId]) return false; // remove child lines being replaced

    return true;
  });

  // --------------------------------------------------
  // 6) MAP REMAINING EXISTING LINES
  // --------------------------------------------------
  const mappedKeptLines = keptLines.map(function (li) {
    const out = {
      Id: Number(li.id || 0),
      Item: li.item ? {
        Id: Number(li.item.id || 0),
        Name: li.item.name || ''
      } : null,
      Description: li.description != null ? li.description : '',
      Qty: Number(li.qty || 0),
      Price: Number(li.price || 0),
      ShippingPrice: Number(li.shippingPrice || 0),
      Taxable: !!li.taxable,
      FulfillmentDate: li.fulfillmentDate || null,
      UnitOfMeasure: li.unitOfMeasure ? {
        Id: Number(li.unitOfMeasure.id || 0),
        Name: li.unitOfMeasure.name || '',
        ExtendedName: li.unitOfMeasure.extendedName || ''
      } : null,
      Class: li.class ? {
        Id: Number(li.class.id || 0),
        Name: li.class.name || ''
      } : baseClass,
      InventoryLocation: li.inventoryLocation ? {
        Id: Number(li.inventoryLocation.id || 0),
        Name: li.inventoryLocation.name || ''
      } : null
    };

    if (Array.isArray(li.customColumns) && li.customColumns.length) {
      out.CustomColumns = li.customColumns.map(function (cc) {
        return {
          Id: Number(cc.id || 0),
          Name: cc.name || '',
          Value: cc.value !== undefined ? cc.value : null,
          ValueText: cc.valueText !== undefined ? cc.valueText : null
        };
      });
    }

    if (Array.isArray(li.itemGroupLineItems) && li.itemGroupLineItems.length) {
      out.ItemGroupLineItems = li.itemGroupLineItems.map(function (gi) {
        return {
          Id: Number(gi.id || 0),
          Item: gi.item ? {
            Id: Number(gi.item.id || 0),
            Name: gi.item.name || ''
          } : null,
          Qty: Number(gi.qty || 0),
          Price: Number(gi.price || 0),
          InventoryLocation: gi.inventoryLocation ? {
            Id: Number(gi.inventoryLocation.id || 0),
            Name: gi.inventoryLocation.name || ''
          } : null,
          UnitOfMeasure: gi.unitOfMeasure ? {
            Id: Number(gi.unitOfMeasure.id || 0),
            Name: gi.unitOfMeasure.name || '',
            ExtendedName: gi.unitOfMeasure.extendedName || ''
          } : null,
          Class: gi.class ? {
            Id: Number(gi.class.id || 0),
            Name: gi.class.name || ''
          } : baseClass
        };
      });
    }

    return out;
  });

  // --------------------------------------------------
  // 7) BUILD NEW GROUP CHILD LINES
  // --------------------------------------------------
  const newGroupChildLines = item.groupItems.map(function (gi) {
    return {
      Id: 0,
      Item: {
        Id: Number(gi.item.id),
        Name: gi.item.name || ''
      },
      Qty: Number(gi.qty || 0),
      Price: Number(gi.price || 0),
      InventoryLocation: gi.inventoryLocation ? {
        Id: Number(gi.inventoryLocation.id || 0),
        Name: gi.inventoryLocation.name || ''
      } : null,
      UnitOfMeasure: gi.unitOfMeasure ? {
        Id: Number(gi.unitOfMeasure.id || 0),
        Name: gi.unitOfMeasure.name || '',
        ExtendedName: gi.unitOfMeasure.extendedName || ''
      } : null,
      Class: baseClass
    };
  });

  // --------------------------------------------------
  // 8) BUILD NEW GROUP PARENT LINE
  // --------------------------------------------------
  const newParentLine = {
    Id: 0,
    Item: {
      Id: Number(item.id),
      Name: item.name || ''
    },
    Description: item.name || '',
    Qty: 1,
    Price: Number(item.price || 0),
    ShippingPrice: Number(item.shippingPrice || 0),
    Taxable: item.taxable !== undefined ? !!item.taxable : true,
    FulfillmentDate: null,
    InventoryLocation: {
      Id: 21,
      Name: ''
    },
    Class: baseClass,
    ItemGroupLineItems: newGroupChildLines
  };

  // --------------------------------------------------
  // 9) FINAL PAYLOAD
  // --------------------------------------------------
  const payload = {
    Id: Number(so.id),
    Type: so.type ? {
      Id: Number(so.type.id || 0),
      Name: so.type.name || ''
    } : null,
    Customer: so.customer ? {
      Id: Number(so.customer.id || 0),
      Number: so.customer.number || '',
      Name: so.customer.name || ''
    } : null,
    Status: so.status ? {
      Id: Number(so.status.id || 0),
      Name: so.status.name || ''
    } : null,
    PaymentTerm: so.paymentTerm ? {
      Id: Number(so.paymentTerm.id || 0),
      Name: so.paymentTerm.name || ''
    } : null,
    BillToLocation: so.billToLocation ? {
      Id: Number(so.billToLocation.id || 0),
      Name: so.billToLocation.name || ''
    } : null,
    ShipToLocation: so.shipToLocation ? {
      Id: Number(so.shipToLocation.id || 0),
      Name: so.shipToLocation.name || ''
    } : null,
    Contact: so.contact ? {
      Id: Number(so.contact.id || 0),
      Name: so.contact.name || ''
    } : null,
    SalesRep: so.salesRep ? {
      Id: Number(so.salesRep.id || 0),
      Name: so.salesRep.name || ''
    } : null,
    OrderDate: so.orderDate || null,
    OrderNumber: so.orderNumber || '',
    OrderName: so.orderName || '',
    ToBePrinted: !!so.toBePrinted,
    ARGLAccount: so.arglAccount ? {
      Id: Number(so.arglAccount.id || 0),
      Name: so.arglAccount.name || ''
    } : null,
    InvoiceFormat: so.invoiceFormat ? {
      Id: Number(so.invoiceFormat.id || 0),
      Name: so.invoiceFormat.name || ''
    } : null,
    SalesTax: so.salesTax ? {
      Id: Number(so.salesTax.id || 0),
      Name: so.salesTax.name || ''
    } : null,
    InvoiceStatus: so.invoiceStatus ? {
      Id: Number(so.invoiceStatus.id || 0),
      Name: so.invoiceStatus.name || ''
    } : null,
    IsChangeOrder: !!so.isChangeOrder,
    ParentId: Number(so.parentId || 0),
    IsRecurring: !!so.isRecurring,
    CustomFields: mappedCustomFields,
    LineItems: mappedKeptLines.concat([newParentLine])
  };

  Logger.log('REPLACE WITH GROUP PAYLOAD: ' + JSON.stringify(payload, null, 2));

  const res = enp_strivenFetch_('/v1/sales-orders', {
    method: 'post',
    body: payload
  });

  Logger.log('REPLACE WITH GROUP RESPONSE: ' + JSON.stringify(res, null, 2));
  return res;
}

/***** ENP_SO_PUT_NOWRITE_DIAGNOSTIC_R2_1_BEGIN *****/

/**
 * ENTERNEWPART - SALES ORDER PUT ROUTE DIAGNOSTIC
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Confirm whether the project-native route
 *   PUT /v1/sales-orders/{id}
 * is actually recognized by the live Striven API.
 *
 * SAFETY
 * ----------------------------------------------------------
 * - DOES NOT use a real Sales Order ID.
 * - DOES NOT modify any sheet.
 * - DOES NOT call the production replacement function.
 * - Uses a deliberately impossible sentinel Sales Order ID.
 * - Logs the GET and PUT HTTP status/body so we can distinguish
 *   route support from validation/model errors.
 *
 * Run manually from Apps Script:
 *   enp_testSalesOrderPutEndpoint_NoWrite
 */
function enp_testSalesOrderPutEndpoint_NoWrite() {
  const sentinelId = 2147483647;
  const baseUrl = enp_getScriptProp_(ENP.PROPS.BASE_URL, true)
    .replace(/\/$/, '');
  const url = baseUrl + '/v1/sales-orders/' + sentinelId;
  const headers = enp_getStrivenHeaders_();

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART - SALES ORDER PUT ROUTE DIAGNOSTIC');
  Logger.log('MODE: NO REAL SALES ORDER WRITE');
  Logger.log('SENTINEL SO ID: ' + sentinelId);
  Logger.log('URL: ' + url);
  Logger.log('====================================================');

  const getRes = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  const getCode = getRes.getResponseCode();
  const getBody = getRes.getContentText();

  Logger.log('CONTROL GET HTTP: ' + getCode);
  Logger.log('CONTROL GET BODY: ' + getBody);

  const putPayload = {
    Id: sentinelId
  };

  const putRes = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    payload: JSON.stringify(putPayload),
    muteHttpExceptions: true
  });

  const putCode = putRes.getResponseCode();
  const putBody = putRes.getContentText();
  const putHeaders = putRes.getAllHeaders();

  Logger.log('PUT HTTP: ' + putCode);
  Logger.log('PUT BODY: ' + putBody);
  Logger.log('PUT RESPONSE HEADERS: ' + JSON.stringify(putHeaders));

  const result = {
    mode: 'NO_REAL_SO_WRITE',
    sentinelSalesOrderId: sentinelId,
    controlGetHttp: getCode,
    putHttp: putCode,
    putBody: putBody,
    allowHeader:
      putHeaders.Allow ||
      putHeaders.allow ||
      ''
  };

  Logger.log('RESULT: ' + JSON.stringify(result));
  Logger.log('====================================================');

  return result;
}

/***** ENP_SO_PUT_NOWRITE_DIAGNOSTIC_R2_1_END *****/
/***** ENP_SO_PUT_NOWRITE_DIAGNOSTIC_R2_1_BEGIN *****/

/**
 * ENTERNEWPART - SALES ORDER PUT ROUTE DIAGNOSTIC
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Confirm whether the project-native route
 *   PUT /v1/sales-orders/{id}
 * is actually recognized by the live Striven API.
 *
 * SAFETY
 * ----------------------------------------------------------
 * - DOES NOT use a real Sales Order ID.
 * - DOES NOT modify any sheet.
 * - DOES NOT call the production replacement function.
 * - Uses a deliberately impossible sentinel Sales Order ID.
 * - Logs the GET and PUT HTTP status/body so we can distinguish
 *   route support from validation/model errors.
 *
 * Run manually from Apps Script:
 *   enp_testSalesOrderPutEndpoint_NoWrite
 */
function enp_testSalesOrderPutEndpoint_NoWrite() {
  const sentinelId = 2147483647;
  const baseUrl = enp_getScriptProp_(ENP.PROPS.BASE_URL, true)
    .replace(/\/$/, '');
  const url = baseUrl + '/v1/sales-orders/' + sentinelId;
  const headers = enp_getStrivenHeaders_();

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART - SALES ORDER PUT ROUTE DIAGNOSTIC');
  Logger.log('MODE: NO REAL SALES ORDER WRITE');
  Logger.log('SENTINEL SO ID: ' + sentinelId);
  Logger.log('URL: ' + url);
  Logger.log('====================================================');

  const getRes = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });

  const getCode = getRes.getResponseCode();
  const getBody = getRes.getContentText();

  Logger.log('CONTROL GET HTTP: ' + getCode);
  Logger.log('CONTROL GET BODY: ' + getBody);

  const putPayload = {
    Id: sentinelId
  };

  const putRes = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    payload: JSON.stringify(putPayload),
    muteHttpExceptions: true
  });

  const putCode = putRes.getResponseCode();
  const putBody = putRes.getContentText();
  const putHeaders = putRes.getAllHeaders();

  Logger.log('PUT HTTP: ' + putCode);
  Logger.log('PUT BODY: ' + putBody);
  Logger.log('PUT RESPONSE HEADERS: ' + JSON.stringify(putHeaders));

  const result = {
    mode: 'NO_REAL_SO_WRITE',
    sentinelSalesOrderId: sentinelId,
    controlGetHttp: getCode,
    putHttp: putCode,
    putBody: putBody,
    allowHeader:
      putHeaders.Allow ||
      putHeaders.allow ||
      ''
  };

  Logger.log('RESULT: ' + JSON.stringify(result));
  Logger.log('====================================================');

  return result;
}

/***** ENP_SO_PUT_NOWRITE_DIAGNOSTIC_R2_1_END *****/

/***** ENP_END_TO_END_CONNECTIVITY_AUDIT_R2_4_BEGIN *****/
/**
 * READ-ONLY END-TO-END AUTOMATION AUDIT.
 * No Striven writes. No sheet writes. No property writes.
 */
function enp_auditEndToEndAutomation_NoWrite() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties().getProperties();
  const triggers = ScriptApp.getProjectTriggers();

  const functionStatus = {
    enp_pipelineTick: typeof enp_pipelineTick === 'function',
    enp_executeApprovedFullPipelineNow: typeof enp_executeApprovedFullPipelineNow === 'function',
    enp_syncItemsReport: typeof enp_syncItemsReport === 'function',
    enp_syncApprovedReport_: typeof enp_syncApprovedReport_ === 'function',
    enp_createItemsForApprovedPendingRows_: typeof enp_createItemsForApprovedPendingRows_ === 'function',
    enp_replaceLinesForApprovedReadyRows_: typeof enp_replaceLinesForApprovedReadyRows_ === 'function',
    enp_replaceSalesOrderItems_: typeof enp_replaceSalesOrderItems_ === 'function',
    enp_actionHubRunPendingBatch_: typeof enp_actionHubRunPendingBatch_ === 'function',
    enp_actionHubReplaceSalesOrderLine_: typeof enp_actionHubReplaceSalesOrderLine_ === 'function'
  };

  const requiredProps = [
    ENP.PROPS.BASE_URL,
    ENP.PROPS.CLIENT_ID,
    ENP.PROPS.CLIENT_SECRET,
    ENP.PROPS.APPROVED_REPORT_URL,
    ENP.PROPS.ITEMS_REPORT_URL,
    ENP.PROPS.DEFAULT_INCOME_GL_ID,
    ENP.PROPS.DEFAULT_INVENTORY_GL_ID,
    ENP.PROPS.DEFAULT_COGS_GL_ID,
    ENP.PROPS.DEFAULT_LOCATION_ID
  ];

  const propertyStatus = {};
  requiredProps.forEach(function(key) {
    propertyStatus[key] = !!props[key];
  });

  const triggerRows = triggers.map(function(t) {
    return {
      handler: t.getHandlerFunction ? t.getHandlerFunction() : '',
      source: String(t.getTriggerSource ? t.getTriggerSource() : ''),
      eventType: String(t.getEventType ? t.getEventType() : '')
    };
  });
  const pipelineTriggerCount = triggerRows.filter(function(t) {
    return t.handler === ENP.PIPELINE.TRIGGER_FUNCTION;
  }).length;

  const sheetNames = [
    ENP.SHEETS.APPROVED,
    ENP.SHEETS.ITEMS,
    ENP.SHEETS.HUB,
    ENP.SHEETS.LOGBOOK
  ];
  const sheetStatus = {};
  sheetNames.forEach(function(name) {
    const sh = ss.getSheetByName(name);
    sheetStatus[name] = sh
      ? { exists: true, rows: sh.getLastRow(), cols: sh.getLastColumn() }
      : { exists: false, rows: 0, cols: 0 };
  });

  const approved = ss.getSheetByName(ENP.SHEETS.APPROVED);
  const approvedStats = {
    placeholderRows: 0,
    awaitingItemCreation: 0,
    readyForReplacement: 0,
    alreadyReplaced: 0,
    failedRows: 0
  };

  if (approved && approved.getLastRow() >= 2 && approved.getLastColumn() >= 1) {
    const grid = approved.getDataRange().getValues();
    const headers = grid[0].map(enp_norm_);
    const col = enp_indexByHeader_(headers);

    for (let i = 1; i < grid.length; i++) {
      const row = grid[i];
      const itemNumber = col['ItemNumber'] != null ? enp_normUpper_(row[col['ItemNumber']]) : '';
      if (itemNumber !== enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) continue;

      approvedStats.placeholderRows++;
      const newItemId = col['NewItemId'] != null ? enp_num_(row[col['NewItemId']]) : null;
      const action = col['LastAction'] != null ? enp_normUpper_(row[col['LastAction']]) : '';

      if (action.indexOf('REPLACED') >= 0 || action === 'DONE') approvedStats.alreadyReplaced++;
      else if (action.indexOf('FAILED') >= 0) approvedStats.failedRows++;
      else if (newItemId) approvedStats.readyForReplacement++;
      else approvedStats.awaitingItemCreation++;
    }
  }

  const bridgeJournalKeys = Object.keys(props).filter(function(key) {
    return key.indexOf('ENP_ITEM_GROUP_MASTER_BRIDGE_R23_') === 0;
  });

  const result = {
    mode: 'READ_ONLY_END_TO_END_AUDIT',
    scriptId: ScriptApp.getScriptId(),
    configuredPipelineHandler: ENP.PIPELINE.TRIGGER_FUNCTION,
    configuredTriggerHours: ENP.PIPELINE.TRIGGER_HOURS,
    pipelineTriggerCount: pipelineTriggerCount,
    triggers: triggerRows,
    functions: functionStatus,
    propertiesPresent: propertyStatus,
    sheets: sheetStatus,
    approved: approvedStats,
    staleItemGroupBridgeJournals: bridgeJournalKeys,
    sourceRouting: {
      pipeline: 'enp_pipelineTick -> enp_executeApprovedFullPipelineNow -> create -> shared replacement engine',
      manual: 'enp_replaceSalesOrderLinesFromSelectedRows -> shared replacement engine',
      actionHub: 'ActionHub runner -> shared replacement engine',
      cf820: 'same Sales Order POST as item replacement'
    }
  };

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART END-TO-END AUTOMATION AUDIT — READ ONLY');
  Logger.log('RESULT: ' + JSON.stringify(result, null, 2));
  Logger.log('====================================================');
  return result;
}
/***** ENP_END_TO_END_CONNECTIVITY_AUDIT_R2_4_END *****/

