// Node.js: full legacy project with API-free boundary tests.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const dir=process.argv[2];let checks=0,network=0;
function ctx(){const c=vm.createContext({Logger:{log(){}},console,UrlFetchApp:{fetch(){network++;throw Error('Network forbidden');}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})}});
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.js')).sort())vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),c,{filename:f});
const bundle=c.hub_row2LegacyEngine_.toString();vm.runInContext(bundle.slice(bundle.indexOf('{')+1,bundle.lastIndexOf('\nreturn {')),c);return c;}
const c=ctx();function test(n,fn){fn();checks++;console.log('PASS '+n);}
const row={'Create Authorized':true,'Item Number':'G190-0004-SER','Item Name':'THERMOSTAT (G190-0004-SER)',Price:3,Cost:1.8,'Item Category':'Hearth - Parts',Description:'THERMOSTAT (G190-0004-SER)','Preferred Vendor':'Wolf Steel Ltd.',Manufacturer:'Wolf Steel Ltd.','Manufacturer Part#':'G190-0004-SER','Serial Number Tracking':'NO','Location Name':'60 - WAREHOUSE (Ajax)',Taxable:'Yes','Item Type':'Inventory',UPC:'','MAP Price':'',Currency:'CAD',Source:'Approved','Sales Order Number':586037,'SO Internal ID':27771,'SO Status':'Approved',Quantity:2,'SO Line Price':3,'Striven Item ID':'','Quoted Authorization':'','Workflow Status':'LOOKUP PENDING','Review Reason':'',Discount:0.4,'Original Description':'Item Number: G190-0004-SER\nItem Name: THERMOSTAT\nPrice: $3.00'};
const desc='Item Number: G190-0004-SER\nItem Name: THERMOSTAT\nPrice: $3.00';
const source={SalesOrderSalesOrderId:27771,ItemItemId:36935,ItemNumber:'ENTERNEWPART',ItemDescription:desc,Quantity:2,Price:3,NewItemId:'',NewItemNumber:'',NewItemName:'',NewItemPrice:'',NewItemCost:'',LastAction:'',LastError:'',LastUpdated:''};
function grid(r){const h=Object.keys(r);return [h,h.map(k=>r[k])];}
function plan(change={},schange={}){return c.enp_legacyHubRow2Plan_(grid({...row,...change}),grid({...source,...schange}));}
test('reviewed row maps exactly and derives basename without doubled suffix',()=>{const p=plan();assert.equal(p.soId,27771);assert.equal(p.baseName,'THERMOSTAT');assert.equal(p.price,3);assert.equal(p.cost,1.8);assert.equal(p.quantity,2);});
test('authorization and pinned business scope reject changes',()=>{for(const change of [{'Create Authorized':false},{'Create Authorized':'TRUE'},{'SO Internal ID':7},{'Sales Order Number':8},{'Item Number':'OTHER'},{Currency:'USD'},{Price:4},{Cost:0},{Quantity:3},{Source:'Quoted'},{'Item Name':'Wrong (G190-0004-SER)'}])assert.throws(()=>plan(change));});
test('legacy source identity, price, missing and duplicate candidates reject',()=>{for(const change of [{Price:4},{ItemDescription:'G190-0004-SER THERMOSTAT $3'},{ItemDescription:desc.replace('THERMOSTAT','OTHER')},{Quantity:3}])assert.throws(()=>plan({},change));const g=grid(source);assert.throws(()=>c.enp_legacyHubRow2Plan_(grid(row),[...g,g[1]]),/exactly one/);});
test('search envelopes accept only explicit arrays or proved zero',()=>{for(const b of [[],{data:[],totalCount:0},{Data:null,TotalCount:0},{data:[{id:1}],totalCount:1}])assert(Array.isArray(c.enp_legacySearchPage_(b).rows));for(const b of [null,{}, {data:null,totalCount:1},{data:[],rows:[]},{data:[],totalCount:false},{data:[],totalCount:-1},{data:[{}],totalCount:0},{data:[],totalCount:1,TotalCount:2}])assert.throws(()=>c.enp_legacySearchPage_(b));});
test('serial NO policy is scoped and does not suppress MAP or YES review',()=>{const refs={BaseCurrency:'CAD',LegacyUntrackedItemNumbers:['G190-0004-SER']};for(const [field,name,id] of [['ItemType','Inventory',901],['DefaultInventoryLocation',row['Location Name'],902],['Category',row['Item Category'],903],['PreferredVendor',row['Preferred Vendor'],904],['Manufacturer',row.Manufacturer,905]])refs[field]=[{Id:id,Name:name,Verified:true,Evidence:'synthetic live witness'}];const base={ItemNumber:row['Item Number'],Name:row['Item Name']};const r={...row,'Workflow Status':'READY'};
assert.equal(c.enp_guardHubPayloadFromRecord_(base,r,refs).unsupportedFields.length,0);
assert(c.enp_guardHubPayloadFromRecord_(base,{...r,'Serial Number Tracking':'YES'},refs).unsupportedFields.includes('Serial Number Tracking'));
assert(c.enp_guardHubPayloadFromRecord_(base,{...r,'MAP Price':0},refs).unsupportedFields.includes('MAP Price'));
assert(c.enp_guardHubPayloadFromRecord_(base,r,{...refs,LegacyUntrackedItemNumbers:[]}).unsupportedFields.includes('Serial Number Tracking'));
});
function run(opts={}){const x=ctx(),events=[],p=plan(),hub={getDataRange:()=>({getValues:()=>grid(row)}),getRange:()=>({setValue:v=>events.push(['hubID',v])})},src={getDataRange:()=>({getValues:()=>grid(source)})};
x.LockService={getUserLock:()=>({waitLock(){},releaseLock(){events.push(['unlock']);}})};
x.SpreadsheetApp={getActive:()=>({getSheetByName:()=>src})};// Use original project configuration.
x.enp_guardHubBook_=()=>({getSheetByName:()=>hub});x.enp_legacyHubRow2Plan_=()=>p;
x.enp_getSalesOrder_=()=>({orderNumber:586037,status:{name:opts.badStatus?'Quoted':'Approved'},lineItems:[]});
x.enp_legacyExactLookupNow_=()=>{events.push(['lookup']);return opts.existing?{Id:9901}:null};
x.enp_findTargetPlaceholderLine_=()=>({id:8801,qty:opts.badQty?9:2,price:3});
x.enp_buildItemPayloadFromSheetRow_=()=>({ItemNumber:row['Item Number'],Name:'THERMOSTAT',Cost:1.8,Price:3});
x.enp_soDefaultInventoryLocationId_=()=>902;
x.enp_legacyHydrateReferences_=()=>events.push(['references']);x.enp_legacyAssertHubRow2Unchanged_=()=>{};
x.enp_legacyWriteHubStatus_=(_,s)=>events.push(['status',s]);
x.enp_guardCreateOrResolveItem_=()=>{events.push(['resolve']);return {status:opts.existing?'EXISTS':'CREATED',id:9901}};
x.enp_legacySaveSourceResolution_=()=>events.push(['saveID',9901]);
x.enp_legacyLiveItem_=()=>({Id:9901,ItemNumber:row['Item Number'],Name:row['Item Name'],Price:3,Cost:1.8});
x.enp_replaceSalesOrderItems_=(id,reps)=>{events.push(['replace',id,reps]);if(opts.replaceFail)throw Error('replacement failure');return {replacements:[{lineId:8801}]}};
x.enp_legacySaveSourceAction_=(_,__,a)=>events.push(['sourceAction',a]);
let result,error;try{result=x.enp_runHubRow2CreateAndReplace()}catch(e){error=e}return {events,result,error};}
test('create route saves ID before replacement and uses existing engine',()=>{const r=run();if(r.error)throw r.error;assert.equal(r.result.status,'COMPLETED');const e=r.events;assert(e.findIndex(a=>a[0]==='saveID')<e.findIndex(a=>a[0]==='replace'));const rep=e.find(a=>a[0]==='replace');assert.equal(rep[1],27771);assert.equal(rep[2][0].desiredQty,2);assert.equal(rep[2][0].desiredPrice,3);assert.equal(rep[2][0].desiredItemName,'THERMOSTAT');assert(e.some(a=>a[0]==='references'));});
test('reuse route skips create metadata resolution',()=>{const r=run({existing:true});if(r.error)throw r.error;assert.equal(r.result.itemResolution,'EXISTS');assert(!r.events.some(a=>a[0]==='references'));});
test('live order status or quantity changes stop before resolution and replacement',()=>{for(const opts of [{badStatus:true},{badQty:true}]){const r=run(opts);assert(r.error);assert(!r.events.some(a=>a[0]==='resolve'||a[0]==='replace'));assert.equal(r.events.at(-1)[0],'unlock');}});
test('replacement failure retains captured item ID and retry status',()=>{const r=run({replaceFail:true});assert(r.error);assert(r.events.some(a=>a[0]==='saveID'));assert(r.events.some(a=>a[0]==='status'&&a[1]==='ITEM READY — REPLACEMENT BLOCKED'));assert.equal(r.events.at(-1)[0],'unlock');});

