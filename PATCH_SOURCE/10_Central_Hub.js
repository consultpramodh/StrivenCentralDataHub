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

/* === HUB_STD_LOCATIONS_R1_6_BEGIN ===
 * STD - Customer Locations - Central Hub
 * Production full refresh.
 *
 * SAFETY:
 * - READS Striven custom report only.
 * - WRITES only this Hub's DATA_LOCATIONS plus Hub logs/control.
 * - Does not modify registered source projects.
 * - Does not POST/PATCH/PUT/DELETE to Striven.
 *
 * BUSINESS RULES CONFIRMED:
 * - Customer Status = Active in the Striven report filter.
 * - Location Active = Yes in the Striven report filter.
 * - Address State = Ontario in the Striven report filter.
 * - Location Full Address is set in the Striven report filter.
 * - Customer ID = Customer Number in this tenant.
 */

function hub_refreshStdLocations() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('STD Locations refresh is already running.');
  }

  const startedMs = Date.now();
  const runId = 'STD_LOCATIONS_' + Utilities.formatDate(
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
    const reportUrl = String(props.getProperty('STRIVEN_STD_LOCATIONS_REPORT_URL') || '').trim();

    const missingProperties = [];
    if (!clientId) missingProperties.push('CLIENT_ID');
    if (!clientSecret) missingProperties.push('CLIENT_SECRET');
    if (!reportUrl) missingProperties.push('STRIVEN_STD_LOCATIONS_REPORT_URL');

    if (missingProperties.length) {
      throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
    }

    if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) {
      throw new Error('STRIVEN_STD_LOCATIONS_REPORT_URL must use https://api.striven.com/.');
    }

    const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
    const fetched = hub_fetchStdLocationsAllPages_(
      reportUrl,
      tokenInfo.accessToken,
      500
    );

    pageCalls = fetched.pageCalls;
    rowsFetched = fetched.rows.length;

    if (!fetched.rows.length) {
      throw new Error(
        'STD Locations report returned zero rows. DATA_LOCATIONS was not replaced.'
      );
    }

    const schema = hub_stdLocationsSchema_();
    const audit = hub_auditStdLocationsSchema_(fetched.actualFields, schema);

    if (
      audit.missingCanonicalFields.length ||
      audit.ambiguousCanonicalFields.length ||
      audit.unexpectedSourceFields.length ||
      fetched.actualFields.length !== schema.length
    ) {
      throw new Error(
        'STD Locations schema validation failed. ' +
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

    const preferredHeaders = hub_stdLocationsSourceHeaders_();
    const nonPreferredDisplayNames = fetched.actualFields.filter(function(field) {
      return preferredHeaders.indexOf(field) < 0;
    });

    if (nonPreferredDisplayNames.length) {
      throw new Error(
        'STD Locations report is not using standardized Display Names: ' +
        nonPreferredDisplayNames.join(', ')
      );
    }

    const seenLocationIds = {};
    const seenCustomerLocationKeys = {};

    let missingCustomerIds = 0;
    let missingLocationIds = 0;
    let missingLocationAddressIds = 0;
    let duplicateLocationIds = 0;
    let duplicateCustomerLocationKeys = 0;

    const records = fetched.rows.map(function(source) {
      const record = hub_buildStdLocationRecord_(
        source,
        audit.canonicalToSource
      );

      if (!record.CustomerId) missingCustomerIds++;
      if (!record.LocationId) missingLocationIds++;
      if (!record.LocationAddressId) missingLocationAddressIds++;

      if (record.LocationId) {
        if (seenLocationIds[record.LocationId]) duplicateLocationIds++;
        else seenLocationIds[record.LocationId] = true;
      }

      if (record.CustomerLocationKey) {
        if (seenCustomerLocationKeys[record.CustomerLocationKey]) {
          duplicateCustomerLocationKeys++;
        } else {
          seenCustomerLocationKeys[record.CustomerLocationKey] = true;
        }
      }

      return record;
    });

    if (
      missingCustomerIds ||
      missingLocationIds ||
      missingLocationAddressIds
    ) {
      throw new Error(
        'STD Locations contains required-ID gaps. ' +
        JSON.stringify({
          missingCustomerIds: missingCustomerIds,
          missingLocationIds: missingLocationIds,
          missingLocationAddressIds: missingLocationAddressIds
        })
      );
    }

    if (duplicateLocationIds || duplicateCustomerLocationKeys) {
      throw new Error(
        'STD Locations contains duplicate identity keys. ' +
        JSON.stringify({
          duplicateLocationIds: duplicateLocationIds,
          duplicateCustomerLocationKeys: duplicateCustomerLocationKeys
        })
      );
    }

    const headers = hub_stdLocationsHeaders_();
    const values = records.map(function(record) {
      return headers.map(function(header) {
        return record[header] == null ? '' : record[header];
      });
    });

    const sh = SpreadsheetApp.getActive().getSheetByName('DATA_LOCATIONS');
    if (!sh) throw new Error('DATA_LOCATIONS sheet is missing.');

    // Full remote fetch + schema + identity validation has completed.
    // Only now is the existing Hub dataset replaced.
    hub_writeCanonicalDataset_(sh, headers, values);
    SpreadsheetApp.flush();

    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;
    const apiCalls = pageCalls + (tokenInfo.requestedNewToken ? 1 : 0);

    hub_updateRefreshControl_(
      'LOCATIONS',
      true,
      records.length,
      apiCalls,
      durationSec,
      'SUCCESS',
      ''
    );

    hub_apiUsage_(
      runId,
      'LOCATIONS',
      'STRIVEN_STD_LOCATIONS_REPORT_URL',
      'GET',
      apiCalls,
      records.length,
      durationSec,
      'SUCCESS',
      '',
      'hub_refreshStdLocations'
    );

    const result = {
      status: 'PASS',
      dataset: 'LOCATIONS',
      targetSheet: 'DATA_LOCATIONS',
      rows: records.length,
      sourceCanonicalFieldCount: schema.length,
      outputColumnCount: headers.length,
      reportPageCalls: pageCalls,
      pageSize: fetched.pageSize,
      tokenRequestMade: tokenInfo.requestedNewToken,
      totalApiCallsThisRun: apiCalls,
      sourceToCanonical: audit.sourceToCanonical,
      canonicalToSource: audit.canonicalToSource,
      duplicateLocationIds: duplicateLocationIds,
      duplicateCustomerLocationKeys: duplicateCustomerLocationKeys,
      missingCustomerIds: missingCustomerIds,
      missingLocationIds: missingLocationIds,
      missingLocationAddressIds: missingLocationAddressIds,
      derivedFields: [
        'CustomerNumber',
        'CustomerStatus',
        'LocationIsActive',
        'LocationProvince',
        'NormalizedLocationPhone',
        'NormalizedLocationAddress',
        'NormalizedLocationPostalCode',
        'LocationKey',
        'CustomerLocationKey'
      ],
      filterExpectation: [
        'Customer Status = Active',
        'Location Full Address is set',
        'Address State = Ontario',
        'Location Active = Yes'
      ],
      strivenWritesPerformed: false,
      sourceProjectsModified: false,
      durationSec: durationSec
    };

    hub_log_(
      'INFO',
      'STD_LOCATIONS_REFRESH',
      'LOCATIONS',
      'Standard Locations refresh completed.',
      JSON.stringify(result)
    );

    Logger.log(JSON.stringify(result, null, 2));
    return result;

  } catch (err) {
    const durationSec = Math.round((Date.now() - startedMs) / 100) / 10;
    const safeError = hub_limit_(String(err && err.message || err), 1000);

    try {
      hub_updateRefreshControl_(
        'LOCATIONS',
        false,
        rowsFetched,
        pageCalls,
        durationSec,
        'FAILED',
        safeError
      );

      hub_apiUsage_(
        runId,
        'LOCATIONS',
        'STRIVEN_STD_LOCATIONS_REPORT_URL',
        'GET',
        pageCalls,
        rowsFetched,
        durationSec,
        'FAILED',
        safeError,
        'hub_refreshStdLocations'
      );

      hub_log_(
        'ERROR',
        'STD_LOCATIONS_REFRESH',
        'LOCATIONS',
        'Standard Locations refresh failed; previous DATA_LOCATIONS retained.',
        safeError
      );
    } catch (loggingErr) {
      // Preserve original exception.
    }

    throw err;

  } finally {
    lock.releaseLock();
  }
}

function hub_stdLocationsSchema_() {
  return [
    {
      canonical: 'LocationDateCreated',
      aliases: [
        'LocationDateCreated', 'Location Date Created',
        'CreatedOn', 'Created On', 'DateCreated', 'Date Created'
      ]
    },
    {
      canonical: 'CustomerId',
      aliases: [
        'CustomerId', 'CustomerID', 'Customer Id', 'Customer ID',
        'CustomerNumber', 'Customer Number'
      ]
    },
    {
      canonical: 'CustomerName',
      aliases: [
        'CustomerName', 'Customer Name'
      ]
    },
    {
      canonical: 'LocationId',
      aliases: [
        'LocationId', 'LocationID', 'Location Id', 'Location ID'
      ]
    },
    {
      canonical: 'LocationName',
      aliases: [
        'LocationName', 'Location Name', 'Name'
      ]
    },
    {
      canonical: 'LocationPrimaryPhone',
      aliases: [
        'LocationPrimaryPhone', 'Location Primary Phone',
        'PrimaryPhone', 'Primary Phone'
      ]
    },
    {
      canonical: 'LocationFullAddress',
      aliases: [
        'LocationFullAddress', 'Location Full Address',
        'AddressFullAddress', 'Address Full Address',
        'FullAddress', 'Full Address'
      ]
    },
    {
      canonical: 'LocationPostalCode',
      aliases: [
        'LocationPostalCode', 'Location Postal Code',
        'AddressZip', 'Address Zip', 'Zip',
        'PostalCode', 'Postal Code'
      ]
    },
    {
      canonical: 'LocationAddressId',
      aliases: [
        'LocationAddressId', 'Location Address Id', 'Location Address ID',
        'AddressId', 'AddressID', 'Address Id', 'Address ID'
      ]
    },
    {
      canonical: 'LocationIsPrimary',
      aliases: [
        'LocationIsPrimary', 'Location Is Primary',
        'IsPrimaryLocation', 'Is Primary Location', 'Primary'
      ]
    },
    {
      canonical: 'LocationIsDefaultShipTo',
      aliases: [
        'LocationIsDefaultShipTo', 'Location Is Default Ship To',
        'IsDefaultShipTo', 'Is Default Ship To',
        'DefaultShipTo', 'Default Ship To'
      ]
    },
    {
      canonical: 'LocationIsDefaultBillTo',
      aliases: [
        'LocationIsDefaultBillTo', 'Location Is Default Bill To',
        'IsDefaultBillTo', 'Is Default Bill To',
        'DefaultBillTo', 'Default Bill To'
      ]
    },
    {
      canonical: 'LocationDateLastModified',
      aliases: [
        'LocationDateLastModified', 'Location Date Last Modified',
        'DateLastModified', 'Date Last Modified',
        'LastModified', 'Last Modified'
      ]
    }
  ];
}

function hub_stdLocationsSourceHeaders_() {
  return [
    'LocationDateCreated',
    'CustomerId',
    'CustomerName',
    'LocationId',
    'LocationName',
    'LocationPrimaryPhone',
    'LocationFullAddress',
    'LocationPostalCode',
    'LocationAddressId',
    'LocationIsPrimary',
    'LocationIsDefaultShipTo',
    'LocationIsDefaultBillTo',
    'LocationDateLastModified'
  ];
}

function hub_stdLocationsHeaders_() {
  return [
    'LocationDateCreated',
    'LocationDateLastModified',

    'CustomerId',
    'CustomerNumber',
    'CustomerName',
    'CustomerStatus',

    'LocationId',
    'LocationKey',
    'CustomerLocationKey',
    'LocationName',

    'LocationAddressId',
    'LocationFullAddress',
    'LocationProvince',
    'LocationPostalCode',
    'NormalizedLocationPostalCode',
    'NormalizedLocationAddress',

    'LocationPrimaryPhone',
    'NormalizedLocationPhone',

    'LocationIsPrimary',
    'LocationIsDefaultShipTo',
    'LocationIsDefaultBillTo',
    'LocationIsActive'
  ];
}

