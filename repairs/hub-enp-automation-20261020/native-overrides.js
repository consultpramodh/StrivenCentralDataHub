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

function enp_hubNativePlan_(grid) {
 const headers=grid[0]||[],r={};headers.forEach(function(h,i){r[h]=(grid[1]||[])[i];});
 const source={SalesOrderSalesOrderId:r['SO Internal ID'],ItemItemId:ENP.VALUES.PLACEHOLDER_ITEM_ID,
 ItemNumber:'ENTERNEWPART',ItemDescription:r['Original Description'],Quantity:r.Quantity,Price:r['SO Line Price'],
 NewItemId:'',NewItemNumber:'',NewItemName:'',NewItemPrice:'',NewItemCost:'',LastAction:'',LastError:'',LastUpdated:''};
 const sh=Object.keys(source),p=enp_legacyHubRow2Plan_(grid,[sh,sh.map(function(h){return source[h];})]);
 p.sourceRowNumber=2;return p;
}
function enp_previewHubRow2CreateAndReplace() {
 const h=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 if(!h)throw new Error('Hub ENTERNEWPART missing');
 const p=enp_hubNativePlan_(h.getDataRange().getValues());
 const out={status:'PREVIEW',hubRow:2,itemNumber:p.record['Item Number'],salesOrderId:p.soId,
 quantity:p.quantity,price:p.price,cost:p.cost,strivenCalls:0,strivenWrites:0};
 Logger.log(JSON.stringify(out));return out;
}
function enp_legacySaveSourceResolution_(sheet,plan,resolution) {
 enp_legacyAssertHubRow2Unchanged_(sheet,plan);
 sheet.getRange(2,plan.hubCol['Striven Item ID']+1).setValue(Number(resolution.id));
}
function enp_legacySaveSourceAction_(sheet,plan,action,error) {
 Logger.log('Hub row 2 '+action+(error?' — '+error:''));
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
function enp_strivenFetch_(path,options) {
 options=options||{};const r=enp_guardRawRequest_(options.method||'GET',path,options.body,false);
 if(!r.ok){const e=new Error('Striven HTTP '+r.code+': '+r.text.slice(0,1500));e.statusCode=r.code;throw e;}
 return r.body;
}

/* Google Apps Script — resolve the legacy SO fallback from Hub-verified references. */
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


/* Google Apps Script — authorized multi-row execution in Central Hub. */
let ENP_HUB_ACTIVE_PLAN=null;
let ENP_HUB_LAST_CALL_MS=0;
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
function enp_hubAssertCurrent_(sheet,plan) {
 const current=enp_hubRowRecord_(sheet.getDataRange().getValues(),plan.rowNumber);
 if(enp_hubFingerprint_(current.record)!==plan.fingerprint)throw new Error('Hub row changed during execution; review before retry');
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
function enp_guardBuildHubCreatePayload_(base) {
 if(!ENP_HUB_ACTIVE_PLAN)return enp_hubOriginalBuildHubCreatePayload_(base);
 const plan=ENP_HUB_ACTIVE_PLAN,sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 enp_hubAssertCurrent_(sheet,plan);
 const r=Object.assign({},enp_hubRowRecord_(sheet.getDataRange().getValues(),plan.rowNumber).record,{'Workflow Status':'READY'});
 const raw=PropertiesService.getScriptProperties().getProperty('ENTERNEWPART_HUB_REFERENCE_IDS');
 const candidate=enp_guardHubPayloadFromRecord_(base,r,raw?JSON.parse(raw):{});
 if(candidate.unsupportedFields.length)throw new Error('API write path unverified: '+candidate.unsupportedFields.join(', '));
 return candidate.payload;
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
function enp_hubHydrateCreateReferences_(record,payload) {
 enp_legacyHydrateReferences_(record,payload);
 const props=PropertiesService.getScriptProperties(),registry=JSON.parse(props.getProperty('ENTERNEWPART_HUB_REFERENCE_IDS')||'{}');
 if(enp_guardUpper_(record['Serial Number Tracking'])==='NO')registry.LegacyUntrackedItemNumbers=[record['Item Number']];
 props.setProperty('ENTERNEWPART_HUB_REFERENCE_IDS',JSON.stringify(registry));
}
function enp_hubExecuteRow_(rowNumber) {
 const sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART');
 let plan=null,itemId=null;
 try {
  plan=enp_hubPlanRow_(sheet.getDataRange().getValues(),rowNumber);ENP_HUB_ACTIVE_PLAN=plan;
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
function enp_hubPreviewAllRows_() {
 const sheet=enp_guardHubBook_().getSheetByName('ENTERNEWPART'),grid=sheet.getDataRange().getValues(),results=[];
 const h=enp_indexByHeader_(grid[0]);
 for(let row=2;row<=grid.length;row++){
  const values=grid[row-1];if(!['Item Number','Original Description','Source','SO Internal ID'].some(function(key){return enp_guardNorm_(values[h[key]]);}))continue;
  if(enp_guardUpper_(values[h['Workflow Status']])==='COMPLETED'){results.push({row:row,status:'COMPLETED'});continue;}
  try{const plan=enp_hubPlanRow_(grid,row);results.push({row:row,status:'ELIGIBLE',itemNumber:plan.record['Item Number']});}
  catch(e){results.push({row:row,status:values[h['Create Authorized']]===true?'REVIEW':'UNAUTHORIZED',reason:String(e.message||e)});}
 }
 return {rows:results.length,eligible:results.filter(function(r){return r.status==='ELIGIBLE';}).length,
 completed:results.filter(function(r){return r.status==='COMPLETED';}).length,
 unauthorized:results.filter(function(r){return r.status==='UNAUTHORIZED';}).length,results:results,strivenCalls:0,writes:0};
}
function enp_hubRunEligibleRows_() {
 const props=PropertiesService.getScriptProperties(),started=Date.now(),pause=Number(props.getProperty('HUB_ENP_PAUSE_UNTIL')||0);
 if(props.getProperty('HUB_ENP_AUTOMATION_ENABLED')!=='true')return {status:'DISABLED',processed:0};
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
   const values=grid[row-1];if(values[h['Create Authorized']]!==true||enp_guardUpper_(values[h['Workflow Status']])==='COMPLETED')continue;
   let plan;try{plan=enp_hubPlanRow_(grid,row);}catch(e){
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
