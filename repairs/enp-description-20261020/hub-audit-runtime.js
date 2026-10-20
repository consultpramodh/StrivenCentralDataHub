
// Google Apps Script — review-only sheet workflow; never calls Striven.
function hub_enpDescriptionContext_() {
  const book=SpreadsheetApp.openById('13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU');
  const sheet=book.getSheetByName('ENTERNEWPART');
  if(!sheet)throw new Error('Missing ENTERNEWPART');
  const grid=sheet.getDataRange().getValues(),headers=grid[0]||[];
  const expected={1:'Item Number',2:'Item Name',3:'Price',17:'Source',19:'SO Internal ID',22:'SO Line Price',30:'Source Item Price',31:'Original Description'};
  Object.keys(expected).forEach(function(key){if(headers[Number(key)]!==expected[key])throw new Error('Description audit schema drift: '+expected[key]);});
  if(headers[43]&&headers[43]!=='Description Quality')throw new Error('AR is occupied; no write performed.');
  const rows=[];
  grid.slice(1).forEach(function(r,i){if(r[1]||r[17]||r[31])rows.push({row:i+2,sku:r[1]||'',name:r[2]||'',price:r[3]==null?'':r[3],raw:r[31]||'',soPrice:r[22],soId:r[19],source:r[17]});});
  const master=SpreadsheetApp.openById('12yGJYyTYW9DRPA53MG7vQJWAK6moFjlQZXu17pfxgCs').getSheetByName('Inventory');
  const shared=book.getSheetByName('DATA_ITEMS');
  const catalog=[];
  [{sheet:master,source:'masterInventory'},{sheet:shared,source:'hubCatalog'}].forEach(function(s){
    if(!s.sheet)throw new Error('Missing '+s.source);
    const data=s.sheet.getRange(1,1,s.sheet.getLastRow(),6).getValues();
    if(data[0][0]!=='ItemNumber'||data[0][1]!=='Id'||data[0][2]!=='ItemName'||data[0][5]!=='Price')throw new Error('Catalog schema drift: '+s.source);
    data.slice(1).forEach(function(r,i){catalog.push({source:s.source,sourceRow:i+2,sku:r[0],id:r[1],name:r[2],category:r[3],cost:r[4],price:r[5]});});
  });
  return {book:book,sheet:sheet,grid:grid,rows:rows,results:rows.map(function(r){return hub_enpClassifyRecord_(r,catalog);})};
}
function hub_previewEnternewpartDescriptions() {
  const ctx=hub_enpDescriptionContext_(),counts={};
  ctx.results.forEach(function(r){counts[r.category]=(counts[r.category]||0)+1;});
  const out={rows:ctx.results.length,categories:counts,strivenCalls:0,writes:0,results:ctx.results};
  Logger.log(JSON.stringify(out));return out;
}
function hub_enpWriteDescriptionReview_(ctx) {
  const name='ENP_DESCRIPTION_REVIEW',sh=ctx.book.getSheetByName(name)||ctx.book.insertSheet(name);
  const head=['Hub Row','Source','SO Internal ID','Item Number','Item Name','Price','Item Number Status','Item Name Status','Price Status','Description Quality','Issues','Evidence','Original Description','Audit UTC'];
  if(sh.getLastRow()&&sh.getRange(1,1,1,14).getValues()[0].join('|')!==head.join('|'))throw new Error('Review table schema drift.');
  const at=new Date().toISOString(),values=[head].concat(ctx.results.map(function(r,i){const src=ctx.rows[i];return [r.row,src.source,src.soId||'',r.itemNumber,r.itemName,r.price==null?'':r.price,r.numberStatus,r.nameStatus,r.priceStatus,r.category,r.issues.join(' | '),r.evidence.join('\n'),r.original,at];}));
  if(sh.getMaxRows()<values.length)sh.insertRowsAfter(sh.getMaxRows(),values.length-sh.getMaxRows());
  const old=sh.getLastRow();sh.getRange(1,1,values.length,14).setValues(values);
  if(old>values.length)sh.getRange(values.length+1,1,old-values.length,14).clearContent();
  sh.setFrozenRows(1);
}
function hub_applyEnternewpartDescriptionRepairs() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    const ctx=hub_enpDescriptionContext_(),sh=ctx.sheet;
    // Stop if another editor changed the source during catalog inspection.
    const current=sh.getDataRange().getValues();
    if(JSON.stringify(current)!==JSON.stringify(ctx.grid))throw new Error('ENTERNEWPART changed during preparation; rerun preview.');
    const stamp=Utilities.formatDate(new Date(),'UTC','yyyyMMdd_HHmmss');
    const backup=sh.copyTo(ctx.book).setName('ENP_DESC_BACKUP_'+stamp);backup.hideSheet();
    // Validate derived-output ownership before touching operational review cells.
    const review=ctx.book.getSheetByName('ENP_DESCRIPTION_REVIEW');
    if(review&&review.getLastRow()&&review.getRange(1,1).getValue()!=='Hub Row')throw new Error('Review sheet is not the owned output.');
    ctx.results.forEach(function(r){
      sh.getRange(r.row,2,1,3).setValues([[r.itemNumber,r.itemName,r.price==null?'':r.price]]);
      sh.getRange(r.row,2,1,3).setNotes([[r.numberStatus+'\n'+r.evidence.join('\n'),r.nameStatus+'\nOriginal Description retained in AF.',r.priceStatus+'\n'+r.evidence.join('\n')]]);
      const parsed=hub_descParseFields_(r.original);
      if(parsed.price!==null)sh.getRange(r.row,31).setValue(parsed.price).setNote('Reparsed source selling price from Original Description; not supplier list price.');
      sh.getRange(r.row,44).setValue(r.category).setNote(r.issues.join(' | '));
    });
    sh.getRange(1,44).setValue('Description Quality');sh.showColumns(44);
    hub_enpWriteDescriptionReview_(ctx);SpreadsheetApp.flush();
    ctx.results.forEach(function(r){const saved=sh.getRange(r.row,2,1,3).getValues()[0];if(saved[0]!==r.itemNumber||saved[1]!==r.itemName||saved[2]!== (r.price==null?'':r.price))throw new Error('Description repair readback failed at row '+r.row);if(sh.getRange(r.row,32).getValue()!==r.original)throw new Error('Original Description changed at row '+r.row);});
    const result={status:'REVIEW_SHEET_REPAIRED',rows:ctx.results.length,backup:backup.getName(),strivenCalls:0,strivenWrites:0,creationAuthorizationChanged:false};
    Logger.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