function hub_fetchStdLocationsAllPages_(reportUrl, accessToken, pageSize) {
  const rows = [];
  const fieldSet = {};
  const maxPages = 500;
  let pageCalls = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const pageUrl = hub_reportPagedUrl_(reportUrl, pageIndex, pageSize);

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

    if (code === 401) {
      PropertiesService.getScriptProperties()
        .deleteProperty('HUB_STRIVEN_ACCESS_TOKEN');
      PropertiesService.getScriptProperties()
        .deleteProperty('HUB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
    }

    if (code < 200 || code >= 300) {
      throw new Error(
        'STD Locations report page ' + pageIndex +
        ' failed HTTP ' + code + ': ' +
        hub_safeExternalText_(text, 500)
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      throw new Error(
        'STD Locations page ' + pageIndex + ' returned non-JSON content.'
      );
    }

    const pageRows = hub_stdLocationsExtractRows_(payload);

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
    'STD Locations reached maxPages=' + maxPages +
    ' without a short final page. Refusing to replace DATA_LOCATIONS.'
  );
}

function hub_stdLocationsExtractRows_(payload) {
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

function hub_auditStdLocationsSchema_(actualFields, schema) {
  const normToRaw = {};

  actualFields.forEach(function(raw) {
    const norm = hub_stdLocationsNormalizeFieldName_(raw);
    if (!normToRaw[norm]) normToRaw[norm] = [];
    normToRaw[norm].push(raw);
  });

  const canonicalToSource = {};
  const sourceToCanonical = {};
  const missing = [];
  const ambiguous = [];
  const acceptedNorms = {};

  schema.forEach(function(def) {
    const canonicalNorm = hub_stdLocationsNormalizeFieldName_(def.canonical);
    const aliases = (def.aliases || []).slice();

    // Mandatory Central Hub alias standard.
    if (!aliases.some(function(alias) {
      return hub_stdLocationsNormalizeFieldName_(alias) === canonicalNorm;
    })) {
      throw new Error(
        'STD Locations alias contract invalid: canonical missing from alias set for ' +
        def.canonical
      );
    }

    const matches = [];

    aliases.forEach(function(alias) {
      const norm = hub_stdLocationsNormalizeFieldName_(alias);
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
    return !acceptedNorms[hub_stdLocationsNormalizeFieldName_(raw)];
  });

  return {
    canonicalToSource: canonicalToSource,
    sourceToCanonical: sourceToCanonical,
    missingCanonicalFields: missing,
    ambiguousCanonicalFields: ambiguous,
    unexpectedSourceFields: unexpected
  };
}

function hub_buildStdLocationRecord_(source, canonicalToSource) {
  function src(canonical) {
    const key = canonicalToSource[canonical];
    return key ? source[key] : '';
  }

  const customerId = hub_stdLocationsClean_(src('CustomerId'));
  const locationId = hub_stdLocationsClean_(src('LocationId'));
  const addressId = hub_stdLocationsClean_(src('LocationAddressId'));
  const phone = hub_stdLocationsClean_(src('LocationPrimaryPhone'));
  const fullAddress = hub_stdLocationsClean_(src('LocationFullAddress'));
  const postal = hub_stdLocationsClean_(src('LocationPostalCode'));

  return {
    LocationDateCreated: src('LocationDateCreated'),
    LocationDateLastModified: src('LocationDateLastModified'),

    CustomerId: customerId,
    CustomerNumber: customerId,
    CustomerName: hub_stdLocationsClean_(src('CustomerName')),
    CustomerStatus: 'Active',

    LocationId: locationId,
    LocationKey: locationId,
    CustomerLocationKey:
      customerId && locationId ? customerId + '|' + locationId : '',
    LocationName: hub_stdLocationsClean_(src('LocationName')),

    LocationAddressId: addressId,
    LocationFullAddress: fullAddress,
    LocationProvince: 'Ontario',
    LocationPostalCode: postal,
    NormalizedLocationPostalCode: hub_stdLocationsNormalizePostal_(postal),
    NormalizedLocationAddress: hub_stdLocationsNormalizeAddress_(fullAddress),

    LocationPrimaryPhone: phone,
    NormalizedLocationPhone: hub_stdLocationsNormalizePhone_(phone),

    LocationIsPrimary: hub_stdLocationsBoolean_(src('LocationIsPrimary')),
    LocationIsDefaultShipTo:
      hub_stdLocationsBoolean_(src('LocationIsDefaultShipTo')),
    LocationIsDefaultBillTo:
      hub_stdLocationsBoolean_(src('LocationIsDefaultBillTo')),
    LocationIsActive: true
  };
}

function hub_stdLocationsNormalizeFieldName_(value) {
  return String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function hub_stdLocationsClean_(value) {
  return String(value == null ? '' : value).trim();
}

function hub_stdLocationsNormalizePhone_(value) {
  const raw = hub_stdLocationsClean_(value);
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && digits.charAt(0) === '1') {
    digits = digits.substring(1);
  }

  return digits;
}

function hub_stdLocationsNormalizePostal_(value) {
  return hub_stdLocationsClean_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function hub_stdLocationsNormalizeAddress_(value) {
  return hub_stdLocationsClean_(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hub_stdLocationsBoolean_(value) {
  if (value === true || value === false) return value;

  const s = hub_stdLocationsClean_(value).toLowerCase();

  if (['true', 'yes', 'y', '1'].indexOf(s) >= 0) return true;
  if (['false', 'no', 'n', '0', ''].indexOf(s) >= 0) return false;

  throw new Error('Unrecognized Location boolean value: ' + String(value));
}

/* === HUB_STD_LOCATIONS_R1_6_END === */

/* ===== OPEN BALANCE DISTRIBUTION MODULE ===== */
/**
 * Classic Fireplace & BBQ Store
 * Striven Central Data Hub — Sales Rep Open Balance Distribution
 * Target Apps Script Project ID:
 * 1t81y0BcV0cnBEBSKcbZt2nx16IBAg63rRvsfSVpjiDiBvrNi6TEq-AG8
 *
 * Privacy model:
 * - Source report is fetched once.
 * - Every source row must resolve to exactly one enabled/READY rep.
 * - Unknown, missing, or ambiguous ownership aborts the ENTIRE run before email.
 * - TEST mode sends every rep-specific report only to ADMIN_TEST_EMAIL.
 * - PRODUCTION mode sends exactly one recipient per rep. No CC/BCC.
 * - CreatedBy is NEVER used as a substitute for SalesRep.
 */

const OB = Object.freeze({
  SPREADSHEET_ID: '13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU',
  SHEETS: Object.freeze({
    CONTROL: 'OPEN_BALANCE_CONTROL',
    REPS: 'OPEN_BALANCE_REP_CONFIG',
    DATA: 'DATA_OPEN_BALANCES',
    SEND_LOG: 'OPEN_BALANCE_SEND_LOG',
    EXCEPTIONS: 'OPEN_BALANCE_EXCEPTIONS',
    EMPLOYEE_PROFILES: 'DATA_EMPLOYEE_PROFILES'
  }),
  REPORT_URL_PROPERTY: 'STRIVEN_OPEN_BALANCE_REPORT_URL',
  DIRECT_API: Object.freeze({
    BASE_URL: 'https://api.striven.com',
    INVOICE_SEARCH_PATH: '/v1/invoices/search',
    INVOICE_DETAIL_PREFIX: '/v1/invoices/',
    EMPLOYEE_DETAIL_PREFIX: '/v1/employees/',
    SEARCH_PAGE_SIZE: 100,
    SEARCH_MAX_PAGES: 500,
    SEARCH_TIME_BUDGET_MS: 4 * 60 * 1000,
    API_BRAKE_MS: 750
  }),
  TRIGGER_FUNCTION: 'runOpenBalanceRepDistribution',
  REFRESH_TRIGGER_FUNCTION: 'runOpenBalanceAutoRefresh',
  PRIVATE_CONFIG_SHEET: 'OPEN_BALANCE_PRIVATE_CONFIG',
  DEFAULT_OWNER_FIELD: 'SalesRep',
  SENDER_NAME: 'Classic Fireplace & BBQ Store',
  CURRENCY: 'CAD'
});

/** Production entry point. Intended for the biweekly installable trigger. */
function runOpenBalanceRepDistribution() {
  return obRun_({ modeOverride: null, sendEmails: true, allowDisabled: false });
}

/**
 * Unattended cache refresh.
 * Safe before Sales Rep routing is ready: it refreshes DATA_OPEN_BALANCES
 * without sending email and without substituting CreatedBy for SalesRep.
 */
function runOpenBalanceAutoRefresh() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, status: 'SKIPPED_LOCKED' };
  }

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);

    if (control.AUTO_REFRESH_ENABLED !== true) {
      return { ok: false, status: 'AUTO_REFRESH_DISABLED' };
    }

    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);

    // Always cache the freshly fetched report before routing validation.
    // This keeps DATA_OPEN_BALANCES current even while Sales Rep ownership is still being configured.
    obWriteRawSnapshot_(ss, report.rows, ownerField);
    obRecordRefresh_(ss, report.rows.length, 'SUCCESS');

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', !!ownerField);
    obSetControlValue_(
      ss,
      'STATUS',
      ownerField ? 'REFRESHED_WAITING_ROUTING' : 'BLOCKED_PENDING_OWNER_FIELD'
    );

    const result = {
      ok: true,
      status: ownerField ? 'REFRESHED_WAITING_ROUTING' : 'REFRESHED_PENDING_OWNER_FIELD',
      rows: report.rows.length,
      ownerFieldPresent: !!ownerField
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    try {
      const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
      obRecordRefresh_(ss, '', 'FAILED: ' + String(err && err.message ? err.message : err).slice(0, 500));
    } catch (loggingErr) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resolves authoritative ownership for every Open Balance Invoice through
 * Striven's direct Invoice API.
 *
 * Route:
 *   Transaction Number
 *     -> POST /v1/invoices/search
 *     -> unique Invoice ID
 *     -> GET /v1/invoices/{id}
 *     -> invoice.salesRep.id/name
 *     -> one-time GET /v1/employees/{salesRep.id} cache
 *
 * Safety:
 * - Never substitutes CreatedBy.
 * - Never guesses duplicate/missing Invoice IDs.
 * - Payment rows remain blocked until payment-to-invoice application evidence
 *   is implemented and verified.
 * - Sends no email.
 */
function openBalanceResolveInvoiceOwners() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const report = obFetchReport_();
    const invoiceRows = report.rows.filter(function(row) {
      return String(row.TransactionType || '').trim().toUpperCase() === 'INVOICE';
    });

    if (!invoiceRows.length) {
      throw new Error('Open Balance report returned zero Invoice rows.');
    }

    const resolution = obResolveInvoiceOwnersFromDirectApi_(invoiceRows);
    const fetchedAt = new Date();
    const runId = 'OWNER-' + Utilities.formatDate(
      fetchedAt,
      Session.getScriptTimeZone() || 'America/Toronto',
      'yyyyMMdd-HHmmss'
    );

    const employeeIds = [];
    const stagingRows = report.rows.map(function(row) {
      const type = String(row.TransactionType || '').trim().toUpperCase();
      const hash = obHash_(JSON.stringify(row));

      if (type !== 'INVOICE') {
        return obStagingRow_(
          runId,
          fetchedAt,
          '',
          row,
          type === 'PAYMENT'
            ? 'PENDING_PAYMENT_APPLICATION_OWNER'
            : 'BLOCKED_UNSUPPORTED_TRANSACTION_TYPE',
          hash
        );
      }

      const comparable = obNormalizeTransactionNumber_(row.TransactionNumber);
      const resolved = resolution.byTransaction[comparable];

      if (!resolved || resolved.status !== 'VERIFIED') {
        return obStagingRow_(
          runId,
          fetchedAt,
          '',
          row,
          resolved ? resolved.status : 'BLOCKED_INVOICE_NOT_RESOLVED',
          hash
        );
      }

      const employeeId = String(resolved.salesRepId);
      if (employeeIds.indexOf(employeeId) === -1) employeeIds.push(employeeId);

      return obStagingRow_(
        runId,
        fetchedAt,
        employeeId,
        row,
        'VERIFIED_INVOICE_SALES_REP_API',
        hash
      );
    });

    obReplaceStaging_(ss, stagingRows);

    const profiles = obCacheEmployeeProfiles_(ss, employeeIds, resolution);
    const verifiedCount = Object.keys(resolution.byTransaction).filter(function(key) {
      return resolution.byTransaction[key].status === 'VERIFIED';
    }).length;

    obSetControlValue_(ss, 'INVOICE_OWNERS_VERIFIED', verifiedCount);
    obSetControlValue_(
      ss,
      'STATUS',
      verifiedCount === invoiceRows.length
        ? 'INVOICE_OWNER_ENRICHMENT_COMPLETE'
        : 'OWNER_ENRICHMENT_PARTIAL'
    );

    const result = {
      ok: verifiedCount === invoiceRows.length,
      status: verifiedCount === invoiceRows.length
        ? 'INVOICE_OWNER_ENRICHMENT_COMPLETE'
        : 'OWNER_ENRICHMENT_PARTIAL',
      sourceRows: report.rows.length,
      invoiceRows: invoiceRows.length,
      verifiedInvoiceOwners: verifiedCount,
      unresolvedInvoiceOwners: invoiceRows.length - verifiedCount,
      paymentRows: report.rows.filter(function(row) {
        return String(row.TransactionType || '').trim().toUpperCase() === 'PAYMENT';
      }).length,
      invoiceSearchPages: resolution.pagesFetched,
      apiCalls: resolution.apiCalls + profiles.apiCalls,
      employeeProfilesRequested: profiles.requested,
      employeeProfilesVerified: profiles.verified,
      employeeProfilesWithoutEmail: profiles.withoutEmail
    };

    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Manual no-email validation. Safe to run from the Apps Script editor. */
function openBalanceDryRun() {
  return obRun_({ modeOverride: 'DRY_RUN', sendEmails: false, allowDisabled: true });
}

/**
 * Manual test send. Sends ALL rep reports only to ADMIN_TEST_EMAIL.
 * It never sends to the rep addresses.
 */
function openBalanceTestSend() {
  return obRun_({ modeOverride: 'TEST', sendEmails: true, allowDisabled: true });
}

/** Fetches the source once and updates source-schema readiness in OPEN_BALANCE_CONTROL. */
function openBalanceAuditSource() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);
    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);
    const present = !!ownerField;

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', present);
    obSetControlValue_(
      ss,
      'STATUS',
      present ? 'WAITING_FOR_REP_CONFIG' : 'BLOCKED_PENDING_OWNER_FIELD'
    );

    const result = {
      ok: present,
      totalRecords: report.rows.length,
      fields: report.fields,
      requestedOwnerField: ownerFieldRequested,
      resolvedOwnerField: ownerField || null,
      status: present ? 'WAITING_FOR_REP_CONFIG' : 'BLOCKED_PENDING_OWNER_FIELD'
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Prompts once for the tokenized Striven report URL and stores it in Script Properties. */
function openBalanceSetupReportUrl() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Open Balance Report URL',
    'Paste the complete Striven v2 report URL. It will be stored in Script Properties, not in the sheet.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return 'CANCELLED';
  const url = String(response.getResponseText() || '').trim();
  if (!/^https:\/\/api\.striven\.com\/v2\/reports\//i.test(url)) {
    throw new Error('Invalid Striven report URL. Expected https://api.striven.com/v2/reports/...');
  }
  PropertiesService.getScriptProperties().setProperty(OB.REPORT_URL_PROPERTY, url);
  return openBalanceAuditSource();
}

/** Stores the TEST-only recipient in OPEN_BALANCE_CONTROL. */
function openBalanceSetupAdminTestEmail() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Admin Test Email',
    'Enter the single email address that should receive ALL test-mode rep reports.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return 'CANCELLED';
  const email = obValidateSingleEmail_(response.getResponseText());
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  obSetControlValue_(ss, 'ADMIN_TEST_EMAIL', email);
  return { ok: true, adminTestEmail: email };
}

/**
 * Installs both unattended triggers:
 * 1) daily refresh of DATA_OPEN_BALANCES
 * 2) biweekly rep distribution
 *
 * This is an infrastructure/deployment action, not an operator workflow.
 * Once installed, no recurring manual refresh or send action is required.
 */
function installOpenBalanceAutomation() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const tz = String(control.TIMEZONE || 'America/Toronto').trim();
  const refreshHour = Number(control.REFRESH_HOUR == null ? 7 : control.REFRESH_HOUR);

  if (!Number.isInteger(refreshHour) || refreshHour < 0 || refreshHour > 23) {
    throw new Error('REFRESH_HOUR must be an integer from 0 to 23.');
  }

  const reportUrl = obGetReportUrl_();
  if (!reportUrl) throw new Error('Open Balance report URL is not configured.');

  obDeleteRefreshTriggers_();

  const refreshTrigger = ScriptApp.newTrigger(OB.REFRESH_TRIGGER_FUNCTION)
    .timeBased()
    .everyDays(1)
    .atHour(refreshHour)
    .inTimezone(tz)
    .create();

  let distribution = null;
  try {
    distribution = installOpenBalanceBiweeklyTrigger();
  } catch (err) {
    // Keep the cache refresh alive even while Sales Rep routing is still being completed.
    distribution = { ok: false, status: 'DISTRIBUTION_NOT_READY', error: String(err && err.message ? err.message : err) };
  }

  return {
    ok: true,
    refreshTriggerId: refreshTrigger.getUniqueId(),
    refreshHour: refreshHour,
    timezone: tz,
    distribution: distribution
  };
}

