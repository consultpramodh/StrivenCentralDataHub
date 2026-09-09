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

/* =========================
 * STANDARD ITEMS DATASET
 * R1.2 — manual refresh only
 * ========================= */

/**
 * Canonical Items schema.
 *
 * Mandatory rule:
 * every field has a canonical Hub name AND an alias set.
 * Alias matching handles naming differences only; it never merges
 * fields with different business meanings.
 */
function hub_stdItemsSchema_() {
  return [
    {canonical:'ItemNumber', aliases:['ItemNumber','Item Number','Item_Number','ItemNo','Item No']},
    {canonical:'Id', aliases:['Id','ItemId','ItemID','Item Id','Item_Id']},
    {canonical:'ItemName', aliases:['ItemName','Item Name','Item_Name']},
    {canonical:'ItemCategory', aliases:['ItemCategory','Item Category','Item_Category','Category']},
    {canonical:'Cost', aliases:['Cost','ItemCost','Item Cost','Item_Cost']},
    {canonical:'Price', aliases:['Price','ItemPrice','Item Price','Item_Price']},
    {canonical:'MAPPricing', aliases:['MAPPricing','MAP Pricing','MAP_Pricing','MAPPrice','MAP Price','MAP_Price']},
    {canonical:'Taxable', aliases:['Taxable','ItemTaxable','Item Taxable','Item_Taxable']},
    {canonical:'ItemType', aliases:['ItemType','Item Type','Item_Type']},
    {canonical:'PreferredVendor', aliases:['PreferredVendor','Preferred Vendor','Preferred_Vendor','PreferredVendorName','Preferred Vendor Name']},
    {canonical:'Description', aliases:['Description','ItemDescription','Item Description','Item_Description']},
    {canonical:'Manufacturer', aliases:['Manufacturer','ManufacturerName','Manufacturer Name','Manufacturer_Name']},
    {canonical:'LocationName', aliases:['LocationName','Location Name','Location_Name','InventoryLocation','Inventory Location','Inventory_Location']},
    {canonical:'ItemsSKU', aliases:['ItemsSKU','ItemSKU','Items SKU','Item SKU','Items_SKU','Item_SKU','SKU']},
    {canonical:'ItemsUPC', aliases:['ItemsUPC','ItemUPC','Items UPC','Item UPC','Items_UPC','Item_UPC','UPC']}
  ];
}

function hub_stdItemsHeaders_() {
  return hub_stdItemsSchema_().map(function(def) { return def.canonical; });
}

/**
 * Manual production refresh for the canonical Items dataset.
 *
 * Safety:
 * - reads only from Striven
 * - writes only to this Hub's DATA_ITEMS / logs / refresh control
 * - fetches + validates the complete report before replacing DATA_ITEMS
 * - existing DATA_ITEMS remains intact if the remote fetch fails
 * - does not modify any registered source project
 */
