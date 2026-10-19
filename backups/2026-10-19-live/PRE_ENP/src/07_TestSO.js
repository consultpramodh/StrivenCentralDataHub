function enp_testCreateNewSOWithItemGroupFromSO() {
  // ---------------------------------------------
  // INPUTS: existing SO and Item Group
  // ---------------------------------------------
  const sourceSoId = 24012;     // existing SO
  const itemGroupId = 42454;    // the item group item you want on the NEW SO
  const qty = 1;                // parent group qty

  // ---------------------------------------------
  // 1) GET SOURCE SALES ORDER
  // ---------------------------------------------
  const so = enp_strivenFetch_('/v1/sales-orders/' + sourceSoId, {
    method: 'get'
  });

  if (!so || !so.id) {
    throw new Error('Source sales order not found: ' + sourceSoId);
  }

  // ---------------------------------------------
  // 2) GET ITEM GROUP
  // ---------------------------------------------
  const itemRes = enp_strivenFetch_('/v1/items/' + itemGroupId, {
    method: 'get'
  });

  const item = itemRes && itemRes.Data ? itemRes.Data : itemRes;
  if (!item || !item.id) {
    throw new Error('Item not found: ' + itemGroupId);
  }

  const itemTypeName = String(
    (item.itemType && item.itemType.name) ||
    (item.ItemType && item.ItemType.Name) ||
    ''
  ).toLowerCase();

  if (itemTypeName !== 'item group') {
    throw new Error('Item ' + itemGroupId + ' is not an Item Group.');
  }

  if (!Array.isArray(item.groupItems) || !item.groupItems.length) {
    throw new Error('Item Group ' + itemGroupId + ' has no groupItems.');
  }

  // ---------------------------------------------
  // 3) BASE CLASS (reuse SO line-item class)
  // ---------------------------------------------
  const firstLineWithClass = (so.lineItems || []).find(function (li) {
    return li && li.class && li.class.id;
  });

  if (!firstLineWithClass) {
    throw new Error('Could not derive required line-item Class from source SO.');
  }

  const baseClass = {
    Id: Number(firstLineWithClass.class.id),
    Name: firstLineWithClass.class.name || ''
  };

  // ---------------------------------------------
  // 4) MAP SO-LEVEL CUSTOM FIELDS (required, 775/831, etc.)
  // ---------------------------------------------
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

  // Optionally sanity‑check required CFs (775/831) like you did before
  const cfIds = mappedCustomFields.map(function (x) { return x.Id; });
  if (cfIds.indexOf(775) === -1) {
    throw new Error('Source SO is missing required Custom Field 775 in GET response.');
  }
  if (cfIds.indexOf(831) === -1) {
    throw new Error('Source SO is missing required Custom Field 831 in GET response.');
  }

  // ---------------------------------------------
  // 5) BUILD CHILD LINES FROM ITEM GROUP
  // ---------------------------------------------
  const groupChildLines = item.groupItems.map(function (gi) {
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
      Class: baseClass
    };
  });

  // ---------------------------------------------
  // 6) BUILD PARENT ITEM GROUP LINE
  // ---------------------------------------------
  const parentGroupLine = {
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
      Id: 21,   // same as in your other tests; adjust if needed
      Name: ''
    },
    Class: baseClass,
    ItemGroupLineItems: groupChildLines
  };

  // ---------------------------------------------
  // 7) BUILD NEW SALES ORDER PAYLOAD
  //     NOTE: Id = 0 to create a NEW SO
  // ---------------------------------------------
  const payload = {
    Id: 0,  // NEW SALES ORDER
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
    OrderNumber: '',             // let Striven assign, or clone so.orderNumber if they allow
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
    IsChangeOrder: false,        // new SO, usually false
    ParentId: 0,                 // no parent by default
    IsRecurring: !!so.isRecurring,
    CustomFields: mappedCustomFields,
    LineItems: [parentGroupLine] // ONLY the new group; append others if you want
  };

  Logger.log('NEW SO WITH GROUP PAYLOAD: ' + JSON.stringify(payload, null, 2));

  const res = enp_strivenFetch_('/v1/sales-orders', {
    method: 'post',
    body: payload
  });

  Logger.log('NEW SO WITH GROUP RESPONSE: ' + JSON.stringify(res, null, 2));
  return res;
}