/**
 * Installs exactly one biweekly trigger using the control sheet settings.
 * Refuses installation while ownership routing is not ready.
 */
function installOpenBalanceBiweeklyTrigger() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const readiness = obCheckConfigurationReadiness_(ss, control);
  if (!readiness.ready) {
    throw new Error('Trigger not installed: ' + readiness.reason);
  }

  obDeleteDistributionTriggers_();

  const dayName = String(control.DAY || 'MONDAY').toUpperCase();
  const dayMap = {
    MONDAY: ScriptApp.WeekDay.MONDAY,
    TUESDAY: ScriptApp.WeekDay.TUESDAY,
    WEDNESDAY: ScriptApp.WeekDay.WEDNESDAY,
    THURSDAY: ScriptApp.WeekDay.THURSDAY,
    FRIDAY: ScriptApp.WeekDay.FRIDAY,
    SATURDAY: ScriptApp.WeekDay.SATURDAY,
    SUNDAY: ScriptApp.WeekDay.SUNDAY
  };
  if (!dayMap[dayName]) throw new Error('Unsupported DAY in OPEN_BALANCE_CONTROL: ' + dayName);

  const hour = Number(control.HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('HOUR must be an integer from 0 to 23.');
  }

  const tz = String(control.TIMEZONE || 'America/Toronto').trim();
  const trigger = ScriptApp.newTrigger(OB.TRIGGER_FUNCTION)
    .timeBased()
    .everyWeeks(2)
    .onWeekDay(dayMap[dayName])
    .atHour(hour)
    .inTimezone(tz)
    .create();

  return { ok: true, triggerId: trigger.getUniqueId(), cadence: 'EVERY_2_WEEKS', day: dayName, hour: hour, timezone: tz };
}

function removeOpenBalanceBiweeklyTrigger() {
  const count = obDeleteDistributionTriggers_();
  return { ok: true, removed: count };
}

function removeOpenBalanceAutomation() {
  const refreshRemoved = obDeleteRefreshTriggers_();
  const distributionRemoved = obDeleteDistributionTriggers_();
  return { ok: true, refreshRemoved: refreshRemoved, distributionRemoved: distributionRemoved };
}

function openBalanceStatus() {
  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const control = obReadControl_(ss);
  const reps = obReadRepConfig_(ss, false);
  const triggers = ScriptApp.getProjectTriggers();
  const triggerCount = triggers.filter(t => t.getHandlerFunction() === OB.TRIGGER_FUNCTION).length;
  const refreshTriggerCount = triggers.filter(t => t.getHandlerFunction() === OB.REFRESH_TRIGGER_FUNCTION).length;
  return {
    control: control,
    enabledRepCount: reps.length,
    triggerCount: triggerCount,
    refreshTriggerCount: refreshTriggerCount,
    reportUrlConfigured: !!obGetReportUrl_()
  };
}

function obRun_(options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = new Date();
  const runId = 'OB-' + Utilities.formatDate(startedAt, 'America/Toronto', 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 8);

  try {
    const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
    const control = obReadControl_(ss);
    const configuredMode = String(control.MODE || 'TEST').toUpperCase();
    const mode = String(options.modeOverride || configuredMode).toUpperCase();

    if (!options.allowDisabled && control.ENABLED !== true) {
      return { ok: false, status: 'DISABLED', runId: runId, message: 'OPEN_BALANCE_CONTROL ENABLED is FALSE.' };
    }

    if (!['PRODUCTION', 'TEST', 'DRY_RUN'].includes(mode)) {
      throw new Error('Unsupported MODE: ' + mode);
    }

    const report = obFetchReport_();
    const ownerFieldRequested = String(control.OWNER_FIELD_REQUIRED || OB.DEFAULT_OWNER_FIELD).trim();
    const ownerField = obFindField_(report.fields, ownerFieldRequested);

    if (!ownerField) {
      obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', false);
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_PENDING_OWNER_FIELD');
      obAppendException_(ss, [
        runId,
        new Date(),
        'SCHEMA_MISSING_OWNER_FIELD',
        '', '', '', '', '', '',
        'Required field "' + ownerFieldRequested + '" was not found. Available fields: ' + report.fields.join(', '),
        'BLOCKED'
      ]);
      throw new Error('Privacy stop: required owner field "' + ownerFieldRequested + '" is absent from the Striven report. CreatedBy will not be used as a substitute.');
    }

    obSetControlValue_(ss, 'OWNER_FIELD_PRESENT', true);

    const reps = obReadRepConfig_(ss, true);
    if (!reps.length) throw new Error('No enabled READY sales reps exist in OPEN_BALANCE_REP_CONFIG.');
    const repByOwner = obBuildRepMap_(reps);

    const routing = obRouteRows_(report.rows, ownerField, repByOwner, runId);
    obReplaceStaging_(ss, routing.stagingRows);

    if (routing.exceptions.length) {
      routing.exceptions.forEach(row => obAppendException_(ss, row));
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_ROUTING_EXCEPTIONS');
      throw new Error('Privacy stop: ' + routing.exceptions.length + ' row(s) could not be assigned to exactly one authorized rep. No emails were sent.');
    }

    // Critical invariant: every source row must be routed exactly once before ANY email.
    if (routing.routedCount !== report.rows.length) {
      obSetControlValue_(ss, 'STATUS', 'BLOCKED_ROUTING_COUNT_MISMATCH');
      throw new Error('Privacy stop: routed row count (' + routing.routedCount + ') does not equal source row count (' + report.rows.length + ').');
    }

    obSetControlValue_(ss, 'STATUS', mode === 'DRY_RUN' ? 'DRY_RUN_VALIDATED' : 'READY');

    if (!options.sendEmails || mode === 'DRY_RUN') {
      const dry = {
        ok: true,
        status: 'DRY_RUN_VALIDATED',
        runId: runId,
        sourceRows: report.rows.length,
        repCount: Object.keys(routing.groups).length,
        ownerField: ownerField
      };
      console.log(JSON.stringify(dry));
      return dry;
    }

    let adminTestEmail = '';
    if (mode === 'TEST') adminTestEmail = obValidateSingleEmail_(control.ADMIN_TEST_EMAIL);
    if (mode === 'PRODUCTION' && control.ENABLED !== true) {
      throw new Error('Production send blocked because ENABLED is FALSE.');
    }

    const results = [];
    const repKeys = Object.keys(routing.groups).sort();

    // All routing validations above happen BEFORE this first send.
    for (const repKey of repKeys) {
      const group = routing.groups[repKey];
      const rep = group.rep;
      const rows = group.rows;

      obAssertGroupIsolation_(rep, rows, ownerField);

      const recipient = mode === 'TEST'
        ? adminTestEmail
        : obValidateSingleEmail_(rep.email);

      const payloadHash = obHash_(JSON.stringify(rows));
      const totalOpenBalance = rows.reduce((sum, row) => sum + obToNumber_(row.OpenBalance), 0);
      const subjectDate = Utilities.formatDate(new Date(), String(control.TIMEZONE || 'America/Toronto'), 'yyyy-MM-dd');
      const subject = mode === 'TEST'
        ? '[TEST – Intended for ' + rep.name + '] Open Balance Report – ' + subjectDate
        : 'Open Balance Report – ' + subjectDate;

      const htmlBody = obBuildEmailHtml_(rep, rows, totalOpenBalance, mode, control.TIMEZONE || 'America/Toronto');
      const textBody = obBuildEmailText_(rep, rows, totalOpenBalance, mode, control.TIMEZONE || 'America/Toronto');

      try {
        MailApp.sendEmail({
          to: recipient,
          subject: subject,
          body: textBody,
          htmlBody: htmlBody,
          name: OB.SENDER_NAME
        });

        obAppendSendLog_(ss, [
          runId, new Date(), mode, rep.key, rep.name, recipient,
          rows.length, totalOpenBalance, payloadHash, 'SENT', ''
        ]);
        results.push({ repKey: rep.key, repName: rep.name, recipient: recipient, rowCount: rows.length, status: 'SENT' });
      } catch (err) {
        obAppendSendLog_(ss, [
          runId, new Date(), mode, rep.key, rep.name, recipient,
          rows.length, totalOpenBalance, payloadHash, 'FAILED', String(err && err.message ? err.message : err)
        ]);
        throw err;
      }
    }

    obSetControlValue_(ss, 'STATUS', mode === 'PRODUCTION' ? 'LAST_RUN_SENT' : 'LAST_TEST_SENT');
    return { ok: true, status: mode === 'PRODUCTION' ? 'SENT' : 'TEST_SENT', runId: runId, results: results };
  } finally {
    lock.releaseLock();
  }
}

