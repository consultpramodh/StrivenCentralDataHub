/************************************************************
 * APPS SCRIPT — 03_enternewpart_sync_and_actions.gs
 * ENTERNEWPART — REPORT SYNC + DIRECT SHEET ACTIONS
 *
 * PURPOSE
 * ----------------------------------------------------------
 * Unified logic for:
 * 1) Sync Approved report to Enternewpart
 * 2) Sync Quoted report to Enternewpart_Quoted
 * 3) Preserve action/result columns during refresh
 * 4) Create items from selected rows
 * 5) Replace sales-order placeholder lines from selected rows
 *
 * DEPENDS ON
 * ----------------------------------------------------------
 * 01_config_menu.gs
 * 02_striven_core.gs
 ************************************************************/


/* =========================================================
 * APPS SCRIPT — PUBLIC ENTRY POINTS
 * ========================================================= */

function enp_syncAllReports() {
  enp_syncItemsReport();
  enp_syncApprovedReport_();
  enp_syncQuotedReport_();

  SpreadsheetApp.getActive().toast(
    'Reports synced: Items, Approved, Quoted',
    'Enternewpart',
    5
  );
}

function enp_createItemsForActiveSheetSelection_(sh) {
  const ss = SpreadsheetApp.getActive();
  const ctx = enp_getSheetContext_(sh);
  enp_ensureActionColumns_(sh, ctx);
  const rows = enp_getSelectedRowNumbers_(sh);

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);
  enp_requireCols_(col, ['ItemDescription','LastAction','LastError','LastUpdated','NewItemId']);

  let created = 0, exists = 0, failed = 0, skipped = 0;

  rows.forEach(function(rowIdx) {
    const row = data[rowIdx - 1];
    const now = new Date();
    try {
      const currentNewId = enp_num_(row[col['NewItemId']]);
      if (currentNewId) { skipped++; return; }

      const payload = enp_buildItemPayloadFromSheetRow_(row, col);
      const resolution = enp_guardCreateOrResolveItem_(payload);
      enp_guardWriteResolutionToRow_(row, col, resolution, {
        itemNumber: payload.ItemNumber,
        itemName: payload.Name,
        price: payload.Price,
        cost: payload.Cost
      }, now);

      if (resolution.status === 'EXISTS') exists++;
      else created++;
    } catch (err) {
      row[col['LastAction']] = 'CREATE FAILED';
      row[col['LastError']] = String(err && err.message ? err.message : err);
      row[col['LastUpdated']] = now;
      failed++;
    }
    sh.getRange(rowIdx, 1, 1, headers.length).setValues([row]);
  });

  ss.toast('Create complete — CREATED=' + created + ' EXISTS=' + exists + ' FAIL=' + failed + ' SKIP=' + skipped, 'Enternewpart', 6);
  return { created: created, exists: exists, failed: failed, skipped: skipped };
}

function enp_replaceLinesForActiveSheetSelection_(sh) {
  const ss = SpreadsheetApp.getActive();
  const ctx = enp_getSheetContext_(sh);

  enp_ensureActionColumns_(sh, ctx);
  const rows = enp_getSelectedRowNumbers_(sh);

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(enp_norm_);
  const col = enp_indexByHeader_(headers);

  enp_requireCols_(col, [
    'SalesOrderSalesOrderId',
    'ItemNumber',
    'ItemDescription',
    'Quantity',
    'NewItemId',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]);

  let done = 0;
  let failed = 0;
  let blocked = 0;
  let skipped = 0;
  const jobsBySo = {};

  rows.forEach(function(rowIdx) {
    const row = data[rowIdx - 1];
    const now = new Date();

    try {
      const soId = enp_num_(row[col['SalesOrderSalesOrderId']]);
      const oldItemNumber = enp_norm_(row[col['ItemNumber']]);
      const rawDescription = enp_norm_(row[col['ItemDescription']]);
      const newItemId = enp_num_(row[col['NewItemId']]);
      const qty = enp_num_(row[col['Quantity']]);

      if (
        enp_normUpper_(oldItemNumber) !==
        enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)
      ) {
        skipped++;
        return;
      }

      const salesRepName =
        col['SalesOrderSalesRepFullName'] != null
          ? enp_norm_(row[col['SalesOrderSalesRepFullName']])
          : '';

      const salesRepEmail = enp_getSalesRepEmailByName_(salesRepName);

      if (!enp_isStandardDescriptionFormat_(rawDescription)) {
        enp_sendInvalidDescriptionEmailToSalesRep_({
          recipientEmail: salesRepEmail,
          salesRepName: salesRepName,
          soId: soId,
          soNumber:
            col['SalesOrderNumber'] != null
              ? row[col['SalesOrderNumber']]
              : '',
          description: rawDescription
        });

        throw new Error('ItemDescription is not in standard format.');
      }

      if (!soId) throw new Error('Missing SalesOrderSalesOrderId.');
      if (!newItemId) throw new Error('Missing NewItemId. Create item first.');

      const parsed = enp_parseDescription_(rawDescription);
      if (!parsed.itemNumber || !parsed.name) {
        throw new Error(
          'Could not parse labeled Item Number and Item Name from ItemDescription.'
        );
      }

      if (!jobsBySo[soId]) jobsBySo[soId] = [];

      jobsBySo[soId].push({
        key: String(rowIdx),
        rowIdx: rowIdx,
        soId: soId,
        soNumber:
          col['SalesOrderNumber'] != null
            ? enp_norm_(row[col['SalesOrderNumber']])
            : '',
        desiredItemNumber: parsed.itemNumber,
        desiredItemName: parsed.name,
        desiredPrice: parsed.price,
        desiredQty: qty,
        newItemId: newItemId
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      Logger.log(
        'REPLACE PRECHECK FAILED row=' + rowIdx +
        ' error=' + message +
        (err && err.stack ? '\n' + err.stack : '')
      );

      row[col['LastAction']] = 'REPLACE FAILED';
      row[col['LastError']] = message;
      row[col['LastUpdated']] = now;
      failed++;
    }
  });

  Object.keys(jobsBySo).forEach(function(soKey) {
    const soId = Number(soKey);
    const jobs = jobsBySo[soKey];

    try {
      const result = enp_replaceSalesOrderItems_(soId, jobs);
      const resultByKey = {};

      (result.replacements || []).forEach(function(r) {
        resultByKey[String(r.key)] = r;
      });

      if (result && result.blocked) {
        Logger.log(
          'ENTERNEWPART SO REPLACE BLOCKED so=' + soId +
          ' code=' + result.blockCode +
          ' message=' + result.blockMessage
        );

        jobs.forEach(function(job) {
          const row = data[job.rowIdx - 1];
          const r = resultByKey[String(job.key)] || {};

          row[col['LastAction']] =
            'ITEM READY - SO REPLACE BLOCKED' +
            (r.lineId ? ' LINE=' + r.lineId : '');
          row[col['LastError']] = result.blockMessage || result.blockCode || '';
          row[col['LastUpdated']] = new Date();
          blocked++;
        });
        return;
      }

      jobs.forEach(function(job) {
        const row = data[job.rowIdx - 1];
        const r = resultByKey[String(job.key)] || {};

        row[col['LastAction']] =
          'REPLACED SO=' + soId +
          (r.lineId ? ' LINE=' + r.lineId : '');
        row[col['LastError']] = '';
        row[col['LastUpdated']] = new Date();
        done++;
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      Logger.log(
        'REPLACE SO FAILED so=' + soId +
        ' rows=' + jobs.map(function(j) { return j.rowIdx; }).join(',') +
        ' error=' + message +
        (err && err.stack ? '\n' + err.stack : '')
      );

      jobs.forEach(function(job) {
        const row = data[job.rowIdx - 1];
        row[col['LastAction']] = 'REPLACE FAILED';
        row[col['LastError']] = message;
        row[col['LastUpdated']] = new Date();
        failed++;
      });
    }
  });

  rows.forEach(function(rowIdx) {
    sh.getRange(rowIdx, 1, 1, headers.length)
      .setValues([data[rowIdx - 1]]);
  });

  ss.toast(
    'Replace complete — OK=' + done +
    ' BLOCKED=' + blocked +
    ' FAIL=' + failed +
    ' SKIP=' + skipped,
    'Enternewpart',
    6
  );
}


/* =========================================================
 * APPS SCRIPT — REPORT SYNC
 * ========================================================= */

function enp_syncApprovedReport_() {
  const url = enp_getScriptProp_(ENP.PROPS.APPROVED_REPORT_URL, true);
  enp_syncReportToSheet_({
    url: url,
    sheetName: ENP.SHEETS.APPROVED,
    baseHeaders: ENP.APPROVED_HEADERS,
    actionHeaders: ENP.ACTION_HEADERS
  });
}

function enp_syncQuotedReport_() {
  const url = enp_getScriptProp_(ENP.PROPS.QUOTED_REPORT_URL, true);
  enp_syncReportToSheet_({
    url: url,
    sheetName: ENP.SHEETS.QUOTED,
    baseHeaders: ENP.APPROVED_HEADERS,
    actionHeaders: ENP.QUOTED_ACTION_HEADERS
  });
}

function enp_syncReportToSheet_(cfg) {
  const body = enp_fetchReportJson_(cfg.url);
  const rows = enp_extractReportRows_(body);

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(cfg.sheetName) || ss.insertSheet(cfg.sheetName);

  const existingGrid = sh.getDataRange().getValues();
  const existingHeaders = existingGrid.length ? existingGrid[0].map(enp_norm_) : [];
  const existingCol = enp_indexByHeader_(existingHeaders);

  const actionStateByKey = {};
  if (existingGrid.length > 1) {
    for (let i = 1; i < existingGrid.length; i++) {
      const row = existingGrid[i];
      const key = enp_makeRowKeyFromSheetRow_(row, existingCol);
      if (!key) continue;

      const state = {};
      (cfg.actionHeaders || []).forEach(h => {
        if (existingCol[h] != null) {
          state[h] = row[existingCol[h]];
        }
      });
      actionStateByKey[key] = state;
    }
  }

  const allHeaders = cfg.baseHeaders.concat(cfg.actionHeaders || []);
  const out = [allHeaders];

  rows.forEach(obj => {
    const rowMap = enp_normalizeReportObject_(obj);
    const rowKey = enp_makeRowKeyFromObject_(rowMap);
    const preserved = actionStateByKey[rowKey] || {};

    const outRow = [];
    cfg.baseHeaders.forEach(h => outRow.push(rowMap[h] != null ? rowMap[h] : ''));
    (cfg.actionHeaders || []).forEach(h => outRow.push(preserved[h] != null ? preserved[h] : ''));

    out.push(outRow);
  });

  sh.clearContents();
  sh.getRange(1, 1, out.length, allHeaders.length).setValues(out);
  sh.getRange(1, 1, 1, allHeaders.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}


/* =========================================================
 * APPS SCRIPT — REPORT HELPERS
 * ========================================================= */

function enp_fetchReportJson_(url) {
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code !== 200) {
    throw new Error('Report fetch failed: HTTP ' + code + ' — ' + text);
  }

  return JSON.parse(text);
}

function enp_extractReportRows_(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.data)) return body.data;
  if (body.Data && Array.isArray(body.Data)) return body.Data;
  if (body.Results && Array.isArray(body.Results)) return body.Results;
  return [];
}

function enp_normalizeReportObject_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => {
    out[String(k).trim()] = obj[k];
  });
  return out;
}