function hub_refreshStdItems() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('STD Items refresh is already running.');
  }

  const startedMs = Date.now();
  const runId = 'STD_ITEMS_' + Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || 'America/Toronto',
    'yyyyMMdd_HHmmss'
  );

  let pageCalls = 0;
  let rowsFetched = 0;

  try {
    hub_initializeOrRepair();

    const props = PropertiesService.getScriptProperties();
    const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
    const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
    const reportUrl = String(props.getProperty('STRIVEN_STD_ITEMS_REPORT_URL') || '').trim();

    const missingProps = [];
    if (!clientId) missingProps.push('CLIENT_ID');
    if (!clientSecret) missingProps.push('CLIENT_SECRET');
    if (!reportUrl) missingProps.push('STRIVEN_STD_ITEMS_REPORT_URL');
    if (missingProps.length) {
      throw new Error('Missing Script Properties: ' + missingProps.join(', '));
    }
    if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
      throw new Error('STRIVEN_STD_ITEMS_REPORT_URL must use https://api.striven.com/.');
    }

    const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
    const token = tokenInfo.accessToken;

    const schema = hub_stdItemsSchema_();
    const canonicalHeaders = hub_stdItemsHeaders_();
    const pageSize = 500;
    const maxPages = 500;

    const canonicalRows = [];
    let sourceMap = null;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const payload = hub_stdItemsFetchPage_(reportUrl, token, pageIndex, pageSize);
      pageCalls++;

      const pageRows = hub_stdItemsExtractRows_(payload);

      if (!pageRows.length) {
        break;
      }

      if (!sourceMap) {
        sourceMap = hub_buildCanonicalSourceMap_(pageRows[0], schema, false);
      }

      for (let i = 0; i < pageRows.length; i++) {
        const row = pageRows[i];
        const rowMap = hub_buildCanonicalSourceMap_(row, schema, false);

        // Prevent silent schema drift within later pages/rows.
        canonicalHeaders.forEach(function(canonical) {
          if (rowMap[canonical] !== sourceMap[canonical]) {
            throw new Error(
              'STD Items schema drift detected for canonical field "' + canonical +
              '" on page ' + pageIndex + ', row ' + (i + 1) +
              '. First source field="' + sourceMap[canonical] +
              '", current source field="' + rowMap[canonical] + '".'
            );
          }
        });

        canonicalRows.push(
          canonicalHeaders.map(function(canonical) {
            const sourceField = sourceMap[canonical];
            const value = row[sourceField];
            return value == null ? '' : value;
          })
        );
      }

      rowsFetched += pageRows.length;

      if (pageRows.length < pageSize) {
        break;
      }

      if (pageIndex === maxPages - 1) {
        throw new Error(
          'STD Items refresh reached the safety limit of ' + maxPages +
          ' pages without reaching the end of the report.'
        );
      }
    }

    if (!canonicalRows.length) {
      throw new Error('STD Items report returned zero rows. DATA_ITEMS was not replaced.');
    }

    if (!sourceMap) {
      throw new Error('STD Items source schema could not be resolved.');
    }

    // Replace DATA_ITEMS only AFTER the entire remote report is fetched and validated.
    hub_writeCanonicalDataset_(
      SpreadsheetApp.getActive().getSheetByName('DATA_ITEMS'),
      canonicalHeaders,
      canonicalRows
    );

    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;

    hub_updateRefreshControl_(
      'ITEMS',
      true,
      canonicalRows.length,
      pageCalls + (tokenInfo.requestedNewToken ? 1 : 0),
      durationSec,
      'SUCCESS',
      ''
    );

    hub_apiUsage_(
      runId,
      'ITEMS',
      'STRIVEN_STD_ITEMS_REPORT_URL',
      'GET',
      pageCalls + (tokenInfo.requestedNewToken ? 1 : 0),
      canonicalRows.length,
      durationSec,
      'SUCCESS',
      '',
      'hub_refreshStdItems'
    );

    const sourceToCanonical = {};
    Object.keys(sourceMap).forEach(function(canonical) {
      sourceToCanonical[sourceMap[canonical]] = canonical;
    });

    const result = {
      status: 'PASS',
      dataset: 'ITEMS',
      targetSheet: 'DATA_ITEMS',
      rows: canonicalRows.length,
      reportPageCalls: pageCalls,
      tokenRequestMade: tokenInfo.requestedNewToken,
      totalApiCallsThisRun: pageCalls + (tokenInfo.requestedNewToken ? 1 : 0),
      durationSec: durationSec,
      canonicalFields: canonicalHeaders,
      sourceToCanonical: sourceToCanonical,
      strivenWritesPerformed: false,
      sourceProjectsModified: false
    };

    hub_log_(
      'INFO',
      'STD_ITEMS_REFRESH',
      'ITEMS',
      'Standard Items refresh completed.',
      JSON.stringify(result)
    );

    return result;

  } catch (err) {
    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;
    const safeError = hub_limit_(String(err && err.message || err), 1000);

    try {
      hub_updateRefreshControl_(
        'ITEMS',
        false,
        rowsFetched,
        pageCalls,
        durationSec,
        'FAILED',
        safeError
      );
      hub_apiUsage_(
        runId,
        'ITEMS',
        'STRIVEN_STD_ITEMS_REPORT_URL',
        'GET',
        pageCalls,
        rowsFetched,
        durationSec,
        'FAILED',
        safeError,
        'hub_refreshStdItems'
      );
      hub_log_(
        'ERROR',
        'STD_ITEMS_REFRESH',
        'ITEMS',
        'Standard Items refresh failed; previous DATA_ITEMS retained.',
        safeError
      );
    } catch (loggingErr) {
      // Do not mask the original failure with a secondary logging failure.
    }

    throw err;

  } finally {
    lock.releaseLock();
  }
}

/**
 * Reuse the Striven access token from Script Properties until near expiry.
 * No credential/token value is written to logs.
 */
