/**
 * Classic Fireplace — Weekly A/R Open Balance
 * New standalone module. Do not paste over unrelated Central Hub files.
 *
 * Tuesday ~10:00 AM America/Toronto: one fresh Striven report fetch,
 * privacy-checked employee/group routing, Manager Jay CC.
 * Routing policy: CreatedBy in this Striven report identifies the Sales Rep.
 * Recipient routing is based on CreatedBy with all-address validation.
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
  // Gmail clips around 102 KiB; one full group email must stay under 90 KiB.
  MAX_HTML_BYTES: 90 * 1024,
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
    routingSource: 'CreatedBy (Sales Rep on Open Balance report)',
    groups: plan.messages.map(function(m) {
      return {label:m.label, rows:m.rows, to:m.to, cc:m.cc, htmlBytes:m.htmlBytes};
    }),
    schedule: 'Every Tuesday around 10:00 AM America/Toronto'
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * Controlled email rendering test:
 * - One fresh Striven report request, no dataset write
 * - Finds the single largest complete employee group (currently Babz/Bruce)
 * - Sends ONE unsplit email to Pramodh only
 * - Never CCs Jay or sends to any Sales Rep
 * - Does not change Tuesday trigger, send state, or weekly digest
 *
 * Run obwSendLargestGroupTest() manually from Apps Script.
 */
function obwSendLargestGroupTest() {
  const plan=obwBuildPlan_();
  if(plan.issues.length) throw new Error('Test blocked: '+plan.issues.join(' | '));
  const m=plan.messages.slice().sort(function(a,b){return b.rows-a.rows;})[0];
  if(!m) throw new Error('Test blocked: no email groups.');
  if(m.htmlBytes>OBW.MAX_HTML_BYTES) throw new Error('Test HTML too large: '+m.htmlBytes);
  const subject='[TEST ONLY] '+m.subject;
  MailApp.sendEmail({
    to:OBW.ADMIN,
    subject:subject,
    body:'TEST ONLY — Do not forward; this is the latest live Striven snapshot.\n\n'+m.plain,
    htmlBody:m.html,
    name:'Classic Fireplace & BBQ Store'
  });
  const result={
    status:'TEST_SENT',to:OBW.ADMIN,cc:'',group:m.label,
    transactions:m.rows,htmlBytes:m.htmlBytes,htmlLimit:OBW.MAX_HTML_BYTES,
    reportRefreshedAt:plan.refreshedAt.toISOString(),
    weeklySendUnchanged:true,
    subject:subject
  };
  console.log(JSON.stringify(result));
  return result;
}

/**
 * ONE-REPORT-CALL OWNERSHIP DIAGNOSTIC. SENDS NO EMAIL.
 * Summarizes only metadata and counts; logs no customer details or report URL.
 * Audits the business-defined CreatedBy ownership and transaction IDs.
 */
