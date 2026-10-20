// JavaScript / Node.js — pure adapter tests; no network or Striven writes.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[2],'utf8');
new vm.Script(source);
const start=source.indexOf('function hub_itemLookupPage_');
assert(start>=0);
const context={};vm.createContext(context);vm.runInContext(source.slice(start),context);
const p=context.hub_itemLookupPage_;
assert.equal(p([]).rows.length,0);
assert.equal(p([{Id:1}]).rows[0].Id,1);
for(const key of ['Data','data','Rows','rows','Results','results','Items','items','Records','records','Value','value']) assert.equal(p({[key]:[{Id:2}],TotalCount:1}).rows[0].Id,2);
for(const bad of [null,'bad',{}, {Data:[],Items:[]},{Data:[],TotalCount:-1},{Data:[],TotalCount:1,totalCount:2}]) assert.throws(()=>p(bad));
assert.equal(p({data:[],totalCount:0}).totalCount,0);
console.log('PASS: 21 response-envelope cases and complete Hub JavaScript syntax');
