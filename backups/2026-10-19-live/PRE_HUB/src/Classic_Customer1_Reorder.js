/**
 * CLASSIC FIREPLACE - CUSTOMER REORDER TEST
 *
 * Purpose:
 *   Build the Striven Community "Customer Reorder Worksheet" concept
 *   against Classic Fireplace's Striven account for Customer ID 1.
 *
 * Credentials:
 *   Reuses Script Properties:
 *     CLIENT_ID
 *     CLIENT_SECRET
 *
 * Safety:
 *   - buildClassicCustomer1Reorder() is READ-ONLY against Striven.
 *   - previewClassicCustomer1Reorder() is READ-ONLY.
 *   - createClassicCustomer1DraftSO() writes ONE Incomplete Sales Order
 *     only after an explicit confirmation dialog.
 *
 * Recommended first run:
 *   1. buildClassicCustomer1Reorder()
 *   2. Enter desired quantities in "Reorder Qty".
 *   3. previewClassicCustomer1Reorder()
 *   4. Only after review, run createClassicCustomer1DraftSO()
 */

const CLASSIC_REORDER = {
  BASE: 'https://api.striven.com',
  CUSTOMER_ID: 1,

  // Existing Striven Plus test workbook.
  SPREADSHEET_ID: '1BkxznKw4431wZdPv87RKnIVYFJVRlSXZcOdVFvaM9fE',

  SHEET: 'Classic Customer 1 Reorder',
  LOG_SHEET: 'Classic Reorder Log',

  CLIENT_ID_PROP: 'CLIENT_ID',
  CLIENT_SECRET_PROP: 'CLIENT_SECRET',
  TOKEN_PROP: 'CLASSIC_REORDER_ACCESS_TOKEN',
  EXPIRY_PROP: 'CLASSIC_REORDER_ACCESS_TOKEN_EXPIRES_AT',

  // Protect the account from an unexpectedly huge first test.
  INVOICE_PAGE_SIZE: 100,
  MAX_INVOICES_TO_READ: 100,
  MAX_ITEM_DETAILS: 100,

  /**
   * Classic-specific Sales Order configuration proven in earlier
   * controlled tests. This is intentionally NOT generalized yet.
   */
  SO: {
    TYPE: {
      Id: 48551,
      Name: 'Fireplace'
    },

    PAYMENT_TERM: {
      Id: 23,
      Name: '$2000 Deposit (for Orders upto $8k) - Balance Due On Receipt'
    },

    CLASS: {
      Id: 17,
      Name: 'Newmarket'
    },

    TAX: {
      Id: 6,
      Name: 'HST'
    },

    SALES_REP: {
      Id: 6,
      Name: 'Pramodh Kumar'
    },

    STATUS: {
      Id: 18,
      Name: 'Incomplete'
    },

    INVENTORY_LOCATION: {
      Id: 21,
      Name: '60 - WAREHOUSE (Ajax)'
    },

    CUSTOM_FIELDS: [
      // Pre-Inspection = Not Applicable
      {
        Id: 775,
        Value: '478'
      },

      // Fulfillment = Pickup
      {
        Id: 831,
        Value: '558'
      }
    ]
  }
};


/**
 * ============================================================
 * MAIN READ-ONLY BUILD
 * ============================================================
 */