function obResolveInvoiceOwnersFromDirectApi_(invoiceRows) {
  const targetNumbers = [];
  const targetIndex = Object.create(null);

  invoiceRows.forEach(function(row) {
    const raw = String(row.TransactionNumber || '').trim();
    const comparable = obNormalizeTransactionNumber_(raw);
    if (!comparable) return;
    if (!targetIndex[comparable]) {
      targetIndex[comparable] = raw;
      targetNumbers.push(raw);
    }
  });

  const matches = Object.create(null);
  const startedAt = Date.now();
  let pageIndex = 0;
  let pagesFetched = 0;
  let apiCalls = 0;
  let searchComplete = false;

  while (
    pageIndex < OB.DIRECT_API.SEARCH_MAX_PAGES &&
    Date.now() - startedAt < OB.DIRECT_API.SEARCH_TIME_BUDGET_MS
  ) {
    const response = obStrivenApiRequest_({
      path: OB.DIRECT_API.INVOICE_SEARCH_PATH,
      method: 'post',
      payload: {
        PageIndex: pageIndex,
        PageSize: OB.DIRECT_API.SEARCH_PAGE_SIZE
      }
    });
    apiCalls++;

    const page = obExtractInvoiceSearchPage_(response.data);
    pagesFetched++;

    page.records.forEach(function(record) {
      const transactionNumber = String(
        record.txnNumber ||
        record.TxnNumber ||
        record.transactionNumber ||
        record.TransactionNumber ||
        record.invoiceNumber ||
        record.InvoiceNumber ||
        ''
      ).trim();
      const comparable = obNormalizeTransactionNumber_(transactionNumber);
      if (!targetIndex[comparable]) return;

      const invoiceId = String(
        record.id ||
        record.Id ||
        record.invoiceId ||
        record.InvoiceId ||
        record.InvoiceID ||
        ''
      ).trim();
      if (!/^\d+$/.test(invoiceId)) return;

      if (!matches[comparable]) matches[comparable] = [];
      if (matches[comparable].indexOf(invoiceId) === -1) {
        matches[comparable].push(invoiceId);
      }
    });

    if (page.isLastPage || !page.records.length) {
      searchComplete = true;
      break;
    }
    pageIndex++;
  }

  if (!searchComplete) {
    throw new Error(
      'Privacy stop: Invoice search did not reach the end of the result set ' +
      'within the configured safety budget. No ownership was accepted because ' +
      'transaction-number uniqueness could not be proven.'
    );
  }

  const byTransaction = Object.create(null);

  targetNumbers.forEach(function(number) {
    const comparable = obNormalizeTransactionNumber_(number);
    const ids = matches[comparable] || [];

    if (!ids.length) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_ID_NOT_FOUND',
        transactionNumber: number
      };
      return;
    }
    if (ids.length !== 1) {
      byTransaction[comparable] = {
        status: 'BLOCKED_AMBIGUOUS_INVOICE_ID',
        transactionNumber: number,
        candidateCount: ids.length
      };
      return;
    }

    const invoiceId = ids[0];
    const detailResponse = obStrivenApiRequest_({
      path: OB.DIRECT_API.INVOICE_DETAIL_PREFIX + encodeURIComponent(invoiceId),
      method: 'get'
    });
    apiCalls++;

    const detail = detailResponse.data;
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVALID_INVOICE_DETAIL',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    const detailNumber = String(
      detail.txnNumber ||
      detail.TxnNumber ||
      detail.transactionNumber ||
      detail.TransactionNumber ||
      detail.invoiceNumber ||
      detail.InvoiceNumber ||
      ''
    ).trim();

    if (obNormalizeTransactionNumber_(detailNumber) !== comparable) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_NUMBER_MISMATCH',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    const salesRep = detail.salesRep || detail.SalesRep;
    const salesRepId = salesRep && String(salesRep.id || salesRep.Id || '').trim();
    const salesRepName = salesRep && String(salesRep.name || salesRep.Name || '').trim();

    if (!salesRepId || !/^\d+$/.test(salesRepId) || !salesRepName) {
      byTransaction[comparable] = {
        status: 'BLOCKED_INVOICE_SALES_REP_MISSING',
        transactionNumber: number,
        invoiceId: invoiceId
      };
      return;
    }

    byTransaction[comparable] = {
      status: 'VERIFIED',
      transactionNumber: number,
      invoiceId: invoiceId,
      salesRepId: salesRepId,
      salesRepName: salesRepName
    };
  });

  return {
    byTransaction: byTransaction,
    targetCount: targetNumbers.length,
    pagesFetched: pagesFetched,
    apiCalls: apiCalls
  };
}

function obExtractInvoiceSearchPage_(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invoice search returned an unsupported payload.');
  }

  const records = Array.isArray(payload)
    ? payload
    : (
        Array.isArray(payload.data)
          ? payload.data
          : (
              Array.isArray(payload.results)
                ? payload.results
                : (
                    Array.isArray(payload.items)
                      ? payload.items
                      : []
                  )
            )
      );

  const totalCount = Number(
    payload.totalCount ||
    payload.TotalCount ||
    payload.totalRecords ||
    payload.TotalRecords ||
    payload.count ||
    0
  );
  const pageIndex = Number(payload.pageIndex || payload.PageIndex || 0);
  const pageSize = Number(
    payload.pageSize ||
    payload.PageSize ||
    OB.DIRECT_API.SEARCH_PAGE_SIZE
  );

  return {
    records: records,
    isLastPage: totalCount > 0 && pageSize > 0
      ? ((pageIndex + 1) * pageSize >= totalCount)
      : records.length < pageSize
  };
}

function obStrivenApiRequest_(request, retrying) {
  request = request || {};
  const path = String(request.path || '');
  if (!/^\/v1\//.test(path)) {
    throw new Error('Refusing unapproved Striven API path: ' + path);
  }

  const token = obGetStrivenAccessToken_(!!retrying);
  Utilities.sleep(OB.DIRECT_API.API_BRAKE_MS);

  const options = {
    method: String(request.method || 'get').toLowerCase(),
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json'
    },
    muteHttpExceptions: true
  };

  if (request.payload !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(request.payload);
  }

  const response = UrlFetchApp.fetch(OB.DIRECT_API.BASE_URL + path, options);
  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status === 401 && !retrying) {
    obClearStrivenTokenCache_();
    return obStrivenApiRequest_(request, true);
  }

  if (status < 200 || status >= 300) {
    throw new Error(
      'Striven API HTTP ' + status + ' for ' + path +
      ': ' + String(text || '').slice(0, 500)
    );
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Striven API returned non-JSON content for ' + path + '.');
    }
  }

  return { statusCode: status, data: data };
}

function obGetStrivenAccessToken_(forceRefresh) {
  const props = PropertiesService.getScriptProperties();
  const tokenKey = 'OB_STRIVEN_ACCESS_TOKEN';
  const expiryKey = 'OB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS';
  const now = Date.now();

  if (!forceRefresh) {
    const cached = String(props.getProperty(tokenKey) || '');
    const expiry = Number(props.getProperty(expiryKey) || 0);
    if (cached && expiry > now + 5 * 60 * 1000) return cached;
  }

  const clientId = String(
    props.getProperty('CLIENT_ID') ||
    props.getProperty('STRIVEN_CLIENT_ID') ||
    ''
  ).trim();
  const clientSecret = String(
    props.getProperty('CLIENT_SECRET') ||
    props.getProperty('STRIVEN_CLIENT_SECRET') ||
    ''
  ).trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Striven OAuth credentials. Expected CLIENT_ID/CLIENT_SECRET ' +
      'or STRIVEN_CLIENT_ID/STRIVEN_CLIENT_SECRET in Script Properties.'
    );
  }

  const basic = Utilities.base64Encode(clientId + ':' + clientSecret);
  const response = UrlFetchApp.fetch(OB.DIRECT_API.BASE_URL + '/accesstoken', {
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

  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('Striven OAuth failed HTTP ' + status + '.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Striven OAuth returned non-JSON content.');
  }

  if (!parsed || !parsed.access_token) {
    throw new Error('Striven OAuth response did not contain access_token.');
  }

  const expiresIn = Number(parsed.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Striven OAuth response did not contain a valid expires_in.');
  }

  props.setProperties({
    [tokenKey]: String(parsed.access_token),
    [expiryKey]: String(now + expiresIn * 1000)
  }, false);

  return String(parsed.access_token);
}

function obClearStrivenTokenCache_() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('OB_STRIVEN_ACCESS_TOKEN');
  props.deleteProperty('OB_STRIVEN_ACCESS_TOKEN_EXPIRES_AT_MS');
}