function enp_makeRowKeyFromObject_(obj) {
  const soId = enp_norm_(obj['SalesOrderSalesOrderId']);
  const itemId = enp_norm_(obj['ItemItemId']);
  const itemNumber = enp_normUpper_(obj['ItemNumber']);
  const qty = enp_norm_(obj['Quantity']);
  const desc = enp_normUpper_(obj['ItemDescription']);
  const price = enp_norm_(obj['Price']);

  if (!soId && !desc) return '';
  return [soId, itemId, itemNumber, qty, price, desc].join('|');
}

function enp_makeRowKeyFromSheetRow_(row, col) {
  if (!row || !col) return '';
  return enp_makeRowKeyFromObject_({
    SalesOrderSalesOrderId: col['SalesOrderSalesOrderId'] != null ? row[col['SalesOrderSalesOrderId']] : '',
    ItemItemId: col['ItemItemId'] != null ? row[col['ItemItemId']] : '',
    ItemNumber: col['ItemNumber'] != null ? row[col['ItemNumber']] : '',
    Quantity: col['Quantity'] != null ? row[col['Quantity']] : '',
    Price: col['Price'] != null ? row[col['Price']] : '',
    ItemDescription: col['ItemDescription'] != null ? row[col['ItemDescription']] : ''
  });
}


/* =========================================================
 * APPS SCRIPT — SHEET CONTEXT + COLUMNS
 * ========================================================= */

function enp_getSheetContext_(sh) {
  const name = sh.getName();

  if (name === ENP.SHEETS.APPROVED) {
    return {
      type: 'approved',
      actionHeaders: ENP.ACTION_HEADERS
    };
  }

  if (name === ENP.SHEETS.QUOTED) {
    return {
      type: 'quoted',
      actionHeaders: ENP.QUOTED_ACTION_HEADERS
    };
  }

  throw new Error('Unsupported sheet: ' + name);
}

function enp_ensureActionColumns_(sh, ctx) {
  enp_ensureHeaders_(sh, ctx.actionHeaders);
}


/* =========================================================
 * APPS SCRIPT — ITEM CREATE HELPERS
 * ========================================================= */