function hub_strivenAccessToken_(clientId, clientSecret) {
  const props = PropertiesService.getScriptProperties();
  const tokenKey = 'HUB_STRIVEN_ACCESS_TOKEN';
  const expiryKey = 'HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS';

  const cachedToken = String(props.getProperty(tokenKey) || '');
  const expiryMs = Number(props.getProperty(expiryKey) || 0);
  const now = Date.now();

  // Keep a 5-minute safety margin.
  if (cachedToken && expiryMs > now + 5 * 60 * 1000) {
    return {
      accessToken: cachedToken,
      requestedNewToken: false
    };
  }

  const basic = Utilities.base64Encode(clientId + ':' + clientSecret);
  const response = UrlFetchApp.fetch('https://api.striven.com/accesstoken', {
    method: 'post',
    headers: {
      Authorization: 'Basic ' + basic,
      Accept: 'application/json'
    },
    payload: {
      grant_type: 'client_credentials',
      ClientId: clientId
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Striven OAuth failed HTTP ' + code + ': ' +
      hub_safeExternalText_(text, 500)
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Striven OAuth returned non-JSON content.');
  }

  if (!parsed || !parsed.access_token) {
    throw new Error('Striven OAuth response did not contain access_token.');
  }

  const expiresIn = Number(parsed.expires_in);
  if (!isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Striven OAuth response did not contain a valid expires_in value.');
  }

  props.setProperties({
    [tokenKey]: String(parsed.access_token),
    [expiryKey]: String(now + expiresIn * 1000)
  }, false);

  return {
    accessToken: String(parsed.access_token),
    requestedNewToken: true
  };
}

function hub_stdItemsFetchPage_(reportUrl, token, pageIndex, pageSize) {
  const url = hub_reportPagedUrl_(reportUrl, pageIndex, pageSize);

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code === 401) {
    // A stale stored token should be cleared so the next execution obtains a new one.
    PropertiesService.getScriptProperties().deleteProperty('HUB_STRIVEN_ACCESS_TOKEN');
    PropertiesService.getScriptProperties().deleteProperty('HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
  }

  if (code < 200 || code >= 300) {
    throw new Error(
      'STD Items report fetch failed HTTP ' + code + ': ' +
      hub_safeExternalText_(text, 500)
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('STD Items report returned non-JSON content.');
  }
}

function hub_reportPagedUrl_(reportUrl, pageIndex, pageSize) {
  let url = String(reportUrl || '').trim();

  url = url
    .replace(/([?&])pageIndex=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/([?&])pageSize=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/[?&]$/, '');

  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return url +
    separator + 'pageIndex=' + encodeURIComponent(pageIndex) +
    '&pageSize=' + encodeURIComponent(pageSize);
}

function hub_stdItemsExtractRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data,
    payload.Data,
    payload.results,
    payload.Results,
    payload.items,
    payload.Items,
    payload.rows,
    payload.Rows,
    payload.records,
    payload.Records
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }

  const keys = Object.keys(payload);
  for (let i = 0; i < keys.length; i++) {
    const value = payload[keys[i]];
    if (
      Array.isArray(value) &&
      value.length &&
      typeof value[0] === 'object' &&
      !Array.isArray(value[0])
    ) {
      return value;
    }
  }

  return [];
}

/**
 * Returns canonical -> actual source-field map.
 * Throws on missing or ambiguous canonical mappings.
 */
function hub_buildCanonicalSourceMap_(row, schema, allowExtras) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Cannot resolve aliases from a non-object report row.');
  }

  const actualKeys = Object.keys(row);
  const normToRaw = {};

  actualKeys.forEach(function(raw) {
    const normalized = hub_normalizeFieldName_(raw);
    if (!normToRaw[normalized]) normToRaw[normalized] = [];
    normToRaw[normalized].push(raw);
  });

  const map = {};
  const acceptedNorms = {};
  const missing = [];
  const ambiguous = [];

  schema.forEach(function(def) {
    const matches = [];

    def.aliases.forEach(function(alias) {
      const normalized = hub_normalizeFieldName_(alias);
      acceptedNorms[normalized] = true;
      (normToRaw[normalized] || []).forEach(function(raw) {
        if (matches.indexOf(raw) < 0) matches.push(raw);
      });
    });

    if (matches.length === 0) {
      missing.push(def.canonical);
    } else if (matches.length > 1) {
      ambiguous.push(def.canonical + ' <= ' + matches.join('|'));
    } else {
      map[def.canonical] = matches[0];
    }
  });

  const unexpected = actualKeys.filter(function(raw) {
    return !acceptedNorms[hub_normalizeFieldName_(raw)];
  });

  if (
    missing.length ||
    ambiguous.length ||
    (!allowExtras && unexpected.length) ||
    Object.keys(map).length !== schema.length
  ) {
    throw new Error(
      'Canonical schema validation failed. ' +
      'Missing=' + missing.join('|') +
      '; Ambiguous=' + ambiguous.join('|') +
      '; Unexpected=' + unexpected.join('|')
    );
  }

  return map;
}

