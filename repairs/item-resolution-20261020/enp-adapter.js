/* Google Apps Script — Central Hub adapter. No direct item searches. */
function enp_guardHubBook_() {
  return SpreadsheetApp.openById('13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU');
}
function enp_guardHubRequests_() {
  const sh=enp_guardHubBook_().getSheetByName('ITEM_LOOKUP_REQUESTS');
  const expected=['ItemNumber','Status','ItemId','ItemJSON','CheckedAtUTC','NextAttemptUTC','Attempts','Error','RequestedBy','RequestedAtUTC'];
  if(!sh||JSON.stringify(sh.getRange(1,1,1,10).getValues()[0])!==JSON.stringify(expected)) throw new Error('Central Hub item lookup queue is not initialized');
  return sh;
}
function enp_guardCanonicalName_(name,number) {
  let base=enp_guardNorm_(name),part=enp_guardNorm_(number);
  if(!base||!part) throw new Error('Item Name and Item Number are required');
  const suffix=' ('+part+')';
  while(base.toUpperCase().endsWith(suffix.toUpperCase())) base=base.slice(0,-suffix.length).trim();
  if(!base) throw new Error('Item Name must contain a name before the Item Number');
  return base+suffix;
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
function enp_guardPublishCreatedToHub_(item) {
  const normalized=enp_guardNormalizeItemRecord_(item,'');
  if(!normalized||!normalized.ItemNumber) throw new Error('Cannot publish created item without identity');
  enp_guardHubRequests_().appendRow([normalized.ItemNumber,'FOUND',normalized.Id,JSON.stringify(normalized),new Date().toISOString(),'',0,'','ENTERNEWPART_CREATE',new Date().toISOString()]);
}
function enp_guardPayloadKey_(payload) {
  return 'ENP_ITEM_VALIDATION_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(payload),Utilities.Charset.UTF_8)).slice(0,40);
}