function enp_buildItemPayloadFromSheetRow_(row, col) {
  const props = PropertiesService.getScriptProperties();
  const rawDescription = col['ItemDescription'] != null ? row[col['ItemDescription']] : '';

  if (!enp_guardIsStandardDescription_(rawDescription)) {
    throw new Error(
      'ItemDescription is not in standard format. Required: Item Number:, Item Name:, Price:. Item creation blocked.'
    );
  }

  const parsed = enp_parseDescription_(rawDescription);

  const explicitNumber = col['NewItemNumber'] != null ? enp_norm_(row[col['NewItemNumber']]) : '';
  const explicitName = col['NewItemName'] != null ? enp_norm_(row[col['NewItemName']]) : '';
  const explicitPrice = col['NewItemPrice'] != null ? enp_num_(row[col['NewItemPrice']]) : null;
  const explicitCost = col['NewItemCost'] != null ? enp_num_(row[col['NewItemCost']]) : null;

  const itemNumber = explicitNumber || parsed.itemNumber || '';
  const name = explicitName || parsed.name || '';
  const price = explicitPrice != null ? explicitPrice : (parsed.price != null ? parsed.price : 0);
  const cost = explicitCost != null ? explicitCost : null;

  if (!itemNumber) throw new Error('Could not derive Item Number from ItemDescription.');
  if (!name) throw new Error('Could not derive Item Name from ItemDescription.');
  if (parsed.price == null && explicitPrice == null) throw new Error('Could not derive Price from ItemDescription.');

  if (enp_normUpper_(itemNumber) === enp_normUpper_(ENP.VALUES.PLACEHOLDER_ITEMNUMBER)) {
    throw new Error('Item number is still the placeholder ENTERNEWPART.');
  }

  const typeId =
    enp_num_(props.getProperty(ENP.PROPS.DEFAULT_ITEMTYPE_ID)) ||
    enp_num_(props.getProperty('ENTERNEWPART_DEFAULT_ITEM_TYPE_ID'));
  if (!typeId) throw new Error('Missing default item type id in Script Properties.');

  const payload = {
    Id: 0,
    ItemNumber: itemNumber,
    Name: name,
    Description: name + ' (' + itemNumber + ')',
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

function enp_extractItemId_(res) {
  if (!res) return null;
  if (typeof res === 'number') return res;
  if (res.Id) return res.Id;
  if (res.id) return res.id;
  if (res.Data && typeof res.Data === 'object') {
    if (res.Data.Id) return res.Data.Id;
    if (res.Data.id) return res.Data.id;
  }
  return null;
}

function enp_writeCreateResultToRow_(row, col, result) {
  if (col['NewItemId'] != null) row[col['NewItemId']] = result.newItemId || '';
  if (col['NewItemNumber'] != null) row[col['NewItemNumber']] = result.itemNumber || '';
  if (col['NewItemName'] != null) row[col['NewItemName']] = result.itemName || '';
  if (col['NewItemPrice'] != null) row[col['NewItemPrice']] = result.price != null ? result.price : '';
  if (col['NewItemCost'] != null) row[col['NewItemCost']] = result.cost != null ? result.cost : '';
  if (col['LastAction'] != null) row[col['LastAction']] = result.action || '';
  if (col['LastError'] != null) row[col['LastError']] = result.error || '';
  if (col['LastUpdated'] != null) row[col['LastUpdated']] = result.updated || '';
}


/* =========================================================
 * APPS SCRIPT — SALES ORDER REPLACE HELPERS
 * ========================================================= */

function enp_getSalesOrderLineItems_(so) {
  const c =
    so.lineItems ||
    so.LineItems ||
    (so.Data && (so.Data.lineItems || so.Data.LineItems)) ||
    [];
  return Array.isArray(c) ? c : [];
}

function enp_findTargetPlaceholderLine_(lineItems, opts) {
  opts = opts || {};

  const desiredItemNumber = enp_normalizeItemNumberForMatch_(
    opts.desiredItemNumber
  );
  const desiredQty = enp_num_(opts.desiredQty);
  const newItemId = enp_num_(opts.newItemId);
  const requestedLineId = enp_num_(opts.lineId);

  if (!desiredItemNumber) {
    throw new Error('Missing desired Item Number for Sales Order line match.');
  }

  /*
   * Prefer the actual Sales Order LineId whenever ActionHub already has it.
   * This is the older ENTERNEWPART matching rule and avoids guessing.
   */
  if (requestedLineId) {
    const direct = (lineItems || []).find(function(li) {
      return enp_num_(li.id != null ? li.id : li.Id) === requestedLineId;
    });

    if (direct) {
      const itemObj = direct.item || direct.Item || {};
      const itemId = enp_num_(itemObj.id != null ? itemObj.id : itemObj.Id);
      const directQty = enp_num_(
        direct.qty != null ? direct.qty :
        direct.Qty != null ? direct.Qty :
        direct.quantity != null ? direct.quantity : direct.Quantity
      );
      const desc = String(
        direct.description != null ? direct.description :
        direct.Description != null ? direct.Description : ''
      );

      if (
        (itemId === ENP.VALUES.PLACEHOLDER_ITEM_ID || itemId === newItemId) &&
        (desiredQty == null || directQty == null || Number(desiredQty) === Number(directQty)) &&
        enp_lineDescriptionMatchesExactItemNumber_(desc, desiredItemNumber)
      ) {
        return direct;
      }

      throw new Error(
        'ActionHub LineId ' + requestedLineId +
        ' exists on the SO but does not match the requested ENTERNEWPART item "' +
        desiredItemNumber + '".'
      );
    }
  }

  const placeholderMatches = [];
  const alreadyReplacedMatches = [];

  (lineItems || []).forEach(function(li) {
    const itemObj = (li && (li.item || li.Item)) || {};
    const itemId = enp_num_(itemObj.id != null ? itemObj.id : itemObj.Id);

    if (
      itemId !== ENP.VALUES.PLACEHOLDER_ITEM_ID &&
      itemId !== newItemId
    ) {
      return;
    }

    const liQty = enp_num_(
      li.qty != null ? li.qty :
      li.Qty != null ? li.Qty :
      li.quantity != null ? li.quantity : li.Quantity
    );

    if (
      desiredQty != null &&
      liQty != null &&
      Number(desiredQty) !== Number(liQty)
    ) {
      return;
    }

    const desc = String(
      li.description != null ? li.description :
      li.Description != null ? li.Description : ''
    );

    /* Match ONLY the labeled Item Number field, not incidental SKU mentions. */
    if (!enp_lineDescriptionMatchesExactItemNumber_(desc, desiredItemNumber)) {
      return;
    }

    if (itemId === ENP.VALUES.PLACEHOLDER_ITEM_ID) {
      placeholderMatches.push(li);
    } else if (newItemId && itemId === newItemId) {
      alreadyReplacedMatches.push(li);
    }
  });

  if (placeholderMatches.length === 1) return placeholderMatches[0];

  if (placeholderMatches.length > 1) {
    const ids = placeholderMatches
      .map(function(li) { return li.id || li.Id || ''; })
      .filter(Boolean)
      .join(', ');

    throw new Error(
      'Ambiguous exact Item Number match for "' + desiredItemNumber +
      '". Matching placeholder LineIds: ' + ids
    );
  }

  if (alreadyReplacedMatches.length === 1) return alreadyReplacedMatches[0];

  if (alreadyReplacedMatches.length > 1) {
    const ids = alreadyReplacedMatches
      .map(function(li) { return li.id || li.Id || ''; })
      .filter(Boolean)
      .join(', ');

    throw new Error(
      'Ambiguous already-replaced line match for "' + desiredItemNumber +
      '". Matching LineIds: ' + ids
    );
  }

  return null;
}

function enp_isPlaceholderDescription_(desc) {
  const t = enp_normUpper_(desc);
  return t.indexOf('ITEM NUMBER') >= 0 && t.indexOf('ITEM NAME') >= 0;
}

function enp_buildCleanLineDescription_(parsed) {
  const name = enp_norm_(parsed && parsed.name);
  const itemNumber = enp_norm_(parsed && parsed.itemNumber);

  if (name && itemNumber) {
    return name + ' (' + itemNumber + ')';
  }

  if (name) return name;

  if (itemNumber) return '(' + itemNumber + ')';

  return '';
}

function enp_setLineItemItemId_(li, newItemId) {
  if (li.item && typeof li.item === 'object') {
    li.item.id = newItemId;
    if (li.item.Id != null) li.item.Id = newItemId;
  }
  if (li.Item && typeof li.Item === 'object') {
    li.Item.Id = newItemId;
    if (li.Item.id != null) li.Item.id = newItemId;
  }
}

function enp_setLineItemPrice_(li, price) {
  if ('price' in li) li.price = price;
  if ('Price' in li) li.Price = price;
  if ('unitPrice' in li) li.unitPrice = price;
  if ('UnitPrice' in li) li.UnitPrice = price;
}

function enp_buildSalesOrderUpsertPayload_(so, lineItems) {
  if (!so) {
    throw new Error('Cannot build Sales Order payload: missing SO.');
  }

  const soId = enp_num_(so.id != null ? so.id : so.Id);
  if (!soId) {
    throw new Error('Cannot build Sales Order payload: missing SO Id.');
  }

  const soLineClass = so.lineItemsClass || so.LineItemsClass || null;

  const mappedLines = (lineItems || []).map(function(li) {
    const itemObj = li.item || li.Item || {};
    const itemId = enp_num_(itemObj.id != null ? itemObj.id : itemObj.Id);

    if (!itemId) {
      throw new Error(
        'Cannot build Sales Order payload: line ' +
        (li.id || li.Id || '') + ' is missing Item Id.'
      );
    }

    const lineClass = li.class || li.Class || soLineClass || null;
    const out = {
      Id: enp_num_(li.id != null ? li.id : li.Id) || 0,
      Item: {
        Id: itemId,
        Name: enp_norm_(itemObj.name != null ? itemObj.name : itemObj.Name)
      },
      Description:
        li.description != null ? li.description :
        li.Description != null ? li.Description : '',
      Qty: enp_num_(
        li.qty != null ? li.qty :
        li.Qty != null ? li.Qty :
        li.quantity != null ? li.quantity :
        li.Quantity
      ) || 0,
      Price: enp_num_(li.price != null ? li.price : li.Price) || 0,
      ShippingPrice:
        enp_num_(li.shippingPrice != null ? li.shippingPrice : li.ShippingPrice) || 0,
      Taxable:
        li.taxable !== undefined ? !!li.taxable :
        li.Taxable !== undefined ? !!li.Taxable : true,
      FulfillmentDate:
        li.fulfillmentDate !== undefined ? li.fulfillmentDate :
        li.FulfillmentDate !== undefined ? li.FulfillmentDate : null
    };

    const invObj = li.inventoryLocation || li.InventoryLocation || null;
    const mappedInv = enp_mapIdNameForPost_(invObj);
    if (mappedInv && mappedInv.Id) out.InventoryLocation = mappedInv;

    const uom = enp_mapUomForPost_(li.unitOfMeasure || li.UnitOfMeasure);
    if (uom) out.UnitOfMeasure = uom;

    const mappedClass = enp_mapIdNameForPost_(lineClass);
    if (mappedClass && mappedClass.Id) out.Class = mappedClass;

    const children = li.itemGroupLineItems || li.ItemGroupLineItems || [];
    if (Array.isArray(children) && children.length) {
      out.ItemGroupLineItems = children.map(function(g) {
        const gItem = g.item || g.Item || {};
        const gItemId = enp_num_(gItem.id != null ? gItem.id : gItem.Id);
        if (!gItemId) {
          throw new Error(
            'Item Group child on SO line ' + out.Id + ' is missing Item Id.'
          );
        }

        const childOut = {
          Id: enp_num_(g.id != null ? g.id : g.Id) || 0,
          Item: {
            Id: gItemId,
            Name: enp_norm_(gItem.name != null ? gItem.name : gItem.Name)
          },
          Qty: enp_num_(g.qty != null ? g.qty : g.Qty) || 0,
          Price: enp_num_(g.price != null ? g.price : g.Price) || 0
        };

        const gLoc = enp_mapIdNameForPost_(g.inventoryLocation || g.InventoryLocation);
        if (gLoc && gLoc.Id) childOut.InventoryLocation = gLoc;

        const gUom = enp_mapUomForPost_(g.unitOfMeasure || g.UnitOfMeasure);
        if (gUom) childOut.UnitOfMeasure = gUom;

        const gClass = enp_mapIdNameForPost_(g.class || g.Class || lineClass || null);
        if (gClass && gClass.Id) childOut.Class = gClass;

        return childOut;
      });
    }

    return out;
  });

  const customFields = so.customFields || so.CustomFields || [];

  const payload = {
    Id: soId,
    Type: enp_mapIdNameForPost_(so.type || so.Type),
    Customer: enp_mapCustomerForPost_(so.customer || so.Customer),
    Status: enp_mapIdNameForPost_(so.status || so.Status),
    PaymentTerm: enp_mapIdNameForPost_(so.paymentTerm || so.PaymentTerm),
    BillToLocation: enp_mapIdNameForPost_(so.billToLocation || so.BillToLocation),
    ShipToLocation: enp_mapIdNameForPost_(so.shipToLocation || so.ShipToLocation),
    ShipVia: enp_mapIdNameForPost_(so.shipVia || so.ShipVia),
    Contact: enp_mapIdNameForPost_(so.contact || so.Contact),
    Project: enp_mapIdNameForPost_(so.project || so.Project),
    SalesRep: enp_mapIdNameForPost_(so.salesRep || so.SalesRep),
    OrderDate: so.orderDate != null ? so.orderDate : so.OrderDate,
    OrderNumber: so.orderNumber != null ? so.orderNumber : so.OrderNumber,
    OrderName: so.orderName != null ? so.orderName : so.OrderName,
    CustomerPONumber:
      so.customerPONumber !== undefined ? so.customerPONumber : so.CustomerPONumber,
    ToBePrinted:
      so.toBePrinted !== undefined ? !!so.toBePrinted : !!so.ToBePrinted,
    TargetDate:
      so.targetDate !== undefined ? so.targetDate : so.TargetDate,
    ARGLAccount: enp_mapIdNameForPost_(so.arglAccount || so.ARGLAccount),
    InvoiceFormat: enp_mapIdNameForPost_(so.invoiceFormat || so.InvoiceFormat),
    LineItemsClass: enp_mapIdNameForPost_(so.lineItemsClass || so.LineItemsClass),
    SalesTax: enp_mapIdNameForPost_(so.salesTax || so.SalesTax),
    InvoiceStatus: enp_mapIdNameForPost_(so.invoiceStatus || so.InvoiceStatus),
    IsChangeOrder:
      so.isChangeOrder !== undefined ? !!so.isChangeOrder : !!so.IsChangeOrder,
    ParentId: enp_num_(so.parentId != null ? so.parentId : so.ParentId) || 0,
    IsRecurring:
      so.isRecurring !== undefined ? !!so.isRecurring : !!so.IsRecurring,
    CustomFields: Array.isArray(customFields)
      ? customFields.map(enp_mapCustomFieldForPost_).filter(Boolean)
      : [],
    LineItems: mappedLines
  };

  if (so.trackingNumber !== undefined || so.TrackingNumber !== undefined) {
    payload.TrackingNumber =
      so.trackingNumber !== undefined ? so.trackingNumber : so.TrackingNumber;
  }

  if (so.customerNotes !== undefined || so.CustomerNotes !== undefined) {
    payload.CustomerNotes =
      so.customerNotes !== undefined ? so.customerNotes : so.CustomerNotes;
  }

  if (so.internalNotes !== undefined || so.InternalNotes !== undefined) {
    payload.InternalNotes =
      so.internalNotes !== undefined ? so.internalNotes : so.InternalNotes;
  }

  Object.keys(payload).forEach(function(key) {
    if (payload[key] === null || payload[key] === undefined) delete payload[key];
  });

  return payload;
}

function enp_tokenize_(value) {
  return enp_normUpper_(value).replace(/\s+/g, ' ');
}

/* ENP_REPLACEMENT_ENGINE_CLEAN_20260827_START */
function enp_normalizeItemNumberForMatch_(value) {
  return enp_normUpper_(value).replace(/\s+/g, ' ');
}

function enp_lineDescriptionMatchesExactItemNumber_(desc, desiredItemNumber) {
  const desired = enp_normalizeItemNumberForMatch_(desiredItemNumber);
  if (!desired) return false;

  const parsed = enp_parseDescription_(desc);
  if (
    parsed.itemNumber &&
    enp_normalizeItemNumberForMatch_(parsed.itemNumber) === desired
  ) {
    return true;
  }

  const normalizedDesc = enp_normUpper_(desc).replace(/\s+/g, ' ');
  return normalizedDesc.endsWith('(' + desired + ')');
}

function enp_setLineItemObject_(li, itemId, itemName) {
  li.item = {
    id: Number(itemId),
    name: enp_norm_(itemName)
  };

  if (li.Item && typeof li.Item === 'object') {
    li.Item = {
      Id: Number(itemId),
      Name: enp_norm_(itemName)
    };
  }
}

function enp_setLineInventoryLocation_(li, loc) {
  if (!loc) return;

  const id = enp_num_(loc.id != null ? loc.id : loc.Id);
  if (!id) return;

  li.inventoryLocation = {
    id: id,
    name: enp_norm_(loc.name != null ? loc.name : loc.Name)
  };

  if (li.InventoryLocation && typeof li.InventoryLocation === 'object') {
    li.InventoryLocation = {
      Id: id,
      Name: enp_norm_(loc.name != null ? loc.name : loc.Name)
    };
  }
}

function enp_soDefaultInventoryLocationId_() {
  const id = enp_num_(
    PropertiesService.getScriptProperties().getProperty(ENP.PROPS.DEFAULT_LOCATION_ID)
  );

  if (!id) {
    throw new Error('Missing Script Property: ' + ENP.PROPS.DEFAULT_LOCATION_ID);
  }

  return id;
}

function enp_getStrivenItemById_(itemId, cache) {
  const id = enp_num_(itemId);
  if (!id) throw new Error('Missing Striven Item Id.');

  const key = String(id);
  if (cache && cache[key]) return cache[key];

  const res = enp_strivenFetch_('/v1/items/' + id, { method: 'get' });
  const item = res && res.Data ? res.Data : res;

  if (!item || !enp_num_(item.id != null ? item.id : item.Id)) {
    throw new Error('Striven item not found: ' + id);
  }

  if (cache) cache[key] = item;
  return item;
}

function enp_applyCf820ToReplacementPayload_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Cannot apply CF820: missing Sales Order payload.');
  }

  const fieldId =
    typeof ENP !== 'undefined' && ENP.CF820 && ENP.CF820.ID != null
      ? Number(ENP.CF820.ID)
      : 820;
  const value =
    typeof ENP !== 'undefined' && ENP.CF820 && ENP.CF820.BOTH_VALUE != null
      ? String(ENP.CF820.BOTH_VALUE)
      : '556';
  const valueText =
    typeof ENP !== 'undefined' && ENP.CF820 && ENP.CF820.BOTH_TEXT != null
      ? String(ENP.CF820.BOTH_TEXT)
      : 'New Items created + SO Updated';

  const fields = Array.isArray(payload.CustomFields)
    ? payload.CustomFields.slice()
    : [];

  if (fields.filter(function(cf) { return cf && enp_num_(cf.Id != null ? cf.Id : cf.id) === fieldId; }).length > 1) {
    throw new Error('Cannot apply CF820: duplicate field IDs in Sales Order payload.');
  }
  let found = false;
  for (let i = 0; i < fields.length; i++) {
    const cf = fields[i] || {};
    const id = enp_num_(cf.Id != null ? cf.Id : cf.id);
    if (id !== fieldId) continue;

    const next = Object.assign({}, cf);
    next.Id = fieldId;
    next.Value = value;
    next.ValueText = valueText;
    fields[i] = next;
    found = true;
    break;
  }

  if (!found) {
    fields.push({
      Id: fieldId,
      Value: value,
      ValueText: valueText
    });
  }

  payload.CustomFields = fields;
  Logger.log('CF820 INCLUDED IN SAME SO POST value=' + value + ' text=' + valueText);
  return payload;
}