function buildClassicCustomer1Reorder() {
  const token = crGetAccessToken_();
  const ss = crGetSpreadsheet_();
  const sheet = crPrepareSheet_(ss);

  crSetStatus_(sheet, 'Loading Customer ID 1...');

  const customerResponse = crApi_(
    '/v1/customers/' + CLASSIC_REORDER.CUSTOMER_ID,
    'get',
    null,
    token
  );

  crRequireOk_(customerResponse, 'Customer lookup');

  const customer = customerResponse.data || {};

  if (Number(customer.id || customer.Id) !== CLASSIC_REORDER.CUSTOMER_ID) {
    throw new Error(
      'Safety stop: Striven did not return Customer ID ' +
      CLASSIC_REORDER.CUSTOMER_ID +
      '.'
    );
  }

  crSetHeaderContext_(sheet, customer);

  crSetStatus_(sheet, 'Loading invoice history...');

  const invoiceSearch = crApi_(
    '/v1/invoices/search',
    'post',
    {
      CustomerId: CLASSIC_REORDER.CUSTOMER_ID,
      PageIndex: 0,
      PageSize: CLASSIC_REORDER.INVOICE_PAGE_SIZE
    },
    token
  );

  crRequireOk_(invoiceSearch, 'Invoice search');

  let invoiceSummaries = crArray_(invoiceSearch.data);

  // Defensive verification because API filters can differ by endpoint/version.
  invoiceSummaries = invoiceSummaries.filter(function(invoice) {
    const c = invoice.customer || invoice.Customer;
    const id = c ? Number(c.id || c.Id || 0) : 0;
    return !id || id === CLASSIC_REORDER.CUSTOMER_ID;
  });

  if (invoiceSummaries.length > CLASSIC_REORDER.MAX_INVOICES_TO_READ) {
    invoiceSummaries = invoiceSummaries.slice(
      0,
      CLASSIC_REORDER.MAX_INVOICES_TO_READ
    );
  }

  const purchaseMap = {};
  let invoicesRead = 0;
  let rawLines = 0;

  invoiceSummaries.forEach(function(summary, index) {
    crSetStatus_(
      sheet,
      'Reading invoice ' +
      (index + 1) +
      ' of ' +
      invoiceSummaries.length +
      '...'
    );

    const invoiceId = Number(
      summary.id ||
      summary.Id ||
      0
    );

    if (!invoiceId) {
      return;
    }

    const detailResponse = crApi_(
      '/v1/invoices/' + invoiceId,
      'get',
      null,
      token
    );

    if (!detailResponse.ok) {
      crLog_(
        ss,
        'INVOICE_READ_FAILED',
        'Invoice ' + invoiceId + ' HTTP ' + detailResponse.status
      );
      return;
    }

    const invoice = detailResponse.data || {};

    // Hard safety check: ignore any invoice that positively belongs to
    // another customer.
    const invoiceCustomer = invoice.customer || invoice.Customer;
    if (invoiceCustomer) {
      const invoiceCustomerId = Number(
        invoiceCustomer.id ||
        invoiceCustomer.Id ||
        0
      );

      if (
        invoiceCustomerId &&
        invoiceCustomerId !== CLASSIC_REORDER.CUSTOMER_ID
      ) {
        return;
      }
    }

    invoicesRead++;

    const invoiceDate =
      invoice.txnDate ||
      invoice.TxnDate ||
      invoice.dateCreated ||
      invoice.DateCreated ||
      null;

    const invoiceNumber =
      invoice.txnNumber ||
      invoice.TxnNumber ||
      invoice.invoiceNumber ||
      invoice.InvoiceNumber ||
      String(invoiceId);

    const lines = Array.isArray(invoice.lineItems)
      ? invoice.lineItems
      : Array.isArray(invoice.LineItems)
        ? invoice.LineItems
        : [];

    lines.forEach(function(line) {
      const item = line.item || line.Item;

      if (!item) {
        return;
      }

      const itemId = Number(item.id || item.Id || 0);

      if (!itemId) {
        return;
      }

      const qty = Number(
        line.qty !== undefined
          ? line.qty
          : line.Qty
      );

      if (!isFinite(qty) || qty <= 0) {
        return;
      }

      rawLines++;

      const historicalPrice = Number(
        line.price !== undefined
          ? line.price
          : line.Price
      );

      const lineUom =
        line.unitOfMeasure ||
        line.UnitOfMeasure ||
        null;

      if (!purchaseMap[itemId]) {
        purchaseMap[itemId] = {
          itemId: itemId,
          itemNumber:
            item.itemNumber ||
            item.ItemNumber ||
            '',
          historicalName:
            item.name ||
            item.Name ||
            '',
          historicalUom: crRefName_(lineUom),
          purchaseCount: 0,
          totalQuantity: 0,
          quantities: [],
          lastPurchaseDate: null,
          lastQuantity: null,
          lastHistoricalPrice: null,
          lastInvoiceId: null,
          lastInvoiceNumber: null
        };
      }

      const record = purchaseMap[itemId];

      record.purchaseCount++;
      record.totalQuantity += qty;
      record.quantities.push(qty);

      if (
        !record.lastPurchaseDate ||
        crDateValue_(invoiceDate) > crDateValue_(record.lastPurchaseDate)
      ) {
        record.lastPurchaseDate = invoiceDate;
        record.lastQuantity = qty;
        record.lastHistoricalPrice =
          isFinite(historicalPrice)
            ? historicalPrice
            : null;
        record.lastInvoiceId = invoiceId;
        record.lastInvoiceNumber = invoiceNumber;

        if (crRefName_(lineUom)) {
          record.historicalUom = crRefName_(lineUom);
        }
      }
    });
  });

  let history = Object.keys(purchaseMap).map(function(key) {
    const record = purchaseMap[key];
    record.typicalQuantity = crMedian_(record.quantities);
    return record;
  });

  history.sort(function(a, b) {
    const dateDifference =
      crDateValue_(b.lastPurchaseDate) -
      crDateValue_(a.lastPurchaseDate);

    if (dateDifference !== 0) {
      return dateDifference;
    }

    return b.purchaseCount - a.purchaseCount;
  });

  if (history.length > CLASSIC_REORDER.MAX_ITEM_DETAILS) {
    history = history.slice(0, CLASSIC_REORDER.MAX_ITEM_DETAILS);
  }

  crSetStatus_(sheet, 'Loading current item data...');

  const rows = [];

  history.forEach(function(historyItem, index) {
    crSetStatus_(
      sheet,
      'Loading item ' +
      (index + 1) +
      ' of ' +
      history.length +
      '...'
    );

    const itemResponse = crApi_(
      '/v1/items/' + historyItem.itemId,
      'get',
      null,
      token
    );

    let current = {};
    let itemReadOk = itemResponse.ok === true;

    if (itemReadOk) {
      current = itemResponse.data || {};
    }

    const active =
      itemReadOk
        ? !(
            current.active === false ||
            current.isActive === false
          )
        : null;

    const currentBasePrice = Number(
      current.price !== undefined
        ? current.price
        : current.Price
    );

    const currentUom =
      current.unitOfMeasure ||
      current.UnitOfMeasure ||
      current.defaultUnitOfMeasure ||
      current.DefaultUnitOfMeasure ||
      null;

    const itemType =
      current.itemType ||
      current.ItemType ||
      null;

    rows.push([
      false, // A Select
      historyItem.itemId, // B
      current.itemNumber ||
        current.ItemNumber ||
        historyItem.itemNumber, // C
      current.name ||
        current.Name ||
        current.description ||
        current.Description ||
        historyItem.historicalName, // D
      crRefName_(itemType), // E
      crRefName_(currentUom) ||
        historyItem.historicalUom, // F
      historyItem.lastPurchaseDate
        ? new Date(historyItem.lastPurchaseDate)
        : '', // G
      historyItem.lastQuantity, // H
      historyItem.typicalQuantity, // I
      historyItem.purchaseCount, // J
      crRound_(historyItem.totalQuantity), // K
      historyItem.lastHistoricalPrice, // L
      isFinite(currentBasePrice)
        ? currentBasePrice
        : '', // M
      0, // N Reorder Qty
      '', // O Est. line total formula
      active === false
        ? 'INACTIVE'
        : itemReadOk
          ? 'BASE ITEM PRICE - STRIVEN WILL PRICE DRAFT SO'
          : 'ITEM LOOKUP FAILED' // P
    ]);
  });

  crWriteRows_(sheet, rows);

  sheet.getRange('B2').setValue(customer.name || customer.Name || '');
  sheet.getRange('D2').setValue(CLASSIC_REORDER.CUSTOMER_ID);
  sheet.getRange('F2').setValue(invoicesRead);
  sheet.getRange('H2').setValue(rows.length);
  sheet.getRange('J2').setValue(rawLines);
  sheet.getRange('L2').setFormula('=COUNTIF(A5:A,TRUE)');
  sheet.getRange('N2').setFormula('=SUM(O5:O)');

  crSetStatus_(
    sheet,
    'READY - read-only build complete'
  );

  crLog_(
    ss,
    'BUILD_COMPLETE',
    JSON.stringify({
      customerId: CLASSIC_REORDER.CUSTOMER_ID,
      customerName: customer.name || customer.Name || '',
      invoicesRead: invoicesRead,
      rawLines: rawLines,
      uniqueItems: rows.length
    })
  );

  ss.setActiveSheet(sheet);

  SpreadsheetApp.getUi().alert(
    'Classic Customer 1 Reorder',
    rows.length +
      ' unique purchased items loaded from ' +
      invoicesRead +
      ' invoices.\n\n' +
      'No Striven data was modified.\n' +
      'Enter Reorder Qty in column N.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return {
    customerId: CLASSIC_REORDER.CUSTOMER_ID,
    customerName: customer.name || customer.Name || '',
    invoicesRead: invoicesRead,
    rawLines: rawLines,
    uniqueItems: rows.length,
    writesPerformed: false
  };
}


