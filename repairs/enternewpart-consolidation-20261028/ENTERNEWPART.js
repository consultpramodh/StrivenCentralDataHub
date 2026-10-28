// Google Apps Script — pure parser/classifier; no external API calls.
function hub_descNormalizeText_(text) {
  return String(text == null ? '' : text).replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/&#x([0-9a-f]+);/gi,(whole,x)=>{const n=parseInt(x,16);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&#(\d+);/g,(whole,x)=>{const n=Number(x);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
    .replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').trim();
}
function hub_descParseMoney_(text) {
  if (text == null || String(text).trim()==='') return null;
  let s=String(text).trim().replace(/[\u00a0\u202f]/g,' ');
  s=s.replace(/^(?:CAD|USD)[ \t]*/i,'').replace(/^\$[ \t]*/,'');
  if (!/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?: \d{3})+(?:\.\d{1,2})?)$/.test(s)) return null;
  const n=Number(s.replace(/[, ]/g,''));
  return Number.isFinite(n)&&n>=0&&n<=9999999999998?n:null;
}
function hub_descValidNumber_(value) {
  const s=String(value||'').trim();
  return !!s && !/[\r\n]|(?:item\s*name|item\s*number|price)\s*:/i.test(s) &&
    s.split(/\s+/).length<5 && !/["<>]/.test(s) && s.toUpperCase()!=='ENTERNEWPART';
}
function hub_descValidName_(value) {
  const s=String(value||'').trim();
  return !!s && !/^(?:item\s*name|item\s*number|price)\s*:/i.test(s) && !/^NEEDSSKU\b/i.test(s);
}
function hub_descCanonicalName_(name,number) {
  let s=String(name||'').trim().replace(/\s+/g,' '),sku=String(number||'').trim();
  if (!s) return '';
  if (!sku) return s;
  const suffix=' ('+sku+')';
  while(s.toUpperCase().endsWith(suffix.toUpperCase()))s=s.slice(0,-suffix.length).trim();
  return s?s+suffix:'';
}
function hub_descParseFields_(text) {
  const raw=String(text==null?'':text),normalized=hub_descNormalizeText_(raw),issues=[];
  const lines=normalized.split('\n').map(s=>s.trim()).filter(Boolean);
  const labels=[],values={number:[],name:[],price:[]};let current=null;
  for(const line of lines){
    const m=line.match(/^(Item[ \t]*Number|Item[ \t]*Name|Price)[ \t]*:[ \t]*(.*)$/i);
    if(m){const key=/number/i.test(m[1])?'number':/name/i.test(m[1])?'name':'price';labels.push(key);current=key;values[key].push(m[2]);}
    else if(current==='name'&&values.name.length===1)values.name[0]+=(values.name[0]?' ':'')+line;
    else if(current)issues.push('UNEXPECTED_CONTINUATION');
  }
  let itemNumber='',name='',price=null,multiItem=false,format=labels.length?'LABELED':'UNLABELED';
  if(labels.length){
    for(const key of Object.keys(values))if(values[key].length>1)issues.push('DUPLICATE_'+key.toUpperCase()+'_LABEL');
    itemNumber=values.number.length===1?values.number[0].trim():'';
    name=values.name.length===1?values.name[0].trim():'';
    price=values.price.length===1?hub_descParseMoney_(values.price[0]):null;
    if(labels.join(',')!=='number,name,price')issues.push('LABEL_STRUCTURE');
    if(values.price[0]&&price===null)issues.push('INVALID_PRICE');
  }else if(normalized){
    multiItem=lines.filter(s=>/^[-•]\s+/.test(s)).length>1;
    if(multiItem){name=lines[0];issues.push('MULTI_ITEM_DESCRIPTION');}
    else{
      const priceLines=lines.filter(s=>/^(?:CAD|USD)?\s*\$/.test(s));
      if(priceLines.length===1)price=hub_descParseMoney_(priceLines[0]);
      const body=lines.filter(s=>!priceLines.includes(s));
      const first=body[0]||'';
      const leading=first.match(/^([A-Za-z0-9][A-Za-z0-9._\/-]*)(?:[ \t]+(.*))?$/);
      if(leading&&/\d/.test(leading[1])){itemNumber=leading[1];name=[leading[2]||'',...body.slice(1)].join(' ').trim();}
      else name=body.join(' ').trim();
      issues.push('NONSTANDARD_FORMAT');
    }
  }
  const sourceItemNumber=itemNumber,sourceItemName=name;
  if(itemNumber&&!hub_descValidNumber_(itemNumber)){issues.push('INVALID_ITEM_NUMBER');itemNumber='';}
  if(name&&!hub_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';}
  if(!itemNumber)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
  return {raw,normalized,itemNumber,name,price,sourceItemNumber,sourceItemName,multiItem,format,labels,issues:[...new Set(issues)]};
}

const HUB_ENP_DESCRIPTION_ALIASES={
 '77L70':{sku:'SV4.5L6',name:'6" Length Rigid DV Vent',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'},
 '77L75':{sku:'SV4.5LA',name:'Adjustable Length Slip Section (2" - 7.5") - rigid',url:'https://ihp.us.com/wp-content/uploads/2021/09/901189-00_A_AST_ScorpioCD_35_40_45-C_DEN-DEP_DV_FP_ECO_IICO.pdf'}
};
function hub_enpClassifyRecord_(row,catalog) {
 const parsed=hub_descParseFields_(row.raw),issues=[],evidence=[],manual=!String(row.raw||'').trim();
 let sku=manual?String(row.sku||'').trim():parsed.itemNumber;
 let name=manual?String(row.name||'').trim():parsed.name;
 let price=manual?hub_descParseMoney_(row.price):parsed.price;
 let numberStatus=sku?'SOURCE_VALUE':'MISSING',nameStatus=name?'SOURCE_VALUE':'MISSING',priceStatus=price!==null?'DESCRIPTION_PRICE':'MISSING';
 if(manual){priceStatus=price!==null?'MANUAL_VALUE':'MISSING';}
 if(!manual&&parsed.format==='UNLABELED')issues.push('NONSTANDARD_FORMAT');
 if(parsed.multiItem){return {row:row.row,itemNumber:'',itemName:'BDM VENTING — multiple components; split required',price:null,category:'MULTI_ITEM',numberStatus:'SPLIT_REQUIRED',nameStatus:'MULTI_COMPONENT_DESCRIPTION',priceStatus:'AGGREGATE_NOT_ALLOCATED',issues:['MULTI_ITEM_DESCRIPTION'],evidence:['Original Description contains multiple bullet components; SO line total is not an individual item price.'],original:row.raw};}
 if(!sku&&parsed.sourceItemNumber&&hub_descValidName_(parsed.sourceItemNumber)) name=parsed.sourceItemNumber+' — '+name;
 if(sku&&!hub_descValidNumber_(sku)){issues.push('INVALID_ITEM_NUMBER');sku='';numberStatus='INVALID';}
 if(name&&!hub_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';nameStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NUMBER')){issues.push('INVALID_ITEM_NUMBER');numberStatus='INVALID';}
 if(parsed.issues.includes('INVALID_ITEM_NAME'))issues.push('INVALID_ITEM_NAME');
 for(const x of parsed.issues.filter(x=>/^DUPLICATE_|INVALID_PRICE|LABEL_STRUCTURE|UNEXPECTED_CONTINUATION/.test(x)))issues.push(x);
 // An explicitly documented manufacturer alias can reuse a known local model.
 const originalSku=sku,alias=HUB_ENP_DESCRIPTION_ALIASES[sku.toUpperCase()];
 if(alias){sku=alias.sku;name=alias.name;numberStatus='VERIFIED_MANUFACTURER_ALIAS';nameStatus='VERIFIED_MANUFACTURER_ALIAS';evidence.push(alias.url+' — '+originalSku+' = '+sku);}
 // DUR is a vendor prefix in this supplied row, not the part number.
 if(!sku&&/^DUR\s+4BVK\s+/i.test(parsed.normalized)){
   sku='4BVK';name=parsed.normalized.replace(/^DUR\s+4BVK\s+/i,'').replace(/\s+/g,' ');numberStatus='MANUFACTURER_VERIFIED';nameStatus='SOURCE_VALUE';
   evidence.push('https://duravent.com/literature/DV_BVGV_CT-001E_04-24_web.pdf — 4BVK roof top termination kit');
 }
 const all=catalog.filter(r=>String(r.sku).trim().toUpperCase()===sku.toUpperCase()&&sku);
 const usable=all.filter(r=>hub_descValidNumber_(r.sku)&&(hub_descValidName_(r.name)||alias)&&Number(r.id)>0);
 const ids=[...new Set(usable.map(r=>Number(r.id)))];
 let exact=null;
 if(ids.length===1){exact=usable.find(r=>r.source==='masterInventory')||usable[0];sku=String(exact.sku).trim();if(numberStatus==='SOURCE_VALUE')numberStatus='EXACT_CATALOG_IDENTITY';evidence.push(exact.source+' row '+exact.sourceRow+'; Item ID '+exact.id);}
 else if(ids.length>1)issues.push('AMBIGUOUS_CATALOG_IDENTITY');
 else if(all.length){issues.push('CORRUPT_CATALOG_MATCH');evidence.push('Matching catalog row has invalid item number/name; not accepted as authoritative.');}
 else if(sku&&!['MANUFACTURER_VERIFIED'].includes(numberStatus))issues.push('NO_CATALOG_IDENTITY');
 if(exact&&!hub_descValidName_(exact.name))issues.push('CATALOG_NAME_REPAIR_REQUIRED');
 if(!name&&exact&&hub_descValidName_(exact.name)){name=String(exact.name).trim();nameStatus='EXACT_CATALOG_FILL';}
 if(!sku&&name){
   const normal=s=>String(s).trim().replace(/\s*\([^()]+\)\s*$/,'').replace(/\s+/g,' ').toUpperCase();
   const candidates=catalog.filter(r=>hub_descValidNumber_(r.sku)&&normal(r.name)===normal(name));
   const candidateIds=[...new Set(candidates.map(r=>r.id))];
   if(candidateIds.length){evidence.push('Name-only candidate(s), not auto-selected: '+[...new Set(candidates.map(r=>String(r.sku)+' / ID '+r.id))].join('; '));issues.push('NAME_ONLY_CANDIDATE_REQUIRES_CONTEXT');}
 }
 if(price===null&&typeof row.soPrice==='number'&&Number.isFinite(row.soPrice)&&row.soPrice>0){price=row.soPrice;priceStatus='SO_LINE_PRICE_FALLBACK';evidence.push('ENTERNEWPART!W'+row.row+' sales-order line price; not independently verified supplier list price.');}
 if(price===null&&exact&&typeof exact.price==='number'&&Number.isFinite(exact.price)&&exact.price>0){price=exact.price;priceStatus='EXACT_CATALOG_PRICE';evidence.push(exact.source+'!F'+exact.sourceRow+' existing item selling price; not supplier list cost input.');}
 if(price!==null&&typeof row.soPrice==='number'&&row.soPrice!==price)issues.push('ORDER_PRICE_DIFFERS');
 if(price!==null&&exact&&typeof exact.price==='number'&&exact.price!==price){issues.push('CATALOG_PRICE_DIFFERS');evidence.push('Catalog price '+exact.price+' differs from selected transaction/description price '+price+'.');}
 if(price===0)issues.push('ZERO_PRICE_REQUIRES_REVIEW');
 if(!sku)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
 const outName=hub_descCanonicalName_(name,sku);
 let category;
 if(!sku&&!name&&price===null)category='NO_ITEM_INFORMATION';
 else if(issues.some(x=>/^INVALID_|^CORRUPT_CATALOG|^DUPLICATE_|^LABEL_STRUCTURE|^UNEXPECTED_CONTINUATION/.test(x)))category='INCORRECT_INFORMATION';
 else if(issues.some(x=>/^MISSING_/.test(x)))category='PARTIAL_INFORMATION';
 else if(issues.some(x=>/DIFFERS|AMBIGUOUS|ZERO_PRICE/.test(x)))category='CONFLICTING_INFORMATION';
 else if(issues.some(x=>/NO_CATALOG|CATALOG_NAME/.test(x)))category='IDENTITY_REVIEW';
 else category=parsed.format==='UNLABELED'&&!manual?'FORMAT_RECOVERED':manual?'MANUAL_SOURCE':'STRUCTURED';
 return {row:row.row,itemNumber:sku,itemName:outName,price,category,numberStatus,nameStatus,priceStatus,issues:[...new Set(issues)],evidence,original:row.raw};
}


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


function enp_runHubRow2CreateAndReplace() { return hub_row2LegacyEngine_().enp_runHubRow2CreateAndReplace(); }
function hub_previewRow2CreateAndReplace() { return hub_row2LegacyEngine_().enp_previewHubRow2CreateAndReplace(); }
function hub_recoverItemGroupMasterBridgeWatchdog() { return hub_row2LegacyEngine_().enp_recoverItemGroupMasterBridgeWatchdog(); }
function hub_row2LegacyEngine_() {
function enp_runHubRow2CreateAndReplace() {
  const lock=LockService.getUserLock();lock.waitLock(1000);
  let hub=null,plan=null,itemId=null;
  try {
    hub=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
    const source=hub;
    if(!hub||!source) throw new Error('Required Hub/legacy source sheet missing');
    plan=enp_hubNativePlan_(hub.getDataRange().getValues());
    const liveSo=enp_getSalesOrder_(plan.soId);
    const liveStatus=(liveSo&&(liveSo.status||liveSo.Status))||{};
    if(enp_guardUpper_(liveStatus.Name!=null?liveStatus.Name:liveStatus.name)!=='APPROVED') throw new Error('Live SO is not Approved; stopped before item creation');
    if(String(liveSo.orderNumber!=null?liveSo.orderNumber:liveSo.OrderNumber)!==String(plan.record['Sales Order Number'])) throw new Error('Live SO number mismatch');
    let existing=enp_legacyExactLookupNow_(plan.record['Item Number']);
    itemId=existing?enp_guardItemId_(existing):null;
    const target=enp_findTargetPlaceholderLine_(enp_getSalesOrderLineItems_(liveSo),{
      desiredItemNumber:plan.record['Item Number'],desiredQty:plan.quantity,newItemId:itemId});
    if(!target) throw new Error('No unique exact thermostat line on live SO; stopped before item creation');
    const liveQty=enp_verificationNumber_(target.qty!=null?target.qty:target.Qty!=null?target.Qty:target.quantity!=null?target.quantity:target.Quantity);
    const livePrice=enp_verificationNumber_(target.price!=null?target.price:target.Price);
    if(liveQty!==plan.quantity||livePrice!==plan.price) throw new Error('Live SO quantity/price changed; review required before item creation');
    const staged=plan.sourceRow.slice(),col=plan.sourceCol;
    staged[col.NewItemNumber]=plan.record['Item Number'];
    staged[col.NewItemName]=plan.baseName;
    staged[col.NewItemPrice]=plan.price;staged[col.NewItemCost]=plan.cost;
    const payload=enp_buildItemPayloadFromSheetRow_(staged,col);
    payload.Name=plan.record['Item Name'];
    if(!existing) {
      enp_legacyHydrateReferences_(plan.record,payload);
      enp_legacyAssertHubRow2Unchanged_(hub,plan);
      enp_legacyWriteHubStatus_(hub,'READY','Legacy execution preflight passed; exact lookup absent; creating the authorized item.');
    }
    enp_soDefaultInventoryLocationId_(); // Resolve required SO location before any new item POST.
    const resolution=enp_guardCreateOrResolveItem_(payload);
    itemId=Number(resolution.id);
    if(!Number.isSafeInteger(itemId)||itemId<=0) throw new Error('Resolver returned invalid item ID');
    // Capture identity BEFORE optional item readback, SO mutation, or later failure.
    enp_legacySaveSourceResolution_(source,plan,resolution);
    const hubCols=plan.hubCol;
    hub.getRange(2,hubCols['Striven Item ID']+1).setValue(itemId);
    const verified=enp_legacyLiveItem_(itemId);
    if(enp_guardUpper_(enp_guardItemNumber_(verified))!==enp_guardUpper_(plan.record['Item Number'])) throw new Error('Resolved live item number mismatch');
    if(resolution.status==='CREATED' &&
       (enp_guardItemName_(verified)!==plan.record['Item Name'] ||
        enp_guardItemPrice_(verified)!==plan.price || enp_guardItemCost_(verified)!==plan.cost)) throw new Error('New item readback name/price/cost mismatch; SO not changed');
    enp_legacyAssertHubRow2Unchanged_(hub,plan);
    enp_legacyWriteHubStatus_(hub,'ITEM READY','Verified Item ID '+itemId+'; applying existing legacy SO replacement and CF820 engine.');
    const replacement={key:'HUB_ROW_2',lineId:enp_num_(target.id!=null?target.id:target.Id),
      desiredItemNumber:plan.record['Item Number'],desiredItemName:plan.baseName,
      desiredPrice:plan.price,desiredQty:plan.quantity,newItemId:itemId};
    const result=enp_replaceSalesOrderItems_(plan.soId,[replacement]);
    if(result&&result.blocked) throw new Error(result.blockMessage||result.blockCode||'Legacy replacement blocked');
    if(!result||!Array.isArray(result.replacements)||result.replacements.length!==1) throw new Error('Legacy replacement did not return one verified line');
    enp_legacySaveSourceAction_(source,plan,'REPLACED SO='+plan.soId+' LINE='+result.replacements[0].lineId,'');
    enp_legacyWriteHubStatus_(hub,'COMPLETED','Verified Item ID '+itemId+'; SO '+plan.soId+' line '+result.replacements[0].lineId+
      ' replaced; quantity '+plan.quantity+' and price '+plan.price+' preserved; CF820 verified by legacy engine.');
    const out={status:'COMPLETED',itemId:itemId,itemResolution:resolution.status,salesOrderId:plan.soId,lineId:result.replacements[0].lineId};
    Logger.log(JSON.stringify(out));return out;
  } catch(e) {
    const message=String(e.message||e);
    if(hub)enp_legacyWriteHubStatus_(hub,itemId?'ITEM READY — REPLACEMENT BLOCKED':'EXECUTION BLOCKED',message);
    if(plan) {
      const s=hub;
      if(s)try{enp_legacySaveSourceAction_(s,plan,itemId?'ITEM READY - SO REPLACE BLOCKED':'CREATE FAILED',message);}catch(statusError){Logger.log('Source status capture failed: '+statusError.message);}
    }
    throw e;
  } finally {lock.releaseLock();}
}

function enp_previewHubRow2CreateAndReplace() {
 const h=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 if(!h)throw new Error('Hub ENTERNEWPART missing');
 const p=enp_hubNativePlan_(h.getDataRange().getValues());
 const out={status:'PREVIEW',hubRow:2,itemNumber:p.record['Item Number'],salesOrderId:p.soId,
 quantity:p.quantity,price:p.price,cost:p.cost,strivenCalls:0,strivenWrites:0};
 Logger.log(JSON.stringify(out));return out;
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

function enp_hubPreviewAllRows_() {
 const sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART'),grid=sheet.getDataRange().getValues(),results=[];
 const h=enp_indexByHeader_(grid[0]);
 for(let row=2;row<=grid.length;row++){
  const values=grid[row-1];if(!['Item Number','Original Description','Source','SO Internal ID'].some(function(key){return enp_guardNorm_(values[h[key]]);}))continue;
  if(enp_guardUpper_(values[h['Workflow Status']])==='COMPLETED'){results.push({row:row,status:'COMPLETED'});continue;}
  try{const plan=enp_hubAutomaticPlan_(grid,row);results.push({row:row,status:'ELIGIBLE',itemNumber:plan.record['Item Number']});}
  catch(e){results.push({row:row,status:enp_hubIsHeld_(values[h['Workflow Status']])?'HOLD':'REVIEW',reason:String(e.message||e)});}
 }
 return {rows:results.length,eligible:results.filter(function(r){return r.status==='ELIGIBLE';}).length,
 completed:results.filter(function(r){return r.status==='COMPLETED';}).length,
 unauthorized:0,review:results.filter(function(r){return r.status==='REVIEW';}).length,held:results.filter(function(r){return r.status==='HOLD';}).length,results:results,strivenCalls:0,writes:0};
}

function enp_hubRunEligibleRows_() {
 const props=PropertiesService.getScriptProperties(),started=Date.now(),pause=Number(props.getProperty('HUB_ENP_PAUSE_UNTIL')||0);
 if(props.getProperty('HUB_ENP_AUTOMATION_ENABLED')==='false')return {status:'DISABLED',processed:0};
 if(pause>started)return {status:'COOLDOWN',processed:0};
 const gate=LockService.getScriptLock();if(!gate.tryLock(1000))return {status:'BUSY',processed:0};
 const token=String(started)+'-'+Utilities.getUuid(),lease='HUB_ENP_WORKER_LEASE';
 try{
  const old=props.getProperty(lease);if(old){const state=JSON.parse(old);if(state.until>started)return {status:'BUSY',processed:0};}
  props.setProperty(lease,JSON.stringify({token:token,until:started+5*60*1000}));
 }finally{gate.releaseLock();}
 const results=[];
 try{
  const sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART'),grid=sheet.getDataRange().getValues(),h=enp_indexByHeader_(grid[0]);
  for(let row=2;row<=grid.length&&results.length<2&&Date.now()-started<180000;row++){
   const values=grid[row-1];if(!enp_hubHasData_(values,h)||enp_guardUpper_(values[h['Workflow Status']])==='COMPLETED'||enp_hubIsHeld_(values[h['Workflow Status']]))continue;
   let plan;try{plan=enp_hubAutomaticPlan_(grid,row);}catch(e){
    const reason=String(e.message||e);
    if(values[h['Workflow Status']]!=='NEEDS REVIEW'||values[h['Review Reason']]!==reason){
     sheet.getRange(row,h['Workflow Status']+1).setValue('NEEDS REVIEW');
     sheet.getRange(row,h['Review Reason']+1).setValue(reason);
    }continue;
   }
   const key='HUB_ENP_ROW_STATE_'+row,raw=props.getProperty(key);let state=raw?JSON.parse(raw):{};
   if(state.fingerprint!==plan.fingerprint)state={fingerprint:plan.fingerprint,attempts:0,nextAt:0};
   if(state.attempts>=3||state.nextAt>Date.now())continue;
   state.attempts++;state.nextAt=Date.now()+10*60*1000;props.setProperty(key,JSON.stringify(state));
   try{const result=enp_hubExecuteRow_(row);results.push(result);props.deleteProperty(key);}
   catch(e){state.error=String(e.message||e);props.setProperty(key,JSON.stringify(state));results.push({status:'BLOCKED',row:row,reason:state.error});}
   if(Number(props.getProperty('HUB_ENP_PAUSE_UNTIL')||0)>Date.now())break;
  }
  return {status:'COMPLETE',processed:results.length,results:results};
 }finally{
  const current=props.getProperty(lease);if(current&&JSON.parse(current).token===token)props.deleteProperty(lease);
 }
}

function enp_guardHubBook_() {
  return SpreadsheetApp.openById('13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU');
}

function enp_hubNativePlan_(grid) {
 const headers=grid[0]||[],r={};headers.forEach(function(h,i){r[h]=(grid[1]||[])[i];});
 const source={SalesOrderSalesOrderId:r['SO Internal ID'],ItemItemId:ENP.VALUES.PLACEHOLDER_ITEM_ID,
 ItemNumber:'ENTERNEWPART',ItemDescription:r['Original Description'],Quantity:r.Quantity,Price:r['SO Line Price'],
 NewItemId:'',NewItemNumber:'',NewItemName:'',NewItemPrice:'',NewItemCost:'',LastAction:'',LastError:'',LastUpdated:''};
 const sh=Object.keys(source),p=enp_legacyHubRow2Plan_(grid,[sh,sh.map(function(h){return source[h];})]);
 p.sourceRowNumber=2;return p;
}

function enp_getSalesOrder_(id) {
  return enp_strivenFetch_('/v1/sales-orders/' + id, {
    method: 'get'
  });
}

function enp_guardUpper_(value) {
  return enp_guardNorm_(value).toUpperCase();
}

function enp_legacyExactLookupNow_(number) {
  const key=enp_guardUpper_(number),found={};let result=null;
  for(let page=0;page<3;page++){
    const response=enp_guardRawRequest_('POST','/v1/items/search',{ItemNumber:number,PageIndex:page,PageSize:1000},false);
    if(!response.ok)throw new Error('Exact item lookup HTTP '+response.code+'; no creation attempted');
    const p=enp_legacySearchPage_(response.body);
    p.rows.forEach(function(item){
      if(enp_guardUpper_(enp_guardItemNumber_(item))!==key)return;
      const id=enp_guardItemId_(item);if(!Number.isSafeInteger(id)||id<=0)throw new Error('Exact item result missing ID');
      found[id]=item;
    });
    const ids=Object.keys(found);if(ids.length>1)throw new Error('Multiple exact live item IDs; no creation allowed');
    if(!p.rows.length&&p.count!==null&&page*1000<p.count)throw new Error('Premature empty item-search page');
    if(p.count!==null?(page+1)*1000>=p.count:p.rows.length<1000){
      result=ids.length?enp_legacyLiveItem_(Number(ids[0])):null;
      const sh=enp_guardHubRequests_(),rows=sh.getDataRange().getValues(),matches=[];
      rows.slice(1).forEach(function(r,i){if(enp_guardUpper_(r[0])===key)matches.push(i+2);});
      const record=[number,result?'FOUND':'NOT_FOUND',result?enp_guardItemId_(result):'',result?JSON.stringify(enp_guardNormalizeItemRecord_(result,'')):'',
        new Date().toISOString(),'',matches.length?(Number(rows[matches[matches.length-1]-1][6])||0)+1:1,'','LEGACY_ROW2_EXECUTION',new Date().toISOString()];
      if(matches.length)sh.getRange(matches[matches.length-1],1,1,10).setValues([record]);else sh.appendRow(record);
      return result;
    }
  }
  throw new Error('Exact item lookup exceeded three-page budget; no creation allowed');
}

function enp_guardItemId_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNum_(
    x.Id != null ? x.Id :
    x.id != null ? x.id :
    x.ItemId != null ? x.ItemId :
    x.itemId != null ? x.itemId : x.ItemID
  );
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

function enp_getSalesOrderLineItems_(so) {
  const c =
    so.lineItems ||
    so.LineItems ||
    (so.Data && (so.Data.lineItems || so.Data.LineItems)) ||
    [];
  return Array.isArray(c) ? c : [];
}

function enp_verificationNumber_(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function enp_buildItemPayloadFromSheetRow_(row,col) {
 const n=row[col.NewItemNumber],name=row[col.NewItemName],price=enp_verificationNumber_(row[col.NewItemPrice]),cost=enp_verificationNumber_(row[col.NewItemCost]);
 if(!n||!name||price===null||cost===null)throw new Error('Hub item payload incomplete');
 const p={Id:0,ItemNumber:n,Name:name,Description:enp_guardCanonicalName_(name,n),Price:price,Cost:cost,Active:true,Taxable:true};
 const props=PropertiesService.getScriptProperties();
 [['IncomeGLAccount',ENP.PROPS.DEFAULT_INCOME_GL_ID],['InventoryAssetGLAccount',ENP.PROPS.DEFAULT_INVENTORY_GL_ID],
 ['COGSGLAccount',ENP.PROPS.DEFAULT_COGS_GL_ID]].forEach(function(pair){
 const value=props.getProperty(pair[1]);if(value!=null&&value!==''){
 const id=Number(value);if(!Number.isSafeInteger(id)||id<=0)throw new Error('Invalid configured '+pair[0]);p[pair[0]]={Id:id};}
 });
 return p;
}

function enp_legacyHydrateReferences_(record,base) {
  const fields={ItemType:['itemType','Inventory','ItemType'],DefaultInventoryLocation:['defaultInventoryLocation',record['Location Name'],'LocationName'],Category:['category',record['Item Category'],'ItemCategory'],PreferredVendor:['preferredVendor',record['Preferred Vendor'],'PreferredVendor'],Manufacturer:['manufacturer',record.Manufacturer,'Manufacturer']};
  const props=PropertiesService.getScriptProperties(),raw=props.getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
  const registry=raw?JSON.parse(raw):{},sheet=enp_guardHubBook_().getSheetByName('DATA_ITEMS');
  if(!sheet)throw new Error('DATA_ITEMS cache missing; cannot select live reference witnesses');
  const grid=sheet.getDataRange().getValues(),c=enp_indexByHeader_(grid[0]),ids=[],evidence={};
  Object.keys(fields).forEach(function(field){
    evidence[field]={};const pair=fields[field],col=c[pair[2]];
    if(col==null||c.Id==null||c.ItemNumber==null)throw new Error('HUB_METADATA_BLOCKED: DATA_ITEMS missing '+pair[2]);
    let n=0;const seen={};
    for(const row of grid.slice(1)){
      const id=Number(row[c.Id]);
      if(!enp_guardUpper_(row[c.ItemNumber])||enp_guardUpper_(row[col])!==enp_guardUpper_(pair[1])||!Number.isSafeInteger(id)||id<=0||seen[id])continue;
      seen[id]=true;if(ids.indexOf(id)<0)ids.push(id);if(++n>=6)break;
    }
  });
  for(const id of ids){
    const live=enp_legacyLiveItem_(id);
    Object.keys(fields).forEach(function(field){
      const pair=fields[field],ref=live[pair[0]]||live[field]||{},name=ref.name!=null?ref.name:ref.Name,rid=Number(ref.id!=null?ref.id:ref.Id);
      if(enp_guardUpper_(name)===enp_guardUpper_(pair[1])&&Number.isSafeInteger(rid)&&rid>0)evidence[field][rid]=id;
    });
  }
  Object.keys(fields).forEach(function(field){
    const found=Object.keys(evidence[field]);
    if(found.length!==1)throw new Error('HUB_METADATA_BLOCKED: missing or ambiguous verified '+field+' ID for '+fields[field][1]);
    const rid=Number(found[0]),id=evidence[field][found[0]];
    registry[field]=[{Id:rid,Name:fields[field][1],Verified:true,Evidence:'GET /v1/items/'+id+' on '+new Date().toISOString()}];
  });
  if(base.ItemType&&Number(base.ItemType.Id)!==enp_guardHubReference_(registry,'ItemType','Inventory').Id)throw new Error('Legacy default item type differs from live Inventory type');
  base.ItemType=enp_guardHubReference_(registry,'ItemType','Inventory');
  registry.BaseCurrency='CAD';registry.LegacyUntrackedItemNumbers=['G190-0004-SER'];
  props.setProperty('ENTERNEWPART_HUB_REFERENCE_IDS',JSON.stringify(registry));
}

function enp_legacyAssertHubRow2Unchanged_(sheet,plan) {
  const row=sheet.getRange(2,1,1,Object.keys(plan.hubCol).length).getValues()[0];
  const fields=['Create Authorized','Item Number','Item Name','Price','Cost','Item Category','Description','Preferred Vendor',
    'Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','Currency','Source',
    'Sales Order Number','SO Internal ID','Quantity','Discount'];
  fields.forEach(function(k){if(row[plan.hubCol[k]]!==plan.record[k])throw new Error('Hub row changed during execution: '+k);});
}

function enp_legacyWriteHubStatus_(sheet,status,message) {
  const h=enp_indexByHeader_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0]);
  sheet.getRange(2,h['Workflow Status']+1).setValue(status);
  sheet.getRange(2,h['Review Reason']+1).setValue(message);
}

function enp_soDefaultInventoryLocationId_() {
 const props=PropertiesService.getScriptProperties(),raw=props.getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
 let registry;try{registry=raw?JSON.parse(raw):{};}catch(e){throw new Error('Invalid Hub reference registry JSON');}
 const id=enp_guardHubReference_(registry,'DefaultInventoryLocation','60 - WAREHOUSE (Ajax)').Id;
 const configured=props.getProperty(ENP.PROPS.DEFAULT_LOCATION_ID);
 if(configured!=null&&configured!==''&&(!Number.isSafeInteger(Number(configured))||Number(configured)!==id)){
   throw new Error('Configured inventory location conflicts with the verified Ajax warehouse reference');
 }
 return id;
}

function enp_guardCreateOrResolveItem_(payload) {
  payload = payload || {};
  const itemNumber = enp_guardNorm_(payload.ItemNumber != null ? payload.ItemNumber : payload.itemNumber);

  if (!itemNumber) {
    throw new Error('Item Number is required before automatic item creation.');
  }
  if (enp_guardUpper_(itemNumber) === 'ENTERNEWPART') {
    throw new Error('Item Number cannot be the ENTERNEWPART placeholder.');
  }

  payload=Object.assign({},payload);
  payload.Name=enp_guardCanonicalName_(payload.Name!=null?payload.Name:payload.name,itemNumber);
  if(Object.prototype.hasOwnProperty.call(payload,'name')) delete payload.name;
  const existing = enp_guardResolveExistingItem_(itemNumber);
  if (existing && existing.Id) {
    Logger.log('ENP resolver: EXISTS ItemNumber=' + itemNumber + ' ItemId=' + existing.Id);
    return { status: 'EXISTS', id: existing.Id, item: existing };
  }

  payload = enp_guardBuildHubCreatePayload_(payload);
  const validationKey=enp_guardPayloadKey_(payload),props=PropertiesService.getScriptProperties();
  const parked=props.getProperty(validationKey);
  if(parked) throw new Error('ITEM_NEEDS_REVIEW: unchanged payload is parked — '+parked);
  let createRes;
  try { createRes=enp_guardRawRequest_('POST','/v1/items',payload,false); }
  catch(e) { props.setProperty(validationKey,'Create outcome unknown; verify in Striven before retrying'); throw e; }
  if (createRes.ok) {
    const created = enp_guardNormalizeItemRecord_(createRes.body, itemNumber);
    const createdId = created && created.Id;
    if (!createdId) {
      props.setProperty(validationKey,'Create succeeded without an Item ID; resolve in Hub before retrying');
      throw new Error('Item create succeeded but no Item ID was returned.');
    }

    // Persist identity before any optional readback or shared-sheet write.
    props.setProperty(validationKey,'Created Item ID '+createdId+'; shared result capture pending');
    enp_guardPublishCreatedToHub_(created);
    props.deleteProperty(validationKey);
    const fullCreated = enp_guardGetItemById_(createdId, created) || created;
    Logger.log('ENP resolver: CREATED ItemNumber=' + itemNumber + ' ItemId=' + createdId);
    return { status: 'CREATED', id: createdId, item: fullCreated };
  }

  if (enp_guardIsDuplicateItemError_(createRes.code, createRes.text)) {
    Logger.log('ENP resolver: duplicate create race detected; resolving exact existing Item Number=' + itemNumber);
    const racedExisting = enp_guardSearchExactItemNumber_(itemNumber, true);
    if (racedExisting && racedExisting.Id) {
      return { status: 'EXISTS', id: racedExisting.Id, item: racedExisting };
    }

    throw new Error(
      'Striven confirmed Item Number already exists, but exact Item ID could not be resolved. ' +
      'ItemNumber=' + itemNumber + '. Creation remains blocked.'
    );
  }

  if([400,409,422].indexOf(Number(createRes.code))>=0) props.setProperty(validationKey,String(createRes.text||'Validation failure').slice(0,1500));
  throw new Error(
    'Striven POST /v1/items failed: HTTP ' + createRes.code + ' — ' +
    String(createRes.text || '').slice(0, 2000)
  );
}

function enp_legacySaveSourceResolution_(sheet,plan,resolution) {
 enp_legacyAssertHubRow2Unchanged_(sheet,plan);
 sheet.getRange(2,plan.hubCol['Striven Item ID']+1).setValue(Number(resolution.id));
}

function enp_legacyLiveItem_(id) {
  const response=enp_guardRawRequest_('GET','/v1/items/'+id,null,false);
  if(!response.ok)throw new Error('Live item read HTTP '+response.code);
  const item=enp_guardUnwrapItem_(response.body);
  if(enp_guardItemId_(item)!==Number(id)||!enp_guardItemNumber_(item)||item.Active===false||item.active===false)throw new Error('Live item ID/identity/active check failed');
  return item;
}

function enp_guardItemNumber_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNorm_(
    x.ItemNumber != null ? x.ItemNumber :
    x.itemNumber != null ? x.itemNumber :
    x.Number != null ? x.Number :
    x.number != null ? x.number :
    x.SKU != null ? x.SKU : x.sku
  );
}

function enp_guardItemName_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  return enp_guardNorm_(
    x.Name != null ? x.Name :
    x.name != null ? x.name :
    x.ItemName != null ? x.ItemName : x.itemName
  );
}

function enp_guardItemPrice_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  const v = x.Price != null ? x.Price : x.price;
  return enp_guardNum_(v);
}

