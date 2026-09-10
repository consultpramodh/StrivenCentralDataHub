/**
 * STRIVEN CENTRAL DATA HUB
 * 90_Tests
 * CURRENT TEST ONLY — STD LOCATIONS SCHEMA DISCOVERY
 * R1.5
 *
 * READ-ONLY against Striven.
 * Fetches only two sample rows.
 * Does not write DATA_LOCATIONS.
 * Does not modify any registered source project.
 */

function test_StdLocationsReportSchema() {
  const startedMs = Date.now();
  const props = PropertiesService.getScriptProperties();
  const clientId = String(props.getProperty('CLIENT_ID') || '').trim();
  const clientSecret = String(props.getProperty('CLIENT_SECRET') || '').trim();
  const reportUrl = String(props.getProperty('STRIVEN_STD_LOCATIONS_REPORT_URL') || '').trim();
  const missingProperties = [];
  if (!clientId) missingProperties.push('CLIENT_ID');
  if (!clientSecret) missingProperties.push('CLIENT_SECRET');
  if (!reportUrl) missingProperties.push('STRIVEN_STD_LOCATIONS_REPORT_URL');
  if (missingProperties.length) throw new Error('Missing Script Properties: ' + missingProperties.join(', '));
  if (!/^https:\/\/api\.striven\.com\//i.test(reportUrl)) throw new Error('STRIVEN_STD_LOCATIONS_REPORT_URL must use https://api.striven.com/.');

  const tokenInfo = hub_strivenAccessToken_(clientId, clientSecret);
  const pageUrl = testLocationsPagedUrl_(reportUrl, 0, 2);
  const response = UrlFetchApp.fetch(pageUrl, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + tokenInfo.accessToken, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  const code=response.getResponseCode(), text=response.getContentText();
  if (code < 200 || code >= 300) throw new Error('STD Locations report fetch failed HTTP '+code+': '+testLocationsSafeText_(text,500));
  let payload; try { payload=JSON.parse(text); } catch(e) { throw new Error('STD Locations report returned non-JSON content.'); }
  const rows=testLocationsExtractRows_(payload).slice(0,2);
  if(!rows.length) throw new Error('STD Locations report returned zero sample rows.');

  const actualFields=testLocationsFieldUnion_(rows);
  const schema=testLocationsSchema_();
  const audit=testLocationsAuditSchema_(actualFields,schema);
  const preferred=testLocationsPreferredHeaders_();
  const nonPreferred=actualFields.filter(function(f){return preferred.indexOf(f)<0;});
  const status=(audit.missingCanonicalFields.length===0 && audit.ambiguousCanonicalFields.length===0 && audit.unexpectedSourceFields.length===0 && actualFields.length===schema.length && nonPreferred.length===0) ? 'PASS' : 'REVIEW_SCHEMA';

  const result={
    status:status,
    test:'test_StdLocationsReportSchema',
    reportConfigured:true,
    reportHost:'api.striven.com',
    oauth:'PASS',
    sampleRows:rows.length,
    expectedCanonicalFieldCount:schema.length,
    actualFieldCount:actualFields.length,
    actualFields:actualFields,
    canonicalToSource:audit.canonicalToSource,
    sourceToCanonical:audit.sourceToCanonical,
    missingCanonicalFields:audit.missingCanonicalFields,
    ambiguousCanonicalFields:audit.ambiguousCanonicalFields,
    unexpectedSourceFields:audit.unexpectedSourceFields,
    preferredDisplayNames:preferred,
    nonPreferredDisplayNames:nonPreferred,
    derivedWithoutReportSlots:[
      'CustomerNumber = CustomerId',
      'CustomerStatus = Active (from report filter)',
      'LocationIsActive = true (from report filter)',
      'LocationProvince = Ontario (from report filter)',
      'NormalizedLocationPhone',
      'NormalizedLocationAddress',
      'NormalizedLocationPostalCode',
      'LocationKey = LocationId',
      'CustomerLocationKey = CustomerId|LocationId'
    ],
    filterExpectation:['Customer Status = Active','Location Full Address is set','Address State = Ontario','Location Active = Yes'],
    writesPerformed:false,
    dataLocationsWritten:false,
    strivenWritesPerformed:false,
    sourceProjectsModified:false,
    tokenRequestMade:tokenInfo.requestedNewToken,
    apiCallsThisRun:1+(tokenInfo.requestedNewToken?1:0),
    elapsedMs:Date.now()-startedMs,
    nextStep:status==='PASS'?'Build production hub_refreshStdLocations and full DATA_LOCATIONS validation.':'Adjust only the report headers/columns reported by this same test, then rerun it.'
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}

function testLocationsSchema_(){
  return [
    {canonical:'LocationDateCreated',aliases:['LocationDateCreated','Location Date Created','CreatedOn','Created On','DateCreated','Date Created']},
    {canonical:'CustomerId',aliases:['CustomerId','CustomerID','Customer Id','Customer ID','CustomerNumber','Customer Number']},
    {canonical:'CustomerName',aliases:['CustomerName','Customer Name']},
    {canonical:'LocationId',aliases:['LocationId','LocationID','Location Id','Location ID']},
    {canonical:'LocationName',aliases:['LocationName','Location Name','Name']},
    {canonical:'LocationPrimaryPhone',aliases:['LocationPrimaryPhone','Location Primary Phone','PrimaryPhone','Primary Phone']},
    {canonical:'LocationFullAddress',aliases:['LocationFullAddress','Location Full Address','AddressFullAddress','Address Full Address','FullAddress','Full Address']},
    {canonical:'LocationPostalCode',aliases:['LocationPostalCode','Location Postal Code','AddressZip','Address Zip','Zip','PostalCode','Postal Code']},
    {canonical:'LocationAddressId',aliases:['LocationAddressId','Location Address Id','Location Address ID','AddressId','AddressID','Address Id','Address ID']},
    {canonical:'LocationIsPrimary',aliases:['LocationIsPrimary','Location Is Primary','IsPrimaryLocation','Is Primary Location','Primary']},
    {canonical:'LocationIsDefaultShipTo',aliases:['LocationIsDefaultShipTo','Location Is Default Ship To','IsDefaultShipTo','Is Default Ship To','DefaultShipTo','Default Ship To']},
    {canonical:'LocationIsDefaultBillTo',aliases:['LocationIsDefaultBillTo','Location Is Default Bill To','IsDefaultBillTo','Is Default Bill To','DefaultBillTo','Default Bill To']},
    {canonical:'LocationDateLastModified',aliases:['LocationDateLastModified','Location Date Last Modified','DateLastModified','Date Last Modified','LastModified','Last Modified']}
  ];
}
function testLocationsPreferredHeaders_(){return ['LocationDateCreated','CustomerId','CustomerName','LocationId','LocationName','LocationPrimaryPhone','LocationFullAddress','LocationPostalCode','LocationAddressId','LocationIsPrimary','LocationIsDefaultShipTo','LocationIsDefaultBillTo','LocationDateLastModified'];}
function testLocationsAuditSchema_(actualFields,schema){
  const normToRaw={}; actualFields.forEach(function(raw){const n=testLocationsNormalize_(raw);if(!normToRaw[n])normToRaw[n]=[];normToRaw[n].push(raw);});
  const canonicalToSource={},sourceToCanonical={},missing=[],ambiguous=[],accepted={};
  schema.forEach(function(def){
    const c=testLocationsNormalize_(def.canonical),aliases=(def.aliases||[]).slice();
    if(!aliases.some(function(a){return testLocationsNormalize_(a)===c;})) throw new Error('Alias standard failure: canonical missing from alias set for '+def.canonical);
    const matches=[];
    aliases.forEach(function(a){const n=testLocationsNormalize_(a);accepted[n]=true;(normToRaw[n]||[]).forEach(function(raw){if(matches.indexOf(raw)<0)matches.push(raw);});});
    if(matches.length===0) missing.push(def.canonical); else if(matches.length>1) ambiguous.push({canonical:def.canonical,sourceFields:matches}); else {canonicalToSource[def.canonical]=matches[0];sourceToCanonical[matches[0]]=def.canonical;}
  });
  const unexpected=actualFields.filter(function(raw){return !accepted[testLocationsNormalize_(raw)];});
  return {canonicalToSource:canonicalToSource,sourceToCanonical:sourceToCanonical,missingCanonicalFields:missing,ambiguousCanonicalFields:ambiguous,unexpectedSourceFields:unexpected};
}
function testLocationsFieldUnion_(rows){const out=[];rows.forEach(function(r){Object.keys(r||{}).forEach(function(k){if(out.indexOf(k)<0)out.push(k);});});return out;}
function testLocationsNormalize_(v){return String(v==null?'':v).replace(/[^A-Za-z0-9]/g,'').toLowerCase();}
function testLocationsPagedUrl_(reportUrl,pageIndex,pageSize){let url=String(reportUrl||'').trim();url=url.replace(/([?&])pageIndex=\d+(&?)/ig,function(_,lead,tail){return tail?lead:'';}).replace(/([?&])pageSize=\d+(&?)/ig,function(_,lead,tail){return tail?lead:'';}).replace(/[?&]$/,'');const sep=url.indexOf('?')>=0?'&':'?';return url+sep+'pageIndex='+encodeURIComponent(pageIndex)+'&pageSize='+encodeURIComponent(pageSize);}
function testLocationsExtractRows_(payload){if(Array.isArray(payload))return payload;if(!payload||typeof payload!=='object')return[];const c=[payload.data,payload.Data,payload.results,payload.Results,payload.items,payload.Items,payload.rows,payload.Rows,payload.records,payload.Records];for(let i=0;i<c.length;i++)if(Array.isArray(c[i]))return c[i];const keys=Object.keys(payload);for(let i=0;i<keys.length;i++){const v=payload[keys[i]];if(Array.isArray(v)&&v.length&&typeof v[0]==='object'&&!Array.isArray(v[0]))return v;}return[];}
function testLocationsSafeText_(value,maxLen){let s=String(value==null?'':value);s=s.replace(/(authorization\s*[:=]\s*['"]?\s*(?:basic|bearer)\s+)[A-Za-z0-9._~+\/=-]+/ig,'$1[REDACTED]');s=s.replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g,'[REDACTED_KEY]');s=s.replace(/([?&](?:api[_-]?key|key|token|access_token)=)[^&\s'"]+/ig,'$1[REDACTED]');return s.length<=maxLen?s:s.substring(0,maxLen)+'...';}