test('native plan uses Hub original description and SO line price',()=>{
 const p=c.enp_hubNativePlan_(grid(row));assert.equal(p.soId,27771);assert.equal(p.sourceRowNumber,2);
 assert.throws(()=>c.enp_hubNativePlan_(grid({...row,'Original Description':'wrong'})));
 assert.throws(()=>c.enp_hubNativePlan_(grid({...row,'SO Line Price':4})));
});
test('native preview reads only Hub and makes no writes or network calls',()=>{
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>grid(row)})})});
 const p=c.enp_previewHubRow2CreateAndReplace();assert.equal(p.status,'PREVIEW');assert.equal(p.strivenCalls,0);assert.equal(p.strivenWrites,0);
});
test('native builder defers type resolution and never invents IDs',()=>{
 const p=c.enp_hubNativePlan_(grid(row)),s=p.sourceRow,co=p.sourceCol;s[co.NewItemNumber]=row['Item Number'];s[co.NewItemName]='THERMOSTAT';s[co.NewItemPrice]=3;s[co.NewItemCost]=1.8;
 const b=c.enp_buildItemPayloadFromSheetRow_(s,co);assert(!b.ItemType);assert.equal(b.Cost,1.8);assert.equal(b.Name,'THERMOSTAT');
});
test('native auth uses Hub token manager and rejects missing credentials',()=>{
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>({CLIENT_ID:'synthetic-id',CLIENT_SECRET:'synthetic-secret'})[k]||null})};
 c.hub_strivenAccessToken_=(id,secret)=>{assert.equal(id,'synthetic-id');assert.equal(secret,'synthetic-secret');return {accessToken:'synthetic-token'};};
 assert.equal(c.enp_guardHeaders_().Authorization,'Bearer synthetic-token');
 c.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};assert.throws(()=>c.enp_guardHeaders_(),/credentials missing/);
});
test('watchdog schedules a global Hub handler',()=>{
 let handler;c.ScriptApp={getProjectTriggers:()=>[],newTrigger:n=>{handler=n;return {timeBased(){return this},after(){return this},create(){return this}}}};
 c.enp_scheduleItemGroupBridgeWatchdog_();assert.equal(handler,'hub_recoverItemGroupMasterBridgeWatchdog');assert.equal(typeof c[handler],'function');
});