function obNormalizeTransactionNumber_(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function obCacheEmployeeProfiles_(ss, employeeIds, resolution) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.EMPLOYEE_PROFILES);
  const lastRow = sheet.getLastRow();
  const existing = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 14).getValues()
    : [];

  const rowById = Object.create(null);
  const rowsByName = Object.create(null);

  existing.forEach(function(row, index) {
    const sheetRow = index + 2;
    const id = String(row[0] || '').trim();
    const name = obNorm_(row[2]);
    if (id) rowById[id] = sheetRow;
    if (name) {
      if (!rowsByName[name]) rowsByName[name] = [];
      rowsByName[name].push(sheetRow);
    }
  });

  const repNameById = Object.create(null);
  Object.keys(resolution.byTransaction).forEach(function(key) {
    const item = resolution.byTransaction[key];
    if (item.status === 'VERIFIED') {
      repNameById[String(item.salesRepId)] = item.salesRepName;
    }
  });

  let apiCalls = 0;
  let verified = 0;
  let withoutEmail = 0;

  employeeIds.forEach(function(employeeId) {
    const id = String(employeeId || '').trim();
    if (!/^\d+$/.test(id)) return;

    const existingRowNumber = rowById[id];
    if (existingRowNumber) {
      const existingStatus = String(
        sheet.getRange(existingRowNumber, 13).getValue() || ''
      ).toUpperCase();
      if (existingStatus === 'VERIFIED') {
        verified++;
        return;
      }
    }

    const response = obStrivenApiRequest_({
      path: OB.DIRECT_API.EMPLOYEE_DETAIL_PREFIX + encodeURIComponent(id),
      method: 'get'
    });
    apiCalls++;

    const employee = response.data;
    if (!employee || typeof employee !== 'object' || Array.isArray(employee)) {
      throw new Error('Employee ' + id + ' returned an invalid profile payload.');
    }
    if (String(employee.Id || employee.id || '').trim() !== id) {
      throw new Error('Employee profile ID mismatch for ' + id + '.');
    }

    const fullName = obEmployeeFullName_(employee) || repNameById[id] || '';
    const primaryEmail = obEmployeePrimaryEmail_(employee);
    const manager = employee.Manager || employee.manager || {};
    const division = employee.Division || employee.division || {};
    const location = employee.Location || employee.location || {};
    const jobTitle = employee.JobTitle || employee.jobTitle || {};

    let targetRow = rowById[id] || 0;
    if (!targetRow && fullName) {
      const candidates = rowsByName[obNorm_(fullName)] || [];
      if (candidates.length === 1) targetRow = candidates[0];
    }
    if (!targetRow) {
      targetRow = Math.max(sheet.getLastRow() + 1, 2);
      obEnsureRows_(sheet, targetRow);
    }

    const profileStatus = primaryEmail ? 'VERIFIED' : 'VERIFIED_NO_EMAIL';
    if (!primaryEmail) withoutEmail++;

    sheet.getRange(targetRow, 1, 1, 14).setValues([[
      id,
      (employee.EmployeeNumber == null && employee.employeeNumber == null)
        ? ''
        : String(employee.EmployeeNumber == null ? employee.employeeNumber : employee.EmployeeNumber),
      fullName,
      primaryEmail,
      (employee.Status === true || employee.status === true),
      (employee.SystemUser === true || employee.systemUser === true),
      division.Name || division.name || '',
      location.Name || location.name || '',
      jobTitle.Name || jobTitle.name || '',
      manager.Id || manager.id || '',
      manager.Name || manager.name || '',
      'GET /v1/employees/' + id,
      profileStatus,
      new Date()
    ]]);

    rowById[id] = targetRow;
    if (profileStatus === 'VERIFIED') verified++;
  });

  return {
    requested: employeeIds.length,
    verified: verified,
    withoutEmail: withoutEmail,
    apiCalls: apiCalls
  };
}

function obEmployeeFullName_(employee) {
  return [
    employee.Prefix || employee.prefix,
    employee.Firstname || employee.firstname || employee.firstName,
    employee.MiddleName || employee.middleName,
    employee.Lastname || employee.lastname || employee.lastName,
    employee.Suffix || employee.suffix
  ].map(function(value) {
    return String(value || '').trim();
  }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function obEmployeePrimaryEmail_(employee) {
  const emails = Array.isArray(employee.Emails)
    ? employee.Emails
    : (Array.isArray(employee.emails) ? employee.emails : []);

  const usable = emails.filter(function(item) {
    return item && String(item.Email || item.email || '').trim();
  });

  const ordered = [
    usable.filter(function(item) {
      return item.Active === true && item.IsPrimary === true;
    }),
    usable.filter(function(item) {
      return item.IsPrimary === true;
    }),
    usable.filter(function(item) {
      return item.Active === true;
    }),
    usable
  ];

  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].length) {
      return String(ordered[i][0].Email || ordered[i][0].email || '').trim();
    }
  }
  return '';
}

function obFetchReport_() {
  const url = obGetReportUrl_();
  if (!url) {
    throw new Error('Open Balance report URL is not configured.');
  }
  if (!/^https:\/\/api\.striven\.com\/v2\/reports\//i.test(url)) {
    throw new Error('Stored open-balance report URL is not an expected Striven v2 report URL.');
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Accept: 'application/json' }
  });
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error('Striven report HTTP ' + status + ': ' + response.getContentText().slice(0, 500));
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (err) {
    throw new Error('Striven report did not return valid JSON.');
  }

  if (!parsed || !Array.isArray(parsed.data)) {
    throw new Error('Unexpected Striven report shape: expected an object with data[].');
  }
  if (parsed.nextPage) {
    throw new Error('Report pagination is present but not yet explicitly validated. Privacy stop instead of guessing pagination semantics.');
  }

  const rows = parsed.data;
  const fields = rows.length ? Object.keys(rows[0]) : [];
  return { rows: rows, fields: fields, totalRecords: Number(parsed.totalRecords || rows.length) };
}

function obReadControl_(ss) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.CONTROL);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('OPEN_BALANCE_CONTROL has no settings.');
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const out = {};
  values.forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) out[key] = row[1];
  });
  return out;
}

function obSetControlValue_(ss, key, value) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.CONTROL);
  const lastRow = sheet.getLastRow();
  const keys = sheet.getRange(1, 1, Math.max(lastRow, 1), 1).getValues().flat();
  const index = keys.findIndex(v => String(v || '').trim() === key);
  if (index < 0) throw new Error('Control setting not found: ' + key);
  sheet.getRange(index + 1, 2).setValue(value);
}

function obReadRepConfig_(ss, readyOnly) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.REPS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const reps = [];
  values.forEach((row, idx) => {
    const enabled = row[0] === true;
    if (!enabled) return;
    const status = String(row[6] || '').trim().toUpperCase();
    if (readyOnly && status !== 'READY') return;

    const rep = {
      rowNumber: idx + 2,
      key: String(row[1] || '').trim(),
      name: String(row[2] || '').trim(),
      email: String(row[3] || '').trim(),
      sourceOwnerValue: String(row[4] || '').trim(),
      status: status,
      notes: String(row[7] || '').trim()
    };

    if (!rep.key || !rep.name || !rep.email || !rep.sourceOwnerValue) {
      throw new Error('Enabled rep config row ' + rep.rowNumber + ' is incomplete.');
    }
    obValidateSingleEmail_(rep.email);
    reps.push(rep);
  });
  return reps;
}

function obBuildRepMap_(reps) {
  const map = {};
  const repKeys = new Set();
  const emails = new Set();

  reps.forEach(rep => {
    const ownerKey = obNorm_(rep.sourceOwnerValue);
    if (!ownerKey) throw new Error('Blank Source Owner Value for rep ' + rep.name + '.');
    if (map[ownerKey]) throw new Error('Duplicate Source Owner Value in rep config: ' + rep.sourceOwnerValue);
    if (repKeys.has(obNorm_(rep.key))) throw new Error('Duplicate Rep Key in rep config: ' + rep.key);
    if (emails.has(rep.email.toLowerCase())) throw new Error('Duplicate production recipient email in rep config: ' + rep.email);
    map[ownerKey] = rep;
    repKeys.add(obNorm_(rep.key));
    emails.add(rep.email.toLowerCase());
  });

  return map;
}

function obRouteRows_(sourceRows, ownerField, repByOwner, runId) {
  const groups = {};
  const stagingRows = [];
  const exceptions = [];
  let routedCount = 0;
  const fetchedAt = new Date();

  sourceRows.forEach(row => {
    const ownerRaw = row[ownerField];
    const ownerNormalized = obNorm_(ownerRaw);
    const rep = ownerNormalized ? repByOwner[ownerNormalized] : null;
    const hash = obHash_(JSON.stringify(row));

    if (!ownerNormalized) {
      exceptions.push(obExceptionRow_(runId, row, 'MISSING_OWNER', 'Owner field ' + ownerField + ' is blank.'));
      stagingRows.push(obStagingRow_(runId, fetchedAt, '', row, 'BLOCKED_MISSING_OWNER', hash));
      return;
    }
    if (!rep) {
      exceptions.push(obExceptionRow_(runId, row, 'OWNER_NOT_CONFIGURED', 'No enabled READY rep config matches owner value: ' + ownerRaw));
      stagingRows.push(obStagingRow_(runId, fetchedAt, '', row, 'BLOCKED_OWNER_NOT_CONFIGURED', hash));
      return;
    }

    if (!groups[rep.key]) groups[rep.key] = { rep: rep, rows: [] };
    groups[rep.key].rows.push(row);
    stagingRows.push(obStagingRow_(runId, fetchedAt, rep.key, row, 'ROUTED', hash));
    routedCount++;
  });

  return { groups: groups, stagingRows: stagingRows, exceptions: exceptions, routedCount: routedCount };
}

function obAssertGroupIsolation_(rep, rows, ownerField) {
  if (!rows.length) throw new Error('Refusing to send empty group for ' + rep.name + '.');
  const expected = obNorm_(rep.sourceOwnerValue);
  for (const row of rows) {
    const actual = obNorm_(row[ownerField]);
    if (actual !== expected) {
      throw new Error('Privacy invariant failed for ' + rep.name + ': row owner ' + row[ownerField] + ' does not equal configured owner ' + rep.sourceOwnerValue + '.');
    }
  }
}

function obReplaceStaging_(ss, rows) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.DATA);
  const maxRows = sheet.getMaxRows();
  if (maxRows > 1) sheet.getRange(2, 1, maxRows - 1, 15).clearContent();
  if (!rows.length) return;
  obEnsureRows_(sheet, rows.length + 1);
  sheet.getRange(2, 1, rows.length, 15).setValues(rows);
}

function obAppendException_(ss, row) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.EXCEPTIONS);
  sheet.appendRow(row);
}

function obAppendSendLog_(ss, row) {
  const sheet = obRequireSheet_(ss, OB.SHEETS.SEND_LOG);
  sheet.appendRow(row);
}

function obStagingRow_(runId, fetchedAt, repKey, row, routingStatus, hash) {
  return [
    runId,
    fetchedAt,
    repKey,
    row.CustomerNumber == null ? '' : String(row.CustomerNumber),
    row.CustomerName == null ? '' : String(row.CustomerName),
    row.TransactionType == null ? '' : String(row.TransactionType),
    row.TransactionNumber == null ? '' : String(row.TransactionNumber),
    obToNumber_(row.TransactionAmount),
    row.TransactionDate == null ? '' : String(row.TransactionDate),
    obToNumber_(row.OpenBalance),
    row.CreatedBy == null ? '' : String(row.CreatedBy),
    row.CreatedOn == null ? '' : String(row.CreatedOn),
    row.TransactionMemo == null ? '' : String(row.TransactionMemo),
    routingStatus,
    hash
  ];
}

function obExceptionRow_(runId, row, reason, details) {
  return [
    runId,
    new Date(),
    reason,
    row.CustomerNumber == null ? '' : String(row.CustomerNumber),
    row.CustomerName == null ? '' : String(row.CustomerName),
    row.TransactionType == null ? '' : String(row.TransactionType),
    row.TransactionNumber == null ? '' : String(row.TransactionNumber),
    row.CreatedBy == null ? '' : String(row.CreatedBy),
    obToNumber_(row.OpenBalance),
    details,
    'BLOCKED'
  ];
}