/**
 * ============================================================
 * READ-ONLY PREVIEW
 * ============================================================
 */
function previewClassicCustomer1Reorder() {
  const ss = crGetSpreadsheet_();
  const sheet = ss.getSheetByName(CLASSIC_REORDER.SHEET);

  if (!sheet) {
    throw new Error(
      'Run buildClassicCustomer1Reorder() first.'
    );
  }

  const selected = crSelectedRows_(sheet);

  if (!selected.length) {
    throw new Error(
      'Enter a Reorder Qty in column N for at least one item.'
    );
  }

  const estimatedBaseTotal = selected.reduce(function(sum, row) {
    return sum + (row.basePrice || 0) * row.qty;
  }, 0);

  const preview = {
    customerId: CLASSIC_REORDER.CUSTOMER_ID,
    itemCount: selected.length,
    estimatedBaseTotal: crRound_(estimatedBaseTotal),
    pricingNote:
      'Worksheet totals use Item API base prices only. ' +
      'The draft Sales Order function intentionally omits Price so Striven can resolve transactional/customer pricing.',
    items: selected
  };

  console.log(
    JSON.stringify(preview, null, 2)
  );

  SpreadsheetApp.getUi().alert(
    'Reorder Preview',
    selected.length +
      ' items selected.\n\n' +
      'Base-price estimate: $' +
      crMoney_(estimatedBaseTotal) +
      '\n\n' +
      'No Striven data was modified.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return preview;
}


/**
 * ============================================================
 * WRITE: CREATE ONE INCOMPLETE SALES ORDER
 * ============================================================
 *
 * IMPORTANT:
 * - This is the only function in this file that writes to Striven.
 * - Price is intentionally omitted from line items.
 * - We read the created Sales Order back and report the actual
 *   line prices returned by Striven.
 */
function createClassicCustomer1DraftSO() {
  const ss = crGetSpreadsheet_();
  const sheet = ss.getSheetByName(CLASSIC_REORDER.SHEET);

  if (!sheet) {
    throw new Error(
      'Run buildClassicCustomer1Reorder() first.'
    );
  }

  const selected = crSelectedRows_(sheet);

  if (!selected.length) {
    throw new Error(
      'Enter a Reorder Qty in column N for at least one item.'
    );
  }

  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    'Create Incomplete Sales Order?',
    'This will WRITE one Incomplete Sales Order to Classic Striven for Customer ID 1 with ' +
      selected.length +
      ' line item(s).\n\n' +
      'Prices will NOT be supplied by this script. Striven will be allowed to calculate the Sales Order prices.\n\n' +
      'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) {
    return {
      created: false,
      reason: 'User cancelled'
    };
  }

  const token = crGetAccessToken_();

  const customerResponse = crApi_(
    '/v1/customers/' + CLASSIC_REORDER.CUSTOMER_ID,
    'get',
    null,
    token
  );

  crRequireOk_(customerResponse, 'Customer lookup');

  const customer = customerResponse.data || {};

  if (Number(customer.id || customer.Id) !== CLASSIC_REORDER.CUSTOMER_ID) {
    throw new Error(
      'Safety stop: expected Customer ID 1.'
    );
  }

  // Re-read each selected item immediately before the write.
  const lineItems = selected.map(function(selection) {
    const itemResponse = crApi_(
      '/v1/items/' + selection.itemId,
      'get',
      null,
      token
    );

    crRequireOk_(
      itemResponse,
      'Item lookup ' + selection.itemId
    );

    const item = itemResponse.data || {};

    if (
      item.active === false ||
      item.isActive === false
    ) {
      throw new Error(
        'Cannot reorder inactive item ' +
        selection.itemId +
        ' (' +
        selection.itemNumber +
        ').'
      );
    }

    return {
      Item: {
        Id: Number(item.id || item.Id),
        Name:
          item.name ||
          item.Name ||
          selection.name
      },

      InventoryLocation:
        CLASSIC_REORDER.SO.INVENTORY_LOCATION,

      Class:
        CLASSIC_REORDER.SO.CLASS,

      Qty:
        selection.qty,

      // IMPORTANT:
      // Price intentionally omitted so Striven can resolve
      // transactional/customer pricing.

      ShippingPrice:
        0,

      Taxable:
        item.taxable === true
    };
  });

  const payload = {
    Type:
      CLASSIC_REORDER.SO.TYPE,

    Customer: {
      Id:
        CLASSIC_REORDER.CUSTOMER_ID,
      Name:
        customer.name ||
        customer.Name ||
        ''
    },

    SalesRep:
      CLASSIC_REORDER.SO.SALES_REP,

    OrderDate:
      new Date().toISOString(),

    OrderName:
      'TEST - CUSTOMER 1 REORDER',

    PaymentTerm:
      CLASSIC_REORDER.SO.PAYMENT_TERM,

    LineItemsClass:
      CLASSIC_REORDER.SO.CLASS,

    SalesTax:
      CLASSIC_REORDER.SO.TAX,

    Status:
      CLASSIC_REORDER.SO.STATUS,

    InternalNotes: {
      NotesHtml:
        '<p>TEST - Striven Plus customer reorder for Customer ID 1. Created from consolidated purchase history.</p>',
      NotesText:
        'TEST - Striven Plus customer reorder for Customer ID 1. Created from consolidated purchase history.'
    },

    CustomFields:
      CLASSIC_REORDER.SO.CUSTOM_FIELDS,

    LineItems:
      lineItems
  };

  crSetStatus_(
    sheet,
    'Creating Incomplete Sales Order...'
  );

  const createResponse = crApi_(
    '/v1/sales-orders',
    'post',
    payload,
    token
  );

  crRequireOk_(
    createResponse,
    'Sales Order creation'
  );

  const createdId = Number(
    createResponse.data &&
    (
      createResponse.data.id ||
      createResponse.data.Id
    )
  );

  if (!createdId) {
    throw new Error(
      'Sales Order was created but no ID was returned.'
    );
  }

  const verifyResponse = crApi_(
    '/v1/sales-orders/' + createdId,
    'get',
    null,
    token
  );

  crRequireOk_(
    verifyResponse,
    'Sales Order verification'
  );

  const so = verifyResponse.data || {};

  const createdLines = Array.isArray(so.lineItems)
    ? so.lineItems
    : Array.isArray(so.LineItems)
      ? so.LineItems
      : [];

  const actualPrices = createdLines.map(function(line) {
    const item = line.item || line.Item || {};
    return {
      itemId: Number(item.id || item.Id || 0),
      itemNumber:
        item.itemNumber ||
        item.ItemNumber ||
        '',
      name:
        item.name ||
        item.Name ||
        '',
      qty: Number(
        line.qty !== undefined
          ? line.qty
          : line.Qty
      ),
      price: Number(
        line.price !== undefined
          ? line.price
          : line.Price
      )
    };
  });

  // Write actual returned Striven price next to each chosen item.
  crApplyReturnedPrices_(
    sheet,
    actualPrices
  );

  crSetStatus_(
    sheet,
    'DRAFT SO CREATED: ' +
      (
        so.orderNumber ||
        so.OrderNumber ||
        createdId
      )
  );

  crLog_(
    ss,
    'DRAFT_SO_CREATED',
    JSON.stringify({
      customerId: CLASSIC_REORDER.CUSTOMER_ID,
      salesOrderId: createdId,
      salesOrderNumber:
        so.orderNumber ||
        so.OrderNumber ||
        '',
      status:
        so.status ||
        so.Status ||
        null,
      orderTotal:
        so.orderTotal ||
        so.OrderTotal ||
        null,
      pricesReturned:
        actualPrices
    })
  );

  ui.alert(
    'Draft Sales Order Created',
    'Sales Order: ' +
      (
        so.orderNumber ||
        so.OrderNumber ||
        createdId
      ) +
      '\nStatus: ' +
      crRefName_(so.status || so.Status) +
      '\nTotal returned by Striven: $' +
      crMoney_(
        Number(
          so.orderTotal ||
          so.OrderTotal ||
          0
        )
      ) +
      '\n\n' +
      'Column Q now shows the prices Striven returned.',
    ui.ButtonSet.OK
  );

  return {
    created: true,
    customerId: CLASSIC_REORDER.CUSTOMER_ID,
    salesOrderId: createdId,
    salesOrderNumber:
      so.orderNumber ||
      so.OrderNumber ||
      '',
    status:
      so.status ||
      so.Status ||
      null,
    orderTotal:
      so.orderTotal ||
      so.OrderTotal ||
      null,
    lineItems:
      actualPrices
  };
}