test('SO location uses verified Hub registry without requiring a legacy property',()=>{
 const ref={Id:902,Name:'60 - WAREHOUSE (Ajax)',Verified:true,Evidence:'synthetic GET /v1/items/9901'};
 const registry={DefaultInventoryLocation:[ref]};
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='ENTERNEWPART_HUB_REFERENCE_IDS'?JSON.stringify(registry):null})};
 assert.equal(c.enp_soDefaultInventoryLocationId_(),902);
});
test('SO location rejects unverified, missing, duplicate or conflicting values',()=>{
 const ref={Id:902,Name:'60 - WAREHOUSE (Ajax)',Verified:true,Evidence:'synthetic GET /v1/items/9901'};
 for(const records of [[],[{...ref,Verified:false}],[{...ref,Evidence:''}],[{...ref,Name:'Other'}],[ref,ref]]){
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='ENTERNEWPART_HUB_REFERENCE_IDS'?JSON.stringify({DefaultInventoryLocation:records}):null})};
 assert.throws(()=>c.enp_soDefaultInventoryLocationId_());
 }
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='ENTERNEWPART_HUB_REFERENCE_IDS'?JSON.stringify({DefaultInventoryLocation:[ref]}):'999'})};
 assert.throws(()=>c.enp_soDefaultInventoryLocationId_(),/conflicts/);
});