function obBuildEmailHtml_(rep, rows, total, mode, timezone) {
  const tz = String(timezone || 'America/Toronto');
  const reportDate = Utilities.formatDate(new Date(), tz, 'MMMM d, yyyy');
  const summary = obBuildRepFinancialSummary_(rows);
  const aging = obBuildInvoiceAging_(rows, tz);
  const firstName = String(rep.name || '').trim().split(/\s+/)[0] || 'there';

  const banner = mode === 'TEST'
    ? '<div style="background:#fff7e8;border:1px solid #d9b875;border-left:4px solid #b56b32;padding:11px 14px;margin-bottom:14px;font-size:12px;line-height:1.5;border-radius:3px;">' +
        '<strong>TEST MODE</strong><br>' +
        'Intended Sales Rep: <strong>' + obHtml_(rep.name) + '</strong><br>' +
        'Delivered to the configured admin test recipient.' +
      '</div>'
    : '';

  const netTitle = summary.netPosition < 0
    ? 'NET CREDIT POSITION'
    : 'NET RECEIVABLE POSITION';
  const netWord = summary.netPosition < 0 ? 'CREDIT' : 'OWING';
  const netAmount = obMoney_(Math.abs(summary.netPosition));

  let agingHtml = '';
  if (aging.available) {
    const bucket = function(label, amount, bg, fg) {
      return '<td style="width:20%;padding:12px 7px;text-align:center;background:' + bg + ';border:1px solid #dedbd5;">' +
        '<div style="font-size:10px;color:' + fg + ';margin-bottom:5px;text-transform:uppercase;">' + obHtml_(label) + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:#272727;">' + obMoney_(amount) + '</div>' +
      '</td>';
    };
    agingHtml =
      '<div style="font-size:11px;font-weight:700;color:#55504b;text-transform:uppercase;letter-spacing:.8px;margin:0 0 8px;">Open Invoice Aging</div>' +
      '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:12px;"><tr>' +
        bucket('Current', aging.current, '#f4f2ee', '#77716a') +
        bucket('1–30 Days', aging.days1to30, '#fbf6eb', '#8d7047') +
        bucket('31–60 Days', aging.days31to60, '#faf0e8', '#a76035') +
        bucket('61–90 Days', aging.days61to90, '#f8ece7', '#9d5238') +
        bucket('90+ Days', aging.days90plus, '#f7e8e4', '#94412f') +
      '</tr></table>';
  } else {
    agingHtml =
      '<div style="border:1px solid #e2ddd6;background:#faf9f7;padding:12px 14px;margin-bottom:22px;font-size:12px;color:#6c6761;line-height:1.5;">' +
        '<strong>Open Invoice Aging</strong><br>' +
        'Aging will display here once invoice Due Date is available from Striven. Transaction Date is not used as a substitute.' +
      '</div>';
  }

  const attachmentName =
    'Open Balance Report - ' + rep.name + ' - ' +
    Utilities.formatDate(new Date(), tz, 'MMM d, yyyy') + '.xlsx';

  return '<div style="margin:0;padding:0;background:#f3f1ed;font-family:Arial,Helvetica,sans-serif;color:#272727;">' +
    '<div style="max-width:700px;margin:0 auto;padding:28px 16px;">' +
      banner +
      '<div style="background:#ffffff;border:1px solid #dedbd5;border-radius:6px;overflow:hidden;">' +

        '<div style="background:#272727;padding:22px 26px;border-bottom:5px solid #a44932;">' +
          '<div style="font-size:12px;color:#d8d4cd;text-transform:uppercase;letter-spacing:1.1px;margin-bottom:6px;">Classic Fireplace &amp; BBQ Store</div>' +
          '<div style="font-size:25px;font-weight:600;color:#ffffff;line-height:1.2;">Accounts Receivable</div>' +
          '<div style="font-size:14px;color:#ddd8d1;margin-top:5px;">Your Open Balance Report</div>' +
        '</div>' +

        '<div style="padding:26px;">' +
          '<p style="margin:0 0 17px;font-size:15px;">Hi ' + obHtml_(firstName) + ',</p>' +
          '<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3b3b3b;">' +
            'Attached is your current Open Balance Report showing your customers\' outstanding invoices, deposits and credits.' +
          '</p>' +

          '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px;"><tr>' +
            '<td style="width:50%;padding:16px;background:#f7f3ee;border:1px solid #dedbd5;">' +
              '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#77716a;margin-bottom:5px;">Open Invoices</div>' +
              '<div style="font-size:24px;font-weight:700;color:#272727;">' + obMoney_(summary.openInvoices) + '</div>' +
              '<div style="font-size:11px;color:#77716a;margin-top:5px;">' + summary.invoiceCount + ' open invoice' + (summary.invoiceCount === 1 ? '' : 's') + '</div>' +
            '</td>' +
            '<td style="width:50%;padding:16px;background:#f4f2ee;border:1px solid #dedbd5;">' +
              '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#77716a;margin-bottom:5px;">Customer Deposits / Credits</div>' +
              '<div style="font-size:24px;font-weight:700;color:#272727;">' + obMoney_(summary.customerCredits) + '</div>' +
              '<div style="font-size:11px;color:#77716a;margin-top:5px;">' + summary.creditCount + ' deposit' + (summary.creditCount === 1 ? '' : 's') + ' / credit' + (summary.creditCount === 1 ? '' : 's') + '</div>' +
            '</td>' +
          '</tr></table>' +

          '<div style="background:#f7f3ee;border-left:5px solid #a44932;padding:17px 20px;margin-bottom:22px;">' +
            '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.9px;color:#77716a;margin-bottom:5px;">' + netTitle + '</div>' +
            '<div style="font-size:28px;font-weight:700;color:#272727;">' + netAmount + ' <span style="font-size:15px;">' + netWord + '</span></div>' +
            '<div style="font-size:11px;color:#77716a;margin-top:6px;">Across ' + summary.customerCount + ' customer' + (summary.customerCount === 1 ? '' : 's') + '</div>' +
          '</div>' +

          agingHtml +

          '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:22px;font-size:13px;">' +
            '<tr><td style="padding:9px 0;border-bottom:1px solid #ebe8e3;color:#77716a;width:50%;">Sales Representative</td>' +
                '<td style="padding:9px 0;border-bottom:1px solid #ebe8e3;font-weight:600;">' + obHtml_(rep.name) + '</td></tr>' +
            '<tr><td style="padding:9px 0;border-bottom:1px solid #ebe8e3;color:#77716a;">Customers</td>' +
                '<td style="padding:9px 0;border-bottom:1px solid #ebe8e3;font-weight:600;">' + summary.customerCount + '</td></tr>' +
            '<tr><td style="padding:9px 0;border-bottom:1px solid #ebe8e3;color:#77716a;">Open Invoices</td>' +
                '<td style="padding:9px 0;border-bottom:1px solid #ebe8e3;font-weight:600;">' + summary.invoiceCount + '</td></tr>' +
            '<tr><td style="padding:9px 0;border-bottom:1px solid #ebe8e3;color:#77716a;">Report Date</td>' +
                '<td style="padding:9px 0;border-bottom:1px solid #ebe8e3;font-weight:600;">' + obHtml_(reportDate) + '</td></tr>' +
          '</table>' +

          '<div style="border:1px solid #d8d4ce;background:#faf9f7;padding:15px 16px;border-radius:4px;margin-bottom:21px;">' +
            '<div style="font-size:10px;font-weight:700;color:#a44932;text-transform:uppercase;letter-spacing:.9px;margin-bottom:6px;">Attached Report</div>' +
            '<div style="font-size:14px;font-weight:600;color:#292929;">' + obHtml_(attachmentName) + '</div>' +
            '<div style="font-size:12px;color:#77716a;margin-top:5px;">Customer-level details for open invoices, deposits and credits.</div>' +
          '</div>' +

          '<div style="border-top:1px solid #ebe8e3;padding-top:17px;font-size:14px;line-height:1.55;color:#44413e;">' +
            'Please review the attached customer-level detail for any balances, deposits or credits that appear incorrect or require follow-up.' +
          '</div>' +

          '<p style="margin:25px 0 0;font-size:14px;line-height:1.55;">Regards,<br><strong>Classic Fireplace &amp; BBQ Store</strong><br>' +
            '<span style="color:#77716a;">Accounts Receivable</span></p>' +
        '</div>' +
      '</div>' +

      '<div style="text-align:center;padding:14px 12px;font-size:10px;color:#8b8781;line-height:1.5;">' +
        '<strong>Confidential</strong> — This report contains customer financial information and is intended only for the named Sales Representative.' +
      '</div>' +
    '</div>' +
  '</div>';
}

function obBuildEmailText_(rep, rows, total, mode, timezone) {
  const tz = String(timezone || 'America/Toronto');
  const summary = obBuildRepFinancialSummary_(rows);
  const aging = obBuildInvoiceAging_(rows, tz);
  const firstName = String(rep.name || '').trim().split(/\s+/)[0] || 'there';
  const prefix = mode === 'TEST'
    ? 'TEST MODE — Intended for ' + rep.name + '\n\n'
    : '';

  const netLabel = summary.netPosition < 0
    ? 'Net Credit Position'
    : 'Net Receivable Position';
  const netWord = summary.netPosition < 0 ? 'CREDIT' : 'OWING';

  let agingText = 'Open Invoice Aging: Due Date enrichment pending.';
  if (aging.available) {
    agingText =
      'Open Invoice Aging:\n' +
      'Current: ' + obMoney_(aging.current) + '\n' +
      '1–30 Days: ' + obMoney_(aging.days1to30) + '\n' +
      '31–60 Days: ' + obMoney_(aging.days31to60) + '\n' +
      '61–90 Days: ' + obMoney_(aging.days61to90) + '\n' +
      '90+ Days: ' + obMoney_(aging.days90plus);
  }

  return prefix +
    'Accounts Receivable — Your Open Balance Report\n\n' +
    'Hi ' + firstName + ',\n\n' +
    'Attached is your current Open Balance Report showing your customers\' outstanding invoices, deposits and credits.\n\n' +
    'Open Invoices: ' + obMoney_(summary.openInvoices) + ' (' + summary.invoiceCount + ')\n' +
    'Customer Deposits / Credits: ' + obMoney_(summary.customerCredits) + ' (' + summary.creditCount + ')\n' +
    netLabel + ': ' + obMoney_(Math.abs(summary.netPosition)) + ' ' + netWord + '\n' +
    'Customers: ' + summary.customerCount + '\n\n' +
    agingText + '\n\n' +
    'Please review the attached customer-level detail for any balances, deposits or credits that appear incorrect or require follow-up.\n\n' +
    'Regards,\nClassic Fireplace & BBQ Store\nAccounts Receivable';
}

function obBuildRepFinancialSummary_(rows) {
  const seenCustomers = Object.create(null);
  let invoiceCount = 0;
  let creditCount = 0;
  let openInvoices = 0;
  let customerCredits = 0;

  rows.forEach(function(row) {
    const customerKey = String(row.CustomerNumber || row.CustomerName || '').trim();
    if (customerKey) seenCustomers[customerKey] = true;

    const type = String(row.TransactionType || '').trim().toUpperCase();
    const open = obToNumber_(row.OpenBalance);

    if (type === 'INVOICE') {
      invoiceCount++;
      if (open > 0) openInvoices += open;
      return;
    }

    if (
      type === 'PAYMENT' ||
      type === 'CREDIT MEMO' ||
      type === 'CREDITMEMO'
    ) {
      creditCount++;
      customerCredits += Math.abs(open);
    }
  });

  return {
    invoiceCount: invoiceCount,
    creditCount: creditCount,
    customerCount: Object.keys(seenCustomers).length,
    openInvoices: openInvoices,
    customerCredits: customerCredits,
    netPosition: openInvoices - customerCredits
  };
}

function obBuildInvoiceAging_(rows, timezone) {
  const todayText = Utilities.formatDate(new Date(), String(timezone), 'yyyy-MM-dd');
  const today = new Date(todayText + 'T00:00:00');
  const out = {
    available: false,
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    days90plus: 0
  };

  rows.forEach(function(row) {
    const type = String(row.TransactionType || '').trim().toUpperCase();
    if (type !== 'INVOICE') return;

    const open = obToNumber_(row.OpenBalance);
    if (open <= 0) return;

    const dueRaw =
      row.DueDate ||
      row['Due Date'] ||
      row.InvoiceDueDate ||
      row['Invoice Due Date'];

    if (!dueRaw) return;

    const due = obParseDate_(dueRaw);
    if (!due) return;

    out.available = true;
    const daysPastDue = Math.floor((today.getTime() - due.getTime()) / 86400000);

    if (daysPastDue <= 0) out.current += open;
    else if (daysPastDue <= 30) out.days1to30 += open;
    else if (daysPastDue <= 60) out.days31to60 += open;
    else if (daysPastDue <= 90) out.days61to90 += open;
    else out.days90plus += open;
  });

  return out;
}

function obParseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value || '').trim();
  if (!text) return null;

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function obCheckConfigurationReadiness_(ss, control) {
  if (control.OWNER_FIELD_PRESENT !== true) return { ready: false, reason: 'OWNER_FIELD_PRESENT is FALSE.' };
  const reps = obReadRepConfig_(ss, true);
  if (!reps.length) return { ready: false, reason: 'No enabled READY reps are configured.' };
  obBuildRepMap_(reps);
  if (!obGetReportUrl_()) {
    return { ready: false, reason: 'Striven report URL is missing.' };
  }
  return { ready: true };
}

function obDeleteDistributionTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === OB.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

function obDeleteRefreshTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === OB.REFRESH_TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

function obGetReportUrl_() {
  const scriptValue = String(
    PropertiesService.getScriptProperties().getProperty(OB.REPORT_URL_PROPERTY) || ''
  ).trim();
  if (scriptValue) return scriptValue;

  const ss = SpreadsheetApp.openById(OB.SPREADSHEET_ID);
  const sh = ss.getSheetByName(OB.PRIVATE_CONFIG_SHEET);
  if (!sh || sh.getLastRow() < 2) return '';

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (const row of rows) {
    if (String(row[0] || '').trim() === OB.REPORT_URL_PROPERTY) {
      return String(row[1] || '').trim();
    }
  }
  return '';
}

function obWriteRawSnapshot_(ss, rows, ownerField) {
  const fetchedAt = new Date();
  const runId = 'REFRESH-' + Utilities.formatDate(
    fetchedAt,
    Session.getScriptTimeZone() || 'America/Toronto',
    'yyyyMMdd-HHmmss'
  );

  const stagingRows = rows.map(row => obStagingRow_(
    runId,
    fetchedAt,
    '',
    row,
    ownerField ? 'REFRESHED_PENDING_ROUTING' : 'REFRESHED_PENDING_OWNER_FIELD',
    obHash_(JSON.stringify(row))
  ));

  obReplaceStaging_(ss, stagingRows);
}

function obRecordRefresh_(ss, rowCount, status) {
  obSetControlValue_(ss, 'LAST_REFRESH_AT', new Date());
  obSetControlValue_(ss, 'LAST_REFRESH_ROWS', rowCount);
  obSetControlValue_(ss, 'LAST_REFRESH_STATUS', status);
}

function obFindField_(fields, requested) {
  const target = obFieldNorm_(requested);
  return fields.find(f => obFieldNorm_(f) === target) || null;
}

function obFieldNorm_(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function obNorm_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function obToNumber_(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function obHash_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function obValidateSingleEmail_(value) {
  const email = String(value || '').trim();
  if (!email) throw new Error('Email is required.');
  if (/[;,\s].*@|[,;]/.test(email) || !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(email)) {
    throw new Error('Exactly one valid email address is required: ' + email);
  }
  return email;
}

function obRequireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Required sheet not found: ' + name);
  return sheet;
}

function obEnsureRows_(sheet, requiredRows) {
  const current = sheet.getMaxRows();
  if (requiredRows > current) sheet.insertRowsAfter(current, requiredRows - current);
}

function obMoney_(value) {
  const n = obToNumber_(value);
  return n.toLocaleString('en-CA', { style: 'currency', currency: OB.CURRENCY });
}

function obHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * ---------------------------------------------------------------------------
 * CONTROLLED TEST ONLY — 10-minute / 3-run email trial
 * ---------------------------------------------------------------------------
 * This path is intentionally isolated from production Sales Rep routing.
 *
 * Test-only ownership:
 * - Uses Striven report CreatedBy solely to reproduce the user's controlled
 *   employee/location test.
 * - CreatedBy MUST NOT be reused by production distribution.
 *
 * Delivery safety:
 * - Hard-coded single recipient: pramodh@classicfireplace.ca
 * - No CC/BCC.
 * - No attachment.
 * - Grouped locations remain one email, but each employee gets a separate
 *   summary, A/R aging section, and transaction table.
 * - No Net Open Balance / Net Deposits.
 * - No totals row at the bottom of transaction tables.
 * - Trigger removes itself after 3 attempted executions.
 */
const OB_CONTROLLED_TEST_10M = Object.freeze({
  TRIGGER_FUNCTION: "runOpenBalanceControlledTest10Min",
  COUNT_PROPERTY: "OB_CONTROLLED_TEST_10M_RUN_COUNT",
  RECIPIENT: "pramodh@classicfireplace.ca",
  INTERVAL_MINUTES: 10,
  MAX_RUNS: 3,
  GROUPS: Object.freeze([
    Object.freeze({
      label: "Steve Trevor + Colleen Trevor",
      members: Object.freeze(["Steve Trevor", "Colleen Trevor"])
    }),
    Object.freeze({
      label: "Matthew McLean + Karen Genis",
      members: Object.freeze(["Matthew McLean", "Karen Genis"])
    }),
    Object.freeze({
      label: "Spencer Bambek + Doug Crann",
      members: Object.freeze(["Spencer Bambek", "Doug Crann"])
    }),
    Object.freeze({
      label: "Trevor Burke + Karen Goldman + Clara Lam",
      members: Object.freeze(["Trevor Burke", "Karen Goldman", "Clara Lam"])
    })
  ])
});

/**
 * Run this ONCE from the bound Apps Script project to start the test.
 * The first trigger execution occurs on Apps Script's 10-minute cadence.
 */
function installOpenBalanceControlledTest10Min3Runs() {
  if (!obGetReportUrl_()) {
    throw new Error("Controlled test not installed: Striven Open Balance report URL is missing.");
  }

  obDeleteControlledTest10MinTriggers_();

  const props = PropertiesService.getScriptProperties();
  props.setProperty(OB_CONTROLLED_TEST_10M.COUNT_PROPERTY, "0");

  const trigger = ScriptApp.newTrigger(OB_CONTROLLED_TEST_10M.TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(OB_CONTROLLED_TEST_10M.INTERVAL_MINUTES)
    .create();

  const result = {
    ok: true,
    status: "CONTROLLED_TEST_SCHEDULED",
    recipient: OB_CONTROLLED_TEST_10M.RECIPIENT,
    intervalMinutes: OB_CONTROLLED_TEST_10M.INTERVAL_MINUTES,
    maxRuns: OB_CONTROLLED_TEST_10M.MAX_RUNS,
    completedRuns: 0,
    triggerId: trigger.getUniqueId()
  };

  console.log(JSON.stringify(result));
  return result;
}

/**
 * Trigger handler. Fetches a fresh Striven report on every run, builds all
 * messages in memory, then sends the controlled-test email set only to the
 * hard-coded admin recipient.
 */
function runOpenBalanceControlledTest10Min() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, status: "SKIPPED_LOCKED" };
  }

  const props = PropertiesService.getScriptProperties();
  let runNumber = Number(props.getProperty(OB_CONTROLLED_TEST_10M.COUNT_PROPERTY) || "0") + 1;

  try {
    if (runNumber > OB_CONTROLLED_TEST_10M.MAX_RUNS) {
      const removed = obDeleteControlledTest10MinTriggers_();
      return {
        ok: true,
        status: "CONTROLLED_TEST_ALREADY_COMPLETE",
        completedRuns: OB_CONTROLLED_TEST_10M.MAX_RUNS,
        removedTriggers: removed
      };
    }

    // Count the trigger attempt before any mail is sent so this trial can
    // never continue indefinitely after a downstream error.
    props.setProperty(OB_CONTROLLED_TEST_10M.COUNT_PROPERTY, String(runNumber));

    const report = obFetchReport_();
    if (!report || !Array.isArray(report.rows) || !report.rows.length) {
      throw new Error("Controlled test stopped: Striven Open Balance report returned no rows.");
    }

    const createdByField = obFindField_(report.fields || [], "CreatedBy");
    if (!createdByField) {
      throw new Error("Controlled test stopped: CreatedBy is missing from the Striven report.");
    }

    const normalizedRows = report.rows.map(function(row) {
      const copy = Object.assign({}, row);
      copy.__controlledTestCreatedBy = String(row[createdByField] == null ? "" : row[createdByField]).trim();
      return copy;
    });

    const missingOwner = normalizedRows.filter(function(row) {
      return !row.__controlledTestCreatedBy;
    });

    if (missingOwner.length) {
      throw new Error(
        "Controlled test stopped: " + missingOwner.length +
        " source row(s) have blank CreatedBy. No emails were sent."
      );
    }

    const messages = obBuildControlledTest10MinMessages_(normalizedRows, runNumber);
    const accountedRows = messages.reduce(function(sum, message) {
      return sum + message.rowCount;
    }, 0);

    if (accountedRows !== normalizedRows.length) {
      throw new Error(
        "Controlled test privacy/count stop: " + accountedRows +
        " grouped rows do not equal " + normalizedRows.length + " source rows."
      );
    }

    const sent = [];
    messages.forEach(function(message) {
      MailApp.sendEmail({
        to: OB_CONTROLLED_TEST_10M.RECIPIENT,
        subject: message.subject,
        body: message.textBody,
        htmlBody: message.htmlBody,
        name: OB.SENDER_NAME
      });

      sent.push({
        label: message.label,
        rows: message.rowCount
      });
    });

    const result = {
      ok: true,
      status: runNumber >= OB_CONTROLLED_TEST_10M.MAX_RUNS
        ? "CONTROLLED_TEST_COMPLETE"
        : "CONTROLLED_TEST_SENT",
      runNumber: runNumber,
      maxRuns: OB_CONTROLLED_TEST_10M.MAX_RUNS,
      recipient: OB_CONTROLLED_TEST_10M.RECIPIENT,
      sourceRows: normalizedRows.length,
      emailsSent: sent.length,
      groups: sent
    };

    console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      status: "CONTROLLED_TEST_FAILED",
      runNumber: runNumber,
      maxRuns: OB_CONTROLLED_TEST_10M.MAX_RUNS,
      recipient: OB_CONTROLLED_TEST_10M.RECIPIENT,
      error: String(err && err.message ? err.message : err)
    }));
    throw err;
  } finally {
    if (runNumber >= OB_CONTROLLED_TEST_10M.MAX_RUNS) {
      obDeleteControlledTest10MinTriggers_();
    }
    lock.releaseLock();
  }
}

/** Manual emergency stop for the 10-minute controlled test. */
function removeOpenBalanceControlledTest10Min3Runs() {
  const removed = obDeleteControlledTest10MinTriggers_();
  const props = PropertiesService.getScriptProperties();
  const completedRuns = Number(props.getProperty(OB_CONTROLLED_TEST_10M.COUNT_PROPERTY) || "0");
  return {
    ok: true,
    status: "CONTROLLED_TEST_STOPPED",
    removedTriggers: removed,
    completedRuns: completedRuns
  };
}

/** Read-only status helper for the controlled test. */
function openBalanceControlledTest10MinStatus() {
  const props = PropertiesService.getScriptProperties();
  const completedRuns = Number(props.getProperty(OB_CONTROLLED_TEST_10M.COUNT_PROPERTY) || "0");
  const triggerCount = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === OB_CONTROLLED_TEST_10M.TRIGGER_FUNCTION;
  }).length;

  return {
    recipient: OB_CONTROLLED_TEST_10M.RECIPIENT,
    intervalMinutes: OB_CONTROLLED_TEST_10M.INTERVAL_MINUTES,
    maxRuns: OB_CONTROLLED_TEST_10M.MAX_RUNS,
    completedRuns: completedRuns,
    remainingRuns: Math.max(0, OB_CONTROLLED_TEST_10M.MAX_RUNS - completedRuns),
    triggerCount: triggerCount,
    active: triggerCount > 0 && completedRuns < OB_CONTROLLED_TEST_10M.MAX_RUNS
  };
}

function obDeleteControlledTest10MinTriggers_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === OB_CONTROLLED_TEST_10M.TRIGGER_FUNCTION) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

