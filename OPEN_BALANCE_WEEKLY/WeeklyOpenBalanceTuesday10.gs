/**
 * Classic Fireplace — Weekly A/R Open Balance
 * New standalone module. Do not paste over unrelated Central Hub files.
 *
 * Tuesday ~10:00 AM America/Toronto: one fresh Striven report fetch,
 * privacy-checked employee/group routing, Manager Jay CC.
 * NO CreatedBy routing in production; no automatic emails until verified.
 *
 * Run obwPreflight() first. Run obwInstallTuesday10() only after it passes.
 * This script DOES NOT modify Striven or the Central Hub datasets.
 */
const OBW = Object.freeze({
  SPREADSHEET_ID: '13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU',
  URL_KEY: 'STRIVEN_OPEN_BALANCE_REPORT_URL',
  URL_SHEET: 'OPEN_BALANCE_PRIVATE_CONFIG',
  EMPLOYEES_SHEET: 'DATA_EMPLOYEE_PROFILES',
  TIMEZONE: 'America/Toronto',
  CC: 'jay@classicfireplace.ca',
  ADMIN: 'pramodh@classicfireplace.ca',
  TRIGGER: 'obwRunTuesday10',
  ROUTING_CERTIFICATION_KEY: 'OBW_OWNER_ROUTING_CERTIFIED',
  GROUPS: [
    {label:'BEACHES', members:['Steve Trevor','Colleen Trevor']},
    {label:'WHITBY', members:['Matthew McLean','Karen Genis']},
    {label:'NEWMARKET', members:['Spencer Bambek','Doug Crann']},
    {label:'Service Department', members:['Trevor Burke','Karen Goldman','Clara Lam']}
  ],
  TEMPORARY: {label:'Babz/Bruce', primary:'Babz Boehm', retired:'Bruce Gowanlock'}
});

/** SAFE: makes one live Striven report read, sends no emails. */
function obwPreflight() {
  const plan = obwBuildPlan_();
  const result = {
    ready: plan.issues.length === 0,
    status: plan.issues.length ? 'BLOCKED' : 'READY',
    issues: plan.issues,
    refreshedAt: plan.refreshedAt.toISOString(),
    sourceRows: plan.sourceRows,
    groups: plan.messages.map(function(m) {
      return {label:m.label, rows:m.rows, to:m.to, cc:m.cc};
    }),
    schedule: 'Every Tuesday around 10:00 AM America/Toronto'
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * ONE-REPORT-CALL OWNERSHIP DIAGNOSTIC. SENDS NO EMAIL.
 * Summarizes only metadata and counts; logs no customer details or report URL.
 * This is the next action when obwPreflight() is BLOCKED on SalesRep.
 */
function obwAuditOwnerSource() {
  const report=obwFetch_();
  const names=Object.keys(report.rows[0]||{});
  const match=function(k){return names.find(function(n){return obwNorm_(n)===obwNorm_(k);})||'';};
  const typeField=match('TransactionType');
  const ownerField=match('SalesRepName')||match('SalesRep');
  const idField=match('TransactionId');
  const counts=Object.create(null);
  let blankOwner=0, missingTransactionIds=0;
  report.rows.forEach(function(row) {
    const kind=typeField?String(row[typeField]||'').trim().toUpperCase():'UNKNOWN';
    counts[kind]=(counts[kind]||0)+1;
    if(!ownerField||!String(row[ownerField]||'').trim()) blankOwner++;
    if(!idField||!String(row[idField]||'').trim()) missingTransactionIds++;
  });
  const result={
    ok:true,status:ownerField&&blankOwner===0?'OWNER_FIELD_PRESENT':'OWNER_FIELD_MISSING_OR_INCOMPLETE',
    sourceRows:report.rows.length, refreshedAt:report.fetchedAt.toISOString(),
    transactionTypes:counts, reportFields:names,
    ownerField:ownerField||null, rowsWithoutSalesRep:blankOwner,
    rowsWithoutTransactionId:missingTransactionIds,
    paymentApplicationMappingVerified:false,
    noEmailsSent:true,
    nextStep:'Invoice owners can be verified using the existing OpenBalanceDistribution.gs function openBalanceResolveInvoiceOwners(). Payment owner routing additionally requires verified invoice-application links; do not certify or schedule while unresolved.'
  };
  console.log(JSON.stringify(result));
  return result;
}

/** Sets up one recurring Tuesday trigger; refuses to install if preflight fails. */
function obwInstallTuesday10() {
  const p = obwPreflight();
  if (!p.ready) throw new Error('NOT INSTALLED: ' + p.issues.join(' | '));
  const old = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === OBW.TRIGGER;
  });
  if (old.length === 1) {
    const result = {ok:true, status:'ALREADY_INSTALLED', triggerId:old[0].getUniqueId()};
    console.log(JSON.stringify(result));
    return result;
  }
  if (old.length > 1) throw new Error('Multiple weekly triggers found; check trigger ownership manually.');
  const t = ScriptApp.newTrigger(OBW.TRIGGER).timeBased()
    .onWeekDay(ScriptApp.WeekDay.TUESDAY).atHour(10).nearMinute(0)
    .everyWeeks(1).inTimezone(OBW.TIMEZONE).create();
  const result = {ok:true, status:'INSTALLED', triggerId:t.getUniqueId(),
    schedule:'Tuesday around 10:00 AM America/Toronto'};
  console.log(JSON.stringify(result));
  return result;
}