function hub_normalizeFieldName_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function hub_writeCanonicalDataset_(sheet, headers, rows) {
  if (!sheet) {
    throw new Error('Target canonical dataset sheet is missing.');
  }
  if (!headers || !headers.length) {
    throw new Error('Canonical dataset headers are empty.');
  }

  const neededRows = rows.length + 1;
  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }

  const clearRows = Math.max(sheet.getLastRow(), neededRows);
  sheet.getRange(1, 1, clearRows, headers.length).clearContent();

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1F4E78')
    .setWrap(true);

  const chunkSize = 5000;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    sheet.getRange(offset + 2, 1, chunk.length, headers.length).setValues(chunk);
  }
}

function hub_updateRefreshControl_(
  datasetKey,
  success,
  rows,
  apiCalls,
  durationSec,
  status,
  error
) {
  const sh = SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.REFRESH);
  if (!sh || sh.getLastRow() < 2) return;

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach(function(h, i) { idx[String(h)] = i; });

  const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const rowIndex = data.findIndex(function(r) {
    return String(r[idx['Dataset Key']] || '').toUpperCase() === String(datasetKey).toUpperCase();
  });
  if (rowIndex < 0) return;

  const targetRow = rowIndex + 2;
  const now = new Date();

  const updates = {
    'Last Attempt': now,
    'Rows': rows,
    'API Calls': apiCalls,
    'Duration Sec': durationSec,
    'Status': status,
    'Error': error || ''
  };
  if (success) updates['Last Success'] = now;

  Object.keys(updates).forEach(function(header) {
    if (idx[header] != null) {
      sh.getRange(targetRow, idx[header] + 1).setValue(updates[header]);
    }
  });
}

function hub_apiUsage_(
  runId,
  datasetKey,
  reportLabel,
  method,
  calls,
  rows,
  durationSec,
  result,
  error,
  caller
) {
  const sh = SpreadsheetApp.getActive().getSheetByName(HUB_SHEETS.API_USAGE);
  if (!sh) return;

  sh.appendRow([
    new Date(),
    runId,
    datasetKey,
    reportLabel,
    method,
    calls,
    rows,
    durationSec,
    result,
    error || '',
    caller
  ]);
}