/**
 * ============================================================
 * SHEET
 * ============================================================
 */
function crPrepareSheet_(ss) {
  let sheet = ss.getSheetByName(
    CLASSIC_REORDER.SHEET
  );

  if (!sheet) {
    sheet = ss.insertSheet(
      CLASSIC_REORDER.SHEET
    );
  }

  sheet.clear();

  sheet.getRange('A1:Q1')
    .merge()
    .setValue(
      'CLASSIC FIREPLACE - CUSTOMER ID 1 REORDER TEST'
    )
    .setFontWeight('bold')
    .setFontSize(14);

  sheet.getRange('A2').setValue('Customer');
  sheet.getRange('C2').setValue('Customer ID');
  sheet.getRange('E2').setValue('Invoices');
  sheet.getRange('G2').setValue('Unique Items');
  sheet.getRange('I2').setValue('Raw Lines');
  sheet.getRange('K2').setValue('Selected');
  sheet.getRange('M2').setValue('Base Estimate');

  sheet.getRange('A3').setValue('Status');
  sheet.getRange('B3:Q3').merge();

  const headers = [[
    'Select',
    'Item ID',
    'Item #',
    'Item Name',
    'Type',
    'UOM',
    'Last Purchase',
    'Last Qty',
    'Typical Qty',
    'Purchase Count',
    'Total Qty',
    'Last Price',
    'Current Base Price',
    'Reorder Qty',
    'Base Est. Total',
    'Pricing / Eligibility',
    'Striven SO Price'
  ]];

  sheet.getRange(4, 1, 1, headers[0].length)
    .setValues(headers)
    .setFontWeight('bold');

  sheet.setFrozenRows(4);

  sheet.setColumnWidth(1, 70);
  sheet.setColumnWidth(2, 85);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 360);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 90);
  sheet.setColumnWidth(9, 100);
  sheet.setColumnWidth(10, 110);
  sheet.setColumnWidth(11, 90);
  sheet.setColumnWidth(12, 100);
  sheet.setColumnWidth(13, 125);
  sheet.setColumnWidth(14, 105);
  sheet.setColumnWidth(15, 120);
  sheet.setColumnWidth(16, 280);
  sheet.setColumnWidth(17, 120);

  return sheet;
}