/** Actual scheduled handler. No separate refresh job: one fetch then send. */
function obwRunTuesday10() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Weekly A/R send already running.');
  try {
    const weekday = Utilities.formatDate(new Date(),OBW.TIMEZONE,'EEE');
    if (weekday !== 'Tue') throw new Error('Automatic send is permitted on Tuesday only.');
    const plan = obwBuildPlan_();
    if (plan.issues.length) throw new Error('BLOCKED BEFORE SEND: ' + plan.issues.join(' | '));
    const today = Utilities.formatDate(new Date(),OBW.TIMEZONE,'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    const snapshotKey = 'OBW_SNAPSHOT_' + today;
    const digest = Utilities.base64Encode(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify(plan.messages.map(function(m) {
        return [m.label,m.to,m.cc,m.rows,m.digestRows];
      }))
    ));
    const oldDigest = props.getProperty(snapshotKey);
    if (oldDigest && oldDigest !== digest) {
      throw new Error('This Tuesday snapshot changed after a partial or prior send. Manual review required.');
    }
    props.setProperty(snapshotKey,digest);
    const sent = [];
    for (const m of plan.messages) {
      const stateKey = 'OBW_SEND_' + today + '_' +
        Utilities.base64EncodeWebSafe(m.label).replace(/=+$/,'');
      const state = props.getProperty(stateKey);
      if (state === 'SENT') continue;
      if (state) throw new Error('Uncertain prior send state for ' + m.label + '; manual review required.');
      // Set state BEFORE sending to avoid duplicate messages on ambiguous failure.
      props.setProperty(stateKey,'SENDING');
      const opts = {to:m.to.join(','),subject:m.subject,htmlBody:m.html,
        body:m.plain,name:'Classic Fireplace & BBQ Store'};
      if (m.cc) opts.cc = m.cc;
      MailApp.sendEmail(opts);
      props.setProperty(stateKey,'SENT');
      sent.push({group:m.label,to:m.to,cc:m.cc,rows:m.rows});
    }
    const result={ok:true,status:'SENT',refreshedAt:plan.refreshedAt.toISOString(),
      groupsSent:sent,sourceRows:plan.sourceRows};
    console.log(JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('Weekly A/R blocked: ' + String(err.message || err));
    try {
      MailApp.sendEmail(OBW.ADMIN,'Weekly A/R report BLOCKED',
        'Tuesday A/R send did not complete. Review Apps Script executions.\n' +
        String(err.message || err));
    } catch (_) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Safe disable: affects this script's handler only. */
function obwRemoveTuesday10() {
  let n=0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if(t.getHandlerFunction()===OBW.TRIGGER){ScriptApp.deleteTrigger(t);n++;}
  });
  console.log('Removed '+n+' weekly trigger(s).');
  return {removed:n};
}
function obwTriggerStatus() {
  const ids=ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction()===OBW.TRIGGER;
  }).map(function(t){return t.getUniqueId();});
  const result={installed:ids.length===1,count:ids.length,triggerIds:ids,
    schedule:'Tuesday ~10:00 AM America/Toronto'};
  console.log(JSON.stringify(result));return result;
}

