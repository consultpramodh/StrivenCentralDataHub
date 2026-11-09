// JavaScript (Node.js): read-only legacy Approved/Quoted report coverage regression.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const script=fs.readFileSync(__dirname+'/ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs','utf8');
const anchor='function hub_enpUserProvidedReportUrl_(';
const at=script.indexOf(anchor);
assert.ok(at>0,'Audit helper is missing');
const body=script.slice(at);
const make=new Function('PropertiesService','Logger','UrlFetchApp','SpreadsheetApp','hub_strivenAccessToken_',body+';return hub_auditEnternewpartSourceReports');
const keys={HUB_ENP_REPORT_URL:'https://api.striven.com/v2/reports/Approved',
 STRIVEN_ENTERNEWPART_REPORT_API:'https://api.striven.com/v2/reports/Approved',
 STRIVEN_ENTERNEWPART_QUOTED_REPORT_API:'https://api.striven.com/v2/reports/Quoted',
 CLIENT_ID:'MOCK_ONLY',CLIENT_SECRET:'MOCK_ONLY'};
const item=(id,desc,status)=>({SalesOrderSalesOrderId:id,ItemItemId:36935,ItemNumber:' ENTERNEWPART ',
 ItemDescription:desc,Quantity:1,Price:10,SalesOrderStatus:status});
const report={
 'https://api.striven.com/v2/reports/Approved':{rows:[item(28419,'GLA-5DV','Approved'),item(28500,'MEL90F/M','Quoted')]},
 'https://api.striven.com/v2/reports/Quoted':{Data:[item(28500,'MEL90F/M','Quoted'),item(22305,'6DVL12','Quoted')]}
};
const head=['SO Internal ID','Original Description','Quantity','SO Line Price','Workflow Status','Source'];
const values=[head,['28419','GLA-5DV',1,10,'NEEDS REVIEW','Approved'],
 ['28500','MEL90F/M',1,10,'NEEDS REVIEW','Quoted'],
 ['22305','6DVL12',1,10,'NEEDS REVIEW','Quoted']];
let calls=0,writes=0;
const audit=make({getScriptProperties(){return {getProperty(k){return keys[k]||null}}}},
 {log(s){JSON.parse(s)}},
 {fetch(url,options){calls++;assert.equal(options.method,'get');assert.match(url,/^https:\/\/api\.striven\.com\/v2\/reports\//);
 assert.ok(report[url]);return {getResponseCode(){return 200},getContentText(){return JSON.stringify(report[url])}}}},
 {openById(){return {getSheetByName(name){if(name==='ENP_PRIVATE_REPORT_STAGING')return null;return {getDataRange(){return {getValues(){return values}}},getRange(){writes++;throw Error('NO WRITES')}}}}}},
 ()=>({accessToken:'FAKE_TOKEN'}));
let tests=0,got=audit();
assert.equal(got.requests,2);tests++;
assert.equal(calls,2);tests++;
assert.equal(got.unionPlaceholderLines,3);tests++;
assert.equal(got.unionSalesOrders,3);tests++;
assert.equal(got.sentinel28419Present,true);tests++;
assert.equal(got.hubUnmatchedCount,0);tests++;
assert.deepEqual(got.byReport[0].names,['HUB','LEGACY_APPROVED']);tests++;
assert.equal(writes,0);tests++;
delete keys.STRIVEN_ENTERNEWPART_QUOTED_REPORT_API;
report['https://api.striven.com/v2/reports/Approved']={rows:[item(28500,'MEL90F/M','Quoted')]};
got=audit();assert.equal(got.status,'ATTENTION_REQUIRED');tests++;
assert.equal(got.sentinel28419Present,false);tests++;
assert.ok(got.warnings.includes('ONE_ENDPOINT_ONLY_LEGACY_DUAL_REPORT_COVERAGE_NOT_CONFIGURED'));tests++;
keys.HUB_ENP_REPORT_URL='http://unsafe.invalid/path';
assert.throws(()=>audit(),/ENP_SOURCE_REPORT_URL_INVALID/);tests++;
assert.equal(writes,0);tests++;
console.log(JSON.stringify({status:'PASS',assertions:tests,liveApiCalls:0,liveWrites:0}));