function hub_safeExternalText_(value, maxLen) {
  let s = String(value == null ? '' : value);

  s = s.replace(
    /(authorization\s*[:=]\s*['"]?\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+\/=-]+/ig,
    '$1[REDACTED]'
  );
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');
  s = s.replace(
    /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig,
    '$1[REDACTED]'
  );

  return s.length <= maxLen ? s : s.substring(0, maxLen) + '...';
}

/* === HUB_STD_CONTACTS_R1_4_BEGIN ===
 * STD - Customer Contacts - Central Hub
 * Production full refresh.
 *
 * SAFETY:
 * - READS Striven custom report only.
 * - WRITES only this Hub's DATA_CONTACTS sheet.
 * - Does not modify registered source projects.
 * - Does not POST/PATCH/PUT/DELETE to Striven.
 *
 * BUSINESS RULES:
 * - Report is filtered in Striven to Active customers only.
 * - Customer ID = Customer Number in this tenant.
 * - CustomerPrimaryEmail is derived from ContactPrimaryEmail where needed.
 * - ContactDateCreated and ContactStatus are intentionally not required.
 */

function hub_refreshStdContacts() {
  const startedMs = Date.now();
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    throw new Error('STD Contacts refresh is already running.');
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
    const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
    const reportUrl = String(props.getProperty('STRIVEN_STD_CONTACTS_REPORT_URL') || '').trim();

    const missingProperties = [];
    if (!clientId) missingProperties.push('CLIENT_ID');
    if (!clientSecret) missingProperties.push('CLIENT_SECRET');
    if (!reportUrl) missingProperties.push('STRIVEN_STD_CONTACTS_REPORT_URL');

    if (missingProperties.length) {
      throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
    }

    if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
      throw new Error('STRIVEN_STD_CONTACTS_REPORT_URL must use https://api.striven.com/.');
    }

    const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
    const fetched = hub_fetchStdContactsAllPages_(reportUrl, tokenInfo.accessToken, 500);

    if (!fetched.rows.length) {
      throw new Error('STD Contacts report returned zero rows. DATA_CONTACTS was not replaced.');
    }

    const schema = hub_stdContactsSchema_();
    const audit = hub_auditStdContactsSchema_(fetched.actualFields, schema);

    if (
      audit.missingCanonicalFields.length ||
      audit.ambiguousCanonicalFields.length ||
      audit.unexpectedSourceFields.length ||
      fetched.actualFields.length !== schema.length
    ) {
      throw new Error(
        'STD Contacts schema validation failed. ' +
        JSON.stringify({
          expectedCanonicalFieldCount: schema.length,
          actualFieldCount: fetched.actualFields.length,
          actualFields: fetched.actualFields,
          missingCanonicalFields: audit.missingCanonicalFields,
          ambiguousCanonicalFields: audit.ambiguousCanonicalFields,
          unexpectedSourceFields: audit.unexpectedSourceFields
        })
      );
    }

    const seenKeys = {};
    let duplicateCustomerContactKeys = 0;
    let missingCustomerIds = 0;
    let missingContactIds = 0;

    const records = fetched.rows.map(function(source) {
      const record = hub_buildStdContactRecord_(source, audit.canonicalToSource);

      if (!record.CustomerId) missingCustomerIds++;
      if (!record.ContactId) missingContactIds++;

      if (record.CustomerContactKey) {
        if (seenKeys[record.CustomerContactKey]) duplicateCustomerContactKeys++;
        else seenKeys[record.CustomerContactKey] = true;
      }

      return record;
    });

    if (missingCustomerIds || missingContactIds) {
      throw new Error(
        'STD Contacts contains required-ID gaps. ' +
        JSON.stringify({
          missingCustomerIds: missingCustomerIds,
          missingContactIds: missingContactIds
        })
      );
    }

    if (duplicateCustomerContactKeys) {
      throw new Error(
        'STD Contacts contains duplicate Customer+Contact relationships. Count=' +
        duplicateCustomerContactKeys
      );
    }

    const headers = hub_stdContactsHeaders_();
    const values = records.map(function(record) {
      return headers.map(function(header) {
        return record[header] == null ? '' : record[header];
      });
    });

    const sh = SpreadsheetApp.getActive().getSheetByName('DATA_CONTACTS');
    if (!sh) throw new Error('DATA_CONTACTS sheet is missing.');

    hub_replaceStdContactsSheet_(sh, headers, values);

    const result = {
      status: 'PASS',
      dataset: 'CONTACTS',
      targetSheet: 'DATA_CONTACTS',
      rows: records.length,
      sourceCanonicalFieldCount: schema.length,
      outputColumnCount: headers.length,
      reportPageCalls: fetched.pageCalls,
      pageSize: fetched.pageSize,
      tokenRequestMade: tokenInfo.requestedNewToken,
      totalApiCallsThisRun: fetched.pageCalls + (tokenInfo.requestedNewToken ? 1 : 0),
      sourceToCanonical: audit.sourceToCanonical,
      canonicalToSource: audit.canonicalToSource,
      duplicateCustomerContactKeys: duplicateCustomerContactKeys,
      missingCustomerIds: missingCustomerIds,
      missingContactIds: missingContactIds,
      derivedFields: [
        'CustomerNumber',
        'CustomerStatus',
        'CustomerPrimaryEmail',
        'NormalizedCustomerPhone',
        'NormalizedCustomerEmail',
        'CustomerCity',
        'NormalizedCustomerAddress',
        'NormalizedContactEmail',
        'NormalizedContactPhone',
        'ContactPhoneExtension',
        'ContactCity',
        'NormalizedContactAddress',
        'EntityType',
        'EntityId',
        'CustomerContactKey'
      ],
      filterExpectation: 'Customer Status = Active in the Striven report definition.',
      strivenWritesPerformed: false,
      sourceProjectsModified: false,
      elapsedMs: Date.now() - startedMs
    };

    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function hub_stdContactsSchema_() {
  return [
    {
      canonical: 'CustomerDateCreated',
      aliases: [
        'CustomerDateCreated', 'Customer Date Created',
        'CustomerCreatedOn', 'Customer Created On',
        'CustomerCreatedAt', 'Customer Created At'
      ]
    },
    {
      canonical: 'CustomerId',
      aliases: [
        'CustomerId', 'CustomerID', 'Customer Id', 'Customer ID',
        'CustomerCustomerId', 'CustomerCustomerID',
        'CustomerNumber', 'Customer Number'
      ]
    },
    {
      canonical: 'CustomerName',
      aliases: [
        'CustomerName', 'Customer Name',
        'CustomerFullName', 'Customer Full Name',
        'CustomerCustomerName'
      ]
    },
    {
      canonical: 'CustomerPrimaryPhone',
      aliases: [
        'CustomerPrimaryPhone', 'Customer Primary Phone',
        'CustomerPhone', 'Customer Phone'
      ]
    },
    {
      canonical: 'CustomerFullAddress',
      aliases: [
        'CustomerFullAddress', 'Customer Full Address',
        'CustomerAddressFullAddress', 'Customer Address Full Address',
        'CustomerAddress'
      ]
    },
    {
      canonical: 'ContactId',
      aliases: [
        'ContactId', 'ContactID', 'Contact Id', 'Contact ID'
      ]
    },
    {
      canonical: 'FirstName',
      aliases: [
        'FirstName', 'First Name',
        'ContactFirstName', 'Contact First Name'
      ]
    },
    {
      canonical: 'LastName',
      aliases: [
        'LastName', 'Last Name',
        'ContactLastName', 'Contact Last Name'
      ]
    },
    {
      canonical: 'ContactFullName',
      aliases: [
        'ContactFullName', 'Contact Full Name',
        'FullName', 'Full Name',
        'ContactName', 'Contact Name'
      ]
    },
    {
      canonical: 'ContactPrimaryEmail',
      aliases: [
        'ContactPrimaryEmail', 'Contact Primary Email',
        'PrimaryEmail', 'Primary Email',
        'ContactEmail', 'Contact Email'
      ]
    },
    {
      canonical: 'ContactPrimaryPhone',
      aliases: [
        'ContactPrimaryPhone', 'Contact Primary Phone',
        'PrimaryPhone', 'Primary Phone',
        'ContactPhone', 'Contact Phone'
      ]
    },
    {
      canonical: 'ContactFullAddress',
      aliases: [
        'ContactFullAddress', 'Contact Full Address',
        'ContactAddressFullAddress', 'Contact Address Full Address',
        'AddressFullAddress', 'Address Full Address'
      ]
    }
  ];
}

function hub_stdContactsHeaders_() {
  return [
    'CustomerDateCreated',
    'CustomerId',
    'CustomerNumber',
    'CustomerName',
    'CustomerStatus',
    'CustomerPrimaryPhone',
    'NormalizedCustomerPhone',
    'CustomerPrimaryEmail',
    'NormalizedCustomerEmail',
    'CustomerFullAddress',
    'CustomerCity',
    'NormalizedCustomerAddress',
    'ContactId',
    'FirstName',
    'LastName',
    'ContactFullName',
    'ContactPrimaryEmail',
    'NormalizedContactEmail',
    'ContactPrimaryPhone',
    'NormalizedContactPhone',
    'ContactPhoneExtension',
    'ContactFullAddress',
    'ContactCity',
    'NormalizedContactAddress',
    'EntityType',
    'EntityId',
    'CustomerContactKey'
  ];
}

function hub_fetchStdContactsAllPages_(reportUrl, accessToken, pageSize) {
  const rows = [];
  const fieldSet = {};
  const maxPages = 500;
  let pageCalls = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const pageUrl = hub_stdContactsPagedUrl_(reportUrl, pageIndex, pageSize);

    const response = UrlFetchApp.fetch(pageUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    });

    pageCalls++;

    const code = response.getResponseCode();
    const text = response.getContentText();

    if (code < 200 || code >= 300) {
      throw new Error(
        'STD Contacts report page ' + pageIndex + ' failed HTTP ' + code + ': ' +
        hub_stdContactsSafeText_(text, 500)
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error('STD Contacts page ' + pageIndex + ' returned non-JSON content.');
    }

    const pageRows = hub_stdContactsExtractRows_(payload);

    pageRows.forEach(function(row) {
      Object.keys(row || {}).forEach(function(key) {
        fieldSet[key] = true;
      });
      rows.push(row);
    });

    if (pageRows.length < pageSize) {
      return {
        rows: rows,
        actualFields: Object.keys(fieldSet),
        pageCalls: pageCalls,
        pageSize: pageSize,
        stopReason: 'SHORT_PAGE'
      };
    }
  }

  throw new Error(
    'STD Contacts reached maxPages=' + maxPages +
    ' without a short final page. Refusing to replace DATA_CONTACTS.'
  );
}

function hub_stdContactsPagedUrl_(reportUrl, pageIndex, pageSize) {
  let url = String(reportUrl || '').trim();

  url = url
    .replace(/([?&])pageIndex=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/([?&])pageSize=\d+(&?)/ig, function(_, lead, tail) {
      return tail ? lead : '';
    })
    .replace(/[?&]$/, '');

  const separator = url.indexOf('?') >= 0 ? '&' : '?';

  return url +
    separator + 'pageIndex=' + encodeURIComponent(pageIndex) +
    '&pageSize=' + encodeURIComponent(pageSize);
}

function hub_stdContactsExtractRows_(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data, payload.Data,
    payload.results, payload.Results,
    payload.items, payload.Items,
    payload.rows, payload.Rows,
    payload.records, payload.Records
  ];

  for (let i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }

  const keys = Object.keys(payload);

  for (let i = 0; i < keys.length; i++) {
    const value = payload[keys[i]];

    if (
      Array.isArray(value) &&
      value.length &&
      typeof value[0] === 'object' &&
      !Array.isArray(value[0])
    ) {
      return value;
    }
  }

  return [];
}

