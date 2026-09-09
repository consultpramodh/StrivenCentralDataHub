/**
 * STRIVEN CENTRAL DATA HUB
 * 10_Central_Hub
 * R1 — 2026-09-09
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Central Hub')
    .addItem('Initialize / Repair Hub','hub_initializeOrRepair')
    .addSeparator()
    .addItem('Inventory ALL Enabled Projects','hub_inventoryAllProjects')
    .addItem('Inventory Registered Sheet Tabs','hub_inventoryRegisteredSheetTabs')
    .addItem('Rebuild Report Registry','hub_rebuildReportRegistry')
    .addSeparator()
    .addItem('Validate Project Registry','hub_validateProjectRegistry')
    .addItem('Add Project Source','hub_addProjectSource')
    .addToUi();
}

function hub_initializeOrRepair() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HUB_HEADERS).forEach(n => hub_ensureSheet_(ss,n,HUB_HEADERS[n]));
  HUB_DATA_TABS.forEach(n => hub_ensureDataSheet_(ss,n));
  hub_seedProjects_(ss);
  hub_seedDatasets_(ss);
  hub_seedRefresh_(ss);
  hub_seedControl_(ss);
  SpreadsheetApp.flush();

  const missing = Object.keys(HUB_HEADERS).concat(HUB_DATA_TABS)
    .filter(n => !ss.getSheetByName(n));
  const result = {
    ok: !missing.length,
    version: HUB_VERSION,
    marker: HUB_MARKER,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    missing,
    registeredProjects: Math.max(0,ss.getSheetByName(HUB_SHEETS.PROJECTS).getLastRow()-1)
  };
  hub_log_(result.ok?'INFO':'ERROR','INITIALIZE','',
    result.ok?'Hub initialized/repaired.':'Hub structure incomplete.',JSON.stringify(result));
  if (!result.ok) throw new Error('Missing Hub sheet(s): '+missing.join(', '));
  ss.toast('Hub ready. Registered projects: '+result.registeredProjects,'Central Hub',6);
  return result;
}

function hub_validateProjectRegistry() {
  hub_initializeOrRepair();
  const rows = hub_projects_(), scriptIds={}, sheetIds={}, issues=[];
  rows.forEach(r => {
    if (!r.projectName && !r.scriptId && !r.spreadsheetId) return;
    if (!r.projectName) issues.push('Row '+r.row+': Project Name missing.');
    if (!r.spreadsheetId) issues.push('Row '+r.row+': Spreadsheet ID missing.');
    if (!r.scriptId) issues.push('Row '+r.row+': Apps Script Script ID missing.');
    if (r.scriptId) {
      if (scriptIds[r.scriptId]) issues.push('Rows '+scriptIds[r.scriptId]+' and '+r.row+': duplicate Script ID.');
      scriptIds[r.scriptId]=r.row;
    }
    if (r.spreadsheetId) {
      if (sheetIds[r.spreadsheetId]) issues.push('Rows '+sheetIds[r.spreadsheetId]+' and '+r.row+': duplicate Spreadsheet ID.');
      sheetIds[r.spreadsheetId]=r.row;
    }
  });
  if (issues.length) {
    hub_log_('WARN','REGISTRY','','Registry validation failed.',issues.join('\n'));
    throw new Error('PROJECT_REGISTRY validation failed:\n'+issues.join('\n'));
  }
  const result={ok:true,registeredProjects:rows.filter(r=>r.projectName).length};
  hub_log_('INFO','REGISTRY','','Registry validation passed.',JSON.stringify(result));
  return result;
}

function hub_addProjectSource() {
  hub_initializeOrRepair();
  const ui=SpreadsheetApp.getUi();
  const name=hub_prompt_(ui,'Project name:'); if(!name)return;
  const sheetInput=hub_prompt_(ui,'Spreadsheet ID or Google Sheets URL:'); if(!sheetInput)return;
  const scriptId=hub_prompt_(ui,'Apps Script Script ID:'); if(!scriptId)return;
  const spreadsheetId=hub_sheetId_(sheetInput);
  const rows=hub_projects_();
  if(rows.some(r=>r.scriptId===scriptId)) throw new Error('Script ID already registered.');
  if(rows.some(r=>r.spreadsheetId===spreadsheetId)) throw new Error('Spreadsheet ID already registered.');
  SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.PROJECTS).appendRow([
    true,hub_key_(name),name,spreadsheetId,
    'https://docs.google.com/spreadsheets/d/'+spreadsheetId+'/edit',
    scriptId,'REGISTERED','','','','','','','NOT_STARTED','Added through Central Hub'
  ]);
  hub_log_('INFO','REGISTRY',name,'Project source added.',scriptId);
}

function hub_inventoryAllProjects() {
  hub_initializeOrRepair();
  hub_validateProjectRegistry();
  hub_assertAppsScriptApiAccess_();

  const ss=SpreadsheetApp.getActive();
  const audit=ss.getSheetByName(HUB_SHEETS.API_AUDIT);
  const projects=hub_projects_().filter(r=>r.enabled&&r.scriptId);
  const rows=[], scanTime=new Date();

  projects.forEach(p => {
    try {
      const content=hub_getProjectContent_(p.scriptId);
      const files=Array.isArray(content.files)?content.files:[];
      let refs=[];
      files.forEach(f => {
        if(!f||!f.source||String(f.type||'').toUpperCase()==='JSON')return;
        refs=refs.concat(hub_scanSource_(p,f.name||'(unnamed)',f.source,scanTime));
      });
      refs=hub_dedupe_(refs);
      refs.forEach(r=>rows.push(r));
      hub_projectScan_(p.row,'INVENTORIED',scanTime,files.length,refs.length,
        refs.filter(r=>r[6]==='CUSTOM_REPORT').length,
        refs.filter(r=>r[10]==='DIRECT_READ').length,
        refs.filter(r=>r[10]==='WRITE').length,'');
    } catch(e) {
      hub_projectScan_(p.row,'SCAN_FAILED',scanTime,'','','','','',String(e));
      hub_log_('ERROR','SOURCE_SCAN',p.projectName,'Project inventory failed.',String(e&&e.stack||e));
    }
  });

  hub_replace_(audit,rows);
  hub_rebuildReportRegistry();
  const result={ok:true,projectsAttempted:projects.length,apiReferences:rows.length};
  hub_log_('INFO','SOURCE_SCAN','','Inventory complete.',JSON.stringify(result));
  ss.toast('Inventory complete: '+rows.length+' API references.','Central Hub',8);
  return result;
}

function hub_inventoryRegisteredSheetTabs() {
  hub_initializeOrRepair();
  hub_validateProjectRegistry();
  const ss=SpreadsheetApp.getActive(), out=[];
  hub_projects_().filter(r=>r.enabled&&r.spreadsheetId).forEach(p=>{
    try {
      SpreadsheetApp.openById(p.spreadsheetId).getSheets().forEach(sh=>{
        const name=sh.getName(), ds=hub_guessDataset_(name);
        if(!ds && !/striven|inventory|customer|location|task|work\s*order|sales\s*order|transaction|asset|item/i.test(name))return;
        out.push([p.projectName,name,sh.getMaxRows(),sh.getMaxColumns(),
          ds||'UNKNOWN',ds?'CENTRALIZE_CANDIDATE':'REVIEW','Collected by Hub']);
      });
    } catch(e) {
      out.push([p.projectName,'(ERROR)','','','UNKNOWN','BLOCKED',String(e)]);
    }
  });
  hub_replace_(ss.getSheetByName(HUB_SHEETS.LOCAL_DATA),out);
  return {ok:true,candidateTabs:out.length};
}

function hub_rebuildReportRegistry() {
  hub_initializeOrRepair();
  const ss=SpreadsheetApp.getActive(), audit=ss.getSheetByName(HUB_SHEETS.API_AUDIT);
  const target=ss.getSheetByName(HUB_SHEETS.REPORTS), out=[], seen={};
  if(audit.getLastRow()<2){hub_replace_(target,[]);return {ok:true,rows:0};}
  audit.getRange(2,1,audit.getLastRow()-1,HUB_HEADERS.API_DEPENDENCY_AUDIT.length).getValues()
    .forEach(r=>{
      const project=String(r[0]||''), file=String(r[3]||''), fn=String(r[4]||'');
      const type=String(r[6]||''), method=String(r[7]||''), endpoint=String(r[8]||'');
      const ds=String(r[9]||'UNKNOWN'), cls=String(r[10]||'UNKNOWN'), action=String(r[11]||'REVIEW');
      if(!endpoint)return;
      const k=[project,file,fn,type,method,endpoint].join('|'); if(seen[k])return; seen[k]=true;
      out.push([false,hub_key_(project+'_'+fn+'_'+endpoint),ds,project,file,fn,
        type==='CUSTOM_REPORT'?'Discovered Custom Report':type,endpoint,method,cls,'','',
        action,hub_target_(ds),'','','','','DISCOVERED',
        'Generated from API_DEPENDENCY_AUDIT; validate columns/filters before cutover.']);
    });
  hub_replace_(target,out);
  return {ok:true,rows:out.length};
}

function hub_assertAppsScriptApiAccess_() {
  const p=hub_projects_().find(r=>r.enabled&&r.scriptId);
  if(!p) throw new Error('No enabled project with Script ID is registered.');
  let content;
  try { content=hub_getProjectContent_(p.scriptId); }
  catch(e) {
    const s=String(e&&e.message||e);
    if(/403|permission|access|forbidden/i.test(s)) throw new Error(
      'Apps Script API access is not authorized. Enable Google Apps Script API for the Hub Cloud project and enable Apps Script API access in account settings. '+s);
    throw e;
  }
  const files=Array.isArray(content.files)?content.files.length:0;
  if(!files) throw new Error('No source files visible for '+p.projectName+'.');
  const result={ok:true,checkedProject:p.projectName,filesVisible:files};
  hub_log_('INFO','SCRIPT_API',p.projectName,'Apps Script API access verified.',JSON.stringify(result));
  return result;
}

function hub_getProjectContent_(scriptId) {
  const r=UrlFetchApp.fetch(HUB_SCRIPT_API_BASE+encodeURIComponent(scriptId)+'/content',{
    method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true
  });
  const code=r.getResponseCode(), text=r.getContentText();
  if(code<200||code>=300) throw new Error('Apps Script API HTTP '+code+': '+hub_limit_(text,1000));
  const parsed=JSON.parse(text);
  if(!parsed||!Array.isArray(parsed.files)) throw new Error('Apps Script API response missing files array.');
  return parsed;
}

function hub_scanSource_(project,fileName,source,scanTime) {
  const lines=String(source||'').split(/\r?\n/), out=[]; let fn='';
  for(let i=0;i<lines.length;i++){
    const line=lines[i], fm=line.match(/^\s*function\s+([A-Za-z0-9_$]+)\s*\(/); if(fm)fn=fm[1];
    const window=lines.slice(Math.max(0,i-4),Math.min(lines.length,i+5)).join('\n');
    const method=hub_method_(window), cls=hub_class_(method,window), ds=hub_guessDataset_(window+' '+fn);
    const urls=line.match(/https?:\/\/[^\s'"`<>]+/g)||[];
    urls.forEach(url=>{
      if(!/striven/i.test(url))return;
      const type=/custom.?report|report/i.test(url)?'CUSTOM_REPORT':'URL_ENDPOINT';
      out.push(hub_ref_(project,fileName,fn,i+1,type,method,hub_redact_(url),ds,cls,
        cls==='WRITE'?'KEEP_DIRECT':type==='CUSTOM_REPORT'?'CENTRALIZE':'REVIEW',line,scanTime,'FOUND'));
    });
    const rx=/\b(?:customReportId|custom_report_id|reportId|reportID|report_id)\b\s*[:=]\s*['"]?([A-Za-z0-9_-]{2,})/ig;
    let m; while((m=rx.exec(line))!==null)
      out.push(hub_ref_(project,fileName,fn,i+1,'CUSTOM_REPORT',method,m[1],ds,
        cls==='WRITE'?'WRITE':'DIRECT_READ',cls==='WRITE'?'KEEP_DIRECT':'CENTRALIZE',line,scanTime,'FOUND'));
    if(/UrlFetchApp\.(?:fetch|fetchAll)\s*\(/.test(line)&&!urls.length)
      out.push(hub_ref_(project,fileName,fn,i+1,'URLFETCH_CALL',method,'(COMPOSED_OR_VARIABLE_URL)',
        ds,cls,cls==='WRITE'?'KEEP_DIRECT':'REVIEW',window,scanTime,'REVIEW'));
  }
  return out;
}

function hub_ref_(p,file,fn,line,type,method,endpoint,ds,cls,action,snippet,time,status){
  return [p.projectName,p.spreadsheetId,p.scriptId,file,fn||'(top-level/unknown)',line,type,
    method||'UNKNOWN',endpoint,ds||'UNKNOWN',cls,action,hub_redact_(hub_limit_(snippet,1000)),time,status];
}
function hub_method_(s){const m=String(s).match(/\bmethod\s*:\s*['"]?(get|post|put|patch|delete)['"]?/i);return m?m[1].toUpperCase():/UrlFetchApp\.(?:fetch|fetchAll)\s*\(/.test(s)?'GET_OR_DEFAULT':'UNKNOWN';}
function hub_class_(m,s){m=String(m).toUpperCase();return /^(POST|PUT|PATCH|DELETE)$/.test(m)?'WRITE':/api\.striven\.com|custom.?report|UrlFetchApp\./i.test(String(s))?'DIRECT_READ':'UNKNOWN';}
function hub_guessDataset_(v){const s=String(v||'').toLowerCase();if(/customer.?asset/.test(s))return'CUSTOMER_ASSETS';if(/sales.?order.?detail|so.?detail/.test(s))return'SO_DETAILS';if(/work.?order/.test(s))return'WORK_ORDERS';if(/sales.?order/.test(s))return'SALES_ORDERS';if(/customer.?location|\blocation(s)?\b/.test(s))return'LOCATIONS';if(/\bcontact(s)?\b/.test(s))return'CONTACTS';if(/\bcustomer(s)?\b/.test(s))return'CUSTOMERS';if(/\btransaction(s)?\b|\binvoice(s)?\b/.test(s))return'TRANSACTIONS';if(/\binventory\b/.test(s))return'INVENTORY';if(/\bitem(s)?\b|\bsku\b/.test(s))return'ITEMS';if(/\basset(s)?\b/.test(s))return'ASSETS';if(/\btask(s)?\b/.test(s))return'TASKS';return'';}
function hub_dedupe_(rows){const s={};return rows.filter(r=>{const k=[r[0],r[3],r[4],r[5],r[6],r[7],r[8]].join('|');if(s[k])return false;s[k]=1;return true;});}

function hub_ensureSheet_(ss,name,headers){
  let sh=ss.getSheetByName(name); if(!sh)sh=ss.insertSheet(name);
  if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  const live=sh.getRange(1,1,1,headers.length).getDisplayValues()[0], blank=live.every(v=>!String(v).trim());
  if(blank)sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {const i=headers.findIndex((h,x)=>String(live[x]||'').trim()!==h);if(i>=0)throw new Error('Unexpected header in '+name+' column '+(i+1)+'.');}
  sh.setFrozenRows(1); sh.getRange(1,1,1,headers.length).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F4E78').setWrap(true);
}
function hub_ensureDataSheet_(ss,name){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(!String(sh.getRange('A1').getDisplayValue()).trim())sh.getRange('A1:B4').setValues([['Status','SCHEMA_PENDING_SOURCE_AUDIT'],['Last Refreshed',''],['Source Report(s)',''],['Rule','Do not populate until source audit confirms canonical schema.']]);}
function hub_seedProjects_(ss){const sh=ss.getSheetByName(HUB_SHEETS.PROJECTS);if(sh.getLastRow()>1)return;const r=HUB_DEFAULT_PROJECTS.map(p=>[true,p.key,p.name,p.spreadsheetId,p.spreadsheetUrl,p.scriptId,'REGISTERED','','','','','','','NOT_STARTED','Initial source']);sh.getRange(2,1,r.length,r[0].length).setValues(r);}
function hub_seedDatasets_(ss){const sh=ss.getSheetByName(HUB_SHEETS.DATASETS);if(sh.getLastRow()>1)return;sh.getRange(2,1,HUB_DEFAULT_DATASETS.length,HUB_DEFAULT_DATASETS[0].length).setValues(HUB_DEFAULT_DATASETS);}
function hub_seedRefresh_(ss){const sh=ss.getSheetByName(HUB_SHEETS.REFRESH),reg=ss.getSheetByName(HUB_SHEETS.DATASETS);if(sh.getLastRow()>1)return;const r=reg.getRange(2,1,reg.getLastRow()-1,2).getValues().map(x=>[false,x[0],x[1],'PENDING','','','','','','','','','','DISABLED_UNTIL_SOURCE_AUDIT','']);if(r.length)sh.getRange(2,1,r.length,r[0].length).setValues(r);}
function hub_seedControl_(ss){const sh=ss.getSheetByName(HUB_SHEETS.CONTROL);if(sh.getLastRow()>1)return;const r=[['Hub Version',HUB_VERSION],['Marker',HUB_MARKER],['Purpose','Centralize repeated Striven bulk reads.'],['Safety Rule','No project cutover before validation.'],['Phase','Inventory / duplicate detection / migration planning'],['Refresh State','DISABLED_UNTIL_SOURCE_AUDIT'],['Last Initialize',new Date()]];sh.getRange(2,1,r.length,2).setValues(r);}

function hub_projects_(){
  const sh=SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.PROJECTS),v=sh.getDataRange().getValues();
  if(v.length<2)return[];const h=v[0].map(String),i={};h.forEach((x,n)=>i[x.trim()]=n);
  ['Enabled','Project Name','Spreadsheet ID','Apps Script Script ID'].forEach(x=>{if(i[x]==null)throw new Error('PROJECT_REGISTRY missing header: '+x);});
  return v.slice(1).map((r,n)=>({row:n+2,enabled:r[i.Enabled]===true||String(r[i.Enabled]).toUpperCase()==='TRUE',
    projectName:String(r[i['Project Name']]||''),spreadsheetId:String(r[i['Spreadsheet ID']]||''),scriptId:String(r[i['Apps Script Script ID']]||'')}));
}
function hub_projectScan_(row,status,time,files,refs,reports,reads,writes,note){
  const sh=SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.PROJECTS),h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0],m={};h.forEach((x,i)=>m[x]=i+1);
  const u={'Connection Status':status,'Last Inventory Scan':time,'Code Files':files,'API References':refs,'Custom Reports':reports,'Direct Reads':reads,'Writes':writes};
  Object.keys(u).forEach(k=>{if(m[k])sh.getRange(row,m[k]).setValue(u[k]);});if(note&&m.Notes)sh.getRange(row,m.Notes).setValue(note);
}
function hub_replace_(sh,rows){const n=sh.getLastRow();if(n>1)sh.getRange(2,1,n-1,Math.max(sh.getLastColumn(),1)).clearContent();if(rows&&rows.length)sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);}
function hub_prompt_(ui,prompt){const r=ui.prompt('Add Project Source',prompt,ui.ButtonSet.OK_CANCEL);if(r.getSelectedButton()!==ui.Button.OK)return'';return String(r.getResponseText()||'').trim();}
function hub_sheetId_(v){const s=String(v||'').trim(),m=s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);if(m)return m[1];if(/^[A-Za-z0-9_-]{20,}$/.test(s))return s;throw new Error('Invalid Spreadsheet ID/URL.');}
function hub_key_(v){return String(v||'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').substring(0,120);}
function hub_target_(d){const m={CUSTOMERS:'DATA_CUSTOMERS',CONTACTS:'DATA_CONTACTS',LOCATIONS:'DATA_LOCATIONS',ITEMS:'DATA_ITEMS',INVENTORY:'DATA_INVENTORY',ASSETS:'DATA_ASSETS',CUSTOMER_ASSETS:'DATA_CUSTOMER_ASSETS',TASKS:'DATA_TASKS',WORK_ORDERS:'DATA_WORK_ORDERS',SALES_ORDERS:'DATA_SALES_ORDERS',SO_DETAILS:'DATA_SO_DETAILS',TRANSACTIONS:'DATA_TRANSACTIONS'};return m[String(d||'').toUpperCase()]||'';}
function hub_redact_(v){let s=String(v==null?'':v);s=s.replace(/(authorization\s*[:=]\s*['"]?\s*bearer\s+)[A-Za-z0-9._~+\/=-]+/ig,'$1[REDACTED]');s=s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g,'[REDACTED_KEY]');s=s.replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig,'$1[REDACTED]');s=s.replace(/(\b(?:api[_-]?key|apikey|token|secret|password|authorization)\b\s*[:=]\s*['"])[^'"]+(['"])/ig,'$1[REDACTED]$2');return s;}
function hub_limit_(v,n){const s=String(v==null?'':v);return s.length<=n?s:s.substring(0,n)+'...';}
function hub_log_(level,area,subject,message,details){const sh=SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.SYSTEM_LOG);if(sh)sh.appendRow([new Date(),level,area,subject,message,hub_limit_(details,4000)]);}
