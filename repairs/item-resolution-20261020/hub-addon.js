/* Google Apps Script — shared item lookup queue, R1 2026-10-20.
 * Read-only Striven operations. Operational projects retain creation/SO writes.
 * Official contract: ItemNumber is a LIKE filter, PageSize max 1000.
 */
function hub_itemLookupHeaders_() {
  return ['ItemNumber','Status','ItemId','ItemJSON','CheckedAtUTC','NextAttemptUTC','Attempts','Error','RequestedBy','RequestedAtUTC'];
}
function hub_itemLookupSheet_() {
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName('ITEM_LOOKUP_REQUESTS');
  if(!sh) sh=ss.insertSheet('ITEM_LOOKUP_REQUESTS');
  const h=hub_itemLookupHeaders_();
  if(!sh.getLastRow()) { sh.getRange(1,1,1,h.length).setValues([h]); sh.setFrozenRows(1); }
  if(JSON.stringify(sh.getRange(1,1,1,h.length).getValues()[0])!==JSON.stringify(h)) throw new Error('ITEM_LOOKUP_REQUESTS schema mismatch');
  return sh;
}
function hub_itemLookupExact_(number,token) {
  const wanted=String(number||'').trim().toUpperCase();
  if(!wanted || wanted==='ENTERNEWPART') throw new Error('Invalid lookup ItemNumber');
  const found={};
  for(let p=0;p<3;p++) {
    const response=UrlFetchApp.fetch('https://api.striven.com/v1/items/search',{
      method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      payload:JSON.stringify({ItemNumber:String(number).trim(),PageIndex:p,PageSize:1000}),muteHttpExceptions:true
    });
    const code=response.getResponseCode();
    if(code!==200) {
      const err=new Error('Item lookup HTTP '+code+': '+response.getContentText().slice(0,600));
      err.httpCode=code;
      const headers=response.getAllHeaders();
      const retryKey=Object.keys(headers).find(k=>k.toLowerCase()==='retry-after');
      const delay=retryKey?Number(headers[retryKey]):0;
      err.retrySeconds=Number.isFinite(delay)&&delay>0?delay:60;
      throw err;
    }
    const body=JSON.parse(response.getContentText());
    const rows=Array.isArray(body.Data)?body.Data:Array.isArray(body.data)?body.data:null;
    if(!rows) throw new Error('Item lookup response missing Data array');
    const count=body.TotalCount!=null?Number(body.TotalCount):body.totalCount!=null?Number(body.totalCount):null;
    if(count!=null&&(!Number.isInteger(count)||count<0||count<rows.length)) throw new Error('Invalid item lookup TotalCount');
    rows.forEach(item=>{
      const n=String(item.ItemNumber!=null?item.ItemNumber:item.itemNumber||'').trim().toUpperCase();
      if(n!==wanted) return;
      const id=Number(item.Id!=null?item.Id:item.id);
      if(!Number.isInteger(id)||id<=0) throw new Error('Exact item match missing valid Id');
      found[id]=item;
    });
    const ids=Object.keys(found);
    if(ids.length>1) throw new Error('Multiple Item IDs for exact ItemNumber '+number);
    const last=count!=null?(p+1)*1000>=count:rows.length<1000;
    if(!rows.length && count!=null && p*1000<count) throw new Error('Item lookup returned premature empty page');
    if(last) return ids.length?{status:'FOUND',id:Number(ids[0]),item:found[ids[0]]}:{status:'NOT_FOUND',id:'',item:null};
  }
  throw new Error('Filtered item lookup exceeded three-page budget; creation blocked');
}
function hub_processItemLookups() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000)) return {status:'BUSY',calls:0};
  try {
    const props=PropertiesService.getScriptProperties(),now=Date.now();
    if(Number(props.getProperty('HUB_ITEM_LOOKUP_PAUSE_UNTIL')||0)>now) return {status:'COOLDOWN'};
    const sh=hub_itemLookupSheet_(),data=sh.getDataRange().getValues();
    const pending=data.slice(1).map((r,i)=>({r:r,row:i+2})).filter(x=>
      ['PENDING','RETRY'].indexOf(String(x.r[1]))>=0 && (!x.r[5]||Date.parse(x.r[5])<=now)).slice(0,5);
    if(!pending.length) return {status:'IDLE',processed:0};
    const cid=props.getProperty('CLIENT_ID')||props.getProperty('STRIVEN_CLIENT_ID');
    const secret=props.getProperty('CLIENT_SECRET')||props.getProperty('STRIVEN_CLIENT_SECRET');
    if(!cid||!secret) throw new Error('Missing Hub Striven credentials');
    const token=hub_strivenAccessToken_(cid,secret).accessToken;
    let processed=0;
    const memo={};
    for(const x of pending) {
      const r=x.r.slice(0,10),key=String(r[0]).trim().toUpperCase();
      r[6]=Number(r[6]||0)+1;
      try {
        const result=memo[key]||hub_itemLookupExact_(r[0],token);memo[key]=result;
        r[1]=result.status;r[2]=result.id;r[3]=result.item?JSON.stringify(result.item):'';
        r[4]=new Date().toISOString();r[5]='';r[7]='';
      } catch(e) {
        const retry=e.httpCode===429||e.httpCode===401||e.httpCode>=500;
        r[1]=retry?'RETRY':'REVIEW';r[2]='';r[3]='';r[7]=String(e.message||e).slice(0,1000);
        let delay=Math.max(60,Math.min(3600,Math.pow(2,Math.min(r[6],6))*60));
        if(e.httpCode===429) {
          delay=Math.max(delay,e.retrySeconds||60);
          if(/per-day|daily|5,000|5000/i.test(r[7])) delay=Math.max(delay,(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),new Date().getUTCDate()+1)-now)/1000+60);
          props.setProperty('HUB_ITEM_LOOKUP_PAUSE_UNTIL',String(now+delay*1000));
        }
        if(e.httpCode===401) { props.deleteProperty('HUB_STRIVEN_ACCESS_TOKEN');props.deleteProperty('HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS'); }
        r[5]=retry?new Date(now+delay*1000).toISOString():'';
      }
      // Never overwrite a row whose key was edited during the API request.
      if(String(sh.getRange(x.row,1).getValue()).trim().toUpperCase()!==key) throw new Error('Lookup request changed during processing');
      sh.getRange(x.row,1,1,10).setValues([r]);processed++;
      if(r[1]==='RETRY') break;
    }
    return {status:'COMPLETE',processed:processed,strivenWrites:0};
  } finally {lock.releaseLock();}
}
function hub_installItemLookupAutomation() {
  hub_itemLookupSheet_();
  const existing=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());
  if(existing.indexOf('hub_processItemLookups')<0) ScriptApp.newTrigger('hub_processItemLookups').timeBased().everyMinutes(5).create();
  if(existing.indexOf('hub_refreshStdItems')<0) ScriptApp.newTrigger('hub_refreshStdItems').timeBased().atHour(7).nearMinute(10).everyDays(1).inTimezone('America/Toronto').create();
  return {status:'INSTALLED',lookupMinutes:5,itemsRefresh:'Daily around 07:10 America/Toronto'};
}