function hub_auditStdContactsSchema_(actualFields, schema) {
  const normToRaw = {};

  actualFields.forEach(function(raw) {
    const norm = hub_stdContactsNormalizeFieldName_(raw);
    if (!normToRaw[norm]) normToRaw[norm] = [];
    normToRaw[norm].push(raw);
  });

  const canonicalToSource = {};
  const sourceToCanonical = {};
  const missing = [];
  const ambiguous = [];
  const acceptedNorms = {};

  schema.forEach(function(def) {
    const canonicalNorm = hub_stdContactsNormalizeFieldName_(def.canonical);
    const aliases = (def.aliases || []).slice();

    // Mandatory alias standard: canonical name must itself be an accepted alias.
    if (!aliases.some(function(alias) {
      return hub_stdContactsNormalizeFieldName_(alias) === canonicalNorm;
    })) {
      throw new Error(
        'STD Contacts alias contract invalid: canonical missing from alias set for ' +
        def.canonical
      );
    }

    const matches = [];

    aliases.forEach(function(alias) {
      const norm = hub_stdContactsNormalizeFieldName_(alias);
      acceptedNorms[norm] = true;

      (normToRaw[norm] || []).forEach(function(raw) {
        if (matches.indexOf(raw) < 0) matches.push(raw);
      });
    });

    if (matches.length === 0) {
      missing.push(def.canonical);
      return;
    }

    if (matches.length > 1) {
      ambiguous.push({
        canonical: def.canonical,
        sourceFields: matches
      });
      return;
    }

    canonicalToSource[def.canonical] = matches[0];
    sourceToCanonical[matches[0]] = def.canonical;
  });

  const unexpected = actualFields.filter(function(raw) {
    return !acceptedNorms[hub_stdContactsNormalizeFieldName_(raw)];
  });

  return {
    canonicalToSource: canonicalToSource,
    sourceToCanonical: sourceToCanonical,
    missingCanonicalFields: missing,
    ambiguousCanonicalFields: ambiguous,
    unexpectedSourceFields: unexpected
  };
}