function enp_replaceSalesOrderItems_(soId, replacements) {
  const bridgeLock = LockService.getScriptLock();
  bridgeLock.waitLock(30000);

  try {
    /*
     * If an earlier execution was interrupted after temporarily bridging an
     * Item Group master, restore that master BEFORE touching any Sales Order.
     */
    enp_recoverStaleItemGroupMasterBridges_();
    return enp_replaceSalesOrderItemsLocked_(soId, replacements);
  } finally {
    bridgeLock.releaseLock();
  }
}

function enp_replaceSalesOrderItemsLocked_(soId, replacements) {
  const id = enp_num_(soId);

  if (!id) throw new Error('Missing Sales Order Id.');
  if (!Array.isArray(replacements) || !replacements.length) {
    throw new Error('No replacements supplied.');
  }

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART SO REPLACE — START SO=' + id);
  Logger.log('REPLACEMENT COUNT=' + replacements.length);
  Logger.log('====================================================');

  const so = enp_getSalesOrder_(id);
  if (!so) throw new Error('Sales Order not found: ' + id);

  const lineItems = enp_getSalesOrderLineItems_(so);
  if (!lineItems.length) {
    throw new Error('Sales Order ' + id + ' has no line items.');
  }

  const beforeLineItems = JSON.parse(JSON.stringify(lineItems));
  const itemCache = {};
  const planned = [];
  const usedLineIds = {};

  /*
   * ENTERNEWPART-FIRST RULE:
   * resolve only the selected ENTERNEWPART lines. Existing Item Group parent
   * IDs are never replaced and no dedicated/snapshot Item Group is created.
   */
  replacements.forEach(function(rep) {
    const newItemId = enp_num_(rep.newItemId);
    if (!newItemId) {
      throw new Error('Missing NewItemId for ' + rep.desiredItemNumber + '.');
    }

    const targetLine = enp_findTargetPlaceholderLine_(lineItems, {
      lineId: rep.lineId,
      desiredItemNumber: rep.desiredItemNumber,
      desiredQty: rep.desiredQty,
      newItemId: newItemId
    });

    if (!targetLine) {
      throw new Error(
        'No exact placeholder line found on SO ' + id +
        ' for Item Number "' + rep.desiredItemNumber + '".'
      );
    }

    const lineId = enp_num_(targetLine.id != null ? targetLine.id : targetLine.Id);
    if (!lineId) {
      throw new Error(
        'Matched Sales Order line has no Line Id for ' + rep.desiredItemNumber + '.'
      );
    }

    if (usedLineIds[lineId]) {
      throw new Error(
        'Safety stop: more than one selected row resolved to SO LineId ' + lineId + '.'
      );
    }
    usedLineIds[lineId] = true;

    const replacementItem = enp_getStrivenItemById_(newItemId, itemCache);

    planned.push({
      key: rep.key,
      lineId: lineId,
      targetLine: targetLine,
      replacement: rep,
      replacementItem: replacementItem
    });
  });

  planned.forEach(function(plan) {
    enp_applyReplacementToLine_(
      plan.targetLine,
      plan.replacement,
      plan.replacementItem
    );
  });

  const expectedItemByLineId = {};
  beforeLineItems.forEach(function(li) {
    const lineId = enp_num_(li.id != null ? li.id : li.Id);
    const itemObj = li.item || li.Item || {};
    if (lineId) {
      expectedItemByLineId[lineId] = enp_num_(
        itemObj.id != null ? itemObj.id : itemObj.Id
      );
    }
  });

  planned.forEach(function(plan) {
    expectedItemByLineId[plan.lineId] = enp_num_(plan.replacement.newItemId);
  });

  /*
   * Striven validates every ItemGroupLineItem in a full Sales Order POST
   * against the CURRENT Item Group master. Striven UI allows a transaction
   * Item Group to have different children, but the Orders API rejects it.
   *
   * R2.3 uses a tightly-guarded TEMPORARY MASTER BRIDGE:
   *   1) snapshot current master
   *   2) temporarily make master children match THIS SO transaction group
   *   3) POST the SO with the same parent Item Group ID and same SO child lines
   *   4) restore the original master immediately, even if the SO POST fails
   *
   * No new Item Group is created. The SO parent Item Group ID never changes.
   */
  const bridgePlans = enp_prepareItemGroupMasterBridgePlans_(
    id,
    lineItems,
    itemCache
  );

  const payload = enp_buildSalesOrderUpsertPayload_(so, lineItems);
  enp_applyCf820ToReplacementPayload_(payload);

  Logger.log(
    'SO PAYLOAD SUMMARY: ' +
    JSON.stringify({
      soId: id,
      lineCount: payload.LineItems ? payload.LineItems.length : 0,
      replacementLineIds: planned.map(function(p) { return p.lineId; }),
      itemGroupMasterBridges: bridgePlans.map(function(b) {
        return {
          parentItemId: b.parentItemId,
          soLineIds: b.soLineIds,
          originalChildItemIds: b.originalChildItemIds,
          temporaryChildItemIds: b.desiredChildItemIds
        };
      })
    })
  );

  let primaryError = null;
  let after = null;
  let afterLines = null;

  try {
    if (bridgePlans.length) {
      enp_scheduleItemGroupBridgeWatchdog_();
      enp_activateItemGroupMasterBridges_(id, bridgePlans);
    }

    enp_strivenFetch_('/v1/sales-orders', {
      method: 'post',
      body: payload
    });

    after = enp_getSalesOrder_(id);
    afterLines = enp_getSalesOrderLineItems_(after);

    enp_verifySalesOrderReplacement_(
      so,
      beforeLineItems,
      after,
      afterLines,
      expectedItemByLineId,
      planned
    );
  } catch (err) {
    primaryError = err;
  }

  let restoreError = null;
  try {
    if (bridgePlans.length) {
      enp_restoreItemGroupMasterBridges_(bridgePlans);
    }
  } catch (err) {
    restoreError = err;
  }

  if (restoreError) {
    const restoreMessage = String(
      restoreError && restoreError.message ? restoreError.message : restoreError
    );

    if (primaryError) {
      throw new Error(
        'SO replacement failed AND Item Group master restore also failed. ' +
        'SO error: ' +
        String(primaryError && primaryError.message ? primaryError.message : primaryError) +
        ' | CRITICAL RESTORE ERROR: ' + restoreMessage +
        '. Recovery journal was retained and will be retried automatically on the next ENTERNEWPART run.'
      );
    }

    throw new Error(
      'SO replacement may have succeeded, but Item Group master restore failed. ' +
      'CRITICAL RESTORE ERROR: ' + restoreMessage +
      '. Recovery journal was retained and will be retried automatically on the next ENTERNEWPART run.'
    );
  }

  if (primaryError) throw primaryError;

  Logger.log('====================================================');
  Logger.log('ENTERNEWPART SO REPLACE — VERIFIED SO=' + id);
  Logger.log('====================================================');

  return {
    salesOrderId: id,
    salesOrderNumber: so.orderNumber || so.OrderNumber || '',
    replacements: planned.map(function(plan) {
      return {
        key: plan.key,
        lineId: plan.lineId,
        newItemId: enp_num_(plan.replacement.newItemId),
        itemNumber: plan.replacement.desiredItemNumber
      };
    })
  };
}

