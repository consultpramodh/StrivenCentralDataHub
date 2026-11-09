// JavaScript (Node.js) - isolated tests for deployed ENP handler; no network or real Sheets writes.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/ENTERNEWPART_EndToEnd_Diagnostic_Fix.gs','utf8');
const header=['Create Authorized','Item Number','Item Name','Price','Cost','Item Category','Description','Preferred Vendor','Manufacturer','Manufacturer Part#','Serial Number Tracking','Location Name','Taxable','Item Type','UPC','MAP Price','Currency','Source','Sales Order Number','SO Internal ID','SO Status','Quantity','SO Line Price','Striven Item ID','Quoted Authorization','Workflow Status','Review Reason','Research URL','Cost Basis','Discount','Source Item Price','Original Description','Original Action','Original Error','Source Row','Last Source Update','Hub Match Status','Supplier List Price','Supplier Currency','Supplier Price Source','Cost Inputs Verified','Calculated Cost','Cost Calculation Status','Description Quality'];
function row(sku,status,reason){const a=Array(header.length).fill('');a[header.indexOf('Item Number')]=sku;a[header.indexOf('Source')]='Approved';a[header.indexOf('Original Description')]='Item Number: '+sku;a[header.indexOf('Workflow Status')]=status;a[header.indexOf('Review Reason')]=reason;return a;}
const data=[header,row('A100','EXECUTION BLOCKED','HTTP 400 from Striven'),row('A101','ITEM READY — REPLACEMENT BLOCKED','Custom Field Id 775 required'),row('A102','NEEDS REVIEW','Missing Item Category'),row('A103','','')];
const writes=[];
const sheet={getDataRange(){return {getValues(){return data}}},getRange(row,col){return {setValue(v){writes.push({row,col,v});data[row-1][col-1]=v}}}};
const props={};
const C={Date,JSON,Math,Number,String,Set,Map,Array,Object,Logger:{log(){}},
 SpreadsheetApp:{openById(){return {getSheetByName(name){assert.equal(name,'ENTERNEWPART');return sheet}}}},
 PropertiesService:{getScriptProperties(){return {getProperty:k=>props[k]??null,setProperty(k,v){props[k]=String(v)},deleteProperty(k){delete props[k]}}}},
 LockService:{getScriptLock(){return {tryLock(){return true},releaseLock(){}}}},
 Utilities:{getUuid(){return 'offline-uuid'}}};
vm.createContext(C);vm.runInContext(src,C);
let assertions=0;
function eq(a,b){assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));assertions++}
const selected=C.hub_enpPendingQueueRows_([2]);eq(selected.rows,[2,3,4,5]);eq(selected.backlog,3);
const result=C.hub_row2LegacyEngine_().enp_hubRunEligibleRows_([2,3,4,5],{maxTimeMs:180000});
eq(result.review.length,4);eq(result.processed,0);
for(const [i,status] of ['EXECUTION BLOCKED','ITEM READY — REPLACEMENT BLOCKED','NEEDS REVIEW'].entries())eq(data[i+1][header.indexOf('Workflow Status')],status);
eq(data[1][header.indexOf('Review Reason')],'HTTP 400 from Striven');
eq(data[2][header.indexOf('Review Reason')],'Custom Field Id 775 required');
eq(data[3][header.indexOf('Review Reason')],'Missing Item Category');
eq(data[4][header.indexOf('Workflow Status')],'NEEDS REVIEW');
assert.ok(String(data[4][header.indexOf('Review Reason')]).length>0);assertions++;
eq(writes.map(x=>x.row),[5,5]);
eq(result.review[1].previousReason,'Custom Field Id 775 required');
console.log(JSON.stringify({status:'PASS',assertions,externalCalls:0,externalWrites:0}));