const crypto=require('crypto');
function util(){return {DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:x=>Buffer.from(x).toString('base64url'),getUuid:()=>crypto.randomUUID(),sleep(){}};}
c.Utilities=util();
function gen(change={}){return {...row,'Item Number':'TEST-ABC','Item Name':'Part (TEST-ABC)','Manufacturer Part#':'TEST-ABC','Original Description':'Item Number: TEST-ABC\nItem Name: Part\nPrice: $3.00','Workflow Status':'READY',...change};}
test('generic Approved plan accepts non-row-2 SKU and preserves separate SO price',()=>{
 const r=gen({Price:10,Cost:6,'SO Line Price':8}),g=grid(r);g.push(g[1]);
 const p=c.enp_hubPlanRow_(g,3);assert.equal(p.rowNumber,3);assert.equal(p.price,10);assert.equal(p.cost,6);assert.equal(p.linePrice,8);
});
test('Quoted rows need both authorization booleans; Manual creates without SO',()=>{
 assert.throws(()=>c.enp_hubPlanRow_(grid(gen({Source:'Quoted'})),2),/Quoted Authorization/);
 assert.throws(()=>c.enp_hubPlanRow_(grid(gen({Source:'Quoted','Quoted Authorization':'TRUE'})),2),/Quoted Authorization/);
 assert.equal(c.enp_hubPlanRow_(grid(gen({Source:'Quoted','Quoted Authorization':true})),2).source,'QUOTED');
 const p=c.enp_hubPlanRow_(grid(gen({Source:'Manual','SO Internal ID':'','Sales Order Number':'',Quantity:'','SO Line Price':''})),2);
 assert.equal(p.soId,null);
});
test('generic plan rejects missing fields, wrong raw identity, serial YES, MAP and unsafe UPC',()=>{
 for(const change of [{'Create Authorized':false},{Cost:''},{Currency:'USD'},{'Manufacturer Part#':'wrong'},{'Original Description':'Item Number: OTHER\nItem Name: Part\nPrice: $3'},{'Serial Number Tracking':'YES'},{'MAP Price':0},{UPC:123},{'Item Category':''},{Quantity:0},{'SO Line Price':''}])assert.throws(()=>c.enp_hubPlanRow_(grid(gen(change)),2));
});
test('duplicate SKU rows are accepted only with identical catalog fields',()=>{
 const g=grid(gen());g.push(g[1].slice());assert(c.enp_hubPlanRow_(g,3));
 g[2][g[0].indexOf('Cost')]=99;assert.throws(()=>c.enp_hubPlanRow_(g,2),/Conflicting duplicate/);
});
test('fingerprint ignores execution output but detects authorization and source changes',()=>{
 const r=gen(),f=c.enp_hubFingerprint_(r);assert.equal(f,c.enp_hubFingerprint_({...r,'Workflow Status':'COMPLETED','Striven Item ID':999}));
 assert.notEqual(f,c.enp_hubFingerprint_({...r,'Create Authorized':false}));assert.notEqual(f,c.enp_hubFingerprint_({...r,'SO Line Price':8}));
 assert(f.length<100);
});
test('preview includes all rows without API calls or writes',()=>{
 const records=[gen({'Workflow Status':'COMPLETED'}),gen({'Create Authorized':false}),gen({'Item Number':'OTHER','Item Name':'Other (OTHER)','Manufacturer Part#':'OTHER','Original Description':'Item Number: OTHER\nItem Name: Other\nPrice: $3'})];
 const h=Object.keys(records[0]),g=[h,...records.map(r=>h.map(k=>r[k]))];
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>g})})});
 const p=c.enp_hubPreviewAllRows_();assert.equal(p.rows,3);assert.equal(p.completed,1);assert.equal(p.unauthorized,0);assert.equal(p.eligible,2);assert.equal(p.strivenCalls,0);assert.equal(p.writes,0);
});
function autoRun(opts={}) {
 const x=ctx(),data=new Map(Object.entries(opts.props||{})),events=[];x.Utilities=util();
 const props={getProperty:k=>data.get(k)||null,setProperty(k,v){data.set(k,v);return this},deleteProperty:k=>data.delete(k)};
 x.PropertiesService={getScriptProperties:()=>props};x.LockService={getScriptLock:()=>({tryLock:()=>!opts.busy,releaseLock(){}})};
 const rs=opts.rows||[gen({'Item Number':'P1','Item Name':'Part (P1)','Manufacturer Part#':'P1','Original Description':'Item Number: P1\nItem Name: Part\nPrice: $3'}),gen({'Item Number':'P2','Item Name':'Part (P2)','Manufacturer Part#':'P2','Original Description':'Item Number: P2\nItem Name: Part\nPrice: $3'}),gen({'Item Number':'P3','Item Name':'Part (P3)','Manufacturer Part#':'P3','Original Description':'Item Number: P3\nItem Name: Part\nPrice: $3'})];
 const h=Object.keys(rs[0]),g=[h,...rs.map(r=>h.map(k=>r[k]))],sheet={getDataRange:()=>({getValues:()=>g}),getRange:()=>({setValue:v=>events.push(['status',v])})};
 x.enp_guardHubBook_=()=>({getSheetByName:()=>sheet});
 x.enp_hubExecuteRow_=row=>{events.push(['execute',row]);if(opts.fail)throw Error('synthetic failure');return {status:'COMPLETED',row};};
 return {x,data,events,run:()=>x.enp_hubRunEligibleRows_()};
}
test('worker is disabled or paused without API calls',()=>{
 for(const props of [{HUB_ENP_AUTOMATION_ENABLED:'false'},{HUB_ENP_AUTOMATION_ENABLED:'true',HUB_ENP_PAUSE_UNTIL:String(Date.now()+90000)}]){
 const a=autoRun({props});assert.equal(a.run().processed,0);assert.equal(a.events.length,0);}
});
test('worker processes at most two rows and removes its lease',()=>{
 const a=autoRun({props:{HUB_ENP_AUTOMATION_ENABLED:'true'}}),r=a.run();assert.equal(r.processed,2);assert.equal(a.events.filter(x=>x[0]==='execute').length,2);assert(!a.data.has('HUB_ENP_WORKER_LEASE'));
});
test('worker skips completed and explicitly held rows',()=>{
 const a=autoRun({props:{HUB_ENP_AUTOMATION_ENABLED:'true'},rows:[gen({'Workflow Status':'COMPLETED'}),gen({'Create Authorized':false,'Workflow Status':'HOLD'})]});assert.equal(a.run().processed,0);assert(!a.events.some(x=>x[0]==='execute'));
});
test('worker lease prevents concurrent execution',()=>{
 const a=autoRun({props:{HUB_ENP_AUTOMATION_ENABLED:'true',HUB_ENP_WORKER_LEASE:JSON.stringify({token:'other',until:Date.now()+90000})}});assert.equal(a.run().status,'BUSY');assert.equal(a.events.length,0);
});
test('failed rows back off and stop after three unchanged attempts',()=>{
 const a=autoRun({props:{HUB_ENP_AUTOMATION_ENABLED:'true'},fail:true,rows:[gen()]});assert.equal(a.run().processed,1);assert.equal(a.run().processed,0);
 const p=a.x.enp_hubPlanRow_([Object.keys(gen()),Object.values(gen())],2);
 a.data.set('HUB_ENP_ROW_STATE_2',JSON.stringify({fingerprint:p.fingerprint,attempts:3,nextAt:0}));assert.equal(a.run().processed,0);
});

