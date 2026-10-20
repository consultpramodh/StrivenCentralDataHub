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