/** Verify ownership, mapping and grouping for ALL rows before any email. */
function obwBuildPlan_() {
  const issues=[];
  const feed=obwFetch_();
  const records=feed.rows;
  const fieldNames=Object.keys(records[0]||{});
  const pick=function(key){return fieldNames.find(function(f){
    return obwNorm_(f)===obwNorm_(key);}) || '';};
  // CreatedBy is NOT a valid financial routing identifier.
  const ownerKey=pick('SalesRepName') || pick('SalesRep');
  if (!ownerKey) issues.push('Striven report has no SalesRepName/SalesRep owner field. CreatedBy is forbidden for production.');
  const required=['CustomerNumber','CustomerName','TransactionType','TransactionId',
    'TransactionNumber','TransactionAmount','TransactionDate','OpenBalance'];
  const names={};
  required.forEach(function(k){
    names[k]=pick(k);
    if(!names[k]) issues.push('Missing Striven report field '+k+'.');
  });
  const certified=PropertiesService.getScriptProperties()
    .getProperty(OBW.ROUTING_CERTIFICATION_KEY);
  if(certified!=='YES') issues.push('Invoice AND payment ownership has not been certified; script property '+OBW.ROUTING_CERTIFICATION_KEY+' must be YES only after verification.');
  const profile=obwEmployeeEmails_();
  issues.push.apply(issues,profile.issues);
  const byOwner=Object.create(null);
  records.forEach(function(r,idx){
    const who=ownerKey?String(r[ownerKey]||'').trim():'';
    if(!who){ if(ownerKey) issues.push('Blank Sales Rep at report row '+(idx+1)+'.');return; }
    if(!byOwner[who]) byOwner[who]=[];
    byOwner[who].push(r);
  });
  const reserved=Object.create(null), specs=[], memberSeen=Object.create(null);
  OBW.GROUPS.forEach(function(g){
    g.members.forEach(function(n){
      if(memberSeen[n]) issues.push('Employee belongs to multiple groups: '+n);
      memberSeen[n]=true;
    });
    const total=g.members.reduce(function(s,n){return s+(byOwner[n]||[]).length;},0);
    if(total){specs.push({label:g.label,members:g.members.slice()});
      g.members.forEach(function(n){reserved[n]=true;});}
  });
  const temp=OBW.TEMPORARY;
  if((byOwner[temp.retired]||[]).length){
    specs.push({label:temp.label,members:[temp.primary,temp.retired]});
    reserved[temp.primary]=true;reserved[temp.retired]=true;
  }
  Object.keys(byOwner).sort().forEach(function(n){
    if(!reserved[n]) specs.push({label:n,members:[n]});
  });
  const messages=[];
  specs.forEach(function(s){
    const involved=s.members.filter(function(n){return (byOwner[n]||[]).length>0;});
    // Bruce is retired: his items are reviewed through Babz, not sent to Bruce.
    const recipients=s.label===temp.label?[temp.primary]:involved;
    const to=[];
    recipients.forEach(function(n){
      const addr=(n==='Jay Scott'?OBW.CC:profile.map[n]||'').toLowerCase().trim();
      if(!/^[^\s@]+@classicfireplace\.ca$/.test(addr)){
        issues.push('Unverified/missing company email for '+n+' in '+s.label+'.');
      } else if(to.indexOf(addr)<0) to.push(addr);
    });
    if(!to.length) issues.push('No primary recipient for '+s.label+'.');
    const cc=to.indexOf(OBW.CC)<0?OBW.CC:'';
    const rows=[];
    s.members.forEach(function(n){
      (byOwner[n]||[]).forEach(function(r){rows.push(r);});
    });
    const byMember=s.members.map(function(n){
      return {name:n,rows:byOwner[n]||[]};
    });
    const date=Utilities.formatDate(feed.fetchedAt,OBW.TIMEZONE,'MMM d, yyyy');
    messages.push({
      label:s.label,to:to,cc:cc,rows:rows.length,
      digestRows:rows.map(function(r){return JSON.stringify(r);}),
      subject:'Weekly A/R Open Balance - '+s.label+' - '+date,
      html:obwEmailHtml_(s.label,byMember,feed.fetchedAt,names),
      plain:obwEmailText_(s.label,byMember,feed.fetchedAt,names)
    });
  });
  const counted=messages.reduce(function(sum,m){return sum+m.rows;},0);
  if(ownerKey && counted!==records.length) issues.push('Coverage mismatch: '+counted+'/'+records.length+' rows.');
  return {issues:Array.from(new Set(issues)),refreshedAt:feed.fetchedAt,
    sourceRows:records.length,messages:messages};
}
function obwEmployeeEmails_() {
  const sheet=SpreadsheetApp.openById(OBW.SPREADSHEET_ID)
    .getSheetByName(OBW.EMPLOYEES_SHEET);
  if(!sheet) return {map:{},issues:['Missing DATA_EMPLOYEE_PROFILES sheet.']};
  const v=sheet.getRange(1,1,Math.min(sheet.getLastRow(),500),4).getDisplayValues();
  const hdr=v[0].map(obwNorm_);
  const nameCol=hdr.indexOf('fullname'),emailCol=hdr.indexOf('primaryemail');
  if(nameCol<0 || emailCol<0) return {map:{},issues:['Employee profile name/email columns missing.']};
  const map=Object.create(null), issues=[];
  for(let i=1;i<v.length;i++){
    const name=String(v[i][nameCol]||'').trim();
    const email=String(v[i][emailCol]||'').trim().toLowerCase();
    if(!name||!email) continue;
    if(map[name]&&map[name]!==email) issues.push('Conflicting emails for '+name+'.');
    map[name]=email;
  }
  return {map:map,issues:issues};
}
function obwFetch_() {
  const props=PropertiesService.getScriptProperties();
  let url=String(props.getProperty(OBW.URL_KEY)||'').trim();
  if(!url) {
    const ss=SpreadsheetApp.openById(OBW.SPREADSHEET_ID);
    const sheet=ss.getSheetByName(OBW.URL_SHEET);
    if(sheet&&sheet.getLastRow()>1){
      const pairs=sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
      const found=pairs.find(function(p){return String(p[0]).trim()===OBW.URL_KEY;});
      if(found)url=String(found[1]||'').trim();
    }
  }
  if(!/^https:\/\/api\.striven\.com\/v2\/reports\/[^?]+/i.test(url))
    throw new Error('Private Striven report URL is missing or invalid.');
  const response=UrlFetchApp.fetch(url,{method:'get',muteHttpExceptions:true,
    headers:{Accept:'application/json'}});
  if(response.getResponseCode()!==200)
    throw new Error('Striven Open Balance report HTTP '+response.getResponseCode()+'.');
  let body;
  try{body=JSON.parse(response.getContentText());}
  catch(e){throw new Error('Striven returned invalid JSON.');}
  if(!body||!Array.isArray(body.data))throw new Error('Unexpected report format.');
  if(body.nextPage || Number(body.totalRecords==null?body.data.length:body.totalRecords)!==body.data.length)
    throw new Error('Striven report is incomplete/paginated. NO SEND.');
  if(!body.data.length)throw new Error('Striven report returned zero rows. NO SEND.');
  return {rows:body.data,fetchedAt:new Date()};
}
function obwEmailHtml_(label,byMember,refreshedAt,keys){
  const time=Utilities.formatDate(refreshedAt,OBW.TIMEZONE,'MMM d, yyyy h:mm a')+' ET';
  const content=byMember.map(function(s){
    const rows=s.rows.slice().sort(function(a,b){
      return (obwDate_(b[keys.TransactionDate])||0)-(obwDate_(a[keys.TransactionDate])||0);
    });
    if(!rows.length)return '<h3 style="font-size:18px;border-bottom:3px solid #a44932;padding-bottom:6px;">'+obwEscape_(s.name)+'</h3><p>No open transactions in this report.</p>';
    const invoices=rows.filter(function(r){return String(r[keys.TransactionType]).toUpperCase()==='INVOICE';});
    const payments=rows.filter(function(r){return String(r[keys.TransactionType]).toUpperCase()==='PAYMENT';});
    const invoiceOpen=invoices.reduce(function(t,r){return t+Math.max(0,obwAmount_(r[keys.OpenBalance]));},0);
    const paymentOpen=payments.reduce(function(t,r){return t+obwAmount_(r[keys.OpenBalance]);},0);
    const h=['Customer #','Customer','Type','Transaction ID','Transaction #','Date','Transaction Amount','Open Balance'];
    const tableHead=h.map(function(x){return '<th style="padding:10px 8px;background:#272727;color:#fff;text-align:left;font-size:12px;">'+x+'</th>';}).join('');
    const trs=rows.map(function(r,i){
      const account=String(r[keys.CustomerNumber]||'').trim();
      const aid=/^\d+$/.test(account)?'https://classicfireplace.striven.com/CRM/AccountDashboard.aspx?AccountID='+encodeURIComponent(account):'';
      const id=String(r[keys.TransactionId]||'').trim();
      const typ=String(r[keys.TransactionType]||'').trim().toUpperCase();
      const route=typ==='PAYMENT'?'payments':typ==='INVOICE'?'invoices':'';
      const turl=route&&/^\d+$/.test(id)?'https://classicfireplace.striven.com/next/accounting#/'+route+'/'+id:'';
      const a=function(value,url){return url?'<a style="color:#7b3f2e;text-decoration:underline;" href="'+obwEscape_(url)+'">'+obwEscape_(value)+'</a>':obwEscape_(value);};
      const data=[a(account,aid),a(r[keys.CustomerName],aid),obwEscape_(typ),
        a(id,turl),a(r[keys.TransactionNumber],turl),obwEscape_(r[keys.TransactionDate]),
        obwMoney_(r[keys.TransactionAmount]),'<strong>'+obwMoney_(r[keys.OpenBalance])+'</strong>'];
      return '<tr style="background:'+(i%2?'#faf9f7':'#fff')+';">'+data.map(function(v){
        return '<td style="padding:10px 8px;border-bottom:1px solid #e8e5df;font-size:13px;line-height:1.4;">'+v+'</td>';
      }).join('')+'</tr>';
    }).join('');
    const box=function(k,v){return '<td style="width:33.3%;padding:12px;background:#f7f3ee;border:1px solid #ddd;"><span style="font-size:11px;color:#69645e;">'+k+'</span><div style="font-size:19px;font-weight:bold;">'+v+'</div></td>';};
    return '<h3 style="font-size:18px;border-bottom:3px solid #a44932;padding-bottom:6px;">'+obwEscape_(s.name)+'</h3>'+
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 14px;border-collapse:collapse;"><tr>'+
      box('Open Balance',obwMoney_(invoiceOpen))+box('Open Payments',obwMoney_(paymentOpen))+box('Transactions',String(rows.length))+'</tr></table>'+
      '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;"><thead><tr>'+tableHead+'</tr></thead><tbody>'+trs+'</tbody></table>';
  }).join('<div style="height:22px;"></div>');
  return '<div style="background:#f3f1ed;color:#272727;font-family:Arial,Helvetica,sans-serif;padding:14px;">'+
    '<div style="max-width:1060px;margin:auto;"><div style="background:#272727;color:white;padding:20px 24px;border-bottom:5px solid #a44932;">'+
    '<div style="font-size:11px;letter-spacing:1px;">CLASSIC FIREPLACE &amp; BBQ STORE</div>'+
    '<div style="font-size:24px;font-weight:bold;margin-top:5px;">Weekly A/R Open Balance</div>'+
    '<div style="font-size:13px;margin-top:7px;">'+obwEscape_(label)+'</div></div>'+
    '<div style="background:white;padding:20px;border:1px solid #dedbd5;">'+
    '<div style="background:#f3f1ed;border-left:4px solid #a44932;padding:12px;font-size:13px;margin-bottom:20px;">'+
    '<strong>Report Refreshed at:</strong> '+obwEscape_(time)+'<div style="font-size:12px;margin-top:5px;">Changes made after this time will appear on the next refresh.</div></div>'+
    content+'</div><div style="text-align:center;padding:12px;color:#888;font-size:11px;">Confidential — Internal A/R information.</div></div></div>';
}
function obwEmailText_(label,byMember,refreshedAt,keys) {
  const time=Utilities.formatDate(refreshedAt,OBW.TIMEZONE,'MMM d, yyyy h:mm a')+' ET';
  const lines=['Weekly A/R Open Balance - '+label,'Report Refreshed at: '+time,
    'Changes after that time appear on the next refresh.',''];
  byMember.forEach(function(s){
    lines.push(s.name+' ('+s.rows.length+' transactions)');
    s.rows.forEach(function(r){
      lines.push(String(r[keys.CustomerName])+' / '+String(r[keys.TransactionNumber])+
        ' / Open Balance '+obwMoney_(r[keys.OpenBalance]));
    });
    lines.push('');
  });
  lines.push('Confidential — Internal A/R information.');
  return lines.join('\n');
}
function obwNorm_(v){return String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]/g,'');}
function obwEscape_(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function obwAmount_(v){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  const s=String(v==null?'':v).trim();
  const n=Number(s.replace(/[$,\s()]/g,''));
  return Number.isFinite(n)?(/^\(.*\)$/.test(s)?-Math.abs(n):n):0;
}
function obwMoney_(v){return obwAmount_(v).toLocaleString('en-CA',{style:'currency',currency:'CAD'});}
function obwDate_(v){
  const s=String(v||'').trim(),p=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if(p)return new Date(+p[3],+p[1]-1,+p[2]).getTime();
  const t=Date.parse(s);return Number.isFinite(t)?t:0;
}