function torontoUtilities(){return {...util(),formatDate(date,zone,format){
 assert.equal(zone,'America/Toronto');
 if(format==='Z'){const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(date).find(x=>x.type==='timeZoneName').value;return p.replace('GMT','').replace(':','')||'+0000';}
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date),p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const day=p.year+'-'+p.month+'-'+p.day;return format==='yyyy-MM-dd'?day:day+' '+p.hour+':'+p.minute;
}};}
test('Toronto schedule has exactly the requested six daily slots',()=>{
 const x=ctx();x.Utilities=torontoUtilities();
 const pairs=[
 ['2026-10-20T11:59:00Z','2026-10-20T12:00:00.000Z'],
 ['2026-10-20T12:00:00Z','2026-10-20T14:00:00.000Z'],
 ['2026-10-20T14:00:00Z','2026-10-20T16:00:00.000Z'],
 ['2026-10-20T16:00:00Z','2026-10-20T18:00:00.000Z'],
 ['2026-10-20T18:00:00Z','2026-10-20T20:00:00.000Z'],
 ['2026-10-20T20:00:00Z','2026-10-20T22:00:00.000Z'],
 ['2026-10-20T22:00:00Z','2026-10-21T12:00:00.000Z'],
 ['2026-10-21T02:00:00Z','2026-10-21T12:00:00.000Z']];
 for(const [now,next]of pairs)assert.equal(x.hub_nextEnternewpartRun_(new Date(now)).toISOString(),next);
});
test('Toronto schedule handles both daylight-saving transitions and year rollover',()=>{
 const x=ctx();x.Utilities=torontoUtilities();
 for(const [now,next]of [
 ['2026-10-31T22:01:00Z','2026-11-01T13:00:00.000Z'],
 ['2026-03-07T23:01:00Z','2026-03-08T12:00:00.000Z'],
 ['2026-12-31T23:01:00Z','2027-01-01T13:00:00.000Z']]){
 assert.equal(x.hub_nextEnternewpartRun_(new Date(now)).toISOString(),next);
 }
});
test('installer replaces the five-minute timer, remains singular and preserves unrelated triggers',()=>{
 const x=ctx();x.Utilities=torontoUtilities();let triggers=[{getUniqueId:()=> 'old',getHandlerFunction:()=> 'hub_processEnternewpartAutomation'},{getUniqueId:()=> 'other',getHandlerFunction:()=> 'unrelated'}],n=0;const props=new Map();
 x.ScriptApp={getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased(){return this},at(date){assert(date.getTime()>Date.now());this.date=date;return this},create(){const id='new'+(++n),t={getUniqueId:()=>id,getHandlerFunction:()=>name};triggers.push(t);return t;}}),deleteTrigger:t=>{triggers=triggers.filter(y=>y.getUniqueId()!==t.getUniqueId())}};
 x.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 x.PropertiesService={getScriptProperties:()=>({setProperty:(k,v)=>props.set(k,v),getProperty:k=>props.get(k)||null})};
 x.hub_previewEnternewpartAutomation=()=>({eligible:0,completed:1,review:64});
 assert.equal(x.hub_enableEnternewpartAutomation().status,'INSTALLED');x.hub_enableEnternewpartAutomation();
 assert.equal(triggers.filter(y=>y.getHandlerFunction()==='hub_enternewpartScheduledRun').length,1);
 assert(triggers.some(y=>y.getHandlerFunction()==='unrelated'));assert(!triggers.some(y=>y.getHandlerFunction()==='hub_processEnternewpartAutomation'));
 assert(props.has('HUB_ENP_NEXT_RUN_AT'));assert.equal(props.get('HUB_ENP_AUTOMATION_ENABLED'),'true');
 x.hub_pauseEnternewpartAutomation();assert.equal(props.get('HUB_ENP_AUTOMATION_ENABLED'),'false');
});
test('old five-minute callbacks automatically migrate without business writes',()=>{
 const x=ctx();let migrated=0;x.hub_enternewpartScheduledRun=()=>{migrated++;return {status:'MIGRATED'}};
 assert.equal(x.hub_processEnternewpartAutomation({triggerUid:'old'}).status,'MIGRATED');assert.equal(migrated,1);
});
test('scheduled callback rearms before work and skips stale or missing due times',()=>{
 for(const delta of [null,2*60*60*1000,5*60*1000]){
  const x=ctx(),events=[];x.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='HUB_ENP_NEXT_RUN_AT'&&delta!==null?new Date(Date.now()-delta).toISOString():null})};
  x.hub_scheduleNextEnternewpartRun_=()=>{events.push('rearm');return {};};
  x.hub_refreshEnternewpartReport=()=>{events.push('refresh');return {reportRows:1,inserted:0,activeRows:[2],completedStillInReport:[]}};
  x.hub_row2LegacyEngine_=()=>({enp_hubRunEligibleRows_:rows=>{assert.equal(rows.join(','),'2');events.push('work');return {status:'COMPLETE'}}});
  x.hub_enternewpartScheduledRun();assert.equal(events[0],'rearm');assert.equal(events.includes('work'),delta===5*60*1000);
 }
});



