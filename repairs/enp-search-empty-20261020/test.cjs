// JavaScript / Node.js — no network or Striven writes.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[2],'utf8');new vm.Script(source);
const start=source.indexOf('function hub_itemLookupPage_');assert(start>=0);
const c={};vm.createContext(c);vm.runInContext(source.slice(start),c);
const p=c.hub_itemLookupPage_;let n=0;
function pass(f){f();n++;}
pass(()=>assert.equal(p([]).rows.length,0));
pass(()=>assert.equal(p([{Id:1}]).rows[0].Id,1));
for(const key of ['Data','data','Rows','rows','Results','results','Items','items','Records','records','Value','value']) pass(()=>assert.equal(p({[key]:[{Id:2}],TotalCount:1}).rows[0].Id,2));
for(const bad of [null,'bad',{}, {Data:[],Items:[]},{Data:[],TotalCount:-1},{Data:[],TotalCount:1,totalCount:2},{data:null,totalCount:1},{data:null},{totalCount:0},{data:{},totalCount:0},{data:null,totalCount:''},{data:null,totalCount:false},{data:[{Id:1}],totalCount:0}]) pass(()=>assert.throws(()=>p(bad)));
pass(()=>assert.equal(p({data:[],totalCount:0}).totalCount,0));
pass(()=>assert.equal(p({data:null,totalCount:0}).rows.length,0));
pass(()=>assert.equal(p({Data:null,TotalCount:0}).rows.length,0));
pass(()=>assert.equal(p({data:null,totalCount:'0'}).rows.length,0));
console.log('PASS: '+n+' response-envelope cases and complete Hub syntax');
