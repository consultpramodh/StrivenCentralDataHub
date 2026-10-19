// /************************************************************
//  * ENTERNEWPART — ITEM CREATION ONLY
//  * - Uses Script Properties for defaults:
//  *   ENTERNEWPART_DEFAULT_COGS_GLACCOUNT_ID        (e.g. 136)
//  *   ENTERNEWPART_DEFAULT_INCOME_GLACCOUNT_ID        (e.g. 13)
//  *   ENTERNEWPART_DEFAULT_INVENTORY_GLACCOUNT_ID        (e.g. 6)
//  *   ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID       (e.g. 21)
//  *   ENTERNEWPART_DEFAULT_ITEMTYPE or _ITEMTYPE_ID (numeric Id ONLY, optional)
//  *
//  * Reads the active row in the current sheet and POSTs /v1/items.
//  ************************************************************/

// /***********************
//  * AUTH + HTTP HELPERS *
//  ***********************/

// /**
//  * Ensure we have a valid Striven token and return headers.
//  * Relies on:
//  *   STRIVEN_BASE_URL
//  *   CLIENT_ID
//  *   CLIENT_SECRET
//  *   striven_token
//  *   striven_token_expires
//  *
//  * If you already have identical helpers elsewhere, de-duplicate.
//  */
// function getStrivenAuthHeaders_legacy_copy_disabled_R3() {
//   const props = PropertiesService.getScriptProperties();
//   const baseUrl = props.getProperty('STRIVEN_BASE_URL');
//   if (!baseUrl) throw new Error('Missing STRIVEN_BASE_URL in Script Properties.');

//   const now       = Date.now();
//   const token     = props.getProperty('striven_token');
//   const expiresMs = Number(props.getProperty('striven_token_expires') || 0);

//   if (!token || !expiresMs || now >= (expiresMs - 60000)) {
//     refreshStrivenToken_();
//   }

//   const newToken = props.getProperty('striven_token');
//   if (!newToken) throw new Error('striven_token missing even after refresh.');

//   return {
//     Authorization: 'Bearer ' + newToken,
//     'Content-Type': 'application/json'
//   };
// }



// /***********************
//  * SHEET UTILITIES     *
//  ***********************/

// function indexByHeader_legacy_copy_disabled_R3(headers) {
//   const map = {};
//   headers.forEach(function (h, i) {
//     if (!h) return;
//     map[String(h).trim()] = i;
//   });
//   return map;
// }






// /**
//  * Parse ItemDescription in this format:
//  *
//  * Item Number: W435-0099-SER
//  * Item Name: SYNCRONOUS MOTOR
//  * Price: $15
//  *
//  * Returns { itemNumber, name, price }.
//  * If a piece is missing, we leave it blank/null — we DO NOT guess.
//  */
// function parseItemFromDescription_legacy_copy_disabled_R3(raw) {
//   if (!raw) {
//     return { itemNumber: '', name: '', price: null };
//   }

//   // Normalize line breaks
//   let text = String(raw).replace(/\r/g, '').trim();

//   let itemNumber = '';
//   let name = '';
//   let price = null;

//   // Match lines like "Item Number: W435-0099-SER"
//   const numMatch = text.match(/Item\s*Number\s*:\s*(.+)/i);
//   if (numMatch && numMatch[1]) {
//     itemNumber = numMatch[1].split('\n')[0].trim();
//   }

//   // Match lines like "Item Name: Dekko Table Top Lid - Alea"
//   const nameMatch = text.match(/Item\s*Name\s*:\s*(.+)/i);
//   if (nameMatch && nameMatch[1]) {
//     name = nameMatch[1].split('\n')[0].trim();
//   }

//   // Match lines like "Price: $15" or "Price: 15.00"
//   const priceMatch = text.match(/Price\s*:\s*(.+)/i);
//   if (priceMatch && priceMatch[1]) {
//     const rawPrice = priceMatch[1].split('\n')[0].trim();
//     const numeric = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));
//     if (!isNaN(numeric)) {
//       price = numeric;
//     }
//   }

//   return { itemNumber, name, price };
// }



// /*************************
//  * ITEM CREATION LOGIC   *
//  *************************/

// /**
//  * Build /v1/items payload using:
//  *  - Primary source: ItemDescription (Item Number, Name, Price)
//  *  - Optional override: NewItemNumber / NewItemName / NewItemPrice / NewItemCost
//  *  - Cross-check / override price using Price column (D)
//  *  - Script Properties for GL + location defaults + ItemType.
//  */
// function buildItemPayloadFromRow_(row, colMap) {
//   const props = PropertiesService.getScriptProperties();

//   function num(val) {
//     if (val === '' || val == null) return null;
//     const n = Number(val);
//     return isNaN(n) ? null : n;
//   }

