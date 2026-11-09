// JavaScript (Node.js): sensitive user-supplied Striven report URL stays outside GitHub source.
// Mock-only endpoints; zero live HTTP, Striven writes, or external sheet mutations.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync(__dirname+'/ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs','utf8');
const a=code.indexOf('function hub_enpUserProvidedReportUrl_(');
const b=code.indexOf('function hub_refreshEnternewpartReport()',a);
assert.ok(a>=0&&b>a,'Source config helper not found');
const factory=new Function('PropertiesService','Logger','UrlFetchApp','SpreadsheetApp',
 'hub_strivenAccessToken_','hub_row2LegacyEngine_',
 code.slice(a,b)+';return {load:hub_enpUserProvidedReportUrl_,collect:hub_enpCollectSourceReportRows_}');
const userUrl='https://api.striven.com/v2/reports/EXAMPLE_USER_REPORT_KEY';
const hubUrl='https://api.striven.com/v2/reports/EXAMPLE_HUB_REPORT_KEY';
const props={HUB_ENP_REPORT_URL:hubUrl,CLIENT_ID:'MOCK',CLIENT_SECRET:'MOCK'};
let staged=userUrl,configClears=0,configStatusWrites=0,flushes=0,liveCalls=[],logs=[];
const stagedSheet={getRange:function(ref){
 if(ref==='B2')return {getValue:()=>staged,clearContent:()=>{staged='';configClears++}};
 if(ref==='C2')return {setValue:()=>{configStatusWrites++}};
 throw new Error('UNEXPECTED_SHEET_ADDRESS '+ref);
}};
const reportRows={
 [hubUrl]:[{SalesOrderSalesOrderId:'28500',ItemItemId:36935,ItemNumber:'ENTERNEWPART',
 ItemDescription:'HUB fixture',Quantity:1,Price:50,SalesOrderNumber:'586765',SalesOrderStatus:'Quoted'}],
 [userUrl]:[{SalesOrderSalesOrderId:'28419',ItemItemId:36935,ItemNumber:' ENTERNEWPART ',
 ItemDescription:'USER fixture',Quantity:1,Price:835.80,SalesOrderNumber:'586684',SalesOrderStatus:'Approved'}]
};
const env=factory(
 {getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=String(v)}})},
 {log:x=>logs.push(x)},
 {fetch:(url,options)=>{
  assert.equal(options.method,'get');liveCalls.push(url);
  assert.ok(reportRows[url],'unrecognized source URL');
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({rows:reportRows[url],totalCount:1})};
 }},
 {openById:id=>{
  if(id==='13OKw69We9tsIWzEQwNOl4aAHh11qrsICSOt781O2upU')
   return {getSheetByName:name=>name==='ENP_PRIVATE_REPORT_STAGING'?stagedSheet:null};
  if(id==='123UZI5PmARY_2F57ABckpGBjiKVwCg4uE-QSoQCO2bU')
   return {getSheetByName:name=>({getDataRange:()=>({getValues:()=>[['SalesOrderSalesOrderId','ItemItemId','ItemNumber']]})})};
  throw new Error('Unknown workbook');
 },flush:()=>{flushes++}},
 ()=>({accessToken:'MOCK_TOKEN'}),
 ()=>({enp_getSalesOrder_:()=>{throw new Error('unexpected live SO read')},
 enp_getSalesOrderLineItems_:()=>{throw new Error('unexpected live SO lines read')}}));
let count=0;const ok=(c,msg)=>{assert.ok(c,msg);count++};
ok(env.load(false)===userUrl,'non-mutating preview reads staged source');
ok(!props.HUB_ENP_USER_REPORT_URL&&configClears===0,'preview must not promote or clear');
const first=env.collect();
ok(first.meta.reportRequests===2,'two distinct report requests');
ok(first.meta.unionLines===2&&first.meta.unionOrders===2,'both report rows retained');
ok(first.meta.endpoints.some(x=>x.sources.includes('USER_SUPPLIED')),'supplemental source labeled');
ok(props.HUB_ENP_USER_REPORT_URL===userUrl,'URL moved to private property');
ok(staged===''&&configClears===1&&configStatusWrites===1,'staging cell cleared after readback');
ok(flushes===1,'one-time handoff flush');
liveCalls=[];const second=env.collect();
ok(second.meta.reportRequests===2&&liveCalls.length===2,'subsequent trigger uses private source without extra fetch');
ok(configClears===1,'no extra stage changes');
ok(logs.every(v=>!String(v).includes(userUrl)),'API URL never logged');
console.log(JSON.stringify({status:'PASS',assertions:count,realApiCalls:0,realWrites:0}));
