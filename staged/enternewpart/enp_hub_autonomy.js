/** Google Apps Script — Hub-backed automatic intake + manual request coordinator.
 * Appended to the existing 98_enp_item_resolution_guard file.
 * This release intentionally performs NO Striven business writes.
 * Unverified metadata and uncertain write outcomes remain blocking states.
 */
var ENP_HUB_AUTONOMY_R1 = 'ENP_HUB_COORDINATOR_R1_20261019';
var ENP_HUB_BOOK_ID_ = '13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU';
var ENP_HUB_SOURCE_ID_ = '123UZI5PmARY_2F57ABckpGBjiKVwCg4uE-QSoQCO2bU';

function enpHubHeaderMap_(headers) {
  var out = {};
  headers.forEach(function(h, i) {
    h = String(h || '').trim();
    if (!h) return;
    if (Object.prototype.hasOwnProperty.call(out,h)) throw new Error('Duplicate header: '+h);
    out[h] = i;
  });
  return out;
}
function enpHubText_(v) { return String(v == null ? '' : v).trim(); }
function enpHubSku_(v) { return enpHubText_(v).toUpperCase(); }
function enpHubParse_(raw) {
  var s = enpHubText_(raw), out = {};
  ['Item Number','Item Name','Price'].forEach(function(k) {
    var m = s.match(new RegExp('^\\s*'+k+'\\s*:[ \\t]*([^\\r\\n]*)','im'));
    out[k] = m ? m[1].trim() : '';
  });
  var amount = out.Price.replace(/[$,\s]/g,'');
  return {sku:out['Item Number'],name:out['Item Name'],price:amount !== '' && /^\d+(\.\d{1,2})?$/.test(amount) ? Number(amount) : null};
}
function enpHubSourceKey_(row) {
  // A source fingerprint, not an authoritative Sales Order line identifier.
  return JSON.stringify([row.Source, String(row['SO Internal ID'] || ''), enpHubSku_(row['Item Number']), row.Quantity, row['Original Description'] || '', row['Source Row'] && row.Source === 'Manual' ? row['Source Row'] : '']);
}
function enpHubPlan_(row, catalog, fresh) {
  if (row['Workflow Status'] === 'DONE' || row['Workflow Status'] === 'SUPERSEDED') return {state:row['Workflow Status'],reason:'Terminal row; no replay.'};
  if (/price conflicts/i.test(String(row['Review Reason'] || ''))) return {state:'REVIEW',reason:'Source item price conflicts with original description.'};
  var manual = row['Create Authorized'] === true;
  if (!manual && row.Source !== 'Approved') return {state:'WAITING MANUAL REQUEST',reason:'Quoted/manual requests require column A.'};
  if (!enpHubSku_(row['Item Number']) || !enpHubText_(row['Item Name'])) return {state:'REVIEW',reason:'Missing product number or name.'};
  if (row.Source !== 'Manual' && !Number(row['SO Internal ID'])) return {state:'REVIEW',reason:'Missing internal Sales Order ID.'};
  if (!fresh) return {state:'WAITING DATA',reason:'Hub Items refresh is older than 24 hours or has no verified success timestamp.'};
  var found = catalog[enpHubSku_(row['Item Number'])] || [];
  if (found.length > 1) return {state:'REVIEW',reason:'Duplicate exact Hub SKU; cannot choose an Item ID.'};
  if (!found.length) return {state:'RESEARCH REQUIRED',reason:'No exact Hub SKU. Online evidence, cost basis, reference IDs and complete create payload must be verified. No catalog scan or POST attempted.'};
  if (row['Striven Item ID'] && Number(row['Striven Item ID']) !== Number(found[0].Id)) return {state:'REVIEW',reason:'Stored Item ID conflicts with unique Hub SKU.'};
  return {state:'READY FOR ITEM VERIFICATION',reason:'Unique Hub SKU found; remote identity and current SO line still need verification. Striven writes are not enabled in this coordinator release.',item:found[0]};
}
function enpHubReadTable_(sh) {
  if (!sh) throw new Error('Required sheet is missing.');
  var grid = sh.getDataRange().getValues();
  // Reference tables share the tab but are not operational item columns.
  var width = sh.getName() === 'ENTERNEWPART' ? 37 : grid[0].length;
  var headers = grid[0].slice(0,width).map(enpHubText_);
  var col = enpHubHeaderMap_(headers);
  var rows = grid.slice(1).map(function(r){var obj={};headers.forEach(function(h,i){if(h)obj[h]=r[i];});return obj;});
  return {sheet:sh,grid:grid,headers:headers,col:col,rows:rows};
}
function enpHubSourceRecords_(sourceBook) {
  var out=[];
  [['Enternewpart','Approved'],['Enternewpart_Quoted','Quoted'],['Manual ItemCreation','Manual']].forEach(function(pair){
    var t=enpHubReadTable_(sourceBook.getSheetByName(pair[0]));
    t.rows.forEach(function(d,i){
      if (!Object.keys(d).some(function(k){return d[k]!=='' && d[k]!=null;})) return;
      var manual=pair[1]==='Manual', p=enpHubParse_(d.ItemDescription);
      if (!manual && enpHubSku_(d.ItemNumber)!=='ENTERNEWPART') return;
      var o={Source:pair[1],'SO Internal ID':manual?'':d.SalesOrderSalesOrderId,'Sales Order Number':manual?'':d.SalesOrderNumber,'SO Status':manual?'':d.SalesOrderStatus,Quantity:manual?'':d.Quantity,'SO Line Price':manual?'':d.Price,'Original Description':manual?'':d.ItemDescription,'Original Action':manual?d.Status:d.LastAction,'Original Error':manual?d.Error:d.LastError,'Source Row':i+2,'Last Source Update':manual?d['Created At']:d.LastUpdated,'Striven Item ID':manual?d['Striven Item Id']:d.NewItemId,'Source Item Price':manual?d.Price:d.NewItemPrice};
      o['Item Number']=enpHubText_(manual?d['Item Number']:(d.NewItemNumber||p.sku));
      o['Item Name']=manual?d['Item Name']:(d.NewItemName||p.name);
      var stored=manual?d.Price:d.NewItemPrice;
      o.Price=stored!==''&&stored!=null?stored:p.price==null?'':p.price;
      if (!manual && stored!==''&&stored!=null && p.price!==null && Number(stored)!==p.price) {o.Price='';o['Review Reason']='Source item price conflicts with original description.';}
      o['Create Authorized']=false;out.push(o);
    });
  });
  return out;
}
function enpHubRefreshSourcesIfDue_() {
  var props=PropertiesService.getScriptProperties(), last=Number(props.getProperty('ENP_HUB_LAST_SOURCE_REFRESH_MS')||0);
  if (Date.now()-last<15*60*1000) return;
  // Refresh intake only; never invoke old pipeline or full Items scans.
  enp_syncApprovedReport_();
  enp_syncQuotedReport_();
  props.setProperty('ENP_HUB_LAST_SOURCE_REFRESH_MS',String(Date.now()));
}
function enpHubAutoTick() { return enpHubCoordinate_(true); }
function enpHubManualEdit(e) {
  if (!e || !e.range || !e.source || e.source.getId()!==ENP_HUB_BOOK_ID_) return;
  if (e.range.getSheet().getName()!=='ENTERNEWPART' || e.range.getRow()<2 || e.range.getColumn()!==1) return;
  // Validate actual cell, supporting multirow checkbox pastes without trusting e.value.
  if (!e.range.getValues().some(function(r){return r[0]===true;})) return;
  return enpHubCoordinate_(false);
}
function enpHubCoordinate_(refresh) {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(1000)) return {status:'BUSY_RETRY_ON_CLOCK'};
  try {
    if (PropertiesService.getScriptProperties().getProperty('ENP_HUB_COORDINATOR_ENABLED')!=='true') return {status:'DISABLED'};
    if (refresh) enpHubRefreshSourcesIfDue_();
    var book=SpreadsheetApp.openById(ENP_HUB_BOOK_ID_), sourceBook=SpreadsheetApp.openById(ENP_HUB_SOURCE_ID_);
    var t=enpHubReadTable_(book.getSheetByName('ENTERNEWPART'));
    ['Create Authorized','Item Number','Item Name','Source','Workflow Status','Review Reason'].forEach(function(h){if(t.col[h]==null)throw new Error('Hub header missing: '+h);});
    if(t.col['Create Authorized']!==0)throw new Error('Column A must remain the manual trigger.');
    var positions={};t.rows.forEach(function(r,i){if(r.Source) {var k=enpHubSourceKey_(r);if(positions[k]!=null)throw new Error('Duplicate source fingerprints require review.');positions[k]=i;}});
    var incoming=enpHubSourceRecords_(sourceBook), added=0;
    var incomingKeys={};incoming.forEach(function(r){var k=enpHubSourceKey_(r);if(incomingKeys[k])throw new Error('Source contains indistinguishable duplicate rows; no import performed.');incomingKeys[k]=true;});
    incoming.forEach(function(r){var k=enpHubSourceKey_(r);if(positions[k]!=null)return;var arr=t.headers.map(function(h){return r[h]==null?'':r[h];});t.sheet.getRange(t.sheet.getLastRow()+1,1,1,arr.length).setValues([arr]);positions[k]=t.rows.length;t.rows.push(r);added++;});
    var items=enpHubReadTable_(book.getSheetByName('DATA_ITEMS')), catalog={};
    items.rows.forEach(function(r){var k=enpHubSku_(r.ItemNumber);if(k){if(!catalog[k])catalog[k]=[];if(!catalog[k].some(function(x){return Number(x.Id)===Number(r.Id);}))catalog[k].push(r);}});
    var refreshTable=enpHubReadTable_(book.getSheetByName('REFRESH_CONTROL'));
    var itemRefresh=refreshTable.rows.filter(function(r){return r['Dataset Key']==='ITEMS';});
    var ts=itemRefresh.length===1?itemRefresh[0]['Last Success']:null;
    var when=ts instanceof Date?ts.getTime():NaN;
    var fresh=Number.isFinite(when)&&Date.now()>=when&&Date.now()-when<=24*60*60*1000;
    var count=0;
    // Manual requests take priority; all rows retain their original positions.
    var work=t.rows.map(function(row,i){return {row:row,i:i};}).sort(function(a,b){return Number(b.row['Create Authorized']===true)-Number(a.row['Create Authorized']===true);});
    work.forEach(function(job){
      var r=job.row;if(!r.Source)return;
      var plan=enpHubPlan_(r,catalog,fresh), rowNum=job.i+2;
      t.sheet.getRange(rowNum,t.col['Workflow Status']+1).setValue(plan.state);
      var reason=plan.reason;
      if (r['Review Reason'] && String(r['Review Reason']).indexOf('price conflicts')>=0)reason='Source item price conflicts with original description. '+reason;
      t.sheet.getRange(rowNum,t.col['Review Reason']+1).setValue(reason);
      if(r['Create Authorized']===true){
        t.sheet.getRange(rowNum,1).setValue(false);
        t.sheet.getRange(rowNum,1).setNote('Manual request evaluated '+new Date().toISOString()+': '+plan.state+'. '+reason);
      }
      count++;
    });
    SpreadsheetApp.flush();
    var result={status:'COORDINATED_NO_STRIVEN_WRITES',added:added,evaluated:count,itemsFresh:fresh};
    PropertiesService.getScriptProperties().setProperty('ENP_HUB_LAST_COORDINATOR_RUN',JSON.stringify({at:new Date().toISOString(),result:result}));
    return result;
  } catch(err) {
    PropertiesService.getScriptProperties().setProperty('ENP_HUB_LAST_COORDINATOR_ERROR',new Date().toISOString()+' '+String(err.message||err).slice(0,2000));
    throw err;
  } finally { lock.releaseLock(); }
}
function enpHubInstallCoordinator() {
  var book=SpreadsheetApp.openById(ENP_HUB_BOOK_ID_);
  if(book.getName()!=='Striven Central Data Hub'||!book.getSheetByName('ENTERNEWPART'))throw new Error('Hub fingerprint mismatch.');
  enpHubTestCoordinator();
  var props=PropertiesService.getScriptProperties();
  // This first stage does not take over existing Striven writers or delete legacy triggers.
  // Retain their inventory as a blocker to later write activation.
  var old=ScriptApp.getProjectTriggers(), saved=old.map(function(t){return {handler:t.getHandlerFunction(),id:t.getUniqueId()};});
  props.setProperty('ENP_HUB_PREINSTALL_TRIGGER_INVENTORY',JSON.stringify(saved));
  var created=[];
  try {
    if(!old.some(function(t){return t.getHandlerFunction()==='enpHubAutoTick';})) created.push(ScriptApp.newTrigger('enpHubAutoTick').timeBased().everyMinutes(5).create());
    if(!old.some(function(t){return t.getHandlerFunction()==='enpHubManualEdit'&&t.getTriggerSourceId()===ENP_HUB_BOOK_ID_;}))created.push(ScriptApp.newTrigger('enpHubManualEdit').forSpreadsheet(book).onEdit().create());
    props.setProperty('ENP_HUB_COORDINATOR_ENABLED','true');
    return {status:'INSTALLED_READ_ONLY_COORDINATOR',triggers:ScriptApp.getProjectTriggers().filter(function(t){return /^enpHub/.test(t.getHandlerFunction());}).map(function(t){return t.getHandlerFunction();}),strivenWrites:false};
  } catch(err) {created.forEach(function(t){ScriptApp.deleteTrigger(t);});props.setProperty('ENP_HUB_COORDINATOR_ENABLED','false');throw err;}
}
function enpHubTestCoordinator() {
  function eq(a,b){if(a!==b)throw new Error('Coordinator regression failed: '+a+' != '+b);}
  var base={Source:'Approved','Item Number':'A-01','Item Name':'Part','SO Internal ID':1,'Create Authorized':false};
  eq(enpHubPlan_(base,{},false).state,'WAITING DATA');
  eq(enpHubPlan_(base,{},true).state,'RESEARCH REQUIRED');
  eq(enpHubPlan_(base,{'A-01':[{Id:2}]},true).state,'READY FOR ITEM VERIFICATION');
  eq(enpHubPlan_(base,{'A-01':[{Id:2},{Id:3}]},true).state,'REVIEW');
  var q=Object.assign({},base,{Source:'Quoted'});eq(enpHubPlan_(q,{},true).state,'WAITING MANUAL REQUEST');
  q['Create Authorized']=true;eq(enpHubPlan_(q,{},true).state,'RESEARCH REQUIRED');
  var conflict=Object.assign({},base,{'Striven Item ID':3});eq(enpHubPlan_(conflict,{'A-01':[{Id:2}]},true).state,'REVIEW');
  eq(enpHubParse_('Item Number: A-01\nItem Name: Part\nPrice: $6,655.00').price,6655);
  eq(enpHubParse_('Item Number:\nItem Name: Part\nPrice:').sku,'');
  eq(enpHubParse_('Price: $0.00').price,0);
  return {status:'PASS',assertions:10,strivenWrites:false};
}

function enpHubSupplierCost_(listPrice, discount, currency) {
  if (currency !== 'CAD') throw new Error('Verified Canadian supplier list price required; no implicit FX conversion.');
  if (typeof listPrice !== 'number' || !Number.isFinite(listPrice) || listPrice < 0) throw new Error('Missing/invalid supplier list price.');
  if (typeof discount !== 'number' || !Number.isFinite(discount) || discount < 0 || discount > 1) throw new Error('Missing/invalid supplier discount.');
  return Math.round((listPrice * (1 - discount) + Number.EPSILON) * 100) / 100;
}