//   // 🔹 1) Get ItemDescription (primary source)
//   let descCell = null;
//   if (colMap['ItemDescription'] != null) {
//     descCell = row[colMap['ItemDescription']];
//   } else if (row.length >= 3) {
//     // Column C fallback if header isn't there
//     descCell = row[2]; // index 2 = column C (0-based)
//   }

//   if (!descCell) {
//     throw new Error('ItemDescription (or column C) is required to derive Item Number, Name, and Price.');
//   }

//   const parsed = parseItemFromDescription_(descCell);
//   let parsedNumber = parsed.itemNumber;
//   let parsedName   = parsed.name;
//   let parsedPrice  = parsed.price;

//   // 🔹 2) Explicit overrides from sheet
//   // IMPORTANT: we ONLY respect NewItemNumber, NEVER the placeholder ItemNumber column.
//   let explicitName  = colMap['NewItemName']   != null ? row[colMap['NewItemName']]   :
//                       colMap['Name']          != null ? row[colMap['Name']]          : '';
//   let explicitNum   = colMap['NewItemNumber'] != null ? row[colMap['NewItemNumber']] : '';
//   let explicitPrice = colMap['NewItemPrice']  != null ? row[colMap['NewItemPrice']]  :
//                       colMap['Price']         != null ? row[colMap['Price']]         : '';
//   let explicitCost  = colMap['NewItemCost']   != null ? row[colMap['NewItemCost']]   :
//                       colMap['Cost']          != null ? row[colMap['Cost']]          : '';

//   // Final Item Number / Name:
//   let itemNumber = String(explicitNum || parsedNumber || '').trim();
//   let name       = String(explicitName || parsedName || '').trim();

//   // 🚫 Only block the placeholder, NOT missing numbers.
//   if (itemNumber && itemNumber.toUpperCase() === 'ENTERNEWPART') {
//     Logger.log('❌ Attempted to create item with placeholder item number: "' + itemNumber + '"');
//     throw new Error('Derived ItemNumber is placeholder (ENTERNEWPART). Check ItemDescription / NewItemNumber.');
//   }

//   // We DO require a name though — no totally blind items.
//   if (!name) {
//     throw new Error('Unable to derive Item Name. Need Item Name line in description or NewItemName.');
//   }


//   if (!name) {
//     throw new Error('Unable to derive Item Name from ItemDescription and overrides.');
//   }

//   // 🔹 4) Price:
//   // Priority: explicit Price column (D) → parsed from ItemDescription → 0
//   let priceFromSheet = num(explicitPrice);
//   let priceFromDesc  = num(parsedPrice);
//   let finalPrice     = 0;

//   if (priceFromSheet != null && priceFromDesc != null && priceFromSheet !== priceFromDesc) {
//     Logger.log('⚠️ Price mismatch for item "' + itemNumber + '": desc=' +
//                priceFromDesc + ', sheet Price=' + priceFromSheet +
//                '. Using sheet Price column.');
//   }

//   if (priceFromSheet != null) {
//     finalPrice = priceFromSheet;
//   } else if (priceFromDesc != null) {
//     finalPrice = priceFromDesc;
//   } else {
//     finalPrice = 0;
//   }

//   const cost = num(explicitCost) || 0;

//   // 🔹 5) Description:
//   // If NewItemDescription is explicitly provided, respect it.
//   // Otherwise:
//   //   - If we have both name + itemNumber: "Name (ItemNumber)"
//   //   - If only name: just name
//   //   - If only itemNumber: just itemNumber
//   let finalDesc;
//   const explicitDescIdx = colMap['NewItemDescription'];

//   if (explicitDescIdx != null && row[explicitDescIdx]) {
//     finalDesc = String(row[explicitDescIdx]).trim();
//   } else if (name && itemNumber) {
//     finalDesc = name + ' (' + itemNumber + ')';
//   } else if (name) {
//     finalDesc = name;
//   } else if (itemNumber) {
//     finalDesc = itemNumber;
//   } else {
//     finalDesc = '';
//   }

//   const payload = {
//     Id:          0,
//     Name:        name,         // e.g. "SYNCRONOUS MOTOR"
//     Description: finalDesc,    // e.g. "SYNCRONOUS MOTOR (W435-0099-SER)" or just name
//     Price:       finalPrice,   // 15
//     Cost:        cost,
//     Active:      true,
//     Taxable:     true
//   };

//   // Only send ItemNumber if we actually have one
//   if (itemNumber) {
//     payload.ItemNumber = itemNumber;
//   }



//   // 🔹 6) Default GL + Inventory Location from Script Properties (full names)
//   const incomeId = num(props.getProperty('ENTERNEWPART_DEFAULT_INCOME_GLACCOUNT_ID'));
//   const invId    = num(props.getProperty('ENTERNEWPART_DEFAULT_INVENTORY_GLACCOUNT_ID'));
//   const cogsId   = num(props.getProperty('ENTERNEWPART_DEFAULT_COGS_GLACCOUNT_ID'));
//   const locId    = num(props.getProperty('ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID'));

