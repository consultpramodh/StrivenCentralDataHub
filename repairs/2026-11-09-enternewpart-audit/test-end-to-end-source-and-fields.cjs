// JavaScript (Node.js) — offline end-to-end report/CF verification. Zero external calls.
'use strict';
const fs=require('node:fs'), assert=require('node:assert/strict');
const script=fs.readFileSync(__dirname+'/ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs','utf8');
const start=script.indexOf('function hub_enpUserProvidedReportUrl_(');
const end=script.indexOf('function hub_refreshEnternewpartReport()',start);
assert.ok(start>=0&&end>start);
const collector=new Function('PropertiesService','Logger','UrlFetchApp','SpreadsheetApp',
 'hub_strivenAccessToken_','hub_row2LegacyEngine_',script.slice(start,end)+';return hub_enpCollectSourceReportRows_');
const props={HUB_ENP_REPORT_URL:'https://api.striven.com/v2/reports/HUB',
 CLIENT_ID:'MOCK',CLIENT_SECRET:'MOCK'};
const row=(so,desc,status='Quoted')=>({SalesOrderSalesOrderId:String(so),
 ItemItemId:36935,ItemNumber:' ENTERNEWPART ',SalesOrderNumber:'SO'+so,
 ItemDescription:desc,Quantity:1,Price:10,SalesOrderStatus:status});
const original=[row(28500,'A'),row(28337,'X'),row(28337,'X'),row(28337,'Y')];
const legacy=[['SalesOrderSalesOrderId','ItemItemId','ItemNumber'],
 ['28500',36935,' ENTERNEWPART '],['28337',36935,'ENTERNEWPART'],
 ['28337',36935,'ENTERNEWPART'],['28337',36935,'ENTERNEWPART'],
 ['28419',36935,'ENTERNEWPART']];
let fetches=0,soGets=0,soStatus='Approved',sheetWrites=0;
const fn=collector({getScriptProperties:()=>({getProperty:k=>props[k]??null})},
 {log:()=>{}},
 {fetch:(url,opts)=>{assert.equal(opts.method,'get');fetches++;
 return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({rows:original,totalCount:4})}}},
 {openById:id=>{
 if(id==='13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU')
  return {getSheetByName:()=>null};
 assert.equal(id,'123UZI5PmARY_2F57ABckpGBjiKVwCg4uE-QSoQCO2bU');
 return {getSheetByName:()=>({getDataRange:()=>({getValues:()=>legacy}),
  getRange:()=>{sheetWrites++;throw Error('NO_WRITE')}})}}},
 ()=>({accessToken:'MOCK_TOKEN'}),
 ()=>({enp_getSalesOrder_:id=>{assert.equal(id,'28419');soGets++;
  return {orderNumber:'586684',status:{Name:soStatus},lineItems:[{id:7,item:{id:36935},
   description:'GLA-5DV live',quantity:1,price:835.8}]}},
  enp_getSalesOrderLineItems_:so=>so.lineItems}));
let checks=0;const verify=(condition,message)=>{assert.ok(condition,message);checks++};
const actual=fn();
verify(actual.meta.reportRequests===1,'report fetched once');
verify(actual.meta.liveOrderChecks===1,'one targeted live SO lookup');
verify(actual.meta.verifiedLegacyLines===1,'live missing SO line recovered');
verify(actual.rows.filter(x=>x.SalesOrderSalesOrderId==='28337'&&x.ItemDescription==='X').length===2,
 'distinct identical physical lines preserved');
verify(actual.rows.some(x=>x.SalesOrderSalesOrderId==='28419'&&x.Price===835.8),
 'live SO rather than legacy data used for fallback');
verify(actual.meta.coverageGuaranteed===false,'coverage not falsely asserted');
verify(sheetWrites===0,'no source writes');
soStatus='Completed';
const outside=fn();
verify(!outside.rows.some(x=>x.SalesOrderSalesOrderId==='28419'),'completed SO not injected');
props.STRIVEN_ENTERNEWPART_REPORT_API=props.HUB_ENP_REPORT_URL;
const duplicateUrl=fn();
verify(duplicateUrl.meta.reportRequests===1,'duplicate report URL causes redundant GET');
const gs=script.indexOf('function enp_hubCustomFieldHasValue_(');
const ge=script.indexOf('function enp_hubExecuteRow_(',gs);
assert.ok(gs>=0&&ge>gs);
const fieldCheck=new Function(script.slice(gs,ge)+';return enp_hubCheckRequiredFields_')();
fieldCheck({CustomFields:[{Id:775,BooleanValue:false},{Id:831,ValueText:'Delivery'}]},
 'Custom Field Id 775 is required., Custom Field Id 831 is required.');
checks++;
verify(!!(()=>{try{fieldCheck({CustomFields:[{Id:775,Value:''}]},
 'Custom Field Id 775 is required.');return false;}catch(e){return /SO_CF_775_REQUIRED/.test(e.message)}})(),
 'missing required SO field blocks');
const execution=script.slice(ge,script.indexOf('function enp_guardResolutionAsItemResponse_',ge));
verify(execution.indexOf("enp_hubCheckRequiredFields_(so,plan.record['Review Reason'])")>=0,
 'preflight uses known server failure');
verify(execution.indexOf("enp_hubCheckRequiredFields_(so,plan.record['Review Reason'])") <
 execution.indexOf("const existing=enp_legacyExactLookupNow_"),'preflight before catalog');
console.log(JSON.stringify({status:'PASS',assertions:checks,externalCalls:0,writes:0}));