function enp_itemGroupChildItemIds_(children, isMaster) {
  if (!Array.isArray(children)) return [];

  return children.map(function(child) {
    const itemObj = isMaster
      ? (child.item || child.Item || child.groupItem || child.GroupItem || {})
      : (child.item || child.Item || {});

    return enp_num_(
      itemObj.id != null ? itemObj.id :
      itemObj.Id != null ? itemObj.Id :
      child.itemId != null ? child.itemId : child.ItemId
    ) || 0;
  }).filter(function(itemId) {
    return itemId > 0;
  }).sort(function(a, b) {
    return a - b;
  });
}

function enp_sameNumberArray_(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (Number(a[i]) !== Number(b[i])) return false;
  }

  return true;
}

function enp_itemGroupDefinitionForPost_(children, preserveMembershipIds) {
  if (!Array.isArray(children)) return [];

  return children.map(function(child) {
    const itemObj = child.item || child.Item || child.groupItem || child.GroupItem || {};
    const itemId = enp_num_(
      itemObj.id != null ? itemObj.id :
      itemObj.Id != null ? itemObj.Id :
      child.itemId != null ? child.itemId : child.ItemId
    );

    if (!itemId) {
      throw new Error('Item Group definition contains a child without Item Id.');
    }

    const out = {
      Id: preserveMembershipIds
        ? (enp_num_(child.id != null ? child.id : child.Id) || 0)
        : 0,
      Item: {
        Id: itemId,
        Name: enp_norm_(itemObj.name != null ? itemObj.name : itemObj.Name)
      },
      Qty: enp_num_(child.qty != null ? child.qty : child.Qty) || 0,
      Price: enp_num_(child.price != null ? child.price : child.Price) || 0
    };

    const loc = enp_mapIdNameForPost_(
      child.inventoryLocation || child.InventoryLocation
    );
    if (loc && loc.Id) out.InventoryLocation = loc;

    const uom = enp_mapUomForPost_(
      child.unitOfMeasure || child.UnitOfMeasure
    );
    if (uom) out.UnitOfMeasure = uom;

    return out;
  });
}

function enp_itemGroupDefinitionSignature_(children) {
  const rows = enp_itemGroupDefinitionForPost_(children, false).map(function(g) {
    return {
      itemId: enp_num_(g.Item && g.Item.Id) || 0,
      qty: Number(g.Qty || 0),
      price: Number(g.Price || 0),
      locationId: enp_num_(g.InventoryLocation && g.InventoryLocation.Id) || 0,
      uomId: enp_num_(g.UnitOfMeasure && g.UnitOfMeasure.Id) || 0
    };
  });

  rows.sort(function(a, b) {
    if (a.itemId !== b.itemId) return a.itemId - b.itemId;
    if (a.qty !== b.qty) return a.qty - b.qty;
    if (a.price !== b.price) return a.price - b.price;
    if (a.locationId !== b.locationId) return a.locationId - b.locationId;
    return a.uomId - b.uomId;
  });

  return JSON.stringify(rows);
}

function enp_salesOrderItemGroupTransactionSignature_(line) {
  const children = line && (line.itemGroupLineItems || line.ItemGroupLineItems) || [];
  if (!Array.isArray(children)) return '[]';

  const rows = children.map(function(child) {
    const itemObj = child.item || child.Item || {};
    const loc = child.inventoryLocation || child.InventoryLocation || {};
    const cls = child.class || child.Class || {};
    const uom = child.unitOfMeasure || child.UnitOfMeasure || {};

    return {
      lineId: enp_num_(child.id != null ? child.id : child.Id) || 0,
      itemId: enp_num_(itemObj.id != null ? itemObj.id : itemObj.Id) || 0,
      qty: Number(child.qty != null ? child.qty : child.Qty || 0),
      price: Number(child.price != null ? child.price : child.Price || 0),
      locationId: enp_num_(loc.id != null ? loc.id : loc.Id) || 0,
      classId: enp_num_(cls.id != null ? cls.id : cls.Id) || 0,
      uomId: enp_num_(uom.id != null ? uom.id : uom.Id) || 0
    };
  });

  rows.sort(function(a, b) {
    if (a.lineId !== b.lineId) return a.lineId - b.lineId;
    if (a.itemId !== b.itemId) return a.itemId - b.itemId;
    return a.qty - b.qty;
  });

  return JSON.stringify(rows);
}