function crWriteRows_(sheet, rows) {
  if (!rows.length) {
    return;
  }

  const startRow = 5;

  sheet.getRange(
    startRow,
    1,
    rows.length,
    16
  ).setValues(rows);

  sheet.getRange(
    startRow,
    1,
    rows.length,
    1
  ).insertCheckboxes();

  sheet.getRange(
    startRow,
    7,
    rows.length,
    1
  ).setNumberFormat('yyyy-mm-dd');

  sheet.getRange(
    startRow,
    12,
    rows.length,
    2
  ).setNumberFormat('$#,##0.00');

  sheet.getRange(
    startRow,
    15,
    rows.length,
    1
  ).setNumberFormat('$#,##0.00');

  sheet.getRange(
    startRow,
    17,
    rows.length,
    1
  ).setNumberFormat('$#,##0.00');

  for (
    let row = startRow;
    row < startRow + rows.length;
    row++
  ) {
    sheet.getRange(row, 15).setFormula(
      '=IF(OR(M' +
      row +
      '="",N' +
      row +
      '<=0),"",M' +
      row +
      '*N' +
      row +
      ')'
    );
  }

  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }

  sheet.getRange(
    4,
    1,
    rows.length + 1,
    17
  ).createFilter();
}


function crSelectedRows_(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 5) {
    return [];
  }

  const values = sheet.getRange(
    5,
    1,
    lastRow - 4,
    17
  ).getValues();

  const selected = [];

  values.forEach(function(row, index) {
    const checked = row[0] === true;
    const qty = Number(row[13]);

    if (
      !checked &&
      (!isFinite(qty) || qty <= 0)
    ) {
      return;
    }

    if (
      !isFinite(qty) ||
      qty <= 0
    ) {
      throw new Error(
        'Row ' +
        (index + 5) +
        ' is selected but Reorder Qty is not greater than zero.'
      );
    }

    if (
      String(row[15]).toUpperCase() === 'INACTIVE'
    ) {
      throw new Error(
        'Row ' +
        (index + 5) +
        ' is inactive and cannot be reordered.'
      );
    }

    selected.push({
      sheetRow: index + 5,
      itemId: Number(row[1]),
      itemNumber: String(row[2] || ''),
      name: String(row[3] || ''),
      uom: String(row[5] || ''),
      lastPurchase: row[6],
      lastQty: Number(row[7] || 0),
      typicalQty: Number(row[8] || 0),
      purchaseCount: Number(row[9] || 0),
      basePrice: Number(row[12] || 0),
      qty: qty
    });
  });

  return selected;
}


function crApplyReturnedPrices_(sheet, prices) {
  const byItemId = {};

  prices.forEach(function(price) {
    byItemId[Number(price.itemId)] = price;
  });

  const lastRow = sheet.getLastRow();

  if (lastRow < 5) {
    return;
  }

  const itemIds = sheet.getRange(
    5,
    2,
    lastRow - 4,
    1
  ).getValues();

  const output = itemIds.map(function(row) {
    const id = Number(row[0]);
    const match = byItemId[id];

    if (
      !match ||
      !isFinite(match.price)
    ) {
      return [''];
    }

    return [match.price];
  });

  sheet.getRange(
    5,
    17,
    output.length,
    1
  ).setValues(output);
}


function crSetHeaderContext_(sheet, customer) {
  sheet.getRange('B2')
    .setValue(
      customer.name ||
      customer.Name ||
      ''
    );

  sheet.getRange('D2')
    .setValue(CLASSIC_REORDER.CUSTOMER_ID);
}


function crSetStatus_(sheet, message) {
  sheet.getRange('B3')
    .setValue(message);
}


/**
 * ============================================================
 * LOG
 * ============================================================
 */
function crLog_(ss, action, details) {
  let sheet = ss.getSheetByName(
    CLASSIC_REORDER.LOG_SHEET
  );

  if (!sheet) {
    sheet = ss.insertSheet(
      CLASSIC_REORDER.LOG_SHEET
    );

    sheet.appendRow([
      'Timestamp',
      'Action',
      'Details'
    ]);
  }

  sheet.appendRow([
    new Date(),
    action || '',
    details || ''
  ]);
}


/**
 * ============================================================
 * AUTH + API
 * ============================================================
 */
function crGetAccessToken_() {
  const props =
    PropertiesService.getScriptProperties();

  const cached =
    props.getProperty(
      CLASSIC_REORDER.TOKEN_PROP
    );

  const expiry = Number(
    props.getProperty(
      CLASSIC_REORDER.EXPIRY_PROP
    ) || 0
  );

  if (
    cached &&
    Date.now() < expiry - 300000
  ) {
    return cached;
  }

  const clientId =
    props.getProperty(
      CLASSIC_REORDER.CLIENT_ID_PROP
    );

  const clientSecret =
    props.getProperty(
      CLASSIC_REORDER.CLIENT_SECRET_PROP
    );

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing CLIENT_ID or CLIENT_SECRET in Apps Script Script Properties.'
    );
  }

  const auth =
    Utilities.base64Encode(
      clientId + ':' + clientSecret
    );

  const response =
    UrlFetchApp.fetch(
      CLASSIC_REORDER.BASE +
      '/accesstoken',
      {
        method: 'post',

        headers: {
          Authorization:
            'Basic ' + auth,

          Accept:
            'application/json'
        },

        payload: {
          grant_type:
            'client_credentials',

          ClientId:
            clientId
        },

        muteHttpExceptions:
          true
      }
    );

  const status =
    response.getResponseCode();

  const raw =
    response.getContentText();

  let data;

  try {
    data = JSON.parse(raw);
  } catch (error) {
    data = {
      raw: raw
    };
  }

  if (
    status < 200 ||
    status >= 300
  ) {
    throw new Error(
      'Striven authentication failed. HTTP ' +
      status +
      '\n' +
      JSON.stringify(
        data,
        null,
        2
      )
    );
  }

  if (!data.access_token) {
    throw new Error(
      'Authentication succeeded but no access token was returned.'
    );
  }

  props.setProperty(
    CLASSIC_REORDER.TOKEN_PROP,
    data.access_token
  );

  props.setProperty(
    CLASSIC_REORDER.EXPIRY_PROP,
    String(
      Date.now() +
      Number(
        data.expires_in ||
        86400
      ) *
      1000
    )
  );

  return data.access_token;
}