test('report failure stops worker; successful refresh limits eligible rows',()=>{
 const x=ctx();let ran=0;
 x.hub_row2LegacyEngine_=()=>({enp_hubRunEligibleRows_:rows=>{ran++;assert.equal(rows.join(','),'3,7');return {status:'COMPLETE'}}});
 x.hub_refreshEnternewpartReport=()=>{throw Error('report unavailable')};
 assert.throws(()=>x.hub_runEnternewpartReportWorker_(),/report unavailable/);assert.equal(ran,0);
 x.hub_refreshEnternewpartReport=()=>({reportRows:2,inserted:0,activeRows:[3,7],completedStillInReport:[]});
 assert.equal(x.hub_runEnternewpartReportWorker_().reportRefresh.activeRows,2);assert.equal(ran,1);
});

function genericExecute(opts={}) {
 const x=ctx(),r=gen(opts.manual?{Source:'Manual','SO Internal ID':'','Sales Order Number':'',Quantity:'','SO Line Price':''}:{Price:10,Cost:6,'SO Line Price':8}),g=grid(r),events=[];
 x.Utilities=util();x.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
 const sheet={getDataRange:()=>({getValues:()=>g}),getRange:(row,col)=>({setValue:v=>{g[row-1][col-1]=v;events.push(['write',col,v]);}})};
 x.enp_guardHubBook_=()=>({getSheetByName:()=>sheet});
 x.enp_legacyExactLookupNow_=()=>opts.existing?{Id:9901}:null;
 x.enp_getSalesOrder_=()=>({orderNumber:r['Sales Order Number'],status:{name:opts.badStatus?'Quoted':r.Source},
 lineItems:[{id:8801,item:{id:36935},description:r['Original Description'],qty:2,price:opts.badPrice?9:8}]});
 x.enp_hubHydrateCreateReferences_=()=>events.push(['references']);
 x.enp_guardBuildHubCreatePayload_=b=>b;x.enp_soDefaultInventoryLocationId_=()=>902;
 x.enp_guardCreateOrResolveItem_=b=>{events.push(['resolve',b.Price,b.Cost]);return {status:opts.existing?'EXISTS':'CREATED',id:9901};};
 x.enp_legacyLiveItem_=()=>({Id:9901,ItemNumber:r['Item Number'],Name:r['Item Name'],Price:r.Price,Cost:r.Cost});
 x.enp_replaceSalesOrderItems_=(id,rs)=>{events.push(['replace',id,rs]);if(opts.failReplace)throw Error('synthetic replacement failure');return {replacements:[{lineId:8801}]};};
 let result,error;try{result=x.enp_hubExecuteRow_(2);}catch(e){error=e;}
 return {x,result,error,events,g};
}
test('generic executor preserves SO price separately from catalog price and saves ID first',()=>{
 const t=genericExecute();if(t.error)throw t.error;
 const p=t.events.find(e=>e[0]==='replace');assert.equal(p[2][0].desiredPrice,8);assert.equal(p[2][0].desiredQty,2);
 const idCol=t.g[0].indexOf('Striven Item ID')+1;assert(t.events.findIndex(e=>e[0]==='write'&&e[1]===idCol)<t.events.findIndex(e=>e[0]==='replace'));
 assert.equal(t.g[1][t.g[0].indexOf('Workflow Status')],'COMPLETED');
 assert.equal(vm.runInContext('ENP_HUB_ACTIVE_PLAN',t.x),null);
});
test('generic live status or price drift stops before item resolution',()=>{
 for(const o of [{badStatus:true},{badPrice:true}]){const t=genericExecute(o);assert(t.error);assert(!t.events.some(e=>e[0]==='resolve'||e[0]==='replace'));}
});
test('generic Manual item completes without an SO update and reuse skips metadata writes',()=>{
 const t=genericExecute({manual:true,existing:true});if(t.error)throw t.error;assert.equal(t.result.status,'COMPLETED');assert(!t.events.some(e=>e[0]==='replace'||e[0]==='references'));
});
test('generic replacement failure keeps saved item ID',()=>{
 const t=genericExecute({failReplace:true});assert(t.error);assert.equal(t.g[1][t.g[0].indexOf('Striven Item ID')],9901);
 assert.equal(t.g[1][t.g[0].indexOf('Workflow Status')],'ITEM READY — REPLACEMENT BLOCKED');
});
test('actual legacy line application works without the old location property',()=>{
 const x=ctx();x.PropertiesService={getScriptProperties:()=>({getProperty:k=>k==='ENTERNEWPART_HUB_REFERENCE_IDS'?JSON.stringify({DefaultInventoryLocation:[{Id:902,Name:'60 - WAREHOUSE (Ajax)',Verified:true,Evidence:'synthetic live item'}]}):null})};
 const line={item:{id:36935},description:'old',qty:2,price:8};
 x.enp_applyReplacementToLine_(line,{newItemId:9901,desiredItemNumber:'ABC',desiredItemName:'Part',desiredPrice:8},{Id:9901,Name:'Part (ABC)',ItemType:{Id:1,Name:'Inventory'}});
 assert.equal(line.item.id,9901);assert.equal(line.inventoryLocation.id,902);assert.equal(line.qty,2);assert.equal(line.price,8);
});