//   if (incomeId) payload.IncomeGLAccount = { Id: incomeId };
//   if (invId)    payload.InventoryAssetGLAccount = { Id: invId };
//   if (cogsId)   payload.COGSGLAccount = { Id: cogsId };
//   if (locId)    payload.DefaultInventoryLocation = { Id: locId };

//   // 🔹 7) REQUIRED: ItemType (we already know 1 works = Inventory)
//   const typeId = num(props.getProperty('ENTERNEWPART_DEFAULT_ITEMTYPE_ID'));
//   if (!typeId) {
//     throw new Error('ENTERNEWPART_DEFAULT_ITEMTYPE_ID is missing or invalid. Cannot create item.');
//   }
//   payload.ItemType = { Id: typeId };

//   return payload;
// }


// /**
//  * Try to pull an Item Id out of whatever Striven returned.
//  * Handles a few possible shapes:
//  *  - { Id: 123 }
//  *  - { id: 123 }
//  *  - { Data: { Id: 123 } }
//  *  - { Data: [ { Id: 123 }, ... ] }
//  *  - 123 (plain number)
//  */
// function extractItemIdFromResponse_legacy_copy_disabled_R3(res) {
//   if (!res) return null;

//   // Plain number
//   if (typeof res === 'number') {
//     return res;
//   }

//   // Direct Id
//   if (res.Id) return res.Id;
//   if (res.id) return res.id;

//   // Wrapped in Data
//   if (res.Data) {
//     const d = res.Data;

//     if (typeof d === 'number') return d;
//     if (d.Id) return d.Id;

//     if (Array.isArray(d) && d.length && d[0] && d[0].Id) {
//       return d[0].Id;
//     }
//   }

//   return null;
// }



// /**
//  * Create an Item in Striven from the ACTIVE ROW in the ACTIVE SHEET.
//  * Expected headers (row 1):
//  *   NewItemNumber / ItemNumber
//  *   NewItemName   / Name
//  *   (optional) NewItemDescription / Description
//  *   (optional) NewItemPrice / Price
//  *   (optional) NewItemCost  / Cost
//  *
//  * Writes the new Item Id back into column "NewItemId" if it exists.
//  */
// function createItemFromActiveRow() {
//   const sh      = SpreadsheetApp.getActiveSheet();
//   const rowIdx  = sh.getActiveRange().getRow();
//   const lastCol = sh.getLastColumn();

//   if (rowIdx === 1) throw new Error('Active row is header row. Move cursor to a data row.');

//   const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
//   const data    = sh.getRange(rowIdx, 1, 1, lastCol).getValues()[0];
//   const col     = indexByHeader_(headers);

//   const payload = buildItemPayloadFromRow_(data, col);

//   const res = strivenRequest_('POST', '/v1/items', payload);

//   // 🔍 Log full response so we can see the shape in execution logs
//   Logger.log('Item create response: ' + JSON.stringify(res));

//   const newId = extractItemIdFromResponse_(res);

//   if (!newId) {
//     throw new Error('Item create succeeded (HTTP 200) but response did not include a usable Id. See logs for raw response.');
//   }

//   Logger.log('✅ Created Item Id ' + newId + ' for row ' + rowIdx);

//   // Write back to NewItemId column if it exists
//   const idxNewItemId = col['NewItemId'];
//   if (idxNewItemId != null) {
//     data[idxNewItemId] = newId;
//     sh.getRange(rowIdx, 1, 1, lastCol).setValues([data]);
//   }

//   return newId;
// } 


// /**
//  * Create a hard-coded TEST ITEM directly in Striven.
//  * This bypasses sheet logic and description parsing.
//  */
// function createTestItem() {
//   const payload = {
//     Id: 0,
//     Name: "TEST ITEM " + new Date().toISOString(),
//     ItemNumber: "TEST-" + Date.now(),
//     Description: "Created via Apps Script Test",
//     Price: 123.45,
//     Cost: 90,
//     Active: true,
//     Taxable: true,

//     // 🔥 Item Type – assume Inventory = Id 1
//     ItemType: {
//       Id: 1,
//       Name: "Inventory"
//     },

//     // 🔥 Your known GL + Location IDs
//     IncomeGLAccount:          { Id: 13 },
//     InventoryAssetGLAccount:  { Id: 6 },
//     COGSGLAccount:            { Id: 136 },
//     DefaultInventoryLocation: { Id: 21 }
//   };

//   const res = strivenRequest_('POST', '/v1/items', payload);
//   Logger.log("✅ TEST ITEM CREATED: " + JSON.stringify(res));
// }