function crApi_(path, method, payload, token) {
  const options = {
    method:
      method || 'get',

    headers: {
      Authorization:
        'Bearer ' + token,

      Accept:
        'application/json'
    },

    muteHttpExceptions:
      true
  };

  if (
    payload !== null &&
    payload !== undefined
  ) {
    options.contentType =
      'application/json';

    options.payload =
      JSON.stringify(payload);
  }

  const response =
    UrlFetchApp.fetch(
      CLASSIC_REORDER.BASE +
      path,
      options
    );

  const status =
    response.getResponseCode();

  const raw =
    response.getContentText();

  let data = raw;

  try {
    data = JSON.parse(raw);
  } catch (error) {}

  return {
    ok:
      status >= 200 &&
      status < 300,

    status:
      status,

    data:
      data
  };
}


function crRequireOk_(response, action) {
  if (
    response &&
    response.ok
  ) {
    return;
  }

  throw new Error(
    action +
    ' failed. HTTP ' +
    (
      response
        ? response.status
        : 'UNKNOWN'
    ) +
    '\n' +
    JSON.stringify(
      response
        ? response.data
        : null,
      null,
      2
    )
  );
}


/**
 * ============================================================
 * HELPERS
 * ============================================================
 */
function crGetSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(
      CLASSIC_REORDER.SPREADSHEET_ID
    );
  } catch (error) {
    const active =
      SpreadsheetApp.getActiveSpreadsheet();

    if (!active) {
      throw error;
    }

    return active;
  }
}


function crArray_(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    Array.isArray(data.Data)
  ) {
    return data.Data;
  }

  if (
    data &&
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  return [];
}


function crRefName_(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return (
    value.name ||
    value.Name ||
    ''
  );
}


function crDateValue_(value) {
  if (!value) {
    return 0;
  }

  const time =
    new Date(value).getTime();

  return isFinite(time)
    ? time
    : 0;
}


function crMedian_(values) {
  const valid = values
    .map(function(value) {
      return Number(value);
    })
    .filter(function(value) {
      return isFinite(value);
    })
    .sort(function(a, b) {
      return a - b;
    });

  if (!valid.length) {
    return 0;
  }

  const middle =
    Math.floor(valid.length / 2);

  if (valid.length % 2) {
    return valid[middle];
  }

  return crRound_(
    (
      valid[middle - 1] +
      valid[middle]
    ) /
    2
  );
}


function crRound_(value) {
  return Math.round(
    Number(value || 0) *
    100
  ) / 100;
}


function crMoney_(value) {
  return crRound_(value)
    .toFixed(2);
}



/**
 * CLASSIC FIREPLACE - CUSTOMER 1 REORDER V2
 *
 * Add this file to the SAME Apps Script project as Classic_Customer1_Reorder.gs.
 *
 * It adds:
 *   1) Reorder eligibility classification.
 *   2) A controlled one-item Striven pricing test.
 *
 * TEST ITEM:
 *   Item ID 36106
 *   Item # 2112
 *   Stainless Flexi-Grilling Basket...
 *   Qty 1
 *
 * This item was chosen because:
 *   - It is active.
 *   - It is Inventory.
 *   - Historical price = current base price = $61.
 *   - Low-value draft test.
 *
 * RUN NEXT:
 *   rebuildClassicCustomer1ReorderV2()
 *
 * THEN:
 *   testClassicCustomer1AutoPricing()
 */

const CLASSIC_REORDER_V2 = {
  TEST_ITEM_ID: 36106,
  TEST_QTY: 1,

  EXCLUDED_TYPES: [
    'Deposit'
  ],

  REVIEW_TYPES: [
    'Service',
    'Non-Inventory',
    'Item Group'
  ],

  EXCLUDED_ITEM_NUMBERS: [
    'Deposit Request',
    'Construction Deposit',
    'ENTERNEWPART'
  ],

  EXCLUDED_ITEM_NAMES: [
    'Note Item',
    'Deposit Request',
    'Construction Deposit',
    'ENTERNEWPART'
  ]
};


/**
 * ============================================================
 * REBUILD THE EXISTING SHEET, THEN CLASSIFY EACH ROW
 * ============================================================
 */