function enp_guardItemCost_(item) {
  const x = enp_guardUnwrapItem_(item) || {};
  const v = x.Cost != null ? x.Cost : x.cost;
  return enp_guardNum_(v);
}

function enp_num_(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
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

function enp_legacySaveSourceAction_(sheet,plan,action,error) {
 Logger.log('Hub row 2 '+action+(error?' — '+error:''));
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

function enp_indexByHeader_(headers) {
  const map = {};
  (headers || []).forEach(function (h, i) {
    const key = String(h || '').trim();
    if (!key) return;
    map[key] = i;
  });
  return map;
}

function enp_guardNorm_(value) {
  return String(value == null ? '' : value).trim();
}

function enp_hubAutomaticPlan_(grid,rowNumber) {
 const mapped=enp_hubRowRecord_(grid,rowNumber),r=mapped.record;
 if(enp_hubIsHeld_(r['Workflow Status']))throw new Error('Row is explicitly on HOLD');
 const candidate=grid.slice(),row=grid[rowNumber-1].slice();
 row[mapped.col['Create Authorized']]=true;
 if(enp_guardUpper_(r.Source)==='QUOTED')row[mapped.col['Quoted Authorization']]=true;
 candidate[rowNumber-1]=row;
 const plan=enp_hubPlanRow_(candidate,rowNumber);
 plan.autoValidated=true;plan.fingerprint=enp_hubFingerprint_(r);
 return plan;
}

function enp_hubIsHeld_(status) {
 return ['HOLD','PAUSED','DO NOT CREATE'].indexOf(enp_guardUpper_(status))>=0;
}

function enp_hubHasData_(values,col) {
 return ['Item Number','Original Description','Source','SO Internal ID'].some(function(key){return enp_guardNorm_(values[col[key]]);});
}

function enp_hubExecuteRow_(rowNumber) {
 const sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 let plan=null,itemId=null;
 try {
  plan=enp_hubAutomaticPlan_(sheet.getDataRange().getValues(),rowNumber);ENP_HUB_ACTIVE_PLAN=plan;
  let target=null;
  const existing=enp_legacyExactLookupNow_(plan.record['Item Number']);
  itemId=existing?enp_guardItemId_(existing):null;
  if(plan.soId){
   const so=enp_getSalesOrder_(plan.soId),status=so.status||so.Status||{};
   if(enp_guardUpper_(status.Name!=null?status.Name:status.name)!==plan.source)throw new Error('Live SO status differs from authorized source');
   if(String(so.orderNumber!=null?so.orderNumber:so.OrderNumber)!==String(plan.record['Sales Order Number']))throw new Error('Live SO number mismatch');
   target=enp_findTargetPlaceholderLine_(enp_getSalesOrderLineItems_(so),{desiredItemNumber:plan.record['Item Number'],desiredQty:plan.quantity,newItemId:itemId});
   if(!target)throw new Error('No unique exact live SO line; stopped before creation');
   const qty=enp_verificationNumber_(target.qty!=null?target.qty:target.Qty!=null?target.Qty:target.quantity!=null?target.quantity:target.Quantity);
   const price=enp_verificationNumber_(target.price!=null?target.price:target.Price);
   if(qty!==plan.quantity||price!==plan.linePrice)throw new Error('Live SO quantity or line price changed');
  }
  const base=enp_buildItemPayloadFromSheetRow_([plan.record['Item Number'],plan.baseName,plan.price,plan.cost],{NewItemNumber:0,NewItemName:1,NewItemPrice:2,NewItemCost:3});
  base.Name=plan.record['Item Name'];base.Description=plan.record.Description||base.Name;
  if(!existing){
   enp_hubHydrateCreateReferences_(plan.record,base);
   // Validate all write fields before setting READY or reaching item POST.
   enp_guardBuildHubCreatePayload_(base);
   enp_hubWriteStatus_(sheet,plan,'READY','Authorized automatic exact lookup completed; creating item.');
  }
  if(plan.soId)enp_soDefaultInventoryLocationId_();
  const resolved=enp_guardCreateOrResolveItem_(base);itemId=Number(resolved.id);
  if(!Number.isSafeInteger(itemId)||itemId<=0)throw new Error('Invalid resolved Item ID');
  enp_hubPersistItemId_(sheet,plan,itemId);
  const verified=enp_legacyLiveItem_(itemId);
  if(enp_guardUpper_(enp_guardItemNumber_(verified))!==enp_guardUpper_(plan.record['Item Number']))throw new Error('Live item SKU mismatch');
  if(resolved.status==='CREATED'&&(enp_guardItemName_(verified)!==plan.record['Item Name']||enp_guardItemPrice_(verified)!==plan.price||enp_guardItemCost_(verified)!==plan.cost))throw new Error('Created item readback name/price/cost mismatch');
  if(!plan.soId){
   enp_hubWriteStatus_(sheet,plan,'COMPLETED','Manual catalog item verified; Item ID '+itemId+'. No SO linked.');
   return {status:'COMPLETED',row:rowNumber,itemId:itemId,itemResolution:resolved.status};
  }
  enp_hubWriteStatus_(sheet,plan,'ITEM READY','Verified Item ID '+itemId+'; replacing exact SO line and verifying CF820.');
  const result=enp_replaceSalesOrderItems_(plan.soId,[{key:'HUB_ROW_'+rowNumber,lineId:enp_num_(target.id!=null?target.id:target.Id),
   desiredItemNumber:plan.record['Item Number'],desiredItemName:plan.baseName,desiredPrice:plan.linePrice,desiredQty:plan.quantity,newItemId:itemId}]);
  if(!result||result.blocked||!Array.isArray(result.replacements)||result.replacements.length!==1)throw new Error('SO replacement did not return one verified line');
  enp_hubWriteStatus_(sheet,plan,'COMPLETED','Verified Item ID '+itemId+'; SO '+plan.soId+' line '+result.replacements[0].lineId+
   ' replaced; Qty '+plan.quantity+' and line price '+plan.linePrice+' preserved; CF820 verified.');
  return {status:'COMPLETED',row:rowNumber,itemId:itemId,itemResolution:resolved.status,salesOrderId:plan.soId};
 }catch(e){
  if(plan)try{enp_hubWriteStatus_(sheet,plan,itemId?'ITEM READY — REPLACEMENT BLOCKED':'EXECUTION BLOCKED',String(e.message||e));}catch(statusError){Logger.log(statusError.message);}
  throw e;
 }finally{ENP_HUB_ACTIVE_PLAN=null;}
}

const ENP = Object.freeze({
  SHEETS: Object.freeze({
  APPROVED: 'Enternewpart',
  QUOTED: 'Enternewpart_Quoted',
  HUB: 'ActionHub',
  ITEMS: 'Striven_Items',
  MANUAL: 'Manual ItemCreation',
  LOGBOOK: 'Enternewpart_Logbook'
}),

  PROPS: Object.freeze({
    BASE_URL: 'STRIVEN_BASE_URL',
    CLIENT_ID: 'CLIENT_ID',
    CLIENT_SECRET: 'CLIENT_SECRET',
    TOKEN: 'striven_token',
    TOKEN_EXPIRES: 'striven_token_expires',

    APPROVED_REPORT_URL: 'STRIVEN_ENTERNEWPART_REPORT_API',
    QUOTED_REPORT_URL: 'STRIVEN_ENTERNEWPART_QUOTED_REPORT_API',
    ITEMS_REPORT_URL: 'ItemsReport_API_KEY',

    DEFAULT_ITEMTYPE_ID: 'ENTERNEWPART_DEFAULT_ITEMTYPE_ID',
    DEFAULT_INCOME_GL_ID: 'ENTERNEWPART_DEFAULT_INCOME_GLACCOUNT_ID',
    DEFAULT_INVENTORY_GL_ID: 'ENTERNEWPART_DEFAULT_INVENTORY_GLACCOUNT_ID',
    DEFAULT_COGS_GL_ID: 'ENTERNEWPART_DEFAULT_COGS_GLACCOUNT_ID',
    DEFAULT_LOCATION_ID: 'ENTERNEWPART_DEFAULT_INVENTORY_LOCATION_ID',

    LAST_HEAVY_SYNC_TS: 'ENP_LAST_SYNC_TS'
  }),

  VALUES: Object.freeze({
    PLACEHOLDER_ITEMNUMBER: 'ENTERNEWPART',
    PLACEHOLDER_ITEM_ID: 36935,
    QUOTED_GATE_HEADER: 'SendToActions'
  }),

  EMAIL: Object.freeze({
    INVALID_DESC_ALERT_TEST_MODE: true,
    INVALID_DESC_ALERT_TEST_EMAIL: 'pramodh@classicfireplace.ca'
  }),

  PIPELINE: Object.freeze({
    TRIGGER_FUNCTION: 'enp_pipelineTick',
    TRIGGER_HOURS: 1,
    HEAVY_SYNC_INTERVAL_HOURS: 6,
    LOCK_WAIT_MS: 30000
  }),

  HUB: Object.freeze({
    HEADERS: [
      'SOId',
      'SONumber',
      'LineId',
      'RawDescription',
      'ParsedItemNumber',
      'ParsedItemName',
      'ParsedPrice',
      'Qty',
      'NewItemId',
      'State',
      'JobKey',
      'Attempts',
      'NextRunAt',
      'LastRunAt',
      'LastError',
      'SourceSheet',
      'SourceRow'
    ],
    STATE_PENDING: 'PENDING',
    STATE_RUNNING: 'RUNNING',
    STATE_DONE: 'DONE',
    STATE_FAILED: 'FAILED',
    RUNNER_BATCH_SIZE: 25,
    RUNNER_MAX_ATTEMPTS: 6
  }),

  APPROVED_HEADERS: Object.freeze([
    'SalesOrderSalesOrderId',
    'SalesOrderCreatedOn',
    'ItemItemId',
    'ItemNumber',
    'ItemDescription',
    'Quantity',
    'Price',
    'SalesOrderNumber',
    'SalesOrderStatus',
    'SalesOrderCustomerName',
    'SalesOrderSalesRepFullName'
  ]),

  ACTION_HEADERS: Object.freeze([
    'NewItemId',
    'NewItemNumber',
    'NewItemName',
    'NewItemPrice',
    'NewItemCost',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]),

  QUOTED_ACTION_HEADERS: Object.freeze([
    'SendToActions',
    'NewItemId',
    'NewItemNumber',
    'NewItemName',
    'NewItemPrice',
    'NewItemCost',
    'LastAction',
    'LastError',
    'LastUpdated'
  ]),

  CF820: Object.freeze({
    ID: 820,
    BOTH_VALUE: '556',
    BOTH_TEXT: 'New Items created + SO Updated'
  })
});

function enp_legacyHubRow2Plan_(hubGrid,sourceGrid) {
  const h=hubGrid[0]||[],hc=enp_indexByHeader_(h);
  if(new Set(h).size!==h.length)throw new Error('Duplicate Hub headers');
  const r={};h.forEach(function(k,i){r[k]=(hubGrid[1]||[])[i];});
  if(r['Create Authorized']!==true)throw new Error('Row 2 Create Authorized must be TRUE');
  if(enp_guardUpper_(r.Source)!=='APPROVED'||Number(r['SO Internal ID'])!==27771||
     String(r['Sales Order Number'])!=='586037'||r['Item Number']!=='G190-0004-SER')throw new Error('Row 2 scope/identity changed');
  if(r.Currency!=='CAD'||enp_verificationNumber_(r.Price)!==3||enp_verificationNumber_(r.Cost)!==1.8||
     enp_verificationNumber_(r.Quantity)!==2)throw new Error('Row 2 approved price/cost/currency/quantity changed');
  const canonical=enp_guardCanonicalName_(r['Item Name'],r['Item Number']);
  if(canonical!==r['Item Name'])throw new Error('Hub Item Name is not canonical');
  const sc=enp_indexByHeader_(sourceGrid[0]||[]);
  enp_requireCols_(sc,['SalesOrderSalesOrderId','ItemItemId','ItemNumber','ItemDescription','Quantity','Price','NewItemId','NewItemNumber','NewItemName','NewItemPrice','NewItemCost','LastAction','LastError','LastUpdated']);
  const candidates=sourceGrid.slice(1).map(function(v,i){return {v:v,row:i+2};}).filter(function(x){
    const p=enp_parseDescription_(x.v[sc.ItemDescription]);
    return Number(x.v[sc.SalesOrderSalesOrderId])===27771&&
      enp_guardUpper_(x.v[sc.ItemNumber])==='ENTERNEWPART'&&
      enp_guardUpper_(p.itemNumber)==='G190-0004-SER'&&
      enp_verificationNumber_(x.v[sc.Quantity])===2;
  });
  if(candidates.length!==1)throw new Error('Expected exactly one matching legacy source row; found '+candidates.length);
  const source=candidates[0],parsed=enp_parseDescription_(source.v[sc.ItemDescription]);
  if(!enp_guardIsStandardDescription_(source.v[sc.ItemDescription])||parsed.price!==3||
     enp_verificationNumber_(source.v[sc.Price])!==3)throw new Error('Legacy source price or description changed');
  const base=canonical.slice(0,-(' ('+r['Item Number']+')').length);
  if(enp_guardCanonicalName_(parsed.name,r['Item Number'])!==canonical)throw new Error('Legacy source Item Name differs from Hub');
  return {record:r,hubCol:hc,sourceCol:sc,sourceRow:source.v.slice(),sourceRowNumber:source.row,
    sourceKey:enp_makeRowKeyFromSheetRow_(source.v,sc),soId:27771,quantity:2,price:3,cost:1.8,baseName:base};
}

function enp_strivenFetch_(path,options) {
 options=options||{};const r=enp_guardRawRequest_(options.method||'GET',path,options.body,false);
 if(!r.ok){const e=new Error('Striven HTTP '+r.code+': '+r.text.slice(0,1500));e.statusCode=r.code;throw e;}
 return r.body;
}

function enp_guardRawRequest_(method,path,payload,retried) {
 if(ENP_HUB_ACTIVE_PLAN){
   const delay=Math.max(0,1000-(Date.now()-ENP_HUB_LAST_CALL_MS));if(delay)Utilities.sleep(delay);
   ENP_HUB_LAST_CALL_MS=Date.now();
 }
 const result=enp_hubRawRequestBase_(method,path,payload,retried);
 if(result.code===429)PropertiesService.getScriptProperties().setProperty('HUB_ENP_PAUSE_UNTIL',String(Date.now()+90000));
 return result;
}

function enp_legacySearchPage_(body) {
  if(Array.isArray(body))return {rows:body,count:null};
  if(!body||typeof body!=='object')throw new Error('Invalid item search response');
  const keys=['Data','data','Rows','rows','Results','results','Items','items','Records','records','Value','value'];
  const ck=['TotalCount','totalCount'].filter(function(k){return body[k]!=null;});
  const counts=ck.map(function(k){if(typeof body[k]==='boolean'||String(body[k]).trim()==='')throw new Error('Invalid total count');return Number(body[k]);});
  if(counts.some(function(n){return !Number.isSafeInteger(n)||n<0;})||(counts.length===2&&counts[0]!==counts[1]))throw new Error('Invalid/conflicting total count');
  const count=counts.length?counts[0]:null,arrays=keys.filter(function(k){return Array.isArray(body[k]);});
  if(!arrays.length&&count===0&&keys.filter(function(k){return Object.prototype.hasOwnProperty.call(body,k)&&body[k]===null;}).length===1)return {rows:[],count:0};
  if(arrays.length!==1)throw new Error('Unrecognized/ambiguous item search response');
  if(count!==null&&count<body[arrays[0]].length)throw new Error('Premature search total count');
  return {rows:body[arrays[0]],count:count};
}

function enp_guardHubRequests_() {
  const sh=enp_guardHubBook_().getSheetByName('ITEM_LOOKUP_REQUESTS');
  const expected=['ItemNumber','Status','ItemId','ItemJSON','CheckedAtUTC','NextAttemptUTC','Attempts','Error','RequestedBy','RequestedAtUTC'];
  if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(expected)) throw new Error('Central Hub item lookup queue is not initialized');
  return sh;
}

function enp_guardNormalizeItemRecord_(item, fallbackNumber) {
  const x = enp_guardUnwrapItem_(item) || {};
  const id = enp_guardItemId_(x);
  if (!id) return null;

  return {
    Id: id,
    id: id,
    ItemNumber: enp_guardItemNumber_(x) || enp_guardNorm_(fallbackNumber),
    Name: enp_guardItemName_(x),
    Price: enp_guardItemPrice_(x),
    Cost: enp_guardItemCost_(x),
    Active: x.Active != null ? x.Active : x.active,
    __raw: x
  };
}

function enp_guardUnwrapItem_(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.length ? enp_guardUnwrapItem_(value[0]) : null;

  if (value.Data && !Array.isArray(value.Data)) return enp_guardUnwrapItem_(value.Data);
  if (value.data && !Array.isArray(value.data)) return enp_guardUnwrapItem_(value.data);
  if (value.Item && typeof value.Item === 'object') return enp_guardUnwrapItem_(value.Item);
  if (value.item && typeof value.item === 'object') return enp_guardUnwrapItem_(value.item);

  return value;
}

function enp_guardNum_(value) {
  if (value === '' || value == null) return null;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

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

function enp_guardCanonicalName_(name,number) {
  let base=enp_guardNorm_(name),part=enp_guardNorm_(number);
  if(!enp_descValidName_(base)||!enp_descValidNumber_(part)) throw new Error('Valid Item Name and Item Number are required; labels/placeholders/prose cannot be item identity.');
  const suffix=' ('+part+')';
  while(base.toUpperCase().endsWith(suffix.toUpperCase())) base=base.slice(0,-suffix.length).trim();
  if(!base) throw new Error('Item Name must contain a name before the Item Number');
  return base+suffix;
}

function enp_guardHubReference_(registry, field, name) {
  const wanted = enp_guardUpper_(name);
  if (!wanted) throw new Error('HUB_METADATA_BLOCKED: missing ' + field + ' name.');
  const candidates = (Array.isArray(registry[field]) ? registry[field] : []).filter(function(ref) {
    return ref && enp_guardUpper_(ref.Name) === wanted;
  });
  if (candidates.length !== 1) throw new Error('HUB_METADATA_BLOCKED: missing or ambiguous verified ' + field + ' ID for ' + name);
  const ref = candidates[0];
  if (!Number.isSafeInteger(Number(ref.Id)) || Number(ref.Id) <= 0 || ref.Verified !== true || !enp_guardNorm_(ref.Evidence)) {
    throw new Error('HUB_METADATA_BLOCKED: unverified ' + field + ' ID for ' + name);
  }
  return {Id: Number(ref.Id)};
}

function enp_guardResolveExistingItem_(itemNumber) {
  const wanted=enp_guardNorm_(itemNumber);
  if(!wanted) return null;
  const local=enp_guardFindLocalItemByNumber_(wanted);
  if(local&&local.Id) {
    const response=enp_guardRawRequest_('GET','/v1/items/'+local.Id,null,false);
    if(!response.ok) throw new Error('Current item identity verification HTTP '+response.code);
    const full=enp_guardNormalizeItemRecord_(response.body,'');
    if(full&&full.Id===local.Id&&enp_guardUpper_(full.ItemNumber)===enp_guardUpper_(wanted)) {
      if(full.Active===false) throw new Error('Existing item is inactive; review required: '+wanted);
      return full;
    }
  }
  return enp_guardSearchExactItemNumber_(wanted);
}

function enp_guardBuildHubCreatePayload_(base) {
 if(!ENP_HUB_ACTIVE_PLAN)return enp_hubOriginalBuildHubCreatePayload_(base);
 const plan=ENP_HUB_ACTIVE_PLAN,sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 enp_hubAssertCurrent_(sheet,plan);
 const r=Object.assign({},enp_hubRowRecord_(sheet.getDataRange().getValues(),plan.rowNumber).record,{'Workflow Status':'READY'});
 if(plan.autoValidated){r['Create Authorized']=true;if(plan.source==='QUOTED')r['Quoted Authorization']=true;}
 const raw=PropertiesService.getScriptProperties().getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
 const candidate=enp_guardHubPayloadFromRecord_(base,r,raw?JSON.parse(raw):{});
 if(candidate.unsupportedFields.length)throw new Error('API write path unverified: '+candidate.unsupportedFields.join(', '));
 return candidate.payload;
}

function enp_guardPayloadKey_(payload) {
  return 'ENP_ITEM_VALIDATION_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(payload),Utilities.Charset.UTF_8)).slice(0,40);
}

function enp_guardPublishCreatedToHub_(item) {
  const normalized=enp_guardNormalizeItemRecord_(item,'');
  if(!normalized||!normalized.ItemNumber) throw new Error('Cannot publish created item without identity');
  enp_guardHubRequests_().appendRow([normalized.ItemNumber,'FOUND',normalized.Id,JSON.stringify(normalized),new Date().toISOString(),'',0,'','ENTERNEWPART_CREATE',new Date().toISOString()]);
}

function enp_guardGetItemById_(itemId, fallback) {
  const id = enp_guardNum_(itemId);
  if (!id) return enp_guardNormalizeItemRecord_(fallback, '');

  const res = enp_guardRawRequest_('GET', '/v1/items/' + id, null, false);
  if (res.ok) {
    const normalized = enp_guardNormalizeItemRecord_(res.body, enp_guardItemNumber_(fallback));
    if (normalized) return normalized;
  }

  return enp_guardNormalizeItemRecord_(fallback, '');
}

function enp_guardIsDuplicateItemError_(code, text) {
  if (Number(code) !== 400 && Number(code) !== 409 && Number(code) !== 422) return false;
  const t = String(text || '').toUpperCase();
  // Recover only Item Number uniqueness races. A duplicate Item Name by itself
  // is a different validation failure and must not be mislabeled as an existing number.
  return (
    t.indexOf('ITEM NUMBER') >= 0 &&
    (t.indexOf('ALREADY EXISTS') >= 0 || t.indexOf('MUST BE UNIQUE') >= 0)
  ) || t.indexOf('ITEMNUMBER_MUSTBEUNIQUE') >= 0 ||
       t.indexOf('ITEMNUMBER_MUST_BE_UNIQUE') >= 0;
}

function enp_guardSearchExactItemNumber_(itemNumber, forceFresh) {
  if(!enp_guardNorm_(itemNumber)) return null;
  return enp_guardHubLookup_(itemNumber,!!forceFresh);
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

function enp_itemGroupBridgeRecoveryPrefix_() {
  return 'ENP_ITEM_GROUP_MASTER_BRIDGE_R23_';
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

function enp_hubRowRecord_(grid,rowNumber) {
 if(!Number.isSafeInteger(rowNumber)||rowNumber<2||rowNumber>grid.length)throw new Error('Invalid Hub row');
 const headers=grid[0],seen={},record={},col={};
 headers.forEach(function(h,i){if(!h||seen[h])throw new Error('Missing/duplicate Hub header');seen[h]=true;record[h]=(grid[rowNumber-1]||[])[i];col[h]=i;});
 ['Create Authorized','Item Number','Item Name','Price','Cost','Item Category','Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source','Quoted Authorization','Sales Order Number','SO Internal ID','Quantity','SO Line Price','Original Description','Striven Item ID','Workflow Status','Review Reason'].forEach(function(h){if(col[h]==null)throw new Error('Missing Hub header: '+h);});
 return {record:record,col:col};
}

function enp_hubPlanRow_(grid,rowNumber) {
 const mapped=enp_hubRowRecord_(grid,rowNumber),r=mapped.record,source=enp_guardUpper_(r.Source);
 if(r['Create Authorized']!==true)throw new Error('Create Authorized must be TRUE');
 if(['APPROVED','QUOTED','MANUAL'].indexOf(source)<0)throw new Error('Unsupported Source');
 if(source==='QUOTED'&&r['Quoted Authorization']!==true)throw new Error('Quoted Authorization must be TRUE');
 const sku=enp_guardNorm_(r['Item Number']),name=enp_guardCanonicalName_(r['Item Name'],sku);
 if(name!==r['Item Name'])throw new Error('Item Name must be Item Name (Item Number)');
 const price=enp_verificationNumber_(r.Price),cost=enp_verificationNumber_(r.Cost);
 if(price===null||cost===null||price<0||cost<0)throw new Error('Nonnegative catalog Price and Cost required');
 if(r.Currency!=='CAD')throw new Error('Only verified CAD base currency is supported');
 if(r['Location Name']!=='60 - WAREHOUSE (Ajax)'||r['Item Type']!=='Inventory'||enp_guardUpper_(r.Taxable)!=='YES')throw new Error('Fixed location, taxable or item type differs');
 ['Item Category','Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking'].forEach(function(h){if(!enp_guardNorm_(r[h]))throw new Error('Missing '+h);});
 if(enp_guardUpper_(r['Manufacturer Part#'])!==enp_guardUpper_(sku))throw new Error('Manufacturer Part# must equal Item Number');
 if(enp_guardUpper_(r['Serial Number Tracking'])!=='NO')throw new Error('Serial tracking YES requires a verified API write path; review required');
 if(r['MAP Price']!=null&&r['MAP Price']!=='')throw new Error('MAP Price requires a verified API write path; review required');
 if(r.UPC!=null&&r.UPC!==''&&typeof r.UPC!=='string')throw new Error('UPC must be text');
 const soId=source==='MANUAL'?null:Number(r['SO Internal ID']);
 let qty=null,linePrice=null;
 if(source==='MANUAL') {
   if(r['SO Internal ID']!==''&&r['SO Internal ID']!=null)throw new Error('Manual rows with an SO must be classified Approved/Quoted first');
 } else {
   if(!Number.isSafeInteger(soId)||soId<=0||!enp_guardNorm_(r['Sales Order Number']))throw new Error('Valid Sales Order identity required');
   qty=enp_verificationNumber_(r.Quantity);linePrice=enp_verificationNumber_(r['SO Line Price']);
   if(qty===null||qty<=0||linePrice===null||linePrice<0)throw new Error('SO quantity and line price required');
   if(!enp_lineDescriptionMatchesExactItemNumber_(r['Original Description'],sku))throw new Error('Original SO description does not identify the exact reviewed Item Number');
 }
 // Same SKU on different orders is permitted only with consistent catalog data.
 const identity=['Item Name','Price','Cost','Item Category','Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','UPC','MAP Price','Currency'];
 grid.slice(1).forEach(function(row,i){
   if(i+2===rowNumber||enp_guardUpper_(row[mapped.col['Item Number']])!==enp_guardUpper_(sku))return;
   identity.forEach(function(h){if(String(row[mapped.col[h]]==null?'':row[mapped.col[h]])!==String(r[h]==null?'':r[h]))throw new Error('Conflicting duplicate SKU catalog field: '+h);});
 });
 const fingerprint=enp_hubFingerprint_(r);
 return {rowNumber:rowNumber,record:r,col:mapped.col,source:source,soId:soId,quantity:qty,linePrice:linePrice,
 price:price,cost:cost,baseName:name.slice(0,-(' ('+sku+')').length),fingerprint:fingerprint};
}

function enp_hubFingerprint_(r) {
 const fields=['Create Authorized','Quoted Authorization','Item Number','Item Name','Price','Cost','Item Category','Description','Preferred Vendor',
 'Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source',
 'Sales Order Number','SO Internal ID','SO Status','Quantity','SO Line Price','Original Description','Discount'];
 return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(fields.map(function(h){return r[h]==null?'':r[h];})),Utilities.Charset.UTF_8));
}

let ENP_HUB_ACTIVE_PLAN=null;

function enp_hubHydrateCreateReferences_(record,payload) {
 enp_legacyHydrateReferences_(record,payload);
 const props=PropertiesService.getScriptProperties(),registry=JSON.parse(props.getProperty('ENTERNEWPART_HUB_REFERENCE_IDS')||'{}');
 if(enp_guardUpper_(record['Serial Number Tracking'])==='NO')registry.LegacyUntrackedItemNumbers=[record['Item Number']];
 props.setProperty('ENTERNEWPART_HUB_REFERENCE_IDS',JSON.stringify(registry));
}

function enp_hubWriteStatus_(sheet,plan,status,message) {
 enp_hubAssertCurrent_(sheet,plan);
 sheet.getRange(plan.rowNumber,plan.col['Workflow Status']+1).setValue(status);
 sheet.getRange(plan.rowNumber,plan.col['Review Reason']+1).setValue(message);
}

function enp_hubPersistItemId_(sheet,plan,itemId) {
 enp_hubAssertCurrent_(sheet,plan);
 sheet.getRange(plan.rowNumber,plan.col['Striven Item ID']+1).setValue(itemId);
}

function enp_requireCols_(colMap, requiredHeaders) {
  const missing = requiredHeaders.filter(function (h) {
    return colMap[h] == null;
  });
  if (missing.length) {
    throw new Error('Missing required columns: ' + missing.join(', '));
  }
}

function enp_parseDescription_(text) {
  return enp_descParseFields_(text);
}

function enp_guardIsStandardDescription_(text) {
  const parsed = enp_parseDescription_(text);
  return parsed.format === 'LABELED' && parsed.labels.join(',') === 'number,name,price' &&
    !!parsed.itemNumber && !!parsed.name && parsed.price !== null && parsed.issues.length === 0;
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

let ENP_HUB_LAST_CALL_MS=0;

function enp_hubRawRequestBase_(method, path, payload, hasRetriedAuth) {
  const url = /^https?:\/\//i.test(path)
    ? path
    : enp_guardBaseUrl_() + '/' + String(path || '').replace(/^\/+/, '');

  const options = {
    method: String(method || 'GET').toLowerCase(),
    headers: enp_guardHeaders_(),
    muteHttpExceptions: true
  };

  if (payload !== undefined && payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  Logger.log('ENP resolver ' + method + ' ' + url + ' HTTP ' + code);

  if ((code === 401 || code === 403) && !hasRetriedAuth) {
    enp_guardRefreshAuth_();
    return enp_guardRawRequest_(method, path, payload, true);
  }

  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = text;
    }
  }

  return {
    ok: code >= 200 && code < 300,
    code: code,
    text: text || '',
    body: body,
    url: url
  };
}

function enp_normUpper_(value) {
  return enp_norm_(value).toUpperCase();
}

function enp_descValidName_(value) {
  const s=String(value||'').trim();
  return !!s && !/^(?:item\s*name|item\s*number|price)\s*:/i.test(s) && !/^NEEDSSKU\b/i.test(s);
}

function enp_descValidNumber_(value) {
  const s=String(value||'').trim();
  return !!s && !/[\r\n]|(?:item\s*name|item\s*number|price)\s*:/i.test(s) &&
    s.split(/\s+/).length<5 && !/["<>]/.test(s) && s.toUpperCase()!=='ENTERNEWPART';
}

function enp_guardFindLocalItemByNumber_(itemNumber) {
  const wanted = enp_guardUpper_(itemNumber);
  if (!wanted) return null;

  const ss = enp_guardHubBook_();
  const names = ['DATA_ITEMS'];
  if (typeof ENP !== 'undefined' && ENP.SHEETS && ENP.SHEETS.ITEMS) {
    // Canonical shared dataset only; no per-project report refresh.
  }

  let sh = null;
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    sh = ss.getSheetByName(names[i]);
    if (sh) break;
  }
  if (!sh) return null;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;

  const headers = data[0].map(function(h) { return enp_guardNorm_(h); });
  const col = {};
  headers.forEach(function(h, i) { if (h) col[h] = i; });

  const numberCol = col.ItemNumber != null ? col.ItemNumber :
    col.itemNumber != null ? col.itemNumber :
    col.Number != null ? col.Number : col.SKU;
  const idCol = col.Id != null ? col.Id :
    col.id != null ? col.id :
    col.ItemId != null ? col.ItemId : col.ItemID;

  if (numberCol == null || idCol == null) return null;

  const nameCol = col.Name != null ? col.Name :
    col.ItemName != null ? col.ItemName : col.name;
  const priceCol = col.Price != null ? col.Price : col.price;
  const costCol = col.Cost != null ? col.Cost : col.cost;
  const activeCol = col.Active != null ? col.Active : col.active;

  let found = null;
  for (let r = 1; r < data.length; r++) {
    if (enp_guardUpper_(data[r][numberCol]) !== wanted) continue;
    const id = enp_guardNum_(data[r][idCol]);
    if (!id) continue;

    if (found && found.Id !== id) {
      throw new Error('Ambiguous local Item Number: ' + itemNumber + ' maps to more than one Item ID.');
    }

    found = {
      Id: id,
      id: id,
      ItemNumber: enp_guardNorm_(data[r][numberCol]),
      Name: nameCol != null ? enp_guardNorm_(data[r][nameCol]) : '',
      Price: priceCol != null ? enp_guardNum_(data[r][priceCol]) : null,
      Cost: costCol != null ? enp_guardNum_(data[r][costCol]) : null,
      Active: activeCol != null ? data[r][activeCol] : null
    };
  }

  return found;
}

function enp_hubOriginalBuildHubCreatePayload_(base) {
  const book = enp_guardHubBook_(), sheet = book.getSheetByName('ENTERNEWPART');
  if (!sheet) throw new Error('HUB_METADATA_BLOCKED: ENTERNEWPART tab missing.');
  const records = enp_guardHubRecords_(sheet.getDataRange().getValues());
  const matches = records.filter(function(r) { return enp_guardUpper_(r['Item Number']) === enp_guardUpper_(base.ItemNumber); });
  if (!matches.length) throw new Error('HUB_METADATA_BLOCKED: no exact Hub Item Number match.');
  // Multiple rows can have different order authorization. Do not borrow another
  // order's approval when this item-only interface cannot identify its source.
  if (matches.length !== 1) throw new Error('HUB_METADATA_BLOCKED: multiple Hub rows require source/order disambiguation.');
  const raw = PropertiesService.getScriptProperties().getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
  let registry;
  try { registry = raw ? JSON.parse(raw) : {}; }
  catch (e) { throw new Error('HUB_METADATA_BLOCKED: invalid reference registry JSON.'); }
  const candidate = enp_guardHubPayloadFromRecord_(base,matches[0],registry || {});
  if (candidate.unsupportedFields.length) throw new Error('HUB_METADATA_BLOCKED: API write path unverified for ' + candidate.unsupportedFields.join(', ') + '.');
  return candidate.payload;
}

function enp_hubAssertCurrent_(sheet,plan) {
 const current=enp_hubRowRecord_(sheet.getDataRange().getValues(),plan.rowNumber);
 if(enp_hubFingerprint_(current.record)!==plan.fingerprint)throw new Error('Hub row changed during execution; review before retry');
}

function enp_guardHubPayloadFromRecord_(base, record, registry) {
  const r = record || {};
  if (r['Create Authorized'] !== true) throw new Error('HUB_METADATA_BLOCKED: Create Authorized must be boolean TRUE.');
  if (enp_guardUpper_(r['Workflow Status']) !== 'READY') throw new Error('HUB_METADATA_BLOCKED: Workflow Status must be READY after review.');
  const source = enp_guardUpper_(r.Source);
  if (['APPROVED','QUOTED','MANUAL'].indexOf(source) < 0) throw new Error('HUB_METADATA_BLOCKED: unsupported Source.');
  if (source === 'QUOTED' && r['Quoted Authorization'] !== true) throw new Error('HUB_METADATA_BLOCKED: Quoted Authorization must be boolean TRUE.');
  if (enp_guardUpper_(r['Item Number']) !== enp_guardUpper_(base.ItemNumber)) throw new Error('HUB_METADATA_BLOCKED: Item Number mismatch.');
  const name = enp_guardCanonicalName_(r['Item Name'],r['Item Number']);
  if (enp_guardUpper_(name) !== enp_guardUpper_(enp_guardCanonicalName_(base.Name,base.ItemNumber))) throw new Error('HUB_METADATA_BLOCKED: Item Name mismatch.');
  if (r['Location Name'] !== '60 - WAREHOUSE (Ajax)' || enp_guardUpper_(r.Taxable) !== 'YES' || r['Item Type'] !== 'Inventory') {
    throw new Error('HUB_METADATA_BLOCKED: fixed location, taxable or item type differs.');
  }
  if (!enp_guardNorm_(r.Currency)) throw new Error('HUB_METADATA_BLOCKED: currency is unverified.');
  if (enp_guardUpper_(r.Currency) !== enp_guardUpper_(registry.BaseCurrency)) throw new Error('HUB_METADATA_BLOCKED: currency differs from verified company base currency.');
  const cost = enp_verificationNumber_(r.Cost), price = enp_verificationNumber_(r.Price);
  if (cost === null || cost < 0 || price === null || price < 0) throw new Error('HUB_METADATA_BLOCKED: verified nonnegative Price and Cost are required.');
  const payload = Object.assign({},base,{
    Id:0,ItemNumber:enp_guardNorm_(r['Item Number']),Name:name,
    Description:enp_guardNorm_(r.Description) || name,Price:price,Cost:cost,Taxable:true,
    ItemType:enp_guardHubReference_(registry,'ItemType','Inventory'),
    DefaultInventoryLocation:enp_guardHubReference_(registry,'DefaultInventoryLocation','60 - WAREHOUSE (Ajax)'),
    Category:enp_guardHubReference_(registry,'Category',r['Item Category']),
    PreferredVendor:enp_guardHubReference_(registry,'PreferredVendor',r['Preferred Vendor']),
    Manufacturer:enp_guardHubReference_(registry,'Manufacturer',r.Manufacturer),
    ManufacturePartNumber:enp_guardNorm_(r['Manufacturer Part#'])
  });
  if (!payload.ManufacturePartNumber) throw new Error('HUB_METADATA_BLOCKED: Manufacturer Part# is required.');
  if (r.UPC != null && r.UPC !== '') {
    if (typeof r.UPC !== 'string') throw new Error('HUB_METADATA_BLOCKED: UPC must be text to preserve leading zeros.');
    payload.BarcodeValue = r.UPC.trim();
  }
  // Keep unsupported fields visible beside the candidate payload. The caller
  // must refuse a POST until every required field has a verified write path.
  const legacyNo = enp_guardUpper_(r['Serial Number Tracking']) === 'NO' &&
    Array.isArray(registry.LegacyUntrackedItemNumbers) &&
    registry.LegacyUntrackedItemNumbers.some(function(n) { return enp_guardUpper_(n) === enp_guardUpper_(r['Item Number']); });
  // Explicit row-scoped legacy policy: untracked NO uses the unchanged legacy
  // request, which omits serial controls. No serial API property is invented.
  const unsupported = legacyNo ? [] : ['Serial Number Tracking'];
  if (r['MAP Price'] !== '' && r['MAP Price'] != null) unsupported.push('MAP Price');
  return {payload:payload,unsupportedFields:unsupported,serialTracking:r['Serial Number Tracking'],mapPrice:r['MAP Price']};
}

function enp_guardHubLookup_(number,forceFresh) {
  const sh=enp_guardHubRequests_(),key=enp_guardUpper_(number),now=Date.now();
  const rows=sh.getDataRange().getValues();
  const matches=rows.slice(1).map((r,i)=>({r:r,row:i+2})).filter(x=>enp_guardUpper_(x.r[0])===key);
  if(!forceFresh) {
    const found=matches.filter(x=>x.r[1]==='FOUND'&&Number(x.r[2])>0);
    const ids=Array.from(new Set(found.map(x=>Number(x.r[2]))));
    if(ids.length>1) throw new Error('Ambiguous Central Hub ItemNumber '+number);
    if(found.length) {
      const item=JSON.parse(found[found.length-1].r[3]);
      if(enp_guardItemId_(item)!==ids[0]||enp_guardUpper_(enp_guardItemNumber_(item))!==key) throw new Error('Central Hub item identity mismatch');
      const response=enp_guardRawRequest_('GET','/v1/items/'+ids[0],null,false);
      if(!response.ok) throw new Error('Central Hub item verification HTTP '+response.code);
      const live=enp_guardNormalizeItemRecord_(response.body,'');
      if(!live||live.Id!==ids[0]||enp_guardUpper_(live.ItemNumber)!==key||live.Active===false) throw new Error('Central Hub item failed current identity/active verification');
      return live;
    }
    const newest=matches.length?matches[matches.length-1]:null;
    if(newest&&newest.r[1]==='NOT_FOUND'&&now-Date.parse(newest.r[4])>=0&&now-Date.parse(newest.r[4])<15*60*1000) return null;
    if(newest&&['PENDING','RETRY','REVIEW'].indexOf(String(newest.r[1]))>=0) throw new Error('HUB_ITEM_'+newest.r[1]+': '+number+(newest.r[7]?' — '+newest.r[7]:''));
  }
  const request=[enp_guardNorm_(number),'PENDING','','','','',0,'','ENTERNEWPART',new Date().toISOString()];
  if(matches.length) sh.getRange(matches[matches.length-1].row,1,1,10).setValues([request]);
  else sh.appendRow(request);
  throw new Error('HUB_ITEM_PENDING: '+number+' queued for centralized exact lookup; no catalog scan attempted');
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

function enp_scheduleItemGroupBridgeWatchdog_() {
  const handler = 'hub_recoverItemGroupMasterBridgeWatchdog';
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

function enp_itemGroupBridgeRecoveryKey_(parentItemId) {
  return enp_itemGroupBridgeRecoveryPrefix_() + String(enp_num_(parentItemId) || 0);
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

function enp_zeroItemGroupMembershipIds_(payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  const groups = clone.GroupItems || clone.groupItems || [];
  groups.forEach(function(g) { g.Id = 0; });
  clone.GroupItems = groups;
  delete clone.groupItems;
  return clone;
}

function enp_descParseFields_(text) {
  const raw=String(text==null?'':text),normalized=enp_descNormalizeText_(raw),issues=[];
  const lines=normalized.split('\n').map(s=>s.trim()).filter(Boolean);
  const labels=[],values={number:[],name:[],price:[]};let current=null;
  for(const line of lines){
    const m=line.match(/^(Item[ \t]*Number|Item[ \t]*Name|Price)[ \t]*:[ \t]*(.*)$/i);
    if(m){const key=/number/i.test(m[1])?'number':/name/i.test(m[1])?'name':'price';labels.push(key);current=key;values[key].push(m[2]);}
    else if(current==='name'&&values.name.length===1)values.name[0]+=(values.name[0]?' ':'')+line;
    else if(current)issues.push('UNEXPECTED_CONTINUATION');
  }
  let itemNumber='',name='',price=null,multiItem=false,format=labels.length?'LABELED':'UNLABELED';
  if(labels.length){
    for(const key of Object.keys(values))if(values[key].length>1)issues.push('DUPLICATE_'+key.toUpperCase()+'_LABEL');
    itemNumber=values.number.length===1?values.number[0].trim():'';
    name=values.name.length===1?values.name[0].trim():'';
    price=values.price.length===1?enp_descParseMoney_(values.price[0]):null;
    if(labels.join(',')!=='number,name,price')issues.push('LABEL_STRUCTURE');
    if(values.price[0]&&price===null)issues.push('INVALID_PRICE');
  }else if(normalized){
    multiItem=lines.filter(s=>/^[-•]\s+/.test(s)).length>1;
    if(multiItem){name=lines[0];issues.push('MULTI_ITEM_DESCRIPTION');}
    else{
      const priceLines=lines.filter(s=>/^(?:CAD|USD)?\s*\$/.test(s));
      if(priceLines.length===1)price=enp_descParseMoney_(priceLines[0]);
      const body=lines.filter(s=>!priceLines.includes(s));
      const first=body[0]||'';
      const leading=first.match(/^([A-Za-z0-9][A-Za-z0-9._\/-]*)(?:[ \t]+(.*))?$/);
      if(leading&&/\d/.test(leading[1])){itemNumber=leading[1];name=[leading[2]||'',...body.slice(1)].join(' ').trim();}
      else name=body.join(' ').trim();
      issues.push('NONSTANDARD_FORMAT');
    }
  }
  const sourceItemNumber=itemNumber,sourceItemName=name;
  if(itemNumber&&!enp_descValidNumber_(itemNumber)){issues.push('INVALID_ITEM_NUMBER');itemNumber='';}
  if(name&&!enp_descValidName_(name)){issues.push('INVALID_ITEM_NAME');name='';}
  if(!itemNumber)issues.push('MISSING_ITEM_NUMBER');if(!name)issues.push('MISSING_ITEM_NAME');if(price===null)issues.push('MISSING_PRICE');
  return {raw,normalized,itemNumber,name,price,sourceItemNumber,sourceItemName,multiItem,format,labels,issues:[...new Set(issues)]};
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

function enp_guardBaseUrl_() {
  const props = PropertiesService.getScriptProperties();
  const base = props.getProperty('STRIVEN_BASE_URL') || 'https://api.striven.com';
  return String(base).replace(/\/+$/, '');
}

function enp_guardHeaders_() {
 const p=PropertiesService.getScriptProperties(),cid=p.getProperty('CLIENT_ID')||p.getProperty('STRIVEN_CLIENT_ID'),
 secret=p.getProperty('CLIENT_SECRET')||p.getProperty('STRIVEN_CLIENT_SECRET');
 if(!cid||!secret)throw new Error('Hub Striven credentials missing');
 return {Authorization:'Bearer '+hub_strivenAccessToken_(cid,secret).accessToken,'Content-Type':'application/json',Accept:'application/json'};
}

function enp_guardRefreshAuth_() {
 const p=PropertiesService.getScriptProperties();
 p.deleteProperty('HUB_STRIVEN_ACCESS_TOKEN');p.deleteProperty('HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
}

function enp_norm_(value) {
  return String(value == null ? '' : value).trim();
}

function enp_guardHubRecords_(grid) {
  if (!Array.isArray(grid) || !grid.length) throw new Error('HUB_METADATA_BLOCKED: missing Hub data.');
  const seen = {};
  const headers = grid[0].map(function(value) {
    const h = String(value == null ? '' : value).trim();
    if (h && seen[h]) throw new Error('HUB_METADATA_BLOCKED: duplicate header ' + h);
    if (h) seen[h] = true;
    return h;
  });
  ['Create Authorized','Item Number','Item Name','Price','Cost','Item Category',
   'Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking',
   'Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source',
   'Quoted Authorization','Workflow Status'].forEach(function(h) {
    if (!seen[h]) throw new Error('HUB_METADATA_BLOCKED: missing header ' + h);
  });
  return grid.slice(1).map(function(row) {
      const out = {};
      headers.forEach(function(h,i) { if (h) out[h] = row[i]; });
      return out;
    }).filter(function(r) { return enp_guardNorm_(r['Item Number']) || enp_guardNorm_(r.Source) || enp_guardNorm_(r['Original Description']); });
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

function enp_setLineItemPrice_(li, price) {
  if ('price' in li) li.price = price;
  if ('Price' in li) li.Price = price;
  if ('unitPrice' in li) li.unitPrice = price;
  if ('UnitPrice' in li) li.UnitPrice = price;
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

function enp_mapIdNameForPost_(obj) {
  if (!obj) return null;
  return {
    Id: enp_num_(obj.id != null ? obj.id : obj.Id) || 0,
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

function enp_mapCustomerForPost_(obj) {
  if (!obj) return null;
  return {
    Id: enp_num_(obj.id != null ? obj.id : obj.Id) || 0,
    Number: enp_norm_(obj.number != null ? obj.number : obj.Number),
    Name: enp_norm_(obj.name != null ? obj.name : obj.Name)
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

function enp_guardResolutionAsItemResponse_(resolution) {
  const item = Object.assign({}, (resolution && resolution.item) || {});
  const id = resolution && resolution.id;
  if (id) {
    item.Id = item.Id || id;
    item.id = item.id || id;
  }
  item.__ENP_STATUS = resolution && resolution.status ? resolution.status : '';
  item.__ENP_EXISTING = item.__ENP_STATUS === 'EXISTS';
  return item;
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

function enp_descNormalizeText_(text) {
  return String(text == null ? '' : text).replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/&#x([0-9a-f]+);/gi,(whole,x)=>{const n=parseInt(x,16);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&#(\d+);/g,(whole,x)=>{const n=Number(x);return n<=1114111?String.fromCodePoint(n):whole;})
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'")
    .replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').trim();
}

function enp_descParseMoney_(text) {
  if (text == null || String(text).trim()==='') return null;
  let s=String(text).trim().replace(/[\u00a0\u202f]/g,' ');
  s=s.replace(/^(?:CAD|USD)[ \t]*/i,'').replace(/^\$[ \t]*/,'');
  if (!/^(?:\d+(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?: \d{3})+(?:\.\d{1,2})?)$/.test(s)) return null;
  const n=Number(s.replace(/[, ]/g,''));
  return Number.isFinite(n)&&n>=0&&n<=9999999999998?n:null;
}
return {enp_runHubRow2CreateAndReplace,enp_previewHubRow2CreateAndReplace,enp_recoverItemGroupMasterBridgeWatchdog,enp_hubPreviewAllRows_,enp_hubRunEligibleRows_,enp_guardHubBook_,enp_hubNativePlan_,enp_getSalesOrder_,enp_guardUpper_,enp_legacyExactLookupNow_,enp_guardItemId_,enp_findTargetPlaceholderLine_,enp_getSalesOrderLineItems_,enp_verificationNumber_,enp_buildItemPayloadFromSheetRow_,enp_legacyHydrateReferences_,enp_legacyAssertHubRow2Unchanged_,enp_legacyWriteHubStatus_,enp_soDefaultInventoryLocationId_,enp_guardCreateOrResolveItem_,enp_legacySaveSourceResolution_,enp_legacyLiveItem_,enp_guardItemNumber_,enp_guardItemName_,enp_guardItemPrice_,enp_guardItemCost_,enp_num_,enp_replaceSalesOrderItems_,enp_legacySaveSourceAction_,enp_recoverStaleItemGroupMasterBridges_,enp_indexByHeader_,enp_guardNorm_,enp_hubAutomaticPlan_,enp_hubIsHeld_,enp_hubHasData_,enp_hubExecuteRow_,enp_legacyHubRow2Plan_,enp_strivenFetch_,enp_guardRawRequest_,enp_legacySearchPage_,enp_guardHubRequests_,enp_guardNormalizeItemRecord_,enp_guardUnwrapItem_,enp_guardNum_,enp_normalizeItemNumberForMatch_,enp_lineDescriptionMatchesExactItemNumber_,enp_guardCanonicalName_,enp_guardHubReference_,enp_guardResolveExistingItem_,enp_guardBuildHubCreatePayload_,enp_guardPayloadKey_,enp_guardPublishCreatedToHub_,enp_guardGetItemById_,enp_guardIsDuplicateItemError_,enp_guardSearchExactItemNumber_,enp_replaceSalesOrderItemsLocked_,enp_itemGroupBridgeRecoveryPrefix_,enp_restoreOneItemGroupMasterBridge_,enp_hubRowRecord_,enp_hubPlanRow_,enp_hubFingerprint_,enp_hubHydrateCreateReferences_,enp_hubWriteStatus_,enp_hubPersistItemId_,enp_requireCols_,enp_parseDescription_,enp_guardIsStandardDescription_,enp_makeRowKeyFromSheetRow_,enp_hubRawRequestBase_,enp_normUpper_,enp_descValidName_,enp_descValidNumber_,enp_guardFindLocalItemByNumber_,enp_hubOriginalBuildHubCreatePayload_,enp_hubAssertCurrent_,enp_guardHubPayloadFromRecord_,enp_guardHubLookup_,enp_getStrivenItemById_,enp_applyReplacementToLine_,enp_prepareItemGroupMasterBridgePlans_,enp_buildSalesOrderUpsertPayload_,enp_applyCf820ToReplacementPayload_,enp_scheduleItemGroupBridgeWatchdog_,enp_activateItemGroupMasterBridges_,enp_verifySalesOrderReplacement_,enp_restoreItemGroupMasterBridges_,enp_itemGroupBridgeRecoveryKey_,enp_postAndVerifyItemGroupMaster_,enp_zeroItemGroupMembershipIds_,enp_descParseFields_,enp_makeRowKeyFromObject_,enp_guardBaseUrl_,enp_guardHeaders_,enp_guardRefreshAuth_,enp_norm_,enp_guardHubRecords_,enp_setLineItemObject_,enp_buildCleanLineDescription_,enp_setLineItemPrice_,enp_setLineInventoryLocation_,enp_itemGroupDefinitionSignature_,enp_itemGroupDefinitionForPost_,enp_itemGroupMasterUpdatePayload_,enp_itemGroupChildItemIds_,enp_mapIdNameForPost_,enp_mapUomForPost_,enp_mapCustomerForPost_,enp_mapCustomFieldForPost_,enp_writeItemGroupBridgeJournal_,enp_salesOrderItemGroupTransactionSignature_,enp_customFieldSignature_,enp_guardResolutionAsItemResponse_,enp_extractItemId_,enp_verifyItemGroupMasterPayload_,enp_descNormalizeText_,enp_descParseMoney_,ENP};
}

/* Google Apps Script — Central Hub manual controls and Toronto business-hour schedule. */
function hub_previewEnternewpartAutomation() {
 const result=hub_row2LegacyEngine_().enp_hubPreviewAllRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_processEnternewpartAutomation(event) {
 // A previously installed five-minute callback migrates itself on its next tick.
 if(event&&event.triggerUid)return hub_enternewpartScheduledRun(event);
 const result=hub_row2LegacyEngine_().enp_hubRunEligibleRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_nextEnternewpartRun_(now) {
 const zone='America/Toronto',hours=[8,10,12,14,16,18],day=Utilities.formatDate(now,zone,'yyyy-MM-dd').split('-').map(Number);
 for(let delta=0;delta<3;delta++)for(const hour of hours){
  const guess=Date.UTC(day[0],day[1]-1,day[2]+delta,hour,0,0);
  const offset=Utilities.formatDate(new Date(guess),zone,'Z'),match=/^([+-])(\d{2})(\d{2})$/.exec(offset);
  if(!match)throw new Error('Invalid Toronto timezone offset');
  const minutes=(Number(match[2])*60+Number(match[3]))*(match[1]==='-'?-1:1);
  const candidate=new Date(guess-minutes*60000);
  if(candidate.getTime()>now.getTime())return candidate;
 }
 throw new Error('Could not calculate the next Toronto run');
}
function hub_scheduleNextEnternewpartRun_(now) {
 const lock=LockService.getScriptLock();lock.waitLock(1000);
 try{
  const next=hub_nextEnternewpartRun_(now),old=ScriptApp.getProjectTriggers().filter(function(t){
   return ['hub_processEnternewpartAutomation','hub_enternewpartScheduledRun'].indexOf(t.getHandlerFunction())>=0;
  });
  const created=ScriptApp.newTrigger('hub_enternewpartScheduledRun').timeBased().at(next).create();
  if(!created||!created.getUniqueId())throw new Error('Timer creation returned no trigger ID');
  const id=created.getUniqueId();
  old.forEach(function(t){if(t.getUniqueId()!==id)ScriptApp.deleteTrigger(t);});
  const verified=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='hub_enternewpartScheduledRun';});
  if(verified.length!==1||verified[0].getUniqueId()!==id)throw new Error('Automatic worker timer failed verification');
  PropertiesService.getScriptProperties().setProperty('HUB_ENP_NEXT_RUN_AT',next.toISOString());
  return {nextRunUTC:next.toISOString(),nextRunLocal:Utilities.formatDate(next,'America/Toronto','yyyy-MM-dd HH:mm'),timezone:'America/Toronto',hours:[8,10,12,14,16,18]};
 }finally{lock.releaseLock();}
}
function hub_enternewpartScheduledRun() {
 const props=PropertiesService.getScriptProperties();
 if(props.getProperty('HUB_ENP_AUTOMATION_ENABLED')==='false')return {status:'PAUSED',processed:0};
 const now=new Date(),due=Date.parse(props.getProperty('HUB_ENP_NEXT_RUN_AT')||'');
 // Re-arm before business work so a failed row does not stop future runs.
 const next=hub_scheduleNextEnternewpartRun_(now);
 if(!Number.isFinite(due)||now.getTime()<due-1000||now.getTime()-due>60*60*1000){
  const out={status:'RESCHEDULED',processed:0,next:next};Logger.log(JSON.stringify(out));return out;
 }
 const result=hub_row2LegacyEngine_().enp_hubRunEligibleRows_();Logger.log(JSON.stringify(result));return result;
}
function hub_enableEnternewpartAutomation() {
 const props=PropertiesService.getScriptProperties(),next=hub_scheduleNextEnternewpartRun_(new Date());
 props.setProperty('HUB_ENP_AUTOMATION_ENABLED','true');
 const preview=hub_previewEnternewpartAutomation(),result={status:'INSTALLED',schedule:next,maxRowsPerRun:2,eligible:preview.eligible,completed:preview.completed,review:preview.review||0,held:preview.held||0,mode:'AUTO_VALIDATED'};
 Logger.log(JSON.stringify(result));return result;
}
function hub_pauseEnternewpartAutomation() {
 PropertiesService.getScriptProperties().setProperty('HUB_ENP_AUTOMATION_ENABLED','false');
 const result={status:'PAUSED',strivenCalls:0};Logger.log(JSON.stringify(result));return result;
}