function enp_itemGroupMasterUpdatePayload_(master, groupItems) {
  const itemId = enp_num_(master && (master.id != null ? master.id : master.Id));
  if (!itemId) throw new Error('Cannot build Item Group update payload without Item Id.');

  const itemType = master.itemType || master.ItemType || {};
  const itemTypeId = enp_num_(itemType.id != null ? itemType.id : itemType.Id);
  const itemTypeName = enp_normUpper_(
    itemType.name != null ? itemType.name : itemType.Name
  );

  if (itemTypeId !== 5 && itemTypeName !== 'ITEM GROUP') {
    throw new Error('Item ' + itemId + ' is not an Item Group.');
  }

  const payload = {
    Id: itemId,
    ItemNumber: enp_norm_(
      master.itemNumber != null ? master.itemNumber : master.ItemNumber
    ),
    Name: enp_norm_(master.name != null ? master.name : master.Name),
    Description:
      master.description !== undefined ? master.description :
      master.Description !== undefined ? master.Description : null,
    Price: enp_num_(master.price != null ? master.price : master.Price) || 0,
    Cost: enp_num_(master.cost != null ? master.cost : master.Cost) || 0,
    Active:
      master.active !== undefined ? !!master.active :
      master.Active !== undefined ? !!master.Active : true,
    Taxable:
      master.taxable !== undefined ? !!master.taxable :
      master.Taxable !== undefined ? !!master.Taxable : true,
    ItemType: { Id: 5 },
    GroupItems: JSON.parse(JSON.stringify(groupItems || []))
  };

  function addScalar(camel, pascal, outputName) {
    if (master[camel] !== undefined) payload[outputName] = master[camel];
    else if (master[pascal] !== undefined) payload[outputName] = master[pascal];
  }

  function addRef(camel, pascal, outputName) {
    const obj = master[camel] || master[pascal] || null;
    const mapped = enp_mapIdNameForPost_(obj);
    if (mapped && mapped.Id) payload[outputName] = mapped;
  }

  addScalar('internalNotes', 'InternalNotes', 'InternalNotes');
  addScalar('manufacturePartNumber', 'ManufacturePartNumber', 'ManufacturePartNumber');
  addScalar('weight', 'Weight', 'Weight');
  addScalar('isShippingRequired', 'IsShippingRequired', 'IsShippingRequired');
  addScalar('shippingPrice', 'ShippingPrice', 'ShippingPrice');
  addScalar('shippingPerc', 'ShippingPerc', 'ShippingPerc');
  addScalar('allowVendorToIncludeInBill', 'AllowVendorToIncludeInBill', 'AllowVendorToIncludeInBill');
  addScalar('reorderPoint', 'ReorderPoint', 'ReorderPoint');
  addScalar('reorderAmount', 'ReorderAmount', 'ReorderAmount');
  addScalar('barcodeValue', 'BarcodeValue', 'BarcodeValue');
  addScalar('maxQuantity', 'MaxQuantity', 'MaxQuantity');

  addRef('category', 'Category', 'Category');
  addRef('division', 'Division', 'Division');
  addRef('preferredVendor', 'PreferredVendor', 'PreferredVendor');
  addRef('manufacturer', 'Manufacturer', 'Manufacturer');
  addRef('incomeGLAccount', 'IncomeGLAccount', 'IncomeGLAccount');
  addRef('inventoryAssetGLAccount', 'InventoryAssetGLAccount', 'InventoryAssetGLAccount');
  addRef('cogsglAccount', 'COGSGLAccount', 'COGSGLAccount');
  addRef('expenseGLAccount', 'ExpenseGLAccount', 'ExpenseGLAccount');
  addRef('defaultGLCategory', 'DefaultGLCategory', 'DefaultGLCategory');
  addRef('defaultInventoryLocation', 'DefaultInventoryLocation', 'DefaultInventoryLocation');
  addRef('relatedAsset', 'RelatedAsset', 'RelatedAsset');
  addRef('unitOfMeasureSet', 'UnitOfMeasureSet', 'UnitOfMeasureSet');
  addRef('baseUnitOfMeasure', 'BaseUnitOfMeasure', 'BaseUnitOfMeasure');

  return payload;
}

function enp_itemGroupBridgeRecoveryPrefix_() {
  return 'ENP_ITEM_GROUP_MASTER_BRIDGE_R23_';
}

function enp_itemGroupBridgeRecoveryKey_(parentItemId) {
  return enp_itemGroupBridgeRecoveryPrefix_() + String(enp_num_(parentItemId) || 0);
}

function enp_writeItemGroupBridgeJournal_(soId, plan) {
  const record = {
    version: 1,
    salesOrderId: enp_num_(soId),
    parentItemId: plan.parentItemId,
    soLineIds: plan.soLineIds,
    startedAt: new Date().toISOString(),
    originalPayload: plan.originalPayload
  };

  const text = JSON.stringify(record);
  if (text.length > 8500) {
    throw new Error(
      'Safety stop: recovery journal for Item Group ' + plan.parentItemId +
      ' is too large for Script Properties. No Item Group was changed.'
    );
  }

  PropertiesService.getScriptProperties().setProperty(
    enp_itemGroupBridgeRecoveryKey_(plan.parentItemId),
    text
  );
  plan.journalWritten = true;
}

function enp_zeroItemGroupMembershipIds_(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  const groups = clone.GroupItems || clone.groupItems || [];
  groups.forEach(function(g) { g.Id = 0; });
  clone.GroupItems = groups;
  delete clone.groupItems;
  return clone;
}

function enp_verifyItemGroupMasterPayload_(live, expectedPayload, label) {
  const expectedId = enp_num_(expectedPayload.Id);
  const liveId = enp_num_(live && (live.id != null ? live.id : live.Id));

  if (liveId !== expectedId) {
    throw new Error(label + ': expected Item Group Id ' + expectedId + ' but read back ' + liveId + '.');
  }

  const liveNumber = enp_norm_(
    live.itemNumber != null ? live.itemNumber : live.ItemNumber
  );
  if (liveNumber !== enp_norm_(expectedPayload.ItemNumber)) {
    throw new Error(label + ': Item Number changed unexpectedly.');
  }

  const liveName = enp_norm_(live.name != null ? live.name : live.Name);
  if (liveName !== enp_norm_(expectedPayload.Name)) {
    throw new Error(label + ': Item Name changed unexpectedly.');
  }

  if (live.active !== undefined && expectedPayload.Active !== undefined) {
    if (!!live.active !== !!expectedPayload.Active) {
      throw new Error(label + ': Active flag changed unexpectedly.');
    }
  }

  if (live.taxable !== undefined && expectedPayload.Taxable !== undefined) {
    if (!!live.taxable !== !!expectedPayload.Taxable) {
      throw new Error(label + ': Taxable flag changed unexpectedly.');
    }
  }

  const liveGroups = live.groupItems || live.GroupItems || [];
  const expectedGroups = expectedPayload.GroupItems || expectedPayload.groupItems || [];

  if (
    enp_itemGroupDefinitionSignature_(liveGroups) !==
    enp_itemGroupDefinitionSignature_(expectedGroups)
  ) {
    throw new Error(
      label + ': Item Group child configuration did not read back as expected.'
    );
  }
}

function enp_postAndVerifyItemGroupMaster_(parentItemId, payload, label) {
  const expectedId = enp_num_(parentItemId);
  const res = enp_guardResolutionAsItemResponse_(enp_guardCreateOrResolveItem_(payload));

  const responseId = enp_extractItemId_(res);
  if (responseId && enp_num_(responseId) !== expectedId) {
    throw new Error(
      label + ': Striven returned Item Id ' + responseId +
      ' instead of updating existing Item Group ' + expectedId + '.'
    );
  }

  const live = enp_getStrivenItemById_(expectedId, {});
  enp_verifyItemGroupMasterPayload_(live, payload, label);
  return live;
}

function enp_prepareItemGroupMasterBridgePlans_(soId, lineItems, itemCache) {
  const plansByParent = {};
  const cache = itemCache || {};

  (lineItems || []).forEach(function(line) {
    const children = line.itemGroupLineItems || line.ItemGroupLineItems || [];
    if (!Array.isArray(children) || !children.length) return;

    const parent = line.item || line.Item || {};
    const parentItemId = enp_num_(parent.id != null ? parent.id : parent.Id);
    const lineId = enp_num_(line.id != null ? line.id : line.Id);

    if (!parentItemId || !lineId) {
      throw new Error(
        'Safety stop: existing Sales Order Item Group line is missing parent Item Id or Line Id.'
      );
    }

    const master = enp_getStrivenItemById_(parentItemId, cache);
    const masterChildren = master.groupItems || master.GroupItems || [];
    const masterSignature = enp_itemGroupDefinitionSignature_(masterChildren);
    const desiredSignature = enp_itemGroupDefinitionSignature_(children);

    if (masterSignature === desiredSignature) return;

    const desiredGroupItems = enp_itemGroupDefinitionForPost_(children, false);

    if (plansByParent[parentItemId]) {
      const existing = plansByParent[parentItemId];
      if (existing.desiredSignature !== desiredSignature) {
        throw new Error(
          'Safety stop: Sales Order ' + soId + ' contains Item Group ' + parentItemId +
          ' more than once with different transaction configurations. A single temporary master cannot represent both at once.'
        );
      }
      existing.soLineIds.push(lineId);
      return;
    }

    const originalGroupItems = enp_itemGroupDefinitionForPost_(masterChildren, true);
    const originalPayload = enp_itemGroupMasterUpdatePayload_(master, originalGroupItems);
    const temporaryPayload = enp_itemGroupMasterUpdatePayload_(master, desiredGroupItems);

    plansByParent[parentItemId] = {
      parentItemId: parentItemId,
      parentItemNumber: enp_norm_(
        master.itemNumber != null ? master.itemNumber : master.ItemNumber
      ),
      soLineIds: [lineId],
      originalSignature: masterSignature,
      desiredSignature: desiredSignature,
      originalPayload: originalPayload,
      temporaryPayload: temporaryPayload,
      originalChildItemIds: enp_itemGroupChildItemIds_(masterChildren, true),
      desiredChildItemIds: enp_itemGroupChildItemIds_(children, false),
      journalWritten: false,
      activated: false
    };
  });

  return Object.keys(plansByParent).map(function(key) {
    return plansByParent[key];
  });
}