test('preview ignores unused rows containing FALSE checkboxes',()=>{
 const g=grid(gen({'Workflow Status':'COMPLETED'})),empty=g[0].map(()=>''),idx=g[0].indexOf('Create Authorized');empty[idx]=false;g.push(empty);
 c.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>g})})});
 const p=c.enp_hubPreviewAllRows_();assert.equal(p.rows,1);assert.equal(p.completed,1);assert.equal(p.unauthorized,0);
});


test('standing policy validates Approved, Quoted and Manual without legacy checkboxes',()=>{
 for(const r of [gen({'Create Authorized':false}),gen({Source:'Quoted','Create Authorized':false,'Quoted Authorization':false}),gen({Source:'Manual','Create Authorized':false,'SO Internal ID':'','Sales Order Number':'',Quantity:'','SO Line Price':''})]){
 const g=grid(r),p=c.enp_hubAutomaticPlan_(g,2);assert.equal(p.autoValidated,true);assert.equal(p.record['Create Authorized'],true);
 if(r.Source==='Quoted')assert.equal(p.record['Quoted Authorization'],true);
 assert.equal(g[1][g[0].indexOf('Create Authorized')],false);assert.equal(p.fingerprint,c.enp_hubFingerprint_(r));
 }
});
test('automatic policy retains hold and data validation barriers',()=>{
 for(const change of [{'Workflow Status':'HOLD'},{'Workflow Status':'PAUSED'},{'Workflow Status':'DO NOT CREATE'},{Cost:''},{'Manufacturer Part#':'bad'},{'Serial Number Tracking':'YES'},{'MAP Price':0},{'Original Description':'unidentified'}]){
 assert.throws(()=>c.enp_hubAutomaticPlan_(grid(gen({'Create Authorized':false,...change})),2));
 }
});
test('worker processes valid unchecked rows without first enabling a flag',()=>{
 const a=autoRun({rows:[gen({'Create Authorized':false})]});assert.equal(a.run().processed,1);assert(a.events.some(e=>e[0]==='execute'));
});
test('worker ignores empty FALSE checkbox rows and reviews invalid unchecked rows',()=>{
 const r=gen({'Create Authorized':false,Cost:''}),blank=Object.fromEntries(Object.keys(r).map(h=>[h,h==='Create Authorized'?false:'']));
 const a=autoRun({rows:[r,blank]});assert.equal(a.run().processed,0);assert(!a.events.some(e=>e[0]==='execute'));
 assert(a.events.some(e=>e[0]==='status'&&e[1]==='NEEDS REVIEW'));
});