function hub_buildStdContactRecord_(source, canonicalToSource) {
  function src(canonical) {
    const key = canonicalToSource[canonical];
    return key ? source[key] : '';
  }

  const customerId = hub_stdContactsClean_(src('CustomerId'));
  const contactId = hub_stdContactsClean_(src('ContactId'));
  const customerPhone = hub_stdContactsClean_(src('CustomerPrimaryPhone'));
  const contactPhone = hub_stdContactsClean_(src('ContactPrimaryPhone'));
  const contactEmail = hub_stdContactsClean_(src('ContactPrimaryEmail'));
  const customerAddress = hub_stdContactsClean_(src('CustomerFullAddress'));
  const contactAddress = hub_stdContactsClean_(src('ContactFullAddress'));
  const contactPhoneParts = hub_stdContactsPhoneParts_(contactPhone);

  return {
    CustomerDateCreated: src('CustomerDateCreated'),
    CustomerId: customerId,
    CustomerNumber: customerId,
    CustomerName: hub_stdContactsClean_(src('CustomerName')),
    CustomerStatus: 'Active',
    CustomerPrimaryPhone: customerPhone,
    NormalizedCustomerPhone: hub_stdContactsPhoneParts_(customerPhone).number,
    CustomerPrimaryEmail: contactEmail,
    NormalizedCustomerEmail: hub_stdContactsNormalizeEmail_(contactEmail),
    CustomerFullAddress: customerAddress,
    CustomerCity: hub_stdContactsCityFromFullAddress_(customerAddress),
    NormalizedCustomerAddress: hub_stdContactsNormalizeAddress_(customerAddress),

    ContactId: contactId,
    FirstName: hub_stdContactsClean_(src('FirstName')),
    LastName: hub_stdContactsClean_(src('LastName')),
    ContactFullName: hub_stdContactsClean_(src('ContactFullName')),
    ContactPrimaryEmail: contactEmail,
    NormalizedContactEmail: hub_stdContactsNormalizeEmail_(contactEmail),
    ContactPrimaryPhone: contactPhone,
    NormalizedContactPhone: contactPhoneParts.number,
    ContactPhoneExtension: contactPhoneParts.extension,
    ContactFullAddress: contactAddress,
    ContactCity: hub_stdContactsCityFromFullAddress_(contactAddress),
    NormalizedContactAddress: hub_stdContactsNormalizeAddress_(contactAddress),

    EntityType: 'CONTACT',
    EntityId: contactId,
    CustomerContactKey: customerId && contactId ? customerId + '|' + contactId : ''
  };
}