function enp_activateItemGroupMasterBridges_(soId, plans) {
  (plans || []).forEach(function(plan) {
    const liveBefore = enp_getStrivenItemById_(plan.parentItemId, {});
    const liveChildren = liveBefore.groupItems || liveBefore.GroupItems || [];

    if (enp_itemGroupDefinitionSignature_(liveChildren) !== plan.originalSignature) {
      throw new Error(
        'Safety stop: Item Group ' + plan.parentItemId +
        ' changed after preflight. No temporary bridge was applied.'
      );
    }

    enp_writeItemGroupBridgeJournal_(soId, plan);

    Logger.log(
      'ITEM GROUP TEMP MASTER BRIDGE — START parent=' + plan.parentItemId +
      ' soLines=' + plan.soLineIds.join(',') +
      ' masterChildren=[' + plan.originalChildItemIds.join(',') + ']' +
      ' transactionChildren=[' + plan.desiredChildItemIds.join(',') + ']'
    );

    enp_postAndVerifyItemGroupMaster_(
      plan.parentItemId,
      plan.temporaryPayload,
      'Temporary bridge for Item Group ' + plan.parentItemId
    );

    plan.activated = true;

    Logger.log(
      'ITEM GROUP TEMP MASTER BRIDGE — VERIFIED parent=' + plan.parentItemId
    );
  });
}

function enp_restoreOneItemGroupMasterBridge_(plan) {
  const key = enp_itemGroupBridgeRecoveryKey_(plan.parentItemId);
  let firstError = null;

  try {
    enp_postAndVerifyItemGroupMaster_(
      plan.parentItemId,
      plan.originalPayload,
      'Restore Item Group ' + plan.parentItemId
    );
  } catch (err) {
    firstError = err;
    Logger.log(
      'ITEM GROUP RESTORE first attempt failed parent=' + plan.parentItemId +
      ' error=' + String(err && err.message ? err.message : err) +
      ' — retrying with fresh membership IDs.'
    );

    const retryPayload = enp_zeroItemGroupMembershipIds_(plan.originalPayload);
    enp_postAndVerifyItemGroupMaster_(
      plan.parentItemId,
      retryPayload,
      'Restore retry Item Group ' + plan.parentItemId
    );
  }

  PropertiesService.getScriptProperties().deleteProperty(key);
  plan.journalWritten = false;
  plan.activated = false;

  Logger.log(
    'ITEM GROUP MASTER RESTORE — VERIFIED parent=' + plan.parentItemId +
    (firstError ? ' (fresh membership IDs used)' : '')
  );
}

function enp_restoreItemGroupMasterBridges_(plans) {
  const errors = [];

  (plans || []).slice().reverse().forEach(function(plan) {
    if (!plan.journalWritten) return;

    try {
      enp_restoreOneItemGroupMasterBridge_(plan);
    } catch (err) {
      errors.push(
        'Item Group ' + plan.parentItemId + ': ' +
        String(err && err.message ? err.message : err)
      );
    }
  });

  if (errors.length) {
    throw new Error(errors.join(' | '));
  }
}

function enp_scheduleItemGroupBridgeWatchdog_() {
  const handler = 'enp_recoverItemGroupMasterBridgeWatchdog';
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction && trigger.getHandlerFunction() === handler;
  });

  if (!exists) {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .after(2 * 60 * 1000)
      .create();
  }
}

function enp_recoverItemGroupMasterBridgeWatchdog() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    enp_recoverStaleItemGroupMasterBridges_();
  } finally {
    lock.releaseLock();
  }
}

function enp_recoverStaleItemGroupMasterBridges_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const prefix = enp_itemGroupBridgeRecoveryPrefix_();
  const keys = Object.keys(all).filter(function(key) {
    return key.indexOf(prefix) === 0;
  });

  if (!keys.length) return;

  Logger.log(
    'ENTERNEWPART RECOVERY: found ' + keys.length +
    ' unfinished Item Group master bridge journal(s). Restoring before SO work.'
  );

  keys.sort().forEach(function(key) {
    let record;
    try {
      record = JSON.parse(all[key]);
    } catch (err) {
      throw new Error(
        'CRITICAL: corrupt Item Group bridge recovery journal ' + key +
        '. No Sales Order work was attempted.'
      );
    }

    const parentItemId = enp_num_(record.parentItemId);
    const originalPayload = record.originalPayload;

    if (!parentItemId || !originalPayload) {
      throw new Error(
        'CRITICAL: incomplete Item Group bridge recovery journal ' + key +
        '. No Sales Order work was attempted.'
      );
    }

    const plan = {
      parentItemId: parentItemId,
      originalPayload: originalPayload,
      journalWritten: true,
      activated: true
    };

    enp_restoreOneItemGroupMasterBridge_(plan);
  });
}

function enp_applyReplacementToLine_(targetLine, rep, replacementItem) {
  const newItemId = enp_num_(rep.newItemId);
  const replacementName = enp_norm_(
    replacementItem.name != null ? replacementItem.name : replacementItem.Name
  );

  const itemType = replacementItem.itemType || replacementItem.ItemType || {};
  const itemTypeId = enp_num_(itemType.id != null ? itemType.id : itemType.Id);
  const itemTypeName = enp_normUpper_(
    itemType.name != null ? itemType.name : itemType.Name
  );

  /* ENTERNEWPART placeholder replacement is a normal item-line operation. */
  if (itemTypeId === 5 || itemTypeName === 'ITEM GROUP') {
    throw new Error(
      'ENTERNEWPART replacement ItemId ' + newItemId +
      ' is an Item Group. This replacer only swaps normal ENTERNEWPART lines.'
    );
  }

  enp_setLineItemObject_(targetLine, newItemId, replacementName);

  const cleanDescription = enp_buildCleanLineDescription_({
    name: rep.desiredItemName,
    itemNumber: rep.desiredItemNumber
  });

  targetLine.description = cleanDescription;
  if ('Description' in targetLine) targetLine.Description = cleanDescription;

  if (
    rep.desiredPrice != null &&
    Number.isFinite(Number(rep.desiredPrice))
  ) {
    enp_setLineItemPrice_(targetLine, Number(rep.desiredPrice));
  }

  const fallbackLocationId = enp_soDefaultInventoryLocationId_();
  const existingLoc = targetLine.inventoryLocation || targetLine.InventoryLocation;
  const replacementLoc =
    replacementItem.defaultInventoryLocation || replacementItem.DefaultInventoryLocation;

  if (existingLoc) {
    enp_setLineInventoryLocation_(targetLine, existingLoc);
  } else if (replacementLoc) {
    enp_setLineInventoryLocation_(targetLine, replacementLoc);
  } else {
    enp_setLineInventoryLocation_(targetLine, {
      id: fallbackLocationId,
      name: ''
    });
  }

  /* The ENTERNEWPART placeholder line itself is not an Item Group. */
  targetLine.itemGroupLineItems = null;
  if ('ItemGroupLineItems' in targetLine) targetLine.ItemGroupLineItems = null;
}

function enp_mapIdNameForPost_(obj) {
  if (!obj) return null;
  return {
    Id: enp_num_(obj.id != null ? obj.id : obj.Id) || 0,
    Name: enp_norm_(obj.name != null ? obj.name : obj.Name)
  };
}

function enp_mapCustomerForPost_(obj) {
  if (!obj) return null;
  return {
    Id: enp_num_(obj.id != null ? obj.id : obj.Id) || 0,
    Number: enp_norm_(obj.number != null ? obj.number : obj.Number),
    Name: enp_norm_(obj.name != null ? obj.name : obj.Name)
  };
}

function enp_mapUomForPost_(obj) {
  if (!obj) return null;
  const id = enp_num_(obj.id != null ? obj.id : obj.Id);
  if (!id) return null;
  return {
    Id: id,
    Name: enp_norm_(obj.name != null ? obj.name : obj.Name),
    ExtendedName: enp_norm_(
      obj.extendedName != null ? obj.extendedName : obj.ExtendedName
    )
  };
}

function enp_mapCustomFieldForPost_(cf) {
  if (!cf) return null;

  const out = {
    Id: enp_num_(cf.id != null ? cf.id : cf.Id) || 0,
    Name: enp_norm_(cf.name != null ? cf.name : cf.Name)
  };

  const fieldType = cf.fieldType || cf.FieldType || null;
  if (fieldType) {
    const fieldTypeId = enp_num_(fieldType.id != null ? fieldType.id : fieldType.Id);
    if (fieldTypeId) {
      out.FieldType = {
        Id: fieldTypeId,
        Name: enp_norm_(fieldType.name != null ? fieldType.name : fieldType.Name)
      };
    }
  }

  if (cf.sourceId !== undefined || cf.SourceId !== undefined) {
    out.SourceId = enp_num_(cf.sourceId !== undefined ? cf.sourceId : cf.SourceId) || 0;
  }

  if (cf.isRequired !== undefined || cf.IsRequired !== undefined) {
    out.IsRequired = cf.isRequired !== undefined ? !!cf.isRequired : !!cf.IsRequired;
  }

  const fields = [
    ['value', 'Value'],
    ['valueText', 'ValueText'],
    ['valueNumber', 'ValueNumber'],
    ['valueDate', 'ValueDate'],
    ['booleanValue', 'BooleanValue'],
    ['optionId', 'OptionId'],
    ['optionIds', 'OptionIds'],
    ['selectedOption', 'SelectedOption'],
    ['selectedOptions', 'SelectedOptions']
  ];

  fields.forEach(function(pair) {
    const camel = pair[0];
    const pascal = pair[1];
    if (cf[camel] !== undefined) out[pascal] = cf[camel];
    else if (cf[pascal] !== undefined) out[pascal] = cf[pascal];
  });

  return out;
}

