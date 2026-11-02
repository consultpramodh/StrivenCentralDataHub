'use strict';
const fs=require('fs');
const file=process.argv[2];
if(!file)throw Error('Usage: node patch-data-items.js PATH');
let src=fs.readFileSync(file,'utf8');
function swap(a,b){const i=src.indexOf(a);if(i<0||src.indexOf(a,i+a.length)>=0)throw Error('Expected unique source fragment not found');src=src.slice(0,i)+b+src.slice(i+a.length);}
swap("    const schema = hub_stdItemsSchema_();\n    const canonicalHeaders = hub_stdItemsHeaders_();",
`    // The requested Inventory report supplies 15 fields. User policy sets Taxable
    // to Yes and defines ItemsSKU as the same value as ItemsUPC.
    const schema = hub_stdItemsSchema_().concat([
      {canonical:'ManufacturePart',aliases:['ManufacturePart']},
      {canonical:'SerialNumberTracking',aliases:['SerialNumberTracking']}
    ]);
    const canonicalHeaders = schema.map(function(x){return x.canonical;});`);
swap("    const canonicalRows = [];\n    let sourceMap = null;","    const canonicalRows = [];\n    const itemIds = new Set();\n    let expectedTotal = null;\n    let sourceMap = null;");
swap("      const pageRows = hub_stdItemsExtractRows_(payload);\n\n      if (!pageRows.length)",
`      const pageRows = hub_stdItemsExtractRows_(payload);
      const total = Number(payload && payload.totalRecords);
      if(!Number.isSafeInteger(total)||total<0) throw new Error('Inventory report lacks a valid totalRecords count.');
      if(expectedTotal===null) expectedTotal=total;
      else if(expectedTotal!==total) throw new Error('Inventory report changed during pagination; DATA_ITEMS retained.');
      if(Number(payload.pageIndex)!==pageIndex) throw new Error('Inventory report page index mismatch.');

      if (!pageRows.length)`);
swap("        sourceMap = hub_buildCanonicalSourceMap_(pageRows[0], schema, false);","        sourceMap = hub_buildCanonicalSourceMap_(hub_normalizeInventoryItemsRow_(pageRows[0]), schema, false);");
swap("        const row = pageRows[i];\n        const rowMap = hub_buildCanonicalSourceMap_(row, schema, false);",
`        const row = hub_normalizeInventoryItemsRow_(pageRows[i]);
        const rowMap = hub_buildCanonicalSourceMap_(row, schema, false);
        const id=String(row.Id==null?'':row.Id).trim();
        if(!/^[1-9]\\d*$/.test(id)||itemIds.has(id))throw new Error('Inventory report contains a missing or duplicate item ID; DATA_ITEMS retained.');
        itemIds.add(id);`);
swap("    // Replace DATA_ITEMS only AFTER the entire remote report is fetched and validated.",
`    if(canonicalRows.length!==expectedTotal)throw new Error('Inventory report row count mismatch; DATA_ITEMS retained.');
    // Replace DATA_ITEMS only AFTER the entire remote report is fetched and validated.`);
swap("  const clearRows = Math.max(sheet.getLastRow(), neededRows);",
`  // Preserve leading zeroes and avoid numeric coercion of product identifiers.
  if(headers.indexOf('ManufacturePart')>=0) ['ItemNumber','ItemsSKU','ItemsUPC','ManufacturePart'].forEach(function(key){
    const col=headers.indexOf(key);if(col>=0&&neededRows>1)sheet.getRange(2,col+1,neededRows-1,1).setNumberFormat('@');
  });
  const clearRows = Math.max(sheet.getLastRow(), neededRows);`);
const marker="function hub_refreshStdItems() {";
swap(marker,`function hub_normalizeInventoryItemsRow_(row) {
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('Invalid inventory report row.');
  const keys=['ItemNumber','Id','ItemName','ItemCategory','Cost','Price','MAPPricing','ItemType','PreferredVendor','Description','Manufacturer','ManufacturePart','LocationName','ItemsUPC','SerialNumberTracking'];
  if(Object.keys(row).length!==keys.length||keys.some(function(k){return !Object.prototype.hasOwnProperty.call(row,k);}))throw new Error('Inventory report schema changed; DATA_ITEMS retained.');
  const out=Object.assign({},row);
  out.ItemTaxable='Yes';
  out.ItemsSKU=row.ItemsUPC==null?'':String(row.ItemsUPC);
  return out;
}

`+marker);
fs.writeFileSync(file,src);