test('automatic payload context permits legacy FALSE flags after full validation',()=>{
 const x=ctx(),r=gen({Source:'Quoted','Create Authorized':false,'Quoted Authorization':false}),g=grid(r);x.Utilities=util();
 x.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>g})})});
 const refs={BaseCurrency:'CAD',LegacyUntrackedItemNumbers:[r['Item Number']]};
 for(const [field,name,id] of [['ItemType','Inventory',901],['DefaultInventoryLocation',r['Location Name'],902],['Category',r['Item Category'],903],['PreferredVendor',r['Preferred Vendor'],904],['Manufacturer',r.Manufacturer,905]])refs[field]=[{Id:id,Name:name,Verified:true,Evidence:'synthetic live item'}];
 x.PropertiesService={getScriptProperties:()=>({getProperty:()=>JSON.stringify(refs)})};
 x.testPlan=x.enp_hubAutomaticPlan_(g,2);vm.runInContext('ENP_HUB_ACTIVE_PLAN=testPlan',x);
 const out=x.enp_guardBuildHubCreatePayload_({ItemNumber:r['Item Number'],Name:r['Item Name']});assert.equal(out.ItemNumber,r['Item Number']);assert.equal(out.Cost,r.Cost);
 g[1][g[0].indexOf('Cost')]=99;assert.throws(()=>x.enp_guardBuildHubCreatePayload_({ItemNumber:r['Item Number'],Name:r['Item Name']}),/row changed/);
});
test('automatic payload context never authorizes a different SKU',()=>{
 const x=ctx(),r=gen({'Create Authorized':false}),g=grid(r);x.Utilities=util();
 x.enp_guardHubBook_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>g})})});
 x.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
 x.testPlan=x.enp_hubAutomaticPlan_(g,2);vm.runInContext('ENP_HUB_ACTIVE_PLAN=testPlan',x);
 assert.throws(()=>x.enp_guardBuildHubCreatePayload_({ItemNumber:'OTHER',Name:'Other'}),/Item Number mismatch/);
});

assert.equal(network,0);console.log(JSON.stringify({checks,externalNetworkAttempts:network}));