function enp_customFieldSignature_(cf) {
  if (!cf) return '';
  return JSON.stringify({
    value: cf.value !== undefined ? cf.value : cf.Value,
    valueText: cf.valueText !== undefined ? cf.valueText : cf.ValueText,
    valueNumber: cf.valueNumber !== undefined ? cf.valueNumber : cf.ValueNumber,
    valueDate: cf.valueDate !== undefined ? cf.valueDate : cf.ValueDate,
    booleanValue:
      cf.booleanValue !== undefined ? cf.booleanValue : cf.BooleanValue,
    optionId: cf.optionId !== undefined ? cf.optionId : cf.OptionId,
    optionIds: cf.optionIds !== undefined ? cf.optionIds : cf.OptionIds,
    selectedOption: cf.selectedOption !== undefined ? cf.selectedOption : cf.SelectedOption,
    selectedOptions: cf.selectedOptions !== undefined ? cf.selectedOptions : cf.SelectedOptions
  });
}

function enp_verifySalesOrderReplacement_(
  beforeSo,
  beforeLines,
  afterSo,
  afterLines,
  expectedItemByLineId,
  planned
) {
  if (!afterSo) {
    throw new Error('Verification failed: SO read-back returned nothing.');
  }

  if (afterLines.length !== beforeLines.length) {
    throw new Error(
      'Verification failed: Sales Order line count changed from ' +
      beforeLines.length + ' to ' + afterLines.length + '.'
    );
  }

  const beforeByLineId = {};
  const afterByLineId = {};
  const targetIds = {};

  beforeLines.forEach(function(li) {
    const lineId = enp_num_(li.id != null ? li.id : li.Id);
    if (lineId) beforeByLineId[lineId] = li;
  });

  afterLines.forEach(function(li) {
    const lineId = enp_num_(li.id != null ? li.id : li.Id);
    if (lineId) afterByLineId[lineId] = li;
  });

  planned.forEach(function(plan) {
    targetIds[plan.lineId] = true;
  });

  Object.keys(expectedItemByLineId).forEach(function(lineKey) {
    const lineId = Number(lineKey);
    const afterLine = afterByLineId[lineId];

    if (!afterLine) {
      throw new Error('Verification failed: SO LineId ' + lineId + ' is missing.');
    }

    const itemObj = afterLine.item || afterLine.Item || {};
    const actualItemId = enp_num_(itemObj.id != null ? itemObj.id : itemObj.Id);
    const expectedItemId = enp_num_(expectedItemByLineId[lineId]);

    if (actualItemId !== expectedItemId) {
      throw new Error(
        'Verification failed: SO LineId ' + lineId +
        ' expected ItemId ' + expectedItemId +
        ' but Striven saved ' + actualItemId + '.'
      );
    }
  });

  planned.forEach(function(plan) {
    const afterLine = afterByLineId[plan.lineId];
    const beforeLine = beforeByLineId[plan.lineId];
    if (!beforeLine || !afterLine) throw new Error('Verification failed: target line missing.');
    const expectedQty = enp_verificationNumber_(beforeLine.qty != null ? beforeLine.qty : beforeLine.Qty);
    const actualQty = enp_verificationNumber_(afterLine.qty != null ? afterLine.qty : afterLine.Qty);
    const expectedPrice = enp_verificationNumber_(plan.replacement.desiredPrice != null
      ? plan.replacement.desiredPrice : (beforeLine.price != null ? beforeLine.price : beforeLine.Price));
    const actualPrice = enp_verificationNumber_(afterLine.price != null ? afterLine.price : afterLine.Price);
    if (expectedQty === null || actualQty !== expectedQty) {
      throw new Error('Verification failed: SO LineId ' + plan.lineId + ' quantity did not save as expected.');
    }
    if (expectedPrice === null || actualPrice !== expectedPrice) {
      throw new Error('Verification failed: SO LineId ' + plan.lineId + ' price did not save as expected.');
    }
    const expectedDesc = enp_buildCleanLineDescription_({
      name: plan.replacement.desiredItemName,
      itemNumber: plan.replacement.desiredItemNumber
    });
    const actualDesc = enp_norm_(
      afterLine.description != null ? afterLine.description : afterLine.Description
    );

    if (actualDesc !== expectedDesc) {
      throw new Error(
        'Verification failed: SO LineId ' + plan.lineId +
        ' description did not save as expected.'
      );
    }
  });

  /*
   * Verify unrelated parent Item IDs remained unchanged.
   * We intentionally do NOT compare Item Group children against the master,
   * rebuild them, or create another Item Group.
   */
  Object.keys(beforeByLineId).forEach(function(lineKey) {
    const lineId = Number(lineKey);
    if (targetIds[lineId]) return;

    const beforeLine = beforeByLineId[lineId];
    const afterLine = afterByLineId[lineId];
    if (!afterLine) {
      throw new Error('Verification failed: unrelated SO LineId ' + lineId + ' disappeared.');
    }

    const beforeItem = beforeLine.item || beforeLine.Item || {};
    const afterItem = afterLine.item || afterLine.Item || {};
    const beforeItemId = enp_num_(beforeItem.id != null ? beforeItem.id : beforeItem.Id);
    const afterItemId = enp_num_(afterItem.id != null ? afterItem.id : afterItem.Id);

    if (beforeItemId !== afterItemId) {
      throw new Error(
        'Verification failed: unrelated SO LineId ' + lineId +
        ' changed ItemId from ' + beforeItemId + ' to ' + afterItemId + '.'
      );
    }
  });

  /*
   * Customized transaction Item Groups must survive byte-for-byte in the
   * fields that matter to the SO transaction: child LineId, ItemId, Qty,
   * Price, InventoryLocation, Class and UOM.
   */
  Object.keys(beforeByLineId).forEach(function(lineKey) {
    const lineId = Number(lineKey);
    const beforeLine = beforeByLineId[lineId];
    const beforeChildren = beforeLine.itemGroupLineItems || beforeLine.ItemGroupLineItems || [];
    if (!Array.isArray(beforeChildren) || !beforeChildren.length) return;

    const afterLine = afterByLineId[lineId];
    if (!afterLine) {
      throw new Error(
        'Verification failed: Item Group SO LineId ' + lineId + ' disappeared.'
      );
    }

    if (
      enp_salesOrderItemGroupTransactionSignature_(beforeLine) !==
      enp_salesOrderItemGroupTransactionSignature_(afterLine)
    ) {
      throw new Error(
        'Verification failed: existing Item Group transaction children changed on SO LineId ' +
        lineId + '.'
      );
    }
  });

  const beforeCustomFields = beforeSo.customFields || beforeSo.CustomFields || [];
  const afterCustomFields = afterSo.customFields || afterSo.CustomFields || [];

  const cf820Id =
    typeof ENP !== 'undefined' && ENP.CF820 && ENP.CF820.ID != null
      ? Number(ENP.CF820.ID)
      : 820;
  (beforeCustomFields || []).forEach(function(beforeCf) {
    if (!beforeCf) return;
    const id = enp_num_(beforeCf.id != null ? beforeCf.id : beforeCf.Id);
    if (!id) throw new Error('Verification failed: SO Custom Field has no ID.');
    // Only this field is intentionally changed by the same order POST.
    if (id === cf820Id) return;
    const matches = (afterCustomFields || []).filter(function(cf) {
      return cf && enp_num_(cf.id != null ? cf.id : cf.Id) === id;
    });
    const label = (beforeCf.isRequired === true || beforeCf.IsRequired === true) ? 'required SO Custom Field ' : 'SO Custom Field ';
    if (matches.length !== 1) throw new Error('Verification failed: ' + label + id + ' is missing or duplicated.');
    if (enp_customFieldSignature_(beforeCf) !== enp_customFieldSignature_(matches[0])) {
      throw new Error('Verification failed: ' + label + id + ' changed.');
    }
  });

  const cf820Expected =
    typeof ENP !== 'undefined' && ENP.CF820 && ENP.CF820.BOTH_VALUE != null
      ? String(ENP.CF820.BOTH_VALUE)
      : '556';
  const cf820Matches = (afterCustomFields || []).filter(function(cf) {
    return enp_num_(cf && (cf.id != null ? cf.id : cf.Id)) === cf820Id;
  });
  const cf820After = cf820Matches.length === 1 ? cf820Matches[0] : null;
  const cf820Value = cf820After
    ? String(cf820After.value != null ? cf820After.value : cf820After.Value != null ? cf820After.Value : '')
    : '';

  if (!cf820After || cf820Value !== cf820Expected) {
    throw new Error(
      'Verification failed: CF820 was not set to expected value ' + cf820Expected + '.'
    );
  }

  const beforeClass = beforeSo.lineItemsClass || beforeSo.LineItemsClass || null;
  const afterClass = afterSo.lineItemsClass || afterSo.LineItemsClass || null;

  if (beforeClass) {
    const beforeClassId = enp_num_(
      beforeClass.id != null ? beforeClass.id : beforeClass.Id
    );
    const afterClassId = enp_num_(
      afterClass && (afterClass.id != null ? afterClass.id : afterClass.Id)
    );

    if (beforeClassId !== afterClassId) {
      throw new Error(
        'Verification failed: Sales Order LineItemsClass changed from ' +
        beforeClassId + ' to ' + afterClassId + '.'
      );
    }
  }
}

/* ENP_REPLACEMENT_ENGINE_CLEAN_20260827_END */

// Google Apps Script — strict numeric readback, preserving explicit zero.
function enp_verificationNumber_(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