function hub_replaceStdContactsSheet_(sh, headers, values) {
  const requiredRows = Math.max(2, values.length + 1);
  const requiredCols = headers.length;

  if (sh.getMaxRows() < requiredRows) {
    sh.insertRowsAfter(sh.getMaxRows(), requiredRows - sh.getMaxRows());
  }

  if (sh.getMaxColumns() < requiredCols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), requiredCols - sh.getMaxColumns());
  }

  const oldLastRow = sh.getLastRow();
  const oldLastColumn = sh.getLastColumn();

  sh.getRange(1, 1, 1, requiredCols).setValues([headers]);

  const chunkSize = 4000;
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize);
    sh.getRange(start + 2, 1, chunk.length, requiredCols).setValues(chunk);
  }

  const newLastRow = values.length + 1;

  if (oldLastRow > newLastRow) {
    sh.getRange(
      newLastRow + 1,
      1,
      oldLastRow - newLastRow,
      Math.max(requiredCols, oldLastColumn)
    ).clearContent();
  }

  if (oldLastColumn > requiredCols && newLastRow > 0) {
    sh.getRange(
      1,
      requiredCols + 1,
      newLastRow,
      oldLastColumn - requiredCols
    ).clearContent();
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, requiredCols)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1F4E78')
    .setWrap(true);

  SpreadsheetApp.flush();
}

function hub_stdContactsNormalizeFieldName_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function hub_stdContactsClean_(value) {
  return String(value == null ? '' : value).trim();
}

function hub_stdContactsNormalizeEmail_(value) {
  return hub_stdContactsClean_(value).toLowerCase();
}

function hub_stdContactsPhoneParts_(value) {
  const raw = hub_stdContactsClean_(value);
  const extMatch = raw.match(/(?:ext(?:ension)?\.?|x)\s*[:.#-]?\s*(\d+)\s*$/i);
  const extension = extMatch ? extMatch[1] : '';
  let main = extMatch ? raw.substring(0, extMatch.index) : raw;
  let digits = main.replace(/\D/g, '');

  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.substring(1);
  }

  return {
    number: digits.length === 10 ? digits : digits,
    extension: extension
  };
}

function hub_stdContactsNormalizeAddress_(value) {
  return hub_stdContactsClean_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hub_stdContactsCityFromFullAddress_(value) {
  const raw = hub_stdContactsClean_(value);
  if (!raw) return '';

  const parts = raw.split(',').map(function(part) {
    return part.trim();
  }).filter(Boolean);

  if (parts.length < 3) return '';

  const last = parts[parts.length - 1];

  // Only infer a city when the final component resembles a CA/US
  // province/state/postal component. Otherwise leave blank rather than guess.
  const regionLike =
    /\b(?:ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)\b/i.test(last) ||
    /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(last) ||
    /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(last);

  return regionLike ? parts[parts.length - 2] : '';
}

function hub_stdContactsSafeText_(value, maxLen) {
  let s = String(value == null ? '' : value);

  s = s.replace(
    /(authorization\s*[:=]\s*['"]?\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+\/=-]+/ig,
    '$1[REDACTED]'
  );

  s = s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[REDACTED_KEY]');

  s = s.replace(
    /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig,
    '$1[REDACTED]'
  );

  return s.length <= maxLen ? s : s.substring(0, maxLen) + '...';
}

/* === HUB_STD_CONTACTS_R1_4_END === */
