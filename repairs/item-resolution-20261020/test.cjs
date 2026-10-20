// JavaScript / Node.js: behavior tests with no network or production writes.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const hub=fs.readFileSync(__dirname+'/HUB/10_Central_Hub.js','utf8');
const enp=fs.readFileSync(__dirname+'/ENP/98_enp_item_resolution_guard.js','utf8');
const h=vm.createContext({console}),e=vm.createContext({console,Logger:{log(){}}});
vm.runInContext(hub,h);vm.runInContext(enp,e);
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
const response=(body,code=200)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify(body),getAllHeaders:()=>({'Retry-After':'90'})});
test('canonical name and idempotence',()=>{
 assert.equal(e.enp_guardCanonicalName_('THERMOSTAT','G190-0004-SER'),'THERMOSTAT (G190-0004-SER)');
 assert.equal(e.enp_guardCanonicalName_('THERMOSTAT (G190-0004-SER)','G190-0004-SER'),'THERMOSTAT (G190-0004-SER)');
 assert.equal(e.enp_guardCanonicalName_('THERMOSTAT (G190-0004-SER) (G190-0004-SER)','G190-0004-SER'),'THERMOSTAT (G190-0004-SER)');
 assert.throws(()=>e.enp_guardCanonicalName_('','ABC'));
});
let calls=[];
h.UrlFetchApp={fetch:(url,opt)=>{calls.push({url,opt});return response({TotalCount:2,Data:[{id:27802,itemNumber:'G190-0007-SER',name:'THERMOSTAT'},{id:900,itemNumber:'G190-0004-SER',name:'THERMOSTAT (G190-0004-SER)'}]});}};
test('LIKE search exact matching and JSON contract',()=>{
 const result=h.hub_itemLookupExact_('G190-0004-SER','test');assert.equal(result.id,900);
 assert.equal(calls.length,1);assert.equal(calls[0].opt.contentType,'application/json');
 assert.equal(JSON.parse(calls[0].opt.payload).ItemNumber,'G190-0004-SER');
});
test('base name never reuses different part',()=>{
 h.UrlFetchApp.fetch=()=>response({TotalCount:1,Data:[{id:27802,itemNumber:'G190-0007-SER',name:'THERMOSTAT'}]});
 assert.equal(h.hub_itemLookupExact_('G190-0004-SER','test').status,'NOT_FOUND');
});
test('all filtered pages checked for ambiguity',()=>{
 let n=0;h.UrlFetchApp.fetch=()=>response({TotalCount:1001,Data:++n===1?[{id:1,itemNumber:'ABC'}]:[{id:2,itemNumber:'ABC'}]});
 assert.throws(()=>h.hub_itemLookupExact_('ABC','test'),/Multiple/);assert.equal(n,2);
});
test('malformed response cannot authorize create',()=>{
 h.UrlFetchApp.fetch=()=>response({message:'not a result'});
 assert.throws(()=>h.hub_itemLookupExact_('ABC','test'),/missing Data/);
 h.UrlFetchApp.fetch=()=>response({TotalCount:100,Data:[]});
 assert.throws(()=>h.hub_itemLookupExact_('ABC','test'),/premature/);
});
test('unfiltered or excessive results stop at three calls',()=>{
 let n=0;h.UrlFetchApp.fetch=()=>{n++;return response({TotalCount:20000,Data:[{id:1,itemNumber:'unrelated'}]});};
 assert.throws(()=>h.hub_itemLookupExact_('ABC','test'),/budget/);assert.equal(n,3);
});
test('429 returns cooldown information without retrying',()=>{
 let n=0;h.UrlFetchApp.fetch=()=>{n++;return response({message:'minute limit'},429);};
 assert.throws(()=>h.hub_itemLookupExact_('ABC','test'),x=>x.httpCode===429&&x.retrySeconds===90);assert.equal(n,1);
});
test('full catalog scans disabled',()=>assert.throws(()=>e.enp_guardScanAllItemsExact_('ABC'),/disabled/));
test('shared misses queue once, pending rechecks make zero Striven calls',()=>{
 let rows=[['ItemNumber','Status','ItemId','ItemJSON','CheckedAtUTC','NextAttemptUTC','Attempts','Error','RequestedBy','RequestedAtUTC']];
 e.enp_guardHubRequests_=()=>({getDataRange:()=>({getValues:()=>rows}),appendRow:r=>rows.push(r)});
 assert.throws(()=>e.enp_guardHubLookup_('ABC',false),/PENDING/);
 assert.throws(()=>e.enp_guardHubLookup_('ABC',false),/PENDING/);assert.equal(rows.length,2);
 rows[1][1]='NOT_FOUND';rows[1][4]=new Date().toISOString();assert.equal(e.enp_guardHubLookup_('ABC',false),null);
 rows[1][4]='not-a-date';assert.throws(()=>e.enp_guardHubLookup_('ABC',false));
});
test('mismatched item IDs and numbers cannot be reused',()=>{
 e.enp_guardFindLocalItemByNumber_=()=>({Id:1});
 e.enp_guardRawRequest_=()=>({ok:true,body:{id:1,itemNumber:'WRONG'}});
 e.enp_guardSearchExactItemNumber_=()=>{throw Error('QUEUED');};
 assert.throws(()=>e.enp_guardResolveExistingItem_('ABC'),/QUEUED/);
});
test('create names normalized and validation payload parked',()=>{
 const props=new Map();e.PropertiesService={getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})};
 e.enp_guardPayloadKey_=p=>'key:'+JSON.stringify(p);e.enp_guardResolveExistingItem_=()=>null;
 let count=0;e.enp_guardRawRequest_=(method,path,payload)=>{count++;assert.equal(payload.Name,'THERMOSTAT (G190-0004-SER)');return {ok:false,code:400,text:'duplicate name'};};
 const payload={ItemNumber:'G190-0004-SER',Name:'THERMOSTAT'};
 assert.throws(()=>e.enp_guardCreateOrResolveItem_(payload),/HTTP 400/);
 assert.throws(()=>e.enp_guardCreateOrResolveItem_(payload),/parked/);assert.equal(count,1);
 assert.equal(payload.Name,'THERMOSTAT');
});
test('uncertain POST outcome never automatically repeats',()=>{
 e.enp_guardRawRequest_=()=>{throw Error('network timeout');};
 const p={ItemNumber:'OTHER',Name:'Part'};
 assert.throws(()=>e.enp_guardCreateOrResolveItem_(p),/network/);
 assert.throws(()=>e.enp_guardCreateOrResolveItem_(p),/parked/);
});
console.log(checks+' behavior groups passed');