function rebuildClassicCustomer1ReorderV2() {
  const result = buildClassicCustomer1Reorder();

  const ss = crGetSpreadsheet_();
  const sheet = ss.getSheetByName(
    CLASSIC_REORDER.SHEET
  );

  if (!sheet) {
    throw new Error(
      'Classic reorder sheet was not created.'
    );
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 5) {
    return result;
  }

  // Change the last two headers so the intent is obvious.
  sheet.getRange('P4').setValue('Eligibility');
  sheet.getRange('Q4').setValue('Reason / Striven Price');

  const rows = sheet.getRange(
    5,
    1,
    lastRow - 4,
    17
  ).getValues();

  const outputP = [];
  const outputQ = [];

  rows.forEach(function(row) {
    const itemId = Number(row[1] || 0);
    const itemNumber = String(row[2] || '').trim();
    const itemName = String(row[3] || '').trim();
    const itemType = String(row[4] || '').trim();
    const currentBasePrice = Number(row[12] || 0);
    const priorStatus = String(row[15] || '').trim();

    let eligibility = 'ELIGIBLE';
    let reason = 'Active purchased item.';

    if (priorStatus === 'INACTIVE') {
      eligibility = 'EXCLUDE';
      reason = 'Item is inactive in Striven.';
    }

    if (
      eligibility !== 'EXCLUDE' &&
      CLASSIC_REORDER_V2.EXCLUDED_TYPES.indexOf(itemType) !== -1
    ) {
      eligibility = 'EXCLUDE';
      reason = 'Transaction/deposit line, not a reorder product.';
    }

    if (
      eligibility !== 'EXCLUDE' &&
      CLASSIC_REORDER_V2.EXCLUDED_ITEM_NUMBERS.indexOf(itemNumber) !== -1
    ) {
      eligibility = 'EXCLUDE';
      reason = 'Placeholder/deposit item, not a normal reorder product.';
    }

    if (
      eligibility !== 'EXCLUDE' &&
      CLASSIC_REORDER_V2.EXCLUDED_ITEM_NAMES.indexOf(itemName) !== -1
    ) {
      eligibility = 'EXCLUDE';
      reason = 'Note/placeholder/deposit line, not a reorder product.';
    }

    if (
      eligibility !== 'EXCLUDE' &&
      CLASSIC_REORDER_V2.REVIEW_TYPES.indexOf(itemType) !== -1
    ) {
      eligibility = 'REVIEW';

      if (itemType === 'Service') {
        reason =
          'Service item. Reorder only when intentionally selling the service again.';
      } else if (itemType === 'Item Group') {
        reason =
          'Item Group. Must verify whether Striven expands/handles group components correctly.';
      } else {
        reason =
          'Non-Inventory item. Requires business-rule review before automatic reorder.';
      }
    }

    if (
      eligibility === 'ELIGIBLE' &&
      (!isFinite(currentBasePrice) || currentBasePrice <= 0)
    ) {
      eligibility = 'REVIEW';
      reason =
        'Current base price is zero/unavailable. Do not auto-reorder until pricing is verified.';
    }

    // Our chosen controlled pricing-test item.
    if (itemId === CLASSIC_REORDER_V2.TEST_ITEM_ID) {
      eligibility = 'TEST READY';
      reason =
        'Selected controlled auto-pricing test item. Active Inventory item, Qty 1.';
    }

    outputP.push([eligibility]);
    outputQ.push([reason]);
  });

  sheet.getRange(
    5,
    16,
    outputP.length,
    1
  ).setValues(outputP);

  sheet.getRange(
    5,
    17,
    outputQ.length,
    1
  ).setValues(outputQ);

  // Clear any existing selection and reorder qty so the next test is controlled.
  sheet.getRange(
    5,
    1,
    lastRow - 4,
    1
  ).setValue(false);

  sheet.getRange(
    5,
    14,
    lastRow - 4,
    1
  ).setValue(0);

  // Automatically mark ONLY the controlled test item.
  for (
    let rowIndex = 5;
    rowIndex <= lastRow;
    rowIndex++
  ) {
    const itemId = Number(
      sheet.getRange(rowIndex, 2).getValue()
    );

    if (itemId === CLASSIC_REORDER_V2.TEST_ITEM_ID) {
      sheet.getRange(rowIndex, 1).setValue(true);
      sheet.getRange(rowIndex, 14).setValue(
        CLASSIC_REORDER_V2.TEST_QTY
      );
      break;
    }
  }

  sheet.getRange('B3').setValue(
    'V2 READY - only controlled test item is selected'
  );

  SpreadsheetApp.getUi().alert(
    'Customer 1 Reorder V2 Ready',
    'The raw purchase history was classified.\n\n' +
      'Only Item ID ' +
      CLASSIC_REORDER_V2.TEST_ITEM_ID +
      ' is selected for Qty ' +
      CLASSIC_REORDER_V2.TEST_QTY +
      '.\n\n' +
      'No Striven data was modified.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );

  return {
    rebuild: result,
    testItemId:
      CLASSIC_REORDER_V2.TEST_ITEM_ID,
    testQty:
      CLASSIC_REORDER_V2.TEST_QTY
  };
}


/**
 * ============================================================
 * CONTROLLED ONE-ITEM AUTO-PRICING TEST
 * ============================================================
 *
 * Writes ONE Incomplete Sales Order after explicit confirmation.
 * Sends NO Price.
 * Reads the created Sales Order back.
 */
function testClassicCustomer1AutoPricing() {
  const ss = crGetSpreadsheet_();
  const sheet = ss.getSheetByName(
    CLASSIC_REORDER.SHEET
  );

  if (!sheet) {
    throw new Error(
      'Run rebuildClassicCustomer1ReorderV2() first.'
    );
  }

  const token = crGetAccessToken_();

  const customerResponse = crApi_(
    '/v1/customers/' +
      CLASSIC_REORDER.CUSTOMER_ID,
    'get',
    null,
    token
  );

  crRequireOk_(
    customerResponse,
    'Customer lookup'
  );

  const customer =
    customerResponse.data || {};

  if (
    Number(
      customer.id ||
      customer.Id
    ) !==
    CLASSIC_REORDER.CUSTOMER_ID
  ) {
    throw new Error(
      'Safety stop: expected Customer ID 1.'
    );
  }

  const itemResponse = crApi_(
    '/v1/items/' +
      CLASSIC_REORDER_V2.TEST_ITEM_ID,
    'get',
    null,
    token
  );

  crRequireOk_(
    itemResponse,
    'Controlled test item lookup'
  );

  const item =
    itemResponse.data || {};

  if (
    item.active === false ||
    item.isActive === false
  ) {
    throw new Error(
      'Controlled test item is inactive.'
    );
  }

  const itemType =
    crRefName_(
      item.itemType ||
      item.ItemType
    );

  if (itemType !== 'Inventory') {
    throw new Error(
      'Safety stop: controlled test item is no longer Inventory. Current type: ' +
      itemType
    );
  }

  const basePrice = Number(
    item.price !== undefined
      ? item.price
      : item.Price
  );

  const ui = SpreadsheetApp.getUi();

  const confirm = ui.alert(
    'Run One-Item Pricing Test?',
    'This will create ONE Incomplete Sales Order in Classic Striven.\n\n' +
      'Customer: ' +
      (
        customer.name ||
        customer.Name ||
        'Customer ID 1'
      ) +
      '\nItem: ' +
      (
        item.itemNumber ||
        item.ItemNumber ||
        CLASSIC_REORDER_V2.TEST_ITEM_ID
      ) +
      '\nQty: ' +
      CLASSIC_REORDER_V2.TEST_QTY +
      '\nItem API base price: $' +
      crMoney_(basePrice) +
      '\n\n' +
      'IMPORTANT: The script will NOT send Price. ' +
      'We are testing what Striven calculates.\n\n' +
      'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    return {
      created: false,
      cancelled: true
    };
  }

  const payload = {
    Type:
      CLASSIC_REORDER.SO.TYPE,

    Customer: {
      Id:
        CLASSIC_REORDER.CUSTOMER_ID,
      Name:
        customer.name ||
        customer.Name ||
        ''
    },

    SalesRep:
      CLASSIC_REORDER.SO.SALES_REP,

    OrderDate:
      new Date().toISOString(),

    OrderName:
      'TEST - CUSTOMER 1 AUTO PRICING',

    PaymentTerm:
      CLASSIC_REORDER.SO.PAYMENT_TERM,

    LineItemsClass:
      CLASSIC_REORDER.SO.CLASS,

    SalesTax:
      CLASSIC_REORDER.SO.TAX,

    Status:
      CLASSIC_REORDER.SO.STATUS,

    InternalNotes: {
      NotesHtml:
        '<p>CONTROLLED TEST - Customer Reorder automatic pricing. Price intentionally omitted. Safe to delete.</p>',

      NotesText:
        'CONTROLLED TEST - Customer Reorder automatic pricing. Price intentionally omitted. Safe to delete.'
    },

    CustomFields:
      CLASSIC_REORDER.SO.CUSTOM_FIELDS,

    LineItems: [
      {
        Item: {
          Id:
            Number(
              item.id ||
              item.Id
            ),

          Name:
            item.name ||
            item.Name ||
            ''
        },

        InventoryLocation:
          CLASSIC_REORDER.SO.INVENTORY_LOCATION,

        Class:
          CLASSIC_REORDER.SO.CLASS,

        Qty:
          CLASSIC_REORDER_V2.TEST_QTY,

        // PRICE INTENTIONALLY OMITTED

        ShippingPrice:
          0,

        Taxable:
          item.taxable === true
      }
    ]
  };

  sheet.getRange('B3').setValue(
    'Creating controlled pricing-test SO...'
  );

  const createResponse = crApi_(
    '/v1/sales-orders',
    'post',
    payload,
    token
  );

  crRequireOk_(
    createResponse,
    'Controlled pricing-test Sales Order creation'
  );

  const salesOrderId = Number(
    createResponse.data &&
    (
      createResponse.data.id ||
      createResponse.data.Id
    )
  );

  if (!salesOrderId) {
    throw new Error(
      'Sales Order was created but no ID was returned.'
    );
  }

  const verifyResponse = crApi_(
    '/v1/sales-orders/' +
      salesOrderId,
    'get',
    null,
    token
  );

  crRequireOk_(
    verifyResponse,
    'Controlled pricing-test Sales Order verification'
  );

  const so =
    verifyResponse.data || {};

  const lines =
    Array.isArray(so.lineItems)
      ? so.lineItems
      : Array.isArray(so.LineItems)
        ? so.LineItems
        : [];

  const line =
    lines.length
      ? lines[0]
      : null;

  const returnedPrice =
    line
      ? Number(
          line.price !== undefined
            ? line.price
            : line.Price
        )
      : null;

  let resultType = 'FAIL';
  let interpretation =
    'Striven did not return a usable line price.';

  if (
    isFinite(returnedPrice) &&
    returnedPrice > 0 &&
    returnedPrice === basePrice
  ) {
    resultType = 'PASS - BASE PRICE';
    interpretation =
      'Striven automatically populated the current Item API base price.';
  } else if (
    isFinite(returnedPrice) &&
    returnedPrice > 0
  ) {
    resultType =
      'PASS - DIFFERENT STRIVEN PRICE';

    interpretation =
      'Striven automatically supplied a price different from the Item API base price. ' +
      'This is the result we need to investigate for customer/transaction-specific pricing.';
  }

  // Find test row and write actual returned price into Q.
  const lastRow =
    sheet.getLastRow();

  for (
    let rowIndex = 5;
    rowIndex <= lastRow;
    rowIndex++
  ) {
    const itemId = Number(
      sheet.getRange(
        rowIndex,
        2
      ).getValue()
    );

    if (
      itemId ===
      CLASSIC_REORDER_V2.TEST_ITEM_ID
    ) {
      sheet.getRange(
        rowIndex,
        17
      ).setValue(
        isFinite(returnedPrice)
          ? returnedPrice
          : ''
      );
      break;
    }
  }

  sheet.getRange('B3').setValue(
    resultType +
    ' | SO ' +
    (
      so.orderNumber ||
      so.OrderNumber ||
      salesOrderId
    )
  );

  const result = {
    result:
      resultType,

    interpretation:
      interpretation,

    customerId:
      CLASSIC_REORDER.CUSTOMER_ID,

    salesOrderId:
      salesOrderId,

    salesOrderNumber:
      so.orderNumber ||
      so.OrderNumber ||
      '',

    itemId:
      CLASSIC_REORDER_V2.TEST_ITEM_ID,

    itemNumber:
      item.itemNumber ||
      item.ItemNumber ||
      '',

    quantity:
      CLASSIC_REORDER_V2.TEST_QTY,

    itemApiBasePrice:
      basePrice,

    priceSent:
      null,

    priceReturned:
      returnedPrice,

    orderTotal:
      Number(
        so.orderTotal ||
        so.OrderTotal ||
        0
      )
  };

  crLog_(
    ss,
    'AUTO_PRICING_TEST',
    JSON.stringify(result)
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  ui.alert(
    'Auto-Pricing Test Complete',
    'Sales Order: ' +
      result.salesOrderNumber +
      '\n\n' +
      'Item API base price: $' +
      crMoney_(basePrice) +
      '\nPrice sent: NONE' +
      '\nPrice returned by Striven: $' +
      (
        isFinite(returnedPrice)
          ? crMoney_(returnedPrice)
          : 'N/A'
      ) +
      '\nOrder total: $' +
      crMoney_(result.orderTotal) +
      '\n\n' +
      resultType +
      '\n' +
      interpretation,
    ui.ButtonSet.OK
  );

  return result;
}