function obwAuditOwnerSource() {
  const report=obwFetch_();
  const names=Object.keys(report.rows[0]||{});
  const match=function(k){return names.find(function(n){return obwNorm_(n)===obwNorm_(k);})||'';};
  const typeField=match('TransactionType');
  const ownerField=match('CreatedBy');
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
    ok:true,status:ownerField&&blankOwner===0?'CREATED_BY_PRESENT':'CREATED_BY_MISSING_OR_INCOMPLETE',
    sourceRows:report.rows.length, refreshedAt:report.fetchedAt.toISOString(),
    transactionTypes:counts, reportFields:names,
    ownerField:ownerField||null, rowsWithoutCreatedBy:blankOwner,
    routingPolicy:'CreatedBy identifies Sales Rep in this weekly report',
    rowsWithoutTransactionId:missingTransactionIds,
    noEmailsSent:true,
    nextStep:'Run obwPreflight(). If READY, run obwInstallTuesday10() once to schedule.'
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
      if(m.htmlBytes>OBW.MAX_HTML_BYTES) throw new Error('Oversized HTML for '+m.label+'.');
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
  // Business rule: CreatedBy in this Open Balance report is the Sales Rep.
  const ownerKey=pick('CreatedBy');
  if (!ownerKey) issues.push('Missing CreatedBy (Sales Rep) field in Open Balance report.');
  const required=['CustomerNumber','CustomerName','TransactionType','TransactionId',
    'TransactionNumber','TransactionAmount','TransactionDate','OpenBalance'];
  const names={};
  required.forEach(function(k){
    names[k]=pick(k);
    if(!names[k]) issues.push('Missing Striven report field '+k+'.');
  });
  const profile=obwEmployeeEmails_();
  issues.push.apply(issues,profile.issues);
  const byOwner=Object.create(null);
  records.forEach(function(r,idx){
    const who=ownerKey?String(r[ownerKey]||'').trim():'';
    if(!who){ if(ownerKey) issues.push('Blank CreatedBy (Sales Rep) at report row '+(idx+1)+'.');return; }
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
    // One complete email per group — never split the report.
    const html=obwEmailHtml_(s.label,byMember,feed.fetchedAt,names);
    const htmlBytes=Utilities.newBlob(html,'text/html').getBytes().length;
    if(htmlBytes>OBW.MAX_HTML_BYTES) {
      issues.push('Email for '+s.label+' is '+htmlBytes+
        ' bytes (> '+OBW.MAX_HTML_BYTES+'). Compact further before sending; splitting is disabled.');
    }
    messages.push({
      label:s.label,to:to.slice(),cc:cc,rows:rows.length,
      digestRows:rows.map(function(r){return JSON.stringify(r);}),
      subject:'Weekly A/R Open Balance - '+s.label+' - '+date,
      html:html,htmlBytes:htmlBytes,
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
/**
 * Compact, Gmail-safe HTML.
 *
 * The previous version generated huge indented HTML (e.g. 245 KB for
 * Babz/Bruce on Oct 13). This avoids per-cell multiline markup entirely.
 * Keeps all 8 columns, all transactions, links, summary and refresh time.
 */
function obwEmailHtml_(label,byMember,refreshedAt,keys) {
  const time=Utilities.formatDate(refreshedAt,OBW.TIMEZONE,'MMM d, yyyy h:mm a')+' ET';
  const esc=obwEscape_;
  const cell='<td style="padding:7px 6px;border-bottom:1px solid #e8e5df">';
  const moneyCell='<td align="right" style="padding:7px 6px;border-bottom:1px solid #e8e5df;white-space:nowrap">';
  const link=function(value,url) {
    const safe=esc(value);
    return url?'<a href="'+esc(url)+'" style="color:#a44932;text-decoration:underline">'+safe+'</a>':safe;
  };
  const sections=byMember.map(function(part) {
    const rows=part.rows.slice().sort(function(a,b) {
      return obwDate_(b[keys.TransactionDate])-obwDate_(a[keys.TransactionDate]);
    });
    const title='<div style="font-size:17px;font-weight:bold;border-bottom:2px solid #a44932;padding:7px 0;margin:16px 0 9px">'+esc(part.name)+'</div>';
    if(!rows.length) return title+'<p style="font-size:13px">No open transactions in this report.</p>';
    let invoices=0,payments=0;
    rows.forEach(function(row) {
      const kind=String(row[keys.TransactionType]||'').trim().toUpperCase();
      const open=obwAmount_(row[keys.OpenBalance]);
      if(kind==='INVOICE'&&open>0)invoices+=open;
      if(kind==='PAYMENT')payments+=open;
    });
    const summary='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px">'+
      '<tr><td style="background:#f7f3ee;padding:9px;border:1px solid #ddd">Open Balance<br><b>'+obwMoney_(invoices)+'</b></td>'+
      '<td style="background:#f7f3ee;padding:9px;border:1px solid #ddd">Open Payments<br><b>'+obwMoney_(payments)+'</b></td>'+
      '<td style="background:#f7f3ee;padding:9px;border:1px solid #ddd">Transactions<br><b>'+rows.length+'</b></td></tr></table>';
    const headers=['Customer #','Customer','Type','Transaction ID','Transaction #','Date','Transaction Amount','Open Balance'];
    const thead='<tr bgcolor="#272727">'+headers.map(function(h) {
      return '<th align="'+((h==='Transaction Amount'||h==='Open Balance')?'right':'left')+
        '" style="padding:8px 6px;color:#fff;font-size:12px">'+h+'</th>';
    }).join('')+'</tr>';
    const body=rows.map(function(r,i) {
      const number=String(r[keys.CustomerNumber]==null?'':r[keys.CustomerNumber]).trim();
      const account=/^\d+$/.test(number)?
        'https://classicfireplace.striven.com/CRM/AccountDashboard.aspx?AccountID='+encodeURIComponent(number):'';
      const id=String(r[keys.TransactionId]==null?'':r[keys.TransactionId]).trim();
      const type=String(r[keys.TransactionType]||'').trim();
      const upper=type.toUpperCase();
      const route=upper==='INVOICE'?'invoices':upper==='PAYMENT'?'payments':'';
      const tx=route&&/^\d+$/.test(id)?
        'https://classicfireplace.striven.com/next/accounting#/'+route+'/'+encodeURIComponent(id):'';
      const data=[
        link(number,account),link(r[keys.CustomerName],account),esc(type),
        link(id,tx),link(r[keys.TransactionNumber],tx),esc(r[keys.TransactionDate]),
        obwMoney_(r[keys.TransactionAmount]),'<b>'+obwMoney_(r[keys.OpenBalance])+'</b>'
      ];
      return '<tr'+(i%2?' bgcolor="#faf9f7"':'')+'>'+
        data.map(function(v,k){return (k>=6?moneyCell:cell)+v+'</td>';}).join('')+'</tr>';
    }).join('');
    return title+summary+'<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;line-height:1.35">'+
      '<thead>'+thead+'</thead><tbody>'+body+'</tbody></table>';
  }).join('');
  return '<div style="background:#f3f1ed;color:#272727;padding:14px;font-family:Arial,Helvetica,sans-serif">'+
    '<div style="max-width:1060px;margin:auto">'+
    '<div style="background:#272727;color:#fff;padding:18px 22px;border-bottom:4px solid #a44932">'+
    '<div style="font-size:11px;letter-spacing:1px">CLASSIC FIREPLACE &amp; BBQ STORE</div>'+
    '<div style="font-size:23px;font-weight:bold;margin-top:5px">Weekly A/R Open Balance</div>'+
    '<div style="font-size:13px;margin-top:7px">'+esc(label)+'</div></div>'+
    '<div style="background:#fff;border:1px solid #dedbd5;padding:17px">'+
    '<div style="background:#f3f1ed;border-left:4px solid #a44932;padding:11px;font-size:13px">'+
    '<b>Report Refreshed at:</b> '+esc(time)+
    '<div style="font-size:12px;margin-top:5px">Changes made after this time will appear on the next refresh.</div></div>'+
    sections+'</div><div style="text-align:center;color:#777;font-size:10px;padding:10px">'+
    'Confidential — Internal A/R information.</div></div></div>';
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