function obBuildControlledTest10MinMessages_(rows, runNumber) {
  const byEmployee = Object.create(null);

  rows.forEach(function(row) {
    const employee = String(row.__controlledTestCreatedBy || "").trim();
    if (!byEmployee[employee]) byEmployee[employee] = [];
    byEmployee[employee].push(row);
  });

  const used = Object.create(null);
  const specs = [];

  OB_CONTROLLED_TEST_10M.GROUPS.forEach(function(group) {
    let rowCount = 0;
    group.members.forEach(function(name) {
      used[name] = true;
      rowCount += (byEmployee[name] || []).length;
    });

    if (rowCount > 0) {
      specs.push({
        label: group.label,
        members: group.members.slice(),
        rowCount: rowCount
      });
    }
  });

  Object.keys(byEmployee).sort().forEach(function(employee) {
    if (used[employee]) return;
    specs.push({
      label: employee,
      members: [employee],
      rowCount: byEmployee[employee].length
    });
  });

  const timezone = "America/Toronto";
  const reportDate = Utilities.formatDate(new Date(), timezone, "MMM d, yyyy");

  return specs.map(function(spec) {
    return {
      label: spec.label,
      rowCount: spec.rowCount,
      subject:
        "[CONTROLLED TEST " + runNumber + "/" + OB_CONTROLLED_TEST_10M.MAX_RUNS + "] " +
        "A/R Open Balance - " + spec.label + " - " + reportDate,
      htmlBody: obBuildControlledTest10MinHtml_(
        spec.label,
        spec.members,
        byEmployee,
        runNumber,
        timezone
      ),
      textBody: obBuildControlledTest10MinText_(
        spec.label,
        spec.members,
        byEmployee,
        runNumber,
        timezone
      )
    };
  });
}

function obBuildControlledTest10MinHtml_(label, members, byEmployee, runNumber, timezone) {
  const reportDate = Utilities.formatDate(new Date(), timezone, "MMMM d, yyyy");
  const sections = members.map(function(employee) {
    return obBuildControlledTestEmployeeHtml_(employee, byEmployee[employee] || [], timezone);
  }).join("");

  return "" +
    "<div style='font-family:Arial,Helvetica,sans-serif;color:#272727;max-width:1040px;margin:auto'>" +
      "<div style='background:#fff7e8;border-left:4px solid #b56b32;padding:12px;margin-bottom:14px;font-size:12px;line-height:1.5'>" +
        "<strong>CONTROLLED TEST " + runNumber + "/" + OB_CONTROLLED_TEST_10M.MAX_RUNS + "</strong><br>" +
        "Email group: <strong>" + obHtml_(label) + "</strong><br>" +
        "Delivered only to " + obHtml_(OB_CONTROLLED_TEST_10M.RECIPIENT) + "." +
      "</div>" +
      "<div style='background:#272727;color:#fff;padding:22px;border-bottom:5px solid #a44932'>" +
        "<div style='font-size:12px;color:#d8d4cd;text-transform:uppercase;letter-spacing:1px'>Classic Fireplace &amp; BBQ Store</div>" +
        "<div style='font-size:25px;font-weight:600;margin-top:5px'>A/R — Open Balance Report</div>" +
      "</div>" +
      "<div style='padding:24px;border:1px solid #dedbd5;background:#fff'>" +
        "<p style='margin-top:0'>Current open transactions as of <strong>" + obHtml_(reportDate) + "</strong>.</p>" +
        (members.length > 1
          ? "<p style='font-size:13px;color:#666'>Employees are grouped into one email for this location, but each employee remains in a separate table.</p>"
          : "") +
        sections +
        "<div style='font-size:10px;color:#777;margin:16px 0'>" +
          "<em>Controlled test: A/R Aging is calculated from Invoice Date. Production aging must use Striven Due Date once that field is enriched.</em>" +
        "</div>" +
        "<p>Please review the transactions above for any Open Balance or Open Payments that require follow-up.</p>" +
        "<p>Regards,<br><strong>Classic Fireplace &amp; BBQ Store</strong><br>Accounts Receivable</p>" +
      "</div>" +
      "<div style='font-size:10px;color:#888;text-align:center;padding:12px'>" +
        "<strong>Confidential</strong> — Controlled test. Delivered only to the admin test recipient." +
      "</div>" +
    "</div>";
}

function obBuildControlledTestEmployeeHtml_(employee, rows, timezone) {
  if (!rows.length) {
    return "" +
      "<div style='margin:28px 0 34px'>" +
        "<div style='font-size:19px;font-weight:700;border-bottom:3px solid #a44932;padding-bottom:7px;margin-bottom:12px'>" +
          obHtml_(employee) +
        "</div>" +
        "<div style='padding:16px;border:1px solid #dedbd5;background:#faf9f7;color:#777'>" +
          "No open transactions in this report." +
        "</div>" +
      "</div>";
  }

  const sorted = rows.slice().sort(function(a, b) {
    const aDate = obParseDate_(a.TransactionDate);
    const bDate = obParseDate_(b.TransactionDate);
    const aTime = aDate ? aDate.getTime() : 0;
    const bTime = bDate ? bDate.getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return String(a.CustomerName || "").localeCompare(String(b.CustomerName || ""));
  });

  const summary = obBuildControlledTestEmployeeSummary_(sorted);
  const aging = obBuildControlledTestInvoiceDateAging_(sorted, timezone);

  const transactionRows = sorted.map(function(row, index) {
    const customerNumber = String(row.CustomerNumber == null ? "" : row.CustomerNumber);
    const customerUrl =
      "https://classicfireplace.striven.com/CRM/AccountDashboard.aspx?AccountID=" +
      encodeURIComponent(customerNumber);
    const bg = index % 2 === 0 ? "#ffffff" : "#faf9f7";

    return "" +
      "<tr style='background:" + bg + "'>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;white-space:nowrap'>" +
          "<a href='" + customerUrl + "' style='color:#7b3f2e;text-decoration:underline;font-weight:600'>" +
            obHtml_(customerNumber) +
          "</a>" +
        "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df'>" + obHtml_(row.CustomerName) + "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;white-space:nowrap'>" + obHtml_(row.TransactionType) + "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;white-space:nowrap'>" + obHtml_(row.TransactionNumber) + "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;white-space:nowrap'>" + obHtml_(row.TransactionDate) + "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;text-align:right;white-space:nowrap'>" +
          obMoney_(row.TransactionAmount) +
        "</td>" +
        "<td style='padding:7px;border-bottom:1px solid #e8e5df;text-align:right;white-space:nowrap;font-weight:600'>" +
          obMoney_(row.OpenBalance) +
        "</td>" +
      "</tr>";
  }).join("");

  return "" +
    "<div style='margin:28px 0 34px'>" +
      "<div style='font-size:19px;font-weight:700;border-bottom:3px solid #a44932;padding-bottom:7px;margin-bottom:12px'>" +
        obHtml_(employee) +
      "</div>" +
      "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse;margin-bottom:12px'>" +
        "<tr>" +
          "<td style='padding:12px;background:#f7f3ee;border:1px solid #ddd'>" +
            "<div style='font-size:10px;color:#777;text-transform:uppercase'>Open Balance</div>" +
            "<div style='font-size:20px;font-weight:bold'>" + obMoney_(summary.openBalance) + "</div>" +
            "<div style='font-size:11px;color:#777'>" + summary.invoiceCount + " Invoices</div>" +
          "</td>" +
          "<td style='padding:12px;background:#f4f2ee;border:1px solid #ddd'>" +
            "<div style='font-size:10px;color:#777;text-transform:uppercase'>Open Payments</div>" +
            "<div style='font-size:20px;font-weight:bold'>" + obMoney_(summary.openPayments) + "</div>" +
            "<div style='font-size:11px;color:#777'>" + summary.paymentCount + " Payments</div>" +
          "</td>" +
          "<td style='padding:12px;background:#f7f3ee;border:1px solid #ddd'>" +
            "<div style='font-size:10px;color:#777;text-transform:uppercase'>Transactions</div>" +
            "<div style='font-size:20px;font-weight:bold'>" + sorted.length + "</div>" +
          "</td>" +
        "</tr>" +
      "</table>" +
      "<div style='font-size:10px;font-weight:bold;color:#555;text-transform:uppercase;margin-bottom:6px'>A/R Aging</div>" +
      "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse;text-align:center;font-size:11px;margin-bottom:12px'>" +
        "<tr>" +
          obControlledTestAgingCell_("Current", aging.current) +
          obControlledTestAgingCell_("1–30 Days", aging.days1to30) +
          obControlledTestAgingCell_("31–60 Days", aging.days31to60) +
          obControlledTestAgingCell_("61–89 Days", aging.days61to89) +
          obControlledTestAgingCell_("90+ Days", aging.days90plus) +
        "</tr>" +
      "</table>" +
      "<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse;font-size:10.5px'>" +
        "<thead><tr style='background:#272727;color:#fff'>" +
          "<th style='padding:8px;text-align:left'>Customer #</th>" +
          "<th style='padding:8px;text-align:left'>Customer</th>" +
          "<th style='padding:8px;text-align:left'>Type</th>" +
          "<th style='padding:8px;text-align:left'>Transaction #</th>" +
          "<th style='padding:8px;text-align:left'>Date</th>" +
          "<th style='padding:8px;text-align:right'>Transaction Amount</th>" +
          "<th style='padding:8px;text-align:right'>Open Balance</th>" +
        "</tr></thead>" +
        "<tbody>" + transactionRows + "</tbody>" +
      "</table>" +
    "</div>";
}

function obControlledTestAgingCell_(label, amount) {
  return "" +
    "<td style='padding:8px;border:1px solid #ddd'>" +
      obHtml_(label) + "<br><b>" + obMoney_(amount) + "</b>" +
    "</td>";
}

function obBuildControlledTestEmployeeSummary_(rows) {
  let invoiceCount = 0;
  let paymentCount = 0;
  let openBalance = 0;
  let openPayments = 0;

  rows.forEach(function(row) {
    const type = String(row.TransactionType || "").trim().toUpperCase();
    const open = obToNumber_(row.OpenBalance);

    if (type === "INVOICE") {
      invoiceCount++;
      if (open > 0) openBalance += open;
      return;
    }

    if (type === "PAYMENT") {
      paymentCount++;
      openPayments += open;
    }
  });

  return {
    invoiceCount: invoiceCount,
    paymentCount: paymentCount,
    openBalance: openBalance,
    openPayments: openPayments
  };
}

function obBuildControlledTestInvoiceDateAging_(rows, timezone) {
  const todayText = Utilities.formatDate(new Date(), String(timezone || "America/Toronto"), "yyyy-MM-dd");
  const today = new Date(todayText + "T00:00:00");
  const out = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to89: 0,
    days90plus: 0
  };

  rows.forEach(function(row) {
    if (String(row.TransactionType || "").trim().toUpperCase() !== "INVOICE") return;

    const open = obToNumber_(row.OpenBalance);
    if (open <= 0) return;

    const invoiceDate = obParseDate_(row.TransactionDate);
    if (!invoiceDate) return;

    const ageDays = Math.floor((today.getTime() - invoiceDate.getTime()) / 86400000);

    if (ageDays <= 0) out.current += open;
    else if (ageDays <= 30) out.days1to30 += open;
    else if (ageDays <= 60) out.days31to60 += open;
    else if (ageDays < 90) out.days61to89 += open;
    else out.days90plus += open;
  });

  return out;
}

function obBuildControlledTest10MinText_(label, members, byEmployee, runNumber, timezone) {
  const reportDate = Utilities.formatDate(new Date(), timezone, "MMMM d, yyyy");
  const lines = [
    "CONTROLLED TEST " + runNumber + "/" + OB_CONTROLLED_TEST_10M.MAX_RUNS,
    "A/R — Open Balance Report",
    "Email group: " + label,
    "Report Date: " + reportDate,
    "Delivered only to " + OB_CONTROLLED_TEST_10M.RECIPIENT,
    ""
  ];

  members.forEach(function(employee) {
    const rows = byEmployee[employee] || [];
    lines.push(employee);

    if (!rows.length) {
      lines.push("No open transactions in this report.", "");
      return;
    }

    const summary = obBuildControlledTestEmployeeSummary_(rows);
    lines.push(
      "Open Balance: " + obMoney_(summary.openBalance),
      "Open Payments: " + obMoney_(summary.openPayments),
      "Transactions: " + rows.length,
      "Full transaction table is included in the HTML email.",
      ""
    );
  });

  lines.push(
    "Controlled test: A/R Aging is calculated from Invoice Date.",
    "Production aging must use Striven Due Date once that field is enriched."
  );

  return lines.join("\n");
}
